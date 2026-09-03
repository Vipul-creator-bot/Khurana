const path = require('path');
const Datastore = require('@seald-io/nedb');

// File-based, persistent, embedded database (no separate DB server required).
// Data lives in backend/data/*.db as newline-delimited JSON — inspect or back it
// up like any other file. Swap this module out for Postgres/MongoDB later
// without touching route logic, since routes only talk to the methods below.

const usersDb = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'users.db'),
  autoload: true,
});
const ordersDb = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'orders.db'),
  autoload: true,
});
// Live stock quantity per product — separate from the static data/products.json
// catalog (name/price/images) so quantity can change at runtime without
// rewriting that file. One doc per product: { productId, quantity, updatedAt }.
const stockDb = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'stock.db'),
  autoload: true,
});
// Queue of stock changes waiting to be pushed into Tally. Every restock or
// sale enqueues an entry here; see utils/tally.js and routes/tally.js for
// how entries get synced (either directly, or via the bridge agent script
// tally-sync-agent.js when Tally isn't reachable from this server).
const tallySyncQueueDb = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'tally-sync-queue.db'),
  autoload: true,
});
// The live product catalog — seeded once from data/products.json (see
// utils/catalog.js), then this DB is the source of truth from then on.
// Admin create/edit/delete operations write here; data/products.json is
// left untouched after the initial seed and only matters for that first
// import (and as a human-readable backup/reference).
const productsDb = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'catalog-products.db'),
  autoload: true,
});
// Same pattern for categories, seeded once from data/categories.json.
const categoriesDb = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'catalog-categories.db'),
  autoload: true,
});
// "How It Works" steps shown on the homepage, seeded once from
// data/how-it-works.json. Admin create/edit/delete/reorder operations
// write here, same pattern as products/categories above.
const howItWorksDb = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'how-it-works.db'),
  autoload: true,
});
// The single tenant/organization record for this app (Zoho Inventory's
// notion of an "organization" — see utils/organization.js). One doc, ever.
const organizationDb = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'organization.db'),
  autoload: true,
});

usersDb.ensureIndexAsync({ fieldName: 'email', unique: true }).catch((err) => {
  console.error('Failed to create users email index:', err);
});
stockDb.ensureIndexAsync({ fieldName: 'productId', unique: true }).catch((err) => {
  console.error('Failed to create stock productId index:', err);
});
productsDb.ensureIndexAsync({ fieldName: 'id', unique: true }).catch((err) => {
  console.error('Failed to create products id index:', err);
});
categoriesDb.ensureIndexAsync({ fieldName: 'id', unique: true }).catch((err) => {
  console.error('Failed to create categories id index:', err);
});
howItWorksDb.ensureIndexAsync({ fieldName: 'id', unique: true }).catch((err) => {
  console.error('Failed to create how-it-works id index:', err);
});

module.exports = {
  usersDb,
  ordersDb,
  stockDb,
  tallySyncQueueDb,
  productsDb,
  categoriesDb,
  howItWorksDb,
  organizationDb,
};
