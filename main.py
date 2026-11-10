import asyncio
import io
import json
import os
import sys
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, UploadFile, File, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
import requests

# Asegurar que la raíz del proyecto esté en el path de Python
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Importación de la lógica de visión desde modelo/ia.py
from modelo.ia import predecir_imagen

BACKEND_WILLIAN = "https://backend-iot-vision.onrender.com"
THINGSPEAK_WRITE_KEY = "IWE7C67EMHPZFP8C"

# Control de tiempo entre peticiones a ThingSpeak (mínimo 15s)
ultimo_envio_ts = 0.0

# --------------------------------------------------------------
# Carga de modelo YOLOv8 comentada para optimizar recursos en Render
# --------------------------------------------------------------
# from ultralytics import YOLO
# MODEL_PATH = os.path.join("modelo", "best.pt")
# if not os.path.exists(MODEL_PATH):
#     MODEL_PATH = "yolov8n.pt"
#
# try:
#     yolo_model = YOLO(MODEL_PATH)
# except Exception as e:
#     yolo_model = None
#     print(f"[!] YOLOv8 no inicializado: {e}")
yolo_model = None


def sincronizar_con_thingspeak(temp: float, turb: float, estado_str: str = "Normal", volt: float = 3.2):
    """
    Reenvía los 4 campos a ThingSpeak respetando el intervalo de 15 segundos.
    Field 1: Temperatura (°C)
    Field 2: Turbidez (NTU)
    Field 3: Estado numérico (1: Normal/Óptima, 2: Moderada, 3: Regular, 4: Crítica)
    Field 4: Voltaje / Señal (V)
    """
    global ultimo_envio_ts
    ahora = time.time()
    if ahora - ultimo_envio_ts < 15.0:
        return None

    mapa_estados = {"NORMAL": 1, "BUENA": 1, "OPTIMA": 1, "MODERADA": 2, "REGULAR": 3, "CRITICA": 4, "MALA": 4}
    est_num = mapa_estados.get(str(estado_str).strip().upper(), 1)

    url = "https://api.thingspeak.com/update"
    params = {
        "api_key": THINGSPEAK_WRITE_KEY,
        "field1": round(float(temp), 2),
        "field2": round(float(turb), 2),
        "field3": est_num,
        "field4": round(float(volt), 2)
    }

    try:
        r = requests.get(url, params=params, timeout=5)
        if r.status_code == 200 and r.text.strip() != "0":
            ultimo_envio_ts = ahora
            print(f"[ThingSpeak OK] Entrada #{r.text.strip()} registrada: Temp={temp}°C, Turb={turb}NTU, Est={est_num}, Volt={volt}V")
            return r.text.strip()
    except Exception as e:
        print(f"[ThingSpeak Error]: {e}")
    return None


async def ciclo_alimentador_thingspeak():
    """Consulta la API periódicamente y reenvía lecturas a ThingSpeak."""
    while True:
        try:
            r = requests.get(f"{BACKEND_WILLIAN}/api/calidad-agua", timeout=5)
            if r.status_code == 200:
                payload = r.json()
                lista = payload.get("data", [])
                if isinstance(lista, list) and len(lista) > 0:
                    ultimo = lista[-1]
                    t = float(ultimo.get("temperatura", 24.5))
                    tb = float(ultimo.get("turbidez", 3.0))
                    est = ultimo.get("estado", "Normal")
                    v = max(0.5, round(4.5 - (tb * 0.1), 2))
                    sincronizar_con_thingspeak(t, tb, est, v)
        except Exception as e:
            # Espera silenciosa si la API remota tarda en responder
            pass
        await asyncio.sleep(16)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicia la sincronización continua en segundo plano
    tarea_background = asyncio.create_task(ciclo_alimentador_thingspeak())
    yield
    tarea_background.cancel()


app = FastAPI(title="Host Local - Monitoreo Híbrido IoT", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def index():
    if os.path.exists("static/index.html"):
        return FileResponse("static/index.html")
    return {"mensaje": "Frontend activo. Abre static/index.html"}


@app.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)


