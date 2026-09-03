const crypto = require('crypto');
const { organizationDb } = require('../db');

// Zoho Inventory scopes every API call to an `organization_id`, obtained via
// GET /organizations (https://www.zoho.com/inventory/api/v1/introduction/#overview).
// This app is single-tenant, so there's exactly one organization — it's
// generated once on first boot (same seed-once pattern as catalog/how-it-works)
// rather than requiring manual .env setup.
async function ensureOrganizationSeeded() {
  const existing = await organizationDb.findOneAsync({});
  if (existing) return;

  await organizationDb.insertAsync({
    organization_id: crypto.randomUUID(),
    name: process.env.COMPANY_NAME || 'Khurana Kitchenware Private Limited',
    time_zone: process.env.ORG_TIME_ZONE || 'Asia/Kolkata',
    currency_code: process.env.ORG_CURRENCY_CODE || 'INR',
    createdAt: new Date().toISOString(),
  });
  console.log('Organization: generated a new organization_id (first boot).');
}

function stripMongoId(doc) {
  const { _id, ...rest } = doc;
  return rest;
}

async function getOrganization() {
  const doc = await organizationDb.findOneAsync({});
  return doc ? stripMongoId(doc) : null;
}

module.exports = { ensureOrganizationSeeded, getOrganization };
