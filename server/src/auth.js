/**
 * API key validation.
 */

const apiKeys = new Set(
  (process.env.API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
);

export function validateApiKey(key) {
  if (apiKeys.size === 0) return true; // no keys configured = open
  return apiKeys.has(key);
}

/**
 * Express middleware — expects Authorization: Bearer <key>
 */
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing API key' });
  }
  const key = header.slice(7);
  if (!validateApiKey(key)) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  next();
}
