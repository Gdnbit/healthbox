from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DOCKERFILE = REPOSITORY_ROOT / "docker" / "Dockerfile"


def test_public_image_installs_current_backend_requirements() -> None:
    dockerfile = PUBLIC_DOCKERFILE.read_text(encoding="utf-8")

    assert "COPY requirements.txt" in dockerfile
    assert "pip install -r requirements.txt" in dockerfile
    assert "COPY app/ ./app/" in dockerfile
    assert "python -m app.scripts.verify_local_parser_runtime --full" in dockerfile
    assert "python -m app.scripts.verify_local_parser_quality" in dockerfile
