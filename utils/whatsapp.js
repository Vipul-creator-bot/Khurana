const twilio = require('twilio');

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
// Twilio's WhatsApp sandbox number by default — replace with your approved
// WhatsApp Business number once you move off the sandbox in production.
const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

const isConfigured = Boolean(ACCOUNT_SID && AUTH_TOKEN);
const client = isConfigured ? twilio(ACCOUNT_SID, AUTH_TOKEN) : null;

// Human-readable hints for the Twilio error codes you'll actually hit while
// testing on the WhatsApp sandbox. Full reference:
// https://www.twilio.com/docs/api/errors
const KNOWN_ERROR_HINTS = {
  20003: 'Authentication failed — TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN in backend/.env is incorrect.',
  21211: "Invalid 'To' phone number — check the member's phone number is a real, correctly formatted number.",
  21608: 'This number is unverified. On a Twilio trial account, you can only send to numbers you\'ve manually verified in the Twilio Console (Console → Phone Numbers → Verified Caller IDs).',
  63007: "No matching WhatsApp sender found — TWILIO_WHATSAPP_FROM in backend/.env doesn't match an active WhatsApp sender on your account (check it's exactly what the Twilio Console sandbox page shows, including the 'whatsapp:' prefix).",
  63015: 'This recipient has not joined your Twilio Sandbox yet — on the sandbox tier, every recipient must first send your join code (shown in Twilio Console → Messaging → Try it out → Send a WhatsApp message) to your sandbox number on WhatsApp once, before they can receive anything.',
  63016: 'Outside the 24-hour session window — the sandbox only allows freeform messages within 24 hours of the recipient last messaging you. Have them re-send the join code, or use an approved message template in production.',
};

// Normalizes an Indian mobile number into WhatsApp's required E.164-ish
// "whatsapp:+91XXXXXXXXXX" format. Accepts numbers typed with spaces,
// dashes, a leading 0, or an existing +91/91 prefix.
function toWhatsAppAddress(rawPhone) {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 10) return `whatsapp:+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `whatsapp:+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `whatsapp:+${digits}`;
  return null; // not a recognizable Indian mobile number — caller should skip it
}

// Sends one WhatsApp message. Resolves with { success, error? } rather than
// throwing, so a caller broadcasting to many recipients can continue past
// individual failures (invalid number, opted-out recipient, etc.).
async function sendWhatsAppMessage(rawPhone, message) {
  if (!isConfigured) {
    return { success: false, error: 'WhatsApp is not configured (missing Twilio credentials).' };
  }
  const to = toWhatsAppAddress(rawPhone);
  if (!to) {
    return { success: false, error: 'Invalid or unrecognized phone number.' };
  }
  try {
    await client.messages.create({ from: WHATSAPP_FROM, to, body: message });
    return { success: true };
  } catch (err) {
    // Log the full Twilio error server-side (code, status, full message) so
    // it's visible in the terminal even though the API response to the
    // frontend stays a short, friendly string.
    console.error(`WhatsApp send failed for ${to}: [${err.code}] ${err.message}`, err.moreInfo || '');
    const hint = KNOWN_ERROR_HINTS[err.code];
    const error = hint ? `${hint} (Twilio error ${err.code})` : err.message || 'Failed to send message.';
    return { success: false, error };
  }
}

module.exports = { sendWhatsAppMessage, toWhatsAppAddress, isConfigured };
