"""``molvis`` command-line entry point.

Open a molecular structure file straight in the browser::

    molvis open structure.data            # LAMMPS data (atom_style 'full')
    molvis open protein.pdb --style spacefill
    molvis open run.lammpstrj             # trajectory → playable in the viewer
    molvis open growth.mrec               # molpy mrec trajectory store
    molvis open growth.mrec --every 10    # keep every 10th frame

Stack topology (or a mesh) on a trajectory, then open the page::

    molvis serve run.dcd topology.pdb
    molvis serve traj.xtc conf.gro cavity.stl
    molvis serve system.data --no-browser

``open`` and ``serve`` read the file with :mod:`molpy`, push it to a fresh
:class:`~molvis.Molvis` viewer (which starts a local server and opens the
default browser), then block until the page is closed or ``Ctrl+C``.

``serve`` puts the first file on the timeline. Each later file is stacked
the way a drop onto a loaded scene is: a structure broadcasts as topology
(coordinates stay with the trajectory; identity and bonds come from the
overlay) and an STL is a mesh, not a data source. A second trajectory is
rejected — it has to be the first argument so it owns the timeline.

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

# Amber prmtop also returns a force field; the viewer only wants the frame.
# GROMACS ``.top`` / ``.itp`` are not listed: that reader keeps bond indices
# 1-based as written, and the scene addresses atoms 0-based.
_TOPOLOGY_READERS: dict[str, Callable[[Path], "Frame"]] = {
    ".prmtop": lambda path: mp.io.read_amber(path)[0],
    ".parm7": lambda path: mp.io.read_amber(path)[0],
}

# Trajectory formats → a molrs lazy reader exposing ``read_all()``.
_TRAJECTORY_READERS: dict[str, Callable[[Path], object]] = {
    ".lammpstrj": mp.io.read_lammps_trajectory,
    ".dump": mp.io.read_lammps_trajectory,
    ".lmptrj": mp.io.read_lammps_trajectory,
    ".lammpsdump": mp.io.read_lammps_trajectory,
    ".xyz": mp.io.read_xyz_trajectory,
    ".extxyz": mp.io.read_xyz_trajectory,
    ".dcd": mp.io.read_dcd_trajectory,
    ".xtc": mp.io.read_xtc_trajectory,
    ".trr": mp.io.read_trr_trajectory,
}

# These extensions are always a trajectory. ``serve`` rejects them after the
# first path: a second timeline cannot stack as topology.
_AUTO_TRAJECTORY_EXT = frozenset(
    {
        ".lammpstrj",
        ".dump",
        ".lmptrj",
        ".lammpsdump",
        ".dcd",
        ".xtc",
        ".trr",
    }
)

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
    """Space-joined list of every extension ``open`` / ``serve`` understands."""
    exts = {
        *_READERS,
        *_TOPOLOGY_READERS,
        *_LAMMPS_DATA_EXT,
        *_TRAJECTORY_READERS,
        *_MREC_SUFFIXES,
        ".stl",
    }
    return " ".join(sorted(exts))


def _is_mrec_store(path: Path) -> bool:
    """True when ``path`` names an mrec store directory (``*.mrec``)."""
    return path.name.lower().endswith(_MREC_DIR_SUFFIX)


def _load_single_frame(path: Path, atom_style: str) -> "Frame":
    """Read ``path`` as a single static frame."""
    ext = path.suffix.lower()
    if ext in _LAMMPS_DATA_EXT:
        # molpy returns the structure plus coeff text. The viewer wants the
        # Frame; leaving the wrapper here makes ``draw_frame`` reject it.
        loaded = mp.io.read_lammps_data(path, atom_style)
        frame = getattr(loaded, "frame", None)
        if isinstance(frame, mp.Frame):
            return frame
        if isinstance(loaded, mp.Frame):
            return loaded
        raise TypeError(
            f"read_lammps_data returned {type(loaded).__name__}, not a Frame"
        )
    reader = _READERS.get(ext) or _TOPOLOGY_READERS.get(ext)
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

    Dispatches on :func:`molrs.io.mrec.section_names`: a ``trajectory`` group
    goes through :func:`molrs.io.read_mrec_trajectory` (so ``step`` rides
    along); a snapshot ``frame`` group goes through
    :func:`molrs.io.read_mrec_frame`. :class:`molrs.io.mrec.MrecReader`
    is the lazy one-frame cursor — this door needs ``step``, so the
    trajectory path stays eager. Both already yield a Frame, so frames are
    used as read.
    """
    try:
        from molrs.io import read_mrec_frame, read_mrec_trajectory
        from molrs.io.mrec import section_names
    except ImportError as exc:
        raise ValueError(
            "opening .mrec stores needs molrs.io.read_mrec_frame / "
            f"read_mrec_trajectory / molrs.io.mrec.section_names ({exc})"
        ) from exc

    secs = section_names(path)
    overlay: mp.Frame | None = None
    if "trajectory" in secs:
        traj = read_mrec_trajectory(path)
        n = len(traj)
        if n == 0:
            raise ValueError(f"{path.name} holds no frames")
        indices = _mrec_stride_indices(n, every)
        frames = [traj[i] for i in indices]
        raw_step = getattr(traj, "step", None)
        steps = None if raw_step is None else [int(raw_step[i]) for i in indices]
        if "frame" in secs:
            overlay = read_mrec_frame(path)
        return frames, steps, overlay
    if "frame" in secs:
        return [read_mrec_frame(path)], None, None
    raise ValueError(
        f"{path.name} has no frame or trajectory section (sections: {sorted(secs)})"
    )


