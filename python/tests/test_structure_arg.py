"""@frame_arg / coerce_to_frame — structure is always the first data argument."""

from __future__ import annotations

import molpy as mp
import numpy as np
import pytest
from molvis.structure import (
    coerce_to_frame,
    frame_arg,
    frame_payload,
    frames_arg,
)


def make_frame(n: int = 2) -> mp.Frame:
    return mp.Frame(
        {
            "atoms": {
                "x": np.zeros(n),
                "y": np.zeros(n),
                "z": np.zeros(n),
                "element": ["C"] * n,
                "aromatic": np.zeros(n),
            }
        }
    )


class FakeMolgraph:
    def to_frame(self, atom_fields=None):
        return make_frame(3)


def test_coerce_frame_passthrough() -> None:
    f = make_frame()
    assert coerce_to_frame(f) is f


def test_coerce_molgraph_to_frame() -> None:
    g = FakeMolgraph()
    out = coerce_to_frame(g)
    assert isinstance(out, mp.Frame)
    assert out["atoms"].n_rows == 3


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
    assert isinstance(frame, mp.Frame)
    assert md is True


def test_frame_arg_coerces_before_the_method_body() -> None:
    class Stage:
        @frame_arg
        def draw_frame(self, frame):
            return frame

    coerced = Stage().draw_frame(FakeMolgraph())
    assert coerced.keys() == ["atoms"]


def test_frames_arg_decorator() -> None:
    class Host:
        @frames_arg
        def set_trajectory(self, frames, boxes=None):
            return frames

    h = Host()
    out = h.set_trajectory([FakeMolgraph(), make_frame(1)])
    assert len(out) == 2
    assert all(isinstance(f, mp.Frame) for f in out)


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


def test_native_perception_keeps_the_input_graph_and_atom_properties() -> None:
    graph = mp.io.smiles.read_smiles("[c:7]1ccccc1").to_atomistic()
    before = graph.to_frame()
    frame = coerce_to_frame(graph)
    after = graph.to_frame()
    assert np.array_equal(
        before["atoms"]["atomic_number"], after["atoms"]["atomic_number"]
    )
    assert np.array_equal(before["bonds"]["bond_number"], after["bonds"]["bond_number"])
    assert frame["atoms"]["atom_map"][0] == 7
    assert frame["atoms"]["atomic_number"].tolist() == [6] * 6
    assert all(frame["bonds"]["bond_number"] > 0)


def test_atom_fields_filters_after_native_to_frame() -> None:
    graph = mp.io.smiles.read_smiles("CO").to_atomistic()
    frame = coerce_to_frame(graph, atom_fields=["atomic_number"])
    assert frame["atoms"].keys() == ["atomic_number"]
    assert frame["atoms"]["atomic_number"].tolist() == [6, 8]


def test_atom_fields_does_not_modify_an_adapters_cached_frame() -> None:
    class CachedGraph:
        def __init__(self):
            self.frame = make_frame()

        def to_frame(self):
            return self.frame

    graph = CachedGraph()
    before = set(graph.frame["atoms"].keys())
    filtered = coerce_to_frame(graph, atom_fields=["element"])
    assert filtered["atoms"].keys() == ["element"]
    assert set(graph.frame["atoms"].keys()) == before
    assert graph.frame["atoms"]["x"].tolist() == [0, 0]
