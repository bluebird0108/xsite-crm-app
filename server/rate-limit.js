const buckets = new Map();

function rateLimit({ windowMs, max, key = (req) => req.ip || "unknown" }) {
  return (req, res, next) => {
    const now = Date.now();
    const bucketKey = String(key(req));
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(bucketKey, bucket);

    const remaining = Math.max(0, max - bucket.count);
    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(remaining));
    res.set("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.set("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }
    if (buckets.size > 10_000) {
      for (const [entryKey, entry] of buckets) if (entry.resetAt <= now) buckets.delete(entryKey);
    }
    next();
  };
}

function resetRateLimits() { buckets.clear(); }

module.exports = { rateLimit, resetRateLimits };
