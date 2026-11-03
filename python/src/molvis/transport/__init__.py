"""Transport layer between :class:`Molvis` and a frontend host.

Exposes:

- :class:`Transport` — Protocol every transport must satisfy.
- :class:`WebSocketTransport` — HTTP+WS server; page dials back
  (optional dependency ``websockets``; not imported on Pyodide).
- :class:`InProcessTransport` — same RPC catalog via an in-page invoker
  (Pyodide → ``RPCRouter``; no ``ws://`` hop).
- the binary-frame framing helpers from :mod:`._codec`.

Frame serialization lives in :mod:`molvis.wire`, not here — a transport
concatenates bytes, it does not decide what a column means.
"""

from __future__ import annotations

from typing import Any

from .base import Transport
from ._codec import decode_binary_frame, encode_binary_frame
from ._jupyter_env import detect_env, resolve_endpoints
from .inprocess import InProcessTransport

__all__ = [
    "InProcessTransport",
    "PageEndpoints",
    "Transport",
    "WebSocketTransport",
    "decode_binary_frame",
    "detect_env",
    "encode_binary_frame",
    "resolve_endpoints",
    "resolve_dist",
]


def __getattr__(name: str) -> Any:
    """Lazy-load WebSocket stack so Pyodide can import InProcessTransport
    without the ``websockets`` package.
    """
    if name in ("WebSocketTransport", "PageEndpoints", "resolve_dist"):
        from . import websocket as _ws

        if name == "WebSocketTransport":
            return _ws.WebSocketTransport
        if name == "PageEndpoints":
            return _ws.PageEndpoints
        return _ws.resolve_dist
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
