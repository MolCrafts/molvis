"""@frame_arg / coerce_to_frame — structure is always the first data argument."""

from __future__ import annotations

import molpy as mp
import numpy as np
import pytest

from molvis.structure import coerce_to_frame, frame_arg, frames_arg


def _frame(n: int = 2) -> mp.Frame:
    frame = mp.Frame()
    frame["atoms"] = {
        "x": np.zeros(n),
        "y": np.zeros(n),
        "z": np.zeros(n),
        "element": np.array(["C"] * n),
    }
    return frame


def _graph() -> mp.Atomistic:
    graph = mp.Atomistic()
    graph.def_atom(x=0.0, y=0.0, z=0.0, element="C")
    graph.def_atom(x=1.5, y=0.0, z=0.0, element="O")
    graph.def_atom(x=3.0, y=0.0, z=0.0, element="C")
    return graph


def test_coerce_frame_passthrough() -> None:
    f = _frame()
    assert coerce_to_frame(f) is f


def test_coerce_graph_to_frame() -> None:
    out = coerce_to_frame(_graph())
    assert isinstance(out, mp.Frame)
    assert out["atoms"].n_rows == 3


def test_coerce_rejects_a_mapping() -> None:
    # A dict shaped like a frame is not a Frame; molrs builds Frames.
    with pytest.raises(TypeError, match="Frame"):
        coerce_to_frame({"blocks": {"atoms": {"x": [0.0]}}})


def test_coerce_rejects_none() -> None:
    with pytest.raises(TypeError, match="required"):
        coerce_to_frame(None)


def test_frame_arg_decorator_coerces_first_arg() -> None:
    class Host:
        @frame_arg
        def draw_frame(self, frame, *, include_metadata: bool = False):
            return frame, include_metadata

    frame, md = Host().draw_frame(_graph(), include_metadata=True)
    assert isinstance(frame, mp.Frame)
    assert md is True


def test_frames_arg_decorator() -> None:
    class Host:
        @frames_arg
        def set_trajectory(self, frames):
            return frames

    out = Host().set_trajectory([_graph(), _frame(1)])
    assert len(out) == 2
    assert all(isinstance(f, mp.Frame) for f in out)


def test_frames_arg_empty_raises() -> None:
    class Host:
        @frames_arg
        def set_trajectory(self, frames):
            return frames

    with pytest.raises(ValueError, match="non-empty"):
        Host().set_trajectory([])


def test_coerce_rejects_a_frame_molrs_finds_invalid() -> None:
    frame = _frame()
    frame["bonds"] = {
        "atomi": np.array([0], dtype=np.uint64),
        "atomj": np.array([5], dtype=np.uint64),
    }
    with pytest.raises(ValueError, match="out of range"):
        coerce_to_frame(frame)
