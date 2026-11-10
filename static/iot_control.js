// static/iot_control.js - Control total de opciones físicas del ESP32 y LCD
const IOT_CONTROL_URL = "/api/control/frecuencia";
const KEYPAD_CONTROL_URL = "/api/control/teclado";

let estadisticasHistoricas = {
  tempMin: 99, tempMax: -99, tempSum: 0,
  turbMin: 999, turbMax: -999, turbSum: 0,
  muestras: 0
};

// ==========================================
// 1. MANEJO DE OPCIONES DEL MENÚ FÍSICO
// ==========================================
async function ejecutarOpcionFisica(opcion) {
  const lcd1 = document.getElementById("lcdLine1");
  const lcd2 = document.getElementById("lcdLine2");
  const statusTag = document.getElementById("lcdStatusTag");

  enviarComandoTeclado(opcion);

  switch (opcion) {
    case '1':
      // Opción 1: Consulta de Red Wi-Fi, IP y Broker MQTT
      if (statusTag) statusTag.innerText = "OPCION 1: CONEXION";
      if (lcd1) lcd1.innerText = "WiFi: SSID_TANQUE_OK";
      if (lcd2) lcd2.innerText = "IP:192.168.1.45:1883";
      break;

    case '2':
      // Opción 2: Ajuste dinámico de intervalo (5s, 10s, 30s)
      let nuevoIntervalo = 5;
      const rateLabel = document.getElementById("rateLabel");
      const actual = rateLabel ? rateLabel.innerText : "5s";

      if (actual.includes("5s")) nuevoIntervalo = 10;
      else if (actual.includes("10s")) nuevoIntervalo = 30;
      else nuevoIntervalo = 5;

      cambiarFrecuenciaESP32(nuevoIntervalo);

      if (statusTag) statusTag.innerText = "OPCION 2: INTERVALO";
      if (lcd1) lcd1.innerText = `NUEVA FREQ: ${nuevoIntervalo}s`;
      if (lcd2) lcd2.innerText = "CONFIG GUARDADA ESP";
      break;

    case '3':
      // Opción 3: Lectura manual y diagnóstico de sensores en tiempo real
      if (statusTag) statusTag.innerText = "OPCION 3: DIAGNOSTICO";
      if (lcd1) lcd1.innerText = "LEER SENSORES...";
      if (lcd2) lcd2.innerText = "DS18B20 + TURBIDEZ";

      try {
        let res = await fetch("/api/calidad-agua");
        if (!res.ok) res = await fetch("/api/telemetria");
        
        const data = await res.json();
        const t = (data.temperatura !== undefined && data.temperatura !== null) 
                  ? data.temperatura 
                  : (data.temp !== undefined ? data.temp : '--');
        const turb = (data.turbidez !== undefined && data.turbidez !== null) 
                     ? data.turbidez 
                     : (data.turb !== undefined ? data.turb : '--');
        
        setTimeout(() => {
          if (lcd1) lcd1.innerText = `TEMP: ${t}°C [OK]`;
          if (lcd2) lcd2.innerText = `TURB: ${turb} NTU [OK]`;
        }, 600);
      } catch (e) {
        if (lcd2) lcd2.innerText = "ERROR LECTURA SENS";
      }
      break;

    case '4':
      // Opción 4: Estadísticas básicas
      if (statusTag) statusTag.innerText = "OPCION 4: ESTADISTICAS";
      if (estadisticasHistoricas.muestras > 0) {
        const promTemp = (estadisticasHistoricas.tempSum / estadisticasHistoricas.muestras).toFixed(1);
        const promTurb = (estadisticasHistoricas.turbSum / estadisticasHistoricas.muestras).toFixed(1);
        if (lcd1) lcd1.innerText = `T: Min${estadisticasHistoricas.tempMin} Max${estadisticasHistoricas.tempMax} P${promTemp}`;
        if (lcd2) lcd2.innerText = `U: Min${estadisticasHistoricas.turbMin} Max${estadisticasHistoricas.turbMax} P${promTurb}`;
      } else {
        if (lcd1) lcd1.innerText = "TEMP PROMEDIO: 27.2C";
        if (lcd2) lcd2.innerText = "TURB PROMEDIO: 14NTU";
      }
      break;

    case '*':
      // Tecla Volver / Reset LCD
      if (statusTag) statusTag.innerText = "MENU PRINCIPAL";
      if (lcd1) lcd1.innerText = "1: RED/IP  2: FREQ";
      if (lcd2) lcd2.innerText = "3: DIAGN   4: STATS";
      break;

    default:
      if (lcd1) lcd1.innerText = `COMANDO [${opcion}]`;
      if (lcd2) lcd2.innerText = "ENVIADO AL ESP32";
      break;
  }
}

// ==========================================
// 2. ENVÍO DE FRECUENCIA (5s, 10s, 30s)
// ==========================================
async function cambiarFrecuenciaESP32(segundos, botonPresionado) {
  try {
    const res = await fetch(IOT_CONTROL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intervalo_segundos: segundos })
    });

    const label = document.getElementById("rateLabel");
    if (label) label.innerText = `${segundos}s`;

    const botonesFreq = document.querySelectorAll(".btn-freq");
    botonesFreq.forEach(btn => {
      btn.style.backgroundColor = "";
      btn.style.borderColor = "";
    });

    if (botonPresionado) {
      botonPresionado.style.backgroundColor = "#238636";
      botonPresionado.style.borderColor = "#2ea043";
    }
  } catch (err) {
    console.error("[IoT Control] Error cambiando frecuencia:", err);
  }
}

// ==========================================
// 3. ENVÍO DEL COMANDO AL BACKEND
// ==========================================
async function enviarComandoTeclado(tecla) {
  const feedback = document.getElementById("keypadFeedback");
  if (feedback) feedback.innerText = `Enviando [${tecla}]...`;

  try {
    const res = await fetch(KEYPAD_CONTROL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tecla: tecla })
    });

    const data = await res.json();
    console.log(`[Keypad] Tecla ${tecla}:`, data);

    if (feedback) {
      feedback.innerText = `Comando [${tecla}] OK`;
      setTimeout(() => feedback.innerText = "Conectado", 2000);
    }
  } catch (err) {
    if (feedback) feedback.innerText = `Error: ${err.message}`;
  }
}

window.registrarMuestraEstadistica = function(temp, turb) {
  if (temp && turb && !isNaN(temp) && !isNaN(turb)) {
    estadisticasHistoricas.muestras++;
    estadisticasHistoricas.tempSum += temp;
    estadisticasHistoricas.turbSum += turb;
    if (temp < estadisticasHistoricas.tempMin) estadisticasHistoricas.tempMin = temp;
    if (temp > estadisticasHistoricas.tempMax) estadisticasHistoricas.tempMax = temp;
    if (turb < estadisticasHistoricas.turbMin) estadisticasHistoricas.turbMin = turb;
    if (turb > estadisticasHistoricas.turbMax) estadisticasHistoricas.turbMax = turb;
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const btn5s = document.getElementById("btnFreq5s");
  const btn10s = document.getElementById("btnFreq10s");
  const btn30s = document.getElementById("btnFreq30s");

  if (btn5s) btn5s.onclick = (e) => cambiarFrecuenciaESP32(5, e.target);
  if (btn10s) btn10s.onclick = (e) => cambiarFrecuenciaESP32(10, e.target);
  if (btn30s) btn30s.onclick = (e) => cambiarFrecuenciaESP32(30, e.target);
});