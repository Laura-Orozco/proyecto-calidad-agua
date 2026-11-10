// Descarga de reportes automáticos en PDF desde el backend en Render
const BACKEND_PDF_URL = "https://backend-iot-vision.onrender.com/api/reporte-pdf";

async function descargarReportePDF() {
  const btn = document.getElementById("btnExportarPDF");
  const textoOriginal = btn.innerHTML;
  btn.innerHTML = "⏳ Generando PDF...";
  btn.style.pointerEvents = "none";

  try {
    const response = await fetch(BACKEND_PDF_URL, {
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(`Error en el servidor: ${response.status}`);
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `reporte_calidad_agua_${Date.now()}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  } catch (err) {
    alert("Error al descargar el PDF de Render: " + err.message);
    console.error("[PDF] Error exportando reporte:", err);
  } finally {
    btn.innerHTML = textoOriginal;
    btn.style.pointerEvents = "auto";
  }
}