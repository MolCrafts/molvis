"""The CLI kernel is an IPython shell plus both viewer registries.

Two cells share ``user_ns``. ``mv.Stage(name=...)`` returns the same object
the registry already holds. The socket only carries source to ``run_cell``.
``sessions`` and ``close`` see Stage and Sketch. ``close`` does not guess.
"""

from __future__ import annotations

import json
import threading

import pytest
from IPython.core.interactiveshell import InteractiveShell
from molvis.cli import main
from molvis.kernel_pipe import KernelClient, KernelPipe, kernel_file
from molvis.scene import Molvis
from molvis.sketch import Sketch


class _Transport:
    def stop(self) -> None:
        return None

    def set_session_name(self, _session: str) -> None:
        return None


@pytest.fixture
def shell():
    InteractiveShell.clear_instance()
    created = InteractiveShell.instance()
    Molvis._scene_registry.clear()
    Sketch._registry.clear()
    yield created
    Molvis.close_all()
    Sketch.close_all()
    Molvis._scene_registry.clear()
    Sketch._registry.clear()
    InteractiveShell.clear_instance()


def test_two_cells_share_the_namespace_and_the_stage(shell) -> None:
    pipe = KernelPipe(shell)
    first = pipe.execute(
        "import molvis as mv\n"
        "mol = 'dopamine'\n"
        "stage = mv.Stage(name='kernel-dopamine')\n"
        "stage\n"
    )
    assert first["success"], first["error_in_exec"]
    assert first["result"] is not None

    second = pipe.execute(
        "mol == 'dopamine' and mv.Stage(name='kernel-dopamine') is stage"
    )
    assert second["success"], second["error_in_exec"]
    assert second["result"] == "True"


def test_a_failing_cell_leaves_the_shell_usable(shell) -> None:
    pipe = KernelPipe(shell)
    broken = pipe.execute("def (")
    assert broken["success"] is False
    assert broken["error_before_exec"]

    follow = pipe.execute("1 + 1")
    assert follow["success"] is True
    assert follow["result"] == "2"


