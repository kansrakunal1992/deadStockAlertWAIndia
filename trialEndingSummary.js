// =============================================================================
// trialEndingSummary.js — Saamagrii.AI Trial Ending Summary (Stage 8)
// Runs as a cron job (see server.js patch). Pulls REAL user data:
//   - entry count (from gamify tracker)
//   - bills count (from Sales table, PDFs sent)
//   - top udhaar entry by name (from UdhaarLedger)
// Composes a personalized Stage 8 message and sends via Twilio.
//
// Place: /trialEndingSummary.js (root, same level as server.js)
// Called from: server.js cron (see server.js patch, runs daily ~5pm IST)
// =============================================================================

'use strict';

const client = require('./twilioClient');
const {
  getTrialsExpiringBefore,
  setTrialReminderSent,
  getSalesDataForPeriod,
  getUserPreference,
} = require('./database');

const { getStage8Message } = require('./api/adoptionMessages');
const { getShopLedger } = require('./api/udhaar');

// Gamify file path (mirrors whatsapp.js GAMIFY_TRACK_FILE)
const fs   = require('fs');
const path = require('path');
const GAMIFY_TRACK_FILE = process.env.GAMIFY_TRACK_FILE
  ?? path.join(__dirname, 'gamify_track.json');

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 3);

// ---------------------------------------------------------------------------
// Read gamify state for a single shop
// ---------------------------------------------------------------------------
function _readGamifyForShop(shopId) {
  try {
    if (!fs.existsSync(GAMIFY_TRACK_FILE)) return null;
    const raw = fs.readFileSync(GAMIFY_TRACK_FILE, 'utf8');
    const all = JSON.parse(raw);
    // Try both raw shopId and E.164 variant
    const digits = String(shopId ?? '').replace(/\D+/g, '');
    return all[shopId] ?? all[`+91${digits}`] ?? all[digits] ?? null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Count bills generated — use Sales records that have a pdfPath or InvoiceSent
// Fallback: count all sales records in trial window (each sale = potential bill)
// ---------------------------------------------------------------------------
async function _countBills(shopId, trialStart) {
  try {
    const start = trialStart ? new Date(trialStart) : new Date(Date.now() - TRIAL_DAYS * 86400_000);
    const end   = new Date();
    const data  = await getSalesDataForPeriod(shopId, start, end);
    const records = Array.isArray(data?.records) ? data.records : [];
    // Count records where InvoiceSent or pdfSent is truthy
    const explicit = records.filter(r => !!(r.fields?.InvoiceSent || r.fields?.PdfSent)).length;
    // If no explicit flag, return 0 (we don't want to inflate the number)
    return explicit;
  } catch { return 0; }
}

// ---------------------------------------------------------------------------
// Normalize shopId → whatsapp:+91XXXXXXXXXX for Twilio send
// ---------------------------------------------------------------------------
function _toWhatsAppAddress(shopId) {
  const raw = String(shopId ?? '').replace(/^whatsapp:/, '');
  const digits = raw.replace(/\D+/g, '');
  if (digits.startsWith('91') && digits.length >= 12) return `whatsapp:+${digits}`;
  if (digits.length === 10) return `whatsapp:+91${digits}`;
  return raw.startsWith('+') ? `whatsapp:${raw}` : `whatsapp:+${raw}`;
}

// ---------------------------------------------------------------------------
// Send a single WhatsApp message via Twilio (same pattern as dailySummary.js)
// ---------------------------------------------------------------------------
async function _sendWA(to, body) {
  const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const from        = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!from) {
    console.error('[trial-end] TWILIO_WHATSAPP_NUMBER not set');
    return null;
  }
  const msg = await client.messages.create({
    body,
    from,
    to: formattedTo,
    timeout: 10000,
  });
  return msg;
}

// ---------------------------------------------------------------------------
// Build and send the Stage 8 message for a single shop
// ---------------------------------------------------------------------------
async function sendTrialEndingMessage(shopId, trialEnd) {
  const ctx = `[trial-end:${shopId}]`;
  try {
    // 1) Language preference
    let lang = 'en';
    try {
      const pref = await getUserPreference(shopId);
      if (pref?.language) lang = String(pref.language).toLowerCase();
    } catch (_) {}

    // 2) Entry count from gamify
    const gs = _readGamifyForShop(shopId);
    const entriesCount = Number(gs?.entries ?? 0);

    // 3) Bills count (explicit invoices sent)
    const trialStart = trialEnd
      ? new Date(new Date(trialEnd).getTime() - TRIAL_DAYS * 86400_000).toISOString()
      : null;
    const billsCount = await _countBills(shopId, trialStart);

    // 4) Top udhaar entry by name + amount
    let udhaarEntries = [];
    try {
      const ledger = await getShopLedger(shopId);
      // Already sorted by balance desc in getShopLedger
      udhaarEntries = (ledger?.ledger ?? []).slice(0, 1); // top 1 only for Stage 8
    } catch (_) {}

    // 5) Compose message
    const message = getStage8Message({
      entriesCount,
      billsCount,
      udhaarEntries,
      days: TRIAL_DAYS,
      langExact: lang,
    });

    // 6) Send
    const wa = _toWhatsAppAddress(shopId);
    const msg = await _sendWA(wa, message);
    console.log(ctx, 'trial ending message sent', { sid: msg?.sid, lang, entriesCount, billsCount });
    return { success: true, sid: msg?.sid };

  } catch (e) {
    console.error(ctx, 'failed:', e?.message);
    return { success: false, error: e?.message };
  }
}

// ---------------------------------------------------------------------------
// Main runner — called by cron in server.js
// Finds all trials expiring within next 24 hours that haven't been reminded yet
// ---------------------------------------------------------------------------
async function runTrialEndingReminders() {
  console.log('[trial-end] Starting trial ending reminder run');
  const results = [];

  try {
    // Look for trials expiring in next 24 hours
    const threshold = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const expiring  = await getTrialsExpiringBefore(threshold);

    console.log(`[trial-end] Found ${expiring.length} trials expiring before ${threshold}`);

    for (const record of expiring) {
      const { id: recordId, shopId, trialEnd, lastReminder } = record;

      // Skip if already reminded
      if (lastReminder) {
        console.log(`[trial-end] ${shopId} already reminded at ${lastReminder} — skip`);
        continue;
      }

      // Skip if trial already ended (only remind while still active)
      if (trialEnd && new Date(trialEnd).getTime() < Date.now()) {
        console.log(`[trial-end] ${shopId} trial already expired — skip`);
        continue;
      }

      const r = await sendTrialEndingMessage(shopId, trialEnd);
      results.push({ shopId, ...r });

      // Mark reminded so we don't double-send
      if (r.success) {
        try {
          await setTrialReminderSent(recordId);
        } catch (e) {
          console.warn(`[trial-end] setTrialReminderSent failed for ${shopId}:`, e?.message);
        }
      }

      // Rate limit: 300ms between messages
      await new Promise(res => setTimeout(res, 300));
    }

  } catch (e) {
    console.error('[trial-end] runner failed:', e?.message);
  }

  const ok  = results.filter(r => r.success).length;
  const err = results.filter(r => !r.success).length;
  console.log(`[trial-end] Done. Sent: ${ok}, Failed: ${err}`);
  return results;
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
module.exports = {
  runTrialEndingReminders,
  sendTrialEndingMessage, // exported for testing / manual trigger
};
