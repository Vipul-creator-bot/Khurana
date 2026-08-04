const express = require('express');
const router = express.Router();
const { checkDeliveryAvailability, STORE_LOCATION, DELIVERY_RADIUS_KM } = require('../utils/geo');

// GET /api/delivery/check?lat=..&lng=..
// Lets the checkout page show live serviceability status as soon as the
// browser reports the customer's location, before they attempt to pay.
router.get('/check', (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'Valid lat and lng query parameters are required.' });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lat/lng values are out of valid range.' });
  }

  const result = checkDeliveryAvailability(lat, lng);
  res.json(result);
});

// GET /api/delivery/info — store location + radius, e.g. to plot on a map
router.get('/info', (req, res) => {
  res.json({ store: STORE_LOCATION, maxRadiusKm: DELIVERY_RADIUS_KM });
});

module.exports = router;


