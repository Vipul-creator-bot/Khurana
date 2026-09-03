const { fail, ERROR_CODES } = require('../utils/apiResponse');

// Zoho Inventory's documented limit: 100 requests per minute per organization
// (https://www.zoho.com/inventory/api/v1/introduction/#overview). In-memory
// fixed-window counter is enough here — this app runs as a single process
// against an embedded file DB, no multi-instance deployment to coordinate.
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 100;

const windows = new Map(); // organization_id -> { count, windowStart }

// Runs after requireOrganizationId, so req.organization is already set.
function rateLimitByOrganization(req, res, next) {
  const orgId = req.organization && req.organization.organization_id;
  const now = Date.now();
  const entry = windows.get(orgId);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    windows.set(orgId, { count: 1, windowStart: now });
    return next();
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return fail(
      res,
      429,
      `You have reached the maximum number of allowed requests (${MAX_REQUESTS_PER_WINDOW} per minute). Please retry after ${retryAfterSeconds}s.`,
      ERROR_CODES.RATE_LIMITED
    );
  }

  entry.count += 1;
  next();
}

module.exports = { rateLimitByOrganization };
