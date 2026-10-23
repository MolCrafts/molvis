"""Unit tests for molvis.cli mrec load helpers."""

from __future__ import annotations

from pathlib import Path

import molpy as mp
import numpy as np
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
        return _frame_with_atoms(self._counts[i])


def _frame_with_atoms(n: int) -> mp.Frame:
    frame = mp.Frame()
    frame["atoms"] = {"x": np.arange(n, dtype=np.float64)}
    return frame


def _install_mrec(monkeypatch, *, secs, traj=None, frame=None) -> None:
    import molrs.io as io

    monkeypatch.setattr(io.mrec, "section_names", lambda _path: secs)
    monkeypatch.setattr(io, "read_mrec_trajectory", lambda _path: traj)
    monkeypatch.setattr(io, "read_mrec_frame", lambda _path: frame)


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
        frame=_frame_with_atoms(2),
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


def test_supported_extensions_include_trajectory_and_topology() -> None:
    exts = set(cli._supported_extensions().split())
    assert {".dcd", ".xtc", ".trr", ".prmtop", ".parm7", ".stl"} <= exts
    assert ".top" not in exts
    assert ".itp" not in exts


def test_lammps_data_unwraps_frame(monkeypatch, tmp_path: Path) -> None:
    path = tmp_path / "sys.data"
    path.write_text("placeholder", encoding="utf-8")
    frame = _frame_with_atoms(4)

    class _Result:
        def __init__(self) -> None:
            self.frame = frame

    monkeypatch.setattr(cli.mp.io, "read_lammps_data", lambda _path, _style: _Result())
    assert cli._load_single_frame(path, "full") is frame


def test_prmtop_reader_returns_structure_frame(monkeypatch, tmp_path: Path) -> None:
    path = tmp_path / "mol.prmtop"
    path.write_text("placeholder", encoding="utf-8")
    frame = _frame_with_atoms(2)
    monkeypatch.setattr(cli.mp.io, "read_amber", lambda _path, inpcrd=None: (frame, object()))
    assert cli._load_single_frame(path, "full") is frame


def test_dcd_loads_through_the_trajectory_reader(monkeypatch, tmp_path: Path) -> None:
    path = tmp_path / "run.dcd"
    path.write_bytes(b"not a real dcd")
    frames = [_frame_with_atoms(1), _frame_with_atoms(1)]

    class _Reader:
        def read_all(self) -> list[mp.Frame]:
            return frames

    monkeypatch.setitem(cli._TRAJECTORY_READERS, ".dcd", lambda _path: _Reader())
    assert cli._load_trajectory(path) == frames


def test_overlay_stl_is_a_mesh(tmp_path: Path) -> None:
    path = tmp_path / "cavity.stl"
    path.write_bytes(b"solid")
    kind, payload = cli._load_overlay(path, "full")
    assert kind == "mesh"
    assert payload == path


def test_overlay_rejects_a_second_trajectory(tmp_path: Path) -> None:
    path = tmp_path / "run.dcd"
    path.write_bytes(b"x")
    with pytest.raises(ValueError, match="owns the timeline"):
        cli._load_overlay(path, "full")


def test_overlay_mrec_uses_the_frame_section(monkeypatch, tmp_path: Path) -> None:
    store = tmp_path / "top.mrec"
    store.mkdir()
    frame = _frame_with_atoms(3)
    _install_mrec(monkeypatch, secs={"frame", "trajectory"}, frame=frame)
    kind, payload = cli._load_overlay(store, "full")
    assert kind == "frame"
    assert payload is frame


def test_overlay_mrec_without_a_frame_section_raises(monkeypatch, tmp_path: Path) -> None:
    store = tmp_path / "traj.mrec"
    store.mkdir()
    _install_mrec(monkeypatch, secs={"trajectory"})
    with pytest.raises(ValueError, match="no frame section"):
        cli._load_overlay(store, "full")


