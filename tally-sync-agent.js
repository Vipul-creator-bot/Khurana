#!/usr/bin/env node
/**
 * Tally sync bridge agent.
 *
 * WHY THIS EXISTS: Tally has no public API — it only answers XML-over-HTTP
 * requests from machines that can reach it directly (default port 9000).
 * If your website's backend is hosted remotely (e.g. Hostinger) and Tally
 * runs on a PC at your shop, the backend generally CANNOT talk to Tally
 * directly. This script bridges that gap: run it ON THE SAME COMPUTER (or
 * same local network) AS TALLY. It polls your hosted backend over the
 * internet for pending stock changes, and pushes each one into your LOCAL
 * Tally itself — so Tally only ever needs to accept connections from
 * localhost, never from the public internet.
 *
 * SETUP:
 *   1. Open TallyPrime → F1 (Help) → Settings → Advanced Configuration →
 *      enable the HTTP Server (default port 9000). Keep Tally open with
 *      your company loaded while this agent runs.
 *   2. Make sure every product name in data/products.json exactly matches
 *      an existing Stock Item name in Tally (case-sensitive) — Tally will
 *      reject the sync otherwise, and it'll show up as a failed entry in
 *      the admin queue view.
 *   3. Set TALLY_SYNC_API_KEY to the SAME value in both this machine's
 *      environment and your hosted backend's .env — it's how this agent
 *      authenticates without a full admin login.
 *   4. Set BACKEND_URL to your live site's API, e.g.
 *      https://api.khuranakitchenware.com
 *   5. Run: node tally-sync-agent.js   (leave it running in the background —
 *      e.g. via pm2, a Windows service, or a scheduled task, so it keeps
 *      polling even after a reboot)
 *
 * This script intentionally has no dependency on the rest of the app
 * running — it only needs Node.js and network access to both your backend
 * and your local Tally.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const SYNC_API_KEY = process.env.TALLY_SYNC_API_KEY || '';
const TALLY_HOST = process.env.TALLY_HOST || 'localhost';
const TALLY_PORT = Number(process.env.TALLY_PORT) || 9000;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 30000;

if (!SYNC_API_KEY) {
  console.error(
    'ERROR: TALLY_SYNC_API_KEY is not set. Set the same value here and in your backend .env, then re-run.'
  );
  process.exit(1);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tallyDate(isoDateString) {
  return isoDateString.slice(0, 10).replace(/-/g, '');
}

function buildStockJournalXml({ stockItemName, quantity, isIncrease, narration, date }) {
  const qty = Math.abs(quantity);
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

function postToLocalTally(xml) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: TALLY_HOST,
        port: TALLY_PORT,
        method: 'POST',
        path: '/',
        headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(xml) },
        timeout: 8000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
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
      resolve({ success: false, error: `Timed out connecting to local Tally at ${TALLY_HOST}:${TALLY_PORT}. Is Tally open with the HTTP server enabled?` });
    });
    req.on('error', (err) => {
      resolve({ success: false, error: `Could not reach local Tally at ${TALLY_HOST}:${TALLY_PORT} (${err.code || err.message}).` });
    });
    req.write(xml);
    req.end();
  });
}

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BACKEND_URL);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const req = lib.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Tally-Sync-Key': SYNC_API_KEY,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, body: null });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function pollAndSync() {
  try {
    const { status, body } = await apiRequest('GET', '/api/admin/tally/queue?status=pending');
    if (status !== 200) {
      console.error(`[${new Date().toISOString()}] Failed to fetch sync queue (HTTP ${status}). Check BACKEND_URL and TALLY_SYNC_API_KEY.`);
      return;
    }

    const entries = body?.entries || [];
    if (!entries.length) {
      console.log(`[${new Date().toISOString()}] No pending stock changes to sync.`);
      return;
    }

    console.log(`[${new Date().toISOString()}] Found ${entries.length} pending change(s) — syncing to local Tally...`);

    for (const entry of entries) {
      const xml = buildStockJournalXml({
        stockItemName: entry.productName,
        quantity: entry.quantity,
        isIncrease: entry.isIncrease,
        narration: entry.reason === 'sale' ? `Sale — Order ${entry.orderId || ''}`.trim() : 'Stock added via admin panel',
        date: entry.createdAt,
      });

      // eslint-disable-next-line no-await-in-loop
      const result = await postToLocalTally(xml);

      // eslint-disable-next-line no-await-in-loop
      await apiRequest('POST', `/api/admin/tally/queue/${entry._id}/ack`, {
        success: result.success,
        error: result.error,
      });

      if (result.success) {
        console.log(`  ✓ Synced: ${entry.productName} (${entry.isIncrease ? '+' : '-'}${entry.quantity})`);
      } else {
        console.error(`  ✗ Failed: ${entry.productName} — ${result.error}`);
      }
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Sync cycle error:`, err.message);
  }
}

console.log('Khurana Kitchenware — Tally sync agent starting.');
console.log(`Backend: ${BACKEND_URL}`);
console.log(`Local Tally: http://${TALLY_HOST}:${TALLY_PORT}`);
console.log(`Polling every ${POLL_INTERVAL_MS / 1000}s. Press Ctrl+C to stop.\n`);

pollAndSync();
setInterval(pollAndSync, POLL_INTERVAL_MS);
