// Response envelope matching Zoho Inventory's API conventions
// (https://www.zoho.com/inventory/api/v1/introduction/#overview): every
// response carries a `code` (0 on success, non-zero on error) and a
// human-readable `message`, with the actual payload under `data`.
// Only the inventory-management surface (organizations, catalog items,
// stock) uses this — the public storefront reads and other admin
// endpoints (members, broadcast, how-it-works) keep their existing shape.

const ERROR_CODES = {
  VALIDATION: 1001,
  NOT_FOUND: 1002,
  ORG_MISSING: 20,
  ORG_INVALID: 21,
  RATE_LIMITED: 429,
  SERVER_ERROR: 1000,
};

function ok(res, data, message = 'success', status = 200, extra = {}) {
  return res.status(status).json({ code: 0, message, data, ...extra });
}

function fail(res, status, message, code = status) {
  return res.status(status).json({ code, message });
}

module.exports = { ok, fail, ERROR_CODES };
