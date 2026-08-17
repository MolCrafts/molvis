#!/usr/bin/env python3
"""
Utility functions and classes for MolVis widget.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import numpy as np

logger = logging.getLogger("molvis")

__all__ = ["NumpyEncoder"]


class NumpyEncoder(json.JSONEncoder):
    """Custom JSON encoder to handle numpy arrays and types."""

    def default(self, o: Any) -> Any:
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.floating):
            return float(o)
        return super().default(o)
