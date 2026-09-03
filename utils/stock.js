const catalog = require('./catalog');
const { stockDb } = require('../db');

// How many units to seed for a product that has no stock record yet. This
// only applies once, the first time the server sees a product — after that,
// the real number lives in stock.db and this default is never used again.
// !! Set real quantities via POST /api/admin/stock/add (or the admin Stock
// panel) after deploying — this seed value is a placeholder, not inventory
// data pulled from anywhere real.
const DEFAULT_SEED_QUANTITY = 20;

// Called once at server startup (after the catalog itself has been seeded —
// see ensureCatalogSeeded in utils/catalog.js, which must run first): makes
// sure every product has a corresponding live stock record, without ever
// overwriting an existing one (so restarting the server never resets real
// counts, and doesn't touch stock for products created later by an admin —
// those get their initial stock set directly at creation time instead).
async function ensureStockSeeded() {
  const products = await catalog.getAllProducts();
  for (const product of products) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await stockDb.findOneAsync({ productId: product.id });
    if (!existing) {
      // eslint-disable-next-line no-await-in-loop
      await stockDb.insertAsync({
        productId: product.id,
        quantity: product.inStock === false ? 0 : DEFAULT_SEED_QUANTITY,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

async function getStock(productId) {
  const record = await stockDb.findOneAsync({ productId: Number(productId) });
  return record ? record.quantity : 0;
}

async function getAllStockLevels() {
  const [records, products] = await Promise.all([stockDb.findAsync({}), catalog.getAllProducts()]);
  const byProductId = new Map(records.map((r) => [r.productId, r.quantity]));
  return products.map((p) => ({
    productId: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    image: p.image,
    quantity: byProductId.get(p.id) ?? 0,
  }));
}

// Adjusts a product's stock by `delta` (positive to add, negative to
// subtract), never letting it go below zero. Returns the new quantity.
async function adjustStock(productId, delta) {
  const id = Number(productId);
  const existing = await stockDb.findOneAsync({ productId: id });
  const current = existing ? existing.quantity : 0;
  const next = Math.max(0, current + delta);

  await stockDb.updateAsync(
    { productId: id },
    { $set: { productId: id, quantity: next, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );

  return next;
}

module.exports = { ensureStockSeeded, getStock, getAllStockLevels, adjustStock, DEFAULT_SEED_QUANTITY };
