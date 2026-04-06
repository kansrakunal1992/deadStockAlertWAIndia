'use strict';
// =============================================================================
// handlers/customer.js — Customer Self-Service Handler
//
// Called by lib/router.js when an inbound message comes from a customer
// (non-owner) who includes a shop code: "BAAKI S1234"
//
// Flows:
//   BAAKI / BALANCE  -> itemised balance at that shop
//   "kal de dunga"   -> log payment commitment, notify owner non-blocking
//   Anything else    -> show balance + prompt
//
// No dependency on whatsapp.js — fully standalone.
// =============================================================================

const { getCustomerBalance, getShopLedger } = require('../api/udhaar');
const metaClient                             = require('../lib/metaClient');

const COMMITMENT_RX = /\b(kal|tomorrow|de\s*dunga|de\s*dungi|dunga|dungi|pakka|abhi|bhejta|bhejti|send)\b/i;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
async function handleCustomerMessage({ from, shopId, shopCode, body, requestId }) {
  const ctx = `[customer:${from}->shop:${shopId}]`;
  console.log(ctx, `body="${body.slice(0, 60)}"`);

  try {
    const customerName = await _resolveCustomerByPhone(shopId, from);

    if (COMMITMENT_RX.test(body)) {
      return await _handleCommitment({ from, shopId, customerName, body, ctx });
    }

    return await _showBalance({ from, shopId, customerName, ctx });

  } catch (err) {
    console.error(ctx, 'error:', err.message);
    await _send(from, 'Kuch technical problem hui. Thodi der mein try karein.');
  }
}

// ---------------------------------------------------------------------------
// Show itemised balance
// ---------------------------------------------------------------------------
async function _showBalance({ from, shopId, customerName, ctx }) {
  if (!customerName) {
    await _send(from, [
      'Aapka koi udhaar nahi mila is dukan par.',
      'Agar galti lag rahi hai, shopkeeper se baat karein.',
    ].join('\n'));
    return;
  }

  const balance = await getCustomerBalance(shopId, customerName);

  if (!balance.success || balance.outstanding <= 0) {
    await _send(from, `${customerName} ji, is dukan par aapka koi baaki nahi hai. \u2705`);
    return;
  }

  const lines = [
    `*${customerName} ji \u2014 aapka hisaab*`,
    '',
    `Kul baaki: *\u20B9${Math.round(balance.outstanding)}*`,
    '',
  ];

  if (balance.entries && balance.entries.length) {
    lines.push('Entries:');
    for (const e of balance.entries.slice(0, 8)) {
      const date = e.date
        ? new Date(e.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        : '';
      lines.push(`  ${date}  \u20B9${e.amount}`);
    }
    if (balance.entries.length > 8) {
      lines.push(`  ... aur ${balance.entries.length - 8} entries`);
    }
  }

  lines.push('');
  lines.push('Kal dene ka plan hai? Type karein: *kal de dunga*');

  await _send(from, lines.join('\n'));
  console.log(ctx, `balance sent: outstanding=${balance.outstanding}`);
}

// ---------------------------------------------------------------------------
// Handle commitment
// ---------------------------------------------------------------------------
async function _handleCommitment({ from, shopId, customerName, body, ctx }) {
  const confirmMsg = customerName
    ? `Shukriya ${customerName} ji! Shopkeeper ko bata diya gaya hai. \u2705`
    : 'Aapki baat shopkeeper tak pahunchi. Shukriya!';

  await _send(from, confirmMsg);

  _notifyOwner({ shopId, from, customerName, body, ctx }).catch(e =>
    console.warn(ctx, 'owner notify failed:', e.message)
  );
}

async function _notifyOwner({ shopId, from, customerName, body, ctx }) {
  const digits  = shopId.replace(/\D+/g, '');
  const ownerWa = digits.startsWith('91') && digits.length >= 12 ? `+${digits}` : `+91${digits}`;
  const display = customerName || from;

  const msg = [
    `*Customer update* \u2709\uFE0F`,
    `${display}: "${body.trim()}"`,
    `Phone: ${from}`,
    '',
    'Balance check: BAAKI type karein.',
  ].join('\n');

  await metaClient.sendTextMessage(ownerWa, msg);
  console.log(ctx, `owner ${ownerWa} notified`);
}

// ---------------------------------------------------------------------------
// Resolve customer name from udhaar ledger by phone number
// ---------------------------------------------------------------------------
async function _resolveCustomerByPhone(shopId, fromPhone) {
  try {
    const ledger = await getShopLedger(shopId);
    if (!ledger.success || !ledger.ledger) return null;

    const digits = fromPhone.replace(/\D+/g, '');
    const canon  = digits.startsWith('91') && digits.length >= 12 ? digits.slice(2) : digits;

    for (const entry of ledger.ledger) {
      if (entry.phone) {
        const ed = String(entry.phone).replace(/\D+/g, '');
        const ec = ed.startsWith('91') && ed.length >= 12 ? ed.slice(2) : ed;
        if (ec === canon) return entry.customerName;
      }
    }
    return null;
  } catch (_) { return null; }
}

function _send(to, body) {
  const digits = String(to).replace('whatsapp:', '').replace(/\D+/g, '');
  const e164   = digits.startsWith('91') && digits.length >= 12 ? `+${digits}` : `+91${digits}`;
  return metaClient.sendTextMessage(e164, body);
}

module.exports = { handleCustomerMessage };
