const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { requireOrganizationId } = require('../middleware/organization');
const { rateLimitByOrganization } = require('../middleware/rateLimit');
const {
  uploadProductImages,
  uploadCategoryImages,
  uploadHowItWorksImage,
  filesToPublicUrls,
} = require('../utils/upload');
const catalog = require('../utils/catalog');
const howItWorks = require('../utils/howItWorks');
const { ok, fail, ERROR_CODES } = require('../utils/apiResponse');
const { paginate } = require('../utils/pagination');

function handleUploadError(err, req, res, next) {
  if (err) {
    return fail(res, 400, err.message || 'Image upload failed.', ERROR_CODES.VALIDATION);
  }
  next();
}

// Items (products) and item categories are the two resources this app
// models after Zoho Inventory's "Items" API — every request must carry a
// valid organization_id and is subject to the same per-organization rate
// limit as the rest of the inventory surface
// (https://www.zoho.com/inventory/api/v1/introduction/#overview).
const scoped = [requireAdmin, requireOrganizationId, rateLimitByOrganization];

// ---- Products ("Items") ----

// GET /api/admin/catalog/products?page=1&per_page=25
router.get('/catalog/products', ...scoped, async (req, res) => {
  try {
    const all = await catalog.getAllProducts();
    const { items, page_context } = paginate(all, req, { reportName: 'Items' });
    ok(res, items, 'success', 200, { page_context });
  } catch (err) {
    console.error('List catalog products error:', err);
    fail(res, 500, 'Unable to fetch products right now.', ERROR_CODES.SERVER_ERROR);
  }
});

// POST /api/admin/catalog/products  (multipart/form-data)
// Fields: name, category, sku, price, salePrice, description, featured,
// video, initialStock. Files: images (up to 10).
router.post(
  '/catalog/products',
  ...scoped,
  (req, res, next) => uploadProductImages.array('images', 10)(req, res, (err) => handleUploadError(err, req, res, next)),
  async (req, res) => {
    try {
      const { name, category, sku, price, salePrice } = req.body;
      if (!name || !category || !sku || !price || !salePrice) {
        return fail(res, 400, 'name, category, sku, price and salePrice are required.', ERROR_CODES.VALIDATION);
      }

      const images = filesToPublicUrls(req.files, 'products');
      const product = await catalog.createProduct({ ...req.body, images });
      ok(res, product, 'The item has been added.', 201);
    } catch (err) {
      console.error('Create product error:', err);
      fail(res, 500, 'Unable to create the product right now.', ERROR_CODES.SERVER_ERROR);
    }
  }
);

// PUT /api/admin/catalog/products/:id  (multipart/form-data)
// Any field is optional — only what's sent gets updated. New uploaded
// images are appended to the existing gallery unless replaceImages=true.
router.put(
  '/catalog/products/:id',
  ...scoped,
  (req, res, next) => uploadProductImages.array('images', 10)(req, res, (err) => handleUploadError(err, req, res, next)),
  async (req, res) => {
    try {
      const uploadedUrls = filesToPublicUrls(req.files, 'products');
      const payload = { ...req.body };
      if (uploadedUrls.length) {
        if (req.body.replaceImages === 'true') payload.images = uploadedUrls;
        else payload.addImages = uploadedUrls;
      }

      const updated = await catalog.updateProduct(req.params.id, payload);
      if (!updated) return fail(res, 404, 'Product not found.', ERROR_CODES.NOT_FOUND);
      ok(res, updated, 'The item has been updated.');
    } catch (err) {
      console.error('Update product error:', err);
      fail(res, 500, 'Unable to update the product right now.', ERROR_CODES.SERVER_ERROR);
    }
  }
);

// DELETE /api/admin/catalog/products/:id
router.delete('/catalog/products/:id', ...scoped, async (req, res) => {
  try {
    const deleted = await catalog.deleteProduct(req.params.id);
    if (!deleted) return fail(res, 404, 'Product not found.', ERROR_CODES.NOT_FOUND);
    ok(res, { product_id: req.params.id }, 'The item has been deleted.');
  } catch (err) {
    console.error('Delete product error:', err);
    fail(res, 500, 'Unable to delete the product right now.', ERROR_CODES.SERVER_ERROR);
  }
});

// ---- Categories ----

// GET /api/admin/catalog/categories?page=1&per_page=25
router.get('/catalog/categories', ...scoped, async (req, res) => {
  try {
    const all = await catalog.getAllCategories();
    const { items, page_context } = paginate(all, req, { reportName: 'ItemCategories' });
    ok(res, items, 'success', 200, { page_context });
  } catch (err) {
    console.error('List catalog categories error:', err);
    fail(res, 500, 'Unable to fetch categories right now.', ERROR_CODES.SERVER_ERROR);
  }
});

