import os
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, precision_score, recall_score, f1_score

_modelo = None
_metricas = {}

def _resolver_ruta_csv(csv_path: str) -> str:
    rutas_posibles = [
        csv_path,
        "water_quality.csv",
        os.path.join("modelo", "water_quality.csv"),
        os.path.join(os.path.dirname(__file__), "water_quality.csv")
    ]
    for ruta in rutas_posibles:
        if os.path.exists(ruta):
            return ruta
    return ""

def _generar_dataset_respaldo() -> pd.DataFrame:
    rng = np.random.default_rng(42)
    n = 400
    temp = rng.uniform(15.0, 38.0, n)
    turb = rng.uniform(0.5, 18.0, n)
    # Potable (1): turbidez < 5.0 NTU y temperatura entre 18 y 30 °C
    label = ((turb < 5.0) & (temp >= 18.0) & (temp <= 30.0)).astype(int)
    return pd.DataFrame({"Temperature": temp, "Turbidity": turb, "Label": label})

def inicializar_modelo_potabilidad(csv_path: str = "water_quality.csv"):
    global _modelo, _metricas
    ruta_real = _resolver_ruta_csv(csv_path)

    if ruta_real:
        raw_df = pd.read_csv(ruta_real)
        cols_lower = {c.lower().strip(): c for c in raw_df.columns}

        col_temp = cols_lower.get("temperature") or cols_lower.get("temperatura") or cols_lower.get("temp")
        col_turb = cols_lower.get("turbidity") or cols_lower.get("turbidez") or cols_lower.get("turb")
        col_label = cols_lower.get("label") or cols_lower.get("potability") or cols_lower.get("potable") or cols_lower.get("clase")

        if col_temp and col_turb and col_label:
            df = raw_df[[col_temp, col_turb, col_label]].dropna().copy()
            df.columns = ["Temperature", "Turbidity", "Label"]
        else:
            df = _generar_dataset_respaldo()
    else:
        df = _generar_dataset_respaldo()

    df["Label"] = df["Label"].astype(int)

    X = df[["Temperature", "Turbidity"]]
    y = df["Label"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    clf = RandomForestClassifier(
        n_estimators=100,
        random_state=42,
        max_depth=10,
        class_weight="balanced"
    )
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    cm = confusion_matrix(y_test, y_pred, labels=[0, 1])
    tn, fp, fn, tp = cm.ravel()

    _modelo = clf
    _metricas = {
        "accuracy": round(float(accuracy_score(y_test, y_pred) * 100), 2),
        "precision": round(float(precision_score(y_test, y_pred, pos_label=1, zero_division=0) * 100), 2),
        "recall": round(float(recall_score(y_test, y_pred, pos_label=1, zero_division=0) * 100), 2),
        "f1": round(float(f1_score(y_test, y_pred, pos_label=1, zero_division=0) * 100), 2),
        "matriz_confusion": {
            "tn": int(tn),
            "fp": int(fp),
            "fn": int(fn),
            "tp": int(tp),
            "raw": [[int(tn), int(fp)], [int(fn), int(tp)]]
        },
        "total_registros": len(df),
        "train_size": len(X_train),
        "test_size": len(X_test)
    }
    return _modelo

def obtener_metricas_modelo():
    global _modelo, _metricas
    if _modelo is None:
        inicializar_modelo_potabilidad()
    return _metricas

def predecir_potabilidad(temperatura: float, turbidez: float):
    global _modelo
    if _modelo is None:
        inicializar_modelo_potabilidad()

    input_df = pd.DataFrame([{"Temperature": float(temperatura), "Turbidity": float(turbidez)}])
    pred_class = int(_modelo.predict(input_df)[0])
    probabilidades = _modelo.predict_proba(input_df)[0]
    confianza = round(float(np.max(probabilidades)) * 100, 2)

    return {
        "potable": pred_class == 1,
        "diagnostico": "Agua Potable" if pred_class == 1 else "Agua Contaminada",
        "confianza_porcentaje": confianza,
        "metricas": _metricas
    }
