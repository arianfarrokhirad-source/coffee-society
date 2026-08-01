// Rate limiting abstraction. Phase 1 ships an in-memory sliding window
// (adequate for a single-founder deployment on one region); the
// interface allows a Redis/Upstash implementation later without
// touching call sites.

export interface RateLimiter {
  /** Returns true when the call is allowed, false when rate limited. */
  check(key: string): Promise<boolean>
}

export interface SlidingWindowOptions {
  windowMs: number
  maxRequests: number
}

export function createInMemoryRateLimiter(options: SlidingWindowOptions): RateLimiter {
  const hits = new Map<string, number[]>()
  return {
    check(key: string): Promise<boolean> {
      const now = Date.now()
      const cutoff = now - options.windowMs
      const list = (hits.get(key) ?? []).filter((t) => t > cutoff)
      if (list.length >= options.maxRequests) {
        hits.set(key, list)
        return Promise.resolve(false)
      }
      list.push(now)
      hits.set(key, list)
      return Promise.resolve(true)
    },
  }
}
