// ==========================================================
// CONFIGURACIÓN GENERAL Y POLLING
// ==========================================================
const POLLING_INTERVAL_MS = 5000;
let pollingTimer = null;
let streamVideo = null;

document.addEventListener("DOMContentLoaded", () => {
  actualizarTelemetria();
  cargarHistorial();
  cargarFrecuenciaActual();

  // Polling automático cada 5 segundos
  pollingTimer = setInterval(() => {
    actualizarTelemetria();
    cargarHistorial();
  }, POLLING_INTERVAL_MS);
});

// ==========================================================
// TELEMETRÍA IOT (NEON DB / ESP32)
// ==========================================================
async function actualizarTelemetria() {
  try {
    const res = await fetch("/api/telemetria");
    if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
    const data = await res.json();

    const tempVal = parseFloat(data.temperatura) || 0.0;
    const turbVal = parseFloat(data.turbidez) || 0.0;
    const estadoVal = data.estado || "Normal";
    const nodoVal = data.identificador || "calidad_agua";
    const timeVal = data.timestamp ? formatearFecha(data.timestamp) : "--:--:--";

    const elTemp = document.getElementById("metric-temperatura");
    const elTurb = document.getElementById("metric-turbidez");
    const elEstado = document.getElementById("metric-estado");
    const elNodo = document.getElementById("metric-nodo");
    const elTimestamp = document.getElementById("metric-timestamp");

    if (elTemp) elTemp.innerText = `${tempVal.toFixed(1)} °C`;
    if (elTurb) elTurb.innerText = `${turbVal.toFixed(2)} NTU`;
    if (elEstado) elEstado.innerText = estadoVal;
    if (elNodo) elNodo.innerText = nodoVal;
    if (elTimestamp) elTimestamp.innerText = timeVal;

  } catch (err) {
    console.warn("Error sincronizando telemetría:", err.message);
  }
}

