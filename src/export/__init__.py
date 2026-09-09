"""Export helpers shared by the pipeline runner and the console exporter."""
from __future__ import annotations

import math
from datetime import datetime

import numpy as np
import pandas as pd


def json_safe(v):
    """Coerce NumPy / pandas scalars to plain JSON values (NaN -> None, floats rounded to 4 dp)."""
    if v is None:
        return None
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if (isinstance(v, float) and math.isnan(v)) or (isinstance(v, np.floating) and np.isnan(v)) else round(float(v), 4)
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%dT%H:%M:%SZ")
    return str(v) if not isinstance(v, (int, str)) else v
