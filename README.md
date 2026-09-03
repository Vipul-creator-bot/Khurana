# Khurana Kitchenware — Backend

Node.js / Express API for the Khurana Kitchenware website: products, categories, cart/checkout
with Razorpay, accounts with a first-order discount, Gurgaon-only delivery validation, an admin
WhatsApp broadcast, live stock tracking, and Tally sync.

## Setup

```bash
npm install
cp .env.example .env   # then fill in real values
npm start
```

Runs on `http://localhost:4000` by default (`PORT` in `.env`).

## Product & category management (admin panel)

Admins can create, edit, and delete products and categories directly from the website — including
uploading images — at `/admin` → "Catalog" tab. Changes take effect immediately, no code deploy
needed.

**This changed how the catalog is stored.** Previously, `data/products.json` and
`data/categories.json` were the live catalog, read fresh on every request. They're now only a
**one-time seed** — on first-ever startup (when the database is empty), their contents get
imported into `data/catalog-products.db` and `data/catalog-categories.db`, and from then on those
databases are the source of truth. Editing `products.json` after that first run has **no effect**
— use the admin panel (or the API directly) instead. This was necessary to make admin edits
actually persist and be queryable/editable, rather than requiring a code deploy to change a JSON
file.

**Image uploads**: saved to `public/images/products/` or `public/images/categories/` (same
convention as manually-added images described elsewhere in this README), immediately reachable
at `/images/products/<filename>` — no separate CDN or image host required. Max 8MB per file, up
to 10 files per request, JPG/PNG/WEBP/GIF only.

**Adding a new product** sets its initial stock quantity too (via the same live stock system
used elsewhere) — no separate step needed.

**Endpoints** (all admin-only, `multipart/form-data` for create/update):
- `POST /api/admin/catalog/products` — fields: `name, category, sku, price, salePrice,
  description, featured, video, initialStock`; files: `images` (up to 10)
- `PUT /api/admin/catalog/products/:id` — any field optional; new `images` files are **appended**
  to the existing gallery unless `replaceImages=true` is also sent
- `DELETE /api/admin/catalog/products/:id`
- `POST /api/admin/catalog/categories` — fields: `name, tagline, video`; files: `images`
- `PUT /api/admin/catalog/categories/:id` — same append-by-default behavior
- `DELETE /api/admin/catalog/categories/:id`

**Persistence note**: like the other `data/*.db` files, `catalog-products.db` and
`catalog-categories.db` (plus anything in `public/images/products/` and
`public/images/categories/` beyond what shipped with the repo) need to survive redeploys. Before
relying on the admin panel in production, confirm with your host (or just test it) that
redeploying doesn't wipe the `data/` and `public/images/` folders — if it does, either avoid
re-uploading over them, or plan to move to a hosted database and object storage (e.g. MongoDB
Atlas + S3/Cloudinary) before depending on this for real catalog data long-term.

## Stock tracking & Tally integration

### How stock works

Every product now has a **live stock quantity**, tracked separately from the static
`data/products.json` catalog (which still holds name/price/images — things that rarely change).
Live quantities live in `data/stock.db`.

