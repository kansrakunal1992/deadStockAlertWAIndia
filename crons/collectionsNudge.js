'use strict';
// =============================================================================
// crons/collectionsNudge.js — Smart Overdue Collections Alert
//
// Runs daily at 2:00 PM IST (registered in server.js).
// For each shop: finds customers overdue beyond their personal avg payment
// gap + 5 days buffer. Sends owner one actionable line per overdue customer
// (max 3 per shop per run, rate-limited to avoid Airtable hammering).
//
// Owner replies "Y" to trigger a reminder -> handled in existing owner flow.
// =============================================================================

const { getAllShopIDs, getUserPreference } = require('../database');
const { getShopLedger }                    = require('../api/udhaar');
const metaClient                           = require('../lib/metaClient');

const MAX_PER_SHOP  = 3;   // max nudges sent per shop per run
const DEFAULT_GAP   = 14;  // assumed payment cycle if no history (days)
const BUFFER        = 5;   // extra days grace before alerting

// ---------------------------------------------------------------------------
// Main runner — exported, called by cron in server.js
// ---------------------------------------------------------------------------
async function runCollectionsNudge() {
  console.log('[collectionsNudge] Starting run');
  const results = [];

  let shopIds;
  try {
    shopIds = await getAllShopIDs();
  } catch (e) {
    console.error('[collectionsNudge] getAllShopIDs failed:', e.message);
    return results;
  }

  console.log(`[collectionsNudge] ${shopIds.length} shops to process`);

  for (const shopId of shopIds) {
    try {
      const r = await _processShop(shopId);
      results.push(...r);
      await _sleep(400);
    } catch (e) {
      console.warn(`[collectionsNudge] shop ${shopId} error:`, e.message);
    }
  }

  const sent = results.filter(r => r.sent).length;
  console.log(`[collectionsNudge] Done. Nudges sent: ${sent}/${results.length}`);
  return results;
}

// ---------------------------------------------------------------------------
// Per-shop processing
// ---------------------------------------------------------------------------
async function _processShop(shopId) {
  const results = [];

  const ledgerResult = await getShopLedger(shopId);
  if (!ledgerResult.success || !ledgerResult.ledger.length) return results;

  const lang  = await _getShopLang(shopId);
  const now   = Date.now();
  let sent    = 0;

  for (const customer of ledgerResult.ledger) {
    if (sent >= MAX_PER_SHOP) break;
    if (customer.totalOwed <= 0) continue;

    const avgGap     = _estimatePaymentGap(customer);
    const triggerAge = avgGap + BUFFER;

    const oldest = (customer.entries || [])
      .filter(e => e.status === 'outstanding' || e.status === 'partial')
      .map(e => new Date(e.date || e.createdAt || Date.now()).getTime())
      .sort((a, b) => a - b)[0];

    if (!oldest) continue;

    const daysSince = Math.floor((now - oldest) / 86400000);
    if (daysSince < triggerAge) continue;

    const ownerDigits = shopId.replace(/\D+/g, '');
    const ownerWa     = ownerDigits.startsWith('91') && ownerDigits.length >= 12
      ? `+${ownerDigits}` : `+91${ownerDigits}`;

    try {
      await metaClient.sendTextMessage(ownerWa, _buildMsg(customer, daysSince, lang));
      sent++;
      results.push({ shopId, customer: customer.customerName, daysSince, sent: true });
      console.log(`[collectionsNudge] Nudge sent: shop=${shopId} customer=${customer.customerName} days=${daysSince}`);
      await _sleep(300);
    } catch (e) {
      console.warn(`[collectionsNudge] send failed for ${shopId}:`, e.message);
      results.push({ shopId, customer: customer.customerName, sent: false, error: e.message });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Build nudge message for owner
// ---------------------------------------------------------------------------
function _buildMsg(customer, daysSince, lang) {
  const name = customer.customerName;
  const amt  = Math.round(customer.totalOwed);

  if (lang && lang !== 'en') {
    return [
      `*Collection alert*`,
      `${name} \u2014 ${daysSince} din se nahi aaya`,
      `Baaki: \u20B9${amt}`,
      '',
      `Reply *Y* to send them a reminder.`,
    ].join('\n');
  }

  return [
    `*Collection alert*`,
    `${name} \u2014 overdue by ${daysSince} days`,
    `Outstanding: \u20B9${amt}`,
    '',
    `Reply *Y* to send them a reminder.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Estimate typical payment gap from entry history (7–60 day clamp)
// ---------------------------------------------------------------------------
function _estimatePaymentGap(customer) {
  const dates = (customer.entries || [])
    .filter(e => e.date || e.createdAt)
    .map(e => new Date(e.date || e.createdAt).getTime())
    .sort((a, b) => a - b);

  if (dates.length < 2) return DEFAULT_GAP;

  let total = 0;
  for (let i = 1; i < dates.length; i++) total += (dates[i] - dates[i - 1]) / 86400000;
  return Math.max(7, Math.min(total / (dates.length - 1), 60));
}

async function _getShopLang(shopId) {
  try {
    const pref = await getUserPreference(shopId);
    return pref?.language || 'hi';
  } catch (_) { return 'hi'; }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { runCollectionsNudge };
