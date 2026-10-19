"""Backup restore allowlists use directory ancestry, never a string prefix."""
from app.core.utils.security import SecurityValidator


def test_backup_path_rejects_prefix_sibling(tmp_path):
    allowed = tmp_path / "backups"
    sibling = tmp_path / "backups-other"
    allowed.mkdir()
    sibling.mkdir()
    safe = allowed / "synthetic.zip"
    unsafe = sibling / "synthetic.zip"
    safe.write_bytes(b"synthetic")
    unsafe.write_bytes(b"synthetic")
    assert SecurityValidator.validate_backup_path(safe, [allowed])
    assert not SecurityValidator.validate_backup_path(unsafe, [allowed])
