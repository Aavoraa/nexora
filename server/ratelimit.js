/**
 * Fixed-window rate limiter kept in process memory. Per instance only: move the
 * counters to Postgres or Redis before running more than one instance (SECURITY.md §5).
 */
export function rateLimit({ windowMs, max, key, message = 'Too many requests. Try again later.' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 10_000) {
      for (const [k, e] of hits) if (e.reset <= now) hits.delete(k);
    }
    const k = key(req);
    let entry = hits.get(k);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

const MIN = 60_000;

export const loginLimit = rateLimit({
  windowMs: 15 * MIN,
  max: 10,
  key: (req) => `${req.ip}|${String(req.body?.username || '').toLowerCase()}`,
  message: 'Too many sign-in attempts. Try again in 15 minutes.',
});

export const registerLimit = rateLimit({
  windowMs: 60 * MIN,
  max: 5,
  key: (req) => req.ip,
  message: 'Too many sign-ups from this network. Try again later.',
});

export const aiLimit = rateLimit({
  windowMs: 60 * MIN,
  max: 30,
  key: (req) => `user:${req.user.id}`,
  message: 'You have reached the hourly AI draft limit. Try again later.',
});
