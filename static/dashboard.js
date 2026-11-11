// static/dashboard.js - Manejo de datos de la API, Gráfica de Estados y Clasificador Edge Impulse Real (WASM)

const API_CALIDAD_AGUA_URL = "/api/calidad-agua";
const API_FALLBACK_URL = "https://backend-iot-vision.onrender.com/api/calidad-agua";

let chartEstadoCol = null;

// Instancia de Edge Impulse WASM
let classifier = null;
let isModelReady = false;

/**
 * 1. Inicialización del modelo WebAssembly de Edge Impulse
 */
async function inicializarModeloWASM() {
  const etiqueta = document.getElementById("resultadoEtiqueta");
  const confianza = document.getElementById("resultadoConfianza");

  if (typeof EdgeImpulseClassifier === "undefined") {
    console.warn("[Edge Impulse] Falta cargar edge-impulse-standalone.js o run-impulse.js");
    return;
  }

  try {
    classifier = new EdgeImpulseClassifier();
    await classifier.init();
    isModelReady = true;
    console.log("[Edge Impulse] Modelo WASM cargado e inicializado exitosamente.");
    
    if (etiqueta) etiqueta.innerText = "Modelo listo";
    if (confianza) confianza.innerText = "Ingrese valores numéricos para clasificar";
  } catch (err) {
    console.error("[Edge Impulse] Error al inicializar WASM:", err);
    if (etiqueta) etiqueta.innerText = "Error WASM";
    if (confianza) confianza.innerText = "No se pudo cargar el archivo .wasm";
  }
}

/**
 * 2. Inferencia Real de Edge Impulse (Punto 3 del Taller)
 */
function predecirMuestra() {
  const inputTurb = document.getElementById("inputTurb");
  const inputTemp = document.getElementById("inputTemp");
  const etiqueta = document.getElementById("resultadoEtiqueta");
  const confianza = document.getElementById("resultadoConfianza");

  if (!etiqueta || !confianza) return;

  if (!isModelReady || !classifier) {
    alert("El modelo WebAssembly aún se está inicializando. Por favor espere un momento.");
    return;
  }

  const turbidez = parseFloat(inputTurb ? inputTurb.value : 0);
  const temperatura = parseFloat(inputTemp ? inputTemp.value : 0);

  // Array ordenado esperado por el modelo: [Turbidez, Temperatura]
  const inputFeatures = [turbidez, temperatura];

  etiqueta.innerText = "Evaluando...";
  etiqueta.style.color = "var(--text-muted)";
  confianza.innerText = "Ejecutando inferencia en memoria local...";

  try {
    const result = classifier.classify(inputFeatures);
    console.log("[Edge Impulse] Resultado:", result);

    if (result && result.results && result.results.length > 0) {
      // Ordenar predicciones de mayor a menor confianza
      const predictions = result.results.sort((a, b) => b.value - a.value);
      const mejorPrediccion = predictions[0];

      const categoria = mejorPrediccion.label;
      const score = (mejorPrediccion.value * 100).toFixed(1);

      etiqueta.innerText = `Categoría: ${categoria}`;
      confianza.innerText = `Nivel de confianza: ${score}%`;

      // Resaltado de color institucional
      const catUpper = String(categoria).toUpperCase();
      if (catUpper.includes("CRITIC") || catUpper.includes("MALA") || catUpper.includes("PELIGRO")) {
        etiqueta.style.color = "var(--status-alert)";
      } else if (catUpper.includes("REGULAR")) {
        etiqueta.style.color = "var(--status-orange)";
      } else if (catUpper.includes("MODERADA")) {
        etiqueta.style.color = "var(--status-warn)";
      } else {
        etiqueta.style.color = "var(--status-ok)";
      }

      // Si tienes la gráfica de columnas activa, sincroniza el estado
      actualizarGraficaEstadoConDato(categoria);

    } else {
      etiqueta.innerText = "Sin resultados";
      confianza.innerText = "No se obtuvieron predicciones del modelo";
    }
  } catch (err) {
    console.error("[Edge Impulse] Error en classify():", err);
    etiqueta.innerText = "Error en inferencia";
    etiqueta.style.color = "var(--status-alert)";
    confianza.innerText = err.message;
  }
}

/**
 * 3. Gráfica en Columnas de Estado
 */
