"""@frame_arg / coerce_to_frame — structure is always the first data argument."""

from __future__ import annotations

import sys
import types

import numpy as np
import pytest

if "molpy" not in sys.modules:
    _mp = types.ModuleType("molpy")
    _mp.Frame = type("Frame", (), {})  # type: ignore[attr-defined]
    _mp.Box = type("Box", (), {})  # type: ignore[attr-defined]
    sys.modules["molpy"] = _mp

from molvis.structure import (
    coerce_to_frame,
    frame_arg,
    frame_payload,
    frames_arg,
)


class FakeFrame:
    def __init__(self, n: int = 2) -> None:
        self.n = n

    def to_dict(self):
        return {
            "blocks": {
                "atoms": {
                    "x": np.zeros(self.n),
                    "y": np.zeros(self.n),
                    "z": np.zeros(self.n),
                    "element": np.array(["C"] * self.n),
                    "aromatic": np.array([0.0] * self.n),
                }
            }
        }


class FakeMolgraph:
    def to_frame(self, atom_fields=None):
        return FakeFrame(3)


def test_coerce_frame_passthrough() -> None:
    f = FakeFrame()
    assert coerce_to_frame(f) is f


def test_coerce_molgraph_to_frame() -> None:
    g = FakeMolgraph()
    out = coerce_to_frame(g)
    assert isinstance(out, FakeFrame)
    assert out.n == 3


def test_coerce_mapping() -> None:
    m = {"blocks": {"atoms": {"x": [0.0]}}}
    assert coerce_to_frame(m) is m


def test_frame_arg_decorator_coerces_first_arg() -> None:
    class Host:
        @frame_arg
        def draw_frame(self, frame, *, include_metadata: bool = False):
            return frame, include_metadata

    h = Host()
    frame, md = h.draw_frame(FakeMolgraph(), include_metadata=True)
    assert isinstance(frame, FakeFrame)
    assert md is True


def test_frame_arg_coerces_before_the_method_body() -> None:
    class Stage:
        @frame_arg
        def draw_frame(self, frame):
            return frame

    coerced = Stage().draw_frame(FakeMolgraph())
    assert "blocks" in coerced.to_dict()


def test_frames_arg_decorator() -> None:
    class Host:
        @frames_arg
        def set_trajectory(self, frames, boxes=None):
            return frames

    h = Host()
    out = h.set_trajectory([FakeMolgraph(), FakeFrame(1)])
    assert len(out) == 2
    assert all(isinstance(f, FakeFrame) for f in out)


def test_frames_arg_empty_raises() -> None:
    class Host:
        @frames_arg
        def set_trajectory(self, frames):
            return frames

    with pytest.raises(ValueError, match="non-empty"):
        Host().set_trajectory([])


def test_frame_payload_states_dtypes_from_the_molrs_registry() -> None:
    payload, buffers = frame_payload(FakeMolgraph())
    columns = payload["blocks"]["atoms"]["columns"]
    assert columns["element"] == {"dtype": "string", "data": ["C", "C", "C"]}
    # Coordinates are float because molrs says so, not because of their values.
    assert columns["x"]["dtype"] == "f64"
    # One buffer per numeric column; the string column rides inline.
    assert len(buffers) == sum(1 for c in columns.values() if c["dtype"] != "string")
