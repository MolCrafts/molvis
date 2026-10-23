"""``BinaryBufferRef`` — the JSON stand-in for a buffer beside the envelope."""

from __future__ import annotations

import pytest

from molvis.types import BUFFER_REF_MARKER, BinaryBufferRef


class TestBinaryBufferRef:
    def test_to_json_carries_marker_and_index(self) -> None:
        assert BinaryBufferRef(2).to_json() == {BUFFER_REF_MARKER: True, "index": 2}

    def test_is_buffer_ref(self) -> None:
        assert BinaryBufferRef.is_buffer_ref(BinaryBufferRef(0).to_json())
        assert not BinaryBufferRef.is_buffer_ref({"index": 0})
        assert not BinaryBufferRef.is_buffer_ref(b"bytes")

    def test_resolve_replaces_nested_refs_with_their_bytes(self) -> None:
        payload = {
            "frame": BinaryBufferRef(1).to_json(),
            "frames": [BinaryBufferRef(0).to_json()],
            "follow": True,
        }
        resolved = BinaryBufferRef.resolve(payload, [b"first", b"second"])
        assert resolved == {"frame": b"second", "frames": [b"first"], "follow": True}

    def test_resolve_refuses_a_dangling_index(self) -> None:
        with pytest.raises(ValueError, match="out of range"):
            BinaryBufferRef.resolve({"frame": BinaryBufferRef(3).to_json()}, [b"x"])
