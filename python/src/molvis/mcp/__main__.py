"""``python -m molvis.mcp`` — the same server as the ``molvis-mcp`` script.

Both entry points exist because a host launches this by command string, and
which one works depends on what is on its ``PATH``. ``molvis-mcp`` is the
short form; ``<venv>/bin/python -m molvis.mcp`` is the one that needs no
``PATH`` at all, which is what a host configured against a virtualenv wants.
"""

from __future__ import annotations

import sys

from .server import main

if __name__ == "__main__":  # pragma: no cover - process entry point
    sys.exit(main())