def _load_mrec_frame(path: Path) -> "Frame":
    """Read the static ``frame`` section of an mrec store (topology overlay)."""
    try:
        from molrs.io import read_mrec_frame
        from molrs.io.mrec import section_names
    except ImportError as exc:
        raise ValueError(
            "opening .mrec stores needs molrs.io.read_mrec_frame / "
            f"molrs.io.mrec.section_names ({exc})"
        ) from exc

    secs = section_names(path)
    if "frame" not in secs:
        raise ValueError(
            f"{path.name} has no frame section to stack "
            f"(sections: {sorted(secs)}). Pass a trajectory store first."
        )
    return read_mrec_frame(path)


def _load_overlay(path: Path, atom_style: str) -> tuple[str, object]:
    """Read one file stacked after the primary.

    Returns ``("mesh", path)`` for STL and ``("frame", frame)`` for a
    structure. Trajectory-only files are rejected: they own the timeline
    and have to be the first argument.
    """
    ext = path.suffix.lower()
    if ext == ".stl":
        return ("mesh", path)
    if ext in _AUTO_TRAJECTORY_EXT:
        raise ValueError(
            f"{path.name} is a trajectory. Pass it first so it owns the "
            "timeline, and put topology after it: "
            f"molvis serve {path.name} <topology>"
        )
    if _is_mrec_store(path):
        return ("frame", _load_mrec_frame(path))
    return ("frame", _load_single_frame(path, atom_style))


def _missing_path_message(path: Path) -> str | None:
    """``None`` when ``path`` exists in the shape its suffix implies."""
    if _is_mrec_store(path):
        if not path.is_dir():
            return f"no such mrec store: {path}"
        return None
    if not path.is_file():
        return f"no such file: {path}"
    return None


def _announce_url(
    scene: mv.Molvis,
    transport: mv.WebSocketTransport,
    *,
    no_browser: bool,
) -> None:
    """Start the server (which opens the browser unless asked not to) and print the URL.

    The following ``set_trajectory`` / ``draw_frame`` call blocks until the
    page connects, so the URL has to be on screen before that wait.
    """
    try:
        scene.connection_url  # noqa: B018 — forces the server to start
        url = transport.page_endpoints(session=scene.name).standalone_url
        if no_browser:
            print(f"molvis: open this URL in a browser → {url}")
        else:
            print(f"molvis: {url}")
    except Exception:  # noqa: BLE001 — URL hint is best-effort
        print("molvis: server started; open the printed port in a browser")


def _install_primary(
    scene: mv.Molvis,
    path: Path,
    *,
    is_stl: bool,
    is_trajectory: bool,
    payload: object,
    steps: list[int] | None,
    mrec_overlay: object | None,
    pipeline_single_frame: bool,
) -> None:
    """Push the first file. ``serve`` installs a single frame as a source."""
    if is_stl:
        scene.add_mesh(path)
        print(f"molvis: loaded mesh from {path.name}")
        return
    if is_trajectory:
        if not isinstance(payload, list):
            raise TypeError(f"trajectory payload must be a list, got {type(payload)!r}")
        frames = payload
        if len(frames) > _TRAJECTORY_STREAM_THRESHOLD:
            # One set_trajectory message would carry every frame's buffers at
            # once; a long trajectory goes over as one blocking head frame
            # (which waits for the page to connect) plus a stream of appends.
            scene.set_trajectory(frames[:1], wait=True)
            for frame in frames[1:]:
                scene.append_frame(frame, follow=False)
        else:
            scene.set_trajectory(frames, wait=True)
        if mrec_overlay is not None:
            scene.add_data_source(mrec_overlay, filename=f"{path.name} (frame)")
        if steps is not None:
            scene.set_frame_labels({"step": steps})
        print(f"molvis: loaded {len(frames)} frame(s) from {path.name}")
        return
    if pipeline_single_frame:
        # A pipeline source, not an edit-pool stamp, so later overlays
        # compose with it (topology broadcasts; coordinates stay here).
        scene.set_trajectory([payload], wait=True)
    else:
        scene.draw_frame(payload)
    print(f"molvis: opened {path.name}")


