"""Multi-class fire / thermal-source classifier with confidence gating.

Classes
-------
0 Wildfire | 1 Agricultural burning | 2 Industrial fire | 3 Gas flare |
4 Persistent thermal source | 5 Unknown (confidence-gated fallback)

Design
------
* No ground-truth labels exist for FIRMS detections, so the model is trained
  with **weak supervision**: deterministic domain-prior rules (persistence,
  industrial proximity, land cover, FRP, diurnal phase) label the unambiguous
  archetypes; a gradient-boosted ensemble (LightGBM by default, XGBoost
  optional) learns a smooth decision surface from those archetypes and
  generalises it to the ambiguous majority.
* The FIRMS ``type`` attribute (0 vegetation / 2 static source) is used only to
  corroborate rule labels, never as a model feature, so the model works on NRT
  feeds that lack it.
* Final probabilities blend the model output with the rule prior
  (``rule_prior_weight``) and are gated: ``max(P) < 0.60 -> class 5 Unknown``.
* Evidence: per-row top-3 feature contributions (TreeSHAP ``pred_contrib``)
  for the predicted class, exported as JSON.
"""
from __future__ import annotations

import json
import logging
import pickle
import time
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from src.config import CLASS_LABELS, CONFIDENCE_THRESHOLD, MODEL_PATH, RANDOM_STATE, UNKNOWN_CLASS
from src.pipeline.spatial_reference import FLARE_FACILITY_TYPES

log = logging.getLogger(__name__)

N_MODEL_CLASSES = 5   # classes 0..4 are learned; 5 is assigned by the gate

FACILITY_TYPE_CODES: dict[str, int] = {
    "none": 0,
    "industrial_unknown": 1,
    "refinery_petrochemical": 2,
    "refinery_steel": 3,
    "chemical_refinery": 4,
    "oil_gas_flare": 5,
    "power_coal": 6,
    "steel_smelter": 7,
    "coal_mining_fire": 8,
    "gas_processing": 9,
    "lng_terminal": 10,
    "petrochemical": 11,
    "refinery": 12,
}

FEATURE_COLUMNS: list[str] = [
    # radiometry
    "brightness", "bright_t31", "brightness_contrast", "frp", "frp_density", "scan", "track", "confidence_numeric",
    # diurnal / seasonal
    "is_night", "local_hour", "month", "doy_sin", "doy_cos",
    # persistence
    "persistence_1d", "persistence_3d", "persistence_7d", "persistence_30d",
    "prior_detections_7d", "same_day_detections",
    # density
    "hotspot_density",
    # industrial context
    "distance_to_industry_km", "inside_industrial_polygon", "facility_type_code", "is_flare_zone",
    # land cover
    "land_cover_class",
]

# ---- domain-prior thresholds -------------------------------------------------
PERSISTENT_MIN_DAYS_7D = 6        # "> 5 days" out of the trailing 7
PERSISTENT_MIN_DAYS_30D = 15      # cloud-tolerant alternative over 30 days
LOW_PERSISTENCE_MAX_7D = 1
LOW_PERSISTENCE_MAX_30D = 3
INDUSTRIAL_ZONE_KM = 2.0
INDUSTRIAL_FIRE_MIN_FRP = 15.0    # MW; ~98th percentile of sudden-onset FRP inside industrial zones
FLARE_MIN_FRP = 1.0
WILDFIRE_MIN_DENSITY = 10         # neighbours within 5 km / 6 h
AGRI_MAX_DENSITY_UNMAPPED = 5


