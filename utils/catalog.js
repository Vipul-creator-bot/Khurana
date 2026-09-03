const fs = require('fs');
const path = require('path');
const { productsDb, categoriesDb, stockDb } = require('../db');

const PRODUCTS_SEED_PATH = path.join(__dirname, '..', 'data', 'products.json');
const CATEGORIES_SEED_PATH = path.join(__dirname, '..', 'data', 'categories.json');

// One-time import: if productsDb/categoriesDb are empty (fresh install),
// load the original static JSON files as the starting catalog. After this
// runs once, the JSON files are never read again — the DB is authoritative,
// so admin-created/edited/deleted items persist correctly and don't get
// reset by whatever's in the JSON file.
async function ensureCatalogSeeded() {
  const productCount = await productsDb.countAsync({});
  if (productCount === 0 && fs.existsSync(PRODUCTS_SEED_PATH)) {
    const seedProducts = JSON.parse(fs.readFileSync(PRODUCTS_SEED_PATH, 'utf-8'));
    for (const product of seedProducts) {
      // eslint-disable-next-line no-await-in-loop
      await productsDb.insertAsync(product);
    }
    console.log(`Catalog: seeded ${seedProducts.length} products from products.json`);
  }

  const categoryCount = await categoriesDb.countAsync({});
  if (categoryCount === 0 && fs.existsSync(CATEGORIES_SEED_PATH)) {
    const seedCategories = JSON.parse(fs.readFileSync(CATEGORIES_SEED_PATH, 'utf-8'));
    for (const category of seedCategories) {
      // eslint-disable-next-line no-await-in-loop
      await categoriesDb.insertAsync(category);
    }
    console.log(`Catalog: seeded ${seedCategories.length} categories from categories.json`);
  }
}

async function nextId(db) {
  const all = await db.findAsync({});
  const max = all.reduce((m, doc) => Math.max(m, Number(doc.id) || 0), 0);
  return max + 1;
}

function stripMongoId(doc) {
  const { _id, ...rest } = doc;
  return rest;
}

// ---- Products ----

async function getAllProducts() {
  const docs = await productsDb.findAsync({});
  return docs.map(stripMongoId);
}

async function getProductById(id) {
  const doc = await productsDb.findOneAsync({ id: Number(id) });
  return doc ? stripMongoId(doc) : null;
}

async function createProduct(data) {
  const id = await nextId(productsDb);
  const product = {
    id,
    name: data.name,
    category: data.category,
    sku: data.sku,
    price: Number(data.price),
    salePrice: Number(data.salePrice),
    image: data.image || (data.images && data.images[0]) || '',
    images: data.images && data.images.length ? data.images : data.image ? [data.image] : [],
    video: data.video || '',
    description: data.description || '',
    featured: Boolean(data.featured),
    inStock: true,
  };
  await productsDb.insertAsync(product);
  // Give it a stock record too, defaulting to whatever was supplied (or 0)
  // so a brand-new product doesn't silently inherit some unrelated default.
  await stockDb.updateAsync(
    { productId: id },
    { $set: { productId: id, quantity: Number(data.initialStock) || 0, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  return product;
}

async function updateProduct(id, data) {
  const existing = await productsDb.findOneAsync({ id: Number(id) });
  if (!existing) return null;

  const updates = {};
  const editableFields = ['name', 'category', 'sku', 'description', 'featured', 'video'];
  for (const field of editableFields) {
    if (data[field] !== undefined) updates[field] = data[field];
  }
  if (data.price !== undefined) updates.price = Number(data.price);
  if (data.salePrice !== undefined) updates.salePrice = Number(data.salePrice);
  if (data.images !== undefined && data.images.length) {
    updates.images = data.images;
    updates.image = data.images[0];
  } else if (data.addImages !== undefined && data.addImages.length) {
    // Append newly uploaded images to the existing gallery rather than replacing it.
    updates.images = [...(existing.images || []), ...data.addImages];
    updates.image = existing.image || data.addImages[0];
  }

  await productsDb.updateAsync({ id: Number(id) }, { $set: updates });
  return getProductById(id);
}

async function deleteProduct(id) {
  const removed = await productsDb.removeAsync({ id: Number(id) }, {});
  await stockDb.removeAsync({ productId: Number(id) }, {});
  return removed > 0;
}

// ---- Categories ----

async function getAllCategories() {
  const docs = await categoriesDb.findAsync({});
  return docs.map(stripMongoId);
}

async function getCategoryById(id) {
  const doc = await categoriesDb.findOneAsync({ id: Number(id) });
  return doc ? stripMongoId(doc) : null;
}

async function createCategory(data) {
  const id = await nextId(categoriesDb);
  const category = {
    id,
    name: data.name,
    tagline: data.tagline || '',
    images: data.images && data.images.length ? data.images : [],
    video: data.video || '',
  };
  await categoriesDb.insertAsync(category);
  return category;
}

async function updateCategory(id, data) {
  const existing = await categoriesDb.findOneAsync({ id: Number(id) });
  if (!existing) return null;

  const updates = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.tagline !== undefined) updates.tagline = data.tagline;
  if (data.video !== undefined) updates.video = data.video;
  if (data.images !== undefined && data.images.length) {
    updates.images = data.images;
  } else if (data.addImages !== undefined && data.addImages.length) {
    updates.images = [...(existing.images || []), ...data.addImages];
  }

  await categoriesDb.updateAsync({ id: Number(id) }, { $set: updates });
  return getCategoryById(id);
}

async function deleteCategory(id) {
  const removed = await categoriesDb.removeAsync({ id: Number(id) }, {});
  return removed > 0;
}

module.exports = {
  ensureCatalogSeeded,
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
};
