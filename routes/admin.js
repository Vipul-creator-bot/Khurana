const express = require('express');
const router = express.Router();
const { usersDb } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { sendWhatsAppMessage, isConfigured } = require('../utils/whatsapp');

function toMemberSummary(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    createdAt: user.createdAt,
  };
}

// GET /api/admin/members  (admin only)
router.get('/members', requireAdmin, async (req, res) => {
  try {
    const users = await usersDb.findAsync({});
    res.json({ count: users.length, members: users.map(toMemberSummary) });
  } catch (err) {
    console.error('List members error:', err);
    res.status(500).json({ error: 'Unable to fetch members right now.' });
  }
});

// POST /api/admin/broadcast/whatsapp  { message }  (admin only)
// Sends a WhatsApp message to every registered member with a phone number.
// Sends are attempted sequentially and independently — one failed number
// (invalid, opted out, etc.) doesn't stop the rest of the broadcast.
router.post('/broadcast/whatsapp', requireAdmin, async (req, res) => {
  try {
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ error: 'Please enter a message to broadcast.' });
    }
    if (message.length > 1600) {
      return res.status(400).json({ error: 'Message is too long (max 1600 characters).' });
    }
    if (!isConfigured) {
      return res.status(503).json({
        error:
          'WhatsApp is not configured yet. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM to backend/.env (see .env.example).',
      });
    }

    const members = await usersDb.findAsync({});
    const withPhone = members.filter((m) => m.phone);

    const results = [];
    for (const member of withPhone) {
      // eslint-disable-next-line no-await-in-loop
      const result = await sendWhatsAppMessage(member.phone, message);
      results.push({ memberId: member._id, name: member.name, phone: member.phone, ...result });
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    res.json({
      totalMembers: members.length,
      eligible: withPhone.length,
      sent,
      failedCount: failed.length,
      failed: failed.map(({ memberId, name, phone, error }) => ({ memberId, name, phone, error })),
    });
  } catch (err) {
    console.error('Broadcast error:', err);
    res.status(500).json({ error: 'Unable to send the broadcast right now. Please try again.' });
  }
});

module.exports = router;