def build_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """Numeric model matrix in the fixed :data:`FEATURE_COLUMNS` order."""
    X = pd.DataFrame(index=df.index)
    ftype = df["nearest_facility_type"].astype(str)
    dist = df["distance_to_industry_km"].astype(np.float32)
    X["facility_type_code"] = ftype.map(FACILITY_TYPE_CODES).fillna(1).astype(np.int8).values
    X["is_flare_zone"] = (ftype.isin(FLARE_FACILITY_TYPES) & (dist <= INDUSTRIAL_ZONE_KM)).astype(np.int8).values
    for col in FEATURE_COLUMNS:
        if col in X.columns:
            continue
        if col not in df.columns:
            raise KeyError(f"feature column missing from frame: {col}")
        X[col] = df[col].astype(np.float32).values
    return X[FEATURE_COLUMNS]


# --------------------------------------------------------------------------- #
# Rule-based domain priors (weak supervision)
# --------------------------------------------------------------------------- #
def assign_rule_labels(df: pd.DataFrame) -> np.ndarray:
    """Return int8 array of prior labels (0..4) or -1 where no rule fires.

    Rules (first match wins):
      3 Gas flare      : persistent & flare-type zone & FRP >= 1 MW
      4 Persistent src : persistent & (industrial zone | built-up | FIRMS static
                         type | >=20 of the last 30 days)
      2 Industrial fire: industrial zone & sudden onset & FRP >= 15 MW
      1 Agricultural   : cropland & sudden onset & daytime & outside industry
      0 Wildfire       : tree/shrub cover & sudden onset & outside industry,
                         or unmapped cover with a dense daytime/nocturnal front
      1 Agricultural   : unmapped cover, daytime, scattered (density <= 5)
    """
    n = len(df)
    labels = np.full(n, -1, dtype=np.int8)
    if n == 0:
        return labels
    p7 = df["persistence_7d"].values.astype(np.int16)
    p30 = df["persistence_30d"].values.astype(np.int16)
    dist = df["distance_to_industry_km"].values.astype(np.float32)
    ftype = df["nearest_facility_type"].astype(str).values
    lc = df["land_cover_class"].values.astype(np.int16)
    frp = df["frp"].values.astype(np.float32)
    night = df["daynight"].astype(str).values == "N"
    dens = df["hotspot_density"].values.astype(np.int32)
    ftype_flag = df["firms_type"].values.astype(np.int8) if "firms_type" in df.columns else np.full(n, -1, np.int8)
    static_src = ftype_flag == 2

    is_flare_type = np.isin(ftype, list(FLARE_FACILITY_TYPES))
    industrial_zone = dist <= INDUSTRIAL_ZONE_KM
    flare_zone = industrial_zone & is_flare_type
    persistent = (p7 >= PERSISTENT_MIN_DAYS_7D) | (p30 >= PERSISTENT_MIN_DAYS_30D)
    sudden = (p7 <= LOW_PERSISTENCE_MAX_7D) & (p30 <= LOW_PERSISTENCE_MAX_30D)
    unassigned = np.ones(n, dtype=bool)

    def apply(mask: np.ndarray, cls: int) -> None:
        nonlocal unassigned
        hit = mask & unassigned
        labels[hit] = cls
        unassigned &= ~hit

    apply(persistent & flare_zone & (frp >= FLARE_MIN_FRP), 3)
    apply(persistent & (industrial_zone | (lc == 50) | static_src | (p30 >= 20)), 4)
    apply(industrial_zone & sudden & (frp >= INDUSTRIAL_FIRE_MIN_FRP) & ~static_src, 2)
    apply((lc == 40) & sudden & ~night & ~industrial_zone & ~static_src, 1)
    apply(np.isin(lc, [10, 20, 95]) & sudden & ~industrial_zone & ~static_src, 0)
    apply((lc == 30) & sudden & (dens >= WILDFIRE_MIN_DENSITY) & ~industrial_zone & ~static_src, 0)
    apply((lc == 30) & sudden & ~night & (dens <= AGRI_MAX_DENSITY_UNMAPPED) & ~industrial_zone & ~static_src, 1)
    return labels


