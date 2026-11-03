"""``molvis`` command-line entry point.

Open a molecular structure file straight in the browser::

    molvis stage structure.data           # LAMMPS data (atom_style 'full')
    molvis stage protein.pdb --style spacefill
    molvis open protein.pdb               # alias of ``molvis stage``; still works
    molvis stage run.lammpstrj            # trajectory → playable in the viewer
    molvis stage growth.mrec --every 10   # keep every 10th frame
    molvis stage protein.pdb --output shot.png

``stage`` (and its alias ``open``) reads the file with :mod:`molpy`, pushes
it to a fresh :class:`~molvis.Molvis` viewer, then blocks until the page is
closed or ``Ctrl+C``. ``--output`` writes one PNG and exits without opening
a tab.

A multi-step agent uses the same shell a notebook kernel uses. ``serve``
keeps an IPython shell alive; ``exec`` runs one cell in it via
``InteractiveShell.run_cell``. ``mv.Stage(name=...)`` is the 3D viewer and
``mv.Sketch(name=...)`` is the 2D board. ``sessions`` prints both
registries. ``close --name`` closes one viewer and does not guess when
the name is on both.

A ``.mrec`` store is a directory, not a file, and may be ragged — frames are
free to differ in atom count (a growing system stays a single trajectory).
Large stores are strided down automatically (``--every 0``, the default,
targets ≲600 frames).
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import TYPE_CHECKING

import molpy as mp

import molvis as mv
from molvis.commands.drawing import STYLE as _STYLES

if TYPE_CHECKING:
    from molpy import Frame

__all__ = ["main"]

# Single-frame readers keyed by lowercased file extension.
_READERS: dict[str, Callable[[Path], Frame]] = {
    ".pdb": mp.io.read_pdb,
    ".ent": mp.io.read_pdb,
    ".xyz": mp.io.read_xyz,
    ".extxyz": mp.io.read_xyz,
    ".gro": mp.io.read_gro,
    ".mol2": mp.io.read_mol2,
    ".xsf": mp.io.read_xsf,
}

# LAMMPS data carries no atom_style on disk, so it is dispatched separately
# with the caller-supplied ``--atom-style``.
_LAMMPS_DATA_EXT = frozenset({".data", ".lmp", ".lammps", ".lammpsdata"})

# Trajectory formats → an iterable molrs lazy reader.
_TRAJECTORY_READERS: dict[str, Callable[[Path], object]] = {
    ".lammpstrj": mp.io.lammps.LammpsDumpReader,
    ".dump": mp.io.lammps.LammpsDumpReader,
    ".xyz": mp.io.xyz.XyzReader,
    ".extxyz": mp.io.xyz.XyzReader,
}

# mrec trajectory stores are directories (``growth.mrec/``). Dispatched
# separately from the file readers above. (A packed ``*.mrec.zip`` archive
# needs molrs ``open_packed`` bound to Python; not wired yet.)
_MREC_DIR_SUFFIX = ".mrec"
_MREC_SUFFIXES = (_MREC_DIR_SUFFIX,)

# ``--every 0`` (auto) strides a large store down to at most this many frames.
_MREC_TARGET_FRAMES = 600

# Trajectories longer than this are streamed frame-by-frame (``append_frame``)
# instead of one ``set_trajectory`` message carrying every buffer at once.
# Governs every trajectory transport, not just mrec.
_TRAJECTORY_STREAM_THRESHOLD = 64


def _supported_extensions() -> str:
    """Space-joined list of every extension ``open`` understands."""
    exts = {*_READERS, *_LAMMPS_DATA_EXT, *_TRAJECTORY_READERS, *_MREC_SUFFIXES}
    return " ".join(sorted(exts))


def _is_mrec_store(path: Path) -> bool:
    """True when ``path`` names an mrec store directory (``*.mrec``)."""
    return path.name.lower().endswith(_MREC_DIR_SUFFIX)


def _load_single_frame(path: Path, atom_style: str) -> Frame:
    """Read ``path`` as a single static frame."""
    ext = path.suffix.lower()
    if ext in _LAMMPS_DATA_EXT:
        return mp.io.read_lammps_data(path, atom_style)
    reader = _READERS.get(ext)
    if reader is None:
        raise ValueError(
            f"unsupported file type '{ext or path.name}'. "
            f"supported: {_supported_extensions()}"
        )
    return reader(path)


def _load_trajectory(path: Path) -> list[Frame]:
    """Read ``path`` as a multi-frame trajectory."""
    ext = path.suffix.lower()
    reader_factory = _TRAJECTORY_READERS.get(ext)
    if reader_factory is None:
        supported = " ".join(sorted([*_TRAJECTORY_READERS, *_MREC_SUFFIXES]))
        raise ValueError(
            f"'{ext or path.name}' is not a recognised trajectory format. "
            f"trajectory formats: {supported}"
        )
    reader = reader_factory(path)
    return list(reader)


def _mrec_stride_indices(n: int, every: int) -> list[int]:
    """Frame indices for ``--every``; ``every<=0`` auto-caps at ``_MREC_TARGET_FRAMES``."""
    if n <= 0:
        return []
    stride = every if every > 0 else max(1, -(-n // _MREC_TARGET_FRAMES))
    indices = list(range(0, n, stride))
    if indices[-1] != n - 1:
        indices.append(n - 1)
    return indices


def _load_mrec_trajectory(
    path: Path, every: int = 0
) -> tuple[list[Frame], list[int] | None, Frame | None]:
    """Read a molpy ``*.mrec`` trajectory store → ``(frames, steps)``.

    Frames may be ragged (per-frame atom counts differ — e.g. a chain-growth
    trajectory where atoms exist only once placed). ``every=0`` auto-strides
    a large store down to ≤ ``_MREC_TARGET_FRAMES`` frames; any positive value
    keeps every ``every``-th frame (the last frame is always kept).

    MrecFile reads the record sections; MrecReader decodes only the selected
    trajectory frames and exposes their step labels.
    """
    record = mp.io.mrec.MrecFile(path)
    secs = record.sections()
    overlay: mp.Frame | None = None
    if "trajectory" in secs:
        traj = mp.io.mrec.MrecReader(path)
        n = len(traj)
        if n == 0:
            raise ValueError(f"{path.name} holds no frames")
        indices = _mrec_stride_indices(n, every)
        frames = [traj[i] for i in indices]
        raw_step = getattr(traj, "step", None)
        steps = None if raw_step is None else [int(raw_step[i]) for i in indices]
        if "frame" in secs:
            overlay = record.frame()
        return frames, steps, overlay
    if "frame" in secs:
        return [record.frame()], None, None
    raise ValueError(
        f"{path.name} has no frame or trajectory section (sections: {sorted(secs)})"
    )


def _png_output(value: str) -> str:
    """Argparse type: a ``.png`` path, or ``-`` for stdout."""
    if value != "-" and Path(value).suffix.lower() != ".png":
        raise argparse.ArgumentTypeError("stage --output accepts a .png path or -")
    return value


def _write_png(path: str, data: bytes) -> None:
    """Write snapshot bytes to a file, or to stdout when *path* is ``-``."""
    if path == "-":
        sys.stdout.buffer.write(data)
        return
    Path(path).expanduser().write_bytes(data)


def _cmd_open(args: argparse.Namespace) -> int:
    """Handle ``molvis stage <file>`` and the ``open`` alias."""
    output: str | None = getattr(args, "output", None)
    log = sys.stderr if output == "-" else sys.stdout
    path: Path = args.file.expanduser()
    is_stl = path.suffix.lower() == ".stl"
    is_mrec = _is_mrec_store(path)
    if is_mrec:
        if not path.is_dir():
            print(f"molvis: no such mrec store: {path}", file=log)
            return 1
    elif not path.is_file():
        print(f"molvis: no such file: {path}", file=log)
        return 1

    is_trajectory = (
        is_mrec
        or args.trajectory
        or path.suffix.lower()
        in (
            ".lammpstrj",
            ".dump",
        )
    )
    steps: list[int] | None = None
    overlay: object | None = None
    try:
        if is_stl:
            payload = None
        elif is_mrec:
            payload, steps, overlay = _load_mrec_trajectory(path, args.every)
        elif is_trajectory:
            payload = _load_trajectory(path)
        else:
            payload = _load_single_frame(path, args.atom_style)
    except ValueError as exc:
        print(f"molvis: {exc}", file=log)
        return 1
    except Exception as exc:  # noqa: BLE001 — surface any reader failure cleanly
        print(f"molvis: failed to read {path.name}: {exc}", file=log)
        return 1

    transport = mv.WebSocketTransport(
        open_browser=output is None and not args.no_browser
    )
    scene = mv.Molvis(name=args.name, transport=transport)

    # ``draw_frame`` / ``set_trajectory`` block until a page connects and
    # acks. With ``--no-browser`` nobody is auto-opened, so print the URL
    # first — otherwise the hint would never reach the user in time.
    if args.no_browser:
        try:
            scene.connection_url  # noqa: B018 — forces the server to start
            url = transport.page_endpoints(session=scene.name).standalone_url
            print(f"molvis: open this URL in a browser → {url}", file=log)
        except Exception:  # noqa: BLE001 — URL hint is best-effort
            print(
                "molvis: server started; open the printed port in a browser",
                file=log,
            )

    if is_stl:
        scene.add_mesh(path)
        print(f"molvis: loaded mesh from {path.name}", file=log)
    elif is_trajectory:
        if len(payload) > _TRAJECTORY_STREAM_THRESHOLD:
            # One set_trajectory message would carry every frame's buffers at
            # once; a long trajectory goes over as one blocking head frame
            # (which waits for the page to connect) plus a stream of appends.
            scene.set_trajectory(payload[:1], wait=True)
            for frame in payload[1:]:
                scene.append_frame(frame, follow=False)
        else:
            scene.set_trajectory(payload, wait=True)
        if overlay is not None:
            scene.add_data_source(overlay, filename=f"{path.name} (frame)")
        if steps is not None:
            scene.set_frame_labels({"step": steps})
        print(f"molvis: loaded {len(payload)} frame(s) from {path.name}", file=log)
    else:
        scene.draw_frame(payload)
        print(f"molvis: opened {path.name}", file=log)
    scene.set_style(style=args.style)

    if output is not None:
        _write_png(output, scene.snapshot())
        scene.close()
        return 0

    print("molvis: viewer is live — press Ctrl+C to close", file=log)
    scene.wait()
    return 0


def _print_cell(reply: dict[str, object]) -> int:
    """Print one kernel reply the way a notebook cell prints, and return an exit code."""
    stdout = reply.get("stdout") or ""
    stderr = reply.get("stderr") or ""
    if stdout:
        sys.stdout.write(str(stdout))
        if not str(stdout).endswith("\n"):
            sys.stdout.write("\n")
    result = reply.get("result")
    if result is not None:
        print(result)
    for label in ("error_before_exec", "error_in_exec"):
        text = reply.get(label)
        if text:
            sys.stderr.write(str(text))
            if not str(text).endswith("\n"):
                sys.stderr.write("\n")
    if stderr:
        sys.stderr.write(str(stderr))
        if not str(stderr).endswith("\n"):
            sys.stderr.write("\n")
    return 0 if reply.get("success") else 1


def _kernel_call(payload: dict[str, object]) -> int:
    """Send *payload* to the running kernel. Exit 2 when no kernel is listening."""
    from molvis.kernel_pipe import KernelClient, KernelUnavailable

    try:
        reply = KernelClient().call(payload)
    except KernelUnavailable as exc:
        print(f"molvis: {exc}", file=sys.stderr)
        return 2
    if payload.get("op") == "sessions":
        import json

        print(json.dumps(reply.get("result"), indent=2, ensure_ascii=False))
        return 0 if reply.get("success") else 1
    if payload.get("op") == "close":
        if reply.get("success"):
            result = reply.get("result")
            if isinstance(result, dict):
                print(f"molvis: closed {result.get('surface')} {result.get('name')}")
                return 0
        elif not reply.get("error_in_exec") and not reply.get("error_before_exec"):
            stderr = str(reply.get("stderr") or "")
            if stderr:
                sys.stderr.write(stderr)
                if not stderr.endswith("\n"):
                    sys.stderr.write("\n")
            return 1
    return _print_cell(reply)


def _cmd_serve(_args: argparse.Namespace) -> int:
    """Run an IPython shell and accept ``exec`` / ``sessions`` / ``close``."""
    from molvis.kernel_pipe import KernelPipe, kernel_file

    pipe = KernelPipe()
    path = kernel_file()
    print(f"molvis: kernel {path}", flush=True)
    print(
        "molvis: send a cell with `molvis exec`. Ctrl+C stops the kernel.", flush=True
    )
    try:
        pipe.serve(path)
    except KeyboardInterrupt:
        pipe.stop()
    return 0


def _cmd_exec(args: argparse.Namespace) -> int:
    """Run one cell in the kernel started by ``molvis serve``."""
    code = sys.stdin.read() if args.code == "-" else args.code
    return _kernel_call({"op": "exec", "code": code})


def _cmd_sessions(_args: argparse.Namespace) -> int:
    """Print both viewer registries from the kernel."""
    return _kernel_call({"op": "sessions"})


def _cmd_close(args: argparse.Namespace) -> int:
    """Close one viewer. ``surface`` is null when the flag is omitted."""
    return _kernel_call({"op": "close", "name": args.name, "surface": args.surface})


def _add_stage_arguments(parser: argparse.ArgumentParser) -> None:
    """Flags shared by ``molvis stage`` and the suppressed ``open`` alias."""
    parser.add_argument("file", type=Path, help="path to the file to open")
    parser.add_argument(
        "--style",
        choices=_STYLES,
        default="ball-and-stick",
        help="rendering style (default: ball-and-stick)",
    )
    parser.add_argument(
        "--atom-style",
        default="full",
        help="LAMMPS atom_style for .data files (default: full)",
    )
    parser.add_argument(
        "-t",
        "--trajectory",
        action="store_true",
        help="read the file as a trajectory (all frames)",
    )
    parser.add_argument(
        "--every",
        type=int,
        default=0,
        help=(
            "for .mrec stores: keep every Nth frame; 0 (default) auto-strides "
            f"large stores down to ≤{_MREC_TARGET_FRAMES} frames"
        ),
    )
    parser.add_argument(
        "--name",
        default=None,
        help="stage name passed to mv.Stage(name=...) (default: default)",
    )
    browser = parser.add_mutually_exclusive_group()
    browser.add_argument(
        "--no-browser",
        action="store_true",
        help="start the server but do not open a browser; print the URL",
    )
    browser.add_argument(
        "--output",
        type=_png_output,
        metavar="PATH",
        help="write a PNG and exit. PATH may be -. Not with --no-browser",
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="molvis",
        description=(
            "Interactive molecular visualization from the terminal. "
            "One kernel serves every viewer. "
            "`molvis stage` opens a 3D file; `molvis open` is the same command "
            "and still works."
        ),
    )
    sub = parser.add_subparsers(
        dest="command",
        metavar="{serve,exec,sessions,close,stage}",
    )

    stage_p = sub.add_parser(
        "stage",
        help="open a structure or trajectory in the 3D stage",
        description=(
            "Open a structure or trajectory in the 3D stage. With no --output, "
            "open the browser and block until the tab closes or Ctrl+C. With "
            "--output, write one PNG and exit without opening a tab. Reads the "
            "file with molpy and pushes it through the stage (draw_frame, "
            "set_trajectory, or add_mesh). "
            f"Supported: {_supported_extensions()}"
        ),
    )
    _add_stage_arguments(stage_p)
    stage_p.set_defaults(func=_cmd_open)

    open_p = sub.add_parser(
        "open",
        help=argparse.SUPPRESS,
        description=(
            "Open a structure or trajectory in the 3D stage. "
            "`open` is an alias of `molvis stage` and still works. "
            f"Supported: {_supported_extensions()}"
        ),
    )
    _add_stage_arguments(open_p)
    open_p.set_defaults(func=_cmd_open)

    serve_p = sub.add_parser(
        "serve",
        help="keep the notebook kernel alive for molvis exec",
        description=(
            "Run one IPython shell in this process. Cells arrive through "
            "`molvis exec` and run with InteractiveShell.run_cell. "
            "Construct a viewer in a cell with mv.Stage(name=...) or "
            "mv.Sketch(name=...), the same calls a notebook uses. "
            "One kernel serves both. This command does not open a board "
            "by itself. Ctrl+C stops the kernel."
        ),
    )
    serve_p.set_defaults(func=_cmd_serve)

    exec_p = sub.add_parser(
        "exec",
        help="run one notebook cell in the kernel",
        description=(
            "Send one cell to the kernel from `molvis serve`. "
            "One kernel holds every viewer. "
            "The cell runs with InteractiveShell.run_cell, so names "
            "bound here are still there on the next exec. "
            "A cell may bind a Stage, a Sketch, or both. "
            "A file one-shot is `molvis stage`; `molvis open` still works."
        ),
    )
    exec_p.add_argument(
        "code",
        help="Python source for one cell, or '-' to read the cell from stdin",
    )
    exec_p.set_defaults(func=_cmd_exec)

    sessions_p = sub.add_parser(
        "sessions",
        help="list viewers registered in the kernel",
        description=(
            "Print both registries from the running kernel as one JSON object "
            '{"stage": [...], "sketch": [...]}. Each sketch row includes '
            '"surface". Stage rows are Stage.session_summary() with '
            '"surface": "stage" added by the pipe. An empty registry is an '
            "empty array. The two name tables are not merged."
        ),
    )
    sessions_p.set_defaults(func=_cmd_sessions)

    close_p = sub.add_parser(
        "close",
        help="close one viewer in the kernel",
        description=(
            "Close one viewer in the running kernel. The kernel process keeps "
            "running. --name is required. When that name exists on exactly one "
            "of Stage or Sketch, that one is closed. When it exists on both, "
            "the command exits 1 and closes neither until --surface is set. "
            "--surface is strict: a miss is an error even if the other surface "
            "has the name. There is no fallback."
        ),
    )
    close_p.add_argument(
        "--name",
        required=True,
        help="viewer name passed to mv.Stage or mv.Sketch",
    )
    close_p.add_argument(
        "--surface",
        choices=("stage", "sketch"),
        default=None,
        help="which registry. Required only when the name is on both",
    )
    close_p.set_defaults(func=_cmd_close)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Console-script entry point. Returns a process exit code."""
    tokens = sys.argv[1:] if argv is None else list(argv)
    if tokens and tokens[0] == "open":
        print(
            "molvis: 'open' is an alias of 'molvis stage' and still works",
            file=sys.stderr,
        )
    parser = _build_parser()
    args = parser.parse_args(None if argv is None else tokens)
    func = getattr(args, "func", None)
    if func is None:
        parser.print_help()
        return 1
    return func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
