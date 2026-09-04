"""Vectorised geodesy helpers shared by every pipeline stage.

All functions accept NumPy arrays (or scalars) and never touch the network.
"""
from __future__ import annotations

import numpy as np

from src.config import EARTH_RADIUS_KM, EARTH_RADIUS_M


def to_unit_sphere_xyz(lat_deg, lon_deg, radius: float = EARTH_RADIUS_M) -> np.ndarray:
    """Convert geographic coordinates to 3-D Cartesian coordinates on a sphere.

    Chord distances between the returned points are, for the radii used in this
    pipeline (<= 5 km), indistinguishable from great-circle distances (relative
    error < 1e-7), which lets us use ``scipy.spatial.cKDTree`` with plain
    Euclidean metrics instead of slower Haversine ball trees.

    Returns an ``(n, 3)`` float64 array in the units of ``radius``.
    """
    lat = np.radians(np.asarray(lat_deg, dtype=np.float64))
    lon = np.radians(np.asarray(lon_deg, dtype=np.float64))
    cos_lat = np.cos(lat)
    xyz = np.empty((lat.shape[0], 3), dtype=np.float64)
    xyz[:, 0] = radius * cos_lat * np.cos(lon)
    xyz[:, 1] = radius * cos_lat * np.sin(lon)
    xyz[:, 2] = radius * np.sin(lat)
    return xyz


def haversine_km(lat1, lon1, lat2, lon2) -> np.ndarray:
    """Great-circle distance in kilometres (broadcasting, vectorised)."""
    lat1 = np.radians(np.asarray(lat1, dtype=np.float64))
    lon1 = np.radians(np.asarray(lon1, dtype=np.float64))
    lat2 = np.radians(np.asarray(lat2, dtype=np.float64))
    lon2 = np.radians(np.asarray(lon2, dtype=np.float64))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def chord_to_arc_km(chord_m) -> np.ndarray:
    """Convert a chord length (metres, from ``to_unit_sphere_xyz``) to arc length in km."""
    chord = np.asarray(chord_m, dtype=np.float64) / EARTH_RADIUS_M
    return 2.0 * EARTH_RADIUS_KM * np.arcsin(np.clip(chord / 2.0, 0.0, 1.0))


def geodesic_circle(lat_deg: float, lon_deg: float, radius_km: float, n_vertices: int = 72) -> np.ndarray:
    """Return ``(n_vertices, 2)`` lon/lat vertices of a geodesic circle (spherical model).

    Used to build buffer polygons around industrial centroids without needing a
    projected CRS. The last vertex is *not* repeated; Shapely closes rings itself.
    """
    lat1 = np.radians(lat_deg)
    lon1 = np.radians(lon_deg)
    ang = radius_km / EARTH_RADIUS_KM
    bearings = np.linspace(0.0, 2.0 * np.pi, n_vertices, endpoint=False)
    lat2 = np.arcsin(np.sin(lat1) * np.cos(ang) + np.cos(lat1) * np.sin(ang) * np.cos(bearings))
    lon2 = lon1 + np.arctan2(
        np.sin(bearings) * np.sin(ang) * np.cos(lat1),
        np.cos(ang) - np.sin(lat1) * np.sin(lat2),
    )
    return np.column_stack([np.degrees(lon2), np.degrees(lat2)])