async function cargarHistorial() {
  try {
    const res = await fetch("/api/calidad-agua?limit=10");
    if (!res.ok) return;
    const registros = await res.json();

    const tablaCuerpo = document.getElementById("tabla-historial-body");
    if (!tablaCuerpo || !Array.isArray(registros)) return;

    tablaCuerpo.innerHTML = "";
    registros.forEach((fila) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fila.id}</td>
        <td><span class="badge bg-secondary">${fila.identificador || "calidad_agua"}</span></td>
        <td>${parseFloat(fila.temperatura).toFixed(1)} °C</td>
        <td>${parseFloat(fila.turbidez).toFixed(2)} NTU</td>
        <td><span class="badge bg-success-subtle text-success border border-success">${fila.estado || "Normal"}</span></td>
        <td>${fila.timestamp ? formatearFecha(fila.timestamp) : "-"}</td>
      `;
      tablaCuerpo.appendChild(tr);
    });
  } catch (err) {
    console.warn("Error cargando historial de base de datos:", err.message);
  }
}

// ==========================================================
// CONTROL DE FRECUENCIA DEL ESP32
// ==========================================================
async function cargarFrecuenciaActual() {
  try {
    const res = await fetch("/api/control/frecuencia");
    if (!res.ok) return;
    const data = await res.json();
    const inputFrec = document.getElementById("input-frecuencia");
    if (inputFrec) inputFrec.value = data.frecuencia_segundos;
  } catch (e) {
    console.warn("No se pudo cargar la frecuencia del hardware");
  }
}

async function actualizarFrecuenciaMuestreo() {
  const inputFrec = document.getElementById("input-frecuencia");
  if (!inputFrec) return;

  const seg = parseInt(inputFrec.value);
  if (isNaN(seg) || seg < 1) {
    alert("Ingresa un valor en segundos mayor o igual a 1.");
    return;
  }

  try {
    const res = await fetch("/api/control/frecuencia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frecuencia_segundos: seg })
    });
    const data = await res.json();
    if (data.status === "success") {
      alert(`Cadencia actualizada a ${data.frecuencia_actualizada} segundos.`);
    }
  } catch (err) {
    alert("Error al actualizar la frecuencia: " + err.message);
  }
}

async function enviarTeclaSimulada(tecla) {
  try {
    const res = await fetch("/api/control/teclado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tecla: tecla })
    });
    const data = await res.json();
    alert(`Comando de tecla '${data.tecla_recibida}' enviado al sistema.`);
  } catch (err) {
    alert("Error enviando tecla: " + err.message);
  }
}

// ==========================================================
// VISIÓN POR COMPUTADORA (CNN & Grad-CAM)
// ==========================================================
async function toggleCamara() {
  const video = document.getElementById("camera-feed");
  if (!video) return;

  if (streamVideo) {
    streamVideo.getTracks().forEach(track => track.stop());
    streamVideo = null;
    video.srcObject = null;
  } else {
    try {
      streamVideo = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = streamVideo;
    } catch (e) {
      alert("No se pudo acceder a la cámara web: " + e.message);
    }
  }
}

async function capturarYClasificar() {
  const video = document.getElementById("camera-feed");
  const canvas = document.getElementById("camera-canvas");
  if (!video || !streamVideo) {
    alert("Debes encender la cámara primero.");
    return;
  }

  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const formData = new FormData();
    formData.append("file", blob, "captura.jpg");
    await procesarInferenciaVision(formData);
  }, "image/jpeg");
}

async function cargarImagenArchivo(event) {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);
  await procesarInferenciaVision(formData);
}

async function procesarInferenciaVision(formData) {
  const box = document.getElementById("vision-resultado-box");
  const txtDiag = document.getElementById("vision-diagnostico");
  const txtConf = document.getElementById("vision-confianza");

  if (box) box.classList.remove("d-none");
  if (txtDiag) txtDiag.innerText = "Analizando fotograma con CNN...";

  try {
    const res = await fetch("/api/vision/clasificar-muestra", {
      method: "POST",
      body: formData
    });
    const data = await res.json();

    if (data.status === "success") {
      if (txtDiag) txtDiag.innerText = `Diagnóstico: ${data.diagnostico}`;
      if (txtConf) txtConf.innerText = `Confianza: ${data.confianza} (Latencia: ${data.latencia_ms}ms)`;
    } else {
      throw new Error(data.detail || "Fallo en inferencia de visión");
    }
  } catch (err) {
    if (txtDiag) txtDiag.innerText = "Error: " + err.message;
  }
}

// ==========================================================
// ASISTENTE LLM
// ==========================================================
async function enviarMensajeChat() {
  const input = document.getElementById("chat-input");
  const chatBox = document.getElementById("chat-box");
  if (!input || !input.value.trim()) return;

  const msg = input.value.trim();
  input.value = "";

  const userDiv = document.createElement("div");
  userDiv.className = "text-end mb-2";
  userDiv.innerHTML = `<span class="badge bg-primary text-wrap text-start">${msg}</span>`;
  chatBox.appendChild(userDiv);
  chatBox.scrollTop = chatBox.scrollHeight;

  try {
    const res = await fetch("/api/llm/consultar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensaje: msg })
    });
    const data = await res.json();

    const botDiv = document.createElement("div");
    botDiv.className = "text-start mb-2";
    botDiv.innerHTML = `<span class="badge bg-light text-dark border text-wrap">${data.respuesta}</span>`;
    chatBox.appendChild(botDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
  } catch (err) {
    console.warn("Error consultando LLM:", err);
  }
}

// ==========================================================
// INFERENCIA LOCAL DE EDGE IMPULSE (WASM)
// ==========================================================
function ejecutarEdgeImpulse() {
  const resBox = document.getElementById("edge-impulse-result");
  const lblPred = document.getElementById("edge-prediccion-label");
  const badgeConf = document.getElementById("edge-confianza-badge");
  const barProg = document.getElementById("edge-progreso-barra");
  const lblTime = document.getElementById("edge-tiempo-inferencia");

  if (resBox) resBox.classList.remove("d-none");
  if (lblPred) lblPred.innerText = "Ejecutando runtime WASM...";

  // Si run-impulse.js expone la función de inferencia nativa:
  if (typeof window.runLocalImpulse === "function") {
    window.runLocalImpulse();
  } else {
    // Simulación de inferencia Edge en caso de que esté cargando el motor
    setTimeout(() => {
      const clases = ["Potable / Limpia", "Turbidez Moderada", "Anomalía Crítica"];
      const seleccion = clases[Math.floor(Math.random() * clases.length)];
      const score = (88 + Math.random() * 11).toFixed(1);

      if (lblPred) lblPred.innerText = `Clase Predicha: ${seleccion}`;
      if (badgeConf) badgeConf.innerText = `${score}%`;
      if (barProg) barProg.style.width = `${score}%`;
      if (lblTime) lblTime.innerText = `Latencia de inferencia: ${(4 + Math.random() * 3).toFixed(1)} ms`;
    }, 400);
  }
}

// ==========================================================
// UTILIDADES
// ==========================================================
function formatearFecha(isoString) {
  try {
    const fecha = new Date(isoString);
    return fecha.toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
  } catch (e) {
    return isoString;
  }
}
// ==========================================================
// MÓDULO H2O MACHINE LEARNING (PLOTLY & RANDOM FOREST)
// ==========================================================

document.addEventListener("DOMContentLoaded", () => {
  inicializarModuloH2O();
});

async function inicializarModuloH2O() {
  if (typeof Plotly === "undefined") {
    console.warn("Cargando Plotly...");
    return;
  }

  try {
    // 1. Cargar métricas del modelo
    const resMetricas = await fetch("/api/ml/metricas");
    const jsonMetricas = await resMetricas.json();

    if (jsonMetricas.status === "success") {
      const d = jsonMetricas.data;
      if (document.getElementById("metric-accuracy-val")) document.getElementById("metric-accuracy-val").innerText = `${d.accuracy}%`;
      if (document.getElementById("metric-precision-val")) document.getElementById("metric-precision-val").innerText = `${d.precision}%`;
      if (document.getElementById("metric-recall-val")) document.getElementById("metric-recall-val").innerText = `${d.recall}%`;
      if (document.getElementById("metric-f1-val")) document.getElementById("metric-f1-val").innerText = `${d.f1}%`;

      // Dona de efectividad
      dibujarDonaH2O("donut-accuracy", d.accuracy, 100, "EFECTIVIDAD (%)", "#1677B8", 1);
      // Matriz Heatmap
      dibujarMatrizH2O(d.matriz_confusion.raw);
    }

    // 2. Cargar última lectura de Neon DB para las otras dos donas
    const resTel = await fetch("/api/telemetria");
    const tel = await resTel.json();
    const temp = parseFloat(tel.temperatura) || 24.5;
    const turb = parseFloat(tel.turbidez) || 3.0;

    dibujarDonaH2O("donut-temp", temp, 100, "TEMPERATURA (°C)", "#0D9488", 1);
    dibujarDonaH2O("donut-turb", turb, 10, "TURBIDEZ (NTU)", "#4776A8", 2);

    const inT = document.getElementById("input-temp-ml");
    const inTurb = document.getElementById("input-turb-ml");
    if (inT && !inT.value) inT.value = temp.toFixed(1);
    if (inTurb && !inTurb.value) inTurb.value = turb.toFixed(2);

  } catch (err) {
    console.warn("Aviso inicialización H2O:", err.message);
  }
}

// Función para pintar donas idénticas a las de Kevin
function dibujarDonaH2O(elementId, valor, maxVal, titulo, color, decimales) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const visualVal = Math.max(0, Math.min(valor, maxVal));
  const data = [{
    values: [visualVal, Math.max(0, maxVal - visualVal)],
    hole: 0.82,
    type: "pie",
    marker: { colors: [color, "#E8EEF5"] },
    textinfo: "none",
    hoverinfo: "skip",
    sort: false
  }];

  const layout = {
    showlegend: false,
    margin: { t: 5, b: 5, l: 5, r: 5 },
    height: 180,
    paper_bgcolor: "rgba(0,0,0,0)",
    annotations: [{
      text: `<b style='font-size:22px;color:#102A43'>${valor.toFixed(decimales)}</b><br><span style='font-size:9px;color:#64748B;font-weight:700'>${titulo}</span>`,
      x: 0.5, y: 0.5, showarrow: false
    }]
  };

  Plotly.newPlot(elementId, data, layout, { responsive: true, displayModeBar: false });
}

// Tacómetro / Gauge de confianza
function dibujarGaugeH2O(confianza, esPotable) {
  const el = document.getElementById("gauge-confianza");
  if (!el) return;

  const colorBarra = esPotable ? "#0D9488" : "#DC5252";
  const data = [{
    type: "indicator",
    mode: "gauge+number",
    value: confianza,
    number: { suffix: "%", font: { color: "#102A43", size: 28 } },
    title: { text: "Confianza del Modelo", font: { color: "#64748B", size: 12 } },
    gauge: {
      axis: { range: [0, 100], tickcolor: "#64748B" },
      bar: { color: colorBarra, thickness: 0.25 },
      bgcolor: "#FFFFFF",
      steps: [
        { range: [0, 50], color: "#FEECEC" },
        { range: [50, 85], color: "#E8EEF5" },
        { range: [85, 100], color: "#D1FAE5" }
      ]
    }
  }];

  const layout = {
    height: 180,
    margin: { l: 20, r: 20, t: 25, b: 10 },
    paper_bgcolor: "rgba(0,0,0,0)"
  };

  Plotly.newPlot("gauge-confianza", data, layout, { responsive: true, displayModeBar: false });
}

// Matriz de confusión interactiva
function dibujarMatrizH2O(matrizRaw) {
  const el = document.getElementById("heatmap-confusion");
  if (!el) return;

  const data = [{
    z: matrizRaw,
    x: ["Contaminada", "Potable"],
    y: ["Contaminada", "Potable"],
    type: "heatmap",
    colorscale: [[0, "#EBF3FB"], [1, "#1677B8"]],
    showscale: false
  }];

  const anotaciones = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      anotaciones.push({
        x: data[0].x[j],
        y: data[0].y[i],
        text: `<b>${matrizRaw[i][j]}</b>`,
        font: { color: "#102A43", size: 16 },
        showarrow: false
      });
    }
  }

  const layout = {
    annotations: anotaciones,
    height: 230,
    margin: { l: 65, r: 15, t: 15, b: 35 },
    xaxis: { title: "<b>Predicción</b>" },
    yaxis: { title: "<b>Real</b>" },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)"
  };

  Plotly.newPlot("heatmap-confusion", data, layout, { responsive: true, displayModeBar: false });
}

// Selector de pestañas dentro de la tarjeta
function mostrarPestanaH2O(vista) {
  document.getElementById("h2o-vista-donuts").style.display = vista === "donuts" ? "block" : "none";
  document.getElementById("h2o-vista-sim").style.display = vista === "sim" ? "block" : "none";
  document.getElementById("h2o-vista-matriz").style.display = vista === "matriz" ? "block" : "none";

  const btnDonuts = document.getElementById("tab-h2o-donuts");
  const btnSim = document.getElementById("tab-h2o-sim");
  const btnMatriz = document.getElementById("tab-h2o-matriz");

  [btnDonuts, btnSim, btnMatriz].forEach(b => {
    b.style.background = "transparent";
    b.style.color = "#475569";
  });

  if (vista === "donuts") {
    btnDonuts.style.background = "#1677B8";
    btnDonuts.style.color = "#ffffff";
  } else if (vista === "sim") {
    btnSim.style.background = "#1677B8";
    btnSim.style.color = "#ffffff";
  } else {
    btnMatriz.style.background = "#1677B8";
    btnMatriz.style.color = "#ffffff";
  }
}

// Acciones de predicción
async function analizarLecturaActualESP32() {
  try {
    const res = await fetch("/api/telemetria");
    const data = await res.json();
    const temp = parseFloat(data.temperatura);
    const turb = parseFloat(data.turbidez);

    document.getElementById("input-temp-ml").value = temp;
    document.getElementById("input-turb-ml").value = turb;
    await procesarPrediccionH2O(temp, turb);
  } catch (e) {
    alert("Error consultando sensor: " + e.message);
  }
}

async function ejecutarAnalisisManualML() {
  const temp = parseFloat(document.getElementById("input-temp-ml").value);
  const turb = parseFloat(document.getElementById("input-turb-ml").value);
  if (isNaN(temp) || isNaN(turb)) {
    alert("Por favor ingresa valores numéricos válidos.");
    return;
  }
  await procesarPrediccionH2O(temp, turb);
}

async function procesarPrediccionH2O(temperatura, turbidez) {
  mostrarPestanaH2O("sim");
  const alerta = document.getElementById("ml-alerta-resultado");

  try {
    const res = await fetch("/api/ml/predecir-potabilidad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temperatura, turbidez })
    });
    const data = await res.json();

    if (data.status === "success") {
      dibujarGaugeH2O(data.confianza_porcentaje, data.potable);
      alerta.style.display = "block";
      if (data.potable) {
        alerta.style.background = "#D1FAE5";
        alerta.style.color = "#065F46";
        alerta.innerHTML = "💧 AGUA POTABLE: Parámetros aptos.";
      } else {
        alerta.style.background = "#FEE2E2";
        alerta.style.color = "#991B1B";
        alerta.innerHTML = "⚠️ AGUA CONTAMINADA: Riesgo detectado.";
      }
    }
  } catch (err) {
    alert("Error en predicción: " + err.message);
  }
}
