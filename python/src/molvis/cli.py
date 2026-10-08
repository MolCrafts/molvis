"""``molvis`` command-line entry point.

Open a molecular structure file straight in the browser::

    molvis open structure.data            # LAMMPS data (atom_style 'full')
    molvis open protein.pdb --style spacefill
    molvis open run.lammpstrj             # trajectory → playable in the viewer
    molvis open growth.mrec               # molpy mrec trajectory store
    molvis open growth.mrec --every 10    # keep every 10th frame

``open`` reads the file with :mod:`molpy`, pushes it to a fresh
:class:`~molvis.Molvis` viewer (which starts a local server and opens the
default browser), then blocks until the page is closed or ``Ctrl+C``.

A ``.mrec`` store is a directory, not a file, and may be ragged — frames are
free to differ in atom count (a growing system stays a single trajectory).
Large stores are strided down automatically (``--every 0``, the default,
targets ≲600 frames).
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Sequence

import molpy as mp

import molvis as mv
from molvis.commands.drawing import STYLE as _STYLES

if TYPE_CHECKING:
    from molpy import Frame

__all__ = ["main"]

# Single-frame readers keyed by lowercased file extension.
_READERS: dict[str, Callable[[Path], "Frame"]] = {
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

# Trajectory formats → a molrs lazy reader exposing ``read_all()``.
_TRAJECTORY_READERS: dict[str, Callable[[Path], object]] = {
    ".lammpstrj": mp.io.read_lammps_dump_trajectory,
    ".dump": mp.io.read_lammps_dump_trajectory,
    ".xyz": mp.io.read_xyz_trajectory,
    ".extxyz": mp.io.read_xyz_trajectory,
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


def _load_single_frame(path: Path, atom_style: str) -> "Frame":
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


def _load_trajectory(path: Path) -> list["Frame"]:
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
    return list(reader.read_all())


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
) -> tuple[list["Frame"], list[int] | None, "Frame | None"]:
    """Read a molpy ``*.mrec`` trajectory store → ``(frames, steps)``.

    Frames may be ragged (per-frame atom counts differ — e.g. a chain-growth
    trajectory where atoms exist only once placed). ``every=0`` auto-strides
    a large store down to ≤ ``_MREC_TARGET_FRAMES`` frames; any positive value
    keeps every ``every``-th frame (the last frame is always kept).

    Dispatches on :func:`molpy.io.mrec.section_names`: a ``trajectory``
    group goes through :func:`molpy.io.read_mrec_trajectory` (so ``step``
    rides along); a snapshot ``frame`` group goes through
    :func:`molpy.io.read_mrec_frame`. :class:`~molpy.io.mrec.MrecReader` is
    the lazy one-frame cursor — this door needs ``step``, so the trajectory
    path stays eager.
    """
    from molpy.io.mrec import section_names

    secs = section_names(path)
    overlay: mp.Frame | None = None
    if "trajectory" in secs:
        traj = mp.io.read_mrec_trajectory(path)
        n = len(traj)
        if n == 0:
            raise ValueError(f"{path.name} holds no frames")
        indices = _mrec_stride_indices(n, every)
        frames = [traj[i] for i in indices]
        raw_step = getattr(traj, "step", None)
        steps = None if raw_step is None else [int(raw_step[i]) for i in indices]
        if "frame" in secs:
            overlay = mp.io.read_mrec_frame(path)
        return frames, steps, overlay
    if "frame" in secs:
        return [mp.io.read_mrec_frame(path)], None, None
    raise ValueError(
        f"{path.name} has no frame or trajectory section (sections: {sorted(secs)})"
    )


def _cmd_open(args: argparse.Namespace) -> int:
    """Handle ``molvis open <file>``."""
    path: Path = args.file.expanduser()
    is_stl = path.suffix.lower() == ".stl"
    is_mrec = _is_mrec_store(path)
    if is_mrec:
        if not path.is_dir():
            print(f"molvis: no such mrec store: {path}")
            return 1
    elif not path.is_file():
        print(f"molvis: no such file: {path}")
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
        print(f"molvis: {exc}")
        return 1
    except Exception as exc:  # noqa: BLE001 — surface any reader failure cleanly
        print(f"molvis: failed to read {path.name}: {exc}")
        return 1

    transport = mv.WebSocketTransport(open_browser=not args.no_browser)
    scene = mv.Molvis(name=args.name, transport=transport)

    # ``draw_frame`` / ``set_trajectory`` block until a page connects and
    # acks. With ``--no-browser`` nobody is auto-opened, so print the URL
    # first — otherwise the hint would never reach the user in time.
    if args.no_browser:
        try:
            scene.connection_url  # noqa: B018 — forces the server to start
            url = transport.page_endpoints(session=scene.name).standalone_url
            print(f"molvis: open this URL in a browser → {url}")
        except Exception:  # noqa: BLE001 — URL hint is best-effort
            print("molvis: server started; open the printed port in a browser")

    if is_stl:
        scene.add_mesh(path)
        print(f"molvis: loaded mesh from {path.name}")
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
        print(f"molvis: loaded {len(payload)} frame(s) from {path.name}")
    else:
        scene.draw_frame(payload)
        print(f"molvis: opened {path.name}")
    scene.set_style(style=args.style)

    print("molvis: viewer is live — press Ctrl+C to close")
    scene.wait()
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="molvis",
        description="Interactive molecular visualization from the terminal.",
    )
    sub = parser.add_subparsers(dest="command")

    open_p = sub.add_parser(
        "open",
        help="open a structure or trajectory file in the browser",
        description=(
            "Read a molecular file and display it in a MolVis browser tab. "
            f"Supported: {_supported_extensions()}"
        ),
    )
    open_p.add_argument("file", type=Path, help="path to the file to open")
    open_p.add_argument(
        "--style",
        choices=_STYLES,
        default="ball-and-stick",
        help="rendering style (default: ball-and-stick)",
    )
    open_p.add_argument(
        "--atom-style",
        default="full",
        help="LAMMPS atom_style for .data files (default: full)",
    )
    open_p.add_argument(
        "-t",
        "--trajectory",
        action="store_true",
        help="read the file as a trajectory (all frames)",
    )
    open_p.add_argument(
        "--every",
        type=int,
        default=0,
        help=(
            "for .mrec stores: keep every Nth frame; 0 (default) auto-strides "
            f"large stores down to ≤{_MREC_TARGET_FRAMES} frames"
        ),
    )
    open_p.add_argument(
        "--name",
        default=None,
        help="session name for the viewer (default: 'default')",
    )
    open_p.add_argument(
        "--no-browser",
        action="store_true",
        help="start the server but do not open a browser; print the URL",
    )
    open_p.set_defaults(func=_cmd_open)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Console-script entry point. Returns a process exit code."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    func = getattr(args, "func", None)
    if func is None:
        parser.print_help()
        return 1
    return func(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
