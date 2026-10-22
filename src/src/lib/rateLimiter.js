/**
 * Sliding-window rate limiter. Tracks call timestamps in memory and makes
 * callers await their turn rather than firing over the limit — this is a
 * real enforcement mechanism, not just an advisory counter (the previous
 * football-data client only *counted* calls for logging; nothing actually
 * stopped it from bursting past the provider's 10-requests/minute limit).
 */
class SlidingWindowRateLimiter {
  /**
   * @param {number} maxCalls - max calls allowed per window
   * @param {number} windowMs - window size in milliseconds
   */
  constructor(maxCalls, windowMs) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.timestamps = [];
  }

  _prune(now) {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }

  /** Resolves once it's safe to make a call, having reserved a slot. */
  async acquire() {
    for (;;) {
      const now = Date.now();
      this._prune(now);

      if (this.timestamps.length < this.maxCalls) {
        this.timestamps.push(now);
        return;
      }

      const oldest = this.timestamps[0];
      const waitMs = oldest + this.windowMs - now + 10; // small buffer
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 10)));
    }
  }

  /** Non-blocking check — true if a call could be made right now. */
  hasCapacity() {
    this._prune(Date.now());
    return this.timestamps.length < this.maxCalls;
  }
}

module.exports = { SlidingWindowRateLimiter };
