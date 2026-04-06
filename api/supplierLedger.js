'use strict';
// =============================================================================
// api/supplierLedger.js — Saamagrii Supplier Credit Module
// Tracks what the shop OWES its distributors (the other side of udhaar.js).
// Backend: Airtable (SupplierLedger table)
// Mirrors udhaar.js patterns exactly — same airtableRequest, same helpers.
//
// Airtable table required: SupplierLedger
// Fields:
//   ShopID           (text)     — canonical +91XXXXXXXXXX
//   DistributorName  (text)     — e.g. "Nestle Rep"
//   DistributorNorm  (text)     — lowercase normalized for matching
//   Amount           (number)   — invoice total
//   PaidAmount       (number)   — amount paid so far
//   Status           (text)     — outstanding | partial | settled
//   DueDate          (dateTime) — payment due date
//   InvoiceRef       (text)     — invoice number / PDF filename
//   InvoiceDate      (dateTime) — date of invoice
//   Notes            (text)
//   Language         (text)
//
// Env vars:
//   AIRTABLE_SUPPLIER_TABLE_NAME  (default: SupplierLedger)
//   AIRTABLE_BASE_ID, AIRTABLE_API_KEY  (shared with rest of app)
// =============================================================================

const { airtableRequest } = require('../database');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SUPPLIER_TABLE = process.env.AIRTABLE_SUPPLIER_TABLE_NAME || 'SupplierLedger';

const AIRTABLE_BASE_ID = (process.env.AIRTABLE_BASE_ID || '')
  .trim()
  .replace(/[;,\s]+$/, '')
  .replace(/[;,\s]+/g, '')
  .replace(/[^a-zA-Z0-9]/g, '');

// ---------------------------------------------------------------------------
// Helpers — identical to udhaar.js internals
// ---------------------------------------------------------------------------
function getCanonicalShopId(fromOrDigits) {
  const raw = String(fromOrDigits ?? '');
  const digits = raw.replace(/^whatsapp:/, '').replace(/\D+/g, '');
  const canon = (digits.startsWith('91') && digits.length >= 12)
    ? digits.slice(2)
    : digits.replace(/^0+/, '');
  return canon;
}

function normalizeShopIdForWrite(input) {
  return `+91${getCanonicalShopId(input)}`;
}

