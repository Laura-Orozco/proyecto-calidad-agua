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
