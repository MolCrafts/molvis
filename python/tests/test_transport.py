"""Binary-payload codec round-trip."""

from __future__ import annotations

import numpy as np


def test_binary_frame_round_trip() -> None:
    from molvis.transport import decode_binary_frame, encode_binary_frame

    buffer_a = np.arange(12, dtype=np.float64).tobytes()
    buffer_b = np.array([1, 2, 3], dtype=np.uint32).tobytes()

    json_payload = {"jsonrpc": "2.0", "method": "ping", "params": {"n": 2}, "id": 7}
    frame = encode_binary_frame(json_payload, [buffer_a, buffer_b])
    decoded_json, decoded_buffers = decode_binary_frame(frame)

    assert decoded_json == json_payload
    assert decoded_buffers[0] == buffer_a
    assert decoded_buffers[1] == buffer_b