# ==============================================================
# RUTA DIRECTA PARA EL ARCHIVO WASM DE EDGE IMPULSE
# ==============================================================
@app.get("/edge-impulse-standalone.wasm")
async def servir_wasm_raiz():
    ruta_wasm = os.path.join("static", "edge-impulse-standalone.wasm")
    if os.path.exists(ruta_wasm):
        return FileResponse(ruta_wasm, media_type="application/wasm")
    return Response(status_code=404)


# ==============================================================
# ENDPOINT DE PRUEBA INMEDIATA DE THINGSPEAK
# ==============================================================
@app.get("/api/thingspeak/test")
async def test_envio_thingspeak():
    resultado = sincronizar_con_thingspeak(temp=24.8, turb=3.2, estado_str="Normal", volt=3.18)
    if resultado:
        return {"status": "success", "mensaje": f"Entrada registrada en ThingSpeak #{resultado}"}
    return {
        "status": "rate_limited_or_error",
        "mensaje": "Espera 15 segundos entre cada envío manual para cumplir con la API de ThingSpeak."
    }


# ==============================================================
# ENDPOINT DE VISIÓN KAGGLE (Inferencia convolucional directa)
# ==============================================================
@app.post("/api/vision/clasificar-muestra")
async def clasificar_muestra(file: UploadFile = File(...)):
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
        print(f"[ERROR VISIÓN]: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error en inferencia: {str(e)}")


# ==============================================================
# INFERENCIA LOCAL YOLOv8 (Fallback por si se llama este endpoint)
# ==============================================================
@app.post("/api/vision/predict")
async def local_predict_vision(file: UploadFile = File(...)):
    if yolo_model is None:
        return {
            "status": "disabled",
            "message": "Modelo YOLO inactivo en entorno ligero",
            "detecciones": []
        }
    try:
        content = await file.read()
        image = Image.open(io.BytesIO(content)).convert("RGB")
        results = yolo_model(image, conf=0.15)
        detecciones = []
        for r in results:
            for box in r.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                detecciones.append({
                    "clase": yolo_model.names[cls_id],
                    "confianza": round(conf * 100, 1),
                    "coordenadas": [int(x1), int(y1), int(x2), int(y2)]
                })
        return {"status": "success", "total_detecciones": len(detecciones), "detecciones": detecciones}
    except Exception as e:
        return {"status": "error", "message": str(e), "detecciones": []}


# ==============================================================
# PROXIES AL BACKEND (Calidad Agua / Telemetría / Teclado)
# ==============================================================
@app.get("/api/calidad-agua")
async def proxy_calidad_agua():
    try:
        r = requests.get(f"{BACKEND_WILLIAN}/api/calidad-agua", timeout=5)
        return r.json()
    except Exception as e:
        return {"temperatura": None, "turbidez": None, "estado": "ESPERANDO", "detalle": str(e)}


@app.get("/api/telemetria")
async def proxy_telemetria():
    try:
        r = requests.get(f"{BACKEND_WILLIAN}/api/telemetria", timeout=5)
        return r.json()
    except Exception as e:
        return {"temperatura": None, "turbidez": None, "estado": "ESPERANDO", "detalle": str(e)}


@app.post("/api/control/teclado")
async def proxy_teclado_matricial(payload: dict = Body(...)):
    tecla = str(payload.get("tecla", "")).strip().upper()
    try:
        r = requests.post(f"{BACKEND_WILLIAN}/api/control/teclado", json={"tecla": tecla}, timeout=5)
        return {
            "status": "success",
            "tecla_recibida": tecla,
            "backend_response": r.json() if r.status_code == 200 else r.text
        }
    except Exception as e:
        return {
            "status": "simulado_local",
            "tecla_recibida": tecla,
            "mensaje": f"Opción {tecla} procesada localmente"
        }


@app.get("/api/incidentes")
async def proxy_incidentes():
    try:
        r = requests.get(f"{BACKEND_WILLIAN}/api/incidentes", timeout=5)
        return r.json()
    except Exception:
        return []


# ==============================================================
# EJECUCIÓN PRINCIPAL
# ==============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