function normalizeDistributorName(name) {
  return String(name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function logError(context, error) {
  console.error(`[${context}] Error:`, error.message);
  if (error.response) {
    console.error(`[${context}] Status:`, error.response.status);
    try { console.error(`[${context}] Data:`, JSON.stringify(error.response.data)); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// createSupplierEntry — record a new invoice from a distributor
// ---------------------------------------------------------------------------
async function createSupplierEntry(shopId, {
  distributorName,
  amount,
  dueDate = null,
  invoiceRef = '',
  invoiceDate = null,
  notes = '',
  lang = 'en',
} = {}) {
  const context = `createSupplierEntry:${shopId}`;
  try {
    const sid = normalizeShopIdForWrite(shopId);
    const result = await airtableRequest({
      method: 'post',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${SUPPLIER_TABLE}`,
      data: {
        fields: {
          ShopID:          sid,
          DistributorName: String(distributorName ?? '').trim(),
          DistributorNorm: normalizeDistributorName(distributorName),
          Amount:          Number(amount) || 0,
          PaidAmount:      0,
          Status:          'outstanding',
          DueDate:         dueDate || null,
          InvoiceRef:      invoiceRef || '',
          InvoiceDate:     invoiceDate || new Date().toISOString(),
          Notes:           notes || '',
          Language:        lang,
        },
      },
    }, context);

    return {
      success: true,
      recordId: result.id,
      distributorName,
      amount: Number(amount),
      dueDate,
      invoiceRef,
    };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// recordSupplierPayment — log a payment made to a distributor
// ---------------------------------------------------------------------------
async function recordSupplierPayment(shopId, distributorName, amountPaid) {
  const context = `recordSupplierPayment:${shopId}`;
  try {
    const sid = normalizeShopIdForWrite(shopId);
    const norm = normalizeDistributorName(distributorName);

    // Find outstanding entries for this distributor
    const filter = `AND({ShopID}='${sid}',{DistributorNorm}='${norm}',{Status}!='settled')`;
    const result = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filter, sort: [{ field: 'InvoiceDate', direction: 'asc' }] },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${SUPPLIER_TABLE}`,
    }, context);

    if (!result.records.length) {
      return { success: false, error: 'No outstanding entries found for this distributor' };
    }

    // Apply payment to oldest entry first (FIFO)
    let remaining = Number(amountPaid);
    const updated = [];

    for (const rec of result.records) {
      if (remaining <= 0) break;
      const outstanding = Number(rec.fields.Amount || 0) - Number(rec.fields.PaidAmount || 0);
      if (outstanding <= 0) continue;

      const payNow = Math.min(remaining, outstanding);
      const newPaid = Number(rec.fields.PaidAmount || 0) + payNow;
      const newStatus = newPaid >= Number(rec.fields.Amount || 0) ? 'settled' : 'partial';

      await airtableRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${SUPPLIER_TABLE}/${rec.id}`,
        data: { fields: { PaidAmount: newPaid, Status: newStatus } },
      }, `${context}:patch`);

      updated.push({ recordId: rec.id, paid: payNow, status: newStatus });
      remaining -= payNow;
    }

    return { success: true, updated, remainingUnallocated: remaining };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// getSupplierLedger — full outstanding summary for a shop
// ---------------------------------------------------------------------------
async function getSupplierLedger(shopId) {
  const context = `getSupplierLedger:${shopId}`;
  try {
    const sid = normalizeShopIdForWrite(shopId);
    const filter = `AND({ShopID}='${sid}',{Status}!='settled')`;
    const result = await airtableRequest({
      method: 'get',
      params: {
        filterByFormula: filter,
        sort: [{ field: 'DueDate', direction: 'asc' }],
      },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${SUPPLIER_TABLE}`,
    }, context);

    const entries = result.records.map(r => ({
      recordId:        r.id,
      distributorName: r.fields.DistributorName || '',
      amount:          Number(r.fields.Amount || 0),
      paidAmount:      Number(r.fields.PaidAmount || 0),
      outstanding:     Number(r.fields.Amount || 0) - Number(r.fields.PaidAmount || 0),
      status:          r.fields.Status || 'outstanding',
      dueDate:         r.fields.DueDate || null,
      invoiceRef:      r.fields.InvoiceRef || '',
      invoiceDate:     r.fields.InvoiceDate || null,
    }));

    const totalOwed = entries.reduce((s, e) => s + e.outstanding, 0);

    // Group by distributor
    const byDistributor = {};
    for (const e of entries) {
      const key = e.distributorName;
      if (!byDistributor[key]) byDistributor[key] = { distributorName: key, totalOwed: 0, entries: [] };
      byDistributor[key].totalOwed += e.outstanding;
      byDistributor[key].entries.push(e);
    }

    return {
      success: true,
      ledger: Object.values(byDistributor).sort((a, b) => b.totalOwed - a.totalOwed),
      totalOwed,
      entryCount: entries.length,
    };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message, ledger: [], totalOwed: 0 };
  }
}

// ---------------------------------------------------------------------------
// getOverdueSupplierEntries — entries past due date, not settled
// Used by collections nudge cron
// ---------------------------------------------------------------------------
async function getOverdueSupplierEntries(shopId) {
  const context = `getOverdueSupplierEntries:${shopId}`;
  try {
    const sid = normalizeShopIdForWrite(shopId);
    const today = new Date().toISOString().split('T')[0];
    const filter = `AND({ShopID}='${sid}',{Status}!='settled',IS_BEFORE({DueDate},'${today}'))`;
    const result = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filter, sort: [{ field: 'DueDate', direction: 'asc' }] },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${SUPPLIER_TABLE}`,
    }, context);

    return {
      success: true,
      entries: result.records.map(r => ({
        recordId:        r.id,
        distributorName: r.fields.DistributorName || '',
        outstanding:     Number(r.fields.Amount || 0) - Number(r.fields.PaidAmount || 0),
        dueDate:         r.fields.DueDate || null,
        invoiceRef:      r.fields.InvoiceRef || '',
      })),
    };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message, entries: [] };
  }
}

// ---------------------------------------------------------------------------
// getDistributorBalance — single distributor total owed by this shop
// ---------------------------------------------------------------------------
async function getDistributorBalance(shopId, distributorName) {
  const context = `getDistributorBalance:${shopId}`;
  try {
    const sid = normalizeShopIdForWrite(shopId);
    const norm = normalizeDistributorName(distributorName);
    const filter = `AND({ShopID}='${sid}',{DistributorNorm}='${norm}',{Status}!='settled')`;
    const result = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filter },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${SUPPLIER_TABLE}`,
    }, context);

    const totalOwed = result.records.reduce((s, r) =>
      s + (Number(r.fields.Amount || 0) - Number(r.fields.PaidAmount || 0)), 0);

    return { success: true, distributorName, totalOwed, entryCount: result.records.length };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message, totalOwed: 0 };
  }
}

module.exports = {
  createSupplierEntry,
  recordSupplierPayment,
  getSupplierLedger,
  getOverdueSupplierEntries,
  getDistributorBalance,
};
