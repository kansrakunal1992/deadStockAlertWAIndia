// =============================================================================
// lib/metaClient.js — Meta WhatsApp Cloud API client
// =============================================================================

'use strict';

const axios = require('axios');

const META_VER      = () => process.env.META_API_VERSION    || 'v20.0';
const META_TOKEN    = () => process.env.META_ACCESS_TOKEN   || '';
const META_PHONE_ID = () => process.env.META_PHONE_NUMBER_ID || '';

// ---------------------------------------------------------------------------
// Dedup cache — Meta delivers each webhook event to multiple IPs in parallel.
// Same wamid arriving within DEDUP_TTL_MS is a duplicate — ACK and skip.
// ---------------------------------------------------------------------------
const DEDUP_TTL_MS = 30_000;
const _seenWamids  = new Map(); // wamid -> timestamp

function _markSeen(wamid) {
  _seenWamids.set(wamid, Date.now());
  // GC: purge entries older than TTL
  if (_seenWamids.size > 5000) {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [k, ts] of _seenWamids) {
      if (ts < cutoff) _seenWamids.delete(k);
    }
  }
}

function _isDuplicate(wamid) {
  const ts = _seenWamids.get(wamid);
  return ts && (Date.now() - ts) < DEDUP_TTL_MS;
}

// ---------------------------------------------------------------------------
// normalizeMetaRequest(req)
//
// Reshapes Meta Cloud API POST body into Twilio-style flat fields that
// the rest of whatsapp.js already reads:
//
//   req.body.From              — "whatsapp:+919876543210"
//   req.body.Body              — "Ramesh 200 udhaar"
//   req.body.WaId              — "919876543210"
//   req.body.NumMedia          — "1" or "0"
//   req.body.MediaUrl0         — "meta:MEDIA_ID" or ""
//   req.body.MediaContentType0 — "audio/ogg; codecs=opus" or ""
//   req.body._metaMessageId    — wamid.xxx
//   req.body._isMetaPayload    — true
//   req.body._isDuplicate      — true if same wamid already processing
// ---------------------------------------------------------------------------
function normalizeMetaRequest(req) {
  if (!req || !req.body) return;
  if (req.body._isMetaPayload || req.body.From) return;

  try {
    const entry  = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value  = change?.value;
    const msgArr = value?.messages;

    // Status update (delivered/read receipt) — no message array
    if (!msgArr || msgArr.length === 0) {
      req.body.From           = '';
      req.body.Body           = '';
      req.body.WaId           = '';
      req.body.NumMedia       = '0';
      req.body._isMetaPayload = true;
      return;
    }

    const msg    = msgArr[0];
    const wamid  = msg.id || '';

    // Dedup check — same message delivered twice in parallel
    if (wamid && _isDuplicate(wamid)) {
      req.body.From           = '';
      req.body.Body           = '';
      req.body.WaId           = '';
      req.body.NumMedia       = '0';
      req.body._isMetaPayload = true;
      req.body._isDuplicate   = true;
      console.log(`[metaClient] duplicate wamid suppressed: ${wamid}`);
      return;
    }

    // Mark as seen before any async work
    if (wamid) _markSeen(wamid);

    const rawFrom = String(msg.from || '');
    const digits  = rawFrom.replace(/\D+/g, '');
    const e164    = digits.startsWith('91') && digits.length >= 12
      ? `+${digits}`
      : `+91${digits}`;

    req.body.From            = `whatsapp:${e164}`;
    req.body.WaId            = digits;
    req.body._metaMessageId  = wamid;
    req.body._isMetaPayload  = true;

    const msgType = String(msg.type || 'text');

    if (msgType === 'text') {
      req.body.Body              = String(msg.text?.body || '');
      req.body.NumMedia          = '0';
      req.body.MediaUrl0         = '';
      req.body.MediaContentType0 = '';
      return;
    }

    if (msgType === 'audio') {
      const audio = msg.audio || {};
      req.body.Body              = '';
      req.body.NumMedia          = '1';
      req.body.MediaUrl0         = audio.id ? `meta:${audio.id}` : '';
      req.body.MediaContentType0 = audio.mime_type || 'audio/ogg; codecs=opus';
      return;
    }

    if (msgType === 'image') {
      const image = msg.image || {};
      req.body.Body              = image.caption || '';
      req.body.NumMedia          = '1';
      req.body.MediaUrl0         = image.id ? `meta:${image.id}` : '';
      req.body.MediaContentType0 = image.mime_type || 'image/jpeg';
      return;
    }

    if (msgType === 'button') {
      req.body.Body              = String(msg.button?.text || msg.button?.payload || '');
      req.body.NumMedia          = '0';
      req.body.MediaUrl0         = '';
      req.body.MediaContentType0 = '';
      return;
    }

    if (msgType === 'interactive') {
      const ia = msg.interactive || {};
      const replyText =
        ia.button_reply?.title ||
        ia.list_reply?.title   ||
        ia.button_reply?.id    ||
        ia.list_reply?.id      || '';
      req.body.Body              = String(replyText);
      req.body.NumMedia          = '0';
      req.body.MediaUrl0         = '';
      req.body.MediaContentType0 = '';
      return;
    }

    // Fallback — unknown type
    req.body.Body              = '';
    req.body.NumMedia          = '0';
    req.body.MediaUrl0         = '';
    req.body.MediaContentType0 = '';

  } catch (e) {
    console.warn('[metaClient] normalizeMetaRequest error:', e?.message);
  }
}

// ---------------------------------------------------------------------------
// resolveMetaMediaUrl — exchanges Meta media ID for download URL
// ---------------------------------------------------------------------------
async function resolveMetaMediaUrl(mediaId) {
  const { data } = await axios.get(
    `https://graph.facebook.com/${META_VER()}/${mediaId}`,
    { headers: { Authorization: `Bearer ${META_TOKEN()}` }, timeout: 8000 }
  );
  if (!data?.url) throw new Error(`No URL for meta media ID: ${mediaId}`);
  return data.url;
}

// ---------------------------------------------------------------------------
// downloadMetaMedia — downloads media binary (handles "meta:ID" or HTTPS URL)
// ---------------------------------------------------------------------------
async function downloadMetaMedia(urlOrMetaId) {
  let url = urlOrMetaId;
  if (String(urlOrMetaId).startsWith('meta:')) {
    const mediaId = String(urlOrMetaId).slice(5);
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
// sendTextMessage — plain text outbound via Meta Graph API
// ---------------------------------------------------------------------------
async function sendTextMessage(to, body) {
  const phone = String(to).replace('whatsapp:', '');
  if (!META_TOKEN())    throw new Error('META_ACCESS_TOKEN not set');
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
// markRead — sends a read receipt for a given wamid (non-blocking)
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
