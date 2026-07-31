const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { usersDb, ordersDb } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { toWhatsAppAddress } = require('../utils/whatsapp');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Emails listed here (comma-separated in .env) are automatically granted
// admin access on registration — e.g. ADMIN_EMAILS=owner@khuranakitchenware.com
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    isAdmin: !!user.isAdmin,
    createdAt: user.createdAt,
  };
}

async function hasClaimedFirstOrderDiscount(userId) {
  const paidOrderCount = await ordersDb.countAsync({ userId, status: 'paid' });
  return paidOrderCount > 0;
}

// POST /api/auth/register  { name, email, password, phone }
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password || !phone) {
      return res.status(400).json({ error: 'Name, email, phone and password are required.' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (!toWhatsAppAddress(phone)) {
      return res.status(400).json({ error: 'Please provide a valid 10-digit Indian mobile number.' });
    }

    const existing = await usersDb.findOneAsync({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const isAdmin = ADMIN_EMAILS.includes(email.toLowerCase());
    const user = await usersDb.insertAsync({
      name,
      email: email.toLowerCase(),
      phone: String(phone).replace(/\D/g, '').slice(-10),
      passwordHash,
      isAdmin,
      createdAt: new Date().toISOString(),
    });

    const token = signToken(user);
    res.status(201).json({
      token,
      user: toPublicUser(user),
      message: 'Welcome to Khurana Kitchenware! Enjoy an extra 5% off your first order.',
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Unable to create your account right now. Please try again.' });
  }
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await usersDb.findOneAsync({ email: String(email).toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = signToken(user);
    res.json({ token, user: toPublicUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Unable to log in right now. Please try again.' });
  }
});

// GET /api/auth/me  (requires Bearer token)
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await usersDb.findOneAsync({ _id: req.userId });
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    const discountClaimed = await hasClaimedFirstOrderDiscount(user._id);
    res.json({
      user: toPublicUser(user),
      firstOrderDiscountAvailable: !discountClaimed,
    });
  } catch (err) {
    console.error('Fetch profile error:', err);
    res.status(500).json({ error: 'Unable to fetch your profile right now.' });
  }
});

module.exports = router;
