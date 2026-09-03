const express = require('express');
const router = express.Router();
const catalog = require('../utils/catalog');
const { tallySyncQueueDb } = require('../db');
const { requireAdmin, requireTallySyncAuth } = require('../middleware/auth');
const { requireOrganizationId } = require('../middleware/organization');
const { rateLimitByOrganization } = require('../middleware/rateLimit');
const { getAllStockLevels, adjustStock } = require('../utils/stock');
const { queueAndSyncStockChange, attemptSync } = require('../utils/tally');
const { ok, fail, ERROR_CODES } = require('../utils/apiResponse');
const { paginate } = require('../utils/pagination');

// Stock levels and stock changes are this app's analogue of Zoho Inventory's
// "Inventory Adjustments" resource — organization-scoped and rate-limited
// like the rest of that surface (https://www.zoho.com/inventory/api/v1/introduction/#overview).
// The Tally-bridge queue endpoints below (queue/ack/retry) have no Zoho
// analogue and keep their existing shape/auth.
const scoped = [requireAdmin, requireOrganizationId, rateLimitByOrganization];

// GET /api/admin/stock?page=1&per_page=25 — current stock level for every product
router.get('/stock', ...scoped, async (req, res) => {
  try {
    const levels = await getAllStockLevels();
    const { items, page_context } = paginate(levels, req, { reportName: 'InventoryAdjustments' });
    ok(res, items, 'success', 200, { page_context });
  } catch (err) {
    console.error('Get stock levels error:', err);
    fail(res, 500, 'Unable to fetch stock levels right now.', ERROR_CODES.SERVER_ERROR);
  }
});

// POST /api/admin/stock/add  { productId, quantity }
// Increases stock for a product and queues the change for Tally sync.
router.post('/stock/add', ...scoped, async (req, res) => {
  try {
    const productId = Number(req.body.productId);
    const quantity = Number(req.body.quantity);

    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      return fail(res, 400, 'productId and a positive quantity are required.', ERROR_CODES.VALIDATION);
    }
    const product = await catalog.getProductById(productId);
    if (!product) {
      return fail(res, 404, 'Product not found.', ERROR_CODES.NOT_FOUND);
    }

    const newQuantity = await adjustStock(productId, quantity);
    const { queueEntry, result } = await queueAndSyncStockChange({
      productId,
      productName: product.name,
      quantity,
      isIncrease: true,
      reason: 'restock',
    });

    ok(
      res,
      {
        productId,
        productName: product.name,
        addedQuantity: quantity,
        newQuantity,
        tallySync: { status: queueEntry.status === 'pending' && result.success ? 'synced' : queueEntry.status, error: result.error || null },
      },
      'The inventory adjustment has been recorded.',
      201
    );
  } catch (err) {
    console.error('Add stock error:', err);
    fail(res, 500, 'Unable to add stock right now.', ERROR_CODES.SERVER_ERROR);
  }
});

// GET /api/admin/tally/queue?status=pending  (admin only, or sync agent key)
router.get('/tally/queue', requireTallySyncAuth, async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const entries = await tallySyncQueueDb.findAsync(filter).sort({ createdAt: -1 });
    res.json({ count: entries.length, entries });
  } catch (err) {
    console.error('Get tally queue error:', err);
    res.status(500).json({ error: 'Unable to fetch the Tally sync queue right now.' });
  }
});

// POST /api/admin/tally/queue/:id/ack  { success, error }  (sync agent key, or admin)
// Called by tally-sync-agent.js after it pushes an entry into local Tally
// itself, to report back whether that succeeded.
router.post('/tally/queue/:id/ack', requireTallySyncAuth, async (req, res) => {
  try {
    const { success, error } = req.body;
    await tallySyncQueueDb.updateAsync(
      { _id: req.params.id },
      {
        $set: {
          status: success ? 'synced' : 'failed',
          lastError: success ? null : error || 'Sync agent reported failure.',
          syncedAt: success ? new Date().toISOString() : null,
        },
        $inc: { attempts: 1 },
      }
    );
    res.json({ acknowledged: true });
  } catch (err) {
    console.error('Ack tally queue error:', err);
    res.status(500).json({ error: 'Unable to update the Tally sync queue right now.' });
  }
});

// POST /api/admin/tally/retry  (admin only)
// Re-attempts a direct push to Tally for every pending entry. Useful when
// this server and Tally ARE on the same network/reachable, or to clear the
// queue after fixing a Stock Item name mismatch.
router.post('/tally/retry', requireAdmin, async (req, res) => {
  try {
    const pending = await tallySyncQueueDb.findAsync({ status: 'pending' });
    const results = [];
    for (const entry of pending) {
      // eslint-disable-next-line no-await-in-loop
      const result = await attemptSync(entry);
      results.push({ id: entry._id, productName: entry.productName, ...result });
    }
    const succeeded = results.filter((r) => r.success).length;
    res.json({ attempted: results.length, succeeded, failed: results.length - succeeded, results });
  } catch (err) {
    console.error('Retry tally sync error:', err);
    res.status(500).json({ error: 'Unable to retry Tally sync right now.' });
  }
});

module.exports = router;
