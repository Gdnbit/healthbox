from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.http.static_files import setup_static_files


def test_nested_template_is_served_before_spa_fallback(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    templates_dir = tmp_path / "templates"
    templates_dir.mkdir()
    (tmp_path / "index.html").write_text("<html>synthetic SPA</html>", encoding="utf-8")
    template_path = templates_dir / "health-lab-import-template.csv"
    template_path.write_text("test_name,result_type,value\n", encoding="utf-8")
    monkeypatch.setenv("STATIC_DIR", str(tmp_path))

    app = FastAPI()
    setup_static_files(app)
    response = TestClient(app).get("/templates/health-lab-import-template.csv")

    assert response.status_code == 200
    assert response.headers["content-type"].split(";", 1)[0] in {
        "text/csv",
        "application/vnd.ms-excel",
    }
    assert response.content == template_path.read_bytes()


def test_unknown_nested_template_does_not_fall_back_to_spa(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "templates").mkdir()
    (tmp_path / "index.html").write_text("<html>synthetic SPA</html>", encoding="utf-8")
    monkeypatch.setenv("STATIC_DIR", str(tmp_path))

    app = FastAPI()
    setup_static_files(app)
    response = TestClient(app).get("/templates/missing.csv")

    assert response.status_code == 404
    assert "synthetic SPA" not in response.text
