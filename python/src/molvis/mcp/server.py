"""The MCP server molvis ships for itself.

MCP is the Model Context Protocol, the contract an agent host uses to call
tools. molvis owns this surface rather than an aggregator owning it, for the
reason the tools themselves are shaped the way they are: what an agent needs
from a viewer is not a command line but a session that stays alive, and only
the package that owns the viewer can keep one.

Seven tools, in two groups:

Read-only
    ``list_sessions`` — which sessions are live, and what their namespaces hold
    ``poll_events`` — frontend events after a cursor
    ``capabilities`` — what this scene can do, reflected off the live object

Session control
    ``open`` — start a scene and its persistent Python namespace
    ``close`` — tear one down
    ``exec`` — run Python in that namespace
    ``refresh`` — re-read edited packages from disk

There is deliberately no ``draw``, no ``show_smiles``, no command envelope:
domain work is written as ordinary molvis Python inside ``exec``, so a
capability added to :class:`~molvis.Molvis` needs no change here. This module
is only the wiring — every behaviour lives in :mod:`molvis.mcp.workbench` and
:mod:`molvis.mcp.reload`, which import no MCP machinery and are unit-tested
without a server.

FastMCP is an optional dependency (``pip install "molcrafts-molvis[mcp]"``),
so it is imported inside :func:`build_server` rather than at module scope:
importing :mod:`molvis.mcp` must not require it.

Registering this with a host is the host's job, not molvis's — either

.. code-block:: bash

    claude mcp add molvis -- molvis-mcp

or an ``mcpServers`` entry in a plugin manifest that ships alongside.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .reload import DEFAULT_PREFIXES, refresh_modules
from .workbench import DEFAULT_POLL_LIMIT, Workbench

if TYPE_CHECKING:  # pragma: no cover - typing only
    from fastmcp import FastMCP

#: Server name a host sees. Tools arrive namespaced by it on the client
#: side (``molvis``/``exec``), which is why no tool name repeats it.
SERVER_NAME = "molvis"

_READ_ONLY: dict[str, Any] = {"readOnlyHint": True, "openWorldHint": False}
_MUTATION: dict[str, Any] = {"readOnlyHint": False, "openWorldHint": False}
_DESTRUCTIVE: dict[str, Any] = {
    "readOnlyHint": False,
    "destructiveHint": True,
    "openWorldHint": False,
}


def build_server(workbench: Workbench | None = None) -> FastMCP:
    """Build the FastMCP server around one workbench.

    Parameters
    ----------
    workbench
        The session store to expose. Defaults to a fresh
        :class:`~molvis.mcp.workbench.Workbench` over real scenes; a test or
        an embedder passes one built on a fake scene factory.

    Returns
    -------
    fastmcp.FastMCP
        The server, with all seven tools registered and nothing started.

    Raises
    ------
    ModuleNotFoundError
        FastMCP is not installed. The message names the extra that installs
        it, because that is the caller's next move.
    """
    try:
        from fastmcp import FastMCP
        from fastmcp.exceptions import ToolError
    except ModuleNotFoundError as exc:  # pragma: no cover - import guard
        raise ModuleNotFoundError(
            "the molvis MCP server needs FastMCP. Install it with: "
            'pip install "molcrafts-molvis[mcp]"'
        ) from exc

    bench = workbench if workbench is not None else Workbench()
    mcp: FastMCP = FastMCP(SERVER_NAME)

    def _named(call: Any, *args: Any, **kwargs: Any) -> Any:
        """Run *call*, turning an unknown session into a client-visible error.

        :meth:`Workbench._require` already names the open sessions; carrying
        that sentence across the seam is the whole job, because a bare
        "error executing tool" would send the agent probing for a session
        list it was just handed.
        """
        try:
            return call(*args, **kwargs)
        except KeyError as exc:
            raise ToolError(str(exc).strip("'")) from exc

    @mcp.tool(annotations=_MUTATION)
    def open(
        session: str | None = None,
        gui: bool | None = None,
        width: int | None = None,
        height: int | None = None,
    ) -> dict[str, Any]:
        """Open a viewer session, or return the one that already has this name.

        The session holds a Python namespace that outlives the call: ``mv``
        is the scene, and anything bound here is still bound on the next
        ``exec``. Re-opening an existing name returns it untouched.

        Parameters
        ----------
        session
            Session name. Omit to mint one.
        gui, width, height
            Forwarded to the scene on creation; ignored (and reported as
            ``config_ignored``) when the session already exists.

        Returns
        -------
        dict
            ``session``, ``created``, ``connected``, ``connection_url``,
            ``info``. Open the ``connection_url`` in a browser to watch.
        """
        config = {
            key: value
            for key, value in (("gui", gui), ("width", width), ("height", height))
            if value is not None
        }
        return bench.open(session, **config)

    @mcp.tool(annotations=_DESTRUCTIVE)
    def close(session: str) -> dict[str, Any]:
        """Close a session: unsubscribe its events, drop its namespace, stop the scene.

        Parameters
        ----------
        session
            Session name.

        Returns
        -------
        dict
            ``session`` and ``closed``; ``closed`` is false for a name that
            was not open, which is reported rather than raised.
        """
        return bench.close(session)

    @mcp.tool(name="list_sessions", annotations=_READ_ONLY)
    def list_sessions() -> list[dict[str, Any]]:
        """List live sessions, oldest first.

        Returns
        -------
        list of dict
            Per session: ``session``, ``connected``, ``connection_url``,
            ``opened_at``, ``events`` (journal high-water mark) and
            ``names`` — what a previous turn left in the namespace.
        """
        return bench.list()

    @mcp.tool(name="exec", annotations=_MUTATION)
    def exec_python(session: str, code: str) -> dict[str, Any]:
        """Run Python in the session's namespace and report what it did.

        This is where domain work happens: ``mv.draw(...)``, molpy parsing,
        NumPy — whatever the installed packages actually expose. A trailing
        expression is evaluated, so ``mv.selection`` answers with a value.

        Parameters
        ----------
        session
            Session name; must be open.
        code
            Python source.

        Returns
        -------
        dict
            ``ok``, ``stdout``, ``result`` (``repr`` of a trailing
            expression) and ``error`` (a traceback, as text, on failure).
        """
        return _named(bench.run, session, code)

    @mcp.tool(annotations=_READ_ONLY)
    def capabilities(session: str) -> dict[str, Any]:
        """Report what this session's scene can do, reflected off the live object.

        Read this before writing ``exec`` code rather than recalling a method
        name: what comes back is the surface the installed build actually
        has.

        Parameters
        ----------
        session
            Session name; must be open.

        Returns
        -------
        dict
            ``molvis`` (version), ``info`` (identity and connection) and
            ``methods`` — name, signature and one-line summary each.
        """
        return _named(bench.describe, session)

    @mcp.tool(annotations=_MUTATION)
    def refresh(packages: list[str] | None = None) -> dict[str, Any]:
        """Re-read edited packages so the next ``exec`` runs the new code.

        Parameters
        ----------
        packages
            Top-level module names. Defaults to the molecular stack an agent
            edits between calls.

        Returns
        -------
        dict
            ``ok``, ``purged``, ``restart_required`` and ``refused``. When
            ``restart_required`` is non-empty a compiled extension is still
            mapped from the old build — restart this server before trusting
            a verdict about it.
        """
        prefixes = tuple(packages) if packages else DEFAULT_PREFIXES
        return refresh_modules(prefixes).as_dict()

    @mcp.tool(name="poll_events", annotations=_READ_ONLY)
    def poll_events(
        session: str,
        cursor: int | None = None,
        limit: int = DEFAULT_POLL_LIMIT,
    ) -> dict[str, Any]:
        """Read frontend events after *cursor*.

        Parameters
        ----------
        session
            Session name; must be open.
        cursor
            Sequence number already seen. Omit to start from the oldest
            retained event.
        limit
            Maximum events in this batch.

        Returns
        -------
        dict
            ``events``, ``cursor`` to pass back, ``pending``, and
            ``dropped`` — true when the journal had already discarded
            events this cursor asked for, so a gap is never silent.
        """
        return _named(bench.poll, session, cursor, limit)

    return mcp


def main(argv: list[str] | None = None) -> int:
    """Run the server on stdio — the ``molvis-mcp`` console script.

    Parameters
    ----------
    argv
        Arguments to read instead of ``sys.argv[1:]``. None are accepted
        today, and an unexpected one is reported rather than ignored — a
        server that silently swallowed a flag would look configured.

    Returns
    -------
    int
        Process exit status.
    """
    import sys

    argv = sys.argv[1:] if argv is None else argv
    if argv:
        print(
            f"molvis-mcp takes no arguments (got: {' '.join(argv)}). "
            "It speaks MCP on stdio; register it with your host, "
            "e.g. `claude mcp add molvis -- molvis-mcp`.",
            file=sys.stderr,
        )
        return 2
    build_server().run()
    return 0


__all__ = ["SERVER_NAME", "build_server", "main"]
