const express = require('express');
const router = express.Router();
const { requireTallySyncAuth } = require('../middleware/auth');
const { getOrganization } = require('../utils/organization');
const { ok, fail, ERROR_CODES } = require('../utils/apiResponse');

// GET /api/organizations
// Mirrors Zoho Inventory's GET /organizations — the documented way to look
// up the organization_id required on every other inventory-management call
// (https://www.zoho.com/inventory/api/v1/introduction/#overview). This app
// is single-tenant, so it always returns the one organization directly
// (real Zoho returns a list, for accounts with multiple organizations).
// Reuses requireTallySyncAuth so both the admin panel and the Tally sync
// agent can bootstrap the organization_id without a separate credential.
router.get('/', requireTallySyncAuth, async (req, res) => {
  try {
    const organization = await getOrganization();
    if (!organization) {
      return fail(res, 500, 'No organization is configured for this server yet.', ERROR_CODES.SERVER_ERROR);
    }
    ok(res, organization);
  } catch (err) {
    console.error('Get organization error:', err);
    fail(res, 500, 'Unable to fetch the organization right now.', ERROR_CODES.SERVER_ERROR);
  }
});

module.exports = router;