# --------------------------------------------------------------------------- #
# Classifier wrapper
# --------------------------------------------------------------------------- #
def cuda_available() -> bool:
    """True when XGBoost can train on a CUDA device in this process."""
    try:
        import xgboost as xgb
        X = np.random.default_rng(0).random((64, 4), dtype=np.float32)
        y = np.arange(64) % 2
        xgb.XGBClassifier(device="cuda", tree_method="hist", n_estimators=1, verbosity=0).fit(X, y)
        return True
    except Exception:
        return False


class FireClassifier:
    """Gradient-boosted multi-class classifier with rule priors and confidence gating.

    Parameters
    ----------
    backend        : "xgboost" (default; CUDA-accelerated when available) or "lightgbm".
    device         : "auto" | "cpu" | "cuda" (xgboost only; auto probes the GPU once).
    evidence_method: "auto" | "exact" | "approx" - TreeSHAP variant for evidence
                     scores. "auto" = exact on CUDA / LightGBM, Saabas-approx on
                     CPU XGBoost (about 10x faster, same feature ranking in
                     the vast majority of rows).
    """

    def __init__(
        self,
        backend: str = "xgboost",
        threshold: float = CONFIDENCE_THRESHOLD,
        rule_prior_weight: float = 0.25,
        n_estimators: int = 200,
        learning_rate: float = 0.1,
        max_depth: int = 7,
        num_leaves: int = 31,
        random_state: int = RANDOM_STATE,
        n_jobs: int = -1,
        device: str = "auto",
        evidence_method: str = "auto",
    ) -> None:
        if backend not in ("lightgbm", "xgboost"):
            raise ValueError("backend must be 'lightgbm' or 'xgboost'")
        if device not in ("auto", "cpu", "cuda"):
            raise ValueError("device must be 'auto', 'cpu' or 'cuda'")
        if evidence_method not in ("auto", "exact", "approx"):
            raise ValueError("evidence_method must be 'auto', 'exact' or 'approx'")
        self.backend = backend
        self.threshold = float(threshold)
        self.rule_prior_weight = float(rule_prior_weight)
        self.n_estimators = n_estimators
        self.learning_rate = learning_rate
        self.max_depth = max_depth
        self.num_leaves = num_leaves
        self.random_state = random_state
        self.n_jobs = n_jobs
        self.device = device
        self.evidence_method = evidence_method
        self.device_: Optional[str] = None
        self.model = None
        self.classes_: np.ndarray = np.arange(N_MODEL_CLASSES)
        self.feature_names_: list[str] = list(FEATURE_COLUMNS)
        self.training_report_: dict = {}

    # ------------------------------------------------------------------ fit
    def _resolve_device(self) -> str:
        if self.backend != "xgboost":
            return "cpu"
        if self.device == "cpu":
            return "cpu"
        if cuda_available():
            return "cuda"
        if self.device == "cuda":
            log.warning("CUDA requested but unavailable to XGBoost; falling back to CPU")
        return "cpu"

    def _make_model(self, n_classes: int):
        if self.backend == "lightgbm":
            import lightgbm as lgb
            return lgb.LGBMClassifier(
                objective="multiclass", num_class=n_classes, n_estimators=self.n_estimators,
                learning_rate=self.learning_rate, num_leaves=self.num_leaves, max_depth=self.max_depth,
                subsample=0.8, subsample_freq=1, colsample_bytree=0.8, min_child_samples=50,
                reg_lambda=1.0, class_weight="balanced", random_state=self.random_state,
                n_jobs=self.n_jobs, verbose=-1,
            )
        import xgboost as xgb
        return xgb.XGBClassifier(
            objective="multi:softprob", num_class=n_classes, n_estimators=self.n_estimators,
            learning_rate=self.learning_rate, max_depth=self.max_depth, subsample=0.8,
            colsample_bytree=0.8, min_child_weight=5, reg_lambda=1.0, tree_method="hist",
            device=self.device_, random_state=self.random_state,
            n_jobs=self.n_jobs if self.n_jobs > 0 else None, verbosity=0,
        )

    def fit(
        self,
        df: pd.DataFrame,
        labels: Optional[np.ndarray] = None,
        max_per_class: int = 200_000,
        validation_fraction: float = 0.2,
    ) -> "FireClassifier":
        t0 = time.time()
        if labels is None:
            labels = assign_rule_labels(df)
        labels = np.asarray(labels, dtype=np.int64)
        labelled = np.flatnonzero(labels >= 0)
        if labelled.size == 0:
            raise ValueError("no rule-labelled rows available for training")
        rng = np.random.default_rng(self.random_state)
        # stratified cap per class
        keep = []
        for cls in np.unique(labels[labelled]):
            idx = labelled[labels[labelled] == cls]
            if idx.size > max_per_class:
                idx = rng.choice(idx, size=max_per_class, replace=False)
            keep.append(idx)
        keep = np.concatenate(keep)
        rng.shuffle(keep)
        n_val = int(len(keep) * validation_fraction)
        val_idx, tr_idx = keep[:n_val], keep[n_val:]

        X_all = build_feature_matrix(df)
        y_all = labels
        self.classes_ = np.unique(y_all[keep])
        class_pos = {c: i for i, c in enumerate(self.classes_)}
        y_tr = np.vectorize(class_pos.get)(y_all[tr_idx])
        self.device_ = self._resolve_device()
        model = self._make_model(len(self.classes_))
        if self.backend == "xgboost":
            counts = np.bincount(y_tr, minlength=len(self.classes_)).astype(np.float64)
            w = (len(y_tr) / (len(self.classes_) * np.maximum(counts, 1)))[y_tr]
            model.fit(X_all.iloc[tr_idx], y_tr, sample_weight=w)
        else:
            model.fit(X_all.iloc[tr_idx], y_tr)
        self.model = model

        report = {
            "backend": self.backend,
            "device": self.device_,
            "train_rows": int(len(tr_idx)),
            "validation_rows": int(len(val_idx)),
            "labelled_rows_total": int(labelled.size),
            "unlabelled_rows": int(len(df) - labelled.size),
            "label_counts": {CLASS_LABELS[int(c)]: int((y_all[labelled] == c).sum()) for c in self.classes_},
            "train_seconds": round(time.time() - t0, 1),
        }
        if len(val_idx):
            from sklearn.metrics import classification_report, confusion_matrix
            p = self._model_proba(X_all.iloc[val_idx])
            pred = self.classes_[np.argmax(p, axis=1)]
            y_val = y_all[val_idx]
            report["validation_accuracy"] = float((pred == y_val).mean())
            rep = classification_report(y_val, pred, labels=self.classes_,
                                        target_names=[CLASS_LABELS[int(c)] for c in self.classes_],
                                        output_dict=True, zero_division=0)
            report["validation_macro_f1"] = float(rep["macro avg"]["f1-score"])
            report["validation_per_class_f1"] = {k: round(v["f1-score"], 4) for k, v in rep.items()
                                                if isinstance(v, dict) and "f1-score" in v and k not in ("macro avg", "weighted avg")}
            report["validation_confusion_matrix"] = confusion_matrix(y_val, pred, labels=self.classes_).tolist()
        imp = self.feature_importances()
        report["top_features"] = dict(list(imp.items())[:10])
        self.training_report_ = report
        log.info("Classifier trained (%s): %d rows, val acc=%.3f macro-F1=%.3f in %.1fs",
                 self.backend, len(tr_idx), report.get("validation_accuracy", float("nan")),
                 report.get("validation_macro_f1", float("nan")), report["train_seconds"])
        return self

    # ------------------------------------------------------------- inference
    def _model_proba(self, X: pd.DataFrame) -> np.ndarray:
        if self.backend == "xgboost":
            import xgboost as xgb
            p = self.model.get_booster().predict(xgb.DMatrix(X))
            p = np.asarray(p, dtype=np.float64)
            if p.ndim == 1:                      # binary objective -> P(class 1)
                p = np.column_stack([1.0 - p, p])
            return p
        return np.asarray(self.model.predict_proba(X), dtype=np.float64)

    def _contributions(self, X: pd.DataFrame) -> np.ndarray:
        """TreeSHAP contributions shaped (n, n_model_classes, n_features + 1)."""
        n_feat = X.shape[1]
        if self.backend == "lightgbm":
            raw = np.asarray(self.model.predict(X, pred_contrib=True))
            blocks = raw.shape[1] // (n_feat + 1)
            if blocks == 1:                      # binary objective returns one block
                raw = np.stack([-raw, raw], axis=1)
            else:
                raw = raw.reshape(len(X), blocks, n_feat + 1)
            return raw
        import xgboost as xgb
        booster = self.model.get_booster()
        approx = self.evidence_method == "approx" or (self.evidence_method == "auto" and self.device_ != "cuda")
        raw = booster.predict(xgb.DMatrix(X), pred_contribs=True, approx_contribs=approx)
        raw = np.asarray(raw)
        if raw.ndim == 2:                        # binary objective -> one block
            raw = np.stack([-raw, raw], axis=1)
        return raw

    def predict(
        self,
        df: pd.DataFrame,
        rule_labels: Optional[np.ndarray] = None,
        return_evidence: bool = True,
        chunk_size: int = 250_000,
        top_k: int = 3,
    ) -> pd.DataFrame:
        """Classify every row. Returns predicted_class, predicted_label,
        confidence_score, evidence_scores (JSON), prob_class_0..4."""
        if self.model is None:
            raise RuntimeError("classifier is not fitted")
        n = len(df)
        X = build_feature_matrix(df)
        if rule_labels is None:
            rule_labels = assign_rule_labels(df)
        rule_labels = np.asarray(rule_labels, dtype=np.int64)
        probs = np.zeros((n, N_MODEL_CLASSES), dtype=np.float32)
        evidence = np.empty(n, dtype=object) if return_evidence else None
        feat_names = np.asarray(self.feature_names_)
        t0 = time.time()
        for start in range(0, n, chunk_size):
            sl = slice(start, min(start + chunk_size, n))
            Xc = X.iloc[sl]
            p_model = self._model_proba(Xc)
            p_full = np.zeros((len(Xc), N_MODEL_CLASSES), dtype=np.float64)
            p_full[:, self.classes_] = p_model
            # blend with rule prior where a prior fires
            rl = rule_labels[sl]
            has_rule = rl >= 0
            if self.rule_prior_weight > 0 and has_rule.any():
                onehot = np.zeros_like(p_full)
                onehot[np.flatnonzero(has_rule), rl[has_rule]] = 1.0
                w = self.rule_prior_weight
                p_full[has_rule] = (1.0 - w) * p_full[has_rule] + w * onehot[has_rule]
            p_full /= np.clip(p_full.sum(axis=1, keepdims=True), 1e-12, None)
            probs[sl] = p_full.astype(np.float32)
            if return_evidence:
                contrib = self._contributions(Xc)                       # (m, k, f+1)
                model_arg = np.argmax(p_model, axis=1)                  # position within self.classes_
                rows = np.arange(len(Xc))
                c = contrib[rows, model_arg, :-1]                       # drop bias term
                top = np.argsort(-np.abs(c), axis=1)[:, :top_k]
                vals = np.take_along_axis(c, top, axis=1)
                names = feat_names[top]
                evidence[sl] = [json.dumps({str(nm): round(float(v), 4) for nm, v in zip(nr, vr)})
                                for nr, vr in zip(names, vals)]
        max_prob = probs.max(axis=1)
        pred = probs.argmax(axis=1).astype(np.int8)
        gated = max_prob < self.threshold
        pred[gated] = UNKNOWN_CLASS
        out = pd.DataFrame({
            "predicted_class": pred,
            "predicted_label": pd.Categorical.from_codes(pred, categories=[CLASS_LABELS[i] for i in range(6)]),
            "confidence_score": max_prob.astype(np.float32),
            "rule_prior_class": rule_labels.astype(np.int8),
        }, index=df.index)
        for i in range(N_MODEL_CLASSES):
            out[f"prob_class_{i}"] = probs[:, i]
        out["evidence_scores"] = evidence if return_evidence else "{}"
        log.info("Predicted %d rows in %.1fs (%.1f%% gated to Unknown)", n, time.time() - t0, 100.0 * gated.mean())
        return out

    # ------------------------------------------------------------ utilities
    def feature_importances(self) -> dict[str, float]:
        if self.model is None:
            return {}
        if self.backend == "lightgbm":
            imp = self.model.booster_.feature_importance(importance_type="gain")
        else:
            score = self.model.get_booster().get_score(importance_type="gain")
            imp = np.array([score.get(f, 0.0) for f in self.feature_names_])
        imp = np.asarray(imp, dtype=np.float64)
        if imp.sum() > 0:
            imp = imp / imp.sum()
        order = np.argsort(-imp)
        return {self.feature_names_[i]: round(float(imp[i]), 4) for i in order}

    def save(self, path: Path = MODEL_PATH) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as fh:
            pickle.dump(self, fh)
        return path

    @classmethod
    def load(cls, path: Path = MODEL_PATH) -> "FireClassifier":
        with open(path, "rb") as fh:
            obj = pickle.load(fh)
        if not isinstance(obj, cls):
            raise TypeError("pickle does not contain a FireClassifier")
        # A model trained on CUDA must still work on a CPU-only machine.
        if obj.backend == "xgboost" and obj.device_ == "cuda" and not cuda_available():
            obj.model.get_booster().set_param({"device": "cpu"})
            obj.device_ = "cpu"
            log.info("Loaded CUDA-trained model onto CPU")
        return obj


