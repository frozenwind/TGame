export class RateLimiter {
  private readonly buckets = new Map<string, { count: number; start: number }>();

  allow(key: string, limit: number, windowMs: number, now: number): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      this.buckets.set(key, { count: 1, start: now });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }
}
