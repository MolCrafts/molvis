"""molvis registers its `%%mv.demo` transformer with whatever shell is live."""

from __future__ import annotations

from types import SimpleNamespace

import molvis


def test_load_ipython_extension_registers_the_demo_transform():
    shell = SimpleNamespace(input_transformers_cleanup=[])

    molvis.load_ipython_extension(shell)

    assert molvis.demo_cell_transform in shell.input_transformers_cleanup


def test_load_ipython_extension_is_idempotent():
    shell = SimpleNamespace(input_transformers_cleanup=[])

    molvis.load_ipython_extension(shell)
    molvis.load_ipython_extension(shell)

    assert shell.input_transformers_cleanup.count(molvis.demo_cell_transform) == 1


def test_load_ipython_extension_tolerates_a_shell_without_transformers():
    # A stripped-down or future shell must not break `import molvis`.
    molvis.load_ipython_extension(SimpleNamespace())


def test_import_registers_with_a_live_shell():
    """`import molvis as mv` alone must enable %%mv.demo in a notebook."""
    from IPython.core.interactiveshell import InteractiveShell

    shell = InteractiveShell.instance()
    molvis._register_with_active_ipython()

    transformed = shell.transform_cell("%%mv.demo delay=0.5\nprint(1)\n")

    assert transformed.startswith("await ")
    assert "run_demo(" in transformed
