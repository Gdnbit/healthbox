"""Local marker registration for the opt-in browser acceptance suite."""


def pytest_configure(config) -> None:
    config.addinivalue_line("markers", "e2e: end-to-end tests")
    config.addinivalue_line("markers", "slow: tests with full application startup")
