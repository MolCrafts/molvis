"""Unit tests for molvis.cli mrec load helpers."""

from __future__ import annotations

import sys
import types
from pathlib import Path

import molpy as mp
import pytest

import molvis.cli as cli
from molvis.cli import _load_mrec_trajectory, _mrec_stride_indices


def test_stride_keeps_last_frame() -> None:
    assert _mrec_stride_indices(5, every=2) == [0, 2, 4]
    assert _mrec_stride_indices(1, every=2) == [0]


def test_auto_stride_caps_at_target(monkeypatch) -> None:
    monkeypatch.setattr(cli, "_MREC_TARGET_FRAMES", 4)
    indices = _mrec_stride_indices(10, every=0)
    assert indices[0] == 0
    assert indices[-1] == 9
    assert len(indices) <= 5


def test_supported_extensions_include_mrec_not_bare_zarr() -> None:
    exts = cli._supported_extensions().split()
    assert ".mrec" in exts
    assert ".mrec.zip" not in exts
    assert ".zarr" not in exts


class _FakeTraj:
    def __init__(self, counts: list[int], steps: list[int]) -> None:
        self._counts = counts
        self.step = steps

    def __len__(self) -> int:
        return len(self._counts)

    def __getitem__(self, i: int) -> mp.Frame:
        n = self._counts[i]
        return mp.Frame({"atoms": {"x": [float(v) for v in range(n)]}})


def _install_mrec(monkeypatch, *, secs, traj=None, frame=None) -> None:
    import molpy.io.mrec

    monkeypatch.setattr(molpy.io.mrec, "section_names", lambda _path: secs)
    monkeypatch.setattr(mp.io, "read_mrec_trajectory", lambda _path: traj)
    monkeypatch.setattr(mp.io, "read_mrec_frame", lambda _path: frame)


def test_load_trajectory_section_strides(monkeypatch) -> None:
    traj = _FakeTraj([3, 5, 4, 6, 2], [0, 1, 2, 3, 4])
    _install_mrec(monkeypatch, secs={"trajectory"}, traj=traj)
    frames, steps, overlay = _load_mrec_trajectory(Path("growth.mrec"), every=2)
    assert overlay is None
    assert steps == [0, 2, 4]
    assert [f["atoms"].n_rows for f in frames] == [3, 4, 2]


def test_load_frame_section_is_one_frame(monkeypatch) -> None:
    _install_mrec(
        monkeypatch,
        secs={"frame"},
        frame=mp.Frame({"atoms": {"x": [1.0, 2.0]}}),
    )
    frames, steps, overlay = _load_mrec_trajectory(Path("final.mrec"))
    assert len(frames) == 1
    assert frames[0]["atoms"].n_rows == 2
    assert steps is None
    assert overlay is None


def test_missing_sections_raise(monkeypatch) -> None:
    _install_mrec(monkeypatch, secs=set())
    with pytest.raises(ValueError, match="no frame or trajectory"):
        _load_mrec_trajectory(Path("empty.mrec"))
