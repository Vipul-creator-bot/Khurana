require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const productsRouter = require('./routes/products');
const categoriesRouter = require('./routes/categories');
const contactRouter = require('./routes/contact');
const testimonialsRouter = require('./routes/testimonials');
const faqsRouter = require('./routes/faqs');
const newsletterRouter = require('./routes/newsletter');
const paymentRouter = require('./routes/payment');
const authRouter = require('./routes/auth');
const deliveryRouter = require('./routes/delivery');
const adminRouter = require('./routes/admin');
const tallyRouter = require('./routes/tally');
const catalogRouter = require('./routes/catalog');
const howItWorksRouter = require('./routes/howItWorks');
const organizationsRouter = require('./routes/organizations');
const { ensureStockSeeded } = require('./utils/stock');
const { ensureCatalogSeeded } = require('./utils/catalog');
const { ensureHowItWorksSeeded } = require('./utils/howItWorks');
const { ensureOrganizationSeeded } = require('./utils/organization');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet({ crossOriginResourcePolicy: false }));
// CORS_ORIGIN can be a single origin or a comma-separated list (e.g. the
// apex domain plus its www subdomain) — needed now that the frontend and
// API are deployed on separate subdomains.
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : '*';
app.use(cors({ origin: corsOrigins }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', company: 'Khurana Kitchenware Private Limited', time: new Date().toISOString() });
});
app.use('/api', express.static(path.join(__dirname, 'public')));

// Serve locally uploaded images: place files in backend/public/images/...
// and reference them from the frontend/API as /images/<path>.
// e.g. backend/public/images/products/kadai.jpg -> http://localhost:4000/images/products/kadai.jpg
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

app.use('/api/products', productsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/contact', contactRouter);
app.use('/api/testimonials', testimonialsRouter);
app.use('/api/faqs', faqsRouter);
app.use('/api/newsletter', newsletterRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/auth', authRouter);
app.use('/api/delivery', deliveryRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin', tallyRouter);
app.use('/api/admin', catalogRouter);
app.use('/api/how-it-works', howItWorksRouter);
app.use('/api/organizations', organizationsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Khurana Kitchenware API running on http://localhost:${PORT}`);
  // Catalog must seed first — stock seeding reads the product list from it.
  ensureCatalogSeeded()
    .then(() => ensureStockSeeded())
    .catch((err) => console.error('Failed to seed catalog/stock:', err));
  ensureHowItWorksSeeded().catch((err) => console.error('Failed to seed how-it-works:', err));
  ensureOrganizationSeeded().catch((err) => console.error('Failed to seed organization:', err));
});
