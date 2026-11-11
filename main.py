import os
import time
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from modelo.ia import predecir_imagen

app = FastAPI(
    title="API Central IoT & Visión AI - Calidad del Agua",
    description="Sistema de Adquisición de Datos IoT (ESP32, Neon DB, ThingSpeak) y Diagnóstico de Visión Computacional",
    version="2.0.0"
)

# Configuración de CORS para permitir peticiones desde cualquier origen o frontend local
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Conexión a la base de datos Neon PostgreSQL
DATABASE_URL = os.getenv("DATABASE_URL")

def get_db_connection():
    if not DATABASE_URL:
        raise HTTPException(
            status_code=500,
            detail="La variable de entorno DATABASE_URL no está configurada en el servidor."
        )
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

# --- MODELOS DE ENTRADA (PYDANTIC) ---

class Esp32Datos(BaseModel):
    temperatura: float
    turbidez: float
    estado: Optional[str] = "Normal"

class FrecuenciaConfig(BaseModel):
    frecuencia_segundos: int

class TeclaControl(BaseModel):
    tecla: str

class LLMConsulta(BaseModel):
    mensaje: str

# Variables de estado en memoria para control de hardware
frecuencia_muestreo = 15

# --- ENDPOINTS IOT Y TELEMETRÍA (NEON DB & THINGSPEAK) ---

@app.get("/api/telemetria", summary="Obtener Última Telemetría")
def obtener_ultima_telemetria():
    """Consulta la última lectura registrada de temperatura, turbidez y estado en Neon DB."""
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
                "temperatura": 24.5,
                "turbidez": 3.0,
                "estado": "Normal",
                "fecha": None
            }
        return fila
    except Exception as e:
        return {
            "error": str(e),
            "temperatura": 24.5,
            "turbidez": 3.0,
            "estado": "Normal"
        }

@app.get("/api/calidad-agua", summary="Obtener Calidad Agua")
def obtener_calidad_agua(limit: int = 50):
    """Retorna el histórico de lecturas fisicoquímicas almacenadas."""
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
    """Endpoint receptor del microcontrolador ESP32 para guardar mediciones en Neon DB."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO lecturas_calidad_agua (temperatura, turbidez, estado)
            VALUES (%s, %s, %s) RETURNING id;
            """,
            (datos.temperatura, datos.turbidez, datos.estado)
        )
        nuevo_id = cur.fetchone()["id"]
        conn.commit()
        cur.close()
        conn.close()
        return {"status": "success", "mensaje": "Lectura almacenada", "id": nuevo_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error guardando lectura ESP32: {str(e)}")

@app.get("/api/incidentes", summary="Obtener Incidentes")
def obtener_incidentes(limit: int = 20):
    """Consulta alertas o eventos críticos registrados."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM incidentes ORDER BY id DESC LIMIT %s;", (limit,))
        filas = cur.fetchall()
        cur.close()
        conn.close()
        return filas
    except Exception:
        # Fallback si la tabla aún no existe o no tiene registros
        return []

@app.get("/api/control/frecuencia", summary="Obtener Frecuencia")
def obtener_frecuencia():
    """Consulta la frecuencia en segundos con la que el ESP32 debe muestrear."""
    global frecuencia_muestreo
    return {"frecuencia_segundos": frecuencia_muestreo}

@app.post("/api/control/frecuencia", summary="Configurar Frecuencia")
def configurar_frecuencia(config: FrecuenciaConfig):
    """Actualiza la tasa de refresco o frecuencia del bucle IoT."""
    global frecuencia_muestreo
    frecuencia_muestreo = max(1, config.frecuencia_segundos)
    return {"status": "success", "frecuencia_actualizada": frecuencia_muestreo}

@app.post("/api/control/teclado", summary="Procesar Tecla Esp32")
def procesar_tecla_esp32(payload: TeclaControl):
    """Recibe pulsaciones de teclado o comandos de hardware desde el ESP32."""
    tecla = payload.tecla.strip().upper()
    return {"status": "success", "tecla_recibida": tecla}

@app.post("/api/llm/consultar", summary="Consultar Llm")
def consultar_llm(consulta: LLMConsulta):
    """Endpoint puente para responder consultas de normativa o diagnóstico."""
    msg = consulta.mensaje.lower()
    if "turbidez" in msg or "turbia" in msg:
        respuesta = "La turbidez representa la opacidad del agua ocasionada por partículas en suspensión. Valores por encima de 5 NTU superan la norma para consumo humano directo."
    elif "temperatura" in msg:
        respuesta = "La temperatura influye directamente en la solubilidad del oxígeno disuelto y la conductividad eléctrica del agua."
    else:
        respuesta = "El sistema de monitoreo IoT y visión artificial evalúa en tiempo real las variables ópticas y fisicoquímicas del efluente."

    return {"status": "success", "respuesta": respuesta}

# --- ENDPOINT DE VISIÓN COMPUTACIONAL E IA ---

@app.post("/api/vision/clasificar-muestra", summary="Clasificar Fotograma con Pipeline CNN / XAI")
async def clasificar_muestra(file: UploadFile = File(...)):
    """Recibe una captura (Webcam, DroidCam o archivo) y devuelve diagnóstico, latencia y distribución Softmax."""
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