function inicializarGraficaEstado() {
  const ctx = document.getElementById("chartEstadoColumnas");
  if (!ctx || typeof Chart === "undefined") return;

  chartEstadoCol = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Óptima / Normal', 'Moderada', 'Regular', 'Crítica'],
      datasets: [{
        label: 'Estado Actual',
        data: [1, 0, 0, 0],
        backgroundColor: ['#059669', '#d97706', '#ea580c', '#dc2626'],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 1, ticks: { display: false }, grid: { display: false } },
        x: { grid: { display: false }, ticks: { font: { size: 10, weight: '600' }, color: '#334155' } }
      }
    }
  });
}

function actualizarGraficaEstadoConDato(estadoStr) {
  const badge = document.getElementById("badgeEstadoTexto");
  const detalle = document.getElementById("detalleEstadoUltimo");
  const est = String(estadoStr || 'NORMAL').trim().toUpperCase();

  if (badge) badge.innerText = estadoStr || 'Normal';
  if (detalle) detalle.innerText = `Último estado detectado: ${estadoStr || 'Normal'}`;

  if (!chartEstadoCol) return;

  if (est.includes("CRITIC") || est.includes("MALA") || est.includes("PELIGRO")) {
    chartEstadoCol.data.datasets[0].data = [0, 0, 0, 1];
  } else if (est.includes("REGULAR")) {
    chartEstadoCol.data.datasets[0].data = [0, 0, 1, 0];
  } else if (est.includes("MODERADA")) {
    chartEstadoCol.data.datasets[0].data = [0, 1, 0, 0];
  } else {
    chartEstadoCol.data.datasets[0].data = [1, 0, 0, 0];
  }
  chartEstadoCol.update();
}

/**
 * 4. Consulta periódica a la API del sistema
 */
async function actualizarMetricasAPI() {
  try {
    let response = await fetch(API_CALIDAD_AGUA_URL);
    if (!response.ok) {
      response = await fetch(API_FALLBACK_URL);
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const lista = Array.isArray(payload.data) ? payload.data : [];

    if (lista.length === 0) return;

    const ultimoRegistro = lista[lista.length - 1];

    if (ultimoRegistro.estado) {
      actualizarGraficaEstadoConDato(ultimoRegistro.estado);
    }

    // Autollenado de los inputs del formulario
    const inputTurb = document.getElementById("inputTurb");
    const inputTemp = document.getElementById("inputTemp");

    if (inputTurb && !inputTurb.value && ultimoRegistro.turbidez !== undefined) {
      inputTurb.value = ultimoRegistro.turbidez;
    }
    if (inputTemp && !inputTemp.value && ultimoRegistro.temperatura !== undefined) {
      inputTemp.value = ultimoRegistro.temperatura;
    }

  } catch (error) {
    console.warn("[Dashboard] Esperando sincronización de telemetría:", error.message);
  }
}

// Carga en el arranque
document.addEventListener("DOMContentLoaded", () => {
  inicializarModeloWASM();
  inicializarGraficaEstado();
  actualizarMetricasAPI();
  setInterval(actualizarMetricasAPI, 5000);
});
// ==========================================================
// MÓDULO MACHINE LEARNING (RANDOM FOREST)
// ==========================================================

// 1. Consulta la última lectura en Neon DB y la evalúa
async function analizarLecturaActualESP32() {
  try {
    const res = await fetch("/api/telemetria");
    if (!res.ok) throw new Error("No se pudo obtener la telemetría");
    const data = await res.json();

    const temp = parseFloat(data.temperatura);
    const turb = parseFloat(data.turbidez);

    // Rellenar las casillas visuales
    const inTemp = document.getElementById("input-temp-ml");
    const inTurb = document.getElementById("input-turb-ml");
    if (inTemp) inTemp.value = temp;
    if (inTurb) inTurb.value = turb;

    await enviarInferenciaML(temp, turb);
  } catch (err) {
    alert("Error al consultar telemetría: " + err.message);
  }
}

// 2. Lee los valores que se escriban en las casillas
async function ejecutarAnalisisManualML() {
  const inTemp = document.getElementById("input-temp-ml");
  const inTurb = document.getElementById("input-turb-ml");

  const temp = parseFloat(inTemp ? inTemp.value : NaN);
  const turb = parseFloat(inTurb ? inTurb.value : NaN);

  if (isNaN(temp) || isNaN(turb)) {
    alert("Por favor ingresa valores válidos de temperatura y turbidez.");
    return;
  }

  await enviarInferenciaML(temp, turb);
}

async function enviarInferenciaML(temperatura, turbidez) {
  const resultBox = document.getElementById("ml-resultado-box");
  const txtResultado = document.getElementById("ml-resultado-texto");
  const badgeConfianza = document.getElementById("ml-confianza-badge");
  const barraProgreso = document.getElementById("ml-progreso-barra");
  const detalleTecnico = document.getElementById("ml-detalle-tecnico");
  const accBadge = document.getElementById("ml-accuracy-badge");

  if (!resultBox) return;

  resultBox.style.display = "block";
  txtResultado.style.color = "#1677B8";
  txtResultado.innerText = "Analizando con Random Forest...";
  barraProgreso.style.width = "40%";
  barraProgreso.style.background = "#1677B8";

  try {
    const response = await fetch("/api/ml/predecir-potabilidad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temperatura, turbidez })
    });

    const data = await response.json();

    if (data.status === "success") {
      const esPotable = data.potable;
      const confianza = data.confianza_porcentaje;

      if (accBadge && data.accuracy_modelo) {
        accBadge.innerText = `Exactitud: ${data.accuracy_modelo}%`;
      }

      if (esPotable) {
        resultBox.style.backgroundColor = "#ECFDF5";
        resultBox.style.borderColor = "#A7F3D0";
        txtResultado.style.color = "#065F46";
        txtResultado.innerHTML = "💧 AGUA POTABLE";
        badgeConfianza.style.background = "#10B981";
        badgeConfianza.style.color = "#ffffff";
        barraProgreso.style.background = "#10B981";
      } else {
        resultBox.style.backgroundColor = "#FEF2F2";
        resultBox.style.borderColor = "#FECACA";
        txtResultado.style.color = "#991B1B";
        txtResultado.innerHTML = "⚠️ AGUA CONTAMINADA";
        badgeConfianza.style.background = "#EF4444";
        badgeConfianza.style.color = "#ffffff";
        barraProgreso.style.background = "#EF4444";
      }

      badgeConfianza.innerText = `${confianza}% certeza`;
      barraProgreso.style.width = `${confianza}%`;
      detalleTecnico.innerText = `Evaluado con Temp: ${temperatura} °C | Turbidez: ${turbidez} NTU`;
    } else {
      throw new Error(data.detail || "Error en la predicción");
    }
  } catch (error) {
    resultBox.style.backgroundColor = "#FFFBEB";
    resultBox.style.borderColor = "#FDE68A";
    txtResultado.style.color = "#92400E";
    txtResultado.innerText = "Error en evaluación";
    detalleTecnico.innerText = error.message;
  }
}

