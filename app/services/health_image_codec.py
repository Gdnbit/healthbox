"""Optional image codec registration for retained health source files."""

from __future__ import annotations

from PIL import Image


def register_optional_heif_decoder() -> bool:
    """Register pillow-heif with Pillow when installed.

    The parser remains importable when the optional dependency is absent.  A
    false result is exposed by the readiness probe instead of failing startup.
    """

    try:
        from pillow_heif import register_heif_opener
    except (ImportError, OSError):
        return False

    try:
        register_heif_opener(thumbnails=False)
    except (OSError, RuntimeError):
        return False

    registered = {extension.lower() for extension in Image.registered_extensions()}
    return ".heic" in registered or ".heif" in registered
