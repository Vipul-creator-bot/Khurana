const express = require('express');
const router = express.Router();
const testimonials = require('../data/testimonials.json');

router.get('/', (req, res) => {
  res.json({ count: testimonials.length, testimonials });
});

module.exports = router;