def _run_viewer(
    args: argparse.Namespace,
    overlays: Sequence[Path],
    *,
    pipeline_single_frame: bool,
    announce_url: bool,
) -> int:
    """Load ``args.file`` plus ``overlays``, open the page, block until close."""
    path = args.file.expanduser()
    overlay_paths = [item.expanduser() for item in overlays]
    for candidate in (path, *overlay_paths):
        message = _missing_path_message(candidate)
        if message is not None:
            print(f"molvis: {message}")
            return 1

    is_stl = path.suffix.lower() == ".stl"
    is_mrec = _is_mrec_store(path)
    is_trajectory = (
        is_mrec or args.trajectory or path.suffix.lower() in _AUTO_TRAJECTORY_EXT
    )
    steps: list[int] | None = None
    mrec_overlay: object | None = None
    loaded_overlays: list[tuple[str, object, str]] = []
    reading = path
    try:
        if is_stl:
            payload: object = None
        elif is_mrec:
            payload, steps, mrec_overlay = _load_mrec_trajectory(path, args.every)
        elif is_trajectory:
            payload = _load_trajectory(path)
        else:
            payload = _load_single_frame(path, args.atom_style)
        for overlay_path in overlay_paths:
            reading = overlay_path
            kind, overlay_payload = _load_overlay(overlay_path, args.atom_style)
            loaded_overlays.append((kind, overlay_payload, overlay_path.name))
    except ValueError as exc:
        print(f"molvis: {exc}")
        return 1
    except Exception as exc:  # noqa: BLE001 — surface any reader failure cleanly
        print(f"molvis: failed to read {reading.name}: {exc}")
        return 1

    transport = mv.WebSocketTransport(open_browser=not args.no_browser)
    scene = mv.Molvis(name=args.name, transport=transport)
    # ``--no-browser`` has nobody to auto-open, so the URL must be printed
    # before the push blocks on the handshake. ``serve`` always prints it.
    if announce_url or args.no_browser:
        _announce_url(scene, transport, no_browser=args.no_browser)

    try:
        _install_primary(
            scene,
            path,
            is_stl=is_stl,
            is_trajectory=is_trajectory,
            payload=payload,
            steps=steps,
            mrec_overlay=mrec_overlay,
            pipeline_single_frame=pipeline_single_frame,
        )
        for kind, overlay_payload, filename in loaded_overlays:
            if kind == "mesh":
                if not isinstance(overlay_payload, Path):
                    raise TypeError(
                        f"mesh overlay must be a path, got {type(overlay_payload)!r}"
                    )
                scene.add_mesh(overlay_payload)
                print(f"molvis: stacked mesh {filename}")
            else:
                scene.add_data_source(overlay_payload, filename=filename)
                print(f"molvis: stacked {filename}")
        scene.set_style(style=args.style)
    except mv.MolvisRPCError as exc:
        print(f"molvis: {exc}")
        scene.close()
        return 1

    print("molvis: viewer is live — press Ctrl+C to close")
    scene.wait()
    return 0


def _cmd_open(args: argparse.Namespace) -> int:
    """Handle ``molvis open <file>``."""
    return _run_viewer(
        args, (), pipeline_single_frame=False, announce_url=False
    )


def _cmd_serve(args: argparse.Namespace) -> int:
    """Handle ``molvis serve <file> [overlay ...]``."""
    return _run_viewer(
        args,
        tuple(args.overlays),
        pipeline_single_frame=True,
        announce_url=True,
    )


def _add_viewer_flags(parser: argparse.ArgumentParser) -> None:
    """Flags shared by ``open`` and ``serve``."""
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
        help="session name for the viewer (default: 'default')",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="start the server but do not open a browser; print the URL",
    )


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
    _add_viewer_flags(open_p)
    open_p.set_defaults(func=_cmd_open)

    serve_p = sub.add_parser(
        "serve",
        help="open a file plus topology overlays in the browser",
        description=(
            "Read the first file onto the timeline, stack each later file "
            "as topology (or an STL mesh), start the local page, and open "
            "it in the browser. A trajectory owns the timeline, so it has "
            "to be the first argument. "
            f"Supported: {_supported_extensions()}"
        ),
    )
    serve_p.add_argument(
        "file",
        type=Path,
        help="structure or trajectory that owns the timeline",
    )
    serve_p.add_argument(
        "overlays",
        nargs="*",
        type=Path,
        metavar="overlay",
        help=(
            "topology or mesh stacked on the first file "
            "(PDB, LAMMPS data, prmtop, GRO, STL, …)"
        ),
    )
    _add_viewer_flags(serve_p)
    serve_p.set_defaults(func=_cmd_serve)

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
