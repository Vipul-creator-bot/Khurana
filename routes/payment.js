const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const router = express.Router();
const products = require('../data/products.json');
const { ordersDb, usersDb } = require('../db');
const { optionalAuth } = require('../middleware/auth');
const { checkDeliveryAvailability, isAddressInServiceCity } = require('../utils/geo');

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const isConfigured = Boolean(KEY_ID && KEY_SECRET);
const FIRST_ORDER_DISCOUNT_PERCENT = 5;
const MAX_QTY_PER_ITEM = 10;

// The Razorpay SDK throws synchronously if key_id/key_secret are missing, so
// only instantiate it when real keys are present. Routes below check
// `isConfigured` first and return a friendly error otherwise.
const razorpay = isConfigured
  ? new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET })
  : null;

// POST /api/payment/create-order  { items: [{ productId, quantity }] }
// Authorization: Bearer <token> is optional — guests can still check out,
// but only logged-in users get the first-order 5% discount.
router.post('/create-order', optionalAuth, async (req, res) => {
  try {
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
    if (!rawItems.length) {
      return res.status(400).json({ error: 'Your cart is empty.' });
    }

    // Enforce the configured delivery radius server-side — the client-side check on
    // the checkout page is just for a smooth UX, this is what's authoritative.
    // Checked before the payment-gateway-configured check below since it's a
    // more fundamental gate: no point discussing payment if we can't deliver.
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        error: 'Please share your location so we can confirm we deliver to your address.',
        code: 'LOCATION_REQUIRED',
      });
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(400).json({ error: 'Invalid location provided.', code: 'LOCATION_REQUIRED' });
    }
    const delivery = checkDeliveryAvailability(lat, lng);
    if (!delivery.withinRange) {
      return res.status(422).json({
        error: `Sorry, we currently only deliver within Gurgaon. Your location is ${delivery.distanceKm} km from our store.`,
        code: 'OUT_OF_DELIVERY_RANGE',
        distanceKm: delivery.distanceKm,
        maxRadiusKm: delivery.maxRadiusKm,
      });
    }

    const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';
    if (!address) {
      return res.status(400).json({
        error: 'Please enter your delivery address.',
        code: 'ADDRESS_REQUIRED',
      });
    }
    if (address.length < 10) {
      return res.status(400).json({
        error: 'Please enter a complete delivery address.',
        code: 'ADDRESS_TOO_SHORT',
      });
    }
    if (!isAddressInServiceCity(address)) {
      return res.status(422).json({
        error: 'Sorry, we currently only deliver within Gurgaon. Please double-check your address.',
        code: 'ADDRESS_OUTSIDE_SERVICE_CITY',
      });
    }

    if (!isConfigured) {
      return res.status(503).json({
        error:
          'Payment gateway is not configured yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to backend/.env (see .env.example).',
      });
    }

    // Resolve + validate every line item against the authoritative product
    // catalog. Prices/names always come from the server, never the client.
    const resolvedItems = [];
    for (const raw of rawItems) {
      const product = products.find((p) => p.id === Number(raw.productId));
      if (!product) {
        return res.status(404).json({ error: `Product ${raw.productId} was not found.` });
      }
      const qty = Math.max(1, Math.min(MAX_QTY_PER_ITEM, Number(raw.quantity) || 1));
      resolvedItems.push({
        productId: product.id,
        name: product.name,
        image: product.image,
        sku: product.sku,
        quantity: qty,
        unitPrice: product.salePrice,
        lineTotal: product.salePrice * qty,
      });
    }

    const baseAmount = resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0);

    let discountPercent = 0;
    let userId = null;

    if (req.userId) {
      const user = await usersDb.findOneAsync({ _id: req.userId });
      if (user) {
        userId = user._id;
        const priorPaidOrders = await ordersDb.countAsync({ userId, status: 'paid' });
        if (priorPaidOrders === 0) {
          discountPercent = FIRST_ORDER_DISCOUNT_PERCENT;
        }
      }
    }

    const finalAmount = Math.round(baseAmount * (1 - discountPercent / 100));
    const amountInPaise = Math.round(finalAmount * 100);

    const receiptLabel =
      resolvedItems.length === 1 ? resolvedItems[0].sku : `cart-${resolvedItems.length}-items`;

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `kk_${receiptLabel}_${Date.now()}`,
      notes: {
        itemCount: String(resolvedItems.length),
        discountPercent: String(discountPercent),
        userId: userId || 'guest',
        address,
      },
    });

    await ordersDb.insertAsync({
      userId,
      items: resolvedItems.map(({ productId, name, quantity, unitPrice, lineTotal }) => ({
        productId,
        name,
        quantity,
        unitPrice,
        lineTotal,
      })),
      baseAmount,
      discountPercent,
      amount: finalAmount,
      address,
      deliveryDistanceKm: delivery.distanceKm,
      razorpayOrderId: razorpayOrder.id,
      status: 'created',
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: KEY_ID,
      items: resolvedItems,
      baseAmount,
      discountPercent,
      finalAmount,
    });
  } catch (err) {
    console.error('Razorpay create-order error:', err);
    res.status(500).json({ error: 'Unable to create payment order. Please try again.' });
  }
});

// POST /api/payment/verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields' });
    }
    if (!KEY_SECRET) {
      return res.status(503).json({ error: 'Payment gateway is not configured yet.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const isValid = expectedSignature === razorpay_signature;

    if (!isValid) {
      return res.status(400).json({ verified: false, error: 'Payment verification failed' });
    }

    await ordersDb.updateAsync(
      { razorpayOrderId: razorpay_order_id },
      { $set: { status: 'paid', razorpayPaymentId: razorpay_payment_id, paidAt: new Date().toISOString() } }
    );

    res.json({ verified: true, message: 'Payment verified successfully.' });
  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ error: 'Unable to verify payment right now.' });
  }
});

module.exports = router;
