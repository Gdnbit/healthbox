"""Small in-process sliding-window limiter used as application-layer defense."""

from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock
from time import monotonic


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after_seconds: int


class InProcessRateLimiter:
    """Thread-safe limiter for one application process.

    This is intentionally a defense-in-depth layer. Public deployment still
    requires reverse-proxy or edge rate limiting across all workers.
    """

    def __init__(self, *, max_requests: int, window_seconds: int):
        if max_requests <= 0 or window_seconds <= 0:
            raise ValueError("rate limiter values must be positive")
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str) -> RateLimitDecision:
        now = monotonic()
        cutoff = now - self.window_seconds
        normalized_key = key or "unknown"
        with self._lock:
            timestamps = self._requests[normalized_key]
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if len(timestamps) >= self.max_requests:
                retry_after = max(1, int(self.window_seconds - (now - timestamps[0])))
                return RateLimitDecision(False, retry_after)
            timestamps.append(now)
            return RateLimitDecision(True, 0)

    def reset(self) -> None:
        """Clear process-local state for deterministic tests and maintenance."""

        with self._lock:
            self._requests.clear()
