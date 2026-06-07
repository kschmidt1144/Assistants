import main


def test_routes_registered():
    paths = {getattr(r, "path", "") for r in main.app.routes}
    assert "/ws/live" in paths
    assert "/api/analyze" in paths
    assert "/api/ocr" in paths
    assert "/health" in paths
