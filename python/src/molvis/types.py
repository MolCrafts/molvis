from __future__ import annotations

from dataclasses import dataclass
from typing import Any

BUFFER_REF_MARKER = "__molvis_buffer__"


@dataclass(frozen=True)
class BinaryBufferRef:
    """JSON-serializable reference to a binary payload stored in widget buffers."""

    index: int
    dtype: str
    shape: tuple[int, ...]

    def to_json(self) -> dict[str, Any]:
        return {
            BUFFER_REF_MARKER: True,
            "index": self.index,
            "dtype": self.dtype,
            "shape": list(self.shape),
        }

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "BinaryBufferRef":
        return cls(
            index=int(payload["index"]),
            dtype=str(payload["dtype"]),
            shape=tuple(int(dim) for dim in payload.get("shape", [])),
        )

    @classmethod
    def is_buffer_ref(cls, payload: Any) -> bool:
        return isinstance(payload, dict) and bool(payload.get(BUFFER_REF_MARKER))


@dataclass(frozen=True)
class JsonRPCRequest:
    jsonrpc: str
    id: int
    method: str
    params: dict[str, Any]


@dataclass(frozen=True)
class JsonRPCResponse:
    jsonrpc: str
    id: int
    result: Any | None = None
    error: dict[str, Any] | None = None
