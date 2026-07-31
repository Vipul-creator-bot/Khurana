const express = require('express');
const router = express.Router();
const faqs = require('../data/faqs.json');

router.get('/', (req, res) => {
  res.json({ count: faqs.length, faqs });
});

module.exports = router;
