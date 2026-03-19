// =============================================================================
// udhaar.js — Saamagrii Credit Tracking (Udhaar / Khata) Module
// Backend: Airtable (UdhaarLedger table)
// Consistent with database.js patterns (same airtableRequest, error handling)
//
// Airtable table required: UdhaarLedger
// Fields:  ShopID (text) | CustomerName (text) | CustomerNameNormalized (text)
//          Amount (number) | Type (text: diya|liya) | Status (text: outstanding|settled|partial)
//          Date (dateTime) | PaidAmount (number) | PaidDate (dateTime)
//          Language (text) | Notes (text)
//
// Env vars:
//   AIRTABLE_UDHAAR_TABLE_NAME  (default: UdhaarLedger)
//   AIRTABLE_BASE_ID, AIRTABLE_API_KEY  (shared with rest of app)
// =============================================================================

const { airtableRequest } = require('../database');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const UDHAAR_TABLE_NAME = process.env.AIRTABLE_UDHAAR_TABLE_NAME || 'UdhaarLedger';

// Clean Base ID the same way database.js does
const AIRTABLE_BASE_ID = (process.env.AIRTABLE_BASE_ID || '')
  .trim()
  .replace(/[;,\s]+$/, '')
  .replace(/[;,\s]+/g, '')
  .replace(/[^a-zA-Z0-9]/g, '');

// ---------------------------------------------------------------------------
// Local helpers (mirror of database.js internals — not exported there)
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

