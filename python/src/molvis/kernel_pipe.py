"""Carry one notebook cell into the process that owns the viewer.

A notebook kernel is an IPython ``user_ns`` plus the viewer registries
already on :class:`~molvis.scene.Molvis` and :class:`~molvis.sketch.Sketch`.
``molvis serve`` keeps that shell alive. ``molvis exec`` delivers source to
``InteractiveShell.run_cell`` — the same call a notebook cell uses. Nothing
here is a second session table, event journal, or executor. ``sessions``
reads both registries. ``close`` closes one viewer and does not guess when
the name is on both.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import socket
import threading
import traceback
from pathlib import Path
from typing import Any

logger = logging.getLogger("molvis")

__all__ = [
    "KernelClient",
    "KernelPipe",
    "KernelUnavailable",
    "kernel_file",
]

_HOST = "127.0.0.1"
_BUFFER = 8 * 1024 * 1024


class KernelUnavailable(RuntimeError):
    """No live kernel is listening. Callers map this to exit code 2."""


def kernel_file() -> Path:
    """Path of the address file. ``MOLVIS_KERNEL_FILE`` overrides it.

    The file holds host, port, and token. It does not hold molecules or
    Stage objects; those live in the kernel process.
    """
    override = os.environ.get("MOLVIS_KERNEL_FILE")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".molvis" / "kernel.json"


def _close_ok(surface: str, name: str) -> dict[str, Any]:
    return {
        "op": "close",
        "success": True,
        "result": {"surface": surface, "name": name},
        "stdout": "",
        "stderr": "",
        "error_before_exec": None,
        "error_in_exec": None,
    }


def _close_fail(stderr: str) -> dict[str, Any]:
    if not stderr.endswith("\n"):
        stderr += "\n"
    return {
        "op": "close",
        "success": False,
        "result": None,
        "stdout": "",
        "stderr": stderr,
        "error_before_exec": None,
        "error_in_exec": None,
    }


def _format_names(names: list[str]) -> str:
    ordered = sorted(names)
    return ", ".join(ordered) if ordered else "(none)"


def _miss_both(name: str) -> str:
    import molvis as mv

    return (
        f"molvis: no stage or sketch named {name!r}\n"
        f"stages: {_format_names(mv.Stage.list_scenes())}\n"
        f"sketches: {_format_names(mv.Sketch.list())}\n"
    )


def _miss_one(surface: str, name: str, names: list[str]) -> str:
    plural = "stages" if surface == "stage" else "sketches"
    return (
        f"molvis: no {surface} named {name!r}\n"
        f"{plural}: {_format_names(names)}\n"
    )


def _exc_text(err: object) -> str | None:
    """Render an IPython ``error_in_exec`` / ``error_before_exec`` value."""
    if err is None:
        return None
    if isinstance(err, BaseException):
        return "".join(traceback.format_exception(type(err), err, err.__traceback__))
    if (
        isinstance(err, tuple)
        and len(err) == 3
        and isinstance(err[0], type)
        and issubclass(err[0], BaseException)
    ):
        return "".join(traceback.format_exception(err[0], err[1], err[2]))
    return str(err)


class KernelPipe:
    """The kernel side of the pipe. Holds the IPython shell and nothing else."""

    def __init__(self, shell: Any | None = None) -> None:
        if shell is None:
            from IPython.core.interactiveshell import InteractiveShell

            shell = InteractiveShell.instance()
        self.shell = shell
        self._stop = threading.Event()
        self._server: socket.socket | None = None

    def execute(self, code: str) -> dict[str, Any]:
        """Run *code* with :meth:`InteractiveShell.run_cell` and return its result.

        stdout and stderr come from IPython's own ``capture_output``. The
        other fields are :class:`~IPython.core.interactiveshell.ExecutionResult`.
        """
        from IPython.utils.capture import capture_output

        with capture_output() as captured:
            result = self.shell.run_cell(code, store_history=False)
        value = result.result
        return {
            "op": "exec",
            "success": bool(result.success),
            "stdout": captured.stdout,
            "stderr": captured.stderr,
            "result": None if value is None else repr(value),
            "error_before_exec": _exc_text(result.error_before_exec),
            "error_in_exec": _exc_text(result.error_in_exec),
        }

    def sessions(self) -> dict[str, Any]:
        """Return both registries. Stage rows gain ``surface`` here only."""
        import molvis as mv

        stages = [
            {**row, "surface": "stage"} for row in mv.Stage.session_summary()
        ]
        return {
            "op": "sessions",
            "success": True,
            "result": {"stage": stages, "sketch": mv.Sketch.session_summary()},
            "stdout": "",
            "stderr": "",
            "error_before_exec": None,
            "error_in_exec": None,
        }

    def close_named(self, name: str, surface: str | None = None) -> dict[str, Any]:
        """Close one viewer. A name on both surfaces closes neither."""
        import molvis as mv

        if surface not in (None, "stage", "sketch"):
            return _close_fail("molvis: surface must be stage, sketch, or omitted\n")
        try:
            if surface is None:
                stage_hit = mv.Stage.has_scene(name)
                sketch_hit = mv.Sketch.has(name)
                if stage_hit and sketch_hit:
                    return _close_fail(
                        f"molvis: {name!r} is both a stage and a sketch; "
                        "pass --surface stage or --surface sketch\n"
                    )
                if stage_hit:
                    mv.Stage.get_scene(name).close()
                    return _close_ok("stage", name)
                if sketch_hit:
                    mv.Sketch.get(name).close()
                    return _close_ok("sketch", name)
                return _close_fail(_miss_both(name))
            if surface == "stage":
                if not mv.Stage.has_scene(name):
                    return _close_fail(_miss_one("stage", name, mv.Stage.list_scenes()))
                mv.Stage.get_scene(name).close()
                return _close_ok("stage", name)
            if not mv.Sketch.has(name):
                return _close_fail(_miss_one("sketch", name, mv.Sketch.list()))
            mv.Sketch.get(name).close()
            return _close_ok("sketch", name)
        except Exception as exc:
            logger.debug("Kernel close request failed", exc_info=True)
            return {
                "op": "close",
                "success": False,
                "result": None,
                "stdout": "",
                "stderr": "",
                "error_before_exec": None,
                "error_in_exec": _exc_text(exc),
            }

    def handle(self, request: dict[str, Any]) -> dict[str, Any]:
        """Dispatch one client request. Unknown ops are reported, not executed."""
        op = request.get("op")
        if op == "exec":
            return self.execute(str(request.get("code", "")))
        if op == "sessions":
            return self.sessions()
        if op == "close":
            surface = request.get("surface")
            return self.close_named(
                str(request.get("name", "")),
                None if surface is None else str(surface),
            )
        return {
            "op": op,
            "success": False,
            "result": None,
            "stdout": "",
            "stderr": "",
            "error_before_exec": None,
            "error_in_exec": f"unknown op: {op!r}",
        }

    def serve(self, path: Path | None = None) -> None:
        """Listen on localhost and write the address file. Blocks until :meth:`stop`."""
        import secrets

        address = path or kernel_file()
        token = secrets.token_urlsafe(24)
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((_HOST, 0))
        sock.listen(5)
        sock.settimeout(0.5)
        self._server = sock
        port = sock.getsockname()[1]
        _write_address(address, {"host": _HOST, "port": port, "token": token})
        try:
            while not self._stop.is_set():
                try:
                    conn, _peer = sock.accept()
                except TimeoutError:
                    continue
                except OSError:
                    if self._stop.is_set():
                        break
                    raise
                try:
                    try:
                        reply = self._respond(conn, token)
                    except Exception as exc:
                        logger.debug("Kernel request failed", exc_info=True)
                        reply = {
                            "op": None,
                            "success": False,
                            "result": None,
                            "stdout": "",
                            "stderr": "",
                            "error_before_exec": None,
                            "error_in_exec": _exc_text(exc),
                        }
                    _reply(conn, reply)
                finally:
                    conn.close()
        finally:
            sock.close()
            self._server = None
            _unlink_if_token(address, token)

    def stop(self) -> None:
        """Ask :meth:`serve` to return and close its socket."""
        self._stop.set()
        server = self._server
        if server is not None:
            try:
                server.close()
            except OSError:
                pass

    def _respond(self, conn: socket.socket, token: str) -> dict[str, Any]:
        raw = _read_message(conn)
        try:
            request = json.loads(raw)
        except json.JSONDecodeError as exc:
            return {
                "op": None,
                "success": False,
                "result": None,
                "stdout": "",
                "stderr": "",
                "error_before_exec": _exc_text(exc),
                "error_in_exec": None,
            }
        if not isinstance(request, dict):
            return {
                "op": None,
                "success": False,
                "result": None,
                "stdout": "",
                "stderr": "",
                "error_before_exec": None,
                "error_in_exec": "request must be a JSON object",
            }
        given = str(request.get("token", ""))
        if not hmac.compare_digest(given, token):
            return {
                "op": request.get("op"),
                "success": False,
                "result": None,
                "stdout": "",
                "stderr": "",
                "error_before_exec": None,
                "error_in_exec": "bad token",
            }
        return self.handle(request)


class KernelClient:
    """One request to a running :class:`KernelPipe`."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or kernel_file()

    def call(self, payload: dict[str, Any], *, timeout: float = 300.0) -> dict[str, Any]:
        """Send *payload* and return the kernel's JSON object.

        Raises:
            KernelUnavailable: The address file is missing or nothing is listening.
        """
        if not self.path.is_file():
            raise KernelUnavailable(f"no kernel at {self.path}; run molvis serve")
        try:
            info = json.loads(self.path.read_text(encoding="utf-8"))
            host = str(info["host"])
            port = int(info["port"])
            token = str(info["token"])
        except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            raise KernelUnavailable(f"unreadable kernel file {self.path}: {exc}") from exc
        message = dict(payload)
        message["token"] = token
        try:
            with socket.create_connection((host, port), timeout=timeout) as conn:
                _write_message(conn, message)
                raw = _read_message(conn)
        except (ConnectionRefusedError, TimeoutError, OSError) as exc:
            raise KernelUnavailable(
                f"kernel at {host}:{port} is not reachable; run molvis serve"
            ) from exc
        try:
            reply = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise KernelUnavailable(f"kernel reply was not JSON: {exc}") from exc
        if not isinstance(reply, dict):
            raise KernelUnavailable("kernel reply was not a JSON object")
        return reply


def _write_address(path: Path, info: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(info).encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, payload)
    finally:
        os.close(fd)


def _unlink_if_token(path: Path, token: str) -> None:
    """Remove the address file only when it still names this kernel."""
    try:
        info = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if isinstance(info, dict) and info.get("token") == token:
        try:
            path.unlink()
        except OSError:
            pass


def _write_message(conn: socket.socket, payload: dict[str, Any]) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") + b"\n"
    conn.sendall(data)


def _reply(conn: socket.socket, payload: dict[str, Any]) -> None:
    try:
        _write_message(conn, payload)
    except OSError:
        return


def _read_message(conn: socket.socket) -> str:
    chunks: list[bytes] = []
    total = 0
    while total <= _BUFFER:
        block = conn.recv(65536)
        if not block:
            break
        chunks.append(block)
        total += len(block)
        if b"\n" in block:
            break
    raw = b"".join(chunks)
    if len(raw) > _BUFFER:
        raise KernelUnavailable("kernel message exceeds 8 MiB")
    line, _sep, _rest = raw.partition(b"\n")
    return line.decode("utf-8")
