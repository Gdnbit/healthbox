def test_health_ai_idempotency_headers_are_allowed_and_exposed(client):
    origin = "http://localhost:3000"
    preflight = client.options(
        "/api/v1/health-ai/subjects/7/questions",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,idempotency-key",
        },
    )

    assert preflight.status_code == 200
    allowed = {
        value.strip().lower()
        for value in preflight.headers["access-control-allow-headers"].split(",")
    }
    assert "idempotency-key" in allowed

    response = client.get(
        "/api/v1/this-route-does-not-exist",
        headers={"Origin": origin},
    )
    exposed = {
        value.strip().lower()
        for value in response.headers["access-control-expose-headers"].split(",")
    }
    assert {
        "idempotency-replayed",
        "retry-after",
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
        "x-ratelimit-reset",
        "x-error-code",
    }.issubset(exposed)
