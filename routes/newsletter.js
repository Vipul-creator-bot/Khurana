const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const SUBSCRIBERS_FILE = path.join(__dirname, '..', 'data', 'newsletter-subscribers.json');

function readSubscribers() {
  if (!fs.existsSync(SUBSCRIBERS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeSubscribers(list) {
  fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(list, null, 2));
}

router.post('/', (req, res) => {
  const { email } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address' });
  }

  const subscribers = readSubscribers();
  if (subscribers.some((s) => s.email.toLowerCase() === email.toLowerCase())) {
    return res.status(200).json({ message: "You're already subscribed!" });
  }
  subscribers.push({ email, subscribedAt: new Date().toISOString() });
  writeSubscribers(subscribers);
  res.status(201).json({ message: 'Subscribed successfully!' });
});

module.exports = router;