def test_exec_without_a_kernel_exits_2(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("MOLVIS_KERNEL_FILE", str(tmp_path / "missing.json"))
    assert main(["exec", "1 + 1"]) == 2


def test_client_delivers_source_to_run_cell(shell, monkeypatch, tmp_path) -> None:
    path = tmp_path / "kernel.json"
    monkeypatch.setenv("MOLVIS_KERNEL_FILE", str(path))
    pipe = KernelPipe(shell)
    thread = threading.Thread(target=pipe.serve, args=(path,), daemon=True)
    thread.start()
    try:
        for _ in range(50):
            if path.is_file():
                break
            thread.join(0.05)
        assert path.is_file()
        assert kernel_file() == path

        client = KernelClient(path)
        bound = client.call({"op": "exec", "code": "answer = 6 * 7"})
        assert bound["success"] is True
        shown = client.call({"op": "exec", "code": "answer"})
        assert shown["success"] is True
        assert shown["result"] == "42"

        listed = client.call({"op": "sessions"})
        assert listed["success"] is True
        assert listed["result"] == {"stage": [], "sketch": []}
    finally:
        pipe.stop()
        thread.join(2)


def test_sessions_stamps_stage_and_reads_sketch(shell) -> None:
    pipe = KernelPipe(shell)
    Molvis(name="view", transport=_Transport(), gui=True, width=10, height=10)
    Sketch(name="board", transport=_Transport())
    reply = pipe.sessions()
    assert reply["success"] is True
    result = reply["result"]
    assert [row["name"] for row in result["stage"]] == ["view"]
    assert result["stage"][0]["surface"] == "stage"
    assert "surface" not in Molvis.session_summary()[0]
    assert result["sketch"][0]["surface"] == "sketch"
    assert result["sketch"][0]["name"] == "board"
    blob = json.dumps(result)
    assert "token" not in blob


def test_close_unique_name_returns_the_surface(shell) -> None:
    pipe = KernelPipe(shell)
    Molvis(name="view", transport=_Transport(), gui=True)
    Sketch(name="board", transport=_Transport())
    stage = pipe.handle({"op": "close", "name": "view"})
    assert stage["success"] is True
    assert stage["result"] == {"surface": "stage", "name": "view"}
    assert stage["error_in_exec"] is None
    assert Molvis.has_scene("view") is False
    assert Sketch.has("board") is True
    sketch = pipe.handle({"op": "close", "name": "board", "surface": None})
    assert sketch["result"] == {"surface": "sketch", "name": "board"}
    assert Sketch.has("board") is False
    assert not pipe._stop.is_set()


def test_close_collision_closes_neither(shell) -> None:
    pipe = KernelPipe(shell)
    Molvis(name="board", transport=_Transport(), gui=True)
    Sketch(name="board", transport=_Transport())
    reply = pipe.handle({"op": "close", "name": "board"})
    assert reply["success"] is False
    assert reply["error_in_exec"] is None
    assert reply["stderr"] == (
        "molvis: 'board' is both a stage and a sketch; "
        "pass --surface stage or --surface sketch\n"
    )
    assert Molvis.has_scene("board")
    assert Sketch.has("board")


def test_close_miss_names_both_registries(shell) -> None:
    pipe = KernelPipe(shell)
    Molvis(name="view", transport=_Transport(), gui=True)
    reply = pipe.handle({"op": "close", "name": "missing"})
    assert reply["success"] is False
    assert reply["error_in_exec"] is None
    assert reply["stderr"] == (
        "molvis: no stage or sketch named 'missing'\n"
        "stages: view\n"
        "sketches: (none)\n"
    )
    assert Molvis.has_scene("view")


def test_close_surface_is_strict(shell) -> None:
    pipe = KernelPipe(shell)
    Molvis(name="shared", transport=_Transport(), gui=True)
    Sketch(name="other", transport=_Transport())
    miss = pipe.handle({"op": "close", "name": "shared", "surface": "sketch"})
    assert miss["success"] is False
    assert miss["error_in_exec"] is None
    assert miss["stderr"] == (
        "molvis: no sketch named 'shared'\nsketches: other\n"
    )
    assert Molvis.has_scene("shared")
    assert Sketch.has("other")
    closed = pipe.handle({"op": "close", "name": "shared", "surface": "stage"})
    assert closed["result"] == {"surface": "stage", "name": "shared"}
    assert Molvis.has_scene("shared") is False
    assert Sketch.has("other")
    left = pipe.handle({"op": "close", "name": "other", "surface": "stage"})
    assert left["stderr"] == "molvis: no stage named 'other'\nstages: (none)\n"
    assert Sketch.has("other")
    gone = pipe.handle({"op": "close", "name": "other", "surface": "sketch"})
    assert gone["result"] == {"surface": "sketch", "name": "other"}
    assert Sketch.has("other") is False


def test_close_rejects_an_unknown_surface(shell) -> None:
    pipe = KernelPipe(shell)
    Sketch(name="board", transport=_Transport())
    reply = pipe.handle({"op": "close", "name": "board", "surface": "both"})
    assert reply["success"] is False
    assert reply["error_in_exec"] is None
    assert "stage, sketch, or omitted" in reply["stderr"]
    assert Sketch.has("board")


def test_close_cli_prints_the_surface(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    class _Client:
        def __init__(self, path: object = None) -> None:
            self.path = path

        def call(self, payload: dict[str, object]) -> dict[str, object]:
            assert payload["name"] == "board"
            assert payload["surface"] is None
            return {
                "op": "close",
                "success": True,
                "result": {"surface": "sketch", "name": "board"},
                "stdout": "",
                "stderr": "",
                "error_before_exec": None,
                "error_in_exec": None,
            }

    monkeypatch.setattr("molvis.kernel_pipe.KernelClient", _Client)
    assert main(["close", "--name", "board"]) == 0
    captured = capsys.readouterr()
    assert captured.out.strip() == "molvis: closed sketch board"
    assert "Traceback" not in captured.err


def test_close_cli_writes_collision_stderr(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    line = (
        "molvis: 'board' is both a stage and a sketch; "
        "pass --surface stage or --surface sketch\n"
    )

    class _Client:
        def __init__(self, path: object = None) -> None:
            self.path = path

        def call(self, payload: dict[str, object]) -> dict[str, object]:
            assert payload["surface"] == "sketch"
            return {
                "op": "close",
                "success": False,
                "result": None,
                "stdout": "",
                "stderr": line,
                "error_before_exec": None,
                "error_in_exec": None,
            }

    monkeypatch.setattr("molvis.kernel_pipe.KernelClient", _Client)
    assert main(["close", "--name", "board", "--surface", "sketch"]) == 1
    captured = capsys.readouterr()
    assert captured.err == line
    assert "Traceback" not in captured.err
    assert captured.out == ""


def test_close_cli_still_prints_a_real_traceback(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    class _Client:
        def __init__(self, path: object = None) -> None:
            self.path = path

        def call(self, _payload: dict[str, object]) -> dict[str, object]:
            return {
                "op": "close",
                "success": False,
                "result": None,
                "stdout": "",
                "stderr": "",
                "error_before_exec": None,
                "error_in_exec": "Traceback (most recent call last):\nBoom\n",
            }

    monkeypatch.setattr("molvis.kernel_pipe.KernelClient", _Client)
    assert main(["close", "--name", "board"]) == 1
    assert "Traceback" in capsys.readouterr().err


def test_sessions_cli_prints_the_object(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    class _Client:
        def __init__(self, path: object = None) -> None:
            self.path = path

        def call(self, payload: dict[str, object]) -> dict[str, object]:
            assert payload["op"] == "sessions"
            return {"success": True, "result": {"stage": [], "sketch": []}}

    monkeypatch.setattr("molvis.kernel_pipe.KernelClient", _Client)
    assert main(["sessions"]) == 0
    assert json.loads(capsys.readouterr().out) == {"stage": [], "sketch": []}


def test_sketch_is_not_a_subcommand() -> None:
    with pytest.raises(SystemExit) as caught:
        main(["sketch"])
    assert caught.value.code == 2


def test_close_surface_choice_is_argparse() -> None:
    with pytest.raises(SystemExit) as caught:
        main(["close", "--name", "board", "--surface", "both"])
    assert caught.value.code == 2