// POST /api/admin/catalog/categories  (multipart/form-data)
// Fields: name, tagline, video. Files: images (up to 10).
router.post(
  '/catalog/categories',
  ...scoped,
  (req, res, next) => uploadCategoryImages.array('images', 10)(req, res, (err) => handleUploadError(err, req, res, next)),
  async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) {
        return fail(res, 400, 'name is required.', ERROR_CODES.VALIDATION);
      }
      const images = filesToPublicUrls(req.files, 'categories');
      const category = await catalog.createCategory({ ...req.body, images });
      ok(res, category, 'The item category has been added.', 201);
    } catch (err) {
      console.error('Create category error:', err);
      fail(res, 500, 'Unable to create the category right now.', ERROR_CODES.SERVER_ERROR);
    }
  }
);

// PUT /api/admin/catalog/categories/:id  (multipart/form-data)
router.put(
  '/catalog/categories/:id',
  ...scoped,
  (req, res, next) => uploadCategoryImages.array('images', 10)(req, res, (err) => handleUploadError(err, req, res, next)),
  async (req, res) => {
    try {
      const uploadedUrls = filesToPublicUrls(req.files, 'categories');
      const payload = { ...req.body };
      if (uploadedUrls.length) {
        if (req.body.replaceImages === 'true') payload.images = uploadedUrls;
        else payload.addImages = uploadedUrls;
      }

      const updated = await catalog.updateCategory(req.params.id, payload);
      if (!updated) return fail(res, 404, 'Category not found.', ERROR_CODES.NOT_FOUND);
      ok(res, updated, 'The item category has been updated.');
    } catch (err) {
      console.error('Update category error:', err);
      fail(res, 500, 'Unable to update the category right now.', ERROR_CODES.SERVER_ERROR);
    }
  }
);

// DELETE /api/admin/catalog/categories/:id
router.delete('/catalog/categories/:id', ...scoped, async (req, res) => {
  try {
    const deleted = await catalog.deleteCategory(req.params.id);
    if (!deleted) return fail(res, 404, 'Category not found.', ERROR_CODES.NOT_FOUND);
    ok(res, { category_id: req.params.id }, 'The item category has been deleted.');
  } catch (err) {
    console.error('Delete category error:', err);
    fail(res, 500, 'Unable to delete the category right now.', ERROR_CODES.SERVER_ERROR);
  }
});

// ---- How It Works (homepage step cards) ----

function parsePoints(raw) {
  return String(raw || '')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
}

// POST /api/admin/how-it-works  (multipart/form-data)
// Fields: title, points (one per line), order (optional). File: image (single, optional).
router.post(
  '/how-it-works',
  requireAdmin,
  (req, res, next) => uploadHowItWorksImage.single('image')(req, res, (err) => handleUploadError(err, req, res, next)),
  async (req, res) => {
    try {
      const { title } = req.body;
      if (!title) {
        return res.status(400).json({ error: 'title is required.' });
      }
      const image = req.file ? filesToPublicUrls([req.file], 'how-it-works')[0] : '';
      const step = await howItWorks.createStep({
        title,
        points: parsePoints(req.body.points),
        image,
        order: req.body.order,
      });
      res.status(201).json(step);
    } catch (err) {
      console.error('Create how-it-works step error:', err);
      res.status(500).json({ error: 'Unable to create this step right now.' });
    }
  }
);

// PUT /api/admin/how-it-works/:id  (multipart/form-data)
// Any field is optional — only what's sent gets updated.
router.put(
  '/how-it-works/:id',
  requireAdmin,
  (req, res, next) => uploadHowItWorksImage.single('image')(req, res, (err) => handleUploadError(err, req, res, next)),
  async (req, res) => {
    try {
      const payload = { ...req.body };
      if (req.body.points !== undefined) payload.points = parsePoints(req.body.points);
      if (req.file) payload.image = filesToPublicUrls([req.file], 'how-it-works')[0];

      const updated = await howItWorks.updateStep(req.params.id, payload);
      if (!updated) return res.status(404).json({ error: 'Step not found.' });
      res.json(updated);
    } catch (err) {
      console.error('Update how-it-works step error:', err);
      res.status(500).json({ error: 'Unable to update this step right now.' });
    }
  }
);

// DELETE /api/admin/how-it-works/:id
router.delete('/how-it-works/:id', requireAdmin, async (req, res) => {
  try {
    const deleted = await howItWorks.deleteStep(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Step not found.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete how-it-works step error:', err);
    res.status(500).json({ error: 'Unable to delete this step right now.' });
  }
});

module.exports = router;
