const express = require('express');
const router = express.Router();
const categories = require('../data/categories.json');

router.get('/', (req, res) => {
  res.json({ count: categories.length, categories });
});

router.get('/:id', (req, res) => {
  const category = categories.find((c) => c.id === Number(req.params.id));
  if (!category) {
    return res.status(404).json({ error: 'Category not found' });
  }
  res.json(category);
});

module.exports = router;