function logError(context, error) {
  console.error(`[${context}] Error:`, error.message);
  if (error.response) {
    console.error(`[${context}] Status:`, error.response.status);
    try { console.error(`[${context}] Data:`, JSON.stringify(error.response.data)); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// INTENT CONSTANTS
// ---------------------------------------------------------------------------
const INTENT = {
  DIYA:    'diya',     // shopkeeper gave credit OUT to customer
  LIYA:    'liya',     // shopkeeper took credit IN (e.g. from supplier)
  WAPAS:   'wapas',    // payment received back from customer
  BAAKI:   'baaki',    // check balance for one customer
  HISAAB:  'hisaab',   // full ledger / all outstanding
  UNKNOWN: null
};

// ---------------------------------------------------------------------------
// INTENT DETECTION
// Ordered: more-specific patterns first. Covers EN / Hinglish / Hindi / Bengali / Gujarati.
// ---------------------------------------------------------------------------
const INTENT_PATTERNS = [
  // ── Full ledger / all outstanding ──
  {
    intent: INTENT.HISAAB,
    patterns: [
      /\b(hisaab|hisab|ledger|sab.*udhaar|udhaar.*sab|sabka.*baaki|baaki.*sab|all.*credit|total.*outstanding|kitne.*baaki|sab.*baaki)\b/i,
      /\b(हिसाब|खाता|सबका|सब\s*का\s*बाकी|कुल\s*बाकी)\b/i,
      /\b(হিসাব|খাতা|সবার\s*বাকি)\b/i,
      /\b(હિસાબ|ખાતું|બધાનું\s*બાકી)\b/i,
    ]
  },
  // ── Check single customer balance ──
  {
    intent: INTENT.BAAKI,
    patterns: [
      /\b(baaki|baki|balance|kitna.*dena|dena.*kitna|how much.*owe|owes?|dues?|outstanding|ka\s+baaki|baaki\s+batao|baaki\s+bata)\b/i,
      /\b(बाकी|कितना\s*देना|देना\s*है|बकाया|बाकी\s*बताओ)\b/i,
      /\b(বাকি|কতটুকু\s*বাকি|দেনা)\b/i,
      /\b(બાકી|કેટલું\s*બાકી)\b/i,
    ]
  },
  // ── Payment received / wapas ──
  {
    intent: INTENT.WAPAS,
    patterns: [
      /\b(wapas|vapas|waapis|returned|paid\s*back|payment\s*received|ne\s*diya|chukta|chukaya|cleared?|milgaya|mil\s*gaya|vaapas\s*mila|wapas\s*diya)\b/i,
      /\b(वापस|वापिस|चुकता|चुकाया|पैसे\s*मिले|वापस\s*मिला|ने\s*दिया)\b/i,
      /\b(ফেরত|ফেরত\s*দিল|চুকিয়ে\s*দিল)\b/i,
      /\b(પાછા|ચૂકવ્યા|ભરી\s*દીધા)\b/i,
    ]
  },
  // ── Diya udhaar (gave credit OUT) ──
  {
    intent: INTENT.DIYA,
    patterns: [
      /\b(diya\s*udhaar|udhaar\s*diya|credit\s*diya|gave.*credit|gave.*udhaar|udhaar\s*de\s*diya|de\s*diya|ko\s*udhaar|udhaar\s*ko|nikala)\b/i,
      /\b(उधार\s*दिया|दिया\s*उधार|उधार\s*दे\s*दिया|निकाला|को\s*उधार)\b/i,
      /\b(ধার\s*দিলাম|উধার\s*দিলাম)\b/i,
      /\b(ઉધારે\s*આપ્યા|ઉધારી\s*આપી)\b/i,
    ]
  },
  // ── Liya udhaar (took credit IN) ──
  {
    intent: INTENT.LIYA,
    patterns: [
      /\b(liya\s*udhaar|udhaar\s*liya|credit\s*liya|took.*credit|took.*udhaar|le\s*liya|kharida.*udhaar|udhaar\s*par\s*kharida)\b/i,
      /\b(उधार\s*लिया|लिया\s*उधार|उधार\s*ले\s*लिया|उधार\s*पर\s*खरीदा)\b/i,
      /\b(ধার\s*নিলাম|উধার\s*নিলাম)\b/i,
      /\b(ઉધારે\s*લીધા|ઉધારી\s*લીધી)\b/i,
    ]
  },
];

/**
 * Detect udhaar intent from raw user text.
 * @returns {{ intent: string|null, raw: string }}
 */
function detectUdhaarIntent(text = '') {
  const t = String(text ?? '').trim();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const re of patterns) {
      if (re.test(t)) return { intent, raw: t };
    }
  }
  return { intent: INTENT.UNKNOWN, raw: t };
}

// ---------------------------------------------------------------------------
// ENTITY EXTRACTION — Amount
// ---------------------------------------------------------------------------

/**
 * Extract rupee amount from text. Returns Number or null.
 * Handles: ₹500  |  Rs 500  |  500 rupees  |  500/-  |  plain 500
 */
function extractAmount(text = '') {
  const t = String(text ?? '');
  // Prefixed: ₹500 or Rs.500
  let m = t.match(/(?:₹|rs\.?\s*|rupees?\s*)(\d+(?:\.\d{1,2})?)/i);
  if (m) { const v = parseFloat(m[1]); if (!isNaN(v) && v > 0) return v; }
  // Suffixed: 500/- or 500 rs or 500 rupees
  m = t.match(/(\d+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|rupees?|-\/)/i);
  if (m) { const v = parseFloat(m[1]); if (!isNaN(v) && v > 0) return v; }
  // Plain integer (last resort, only if other tokens were present for udhaar)
  m = t.match(/\b(\d{2,6}(?:\.\d{1,2})?)\b/);
  if (m) { const v = parseFloat(m[1]); if (!isNaN(v) && v > 0) return v; }
  return null;
}

// ---------------------------------------------------------------------------
// ENTITY EXTRACTION — Customer name
// ---------------------------------------------------------------------------

// Tokens to strip before isolating the customer name
const STOP_WORDS = new Set([
  // Hinglish / Hindi
  'udhaar','udhar','udhari','udhare','diya','liya','wapas','vapas','waapis',
  'baaki','baki','balance','hisaab','hisab','khata','ledger','outstanding',
  'paid','payment','received','chukta','chukaya','cleared','milgaya','mila',
  'mil','gaya','ne','ko','se','ka','ki','ke','hai','tha','the','le','de',
  'batao','bata','dikhaao','dikhao','nikala','aur','aage','abhi',
  // English
  'of','for','by','the','is','a','an','has','to','give','gave','took','take',
  'credit','rupees','rs','please','now','today','total',
  // Native script common words (strip via regex in normalisation step)
]);

/**
 * Extract a candidate customer name from text by removing noise tokens.
 * Returns string or null if nothing remains.
 */
function extractCustomerName(text = '') {
  let t = String(text ?? '').trim();

  // 1. Remove amount patterns (₹500, 500/-, etc.)
  t = t.replace(/(?:₹|rs\.?\s*|rupees?\s*)\d+(?:\.\d{1,2})?/gi, '');
  t = t.replace(/\d+(?:\.\d{1,2})?\s*(?:₹|rs\.?|rupees?|-\/)/gi, '');
  t = t.replace(/\b\d+(?:\.\d{1,2})?\b/g, '');

  // 2. Remove Hindi/Devanagari noise words
  t = t.replace(/\b(उधार|वापस|वापिस|बाकी|बकाया|हिसाब|खाता|चुकता|चुकाया|मिले|दिया|लिया|पैसे|को|ने|का|की|के|से|है|था|दे|ले|निकाला)\b/g, ' ');

  // 3. Remove Bengali/Gujarati noise words
  t = t.replace(/\b(ধার|উধার|বাকি|হিসাব|খাতা|ফেরত|ઉધાર|ઉધારી|બાકી|હિસાબ|ખાતું|ફેરત)\b/g, ' ');

  // 4. Remove English stop-words
  for (const w of STOP_WORDS) {
    t = t.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ');
  }

  // 5. Strip punctuation (keep alphanumeric + unicode scripts + spaces)
  t = t.replace(/[^a-zA-Z\u0900-\u097F\u0980-\u09FF\u0A80-\u0AFF\s]/g, ' ')
       .replace(/\s+/g, ' ')
       .trim();

  return t.length >= 2 ? t : null;
}

/**
 * Full parse of a udhaar message.
 * @returns {{ intent, customerName, amount, lang, raw }}
 */
function parseUdhaarMessage(text = '', lang = 'en') {
  const { intent } = detectUdhaarIntent(text);
  const amount = extractAmount(text);
  const customerName = extractCustomerName(text);
  return { intent, customerName, amount, lang, raw: String(text ?? '') };
}

// ---------------------------------------------------------------------------
// FUZZY CUSTOMER NAME MATCHING
// ---------------------------------------------------------------------------

function levenshtein(a = '', b = '') {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
    for (let j = 1; j <= n; j++) {
      dp[i][j] = i === 0
        ? j
        : a[i-1] === b[j-1]
          ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function normalizeNameForMatch(name = '') {
  return String(name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Find the best matching customer name from a list.
 * Threshold: edit distance ≤ 2 OR token-set overlap ≥ 0.5
 * Returns matched name string or null.
 */
function fuzzyMatchName(candidate = '', existingNames = []) {
  const cand = normalizeNameForMatch(candidate);
  if (!cand || existingNames.length === 0) return null;

  let bestMatch = null;
  let bestDist = Infinity;

  for (const name of existingNames) {
    const norm = normalizeNameForMatch(name);
    if (!norm) continue;
    if (norm === cand) return name; // exact hit

    const dist = levenshtein(cand, norm);
    const maxLen = Math.max(cand.length, norm.length);

    // Token-set overlap (Jaccard)
    const cToks = new Set(cand.split(' '));
    const nToks = new Set(norm.split(' '));
    const inter = [...cToks].filter(tok => nToks.has(tok)).length;
    const union = new Set([...cToks, ...nToks]).size;
    const iou = union > 0 ? inter / union : 0;

    const isMatch = dist <= 2 || iou >= 0.5;
    if (isMatch && dist < bestDist) {
      bestDist = dist;
      bestMatch = name; // keep original casing from Airtable
    }
  }
  return bestMatch;
}

// ---------------------------------------------------------------------------
// AIRTABLE CRUD
// ---------------------------------------------------------------------------

/** List distinct customer names for a shop (for fuzzy matching). */
async function getShopCustomerNames(shopId) {
  const context = `Udhaar.GetCustomerNames ${shopId}`;
  try {
    const sid = normalizeShopIdForWrite(shopId);
    const result = await airtableRequest({
      method: 'get',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${UDHAAR_TABLE_NAME}`,
      params: {
        filterByFormula: `{ShopID}='${sid.replace(/'/g, "''")}'`,
        fields: ['CustomerName'],
        maxRecords: 500
      }
    }, context);
    const names = (result.records || [])
      .map(r => String(r.fields?.CustomerName ?? '').trim())
      .filter(Boolean);
    return [...new Set(names)];
  } catch (err) {
    logError(context, err);
    return [];
  }
}

/**
 * Resolve a raw name input against existing customers (fuzzy).
 * @returns {{ resolvedName: string, isNew: boolean, originalInput: string }}
 */
async function resolveCustomerName(shopId, nameRaw) {
  const existingNames = await getShopCustomerNames(shopId);
  const matched = fuzzyMatchName(String(nameRaw ?? '').trim(), existingNames);
  if (matched) return { resolvedName: matched, isNew: false, originalInput: nameRaw };
  // Capitalize first letter of each word for new customers
  const cleaned = String(nameRaw ?? '').trim()
    .replace(/\b\w/g, c => c.toUpperCase());
  return { resolvedName: cleaned, isNew: true, originalInput: nameRaw };
}

/**
 * Create a new Udhaar entry.
 * @param {string} shopId
 * @param {{ customerName, amount, type: 'diya'|'liya', notes, lang }} opts
 */
async function createUdhaarEntry(shopId, { customerName, amount, type = 'diya', notes = '', lang = 'en' } = {}) {
  const context = `Udhaar.Create ${shopId}`;
  try {
    if (!customerName || !amount) {
      return { success: false, error: 'missing_fields', customerName, amount };
    }
    const sid = normalizeShopIdForWrite(shopId);
    const { resolvedName, isNew } = await resolveCustomerName(shopId, customerName);

    const fields = {
      ShopID:                  sid,
      CustomerName:            resolvedName,
      CustomerNameNormalized:  normalizeNameForMatch(resolvedName),
      Amount:                  Number(amount),
      Type:                    String(type),        // 'diya' | 'liya'
      Status:                  'outstanding',
      Date:                    new Date().toISOString(),
      Language:                String(lang),
      ...(notes ? { Notes: String(notes).trim() } : {})
    };

    const result = await airtableRequest({
      method: 'post',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${UDHAAR_TABLE_NAME}`,
      data: { fields }
    }, context);

    console.log('[udhaar-create]', { shop: sid, customer: resolvedName, amount, type, isNew, id: result.id });
    return { success: true, id: result.id, resolvedName, isNew, amount, type };
  } catch (err) {
    logError(context, err);
    return { success: false, error: err.message };
  }
}

/**
 * Record a payment received from a customer.
 * Settles oldest outstanding 'diya' entries first (FIFO).
 */
async function recordPayment(shopId, customerName, amountPaid) {
  const context = `Udhaar.Payment ${shopId}`;
  try {
    const sid = normalizeShopIdForWrite(shopId);
    const { resolvedName } = await resolveCustomerName(shopId, customerName);
    const normName = normalizeNameForMatch(resolvedName);

    // Fetch outstanding 'diya' entries sorted oldest-first
    const filterByFormula = [
      `{ShopID}='${sid.replace(/'/g, "''")}'`,
      `{CustomerNameNormalized}='${normName.replace(/'/g, "''")}'`,
      `{Status}='outstanding'`,
      `{Type}='diya'`
    ].join(',');

    const result = await airtableRequest({
      method: 'get',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${UDHAAR_TABLE_NAME}`,
      params: {
        filterByFormula: `AND(${filterByFormula})`,
        sort: [{ field: 'Date', direction: 'asc' }],
        maxRecords: 100
      }
    }, `${context}.Fetch`);

    const records = result.records || [];
    if (records.length === 0) {
      return { success: false, error: 'no_outstanding', resolvedName };
    }

    let remaining = Number(amountPaid);
    const updates = [];

    for (const rec of records) {
      if (remaining <= 0) break;
      const recAmt = Number(rec.fields?.Amount ?? 0);

      if (remaining >= recAmt) {
        // Fully settle this entry
        updates.push({
          id: rec.id,
          fields: { Status: 'settled', PaidAmount: recAmt, PaidDate: new Date().toISOString() }
        });
        remaining -= recAmt;
      } else {
        // Partial: reduce this entry and mark as partial
        updates.push({
          id: rec.id,
          fields: {
            Status: 'partial',
            Amount: recAmt - remaining,
            PaidAmount: remaining,
            PaidDate: new Date().toISOString()
          }
        });
        remaining = 0;
      }
    }

    // Patch in batches of 10 (Airtable limit)
    for (let i = 0; i < updates.length; i += 10) {
      await airtableRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${UDHAAR_TABLE_NAME}`,
        data: { records: updates.slice(i, i + 10) }
      }, `${context}.Patch`);
    }

    // Compute new balance
    const balRes = await getCustomerBalance(shopId, resolvedName);
    console.log('[udhaar-payment]', { shop: sid, customer: resolvedName, amountPaid, newBalance: balRes.balance });
    return { success: true, resolvedName, amountPaid: Number(amountPaid), newBalance: balRes.balance ?? 0 };
  } catch (err) {
    logError(context, err);
    return { success: false, error: err.message };
  }
}

