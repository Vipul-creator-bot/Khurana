const express = require('express');
const router = express.Router();
const howItWorks = require('../utils/howItWorks');

// GET /api/how-it-works
router.get('/', async (req, res) => {
  try {
    const steps = await howItWorks.getAllSteps();
    res.json({ count: steps.length, steps });
  } catch (err) {
    console.error('List how-it-works error:', err);
    res.status(500).json({ error: 'Unable to fetch this content right now.' });
  }
});

module.exports = router;
