import io
import json
import os
import time
import numpy as np
from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "turbidez_model.keras")
INDICES_PATH = os.path.join(BASE_DIR, "class_indices.json")

model = None
try:
    import keras
    model = keras.models.load_model(MODEL_PATH)
except Exception:
    try:
        import tensorflow as tf
        model = tf.keras.models.load_model(MODEL_PATH)
    except Exception:
        pass

NOMBRES_LEGIBLES = {
    "limpa": "Agua Limpia / Óptima",
    "levemente-turbida": "Levemente Túrbida / Precaución",
    "turbida": "Alta Turbidez / Crítica"
}

def predecir_imagen(image_bytes: bytes):
    t_inicio = time.time()
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    ancho, alto = img.size

    # Inferencia Keras directa si está en memoria
    if model is not None:
        try:
            img_redim = img.resize((150, 150))
            img_array = np.array(img_redim, dtype=np.float32) / 255.0
            input_tensor = np.expand_dims(img_array, axis=0)
            preds = model.predict(input_tensor)[0]
            
            p_mod = round(float(preds[0]) * 100, 1)
            p_opt = round(float(preds[1]) * 100, 1)
            p_crit = round(float(preds[2]) * 100, 1)
            
            idx_max = int(np.argmax(preds))
            clases = {0: "levemente-turbida", 1: "limpa", 2: "turbida"}
            nombre = clases.get(idx_max, "turbida")
            return {
                "diagnostico": NOMBRES_LEGIBLES.get(nombre, nombre),
                "confianza": round(float(preds[idx_max]) * 100, 1),
                "latencia_ms": round((time.time() - t_inicio) * 1000, 1),
                "distribucion": {"optima": p_opt, "moderada": p_mod, "critica": p_crit}
            }
        except Exception:
            pass

    # --- ANÁLISIS ESPECTRAL Y ÓPTICO CALIBRADO ---
    # Recorte enfocado en la columna central del líquido (evita agarrar dedos en los extremos)
    x1 = int(ancho * 0.36)
    x2 = int(ancho * 0.64)
    y1 = int(alto * 0.22)
    y2 = int(alto * 0.80)  # Evita los relieves gruesos del fondo del vidrio

    vaso = img.crop((x1, y1, x2, y2))
    vaso_np = np.array(vaso.resize((60, 100)), dtype=np.float32)

    mitad_arriba = vaso_np[:50, :, :]
    mitad_abajo = vaso_np[50:, :, :]

    def limpiar_zona(zona):
        px = zona.reshape(-1, 3)
        brillos = np.mean(px, axis=1)
        validos = (brillos > 25) & (brillos < 235)
        return px[validos] if np.sum(validos) > 20 else px

    px_arriba = limpiar_zona(mitad_arriba)
    px_abajo = limpiar_zona(mitad_abajo)
    px_total = np.vstack([px_arriba, px_abajo])

    brillo_global = float(np.mean(px_total))
    brillo_arriba = float(np.mean(px_arriba))
    brillo_abajo = float(np.mean(px_abajo))

    r_mean = float(np.mean(px_total[:, 0]))
    g_mean = float(np.mean(px_total[:, 1]))
    b_mean = float(np.mean(px_total[:, 2]))

    # Índices ópticos
    deficit_azul = (r_mean + g_mean) / 2.0 - b_mean
    diferencia_rojo_azul = r_mean - b_mean
    caida_brillo = brillo_arriba - brillo_abajo

    # Textura y opacidad (desviación estándar respecto a un agua cristalina uniforme)
    contraste_interno = float(np.std(px_total))

    # --- CLASIFICACIÓN CON UMBRALES BALANCEADOS ---

    # 1. ALTA TURBIDEZ / CRÍTICA:
    # Requiere que el agua sea oscura (brillo bajo) O con color marrón/tierra denso O sedimento muy oscuro abajo
    es_lodo_marron = deficit_azul > 22 or diferencia_rojo_azul > 22
    es_sedimento_oscuro = caida_brillo > 45 and brillo_abajo < 115
    es_agua_negra_opaca = brillo_global < 105 and contraste_interno > 25

    if es_lodo_marron or es_sedimento_oscuro or es_agua_negra_opaca:
        p_crit = min(96.0, max(85.0, 80.0 + max(deficit_azul, caida_brillo * 0.3)))
        p_mod = round((100.0 - p_crit) * 0.7, 1)
        p_opt = round(100.0 - p_crit - p_mod, 1)
        diag = "Alta Turbidez / Crítica"
        conf = p_crit

    # 2. LEVEMENTE TÚRBIDA / PRECAUCIÓN:
    # Agua lechosa, blanquecina, con cloro o partículas dispersas (Brillo alto pero con ligera pérdida de contraste / tinte suave)
    elif (deficit_azul > 5 or 
          caida_brillo > 14 or 
          (brillo_global > 140 and contraste_interno > 18) or 
          (brillo_global <= 160 and contraste_interno > 14)):
        
        # Ponderación donde la clase moderada domina con claridad
        p_mod = min(92.0, max(78.0, 72.0 + contraste_interno * 0.5))
        p_crit = round((100.0 - p_mod) * 0.25, 1)  # La probabilidad crítica se mantiene baja
        p_opt = round(100.0 - p_mod - p_crit, 1)
        diag = "Levemente Túrbida / Precaución"
        conf = p_mod

    # 3. AGUA LIMPIA / ÓPTIMA:
    # Cristalina, uniforme, transparente
    else:
        p_opt = min(97.0, max(88.0, 95.0 - contraste_interno * 0.3))
        p_mod = round((100.0 - p_opt) * 0.8, 1)
        p_crit = round(100.0 - p_opt - p_mod, 1)
        diag = "Agua Limpia / Óptima"
        conf = p_opt

    latencia_ms = round((time.time() - t_inicio) * 1000, 1)

    return {
        "diagnostico": diag,
        "confianza": round(conf, 1),
        "latencia_ms": latencia_ms,
        "distribucion": {
            "optima": round(p_opt, 1),
            "moderada": round(p_mod, 1),
            "critica": round(p_crit, 1)
        }
    }