- **On first run**, every product gets seeded with a placeholder quantity (20 units if
  `inStock` was `true` in `products.json`, 0 otherwise). **This is a placeholder, not real
  inventory data** — set your actual quantities via the admin Stock panel (`/admin` → "Stock &
  Tally" tab) or `POST /api/admin/stock/add` after deploying.
- **Stock increases** when an admin adds stock (`POST /api/admin/stock/add`).
- **Stock decreases automatically** when an order's payment is verified (`POST
  /api/payment/verify`) — one unit per item purchased, for every item in the order.
- **Checkout blocks overselling**: `POST /api/payment/create-order` checks live stock for every
  cart item before creating a Razorpay order, rejecting with `409 INSUFFICIENT_STOCK` if there
  isn't enough (a customer can't order 5 units of something with only 3 left).
- `GET /api/products` and `GET /api/products/:id` now include a `stockQuantity` field, and
  `inStock` is computed live (`stockQuantity > 0`) rather than the static flag in the JSON file.

### How Tally sync works

**The core problem**: Tally has no REST API or webhooks. It exposes an XML-over-HTTP gateway
(default port 9000) that only answers while Tally itself is open with its HTTP Server enabled —
and it only accepts connections from machines that can actually reach that port. If Tally runs on
a PC at your shop and this backend is hosted remotely (e.g. Hostinger), **they generally cannot
talk to each other directly** without a VPN/tunnel.

This is handled with a **sync queue + bridge agent** pattern, which is the standard approach for
integrating a cloud app with an on-premises Tally installation:

1. Every stock change (restock or sale) is recorded in `data/tally-sync-queue.db` and a **direct**
   push to Tally is attempted immediately (`TALLY_HOST`/`TALLY_PORT` in `.env`, default
   `localhost:9000`).
   - If this backend and Tally **are** reachable from each other (e.g. both on the same LAN, or
     you're running this backend on the same machine as Tally for testing), the push usually
     succeeds immediately and the queue entry is marked `synced`.
   - If not (the common case for a remotely-hosted backend), the push fails gracefully — this is
     expected, not a bug — and the entry stays `pending`.
2. **`tally-sync-agent.js`** is a small standalone script you run **on the same machine/network as
   Tally** (e.g. the shop's PC). It polls this backend's queue over the internet for pending
   entries, and pushes each one into your **local** Tally itself — so Tally only ever needs to
   accept connections from `localhost`, never the public internet.
3. The admin Stock panel (`/admin`) shows pending/synced counts and lets you retry a direct push
   manually.

**Setup:**

1. In TallyPrime: **F1 (Help) → Settings → Advanced Configuration → Enable HTTP Server** (port
   9000 by default). Keep Tally open with your company loaded.
2. Make sure every product name in `data/products.json` **exactly matches** an existing Stock
   Item name in Tally (case-sensitive) — the sync uses product name to identify the Stock Item,
   and Tally will reject anything it doesn't recognise.
3. Generate a shared secret: `openssl rand -hex 24`. Set it as `TALLY_SYNC_API_KEY` in **both**
   this backend's `.env` and the environment where you'll run the agent — this is how the agent
   authenticates without a full admin login (see `middleware/auth.js`'s `requireTallySyncAuth`).
4. On the shop's machine (with Tally running), copy `tally-sync-agent.js` over and run it:
   ```bash
   BACKEND_URL=https://api.khuranakitchenware.com \
   TALLY_SYNC_API_KEY=<the same secret> \
   node tally-sync-agent.js
   ```
   Leave it running (e.g. via `pm2 start tally-sync-agent.js --name tally-sync`, a Windows
   service, or a scheduled task) so it keeps syncing even after a reboot. It polls every 30
   seconds by default (`POLL_INTERVAL_MS`).

**Endpoints** (all admin-only, or accept `X-Tally-Sync-Key` for the agent):
- `GET /api/admin/stock` — current quantity for every product
- `POST /api/admin/stock/add` — `{ productId, quantity }`, increases stock and queues a Tally sync
- `GET /api/admin/tally/queue?status=pending` — list sync queue entries
- `POST /api/admin/tally/queue/:id/ack` — used by the agent to report sync success/failure
- `POST /api/admin/tally/retry` — admin-triggered retry of all pending entries (direct push)

**What gets sent to Tally**: a **Stock Journal** voucher (not a Sales voucher) for each change —
Tally's standard mechanism for a pure quantity adjustment. This was chosen deliberately over a
full Sales Voucher because it only requires the Stock Item master to exist, not a full chart of
accounts (party ledger, sales ledger, GST setup, etc.) — so it works as a simple, robust
inventory sync without assuming anything about how you've set up accounting in Tally. If you'd
prefer full sales-voucher-based accounting sync (so Tally also records revenue/GST per sale, not
just quantity), that's a bigger integration requiring your ledger names — let your developer know
and this can be extended.

**Config reference** (`.env`):
```
TALLY_HOST=localhost       # only relevant if this backend can reach Tally directly
TALLY_PORT=9000
TALLY_COMPANY=             # optional; blank = Tally's currently open company
TALLY_SYNC_API_KEY=        # shared secret for tally-sync-agent.js — generate with openssl rand -hex 24
```

## Inventory API conventions (modeled on Zoho Inventory)

The inventory-management surface — organizations, catalog items/categories, and stock —
follows the same API conventions as [Zoho Inventory's REST
API](https://www.zoho.com/inventory/api/v1/introduction/#overview), adapted for a
single-tenant app. This covers `routes/organizations.js`, `routes/catalog.js`, and the
`/stock` endpoints in `routes/tally.js`. It does **not** cover the public storefront reads
(`/api/products`, `/api/categories`), or the other `/api/admin/*` endpoints (members,
broadcast, how-it-works, and the Tally-bridge queue/ack/retry endpoints) — those keep their
original, simpler response shape since they have no real Zoho Inventory analogue.

- **Organization scoping**: every request needs an `organization_id`, just like Zoho requires
  for every API call. Get it once via `GET /api/organizations` (admin-only, or the Tally sync
  key), then pass it on every subsequent request as either a `?organization_id=` query param
  or an `X-Organization-Id` header. This app is single-tenant, so there's exactly one
  organization — it's generated automatically on first boot (see `utils/organization.js`,
  `data/organization.db`) rather than requiring manual setup. Missing/invalid IDs get a `400`
  with `code: 20` (missing) or `code: 21` (invalid).
- **Response envelope**: every response is `{ code, message, data }` — `code: 0` on success,
  non-zero on error, with the payload under `data` (see `utils/apiResponse.js`). This matches
  the shape described in Zoho's overview.
- **Pagination**: list endpoints (`GET /api/admin/catalog/products`, `.../categories`,
  `GET /api/admin/stock`) accept `?page=` and `?per_page=` (max 200, default 25) and return a
  `page_context: { page, per_page, has_more_page, report_name }` alongside `data` — Zoho's
  pagination convention (see `utils/pagination.js`).
- **Rate limiting**: 100 requests/minute per organization, matching Zoho's documented limit.
  Exceeding it returns `429` with `code: 429` and a `Retry-After` header (see
  `middleware/rateLimit.js`). It's an in-memory counter — fine for this single-process app, but
  won't coordinate across multiple instances if you ever scale horizontally.

**Endpoints added/changed by this**:
- `GET /api/organizations` — look up the organization_id (admin JWT or Tally sync key)
- `GET /api/admin/catalog/products` / `GET /api/admin/catalog/categories` — new paginated list
  endpoints (previously only the public `/api/products` / `/api/categories` existed)
- `POST`/`PUT`/`DELETE /api/admin/catalog/products` and `/categories` — same behavior as
  before, now organization-scoped and enveloped
- `GET /api/admin/stock` and `POST /api/admin/stock/add` — same behavior as before, now
  organization-scoped, enveloped, and (for `GET`) paginated

The Angular admin panel's `AdminService` (`KhuranaFrontend/.../core/services/admin.service.ts`)
handles the organization_id lookup/caching and envelope unwrapping internally — components
consume the same plain interfaces as before, nothing else in the frontend needed to change.

## Other features

See inline comments in `routes/` and `utils/` for the Razorpay checkout flow, Gurgaon-only
delivery validation (`utils/geo.js`), first-order discount logic, and the WhatsApp broadcast
(`utils/whatsapp.js`, via Twilio).
