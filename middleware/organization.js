const { getOrganization } = require('../utils/organization');
const { fail, ERROR_CODES } = require('../utils/apiResponse');

// Mirrors Zoho Inventory's requirement that every API call carry an
// organization_id identifying the business
// (https://www.zoho.com/inventory/api/v1/introduction/#overview) — call
// GET /api/organizations to look it up. Accepted as a query param (Zoho's
// convention) or an X-Organization-Id header (for non-GET bodies where a
// query param is awkward to add from a form).
async function requireOrganizationId(req, res, next) {
  try {
    const org = await getOrganization();
    if (!org) {
      return fail(res, 500, 'No organization is configured for this server yet.', ERROR_CODES.SERVER_ERROR);
    }

    const provided = req.query.organization_id || req.headers['x-organization-id'];
    if (!provided) {
      return fail(
        res,
        400,
        'The organization_id is required on every request. Call GET /api/organizations to look it up.',
        ERROR_CODES.ORG_MISSING
      );
    }
    if (provided !== org.organization_id) {
      return fail(res, 400, 'The organization ID you provided is invalid.', ERROR_CODES.ORG_INVALID);
    }

    req.organization = org;
    next();
  } catch (err) {
    console.error('Organization lookup error:', err);
    fail(res, 500, 'Unable to verify the organization right now.', ERROR_CODES.SERVER_ERROR);
  }
}

module.exports = { requireOrganizationId };
