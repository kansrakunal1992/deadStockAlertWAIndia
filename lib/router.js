'use strict';
// =============================================================================
// lib/router.js — Inbound WhatsApp Actor Router
//
// Every inbound message hits this router first.
// It answers one question: WHO sent this message?
//
//   1. Owner   — inbound phone is a registered shop (isUserAuthorized returns success)
//               → pass to existing whatsapp.js handler as normal
//
//   2. Customer — message body starts with "BAAKI <code>" or "BALANCE <code>"
//               → extract shop code, resolve shopId, call customerHandler
//
//   3. Distributor — message body starts with "INV <code>"
//               → extract shop code, resolve shopId, call distributorHandler
//
//   4. Unknown — not a registered owner, no recognizable code
//               → reply with a short help message
//
// All existing owner flows are UNCHANGED — router is a thin pre-processor.
// =============================================================================

const { isUserAuthorized } = require('../database');
const { resolveShopCode, extractShopCode } = require('./shopCode');

// ---------------------------------------------------------------------------
// Actor type constants
// ---------------------------------------------------------------------------
const ACTOR = {
  OWNER:       'owner',
  CUSTOMER:    'customer',
  DISTRIBUTOR: 'distributor',
  UNKNOWN:     'unknown',
};

// ---------------------------------------------------------------------------
// Keyword matchers
// ---------------------------------------------------------------------------
const CUSTOMER_KEYWORDS  = /^\s*(baaki|balance|bakaya|hisab|kitna|udhar|udhaar)\b/i;
const DISTRIBUTOR_KEYWORDS = /^\s*(inv|invoice|rasid|bill)\b/i;

// ---------------------------------------------------------------------------
// identifyActor
// Returns { actor, shopId, shopCode } where shopId is the SHOP BEING SERVED
// (not the sender — for customer/distributor flows these differ).
// ---------------------------------------------------------------------------
async function identifyActor(fromRaw, messageBody) {
  const from    = normalizeFrom(fromRaw);   // +91XXXXXXXXXX (sender)
  const body    = String(messageBody ?? '').trim();
  const bodyUp  = body.toUpperCase();

  // ── Step 1: Is the sender a registered owner? ──────────────────────────
  try {
    const auth = await isUserAuthorized(from);
    if (auth?.success) {
      return { actor: ACTOR.OWNER, shopId: from, shopCode: null, senderId: from };
    }
  } catch (_) { /* fall through */ }

  // ── Step 2: Does the message contain a shop code? ──────────────────────
  const code = extractShopCode(body);

  if (code) {
    const shopId = await resolveShopCode(code);

    if (!shopId) {
      // Code doesn't resolve — unknown
      return { actor: ACTOR.UNKNOWN, shopId: null, shopCode: code, senderId: from };
    }

    // Determine customer vs distributor by keyword prefix
    if (CUSTOMER_KEYWORDS.test(bodyUp)) {
      return { actor: ACTOR.CUSTOMER, shopId, shopCode: code, senderId: from };
    }

    if (DISTRIBUTOR_KEYWORDS.test(bodyUp)) {
      return { actor: ACTOR.DISTRIBUTOR, shopId, shopCode: code, senderId: from };
    }

    // Has a valid code but no keyword — treat as customer balance check by default
    return { actor: ACTOR.CUSTOMER, shopId, shopCode: code, senderId: from };
  }

  // ── Step 3: No owner, no code — unknown sender ─────────────────────────
  return { actor: ACTOR.UNKNOWN, shopId: null, shopCode: null, senderId: from };
}

// ---------------------------------------------------------------------------
// buildUnknownReply
// Sent when a message doesn't match any known actor pattern.
// Short, friendly, bilingual.
// ---------------------------------------------------------------------------
function buildUnknownReply() {
  return [
    'Saamagrii AI — aapka WhatsApp dukaan assistant.',
    '',
    'Apne shopkeeper se link maangein unke khate ka, ya',
    'type karein: *BAAKI S1234* (apna shop code daalo).',
    '',
    'Saamagrii AI — your WhatsApp shop assistant.',
    'Ask your shopkeeper for their Saamagrii link.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------
function normalizeFrom(raw) {
  const s = String(raw ?? '').replace(/^whatsapp:/, '').trim();
  const digits = s.replace(/\D+/g, '');
  if (!digits) return s;
  const canon = (digits.startsWith('91') && digits.length >= 12)
    ? digits.slice(2) : digits.replace(/^0+/, '');
  return `+91${canon}`;
}

module.exports = { identifyActor, buildUnknownReply, ACTOR };
