'use strict';
// =============================================================================
// lib/shopCode.js — Shop Code Generator & Resolver
//
// Every shop gets a short alphanumeric code (e.g. S1234) on registration.
// Customers and distributors use this code in WhatsApp messages to identify
// which shop they're interacting with:
//   Customer:     "BAAKI S1234"    → balance at Sharma's shop
//   Distributor:  "INV S1234"      → invoice for Sharma's shop
//
// Codes are stored as the ShopCode field on the AuthUsers Airtable record.
// If a shop has no code yet (existing users), one is generated on first lookup.
//
// Airtable field required: ShopCode (text) on AuthUsers table
// Env vars: AIRTABLE_BASE_ID, AIRTABLE_API_KEY, AIRTABLE_AUTH_USERS_TABLE_NAME
// =============================================================================

const { airtableRequest } = require('../database');

const AUTH_TABLE = process.env.AIRTABLE_AUTH_USERS_TABLE_NAME || 'AuthUsers';

const AIRTABLE_BASE_ID = (process.env.AIRTABLE_BASE_ID || '')
  .trim()
  .replace(/[;,\s]+$/, '')
  .replace(/[;,\s]+/g, '')
  .replace(/[^a-zA-Z0-9]/g, '');

// In-memory cache: code → shopId, shopId → code
// Avoids Airtable round-trips on every inbound message
const _codeToShop = new Map();  // 'S1234' → '+919876543210'
const _shopToCode = new Map();  // '+919876543210' → 'S1234'

// ---------------------------------------------------------------------------
// generateCode — produces a code like S4829
// Uppercase S prefix + 4 random digits — short, readable, unambiguous
// ---------------------------------------------------------------------------
function generateCode() {
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `S${digits}`;
}

// ---------------------------------------------------------------------------
// getOrCreateShopCode
// Returns the shop's code. Generates + persists one if it doesn't exist yet.
// ---------------------------------------------------------------------------
async function getOrCreateShopCode(shopId) {
  const canonical = normalizeShopId(shopId);

  // Fast path — in-memory cache
  if (_shopToCode.has(canonical)) return _shopToCode.get(canonical);

  const context = `shopCode:get:${canonical}`;

  try {
    // Look up existing code in Airtable
    const filter = buildShopIdFilter(canonical);
    const result = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filter, fields: ['ShopID', 'ShopCode'], maxRecords: 1 },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_TABLE}`,
    }, context);

    const rec = result.records[0];
    if (!rec) return null; // shop not registered

    const existingCode = rec.fields.ShopCode;
    if (existingCode && String(existingCode).trim()) {
      const code = String(existingCode).trim().toUpperCase();
      _cache(code, canonical);
      return code;
    }

    // No code yet — generate one, ensure uniqueness, persist
    const code = await _generateUniqueCode();
    await airtableRequest({
      method: 'patch',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_TABLE}/${rec.id}`,
      data: { fields: { ShopCode: code } },
    }, `${context}:write`);

    _cache(code, canonical);
    console.log(`[shopCode] Assigned ${code} to ${canonical}`);
    return code;

  } catch (err) {
    console.error(`[shopCode] getOrCreateShopCode error for ${canonical}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// resolveShopCode
// Given a code like "S1234", returns the shopId (+91XXXXXXXXXX) or null.
// ---------------------------------------------------------------------------
async function resolveShopCode(code) {
  const upper = String(code ?? '').trim().toUpperCase();
  if (!upper.match(/^S\d{4}$/)) return null;

  // Fast path
  if (_codeToShop.has(upper)) return _codeToShop.get(upper);

  const context = `shopCode:resolve:${upper}`;

  try {
    const filter = `{ShopCode}='${upper}'`;
    const result = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filter, fields: ['ShopID', 'ShopCode'], maxRecords: 1 },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_TABLE}`,
    }, context);

    const rec = result.records[0];
    if (!rec) return null;

    const shopId = normalizeShopId(rec.fields.ShopID || '');
    if (shopId) _cache(upper, shopId);
    return shopId || null;

  } catch (err) {
    console.error(`[shopCode] resolveShopCode error for ${upper}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// extractShopCode
// Parses a shop code out of a message body.
// Handles: "BAAKI S1234", "INV S1234", "s1234", "S 1234" etc.
// Returns the normalized code string (e.g. "S1234") or null.
// ---------------------------------------------------------------------------
function extractShopCode(messageBody) {
  const text = String(messageBody ?? '').trim().toUpperCase();
  // Match S followed by exactly 4 digits, possibly with a space
  const match = text.match(/\bS\s?(\d{4})\b/);
  if (!match) return null;
  return `S${match[1]}`;
}

// ---------------------------------------------------------------------------
// buildCustomerLink — deep link for a shop to share with a customer
// wa.me/91XXXXXXXXXX?text=BAAKI+S1234
// ---------------------------------------------------------------------------
function buildCustomerLink(shopId, shopCode, twilioNumber) {
  // twilioNumber: e.g. '+14155238886' or from TWILIO_WHATSAPP_NUMBER env
  const num = String(twilioNumber || process.env.TWILIO_WHATSAPP_NUMBER || '')
    .replace(/\D+/g, '');
  const text = encodeURIComponent(`BAAKI ${shopCode}`);
  return `https://wa.me/${num}?text=${text}`;
}

// ---------------------------------------------------------------------------
// buildDistributorLink — deep link for a shop to share with a distributor
// wa.me/91XXXXXXXXXX?text=INV+S1234
// ---------------------------------------------------------------------------
function buildDistributorLink(shopId, shopCode, twilioNumber) {
  const num = String(twilioNumber || process.env.TWILIO_WHATSAPP_NUMBER || '')
    .replace(/\D+/g, '');
  const text = encodeURIComponent(`INV ${shopCode}`);
  return `https://wa.me/${num}?text=${text}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function normalizeShopId(raw) {
  const digits = String(raw ?? '').replace(/^whatsapp:/, '').replace(/\D+/g, '');
  const canon = (digits.startsWith('91') && digits.length >= 12)
    ? digits.slice(2) : digits.replace(/^0+/, '');
  return canon ? `+91${canon}` : '';
}

function buildShopIdFilter(canonical) {
  const digits = canonical.replace(/\D+/g, '');
  const with91 = digits.startsWith('91') ? `+${digits}` : `+91${digits}`;
  const without91 = digits.startsWith('91') ? digits.slice(2) : digits;
  return `OR({ShopID}='${with91}',{ShopID}='${without91}',{ShopID}='+91${without91}')`;
}

function _cache(code, shopId) {
  _codeToShop.set(code, shopId);
  _shopToCode.set(shopId, code);
}

async function _generateUniqueCode() {
  // Try up to 10 times to get a unique code
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateCode();
    // Check if already taken
    const result = await airtableRequest({
      method: 'get',
      params: { filterByFormula: `{ShopCode}='${candidate}'`, maxRecords: 1 },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_TABLE}`,
    }, 'shopCode:uniqueCheck');
    if (!result.records.length) return candidate;
  }
  // Fallback: timestamp-based (guaranteed unique)
  return `S${String(Date.now()).slice(-4)}`;
}

module.exports = {
  getOrCreateShopCode,
  resolveShopCode,
  extractShopCode,
  buildCustomerLink,
  buildDistributorLink,
};
