// =============================================================================
// billTrigger.js — Saamagrii.AI Bill Intent Router
// Intercepts "bill"/"rasid"/"receipt" in any language, generates PDF invoice,
// sends via WhatsApp, returns "forward karo" confirmation.
//
// Place: /api/billTrigger.js (same folder as whatsapp.js and udhaar.js)
// Called from: whatsapp.js handleNewInteraction — BEFORE inventory parsing
//
// Integration point in whatsapp.js (add after udhaar check, before sticky):
//   const { handleBillRequest } = require('./billTrigger');
//   const billResult = await handleBillRequest(shopId, From, Body, detectedLanguage, requestId);
//   if (billResult.handled) {
//     return res.send('<Response></Response>');
//   }
// =============================================================================

'use strict';

const path = require('path');
const {
  isBillRequest,
  getStage7bMessage,
  getStage7cMessage,
} = require('./adoptionMessages');

const { generateInvoicePDF } = require('../pdfGenerator');

// ---------------------------------------------------------------------------
// Lazy-load helpers from whatsapp.js globals (avoid circular require)
// All helpers are defined in whatsapp.js scope at runtime
// ---------------------------------------------------------------------------
function _getShopDetails() {
  // getShopDetails is imported in whatsapp.js at line ~4598
  // We access it via the module scope at call time
  try { return require('../database').getShopDetails; } catch { return null; }
}

function _sendPDFViaWhatsApp() {
  // sendPDFViaWhatsApp is defined in whatsapp.js — access via global cache
  // whatsapp.js exposes it on globalThis for cross-module use
  return globalThis.__sendPDFViaWhatsApp ?? null;
}

function _sendMsg() {
  return globalThis.__sendMessageViaAPI ?? null;
}

// ---------------------------------------------------------------------------
// Grace guard — prevent duplicate bill sends within 15s
// ---------------------------------------------------------------------------
globalThis._billGrace = globalThis._billGrace ?? new Map(); // shopId -> ts
const BILL_GRACE_MS = Number(process.env.BILL_GRACE_MS ?? 15_000);

function _billAllowed(shopId) {
  const key = String(shopId ?? '');
  const now = Date.now();
  const prev = globalThis._billGrace.get(key);
  if (prev && (now - prev) < BILL_GRACE_MS) return false;
  globalThis._billGrace.set(key, now);
  return true;
}

