const express = require('express');
const router = express.Router();
const catalog = require('../utils/catalog');

router.get('/', async (req, res) => {
  try {
    const categories = await catalog.getAllCategories();
    res.json({ count: categories.length, categories });
  } catch (err) {
    console.error('List categories error:', err);
    res.status(500).json({ error: 'Unable to fetch categories right now.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const category = await catalog.getCategoryById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(category);
  } catch (err) {
    console.error('Get category error:', err);
    res.status(500).json({ error: 'Unable to fetch this category right now.' });
  }
});

module.exports = router;
