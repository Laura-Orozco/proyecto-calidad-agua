import os
import time
from typing import Optional, List, Dict, Any
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from modelo.ia import predecir_imagen

app = FastAPI(
    title="API Central IoT & Visión AI - Calidad del Agua",
    description="Sistema de Adquisición de Datos IoT (ESP32, Neon DB, ThingSpeak) y Diagnóstico de Visión Computacional",
    version="2.0.0"
)

# Soporte CORS para consumo local y desde la web
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Conexión centralizada a Neon PostgreSQL
DATABASE_URL = os.getenv("DATABASE_URL")

def get_db_connection():
    if not DATABASE_URL:
        raise HTTPException(
            status_code=500,
            detail="La variable de entorno DATABASE_URL no está configurada en el servidor."
        )
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

# --- MODELOS PYDANTIC ---

class Esp32Datos(BaseModel):
    device_id: Optional[str] = "calidad_agua"
    temperatura: float
    turbidez: float
    estado: Optional[str] = "Normal"

class FrecuenciaConfig(BaseModel):
    frecuencia_segundos: int

class TeclaControl(BaseModel):
    tecla: str

class LLMConsulta(BaseModel):
    mensaje: str

# Variable global para control de tasa de muestreo
frecuencia_muestreo = 15

# --- ENDPOINTS IOT Y TELEMETRÍA (NEON DB & THINGSPEAK) ---

@app.get("/api/telemetria", summary="Obtener Última Telemetría")
def obtener_ultima_telemetria():
    """Consulta el registro más reciente de los sensores en Neon DB."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM lecturas_calidad_agua ORDER BY id DESC LIMIT 1;")
        fila = cur.fetchone()
        cur.close()
        conn.close()

        if not fila:
            return {
                "id": 0,
                "device_id": "calidad_agua",
                "temperatura": 24.5,
                "turbidez": 3.0,
                "estado": "Normal",
                "fecha": None
            }
        return fila
    except Exception as e:
        return {
            "error": str(e),
            "device_id": "calidad_agua",
            "temperatura": 24.5,
            "turbidez": 3.0,
            "estado": "Normal"
        }

@app.get("/api/calidad-agua", summary="Obtener Calidad Agua")
def obtener_calidad_agua(limit: int = 50):
    """Consulta el histórico de mediciones almacenadas."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM lecturas_calidad_agua ORDER BY id DESC LIMIT %s;", (limit,))
        filas = cur.fetchall()
        cur.close()
        conn.close()
        return filas
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error consultando historial: {str(e)}")

@app.post("/api/esp32/enviar-datos", summary="Recibir Datos Esp32")
def recibir_datos_esp32(datos: Esp32Datos):
    """
    Endpoint receptor del microcontrolador ESP32.
    Inserta la lectura asegurando device_id ('calidad_agua' por defecto) y marca de tiempo NOW().
    """
    try:
        # Si Kevin no envía el identificador o llega en blanco, forzar 'calidad_agua'
        dispositivo_nombre = datos.device_id.strip() if datos.device_id and datos.device_id.strip() else "calidad_agua"

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO lecturas_calidad_agua (device_id, temperatura, turbidez, estado, fecha)
            VALUES (%s, %s, %s, %s, NOW())
            RETURNING id, fecha;
            """,
            (dispositivo_nombre, datos.temperatura, datos.turbidez, datos.estado)
        )
        resultado = cur.fetchone()
        nuevo_id = resultado["id"]
        fecha_registro = resultado["fecha"]
        conn.commit()
        cur.close()
        conn.close()

        return {
            "status": "success",
            "mensaje": "Lectura registrada con éxito",
            "id": nuevo_id,
            "device_id": dispositivo_nombre,
            "fecha": fecha_registro
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error guardando lectura ESP32: {str(e)}")

@app.get("/api/incidentes", summary="Obtener Incidentes")
def obtener_incidentes(limit: int = 20):
    """Consulta incidentes o anomalías registradas."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM incidentes ORDER BY id DESC LIMIT %s;", (limit,))
        filas = cur.fetchall()
        cur.close()
        conn.close()
        return filas
    except Exception:
        return []

@app.get("/api/control/frecuencia", summary="Obtener Frecuencia")
def obtener_frecuencia():
    """Consulta la frecuencia de muestreo configurada para el hardware."""
    global frecuencia_muestreo
    return {"frecuencia_segundos": frecuencia_muestreo}

@app.post("/api/control/frecuencia", summary="Configurar Frecuencia")
def configurar_frecuencia(config: FrecuenciaConfig):
    """Actualiza la cadencia de envío de datos del ESP32."""
    global frecuencia_muestreo
    frecuencia_muestreo = max(1, config.frecuencia_segundos)
    return {"status": "success", "frecuencia_actualizada": frecuencia_muestreo}

@app.post("/api/control/teclado", summary="Procesar Tecla Esp32")
def procesar_tecla_esp32(payload: TeclaControl):
    """Recibe eventos físicos o pulsaciones desde el ESP32."""
    tecla = payload.tecla.strip().upper()
    return {"status": "success", "tecla_recibida": tecla}

@app.post("/api/llm/consultar", summary="Consultar Llm")
def consultar_llm(consulta: LLMConsulta):
    """Asistente de respuestas contextuales de calidad hídrica."""
    msg = consulta.mensaje.lower()
    if "turbidez" in msg or "turbia" in msg:
        respuesta = "La turbidez evalúa la presencia de partículas en suspensión en la columna de agua. Niveles sobre 5 NTU requieren retención y purga para uso seguro."
    elif "temperatura" in msg:
        respuesta = "La temperatura modula la tasa metabólica del efluente y la capacidad de disolución de gases como el oxígeno."
    else:
        respuesta = "Sistema centralizado de telemetría IoT y diagnóstico por visión artificial operativo."

    return {"status": "success", "respuesta": respuesta}

# --- ENDPOINT DE VISIÓN COMPUTACIONAL E IA ---

@app.post("/api/vision/clasificar-muestra", summary="Clasificar Fotograma con Pipeline CNN / XAI")
async def clasificar_muestra(file: UploadFile = File(...)):
    """Inferencia de turbidez sobre muestra visual capturada por cámara o cargada como imagen."""
    try:
        contenido = await file.read()
        res = predecir_imagen(contenido)
        return {
            "status": "success",
            "diagnostico": res["diagnostico"],
            "confianza": f"{res['confianza']}%",
            "latencia_ms": res["latencia_ms"],
            "distribucion": res["distribucion"],
            "modelo_fuente": "Edge Colorimetry & CNN Pipeline"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en inferencia visual: {str(e)}")

# --- ARCHIVOS ESTÁTICOS / FRONTEND ---

if os.path.exists("static"):
    app.mount("/", StaticFiles(directory="static", html=True), name="static")