// ==========================================================
// RENDERIZADO VISUAL IDÉNTICO AL APP.PY DE KEVIN
// ==========================================================

let datosModeloH2O = null;

// Cargar métricas y configurar gráficos al iniciar
document.addEventListener("DOMContentLoaded", () => {
  cargarMetricasH2O();
});

async function cargarMetricasH2O() {
  try {
    const res = await fetch("/api/ml/metricas");
    const json = await res.json();
    if (json.status !== "success") return;

    datosModeloH2O = json.data;

    // Actualizar etiquetas estadísticas
    document.getElementById("stat-total-registros").innerHTML = `<strong>Registros procesados:</strong> ${datosModeloH2O.total_registros}`;
    document.getElementById("stat-train-size").innerHTML = `<strong>Datos entrenamiento:</strong> ${datosModeloH2O.train_size}`;
    document.getElementById("stat-test-size").innerHTML = `<strong>Datos de prueba:</strong> ${datosModeloH2O.test_size}`;

    document.getElementById("metric-accuracy-val").innerText = `${datosModeloH2O.accuracy}%`;
    document.getElementById("metric-precision-val").innerText = `${datosModeloH2O.precision}%`;
    document.getElementById("metric-recall-val").innerText = `${datosModeloH2O.recall}%`;
    document.getElementById("metric-f1-val").innerText = `${datosModeloH2O.f1}%`;

    // Renderizar Donut de Precisión
    renderDonut("donut-accuracy", datosModeloH2O.accuracy, 100, "EFECTIVIDAD (%)", "#1677B8", 1);

    // Obtener telemetría actual para los otros 2 donuts
    const resTel = await fetch("/api/telemetria");
    const tel = await resTel.json();
    const temp = parseFloat(tel.temperatura) || 24.5;
    const turb = parseFloat(tel.turbidez) || 3.0;

    renderDonut("donut-temp", temp, 100, "TEMPERATURA (°C)", "#0D9488", 1);
    renderDonut("donut-turb", turb, 10, "TURBIDEZ (NTU)", "#4776A8", 2);

    // Renderizar Heatmap de Matriz de Confusión
    renderHeatmap(datosModeloH2O.matriz_confusion.raw);

  } catch (err) {
    console.warn("No se pudieron cargar métricas de H2O:", err);
  }
}

