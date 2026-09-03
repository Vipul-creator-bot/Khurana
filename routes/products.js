const express = require('express');
const router = express.Router();
const catalog = require('../utils/catalog');
const { getStock } = require('../utils/stock');

// Overlays live stock quantity (from stock.db) onto a product record, so
// the storefront always reflects real-time inventory.
async function withLiveStock(product) {
  const stockQuantity = await getStock(product.id);
  return { ...product, stockQuantity, inStock: stockQuantity > 0 };
}

// GET /api/products?category=Cookware&featured=true&search=knife
router.get('/', async (req, res) => {
  try {
    let result = await catalog.getAllProducts();
    const { category, featured, search } = req.query;

    if (category) {
      result = result.filter(
        (p) => p.category.toLowerCase() === String(category).toLowerCase()
      );
    }
    if (featured !== undefined) {
      const wantFeatured = featured === 'true';
      result = result.filter((p) => p.featured === wantFeatured);
    }
    if (search) {
      const q = String(search).toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
      );
    }

    const withStock = await Promise.all(result.map(withLiveStock));
    res.json({ count: withStock.length, products: withStock });
  } catch (err) {
    console.error('List products error:', err);
    res.status(500).json({ error: 'Unable to fetch products right now.' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const product = await catalog.getProductById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(await withLiveStock(product));
  } catch (err) {
    console.error('Get product error:', err);
    res.status(500).json({ error: 'Unable to fetch this product right now.' });
  }
});

module.exports = router;
