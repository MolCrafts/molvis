"""WebSocket frame framing shared by the transports.

Packs a JSON-RPC envelope and its binary buffers into one WebSocket frame.

Column serialization is **not** here — that is :mod:`molvis.wire`, the one
place a Frame becomes bytes. This module only concatenates what it is given.
"""

from __future__ import annotations

import json
import struct
from typing import Any

__all__ = [
    "decode_binary_frame",
    "encode_binary_frame",
]


def encode_binary_frame(
    json_payload: dict[str, Any],
    buffers: list[memoryview | bytes],
) -> bytes:
    """Pack a JSON-RPC envelope + binary buffers into one WebSocket frame.

    Wire format (little-endian throughout):
        [4 bytes]    uint32  buffer_count (N)
        [N*8 bytes]  N pairs of (uint32 offset, uint32 length)
        [variable]   JSON payload as UTF-8
        [variable]   concatenated buffer bytes

    Offsets are relative to the start of the buffer data section
    (immediately after the JSON section).
    """
    json_bytes = json.dumps(json_payload).encode("utf-8")
    buffer_count = len(buffers)

    byte_offset = 0
    offset_table: list[tuple[int, int]] = []
    for buf in buffers:
        nbytes = buf.nbytes if hasattr(buf, "nbytes") else len(buf)
        offset_table.append((byte_offset, nbytes))
        byte_offset += nbytes

    header_size = 4 + buffer_count * 8
    total_size = header_size + len(json_bytes) + byte_offset

    out = bytearray(total_size)
    pos = 0

    struct.pack_into("<I", out, pos, buffer_count)
    pos += 4

    for buf_offset, buf_length in offset_table:
        struct.pack_into("<I", out, pos, buf_offset)
        pos += 4
        struct.pack_into("<I", out, pos, buf_length)
        pos += 4

    out[pos : pos + len(json_bytes)] = json_bytes
    pos += len(json_bytes)

    for buf in buffers:
        buf_bytes = bytes(buf)
        out[pos : pos + len(buf_bytes)] = buf_bytes
        pos += len(buf_bytes)

    return bytes(out)


def decode_binary_frame(data: bytes) -> tuple[dict[str, Any], list[bytes]]:
    """Decode a binary frame into ``(json_dict, [buffer_bytes])``."""
    pos = 0

    buffer_count = struct.unpack_from("<I", data, pos)[0]
    pos += 4

    offset_table: list[tuple[int, int]] = []
    for _ in range(buffer_count):
        buf_offset = struct.unpack_from("<I", data, pos)[0]
        pos += 4
        buf_length = struct.unpack_from("<I", data, pos)[0]
        pos += 4
        offset_table.append((buf_offset, buf_length))

    header_size = 4 + buffer_count * 8
    total_buffer_size = sum(length for _, length in offset_table)
    json_end = len(data) - total_buffer_size
    json_bytes = data[header_size:json_end]
    json_payload = json.loads(json_bytes.decode("utf-8"))

    buffer_data_start = json_end
    buffers: list[bytes] = []
    for buf_offset, buf_length in offset_table:
        start = buffer_data_start + buf_offset
        buffers.append(data[start : start + buf_length])

    return json_payload, buffers
