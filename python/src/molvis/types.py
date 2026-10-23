from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

#: Marker key identifying a binary-buffer reference inside a JSON payload.
#: Matches ``BUFFER_REF_MARKER`` in ``stage/src/transport/rpc/types.ts``.
BUFFER_REF_MARKER = "__molvis_buffer__"

#: The one encoding a Frame crosses the RPC seam in: molrs's own Frame bytes,
#: written by ``molrs.io.write_msgpack_frame_bytes`` and read by
#: ``molrs.io.read_msgpack_frame_bytes`` here, and by ``writeEncodedFrame`` /
#: ``readEncodedFrame`` (molrs-wasm, format ``msgpack``) in the browser. Blocks, columns with their
#: dtypes and validity masks, the box and the meta all travel inside it.
FRAME_FORMAT = "msgpack"


@dataclass(frozen=True)
class BinaryBufferRef:
    """JSON stand-in for one binary buffer carried beside the envelope.

    A Frame travels as one buffer of molrs Frame bytes; the JSON params carry
    this reference in its place. The WebSocket transport ships the buffers in
    the binary-frame side channel (:mod:`molvis.transport._codec`); the
    in-process transport has no side channel and puts the bytes back inline
    with :meth:`resolve`.
    """

    index: int

    def to_json(self) -> dict[str, Any]:
        return {BUFFER_REF_MARKER: True, "index": self.index}

    @classmethod
    def is_buffer_ref(cls, payload: Any) -> bool:
        return isinstance(payload, Mapping) and payload.get(BUFFER_REF_MARKER) is True

    @classmethod
    def resolve(cls, payload: Any, buffers: Sequence[Any]) -> Any:
        """Replace every buffer reference in *payload* with its bytes.

        Raises:
            ValueError: A reference points past the end of *buffers*.
        """
        if cls.is_buffer_ref(payload):
            index = payload.get("index")
            if not isinstance(index, int) or not 0 <= index < len(buffers):
                raise ValueError(
                    f"buffer index {index!r} is out of range "
                    f"({len(buffers)} buffer(s) received)"
                )
            return bytes(buffers[index])
        if isinstance(payload, Mapping):
            return {key: cls.resolve(value, buffers) for key, value in payload.items()}
        if isinstance(payload, list):
            return [cls.resolve(item, buffers) for item in payload]
        return payload


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