# --------------------------------------------------------------------------- #
# Validation against the embedded flare catalog
# --------------------------------------------------------------------------- #
def flare_catalog_validation(df: pd.DataFrame, predictions: pd.DataFrame) -> dict:
    """Consistency of the Gas-Flare class with the embedded flare-site catalog.

    * recall proxy   : share of *persistent* detections within a catalog site's
                       radius that are classified Gas flare (strict) or Gas
                       flare / Persistent source (lenient).
    * precision proxy: share of Gas-flare predictions that lie within a known
                       flare-bearing facility (catalog site or flare-type zone).
    """
    pred = predictions["predicted_class"].values
    near = df["near_flare_site"].values.astype(bool)
    persistent = (df["persistence_7d"].values >= PERSISTENT_MIN_DAYS_7D) | (df["persistence_30d"].values >= PERSISTENT_MIN_DAYS_30D)
    ref = near & persistent
    flare_pred = pred == 3
    ftype = df["nearest_facility_type"].astype(str).values
    flare_zone = np.isin(ftype, list(FLARE_FACILITY_TYPES)) & (df["distance_to_industry_km"].values <= INDUSTRIAL_ZONE_KM)
    out = {
        "catalog_sites": int(df["flare_site_id"].nunique()),
        "reference_detections": int(ref.sum()),
        "flare_predictions": int(flare_pred.sum()),
        "recall_strict_gas_flare": float(flare_pred[ref].mean()) if ref.any() else None,
        "recall_lenient_flare_or_persistent": float(np.isin(pred[ref], [3, 4]).mean()) if ref.any() else None,
        "precision_proxy_in_flare_zone": float((near | flare_zone)[flare_pred].mean()) if flare_pred.any() else None,
        "catalog_sites_detected": int(df.loc[ref, "flare_site_id"].nunique()) if ref.any() else 0,
    }
    return out
