"""Public-API lock: THEME is tab10|ovito; classic is rejected."""

from molvis.commands.drawing import THEME
from molvis.scene import Molvis


def main() -> None:
    assert THEME == ("tab10", "ovito"), THEME
    assert Molvis.THEME == ("tab10", "ovito")
    # Construction may need a transport; catalog is on the class.
    try:
        # Avoid opening a live viewer: validate via the mixin method unbound.
        from molvis.commands.drawing import DrawingCommandsMixin

        class Dummy:
            THEME = THEME

            def send_cmd(self, *args, **kwargs):
                raise AssertionError("must not send for unknown theme")

        dummy = Dummy()
        try:
            DrawingCommandsMixin.set_theme(dummy, "classic")  # type: ignore[arg-type]
        except ValueError as exc:
            assert "unknown theme" in str(exc)
        else:
            raise AssertionError("classic must raise ValueError")
    except Exception:
        raise


if __name__ == "__main__":
    main()
    print("theme-tab10-ovito-06-python ok")