/**
 * Get outstanding balance for a single customer.
 */
async function getCustomerBalance(shopId, customerName) {
  const context = `Udhaar.Balance ${shopId}`;
  try {
    const sid = normalizeShopIdForWrite(shopId);
    const { resolvedName, isNew } = await resolveCustomerName(shopId, customerName);

    if (isNew) {
      return { success: true, resolvedName, balance: 0, isNew: true, entries: [] };
    }

    const normName = normalizeNameForMatch(resolvedName);
    const filterByFormula = [
      `{ShopID}='${sid.replace(/'/g, "''")}'`,
      `{CustomerNameNormalized}='${normName.replace(/'/g, "''")}'`,
      `OR({Status}='outstanding',{Status}='partial')`,
      `{Type}='diya'`
    ].join(',');

    const result = await airtableRequest({
      method: 'get',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${UDHAAR_TABLE_NAME}`,
      params: {
        filterByFormula: `AND(${filterByFormula})`,
        sort: [{ field: 'Date', direction: 'asc' }],
        maxRecords: 500
      }
    }, context);

    const records = result.records || [];
    const balance = records.reduce((sum, r) => sum + Number(r.fields?.Amount ?? 0), 0);
    const entries = records.map(r => ({
      id:     r.id,
      amount: Number(r.fields?.Amount ?? 0),
      date:   r.fields?.Date,
      status: r.fields?.Status,
      notes:  r.fields?.Notes ?? null,
    }));

    return { success: true, resolvedName, balance, entries, isNew: false };
  } catch (err) {
    logError(context, err);
    return { success: false, error: err.message, balance: null };
  }
}

/**
 * Get full ledger — all customers with outstanding 'diya' balance, grouped + sorted.
 */
async function getShopLedger(shopId) {
  const context = `Udhaar.Ledger ${shopId}`;
  try {
    const sid = normalizeShopIdForWrite(shopId);
    const filterByFormula = [
      `{ShopID}='${sid.replace(/'/g, "''")}'`,
      `OR({Status}='outstanding',{Status}='partial')`,
      `{Type}='diya'`
    ].join(',');

    const result = await airtableRequest({
      method: 'get',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${UDHAAR_TABLE_NAME}`,
      params: {
        filterByFormula: `AND(${filterByFormula})`,
        sort: [{ field: 'CustomerName', direction: 'asc' }],
        maxRecords: 500
      }
    }, context);

    const records = result.records || [];

    // Group by customer, summing balance
    const byCustomer = {};
    for (const rec of records) {
      const name = String(rec.fields?.CustomerName ?? '').trim();
      if (!name) continue;
      byCustomer[name] = (byCustomer[name] ?? 0) + Number(rec.fields?.Amount ?? 0);
    }

    const ledger = Object.entries(byCustomer)
      .map(([customer, balance]) => ({ customer, balance }))
      .sort((a, b) => b.balance - a.balance); // highest first

    const totalOutstanding = ledger.reduce((s, e) => s + e.balance, 0);
    return { success: true, ledger, totalOutstanding, count: ledger.length };
  } catch (err) {
    logError(context, err);
    return { success: false, error: err.message, ledger: [], totalOutstanding: 0 };
  }
}

// ---------------------------------------------------------------------------
// RESPONSE FORMATTERS — Multilingual
// ---------------------------------------------------------------------------

const LANG_STRINGS = {
  en: {
    creditGiven:  (name, amt)       => `✅ Udhaar recorded!\n👤 *${name}*\n💰 ₹${amt} given on credit`,
    creditTaken:  (name, amt)       => `✅ Recorded!\n👤 *${name}*\n💰 ₹${amt} taken on credit`,
    paymentDone:  (name, amt, bal)  => `✅ Payment received!\n👤 *${name}*\n💰 ₹${amt} received\n📊 Remaining balance: ₹${bal}`,
    allClear:     (name)            => `👤 *${name}*\n✅ All clear — no outstanding balance`,
    balance:      (name, bal)       => `👤 *${name}*\n💰 Outstanding: *₹${bal}*`,
    noCustomer:   (name)            => `❌ No udhaar record found for "${name}"`,
    ledgerHeader: (total, count)    => `📒 *Udhaar Ledger*\n${count} customer(s) | Total: *₹${total}*\n──────────────\n`,
    ledgerLine:   (i, name, bal)    => `${i}. ${name} — ₹${bal}`,
    ledgerEmpty:  ()                => `✅ No outstanding udhaar! All accounts are clear.`,
    noAmount:     ()                => `❓ Please mention the amount.\nExample: *Raju ko ₹200 udhaar diya*`,
    noName:       ()                => `❓ Please mention the customer name.\nExample: *Raju ka baaki batao*`,
    newCustomer:  (name)            => ` (new customer added: ${name})`,
  },
  hi: {
    creditGiven:  (name, amt)       => `✅ उधार दर्ज हुआ!\n👤 *${name}*\n💰 ₹${amt} उधार दिया`,
    creditTaken:  (name, amt)       => `✅ दर्ज हुआ!\n👤 *${name}*\n💰 ₹${amt} उधार लिया`,
    paymentDone:  (name, amt, bal)  => `✅ भुगतान मिला!\n👤 *${name}*\n💰 ₹${amt} मिले\n📊 बाकी: ₹${bal}`,
    allClear:     (name)            => `👤 *${name}*\n✅ सब साफ! कोई बाकी नहीं।`,
    balance:      (name, bal)       => `👤 *${name}*\n💰 बाकी: *₹${bal}*`,
    noCustomer:   (name)            => `❌ "${name}" का कोई उधार रिकॉर्ड नहीं मिला`,
    ledgerHeader: (total, count)    => `📒 *उधार खाता*\n${count} ग्राहक | कुल बाकी: *₹${total}*\n──────────────\n`,
    ledgerLine:   (i, name, bal)    => `${i}. ${name} — ₹${bal}`,
    ledgerEmpty:  ()                => `✅ कोई उधार बाकी नहीं! सब साफ है।`,
    noAmount:     ()                => `❓ कृपया राशि बताएं।\nउदाहरण: *राजू को ₹200 उधार दिया*`,
    noName:       ()                => `❓ कृपया ग्राहक का नाम बताएं।\nउदाहरण: *राजू का बाकी बताओ*`,
    newCustomer:  (name)            => ` (नया ग्राहक: ${name})`,
  },
  bn: {
    creditGiven:  (name, amt)       => `✅ ধার রেকর্ড হয়েছে!\n👤 *${name}*\n💰 ₹${amt} ধার দেওয়া হয়েছে`,
    creditTaken:  (name, amt)       => `✅ রেকর্ড হয়েছে!\n👤 *${name}*\n💰 ₹${amt} ধার নেওয়া হয়েছে`,
    paymentDone:  (name, amt, bal)  => `✅ পেমেন্ট পাওয়া গেছে!\n👤 *${name}*\n💰 ₹${amt} পাওয়া গেছে\n📊 বাকি: ₹${bal}`,
    allClear:     (name)            => `👤 *${name}*\n✅ সব পরিষ্কার — কোনো বাকি নেই`,
    balance:      (name, bal)       => `👤 *${name}*\n💰 বাকি: *₹${bal}*`,
    noCustomer:   (name)            => `❌ "${name}"-এর কোনো ধার রেকর্ড পাওয়া যায়নি`,
    ledgerHeader: (total, count)    => `📒 *ধার খাতা*\n${count} জন গ্রাহক | মোট বাকি: *₹${total}*\n──────────────\n`,
    ledgerLine:   (i, name, bal)    => `${i}. ${name} — ₹${bal}`,
    ledgerEmpty:  ()                => `✅ কোনো বাকি ধার নেই! সব পরিষ্কার।`,
    noAmount:     ()                => `❓ অনুগ্রহ করে পরিমাণ উল্লেখ করুন।`,
    noName:       ()                => `❓ অনুগ্রহ করে গ্রাহকের নাম উল্লেখ করুন।`,
    newCustomer:  (name)            => ` (নতুন গ্রাহক: ${name})`,
  },
  gu: {
    creditGiven:  (name, amt)       => `✅ ઉધારી નોંધ થઈ!\n👤 *${name}*\n💰 ₹${amt} ઉધારે આપ્યા`,
    creditTaken:  (name, amt)       => `✅ નોંધ થઈ!\n👤 *${name}*\n💰 ₹${amt} ઉધારે લીધા`,
    paymentDone:  (name, amt, bal)  => `✅ ચૂકવણી મળી!\n👤 *${name}*\n💰 ₹${amt} મળ્યા\n📊 બાકી: ₹${bal}`,
    allClear:     (name)            => `👤 *${name}*\n✅ બધું ક્લિયર — કોઈ બાકી નથી`,
    balance:      (name, bal)       => `👤 *${name}*\n💰 બાકી: *₹${bal}*`,
    noCustomer:   (name)            => `❌ "${name}" માટે કોઈ ઉધારી રેકોર્ડ મળ્યો નહિ`,
    ledgerHeader: (total, count)    => `📒 *ઉધારી ખાતું*\n${count} ગ્રાહક | કુલ બાકી: *₹${total}*\n──────────────\n`,
    ledgerLine:   (i, name, bal)    => `${i}. ${name} — ₹${bal}`,
    ledgerEmpty:  ()                => `✅ કોઈ ઉધારી બાકી નથી! બધું ક્લિયર.`,
    noAmount:     ()                => `❓ કૃપા કરીને રકમ જણાવો.`,
    noName:       ()                => `❓ કૃપા કરીને ગ્રાહકનું નામ જણાવો.`,
    newCustomer:  (name)            => ` (નવા ગ્રાહક: ${name})`,
  },
};

function getLangStrings(lang = 'en') {
  const base = String(lang ?? 'en').toLowerCase().replace(/-latn$/, '').split(/[-_]/)[0];
  return LANG_STRINGS[base] ?? LANG_STRINGS.en;
}

/**
 * Format a WhatsApp-ready response string for the given intent + result.
 */
function formatUdhaarResponse(intent, result, lang = 'en') {
  const L = getLangStrings(lang);
  try {
    switch (intent) {
      case INTENT.DIYA:
        if (!result.resolvedName) return L.noName();
        if (!result.amount)       return L.noAmount();
        return L.creditGiven(result.resolvedName, result.amount)
          + (result.isNew ? L.newCustomer(result.resolvedName) : '');

      case INTENT.LIYA:
        if (!result.resolvedName) return L.noName();
        if (!result.amount)       return L.noAmount();
        return L.creditTaken(result.resolvedName, result.amount);

      case INTENT.WAPAS:
        if (!result.resolvedName) return L.noName();
        if (result.error === 'no_outstanding') return L.allClear(result.resolvedName);
        return L.paymentDone(result.resolvedName, result.amountPaid, result.newBalance ?? 0);

      case INTENT.BAAKI:
        if (result.isNew || (result.resolvedName && result.balance === 0))
          return L.allClear(result.resolvedName ?? '?');
        if (!result.resolvedName) return L.noName();
        return L.balance(result.resolvedName, result.balance ?? 0);

      case INTENT.HISAAB: {
        if (!result.ledger || result.ledger.length === 0) return L.ledgerEmpty();
        let msg = L.ledgerHeader(result.totalOutstanding, result.count);
        result.ledger.forEach((e, i) => {
          msg += L.ledgerLine(i + 1, e.customer, e.balance) + '\n';
        });
        return msg.trim();
      }

      default:
        return null;
    }
  } catch (e) {
    console.error('[udhaar-format]', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// TOP-LEVEL HANDLER — call from whatsapp.js before inventory parsing
// Returns: { handled: true, response: string } OR { handled: false }
// ---------------------------------------------------------------------------

/**
 * @param {string} shopId   - raw shopId from From field (e.g. "+919876543210")
 * @param {string} text     - Body of WhatsApp message
 * @param {string} lang     - detected language code (e.g. 'hi', 'en', 'bn', 'gu')
 * @param {string} requestId - for logging
 */
async function handleUdhaarMessage(shopId, text, lang = 'en', requestId = null) {
  const ctx = `[udhaar${requestId ? ':' + requestId : ''}]`;
  try {
    const parsed = parseUdhaarMessage(text, lang);
    if (!parsed.intent) return { handled: false };

    const { intent, customerName, amount } = parsed;
    console.log(ctx, { intent, customer: customerName, amount, lang });

    let result = {};

    switch (intent) {

      case INTENT.DIYA: {
        if (!customerName) return { handled: true, response: getLangStrings(lang).noName() };
        if (!amount)       return { handled: true, response: getLangStrings(lang).noAmount() };
        const { resolvedName, isNew } = await resolveCustomerName(shopId, customerName);
        result = await createUdhaarEntry(shopId, { customerName: resolvedName, amount, type: 'diya', lang });
        result.resolvedName = result.resolvedName ?? resolvedName;
        result.isNew = result.isNew ?? isNew;
        break;
      }

      case INTENT.LIYA: {
        if (!customerName) return { handled: true, response: getLangStrings(lang).noName() };
        if (!amount)       return { handled: true, response: getLangStrings(lang).noAmount() };
        const { resolvedName } = await resolveCustomerName(shopId, customerName);
        result = await createUdhaarEntry(shopId, { customerName: resolvedName, amount, type: 'liya', lang });
        result.resolvedName = result.resolvedName ?? resolvedName;
        break;
      }

      case INTENT.WAPAS: {
        if (!customerName) return { handled: true, response: getLangStrings(lang).noName() };
        if (!amount)       return { handled: true, response: getLangStrings(lang).noAmount() };
        result = await recordPayment(shopId, customerName, amount);
        break;
      }

      case INTENT.BAAKI: {
        if (!customerName) {
          // No name given → show full ledger
          result = await getShopLedger(shopId);
          return { handled: true, response: formatUdhaarResponse(INTENT.HISAAB, result, lang) };
        }
        result = await getCustomerBalance(shopId, customerName);
        break;
      }

      case INTENT.HISAAB: {
        result = await getShopLedger(shopId);
        break;
      }

      default:
        return { handled: false };
    }

    // Surface DB errors (but not expected "no_outstanding" which has its own message)
    if (result.success === false && result.error && result.error !== 'no_outstanding') {
      console.error(ctx, 'DB error:', result.error);
      // Fail open: don't show raw error to user; let inventory handler try
      return { handled: false };
    }

    const response = formatUdhaarResponse(intent, result, lang);
    if (!response) return { handled: false };

    return { handled: true, response };

  } catch (e) {
    console.error(ctx, 'Unhandled error:', e.message, e.stack);
    return { handled: false }; // fail-open → inventory handler gets a chance
  }
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
module.exports = {
  // Top-level handler (use this in whatsapp.js)
  handleUdhaarMessage,

  // Intent layer
  detectUdhaarIntent,
  parseUdhaarMessage,
  INTENT,

  // Extraction helpers (useful for testing)
  extractAmount,
  extractCustomerName,

  // Fuzzy matching
  fuzzyMatchName,
  resolveCustomerName,

  // CRUD (usable directly for admin/cron scripts)
  createUdhaarEntry,
  recordPayment,
  getCustomerBalance,
  getShopLedger,

  // Formatter
  formatUdhaarResponse,
  getLangStrings,
};
