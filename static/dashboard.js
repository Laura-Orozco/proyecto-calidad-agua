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

