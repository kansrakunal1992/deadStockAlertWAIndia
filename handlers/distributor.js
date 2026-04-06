'use strict';
// =============================================================================
// handlers/distributor.js — Distributor Invoice Intake Handler
//
// Called by lib/router.js when an inbound message comes from a distributor
// who includes a shop code: "INV S1234"
//
// Flows:
//   "INV S1234 [details]"  -> parse via Deepseek -> write SupplierLedger -> notify owner
//   Image/PDF with caption -> same, mediaUrl passed to extraction
//   "kitna baaki S1234"    -> return outstanding balance for this distributor
//
// No dependency on whatsapp.js — fully standalone.
// =============================================================================

const { createSupplierEntry, getDistributorBalance } = require('../api/supplierLedger');
const metaClient                                      = require('../lib/metaClient');
const axios                                           = require('axios');

const BALANCE_RX = /\b(kitna|baaki|balance|outstanding|due)\b/i;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
async function handleDistributorMessage({ from, shopId, shopCode, body, req, requestId }) {
  const ctx = `[distributor:${from}->shop:${shopId}]`;
  console.log(ctx, `body="${body.slice(0, 60)}"`);

  const distributorPhone = from.replace(/\D+/g, '');

  try {
    if (BALANCE_RX.test(body)) {
      return await _handleBalanceQuery({ from, shopId, distributorPhone, ctx });
    }

    const hasMedia  = req && req.body && String(req.body.NumMedia || '0') !== '0';
    const mediaUrl  = hasMedia ? (req.body.MediaUrl0 || '') : null;

    return await _handleInvoice({
      from, shopId, shopCode, body, distributorPhone, mediaUrl, requestId, ctx,
    });

  } catch (err) {
    console.error(ctx, 'error:', err.message);
    await _send(from, 'Invoice process nahi ho saka. Thodi der mein dobara try karein.');
  }
}

// ---------------------------------------------------------------------------
// Invoice intake
// ---------------------------------------------------------------------------
async function _handleInvoice({ from, shopId, shopCode, body, distributorPhone, mediaUrl, requestId, ctx }) {
  await _send(from, 'Invoice mil gaya. Process ho raha hai...');

  const parsed = await _extractInvoiceDetails({ body, mediaUrl, requestId, ctx });

  if (!parsed.amount || parsed.amount <= 0) {
    await _send(from, [
      'Invoice amount detect nahi hua.',
      '',
      'Please type karein:',
      `INV ${shopCode} [amount] [distributor name] [invoice no.]`,
      '',
      `Example: INV ${shopCode} 2160 Nestle Jan-2025`,
    ].join('\n'));
    return;
  }

  const distName = parsed.distributorName || `Distributor ${distributorPhone.slice(-4)}`;

  const entry = await createSupplierEntry(shopId, {
    distributorName: distName,
    amount:          parsed.amount,
    dueDate:         parsed.dueDate   || null,
    invoiceRef:      parsed.invoiceRef || '',
    invoiceDate:     parsed.invoiceDate || new Date().toISOString(),
    notes:           parsed.notes      || '',
    lang:            'hi',
  });

  if (!entry.success) {
    console.error(ctx, 'createSupplierEntry failed:', entry.error);
    await _send(from, 'Entry save nahi ho saki. Baad mein try karein.');
    return;
  }

  const lines = [
    `Invoice record ho gaya. \u2705`,
    `Amount: \u20B9${Math.round(parsed.amount)}`,
    parsed.dueDate ? `Due: ${new Date(parsed.dueDate).toLocaleDateString('en-IN')}` : null,
    parsed.invoiceRef ? `Ref: ${parsed.invoiceRef}` : null,
  ].filter(Boolean);

  await _send(from, lines.join('\n'));

  _notifyOwner({ shopId, parsed, distName, distributorPhone, ctx }).catch(e =>
    console.warn(ctx, 'owner notify failed:', e.message)
  );
}

// ---------------------------------------------------------------------------
// Balance query
// ---------------------------------------------------------------------------
async function _handleBalanceQuery({ from, shopId, distributorPhone, ctx }) {
  const distName = `Distributor ${distributorPhone.slice(-4)}`;
  const result   = await getDistributorBalance(shopId, distName);

  if (!result.success) {
    await _send(from, 'Balance check nahi ho saka. Baad mein try karein.');
    return;
  }

  if (result.totalOwed <= 0) {
    await _send(from, 'Is dukan par aapka koi outstanding nahi hai. \u2705');
    return;
  }

  await _send(from, [
    `*Outstanding balance*`,
    `\u20B9${Math.round(result.totalOwed)} \u2014 ${result.entryCount} invoice(s)`,
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// Notify owner of new invoice
// ---------------------------------------------------------------------------
async function _notifyOwner({ shopId, parsed, distName, distributorPhone, ctx }) {
  const digits  = shopId.replace(/\D+/g, '');
  const ownerWa = digits.startsWith('91') && digits.length >= 12 ? `+${digits}` : `+91${digits}`;

  const lines = [
    `*Naya supplier invoice*`,
    `Amount: \u20B9${Math.round(parsed.amount || 0)}`,
    `Distributor: ${distName}`,
    parsed.dueDate ? `Due: ${new Date(parsed.dueDate).toLocaleDateString('en-IN')}` : null,
    parsed.invoiceRef ? `Ref: ${parsed.invoiceRef}` : null,
    '',
    'Supplier ledger mein save ho gaya. \u2705',
  ].filter(Boolean);

  await metaClient.sendTextMessage(ownerWa, lines.join('\n'));
  console.log(ctx, `owner ${ownerWa} notified`);
}

// ---------------------------------------------------------------------------
// Extract invoice details via Deepseek; rule-based fallback
// ---------------------------------------------------------------------------
async function _extractInvoiceDetails({ body, mediaUrl, requestId, ctx }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return _ruleBasedExtract(body);

  try {
    const prompt = [
      'Extract invoice details from this WhatsApp message.',
      'Return ONLY valid JSON: { "amount": number, "distributorName": string,',
      '  "invoiceRef": string, "dueDate": "YYYY-MM-DD or null", "invoiceDate": "YYYY-MM-DD or null", "notes": string }',
      '',
      'Message: ' + body,
      mediaUrl ? `Attachment: ${mediaUrl}` : '',
    ].filter(Boolean).join('\n');

    const resp = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      { model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 200, temperature: 0 },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 8000 }
    );

    const text = resp.data?.choices?.[0]?.message?.content || '';
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (json) return JSON.parse(json);
  } catch (e) {
    console.warn(ctx, 'Deepseek extract failed:', e.message);
  }

  return _ruleBasedExtract(body);
}

function _ruleBasedExtract(body) {
  const amountMatch = body.match(/\b(\d{3,7}(?:\.\d{1,2})?)\b/);
  const amount      = amountMatch ? parseFloat(amountMatch[1]) : 0;
  const afterAmt    = amountMatch
    ? body.slice(body.indexOf(amountMatch[0]) + amountMatch[0].length).trim()
    : '';
  const distName = afterAmt.split(/\s+/).slice(0, 3).join(' ') || '';
  return { amount, distributorName: distName, invoiceRef: '', dueDate: null, invoiceDate: null, notes: '' };
}

function _send(to, body) {
  const digits = String(to).replace('whatsapp:', '').replace(/\D+/g, '');
  const e164   = digits.startsWith('91') && digits.length >= 12 ? `+${digits}` : `+91${digits}`;
  return metaClient.sendTextMessage(e164, body);
}

module.exports = { handleDistributorMessage };
