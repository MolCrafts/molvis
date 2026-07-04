"""``molvis`` command-line entry point.

Open a molecular structure file straight in the browser::

    molvis open structure.data            # LAMMPS data (atom_style 'full')
    molvis open protein.pdb --style spacefill
    molvis open run.lammpstrj             # trajectory → playable in the viewer

``open`` reads the file with :mod:`molpy`, pushes it to a fresh
:class:`~molvis.Molvis` viewer (which starts a local server and opens the
default browser), then blocks until the page is closed or ``Ctrl+C``.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Sequence

import molpy as mp

import molvis as mv

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
    ".lammpstrj": mp.io.read_lammps_trajectory,
    ".dump": mp.io.read_lammps_trajectory,
    ".xyz": mp.io.read_xyz_trajectory,
    ".extxyz": mp.io.read_xyz_trajectory,
}

_STYLES = ("ball_and_stick", "spacefill", "wireframe")


def _supported_extensions() -> str:
    """Space-joined list of every extension ``open`` understands."""
    exts = {*_READERS, *_LAMMPS_DATA_EXT, *_TRAJECTORY_READERS}
    return " ".join(sorted(exts))


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
        supported = " ".join(sorted(_TRAJECTORY_READERS))
        raise ValueError(
            f"'{ext or path.name}' is not a recognised trajectory format. "
            f"trajectory formats: {supported}"
        )
    reader = reader_factory(path)
    return list(reader.read_all())


def _cmd_open(args: argparse.Namespace) -> int:
    """Handle ``molvis open <file>``."""
    path: Path = args.file.expanduser()
    if not path.is_file():
        print(f"molvis: no such file: {path}")
        return 1

    is_trajectory = args.trajectory or path.suffix.lower() in (
        ".lammpstrj",
        ".dump",
    )
    try:
        payload = (
            _load_trajectory(path)
            if is_trajectory
            else _load_single_frame(path, args.atom_style)
        )
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

    if is_trajectory:
        scene.set_trajectory(payload)
        print(f"molvis: loaded {len(payload)} frame(s) from {path.name}")
    else:
        scene.draw_frame(payload, style=args.style)
        print(f"molvis: opened {path.name}")

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
        default="ball_and_stick",
        help="rendering style (default: ball_and_stick)",
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