def test_serve_parser_collects_overlays() -> None:
    args = cli._build_parser().parse_args(
        ["serve", "run.dcd", "top.pdb", "cavity.stl", "--style", "spacefill", "--no-browser"]
    )
    assert args.command == "serve"
    assert args.func is cli._cmd_serve
    assert args.file == Path("run.dcd")
    assert args.overlays == [Path("top.pdb"), Path("cavity.stl")]
    assert args.style == "spacefill"
    assert args.no_browser is True


class _Page:
    standalone_url = "http://127.0.0.1:9/"


class _FakeTransport:
    def __init__(self, open_browser: bool = True, **_kwargs: object) -> None:
        self.open_browser = open_browser

    def page_endpoints(self, session: str | None = None) -> _Page:
        return _Page()


class _FakeScene:
    def __init__(self, name: str | None = None, transport: object = None) -> None:
        self.name = name or "default"
        self.transport = transport
        self.calls: list[tuple[object, ...]] = []

    @property
    def connection_url(self) -> str:
        return "ws://127.0.0.1:9/ws"

    def set_trajectory(self, frames: object, *, wait: bool = False) -> None:
        self.calls.append(("trajectory", frames, wait))

    def append_frame(self, frame: object, *, follow: bool = True) -> None:
        self.calls.append(("append", follow))

    def add_data_source(
        self,
        frame: object,
        *,
        filename: str | None = None,
        wait: bool = True,
    ) -> None:
        self.calls.append(("source", filename, frame))

    def add_mesh(self, path: object, *, wait: bool = True) -> None:
        self.calls.append(("mesh", Path(str(path)).name))

    def set_frame_labels(self, labels: object) -> None:
        self.calls.append(("labels", labels))

    def set_style(self, style: str | None = None, **_kwargs: object) -> None:
        self.calls.append(("style", style))

    def draw_frame(self, frame: object, *, wait: bool = False) -> None:
        self.calls.append(("draw", frame))

    def wait(self) -> None:
        self.calls.append(("wait",))

    def close(self) -> None:
        self.calls.append(("close",))


