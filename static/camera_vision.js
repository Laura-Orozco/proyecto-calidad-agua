/**
 * camera_vision.js
 * Módulo de captura visual y consumo del endpoint de inferencia de visión (Keras CNN).
 */

// Endpoint relativo apuntando directamente a FastAPI local
const VISION_API_URL = "/api/vision/clasificar-muestra";

let videoStreamInstance = null;

/**
 * Inicia o detiene la transmisión de video (webcam o DroidCam).
 */
async function toggleCamara() {
  const video = document.getElementById("videoCam");
  const canvas = document.getElementById("canvasVision");
  const btnToggle = document.getElementById("btnToggleCam");
  const btnCapturar = document.getElementById("btnCapturar");
  const badge = document.getElementById("camStatusBadge");

  if (!videoStreamInstance) {
    try {
      videoStreamInstance = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } }
      });
      if (video) {
        video.srcObject = videoStreamInstance;
        video.style.display = "block";
      }
      if (canvas) canvas.style.display = "none";
      if (btnToggle) btnToggle.innerText = "Detener Cámara";
      if (btnCapturar) btnCapturar.style.display = "inline-flex";
      if (badge) {
        badge.innerText = "Cámara transmitiendo";
        badge.style.backgroundColor = "#ecfdf5";
        badge.style.color = "#059669";
      }
    } catch (err) {
      console.error("[Cámara] Error al solicitar acceso:", err);
      alert("No se pudo acceder al dispositivo de captura o DroidCam.");
    }
  } else {
    // Detener pistas de video
    videoStreamInstance.getTracks().forEach(track => track.stop());
    videoStreamInstance = null;
    if (video) video.style.display = "none";
    if (canvas) canvas.style.display = "block";
    if (btnToggle) btnToggle.innerText = "Iniciar Transmisión DroidCam";
    if (btnCapturar) btnCapturar.style.display = "none";
    if (badge) {
      badge.innerText = "Cámara en espera";
      badge.style.backgroundColor = "#eff6ff";
      badge.style.color = "#2563eb";
    }
  }
}

/**
 * Captura un fotograma del video, lo dibuja en el canvas y lo envía a clasificar.
 */
function capturarFotograma() {
  const video = document.getElementById("videoCam");
  const canvas = document.getElementById("canvasVision");
  if (!video || !canvas) return;

  const ctx = canvas.getContext("2d");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Cerrar transmisión en vivo para congelar la imagen de prueba
  toggleCamara();

  // Convertir canvas a Blob JPEG y despachar al backend
  canvas.toBlob(blob => {
    if (blob) {
      enviarImagenABackend(blob);
    }
  }, "image/jpeg", 0.95);
}

/**
 * Procesa un archivo de imagen seleccionado manualmente desde el explorador.
 */
function procesarArchivoLocal(event) {
  const file = event.target.files[0];
  if (!file) return;

  const canvas = document.getElementById("canvasVision");
  const video = document.getElementById("videoCam");
  if (video) video.style.display = "none";
  if (canvas) canvas.style.display = "block";

  const ctx = canvas.getContext("2d");
  const img = new Image();

  img.onload = function () {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    enviarImagenABackend(file);
  };

  img.src = URL.createObjectURL(file);
}

/**
 * Envía el archivo o Blob vía POST a FastAPI y renderiza la etiqueta y confianza.
 */
async function enviarImagenABackend(blobOArchivo) {
  const statusMsg = document.getElementById("statusMessage");
  const chips = document.getElementById("vrChipsContainer");
  const badge = document.getElementById("vrTotalBadge");

  if (statusMsg) statusMsg.innerText = "Procesando muestra con el modelo de visión...";

  const formData = new FormData();
  formData.append("file", blobOArchivo, "muestra.jpg");

  try {
    const res = await fetch(VISION_API_URL, {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error ${res.status}: ${errText}`);
    }

    const data = await res.json();

    const diagnostico = data.diagnostico || "Sin diagnóstico";
    const confianza = data.confianza || "0%";

    if (statusMsg) statusMsg.innerText = `Diagnóstico: ${diagnostico}`;
    if (badge) badge.innerText = `Confianza: ${confianza}`;

    if (chips) {
      let estiloColor = "#10b981"; // Verde: Agua limpia
      const diagLower = diagnostico.toLowerCase();

      if (diagLower.includes("leve") || diagLower.includes("precaución") || diagLower.includes("moderada")) {
        estiloColor = "#f59e0b"; // Ámbar: Levemente túrbida
      } else if (diagLower.includes("turbi") || diagLower.includes("crítica") || diagLower.includes("alga")) {
        estiloColor = "#ef4444"; // Rojo: Alta turbidez
      }

      chips.innerHTML = `
        <div class="vr-chip">
          <span style="font-weight: 600; color: #1e293b;">${diagnostico}</span>
          <span style="background-color: ${estiloColor}; color: #ffffff; border-radius: 12px; padding: 2px 8px; font-size: 0.76rem; font-weight: 700;">
            ${confianza}
          </span>
        </div>
      `;
    }
  } catch (err) {
    console.error("[Visión] Fallo en la petición de inferencia:", err);
    if (statusMsg) statusMsg.innerText = `Fallo al procesar: ${err.message || "Error en red o API"}`;
  }
}

/**
 * Restablece el visor gráfico y el contenedor de resultados.
 */
function limpiarVisor() {
  const canvas = document.getElementById("canvasVision");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  const statusMsg = document.getElementById("statusMessage");
  const chips = document.getElementById("vrChipsContainer");
  const badge = document.getElementById("vrTotalBadge");

  if (statusMsg) statusMsg.innerText = "Esperando muestra...";
  if (badge) badge.innerText = "Efectividad > 85%";
  if (chips) chips.innerHTML = '<span class="vr-placeholder">No se han analizado fotogramas aún.</span>';
}