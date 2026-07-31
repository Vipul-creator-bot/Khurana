const express = require('express');
const router = express.Router();
const products = require('../data/products.json');

// GET /api/products?category=Cookware&featured=true&search=knife
router.get('/', (req, res) => {
  let result = [...products];
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

  res.json({ count: result.length, products: result });
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const product = products.find((p) => p.id === Number(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
});

module.exports = router;
