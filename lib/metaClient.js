// =============================================================================
// lib/metaClient.js — Meta WhatsApp Cloud API client
// Drop-in for Twilio. Used by whatsapp.js for outbound sends.
//
// Env vars required:
//   META_ACCESS_TOKEN      permanent system user token
//   META_PHONE_NUMBER_ID   15-digit number ID from Meta portal
//   META_API_VERSION       e.g. v20.0 (default)
// =============================================================================

'use strict';

const axios = require('axios');

const META_VER = () => process.env.META_API_VERSION || 'v20.0';
const META_TOKEN = () => process.env.META_ACCESS_TOKEN || '';
const META_PHONE_ID = () => process.env.META_PHONE_NUMBER_ID || '';

// ---------------------------------------------------------------------------
// normalizeMetaRequest(req)
//
// Call this ONCE at the top of whatsappHandler before any field reads.
// Reshapes a Meta Cloud API POST body into the Twilio-style flat fields
// that the rest of whatsapp.js already reads:
//
//   req.body.From           — "whatsapp:+919876543210"
//   req.body.Body           — "Ramesh 200 udhaar"
//   req.body.WaId           — "919876543210"
//   req.body.NumMedia       — "1" or "0"
//   req.body.MediaUrl0      — CDN URL for audio/image (needs Bearer token)
//   req.body.MediaContentType0 — "audio/ogg; codecs=opus"
//   req.body._metaMessageId — wamid.xxx (for dedup / read receipts)
//   req.body._isMetaPayload — true (so we know not to double-normalize)
//
// Text messages, audio messages, and image messages all handled.
// Non-message events (status updates, etc.) produce empty fields — handler
// returns 200 immediately when From is empty.
// ---------------------------------------------------------------------------
function normalizeMetaRequest(req) {
  if (!req || !req.body) return;

  // Already normalized or is a Twilio form post
  if (req.body._isMetaPayload || req.body.From) return;

  try {
    const entry   = req.body?.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;
    const msgArr  = value?.messages;

    // Status update or non-message webhook — leave body as-is, handler
    // will see empty From and return 200 early.
    if (!msgArr || msgArr.length === 0) {
      req.body.From  = '';
      req.body.Body  = '';
      req.body.WaId  = '';
      req.body.NumMedia = '0';
      req.body._isMetaPayload = true;
      return;
    }

    const msg     = msgArr[0];
    const rawFrom = String(msg.from || ''); // e.g. "919876543210"

    // Normalise to E.164 with whatsapp: prefix
    const digits = rawFrom.replace(/\D+/g, '');
    const e164   = digits.startsWith('91') && digits.length >= 12
      ? `+${digits}`
      : `+91${digits}`;
    req.body.From  = `whatsapp:${e164}`;
    req.body.WaId  = digits;
    req.body._metaMessageId = msg.id || '';
    req.body._isMetaPayload = true;

    const msgType = String(msg.type || 'text');

    // ── Text ──────────────────────────────────────────────────────────────
    if (msgType === 'text') {
      req.body.Body     = String(msg.text?.body || '');
      req.body.NumMedia = '0';
      req.body.MediaUrl0 = '';
      req.body.MediaContentType0 = '';
      return;
    }

    // ── Audio / voice note ────────────────────────────────────────────────
    if (msgType === 'audio') {
      const audio = msg.audio || {};
      req.body.Body     = '';
      req.body.NumMedia = '1';
      // Store the Meta media ID — downloadAudio resolves it to a URL
      req.body.MediaUrl0 = audio.id ? `meta:${audio.id}` : '';
      req.body.MediaContentType0 = audio.mime_type || 'audio/ogg; codecs=opus';
      return;
    }

    // ── Image ─────────────────────────────────────────────────────────────
    if (msgType === 'image') {
      const image = msg.image || {};
      req.body.Body     = image.caption || '';
      req.body.NumMedia = '1';
      req.body.MediaUrl0 = image.id ? `meta:${image.id}` : '';
      req.body.MediaContentType0 = image.mime_type || 'image/jpeg';
      return;
    }

    // ── Button / quick-reply / interactive ────────────────────────────────
    if (msgType === 'button') {
      req.body.Body     = String(msg.button?.text || msg.button?.payload || '');
      req.body.NumMedia = '0';
      req.body.MediaUrl0 = '';
      req.body.MediaContentType0 = '';
      return;
    }

    if (msgType === 'interactive') {
      const interactive = msg.interactive || {};
      const replyText =
        interactive.button_reply?.title ||
        interactive.list_reply?.title   ||
        interactive.button_reply?.id    ||
        interactive.list_reply?.id      || '';
      req.body.Body     = String(replyText);
      req.body.NumMedia = '0';
      req.body.MediaUrl0 = '';
      req.body.MediaContentType0 = '';
      return;
    }

    // ── Fallback — unknown type ───────────────────────────────────────────
    req.body.Body     = '';
    req.body.NumMedia = '0';
    req.body.MediaUrl0 = '';
    req.body.MediaContentType0 = '';

  } catch (e) {
    console.warn('[metaClient] normalizeMetaRequest error:', e?.message);
  }
}

