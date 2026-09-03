const http = require('http');
const { tallySyncQueueDb } = require('../db');

// Tally has no REST API or webhooks — it exposes an XML-over-HTTP gateway
// (default port 9000) that only answers while Tally itself is open with
// "Enable HTTP Server" turned on (F1 > Settings > Advanced Configuration).
//
// IMPORTANT — network reachability: this server (wherever it's hosted, e.g.
// Hostinger) can only reach Tally directly if TALLY_HOST/TALLY_PORT point to
// a machine it can actually connect to. If Tally runs on a PC at your shop
// and this backend runs on the internet, they generally CANNOT talk to each
// other directly — you'd need a VPN/site-to-site tunnel, or (simpler, and
// what this module supports out of the box) run tally-sync-agent.js on the
// same machine/network as Tally. That agent polls this server's sync queue
// over the internet and pushes into your local Tally itself. See the
// README's "Tally integration" section for setup.
const TALLY_HOST = process.env.TALLY_HOST || 'localhost';
const TALLY_PORT = Number(process.env.TALLY_PORT) || 9000;
const TALLY_COMPANY = process.env.TALLY_COMPANY || ''; // optional; blank = Tally's currently loaded company
const REQUEST_TIMEOUT_MS = 5000;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tallyDate(isoDateString) {
  // Tally wants YYYYMMDD
  return isoDateString.slice(0, 10).replace(/-/g, '');
}

/**
 * Builds a Stock Journal voucher XML — Tally's standard mechanism for a pure
 * stock quantity adjustment (unlike Sales/Purchase vouchers, it doesn't
 * require party or sales ledger masters to already exist, just the Stock
 * Item itself). Positive quantity = stock increase (destination), negative
 * = stock decrease (source).
 *
 * `stockItemName` must exactly match an existing Stock Item name in Tally.
 */
function buildStockJournalXml({ stockItemName, quantity, isIncrease, narration, date }) {
  const qty = Math.abs(quantity);
  const companyTag = TALLY_COMPANY ? `<SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY)}</SVCURRENTCOMPANY>` : '';
  const entryTag = isIncrease
    ? `<ALLINVENTORYENTRIES.LIST>
         <STOCKITEMNAME>${escapeXml(stockItemName)}</STOCKITEMNAME>
         <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
         <ACTUALQTY>${qty}</ACTUALQTY>
         <BILLEDQTY>${qty}</BILLEDQTY>
       </ALLINVENTORYENTRIES.LIST>`
    : `<ALLINVENTORYENTRIES.LIST>
         <STOCKITEMNAME>${escapeXml(stockItemName)}</STOCKITEMNAME>
         <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
         <ACTUALQTY>-${qty}</ACTUALQTY>
         <BILLEDQTY>-${qty}</BILLEDQTY>
       </ALLINVENTORYENTRIES.LIST>`;

  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          ${companyTag}
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Stock Journal" ACTION="Create">
            <DATE>${tallyDate(date)}</DATE>
            <NARRATION>${escapeXml(narration)}</NARRATION>
            <VOUCHERTYPENAME>Stock Journal</VOUCHERTYPENAME>
            ${entryTag}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

/**
 * POSTs an XML envelope to Tally's HTTP gateway. Resolves to
 * { success, error? } rather than throwing — a connection failure (Tally not
 * reachable from here, most likely if this server is remotely hosted) is an
 * expected, common outcome, not a bug, so callers should handle it gracefully
 * and fall back to the sync queue.
 */
function postToTally(xml) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: TALLY_HOST,
        port: TALLY_PORT,
        method: 'POST',
        path: '/',
        headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(xml) },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          // Tally responds with its own XML; a LINEERROR tag anywhere in it
          // means Tally rejected the request (e.g. Stock Item name not found).
          if (body.includes('<LINEERROR>')) {
            const match = body.match(/<LINEERROR>(.*?)<\/LINEERROR>/);
            resolve({ success: false, error: match ? match[1] : 'Tally rejected the request.' });
          } else {
            resolve({ success: true });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: `Timed out connecting to Tally at ${TALLY_HOST}:${TALLY_PORT}.` });
    });
    req.on('error', (err) => {
      resolve({ success: false, error: `Could not reach Tally at ${TALLY_HOST}:${TALLY_PORT} (${err.code || err.message}).` });
    });
    req.write(xml);
    req.end();
  });
}

/**
 * Records a stock change and queues it for Tally sync. Always succeeds at
 * the queue-insert step (that's just local disk I/O); the live push to
 * Tally is attempted immediately as a best effort, and the queue entry's
 * status reflects whether that succeeded — 'synced' if Tally answered
 * directly, 'pending' if not (most common when this server is remote from
 * Tally), letting tally-sync-agent.js or a manual retry pick it up later.
 */
async function queueAndSyncStockChange({ productId, productName, quantity, isIncrease, reason, orderId }) {
  const queueEntry = await tallySyncQueueDb.insertAsync({
    productId,
    productName,
    quantity,
    isIncrease,
    reason, // 'restock' | 'sale'
    orderId: orderId || null,
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    syncedAt: null,
  });

  const result = await attemptSync(queueEntry);
  return { queueEntry, result };
}

async function attemptSync(queueEntry) {
  const xml = buildStockJournalXml({
    stockItemName: queueEntry.productName,
    quantity: queueEntry.quantity,
    isIncrease: queueEntry.isIncrease,
    narration: queueEntry.reason === 'sale'
      ? `Sale — Order ${queueEntry.orderId || ''}`.trim()
      : 'Stock added via Khurana Kitchenware admin panel',
    date: queueEntry.createdAt,
  });

  const result = await postToTally(xml);

  await tallySyncQueueDb.updateAsync(
    { _id: queueEntry._id },
    {
      $set: {
        status: result.success ? 'synced' : 'pending',
        lastError: result.success ? null : result.error,
        syncedAt: result.success ? new Date().toISOString() : null,
      },
      $inc: { attempts: 1 },
    }
  );

  return result;
}

module.exports = { buildStockJournalXml, postToTally, queueAndSyncStockChange, attemptSync, TALLY_HOST, TALLY_PORT };
