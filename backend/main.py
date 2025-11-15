from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np
import joblib
import os
from typing import List, Dict, Any

# Metrics
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

app = FastAPI(title="Water Consumption Forecast API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
DATA_PATH = os.path.join("data", "WaterConsumptionDataset(Finalized).csv")
MODELS_PATH = "models"

TARGET_COL = "Total Water Consumption(Billion Cubic Meters)"

# Load dataset
if not os.path.exists(DATA_PATH):
    raise FileNotFoundError(f"Dataset not found at {DATA_PATH}")

df = pd.read_csv(DATA_PATH)

# Clean numeric commas
if "Population" in df.columns:
    df["Population"] = df["Population"].astype(str).str.replace(",", "").astype(float)

COUNTRIES = sorted(df["Country"].dropna().unique().tolist())

# Features
X_all = df.drop(columns=[TARGET_COL])
categorical_features = ["Country", "Water Scarcity Level"]
numerical_features = [c for c in X_all.columns if c not in categorical_features]
FEATURE_COLUMNS = numerical_features + categorical_features


def load_model(file):
    path = os.path.join(MODELS_PATH, file)
    if not os.path.exists(path):
        raise RuntimeError(f"Model file missing: {path}")
    return joblib.load(path)


# LOAD MODELS
model_map = {
    "lasso": load_model("lasso_fixed.pkl"),
    "ridge": load_model("ridge_fixed.pkl"),
    "knn": load_model("knn_fixed.pkl"),
}


class PredictInput(BaseModel):
    country: str
    year: int
    models: List[str] = []


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/countries")
def countries():
    return COUNTRIES


def build_features(country: str):
    hist = df[df["Country"] == country].sort_values("Year")
    if hist.empty:
        raise ValueError(f"No data for country {country}")

    X_hist = hist[FEATURE_COLUMNS].copy()
    y_true = hist[TARGET_COL].astype(float).tolist()

    return hist, X_hist, y_true


# ---------------------- PREDICT ----------------------
@app.post("/predict")
def predict(body: PredictInput):
    country = body.country
    year = body.year

    if country not in COUNTRIES:
        raise HTTPException(400, f"Invalid country: {country}")

    hist, X_hist, y_true = build_features(country)

    # Prepare future row
    X_pred = X_hist.iloc[-1:].copy()
    X_pred["Year"] = year
    X_pred["Country"] = country

    # Model selection
    for m in body.models:
        m = m.lower()
        if m in model_map:
            model_key = m
            model = model_map[m]
            break
    else:
        model_key = "lasso"
        model = model_map["lasso"]

    # Predict
    try:
        y_fit = model.predict(X_hist)
        y_future = float(model.predict(X_pred)[0])
    except Exception as e:
        raise HTTPException(500, f"Prediction failed: {e}")

    current = float(y_fit[-1])
    change = ((y_future - current) / current * 100) if current != 0 else 0.0

    # Confidence band
    errors = np.array(y_true) - np.array(y_fit)
    std = float(np.std(errors)) if len(errors) else 0.0
    band = [[float(v - 2*std), float(v + 2*std)] for v in y_fit] + \
           [[float(y_future - 2*std), float(y_future + 2*std)]]

    return {
        "model_used": model_key,
        "years": hist["Year"].tolist() + [year],
        "values": list(map(float, y_fit)) + [y_future],
        "current": current,
        "predicted": y_future,
        "change": change,
        "band": band,
        "metrics": {}
    }


# ---------------------- COMPARE ----------------------
@app.get("/compare")
def compare(country: str):
    if country not in COUNTRIES:
        raise HTTPException(400, f"Invalid country: {country}")

    hist = df[df["Country"] == country].sort_values("Year")
    years = hist["Year"].tolist()
    X_hist = hist[FEATURE_COLUMNS].copy()

    model_results = {}
    for name, model in model_map.items():
        try:
            preds = model.predict(X_hist)
            model_results[name] = list(map(float, preds))
        except Exception as e:
            print(f"[ERROR] {name} failed: {e}")
            model_results[name] = []

    return {
        "years": years,
        "lasso": model_results.get("lasso", []),
        "ridge": model_results.get("ridge", []),
        "knn": model_results.get("knn", [])
    }


# ---------------------- METRICS ----------------------
@app.get("/metrics")
def metrics(country: str):
    if country not in COUNTRIES:
        raise HTTPException(400, f"Invalid country: {country}")

    hist, X_hist, y_true = build_features(country)

    results = {}

    for name, model in model_map.items():
        try:
            y_pred = model.predict(X_hist)

            y_true_arr = np.array(y_true)
            y_pred_arr = np.array(y_pred)

            mae = float(mean_absolute_error(y_true_arr, y_pred_arr))
            rmse = float(np.sqrt(mean_squared_error(y_true_arr, y_pred_arr)))
            r2 = float(r2_score(y_true_arr, y_pred_arr))

            # MAPE
            nonzero_mask = y_true_arr != 0
            mape = float(np.mean(np.abs((y_true_arr[nonzero_mask] - y_pred_arr[nonzero_mask]) /
                                        y_true_arr[nonzero_mask])) * 100) if nonzero_mask.any() else None

            results[name] = {
                "MAE": mae,
                "RMSE": rmse,
                "R2": r2,
                "MAPE": mape
            }
        except Exception as e:
            print(f"[METRICS ERROR] {name} for {country}: {e}")
            results[name] = {
                "MAE": None, "RMSE": None, "R2": None, "MAPE": None
            }

    return results


# ---------------------- ANALYSIS (FIX FOR YOUR ERROR) ----------------------
@app.get("/analysis")
def country_analysis(country: str):
    """
    Returns true historical values ONLY (no prediction)
    Used in frontend Country Analysis page.
    """
    if country not in COUNTRIES:
        raise HTTPException(400, f"Invalid country: {country}")

    hist = df[df["Country"] == country].sort_values("Year")

    if hist.empty:
        raise HTTPException(404, "No data for this country")

    return {
        "years": hist["Year"].tolist(),
        "true_values": hist[TARGET_COL].astype(float).tolist()
    }
