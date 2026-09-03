const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const router = express.Router();
const catalog = require('../utils/catalog');
const { ordersDb, usersDb } = require('../db');
const { optionalAuth } = require('../middleware/auth');
const { checkDeliveryAvailability, isAddressInServiceCity } = require('../utils/geo');
const { getStock, adjustStock } = require('../utils/stock');
const { queueAndSyncStockChange } = require('../utils/tally');

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const isConfigured = Boolean(KEY_ID && KEY_SECRET);
const FIRST_ORDER_DISCOUNT_PERCENT = 5;
const MAX_QTY_PER_ITEM = 10;

// Standard 15-character GSTIN: 2-digit state code, 10-char PAN, 1-digit entity
// number, literal 'Z', 1-char checksum. e.g. 07AABCU9603R1ZM
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

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

    // B2B orders carry a GSTIN so the Tally ledger/invoice can claim input
    // credit; B2C orders never store one, even if the client sends one.
    const customerType = req.body.customerType === 'B2B' ? 'B2B' : 'B2C';
    let gstNumber = '';
    if (customerType === 'B2B') {
      gstNumber = typeof req.body.gstNumber === 'string' ? req.body.gstNumber.trim().toUpperCase() : '';
      if (!gstNumber) {
        return res.status(400).json({
          error: 'GST number is required for B2B orders.',
          code: 'GST_NUMBER_REQUIRED',
        });
      }
      if (!GSTIN_REGEX.test(gstNumber)) {
        return res.status(400).json({
          error: 'Please enter a valid 15-character GST number.',
          code: 'GST_NUMBER_INVALID',
        });
      }
    }

    // Resolve + validate every line item against the authoritative product
    // catalog, including live stock availability. Checked before the
    // payment-gateway-configured gate below — no point discussing payment
    // for something that's out of stock anyway.
    const resolvedItems = [];
    for (const raw of rawItems) {
      const product = await catalog.getProductById(raw.productId);
      if (!product) {
        return res.status(404).json({ error: `Product ${raw.productId} was not found.` });
      }
      const qty = Math.max(1, Math.min(MAX_QTY_PER_ITEM, Number(raw.quantity) || 1));

      // eslint-disable-next-line no-await-in-loop
      const available = await getStock(product.id);
      if (available < qty) {
        return res.status(409).json({
          error:
            available === 0
              ? `Sorry, "${product.name}" is currently out of stock.`
              : `Sorry, only ${available} unit(s) of "${product.name}" are left in stock.`,
          code: 'INSUFFICIENT_STOCK',
          productId: product.id,
          availableQuantity: available,
        });
      }

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

    if (!isConfigured) {
      return res.status(503).json({
        error:
          'Payment gateway is not configured yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to backend/.env (see .env.example).',
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
        customerType,
        gstNumber: gstNumber || 'N/A',
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
      customerType,
      // Only ever stored for B2B — a B2C order must never carry a GST number.
      gstNumber: customerType === 'B2B' ? gstNumber : '',
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
      customerType,
      gstNumber: customerType === 'B2B' ? gstNumber : '',
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

    const order = await ordersDb.findOneAsync({ razorpayOrderId: razorpay_order_id });

    await ordersDb.updateAsync(
      { razorpayOrderId: razorpay_order_id },
      { $set: { status: 'paid', razorpayPaymentId: razorpay_payment_id, paidAt: new Date().toISOString() } }
    );

    // Reduce stock for every item in the order, and queue each change for
    // Tally sync. Done after marking the order paid (not at create-order
    // time) so an abandoned/unpaid order never touches real inventory.
    // Failures here are logged but don't fail the payment response — the
    // customer already paid, this must never block that confirmation.
    if (order && Array.isArray(order.items)) {
      for (const item of order.items) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await adjustStock(item.productId, -item.quantity);
          // eslint-disable-next-line no-await-in-loop
          await queueAndSyncStockChange({
            productId: item.productId,
            productName: item.name,
            quantity: item.quantity,
            isIncrease: false,
            reason: 'sale',
            orderId: razorpay_order_id,
          });
        } catch (stockErr) {
          console.error(`Stock update failed for product ${item.productId} on order ${razorpay_order_id}:`, stockErr);
        }
      }
    }

    res.json({ verified: true, message: 'Payment verified successfully.' });
  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ error: 'Unable to verify payment right now.' });
  }
});

module.exports = router;
