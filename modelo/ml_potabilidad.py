import os
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier

_modelo = None
_accuracy = 0.0

def inicializar_modelo_potabilidad(csv_path: str = "water_quality.csv"):
    global _modelo, _accuracy
    if not os.path.exists(csv_path):
        return None

    # Carga y limpieza de datos según el dataset de Kevin
    df = pd.read_csv(csv_path)[["Temperature", "Turbidity", "Label"]].dropna()
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

    _modelo = clf
    _accuracy = round(float(clf.score(X_test, y_test) * 100), 2)
    return _modelo

def predecir_potabilidad(temperatura: float, turbidez: float):
    global _modelo
    if _modelo is None:
        inicializar_modelo_potabilidad()

    if _modelo is None:
        raise ValueError("El archivo water_quality.csv no fue encontrado en la raíz del proyecto.")

    input_df = pd.DataFrame([{
        "Temperature": float(temperatura), 
        "Turbidity": float(turbidez)
    }])
    
    pred_class = int(_modelo.predict(input_df)[0])
    probabilidades = _modelo.predict_proba(input_df)[0]
    confianza = round(float(np.max(probabilidades)) * 100, 2)

    return {
        "potable": pred_class == 1,
        "diagnostico": "Agua Potable" if pred_class == 1 else "Agua Contaminada",
        "confianza_porcentaje": confianza,
        "accuracy_modelo": _accuracy
    }
