const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';

function signToken(user) {
  return jwt.sign({ sub: user._id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

/**
 * Requires a valid Bearer token. Rejects with 401 if missing/invalid.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

/**
 * Attaches req.userId if a valid Bearer token is present, but does NOT
 * reject the request if it's missing/invalid — used for routes like
 * checkout that support both guest and logged-in flows.
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.userId = payload.sub;
    } catch {
      // ignore invalid/expired token — proceed as guest
    }
  }
  next();
}

/**
 * Requires a valid Bearer token AND that the user has isAdmin: true.
 * Must run after requireAuth-equivalent token verification, so it does its
 * own token check (kept dependency-free from db.js to avoid a require
 * cycle) and then looks up the user's admin flag.
 */
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }

  // Lazy require to avoid a require() cycle (db.js doesn't depend on this file).
  const { usersDb } = require('../db');
  usersDb
    .findOneAsync({ _id: req.userId })
    .then((user) => {
      if (!user || !user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required.' });
      }
      next();
    })
    .catch(() => res.status(500).json({ error: 'Unable to verify admin access right now.' }));
}

/**
 * Requires a shared-secret key (TALLY_SYNC_API_KEY) sent as
 * X-Tally-Sync-Key — used by tally-sync-agent.js, an unattended script
 * running at the shop's location, rather than a full JWT login flow.
 * Also accepts a valid admin JWT so admins can hit the same endpoints
 * from a browser/Postman without generating a separate key for testing.
 */
function requireTallySyncAuth(req, res, next) {
  const syncKey = process.env.TALLY_SYNC_API_KEY || '';
  const providedKey = req.headers['x-tally-sync-key'];

  if (syncKey && providedKey && providedKey === syncKey) {
    return next();
  }
  // Fall back to admin JWT auth
  return requireAdmin(req, res, next);
}

module.exports = { signToken, requireAuth, optionalAuth, requireAdmin, requireTallySyncAuth, JWT_SECRET };