// ---------------------------------------------------------------------------
// Last sale cache — to know what product/qty to put on the bill
// whatsapp.js sets globalThis.__lastTxnForShop after every committed sale
// ---------------------------------------------------------------------------
function _getLastSale(shopId) {
  try {
    const map = globalThis.__lastTxnForShop;
    if (!map) return null;
    const txn = map.get(String(shopId));
    if (!txn) return null;
    // Only use 'sold' transactions for bill generation
    if (String(txn.action ?? '').toLowerCase() !== 'sold') return null;
    return txn;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Normalize shopId → E.164 (mirrors whatsapp.js toE164 logic)
// ---------------------------------------------------------------------------
function _normalizeShopId(raw) {
  const digits = String(raw ?? '').replace(/^whatsapp:/, '').replace(/\D+/g, '');
  if (digits.startsWith('91') && digits.length >= 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return String(raw ?? '').replace(/^whatsapp:/, '');
}

// ---------------------------------------------------------------------------
// Build a minimal saleRecord from last transaction for PDF generation
// ---------------------------------------------------------------------------
function _buildSaleRecord(lastTxn) {
  return {
    product:  String(lastTxn.product ?? 'Item').trim(),
    quantity: Number(lastTxn.quantity ?? 1),
    unit:     String(lastTxn.unit ?? 'pieces'),
    rate:     Number(lastTxn.pricePerUnit ?? lastTxn.rate ?? 0),
    saleDate: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main handler — called from whatsapp.js handleNewInteraction
//
// @param {string} shopId         - normalized shop ID (digits only / E.164)
// @param {string} From           - whatsapp:+91XXXXXXXXXX
// @param {string} body           - raw message body
// @param {string} lang           - detected language code
// @param {string} requestId      - for logging
// @returns {{ handled: boolean }}
// ---------------------------------------------------------------------------
async function handleBillRequest(shopId, From, body, lang = 'en', requestId = null) {
  const ctx = `[bill${requestId ? ':' + requestId : ''}]`;

  try {
    if (!isBillRequest(body)) return { handled: false };
    if (!_billAllowed(shopId)) {
      console.log(ctx, 'grace guard blocked duplicate bill request');
      return { handled: false };
    }

    console.log(ctx, { shopId, lang, body: String(body).slice(0, 60) });

    const sendMsg  = _sendMsg();
    const sendPDF  = _sendPDFViaWhatsApp();
    const getShop  = _getShopDetails();

    // -----------------------------------------------------------------------
    // 1) Fetch shop details
    // -----------------------------------------------------------------------
    let shopDetails = null;
    if (typeof getShop === 'function') {
      try {
        const r = await getShop(shopId);
        shopDetails = r?.shopDetails ?? r ?? null;
      } catch (e) {
        console.warn(ctx, 'getShopDetails failed:', e?.message);
      }
    }

    // -----------------------------------------------------------------------
    // 2) If shop name is not captured yet — ask for it (organic capture)
    //    This is the BEST moment to capture shop name (customer is waiting)
    // -----------------------------------------------------------------------
    const hasShopName = !!(shopDetails?.name && String(shopDetails.name).trim().length > 1
      && String(shopDetails.name).toLowerCase() !== 'shop name');

    if (!hasShopName) {
      console.log(ctx, 'shop name missing — asking before generating bill');
      if (typeof sendMsg === 'function') {
        await sendMsg(From, getStage7cMessage(lang), { lang });
      }
      // Set state so next message is treated as shop name for bill
      try {
        if (typeof globalThis.__setUserState === 'function') {
          await globalThis.__setUserState(shopId, 'awaiting_shop_name_for_bill', {
            reason: 'bill',
            lang,
            createdAtISO: new Date().toISOString()
          });
        }
      } catch (_) {}
      return { handled: true };
    }

    // -----------------------------------------------------------------------
    // 3) Get last sale for this shop
    // -----------------------------------------------------------------------
    const lastTxn = _getLastSale(shopId);
    if (!lastTxn) {
      // No recent sale — generate a generic receipt with placeholder
      console.log(ctx, 'no recent sale found — using placeholder');
    }

    const saleRecord = lastTxn
      ? _buildSaleRecord(lastTxn)
      : { product: 'Item', quantity: 1, unit: 'pieces', rate: 0, saleDate: new Date().toISOString() };

    // Enrich shopDetails with normalized phone
    const enrichedShopDetails = {
      ...(shopDetails ?? {}),
      shopId:  _normalizeShopId(shopId),
      phone:   _normalizeShopId(shopId),
      name:    shopDetails?.name ?? 'Shop',
      address: shopDetails?.address ?? '',
      gstin:   shopDetails?.gstin ?? null,
    };

    // -----------------------------------------------------------------------
    // 4) Generate PDF invoice
    // -----------------------------------------------------------------------
    let pdfPath = null;
    try {
      pdfPath = await generateInvoicePDF(enrichedShopDetails, saleRecord);
      console.log(ctx, 'PDF generated:', pdfPath);
    } catch (e) {
      console.error(ctx, 'PDF generation failed:', e?.message);
      // Fail gracefully — don't surface raw error to user
      return { handled: false };
    }

    // -----------------------------------------------------------------------
    // 5) Send PDF via WhatsApp
    // -----------------------------------------------------------------------
    if (typeof sendPDF === 'function' && pdfPath) {
      try {
        await sendPDF(From, pdfPath, lang);
        console.log(ctx, 'PDF sent to', From);
      } catch (e) {
        console.error(ctx, 'PDF send failed:', e?.message);
        return { handled: false };
      }
    } else {
      console.warn(ctx, '__sendPDFViaWhatsApp not available on globalThis');
      return { handled: false };
    }

    // -----------------------------------------------------------------------
    // 6) Send "forward karo" confirmation
    // -----------------------------------------------------------------------
    if (typeof sendMsg === 'function') {
      // Small delay so PDF message appears first in chat
      await new Promise(r => setTimeout(r, 600));
      await sendMsg(From, getStage7bMessage(lang), { lang });
    }

    return { handled: true };

  } catch (e) {
    console.error(`${ctx} unhandled error:`, e?.message, e?.stack);
    return { handled: false }; // fail-open — let inventory handler try
  }
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
module.exports = {
  handleBillRequest,
  isBillRequest, // re-exported for convenience
};
