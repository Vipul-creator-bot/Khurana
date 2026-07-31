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

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
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
});
