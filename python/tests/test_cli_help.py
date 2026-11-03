"""Help text and one-shot output for ``molvis stage`` / ``molvis open``."""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from molvis import cli
from molvis.control import ControlMixin


def _help(argv: list[str]) -> tuple[str, str]:
    stdout = io.StringIO()
    stderr = io.StringIO()
    with pytest.raises(SystemExit) as caught, pytest.MonkeyPatch.context() as patch:
        patch.setattr("sys.stdout", stdout)
        patch.setattr("sys.stderr", stderr)
        cli.main(argv)
    assert caught.value.code == 0
    return stdout.getvalue(), stderr.getvalue()


def test_top_level_help_names_stage_and_one_kernel() -> None:
    out, err = _help(["--help"])
    text = out + err
    assert "stage" in text
    assert "one kernel" in text.lower() or "One kernel" in text
    assert "mv.Sketch" not in text
    assert "smiles" not in text
    assert "place-bond" not in text
    assert "sketch-draw" not in text
    assert "{serve,exec,sessions,close,stage}" in text
    assert "sketch" not in text.split("commands:")[-1]


def test_open_help_is_an_alias_and_exits_0(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as caught:
        cli.main(["open", "--help"])
    assert caught.value.code == 0
    captured = capsys.readouterr()
    assert "molvis: 'open' is an alias of 'molvis stage' and still works" in captured.err
    assert "still works" in captured.out
    assert "--output" in captured.out
    assert "--smiles" not in captured.out
    assert "--no-gui" not in captured.out


def _flat(text: str) -> str:
    return " ".join(text.split())


def test_serve_help_names_both_viewers() -> None:
    out, err = _help(["serve", "--help"])
    text = _flat(out + err)
    assert "mv.Stage" in text
    assert "mv.Sketch" in text
    assert "One kernel serves both" in text


def test_sessions_and_close_help_name_both_registries() -> None:
    sessions, _ = _help(["sessions", "--help"])
    assert '{"stage"' in _flat(sessions)
    assert "sketch" in sessions
    close = _flat(_help(["close", "--help"])[0])
    assert "--surface" in close
    assert "{stage,sketch}" in close
    assert "closes neither" in close
    assert "mv.Sketch" in close


def test_exec_help_allows_a_stage_and_a_sketch() -> None:
    out, _ = _help(["exec", "--help"])
    assert "Sketch" in out
    assert "Stage" in out


def test_stage_help_lists_output_and_omits_sketch_flags(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as caught:
        cli.main(["stage", "--help"])
    assert caught.value.code == 0
    captured = capsys.readouterr()
    assert captured.err == ""
    text = captured.out
    assert "--output" in text
    assert "--style" in text
    assert "--trajectory" in text
    assert "--smiles" not in text
    assert "--no-gui" not in text
    assert ".stl" not in text


def test_output_rejects_a_non_png_suffix() -> None:
    with pytest.raises(SystemExit) as caught:
        cli.main(["stage", "protein.pdb", "--output", "shot.jpg"])
    assert caught.value.code == 2


def test_output_and_no_browser_are_a_usage_error() -> None:
    with pytest.raises(SystemExit) as caught:
        cli.main(["stage", "protein.pdb", "--output", "shot.png", "--no-browser"])
    assert caught.value.code == 2


class _Scene:
    def __init__(self) -> None:
        self.waited = False
        self.closed = False
        self.frames: list[object] = []

    def draw_frame(self, payload: object) -> None:
        self.frames.append(payload)

    def set_style(self, style: str | None = None, **_kwargs: object) -> None:
        self.style = style

    def snapshot(self) -> bytes:
        return b"\x89PNG-test"

    def close(self) -> None:
        self.closed = True

    def wait(self) -> None:
        self.waited = True


class _Transport:
    def __init__(self, *, open_browser: bool = True) -> None:
        self.open_browser = open_browser


def test_output_png_snapshots_and_does_not_wait(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    pdb = tmp_path / "protein.pdb"
    pdb.write_text("ATOM")
    shot = tmp_path / "shot.png"
    scene = _Scene()
    created: list[_Transport] = []

    def transport(*, open_browser: bool = True) -> _Transport:
        item = _Transport(open_browser=open_browser)
        created.append(item)
        return item

    monkeypatch.setattr(cli, "_load_single_frame", lambda _path, _style: {"ok": True})
    monkeypatch.setattr(cli.mv, "WebSocketTransport", transport)
    monkeypatch.setattr(cli.mv, "Molvis", lambda **_kwargs: scene)

    code = cli.main(["stage", str(pdb), "--output", str(shot)])
    captured = capsys.readouterr()

    assert code == 0
    assert captured.err == ""
    assert created[0].open_browser is False
    assert scene.closed is True
    assert scene.waited is False
    assert shot.read_bytes() == b"\x89PNG-test"


def test_open_alias_follows_stage_and_prints_the_alias(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    pdb = tmp_path / "protein.pdb"
    pdb.write_text("ATOM")
    shot = tmp_path / "shot.png"
    scene = _Scene()
    monkeypatch.setattr(cli, "_load_single_frame", lambda _path, _style: {"ok": True})
    monkeypatch.setattr(cli.mv, "WebSocketTransport", lambda **_kwargs: _Transport())
    monkeypatch.setattr(cli.mv, "Molvis", lambda **_kwargs: scene)

    code = cli.main(["open", str(pdb), "--output", str(shot)])
    captured = capsys.readouterr()

    assert code == 0
    assert "alias of 'molvis stage'" in captured.err
    assert scene.closed is True
    assert scene.waited is False


def test_output_dash_writes_png_bytes_to_stdout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pdb = tmp_path / "protein.pdb"
    pdb.write_text("ATOM")
    scene = _Scene()

    class _Stdout:
        def __init__(self) -> None:
            self.buffer = io.BytesIO()

        def write(self, text: str) -> int:
            return len(text)

        def flush(self) -> None:
            return None

    stdout = _Stdout()
    monkeypatch.setattr(cli, "_load_single_frame", lambda _path, _style: {"ok": True})
    monkeypatch.setattr(cli.mv, "WebSocketTransport", lambda **_kwargs: _Transport())
    monkeypatch.setattr(cli.mv, "Molvis", lambda **_kwargs: scene)
    monkeypatch.setattr(cli.sys, "stdout", stdout)

    code = cli.main(["stage", str(pdb), "--output", "-"])

    assert code == 0
    assert stdout.buffer.getvalue() == b"\x89PNG-test"
    assert scene.waited is False


class _Host(ControlMixin):
    def __init__(self) -> None:
        self.calls: list[str] = []

    def send_cmd(self, method: str, _params: object, **_kwargs: object) -> dict[str, object]:
        self.calls.append(method)
        return {}


def test_stage_fit_returns_the_main_camera() -> None:
    host = _Host()
    camera = host.fit()
    assert camera is host.camera
    assert host.calls == ["camera.fit"]
    again = host.fit()
    assert again is camera
    assert host.calls == ["camera.fit", "camera.fit"]