def _install_fakes(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    holder: dict[str, object] = {}

    class Transport(_FakeTransport):
        def __init__(self, open_browser: bool = True, **kwargs: object) -> None:
            super().__init__(open_browser=open_browser, **kwargs)
            holder["open_browser"] = open_browser

    class Scene(_FakeScene):
        def __init__(self, name: str | None = None, transport: object = None) -> None:
            super().__init__(name, transport)
            holder["scene"] = self

    monkeypatch.setattr(cli.mv, "WebSocketTransport", Transport)
    monkeypatch.setattr(cli.mv, "Molvis", Scene)
    return holder


def test_serve_stacks_topology_and_mesh_then_waits(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    traj = tmp_path / "run.dcd"
    top = tmp_path / "top.pdb"
    mesh = tmp_path / "cavity.stl"
    for path in (traj, top, mesh):
        path.write_bytes(b"x")
    frames = [_frame_with_atoms(2), _frame_with_atoms(2)]
    topo = _frame_with_atoms(2)
    monkeypatch.setattr(cli, "_load_trajectory", lambda _path: frames)
    monkeypatch.setattr(cli, "_load_single_frame", lambda _path, _style: topo)
    holder = _install_fakes(monkeypatch)

    rc = cli.main(
        ["serve", str(traj), str(top), str(mesh), "--style", "spacefill", "--no-browser"]
    )

    assert rc == 0
    assert holder["open_browser"] is False
    scene = holder["scene"]
    assert isinstance(scene, _FakeScene)
    assert scene.calls == [
        ("trajectory", frames, True),
        ("source", "top.pdb", topo),
        ("mesh", "cavity.stl"),
        ("style", "spacefill"),
        ("wait",),
    ]
    out = capsys.readouterr().out
    assert "open this URL in a browser" in out
    assert "stacked top.pdb" in out
    assert "stacked mesh cavity.stl" in out


def test_serve_single_structure_is_a_pipeline_source(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    pdb = tmp_path / "mol.pdb"
    pdb.write_text("x", encoding="utf-8")
    frame = _frame_with_atoms(1)
    monkeypatch.setattr(cli, "_load_single_frame", lambda _path, _style: frame)
    holder = _install_fakes(monkeypatch)

    assert cli.main(["serve", str(pdb), "--no-browser"]) == 0
    scene = holder["scene"]
    assert isinstance(scene, _FakeScene)
    assert scene.calls[0] == ("trajectory", [frame], True)
    assert holder["open_browser"] is False


def test_serve_opens_the_browser_by_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    pdb = tmp_path / "mol.pdb"
    pdb.write_text("x", encoding="utf-8")
    monkeypatch.setattr(cli, "_load_single_frame", lambda _path, _style: _frame_with_atoms(1))
    holder = _install_fakes(monkeypatch)

    assert cli.main(["serve", str(pdb)]) == 0
    assert holder["open_browser"] is True
    assert "http://127.0.0.1:9/" in capsys.readouterr().out


def test_open_single_structure_still_draws(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    pdb = tmp_path / "mol.pdb"
    pdb.write_text("x", encoding="utf-8")
    frame = _frame_with_atoms(1)
    monkeypatch.setattr(cli, "_load_single_frame", lambda _path, _style: frame)
    holder = _install_fakes(monkeypatch)

    assert cli.main(["open", str(pdb), "--no-browser"]) == 0
    scene = holder["scene"]
    assert isinstance(scene, _FakeScene)
    assert scene.calls[0] == ("draw", frame)


def test_serve_missing_overlay_does_not_start_the_viewer(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    pdb = tmp_path / "mol.pdb"
    pdb.write_text("x", encoding="utf-8")
    started: list[object] = []
    monkeypatch.setattr(cli.mv, "Molvis", lambda **_kwargs: started.append(True))

    rc = cli.main(["serve", str(pdb), str(tmp_path / "missing.pdb"), "--no-browser"])
    assert rc == 1
    assert started == []


def test_serve_rejects_trajectory_overlay_before_opening(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    pdb = tmp_path / "top.pdb"
    dcd = tmp_path / "run.dcd"
    pdb.write_text("x", encoding="utf-8")
    dcd.write_bytes(b"x")
    monkeypatch.setattr(cli, "_load_single_frame", lambda _path, _style: _frame_with_atoms(1))
    started: list[object] = []
    monkeypatch.setattr(cli.mv, "Molvis", lambda **_kwargs: started.append(True))

    rc = cli.main(["serve", str(pdb), str(dcd), "--no-browser"])
    assert rc == 1
    assert started == []
    assert "owns the timeline" in capsys.readouterr().out


def test_serve_reports_a_composition_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    pdb = tmp_path / "top.pdb"
    data = tmp_path / "sys.data"
    pdb.write_text("x", encoding="utf-8")
    data.write_text("x", encoding="utf-8")
    monkeypatch.setattr(cli, "_load_single_frame", lambda _path, _style: _frame_with_atoms(1))
    holder = _install_fakes(monkeypatch)

    class Scene(_FakeScene):
        def __init__(self, name: str | None = None, transport: object = None) -> None:
            super().__init__(name, transport)
            holder["scene"] = self

        def add_data_source(
            self,
            frame: object,
            *,
            filename: str | None = None,
            wait: bool = True,
        ) -> None:
            raise cli.mv.MolvisRPCError(
                method="scene.add_data_source",
                code=-32602,
                message="file has 2 atom(s); existing system has 1",
            )

    monkeypatch.setattr(cli.mv, "Molvis", Scene)
    rc = cli.main(["serve", str(pdb), str(data), "--no-browser"])
    assert rc == 1
    scene = holder["scene"]
    assert isinstance(scene, _FakeScene)
    assert scene.calls[-1] == ("close",)
    assert "2 atom(s)" in capsys.readouterr().out