// 1. Gráficos Donut
function renderDonut(elementId, value, maxVal, title, color, decimals) {
  const valVis = Math.max(0, Math.min(value, maxVal));
  const data = [{
    values: [valVis, Math.max(0, maxVal - valVis)],
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
    height: 190,
    paper_bgcolor: "rgba(0,0,0,0)",
    annotations: [{
      text: `<b style='font-size:24px;color:#102A43'>${value.toFixed(decimals)}</b><br><span style='font-size:9px;color:#64748B;letter-spacing:1px;font-weight:600'>${title}</span>`,
      x: 0.5, y: 0.5, showarrow: false
    }]
  };

  Plotly.newPlot(elementId, data, layout, { responsive: true, displayModeBar: false });
}

// 2. Gráfico Gauge (Velocímetro de confianza)
function renderGauge(confianza, esPotable) {
  const colorBarra = esPotable ? "#0D9488" : "#DC5252";
  const data = [{
    type: "indicator",
    mode: "gauge+number",
    value: confianza,
    number: { suffix: "%", font: { color: "#102A43", size: 30 } },
    title: { text: "Nivel de confianza del modelo", font: { color: "#64748B", size: 13 } },
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
    height: 200,
    margin: { l: 20, r: 20, t: 30, b: 10 },
    paper_bgcolor: "rgba(0,0,0,0)"
  };

  Plotly.newPlot("gauge-confianza", data, layout, { responsive: true, displayModeBar: false });
}

// 3. Matriz de Confusión (Heatmap idéntico a Seaborn)
function renderHeatmap(zValues) {
  const data = [{
    z: zValues,
    x: ["Contaminada", "Potable"],
    y: ["Contaminada", "Potable"],
    type: "heatmap",
    colorscale: [
      [0, "#EBF3FB"],
      [1, "#1677B8"]
    ],
    showscale: false
  }];

  const annotations = [];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      annotations.push({
        x: data[0].x[j],
        y: data[0].y[i],
        text: `<b>${zValues[i][j]}</b>`,
        font: { color: "#102A43", size: 18 },
        showarrow: false
      });
    }
  }

  const layout = {
    annotations: annotations,
    height: 280,
    margin: { l: 70, r: 20, t: 20, b: 40 },
    xaxis: { title: "<b>Predicción del modelo</b>" },
    yaxis: { title: "<b>Estado real</b>" },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)"
  };

  Plotly.newPlot("heatmap-confusion", data, layout, { responsive: true, displayModeBar: false });
}

// 4. Conmutador de Pestañas
function cambiarVistaH2O(vista) {
  document.getElementById("vista-h2o-resumen").style.display = vista === "resumen" ? "block" : "none";
  document.getElementById("vista-h2o-simulador").style.display = vista === "simulador" ? "block" : "none";
  document.getElementById("vista-h2o-matriz").style.display = vista === "matriz" ? "block" : "none";

  const btnRes = document.getElementById("tab-btn-resumen");
  const btnSim = document.getElementById("tab-btn-simulador");
  const btnMat = document.getElementById("tab-btn-matriz");

  [btnRes, btnSim, btnMat].forEach(b => {
    b.style.background = "#E8EEF5";
    b.style.color = "#243447";
  });

  if (vista === "resumen") {
    btnRes.style.background = "#1677B8";
    btnRes.style.color = "#fff";
  } else if (vista === "simulador") {
    btnSim.style.background = "#1677B8";
    btnSim.style.color = "#fff";
  } else {
    btnMat.style.background = "#1677B8";
    btnMat.style.color = "#fff";
  }
}

// 5. Inferencia conectada con el velocímetro
async function enviarInferenciaML(temperatura, turbidez) {
  cambiarVistaH2O("simulador");
  const alerta = document.getElementById("ml-alerta-resultado");

  try {
    const res = await fetch("/api/ml/predecir-potabilidad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temperatura, turbidez })
    });
    const json = await res.json();

    if (json.status === "success") {
      const esPotable = json.potable;
      const conf = json.confianza_porcentaje;

      renderGauge(conf, esPotable);

      alerta.style.display = "block";
      if (esPotable) {
        alerta.style.background = "#D1FAE5";
        alerta.style.color = "#065F46";
        alerta.innerHTML = "💧 AGUA POTABLE: El modelo clasifica la muestra como potable.";
      } else {
        alerta.style.background = "#FEE2E2";
        alerta.style.color = "#991B1B";
        alerta.innerHTML = "⚠️ AGUA CONTAMINADA: El modelo clasifica la muestra dentro de la categoría contaminada.";
      }
    }
  } catch (err) {
    alert("Error procesando predicción: " + err.message);
  }
}
