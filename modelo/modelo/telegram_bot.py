import os
import json
import urllib.request
from modelo.ml_potabilidad import predecir_potabilidad

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

def enviar_mensaje_telegram(texto: str, chat_id: str = None):
    token = os.getenv("TELEGRAM_BOT_TOKEN", TELEGRAM_BOT_TOKEN)
    destino = chat_id or os.getenv("TELEGRAM_CHAT_ID", TELEGRAM_CHAT_ID)
    if not token or not destino:
        print("[Telegram Warning] Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({
        "chat_id": destino,
        "text": texto,
        "parse_mode": "Markdown"
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"[Telegram Error]: {e}")
        return False

def notificar_alerta_critica(temperatura: float, turbidez: float, estado: str, identificador: str = "calidad_agua"):
    if "critica" not in estado.lower() and "crítica" not in estado.lower():
        return False

    pred = predecir_potabilidad(temperatura, turbidez)
    mensaje = (
        "🚨 *ALERTA CRÍTICA DE CALIDAD DEL AGUA*\n\n"
        f"📍 *Nodo:* `{identificador}`\n"
        f"🌡️ *Temperatura:* `{temperatura:.1f} °C`\n"
        f"💧 *Turbidez:* `{turbidez:.2f} NTU`\n"
        f"⚠️ *Estado IoT:* *{estado}*\n"
        f"🤖 *Diagnóstico IA:* {pred['diagnostico']} ({pred['confianza_porcentaje']}% confianza)\n\n"
        "_Se recomienda inspección inmediata del efluente o activación de purga._"
    )
    return enviar_mensaje_telegram(mensaje)

def procesar_consulta_usuario(texto_usuario: str, get_db_connection) -> str:
    msg = texto_usuario.strip().lower()

    if msg in ["/start", "/ayuda", "hola", "menu", "menú"]:
        return (
            "👋 *Asistente IoT de Calidad del Agua*\n\n"
            "Puedes preguntarme o usar estos comandos:\n"
            "• `/estado` — Última lectura de temperatura, turbidez y estado\n"
            "• `/potabilidad` — Evaluación con el modelo Random Forest\n"
            "• `/historial` — Últimos 5 registros guardados en Neon DB\n"
            "• También puedes preguntar en lenguaje natural: _\"¿cómo está el agua?\"_, _\"¿es potable?\"_ o _\"¿cuál es la turbidez?\"_"
        )

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        if "/historial" in msg or "historial" in msg or "ultimos" in msg or "últimos" in msg:
            cur.execute(
                "SELECT temperatura, turbidez, estado, timestamp "
                "FROM calidad_agua ORDER BY id DESC LIMIT 5;"
            )
            filas = cur.fetchall()
            cur.close()
            conn.close()

            if not filas:
                return "📭 Aún no hay registros guardados en la base de datos."

            lineas = ["📊 *Últimas 5 lecturas en Neon DB:*\n"]
            for f in filas:
                hora = str(f["timestamp"])[:16] if f["timestamp"] else "--"
                lineas.append(f"• `{hora}` | {f['temperatura']}°C | {f['turbidez']} NTU | *{f['estado']}*")
            return "\n".join(lineas)

        cur.execute(
            "SELECT temperatura, turbidez, estado, timestamp "
            "FROM calidad_agua ORDER BY id DESC LIMIT 1;"
        )
        ultima = cur.fetchone()
        cur.close()
        conn.close()

        if not ultima:
            return "📭 No encontré lecturas recientes del ESP32 en Neon DB."

        temp = float(ultima["temperatura"])
        turb = float(ultima["turbidez"])
        estado = ultima["estado"]
        pred = predecir_potabilidad(temp, turb)

        if "temperatura" in msg or "calor" in msg or "grados" in msg:
            return f"🌡️ La temperatura actual del agua es *{temp:.1f} °C* (Estado: *{estado}*)."

        if "turbidez" in msg or "turbia" in msg or "ntu" in msg:
            return f"💧 El nivel actual de turbidez es *{turb:.2f} NTU* (Estado: *{estado}*)."

        if "potable" in msg or "tomar" in msg or "consumo" in msg or "/potabilidad" in msg:
            icono = "✅" if pred["potable"] else "⛔"
            return (
                f"{icono} *Evaluación de Potabilidad (Random Forest):*\n"
                f"• *Resultado:* {pred['diagnostico']}\n"
                f"• *Confianza:* {pred['confianza_porcentaje']}%\n"
                f"• *Lectura base:* {temp:.1f} °C y {turb:.2f} NTU"
            )

        return (
            "📡 *Reporte Actual de la Estación:*\n\n"
            f"🌡️ *Temperatura:* `{temp:.1f} °C`\n"
            f"💧 *Turbidez:* `{turb:.2f} NTU`\n"
            f"📌 *Estado:* *{estado}*\n"
            f"🤖 *IA Potabilidad:* {pred['diagnostico']} ({pred['confianza_porcentaje']}%)"
        )

    except Exception as e:
        return f"⚠️ Error consultando los sensores: `{str(e)}`"