// ---------------------------------------------------------------------------
// resolveMetaMediaUrl(mediaId)
//
// Exchanges a Meta media ID for a short-lived download URL.
// Called by downloadAudio when MediaUrl0 starts with "meta:"
// ---------------------------------------------------------------------------
async function resolveMetaMediaUrl(mediaId) {
  const { data } = await axios.get(
    `https://graph.facebook.com/${META_VER()}/${mediaId}`,
    { headers: { Authorization: `Bearer ${META_TOKEN()}` }, timeout: 8000 }
  );
  if (!data?.url) throw new Error(`No URL returned for meta media ID: ${mediaId}`);
  return data.url; // short-lived HTTPS URL (~5min)
}

// ---------------------------------------------------------------------------
// downloadMetaMedia(urlOrMetaId)
//
// Downloads media binary. Handles both:
//   - "meta:MEDIA_ID" → resolves ID to URL first
//   - plain HTTPS URL → downloads directly with Bearer token
// Returns: Buffer
// ---------------------------------------------------------------------------
async function downloadMetaMedia(urlOrMetaId) {
  let url = urlOrMetaId;
  if (String(urlOrMetaId).startsWith('meta:')) {
    const mediaId = String(urlOrMetaId).slice(5); // strip "meta:"
    url = await resolveMetaMediaUrl(mediaId);
  }
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${META_TOKEN()}`,
      'User-Agent': 'Saamagrii-AI/1.0'
    }
  });
  return Buffer.from(data);
}

// ---------------------------------------------------------------------------
// sendTextMessage(to, body)
//
// Sends a plain text WhatsApp message via Meta Graph API.
// `to` — E.164 with or without whatsapp: prefix, e.g. "+919876543210"
//
// Returns the API response data object.
// ---------------------------------------------------------------------------
async function sendTextMessage(to, body) {
  const phone = String(to).replace('whatsapp:', '');

  if (!META_TOKEN()) throw new Error('META_ACCESS_TOKEN not set');
  if (!META_PHONE_ID()) throw new Error('META_PHONE_NUMBER_ID not set');

  const { data } = await axios.post(
    `https://graph.facebook.com/${META_VER()}/${META_PHONE_ID()}/messages`,
    {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: String(body) }
    },
    {
      headers: {
        Authorization: `Bearer ${META_TOKEN()}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );
  return data;
}

// ---------------------------------------------------------------------------
// markRead(messageId)
//
// Sends a read receipt for a given wamid. Optional — improves UX.
// ---------------------------------------------------------------------------
async function markRead(messageId) {
  if (!messageId || !META_TOKEN() || !META_PHONE_ID()) return;
  try {
    await axios.post(
      `https://graph.facebook.com/${META_VER()}/${META_PHONE_ID()}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      {
        headers: {
          Authorization: `Bearer ${META_TOKEN()}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );
  } catch (_) { /* non-blocking */ }
}

module.exports = {
  normalizeMetaRequest,
  resolveMetaMediaUrl,
  downloadMetaMedia,
  sendTextMessage,
  markRead
};
