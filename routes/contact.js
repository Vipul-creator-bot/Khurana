const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const SUBMISSIONS_FILE = path.join(__dirname, '..', 'data', 'contact-submissions.json');

function readSubmissions() {
  if (!fs.existsSync(SUBMISSIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeSubmissions(list) {
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(list, null, 2));
}

// POST /api/contact
router.post('/', (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email and message are required' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address' });
  }

  const submissions = readSubmissions();
  const entry = {
    id: submissions.length ? submissions[submissions.length - 1].id + 1 : 1,
    name,
    email,
    phone: phone || '',
    subject: subject || 'General Enquiry',
    message,
    createdAt: new Date().toISOString(),
  };
  submissions.push(entry);
  writeSubmissions(submissions);

  res.status(201).json({ message: 'Thank you! Your message has been received. Our team will get back to you shortly.', submission: entry });
});

module.exports = router;
