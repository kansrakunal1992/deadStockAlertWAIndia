// Twilio SDK (needed for TwiML builders like new twilio.twiml.MessagingResponse())
const twilio = require('twilio'); // REQUIRED for TwiML usage [twilio-node docs]
// Shared Twilio REST client (Keep-Alive + Edge/Region already configured in root/twilioClient.js)
const client = require('../twilioClient'); // from /root/api → ../twilioClient.js
// Soniox async transcription helper (server-side file transcription; no streaming)
const { transcribeFileWithSoniox } = require('../stt/sonioxAsync');
const {
  normalizeLangExact,
  toSonioxHints,
  chooseUiLanguage,
} = require('../stt/sonioxLangHints');

const axios = require('axios');
// ---------------------------------------------------------------------------
// NEW: Trial length constant (fallback to 7 days if env not set)
// ---------------------------------------------------------------------------
// Placed near the top to be available to onboarding flow
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 3);
const fs = require('fs');

const crypto = require('crypto');
const path = require('path');
const { execSync } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const CAPTURE_SHOP_DETAILS_ON = String(process.env.CAPTURE_SHOP_DETAILS_ON ?? 'paid').toLowerCase();
// 'paid' → capture after payment; 'trial' → capture during trial onboarding

// ---------------------------------------------------------------------------
// Ultra‑early ack: micro language hint based on Unicode script and Hinglish ASCII
// ---------------------------------------------------------------------------
function guessLangFromInput(s = '') {
  try {
    const text = String(s || '').trim();
    if (!text) return 'en';
    // Script blocks → native languages
    if (/[\u0900-\u097F]/.test(text)) return 'hi';   // Devanagari → Hindi/Marathi
    if (/[\u0980-\u09FF]/.test(text)) return 'bn';   // Bengali
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';   // Tamil
    if (/[\u0C00-\u0C7F]/.test(text)) return 'te';   // Telugu
    if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';   // Kannada
    if (/[\u0A80-\u0AFF]/.test(text)) return 'gu';   // Gujarati
    // ASCII Hinglish detector → Roman Hindi (hi‑latn)    
    const t = text.toLowerCase();
    const isAscii = /^[\x00-\x7F]+$/.test(t);
    // Verbish tokens (existing)
    const hinglishTokens = /\b(kya|kaise|kyon|kyu|kab|kitna|kitni|daam|kimat|fayda|nuksan|bana|sakte|skte|hai|h|kharid|khareed|bech|bikri|dukaan|naam)\b/;
    // NEW: common Roman‑Hindi nouns seen in inventory
    const hinglishNouns = /\b(doodh|dudh|chini|atta|aata|tel|namak|chai|sabzi|sabji|dal|daal|chawal|maggi|amul|parle|parle\-g|frooti|oreo)\b/;      
     // Treat one-word commands as language-neutral (prefer DB or 'en')
     const COMMAND_ONLY = new Set(['mode','help','demo','trial','paid','activate','start']);
     if (COMMAND_ONLY.has(text.toLowerCase())) return 'en';         
     // Widen detection: verbs OR nouns keep us in Roman-Hindi
     if (isAscii && (hinglishTokens.test(t) || hinglishNouns.test(t))) return 'hi-latn';
    return 'en';
  } catch {
    return 'en';
  }
}

// ========================================================================
// [UNIQ:VOICE-CONF-005] Voice (STT) confidence minimum — environment-driven
// Default to 0.60 for audio turns; upstream handlers can read this constant.
// ========================================================================
const STT_CONFIDENCE_MIN_VOICE = Number(process.env.STT_CONFIDENCE_MIN_VOICE ?? 0.60);

// ============================================================================
// Soniox language hints adapter
// Maps your detected/pinned language into the single-language hint Soniox expects
// (recommended to maximize accuracy when you know the language). [2](https://soniox.com/docs/stt/concepts/language-restrictions)
// Supported languages list: hi, bn, ta, te, kn, mr, gu, en. [3](https://soniox.com/docs/stt/concepts/supported-languages)
// ============================================================================
function mapLangToSonioxHints(langCode) {
  const L = String(langCode ?? 'en').toLowerCase();
  switch (L) {
    case 'hi':
    case 'bn':
    case 'ta':
    case 'te':
    case 'kn':
    case 'mr':
    case 'gu':
    case 'en':
      return [L];
    // Romanized variants → prefer English transcription in Latin script
    case 'hi-latn':
    case 'bn-latn':
    case 'ta-latn':
    case 'te-latn':
    case 'kn-latn':
    case 'mr-latn':
    case 'gu-latn':
      return ['en'];
    default:
      return ['en'];
  }
}

/**
 * Resolve Soniox language hints for a given WhatsApp 'From'.
 * Priority:
 *  1) User preference (pinned), if available
 *  2) Detected language from this turn (hint)
 *  3) Fallback 'en'
 */
async function resolveSonioxLanguageHints(From, detectedLanguageHint = 'en') {
  let lang = String(detectedLanguageHint ?? 'en').toLowerCase();
  try {
    const shopId = String(From ?? '').replace('whatsapp:', '');
    if (typeof getUserPreference === 'function') {
      const pref = await getUserPreference(shopId).catch(() => null);
      if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
    }
  } catch { /* noop */ }
  return mapLangToSonioxHints(lang);
}

// --------------------------------------------------------------------------------
// NEW: Canonical language mapper (single source of truth)
// --------------------------------------------------------------------------------
function canonicalizeLang(code) {
  const s = String(code ?? 'en').trim().toLowerCase();
  const map = {        
    // English
    'english': 'en',
    // Hindi / Hinglish
    'hindi': 'hi',
    'hinglish': 'hi-latn',
    'hi-latin': 'hi-latn',
    'roman hindi': 'hi-latn',
    // Bengali
    'bangla': 'bn',
    'bengali': 'bn',
    // Others
    'tamil': 'ta', 'telugu': 'te', 'kannada': 'kn',
    'marathi': 'mr', 'gujarati': 'gu',
  };
  return map[s] ?? s;
}

// ========================================================================
 // [UNIQ:UNIT-TAXONOMY-001] Unified metrics/unit taxonomy & helpers
 // One source of truth for all parsers (rule-based, verb-less, sticky mode).
 // Includes textile-friendly length units + common mass/volume/count units.
 // ========================================================================
 const UNIT_TOKENS = {
   // Length (common for textiles/wires)
   metre:       ['metre','meter','metres','meters','mtr','mtrs','m'],
   centimeter:  ['centimeter','centimetre','centimeters','centimetres','cm'],
   millimeter:  ['millimeter','millimetre','millimeters','millimetres','mm'],
   inch:        ['inch','inches','in'],
   foot:        ['foot','feet','ft'],
   yard:        ['yard','yards','yd'],
   // Area (optional)
   square_meter:['square meter','square metre','sq m','sqm','m²'],
   square_foot: ['square foot','square feet','sq ft','sqft','ft²'],
   // Mass
   kilogram:    ['kilogram','kilograms','kg','kgs'],
   gram:        ['gram','grams','g','gm','gms'],
   milligram:   ['milligram','milligrams','mg'],
   // Volume
   liter:       ['liter','litre','liters','litres','l','ltr','ltrs'],
   milliliter:  ['milliliter','millilitre','milliliters','millilitres','ml'],
   // Count / packs
   piece:       ['piece','pieces','pc','pcs'],
   packet:      ['packet','packets','pkt','pkts','pack','packs'],
   box:         ['box','boxes'],
   bottle:      ['bottle','bottles'],
   dozen:       ['dozen','dozens'],
   roll:        ['roll','rolls'],
 };
 
 const UNIT_REGEX = new RegExp(
   '\\b(?:' +
   Object.values(UNIT_TOKENS)
     .flat()
     .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
     .join('|') +
   ')\\b',
   'i'
 );
 
 const UNIT_CANONICAL_MAP = (() => {
   const m = new Map();
   for (const [canon, toks] of Object.entries(UNIT_TOKENS)) {
     toks.forEach(t => m.set(t.toLowerCase(), canon));
   }
   return m;
 })();
 
 function canonicalizeUnitToken(tok = '') {
   const lc = String(tok).toLowerCase();
   const key = UNIT_CANONICAL_MAP.get(lc);
   if (!key) return tok;
   const DISPLAY = {
     metre: 'metres', centimeter: 'cm', millimeter: 'mm',
     inch: 'inch', foot: 'ft', yard: 'yd',
     square_meter: 'sqm', square_foot: 'sqft',
     kilogram: 'kg', gram: 'g', milligram: 'mg',
     liter: 'ltr', milliliter: 'ml',
     piece: 'pieces', packet: 'packets', box: 'boxes',
     bottle: 'bottles', dozen: 'dozen', roll: 'rolls',
   };
   return DISPLAY[key] ?? tok;
 }

// ------------------------------------------------------------------------
// [UNIFIED PATCH] Roman-Hindi vs Hinglish detection sets + env gate
// ------------------------------------------------------------------------
// Gate to enable/disable stronger roman-Hindi -> native Hindi routing
const ENABLE_ROMAN_HINDI_NATIVE = String(process.env.ENABLE_ROMAN_HINDI_NATIVE ?? '1') === '1';

// Hindi roman number words (extend as needed)
const HI_ROMAN_NUMBER_WORDS = /\b(ek|do|teen|char|paanch|panch|chhe|cheh|saat|aath|aathh|nau|das|gyarah|gyaarah|barah|baarah|terah|chaudah|pandrah|solah|satrah|atharah|unnis|bis|bees|ikkis|bais|teis|chaubees|pachis|chhabis|sattais|athais|untis|tees|chaalis|chalees|pachaas|saath|sattar|assi|nabbe|sau|hazaar|lakh|crore)\b/i;

// English number words (kept for Hinglish intent)
const EN_NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|million|crore)\b/i;

// Common Hindi roman nouns/brands (inventory context)
const HI_ROMAN_NOUNS = /\b(doodh|dudh|atta|aata|tel|chini|chai|paani|namak|biskut|biscuit|sabji|sabzi|dal|daal|chawal|chawal|maggi|amul|parle|parle\-g|frooti|mariegold|goodday|oreo)\b/i;

// English unit tokens (already used elsewhere; redeclare for local checks)
const UNIT_TOKENS_EN = /\b(ltr|liter|litre|liters|litres|kg|g|gm|gms|ml|packet|packets|piece|pieces|box|boxes|bottle|bottles|dozen)\b/i;

const __sentListPickerFor = new Set();

async function maybeResendListPicker(From, lang, requestId) {      
    // Use the canonical E.164 normalizer already defined above.
      const shopKey = shopIdFrom(From); // e.g., "+919013283687"
      const rid = String(requestId ?? Date.now());
      const key = `${shopKey}::${rid}`;
      if (__sentListPickerFor.has(key)) return false;
      const ok = await resendInventoryListPicker(From, lang);
      if (ok) __sentListPickerFor.add(key);
      return ok;
}

// ---------------------------------------------------------------------------
// STEP 2: HOISTED GLOBALS (fix early references like "handledRequests is not defined")
// Place all global Sets/Maps and TTLs at the very top, right after imports.
// ---------------------------------------------------------------------------
// Handled/apology guard: track per-request success to prevent late apologies
const handledRequests = new Set();            // <- used by parse-error & upsell schedulers

// --- [PATCH:MODE-OVERRIDE-FOOTER-20251221] Begin
// Keep the last sticky action set (per shopId) so the footer can reflect
// the new mode immediately on ACK/examples—before caches/DB reads catch up.
// Shape: shopId -> { action: 'purchased'|'sold'|'returned', ts: number }
const __lastStickyAction = new Map();
// --- [PATCH:MODE-OVERRIDE-FOOTER-20251221] End

// --- [PATCH:TXN-CONFIRM-DEDUP-001] Begin ---
// Suppress duplicate transaction confirmations (Purchased/Sold/Returned)
// sent within a short window for the same shopId + normalized text.
const TXN_CONFIRM_TTL_MS = Number(process.env.TXN_CONFIRM_TTL_MS ?? 7000);
const __txnConfirmSeen = new Map(); // key -> { ts }

function _isTxnConfirmationText(s = '') {
  const t = String(s || '').toLowerCase();
  // emoji ↩️ (U+21A9) or common check/box icons, then verb
  return /^(↩️|\u21a9|✅|📦)\s*(returned|sold|purchased)\b/.test(t);
}

function _txnKey(from, body) {
  try {
    const shopId = String(from || '').replace('whatsapp:', '');
    const raw = String(body || '');
    // strip stock annotation e.g., "(Stock: 402 litres)"
    const main = raw.replace(/\(Stock:[^)]+\)/i, '').trim();
    // reuse existing light normalizers
    const norm = _normLite(normalizeNumeralsToLatin(main));
    return `${shopId}::${norm}`;
  } catch {
    return `${from}::${body}`;
  }
}

function _shouldSuppressTxnDuplicate(from, body) {
  try {
    if (!_isTxnConfirmationText(body)) return false;
    const k = _txnKey(from, body);
    const prev = __txnConfirmSeen.get(k);
    const now = Date.now();
    if (prev && (now - prev.ts) < TXN_CONFIRM_TTL_MS) {
      return true;
    }
    __txnConfirmSeen.set(k, { ts: now });
    // cheap sweep
    if (__txnConfirmSeen.size > 1000) {
      for (const [kk, vv] of __txnConfirmSeen) {
        if (now - vv.ts > TXN_CONFIRM_TTL_MS) __txnConfirmSeen.delete(kk);
      }
    }
  } catch {}
  return false;
}
// --- [PATCH:TXN-CONFIRM-DEDUP-001] End ---

// --- Defensive shim: provide a safe setUserState if not present (prevents runtime errors)
if (typeof globalThis.setUserState !== 'function') {      
    globalThis.setUserState = async function setUserState(from, mode, data = {}) {
        try {
          const shopId = shopIdFrom(from);                   
          // Auto-stamp TTL & createdAtISO ONLY for ephemeral override modes.
                const isEphemeral = EPHEMERAL_OVERRIDE_MODES.has(String(mode ?? '').toLowerCase());
                const payload = isEphemeral
                  ? { ...data, createdAtISO: new Date().toISOString(), timeoutSec: (_ttlForMode(mode) / 1000) }
                  : data;
                if (typeof saveUserStateToDB === 'function') {
                  const r = await saveUserStateToDB(shopId, mode, payload);
            if (r?.success) return { success: true };
          }
          console.warn('[shim] setUserState not available; skipping', { from, mode });
        } catch (_) {}
        return { success: false };
      };
}

// --- Defensive shim: provide a safe getUserState if not present (used by some handlers)
if (typeof globalThis.getUserState !== 'function') {
  globalThis.getUserState = async function getUserState(from) {
    try {
      const shopId = shopIdFrom(from);
      if (typeof getUserStateFromDB === 'function') {
        return await getUserStateFromDB(shopId);
      }
    } catch (_) {}
    return null;
  };
}

if (typeof globalThis.clearUserState !== 'function') {
  globalThis.clearUserState = async function clearUserState(shopIdOrFrom) {
    try {
      const key = String(shopIdOrFrom ?? '').replace('whatsapp:', '');
      await deleteUserStateFromDB(key);
    } catch (_) {}
  };
}

// Caches
const languageCache = new Map();
const productMatchCache = new Map();
const inventoryCache = new Map();
const productTranslationCache = new Map();
// === Inventory write policy: DO NOT translate product names for DB writes ===
// Gate is ON by default (DISABLE_PRODUCT_TRANSLATION_FOR_DB=1)
const DISABLE_PRODUCT_TRANSLATION_FOR_DB =
  String(process.env.DISABLE_PRODUCT_TRANSLATION_FOR_DB ?? '1') === '1';

/**
 * resolveProductNameForWrite(updateOrName):
 * Returns the product name to be persisted to DB/batches.
 * Current policy: always use the raw AI product (no translation/normalization).
 */
function resolveProductNameForWrite(updateOrName) {
  const raw = typeof updateOrName === 'string'
    ? updateOrName
    : (updateOrName?.product ?? '');
  // If gate is ON, always trust AI/raw; never translate
  if (DISABLE_PRODUCT_TRANSLATION_FOR_DB) return raw;
  // (If you ever flip the policy, keep raw as default anyway)
  return raw;
}

// TTLs
const LANGUAGE_CACHE_TTL = 24 * 60 * 60 * 1000;          // 24 hours
const INVENTORY_CACHE_TTL = 5 * 60 * 1000;               // 5 minutes
const PRODUCT_CACHE_TTL = 60 * 60 * 1000;                // 1 hour
const PRODUCT_TRANSLATION_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// --- NEW: tiny L1 TTL caches for plan/state to avoid blocking critical paths ---
const planCache = new Map();  // shopId -> { value, ts }
const stateCache = new Map(); // shopId -> { value, ts }
const PLAN_CACHE_TTL  = 60 * 1000;  // 60s
const STATE_CACHE_TTL = 30 * 1000;  // 30s
function _cacheGet(map, key, ttl) {
  try {
    const hit = map.get(String(key));
    if (!hit) return null;
    if (Date.now() - (hit.ts ?? 0) > ttl) return null;
    return hit.value ?? null;
  } catch { return null; }
}
function _cachePut(map, key, value) {
  try { map.set(String(key), { value, ts: Date.now() }); } catch {}
}
async function getUserPlanQuick(shopId) {
  const cached = _cacheGet(planCache, shopId, PLAN_CACHE_TTL);
  if (cached) return cached;
  let planInfo = null;
  try { planInfo = await getUserPlan(shopId); } catch {}
  _cachePut(planCache, shopId, planInfo);
  return planInfo;
}
async function getUserStateQuick(shopId) {
  const cached = _cacheGet(stateCache, shopId, STATE_CACHE_TTL);
  if (cached) return cached;
  let st = null;
  try { st = await getUserStateFromDB(shopId); } catch {}
  _cachePut(stateCache, shopId, st);
  return st;
}

// ---------------------------------------------------------------------------
// E.164 normalizer (India default). Always pass E.164 to Airtable/DB lookups.
// Accepts: "whatsapp:+919013283687", "+919013283687", "9013283687", "91XXXXXXXXXX"
// Returns: "+919013283687" (best-effort)
// ---------------------------------------------------------------------------
function toE164(input) {
  const raw = String(input || '');
  const noPrefix = raw.replace(/^whatsapp:/, '');
  const digits = noPrefix.replace(/\D+/g, '');
  // Already E.164-ish with leading '+'
  if (noPrefix.startsWith('+') && digits.length >= 10) return noPrefix;
  // 91XXXXXXXXXX → +91XXXXXXXXXX
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  // 10-digit local Indian number → +91XXXXXXXXXX
  if (digits.length === 10) return `+91${digits}`;
  // Fallback: return without the 'whatsapp:' prefix
  return noPrefix;
}

// Convenience: always prefer E.164 for DB-facing shopId derivations
const shopIdFrom = (From) => toE164(From);

// ===== Ephemeral overrides (auto-clear only for these modes) ===================
// We will auto-stamp TTLs, auto-expire on read, and schedule a best-effort timer.
const EPHEMERAL_OVERRIDE_MODES = new Set(['awaitingBatchOverride','awaitingPurchaseExpiryOverride']);
const TTL_AWAITING_BATCH_OVERRIDE_SEC =
  Number(process.env.TTL_BATCH_OVERRIDE ?? 120); // default 120s
const TTL_AWAITING_PURCHASE_EXP_OVERRIDE_SEC =
  Number(process.env.TTL_PURCHASE_EXP_OVERRIDE ?? 120); // default 120s

function _ttlForMode(mode) {
  const m = String(mode ?? '').toLowerCase();
  if (m === 'awaitingbatchoverride') return TTL_AWAITING_BATCH_OVERRIDE_SEC * 1000;
  if (m === 'awaitingpurchaseexpiryoverride') return TTL_AWAITING_PURCHASE_EXP_OVERRIDE_SEC * 1000;
  return 0;
}

function _isEphemeralOverride(st) {
  const mode = String(st?.mode ?? '').toLowerCase();
  return EPHEMERAL_OVERRIDE_MODES.has(mode);
}

function _isExpiredEphemeral(st) {
  if (!_isEphemeralOverride(st)) return false;
  const ttlMs = _ttlForMode(st?.mode);
  if (!ttlMs) return false;
  // Prefer explicit timestamp in data; fallback to createdAt fields if present.
  const createdISO =
    st?.data?.createdAtISO ?? st?.createdAtISO ?? st?.createdAt;
  const createdMs = createdISO ? new Date(createdISO).getTime() : 0;
  if (!Number.isFinite(createdMs) || createdMs <= 0) return false; // no timestamp → don’t expire
  return (Date.now() - createdMs) > ttlMs;
}

async function clearEphemeralOverrideStateByShopId(shopId) {
  try {
    const st = await getUserStateFromDB(shopId);
    if (st && _isEphemeralOverride(st)) {
      await deleteUserStateFromDB(st.id ?? shopId);
      console.log('[state] cleared ephemeral override', { shopId, mode: st.mode });
      return true;
    }
  } catch (_) {}
  return false;
}

async function setEphemeralOverrideState(fromOrShopId, mode, data = {}) {
  try {
    const shopId = String(fromOrShopId ?? '').replace('whatsapp:', '');
    const payload = {
      ...data,
      createdAtISO: new Date().toISOString(),
      timeoutSec: (_ttlForMode(mode) / 1000)
    };
    await setUserState(shopId, mode, payload);
    const ttlMs = _ttlForMode(mode);
    if (ttlMs > 0) {
      // Best-effort timer: process-lifetime only; read-side TTL is the hard guard.
      setTimeout(() => {
        clearEphemeralOverrideStateByShopId(shopId).catch(() => {});
      }, ttlMs + 250);
    }
    return { success: true };
  } catch (_) {
    return { success: false };
  }
}

// === Feature flag: ENABLE_STREAK_MESSAGES (inline helper; no imports) ===
let __FLAGS_CACHE; // per-file cache

function __toBool(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function __isStreakEnabled() {
  if (__FLAGS_CACHE && typeof __FLAGS_CACHE.enableStreak === 'boolean') {
    return __FLAGS_CACHE.enableStreak;
  }
  const raw = process.env.ENABLE_STREAK_MESSAGES;
  const enabled = __toBool(raw);
  try {
    console.log('[flags] ENABLE_STREAK_MESSAGES =', raw ?? '(unset)', '→', enabled ? 'ON' : 'OFF');
  } catch (_) {}
  __FLAGS_CACHE = { enableStreak: enabled };
  return enabled;
}
// === End flag helper ===

// --- Gamified streak nudge (gated; safe to leave even if counters aren't live) ---
async function maybeSendStreakMessage(From, lang = 'en', tag = 'streak') {
  // Double gate: respect env flag here too
  if (!__isStreakEnabled()) return false;

  try {
    const shopId = String(From || '').replace('whatsapp:', '');

    // Optional: respect your 15s grace after trial activation (you set this in activateTrialFlow)
    const recent = globalThis._recentActivations?.get?.(shopId);
    if (recent && Date.now() - recent < 15000) return false;

    // Try your own counters if available; otherwise do nothing
    let count = null;
    if (typeof getUserStreakInfo === 'function') {
      const info = await getUserStreakInfo(shopId); // expected shape: {count, qualified}
      count = info?.count;
      if (info && info.qualified === false) return false;
    }
    // If no counters exist yet, quietly skip
    if (!Number.isFinite(count) || count < 1) return false;
        
    let msg = await t(
          `🔥 Streak ${count}! Keep it going—log today’s update to reach ${count + 1}.`,
          lang,
          `${tag}::${shopId}`
        );
        await sendMessageViaAPI(From, finalizeForSend(msg, lang));
    return true;
  } catch (e) {
    console.warn('[streak] failed:', e?.message);
    return false;
  }
}

// [UNIQ:ORCH-VAR-LOCK-001] Variant lock & Sales-QA cache helpers
// ============================================================================
// Keep exact language variant (e.g., 'hi-latn') instead of normalizing to 'hi'
function ensureLangExact(languageDetected, fallback = 'en') {      
    // Canonicalize arbitrary tokens like "hindi", "hinglish" into our supported codes.
      // Still preserves '-latn' variants (hi-latn).
      const l = String(languageDetected ?? fallback).toLowerCase().trim();
      const c = canonicalizeLang(l);
      return c;
}

// ==== NEW: Guard against GSTIN / code-dominant inputs flipping language =====
async function checkAndUpdateLanguageSafe(text, From, currentLang, requestId) {
  try {
    const msg = String(text ?? '').trim();
    const isGSTINLike = /^[0-9A-Z]{15}$/i.test(msg);
    const asciiLen = msg.replace(/[^\x00-\x7F]/g, '').length;
    const isCodeDominant = asciiLen / Math.max(1, msg.length) > 0.85 || (msg.match(/\d/g) || []).length >= 10;
    // If pure code (GSTIN or numeric-heavy), keep user's language preference unchanged
    if (isGSTINLike || isCodeDominant) {
      return currentLang ?? 'en';
    }
    // Otherwise, delegate to your existing detector/persistence
    return await checkAndUpdateLanguage(msg, From, currentLang ?? 'en', requestId);
  } catch (e) {
    console.warn(`[${requestId}] checkAndUpdateLanguageSafe failed; keeping ${currentLang}:`, e?.message);
    return currentLang ?? 'en';
  }
}

// -----------------------------------------------------------------------------
// Lightweight auto-detector (expanded): switch native target to '*-latn' when
// input is ASCII-looking Roman Indic across multiple languages. No bilingual
// output—tx() is single-call and Unicode clamp keeps one script.
// -----------------------------------------------------------------------------
function autoLatnIfRoman(languageCode, sourceText) {
  try {
    const raw = String(sourceText ?? '');
    // Fast ASCII check: Romanized inputs typically stay in 0x00–0x7F
    const isAscii = /^[\x00-\x7F]+$/.test(raw);
    if (!isAscii) return languageCode;  
    const t = raw.toLowerCase();
    
        // --- Hindi/Marathi (Hinglish) ---
        const hiTokens = /\b(kya|kyu|kaise|kab|kitna|kitni|daam|kimat|bhav|fayda|nuksan|bana|sakte|skte|hai|h|kharid|khareed|bech|bikri|return|wapis|chalu|shuru|tod|dukaan|naam)\b/;
        // --- Bengali (Banglish) ---
        const bnTokens = /\b(koto|dam|dami|kimot|shuru|cholbe|kharid|kena|bikri|bikre|ferot|return)\b/;
        // --- Tamil (Tanglish) ---
        const taTokens = /\b(enna|epadi|eppadi|evlo|evvalu|price|vilai|todangu|arambam|suru|kharidu|vangi|vangirom|vittu|vikkal|return|thiruppu)\b/;
        // --- Telugu (Teluglish) ---
        const teTokens = /\b(emi|ela|enta|dharam|price|prarambhinchandi|start|kharid|konugolu|ammu|ammina|return|tirigi|cheyaali|naaku|kaavali)\b/;
        // --- Kannada (Kanglish) ---
        const knTokens = /\b(enenu|hege|eshtu|bele|shuru|prarambhisi|kharidi|kondu|marata|sale|return|wapsi|beku|maadabeku)\b/;
        // --- Gujarati (Gujlish) ---
        const guTokens = /\b(shu|kem|ketlu|bhav|kimat|daam|sharu|chalu|kharid|levu|vech|vechaan|return|wapas|joie|joye|joiy|karvu|chhe)\b/;
    
        const hitHi = hiTokens.test(t);
        const hitBn = bnTokens.test(t);
        const hitTa = taTokens.test(t);
        const hitTe = teTokens.test(t);
        const hitKn = knTokens.test(t);
        const hitGu = guTokens.test(t);
        const anyHit = hitHi || hitBn || hitTa || hitTe || hitKn || hitGu;
        if (!anyHit) return languageCode;          
      const base = String(languageCode ?? 'en').toLowerCase().replace(/-latn$/, '');
          const isIndicBase = /^(hi|bn|ta|te|kn|mr|gu)$/.test(base);
          if (!isIndicBase) return languageCode; // Already en or non-Indic
      
          // [PATCH] Respect strong roman-Hindi intent: KEEP native Hindi (hi) instead of flipping to hi-latn
          if (ENABLE_ROMAN_HINDI_NATIVE) {
            const strongHindiRoman =
              HI_ROMAN_NUMBER_WORDS.test(t) &&
              UNIT_TOKENS_EN.test(t) &&
              HI_ROMAN_NOUNS.test(t);
            if (base === 'hi' && strongHindiRoman) {
              return 'hi';
            }
          }
    
        // Prefer switching to the *-latn variant matching the detected base language.
        // If AI/heuristics said 'hi' but tokens looked Tamil-ish, we still respect 'hi'
        // (to avoid cross-language jumps), and simply flip to 'hi-latn'.
        switch (base) {
          case 'hi': return 'hi-latn';
          case 'mr': return 'mr-latn';
          case 'bn': return 'bn-latn';
          case 'ta': return 'ta-latn';
          case 'te': return 'te-latn';
          case 'kn': return 'kn-latn';
          case 'gu': return 'gu-latn';
          default:   return languageCode;
        }
  } catch (_) {
    return languageCode;
  }
}

// ==== NEW: Units mapping for all supported languages (base code only) ===========
const UNIT_MAP = {
  hi: {
    kg: 'किलो', g: 'ग्राम', gm: 'ग्राम', ml: 'एमएल', l: 'लीटर', ltr: 'लीटर',
    packet: 'पैकेट', packets: 'पैकेट', piece: 'पीस', pieces: 'पीस',
    box: 'बॉक्स', boxes: 'बॉक्स', bottle: 'बोतल', bottles: 'बोतल', dozen: 'दर्जन',
    metre: 'मीटर', metres: 'मीटर'
  },
  bn: {
    kg: 'কেজি', g: 'গ্রাম', gm: 'গ্রাম', ml: 'এমএল', l: 'লিটার', ltr: 'লিটার',
    packet: 'প্যাকেট', packets: 'প্যাকেট', piece: 'পিস', pieces: 'পিস',
    box: 'বাক্স', boxes: 'বাক্স', bottle: 'বোতল', bottles: 'বোতল', dozen: 'ডজন',
    metre: 'মিটার', metres: 'মিটার'
  },
  ta: {
    kg: 'கி', g: 'கிராம்', gm: 'கிராம்', ml: 'எம்எல்', l: 'லிட்டர்', ltr: 'லிட்டர்',
    packet: 'பாக்கெட்', packets: 'பாக்கெட்', piece: 'பீஸ்', pieces: 'பீஸ்',
    box: 'பெட்டி', boxes: 'பெட்டிகள்', bottle: 'பாட்டில்', bottles: 'பாட்டில்கள்', dozen: 'டஜன்',
    metre: 'மீட்டர்', metres: 'மீட்டர்'
  },
  te: {
    kg: 'కిలో', g: 'గ్రామ్', gm: 'గ్రామ్', ml: 'ఎంఎల్', l: 'లీటర్', ltr: 'లీటర్',
    packet: 'ప్యాకెట్', packets: 'ప్యాకెట్లు', piece: 'పీసు', pieces: 'పీసులు',
    box: 'డబ్బా', boxes: 'డబ్బాలు', bottle: 'సీసా', bottles: 'సీసాలు', dozen: 'డజన్',
    metre: 'మీటరు', metres: 'మీటర్లు'
  },
  kn: {
    kg: 'ಕೆಜಿ', g: 'ಗ್ರಾಂ', gm: 'ಗ್ರಾಂ', ml: 'ಎಂಎಲ್', l: 'ಲೀಟರ್', ltr: 'ಲೀಟರ್',
    packet: 'ಪ್ಯಾಕೆಟ್', packets: 'ಪ್ಯಾಕೆಟ್‌ಗಳು', piece: 'ಪೀಸ್', pieces: 'ಪೀಸ್‌ಗಳು',
    box: 'ಬಾಕ್ಸ್', boxes: 'ಬಾಕ್ಸ್‌ಗಳು', bottle: 'ಬಾಟಲ್', bottles: 'ಬಾಟಲಿಗಳು', dozen: 'ಡಜನ್',
    metre: 'ಮೀಟರ್', metres: 'ಮೀಟರ್'
  },
  mr: {
    kg: 'किलो', g: 'ग्रॅम', gm: 'ग्रॅम', ml: 'एमएल', l: 'लिटर', ltr: 'लिटर',
    packet: 'पॅकेट', packets: 'पॅकेट', piece: 'पीस', pieces: 'पीस',
    box: 'बॉक्स', boxes: 'बॉक्स', bottle: 'बाटली', bottles: 'बाटल्या', dozen: 'डझन',
    metre: 'मीटर', metres: 'मीटर'
  },
  gu: {
    kg: 'કિલો', g: 'ગ્રામ', gm: 'ગ્રામ', ml: 'એમએલ', l: 'લિટર', ltr: 'લિટર',
    packet: 'પેકેટ', packets: 'પેકેટ', piece: 'પીસ', pieces: 'પીસ',
    box: 'બોક્સ', boxes: 'બોક્સ', bottle: 'બોટલ', bottles: 'બોટલો', dozen: 'ડઝન',
    metre: 'મીટર', metres: 'મીટર'
  }
};
function displayUnit(unit, lang = 'en') {
  const base = String(lang).toLowerCase().replace(/-latn$/, ''); // hi-latn -> hi
  const u = String(unit ?? '').toLowerCase().trim();
  const map = UNIT_MAP[base];
  return map ? (map[u] ?? unit) : unit;
}

// [PATCH:UNIT-NORMALIZER-20251226] Provide a safe unit normalizer used across
// updateMultipleInventory and serializers (global shim to avoid import churn).
if (typeof globalThis.normalizeUnit !== 'function') {
  globalThis.normalizeUnit = function normalizeUnit(unitRaw) {
    try {
      const tok = String(unitRaw ?? '').trim().toLowerCase();
      if (!tok) return '';
      // Reuse the canonical unit map and display decisions you've already defined.
      const normalized = canonicalizeUnitToken(tok); // e.g., "kg"/"kgs"/"kilogram" → "kg"
      return normalized ?? tok;
    } catch (_) {
      return String(unitRaw ?? '').trim();
    }
  };
}

// =======================================================================
// [STRICT-PURCHASE-PRICE-REQUIRED] Helpers
// Enforce: do NOT accept "purchased" lines without price when backend
// has no known price for that product. Nudge the user to resend line
// with price; no DB writes, no confirmations for those lines.
// =======================================================================
async function isPriceKnown(shopId, productName) {
  try {
    const res = await getProductPrice(productName, shopId);
    return !!(res?.success && Number.isFinite(res.price));
  } catch { return false; }
}

async function sendPriceRequiredNudge(From, productName, unit, langHint = 'en', opts = {}) {
  try {
    const lang = String(langHint ?? 'en').toLowerCase();
    const unitDisp = displayUnit(unit ?? 'unit', lang);
    const onlyOnceLine = lang.startsWith('hi')
      ? `नया प्रोडक्ट होने के कारण कीमत सिस्टम में सेव नहीं है—कीमत सिर्फ एक बार देना ज़रूरी है।`
      : `Since it's a new product, price isn't stored in the system—it's required only one time.`;
    const bodySrc = [
      `🟡 Price required for “${productName}”.`,
      onlyOnceLine,
      '',
      `Please resend in one line WITH price. Examples (type or speak a voice note):`,
      `• ${productName} 10 ${unitDisp} at ₹70 per ${unitDisp}`,
      `• ${productName} 10 ${unitDisp} ₹70/${unitDisp} exp +6m`,
    ].join('\n');
    let msg0 = await t(bodySrc, lang, `price-required::${productName}`);
    msg0 = nativeglishWrap(msg0, lang);
    const tagged = await tagWithLocalizedMode(From, finalizeForSend(msg0, lang), lang);
    await sendMessageViaAPI(From, tagged);
  } catch (e) {
    console.warn('[price-nudge] failed:', e?.message);
  }
}

async function sendMultiPriceRequiredNudge(From, items, langHint = 'en') {
  try {
    const lang = String(langHint ?? 'en').toLowerCase();
    const onlyOnceLine = lang.startsWith('hi')
      ? `नए प्रोडक्ट्स के लिए कीमत सिस्टम में नहीं है—कीमत सिर्फ एक बार देना ज़रूरी है।`
      : `For new products, price isn't stored—it's required only one time.`;
    const bullets = (items ?? []).map(it => {
      const uDisp = displayUnit(it.unit ?? 'unit', lang);
      return `• ${it.product}: e.g. (type or speak a voice note): “purchased ${it.product} 10 ${uDisp} @ ₹70/${uDisp}”`;
    }).join('\n');
    const bodySrc = [
      `🟡 Price required for the following products:`,
      bullets,
      '',
      onlyOnceLine
    ].join('\n');
    let msg0 = await t(bodySrc, lang, `price-required::multi`);
    msg0 = nativeglishWrap(msg0, lang);
    const tagged = await tagWithLocalizedMode(From, finalizeForSend(msg0, lang), lang);
    await sendMessageViaAPI(From, tagged);
  } catch (e) {
    console.warn('[price-nudge-multi] failed:', e?.message);
  }
}

 // ========================================================================
 // [UNIQ:WORDS-TO-DIGITS-002] English number words → digits (voice-friendly)
 // Handles compounds ("twenty five"), hyphens, "point five", and Indian scales.
 // ========================================================================
 function wordsToNumber(input) {
   if (!input) return '';
   const SMALL = {
     zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
     ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15,
     sixteen:16, seventeen:17, eighteen:18, nineteen:19
   };
   const TENS = { twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
   // India-friendly scales (optional: 'million' kept for generality)
   const SCALE = { hundred:100, thousand:1000, lakh:100000, million:1000000, crore:10000000 };
   const clean = String(input).toLowerCase().replace(/-/g,' ').replace(/\band\b/g,' ').replace(/\s+/g,' ').trim();
   const tokens = clean.split(/\b/);
   const out = [];
   let buffer = [];
   const flush = () => {
     if (!buffer.length) return;
     const decIdx = buffer.indexOf('point');
     if (decIdx >= 0) {
       const intVal = parseNumberWords(buffer.slice(0, decIdx));
       const fracVal = buffer.slice(decIdx + 1).map(w => SMALL[w] ?? (/\d/.test(w) ? w : '')).join('');
       if (intVal != null && fracVal) { out.push(String(intVal) + '.' + String(fracVal)); buffer = []; return; }
     }
     const val = parseNumberWords(buffer);
     out.push(val != null ? String(val) : buffer.join(''));
     buffer = [];
   };
   function parseNumberWords(arr) {
     let total = 0, current = 0, seen = false;
     for (const raw of arr) {
       const w = raw.trim(); if (!w) continue;
       if (w in SMALL) { current += SMALL[w]; seen = true; continue; }
       if (w in TENS)  { current += TENS[w];  seen = true; continue; }
       if (w in SCALE) { if (!seen && w === 'hundred') return null; current *= SCALE[w]; total += current; current = 0; seen = true; continue; }
       if (/^\d+$/.test(w)) { total += current; current = 0; total += parseInt(w,10); seen = true; continue; }
       return null;
     }
     total += current; return seen ? total : null;
   }
   for (const t of tokens) {
     const token = t.trim();
     if (!token) { out.push(t); continue; }
     const isNumberish = (token in SMALL) || (token in TENS) || (token in SCALE) || token === 'point' || /^\d+$/.test(token);
     if (isNumberish) { buffer.push(token); continue; }
     flush(); out.push(t);
   }
   flush(); return out.join('');
 }

// ------------------------------------------------------------------------
// [PATCH] Hindi roman number words -> digits (lightweight normalizer)
// ------------------------------------------------------------------------
function hindiRomanWordsToDigits(input) {
  if (!input) return '';
  const t = String(input).toLowerCase();
  const map = new Map([
    ['ek',1],['do',2],['teen',3],['char',4],
    ['paanch',5],['panch',5],['chhe',6],['cheh',6],
    ['saat',7],['aath',8],['aathh',8],['nau',9],
    ['das',10],['gyarah',11],['gyaarah',11],['barah',12],['baarah',12],
    ['terah',13],['chaudah',14],['pandrah',15],['solah',16],
   ['satrah',17],['atharah',18],['unnis',19],
    ['bis',20],['bees',20],['ikkis',21],['bais',22],['teis',23],
    ['chaubees',24],['pachis',25],['chhabis',26],['sattais',27],
    ['athais',28],['untis',29],['tees',30],['chaalis',40],['chalees',40],
    ['pachaas',50],['saath',60],['sattar',70],['assi',80],['nabbe',90],
    ['sau',100],['hazaar',1000],['lakh',100000],['crore',10000000],
  ]);
  return t.replace(/\b([a-z\-]+)\b/g, (m) => {
    const v = map.get(m);
    return (typeof v === 'number') ? String(v) : m;
  });
}

async function composeLowStockLocalized(shopId, lang, requestId) {
  // Try DB low-stock (threshold 5); fallback to inventory if needed
  let items = [];
  try {
    items = await getLowStockProducts(shopId, 5) || [];
  } catch (_) {}
  const count = items.length;
  const header = lang.startsWith('hi')
    ? `🟠 कम स्टॉक — ${count} आइटम`
    : `🟠 Low Stock — ${count} items`;
  const lines = (count ? items.slice(0, 10) : []).map(async p => {
    const nameSrc = p.name ?? p.fields?.Product ?? '—';
    const nameHi = await translateProductName(nameSrc, `lowstock-${shopId}`);
    const qty = p.quantity ?? p.fields?.Quantity ?? 0;
    const unit = displayUnit(p.unit ?? p.fields?.Units ?? 'pieces', lang);
    return `• ${nameHi} — ${qty} ${unit}`;
  });
  const resolved = (await Promise.all(lines)).join('\n');
  const more = count > 10 ? (lang.startsWith('hi') ? '• +1 और' : '• +1 more') : '';
  const actionLine = lang.startsWith('hi')
    ? '➡️ कार्रवाई: "पुन: ऑर्डर सुझाव" देखें या "मूल्य" की समीक्षा करें।'
    : '➡️ Action: check "reorder suggestions" or review "prices".';
  const body = [header, resolved, more, '', actionLine].filter(Boolean).join('\n');
  // Respect your Nativeglish anchors + footer/mode tags
  const msg0 = await tx(body, lang, `whatsapp:${shopId}`, 'low-stock', `lowstock::${shopId}`);
  return nativeglishWrap(await tagWithLocalizedMode(`whatsapp:${shopId}`, msg0, lang), lang);
}

function isSafeAnchor(text) {
    const safePatterns = [
        /start trial/i,
        /activate trial/i,
        /activate paid/i,
        /paid confirm/i,              
        // NEW: Treat localized 'mode' tokens as safe anchors too (avoid mixed-script clamps)
        // Hindi, Bengali, Tamil, Telugu, Kannada, Marathi, Gujarati
        /\b(मोड)\b/u,
        /\b(মোড)\b/u,
        /\b(மோடு)\b/u,
        /\b(మోడ్)\b/u,
        /\b(ಮೋಡ್)\b/u,
        /\b(मोड)\b/u,
        /\b(મોડ)\b/u,  
        /help/i,
        /support/i,
        /Saamagrii\.AI/i,
        /\bSaamagrii\.AI\b/,  
        /Saamagrii\.AI/i,
        /WhatsApp/i,
        /https?:\/\//i,
        /wa\.link/i,
        /\b(kg|kgs|g|gm|gms|ltr|ltrs|l|ml|packet|packets|piece|pieces|₹|Rs|MRP|exp|expiry|expiring)\b/i,
        /\b(GSTIN|GST|CGST|SGST|IGST|PAN|FSSAI|UPI|HSN|SKU|QR)\b/i,              
        /\b(Short Summary|Full Summary|Sales Today|Low Stock|Expiring Soon|Next actions)\b/i,
        /"(low stock|reorder suggestions|expiring 0|expiring 7|expiring 30|sales (today|week|month)|top 5 products month|inventory value|stock value|value summary)"/i,                
        // NEW: English headers & quoted commands
           /\b(Short Summary|Full Summary|Sales Today|Low Stock|Expiring Soon|Next actions)\b/i,
           /"(reorder suggestions|prices|stock value)"/i,
           // NEW: Hindi (Devanagari)
           /\b(संक्षिप्त सारांश|आज की बिक्री|स्टॉक कम|शीघ्र समाप्त|अगले कदम)\b/,
           /"(पुनः ऑर्डर सुझाव|मूल्य|स्टॉक मूल्य)"/,
           // NEW: Hinglish (Roman Hindi)
           /\b(Short Summary|Agle Kadam|Kam Stock|Jaldi Khatm)\b/i,
           /"(punah order sujhav|moolya|stock moolya)"/i,
           // NEW: Bengali
           /\b(সংক্ষিপ্ত সারাংশ|আজকের বিক্রি|স্টক কম|শীঘ্রই মেয়াদোত্তীর্ণ|পরবর্তী পদক্ষেপ)\b/,
           /"(পুনঃঅর্ডার পরামর্শ|মূল্য|স্টকের মূল্য)"/,
           // NEW: Tamil
           /\b(சுருக்கம்|இன்று விற்பனை|இருப்பு குறைவு|விரைவில் காலாவதி|அடுத்த செயல்கள்)\b/,
           /"(மீண்டும் ஆர்டர் பரிந்துரைகள்|விலைகள்|இருப்பு மதிப்பு)"/,
           // NEW: Telugu
           /\b(సంక్షిప్త సారాంశం|ఈరోజు అమ్మకాలు|తక్కువ నిల్వ|త్వరలో గడువు|తదుపరి చర్యలు)\b/,
           /"(పునః ఆర్డర్ సూచనలు|ధరలు|నిల్వ విలువ)"/,
           // NEW: Kannada
           /\b(ಸಂಕ್ಷಿಪ್ತ ಸಾರಾಂಶ|ಇಂದಿನ ಮಾರಾಟ|ಕಡಿಮೆ ಸಂಗ್ರಹ|ಶೀಘ್ರದಲ್ಲೇ ಅವಧಿ|ಮುಂದಿನ ಕ್ರಮಗಳು)\b/,
           /"(ಮರುಆರ್ಡರ್ ಸಲಹೆಗಳು|ಬೆಲೆಗಳು|ಸ್ಟಾಕ್ ಮೌಲ್ಯ)"/,
           // NEW: Marathi
           /\b(संक्षिप्त सारांश|आजची विक्री|कमी साठा|लवकरच कालबाह्य|पुढील कृती)\b/,
           /"(पुन्हा ऑर्डर सुचवणी|किंमती|साठा मूल्य)"/,
           // NEW: Gujarati
           /\b(સંક્ષિપ્ત સારાંશ|આજનું વેચાણ|ઓછો જથ્થો|ટૂંક સમયમાં ગાળા પૂરા|આગળની કાર્યવાહી)\b/,
           /"(પુનઃ ઓર્ડર સૂચનો|કિંમતો|સ્ટોક મૂલ્ય)"/
    ];
    return safePatterns.some(rx => rx.test(text));
}

// Normalize user question for cache key purposes
function normalizeUserTextForKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s₹\.]/gu, '');
}

 // ===== NEW: Safe normalizer to avoid "text is not defined" =====
 function safeNormalizeForQuickQuery(input) {
   const msg = String(input ?? '').trim();
   try {
     const canon = normalizeUserTextForKey(msg);
     return canon;
   } catch (e) {
     console.warn('[quick-query normalize] failed:', e?.message);
     return msg;
   }
 }

// Build a robust Sales-QA key that separates language variants & topics
// Using base64 for log readability (your logs show base64 promptHash values)

// Optional runtime flag to toggle off cache hits without removing writes
 const DISABLE_SALES_QA_CACHE_HIT =
   String(process.env.DISABLE_SALES_QA_CACHE_HIT ?? '1').toLowerCase() === '1';

function buildSalesQaCacheKey({ langExact, topicForced, pricingFlavor, text }) {  
// crypto is already imported in your file; reuse it here.
// SAFETY: tolerate missing/undefined text at call sites.
  const normalized = safeNormalizeForQuickQuery(typeof text === 'string' ? text : '');

  const payload = [
    'sales-qa',
    String(langExact ?? 'en'),
    String(topicForced ?? 'none'),
    String(pricingFlavor ?? 'none'),
    normalized
  ].join('::');
  const base = crypto.createHash('sha1').update(payload).digest('base64');
  // Return a per-request unique key when disabling cache hits
  // (ensures lookups never match previous writes; minimal blast radius)
  return DISABLE_SALES_QA_CACHE_HIT ? `${base}::${Date.now()}` : base;
 }

// Lightweight pricing validator (optional use downstream)
function isPricingAnswer(text) {
  return /\b(₹|rs\.?|inr)\b/i.test(String(text || '')) || /\d/.test(String(text || ''));
}

// [UNIQ:MLR-FLAGS-002] Runtime flag: disable translation cache for *-latn
// Default ON to avoid generic/stale cache for Hinglish (hi-latn) & variants.
// Set DISABLE_TRANSLATION_CACHE_FOR_LATN=0 to re-enable if ever needed.
// ---------------------------------------------------------------------------
const DISABLE_TRANSLATION_CACHE_FOR_LATN =
  String(process.env.DISABLE_TRANSLATION_CACHE_FOR_LATN ?? '1') === '1';

// ---------------------------------------------------------------------------
// [UNIQ:MLR-UTIL-003B] Decide if we should emit roman-only for language variants
// ---------------------------------------------------------------------------
function shouldUseRomanOnly(languageCode) {
  return String(languageCode || '').toLowerCase().endsWith('-latn');
}

// === Render policy: single block, one script chosen by variant =================
// 'latin' for en or *-latn; 'native' for Indic codes without -latn.
function chooseRenderMode(languageCode) {
  const L = String(languageCode ?? 'en').toLowerCase().trim();
  if (L === 'en') return 'latin';
  if (L.endsWith('-latn')) return 'latin';
  // All supported Indic languages use native script: hi, bn, ta, te, kn, mr, gu
  return 'native';
}

// Canonical commands & button labels we want in "double quotes" in any language
const QUOTE_TERMS = ['low stock','reorder suggestions','expiring 0','expiring 7','expiring 30','short summary','full summary','sales today','sales week','sales month','top 5 products month','inventory value','stock value','value summary','start trial','demo','help','paid','activate paid','activate trial'];

// === Single-block formatter with de-duplication for echoes ===================
function normalizeTwoBlockFormat(raw, languageCode) {          
        if (!raw) return '';
          let s = String(raw ?? '')
            .replace(/[\`"<>\[\]\\]/g, '')
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .trim();
          const punct = /[.!?]$/;
          // De-echo: drop duplicates
          const lines = s.split(/\n+/).map(l => l.trim()).filter(Boolean);
          const uniq = [];
          const seen = new Set();
          for (const l of lines) {
            const key = l.toLowerCase();
            if (!seen.has(key)) { uniq.push(l); seen.add(key); }
          }
          s = uniq.join('\n');
          // (Do not clamp here; clamping is centralized in t(...)/enforceSingleScriptSafe)
          if (!punct.test(s)) s += '.';
          return normalizeNumeralsToLatin(s);
}

// Minimal helper: de-duplicate repeated bullet/example lines (case-insensitive)
function dedupeBullets(text) {
  try {
    const lines = String(text ?? '').split(/\r?\n/);
    const seen = new Set();
    const out = [];
    for (const ln of lines) {
      const key = ln.trim().toLowerCase();
      if (!key) { out.push(ln); continue; }
      if (!seen.has(key)) { seen.add(key); out.push(ln); }
    }
    return out.join('\n');
  } catch { return text; }
}

// ====== AI-backed language & intent detection (guarded, cached) ======
const _aiDetectCache = new Map(); // key: text|heuristicLang -> {language,intent,ts}
const AI_DETECT_TTL_MS = Number(process.env.AI_DETECT_TTL_MS ?? 5 * 60 * 1000); // 5 min

// Parse multiple inventory updates from transcript
// Accepts either a req-like object (req.body.{From, Body}) OR plain text.
async function parseMultipleUpdates(reqOrText, requestId) {
  // Shape detection: request-like vs plain text
  const isReq = reqOrText && typeof reqOrText === 'object';
  const from =
    (isReq && (reqOrText.body?.From || reqOrText.From)) || null;
  const transcript =
    (isReq && (reqOrText.body?.Body || reqOrText.Body)) ||
    (!isReq ? String(reqOrText ?? '') : '');
  
  // SAFE requestId derivation
  const shopIdMaybe = String(from || '').replace('whatsapp:', '');
  const requestId1 =
    (isReq && (reqOrText.requestId || reqOrText?.headers?.['x-request-id'])) ||
    `pmu-${Date.now()}-${shopIdMaybe || 'unknown'}`;

  // Guard: never throw on missing From; just log once & return []
  if (!from) {
    if (isReq) {
      try {
        console.warn('[parseMultipleUpdates] Missing "From" in request body:', JSON.stringify(reqOrText.body ?? {}, null, 2));
      } catch (_) {
        console.warn('[parseMultipleUpdates] Missing "From" in request body: <unavailable>');
      }
    }
    // No shopId → no user state; safely return no updates
    return [];
  }
  const shopId = String(from).replace('whatsapp:', '');
  const updates = [];  
  // ----------------------------------------------------------------------
     // [UNIQ:WORDS-TO-DIGITS-002] Normalize spelled numbers → digits for STT
     // ----------------------------------------------------------------------
     let t = String(transcript ?? '').trim();        
    // [PATCH] Normalize Hindi roman number words first (e.g., "bees litre dudh" -> "20 litre dudh")
      t = hindiRomanWordsToDigits(t);
      // Existing English words-to-number normalizer (keeps support for "twenty litre dudh")
      t = wordsToNumber(t); 
  // Prefer DB state; use in-memory fallback if DB read is transiently null
  const userState = (await getUserStateFromDB(shopId)) || globalState.conversationState[shopId] || null;      
  
  // --- [NEW EARLY EXIT: trial-onboarding capture] ---------------------------------
  // If user is in onboarding flow, consume this message and do not parse as inventory        
  if (userState && (userState.mode === 'onboarding_trial_capture' || userState.mode === 'onboarding_paid_capture')) {
     try {
       const langHint = await detectLanguageWithFallback(transcript, from ?? `whatsapp:${shopId}`, 'onboard-capture');
       if (userState.mode === 'onboarding_trial_capture') {
         await handleTrialOnboardingStep(from ?? `whatsapp:${shopId}`, transcript, langHint, requestId1);
       } else {
         await handlePaidOnboardingStep(from ?? `whatsapp:${shopId}`, transcript, langHint, requestId1);
       }
     } catch (e) { console.warn('[onboard-capture] step failed:', e?.message); }
     return []; // consume onboarding messages
   }
  
     // NEW: global skip message guard to avoid alias/transaction normalization
     try {
       const tLower = String(transcript ?? '').trim().toLowerCase();
       if (isSkipMessage(tLower)) {
         // Acknowledge politely; do not parse as inventory
         const langHint = await detectLanguageWithFallback(transcript, from, 'skip-ack');
         const okText = await t('Okay—skipped.', langHint, 'skip-ack');
         await sendMessageViaAPI(from, finalizeForSend(okText, langHint));
         return [];
       }
     } catch (_) { /* best-effort */ }
    
  // Standardize valid actions (canonical: purchased, sold, returned)
  const VALID_ACTIONS = ['purchased', 'sold', 'returned'];
  
  // Get pending action from user state if available    
  let pendingAction = null;
    if (userState) {
      if (userState.mode === 'awaitingTransactionDetails' && userState.data?.action) {
        pendingAction = userState.data.action;              // purchased | sold | returned
      } else if (userState.mode === 'awaitingBatchOverride') {
        pendingAction = 'sold';                             // still in SALE context
      } else if (userState.mode === 'awaitingPurchaseExpiryOverride') {
        pendingAction = 'purchased';                         // still in PURCHASED context
      }
      if (pendingAction) {
        console.log(`[parseMultipleUpdates] Using pending action from state: ${pendingAction}`);
      }
    }
    
  // ----------------------------------------------------------------------
     // [UNIQ:ACTION-INFER-004] Infer action directly from text if no sticky mode
     // ----------------------------------------------------------------------
     function resolveActionFromText(s) {
       const t = String(s||'').toLowerCase();
       const PURCHASE = /\b(purchase|purchased|buy|bought|billed in|restock|opening|received|recd)\b/;
       const SALE     = /\b(sale|sell|sold|billed out|issued)\b/;
       const RETURN   = /\b(return|returned|refund|exchange)\b/;
       if (PURCHASE.test(t)) return 'purchased';
       if (SALE.test(t))     return 'sold';
       if (RETURN.test(t))   return 'returned';
       return null;
     }
     const inferredAction = pendingAction ? null : resolveActionFromText(t);
     const hasAnyAction = !!(pendingAction || inferredAction);
    
  // Never treat summary commands as inventory messages
    if (resolveSummaryIntent(t)) return [];
    // --- BEGIN: early skip for command aliases (e.g., "reorder sujhav") ---
    try {
      // Language hint optional; safe to pass undefined here
      const aliasCmd = normalizeCommandAlias(t);
      if (aliasCmd) {
        return []; // read-only command; do not parse as inventory update
      }
    } catch { /* noop */ }
    // --- END: early skip for command aliases ---

  // NEW: ignore read-only inventory queries outright
  if (isReadOnlyQuery(t)) {
    console.log('[Parser] Read-only query detected; skipping update parsing.');
    return [];
  }
  
  // ===== NEW: Auto-park previous item when awaiting price and a new transaction arrives =====
  // --- STRICT PRICE ENFORCEMENT: removed old price-await flow -----------

 // NEW: only attempt update parsing if message looks like a transaction   
 // Relax when we already have a sticky mode OR an inferred action (consume verb-less lines)
    if (!looksLikeTransaction(t) && !hasAnyAction) {
    console.log('[Parser] Not transaction-like; skipping update parsing.');
    return [];
  }
        
  // Try AI-based parsing first  
  try {
    console.log(`[AI Parsing] Attempting to parse: "${transcript}"`);     
    // Guard: if waiting for price and the message is price-like, skip AI transaction parsing.
        try {
          const stX = await getUserStateFromDB(shopId);
          if (isPriceAwaitState(stX) && isPriceLikeMessage(t)) {
            return []; // already consumed in price-first block above
          }
        } catch {}
        const aiUpdate = await parseInventoryUpdateWithAI(transcript, 'ai-parsing');
    // Only accept AI results if they are valid inventory updates (qty > 0 + valid action)
    if (aiUpdate && aiUpdate.length > 0) {          
    const cleaned = aiUpdate.map(update => {
        try {
          // Apply state override with validation            
          const normalizedPendingAction = String(pendingAction ?? '').toLowerCase();
          const ACTION_MAP = {                     
            purchase: 'purchased',
            purchased: 'purchased',
            buy: 'purchased',
            bought: 'purchased',
            sold: 'sold',
            sale: 'sold',
            return: 'returned',
            returned: 'returned'
          };
          
          const finalAction = ACTION_MAP[normalizedPendingAction] ?? normalizedPendingAction;
          
          if (['purchased', 'sold', 'returned'].includes(finalAction)) {
            update.action = finalAction;
            console.log(`[AI Parsing] Overriding AI action with normalized state action: ${update.action}`);
          } else {
            console.warn(`[AI Parsing] Invalid action in state: ${pendingAction}`);
          }
          return update;
        } catch (error) {
          console.warn(`[AI Parsing] Error processing update:`, error.message);
          return update;
        }
      }).filter(isValidInventoryUpdate);
      if (cleaned.length > 0) {
        console.log(`[AI Parsing] Successfully parsed ${cleaned.length} valid updates using AI`);              
        //if (userState?.mode === 'awaitingTransactionDetails') {
        //          await deleteUserStateFromDB(userState.id);
        //        }
        // STICKY MODE: keep awaitingTransactionDetails until user switches/resets
        return cleaned;
      } else {
        console.log(`[AI Parsing] AI produced ${aiUpdate.length} updates but none were valid. Falling back to rule-based parsing.`);
      }
    }

    
    console.log(`[AI Parsing] No valid AI results, falling back to rule-based parsing`);
  } catch (error) {
    console.warn(`[AI Parsing] Failed, falling back to rule-based parsing:`, error.message);
  }
  
  // --- Only if AI failed to produce valid updates, use rule-based parsing --- 
  // Fallback prompt if no action and no state       
    if (!userState) {
        try {
          if (typeof sendMessageQueued === 'function') {
            await sendMessageQueued(from, 'Did you mean to record a purchase, sale, or return?');
          }
          // Avoid ReferenceError: 'gate' is not defined
          if (typeof scheduleUpsell === 'function') {
            await scheduleUpsell('transaction_hint');
          }
        } catch (_) { /* noop */ }
        return [];
      }
                 
      function parseSimpleWithoutVerb(s, actionHint) {
        try {
          const mUnit  = s.match(UNIT_REGEX);
          const mPrice = s.match(/\b(?:at|@)\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(ltr|l|liter|litre|liters|litres|kg|g|gm|ml|packet|packets|piece|pieces))?/i);
          const mQty   = s.match(/(\d+(?:\.\d+)?)/);            // allow qty anywhere
      
          if (!mQty || !mUnit) return null;
          const idxQty = s.indexOf(mQty[1]);                    // grab index wherever it is
          const product = s.slice(0, idxQty).replace(/\bat$/i, '').trim();
          const qty     = parseFloat(mQty[1]);
          const unitToken = canonicalizeUnitToken(mUnit[0]);
          const price   = mPrice ? parseFloat(mPrice[1]) : null;
      
          return { action: actionHint || 'purchased', product, quantity: qty, unit: unitToken, pricePerUnit: price, expiry: null };
        } catch { return null; }
      }


  // Fallback to rule-based parsing ONLY if AI fails
  // Better sentence splitting to handle conjunctions    
  const sentences = String(transcript)
     .split(regexPatterns.lineBreaks)               // split on newlines/bullets first
     .flatMap(chunk => chunk.split(regexPatterns.conjunctions)) // then split on conjunctions
     .map(s => s.trim())
     .filter(Boolean);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed) {
      try {
        let update = parseSingleUpdate(trimmed);
        if (update && update.product) {
          // Apply state override for rule-based parsing too                    
          const normalizedPendingAction = String(pendingAction ?? '').toLowerCase();
          const ACTION_MAP = {                       
            purchase: 'purchased',
            purchased: 'purchased',
            buy: 'purchased',
            bought: 'purchased',
            sold: 'sold',
            sale: 'sold',
            return: 'returned',
            returned: 'returned'
          };
          
          const finalAction = ACTION_MAP[normalizedPendingAction] ?? normalizedPendingAction;

          const actionResolved = finalAction || inferredAction || null;
          if (['purchased', 'sold', 'returned'].includes(actionResolved)) {                         
              update.action = actionResolved;
              console.log(`[Rule Parsing] Action resolved: ${update.action} (sticky/inferred)`);
          } else {
            console.warn(`[AI Parsing] Invalid action in state: ${pendingAction}`);
          }      
          // Only translate for display; keep original product for DB writes                    
          const UI_PRODUCT_DO_NOT_TRANSLATE = new Set([
            'chini','dudh','atta','tel','namak','chai','sabzi','dal','chawal'
          ]);
          async function translateProductNameSafeForUI(name, tag = 'ui') {
            const n = String(name).toLowerCase().trim();
            if (UI_PRODUCT_DO_NOT_TRANSLATE.has(n)) return name; // preserve as spoken
            try { return await translateProductName(name, tag); } catch { return name; }
          }

          update.productDisplay = await translateProductNameSafeForUI(update.product, 'rule-parsing');                                       
            } else if (pendingAction) {
                      // Verb-less fallback: only when sticky mode exists AND AI has already failed
                      const normalizedPendingAction = String(pendingAction ?? '').toLowerCase();
                      const ACTION_MAP = { purchase:'purchased', buy:'purchased', bought:'purchased', sold:'sold', sale:'sold', return:'returned', returned:'returned' };
                      const finalAction = ACTION_MAP[normalizedPendingAction] ?? normalizedPendingAction;                                           
                      const alt = parseSimpleWithoutVerb(trimmed, finalAction);
                              if (alt) {
                                // Keep RAW for DB writes; translate ONLY for UI
                                alt.productDisplay = await translateProductName(alt.product, 'rule-parsing');
                                if (isValidInventoryUpdate(alt)) {
                                  updates.push(alt);
                                  continue;
                                }
                              }
        }        
        // EXTRA GUARD: if user is in awaitingPriceExpiry and this sentence is price-like, do not push a transaction
        try {
          const stX = await getUserStateFromDB(shopId);
          if (isPriceAwaitState(stX) && isPriceLikeMessage(trimmed)) {
            // Let price-first saver consume it; skip transaction
            continue;
          }
        } catch (_) {}
        if (isValidInventoryUpdate(update)) {
          updates.push(update);
        }
      } catch (err) {
        console.warn(`[parseMultipleUpdates] Failed to parse sentence: "${trimmed}"`, err.message);
      }
    }
  }
  
  console.log(`[Rule-based Parsing] Parsed ${updates.length} valid updates from transcript`);   
  //if (userState?.mode === 'awaitingTransactionDetails') {
  //    await deleteUserStateFromDB(userState.id);
  //  }
  // STICKY MODE: keep awaitingTransactionDetails until user switches/resets
  // --- STRICT PRICE ENFORCEMENT: drop purchased lines without price when backend unknown
    const langHint = await detectLanguageWithFallback(transcript, from ?? `whatsapp:${shopId}`, 'price-enforce');
    const lacking = [];
    const accepted = [];
    for (const u of updates) {
      try {
        if (String(u?.action ?? '').toLowerCase() === 'purchased') {
          const hasPrice = Number.isFinite(u?.pricePerUnit);
          let priceKnown = false, backend = null;
          try { backend = await getProductPrice(u.product, shopId); } catch {}
          priceKnown = !!(backend?.success && Number.isFinite(backend?.price));
          if (!hasPrice && !priceKnown) {
            lacking.push({ product: u.product, unit: u.unit }); // raw only
            continue; // do NOT accept this line
          }
          if (!hasPrice && priceKnown) {
            u.pricePerUnit = backend.price; // allow success if backend has price
          }
        }
        accepted.push(u);
      } catch {}
    }
    if (lacking.length === 1) {
      await sendPriceRequiredNudge(from, lacking[0].product, lacking[0].unit, langHint);
    } else if (lacking.length > 1) {
      await sendMultiPriceRequiredNudge(from, lacking, langHint);
    }
    return accepted;
}

// ===== NEW: Consume and persist price for the pending batch =====================
// [REMOVED]: price-await persist/ack flow. We now require the user to resend
// the purchase line WITH price; no DB saves or acks for missing price lines.

// "Nativeglish": keep helpful English anchors (units, brand words) in otherwise localized text.
function nativeglishWrap(text, lang) {
    try {
        let out = String(text ?? '');                
        const units = [
              'kg','kgs','g','gm','gms','ltr','ltrs','l','ml','packet','packets','piece','pieces',
              '₹','Rs','MRP',                        
              // [UNIQ:UNIT-TAXONOMY-001] expose extra anchors in mixed-script outputs
              'meter','metre','meters','metres','cm','mm','in','ft','yd','sqm','sqft'
            ];
        units.forEach(tok => {
            const rx = new RegExp(`\\b${tok}\\b`, 'gi');
            out = out.replace(rx, tok);
        });

        // Detect mixed scripts before clamping
        const hasLatin = /\p{Script=Latin}/u.test(out);
        const hasNativeScript = /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Gujarati}\p{Script=Kannada}]/u.test(out);
        const hasMixedScripts = hasLatin && hasNativeScript;

        if (hasMixedScripts && !isSafeAnchor(out)) {
            console.warn(`[nativeglishWrap] Mixed scripts detected for ${lang}, enforcing single script.`);                        
            return enforceSingleScript(out, lang);
        }

        return out; // Keep original if single-script
    } catch {
        return String(text ?? '');
    }
}

/**
 * composeDemoByLanguage(lang)
 * Returns the rich multi-line demo transcript localized per language.
 * Designed to keep brand names & units readable while matching your old format.
 */
function composeDemoByLanguage(lang) {
  const L = String(lang || 'en').toLowerCase();

  switch (L) {
    case 'hi': // Hindi (Devanagari)
      return [
        'डेमो:',
        'User: 2 लीटर दूध बेचा',
        'Bot: ✅ 2 लीटर दूध बेचा — @ ₹? प्रति यूनिट — स्टॉक: (अपडेट)',
        'User: Parle-G के 12 पैकेट ₹10 exp +6m पर खरीदे',
        'Bot: ✅ Parle-G के 12 पैकेट खरीदे — कीमत: ₹10',
        '      Expiry: +6 महीने सेट',
        'User: छोटा सारांश',
        'Bot: 📊 संक्षिप्त सारांश — आज की बिक्री, स्टॉक कम, शीघ्र समाप्त…',
        '',
        `Tip: “${SWITCH_WORD.hi}” टाइप करें या वॉइस नोट बोलें Purchase/Sale/Return बदलने के लिए`
      ].join('\n');

    case 'bn': // Bengali
      return [
        'ডেমো:',
        'User: 2 লিটার দুধ বিক্রি',
        'Bot: ✅ 2 লিটার দুধ বিক্রি — @ ₹? প্রতি ইউনিট — স্টক: (আপডেট)',
        'User: Parle-G 12 প্যাকেট ₹10 exp +6m এ কিনেছি',
        'Bot: ✅ Parle-G 12 প্যাকেট কেনা — দাম: ₹10',
        '      মেয়াদ: +6 মাস সেট',
        'User: ছোট সারাংশ',
        'Bot: 📊 সংক্ষিপ্ত সারাংশ — আজকের বিক্রি, স্টক কম, শিগগিরই মেয়াদোত্তীর্ণ…',
        '',
        `Tip: “${SWITCH_WORD.bn}” টাইপ করুন বা ভয়েস নোট বলুন Purchase/Sale/Return বদলাতে`
      ].join('\n');

    case 'ta': // Tamil
      return [
        'டெமோ:',
        'User: 2 லிட்டர் பால் விற்றேன்',
        'Bot: ✅ 2 லிட்டர் பால் விற்றோம் — @ ₹? ஒவ்வொன்றும் — ஸ்டாக்: (புதுப்பிப்பு)',
        'User: Parle-G 12 பாக்கெட் ₹10 exp +6m க்கு வாங்கினேன்',
        'Bot: ✅ Parle-G 12 பாக்கெட் வாங்கப்பட்டது — விலை: ₹10',
        '      Expiry: +6 மாதங்கள் அமைக்கப்பட்டது',
        'User: சுருக்கம்',
        'Bot: 📊 சுருக்கம் — இன்றைய விற்பனை, குறைந்த இருப்பு, விரைவில் காலாவதி…',
        '',
        `Tip: “${SWITCH_WORD.ta}” என தட்டச்சு செய்யவும் அல்லது வொய்ஸ் நோட் பேசவும் Purchase/Sale/Return மாறவும்`
      ].join('\n');

    case 'te': // Telugu
      return [
        'డెమో:',
        'User: 2 లీటర్ పాలు అమ్మాను',
        'Bot: ✅ 2 లీటర్ పాలు అమ్మారు — @ ₹? ప్రతి యూనిట్ — స్టాక్: (అప్‌డేట్)',
        'User: Parle-G 12 ప్యాకెట్లు ₹10 exp +6m తో కొనుగోలు చేశాను',
        'Bot: ✅ Parle-G 12 ప్యాకెట్లు కొనుగోలు — ధర: ₹10',
        '      Expiry: +6 నెలలు సెట్ చేశారు',
        'User: సంక్షిప్త సారాంశం',
        'Bot: 📊 సంక్షిప్త సారాంశం — ఈరోజు అమ్మకాలు, తక్కువ నిల్వ, త్వరలో గడువు…',
        '',
        `Tip: “${SWITCH_WORD.te}” టైప్ చేయండి లేదా వాయిస్ నోట్ మాట్లాడండి Purchase/Sale/Return మార్చండి`
      ].join('\n');

    case 'kn': // Kannada
      return [
        'ಡೆಮೊ:',
        'User: 2 ಲೀಟರ್ ಹಾಲು ಮಾರಿದೆ',
        'Bot: ✅ 2 ಲೀಟರ್ ಹಾಲು ಮಾರಾಟ — @ ₹? ಪ್ರತಿಯೊಂದು — ಸ್ಟಾಕ್: (ನವೀಕರಣ)',
        'User: Parle-G 12 ಪ್ಯಾಕೆಟ್‌ಗಳನ್ನು ₹10 exp +6m ಗೆ ಖರೀದಿಸಿದೆ',
        'Bot: ✅ Parle-G 12 ಪ್ಯಾಕೆಟ್ ಖರೀದಿ — ಬೆಲೆ: ₹10',
        '      Expiry: +6 ತಿಂಗಳು ಸೆಟ್',
        'User: ಸಂಕ್ಷಿಪ್ತ ಸಾರಾಂಶ',
        'Bot: 📊 ಸಂಕ್ಷಿಪ್ತ ಸಾರಾಂಶ — ಇಂದಿನ ಮಾರಾಟ, ಕಡಿಮೆ ಸಂಗ್ರಹ, ಶೀಘ್ರದಲ್ಲೇ ಅವಧಿ…',
        '',
        `Tip: “${SWITCH_WORD.kn}” ಎಂದು ಟೈಪ್ ಮಾಡಿ ಅಥವಾ ವಾಯ್ಸ್ ನೋಟ್ ಮಾತನಾಡಿ Purchase/Sale/Return ಬದಲಿಸಿ`
      ].join('\n');

    case 'mr': // Marathi
      return [
        'डेमो:',
        'User: 2 लिटर दूध विकले',
        'Bot: ✅ 2 लिटर दूध विकले — @ ₹? प्रति युनिट — स्टॉक: (अपडेट)',
        'User: Parle-G चे 12 पॅकेट ₹10 exp +6m ला घेतले',
        'Bot: ✅ Parle-G चे 12 पॅकेट घेतले — किंमत: ₹10',
        '      Expiry: +6 महिने सेट',
        'User: संक्षिप्त सारांश',
        'Bot: 📊 संक्षिप्त सारांश — आजची विक्री, कमी साठा, लवकरच कालबाह्य…',
        '',
        `Tip: “${SWITCH_WORD.mr}” टाइप करा किंवा व्हॉईस नोट बोला Purchase/Sale/Return बदलण्यासाठी`
      ].join('\n');

    case 'gu': // Gujarati
      return [
        'ડેમો:',
        'User: 2 લીટર દૂધ વેચ્યું',
        'Bot: ✅ 2 લીટર દૂધ વેચાયું — @ ₹? પ્રતિ યુનિટ — સ્ટોક: (અપડેટ)',
        'User: Parle-G ના 12 પેકેટ ₹10 exp +6m પર ખરીદ્યા',
        'Bot: ✅ Parle-G ના 12 પેકેટ ખરીદ્યા — ભાવ: ₹10',
        '      Expiry: +6 મહિના સેટ',
        'User: સંક્ષિપ્ત સારાંશ',
        'Bot: 📊 સંક્ષિપ્ત સારાંશ — આજનું વેચાણ, ઓછો જથ્થો, ટૂંક સમયમાં ગાળાપૂરા…',
        '',
        `Tip: “${SWITCH_WORD.gu}” ટાઈપ કરો અથવા વૉઇસ નોટ બોલો Purchase/Sale/Return બદલવા`
      ].join('\n');

    case 'hi-latn': // Hinglish (Roman Hindi)
      return [
        'Demo:',
        'User: 2 ltr doodh becha',
        'Bot: ✅ 2 ltr doodh becha — @ ₹? each — Stock: (updated)',
        'User: Parle-G 12 packets ₹10 exp +6m par kharide',
        'Bot: ✅ Parle-G 12 packets kharide — Price: ₹10',
        '      Expiry: +6 months set',
        'User: chhota saransh',
        'Bot: 📊 Short Summary — Aaj ki sales, Low Stock, Expiring soon…',
        '',
        `Tip: Type or speak (voice note) “${SWITCH_WORD.hi}” to switch Purchase/Sale/Return`
      ].join('\n');

    default: // English
      return [
        'Demo:',
        'User: sold milk 2 ltr',
        'Bot: ✅ Sold 2 ltr milk @ ₹? each — Stock: (updated)',
        'User: purchased Parle-G 12 packets ₹10 exp +6m',
        'Bot: 📦 Purchased 12 packets Parle-G — Price: ₹10',
        '      Expiry: set to +6 months',
        'User: short summary',
        'Bot: 📊 Short Summary — Sales Today, Low Stock, Expiring Soon…',
        '',
        'Tip: Type or speak (voice note) “mode” to switch Purchase/Sale/Return mode or make an inventory query'
      ].join('\n');
  }
}

/**
 * sendDemoTranscriptLocalized(From, lang, rid)
 * Sends the rich demo transcript in the user's language, preserves anchors,
 * and appends your localized footer «<MODE_BADGE> • <SWITCH_WORD>».
 */
async function sendDemoTranscriptLocalized(From, lang, rid = 'cta-demo') {
  const body0 = composeDemoByLanguage(lang);

  // Keep helpful English anchors like units and ₹ inside localized text
  const wrapped = nativeglishWrap(body0, lang);

  // Append localized mode footer    
  const tagged = await tagWithLocalizedMode(From, wrapped, lang);
  // Send immediately, do not block on Airtable cache writes
  await sendMessageViaAPI(From, tagged);
  // Async cache write (non-blocking)
  try {
     upsertTranslationEntry({ key: cacheKey, lang, text: tagged }).catch(e =>
       console.warn('[cache-write-fail]', e.message)
     );
   } catch (_) { /* noop */ }
}

// ===== Script, Language & "Nativeglish" helpers =====
function _hasDevanagari(s) { return /[\u0900-\u097F]/.test(s); }
function _hasBengali(s)    { return /[\u0980-\u09FF]/.test(s); }
function _hasTamil(s)      { return /[\u0B80-\u0BFF]/.test(s); }
function _hasTelugu(s)     { return /[\u0C00-\u0C7F]/.test(s); }
function _hasKannada(s)    { return /[\u0C80-\u0CFF]/.test(s); }
function _hasGujarati(s)   { return /[\u0A80-\u0AFF]/.test(s); }
// Marathi uses Devanagari

// Localization helper: centralize generateMultiLanguageResponse + single-script clamp
// === SAFETY: single-script clamp with short-message guard =====================

function enforceSingleScriptSafe(out, lang) {  
    // Numerals-only normalization. No script clamping anymore.
      // Trust Deepseek for language/script choice; we only ensure digits are ASCII 0–9.
      return normalizeNumeralsToLatin(out);
}

// ===== NEW: Idempotency (dedupe) for price turns =====
// [REMOVED]: price-turn dedupe; no longer used with strict price requirement.

async function t(text, languageCode, requestId) {             
    const L = canonicalizeLang(languageCode);
      const src = String(text ?? '');
      // Race: if translation is slow, return source (keeps reply snappy)
      const out = await Promise.race([
        generateMultiLanguageResponse(src, L, requestId),
        new Promise(resolve => setTimeout(() => resolve(src), TRANSLATE_TIMEOUT_MS))
      ]);
    
      // NEW: opt-out marker to preserve Latin anchors in mixed-script outputs
      const skipClamp = src.includes(NO_CLAMP_MARKER);
      if (skipClamp) {
        return stripMarkers(out); // remove <!NO_CLAMP!> / <!NO_FOOTER!> safely
      }

    // Detect mixed scripts: Latin + any major Indian script
    const hasLatin = /\p{Script=Latin}/u.test(out);
    const hasNativeScript = /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Gujarati}\p{Script=Kannada}]/u.test(out);
    const hasMixedScripts = hasLatin && hasNativeScript;
        
    if (hasMixedScripts && !isSafeAnchor(out)) {
       console.warn(`[clamp] Mixed scripts detected for ${languageCode}, applying numerals-only normalization.`);
       // Use the safe variant so Latin anchors (units, quoted commands) survive
       return enforceSingleScriptSafe(out, L);
    }

    // If AI output is already single-script, keep original
    return out;
}

// tx: simple wrapper (no romanization/bilingual logic)
async function tx(message, lang, fromOrShopId, sourceText, cacheKey) {
  const L = String(lang ?? 'en').toLowerCase();
  try { return await t(message, L, cacheKey); } catch { return String(message ?? ''); }
}

// ---- NEW: scoped cache key builder to avoid generic translation reuse
function shortHash(s) {
  try {
    return crypto.createHash('sha256')
      .update(String(s ?? ''))
      .digest('hex')
      .slice(0, 12);
  } catch {
    return String(s ?? '').length.toString(16).padStart(12, '0');
  }
}
function buildTranslationCacheKey(requestId, topic, flavor, lang, sourceText) {
  const rid = String(requestId ?? '').trim() || 'req';
  const tpc = String(topic ?? 'unknown').toLowerCase();
  const flv = String(flavor ?? 'n/a').toLowerCase();
  const L   = String(lang ?? 'en').toLowerCase();
  return `${rid}::${tpc}::${flv}::${L}::${shortHash(sourceText ?? '')}`;
}

// ---- NEW: helper to sanitize after late string edits (e.g., replacing labels)
function sanitizeAfterReplace(text, lang) {
  try {        
    // t() already applied single-script clamp via enforceSingleScriptSafe.
        // Avoid double-clamp which was causing punctuation-only artifacts.
        const wrapped = nativeglishWrap(text, lang);
        return normalizeNumeralsToLatin(wrapped);
  } catch {
    return normalizeNumeralsToLatin(text);
  }
}

/**
 * aiDetectLangIntent(text)
 * Uses Deepseek to classify:
 *  - language: hi|hi-Latn|en|bn|bn-Latn|ta|ta-Latn|te|te-Latn|kn|kn-Latn|mr|mr-Latn|gu|gu-Latn
 *  - intent:   question|transaction|greeting|command|other
 * Called only when heuristics are uncertain.
 */
async function aiDetectLangIntent(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { language: 'en', intent: 'other' };
  const key = `ai:${raw.slice(0,256)}`;
  const prev = _aiDetectCache.get(key);
  if (prev && (Date.now() - prev.ts) < AI_DETECT_TTL_MS) return { language: prev.language, intent: prev.intent };

  const sys = [
    'You are a classifier.',
    'Return ONLY a strict JSON object: {"language":"<code>","intent":"<intent>"}',
    'Valid language codes: en, hi, hi-Latn, bn, bn-Latn, ta, ta-Latn, te, te-Latn, kn, kn-Latn, mr, mr-Latn, gu, gu-Latn',
    'If the text is Romanized Indic (e.g. Hinglish, Tanglish), use the -Latn code.',
    'Intents: question, transaction, greeting, command, other',
    'No commentary.'
  ].join(' ');
  const user = raw;

  try {
    const resp = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0.1,
        max_tokens: 40
      },
      { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 8000 }
    );
    const txt = String(resp?.data?.choices?.[0]?.message?.content ?? '').trim();
    let out = {};
    try { out = JSON.parse(txt); } catch {
      const m = txt.match(/\{[\s\S]*\}/); if (m) { out = JSON.parse(m[0]); }
    }
    const language = String(out.language ?? 'en').toLowerCase();
    const intent   = String(out.intent   ?? 'other').toLowerCase();
    _aiDetectCache.set(key, { language, intent, ts: Date.now() });
    return { language, intent };
  } catch (e) {
    console.warn('[aiDetectLangIntent] fail:', e?.message);
    return { language: 'en', intent: 'other' };
  }
}

// ====== NEW: Lightweight AI Orchestrator (strict JSON) ======
// Purpose: one-pass classification of inbound text into language, kind and normalized command,
// while keeping business gating and stateful ops deterministic (non-AI).
// This rides alongside your existing heuristics and never replaces trial/paywall/onboarding gates.  [1](https://airindianew-my.sharepoint.com/personal/kunal_kansra_airindia_com/Documents/Microsoft%20Copilot%20Chat%20Files/whatsapp.js.txt)
const USE_AI_ORCHESTRATOR = String(process.env.USE_AI_ORCHESTRATOR ?? 'true').toLowerCase() === 'true';

function _safeJsonExtract(txt) {
  if (!txt) return null;
  try { return JSON.parse(txt); } catch (_) {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (_) { return null; } }
    return null;
  }
}

/**
 * aiOrchestrate(text): returns a strict decision object:
 * {
 *   language: "<code or -latn>",
 *   kind: "greeting|question|transaction|command|other",
 *   command: { normalized: "short summary|low stock|..." } | null,
 *   transaction: { action, product, quantity, unit, pricePerUnit, expiry } | null
 * }
 * Low tokens, temperature=0 for determinism.
 */

async function aiOrchestrate(text) {
  const sys = [
    'You are a deterministic classifier and lightweight parser.',
    'Return ONLY valid JSON with keys: language, kind, command(normalized), transaction(action,product,quantity,unit,pricePerUnit,expiry).',
    'No prose, no extra keys.'
  ].join(' ');
  const user = String(text ?? '').trim();
  if (!user) return { language: 'en', kind: 'other', command: null, transaction: null };
  try {
    const resp = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0.0,
        max_tokens: 180
      },
      { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,'Content-Type':'application/json' }, timeout: 8000 }
    );
    const raw = String(resp?.data?.choices?.[0]?.message?.content ?? '').trim();
    const out = _safeJsonExtract(raw);
    if (!out || typeof out !== 'object') return { language: 'en', kind: 'other', command: null, transaction: null };
    // Guard: sanitize shape
    const language = String(out.language ?? 'en').toLowerCase();
    const kind = String(out.kind ?? 'other').toLowerCase();
    const command = out.command && typeof out.command === 'object' ? { normalized: String(out.command.normalized ?? '') || null } : null;
    const tx = out.transaction && typeof out.transaction === 'object'
      ? {
          action: out.transaction.action ?? null,
          product: out.transaction.product ?? null,
          quantity: Number.isFinite(out.transaction.quantity) ? out.transaction.quantity : null,
          unit: out.transaction.unit ?? null,
          pricePerUnit: Number.isFinite(out.transaction.pricePerUnit) ? out.transaction.pricePerUnit : null,
          expiry: out.transaction.expiry ?? null
        }
      : null;
    return { language, kind, command, transaction: tx };
  } catch (e) {
    console.warn('[aiOrchestrate] fail:', e?.message);
    return { language: 'en', kind: 'other', command: null, transaction: null };
  }
}

// ===== Sticky-mode helpers (lightweight, deterministic) =====
async function getStickyActionQuick(from) {
  try {
    const shopId = String(from ?? '').replace('whatsapp:', '');
    const stateDb = await getUserStateFromDB(shopId);
    const stateMem = globalState?.conversationState?.[shopId];
    const st = stateDb || stateMem || null;
    if (!st) return null;
    switch (st.mode) {
      case 'awaitingTransactionDetails': return st.data?.action ?? null;
      case 'awaitingBatchOverride':      return 'sold';
      case 'awaitingPurchaseExpiryOverride': return 'purchased';
      default: return st.data?.action ?? null;
    }
  } catch { return null; }
}
function looksLikeTxnLite(s) {
  const t = String(s ?? '').toLowerCase();    
  // Detect ASCII digits and Indic (Devanagari) digits
    const hasNum = /(\d|[\u0966-\u096F])/.test(t);
    // English unit tokens
    const UNIT_RX_EN = /\b(ltr|l|liter|litre|liters|litres|kg|g|gm|ml|packet|packets|piece|pieces|box|boxes)\b/i;
    // Hindi unit tokens (avoid \b because word-boundaries are unreliable on Indic scripts)
    const UNIT_RX_HI = /(लीटर|किलो|ग्राम|एमएल|पैकेट|पीस|बॉक्स|डिब्बा)/u;
    const hasUnit = UNIT_RX_EN.test(t) || UNIT_RX_HI.test(t);
  const hasPrice = /\b(?:@|at)\s*\d+(?:\.\d+)?(?:\s*\/\s*(ltr|l|liter|litre|liters|litres|kg|g|gm|ml|packet|packets|piece|pieces|box|boxes))?/i.test(t)
                 || /(?:₹|rs\.?|inr)\s*\d+(?:\.\d+)?/i.test(t);
  // Verb-less acceptance: number + unit is sufficient in sticky mode; price is optional 
  // We treat "price only" (e.g., ₹60+  // We treat "price only" (e.g., ₹60) as NOT transaction-like to avoid false parking.
    return (hasNum && hasUnit) || (hasUnit && hasPrice);
}

// ===== NEW: Hindi-aware price-like detector (used to gate price handling in awaitingPriceExpiry) =====
function isPriceLikeMessage(s) {
  const t = String(s ?? '').trim();
  if (!t) return false;
  // Accept explicit currency markers
  if (/(₹|rs\.?|inr)\s*\d+(?:\.\d+)?/i.test(t)) return true;
  // Accept "70 / unit" or "70 प्रति unit"
  if (/(\d+(?:\.\d+)?)\s*(\/|\bper\b|प्रति)\s*\S+/i.test(t)) return true;
  // Accept bare numeric (ASCII or Indic digits) ONLY when there is no unit token attached
  const isNumericOnly = /^(\s*)(\d|[\u0966-\u096F])+(?:\.\d+)?(\s*)$/u.test(t);
  if (isNumericOnly) return true;
  return false;
}

// ===== NEW: Skip-message detector (multilingual) =====
function isSkipMessage(s) {
  const t = String(s ?? '').trim();
  if (!t) return false;

  // Accept pure English signals
  const en = /^(skip|na|n\/a|none|no)$/i;
  if (en.test(t)) return true;

  // Hinglish (Romanized Hindi) common forms
  const hiLatn = /\b(skip|chhod|chod|chhodo|bypass)\b/i;
  if (hiLatn.test(t.toLowerCase())) return true;

  // Hindi (Devanagari): “स्किप”, “छोड़ें”, “छोड़ो”, “बायपास”
  const hiNative = /(\u0938\u094d\u0915\u093f\u092a|स्किप|छोड़ें|छोड़ो|बायपास)/u;
  if (hiNative.test(t)) return true;

  // Bengali: “স্কিপ”, “ছাড়ুন”
  const bnNative = /(স্কিপ|ছাড়ুন)/u;
  if (bnNative.test(t)) return true;

  // Tamil: “ஸ்கிப்”, “தவிர்”
  const taNative = /(ஸ்கிப்|தவிர்)/u;
  if (taNative.test(t)) return true;

  // Telugu: “స్కిప్”, “వదిలేయి”
  const teNative = /(స్కిప్|వదిలేయి)/u;
  if (teNative.test(t)) return true;

  // Kannada: “ಸ್ಕಿಪ್”, “ಬಿಟ್ಟಿಡಿ”
  const knNative = /(ಸ್ಕಿಪ್|ಬಿಟ್ಟಿಡಿ)/u;
  if (knNative.test(t)) return true;

  // Marathi: “स्किप”, “सोडा”
  const mrNative = /(स्किप|सोडा)/u;
  if (mrNative.test(t)) return true;

  // Gujarati: “સ્કિપ”, “છોડી દો”
  const guNative = /(સ્કિપ|છોડી દો)/u;
  if (guNative.test(t)) return true;

  return false;
}

// ===== NEW: Dedup correction writes (TTL) =====
const CORR_DEDUPE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const _corrSeen = new Map(); // key -> { ts }
function _corrKey(shopId, payload) {
  const base = `${shopId}::${String(payload?.product ?? '')}::${String(payload?.quantity ?? '')}::${String(payload?.unit ?? '')}`;
  let h = 2166136261;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return String(h >>> 0);
}
function seenDuplicateCorrection(shopId, payload) {
  const k = _corrKey(shopId, payload);
  const now = Date.now();
  const hit = _corrSeen.get(k);
  if (hit && (now - hit.ts) < CORR_DEDUPE_TTL_MS) return true;
  _corrSeen.set(k, { ts: now });
  if (_corrSeen.size > 1000) {
    for (const [kk, vv] of _corrSeen) if ((now - vv.ts) > CORR_DEDUPE_TTL_MS) _corrSeen.delete(kk);
  }
  return false;
}

// ===== NEW: price-await helpers (auto-park previous item, rupee default) =====
// [REMOVED]: price-await helpers & reminders. Strict purchase price required.

/**
 * applyAIOrchestration(text, From, detectedLanguageHint, requestId)
 * Merges orchestrator advice into our routing variables:
 * - language: prefer AI language if present; persist preference (best-effort).
 * - isQuestion: true if kind === 'question'.
 * - normalizedCommand: exact English command if kind === 'command'.
 * - aiTxn: parsed transaction skeleton (NEVER auto-applied; deterministic parser still decides).
 * NOTE: All business gating (ensureAccessOrOnboard, trial/paywall, template sends) stays non-AI.  [1](https://airindianew-my.sharepoint.com/personal/kunal_kansra_airindia_com/Documents/Microsoft%20Copilot%20Chat%20Files/whatsapp.js.txt)
 */

async function applyAIOrchestration(text, From, detectedLanguageHint, requestId, stickyActionCached) {   
// LEGACY: pinned language from onboarding_trial_capture (PRESERVED) — run BEFORE deriving hintedLang
 try {
   const shopIdTmp = String(From ?? '').replace('whatsapp:', '');
   const st = await getUserStateFromDB(shopIdTmp).catch(() => null);
   if (st?.mode === 'onboarding_trial_capture') {
     const pinned = st?.data?.lang ?? (await getUserPreference(shopIdTmp).catch(() => ({})))?.language;
     if (pinned) detectedLanguageHint = String(pinned).toLowerCase();
   }
 } catch {}
 
 // Declare hintedLang after any possible override of detectedLanguageHint
 const hintedLang = ensureLangExact(detectedLanguageHint ?? 'en');

  // === Helpers (defined once) ===
  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      promise,
      new Promise((resolve) =>
        setTimeout(() => resolve(typeof fallback === 'function' ? fallback() : fallback), ms)
      ),
    ]).catch(() => (typeof fallback === 'function' ? fallback() : fallback));
  }
  
  // --- GREETING GUARD: prevent greetings from becoming commands/summary ---
  // If the message is a greeting, do not let orchestrator map it to "short summary".
  // We return a neutral route with no command and no question.
  if (_isGreeting(text)) {
    const language = ensureLangExact(detectedLanguageHint ?? 'en');
    console.log('[orchestrator] Greeting detected; suppressing command normalization.');
    return {
      language,
      isQuestion: false,
      normalizedCommand: null,
      aiTxn: null,
      questionTopic: null,
      pricingFlavor: null,
      identityAsked: typeof isNameQuestion === 'function' ? isNameQuestion(text) : false
    };
  }

  function inBackground(label, fn) {
    Promise.resolve().then(fn).catch((e) => console.warn(`[bg:${label}]`, e?.message));
  }
  function isPricingQuestion(msg) {
    const t = String(msg ?? '').toLowerCase();
    const en = /\b(price|cost|charge|charges|rate)\b/;
    const hing = /\b(kimat|daam|rate|price kya|kitna|kitni)\b/;
    const hiNative = /(कीमत|दाम|भाव|रेट|कितना|कितनी)/;
    return en.test(t) || hing.test(t) || hiNative.test(msg);
  }
  function isBenefitQuestion(msg) {
    const t = String(msg ?? '').toLowerCase();
    return /\b(benefit|daily benefit|value|help|use case)\b/.test(t)
        || /(फ़ायदा|लाभ|मदद|दैनिक)/.test(msg)
        || /\b(fayda)\b/.test(t);
  }
  function isCapabilitiesQuestion(msg) {
    const t = String(msg ?? '').toLowerCase();
    return /\b(what.*do|what does it do|exactly.*does|how does it work|kya karta hai)\b/.test(t)
        || /(क्या करता है|किस काम का है|कैसे चलता है)/.test(msg)
        || /\b(kya karta hai)\b/.test(t);
  }
  function classifyQuestionTopic(msg) {
    if (isPricingQuestion(msg)) return 'pricing';
    if (isBenefitQuestion(msg)) return 'benefits';
    if (isCapabilitiesQuestion(msg)) return 'capabilities';
    return null;
  }
  function looksLikeInventoryPricing(msg) {
    const s = String(msg ?? '').toLowerCase();
    const unitRx = /(kg|kgs|g|gm|gms|ltr|ltrs|l|ml|packet|packets|piece|pieces|बॉक्स|टुकड़ा|नंग)/i;
    const moneyRx = /(?:₹|rs\.?|rupees)\s*\d+(?:\.\d+)?/i;
    const brandRx = /(milk|doodh|parle\-g|maggi|amul|oreo|frooti|marie gold|good day|dabur|tata|nestle)/i;
    return unitRx.test(s) || moneyRx.test(s) || brandRx.test(s);
  }

  try {
    // --- LEGACY: pinned language from onboarding_trial_capture (PRESERVED) ---
    try {
      const shopIdTmp = String(From ?? '').replace('whatsapp:', '');
      const st = await getUserStateFromDB(shopIdTmp).catch(() => null);
      if (st?.mode === 'onboarding_trial_capture') {
        const pinned = st?.data?.lang ?? (await getUserPreference(shopIdTmp).catch(() => ({})))?.language;
        if (pinned) detectedLanguageHint = String(pinned).toLowerCase();
      }
    } catch {}

    // --- LEGACY: short-circuit when orchestrator disabled (PRESERVED) ---
    if (!USE_AI_ORCHESTRATOR) {
      return { language: detectedLanguageHint, isQuestion: null, normalizedCommand: null, aiTxn: null };
    }

    const shopId = shopIdFrom(From);

    // --- LEGACY: sticky-mode clamp before any AI (PRESERVED) ---
    try {
      const stickyAction = await getStickyActionQuick(From);
      if (stickyAction && looksLikeTxnLite(text)) {              
      const language = ensureLangExact(detectedLanguageHint ?? 'en');
            console.log('[orchestrator]', {
              requestId, language, kind: 'transaction', normalizedCommand: '—',
              topicForced: null, pricingFlavor: null, sticky: stickyAction
            });
            // HARD RETURN: no classifier, no AI; inventory parser consumes this turn.
            return {
              language,
              isQuestion: false,
              normalizedCommand: null,
              aiTxn: null,
              questionTopic: null,
              pricingFlavor: null,
              forceInventory: true
            };
      }
    } catch (_) { /* fall through to AI orchestrator */ }

    // ---- NEW FAST PATH (Deepseek single call) when ENABLE_FAST_CLASSIFIER=true ----
    if (ENABLE_FAST_CLASSIFIER) {
      console.log('[fast-classifier] on req=%s timeout=%sms model=deepseek-chat', requestId, String(FAST_CLASSIFIER_TIMEOUT_MS ?? '1200'));
      const out = await classifyAndRoute(text, detectedLanguageHint);    
          
        // --- DEFENSIVE: do not normalize commands for greetings ---
        if (_isGreeting(text)) {
          return {
            language: ensureLangExact(out?.language ?? detectedLanguageHint ?? 'en'),
            isQuestion: false,
            normalizedCommand: null,
            aiTxn: null,
            questionTopic: null,
            pricingFlavor: null,
            identityAsked: typeof isNameQuestion === 'function' ? isNameQuestion(text) : false
          };
        }
    
        // --- Normalize summary intent into command (existing) ---
      let route = {
        language: ensureLangExact(out?.language ?? detectedLanguageHint ?? 'en'),
        kind: out?.kind ?? 'other',
        command: out?.command ?? null,
        transaction: out?.transaction ?? null
      };
      try {
        const summaryCmd = /\bsummary\b/i.test(text) ? resolveSummaryIntent(text) : null;
        if (summaryCmd) { route.kind = 'command'; route.command = { normalized: summaryCmd }; }
      } catch {}
  
    // --- BEGIN: alias-based command normalization (e.g., "reorder sujhav" -> "reorder suggestions") ---
    // Position: immediately after summary normalization, before logging/return.
    // Anchor variables available here:
    //   - route.kind / route.command
    //   - detectedLanguageHint (via hintedLang below)
    let normalizedCommand = (route.kind === 'command' && route?.command?.normalized)
      ? route.command.normalized
      : null;
  
    if (!normalizedCommand) {
      // hintedLang is defined above in this function: const hintedLang = ensureLangExact(detectedLanguageHint ?? 'en');
      const aliasCmd = normalizeCommandAlias(text, hintedLang);
      if (aliasCmd) {
        normalizedCommand = aliasCmd;
        route.kind = 'command';
        route.command = { normalized: normalizedCommand };
      }
    }
    // --- END: alias-based command normalization ---

      // --- Topic detection (PRESERVED) ---
      const topicForced = classifyQuestionTopic(text);
      if (topicForced) { route.kind = 'question'; }

      // --- Language exact variant lock (PRESERVED) ---           
      const orchestratedLang = ensureLangExact(route.language ?? hintedLang);
      // NEW: prefer user's hint when it's non‑English; else fall back to orchestrated
      const language = (hintedLang !== 'en') ? hintedLang : orchestratedLang;

      // Save preference in background (no await)
      inBackground('savePref', async () => {
        try { if (typeof saveUserPreference === 'function') await saveUserPreference(shopIdFrom(From), language); } catch {}
      });

      // --- Sticky safety: prefer cached sticky; else bounded fetch ---
      let isQuestion = (route.kind === 'question');
      // normalizedCommand already set/updated by alias normalizer above
      const aiTxn = route.kind === 'transaction' ? route.transaction : null;

      let stickyAction = stickyActionCached ?? await withTimeout(
        (typeof getStickyActionQuick === 'function'
          ? (getStickyActionQuick.length > 0 ? getStickyActionQuick(From) : getStickyActionQuick())
          : Promise.resolve(null)),
        150, () => null
      );
      if (stickyAction) { isQuestion = false; normalizedCommand = null; }

      // --- Pricing flavor: only when pricing; bounded parallel fetches ---
      let pricingFlavor = null;
      if (topicForced === 'pricing') {
        let activated = false;
        try {
          const [planInfoRes, prefRes] = await Promise.allSettled([
            withTimeout(getUserPlanQuick(shopIdFrom(From)), 500, () => null),
            withTimeout(getUserPreference(shopIdFrom(From)), 500, () => null),
          ]);
          const planInfo = planInfoRes.status === 'fulfilled' ? planInfoRes.value : null;
          const plan     = String((planInfo?.plan ?? prefRes?.value?.plan ?? '')).toLowerCase();
          const end      = getUnifiedEndDate(planInfo);
          const activeTrial = (plan === 'trial' && end && new Date(end).getTime() > Date.now());
          activated = (plan === 'paid') || activeTrial;
        } catch { /* best effort */ }
        pricingFlavor = (activated && looksLikeInventoryPricing(text)) ? 'inventory_pricing' : 'tool_pricing';
      }

      console.log('[orchestrator]', {
        requestId, language, kind: route.kind,
        normalizedCommand: normalizedCommand ?? '—',
        topicForced, pricingFlavor
      });
      const identityAsked = (typeof isNameQuestion === 'function') ? isNameQuestion(text) : false;
      return { language, isQuestion, normalizedCommand, aiTxn, questionTopic: topicForced, pricingFlavor, identityAsked };
    }

    // ---- LEGACY PATH (Gate OFF): original Deepseek orchestrator call (PRESERVED) ----
    console.log('[fast-classifier] off req=%s (calling aiOrchestrate with 8s timeout)', requestId);
    
    const legacy = await withTimeout(aiOrchestrate(text), 8000, () => ({
       language: detectedLanguageHint ?? 'en',
       kind: 'other',
       command: null,
       transaction: null
     }));

    // --- Normalize summary intent into command (PRESERVED) ---
    try {
      const summaryCmd = /\bsummary\b/i.test(text) ? resolveSummaryIntent(text) : null;
      if (summaryCmd) {
        legacy.kind = 'command';
        legacy.command = { normalized: summaryCmd };
      }
    } catch { /* best-effort */ }
        
      // --- BEGIN: alias-based command normalization for legacy path ---
      // Anchor: right after legacy summary normalization.
      let legacyNormalizedCommand =
        (legacy.kind === 'command' && legacy?.command?.normalized)
          ? legacy.command.normalized
          : null;
    
      if (!legacyNormalizedCommand) {
        const aliasCmd = normalizeCommandAlias(text, ensureLangExact(detectedLanguageHint ?? 'en'));
        if (aliasCmd) {
          legacyNormalizedCommand = aliasCmd;
          legacy.kind = 'command';
          legacy.command = { normalized: legacyNormalizedCommand };
        }
      }
     // --- END: alias-based command normalization for legacy path ---

    // --- Topic detection (PRESERVED) ---
    const topicForced = classifyQuestionTopic(text);
    if (topicForced) { legacy.kind = 'question'; }

    // --- Pricing flavor (PRESERVED) ---
    let pricingFlavor = null; // 'tool_pricing' | 'inventory_pricing' | null
    if (topicForced === 'pricing') {
      let activated = false;
      try {
        const [planInfoRes, prefRes] = await Promise.allSettled([
          getUserPlanQuick(shopId), getUserPreference(shopId)
        ]);
        const planInfo = planInfoRes.status === 'fulfilled' ? planInfoRes.value : null;
        const plan = String((planInfo?.plan ?? prefRes?.value?.plan ?? '')).toLowerCase();
        const end = getUnifiedEndDate(planInfo);
        const activeTrial = (plan === 'trial' && end && new Date(end).getTime() > Date.now());
        activated = (plan === 'paid') || activeTrial;
      } catch { /* best effort */ }
      pricingFlavor = (activated && looksLikeInventoryPricing(text)) ? 'inventory_pricing' : 'tool_pricing';
    }

    // --- Language exact variant lock + save preference (PRESERVED) ---        
    
      const orchestratedLang = ensureLangExact(legacy.language ?? hintedLang);
      // NEW: prefer user's hint when it's non‑English; else fall back to orchestrated
      const language = (hintedLang !== 'en') ? hintedLang : orchestratedLang;
    try {
      if (typeof saveUserPreference === 'function') {
        await saveUserPreference(shopId, language);
      }
    } catch {}

    // --- Derive router fields (PRESERVED) ---
    let isQuestion = legacy.kind === 'question';
    let normalizedCommand = legacyNormalizedCommand;
    const aiTxn = legacy.kind === 'transaction' ? legacy.transaction : null;

    // --- Final sticky-mode safety (PRESERVED) ---
    try {
      const stickyAction = await getStickyActionQuick(From);
      if (stickyAction) { isQuestion = false; normalizedCommand = null; }
    } catch { /* noop */ }

    console.log('[orchestrator]', {
      requestId, language, kind: legacy.kind,
      normalizedCommand: normalizedCommand ?? '—',
      topicForced, pricingFlavor
    });

    const identityAsked = (typeof isNameQuestion === 'function') ? isNameQuestion(text) : false;
    return { language, isQuestion, normalizedCommand, aiTxn, questionTopic: topicForced, pricingFlavor, identityAsked };

  } catch (e) {
    console.warn('[applyAIOrchestration] fallback due to error:', e?.message);
    const language = ensureLangExact(detectedLanguageHint ?? 'en');
    const normalizedCommand = resolveSummaryIntent(text) ?? null;
    const identityAsked = isNameQuestion?.(text) ?? false;
    return { language, isQuestion: await looksLikeQuestion(text, language), normalizedCommand, aiTxn: null, questionTopic: null, pricingFlavor: null, identityAsked };
  }
}


// Decide if AI should be used (cost guard)
function _shouldUseAI(text, heuristicLang) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return false;
  // NOTE: Do NOT skip AI because of trailing '?' — Hinglish often ends with '?'
  const isAscii = /^[\x00-\x7F]+$/.test(t);
  // Expanded Roman-Indic tokens (captures “bana/skte/h/kya/kaise/kitna/…”)
  const romanIndicTokens = /\b(kya|kyu|kaise|kab|kitna|daam|kimat|fayda|nuksan|bana|sakte|skte|hai|h|kharid|bech|karo)\b/i;
  // Use AI when heuristics think 'en' but the text smells Indic and is ASCII
  return isAscii && romanIndicTokens.test(t) && heuristicLang === 'en';
}

// ---------------------------------------------------------------------------
// SINGLE-RESPONSE GUARD (Express): helpers to avoid "headers already sent"
// We wrap res.send/status to ensure we only respond once per request.
// ---------------------------------------------------------------------------
function makeSafeResponder(res) {
  let responded = false;
  return {
    safeSend: (status, body) => {
      if (responded || res.headersSent) return;
      responded = true;
      res.status(status).send(body);
    },
    markResponded: () => { responded = true; },
    alreadySent: () => responded || res.headersSent
  };
}

// --- GLOBAL shim: always available across the module and any early call sites
if (typeof globalThis.getUserState !== 'function') {
  globalThis.getUserState = async function getUserState(from) {
    try {
      const shopId = String(from || '').replace('whatsapp:', '');
      if (typeof getUserStateFromDB === 'function') {                  
          const st = await getUserStateFromDB(shopId);
                  // Auto-expire ONLY the two ephemeral override modes.
                  if (st && _isExpiredEphemeral(st)) {
                    try { await deleteUserStateFromDB(st.id ?? shopId); } catch (_) {}
                    console.log('[state] auto-expired ephemeral override on read', { shopId, mode: st.mode });
                    return null;
                  }
                  return st;
      }
    } catch (_) {}
    return null; // default: no state
  };
}


// ------------------------------------------------------------
// Bootstrap guard: guarantee a reset detector exists even if
// later edits move/rename the canonical function.
// ------------------------------------------------------------
/* eslint-disable no-inner-declarations */
if (typeof isResetMessage === 'undefined') {
  function isResetMessage(text) {
    const FALLBACK = ['reset','start over','restart','cancel','exit','stop'];
    const t = String(text ?? '').trim().toLowerCase();
    return t && FALLBACK.includes(t);
  }
}
/* eslint-enable no-inner-declarations */

// ------------------------------------------------------------
// Canonical RESET tokens + HOISTED detector
// ------------------------------------------------------------
// Keep English + Indic synonyms so users can bail out of any flow.
// IMPORTANT: hoisted declaration so ALL early call sites are safe.

// ------------------------------------------------------------
// Global RESET commands + detector (shared)
// ------------------------------------------------------------
// Keep both English & common Hindi/Indic synonyms so users can bail out of any flow.
// IMPORTANT: Define this ONCE, near the top, before any handlers use it.
const RESET_COMMANDS = [
  // English
  'reset', 'start over', 'restart', 'cancel', 'exit', 'stop',
  // Hindi / Marathi (Devanagari)
  'रीसेट','रिसेट','रद्द','बंद','बाहर','दोबारा शुरू','रिस्टार्ट','नया शुरू','नया सत्र',
  // Bengali
  'রিসেট','বাতিল','বন্ধ',
  // Tamil
  'ரீசெட்','ரத்து','நிறுத்து',
  // Telugu
  'రీసెట్','రద్దు','ఆపు',
  // Kannada
  'ರಿಸೆಟ್','ರದ್ದು','ನಿಲ್ಲಿಸಿ',
  // Gujarati
  'રીસેટ','રદ','બંધ'
];

function isResetMessage(text) {
  const t = String(text ?? '').trim();
  if (!t) return false;
  return RESET_COMMANDS.some(cmd => {
    try {
      const re = new RegExp(`^\\s*${cmd}\\s*$`, 'i');
      return re.test(t);
    } catch {
      return t.toLowerCase() === String(cmd).toLowerCase();
    }
  });
}

// === Guard: detect "start trial" intent in all supported languages ===
function isStartTrialIntent(text) {
  const s = String(text || '').trim();
  if (!s) return false;

  // --- English (exact + common phrasings) ---
  const enExact = /^(start trial|start my trial|begin trial|free trial|activate trial|trial|start|try now)$/i;
  const enContains =
    /(want|wanna|would like|please|pls|plz|need|start|begin|activate)\s+(the\s+)?(free\s+)?trial/i.test(s) ||
    /\btrial\b.*\b(start|begin|activate)\b/i.test(s) ||
    /\bstart\b.*\btrial\b/i.test(s);

  // --- Hinglish (Roman Hindi) ---
  const hiLatn =
    /\b(trial\s*(shuru|start|chalu)|mujhe\s*trial\s*chahiye|trial\s*karna\s*hai|trial\s*(please|pls|plz))\b/i.test(s);

  // --- Hindi (Devanagari) ---
  const hiNative =
    /(ट्रायल)\s*(शुरू|शुरू करें|चालू|आरंभ)\b/.test(s) ||
    /मुझे\s*ट्रायल\s*चाहिए/.test(s) ||
    /ट्रायल\s*करना\s*है/.test(s);

  // --- Bengali (native + roman) ---
  const bnNative =
    /(ট্র(?:া|া)য়াল)\s*(শুরু(?:\s*করুন)?|চালু)\b/.test(s) ||
    /আমি\s*ট্র(?:া|া)য়াল\s*চাই/.test(s) ||
    /(ট্র(?:া|া)য়াল)\s*করতে\s*চাই/.test(s);
  const bnLatn =
    /\b(trial\s*(shuru\s*korun|chalu)|ami\s*trial\s*chai|trial\s*korte\s*chai)\b/i.test(s);

  // --- Tamil (native + roman) ---
  const taNative =
    /(ட்ரயல்)\s*(தொடங்கவும்|தொடங்கு|ஆரம்பம்)\b/.test(s) ||
    /எனக்கு\s*ட்ரயல்\s*வேண்டும்/.test(s) ||
    /(ட்ரயல்)\s*செய்ய\s*வேண்டும்/.test(s);
  const taLatn =
    /\b(trial\s*(todangavum|todangu|arambam)|trial\s*venum|trial\s*seyya\s*venum)\b/i.test(s);

  // --- Telugu (native + roman) ---
  const teNative =
    /(ట్రయల్)\s*(ప్రారంభించండి|స్టార్ట్)\b/.test(s) ||
    /నాకు\s*ట్రయల్\s*కావాలి/.test(s) ||
    /(ట్రయల్)\s*చేయాలి/.test(s);
  const teLatn =
    /\b(trial\s*(prarambhinchandi|start)|naaku\s*trial\s*kaavali|trial\s*cheyaali)\b/i.test(s);

  // --- Kannada (native + roman) ---
  const knNative =
    /(ಟ್ರಯಲ್)\s*(ಪ್ರಾರಂಭಿಸಿ|ಶುರು)\b/.test(s) ||
    /ನನಗೆ\s*ಟ್ರಯಲ್\s*ಬೇಕು/.test(s) ||
    /(ಟ್ರಯಲ್)\s*ಮಾಡಬೇಕು/.test(s);
  const knLatn =
    /\b(trial\s*(prarambhisi|shuru)|nanage\s*trial\s*beku|trial\s*maadabeku)\b/i.test(s);

  // --- Marathi (native + roman) ---
  const mrNative =
    /(ट्रायल)\s*(सुरू\s*करा|सुरू)\b/.test(s) ||
    /मला\s*ट्रायल\s*हवी/.test(s) ||
    /(ट्रायल)\s*करायची\s*आहे/.test(s);
  const mrLatn =
    /\b(trial\s*suru\s*kara|mala\s*trial\s*havi)\b/i.test(s);

  // --- Gujarati (native + roman) ---
  const guNative =
    /(ટ્રાયલ)\s*(શરૂ\s*કરો|શરૂ)\b/.test(s) ||
    /મને\s*ટ્રાયલ\s*જોઈએ/.test(s) ||
    /(ટ્રાયલ)\s*કરવું\s*છે/.test(s);
  const guLatn =
    /\b(trial\s*sharu\s*karo|mane\s*trial\s*joie[e]?|trial\s*karvu\s*chhe)\b/i.test(s);

  // Legacy numeric quick-code you already accept
  const numeric1 = /^\s*1\s*$/i.test(s);

  return (
    enExact.test(s) || enContains ||
    hiLatn || hiNative ||
    bnNative || bnLatn ||
    taNative || taLatn ||
    teNative || teLatn ||
    knNative || knLatn ||
    mrNative || mrLatn ||
    guNative || guLatn ||
    numeric1
  );
}

// --- Question intent detector (AI-backed when uncertain) ---
async function looksLikeQuestion(text, lang = 'en') {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return false;
  if (/[?\uff1f]\s*$/.test(t)) return true; // obvious question

  // Heuristics
  const en = /\b(what|why|when|how|who|which|price|cost|charges?|benefit|pros|cons|compare|best)\b/;
  // Strengthened Hinglish detection (no '?' required)
  const hinglish = /\b(kya|kaise|kyon|kyu|kab|kitna|daam|kimat|fayda|nuksan|bana|sakte|skte|hai|h)\b/;
  const hiNative = /(क्या|कैसे|क्यों|कब|कितना|दाम|कीमत|फ़ायदा|नुकसान)/;
  if (en.test(t) || hinglish.test(t) || hiNative.test(t)) return true;

  // Ambiguous → ask AI intent
  const isAscii = /^[\x00-\x7F]+$/.test(t);
  const weakPunct = !/[.!]$/.test(t);
  const shortish = t.split(/\s+/).length <= 8;
  if (!(isAscii && weakPunct && shortish)) return false;

  try {
    const { intent } = await aiDetectLangIntent(text);
    return intent === 'question';
  } catch {
    return false;
  }
}

// ------------------------------------------------------------
// Cross-language greeting detection (exact-match tokens)
// (Set already present below; we add normalization + guarded matcher)
// ------------------------------------------------------------
const GREETING_TOKENS = new Set([
  // English / Latin
  'hello', 'hi', 'hey', 'namaste', 'namaskar',
  // Hindi / Marathi (Devanagari)
  'नमस्ते', 'नमस्कार',
  // Bengali
  'নমস্কার',
  // Tamil
  'வணக்கம்',
  // Telugu
  'నమస్కారం',
  // Kannada
  'ನಮಸ್ಕಾರ',
  // Gujarati
  'નમસ્તે',
  // (Optionally keep a few common foreign forms seen in India)
  'hola', 'hallo'
]);

async function parkPendingPriceDraft(shopId, payload) {
  try {
    // No-op persistence or minimal in-memory cache, depending on your architecture.
    // Intentionally do not write inventory here to maintain STRICT no-capture policy.
    console.log('[awaitingPriceExpiry] parkPendingPriceDraft noop', { shopId, payload });
    return { success: true };
  } catch (e) {
    console.warn('[awaitingPriceExpiry] park shim failed:', e?.message);
    return { success: false, error: e?.message };
  }
}

// Normalize away zero-widths/punctuations; keep letters/numbers/spaces
function _normalizeForGreeting(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')     // zero-width chars
    .replace(/[^\p{L}\p{N}\s]/gu, '')          // punctuation & symbols
    .trim()
    .toLowerCase();
}

if (typeof _isGreeting !== 'function') {
  function _isGreeting(text) {
    const t = _normalizeForGreeting(text);
    return t ? GREETING_TOKENS.has(t) : false;
  }
}

// Defensive guard: ensure safeTrackResponseTime exists before any usage
// even if bundling or conditional blocks load differently.
let __safeTrackDefined = false;
try {
  if (typeof safeTrackResponseTime === 'function') {
    __safeTrackDefined = true;
  }
} catch (_) {}
if (!__safeTrackDefined) {
  function safeTrackResponseTime(startTime, requestId) { try { trackResponseTime(startTime, requestId); } catch (_) {} }
}
// Performance tracking
const responseTimes = {
  total: 0,
  count: 0,
  max: 0
};
const authCache = new Map();
const { processShopSummary } = require('../dailySummary');
const { generateInvoicePDF, generateInventoryShortSummaryPDF, generateSalesRawTablePDF } = require('../pdfGenerator'); // +new generators
const { getShopDetails } = require('../database');
const TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS || 4000);

// ===PATCH START: UNIQ:PARALLEL-HELPERS-20251219===
// Bound a non-critical promise with a tight timeout and a safe fallback.
// If it times out or throws, we return fallback (value or function()).
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) =>
      setTimeout(() => resolve(typeof fallback === 'function' ? fallback() : fallback), ms)
    ),
  ]).catch(() => (typeof fallback === 'function' ? fallback() : fallback));
}

// Fire-and-forget background work with error guard.
// Use only for side-effects that do not change the current reply.
function inBackground(label, fn) {
  Promise.resolve()
    .then(fn)
    .catch((e) => console.warn(`[bg:${label}]`, e?.message));
}
// ===PATCH END: UNIQ:PARALLEL-HELPERS-20251219===

// ===PATCH START: UNIQ:DS-CLASSIFIER-ENV-20251219===
/**
 * Env-governed Deepseek fast classifier: language + kind + command.normalized + transaction skeleton.
 * - Single Deepseek call (model: deepseek-chat), temperature:0, max_tokens:64, timeout ≤ 1.2s.
 * - On error/timeout, falls back to heuristics. Returns { language, kind, command, transaction }.
 * Toggle with ENABLE_FAST_CLASSIFIER (true/false).
 */
function __toBoolLocal(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}
const __bool = (typeof __toBool === 'function') ? __toBool : __toBoolLocal;

// ---- Env toggles & params ----
const ENABLE_FAST_CLASSIFIER = __bool(process.env.ENABLE_FAST_CLASSIFIER ?? 'true');        // main gate
const FAST_CLASSIFIER_TIMEOUT_MS = Number(process.env.FAST_CLASSIFIER_TIMEOUT_MS ?? 1200);  // 1.2s default
const FAST_CLASSIFIER_MODEL_DEEPSEEK = process.env.FAST_CLASSIFIER_MODEL_DEEPSEEK ?? 'deepseek-chat';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// ---- Deepseek unified classification ----
async function _classifyViaDeepseek(text) {
  const axios = require('axios');
  const sys = [
    'You are a deterministic router.',
    'Return STRICT JSON object with keys:',
    '- language: ISO code or exact variant (e.g., "en", "hi", "hi-latn")',
    '- kind: one of ["greeting","question","transaction","command","other"]',
    '- command: { normalized: string } or null',
    '- transaction: { action, product, quantity, unit, pricePerUnit, expiry } or null',
    'No prose. No markdown. No extra keys.'
  ].join(' ');
  const body = {
    model: FAST_CLASSIFIER_MODEL_DEEPSEEK,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: String(text ?? '').trim() }],
    temperature: 0,
    max_tokens: 64
  };
  const resp = await axios.post(
    'https://api.deepseek.com/v1/chat/completions',
    body,
    { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, timeout: FAST_CLASSIFIER_TIMEOUT_MS }
  );
  const raw = String(resp?.data?.choices?.[0]?.message?.content ?? '').trim();

  // Try strict parse; if the model included extra text, extract the first balanced JSON block
  let jsonStr = raw;
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = raw.slice(firstBrace, lastBrace + 1);
  }
  try { return JSON.parse(jsonStr); } catch { return null; }
}

/**
 * classifyAndRoute(text, detectedLanguageHint):
 * - Returns null when gate is OFF (callers should use legacy path).
 * - Returns unified {language, kind, command, transaction} when gate is ON.
 */
async function classifyAndRoute(text, detectedLanguageHint) {
  if (!ENABLE_FAST_CLASSIFIER) return null;

  try {
    const out = await _classifyViaDeepseek(text);
    if (out && out.language && out.kind) {
      return {
        language: ensureLangExact(out.language ?? detectedLanguageHint ?? 'en'),                
        kind: out.kind ?? 'other',
        // HARD GUARD: never pass through a command for greetings
        command: _isGreeting(text) ? null : (out.command ?? null),
        transaction: out.transaction ?? null
      };
    }
  } catch { /* fall through to heuristics */ }

  // Final fallback under gate ON: heuristics (deterministic & fast)
  const user = String(text ?? '').trim();    
  const isGreeting = _isGreeting(user);
  const normalized = isGreeting ? null : resolveSummaryIntent(user);    
  // --- BEGIN: alias-based command normalization (heuristics path) ---
    if (!normalized) {
      const aliasCmd = normalizeCommandAlias(user, detectedLanguageHint);
      if (aliasCmd) normalized = aliasCmd; // e.g., "reorder sujhav" -> "reorder suggestions"
    }
    // --- END: alias-based command normalization ---
   const isCommand = normalized && /^(short summary|full summary|low stock|reorder suggestions|expiring \d+|sales (today|week|month)|inventory value|stock value|value summary)$/i.test(normalized);
   return {
     language: ensureLangExact(detectedLanguageHint ?? guessLangFromInput(user) ?? 'en'),
     kind: (await looksLikeQuestion(user) ? 'question' : 'other'),
     command: isGreeting || !isCommand ? null : { normalized },
     transaction: null
   };
}
// ===PATCH END: UNIQ:DS-CLASSIFIER-ENV-20251219===

const languageNames = {
  'hi': 'Hindi',
  'bn': 'Bengali',
  'ta': 'Tamil',
  'te': 'Telugu',
  'kn': 'Kannada',
  'gu': 'Gujarati',
  'mr': 'Marathi',
  'en': 'English'
};


// ---- Static UX labels for critical fallbacks (Option A) --------------------
// Keep these strings ultra-concise and language-native. Extend per language as needed.
const STATIC_LABELS = {
  ack: {
    en: 'Processing your message…',
    hi: 'आपका संदेश प्रोसेस हो रहा है…',
    'hi-latn': 'Aapka sandesh process ho raha hai…',
    bn: 'আপনার বার্তা প্রক্রিয়াকরণ হচ্ছে…',
    ta: 'உங்கள் செய்தி செயலாக்கப்படுகிறது…',
    te: 'మీ సందేశాన్ని ప్రాసెస్ చేస్తున్నాం…',
    kn: 'ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಸಂಸ್ಕರಿಸಲಾಗುತ್ತಿದೆ…',
    mr: 'आपला संदेश प्रक्रिया होत आहे…',
    gu: 'તમારો સંદેશ પ્રોસેસ થઈ રહ્યો છે…'
  }, 
// NEW: Voice-specific ultra-early ack
  ackVoice: {
    en: 'Transcribing your voice…',
    hi: 'आपकी आवाज़ का ट्रांसक्रिप्शन हो रहा है…',
    'hi-latn': 'Aapki awaaz ka transcription ho raha hai…',
    bn: 'আপনার ভয়েস ট্রান্সক্রাইব হচ্ছে…',
    ta: 'உங்கள் குரலை பதிவுசெய்கிறோம்…',
    te: 'మీ వాయిస్ ట్రాన్స్‌క్రైబ్ అవుతోంది…',
    kn: 'ನಿಮ್ಮ ಧ್ವನಿಯನ್ನು ಲಿಖಿತಗೊಳಿಸುತ್ತಿದ್ದೇವೆ…',
    mr: 'आपल्या आवाजाचे ट्रान्सक्रिप्शन होत आहे…',
    gu: 'તમારો અવાજ ટ્રાન્સક્રાઇબ થઈ રહ્યો છે…',
  },
  fallbackHint: {        
    en: 'Type or speak (voice note) “mode” to switch Purchase/Sale/Return or make an inventory query',
        hi: '“मोड” टाइप करें या वॉइस नोट बोलें—संदर्भ बदलने या सारांश पूछने के लिए।',
        bn: '“mode” টাইপ করুন বা ভয়েস নোট বলুন—প্রসঙ্গ বদলাতে বা সারাংশ জানতে।',
        ta: '“mode” என்று தட்டச்சிடவும் அல்லது வொய்ஸ் நோட் பேசவும்—சூழலை மாற்ற அல்லது சுருக்கம் கேட்க.',
        te: '“mode” టైప్ చేయండి లేదా వాయిస్ నోట్ మాట్లాడండి—సందర్భం మార్చడానికి లేదా సారాంశం అడగడానికి.',
        kn: '“mode” ಅನ್ನು ಟೈಪ್ ಮಾಡಿ ಅಥವಾ ವಾಯ್ಸ್ ನೋಟ್ ಮಾತನಾಡಿ—ಸಂದರ್ಬ ಬದಲಿಸಲು ಅಥವಾ ಸಾರಾಂಶಕ್ಕಾಗಿ.',
        mr: '“mode” टाइप करा किंवा व्हॉईस नोट बोला—संदर्भ बदलण्यासाठी किंवा सारांश विचारण्यासाठी.',
        gu: '“mode” ટાઈપ કરો અથવા વૉઇસ નોટ બોલો—સંદર્ભ બદલવા અથવા સારાંશ માગવા.'
  },   
  // --- Localized captions for interactive buttons (used in onboarding text too)
    startTrialBtn: {
      en: 'Start Trial',
      hi: 'ट्रायल शुरू करें',
      bn: 'ট্রায়াল শুরু করুন',
      ta: 'ட்ரயல் தொடங்கவும்',
      te: 'ట్రయల్ ప్రారంభించండి',
      kn: 'ಟ್ರಯಲ್ ಪ್ರಾರಂಭಿಸಿ',
      mr: 'ट्रायल सुरू करा',
      gu: 'ટ્રાયલ શરૂ કરો'
    },
    demoBtn: {
      en: 'Demo',
      hi: 'डेमो',
      bn: 'ডেমো',
      ta: 'டெமோ',
      te: 'డెమో',
      kn: 'ಡೆಮೊ',
      mr: 'डेमो',
      gu: 'ડેમો'
    },
    helpBtn: {
      en: 'Help',
      hi: 'मदद',
      bn: 'সহায়তা',
      ta: 'உதவி',
      te: 'సహాయం',
      kn: 'ಸಹಾಯ',
      mr: 'मदत',
      gu: 'મદદ'
    }
};
function getStaticLabel(key, lang) {
  const lc = String(lang || 'en').toLowerCase();
  return STATIC_LABELS[key]?.[lc] || STATIC_LABELS[key]?.en || '';
}

// ===== LOCALIZED MODE BADGES & SWITCH WORD (one-word, language-appropriate) =====
// One-word badge shown for the current mode (Purchase / Sale / Return / None) in user's language.
const MODE_BADGE = {
  purchase: {
    en: 'PURCHASE', hi: 'खरीद', bn: 'ক্রয়', ta: 'கொள்முதல்', te: 'కొనుగోలు',
    kn: 'ಖರೀದಿ', mr: 'खरेदी', gu: 'ખરીદી'
  },
  sold: {
    en: 'SALE', hi: 'बिक्री', bn: 'বিক্রি', ta: 'விற்பனை', te: 'అమ్మకం',
    kn: 'ಮಾರಾಟ', mr: 'विक्री', gu: 'વેચાણ'
  },
  returned: {
    en: 'RETURN', hi: 'वापसी', bn: 'রিটার্ন', ta: 'ரிட்டர்ன்', te: 'రిటర్న్',
    kn: 'ರಿಟರ್ನ್', mr: 'परत', gu: 'રીટર્ન'
  },
  none: {
    en: 'NONE', hi: 'कोई', bn: 'নাই', ta: 'இல்லை', te: 'లేను',
    kn: 'ಇಲ್ಲ', mr: 'काही नाही', gu: 'નથી'
  }
};

// Single-word “switch mode” hint to display in the footer (localized).
// This is what users will see as the one-word hint to switch context.
const SWITCH_WORD = {
  en: 'mode',
  hi: 'मोड',
  bn: 'মোড',
  ta: 'மோட்',
  te: 'మోడ్',
  kn: 'ಮೋಡ್',
  mr: 'मोड',
  gu: 'મોડ'
};

// ===== TERMINAL COMMANDS & ALIAS GUARD (new unified) =========================
// Commands that are terminal (one-shot, read-only). Once resolved to these,
// we should NOT recurse/re-route or re-orchestrate in the same cycle.
const TERMINAL_COMMANDS = new Set([
  'short summary',
  'full summary',    
  // Router single-pass: treat these read-only queries as terminal too
  'low stock',
  'reorder suggestions',
  'expiring 0',
  'expiring 7',
  'expiring 30',
  'sales today',
  'sales week',
  'sales month',
  'top 5 products month',
  'top products month',
  'value summary',
  'inventory value',
  'stock value',
  'reset',
  'reorder',
  'reorder suggestion'
]);

// Robust alias-depth counter (handles ':alias' and '::ai-norm' forms).
function _aliasDepth(id) {
  const s = String(id || '');
  const aliasHits   = (s.match(/:alias/g)    || []).length;      // ':alias'
  const aiNormHitsD = (s.match(/::ai-norm/g) || []).length;      // '::ai-norm'
  const aiNormHitsS = (s.match(/:ai-norm/g)  || []).length;      // ':ai-norm' (defensive)
  return aliasHits + aiNormHitsD + aiNormHitsS;
}

// Allow overriding via env if needed; default is 1 hop.
const MAX_ALIAS_DEPTH = Number(process.env.MAX_ALIAS_DEPTH ?? 1);

// Helper: is this a terminal command?
function _isTerminalCommand(cmd) {
  const c = String(cmd || '').trim().toLowerCase();
  return TERMINAL_COMMANDS.has(c);
}

// Helper: normalize language hint safely
function _safeLang(...candidates) {      
    for (const c of candidates) {
        if (c) {
          const s = String(c).toLowerCase();
          return canonicalizeLang(s);
        }
      }
  return 'en';
}

// ==== SINGLE SOURCE: Language detection (heuristic + optional AI) ====
// Must be declared BEFORE any calls (e.g., in handleRequest or module.exports).
async function detectLanguageWithFallback(text, from, requestId) {
  return (async () => {
    try {              
        // --- GREETING SHORT-CIRCUIT ---
              // If the inbound text is a greeting (e.g., "hi", "hello", "namaste", "namaskar"),
              // do NOT treat it as a language token and do NOT flip language.
              // We keep the turn in English for one-word greetings to avoid "Hi" => Hindi collisions.
              // Anchor: uses your existing _isGreeting(text) helper and GREETING_TOKENS.
              if (_isGreeting(text)) {
                // English is the safest default for single-word greetings.
                // (Voice/STT paths still read pinned prefs elsewhere.)
                console.log(`[${requestId}] Greeting detected; short-circuiting to en`);
                return 'en';
              }
        const shopIdX = String(from ?? '').replace('whatsapp:', '');
              const stX = await getUserStateFromDB(shopIdX).catch(() => null);
              const isOnboarding = stX?.mode === 'onboarding_trial_capture';                            
              // NOTE: For TEXT turns we should NOT retain pinned non-English preference.
                    // Voice path already respects pinned language via STT config helpers.
                    const pinnedLang = ''; // <-- disable pinned pref retention for text    
              // ------------------------------------------------------------------
                    // NEW: Respect pinned/non‑English user preference across turns.
                    // If the user previously chose a non‑English language, keep it
                    // for this turn unless the message is an explicit language switch.
                    // This is language‑agnostic (hi/bn/ta/te/kn/mr/gu and *-latn).
                    // ------------------------------------------------------------------
              const GSTIN_RX = /^[0-9A-Z]{15}$/i;
              const raw = String(text ?? '');
              const asciiLen = raw.replace(/[^\x00-\x7F]/g, '').length;
              const isCodeDominant = (asciiLen / Math.max(1, raw.length)) > 0.85 || ((raw.match(/\d/g) ?? []).length >= 10);
              if (isOnboarding && (GSTIN_RX.test(raw) || isCodeDominant)) {
                const langLocked = pinnedLang || 'en';
                console.log(`[${requestId}] GSTIN/code-dominant during onboarding; sticking to ${langLocked}`);
                try { await saveUserPreference(shopIdX, langLocked); } catch {}
                return ensureLangExact(langLocked);
              }
      const lowerText = String(text || '').toLowerCase();
      let detectedLanguage = 'en';

      // 0) Explicit one-word switch (uses your existing tokens helper)
      try {
        if (typeof _matchLanguageToken === 'function') {
          const wanted = _matchLanguageToken(text);
          if (wanted) detectedLanguage = wanted;
        }
      } catch (_) {}

      // 1) Script/keyword heuristics only if not decided yet
      if (detectedLanguage === 'en') {
        if (/[\u0900-\u097F]/.test(text)) { // Devanagari                        
                   // If Devanagari script is present, prefer native Hindi.
                   // Do NOT flip to English due to a few English brand/verb tokens.
                   detectedLanguage = 'hi';
        } else if (/[\u0980-\u09FF]/.test(text)) detectedLanguage = 'bn';
        else if (/[\u0B80-\u0BFF]/.test(text)) detectedLanguage = 'ta';
       else if (/[\u0C00-\u0C7F]/.test(text)) detectedLanguage = 'te';
        else if (/[\u0C80-\u0CFF]/.test(text)) detectedLanguage = 'kn';
        else if (/[\u0A80-\u0AFF]/.test(text)) detectedLanguage = 'gu';
        else {                        
                // Use word-boundary based greeting checks to avoid false positives like "bhi" → "hi"
                      const hasEnGreet = /(?:^|\\s)(hello|hi|hey)(?:\\s|$)/i.test(lowerText);
                      const hasHiGreet = /(?:^|\\s)(नमस्ते|नमस्कार)(?:\\s|$)/.test(text);
                      const hasTaGreet = /(?:^|\\s)(வணக்கம்)(?:\\s|$)/.test(text);
                      const hasTeGreet = /(?:^|\\s)(నమస్కారం)(?:\\s|$)/.test(text);
                      const hasKnGreet = /(?:^|\\s)(ನಮಸ್ಕಾರ)(?:\\s|$)/.test(text);
                      const hasBnGreet = /(?:^|\\s)(নমস্কার)(?:\\s|$)/.test(text);
                      const hasGuGreet = /(?:^|\\s)(નમસ્તે)(?:\\s|$)/.test(text);
                      const hasMrGreet = /(?:^|\\s)(नमस्कार)(?:\\s|$)/.test(text);
                      if (hasEnGreet) detectedLanguage = 'en';
                      else if (hasHiGreet) detectedLanguage = 'hi';
                      else if (hasTaGreet) detectedLanguage = 'ta';
                      else if (hasTeGreet) detectedLanguage = 'te';
                      else if (hasKnGreet) detectedLanguage = 'kn';
                      else if (hasBnGreet) detectedLanguage = 'bn';
                      else if (hasGuGreet) detectedLanguage = 'gu';
                      else if (hasMrGreet) detectedLanguage = 'mr';
        }
      }
      
    // ---- [PATCH BLOCK] Roman-Hindi vs Hinglish classification (before autoLatnIfRoman) ----
    // We are still in detectLanguageWithFallback(...), after initial heuristics "detectedLanguage"
    // but BEFORE calling autoLatnIfRoman(...). This ensures intent is respected.
    try {
      const rawLocal = String(text ?? '');
      const tLocal = rawLocal.toLowerCase();
      const isAsciiLocal = /^[\x00-\x7F]+$/.test(rawLocal);

      // Strong Hindi intent: roman Hindi number words + unit anchors + Hindi nouns
      const strongHindiRoman =
        ENABLE_ROMAN_HINDI_NATIVE &&
        isAsciiLocal &&
        HI_ROMAN_NUMBER_WORDS.test(tLocal) &&
        UNIT_TOKENS_EN.test(tLocal) &&
        HI_ROMAN_NOUNS.test(tLocal);

      // English-driven Hinglish: English number words + units + Hindi nouns (ASCII)
      const englishDrivenHinglish =
        isAsciiLocal &&
        EN_NUMBER_WORDS.test(tLocal) &&
        UNIT_TOKENS_EN.test(tLocal) &&
        HI_ROMAN_NOUNS.test(tLocal);

      if (strongHindiRoman) {
        // Force native Hindi for roman-Hindi transactional intent
        detectedLanguage = 'hi';
      } else if (englishDrivenHinglish && detectedLanguage === 'en') {
        detectedLanguage = 'hi-latn';
      }
    } catch (_) { /* noop */ }
      
      // 2) AI pass for Romanized Indic / ambiguous ASCII
            const useAI = _shouldUseAI(text, detectedLanguage);
            if (useAI) {
              const ai = await aiDetectLangIntent(text);            
              if (ai.language) detectedLanguage = ai.language;
                        // Re-enable *-latn auto-detection (single-script only; no bilingual generation)
                        detectedLanguage = autoLatnIfRoman(detectedLanguage, text);
              try {
                const shopId = String(from ?? '').replace('whatsapp:', '');
                if (typeof saveUserPreference === 'function') await saveUserPreference(shopId, detectedLanguage);
              } catch (_e) {}                                
                  console.log(`[${requestId}] AI lang=${ai.language} intent=${ai.intent}`);
                      }
                  
                      // Final pass: even if heuristics stayed native, switch to *-latn when text looks Roman Indic.
                      // [PATCH] Do NOT flip hi->hi-latn if strong Hindi roman intent is detected.
                      try {
                        const rawLocal2 = String(text ?? '');
                        const tLocal2 = rawLocal2.toLowerCase();
                        const strongHindiRoman2 = ENABLE_ROMAN_HINDI_NATIVE && /^[\x00-\x7F]+$/.test(rawLocal2)
                          && HI_ROMAN_NUMBER_WORDS.test(tLocal2) && UNIT_TOKENS_EN.test(tLocal2) && HI_ROMAN_NOUNS.test(tLocal2);
                        detectedLanguage = strongHindiRoman2 ? canonicalizeLang(detectedLanguage) : autoLatnIfRoman(detectedLanguage, text);
            } catch (_) {}
            // 3) Optional AI if non-ASCII but heuristics left it at 'en'
            if (!useAI && detectedLanguage === 'en' && !/^[a-z0-9\s.,!?'\"@:/\-]+$/i.test(lowerText)) {
              try {
                const ai = await aiDetectLangIntent(text);
                if (ai.language) detectedLanguage = ai.language;
                detectedLanguage = autoLatnIfRoman(detectedLanguage, text);
              } catch (e) {
                console.warn(`[${requestId}] AI language detection failed: ${e.message}`);
              }
            }
        // Final pass: even if heuristics stayed native, switch to *-latn when text looks Roman Indic.
              // (Ensures Hinglish/Tanglish etc. get Latin-only responses without bilingual.)
              detectedLanguage = autoLatnIfRoman(detectedLanguage, text);
        detectedLanguage = canonicalizeLang(detectedLanguage);

      console.log(`[${requestId}] Detected language: ${detectedLanguage}`);

      // 3) Persist preference (best effort)
      try {
        const shopId = String(from || '').replace('whatsapp:', '');
        if (typeof saveUserPreference === 'function') {
          await saveUserPreference(shopId, detectedLanguage);
        }
      } catch (e) {
        console.warn(`[${requestId}] Failed to save language preference: ${e.message}`);
      }

      // 4) Optional in-memory cache if available in your module
      try {
        if (typeof languageCache !== 'undefined' && typeof LANGUAGE_CACHE_TTL !== 'undefined') {
          const cacheKey = `${from}:${String(text || '').substring(0, 50)}`;
          languageCache.set(cacheKey, { language: detectedLanguage, timestamp: Date.now() });
        }
      } catch (_) {}

      return detectedLanguage;
    } catch (error) {
      console.warn(`[${requestId}] Language detection failed, defaulting to English: ${error.message}`);
      return 'en';
    }
  })();
}

// Safe wrapper so missing function can’t crash the request
async function safeSendParseError(From, detectedLanguage, requestId, header) {
  try {             
    // NEW: if this requestId was handled (e.g., skip processed), suppress fallback
        if (handledRequests?.has?.(requestId)) {
          console.log('[safeSendParseError] suppressed (already handled)', { requestId });
          return;
        }

    // Do not send apologies/examples during trial onboarding capture
       try {
         const shopId = String(From).replace('whatsapp:', '');
         const st = await getUserStateFromDB(shopId);
         if (st?.mode === 'onboarding_trial_capture') {
           console.log('[safeSendParseError] suppressed during onboarding', { requestId });
           return;
         }
       } catch {}
    if (typeof sendParseErrorWithExamples === 'function') {
      await sendParseErrorWithExamples(From, detectedLanguage, requestId, header);
    } else {                             
        // Ultra-compact fallback in user's language (ensure msg is defined)                            
              const msg = await t(
                    header ?? 'Sorry, I could not understand that. Try (type or speak a voice note): "sold milk 2 ltr" or "short summary".',
                detectedLanguage,
                requestId + '::err-fallback'
              );
              // Guard: if already handled elsewhere in this cycle, do not send apology
              if (!handledRequests.has(requestId)) {
                await sendMessageViaAPI(From, msg);
              } else {
                console.log('[safeSendParseError] suppressed (already handled)', { requestId });
              }
    }
  } catch (e) {
    // last resort noop
    console.warn('[safeSendParseError] failed:', e?.message);
  }
}


// Fallback tokens we accept from users (they might type English/Hinglish or local verbs)
const SWITCH_FALLBACKS = [
  // English / Hinglish
  'mod', 'mode', 'switch', 'change', 'badlo',
  // Hindi
  'मोड', 'बदलें', 'बदल', 'बदले',
  // Bengali
  'মোড', 'বদল',
  // Tamil
  'மோட்', 'மாற்று',
  // Telugu
  'మోడ్', 'మార్చు',
  // Kannada
  'ಮೋಡ್', 'ಬದಲಿಸಿ',
  // Marathi
  'मोड', 'बदला',
  // Gujarati
  'મોડ', 'બદલો'
];

// ============================================================================
// ===== Unicode-script clamp (single-script rendering) ========================
// ============================================================================


/**
 * Clamp text to a single script based on language.
 * Keeps numerals, ₹, punctuation, and emojis.
 */
function clampToSingleScript(text, lang) {
    const s = String(text ?? '').normalize('NFC');
    const L = String(lang ?? 'en').toLowerCase();
    const SCRIPT_RX = {                
        roman: /[\p{Script=Latin}\p{Number}\p{Symbol}\p{Punctuation}\p{Mark}\s]/u,
            hi:    /[\p{Script=Devanagari}\p{Number}\p{Symbol}\p{Punctuation}\p{Mark}\s]/u,
            mr:    /[\p{Script=Devanagari}\p{Number}\p{Symbol}\p{Punctuation}\p{Mark}\s]/u,
            bn:    /[\p{Script=Bengali}\p{Number}\p{Symbol}\p{Punctuation}\p{Mark}\s]/u,
            ta:    /[\p{Script=Tamil}\p{Number}\p{Symbol}\p{Punctuation}\p{Mark}\s]/u,
            te:    /[\p{Script=Telugu}\p{Number}\p{Symbol}\p{Punctuation}\p{Mark}\s]/u,
            kn:    /[\p{Script=Kannada}\p{Number}\p{Symbol}\p{Punctuation}\p{Mark}\s]/u,
            gu:    /[\p{Script=Gujarati}\p{Number}\p{Symbol}\p{Punctuation}\p{Mark}\s]/u
    };
    const isRomanTarget = L === 'en' || L.endsWith('-latn');
    const rx = isRomanTarget ? SCRIPT_RX.roman : (SCRIPT_RX[L] ?? SCRIPT_RX.roman);
    const kept = [...s].filter(ch => rx.test(ch)).join('');        
    return kept.replace(/\r?\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ===== Language detection re-entry guard + explicit tokens =====
const _langDetectInFlight = new Set(); // from (whatsapp:+91...) -> boolean
const LANGUAGE_TOKENS = {
  // two-way synonyms for quick, explicit language switches
  en: new Set(['en','eng','english']),
  hi: new Set(['hin','hindi','हिंदी','हिन्दी']),
  bn: new Set(['bn','ben','bengali','বাংলা']),
  ta: new Set(['ta','tam','tamil','தமிழ்']),
  te: new Set(['te','tel','telugu','తెలుగు']),
  kn: new Set(['kn','kan','kannada',' ಕನ್ನಡ','ಕನ್ನಡ']),
  mr: new Set(['mr','mar','marathi','मराठी']),
  gu: new Set(['gu','guj','gujarati','ગુજરાતી'])
};

function _matchLanguageToken(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;

  // Require an explicit switch phrase for short/ambiguous tokens
  const explicitSwitch = /\b(lang(uage)?|switch|set)\b/.test(t);

  for (const [code, set] of Object.entries(LANGUAGE_TOKENS)) {
    if (set.has(t) && (explicitSwitch || t.length > 2)) {
      return code;
    }
  }
  return null;
}
  
// Helper: which one-word switch label to show for a given language
function getSwitchWordFor(lang) {
  const lc = String(lang || 'en').toLowerCase();
  return SWITCH_WORD[lc] || SWITCH_WORD.en;
}

// Helper: resolve the one-word badge for current action in user's language
function getModeBadge(action, lang) {
  const a = (action || '').toLowerCase();
  const lc = String(lang || 'en').toLowerCase();
  if (a === 'purchase' || a === 'purchased') return MODE_BADGE.purchase[lc] || MODE_BADGE.purchase.en;
  if (a === 'sold') return MODE_BADGE.sold[lc] || MODE_BADGE.sold.en;
  if (a === 'returned') return MODE_BADGE.returned[lc] || MODE_BADGE.returned.en;
  return MODE_BADGE.none[lc] || MODE_BADGE.none.en;
}

// --- Summary/low-stock sanitization helpers ---
const UNIT_WORDS = new Set([
  'packet','packets','bottle','bottles','box','boxes','bag','bags',
  'piece','pieces','metre','metres','meter','meters','time','times'
]);
function looksLikeCommandOrSlug(name) {
  const n = String(name || '').trim().toLowerCase();
  return (
    n.startsWith('list_') ||
    /^expiring\s*\d+$/.test(n) ||
    /^sales\b/.test(n) ||
    n === 'daily summary'
  );
}
function sanitizeProductRows(arr) {
  // Accepts rows like {name, quantity, unit} OR Airtable-style with fields
  const dedup = new Map(); // lcName -> {name, quantity, unit}
  for (const r of (arr || [])) {
    const rawName = r?.name ?? r?.fields?.Product ?? '';
    const name = String(rawName).trim();
    if (!name) continue;
    const lc = name.toLowerCase();
    if (UNIT_WORDS.has(lc)) continue;
    if (looksLikeCommandOrSlug(lc)) continue;
    const quantity = r?.quantity ?? r?.fields?.Quantity;
    const unit = r?.unit ?? r?.fields?.Units ?? 'pieces';
    const prev = dedup.get(lc);
    // Prefer the entry with the lower quantity (stricter warning) and keep original casing
    if (!prev || (Number.isFinite(quantity) && quantity < (prev.quantity ?? Infinity))) {
      dedup.set(lc, { name, quantity, unit });
    }
  }
  return Array.from(dedup.values());
}

// ===== Localized single-word direct-set actions (switch instantly) =====
const LOCAL_SET_WORDS = {
  // hi
  'खरीद': 'purchased', 'बिक्री': 'sold', 'वापसी': 'returned',
  // bn
  'ক্রয়': 'purchased', 'বিক্রি': 'sold', 'রিটার্ন': 'returned',
  // ta
  'கொள்முதல்': 'purchased', 'விற்பனை': 'sold', 'ரிட்டர்ன்': 'returned',
  // te
  'కొనుగోలు': 'purchased', 'అమ్మకం': 'sold', 'రిటర్న్': 'returned',
  // kn
  'ಖರೀದಿ': 'purchased', 'ಮಾರಾಟ': 'sold', 'ರಿಟರ್ನ್': 'returned',
  // mr
  'खरेदी': 'purchased', 'विक्री': 'sold', 'परत': 'returned',
  // gu
  'ખરીદી': 'purchased', 'વેચાણ': 'sold', 'રીટર્ન': 'returned'
};

// ==== Canonical message markers (single source of truth) ====
// ANCHOR: UNIQ:MARKER-STRIP-001
const NO_FOOTER_MARKER = '<!NO_FOOTER!>';
const NO_CLAMP_MARKER  = '<!NO_CLAMP!>';
// Hardened marker stripper: handles <!...!>, plain !NO_*! (if <> got sanitized),
// duplicates, and trims leftovers.
function stripMarkers(s) {
  return String(s ?? '')
    .replace(new RegExp(NO_FOOTER_MARKER, 'g'), '')
    .replace(new RegExp(NO_CLAMP_MARKER,  'g'), '')
    .replace(/!NO_CLAMP!/g, '')   // defensive: angle brackets removed upstream
    .replace(/!NO_FOOTER!/g, '')  // defensive: angle brackets removed upstream
    .replace(/(?:\s*\n)?\s*(?:!NO_CLAMP!\s*){2,}/g, '') // remove duplicates
    .replace(/(?:\s*\n)?\s*(?:!NO_FOOTER!\s*){2,}/g, '')
    .trim();
}

// ==== Unified end-date resolver (uses one Airtable field: TrialEndDate) ====
// Many call sites previously checked planInfo.trialEnd / trialEndDate / endDate.
// From now on, both trial and paid store the plan end in TrialEndDate.
function getUnifiedEndDate(planInfo) {
  return planInfo?.TrialEndDate
      ?? planInfo?.trialEndDate
      ?? planInfo?.trialEnd
      ?? planInfo?.endDate
      ?? null;
}

// Accept one-word localized switch triggers or direct-set actions
function parseModeSwitchLocalized(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const t = raw.toLowerCase();

  // One-word ask (open options): if it matches any fallback token
  const singleWord = t.replace(/\s+/g, ' ');
  const isSingle = !/\s/.test(singleWord);
  const inFallbacks = SWITCH_FALLBACKS.some(x => String(x).toLowerCase() === singleWord);
  if (isSingle && inFallbacks) return { ask: true };
  
  // Direct-set in English/Hinglish phrases (purchase/sale/return)
      // Normalize common verbs → canonical actions used by sticky mode
      // purchase → 'purchased', sale/sold → 'sold', return → 'returned'
      const DIRECT_SET_MAP = {
        purchased: /\b(purchase|purchased|buy|bought)\b/i,
        sold: /\b(sale|sell|sold)\b/i,
        returned: /\b(return|returned)\b/i
      };
      for (const [act, rx] of Object.entries(DIRECT_SET_MAP)) {
        if (rx.test(t)) return { set: act };
      }
    
      // Direct-set via localized one-word labels (LOCAL_SET_WORDS map is defined earlier)
      try {
        const lc = (LOCAL_SET_WORDS && typeof LOCAL_SET_WORDS === 'object') ? LOCAL_SET_WORDS : null;
        if (lc) {
          // exact single-word match to any localized label
          const hit = Object.keys(lc).find(k => k.toLowerCase() === singleWord);
          if (hit) return { set: lc[hit] }; // returns 'purchased' | 'sold' | 'returned'
        }
      } catch (_) { /* noop */ }
    
      // Mode phrases that still imply "ask" (open menu)

  const containsFallback = SWITCH_FALLBACKS.some(x => t.includes(String(x).toLowerCase())); 
  if (containsFallback) return { ask: true };
  return null;
}

// Normalize and persist sticky mode
async function setStickyMode(from, actionOrWord) {      
    // Normalize WhatsApp identifier to the same format readers use downstream.
      const waFrom = String(from || '');
      const normalizedFrom = waFrom.startsWith('whatsapp:')
        ? waFrom
        : `whatsapp:${waFrom.replace(/^whatsapp:/, '')}`;
          
      // Compute shopId and proactively clear any ephemeral override modes (batch/expiry) before switching.
        const shopIdLocal = String(normalizedFrom).replace('whatsapp:', '');
        try { await clearEphemeralOverrideStateByShopId(shopIdLocal); } catch (_) { /* best-effort */ }

      // Store canonical actions exactly as downstream validators and parsers expect.
      const map = {
        purchase: 'purchased', buy: 'purchased', bought: 'purchased',
        sale: 'sold', sell: 'sold', sold: 'sold',
        return: 'returned', returned: 'returned'
      };
      const norm = (map[actionOrWord] ?? actionOrWord ?? '').toLowerCase();
      const finalAction = ['purchased','sold','returned'].includes(norm) ? norm : 'purchased';
    
      // Persist to DB (shopId derived inside setUserState) under mode expected by sticky parsers.
      await setUserState(normalizedFrom, 'awaitingTransactionDetails', { action: finalAction });
        
        // --- [PATCH:MODE-OVERRIDE-FOOTER-20251221] Begin
        // 1) Record the last sticky action with timestamp (helps the immediate footer render).
        try { __lastStickyAction.set(shopIdLocal, { action: finalAction, ts: Date.now() }); } catch { /* noop */ }
        // 2) Warm the stateCache with the new mode so tagWithLocalizedMode sees it instantly.
        try {
          _cachePut(stateCache, shopIdLocal, { mode: 'awaitingTransactionDetails', data: { action: finalAction } });
        } catch { /* noop */ }
        // --- [PATCH:MODE-OVERRIDE-FOOTER-20251221] End

      try { console.log('[state] sticky set', { from: normalizedFrom, action: finalAction }); } catch (_) {}
    
      // Best-effort in‑memory mirror (optional)           
      try {
          globalState.conversationState[shopIdLocal] = {
          mode: 'awaitingTransactionDetails',
          data: { action: finalAction },
          ts: Date.now()
        };
      } catch (_) { /* noop */ }
}

// ===== LOCALIZED FOOTER TAG: append «<MODE_BADGE> • <SWITCH_WORD>» to every message =====
async function tagWithLocalizedMode(from, text, detectedLanguageHint = null, opts = {}) {
  try {
    // NOTE: badge will be shown only if the user is activated (paid or trial & not expired)        
        // 🔧 Strip footer-suppressor markers (raw "<>" or escaped) and finalize immediately
        if (/^(?:\s*(?:<>|&lt;&gt;))+/.test(String(text))) {
          const withoutMarker = String(text).replace(/^(?:\s*(?:<>|&lt;&gt;))+/, '');
          return finalizeForSend(withoutMarker, String(detectedLanguageHint ?? 'en').toLowerCase());
        }
    // Guard: if footer already present, do not append again        
    if (/«.+\s•\s.+»$/.test(text)) {
          return finalizeForSend(text, String(detectedLanguageHint ?? 'en').toLowerCase());
        }

    const shopId = shopIdFrom(from);
    

    // 1) Activation gate: only show badge if plan is active            
    // --- NEW: parallel reads (plan + pref + state) via Promise.allSettled + TTL caches ---
        const [planInfoRes, prefRes, stateRes] = await Promise.allSettled([
          getUserPlanQuick(shopId),
          getUserPreference(shopId),
          getUserStateQuick(shopId)
        ]);
        const planInfo = planInfoRes.status === 'fulfilled' ? planInfoRes.value : null;
        const pref     = prefRes.status     === 'fulfilled' ? prefRes.value     : null;
        const state    = stateRes.status    === 'fulfilled' ? stateRes.value    : null;
        let activated = false;
        try {
          const plan = String(planInfo?.plan ?? '').toLowerCase();
          const end  = getUnifiedEndDate(planInfo);
          const expired = (plan === 'trial' && end)
            ? (new Date(end).getTime() < Date.now())
            : false;
          activated = (plan === 'paid') || (plan === 'trial' && !expired);
        } catch (_) { /* best-effort only */ }
    
    // 2) Read current state and derive the *effective* action used for footer
    let action = null; // canonical: 'purchased' | 'sold' | 'returned' | null
    if (state) {
      switch (state.mode) {
        case 'awaitingTransactionDetails':
          action = state.data?.action ?? null;
          break;
        case 'awaitingBatchOverride':
          // Still in SALE context during the 2‑min post-sale window
          action = 'sold';
          break;
        case 'awaitingPurchaseExpiryOverride':
        case 'awaitingPriceExpiry':
          // Purchase flows (price/expiry capture & quick override)
          action = 'purchased';
          break;
        default:
          action = state.data?.action ?? null;
      }
    }
        
    // --- [PATCH:MODE-OVERRIDE-FOOTER-20251221] Begin
        // If caller provided an explicit override for THIS TURN (e.g., immediately after mode switch),
        // honor it to avoid stale cache modes in the first ACK/examples.
        const overrideAct = String(opts?.actionOverride ?? '').toLowerCase();
        if (['purchased','sold','returned'].includes(overrideAct)) {
          action = overrideAct;
        } else {
          // Otherwise, if we have a very recent sticky action update (<5s), use it.
          try {
            const recent = __lastStickyAction.get(shopId);
            if (recent && (Date.now() - recent.ts) < 5000 && ['purchased','sold','returned'].includes(recent.action)) {
              action = recent.action;
            }
          } catch { /* noop */ }
        }
        // --- [PATCH:MODE-OVERRIDE-FOOTER-20251221] End
      
    // Normalize to canonical forms (handles legacy 'purchase' → 'purchased')
    if (action === 'purchase') action = 'purchased';    
   
    // 2) Resolve language to use:
          //    For TEXT turns, ALWAYS use the detected language from this turn.
          //    For VOICE or when no hint is provided, fall back to preference.
          let lang = String(detectedLanguageHint ?? '').toLowerCase();
          const isVoice = opts?.kind === 'voice';
          if (!lang) {
            lang = String(pref?.language ?? 'en').toLowerCase();
          } else if (isVoice && pref?.success && pref.language) {
            // Voice may retain pinned preference unless explicit switch
            lang = String(pref.language).toLowerCase();
          }
          // Optional hard override to skip preference entirely
          if (opts?.noPrefOverride === true) {
            lang = String(detectedLanguageHint ?? 'en').toLowerCase();
          }
        
    // 4) If not activated, or effective action is none, do NOT append badge
        const isNone = !action || String(action).trim().length === 0;
        if (!activated || isNone) return finalizeForSend(text, String(detectedLanguageHint ?? 'en').toLowerCase());
               
    // --- NEW: Append Help CTA conditionally (only where explicitly requested) ---
        // Avoid duplication if CTA already present.
        const switchWord = getSwitchWordFor(lang);                
        const HELP_CTA = `\n\nNeed help? WhatsApp Saamagrii.AI support: "https://wa.link/6q3ol7". ` +
            `Type or speak (voice note) "${switchWord}" to switch Purchase/Sale/Return or ask an inventory query.`;        
        const wantHelpCta = opts?.helpCta === true;
            if (wantHelpCta && !/Need help\?/i.test(text)) {
              text = String(text) + HELP_CTA;
            }        
                
    // Build badge in user language                
        const badge = getModeBadge(action, lang); // e.g., 'बिक्री', 'விற்பனை', 'SALE'
                // 🔧 If badge resolves empty, do not append a placeholder
                if (!badge || !String(badge).trim()) {
                  return finalizeForSend(text, lang);
                }
        // switchWord defined above for CTA
        const tag = `«${badge} • ${switchWord}»`;

    // 4) Append on a new line; keep WA length constraints safe        
    const out = text.endsWith('\n') ? (text + tag) : (text + '\n' + tag);
    return finalizeForSend(out, lang);
  } catch {
    
    // Fallback: never show a NONE badge; return the text as-is
    return finalizeForSend(String(text ?? ''), String(detectedLanguageHint ?? 'en').toLowerCase());
  }
}


// ====== SUMMARY COMMAND ALIASES (multilingual, native + translit) ======
const SUMMARY_ALIAS_MAP = {
  hi: {
    short: ['छोटा सारांश', 'संक्षिप्त सारांश', 'chhota saraansh', 'sankshept saraansh'],
    full:  ['पूरा सारांश', 'विस्तृत सारांश', 'poora saraansh', 'vistrit saraansh']
  },
  bn: {   
    short: ['ছোট সারাংশ', 'সংক্ষিপ্ত সারাংশ', 'সংক্ষিপ্ত সারসংক্ষেপ'],
    full:  ['সম্পূর্ণ সারাংশ', 'বিস্তারিত সারাংশ', 'সম্পূর্ণ সারসংক্ষেপ']
  },
  ta: {
    short: ['சுருக்கம்', 'சுருக்கச் செய்தி'],
    full:  ['முழு சுருக்கம்', 'விரிவான சுருக்கம்']
  },
  te: {
    short: ['సంక्षిప్త సారాంశం'],
    full:  ['పూర్తి సారాంశం', 'వివరణాత్మక సారాంశం']
  },
  kn: {
    short: ['ಸಂಕ್ಷಿಪ್ತ ಸಾರಾಂಶ'],
    full:  ['ಪೂರ್ಣ ಸಾರಾಂಶ', 'ವಿಸ್ತೃತ ಸಾರಾಂಶ']
  },
  mr: {
    short: ['संक्षिप्त सारांश'],
    full:  ['पूर्ण सारांश', 'सविस्तर सारांश']
  },
  gu: {
    short: ['સંક્ષિપ્ત સારાંશ'],
    full:  ['સંપૂર્ણ સારાંશ', 'વિસ્તૃત સારાંશ']
  },
  en: {
    short: ['short summary', 'summary'], // keep "summary" for back-compat
    full:  ['full summary']
  }
};

// ====== DETERMINISTIC NATIVEGLISH LABEL RENDERER (no external API) ======
const NL_LABELS = {
  // Use *plain* labels (no colon required); these will be replaced as "native (English)".
  hi: {
    'Short Summary': 'संक्षिप्त सारांश',
    'Sales Today': 'आज की बिक्री',
    'vs Yesterday': 'कल के मुकाबले',
    'WTD': 'सप्ताह-पर्यंत',
    'Top Movers Today': 'आज के टॉप मूवर्स',
    'Inventory': 'भंडार',
    'Low Stock': 'स्टॉक कम',
    'Low Stock Alerts': 'स्टॉक कम अलर्ट',
    'Expiring Soon': 'शीघ्र समाप्त',
    'Next actions': 'अगले कदम',
    'Glossary': 'शब्दावली',
    'Daily Inventory Summary': 'दैनिक भंडार सारांश',
    'Sales': 'बिक्री',
    'GST Collected': 'एकत्रित GST',
    'Top Sellers': 'सबसे अधिक बिकने वाले',
    'Top Categories': 'शीर्ष श्रेणियाँ',
    'Current Inventory': 'वर्तमान भंडार',
    'Total Value': 'कुल मूल्य',
    'Total Cost': 'कुल लागत',
    'Profit Margin': 'लाभ मार्जिन',
    'Inventory by Category': 'वर्ग अनुसार भंडार',
    'Insights': 'अंतर्दृष्टि'
  },       
    'hi-latn': {
       'Short Summary': 'Short Summary',
       'Sales Today': 'Aaj ki Sales',
       'Low Stock': 'Kam Stock',
       'Expiring Soon': 'Jaldi Khatm',
       'Next actions': 'Agle Kadam'
     },
  bn: {
    'Short Summary': 'সংক্ষিপ্ত সারাংশ',
    'Sales Today': 'আজকের বিক্রি',
    'vs Yesterday': 'গতকালের তুলনায়',
    'WTD': 'সপ্তাহ-পর্যন্ত',
    'Top Movers Today': 'আজকের শীর্ষ বিক্রিত',
    'Inventory': 'মজুত',
    'Low Stock': 'স্টক কম',
    'Low Stock Alerts': 'স্টক কম সতর্কতা',
    'Expiring Soon': 'শীঘ্রই মেয়াদোত্তীর্ণ',
    'Next actions': 'পরবর্তী পদক্ষেপ',
    'Glossary': 'শব্দতালিকা',
    'Daily Inventory Summary': 'দৈনিক মজুত সারাংশ',
    'Sales': 'বিক্রি',
    'GST Collected': 'সংগৃহীত GST',
    'Top Sellers': 'শীর্ষ বিক্রিত',
    'Top Categories': 'শীর্ষ শ্রেণী',
    'Current Inventory': 'বর্তমান মজুত',
    'Total Value': 'মোট মূল্য',
    'Total Cost': 'মোট খরচ',
    'Profit Margin': 'লাভের মার্জিন',
    'Inventory by Category': 'বিভাগ অনুযায়ী মজুত',
    'Insights': 'ইনসাইটস'
  },
  ta: {
    'Short Summary':'சுருக்கம்',
    'Sales Today':'இன்று விற்பனை',
    'vs Yesterday':'நேற்றுடன் ஒப்பிடுக',
    'WTD':'வாரம் வரை',
    'Top Movers Today':'இன்றைய மேல் நகர்வுகள்',
    'Inventory':'இருப்பு',
    'Low Stock':'இருப்பு குறைவு',
    'Low Stock Alerts':'இருப்பு குறைவு எச்சரிக்கை',
    'Expiring Soon':'விரைவில் காலாவதி',
    'Next actions':'அடுத்த செயல்கள்',
    'Glossary':'சொற்களஞ்சியம்',
    'Daily Inventory Summary':'தினசரி இருப்பு சுருக்கம்',
    'Sales':'விற்பனை',
    'GST Collected':'திரட்டிய GST',
    'Top Sellers':'அதிகம் விற்கப்பட்டவை',
    'Top Categories':'சிறந்த வகைகள்',
    'Current Inventory':'தற்போதைய இருப்பு',
    'Total Value':'மொத்த மதிப்பு',
    'Total Cost':'மொத்த செலவு',
    'Profit Margin':'லாப விகிதம்',
    'Inventory by Category':'வகை வாரியான இருப்பு',
    'Insights':'உள்ளடக்கங்கள்'
  },
  te: {
    'Short Summary':'సంక్షిప్త సారాంశం',
    'Sales Today':'ఈరోజు అమ్మకాలు',
    'vs Yesterday':'నిన్నతో పోల్చితే',
    'WTD':'వారం వరకు',
    'Top Movers Today':'ఈరోజు టాప్ మూవర్స్',
    'Inventory':'నిల్వ',
    'Low Stock':'తక్కువ నిల్వ',
    'Low Stock Alerts':'తక్కువ నిల్వ హెచ్చరికలు',
    'Expiring Soon':'త్వరలో గడువు ముగియనున్నవి',
    'Next actions':'తదుపరి చర్యలు',
    'Glossary':'పదకోశం',
    'Daily Inventory Summary':'రోజువారీ నిల్వ సారాంశం',
    'Sales':'అమ్మకాలు',
    'GST Collected':'సేకరించిన GST',
    'Top Sellers':'అత్యధికంగా అమ్మినవి',
    'Top Categories':'ఉత్తమ వర్గాలు',
    'Current Inventory':'ప్రస్తుత నిల్వ',
    'Total Value':'మొత్తం విలువ',
    'Total Cost':'మొత్తం ఖర్చు',
    'Profit Margin':'లాభ మార్జిన్',
    'Inventory by Category':'వర్గాల వారీ నిల్వ',
    'Insights':'అవగాహనలు'
  },
  kn: {
    'Short Summary':'ಸಂಕ್ಷಿಪ್ತ ಸಾರಾಂಶ',
    'Sales Today':'ಇಂದಿನ ಮಾರಾಟ',
    'vs Yesterday':'ನಿನ್ನೆ ಜೊತೆ ಹೋಲಿಕೆ',
    'WTD':'ವಾರದವರೆಗೆ',
    'Top Movers Today':'ಇಂದಿನ ಟಾಪ್ ಮೂವರ್ಸ್',
    'Inventory':'ಸಂಗ್ರಹ',
    'Low Stock':'ಕಡಿಮೆ ಸಂಗ್ರಹ',
    'Low Stock Alerts':'ಕಡಿಮೆ ಸಂಗ್ರಹ ಎಚ್ಚರಿಕೆ',
    'Expiring Soon':'ಶೀಘ್ರದಲ್ಲೇ ಅವಧಿ ಮುಗಿಯುವವು',
    'Next actions':'ಮುಂದಿನ ಕ್ರಮಗಳು',
    'Glossary':'ಪದಕೋಶ',
    'Daily Inventory Summary':'ದೈನಂದಿನ ಸಂಗ್ರಹ ಸಾರಾಂಶ',
    'Sales':'ಮಾರಾಟ',
    'GST Collected':'ಸಂಗ್ರಹಿಸಿದ GST',
    'Top Sellers':'ಅತ್ಯಂತ ಮಾರಾಟವಾದವು',
    'Top Categories':'ಅತ್ಯುತ್ತಮ ವರ್ಗಗಳು',
    'Current Inventory':'ಪ್ರಸ್ತುತ ಸಂಗ್ರಹ',
    'Total Value':'ಒಟ್ಟು ಮೌಲ್ಯ',
    'Total Cost':'ಒಟ್ಟು ವೆಚ್ಚ',
    'Profit Margin':'ಲಾಭ ಅಂಚು',
    'Inventory by Category':'ವರ್ಗಗಳ ಪ್ರಕಾರ ಸಂಗ್ರಹ',
    'Insights':'ಅಂತರ್ಗತಗಳು'
  },
  mr: {
    'Short Summary':'संक्षिप्त सारांश',
    'Sales Today':'आजची विक्री',
    'vs Yesterday':'कालच्या तुलनेत',
    'WTD':'आठवडा-पर्यंत',
    'Top Movers Today':'आजचे टॉप मूव्हर्स',
    'Inventory':'साठा',
    'Low Stock':'कमी साठा',
    'Low Stock Alerts':'कमी साठ्याची सूचना',
    'Expiring Soon':'लवकरच कालबाह्य',
    'Next actions':'पुढील कृती',
    'Glossary':'शब्दकोश',
    'Daily Inventory Summary':'दैनिक साठा सारांश',
    'Sales':'विक्री',
    'GST Collected':'आकारलेला GST',
    'Top Sellers':'टॉप विक्री',
    'Top Categories':'शीर्ष वर्ग',
    'Current Inventory':'वर्तमान साठा',
    'Total Value':'एकूण मूल्य',
    'Total Cost':'एकूण खर्च',
    'Profit Margin':'नफा मार्जिन',
    'Inventory by Category':'वर्गनिहाय साठा',
    'Insights':'इनसाइट्स'
  },
  gu: {
    'Short Summary':'સંક્ષિપ્ત સારાંશ',
    'Sales Today':'આજનું વેચાણ',
    'vs Yesterday':'કાલની તુલનામાં',
    'WTD':'અઠવાડિયા સુધી',
    'Top Movers Today':'આજના ટોપ મૂવર્સ',
    'Inventory':'જથ્થો',
    'Low Stock':'ઓછો જથ્થો',
    'Low Stock Alerts':'ઓછા જથ્થાની ચેતવણી',
    'Expiring Soon':'ટૂંક સમયમાં ગાળા પૂરા',
    'Next actions':'આગળની કાર્યવાહી',
    'Glossary':'શબ્દકોશ',
    'Daily Inventory Summary':'દૈનિક જથ્થો સારાંશ',
    'Sales':'વેચાણ',
    'GST Collected':'ઉઘરેલો GST',
    'Top Sellers':'ટોપ વેચાણ',
    'Top Categories':'શ્રેષ્ઠ શ્રેણીઓ',
    'Current Inventory':'વર્તમાન જથ્થો',
    'Total Value':'કુલ કિંમત',
    'Total Cost':'કુલ ખર્ચ',
    'Profit Margin':'નફાકીય માર्जિન',
    'Inventory by Category':'વર્ગ પ્રમાણે જથ્થો',
    'Insights':'ઇન્સાઇટ્સ'
  },
  en: {}
};

// ==== NEW: Quoted command label map for "Next actions" (all languages) ====
const CMD_LABELS = {
  en: {
    'reorder suggestions': 'reorder suggestions',
    'prices': 'prices',
    'stock value': 'stock value',
  },
  // Hindi (Devanagari)
  hi: {
    'reorder suggestions': 'पुनः ऑर्डर सुझाव',
    'prices': 'मूल्य',
    'stock value': 'स्टॉक मूल्य',
  },
  // Hinglish (Roman Hindi)
  'hi-latn': {
    'reorder suggestions': 'punah order sujhav',
    'prices': 'moolya',
    'stock value': 'stock moolya',
  },
  // Bengali
  bn: {
    'reorder suggestions': 'পুনঃঅর্ডার পরামর্শ',
    'prices': 'মূল্য',
    'stock value': 'স্টকের মূল্য',
  },
  // Tamil
  ta: {
    'reorder suggestions': 'மீண்டும் ஆர்டர் பரிந்துரைகள்',
    'prices': 'விலைகள்',
    'stock value': 'இருப்பு மதிப்பு',
  },
  // Telugu
  te: {
    'reorder suggestions': 'పునః ఆర్డర్ సూచనలు',
    'prices': 'ధరలు',
    'stock value': 'నిల్వ విలువ',
  },
  // Kannada
  kn: {
    'reorder suggestions': 'ಮರುಆರ್ಡರ್ ಸಲಹೆಗಳು',
    'prices': 'ಬೆಲೆಗಳು',
    'stock value': 'ಸ್ಟಾಕ್ ಮೌಲ್ಯ',
  },
  // Marathi
  mr: {
    'reorder suggestions': 'पुन्हा ऑर्डर सुचवणी',
    'prices': 'किंमती',
    'stock value': 'साठा मूल्य',
  },
  // Gujarati
  gu: {
    'reorder suggestions': 'પુનઃ ઓર્ડર સૂચનો',
    'prices': 'કિંમતો',
    'stock value': 'સ્ટોક મૂલ્ય',
  },
};

// ====== COMMAND ALIASES (multilingual) -> canonical command ======
const COMMAND_ALIAS_MAP = {
  en: {
    'reorder suggestions': [
      'reorder', 're-order', 'reorder suggestion', 'restock suggestions',
      'repeat order', 'replenishment', 'suggest reorder'
    ],
    'prices': ['price list', 'prices', 'show prices'],
    'stock value': ['stock value', 'inventory value', 'value summary']
  },
  hi: { // Devanagari
    'reorder suggestions': [
      'रीऑर्डर', 'री ऑर्डर', 'रीऑर्डर सुझाव', 'री ऑर्डर सुझाव',
      'पुनः ऑर्डर', 'पुन: ऑर्डर', 'पुनः ऑर्डर सुझाव', 'पुन: ऑर्डर सुझाव',
      'फिर से ऑर्डर', 'फिरसे ऑर्डर'
    ],
    'prices': ['कीमत', 'भाव', 'रेट', 'मूल्य', 'कीमत सूची'],
    'stock value': ['स्टॉक मूल्य', 'इन्वेंटरी मूल्य', 'कुल मूल्य']
  },
  'hi-latn': { // Hinglish / Roman Hindi
    'reorder suggestions': [
      'reorder', 're order', 'reorder sujhav', 'riorder sujhav',
      'punah order', 'punah order sujhav', 'phir se order', 'order repeat',
      'reorder salah', 'reorder suggestion'
    ],
    'prices': ['moolya', 'kimat', 'daam', 'rate', 'prices'],
    'stock value': ['stock moolya', 'inventory value', 'value summary']
  },
  // (Optionally add bn/ta/te/kn/mr/gu variants later)
};

/**
 * normalizeCommandAlias(text, langHint) -> canonical command or null
 * Returns "reorder suggestions" / "prices" / "stock value" when aliases match,
 * but ONLY if the message does NOT look like a transaction.
 */
function normalizeCommandAlias(text, langHint = 'en') {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;

  // DO NOT convert to command if it looks like a transaction (qty+unit or price)
  if (looksLikeTxnLite?.(t)) return null; // uses your existing heuristic
  // Also skip if it clearly has quantity/unit inline
  if (/\b\d+(\.\d+)?\b/.test(t) && /\b(ltr|l|liter|litre|kg|g|gm|ml|packet|packets|piece|pieces|box|boxes)\b/i.test(t)) {
    return null;
  }

  const lang = String(langHint || 'en').toLowerCase();
  const base = lang.replace(/-latn$/, '');
  const mapsToTry = [
    COMMAND_ALIAS_MAP[lang],
    COMMAND_ALIAS_MAP[base],
    COMMAND_ALIAS_MAP['en'],
  ].filter(Boolean);

  for (const map of mapsToTry) {
    for (const [canonical, variants] of Object.entries(map)) {
      if (variants.some(v => t.includes(String(v).toLowerCase()))) {
        return canonical; // e.g., "reorder suggestions"
      }
    }
  }
  // Minimal heuristic: plain "reorder" => "reorder suggestions"
  if (/^re[- ]?order\b/.test(t)) return 'reorder suggestions';
  return null;
}

// [SALES-QA-IDENTITY-003] Localized identity line for all languages/variants
// Saamagrii.AI stays Latin; "friend" varies by language/script; "Name" label localized.
function identityTextByLanguage(langCode = 'en') {
  const L = String(langCode).toLowerCase().trim();
  // Localized 'Name' label
  const NAME_LABEL = {
    en: 'Name',
    hi: 'नाम',
    mr: 'नाव',
    bn: 'নাম',
    ta: 'பெயர்',
    te: 'పేరు',
    kn: 'ಹೆಸರು',
    gu: 'નામ',
    // Romanized variants
    'hi-latn': 'Naam',
    'mr-latn': 'Naav',
    'bn-latn': 'Nam',
    'ta-latn': 'Peyar',
    'te-latn': 'Peru',
    'kn-latn': 'Hesaru',
    'gu-latn': 'Naam'
  };
  // Localized 'friend' word—kept simple/neutral; adjust if you prefer alternate synonyms
  const FRIEND_WORD = {
    en: 'friend',
    hi: 'मित्र',
    mr: 'मित्र',
    bn: 'বন্ধু',
    ta: 'நண்பர்',
    te: 'స్నేహితుడు',
    kn: 'ಸ್ನೇಹಿತ',
    gu: 'મિત્ર',
    // Romanized variants
    'hi-latn': 'friend',
    'mr-latn': 'mitra',
    'bn-latn': 'bandhu',
    'ta-latn': 'nanbar',
    'te-latn': 'snehitudu',
    'kn-latn': 'snehita',
    'gu-latn': 'mitra'
  };
  const nameLabel = NAME_LABEL[L] ?? NAME_LABEL.en;
  const friend = FRIEND_WORD[L] ?? FRIEND_WORD.en;
  // Final: Name - <AGENT_NAME>, Saamagrii.AI <friend>   (Saamagrii.AI stays Latin)
  return `${nameLabel} - ${AGENT_NAME}, Saamagrii.AI ${friend}`;
}

// Helper: localize quoted commands → keeps the double quotes
function localizeQuotedCommands(text, lang) {
  try {
    const lc = String(lang ?? 'en').toLowerCase();
    const dict = CMD_LABELS[lc];
    if (!dict) return text;
    let out = String(text ?? '');
    for (const [enKey, nativeVal] of Object.entries(dict)) {
      const rx = new RegExp(`"${enKey}"`, 'gi');
      out = out.replace(rx, `"${nativeVal}"`);
    }
    return out;
  } catch { return text; }
}

const { sendContentTemplate } = require('./whatsappButtons');
const { ensureLangTemplates, getLangSids } = require('./contentCache');

/**
 * Resurface the Inventory List-Picker right after a read-only query.
 * Minimal blast radius: call once with From + lang.
 */
async function resendInventoryListPicker(From, langHint = 'en') {
  try {        
    const toNumber = String(From).replace('whatsapp:', '');
        // Derive user's preferred language if caller omitted or passed a stale hint
        // Fast, TTL-cached; falls back to the provided hint.
        let langResolved = await getPreferredLangQuick(From, langHint);
        // Canonicalize & normalize to base for ContentSid bundle creation
        langResolved = canonicalizeLang(langResolved);
        await ensureLangTemplates(langResolved);
        const sids = getLangSids(langResolved);

    if (sids?.listPickerSid) {
      // Re-send the list picker so user can immediately run another query
      await sendContentTemplate({ toWhatsApp: toNumber, contentSid: sids.listPickerSid });
      console.log('[list-picker] resurfaced', { to: toNumber, sid: sids.listPickerSid, lang: langResolved });
    } else {
      console.warn('[list-picker] missing listPickerSid for lang', { lang: langResolved });
    }
  } catch (e) {
    console.warn('[list-picker] resend failed', e?.response?.data ?? e?.message);
  }
}

async function sendWelcomeFlowLocalized(From, detectedLanguage = 'en', requestId = null)
{
  const toNumber = From.replace('whatsapp:', '');   
  // Mark this request as handled (suppresses parse-error apologies later in this cycle)
  try { if (requestId) handledRequests.add(requestId); } catch {}
  
  // 2) Plan gating: only show menus for activated users (trial/paid).
     //    Unactivated users receive a concise CTA to start the trial/paid plan.
     let plan = 'demo';
     try {
       const pref = await getUserPreference(toNumber);
       if (pref?.success && pref.plan) plan = String(pref.plan).toLowerCase();
     } catch { /* ignore plan read */ }
     const isActivated = (plan === 'trial' || plan === 'paid');
          
      if (!isActivated) {
             // NEW: Send 3‑button Onboarding Quick‑Reply (Start Trial • Demo • Help)
             let sent = false;
             const ONBOARDING_QR_SID = String(process.env.ONBOARDING_QR_SID || '').trim();
                                                       
            try {
                // Build source with localized label BEFORE translation and opt-out of clamp/footer for this message.
                const introKey = `welcome-intro::${toNumber}::${String(detectedLanguage).toLowerCase()}`;
                const NO_FOOTER_MARKER = '<!NO_FOOTER!>';
                const startTrialLabel  = getStaticLabel('startTrialBtn', detectedLanguage);
                // Keep the label in native script directly in the source text; avoid quotes getting emptied.
                const introSrc = await composeAIOnboarding('en'); // deterministic English skeleton
                const introSrcWithLabel = introSrc.replace(/"Start Trial"/g, `"${startTrialLabel}"`);                                
                // Translate once with canonical markers, then finalize and send.
                      let introText = await t(NO_CLAMP_MARKER + NO_FOOTER_MARKER + introSrcWithLabel, detectedLanguage ?? 'en', introKey);
                      introText = nativeglishWrap(introText, detectedLanguage ?? 'en'); // keep anchors readable
                      await sendMessageQueued(From, finalizeForSend(introText, detectedLanguage ?? 'en'));
                await new Promise(r => setTimeout(r, 250)); // tiny spacing before buttons
                          // >>> NEW: Send benefits video AFTER intro, BEFORE buttons (once per session gate already applies)
                          try {
                            // Prefer saved language if present
                            let lang = (detectedLanguage ?? 'en').toLowerCase();
                            try {
                              const prefLang = await getUserPreference(toNumber);
                              if (prefLang?.success && prefLang.language) lang = String(prefLang.language).toLowerCase();
                            } catch {}
                            await sendOnboardingBenefitsVideo(From, lang);
                            await new Promise(r => setTimeout(r, 300)); // breathing room before buttons
                          } catch (e) {
                            console.warn('[onboard-video] skipped', e?.message);
                          }
                } catch (e) {
                  console.warn('[welcome] intro send failed', { message: e?.message });
                }
                // 1) Prefer explicit env ContentSid if present — BUTTONS AFTER INTRO
                if (ONBOARDING_QR_SID) {
                  try {
                    const resp = await sendContentTemplate({ toWhatsApp: toNumber, contentSid: ONBOARDING_QR_SID });
                    console.log('[onboard-qr] env ContentSid send OK', { sid: resp?.sid, to: toNumber, contentSid: ONBOARDING_QR_SID });
                    sent = true;
                  } catch (e) {
                    const status = e?.response?.status;
                    const data = e?.response?.data;
                    console.warn('[onboard-qr] env ContentSid send FAILED', { status, data, sid: ONBOARDING_QR_SID, to: toNumber });
                  }
                }
      
             // 2) If env send failed or wasn't set, try per-language ContentSid from contentCache
             if (!sent) {
               try {
                 await ensureLangTemplates(detectedLanguage);
                 const sids = getLangSids(detectedLanguage);
                 if (sids?.onboardingQrSid) {
                   const resp2 = await sendContentTemplate({ toWhatsApp: toNumber, contentSid: sids.onboardingQrSid });
                   console.log('[onboard-qr] per-language send OK', { sid: resp2?.sid, to: toNumber, contentSid: sids.onboardingQrSid });
                   sent = true;
                 } else {
                   console.warn('[onboard-qr] missing per-language onboardingQrSid after ensureLangTemplates', { lang: detectedLanguage });
                 }
               } catch (e) {
                 const status = e?.response?.status;
                 const data   = e?.response?.data;
                 console.warn('[onboard-qr] per-language send FAILED', { status, data, lang: detectedLanguage, to: toNumber });
               }
             }
      
             // 3) Text fallback if neither option worked
             if (!sent) {                                                               
                // If buttons couldn't be sent, still send a compact CTA AFTER intro
                      const ctaText = getTrialCtaText(detectedLanguage ?? 'en');                                             
                      let ctaLocalized = await t(NO_FOOTER_MARKER + ctaText, detectedLanguage ?? 'en', 'welcome-gate');
                      await sendMessageQueued(From, finalizeForSend(ctaLocalized, detectedLanguage ?? 'en'));
             }
        try { markWelcomed(toNumber); } catch {}
             return; // still skip menus until activation
           }
                    
    // 3) Guarded template sends (only if SIDs exist), with plan-aware hint
      try {
        await ensureLangTemplates(detectedLanguage); // creates once per lang, then reuses
        const sids = getLangSids(detectedLanguage);
        // Send the hint FIRST
        await sendMessageQueued(From, await t(getStaticLabel('fallbackHint', detectedLanguage), detectedLanguage ?? 'en', 'welcome-hint'));
        // Then send List-Picker (inventory queries) and follow with Quick-Reply (record purchase/sale/return)
        if (sids?.listPickerSid) {
          try {
            await sendContentTemplateOnce({ toWhatsApp: toNumber, contentSid: sids.listPickerSid, requestId });
          } catch (e) {
            console.warn('[welcome] listPicker send failed', { status: e?.response?.status, data: e?.response?.data, sid: sids?.listPickerSid });
          }
        }
        if (sids?.quickReplySid) {
          try {
            await sendContentTemplateOnce({ toWhatsApp: toNumber, contentSid: sids.quickReplySid, requestId });
          } catch (e) {
            console.warn('[welcome] quickReply send failed', { status: e?.response?.status, data: e?.response?.data, sid: sids?.quickReplySid });
          }
        }
      } catch (e) {
        console.warn('[welcome] template orchestration failed', { status: e?.response?.status, data: e?.response?.data, message: e?.message });
        // Localized fallback hint
        const fhLabel = getStaticLabel('fallbackHint', detectedLanguage);
        const fhText = await t(fhLabel, detectedLanguage ?? 'en', 'welcome-fallback');
        await sendMessageQueued(From, fhText);
      }

  try { markWelcomed(toNumber); } catch {}
}

// ---------------------------------------------------------------------------
// NEW: tiny newline normalizer used where translators may emit literal "\n"
// ---------------------------------------------------------------------------
function fixNewlines1(str) {
  return String(str ?? '')
    .replace(/\\n/g, '\n')     // unescape literal \n
    .replace(/\r/g, '')        // drop any stray CRs
    .replace(/[ \t]*\n/g, '\n')// trim leading spaces before LF
    .trimEnd();                // avoid trailing whitespace
}

// === NUMERAL NORMALIZER: always convert any script digits to ASCII (0-9) ===
// Covers Devanagari (०-९), Bengali, Tamil, Telugu, Kannada, Gujarati, Arabic-Indic, etc.
function normalizeNumeralsToLatin(text) {
  if (!text) return '';
  const map = {
    // Devanagari
    '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9',
    // Bengali
    '০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9',
    // Tamil
    '௦':'0','௧':'1','௨':'2','௩':'3','௪':'4','௫':'5','௬':'6','௭':'7','௮':'8','௯':'9',
    // Telugu
    '౦':'0','౧':'1','౨':'2','౩':'3','౪':'4','౫':'5','౬':'6','౭':'7','౮':'8','౯':'9',
    // Kannada
    '೦':'0','೧':'1','೨':'2','೩':'3','೪':'4','೫':'5','೬':'6','೭':'7','೮':'8','೯':'9',
    // Gujarati
    '૦':'0','૧':'1','૨':'2','૩':'3','૪':'4','૫':'5','૬':'6','૭':'7','૮':'8','૯':'9',
    // Arabic-Indic
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'
  };
  return String(text).replace(
    /[\u0966-\u096F\u09E6-\u09EF\u0BE6-\u0BEF\u0C66-\u0C6F\u0CE6-\u0CEF\u0AE6-\u0AEF\u0660-\u0669]/g,
    ch => map[ch] || ch
  );
}

// ANCHOR: UNIQ:FINALIZE-SEND-001
// Finalize text for sending: strip any markers, enforce single-script, fix newlines,
// and normalize digits. Use this on all onboarding text sends.

function finalizeForSend(text, lang) {
  const stripped = stripMarkers(text);
  // 🔧 Strip any leaked footer-suppressor markers at the start:
  // supports both raw "<>" and HTML-escaped "&lt;&gt;"
  const deMarked = String(stripped).replace(/^(?:\s*(?:<>|&lt;&gt;))+/, '');
  const oneScript = enforceSingleScriptSafe(deMarked, lang);
  const withNL    = fixNewlines1(oneScript);
  return normalizeNumeralsToLatin(withNL).trim();
}

// Example usage (pseudo; replace at your STT call site):
// const shopId = toE164(req.body.From).replace('whatsapp:', '');
// const sttLang = await determineSttLangForShop(shopId, detectedLanguageHint);
// const sttConfig = { languageCode: sttLang, /* ...other config... */ };
// googleStt.transcribe(audioBuffer, sttConfig);

// Minimal env toggle to prefer native STT over English fallback
const PREFER_NATIVE_STT = String(process.env.PREFER_NATIVE_STT ?? '1') === '1';

/**
 * pickBestSttResult(nativeHi, englishEn):
 * Return Hindi result when enabled & confident; else fallback to English.
 * Shape expectation: { text, langCode, confidence } for each argument.
 */
function pickBestSttResult(nativeHi, englishEn, minConf = STT_CONFIDENCE_MIN_VOICE) {
  try {
    if (PREFER_NATIVE_STT && nativeHi?.langCode?.toLowerCase() === 'hi-in') {
      const c = Number(nativeHi?.confidence ?? 0);
      if (Number.isFinite(c) && c >= minConf && (nativeHi.text ?? '').trim()) {
        return nativeHi;
      }
    }
    // otherwise use english if present
    if ((englishEn?.text ?? '').trim()) return englishEn;
  } catch {}
  // last resort: whichever has text
  return (nativeHi?.text ?? '').trim() ? nativeHi : englishEn;
}

// ===== [PATCH:HYBRID-DIAGNOSTIC-TOGGLES-001] BEGIN =====
// Hybrid option toggles (Railway envs with safe defaults)
const ALLOW_READONLY_IN_STICKY = String(process.env.ALLOW_READONLY_IN_STICKY ?? '1') === '1';
const STICKY_PEEK_MAX = Number(process.env.STICKY_PEEK_MAX ?? 2);                // max consecutive peeks before nudge
const STICKY_PEEK_TTL_EXTENSION_MS = Number(process.env.STICKY_PEEK_TTL_EXTENSION_MS ?? 0); // 0 = disabled

function _safeBoolean(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}
// ===== [PATCH:HYBRID-DIAGNOSTIC-TOGGLES-001] END =====

// [UNIQ:ACK-FAST-CORE-002] — ultra-early ack helpers (no t(), no footer)
const SEND_EARLY_ACK = String(process.env.SEND_EARLY_ACK ?? 'true').toLowerCase() === 'true';
const EARLY_ACK_TIMEOUT_MS = Number(process.env.EARLY_ACK_TIMEOUT_MS ?? 500);
const _recentAcks = (globalThis._recentAcks = globalThis._recentAcks ?? new Map()); // from -> {at}

function wasAckRecentlySent(From, windowMs = ACK_SILENCE_WINDOW_MS) {
  try {
    const prev = _recentAcks.get(String(From));
    return !!(prev && Date.now() - prev.at < windowMs);
  } catch { return false; }
}
function markAckSent(From) {
  try { _recentAcks.set(String(From), { at: Date.now() }); } catch {}
}

// Fast preference resolver with tiny timeout; never blocks the ack path.
async function getPreferredLangQuick(From, hint = 'en') {
  const shopId = String(From ?? '').replace('whatsapp:', '');
  const fallback = String(hint ?? 'en').toLowerCase();
  try {
    // reuse your languageCache if present (best-effort)
    for (const [key, val] of languageCache) {
      if (String(key).startsWith(String(From))) {
        const age = Date.now() - (val?.timestamp ?? 0);
        if (age < LANGUAGE_CACHE_TTL) return String(val.language ?? fallback).toLowerCase();
      }
    }
  } catch {}
  try {
    const prefP = getUserPreference(shopId);
    const lang = await Promise.race([
      prefP.then(p => String(p?.language ?? fallback).toLowerCase()),
      new Promise(resolve => setTimeout(() => resolve(fallback), EARLY_ACK_TIMEOUT_MS))
    ]);
    return lang;
  } catch { return fallback; }
}

/**
 * Send ultra-early ack (text/voice). No t(), no footer; single-script + digits normalized.
 * Safe to call multiple times — guarded by _recentAcks.
 */
async function sendProcessingAckQuick(From, kind = 'text', langHint = 'en') {
  try {        
    if (!SEND_EARLY_ACK) return;           

        // Activation gate (ALL kinds): suppress ultra‑early ack until Trial/Paid is active
            const shopId = String(From ?? '').replace('whatsapp:', '');
            try {
              // Fast L1 cache read; avoids blocking the critical path
              const planInfo = await getUserPlanQuick(shopId);
              const plan = String(planInfo?.plan ?? '').toLowerCase();
              const end  = getUnifiedEndDate(planInfo);
              const activated =
                (plan === 'paid') ||
                (plan === 'trial' && end && new Date(end).getTime() > Date.now());
              if (!activated) return; // skip any ack before activation (trial or paid)
            } catch (_) {
              // Best‑effort: if plan can't be resolved quickly, avoid sending ack pre‑activation
              return;
            }

        // Prefer a script/hinglish guess when available; fall back to incoming hint
        // NOTE: callers that don't pass source text should use the wrapper below.              
        const preHint = canonicalizeLang(langHint ?? 'en');             
        // TEXT: do NOT override with DB preference; VOICE can retain pinned pref.
        let lang = preHint;
        if (kind === 'voice') {
          try {
            const pref = await getUserPreference(shopId);
            if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
          } catch {}
        }
         const raw = getStaticLabel(kind === 'voice' ? 'ackVoice' : 'ack', lang) ?? getStaticLabel('ack', 'en');               
      // Ensure footer uses THIS TURN language for text acks
          const tagOpts = { kind, noPrefOverride: (kind === 'text') };
          let withFooter = await tagWithLocalizedMode(From, raw, lang, tagOpts);
        withFooter = finalizeForSend(withFooter, lang);                    // single‑script + numerals
        // Instrument ack latency (POST→ack‑sent). The webhook sets reqStart in scope.
        const __t0 = Date.now();        
        const t0 = Date.now();
        await sendMessageViaAPI(From, withFooter);
        try { console.log('[ack]', { ms_post_to_sent: Date.now() - (globalThis.__lastPostTs || t0) }); } catch {}
        markAckSent(From);
  } catch (e) {
    try { console.warn('[ack-fast] failed:', e?.message); } catch {}
  }
}

// Convenience wrapper: pass inbound Body to derive a better early hint.
// Keeps ultra‑early property and avoids touching all call sites’ preference logic.
async function sendProcessingAckQuickFromText(From, kind = 'text', sourceText = '') {
  try {
    if (!SEND_EARLY_ACK) return;

    const t = String(sourceText || '').trim().toLowerCase();
     const isCommandOnly = ['mode','help','demo','trial','paid'].includes(t);
     const hint = isCommandOnly ? 'en' : guessLangFromInput(sourceText);
    return await sendProcessingAckQuick(From, kind, hint);
  } catch (e) {
    try { console.warn('[ack-fast-wrapper] failed:', e?.message); } catch {}
  }
}

// =============================================================================
// ==== Paid Plan CTA & Confirmation (white-label, no partner branding) ========
// =============================================================================
/**
 * Send the branded payment CTA page to the user with a shopId query param.
 * Razorpay static page (no shopId required): https://rzp.io/rzp/saamagriiAIPaidPlanActivation
 */
async function sendPaidPlanCTA(From, lang = 'en') {
  try {        
        const url = 'https://rzp.io/rzp/saamagriiAIPaidPlanActivation';
        let msg = await t(
          '🔒 Activate your Saamagrii.AI Paid Plan to unlock full access.\n' +
          'Complete the secure payment here:\n' + url,
          lang,
          `paid-cta::${String(From).replace('whatsapp:', '')}`
        );
        // Ensure single-script, clean newlines and ASCII digits before sending
        await sendMessageViaAPI(From, finalizeForSend(msg, lang));
  } catch (e) {
    console.warn('[paid-cta] failed:', e?.message);
  }
}

/**
 * Send a localized paid activation confirmation over WhatsApp.
 * Called from the server webhook after successful payment capture.
 */

// Idempotent + deduped paid confirmation (shows "30 days" and expiry date if present)
const _paidConfirmGuard = new Map(); // shopId -> { at: ms, lastHash: string }
const PAID_CONFIRM_TTL_MS = Number(process.env.PAID_CONFIRM_TTL_MS ?? (5 * 60 * 1000));
function _hash(s) { try { return crypto.createHash('sha256').update(String(s ?? '')).digest('hex'); } catch { return String(s ?? '').length.toString(16); } }
async function sendWhatsAppPaidConfirmation(From) {
  try {
    const shopId = shopIdFrom(From);
    // Resolve language
    let lang = 'en';
    try {
      const pref = await getUserPreference(shopId);
      if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
    } catch {}
    // Read unified end date (uses TrialEndDate for both trial & paid)
    let endISO = null;
    try {
      const planInfo = await getUserPlan(shopId);
      endISO = getUnifiedEndDate(planInfo);
    } catch {}
    const endLine = endISO
      ? `\nExpires on ${new Date(endISO).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}.`
      : '';
    const text0 = await t(
      `✅ Your Saamagrii.AI Paid Plan is now active. Enjoy full access for 30 days!${endLine}`,
      lang,
      `paid-confirm::${shopId}`
    );
    // Append footer and normalize; then idempotency guard by hash within TTL
    const withFooter = await appendSupportFooter(text0, From);
    const body = normalizeNumeralsToLatin(enforceSingleScriptSafe(withFooter, lang)).trim();
    const h = _hash(body); const prev = _paidConfirmGuard.get(shopId); const now = Date.now();
    if (prev && (now - prev.at) < PAID_CONFIRM_TTL_MS && prev.lastHash === h) { console.log('[paid-confirm] suppressed duplicate', { shopId }); return; }
    _paidConfirmGuard.set(shopId, { at: now, lastHash: h });
    await sendMessageDedup(From, body);        
    // If configured for paid capture and details are incomplete, start capture
      try {
        if (CAPTURE_SHOP_DETAILS_ON === 'paid') {
          const shopId = shopIdFrom(From);
          const details = await getShopDetails(shopId).catch(() => null);
          const missing = !details || !details.name || !details.address; // keep GSTIN optional
          if (missing) { await beginPaidOnboarding(From, lang); }
        }
      } catch (_) {}
  } catch (e) {
    console.warn('[paid-confirm] failed:', e?.message);
  }
}

// Replace English labels with "native (English)" anywhere they appear
// Single-script rendering: replace labels to native OR keep English only; never mix.
function renderNativeglishLabels(text, languageCode) {
  const lang = (languageCode ?? 'en').toLowerCase();
  // If SINGLE_SCRIPT_MODE, do NOT append "(English)" alongside native labels.
  if (SINGLE_SCRIPT_MODE) {
    const dict = NL_LABELS[lang] ?? NL_LABELS.en;
    let out = text;
    const esc = s => s.replace(/[\.\*\+?\^\${}\(\)\[\]\\]/g, '\\$&');
    for (const key of Object.keys(dict)) {
      const native = dict[key];
      if (!native) continue;
      const re = new RegExp(esc(key), 'g');
      // Replace with native only; English label is not retained.
      out = out.replace(re, native);
    }
    return out;
  }
  // Legacy behaviour (kept for backwards compatibility when SINGLE_SCRIPT_MODE=false)
  const dict = NL_LABELS[lang] ?? NL_LABELS.en;
  let out = text;
  const esc = s => s.replace(/[\.\*\+?\^\${}\(\)\[\]\\]/g, '\\$&');
  for (const key of Object.keys(dict)) {
    const native = dict[key];
    if (!native) continue;
    const re = new RegExp(esc(key), 'g');
    out = out.replace(re, `${native} (${key})`);
  }
  return out;
}

/**
 * Classify allowed non‑mutating diagnostic "peek" queries.
 * Returns {kind, args} or null.
 * Allowed inside sticky Purchase/Sale/Return:
 *   - "stock <product>"
 *   - "price <product>"
 *   - "prices"
 *   - "low stock"
 *   - "expiring <n>"
 *   - "short summary" / "full summary"
 */
function classifyDiagnosticPeek(text) {
  const s = String(text ?? '').trim();
  const lc = s.toLowerCase();
  const mStock   = lc.match(/^\s*stock\s+(.+?)\s*$/i);
  const mPrice   = lc.match(/^\s*price\s+(.+?)\s*$/i);
  const isPrices = /^\s*prices\s*$/.test(lc);
  const isLow    = /^\s*low\s+stock\s*$/.test(lc);
  const mExp     = lc.match(/^\s*expiring\s+(\d+)\s*$/i);
  const isShort  = /^\s*short\s+summary\s*$/.test(lc);
  const isFull   = /^\s*full\s+summary\s*$/.test(lc);
  if (mStock)  return { kind: 'stock',   args: { product: mStock[1].trim() } };
  if (mPrice)  return { kind: 'price',   args: { product: mPrice[1].trim() } };
  if (isPrices) return { kind: 'prices', args: {} };
  if (isLow)    return { kind: 'low',    args: {} };
  if (mExp)     return { kind: 'exp',    args: { days: Number(mExp[1]) } };
  if (isShort)  return { kind: 'summary', args: { flavor: 'short' } };
  if (isFull)   return { kind: 'summary', args: { flavor: 'full' } };
  return null;
}
// ===== [PATCH:HYBRID-DIAGNOSTIC-CLASSIFY-002] END =====

// ===== [PATCH:HYBRID-DIAGNOSTIC-HANDLER-003] BEGIN =====
/**
 * Handle diagnostic "peek" read‑only queries without changing sticky mode.
 * Adds "Peek • <Title>" banner and a guidance line, then keeps footer badge.
 * Optionally refreshes TTL once per sticky session.
 */
async function handleDiagnosticPeek(From, text, requestId, stickyAction) {
  const shopId = shopIdFrom(From);
  const lang   = await detectLanguageWithFallback(text, From, requestId);
  const peek   = classifyDiagnosticPeek(text);
  if (!peek) return false;

  // Read current sticky state (do not mutate action)
  let st = null;
  try { st = await getUserStateFromDB(shopId); } catch (_) {}
  const modeBadge = getModeBadge(stickyAction ?? (st?.data?.action ?? null), lang);

  // Track consecutive peeks to nudge if needed
  try {
    const data = { ...(st?.data ?? {}) };
    data.peekCount = Number(data.peekCount ?? 0) + 1;
    // Persist updated peekCount; do not change mode
    await saveUserStateToDB(shopId, st?.mode ?? 'awaitingTransactionDetails', data);        
    // [PATCH: REFRESH_STICKY_TTL_ON_PEEK] Immediately refresh state timestamp (optional keep-alive)
        try { await refreshUserStateTimestamp(shopId); } catch (_) { /* optional */ }
    st = { ...(st ?? {}), data };
  } catch (_) {}

  // Optional one‑time TTL refresh (extend lifespan once)
  try {
    const allowExtend = STICKY_PEEK_TTL_EXTENSION_MS > 0;
    const already = Boolean(st?.data?.peekTTLExtended);
    if (allowExtend && !already) {
      const data = { ...(st?.data ?? {}), peekTTLExtended: true };
      // Bump timestamp by rewriting state (same mode)
      await saveUserStateToDB(shopId, st?.mode ?? 'awaitingTransactionDetails', data);
    }
  } catch (_) {}

  // Compose message based on kind
  let header = '';
  let body   = '';
  if (peek.kind === 'stock') {
    const inv = await getProductInventory(shopId, peek.args.product);
    const qty = Number(inv?.quantity ?? 0);
    const unitDisp = displayUnit(inv?.unit ?? 'pieces', lang);
    const name = inv?.product ?? peek.args.product;
    header = `Peek • Stock — ${name}`;
    body   = `${qty} ${unitDisp}`;
  } else if (peek.kind === 'price') {
    const res = await getProductPrice(peek.args.product, shopId);
    if (res?.success) {
      header = `Peek • Price — ${peek.args.product}`;
      body   = `₹${res.price} per ${res.unit}`;
    } else {
      header = `Peek • Price — ${peek.args.product}`;
      body   = `Not found for your shop`;
    }
  } else if (peek.kind === 'prices') {
    const items = await getAllProducts(shopId);
    header = `Peek • Prices — ${items.length} items`;
    body   = (items.slice(0, 10).map(p => `• ${p.name}: ₹${p.price} / ${p.unit}`)).join('\n') || '—';
  } else if (peek.kind === 'low') {
    const low = await getLowStockProducts(shopId, 5);
    header = `Peek • Low Stock — ${low.length} items`;
    body   = (low.slice(0, 10).map(p => `• ${p.name}: ${p.quantity} ${displayUnit(p.unit, lang)}`)).join('\n') || '—';
  } else if (peek.kind === 'exp') {
    const exp = await getExpiringProducts(shopId, peek.args.days ?? 7, { strictExpired: true });
    header = `Peek • Expiring ≤ ${peek.args.days}d — ${exp.length} items`;
    body   = (exp.slice(0, 10).map(r => {
      const d = r.expiryDate instanceof Date ? r.expiryDate : new Date(r.expiryDate);
      const dd = d.toISOString().split('T')[0];
      return `• ${r.name}: ${r.quantity} (exp ${dd})`;
    }).join('\n')) || '—';
  } else if (peek.kind === 'summary') {
    // Minimal summaries via existing summary helpers — keep it short
    header = peek.args.flavor === 'full' ? 'Peek • Full Summary' : 'Peek • Short Summary';
    try {
      const summary = await processShopSummary?.(shopId, { flavor: peek.args.flavor ?? 'short' });
      body = String(summary ?? '').trim() || '—';
    } catch (_) {
      body = '—';
    }
  }

  // Guidance line keeps user anchored in sticky action  
  // [PATCH C] Mode examples glitch in sticky flow footer — override with latest sticky action immediately
  // Use __lastStickyAction (shopId -> {action, ts}) when present; fallback to current stickyAction or modeBadge.
  const shopKey = shopIdFrom(From); // e.g., "+9190..."
  const override = __lastStickyAction?.get?.(shopKey) || (stickyAction ? { action: stickyAction.action } : null);
  const currentMode = (override?.action || String(modeBadge || '')).toLowerCase();
  // Localized, mode-specific examples shown inline so footer matches user's active flow.  
  // === Localized examples lead-in for all supported languages ===
  const baseLang = String(lang ?? 'en').toLowerCase().replace(/-latn$/, ''); // hi-latn -> hi
  // === Localized examples block      
  let examples = '';
  // Mode display labels (Purchase/Sale/Return) per language
  const M = (function () {
    switch (baseLang) {
      case 'hi': return { p:'खरीद', s:'बिक्री', r:'वापसी' };
     case 'bn': return { p:'ক্রয়', s:'বিক্রি', r:'রিটার্ন' };
      case 'ta': return { p:'கொள்முதல்', s:'விற்பனை', r:'ரிட்டர்ன்' };
      case 'te': return { p:'కొనుగోలు', s:'అమ్మకం', r:'రిటర్న్' };
      case 'kn': return { p:'ಖರೀದಿ', s:'ಮಾರಾಟ', r:'ರಿಟರ್ನ್' };
      case 'mr': return { p:'खरेदी', s:'विक्री', r:'परत' };
      case 'gu': return { p:'ખરીદી', s:'વેચાણ', r:'રિટર્ન' };
      default:   return { p:'Purchase', s:'Sale', r:'Return' };
    }
  })();  
// PLURAL header: “Examples (…)”
  const modeHeader = (function () {
    switch (currentMode) {
      case 'purchased': return baseLang === 'en' ? 'Examples (Purchase):' : (baseLang === 'hi' ? 'उदाहरण (खरीद):' :
        baseLang === 'bn' ? 'উদাহরণ (ক্রয়):' :
        baseLang === 'ta' ? 'உதாரணம் (கொள்முதல்):' :
        baseLang === 'te' ? 'ఉదాహరణ (కొనుగోలు):' :
        baseLang === 'kn' ? 'ಉದಾಹರಣೆ (ಖರೀದಿ):' :
        baseLang === 'mr' ? 'उदाहरण (खरेदी):' :
        baseLang === 'gu' ? 'ઉદાહરણ (ખરીદી):' :           
    'Examples (Purchase):');
      case 'sold': return baseLang === 'en' ? 'Examples (Sale):' : (baseLang === 'hi' ? 'उदाहरण (बिक्री):' :
        baseLang === 'bn' ? 'উদাহরণ (বিক্রি):' :
        baseLang === 'ta' ? 'உதாரணம் (விற்பனை):' :
        baseLang === 'te' ? 'ఉదాహరణ (అమ్మకం):' :
        baseLang === 'kn' ? 'ಉದಾಹರಣೆ (ಮಾರಾಟ):' :
        baseLang === 'mr' ? 'उदाहरण (विक्री):' :
        baseLang === 'gu' ? 'ઉદાહરણ (વેચાણ):' :
        'Example (Sale):');
      case 'returned': return baseLang === 'en' ? 'Example (Return):' : (baseLang === 'hi' ? 'उदाहरण (वापसी):' :
        baseLang === 'bn' ? 'উদাহরণ (রিটার্ন):' :
        baseLang === 'ta' ? 'உதாரணம் (ரிட்டர்ன்):' :
        baseLang === 'te' ? 'ఉదాహరణ (రిటర్న్):' :
        baseLang === 'kn' ? 'ಉದಾಹರಣೆ (ರಿಟರ್ನ್):' :
        baseLang === 'mr' ? 'उदाहरण (परत):' :
        baseLang === 'gu' ? 'ઉદાહરણ (રિટર્ન):' :
        'Example (Return):');
      default: return baseLang === 'en' ? 'Example:' : (baseLang === 'hi' ? 'उदाहरण:' :
        baseLang === 'bn' ? 'উদাহরণ:' :
        baseLang === 'ta' ? 'உதாரணம்:' :
        baseLang === 'te' ? 'ఉదాహరణ:' :
        baseLang === 'kn' ? 'ಉದಾಹರಣೆ:' :
        baseLang === 'mr' ? 'उदाहरणे:' :
        baseLang === 'gu' ? 'ઉદાહરણ:' : 'Example:');
    }
  })();
// “Type or speak (voice note):”
  const speakLine = (function () {
    switch (baseLang) {
      case 'hi': return 'टाइप करें या वॉइस नोट बोलें:';
      case 'bn': return 'টাইপ করুন বা ভয়েস নোট বলুন:';
      case 'ta': return 'தட்டச்சிடவும் அல்லது வொய்ஸ் நோட் பேசவும்:';
      case 'te': return 'టైప్ చేయండి లేదా వాయిస్ నోట్ మాట్లాడండి:';
      case 'kn': return 'ಟೈಪ್ ಮಾಡಿ ಅಥವಾ ವಾಯ್ಸ್ ನೋಟ್ ಮಾತನಾಡಿ:';
      case 'mr': return 'टाइप करा किंवा व्हॉईस नोट बोला:';
      case 'gu': return 'ટાઈપ કરો અથવા વૉઇસ નોટ બોલો:';
      default:   return 'Type or speak (voice note):';
    }
  })();
  
  // Dash bullets (localized items)
  const bullets = (function () {
    switch (baseLang) {
      case 'hi': return [
        '• दूध 10 लीटर @ ₹10/लीटर',
        '• पैरासिटामोल 3 पैकेट @ ₹20/पैकेट एक्सपायरी +7 दिन',
        '• मोबाइल हैंडसेट Xiaomi 1 पैकेट @ ₹60000/पैकेट'
      ];
      case 'bn': return [
        '• দুধ 10 লিটার @ ₹10/লিটার',
        '• প্যারাসিটামল 3 প্যাকেট @ ₹20/প্যাকেট মেয়াদ +7 দিন',
        '• মোবাইল হ্যান্ডসেট Xiaomi 1 প্যাকেট @ ₹60000/প্যাকেট'
      ];
      case 'ta': return [
        '• பால் 10 லிட்டர் @ ₹10/லிட்டர்',
        '• பாராசிடமால் 3 பாக்கெட் @ ₹20/பாக்கெட் காலாவதி +7 நாள்',
        '• மொபைல் ஹேண்ட்செட் Xiaomi 1 பாக்கெட் @ ₹60000/பாக்கெட்'
      ];
      case 'te': return [
        '• పాలు 10 లీటర్ @ ₹10/లీటర్',
        '• ప్యారాసెటమాల్ 3 ప్యాకెట్లు @ ₹20/ప్యాకెట్ గడువు +7 రోజులు',
        '• మొబైల్ హ్యాండ్సెట్ Xiaomi 1 ప్యాకెట్ @ ₹60000/ప్యాకెట్'
      ];
      case 'kn': return [
        '• ಹಾಲು 10 ಲೀಟರ್ @ ₹10/ಲೀಟರ್',
        '• ಪ್ಯಾರಾಸಿಟಮಾಲ್ 3 ಪ್ಯಾಕೆಟ್ @ ₹20/ಪ್ಯಾಕೆಟ್ ಅವಧಿ +7 ದಿನ',
        '• ಮೊಬೈಲ್ ಹ್ಯಾಂಡ್‌ಸೆಟ್ Xiaomi 1 ಪ್ಯಾಕೆಟ್ @ ₹60000/ಪ್ಯಾಕೆಟ್'
      ];
      case 'mr': return [
        '• दूध 10 लिटर @ ₹10/लिटर',
        '• पॅरासिटामॉल 3 पॅकेट @ ₹20/पॅकेट कालबाह्यता +7 दिवस',
        '• मोबाइल हँडसेट Xiaomi 1 पॅकेट @ ₹60000/पॅकेट'
      ];
      case 'gu': return [
        '• દૂધ 10 લિટર @ ₹10/લિટર',
        '• પેરાસિટામોલ 3 પેકેટ @ ₹20/પેકેટ સમયસમાપ્તિ +7 દિવસ',
        '• મોબાઇલ હેન્ડસેટ Xiaomi 1 પેકેટ @ ₹60000/પેકેટ'
      ];
      default: return [
        '• milk 10 litres at ₹10/litre',
        '• paracetamol 3 packets at ₹20/packet expiry +7d',
        '• mobile handset Xiaomi 1 packet at ₹60000/packet'
      ];
    }
  })();
  // Compose examples block lines    
  const examplesLines = [modeHeader, speakLine, ...bullets].join('\n');
  examples = examplesLines;

  const composed = [header, body, '', guidance].filter(Boolean).join('\n');
  const msg = await t(composed, lang, requestId + '::peek');    
  await sendMessageViaAPI(From, await tagWithLocalizedMode(From, msg, lang));
  // Resurface the inventory List-Picker so the user can run the next query immediately.
  await maybeResendListPicker(From, lang, requestId);

  // Nudge if too many consecutive peeks
  try {
    const c = Number(st?.data?.peekCount ?? 0);
    if (ALLOW_READONLY_IN_STICKY && STICKY_PEEK_MAX > 0 && c > STICKY_PEEK_MAX) {
      const nudge = await t(
        'Looks like you’re exploring—type “mode” to switch, or send the transaction line to continue.',
        lang,
        requestId + '::peek-nudge'
      );
      await sendMessageViaAPI(From, await tagWithLocalizedMode(From, nudge, lang));
    }
  } catch (_) {}

  handledRequests?.add?.(requestId); // avoid late apology
  return true;
}
// ===== [PATCH:HYBRID-DIAGNOSTIC-HANDLER-003] END =====

// ---------- Composite Key Normalizer ----------
    // Many logs showed newline-delimited keys. Normalize to a single line with a pipe separator.
    function normalizeCompositeKey(key) {
      if (!key) return key;
      try {
        let k = String(key);
        // collapse CR/LF to '|', collapse multiple spaces, trim
        k = k.replace(/\r?\n+/g, '|').replace(/\s{2,}/g, ' ').trim();
        // very basic shape guard: three parts separated by '|'
        // (shopId|product|iso) – if not, still return sanitized k to avoid throws
        return k;
      } catch (_) {
        return key;
      }
    }

// --- Lightweight text normalizer (lowercase, strip punctuation/extra spaces)
function _normLite(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===== Last-day OR post-expiry paid CTA (lightweight, button-only) =====
// Shows a single-button "Activate Paid Plan" card AFTER each interaction, but throttled.
// It uses existing helpers: getUserPlan/getUserPreference (database.js),
// ensureLangTemplates/getLangSids (contentCache.js) and sendContentTemplate (whatsappButtons).
// (Anchors for these helpers exist in your file and modules)  // keep as comment
const _paidCtaThrottle = new Map(); // shopId -> lastSentMs
const PAID_CTA_THROTTLE_MS = Number(process.env.PAID_CTA_THROTTLE_MS ?? (2 * 60 * 1000)); // 2 minutes throttle
async function maybeShowPaidCTAAfterInteraction(from, langHint = 'en', opts = {}) {
  try {
    const shopId = String(from ?? '').replace('whatsapp:', '');
    // Plan info from Airtable via database.js:getUserPlan        
    const planInfo = await getUserPlanQuick(shopId); // use quick cache helper
    const plan = String(planInfo?.plan ?? '').toLowerCase();
    const trialEnd = getUnifiedEndDate(planInfo);

    const now = Date.now();
    const isPaid = (plan === 'paid');        
    // New guards                
        const hasNoPlan = (!plan || plan === 'none' || plan === 'demo' || plan === 'free_demo' || plan === 'free_demo_first_50');
        const trialActive = (plan === 'trial' && trialEnd && (trialEnd.getTime() > now));                                
        const isTrialActiveLastDay =
              (plan === 'trial' && trialEnd && (new Date(trialEnd).getTime() > now) && (new Date(trialEnd).getTime() - now <= 24 * 60 * 60 * 1000));
        
    // Context: if the current turn had a typed trial intent, suppress CTA
        const trialIntentNow = !!opts?.trialIntentNow;        
    // Suppress CTA for paid users, new/first-time users, or the same turn as trial intent.
        // IMPORTANT: do NOT suppress when it's the last day of an active trial.            
    // --- NEW: strictly gate to final trial day only; suppress for all other cases ---
        if (trialIntentNow) return;
        if (!isTrialActiveLastDay) return;

    // Gentle throttle so we don't overwhelm
    const last = _paidCtaThrottle.get(shopId) ?? 0;
    if (now - last < PAID_CTA_THROTTLE_MS) return;
    // Resolve language from preference
    let lang = String(langHint ?? 'en').toLowerCase();
    try {
      const pref = await getUserPreference(shopId);
      if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
    } catch (_) {}
    // Ensure content bundle and pick Paid CTA ContentSid        
    await ensureLangTemplates(lang);
        // Small delay so CTA appears after the main reply
        await new Promise(r => setTimeout(r, 250));
        await sendPaidPlanCTA(from, lang);
        _paidCtaThrottle.set(shopId, now);
        // Stamp LastTrialReminder (optional analytics)
        try {
          const prefRow = await getUserPreference(shopId);
          if (prefRow?.id) await setTrialReminderSent(prefRow.id);
        } catch (_) {}
  } catch (e) {
    console.warn('[paid-cta] skip:', e?.message);
  }
}
 
// Map button taps / list selections to your existing quick-query router
// === ACTIVATION: typed "start trial" unified flow ============================
// --- [NEW HELPERS & FLOW: begin capture BEFORE activation] ---------------------------
function _isSkipGST(s) {
  const t = String(s ?? '').trim().toLowerCase();
  return ['skip','na','n/a','not available','none','no gst','no'].includes(t);
}

async function beginTrialOnboarding(From, lang = 'en') {
  const shopId = shopIdFrom(From);
  // ✅ Always store by shopId (without "whatsapp:") to match DB readers
  await setUserState(shopId, 'onboarding_trial_capture', { step: 'name', collected: {}, lang });
  try { await saveUserPreference(shopId, lang); } catch {}
  const NO_FOOTER_MARKER = '<!NO_FOOTER!>';
  const askName = await t(NO_FOOTER_MARKER + 'Please share your *Shop Name*.', lang, `trial-onboard-name-${shopId}`);
  await sendMessageViaAPI(From, askName);
}

async function handleTrialOnboardingStep(From, text, lang = 'en', requestId = null) {
  const shopId = String(From).replace('whatsapp:', '');
  // ✅ Read by the same key we used to write
  const state = await getUserStateFromDB(shopId);  
  if (!state || state.mode !== 'onboarding_trial_capture') return false;
     
    const data = state.data?.collected ?? {};
     const step = state.data?.step ?? 'name';
     // Use the canonical markers (already defined globally in your module)
     const NO_FOOTER_MARKER = '<!NO_FOOTER!>';
     const NO_CLAMP_MARKER  = '<!NO_CLAMP!>';
    
     // NEW: pin language for this turn so code-like inputs (GSTIN) don't flip to en
     try {
       const pref = await getUserPreference(shopId).catch(() => ({ language: lang }));
       const currentLang = String(pref?.language ?? lang ?? 'en').toLowerCase();
       lang = await checkAndUpdateLanguageSafe(String(text ?? ''), From, currentLang, `trial-onboard-${shopId}`);
     } catch (_) { /* keep incoming lang */ }
  if (step === 'name') {
    data.name = String(text ?? '').trim();
    await setUserState(shopId, 'onboarding_trial_capture', { step: 'gstin', collected: data, lang });   
    // NEW: add NO_CLAMP to preserve Latin tokens (GSTIN/NA) in Hindi output
       const askGstin = await t(
         NO_CLAMP_MARKER + NO_FOOTER_MARKER +
         'Enter your *GSTIN* (type "*NA*" or *skip* if not available).',
         lang,
         `trial-onboard-gstin-${shopId}`
       );
    await sendMessageViaAPI(From, finalizeForSend(askGstin, lang));
      try { if (requestId) handledRequests.add(requestId); } catch {}
    return true;
  }
  if (step === 'gstin') {
    const raw = String(text ?? '').trim();
    data.gstin = _isSkipGST(raw) ? null : raw;
    await setUserState(shopId, 'onboarding_trial_capture', { step: 'address', collected: data, lang });
    // NEW: add NO_CLAMP to preserve "Address" and any Latin/ASCII parts user may reply with
       const askAddr = await t(
         NO_CLAMP_MARKER + NO_FOOTER_MARKER + 'Please share your *Shop Address* (area, city).',
         lang,
         `trial-onboard-address-${shopId}`
       );
    await sendMessageViaAPI(From, finalizeForSend(askAddr, lang));
      try { if (requestId) handledRequests.add(requestId); } catch {}
    return true;
  }
  if (step === 'address') {
    data.address = String(text ?? '').trim();        
    // -----------------------------------------------------------------------
        // Persist details BEFORE activation (guarded: do not throw if helper missing)
        // -----------------------------------------------------------------------
        if (typeof upsertAuthUserDetails === 'function') {
          try {
            await upsertAuthUserDetails(shopId, {
              name: data.name,
              gstin: data.gstin,
              address: data.address,
              phone: shopId
            });
          } catch (e) {
            console.warn('[trial-onboard] upsertAuthUserDetails failed:', e?.message);
          }
        } else {
          console.warn('[trial-onboard] upsertAuthUserDetails is not defined — skipping');
        }
    
        // -----------------------------------------------------------------------
        // Start trial now (guarded): proceed even if helper is unavailable
        // -----------------------------------------------------------------------
        if (typeof startTrialForAuthUser === 'function') {
          try {
            await startTrialForAuthUser(shopId, TRIAL_DAYS, {
              name: data.name, gstin: data.gstin, address: data.address, phone: shopId
            });
          } catch (e) {
            console.warn('[trial-onboard] startTrialForAuthUser failed:', e?.message);
          }
        } else {
          console.warn('[trial-onboard] startTrialForAuthUser is not defined — skipping');
        }
       
    // ✅ Clear by shopId (safe no-op if your delete uses record id; otherwise add a DB helper to delete by key)
    try { await clearUserState(shopId); } catch {}            
    // -----------------------------------------------------------------------
        // Send activation message WITHOUT clamp & WITHOUT footer to avoid truncation
        // -----------------------------------------------------------------------
        
        let msgRaw = `${NO_CLAMP_MARKER}${NO_FOOTER_MARKER}🎉 Trial activated for ${TRIAL_DAYS} days!\n\n` +
                     `Try (type or speak a voice note):"Mode" -> \n• "short summary"\n• "price list"\n• "Record Purchase"\n• "Record Sale"\n• "Record Return"`;               
        let msgTranslated = await t(msgRaw, lang, `trial-onboard-done-${shopId}`);              
        await sendMessageViaAPI(From, finalizeForSend(msgTranslated, lang));            
        // NEW: Standalone inventory pre-load tip (post-activation)
        // Sends a brief line without footer; localized via t(), digits normalized via finalizeForSend().
        try {
          const preloadEn =
            `To pre-load your existing inventory directly into the backend, WhatsApp the Saamagrii.AI support team: ${SUPPORT_WHATSAPP_LINK}`;
          // Use canonical markers to keep this message standalone (no footer/mode badge).
          const preloadSrc = NO_FOOTER_MARKER + preloadEn;
          let preloadMsg = await t(preloadSrc, lang, `trial-preload-info-${shopId}`);
          await sendMessageViaAPI(From, finalizeForSend(preloadMsg, lang));
        } catch (e) {
          console.warn('[trial-onboard] preload info send failed:', e?.message);
        }
      try { if (requestId) handledRequests.add(requestId); } catch {}
    try {
      await ensureLangTemplates(lang);
      const sids = getLangSids(lang);
      if (sids?.quickReplySid) await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.quickReplySid });
      if (sids?.listPickerSid) await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.listPickerSid });
    } catch (e) {
      console.warn('[trial-onboard] menu orchestration failed', e?.response?.status, e?.response?.data);
    }
    try { (globalThis._recentActivations = globalThis._recentActivations ?? new Map()).set(shopId, Date.now()); } catch {}
    return true;
  }
  return false;
}

// === Paid onboarding (collect details after payment) ===
async function beginPaidOnboarding(From, lang = 'en') {
  const shopId = shopIdFrom(From);
  await setUserState(shopId, 'onboarding_paid_capture', { step: 'name', collected: {}, lang });
  try { await saveUserPreference(shopId, lang); } catch {}
  const askName = await t(NO_FOOTER_MARKER + 'Please share your *Shop Name*.', lang, `paid-onboard-name-${shopId}`);
  await sendMessageViaAPI(From, askName);
}

async function handlePaidOnboardingStep(From, text, lang = 'en', requestId = null) {
  const shopId = String(From).replace('whatsapp:', '');
  const state = await getUserStateFromDB(shopId);
  if (!state || state.mode !== 'onboarding_paid_capture') return false;
  
  // Per-request idempotency to avoid double prompts when orchestrator re-enters
  const __guardKey = `${shopId}::${String(requestId ?? Date.now())}`;
  if (globalThis.__onboardStepGuard?.has?.(__guardKey)) {
    console.log('[onboard-capture] suppressed duplicate step', { guardKey: __guardKey });
    return true;
  }
  try {
    globalThis.__onboardStepGuard = globalThis.__onboardStepGuard || new Set();
    globalThis.__onboardStepGuard.add(__guardKey);
    setTimeout(() => { try { globalThis.__onboardStepGuard.delete(__guardKey); } catch (_) {} }, 15000);
  } catch (_) {}

  const data = state.data?.collected ?? {};
  const step = state.data?.step ?? 'name';

  // Keep language stable for code-like inputs (GSTIN)
  try {
    const pref = await getUserPreference(shopId).catch(() => ({ language: lang }));
    const currentLang = String(pref?.language ?? lang ?? 'en').toLowerCase();
    lang = await checkAndUpdateLanguageSafe(String(text ?? ''), From, currentLang, `paid-onboard-${shopId}`);
  } catch (_) {}

  if (step === 'name') {        
    const name = String(text ?? '').trim();
        if (!name) {
          const retryName = await t(
            NO_CLAMP_MARKER + NO_FOOTER_MARKER + 'Shop name seems empty—please re-enter your *Shop Name*.',
            lang, `paid-onboard-name-retry-${shopId}`
          );
          await sendMessageViaAPI(From, finalizeForSend(retryName, lang));
          try { if (requestId) handledRequests.add(requestId); } catch {}
          return true;
        }
        data.name = name;

    await setUserState(shopId, 'onboarding_paid_capture', { step: 'gstin', collected: data, lang });
    const askGstin = await t(
      NO_CLAMP_MARKER + NO_FOOTER_MARKER + 'Enter your *GSTIN* (type "*NA*" or *skip* if not available).',
      lang, `paid-onboard-gstin-${shopId}`
    );
    await sendMessageViaAPI(From, finalizeForSend(askGstin, lang));
    try { if (requestId) handledRequests.add(requestId); } catch {}
    return true;
  }

  if (step === 'gstin') {
    const raw = String(text ?? '').trim();        
    const isSkip = _isSkipGST(raw);
        const GSTIN_RX = /^[0-9A-Z]{15}$/i;
        if (!isSkip && !GSTIN_RX.test(raw)) {
          const retryGstin = await t(
            NO_CLAMP_MARKER + NO_FOOTER_MARKER + 'GSTIN seems invalid—please re-enter 15 characters or type *skip*.',
            lang, `paid-onboard-gstin-retry-${shopId}`
          );
          await sendMessageViaAPI(From, finalizeForSend(retryGstin, lang));
          try { if (requestId) handledRequests.add(requestId); } catch {}
          return true;
        }
        data.gstin = isSkip ? null : raw.toUpperCase();
        await setUserState(shopId, 'onboarding_paid_capture', { step: 'address', collected: data, lang });
        const askAddr = await t(
          NO_CLAMP_MARKER + NO_FOOTER_MARKER + 'Please share your *Shop Address* (area, city).',
          lang, `paid-onboard-address-${shopId}`
        );
        await sendMessageViaAPI(From, finalizeForSend(askAddr, lang));
        try { if (requestId) handledRequests.add(requestId); } catch {}
        return true;
  }

  if (step === 'address') {
    data.address = String(text ?? '').trim();

    // Save details
    try { await upsertAuthUserDetails(shopId, { name: data.name, gstin: data.gstin, address: data.address, phone: shopId }); }
    catch (e) { console.warn('[paid-onboard] upsertAuthUserDetails failed:', e?.message); }

    // Mark paid (prefer markAuthUserPaid; fallback saveUserPlan)
    try { await markAuthUserPaid(shopId); }
    catch (e) { console.warn('[paid-onboard] markAuthUserPaid failed:', e?.message); try { await saveUserPlan(shopId, 'paid'); } catch {} }

    try { await clearUserState(shopId); } catch {}

    let msg0 = await t(NO_CLAMP_MARKER + NO_FOOTER_MARKER + '✅ Paid Plan activated. Thank you! Your details are saved.', lang, `paid-onboard-done-${shopId}`);
    await sendMessageViaAPI(From, finalizeForSend(msg0, lang));

    // Normal paid confirmation + menus
    try { await sendWhatsAppPaidConfirmation(From); } catch {}
    try {
      await ensureLangTemplates(lang);
      const sids = getLangSids(lang);
      if (sids?.quickReplySid) await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.quickReplySid });
      if (sids?.listPickerSid) await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.listPickerSid });
    } catch (e) { console.warn('[paid-onboard] menu orchestration failed', e?.response?.status, e?.response?.data); }

    try { if (requestId) handledRequests.add(requestId); } catch {}
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// (Optional) Defensive shims: never throw if helpers are absent during rollout
// ---------------------------------------------------------------------------
if (typeof globalThis.upsertAuthUserDetails !== 'function') {
  globalThis.upsertAuthUserDetails = async () => ({ success: false });
}
if (typeof globalThis.startTrialForAuthUser !== 'function') {
  globalThis.startTrialForAuthUser = async () => ({ success: false });
}

// --- typed path now begins capture (no immediate activation)
async function activateTrialFlow(From, lang = 'en') {
  const shopId = shopIdFrom(From);
  try {
    const planInfo = await getUserPlan(shopId);
    const plan = String(planInfo?.plan ?? '').toLowerCase();
    const end = planInfo?.trialEndDate ?? planInfo?.trialEnd ?? null;
    const active = (plan === 'paid') || (plan === 'trial' && end && new Date(end).getTime() > Date.now());
    if (active) {
      const msg = await t('✅ You already have access.', lang, `cta-trial-already-${shopId}`);
      await sendMessageViaAPI(From, msg);
      return { success: true, already: true };
    }
  } catch { /* continue */ }    
  if (CAPTURE_SHOP_DETAILS_ON === 'paid') {
      // Activate trial immediately (no capture)
      try { await startTrialForAuthUser(shopId, TRIAL_DAYS); } catch (_) {}
      const msgRaw = `${NO_CLAMP_MARKER}${NO_FOOTER_MARKER}🎉 Trial activated for ${TRIAL_DAYS} days!\n\n` +
                     `Try:\n• short summary\n• price list\n• "10 Parle-G sold at 11/packet"`;
      let msgTranslated = await t(msgRaw, lang, `trial-activated-${shopId}`);
      await sendMessageViaAPI(From, finalizeForSend(msgTranslated, lang));
      try { (globalThis._recentActivations = globalThis._recentActivations ?? new Map()).set(shopId, Date.now()); } catch {}
      try {
        await ensureLangTemplates(lang);
        const sids = getLangSids(lang);
        if (sids?.quickReplySid) await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.quickReplySid });
        if (sids?.listPickerSid) await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.listPickerSid });
      } catch (_) {}
      return { success: true, activatedTrial: true };
    }
    // legacy: capture on trial if toggle != 'paid'
    await beginTrialOnboarding(From, lang);
    return { success: true, startedCapture: true };
}

// Map button taps / list selections to your existing quick‑query router
// Robust to multiple Twilio payload shapes + safe fallback
async function handleInteractiveSelection(req) {
// Global, minimal grace-cache to avoid stale plan reads immediately after trial activation
const _recentActivations = (globalThis._recentActivations = globalThis._recentActivations || new Map()); // shopId -> ts(ms)
const RECENT_ACTIVATION_MS = 15000; // 15 seconds grace

  const raw = req.body || {};      
  // Normalize "From" to the WhatsApp-prefixed format used by downstream readers
    const rawFrom =
    raw.From ?? raw.from ??
    (raw.WaId ? `whatsapp:${raw.WaId}` : null);
    const from = rawFrom && String(rawFrom).startsWith('whatsapp:')
       ? String(rawFrom)
       : `whatsapp:${String(rawFrom ?? '').replace(/^whatsapp:/, '')}`;
    const shopIdTop = shopIdFrom(from);    
  
    // Detect inventory list selections (e.g., "list_low", "list_sales_day").
      const _payloadId = String(
        raw.Body ?? raw.ListId ?? raw.EventId ?? raw.ContentSid ?? ''
      ).toLowerCase();  
    // === Intercept QR taps (purchase/sale/return) and send localized examples ===
          try {
            // Resolve UI language from preference; fall back to 'en'
            let langUi = 'en';
            try {
              const pref = await getUserPreference(shopIdTop);
              if (pref?.success && pref.language) langUi = String(pref.language).toLowerCase();
            } catch (_) {}
            langUi = langUi.replace(/-latn$/, ''); // e.g., hi-latn -> hi
    
            const isPurchase = _payloadId === 'qr_purchase';
            const isSale     = _payloadId === 'qr_sale';
            const isReturn   = _payloadId === 'qr_return';
            if (isPurchase || isSale || isReturn) {
              // Localized header: Example (Purchase|Sale|Return)
              const header = (function () {
                switch (langUi) {
                  case 'hi': return isPurchase ? 'उदाहरण (खरीद):' : isSale ? 'उदाहरण (बिक्री):' : 'उदाहरण (वापसी):';
                  case 'bn': return isPurchase ? 'উদাহরণ (ক্রয়):'   : isSale ? 'উদাহরণ (বিক্রি):' : 'উদাহরণ (রিটার্ন):';
                  case 'ta': return isPurchase ? 'உதாரணம் (கொள்முதல்):' : isSale ? 'உதாரணம் (விற்பனை):' : 'உதாரணம் (ரிட்டர்ன்):';
                  case 'te': return isPurchase ? 'ఉదాహరణ (కొనుగోలు):'  : isSale ? 'ఉదాహరణ (అమ్మకం):'  : 'ఉదాహరణ (రిటర్న్):';
                  case 'kn': return isPurchase ? 'ಉದಾಹರಣೆ (ಖರೀದಿ):'    : isSale ? 'ಉದಾಹರಣೆ (ಮಾರಾಟ):'  : 'ಉದಾಹರಣೆ (ರಿಟರ್ನ್):';
                  case 'mr': return isPurchase ? 'उदाहरण (खरेदी):'      : isSale ? 'उदाहरण (विक्री):'    : 'उदाहरण (परत):';
                  case 'gu': return isPurchase ? 'ઉદાહરણ (ખરીદી):'      : isSale ? 'ઉદાહરણ (વેચાણ):'     : 'ઉદાહરણ (રિટર્ન):';
                  default:   return isPurchase ? 'Example (Purchase):'    : isSale ? 'Example (Sale):'       : 'Example (Return):';
                }
              })();
                          
            // “Type or speak (voice note):” line (localized) — shown before the bullets
                  const speakLine =
                    langUi === 'hi' ? 'टाइप करें या वॉइस नोट बोलें:' :
                    langUi === 'bn' ? 'টাইপ করুন বা ভয়েস নোট বলুন:' :
                    langUi === 'ta' ? 'தட்டச்சிடவும் அல்லது வொய்ஸ் நோட் பேசவும்:' :
                    langUi === 'te' ? 'టైప్ చేయండి లేదా వాయిస్ నోట్ మాట్లాడండి:' :
                    langUi === 'kn' ? 'ಟೈಪ್ ಮಾಡಿ ಅಥವಾ ವಾಯ್ಸ್ ನೋಟ್ ಮಾತನಾಡಿ:' :
                    langUi === 'mr' ? 'टाइप करा किंवा व्हॉईस नोट बोला:' :
                    langUi === 'gu' ? 'ટાઈપ કરો અથવા વૉઇસ નોટ બોલો:' :
                    'Type or speak (voice note):';

              // Localized item examples (bullets)
              const bullets = (function () {
                switch (langUi) {
                  case 'hi': return [
                    '• दूध 10 लीटर @ ₹10/लीटर',
                    '• पैरासिटामोल 3 पैकेट @ ₹20/पैकेट एक्सपायरी +7 दिन',
                    '• मोबाइल हैंडसेट Xiaomi 1 पैकेट @ ₹60000/पैकेट'
                  ];
                  case 'bn': return [
                    '• দুধ 10 লিটার @ ₹10/লিটার',
                    '• প্যারাসিটামল 3 প্যাকেট @ ₹20/প্যাকেট মেয়াদ +7 দিন',
                    '• মোবাইল হ্যান্ডসেট Xiaomi 1 প্যাকেট @ ₹60000/প্যাকেট'
                  ];
                  case 'ta': return [
                    '• பால் 10 லிட்டர் @ ₹10/லிட்டர்',
                    '• பாராசிடமால் 3 பாக்கெட் @ ₹20/பாக்கெட் காலாவதி +7 நாள்',
                    '• மொபைல் ஹேண்ட்செட் Xiaomi 1 பாக்கெட் @ ₹60000/பாக்கெட்'
                  ];
                  case 'te': return [
                    '• పాలు 10 లీటర్ @ ₹10/లీటర్',
                    '• ప్యారాసెటమాల్ 3 ప్యాకెట్లు @ ₹20/ప్యాకెట్ గడువు +7 రోజులు',
                    '• మొబైల్ హ్యాండ్సెట్ Xiaomi 1 ప్యాకెట్ @ ₹60000/ప్యాకెట్'
                  ];
                  case 'kn': return [
                    '• ಹಾಲು 10 ಲೀಟರ್ @ ₹10/ಲೀಟರ್',
                    '• ಪ್ಯಾರಾಸಿಟಮಾಲ್ 3 ಪ್ಯಾಕೆಟ್ @ ₹20/ಪ್ಯಾಕೆಟ್ ಅವಧಿ +7 ದಿನ',
                    '• ಮೊಬೈಲ್ ಹ್ಯಾಂಡ್‌ಸೆಟ್ Xiaomi 1 ಪ್ಯಾಕೆಟ್ @ ₹60000/ಪ್ಯಾಕೆಟ್'
                  ];
                  case 'mr': return [
                    '• दूध 10 लिटर @ ₹10/लिटर',
                    '• पॅरासिटामॉल 3 पॅकेट @ ₹20/पॅकेट कालबाह्यता +7 दिवस',
                    '• मोबाइल हँडसेट Xiaomi 1 पॅकेट @ ₹60000/पॅकेट'
                  ];
                  case 'gu': return [
                    '• દૂધ 10 લિટર @ ₹10/લિટર',
                    '• પેરાસિટામોલ 3 પેકેટ @ ₹20/પેકેટ સમયસમાપ્તિ +7 દિવસ',
                    '• મોબાઇલ હેન્ડસેટ Xiaomi 1 પેકેટ @ ₹60000/પેકેટ'
                  ];
                  default: return [
                    '• milk 10 litres at ₹10/litre',
                    '• paracetamol 3 packets at ₹20/packet expiry +7d',
                    '• mobile handset Xiaomi 1 packet at ₹60000/packet'
                  ];
                }
              })();
       
              const bodyExamples = [header, speakLine, ...bullets].join('\n');
              const reqId = String(req?.headers?.['x-request-id'] ?? Date.now());
              const msg0 = await t(bodyExamples, langUi, `${reqId}::qr-examples`);
              let msgFinal = await tagWithLocalizedMode(from, msg0, langUi);
              msgFinal = enforceSingleScriptSafe(msgFinal, langUi);
              msgFinal = normalizeNumeralsToLatin(msgFinal).trim();
              await sendMessageViaAPI(from, msgFinal);
              return; // consumed: prevent legacy "Examples (purchase)" path
            }
          } catch (_) { /* best-effort; fall through to existing logic */ }
  
      const _isInventoryListSelection = /^list_/.test(_payloadId);
    
      // Fire-and-forget: resurface List-Picker AFTER the main reply, regardless of early returns.
      // Tiny delay so the buttons appear immediately after the text reply in WA clients.
      try {
        if (_isInventoryListSelection) {
          setTimeout(async () => {
            try {
              const langHint = await getPreferredLangQuick(from, 'en');
              await maybeResendListPicker(from, langHint, raw.requestId ?? 'interactive');
            } catch (_) { /* noop */ }
          }, 350);
        }
      } catch (_) { /* noop */ }
     
    // STEP 12: 3s duplicate‑tap guard (per shop + payload)
    const _recentTaps = (globalThis._recentTaps ||= new Map()); // shopId -> { payload, at }
    function _isDuplicateTap(shopId, payload, windowMs = 3000) {
      const prev = _recentTaps.get(shopId);
      const now = Date.now();
      if (prev && prev.payload === payload && (now - prev.at) < windowMs) return true;
      _recentTaps.set(shopId, { payload, at: now });
      return false;
    }

  // Quick‑Reply payloads (Twilio replies / Content API postbacks)
  let payload = String(
    raw.ButtonPayload ||
    raw.ButtonId ||
    raw.PostbackData ||
    ''
  );
   
  // Duplicate‑tap short‑circuit
    try {
      if (payload && _isDuplicateTap(shopIdTop, payload)) return true;
    } catch (_) {} 

   
  // STEP 13: Summary buttons → route directly
    if (payload === 'instant_summary' || payload === 'full_summary') {
      let btnLang = 'en';
      try {
        const prefLP = await getUserPreference(shopIdTop);
        if (prefLP?.success && prefLP.language) btnLang = String(prefLP.language).toLowerCase();
      } catch (_) {}
      const cmd = (payload === 'instant_summary') ? 'short summary' : 'full summary';
      await handleQuickQueryEN(cmd, from, btnLang, 'btn');            
      // NEW: also generate Inventory Short Summary PDF for 'short summary' button                   
          if (cmd === 'short summary') {
                try {
                  const pdfPath = await generateInventoryShortSummaryPDF(shopIdTop);
                  // Optional safety check (mirrors your invoice flow):
                  if (!fs.existsSync(pdfPath)) throw new Error(`Generated PDF not found: ${pdfPath}`);
                  const msg = await sendPDFViaWhatsApp(from, pdfPath);
                  console.log(`[interactive] Inventory summary PDF sent. SID: ${msg?.sid}`);
                } catch (e) {
                  console.warn('[interactive] inventory PDF send failed', e?.message);
                }
              }
      return true;
    }

  // List‑Picker selections across possible fields/shapes
  const lr = (raw.ListResponse || raw.List || raw.Interactive || {});
  const lrId = (lr.Id || lr.id || lr.ListItemId || lr.SelectedItemId)
            || raw.ListId || raw.ListPickerSelection || raw.SelectedListItem
            || raw.ListReplyId || raw.PostbackData || '';
  let listId = String(lrId || '');
  // Text fallbacks (rare deliveries echoing IDs in Body)
  const text = String(raw.ButtonText || raw.Body || '');
  if (!listId && /^list_/.test(text)) listId = text.trim();
  // Debug snapshot to verify what we received in prod logs
  try {
    console.log(`[interact] payload=${payload || '—'} listId=${listId || '—'} body=${text || '—'}`);
  } catch (_) {}
    
  // --- 4B: Map localized ButtonText -> canonical payload IDs (EN + HI)
    // Covers cases where Twilio doesn't send ButtonPayload but only ButtonText.         
    // Helper: normalize any escaped/mangled newlines from translations/templates
      function fixNewlines(str) {
        if (!str) return str;
        // Convert typical escape sequences back to real newlines; also trim weird artifacts.
        return String(str).replace(/\\n/g, '\n').replace(/\r/g, '').replace(/[ \t]*\.\?\\n/g, '\n');
      }
         
    // --- NEW: send examples with a localized "Processing your message…" ack + single footer tag
      async function sendExamplesWithAck(from, lang, examplesText, requestId = 'examples') {
        try {
          // Tag examples with the localized footer exactly once          
        let tagged = await tagWithLocalizedMode(from, fixNewlines(examplesText), lang);
            // LOCAL CLAMP → Single script; numerals normalization
            tagged = enforceSingleScriptSafe(tagged, lang);
            tagged = normalizeNumeralsToLatin(tagged).trim();
            await sendMessageViaAPI(from, tagged);
        } catch (e) {
          // Fallback: still send examples if tagging fails              
        let ex = fixNewlines(examplesText);
            ex = enforceSingleScriptSafe(ex, lang);
            ex = normalizeNumeralsToLatin(ex).trim();
            await sendMessageViaAPI(from, ex);
        }
      }
    
    if (!payload && text) {
      const BTN_TEXT_MAP = [
        // Onboarding buttons
        { rx: /^ट्रायल\s+शुरू\s+करें$/i, payload: 'activate_trial' },
        { rx: /^ट्रायल$/i,               payload: 'activate_trial' },
        { rx: /^डेमो(?:\s+देखें)?$/i,    payload: 'show_demo' },
        { rx: /^(मदद|सहायता)$/i,         payload: 'show_help' },
        // Transaction quick-reply buttons
        { rx: /^खरीद\s+दर्ज\s+करें$/i,   payload: 'qr_purchase' },
        { rx: /^बिक्री\s+दर्ज\s+करें$/i,  payload: 'qr_sale' },
        { rx: /^रिटर्न\s+दर्ज\s+करें$/i,  payload: 'qr_return' },
      ];
      const hit = BTN_TEXT_MAP.find(m => m.rx.test(text));
      if (hit) payload = hit.payload;
    }
  
    // Shared: shopId + language + activation gate
    const shopId = String(from).replace('whatsapp:', '');
    let lang = 'en';
    try {
      const prefLP = await getUserPreference(shopId);
      if (prefLP?.success && prefLP.language) lang = String(prefLP.language).toLowerCase();
    } catch (_) {}
         
    // Optional helper: boolean activation check if available (preferred over raw plan reads)
      async function _isActivated(shopIdNum) {
        try { if (typeof isUserActivated === 'function') return !!(await isUserActivated(shopIdNum)); } catch (_) {}
        return null; // let planInfo logic decide
      }
            
    // Helpers (local to this handler):
      function isPlanActive(planInfo) {
        const plan = String(planInfo?.plan ?? '').toLowerCase();
        const end = planInfo?.trialEnd ?? planInfo?.endDate ?? null;
        const isExpired = (() => {
          if (!end) return true;
          const d = new Date(end);
          return Number.isNaN(d.getTime()) ? true : (d.getTime() < Date.now());
        })();
        return plan === 'paid' || (plan === 'trial' && !isExpired);
      }
      
    function getStickyExamplesLocalized(action, langCode) {
      const baseLang = String(langCode || 'en').toLowerCase().replace(/-latn$/, ''); // map hi-latn -> hi
      const act = String(action || '').toLowerCase(); // 'purchased' | 'sold' | 'returned'
      // Header per action (retain Purchase/Sale/Return)
      const H = {
        en: { p:'Example (Purchase):', s:'Example (Sale):',    r:'Example (Return):',  n:'Example:' },
        hi: { p:'उदाहरण (खरीद):',      s:'उदाहरण (बिक्री):',   r:'उदाहरण (वापसी):',   n:'उदाहरण:' },
        bn: { p:'উদাহরণ (ক্রয়):',       s:'উদাহরণ (বিক্রি):',    r:'উদাহরণ (রিটার্ন):',  n:'উদাহরণ:' },
        ta: { p:'உதாரணம் (கொள்முதல்):', s:'உதாரணம் (விற்பனை):', r:'உதாரணம் (ரிட்டர்ன்):', n:'உதாரணம்:' },
        te: { p:'ఉదాహరణ (కొనుగోలు):',  s:'ఉదాహరణ (అమ్మకం):',   r:'ఉదాహరణ (రిటర్న్):',   n:'ఉదాహరణ:' },
        kn: { p:'ಉದಾಹರಣೆ (ಖರೀದಿ):',     s:'ಉದಾಹರಣೆ (ಮಾರಾಟ):',   r:'ಉದಾಹರಣೆ (ರಿಟರ್ನ್):',  n:'ಉದಾಹರಣೆ:' },
        mr: { p:'उदाहरण (खरेदी):',      s:'उदाहरण (विक्री):',    r:'उदाहरण (परत):',      n:'उदाहरणे:' },
        gu: { p:'ઉદાહરણ (ખરીદી):',      s:'ઉદાહરણ (વેચાણ):',     r:'ઉદાહરણ (રિટર્ન):',    n:'ઉદાહરણ:' }
      };
      
      const headerMap = H[baseLang] || H.en;
        const header = act === 'purchased' ? headerMap.p : act === 'sold' ? headerMap.s : act === 'returned' ? headerMap.r : headerMap.n;
        // “Type or speak (voice note):”
        const speakLine =
          baseLang === 'hi' ? 'टाइप करें या वॉइस नोट बोलें:' :
          baseLang === 'bn' ? 'টাইপ করুন বা ভয়েস নোট বলুন:' :
          baseLang === 'ta' ? 'தட்டச்சிடவும் அல்லது வொய்ஸ் நோட் பேசவும்:' :
          baseLang === 'te' ? 'టైప్ చేయండి లేదా వాయిస్ నోట్ మాట్లాడండి:' :
          baseLang === 'kn' ? 'ಟೈಪ್ ಮಾಡಿ ಅಥವಾ ವಾಯ್ಸ್ ನೋಟ್ ಮಾತನಾಡಿ:' :
          baseLang === 'mr' ? 'टाइप करा किंवा व्हॉईस नोट बोला:' :
          baseLang === 'gu' ? 'ટાઈપ કરો અથવા વૉઇસ નોટ બોલો:' :
          'Type or speak (voice note):';
       
      // Localized item examples (keep brands/units consistent; use ₹ and native expiry words)
      const bullets =
        baseLang === 'hi' ? [
          '• दूध 10 लीटर @ ₹10/लीटर',
          '• पैरासिटामोल 3 पैकेट @ ₹20/पैकेट एक्सपायरी +7 दिन',
          '• मोबाइल हैंडसेट Xiaomi 1 पैकेट @ ₹60000/पैकेट'
        ] :
        baseLang === 'bn' ? [
          '• দুধ 10 লিটার @ ₹10/লিটার',
          '• প্যারাসিটামল 3 প্যাকেট @ ₹20/প্যাকেট মেয়াদ +7 দিন',
          '• মোবাইল হ্যান্ডসেট Xiaomi 1 প্যাকেট @ ₹60000/প্যাকেট'
        ] :
        baseLang === 'ta' ? [
          '• பால் 10 லிட்டர் @ ₹10/லிட்டர்',
          '• பாராசிடமால் 3 பாக்கெட் @ ₹20/பாக்கெட் காலாவதி +7 நாள்',
          '• மொபைல் ஹேண்ட்செட் Xiaomi 1 பாக்கெட் @ ₹60000/பாக்கெட்'
        ] :
        baseLang === 'te' ? [
          '• పాలు 10 లీటర్ @ ₹10/లీటర్',
          '• ప్యారాసెటమాల్ 3 ప్యాకెట్లు @ ₹20/ప్యాకెట్ గడువు +7 రోజులు',
          '• మొబైల్ హ్యాండ్సెట్ Xiaomi 1 ప్యాకెట్ @ ₹60000/ప్యాకెట్'
        ] :
        baseLang === 'kn' ? [
          '• ಹಾಲು 10 ಲೀಟರ್ @ ₹10/ಲೀಟರ್',
          '• ಪ್ಯಾರಾಸಿಟಮಾಲ್ 3 ಪ್ಯಾಕೆಟ್ @ ₹20/ಪ್ಯಾಕೆಟ್ ಅವಧಿ +7 ದಿನ',
          '• ಮೊಬೈಲ್ ಹ್ಯಾಂಡ್‌ಸೆಟ್ Xiaomi 1 ಪ್ಯಾಕೆಟ್ @ ₹60000/ಪ್ಯಾಕೆಟ್'
        ] :
        baseLang === 'mr' ? [
          '• दूध 10 लिटर @ ₹10/लिटर',
          '• पॅरासिटामॉल 3 पॅकेट @ ₹20/पॅकेट कालबाह्यता +7 दिवस',
          '• मोबाइल हँडसेट Xiaomi 1 पॅकेट @ ₹60000/पॅकेट'
        ] :
        baseLang === 'gu' ? [
          '• દૂધ 10 લિટર @ ₹10/લિટર',
          '• પેરાસિટામોલ 3 પેકેટ @ ₹20/પેકેટ સમયસમાપ્તિ +7 દિવસ',
          '• મોબાઇલ હેન્ડસેટ Xiaomi 1 પેકેટ @ ₹60000/પેકેટ'
        ] :
        [
          '• milk 10 litres at ₹10/litre',
          '• paracetamol 3 packets at ₹20/packet expiry +7d',
          '• mobile handset Xiaomi 1 packet at ₹60000/packet'
        ];   
      
    // Compose final block (header + speakLine + bullets)
    return [header, speakLine, ...bullets].join('\n');
    }
          
    // Activation check for example gating + prompts
      let activated = false;
      let planInfo = null;
     let activatedDirect = null;
      try {                  
        // Preferred: fast boolean if available
        activatedDirect = await _isActivated(shopIdTop);
        planInfo = await getUserPlan(shopIdTop);
        activated = (activatedDirect === true) ? true : isPlanActive(planInfo);
      } catch (_) {}
      const plan = String(planInfo?.plan ?? '').toLowerCase();
      const end  = planInfo?.trialEnd ?? planInfo?.endDate ?? null;
      const isNewUser = !plan || plan === 'none';
      const trialExpired = plan === 'trial' && end ? (new Date(end).getTime() < Date.now()) : false;         
     // Recent activation grace: treat as active for a short window after 'activate_trial'
      const recentTs = _recentActivations.get(shopIdTop);
      const isRecentlyActivated = !!recentTs && (Date.now() - recentTs < RECENT_ACTIVATION_MS);
      const allowExamples = activated || isRecentlyActivated;
  
   // Quick‑Reply buttons (payload IDs are language‑independent)
   if (payload === 'qr_purchase') {                                     
        await setStickyMode(from, 'purchased'); // always set sticky                       
            if (allowExamples) {
                  // re-check activation right before send, to cope with very short DB lag
                  try {
                    const check = await _isActivated(shopIdTop);
                    if (check !== true && !isRecentlyActivated) throw new Error('not-activated-yet');
                  } catch (_) {}
              const examples = getStickyExamplesLocalized('purchased', lang);
              await sendExamplesWithAck(from, lang, examples, `qr-purchase-${shopIdTop}`);                        
            } else {
                  // NEW: Prompt for activation when plan not active (new or expired trial)                              
            const msgRaw = isNewUser
                    ? await t('🚀 Start your free trial to record purchases, sales, and returns.\nReply "trial" to start.', lang, `qr-trial-prompt-${shopId}`)
                    : trialExpired
                      ? await t(`🔒 Your trial has ended. Activate the paid plan to continue recording transactions.\nPay ₹11 via Paytm → ${PAYTM_NUMBER} (${PAYTM_NAME})\nOr pay at: ${PAYMENT_LINK}\nReply "paid" after payment ✅`, lang, `qr-paid-prompt-${shopId}`)
                      : await t('ℹ️ Please activate your plan to record transactions.', lang, `qr-generic-prompt-${shopId}`);
                  await sendMessageViaAPI(from, fixNewlines(msgRaw));
                }
       try { await maybeShowPaidCTAAfterInteraction(from, lang, { trialIntentNow: isStartTrialIntent(text) }); } catch (_) {}                    
       return true;
   }
   if (payload === 'qr_sale') {                       
        await setStickyMode(from, 'sold'); // always set sticky                      
            if (allowExamples) {
                  try {
                    const check = await _isActivated(shopIdTop);
                    if (check !== true && !isRecentlyActivated) throw new Error('not-activated-yet');
                  } catch (_) {}
              const examples = getStickyExamplesLocalized('sold', lang);
              await sendExamplesWithAck(from, lang, examples, `qr-sale-${shopIdTop}`);              
            } else {                                  
                const msgRaw = isNewUser
                        ? await t('🚀 Start your free trial to record purchases, sales, and returns.\nReply "trial" to start.', lang, `qr-trial-prompt-${shopId}`)
                        : trialExpired
                          ? await t(`🔒 Your trial has ended. Activate the paid plan to continue recording transactions.\nPay ₹11 via Paytm → ${PAYTM_NUMBER} (${PAYTM_NAME})\nOr pay at: ${PAYMENT_LINK}\nReply "paid" after payment ✅`, lang, `qr-paid-prompt-${shopId}`)
                          : await t('ℹ️ Please activate your plan to record transactions.', lang, `qr-generic-prompt-${shopId}`);
                      await sendMessageViaAPI(from, fixNewlines(msgRaw));
                }
       try { await maybeShowPaidCTAAfterInteraction(from, lang, { trialIntentNow: isStartTrialIntent(text) }); } catch (_) {}               
       return true;
   }
   if (payload === 'qr_return') {                         
        await setStickyMode(from, 'returned'); // always set sticky                        
            if (allowExamples) {
                  try {
                    const check = await _isActivated(shopIdTop);
                    if (check !== true && !isRecentlyActivated) throw new Error('not-activated-yet');
                  } catch (_) {}
                const examples = getStickyExamplesLocalized('returned', lang);
                await sendExamplesWithAck(from, lang, examples, `qr-return-${shopIdTop}`);
        } else {                          
            const msgRaw = isNewUser
                    ? await t('🚀 Start your free trial to record purchases, sales, and returns.\nReply "trial" to start.', lang, `qr-trial-prompt-${shopId}`)
                    : trialExpired
                      ? await t(`🔒 Your trial has ended. Activate the paid plan to continue recording transactions.\nPay ₹11 via Paytm → ${PAYTM_NUMBER} (${PAYTM_NAME})\nOr pay at: ${PAYMENT_LINK}\nReply "paid" after payment ✅`, lang, `qr-paid-prompt-${shopId}`)
                      : await t('ℹ️ Please activate your plan to record transactions.', lang, `qr-generic-prompt-${shopId}`);
                  await sendMessageViaAPI(from, fixNewlines(msgRaw));
            }
       try { await maybeShowPaidCTAAfterInteraction(from, lang, { trialIntentNow: isStartTrialIntent(text) }); } catch (_) {}                    
       return true;
   }
 
  // --- NEW: Activate Trial Plan ---
  if (payload === 'activate_trial') {                  
        // --- NEW: start onboarding capture; do NOT activate yet
            if (activated) {
              const msg = await t('✅ You already have access.', lang, `cta-trial-already-${shopId}`);
              await sendMessageViaAPI(from, fixNewlines(msg));
              try { await maybeShowPaidCTAAfterInteraction(from, lang, { trialIntentNow: true }); } catch {}
              return true;
            }                        
            if (CAPTURE_SHOP_DETAILS_ON === 'paid') {
                // Immediate trial activation (no capture)
                await activateTrialFlow(from, lang);
              } else {
                // Legacy behavior: capture during trial
                await beginTrialOnboarding(from, lang);
              }
              return true;
  }
  
  // --- NEW: Demo button ---     
  if (payload === 'show_demo') {                
        // Send demo video (no text narrative) and the QR buttons, then exit.
          try {
            const langPinned = String(lang ?? 'en').toLowerCase();
            const rqid = req.requestId ? String(req.requestId) : `req-${Date.now()}`;
            console.log(`[interactive:demo] payload=${payload} → sending video`);
            await sendDemoVideoAndButtons(from, langPinned, `${rqid}::cta-demo`);
          } catch (e) {
            console.warn('[interactive:demo] video send failed:', e?.message);
          }
          // We already replied via PM API; short‑circuit this turn.
          return true;
      }
  // --- NEW: Help button ---
  if (payload === 'show_help') {        
    const helpEn = [
          'Help:',
          `• WhatsApp or call: +91-9013283687`,
          `• WhatsApp link: https://wa.link/6q3ol7`
        ].join('\n');
        const help = await t(helpEn, lang, `cta-help-${shopId}`);
        await sendMessageViaAPI(from, help);
    return true;
  }
   
  // --- NEW: Activate Paid Plan ---     
  if (payload === 'activate_paid') {
    // Show paywall; activation only after user replies "paid"
         // IMPORTANT: use RAW markers so clamp/footer logic can detect them.
         const NO_FOOTER_MARKER = '<!NO_FOOTER!>';
    
      // Compose the 3-line paywall body
      const body =
        `To activate the paid plan, pay ₹${PAID_PRICE_INR} via Paytm → ${PAYTM_NUMBER} (${PAYTM_NAME})\n` +
        `Or pay at: ${PAYMENT_LINK}\nClick on "paid" after payment ✅`;        
          
    // Put BOTH markers INSIDE the string given to t(...),
         // so enforceSingleScriptSafe() and tagWithLocalizedMode() skip clamp/footer.                 
        let localized = await t(NO_FOOTER_MARKER + body, lang, `cta-paid-${shopId}`);
            // ANCHOR: UNIQ:ACTIVATE-PAID-001
            // Finalize before sending (strip markers, single-script, newline & digit normalization)
            await sendMessageViaAPI(from, finalizeForSend(localized, lang));
    
      // NEW: Immediately surface single-button "Paid" quick-reply (unchanged)
      try {
        await ensureLangTemplates(lang);
        const sids = getLangSids(lang);
        if (sids?.paidConfirmSid) {
          await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.paidConfirmSid });
        }
      } catch (e) {
        console.warn('[activate_paid] paidConfirm send failed', e?.response?.status, e?.response?.data);
      }
    
      try { await maybeShowPaidCTAAfterInteraction(from, lang, { trialIntentNow: false }); } catch (_) {}
      return true;
    }

// NEW: Handle taps on the single-button "Paid" quick-reply
if (payload === 'confirm_paid') {
  const shopId = String(from).replace('whatsapp:', '');
  const langPref = (await getUserPreference(shopId))?.language?.toLowerCase() ?? 'en';      
    let ack = await t(
        'Thanks! We will verify the payment shortly. If not activated in a minute, please tap “Paid” again.',
        langPref, `confirm-paid-${shopId}`
      );
      await sendMessageViaAPI(from, finalizeForSend(ack, langPref));
  // Re-surface the button for convenience
  try {
    await ensureLangTemplates(langPref);
    const sids = getLangSids(langPref);
    if (sids?.paidConfirmSid) {
      await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.paidConfirmSid });
    }
  } catch (e) {
    console.warn('[confirm_paid] re-send failed', e?.response?.status, e?.response?.data);
  }    
  // Begin paid onboarding capture (shop name, GSTIN, address)
    if (CAPTURE_SHOP_DETAILS_ON === 'paid') {
      try { await beginPaidOnboarding(from, langPref); } catch (e) { console.warn('[confirm_paid] beginPaidOnboarding failed:', e?.message); }
    }
  return true;
}
     
  // List‑Picker selections → route using user's saved language preference
    let lpLang = 'en';
    try {
      const shopIdLP = String(from).replace('whatsapp:', '');
      const prefLP = await getUserPreference(shopIdLP);
      if (prefLP?.success && prefLP.language) lpLang = String(prefLP.language).toLowerCase();
    } catch (_) { /* best effort */ }
    const route = (cmd) => handleQuickQueryEN(cmd, from, lpLang, 'lp');
   switch (listId) {
             
        case 'list_short_summary':                      
          await route('short summary');
                return true;
        
          case 'list_full_summary':
            await route('full summary'); return true;
        
          case 'list_reorder_suggest':
            await route('reorder suggestions'); return true;
        
          case 'list_sales_week':                   
            await route('sales week');
                  return true;
        
          case 'list_expiring_30':
            await route('expiring 30'); return true;
        
          // keep existing IDs working:
          case 'list_low':
            await route('low stock'); return true;
        
          case 'list_expiring': // your "Expiring 0"
            await route('expiring 0'); return true;
        
          case 'list_sales_day':                      
            await route('sales today');
                  return true;
        
          case 'list_top_month':
            await route('top 5 products month'); return true;
        
          case 'list_value':
            await route('value summary'); return true;
}     
  // If Twilio only sent text (rare), you can optionally pattern‑match:
    if (/record\s+purchase/i.test(text)) { /* ... */ }
    return false;
  }

// --- Tiny edit distance (Damerau-Levenshtein would be nicer; classic Levenshtein is fine here)
function _editDistance(a, b) {
  a = _normLite(a); b = _normLite(b);
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}
    
function _near(a, b, max=2) { return _editDistance(a, b) <= max; }

// --- Fuzzy resolver: exact alias -> fuzzy regex/synonyms -> edit-distance over key tokens
function resolveSummaryIntent(raw) {
  
const s = String(raw || '').trim();
if (_isGreeting(s)) return null;

  // 1) Exact alias
  const exact = resolveSummaryAlias(raw);
  if (exact) return exact;

  // 2) Language-agnostic normalized text
  const t = _normLite(raw);

  // 3) Generic English patterns and synonyms
  if (/(^|\s)(short|quick|mini)\s*(summary|report|overview)($|\s)/i.test(t)) return 'short summary';
  if (/(^|\s)(full|detailed|complete|entire)\s*(summary|report|overview)($|\s)/i.test(t)) return 'full summary';
  // also “summary please short” kind of phrasing
  if (/summary|report|overview/.test(t) && /(short|quick|mini)/.test(t)) return 'short summary';
  if (/summary|report|overview/.test(t) && /(full|detailed|complete|entire)/.test(t)) return 'full summary';

  // 4) Bengali (bn) common variants
  if (/(ছোট|সংক্ষিপ্ত|ক্ষুদ্র).*(সারাংশ|সারসংক্ষেপ|সারমর্ম)/.test(t)) return 'short summary';
  if (/(সম্পূর্ণ|পূর্ণ|বিস্তারিত).*(সারাংশ|সারসংক্ষেপ|রিপোর্ট|সারমর্ম)/.test(t)) return 'full summary';
  if (/\b(সংক্ষিপ্ত সারসংক্ষেপ|ছোট সারাংশ)\b/.test(t)) return 'short summary';
  if (/\b(সম্পূর্ণ সারসংক্ষেপ|বিস্তারিত সারসংক্ষেপ)\b/.test(t)) return 'full summary';

  // 5) Hindi (hi)
  if (/(छोटा|संक्षिप्त).*(सारांश|रिपोर्ट)/.test(t)) return 'short summary';
  if (/(पूरा|पूर्ण|विस्तृत).*(सारांश|रिपोर्ट)/.test(t)) return 'full summary';

  // 6) Tamil (ta)
  if (/(சிறு|சுருக்க).*(சுருக்கம்|அறிக்கை)/.test(t)) return 'short summary';
  if (/(முழு|விரிவான).*(சுருக்கம்|அறிக்கை)/.test(t)) return 'full summary';

  // 7) Telugu (te)
  if (/(చిన్న|సంక్షిప్త).*(సారాంశం|నివేదిక)/.test(t)) return 'short summary';
  if (/(పూర్తి|వివరణాత్మక).*(సారాంశం|నివేదిక)/.test(t)) return 'full summary';

  // 8) Kannada (kn)
  if (/(ಚಿಕ್ಕ|ಸಂಕ್ಷಿಪ್ತ).*(ಸಾರಾಂಶ|ವರದಿ)/.test(t)) return 'short summary';
  if (/(ಪೂರ್ಣ|ವಿಸ್ತೃತ).*(ಸಾರಾಂಶ|ವರದಿ)/.test(t)) return 'full summary';

  // 9) Marathi (mr)
  if (/(लहान|संक्षिप्त).*(सारांश|अहवाल)/.test(t)) return 'short summary';
  if (/(पूर्ण|सविस्तर).*(सारांश|अहवाल)/.test(t)) return 'full summary';

  // 10) Gujarati (gu)
  if (/(નાનું|સંક્ષિપ્ત).*(સારાંશ|અહેવાલ)/.test(t)) return 'short summary';
  if (/(સંપૂર્ણ|વિસ્તૃત).*(સારાંશ|અહેવાલ)/.test(t)) return 'full summary';

  // 11) Edit-distance fallback around key tokens (summary/report/overview)
  const tokens = t.split(/\s+/);
  const hasSumm = tokens.some(w => _near(w, 'summary') || _near(w, 'report') || _near(w, 'overview'));
  const hasShort = tokens.some(w => _near(w, 'short') || _near(w, 'quick') || _near(w, 'mini'));
  const hasFull  = tokens.some(w => _near(w, 'full') || _near(w, 'detailed') || _near(w, 'complete'));
  if (hasSumm && hasShort) return 'short summary';
  if (hasSumm && hasFull)  return 'full summary';

  return null;
}

// [SALES-QA-IDENTITY-002] Detector for "what's your name / tumhara naam kya hai / तुम्हारा नाम क्या है"
function isNameQuestion(s = '') {
  const t = String(s).trim().toLowerCase();
  // English
  const en = /\b((what('?s)?|whats)\s+your\s+name|who\s+are\s+you)\b/;
  // Hinglish (Latin)
  const hing = /\btumhara\s+naam\s+kya\s+hai\b|\btera\s+naam\b/;
  // Hindi (Devanagari)
  const hiNative = /(तुम्हारा|आपका)\s+नाम\s+क्या\s+है/;
  return en.test(t) || hing.test(t) || hiNative.test(s);
}

// ---- READ-ONLY / TXN GUARDS -------------------------------------------------
function isReadOnlyQuery(text) {
  const t = String(text || '').trim().toLowerCase();
  const readOnlyPatterns = [
    /^(?:stock|inventory|qty)\s+\S+$/,                          // stock Maggi
    /^(?:batches?|expiry)\s+\S+$/,                              // batches milk
    /^expiring(?:\s+\d+)?$/,                                    // expiring 30
    /^show\s+expired\s+stock$/,
    /^sales\s+(?:today|this\s*week|week|this\s*month|month)$/,   // sales today
    /^top\s*\d*\s*products(?:\s+(?:today|week|month|this\s*week|this\s*month))?$/,
    /^(?:low\s*stock|stockout|out\s*of\s*stock)$/,
    /^(?:inventory\s*value|stock\s*value|value\s*summary)$/,
    /^products(?:\s+(?:search|page|\d+).*)?$/,                  // products / products 2 / products search maggi
    /^prices(?:\s+(?:page|\d+).*)?$/                            // prices / prices 2
  ];
  return readOnlyPatterns.some(rx => rx.test(t));
}

function looksLikeTransaction(text) {
  const s = String(text ?? '').toLowerCase();
  try { regexPatterns.purchaseKeywords.lastIndex = 0; } catch (_) {}
  try { regexPatterns.salesKeywords.lastIndex = 0; } catch (_) {}
  try { regexPatterns.remainingKeywords.lastIndex = 0; } catch (_) {}
  try { regexPatterns.returnKeywords.lastIndex = 0; } catch (_) {}
  try { regexPatterns.digits.lastIndex = 0; } catch (_) {}    
  // ======================================================================
     // [UNIQ:TXN-GATE-EDIT-003] Voice-friendly gating:
     // - Accept worded numbers OR digits
     // - Use unified UNIT_REGEX (includes metre/meter + extended units)
     // ======================================================================
     const hasDigits = regexPatterns.digits.test(s) ||
       /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|million|crore|point)\b/i.test(s);
     const mentionsMoney =
       /(?:₹|rs\.?|rupees)\s*\d+(?:\.\d+)?/i.test(s)
       ||
       /(?:@|at)\s*(?:\d+(?:\.\d+)?)\s*(?:per\s+)?(?:kg|liter|litre|liters|litres|packet|packets|box|boxes|piece|pieces|ml|g|kg|ltr|meter|metre|meters|metres|cm|mm|in|ft|yd)/i.test(s);
     const hasUnit = UNIT_REGEX.test(s);
  const hasTxnVerb =
    regexPatterns.purchaseKeywords.test(s)
    ||
    regexPatterns.salesKeywords.test(s)
    ||
    regexPatterns.returnKeywords.test(s)
    ||
    /\b(opening|received|recd|restock|purchase|bought|sold)\b/i.test(s);

  // ✅ Tightened condition: must have verb AND digits AND unit/money
  return hasTxnVerb && hasDigits && (mentionsMoney || hasUnit);
}

// NOTE: function declaration (not const arrow) so it's hoisted and available everywhere.
function resolveSummaryAlias(raw) {
  const t = String(raw || '').trim().toLowerCase();
  for (const lang of Object.keys(SUMMARY_ALIAS_MAP)) {
    const { short = [], full = [] } = SUMMARY_ALIAS_MAP[lang] || {};
    if (short.some(x => t === x.toLowerCase())) return 'short summary';
    if (full.some(x => t === x.toLowerCase()))  return 'full summary';
  }
  return null;
}


// Add this near the top of whatsapp.js
const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME;
const isServerless = isRailway || process.env.VERCEL || process.env.NETLIFY;
console.log('Environment detection:', {
  isRailway: !!isRailway,
  isServerless: !!isServerless,
  nodeVersion: process.version,
  platform: process.platform
});

// --------------------------------------------------------------------------------
// NEW: Pre-warm content templates at boot (non-blocking) to avoid cold-start lag
// --------------------------------------------------------------------------------
setImmediate(async () => {
  try {
    for (const L of ['en', 'hi', 'hi-latn']) {
      await ensureLangTemplates(L);
    }
    console.log('[contentCache] pre-warmed en/hi/hi-latn');
  } catch (e) {
    console.warn('[contentCache] pre-warm failed', e?.message);
  }
});

const {
  updateInventory,
  testConnection,
  createBatchRecord,
  getBatchRecords,
  updateBatchExpiry,
  saveUserPreference,
  getUserPreference,
  saveUserPlan,
  getUserPlan,
  isFirst50Shops,
  isFeatureAvailable,
  createSalesRecord,
  updateBatchQuantity,
  batchUpdateInventory,
  getBatchByCompositeKey,           // Add this
  updateBatchQuantityByCompositeKey,
  savePendingTranscription,    // Add this
  getPendingTranscription,     // Add this
  deletePendingTranscription,
  saveCorrectionState,    // Add this
  getCorrectionState,     // Add this
  deleteCorrectionState,
  saveUserStateToDB,
  getUserStateFromDB,
  deleteUserStateFromDB,
  updateBatchPurchasePrice,
  isUserAuthorized,
  deactivateUser,    
  getAuthUserRecord,        // NEW
  startTrialForAuthUser,    // NEW
  markAuthUserPaid,         // NEW
  getTrialsExpiringBefore,  // NEW
  setTrialReminderSent,     // NEW
  touchUserLastUsed,
  getUsersInactiveSince,
  getTodaySalesSummary,
  getInventorySummary,
  getLowStockProducts,
  getExpiringProducts,
  getSalesDataForPeriod,
  getPurchaseDataForPeriod,
  getAllShopIDs,
  upsertProduct,
  getProductPrice,
  getAllProducts,
  updateProductPrice,
  getProductsNeedingPriceUpdate,
  getTranslationEntry,
  upsertTranslationEntry,
  getProductInventory,
  getStockoutItems,
  getBatchesForProductWithRemaining,
  getSalesSummaryPeriod,
  getTopSellingProductsForPeriod,
  getReorderSuggestions,
  getCurrentInventory,
  applySaleWithReconciliation,
  reattributeSaleToBatch,
  upsertAuthUserDetails,
  refreshUserStateTimestamp
} = require('../database');

// ===== ShopID helpers ========================================================
// Keep digits-only only for non-DB use (e.g., filenames, local keys).
function toDigitsOnly(fromOrDigits) {
  const raw = String(fromOrDigits ?? '');
  return raw.replace(/^whatsapp:/, '').replace(/\D+/g, '');
}
// Return E.164 for DB calls; used by shopIdFrom(From) above
function fromToShopId(From) {
  return shopIdFrom(From); // now E.164 (e.g., "+919013283687")
}

// --- No-op fallback for builds where cleanupCaches isn't bundled
if (typeof cleanupCaches === 'undefined') {
  function cleanupCaches() { /* noop */ }
}

// ---------------------------------------------------------------------------
// Guarded invoice shop-details fetch (always E.164). Use upstream where needed.
// ---------------------------------------------------------------------------
async function ensureShopDetailsForInvoice(From) {
  const phoneE164 = shopIdFrom(From);
  let details = null;
  try {
    // getShopDetails expects the phone key used in Airtable (E.164)
    details = await getShopDetails(phoneE164);
  } catch (_) {}
  if (!details) {
    // Friendly nudge instead of silent failure
    await sendMessageViaAPI(From, '⚠️ Shop details not found. Please complete onboarding (name, address, GSTIN) before generating invoices.');
    return null;
  }
  // Ensure the generator sees E.164 as shopId; it will strip for filenames itself.
  return { ...details, shopId: phoneE164 };
}

/**
 * SAFE TIP WRAPPER
 * Only invoke runWithTips if it exists and is a function; otherwise, run the handler directly.
 * Using `typeof runWithTips` is safe even if the symbol is not declared, so no ReferenceError.
 */
const invokeWithTips = async (ctx, fn) => {
  try {
    if (typeof runWithTips === 'function') {
      return await runWithTips(ctx, fn);
    }
  } catch (_) { /* noop: fall back to plain handler */ }
  return await fn();
};

// ===== Compact & Single-Script config =====
const COMPACT_MODE = String(process.env.COMPACT_MODE ?? 'true').toLowerCase() === 'true';
const SINGLE_SCRIPT_MODE = String(process.env.SINGLE_SCRIPT_MODE ?? 'true').toLowerCase() === 'true';
// Optional debug switch for QA sanitize instrumentation
const DEBUG_QA_SANITIZE = String(process.env.DEBUG_QA_SANITIZE ?? 'false').toLowerCase() === 'true';
const AGENT_NAME = process.env.AGENT_NAME ?? 'Suhani';
// ===== Paywall / Trial / Links (env-driven) =====
const PAYTM_NUMBER = String(process.env.PAYTM_NUMBER ?? '9013283687');
const PAYTM_NAME   = String(process.env.PAYTM_NAME   ?? 'Saamagrii.AI Support Team');
const PAID_PRICE_INR = Number(process.env.PAID_PRICE_INR ?? 11);
const INLINE_PAYTM_IN_PRICING = String(process.env.INLINE_PAYTM_IN_PRICING ?? 'false').toLowerCase() === 'true';
const WHATSAPP_LINK = String(process.env.WHATSAPP_LINK ?? 'https://wa.link/6q3ol7');
const PAYMENT_LINK  = String(process.env.PAYMENT_LINK  ?? '<payment_link>');

// NEW: Trial CTA ContentSid (Quick-Reply template)
const TRIAL_CTA_SID = String(process.env.TRIAL_CTA_SID ?? '').trim();

// === NEW: Onboarding benefits video (default URL; per-language fallbacks optional) ===
const ONBOARDING_VIDEO_URL = String(process.env.ONBOARDING_VIDEO_URL ??
  'https://kansrakunal1992.github.io/deadStockAlertWAIndia/saamagrii-benefits-hi.mp4'
).trim();
const ONBOARDING_VIDEO_URL_HI = String(process.env.ONBOARDING_VIDEO_URL_HI ?? '').trim();
// (We won’t use HI_LATN separately; hi-latn is treated as Hindi)
const ONBOARDING_VIDEO_URL_EN = String(process.env.ONBOARDING_VIDEO_URL_EN ??
  'https://kansrakunal1992.github.io/deadStockAlertWAIndia/saamagrii-benefits-en.mp4'
).trim();

// === NEW: Demo video shown when user taps “Demo” or types demo ===
// Recommended: host via GitHub Pages/S3 and set DEMO_VIDEO_URL in Railway env.
const DEMO_VIDEO_URL = String(((process.env.DEMO_VIDEO_URL ?? process.env.ONBOARDING_VIDEO_URL) ?? '')).trim();               // English (all other languages)
const DEMO_VIDEO_URL_HI = String(process.env.DEMO_VIDEO_URL_HI ?? '').trim();                                                  // Hindi/Hinglish shared
// NOTE: We no longer need a separate hi-latn URL; Hinglish will reuse DEMO_VIDEO_URL_HI

function getDemoVideoUrl(lang) {
  const L = String(lang ?? 'en').toLowerCase();
  // Use the Hindi demo video for both native Hindi and Hinglish (hi-latn)
  if ((L === 'hi' || L === 'hi-latn') && DEMO_VIDEO_URL_HI) return DEMO_VIDEO_URL_HI;
  // Otherwise use the English demo video (or fallback)
  return DEMO_VIDEO_URL || ONBOARDING_VIDEO_URL;
}

/**
 * Canonical activation gate:
 * Only 'trial' (explicit user action) or 'paid' are considered activated.
 * No implicit mapping for 'free_demo_first_50', 'demo', or ''.
 */

// COPILOT-PATCH-ACTIVATION-READ-PLAN
async function isUserActivated(shopId) {
  try {
    const planInfo = await getUserPlan(shopId);
    const plan = String(planInfo?.plan ?? '').toLowerCase();
    return plan === 'trial' || plan === 'paid';
  } catch {
    return false;
  }
}

// --- Q&A-only: per-request tip suppression (so no "Reply 'Demo'..." tail after Q&A)
const suppressTipsFor = new Set(); // requestId strings

// Helper: send Onboarding Quick-Reply (Activate Trial / Demo / Help) in user's language
async function sendOnboardingQR(shopId, lang) {
  await ensureLangTemplates(lang);
  const sids = getLangSids(lang) || {};
  const contentSid = String(process.env.ONBOARDING_QR_SID ?? '').trim() || sids.onboardingQrSid;
  if (contentSid) await sendContentTemplateQueuedOnce({ toWhatsApp: shopId, contentSid, requestId });
}

// === NEW: light media sender + buttons wrapper for Demo ===
async function sendDemoVideoAndButtons(From, lang = 'en', requestId = 'cta-demo') {
  const shopId = String(From).replace('whatsapp:', '');
  const videoUrl = getDemoVideoUrl(lang);

  // 1) Send WhatsApp video via Twilio PM API (no caption)
  try {
    console.log(`[demo-video] sending to ${From} url=${videoUrl}`);
    const msg = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER, // e.g., 'whatsapp:+1415...'
      to: From,                                 // already 'whatsapp:+<msisdn>'
      body: '',
      mediaUrl: [videoUrl]
    });
    console.log('[demo-video] sent', { sid: msg.sid });
  } catch (e) {
    console.warn('[demo-video] media send failed:', e?.message, e?.code, e?.status);
    // No link fallback – we only want inline video
  }

 // 2) Render the quick‑reply buttons
   try { await new Promise(r => setTimeout(r, 250)); } catch {}
   try {
     await ensureLangTemplates(lang);
     const sids = getLangSids(lang) ?? {};
     const contentSid = String(process.env.ONBOARDING_QR_SID ?? '').trim() || sids.onboardingQrSid;
     if (contentSid) {
       await sendContentTemplate({ toWhatsApp: shopId, contentSid });
     } else {               
        const ctaText = getTrialCtaText(lang);
              let msg = await t(NO_FOOTER_MARKER + ctaText, lang, `${requestId}::qr-fallback`);
              await sendMessageViaAPI(From, finalizeForSend(msg, lang));
     }
   } catch (e) {
     console.warn('[demo-buttons] failed:', e?.message);
   }
 }

// === Canonical benefits video (Hindi & Hinglish vs English) ===================
function getBenefitsVideoUrl(lang = 'en') {
  const L = String(lang ?? 'en').toLowerCase();
  const isHindi = (L === 'hi' || L === 'hi-latn'); // Hinglish is Hindi
  if (isHindi) {
    return (ONBOARDING_VIDEO_URL_HI || ONBOARDING_VIDEO_URL || ONBOARDING_VIDEO_URL_EN);
  }
  return ONBOARDING_VIDEO_URL_EN;
}

/**
 * Send the onboarding benefits video (no caption), before QR buttons.
 * Mirrors sendDemoVideoAndButtons(...) Twilio PM API pattern.
 */
async function sendOnboardingBenefitsVideo(From, lang = 'en') {
  try {
    const toNumber = shopIdFrom(From);
    const L           = String(lang ?? 'en').toLowerCase();
    const rawUrl      = getBenefitsVideoUrl(L);
    if (!rawUrl) { console.warn('[onboard-benefits] No video URL configured; skipping'); return; }
    // Percent-encode URL (safe for spaces/Unicode)
    let encodedUrl = rawUrl;
    try { encodedUrl = encodeURI(rawUrl); } catch (e) {
      console.warn('[onboard-benefits] encodeURI failed; using raw URL', { error: e?.message, rawUrl });
    }
    console.log('[onboard-benefits] media URL', { rawUrl, encodedUrl, lang: L });        
    // Localized caption with canonical marker handled inside t(...), then stripped & finalized.
        const captionEn = 'Manage stock & expiry on WhatsApp • Low-stock alerts • Smart reorder tips';
        let caption = await t(NO_FOOTER_MARKER + captionEn, L, 'onboard-video-caption');
        caption = finalizeForSend(caption, L);
    // Twilio send
    const accountSid   = process.env.ACCOUNT_SID;
    const authToken    = process.env.AUTH_TOKEN;
    const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER; // e.g. 'whatsapp:+14155238886'
    if (accountSid && authToken && fromWhatsApp) {
      const twilioClient = require('twilio')(accountSid, authToken);
      try {
        const resp = await twilioClient.messages.create({
          from: fromWhatsApp,
          to: `whatsapp:${toNumber}`,
          mediaUrl: [encodedUrl],
          body: caption,
        });
        console.log('[onboard-benefits] sent', { sid: resp?.sid, to: toNumber, url: encodedUrl, rawUrl, lang: L });
        return;
      } catch (err) {
        const code       = err?.code ?? err?.status;
        const message    = err?.message ?? err?.moreInfo;
        const respStatus = err?.status ?? err?.response?.status;
        const respData   = err?.response?.data;
        console.warn('[onboard-benefits] Twilio send failed', { code, message, respStatus, respData, attemptedUrl: encodedUrl, rawUrl, lang: L });
        // Fall through to abstraction fallback
      }
    } else {
      console.warn('[onboard-benefits] Missing Twilio creds; will try abstraction fallback', {
        hasSid: !!accountSid, hasToken: !!authToken, hasFrom: !!fromWhatsApp
      });
    }
    // Fallback: app abstraction with mediaUrl
    try {
      if (typeof sendMessageViaAPI === 'function') {
        await sendMessageViaAPI(From, caption, { mediaUrl: encodedUrl });
        console.log('[onboard-benefits] sent via sendMessageViaAPI (fallback)', { to: toNumber, url: encodedUrl, rawUrl, lang: L });
        return;
      } else {
        console.warn('[onboard-benefits] sendMessageViaAPI not available; cannot use fallback');
      }
    } catch (e) {
      console.warn('[onboard-benefits] fallback sendMessageViaAPI failed', { error: e?.message, attemptedUrl: encodedUrl, rawUrl, lang: L });
    }
    console.warn('[onboard-benefits] send wrapper failed (both paths)');
  } catch (e) {
    console.warn('[onboard-benefits] send failed', e?.message);
  }
}

// Localized trial CTA text fallback (used only if Content send fails)
function getTrialCtaText(lang) {
  const lc = String(lang || 'en').toLowerCase();
  switch (lc) {
    case 'hi':
      return '✅ ट्रायल शुरू करने के लिए 1 रिप्लाई करें • 📖 डेमो के लिए 2 • ❓ मदद के लिए 3';
    case 'bn':
      return '✅ ট্রায়াল শুরু করতে 1 রিপ্লাই করুন • 📖 ডেমো 2 • ❓ সাহায্য 3';
    case 'ta':
      return '✅ ட்ரயல் தொடங்க 1 • 📖 டெமோ 2 • ❓ உதவி 3';
    case 'te':
      return '✅ ట్రయల్ ప్రారంభించడానికి 1 • 📖 డెమో 2 • ❓ సహాయం 3';
    case 'kn':
      return '✅ ಟ್ರಯಲ್ ಪ್ರಾರಂಭ 1 • 📖 ಡೆಮೊ 2 • ❓ ಸಹಾಯ 3';
    case 'mr':
      return '✅ ट्रायल सुरू करण्यासाठी 1 • 📖 डेमो 2 • ❓ मदत 3';
    case 'gu':
      return '✅ ટ્રાયલ શરૂ કરવા 1 • 📖 ડેમો 2 • ❓ મદદ 3';
    default:
      return `Reply 1 to start FREE ${TRIAL_DAYS}-day trial • 2 demo • 3 help`;
  }
}

// ===== Welcome/Onboarding session controls (new) =====
const WELCOME_SESSION_MINUTES = Number(process.env.WELCOME_SESSION_MINUTES ?? 15);
const WELCOME_ONCE_PER_SESSION = String(process.env.WELCOME_ONCE_PER_SESSION ?? 'true').toLowerCase() === 'true';
const STATE_DIR = process.env.STATE_DIR || '/tmp';
try {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  console.log('[state-dir] using:', STATE_DIR);
} catch (e) { console.warn('[state-dir] mkdir failed:', e?.message); }
// Write tracker into a writable directory (A)
const WELCOME_TRACK_FILE = path.join(STATE_DIR, 'welcome_session_tracker.json');

function readWelcomeTracker() {
  try {        
    if (!fs.existsSync(WELCOME_TRACK_FILE)) { console.log('[welcome] tracker missing:', WELCOME_TRACK_FILE); return {}; }
    const data = fs.readFileSync(WELCOME_TRACK_FILE, 'utf8'); return JSON.parse(data);
  } catch { return {}; }
}
function writeWelcomeTracker(state) {
  try {        
    fs.writeFileSync(WELCOME_TRACK_FILE, JSON.stringify(state, null, 2));
    console.log('[welcome] tracker write OK:', WELCOME_TRACK_FILE);
    return true;
  } catch (e) {
    console.warn('[welcome] tracker write FAIL:', { file: WELCOME_TRACK_FILE, err: e?.message });
    return false; }
}
function getLastWelcomedISO(shopId) {
  const state = readWelcomeTracker();
  return state[shopId] ?? null;
}
function markWelcomed(shopId, whenISO = new Date().toISOString()) {
  const state = readWelcomeTracker();
  state[shopId] = whenISO;
  writeWelcomeTracker(state);
}

function _isLanguageChoice(text) {
  try {
    const t = String(text ?? '').trim();
    if (!t) return false;
    // use existing token matcher if available
    if (typeof _matchLanguageToken === 'function') return !!_matchLanguageToken(t);
    // fallback: common words
    return (/^\s*(english|hindi|marathi|gujarati|bengali|tamil|telugu|kannada)\s*$/i).test(t);
  } catch { return false; }
}

async function shouldWelcomeNow(shopId, text) {
  const last = getLastWelcomedISO(shopId);
  const greetingOrLang = _isGreeting(text) || _isLanguageChoice(text);
    // HARD GUARD: NEVER welcome if this turn looks like a question
      try {
        // Use AI-backed question detector when possible; fall back to heuristic
        const langHint = (await getUserPreference(shopId))?.language || 'en';
        const isQ = await looksLikeQuestion(text, String(langHint).toLowerCase());
        if (isQ) {
          console.log('[welcome] suppressed: turn looks like question');
          return false;
        }
      } catch (_) { /* best-effort; default continue */ }
    
      // FIRST-EVER: show welcome only for greeting/language selection; questions are already suppressed above
      if (!last) {
        if (greetingOrLang) {
          console.log('[welcome] reason=first-ever + greeting/lang');
          return true;
        }
    console.log('[welcome] first-ever but not greeting/lang → skip');
    return false;
  }
  if (!WELCOME_ONCE_PER_SESSION) {
    const yes = greetingOrLang;
    console.log('[welcome] oncePerSession=false, greeting/lang=', yes);
    return yes;
  }
  const diffMs = Date.now() - new Date(last).getTime();
  const withinSession = diffMs < (WELCOME_SESSION_MINUTES * 60 * 1000);
  if (withinSession) { console.log('[welcome] within-session → skip'); return false; }
  const yes = greetingOrLang;
  console.log('[welcome] session expired, greeting/lang=', yes);
  return yes;
}

// ---- NEW: treat languages ending with -Latn as Roman script targets (ASCII-preferred)
function isRomanTarget(lang) {
  return /-latn$/i.test(String(lang ?? 'en'));
}

/**
 * Enforce strict single-script compliance.
 */
function enforceSingleScript(out, lang) {
    if (!SINGLE_SCRIPT_MODE) return out;        
    return clampToSingleScript(out, lang);
}

// === Compact/Verbose message helpers (inline; no new files) ===
function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/**
 * r: { product, quantity, unit, unitAfter, action, success, error, newQuantity? }
 */
function formatResultLine(r, compact = true, includeStockPart = true) {
  const qty = Math.abs(r.quantity ?? 0);
  const unit = r.unitAfter ?? r.unit ?? '';    
  const stockPart = (includeStockPart && Number.isFinite(r.newQuantity))
      ? ` (Stock: ${r.newQuantity} ${unit})`
      : '';
  const act = capitalize(r.action ?? '');
  if (compact) {        
    // Treat success === undefined as "not a failure yet".
    // Only render an error line when success is explicitly false.
    if (r.success !== false) {
    // Unified symbol map for actions          
    const SYMBOLS = { purchased: '📦', sold: '🛒', returned: '↩️' };
          const actionLc = String(r.action ?? '').toLowerCase();
          const symbol = SYMBOLS[actionLc] ?? '✅';
          return `${symbol} ${act} ${qty} ${unit} ${r.product}${stockPart}`.trim();
    }
    return `❌ ${r.product} — ${r.error ?? 'Error'}`;
  }
  const tail = (r.success === false) ? `❌ ${r.error ?? 'Error'}` : '✅';
  return `• ${r.product}: ${qty} ${unit} ${act}${stockPart} ${tail}`.trim();
}

function composePurchaseConfirmation({ product, qty, unit, pricePerUnit, newQuantity }) {
  const unitText  = unit ? ` ${unit}` : '';
  const priceText = (Number(pricePerUnit) > 0)
    ? ` at ₹${Number(pricePerUnit).toFixed(2)}/${unit}`
    : '';
  const stockText = (newQuantity !== undefined && newQuantity !== null)
    ? ` (Stock: ${newQuantity}${unitText})`
    : '';
  return `📦 Purchased ${Math.abs(qty)}${unitText} ${product}${priceText}${stockText}`;
}

// --- Single-sale confirmation (compose & send once) --------------------------
const saleConfirmTracker = new Set();

const _confirmHashGuard = new Map(); // shopId -> { at: ms, lastHash: string }
const CONFIRM_BODY_TTL_MS = Number(process.env.CONFIRM_BODY_TTL_MS ?? (10 * 1000));
async function _sendConfirmOnceByBody(From, detectedLanguage, requestId, body) {
  const shopId = String(From).replace('whatsapp:', '');
  const localized = await t(body, detectedLanguage ?? 'en', `${requestId}::confirm-once`);
  const final = normalizeNumeralsToLatin(
    enforceSingleScriptSafe(await appendSupportFooter(localized, From), detectedLanguage)
  ).trim();
  const h = _hash(final); const prev = _confirmHashGuard.get(shopId); const now = Date.now();
  if (prev && (now - prev.at) < CONFIRM_BODY_TTL_MS && prev.lastHash === h) {
    console.log('[confirm-once] suppressed duplicate', { shopId, requestId });
    return;
  }
  _confirmHashGuard.set(shopId, { at: now, lastHash: h });
  await sendMessageViaAPI(From, final);
}

function composeSaleConfirmation({ product, qty, unit, pricePerUnit, newQuantity }) {
  const unitText  = unit ? ` ${unit}` : '';
  const priceText = (Number(pricePerUnit) > 0)
    ? ` at ₹${Number(pricePerUnit).toFixed(2)}/${unit}`
    : '';
  const stockText = (newQuantity !== undefined && newQuantity !== null)
    ? ` (Stock: ${newQuantity}${unitText})`
    : '';
  // Use 🛒 for sold (parallel to ↩️ for returned and 📦 for purchased)
  return `🛒 Sold ${Math.abs(qty)}${unitText} ${product}${priceText}${stockText}`;
}

// === Support link (from environment) ===
// Falls back to wa.link if env isn't set.
const SUPPORT_WHATSAPP_LINK = String(process.env.WHATSAPP_LINK || 'https://wa.link/6q3ol7');

// Append one-line support footer to all user-visible messages (language/script aware)
async function appendSupportFooter(msg, from) {
  const base = String(msg ?? '').trim();
     
  // Prevent duplicate footer lines
    if (/Need help\?/i.test(base) || base.includes(SUPPORT_WHATSAPP_LINK)) {
      return base;
    }
  
  // Resolve language preference (best-effort)
  let lang = 'en';
  try {
    const shopId = String(from ?? '').replace('whatsapp:', '');
    if (shopId && typeof getUserPreference === 'function') {
      const pref = await getUserPreference(shopId);
      if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
    }
  } catch {}
  const lines = {
    en: `Need help? WhatsApp Saamagrii.AI support: ${SUPPORT_WHATSAPP_LINK}. Type "mode" to switch Purchase/Sale/Return or ask an inventory query.`,
    hi: `मदद चाहिए? Saamagrii.AI सपोर्ट: ${SUPPORT_WHATSAPP_LINK}। "मोड" लिखें—खरीद/बिक्री/रिटर्न बदलें या इन्वेंटरी पूछें।`,
    'hi-latn': `Madad chahiye? Saamagrii.AI support: ${SUPPORT_WHATSAPP_LINK}. "mode" likho—Purchase/Sale/Return badlo ya inventory puchho.`,
    bn: `সাহায্য লাগবে? Saamagrii.AI সাপোর্ট: ${SUPPORT_WHATSAPP_LINK}। "মোড" লিখুন—ক্রয়/বিক্রি/রিটার্ন বদলান বা ইনভেন্টরি জিজ্ঞেস করুন।`,
    ta: `உதவி வேண்டுமா? Saamagrii.AI ஆதரவு: ${SUPPORT_WHATSAPP_LINK}. "மோட்" தட்டச்சு செய்து கொள்முதல்/விற்பனை/ரிட்டர்ன் மாற்றவும் அல்லது இன்வென்டரி கேளுங்கள்.`,
    te: `సహాయం కావాలా? Saamagrii.AI సపోర్ట్: ${SUPPORT_WHATSAPP_LINK}. "మోడ్" టైప్ చేసి కొనుగోలు/అమ్మకం/రిటర్న్ మార్చండి లేదా ఇన్వెంటరీ అడగండి.`,
    kn: `ಸಹಾಯ ಬೇಕಾ? Saamagrii.AI ಸಹಾಯ: ${SUPPORT_WHATSAPP_LINK}. "ಮೋಡ್" ಟೈಪ್ ಮಾಡಿ ಖರೀದಿ/ಮಾರಾಟ/ರಿಟರ್ನ್ ಬದಲಿಸಿ ಅಥವಾ ಇನ್ವೆಂಟರಿ ಕೇಳಿ.`,
    mr: `मदत हवी आहे? Saamagrii.AI सपोर्ट: ${SUPPORT_WHATSAPP_LINK}। "मोड" टाइप करा—खरेदी/विक्री/रिटर्न बदला किंवा इन्व्हेंटरी विचारा।`,
    gu: `મદદ જોઈએ? Saamagrii.AI સપોર્ટ: ${SUPPORT_WHATSAPP_LINK}। "મોડ" લખો—ખરીદી/વેચાણ/રીટર્ન બદલો અથવા ઇન્વેન્ટરી પૂછો।`,
  };
  const footer = lines[lang] || lines.en;     
  const merged = base ? `${base}\n\n${footer}` : footer;
      // LOCAL CLAMP → Single script; numerals normalization
      const one = enforceSingleScriptSafe(merged, lang);
      return normalizeNumeralsToLatin(one).trim();
}

// NEW: short-window duplicate message guard (3 seconds)
// Prevents accidental double “Stock: …” echoes or repeated bodies from concurrent paths.
const _recentSends = (globalThis._recentSends = globalThis._recentSends || new Map()); // key: from -> { body, at }
function _isDuplicateBody(from, msg, windowMs = 3000) {
  try {
    const key = String(from);
    const now = Date.now();
    const prev = _recentSends.get(key);
    if (prev && prev.body === msg && (now - prev.at) < windowMs) {
      return true;
    }
    _recentSends.set(key, { body: msg, at: now });
  } catch (_) {}
  return false;
}
async function sendMessageDedup(From, msg) {
  if (!msg) return;
  // Append language-aware footer; dedupe on the final normalized body          
    const withFooter = await appendSupportFooter(String(msg).trim(), From);
      // OPTIONAL GLOBAL FINALIZE:
      // Determine language hint best-effort (you may keep 'en' to avoid extra DB reads)
      let langHint = 'en';
      try {
        const shopId = String(From ?? '').replace('whatsapp:', '');
        const pref = await getUserPreference(shopId);
        if (pref?.success && pref.language) langHint = String(pref.language).toLowerCase();
      } catch {}
      const finalBody = finalizeForSend(withFooter, langHint);
      if (_isDuplicateBody(From, finalBody)) {
    try { console.log('[dedupe] suppressed duplicate body for', From); } catch (_) {}
    return;
  }
  await sendMessageViaAPI(From, finalBody);
}

async function sendSaleConfirmationOnce(From, detectedLanguage, requestId, info) {
  // Gate duplicates per request
  if (saleConfirmTracker.has(requestId)) return;
  saleConfirmTracker.add(requestId);      
  const head = composeSaleConfirmation(info);
  const body = `${head}\n\n✅ Successfully updated 1 of 1 items.`;
  await _sendConfirmOnceByBody(From, detectedLanguage, requestId, body);
}

/**
 * NEW: one-liner purchase confirmation (language-aware via t())
 * Mirrors the sale confirmation, but for “purchased”.
 */
async function sendPurchaseConfirmationOnce(From, detectedLanguage, requestId, payload) {
 const {
    product,
    qty,
    unit = '',
    pricePerUnit = null,
    newQuantity = null
  } = payload || {};

  // Build the one-line head via composer (emoji + unit/price/stock)  
const head = composePurchaseConfirmation({ product, qty, unit, pricePerUnit, newQuantity });
const body = `${head}\n\n✅ Successfully updated 1 of 1 items.`;
await _sendConfirmOnceByBody(From, detectedLanguage, requestId, body);
}

function chooseHeader(count, compact = true, isPrice = false) {
  if (compact) {
    return count > 1 ? (isPrice ? '✅ Prices updated:\n' : '✅ Done:\n') : '';
  }
  return isPrice ? '✅ Price updates processed:\n\n' : '✅ Updates processed:\n\n';
}


// --- Fallback: define generateMultiLanguageResponse if missing
if (typeof generateMultiLanguageResponse === 'undefined') {
  /**
   * Minimal fallback: return original text unchanged.
   * Prevents crashes when the real localization engine isn't loaded.
   * (Now single-script only: no bilingual/native+roman output anywhere.) **/
  function generateMultiLanguageResponse(text, languageCode = 'en', requestId = '') {        
    const lc = String(languageCode ?? 'en').toLowerCase();
        const mapLang = (l) => l.endsWith('-latn') ? l.replace('-latn','') : l;
        const L = mapLang(lc);
        // Tiny deterministic dictionaries to avoid English-only fallbacks for common short lines
        const DICT = {
          // Hindi native
          'hi': {
            'Demo:': 'डेमो:',
            'Help:': 'मदद:',
            'Processing your message…': 'आपका संदेश प्रोसेस हो रहा है…',
            'Reply “Demo” to see a quick walkthrough; “Help” for support & contact.':
              '“Demo” लिखें वॉकथ्रू के लिए; “Help” लिखें सपोर्ट/कॉन्टैक्ट के लिए।'
          },
          // Roman Hindi (Hinglish)
          'hi-latn': {
            'Demo:': 'Demo:',
            'Help:': 'Madad:',
            'Processing your message…': 'Aapka sandesh process ho raha hai…',
            'Reply “Demo” to see a quick walkthrough; “Help” for support & contact.':
              '“Demo” likho walkthrough ke liye; “Help” likho support/contact ke liye.'
          },                   
        // Bengali
               'bn': {
                 'Demo:': 'ডেমো:',
                 'Help:': 'সহায়তা:',
                 'Processing your message…': 'আপনার বার্তা প্রক্রিয়াকরণ হচ্ছে…',
                 'Reply “Demo” to see a quick walkthrough; “Help” for support & contact.':
                 'দ্রুত ওয়াকথ্রু দেখতে “ডেমো” লিখুন; সহায়তা/যোগাযোগের জন্য “হেল্প” লিখুন।'
               },
               // Tamil
               'ta': {
                 'Demo:': 'டெமோ:',
                 'Help:': 'உதவி:',
                 'Processing your message…': 'உங்கள் செய்தி செயலாக்கப்படுகிறது…',
                 'Reply “Demo” to see a quick walkthrough; “Help” for support & contact.':
                 'விரைவு நடைவழிக்காக “டெமோ” தட்டச்சு செய்யவும்; ஆதரவு/தொடர்பு “ஹெல்ப்”.'
               },
               // Telugu
               'te': {
                 'Demo:': 'డెమో:',
                 'Help:': 'సహాయం:',
                 'Processing your message…': 'మీ సందేశాన్ని ప్రాసెస్ చేస్తున్నాం…',
                 'Reply “Demo” to see a quick walkthrough; “Help” for support & contact.':
                 'వాక్‌థ్రూ కోసం “డెమో” టైప్ చేయండి; సహాయం/సంప్రదించడానికి “హెల్ప్”.'
               },
               // Kannada
               'kn': {
                 'Demo:': 'ಡೆಮೊ:',
                 'Help:': 'ಸಹಾಯ:',
                 'Processing your message…': 'ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಸಂಸ್ಕರಿಸಲಾಗುತ್ತಿದೆ…',
                 'Reply “Demo” to see a quick walkthrough; “Help” for support & contact.':
                 'ತ್ವರಿತ ವಾಕ್‌ಥ್ರೂಗೆ “ಡೆಮೊ” ಟೈಪ್ ಮಾಡಿ; ಸಹಾಯ/ಸಂಪರ್ಕಕ್ಕೆ “ಹೆಲ್ಪ್”.'
               },
               // Marathi
               'mr': {
                 'Demo:': 'डेमो:',
                 'Help:': 'मदत:',
                 'Processing your message…': 'आपला संदेश प्रक्रिया होत आहे…',
                 'Reply “Demo” to see a quick walkthrough; “Help” for support & contact.':
                 'जलद वॉकथ्रूसाठी “डेमो” लिहा; सपोर्ट/संपर्कासाठी “हेल्प” लिहा.'
               },
               // Gujarati
               'gu': {
                 'Demo:': 'ડેમો:',
                 'Help:': 'મદદ:',
                 'Processing your message…': 'તમારો સંદેશ પ્રોસેસ થઈ રહ્યો છે…',
                 'Reply “Demo” to see a quick walkthrough; “Help” for support & contact.':
                 'ઝડપી વૉકથ્રૂ માટે “ડેમો” લખો; સપોર્ટ/સંપર્ક માટે “હેલ્પ” લખો.'
               },
          'en': {}
        };
        const dict = DICT[lc] || DICT[L] || DICT['en'];
        let out = String(text ?? '');
        Object.keys(dict).forEach(k => { out = out.replace(new RegExp(k, 'g'), dict[k]); });
        return out;
  }
}

// ---------- SHORT/FULL SUMMARY HANDLER (used by List-Picker & buttons) ----------
// NEW: Inventory commands that must be gated behind activation, same as summaries.
// These cover all List-Picker items defined in contentCache.js LIST_LABELS
// and their canonical English forms used by handleInteractiveSelection routing.
const INVENTORY_COMMANDS = new Set([
  // Summaries
  'short summary',
  'full summary',
  // Inventory insights / queries
  'low stock',
  'reorder suggestions',
  'expiring 0',
  'expiring 7',
  'expiring 30',
  'sales today',
  'sales week',
  'sales month',
  'top 5 products month',
  'top products month',
  'value summary',
  'inventory value',
  'stock value'
]);

async function handleQuickQueryEN(cmd, From, lang = 'en', source = 'lp') {  
// Early terminal guard: if caller already passed a terminal command,
  // mark handled and short-circuit—no further normalization/re-entry.
  try {
    if (_isTerminalCommand(cmd)) {
      handledRequests.add(String(source || 'qq') + '::terminal'); // suppress late apologies in-cycle
    }
  } catch (_) { /* noop */ }
  const shopId = shopIdFrom(From);

  const sendTagged = async (body) => {    
// keep existing per-command cache key (already unique & scoped)            
        const msg0 = await tx(body, lang, From, cmd, `qq-${cmd}-${shopId}`);
         // NEW: replace English section headers with native ones to avoid mixed script
         let labeled = renderNativeglishLabels(msg0, lang);              
        // NEW: localize quoted commands inside "Next actions" (e.g., "reorder suggestions", "prices", "stock value")
         labeled = localizeQuotedCommands(labeled, lang);
         // Optional: keep English anchors (units/₹) readable inside localized text
         labeled = nativeglishWrap(labeled, lang);
         let msg = await tagWithLocalizedMode(From, labeled, lang);
        // LOCAL CLAMP → Single script; numerals normalization
        msg = enforceSingleScriptSafe(msg, lang);
        msg = normalizeNumeralsToLatin(msg).trim();
        await sendMessageViaAPI(From, msg);
  };
   
  // ---- NEW: Expiring / Expired handler ------------------------------------
    try {
      const cmdLc = String(cmd).trim().toLowerCase();
      const m = cmdLc.match(/^expiring(?:\s+(\d+))?$/);
      if (m) {
        // Parse days; default to 30 if missing (aligned with your normalizer)
        const days = Number(m[1] ?? 30);
        const strictExpired = (days === 0);
        // Fetch from Batch table via database helper (already patched to pin URL & sanitize formula)
        const rows = await getExpiringProducts(shopId, days, { strictExpired });
  
        // Format header: "Expired" for 0; else "Expiring N"
        const header = strictExpired ? '⏳ Expired' : `⏳ Expiring ${days}`;
  
        if (!rows || rows.length === 0) {
         await sendTagged(`${header}\nNone.`);
          return true;
        }
  
        // Build list; clamp to a reasonable size for WhatsApp messages
        const lines = [];
        for (const r of rows.slice(0, 40)) {
          const name = String(r.name ?? '').trim();
          const qty  = Number(r.quantity ?? 0);
          const unitDisp = displayUnit(r.unit ?? 'pieces', lang);
          // Date formatting (existing helper): show IST-friendly date/time
          const expShown = r.expiryDate ? formatDateForDisplay(r.expiryDate) : '—';
          const line = strictExpired
            ? `• ${name} — ${qty} ${unitDisp} — expired on ${expShown}`
            : `• ${name} — ${qty} ${unitDisp} — expires on ${expShown}`;
          lines.push(line);
        }
  
        const body = `${header}\n${lines.join('\n')}`;
        await sendTagged(body);
        return true;
      }
    } catch (e) {
      console.warn('[expiring-handler] failed:', e?.message);
      // Fail gracefully and let other branches run if needed
    }
 
// Helper no-op: clamp removed, keep numerals-only normalization elsewhere
  const noClamp = (s) => String(s);
              
    // -- Early activation gate for ANY inventory command (same defense as summaries)
      //    This prevents DB lookups for unactivated users and shows the same CTA prompt.
      try {
        if (INVENTORY_COMMANDS.has(String(cmd).toLowerCase())) {
          const planInfo = await getUserPlan(shopId);
          const plan = String(planInfo?.plan ?? '').toLowerCase();
          const activated = (plan === 'trial' || plan === 'paid');
          if (!activated) {                        
                // Keep EXACT same prompt text you use for summaries, per request.
                        // (If you prefer a more generic line like "To use inventory queries...",
                        // you can change only the text below without touching the gating.)
                        const prompt = await t(
                          'To use summaries, please activate your FREE trial.\nReply "Start Trial" or tap the trial button.',
                          lang,
                          `cta-summary-${shopId}`
                        );
            await sendTagged(prompt);
            return true;
          }
        }
      } catch (_e) {
        if (INVENTORY_COMMANDS.has(String(cmd).toLowerCase())) {
          const prompt = await t(
            'To use summaries, please activate your FREE trial.\nReply "Start Trial" or tap the trial button.',
            lang,
            `cta-summary-${shopId}`
          );
          await sendTagged(prompt);
          return true;
        }
      }

  if (cmd === 'short summary') {
    let hasAny = false;
    try {              
        const today = await getTodaySalesSummary(shopId);
        const inv   = await getInventorySummary(shopId);
        hasAny = !!(today?.totalSales || today?.totalValue || inv?.totalValue || (inv?.lowStock || []).length);
    } catch (_) {}
    if (!hasAny) {
      await sendTagged('📊 Short Summary — Aaj abhi koi transaction nahi hua.\n💡 Tip: “sold milk 2 ltr” try karo.');
      return true;
    } 
    
    const lines = [];
        // 1) Sales today (amount + optional orders/items)
      let todaySummary = null;
        try {                                              
            todaySummary = await getTodaySalesSummary(shopId);
                  const amtNum = Number(todaySummary?.totalSales ?? todaySummary?.totalValue ?? 0);
                  if (amtNum > 0) {
                    const amt    = Math.round(amtNum);
                    const orders = (todaySummary?.orders ?? todaySummary?.bills ?? todaySummary?.count ?? null);
                    const items  = (todaySummary?.totalItems ?? null);
                    const tail   = orders ? ` • ${orders} orders` : (items ? ` • ${items} items` : '');
                    lines.push(`🧾 Sales Today: ₹${amt}${tail}`);
                  } else {
                    // Friendlier zero-case (avoid misleading ₹0 if local tz differs)
                    lines.push(`🧾 Sales Today: no recorded sales yet (IST).`);
                  }
                } catch (_) { /* soft-fail */ }
            
                // Optional: vs yesterday (compact, aligns on totalSales)
                try {
                  const y = await getSalesSummaryPeriod(shopId, 'yesterday');
                  if (
                    y && Number.isFinite(Number(y.totalSales)) &&
                    todaySummary && Number.isFinite(Number(todaySummary.totalSales))
                  ) {
                    const diff = Number(todaySummary.totalSales) - Number(y.totalSales);
                    const sign = diff === 0 ? '＝' : (diff > 0 ? '📈' : '📉');
                    lines.push(`↔️ vs Yesterday: ${sign} ₹${Math.abs(diff).toFixed(0)}`);
                  }
                } catch (_) { /* soft-fail */ }
      
        // 2) Low stock with quantity + unit for context        
        try {
              const raw = await getLowStockProducts(shopId) ?? [];
              const l   = sanitizeProductRows(raw); // → { name, quantity, unit }
              if (l.length) {
                const MAX = 8;
                const lowList = l.slice(0, MAX).map(x => {
                  const qty  = Number(x.quantity ?? 0);
                  const unit = String(x.unit ?? '').trim();
                  return qty ? `${x.name} (${qty}${unit ? ' ' + unit : ''})` : x.name;
                });
                const more = l.length > MAX ? ` • +${l.length - MAX} more` : '';
                lines.push(`🟠 Low Stock: ${lowList.join(', ')}${more}`);
              }
            } catch (_) { /* soft-fail */ }
    
        // 3) Expiring soon (7 days) with days left if available
        try {
          const eRaw = await getExpiringProducts(shopId, 7, { strictExpired: false }) || [];                  
          const e = sanitizeProductRows(eRaw);
          const seen = new Set();
          const unique = [];
          for (const r of e) { if (!seen.has((r.name||'').toLowerCase())) { seen.add((r.name||'').toLowerCase()); unique.push(r); } }
          if (e.length) {
            // attempt to read daysLeft if your rows carry it (defensive)
            const fmt = (r) => {
              const days = r?.fields?.DaysLeft ?? r?.daysLeft ?? null;
              return Number.isFinite(days) ? `${r.name} (${days}d)` : r.name;
            };
            const expList = unique.slice(0,5).map(fmt).join(', ');
            lines.push(`⏳ Expiring Soon: ${expList}`);
          }
        } catch(_){}
    
        // 4) Next actions hint when there is anything actionable
        const actionable = lines.some(l => /^🟠 Low Stock:/i.test(l) || /^⏳ Expiring Soon:/i.test(l));
        if (actionable) {
          lines.push(`➡️ Next actions: • "reorder suggestions" • "prices" • "stock value"`);
        }
    
        const body = `📊 Short Summary\n${lines.join('\n') || '—'}`;
    await sendTagged(body);   
    // NEW: Attach the Inventory Short Summary PDF (same UX as invoice)
      try {
        const pdfPath = await generateInventoryShortSummaryPDF(shopId);
        // Optional: mirror your invoice safety check
        if (typeof fs !== 'undefined' && fs.existsSync && !fs.existsSync(pdfPath)) {
          throw new Error(`Generated PDF file not found: ${pdfPath}`);
        }
        const msg = await sendPDFViaWhatsApp(From, pdfPath); // From is 'whatsapp:<shopId>'
        console.log(`[qq] Inventory summary PDF sent. SID: ${msg?.sid}`);
      } catch (e) {
        console.warn('[qq] inventory PDF send failed', e?.message);
      }
    return true;
  }
  if (cmd === 'full summary') {
    try {          
        let langPref = lang;
        try {
          const pref = await getUserPreference(shopId);
          if (pref?.success && pref.language) {
            langPref = String(pref.language).toLowerCase();
          }
        } catch { /* noop */ }
        
        let insights = await generateFullScaleSummary(shopId, langPref, `qq-full-${shopId}`);
        
        // Ensure final send uses the same preferred language
        const decorated = insights?.startsWith('📊') ? insights : `📊 Full Summary\n${insights}`;

          // Optional: decorate common section headers with icons (non-destructive)
          insights = String(insights)
            .replace(/^Sales\b/m,           '🧾 Sales')
            .replace(/^Low Stock\b/m,       '🟠 Low Stock')
            .replace(/^Expiring Soon\b/m,   '⏳ Expiring Soon')
            .replace(/^Insights\b/m,        '💡 Insights');
          
          await sendTagged(decorated);
    } catch (_) {
      await sendTagged('📊 Full Summary — snapshot unavailable. Try: “short summary”.');
    }
    return true;
  }

    // (Optional) Friendlier standalone Expiring commands (0/7/30) — enable if desired
      if (cmd === 'expiring 30' || cmd === 'expiring 7' || cmd === 'expiring 0') {
        const days = cmd.endsWith('30') ? 30 : (cmd.endsWith('7') ? 7 : 0);
        try {
          const raw  = await getExpiringProducts(shopId, days, { strictExpired: false }) ?? [];
          const rows = sanitizeProductRows(raw);
          if (!rows.length) { await sendTagged(`⏳ Expiring ${days}\nNo items are expiring in ${days} days. ✅`); return true; }
          const fmt = r => {
            const d = r?.fields?.DaysLeft ?? r?.daysLeft ?? null;
            return Number.isFinite(d) ? `${r.name} (${d}d)` : r.name;
          };
          const MAX = 8, list = rows.slice(0, MAX).map(fmt), more = rows.length > MAX ? ` • +${rows.length - MAX} more` : '';
          await sendTagged(noClamp(`⏳ Expiring ${days} — None.`));
          return true;
        } catch (_) { await sendTagged(`⏳ Expiring ${days} — couldn’t fetch now. Try later.`); return true; }
      }
        
    // =========================
      // Utility commands (canonical)
      // =========================
      // 1) PRODUCTS: list / paging / search
      // Accepts:
      //   • "products" | "list products" → page 1
      //   • "products page N" | "list products N" → page N
      //   • "products search <term>" | "search products <term>"
      {
        const mList = cmd.match(/^list\s+products(?:\s+(\d+))?$/i) || cmd.match(/^products(?:\s+page\s+(\d+))?$/i);
        const mSearch = cmd.match(/^(?:products\s+search|search\s+products)\s+(.+)$/i);
        if (mList || mSearch) {
          const PAGE_SIZE = 25;
          const page = mList ? Math.max(1, parseInt(mList[1] ?? '1', 10)) : 1;
          const query = mSearch ? mSearch[1].trim() : '';
          const list = await getCurrentInventory(shopId);
          const map = new Map(); // name lc → {name, qty, unit}
          for (const r of list) {
            const name = r?.fields?.Product?.trim();
            if (!name) continue;
            const qty  = r?.fields?.Quantity ?? 0;
            const unit = r?.fields?.Units ?? 'pieces';
            map.set(name.toLowerCase(), { name, qty, unit });
          }
          let items = Array.from(map.values());
          if (query) {
            const q = query.toLowerCase();
            items = items.filter(x => x.name.toLowerCase().includes(q));
          }
          items.sort((a,b) => a.name.localeCompare(b.name, undefined, {sensitivity:'base'}));
          const total = items.length;
          const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
          const pageSafe = Math.min(page, totalPages);
          const start = (pageSafe - 1) * PAGE_SIZE;
          const pageItems = items.slice(start, start + PAGE_SIZE);
    
          let header = query
            ? `🧾 Products matching “${query}” — ${pageItems.length} of ${total}`
            : `🧾 Products — Page ${pageSafe}/${totalPages} — ${pageItems.length} of ${total}`;
          if (total === 0) {
            const msg0 = await tx(`${header}\nNo products found.`, lang, From, cmd, `qq-products-${shopId}`);
            const msg = await tagWithLocalizedMode(From, msg0, lang);
            await sendMessageViaAPI(From, msg);
            return true;
          }
          const lines = pageItems.map(p => `• ${p.name} — ${p.qty} ${p.unit}`);
          let body = `${header}\n\n${lines.join('\n')}`;
          if (!query && pageSafe < totalPages) {
            body += `\n\n➡️ Next page: "products ${pageSafe+1}"`;
          } else if (query && pageSafe < totalPages) {
            body += `\n\n➡️ Next page: "products ${pageSafe+1}" (repeat the search term)`;
          }
          body += `\n🔎 Search: "products search <term>"`;
          await sendTagged(body);
          return true;
        }
      }
    
      // 2) PRICES: needing update (paged)
      // Accepts: "prices" | "price updates" | "stale prices" | with optional "page N"
      {
        const mPrice = cmd.match(/^(?:prices|price\s*updates|stale\s*prices)(?:\s+(?:page\s+)?(\d+))?$/i);
        if (mPrice) {
          const page = mPrice[1] ? parseInt(mPrice[1], 10) : 1;
          const out = await sendPriceUpdatesPaged(From, lang, `qq-prices-${shopId}`, page);
          if (out) await sendTagged(out);
          return true;
        }
      }
    
      // 3) STOCK for product (single-product lookup)
      // Accepts: "stock <product>" | "inventory <product>" | "qty <product>"
      {
        const mStock = cmd.match(/^(?:stock|inventory|qty)\s+(.+)$/i);
        if (mStock) {
          const rawQuery = mStock[1].trim().replace(/[?।。.!,;:\u0964\u0965]+$/u, '');
          const product = await translateProductName(rawQuery, `qq-stock-${shopId}`);
          try {
            const exact = await getProductInventory(shopId, product);
            if (exact?.success) {
              const qty = exact.quantity ?? 0;
              const unit = exact.unit ?? 'pieces';
              await sendTagged(`📦 Stock — ${product}: ${qty} ${unit}`);
              return true;
            }
          } catch (e) {
            console.warn(`[qq-stock] getProductInventory failed:`, e?.message);
          }
          // Fuzzy fallback
          try {
            const list = await getCurrentInventory(shopId);
            const norm = s => String(s ?? '').toLowerCase().trim();
            const qN = norm(product);
            let best = null, bestScore = 0;
            for (const r of list) {
              const name = r?.fields?.Product;
              if (!name) continue;
              const n = norm(name);
              if (!n || !qN) continue;
              let score = 0;
              if (n === qN) score = 3;
              else if (n.includes(qN) || qN.includes(n)) score = 2;
              else {
                const qw = qN.split(/\s+/).filter(w => w.length > 2);
                const nw = n.split(/\s+/).filter(w => w.length > 2);
                const overlap = qw.filter(w => nw.includes(w)).length;
                if (overlap > 0) score = 1;
              }
              if (score > bestScore) { bestScore = score; best = r; }
            }
            let message;
            if (!best) {
              message = `📦 ${rawQuery}: not found in inventory.`;
            } else {
              const qty = best?.fields?.Quantity ?? 0;
              const unit = best?.fields?.Units ?? 'pieces';
              const name = best?.fields?.Product ?? product;
              message = `📦 Stock — ${name}: ${qty} ${unit}`;
            }
            await sendTagged(message);
            return true;
          } catch (e) {
            console.warn(`[qq-stock] Fallback list scan failed:`, e?.message);
            await sendTagged(`📦 ${rawQuery}: not found in inventory.`);
            return true;
          }
        }
      }
    
      // 4) Batches per product (purchase & expiry)
      // Accepts: "batches <product>" | "expiry <product>"
      {
        const mBatch = cmd.match(/^(?:batches?|expiry)\s+(.+)$/i);
        if (mBatch) {
          const rawQuery = mBatch[1].trim().replace(/[?।。.!,;:\u0964\u0965]+$/u, '');
          const product = await translateProductName(rawQuery, `qq-batches-${shopId}`);
          // Prefer helper returning remaining batches
          try {
            const exact = await getBatchesForProductWithRemaining(shopId, product);
            if (Array.isArray(exact) && exact.length > 0) {
              const lines = exact.map(b => {
                const q  = b.quantity ?? b.fields?.Quantity ?? 0;
                const u  = b.unit ?? b.fields?.Units ?? 'pieces';
                const pd = b.purchaseDate ?? b.fields?.PurchaseDate ?? null;
                const ed = b.expiryDate   ?? b.fields?.ExpiryDate   ?? null;
                return `• ${q} ${u}\n Bought: ${formatDateForDisplay(pd ?? '—')}\n Expiry: ${formatDateForDisplay(ed ?? '—')}`;
              }).join('\n');
              let message = `📦 Batches — ${product}:\n${lines}`;
              const soon = exact.filter(b => (b.expiryDate ?? b.fields?.ExpiryDate) &&
                daysBetween(new Date(b.expiryDate ?? b.fields?.ExpiryDate), new Date()) <= 7);
              if (soon.length) message += `\n\n💡 ${soon.length} batch(es) expiring ≤7 days — clear with FIFO/discounts.`;
              await sendTagged(message);
              return true;
            }
          } catch (e) {
            console.warn(`[qq-batches] exact fetch failed:`, e?.message);
          }
          // Fuzzy fallback
          try {
            const all = await getBatchRecords(shopId, product);
            const valid = all.filter(b => !!b?.fields?.Product && (b.fields.Quantity ?? 0) > 0);
            const norm = s => String(s ?? '').toLowerCase().trim();
            const qN = norm(product);
            const scored = valid.map(b => {
              const n = norm(b.fields.Product);
              let score = 0;
              if (n === qN) score = 3;
              else if (n.includes(qN) || qN.includes(n)) score = 2;
              else {
                const qw = qN.split(/\s+/).filter(w => w.length > 2);
                const nw = n.split(/\s+/).filter(w => w.length > 2);
                const overlap = qw.filter(w => nw.includes(w)).length;
                if (overlap > 0) score = 1;
              }
              return { score, rec: b };
            }).sort((a,b) => b.score - a.score);
            const topName = scored.length ? scored[0].rec.fields.Product : null;
            const active = valid.filter(b => b.fields.Product === topName);
            let message;
            if (!active.length) {
              message = `📦 No active batches found for ${rawQuery}.`;
            } else {
              const lines = active.map(b => {
                const q  = b.fields.Quantity ?? 0;
                const u  = b.fields.Units ?? 'pieces';
                const pd = b.fields.PurchaseDate ? formatDateForDisplay(b.fields.PurchaseDate) : '—';
                const ed = b.fields.ExpiryDate   ? formatDateForDisplay(b.fields.ExpiryDate)   : '—';
                return `• ${q} ${u}\n Bought: ${pd}\n Expiry: ${ed}`;
              }).join('\n');
              message = `📦 Batches — ${topName ?? product}:\n${lines}`;
              const soon = active.filter(b => b.fields.ExpiryDate && daysBetween(new Date(b.fields.ExpiryDate), new Date()) <= 7);
              if (soon.length) message += `\n\n💡 ${soon.length} batch(es) expiring ≤7 days — clear with FIFO/discounts.`;
            }
            await sendTagged(message);
            return true;
          } catch (e) {
            console.warn(`[qq-batches] fallback failed:`, e?.message);
            await sendTagged(`📦 No active batches found for ${rawQuery}.`);
            return true;
          }
        }
      }
        
        // -------------------------------
              // NEW: Low Stock (fully localized)
              // -------------------------------
              if (cmd === 'low stock') {
                try {
                  const shopId = String(From).replace('whatsapp:', '');
        
                  // If nothing is low, send a localized "no alerts" line.
                  const rows = sanitizeProductRows(await getLowStockProducts(shopId) ?? []);
                  const count = rows.length;
                  if (!count) {
                    // Localize this short line via t(), then pass through your standard pipeline.
                    let zeroLine = await t('🟢 Low Stock — No alerts right now.', lang, `lowstock::none::${shopId}`);
                    zeroLine = renderNativeglishLabels(zeroLine, lang);
                    zeroLine = localizeQuotedCommands(zeroLine, lang);
                    zeroLine = nativeglishWrap(zeroLine, lang);
                    let msg = await tagWithLocalizedMode(From, zeroLine, lang);
                    msg = enforceSingleScriptSafe(msg, lang);
                    msg = normalizeNumeralsToLatin(msg).trim();
                    await sendMessageViaAPI(From, msg);
                    return true;
                  }
        
                  // Use your dedicated localized composer: Hindi/Hinglish headers, translated units & names.
                  const composed = await composeLowStockLocalized(shopId, lang, `lowstock::${shopId}`);
        
                  // Keep your existing label/quote/anchor pipeline so "Next actions" quoted commands localize.
                  let labeled = renderNativeglishLabels(composed, lang);
                  labeled     = localizeQuotedCommands(labeled, lang);
                  labeled     = nativeglishWrap(labeled, lang);
                  let msg     = await tagWithLocalizedMode(From, labeled, lang);
                  msg         = enforceSingleScriptSafe(msg, lang);     // numerals-only normalization
                  msg         = normalizeNumeralsToLatin(msg).trim();   // ASCII digits
        
                  // IMPORTANT: sendMessageDedup expects `From` (WhatsApp format), not `shopId`.
                  await sendMessageDedup(From, msg);
                } catch (e) {
                  // Localized fallback on error
                  let err = await t('🟠 Low Stock — snapshot unavailable. Try again in a minute.', lang, 'lowstock::error');
                  err = renderNativeglishLabels(err, lang);
                  err = nativeglishWrap(err, lang);
                  err = enforceSingleScriptSafe(err, lang);
                  err = normalizeNumeralsToLatin(err).trim();
                  await sendMessageViaAPI(From, err);
                }
                return true;
              }
                    
          // --------------------------------------
          // NEW: Reorder Suggestions (velocity-based) — FIXED
          // --------------------------------------
          if (cmd === 'reorder suggestions') {
            try {
              const { success, suggestions, days, leadTimeDays, safetyDays, error } =
                await getReorderSuggestions(shopId, { days: 30, leadTimeDays: 3, safetyDays: 2 });
          
              if (!success) {
                await sendTagged('📦 Reorder Suggestions — snapshot unavailable. Try later.');
                return true;
              }
          
              const count = suggestions.length;
              if (!count) {
                await sendTagged('📦 Reorder Suggestions — No items need attention right now.');
                return true;
              }
          
              const LINES_MAX = 10;
              const lines = suggestions.slice(0, LINES_MAX).map(s => {
                const name = s.name ?? s.fields?.Product ?? '—';
                const qty  = s.reorderQty ?? s.fields?.ReorderQty ?? null;  // returned field
                const unit = s.unit ?? s.fields?.Units ?? '';                // returned field
                const base = qty ? `${qty}${unit ? ' ' + unit : ''}` : null;
                if (base) return `• ${name} — ${base}`;
                return `• ${name}`;
              }).join('\n');
          
              const moreTail = count > LINES_MAX ? `\n• +${count - LINES_MAX} more` : '';
              const header   = `📦 Reorder Suggestions — ${count} ${count === 1 ? 'item' : 'items'}`
                + ` (based on ${days}d sales, lead ${leadTimeDays}d, safety ${safetyDays}d)`;
          
              // Unify marker with global constant used by clamp/strip logic
              const NO_CLAMP_MARKER = globalThis.NO_CLAMP_MARKER || '<!NO_CLAMP!>';
              const body = `${NO_CLAMP_MARKER}${header}\n${lines}${moreTail}\n\n➡️ Action: place purchase orders for suggested quantities.`;
          
              // Optional: localize & append mode badge
              const detectedLanguage = await detectLanguageWithFallback(body, `whatsapp:${shopId}`, 'reorder-suggestions');
              const msgLocalized     = await t(body, detectedLanguage, 'reorder-suggestions');
              const msgFinal         = await tagWithLocalizedMode(`whatsapp:${shopId}`, msgLocalized, detectedLanguage);
          
              await sendMessageDedup(shopId, msgFinal);
            } catch (e) {
              await sendTagged('📦 Reorder Suggestions — snapshot unavailable. Try later.');
            }
            return true;
          }

    
      // -----------------------------------
      // NEW: Expiring (0/7/30 days window)
      // -----------------------------------          
    if (cmd === 'expiring 0' || cmd === 'expiring 7' || cmd === 'expiring 30') {
      // Exact-match to avoid "30" being misread as ending with "0"
      const days = (cmd === 'expiring 0') ? 0 : (cmd === 'expiring 7') ? 7 : 30;
        try {                  
              const rowsRaw = await getExpiringProducts(shopId, days) ?? [];
              const rows = sanitizeProductRows(rowsRaw);
              if (!rows.length) {
                await sendTagged(`${days === 0 ? '⏳ Expired' : `⏳ Expiring ${days}`} — None.`);
                return true;
              }
              const fmt = (r) => {
                const d = r?.fields?.DaysLeft ?? r?.daysLeft ?? null; // may be null (we still show names)
                return Number.isFinite(d) ? `${r.name} (${d}d)` : r.name;
              };
              const list = rows.slice(0, 10).map(fmt).join(', ');
              const header = (days === 0) ? '⏳ Expired' : `⏳ Expiring ${days}`;
              await sendTagged(noClamp(`${header}\n${list}`));
        } catch (_) {                  
              const header = (days === 0) ? '⏳ Expired' : `⏳ Expiring ${days}`;
              await sendTagged(noClamp(`${header} — snapshot unavailable.`));
        }
        return true;
      }
    
      // -----------------------------------
      // NEW: Sales (today / week / month)
      // -----------------------------------
      if (cmd === 'sales today' || cmd === 'sales week' || cmd === 'sales month') {
        const period = cmd.replace('sales ', ''); // today|week|month
        try {
          const s = await getSalesSummaryPeriod(shopId, period);                    
          const amt = Number(s?.totalValue ?? 0);
              if (!amt) {
                await sendTagged(noClamp(`🧾 Sales ${capitalize(period)} — ₹0`));
            return true;
          }
          const amtStr = amt.toFixed(0);
          const orders = (s?.orders ?? s?.bills ?? s?.count ?? null);
          const items  = (s?.totalItems ?? null);
          const tail   = orders ? ` • ${orders} orders` : (items ? ` • ${items} items` : '');
          await sendTagged(noClamp(`🧾 Sales ${capitalize(period)}\n₹${amt}${tail}`));                                        
          try {
                if (period === 'today' || period === 'week') {
                  const pdfPath = await generateSalesRawTablePDF(shopId, period);
                  if (!fs.existsSync(pdfPath)) throw new Error(`Generated PDF not found: ${pdfPath}`);
                  const msg = await sendPDFViaWhatsApp(From, pdfPath);
                  console.log(`[qq] Sales (${period}) PDF sent. SID: ${msg?.sid}`);
                }
              } catch (e) {
                console.warn('[qq] sales PDF send failed', e?.message);
              }
        } catch (_) {
          await sendTagged(noClamp(`🧾 Sales ${capitalize(period)} — snapshot unavailable.`));
        }
        return true;
      }
    
      // -------------------------------------------------
      // NEW: Top 5 Products Month (alias: top products month)
      // -------------------------------------------------
      if (cmd === 'top 5 products month' || cmd === 'top products month') {
        try {                  
        const { top = [] } = await getTopSellingProductsForPeriod(shopId, 'month');
        if (!top || top.length === 0) {
            await sendTagged(noClamp('🏆 Top Products (Month) — No data yet.'));
            return true;
          }
          const lines = top.slice(0, 5).map((t, i) => {
            const name = t.name ?? t.fields?.Product ?? '—';
            const qty  = t.qty ?? t.fields?.Qty ?? t.itemsSold ?? null;
            return qty ? `${i+1}. ${name} (${qty})` : `${i+1}. ${name}`;
          }).join('\n');
          await sendTagged(noClamp(`🏆 Top Products — Month\n${lines}`));
        } catch (_) {
          await sendTagged(noClamp('🏆 Top Products — snapshot unavailable.'));
        }
        return true;
      }
    
      // --------------------------------------------
      // NEW: Inventory Value / Stock Value / Summary
      // --------------------------------------------
      if (cmd === 'value summary' || cmd === 'inventory value' || cmd === 'stock value') {
        try {
          const inv = await getInventorySummary(shopId);
          const total = Number(inv?.totalValue ?? 0).toFixed(0);                    
          // Prefer canonical unique product count; keep fallbacks for compatibility
                    const items = Number(inv?.totalProducts ?? inv?.totalItems ?? inv?.count ?? 0);
                    // Optional: compute inclusive low-stock from DB helper (≤ threshold, includes 0/negatives)
                    const lowList = await getLowStockProducts?.(shopId, 5);
                    const lowCt = Array.isArray(lowList) ? lowList.length : Number(inv?.lowStock?.length ?? 0);
          const lines = [
            `💰 Total Value: ₹${total}`,
            items ? `📦 Unique Products: ${items}` : null,
            `🟠 Low Stock Alerts: ${lowCt}`
          ].filter(Boolean).join('\n');
          await sendTagged(noClamp(lines || '💰 Inventory Value — No data yet.'));
        } catch (_) {
          await sendTagged(noClamp('💰 Inventory Value — snapshot unavailable.'));
        }
        return true;
      }
  return false;
}

// ---------------------------------------------------------------------------
// STEP 3: After any AI Sales Q&A answer, send appropriate buttons.
// - Unactivated (no plan / demo): Onboarding QR (Start Trial / Demo / Help)
// - Activated (trial|paid): Purchase/Sale/Return Quick-Reply + Demo/Help CTA text
// ---------------------------------------------------------------------------
async function sendSalesQAButtons(From, lang, isActivated) {
  const toNumber = String(From).replace('whatsapp:', '');
  try {
    await ensureLangTemplates(lang);         // builds per-language templates if missing
    const sids = getLangSids(lang);

    if (!isActivated) {
      // Show onboarding quick-replies (Start Trial / Demo / Help)
      if (sids?.onboardingQrSid) {
        await sendContentTemplate({ toWhatsApp: toNumber, contentSid: sids.onboardingQrSid });
        return;
      }
      // Fallback text CTA when template missing:
      const txt = getTrialCtaText(lang);
      const NO_FOOTER_MARKER = '<!NO_FOOTER!>';
      await sendMessageQueued(From, NO_FOOTER_MARKER + await t(txt, lang, 'qa-buttons-onboard-fallback'));
      return;
    }

    // Activated users: show Purchase/Sale/Return Quick-Reply first
    if (sids?.quickReplySid) {
      try {
        await sendContentTemplate({ toWhatsApp: toNumber, contentSid: sids.quickReplySid });
      } catch (e) {
        console.warn('[qa-buttons] quickReply send failed', { status: e?.response?.status, data: e?.response?.data });
      }
    }         
    // NEW: Always follow with Inventory Query List-Picker (Short Summary, Low Stock, Expiring, Sales Today/Week, etc.)
      // This ensures that when the user types "mode" (or any localized equivalent), they see both
      // transaction actions AND inventory queries together.
      if (sids?.listPickerSid) {
        try {
          await sendContentTemplate({ toWhatsApp: toNumber, contentSid: sids.listPickerSid });
        } catch (e) {
          console.warn('[qa-buttons] listPicker send failed', { status: e?.response?.status, data: e?.response?.data });
        }
      }
  } catch (e) {
    console.warn('[qa-buttons] orchestration failed:', e?.message);
  }
}

// ---- OPTIONAL: convenience wrapper (call after every Sales-Q&A answer) ----
async function sendPostQABundle(From, detectedLanguage) {
  try {
    const toNumber = String(From).replace('whatsapp:', '');
    let lang = (detectedLanguage ?? 'en').toLowerCase();
    try {
      const pref = await getUserPreference(toNumber);
      if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
    } catch { /* noop */ }
    const plan = (await getUserPreference(toNumber))?.plan ?? '';
    const isActivated = String(plan).toLowerCase() === 'trial' || String(plan).toLowerCase() === 'paid';
    await sendSalesQAButtons(From, lang, isActivated);
  } catch (e) {
    console.warn('[post-qa-bundle] failed:', e?.message);
  }
}

// OPTIONAL: Quiet 422 Airtable errors when trying to save 'demo' as a plan
async function _safeSaveUserPlan(shopId, plan) {
  try { await saveUserPlan(shopId, plan); }
  catch (e) {
    const typ = String(e?.response?.data?.error?.type || '');
    if (typ.includes('INVALID_MULTIPLE_CHOICE_OPTIONS')) {
      // Ignore: selector disallows 'demo' option; leave plan empty for unactivated users
      return;
    }
    console.warn('[Save User Plan] unexpected error', e?.message);
  }
}

// STEP 3: Single-message DEMO transcript (text-only; video comes in Step 17)
async function sendDemoTranscriptOnce(From, lang, rid = 'cta-demo') {
  const demoEn = [
    'Demo:',
    'User: sold milk 2 ltr',
    'Bot: ✅ Sold 2 ltr milk @ ₹? each — Stock: (updated)',
    'User: purchased Parle-G 12 packets ₹10 exp +6m',
    'Bot: 📦 Purchased 12 packets Parle-G — Price: ₹10',
    '      Expiry: set to +6 months',
    'User: short summary',
    'Bot: 📊 Short Summary — Sales Today, Low Stock, Expiring Soon…',
    '',
    'Tip: type “mode” to switch Purchase/Sale/Return or make an inventory query'
  ].join('\n');
  const body = await t(demoEn, lang, rid);
  await sendMessageViaAPI(From, body);
}

// --- Replace the above sender with your deterministic Nativeglish demo everywhere it's used ---
// In handleInteractiveSelection(), change 'show_demo' branch to:
//   await sendNativeglishDemo(from, lang, `cta-demo-${shopId}`);
// (No diff here because that branch is in another section of your file; ensure it calls sendNativeglishDemo.)

// ---- Utilities for summary/date & safe parsers ----
function formatDateForDisplay(iso) {
  try {
    const d = new Date(iso);
    const dd = `${d.getDate().toString().padStart(2,'0')}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getFullYear()}`;
    return dd;
  } catch { return String(iso ?? '—'); }
}

// ===== AI onboarding & sales Q&A (Deepseek) — grounded KB (no hallucinations) =====
// Trial and Paid plans have identical features; trial is time-limited only.
const SALES_AI_MANIFEST = Object.freeze({
  product: 'Saamagrii.AI',
  capabilities: [
    // Core inventory ops
    'stock updates (purchase/sale/return)',
    'batch & expiry tracking (+2-minute override windows)',
    'sales entries & confirmations',
    // Insights & alerts
    'summaries: short / full',
    'low-stock alerts & stockout list',
    'expiring items (0 / 7 / 30 days)',
    'reorder suggestions (30-day velocity; lead + safety)',
    'inventory value summary',
    // Billing & docs
    'invoice PDF generation upon sale (trial & paid)'
  ],
  quickCommands: [
    'sold <product> <qty> <unit>',
    'purchase <product> <qty> <unit> ₹<rate> exp <dd-mm/+7d>',
    'return <product> <qty> <unit>',
    'short summary',
    'full summary',
    'low stock',
    'expiring 0|7|30',
    'sales today|week|month',
    'top 5 products month',
    'value summary',
    'batches <product>',
    'stock <product>'
  ],
  plans: {
    trialDays: TRIAL_DAYS,
    pricePerMonthINR: PAID_PRICE_INR,
    equalFeaturesNote: 'Trial has all features of the paid plan; trial is time-limited.',
    paidCTA: `Pay ₹${PAID_PRICE_INR} via Paytm → ${PAYTM_NUMBER} (${PAYTM_NAME}) or ${PAYMENT_LINK}`
  },
  guardrails: [
    'Do NOT invent features beyond this list.',
    'If out of scope, say “I’m not sure yet” and show 2–3 quick commands.',
    'Always answer in the user’s language/script (single script).',
    'Keep replies concise (3–5 short sentences).',
    'Only mention payment details when pricing is asked.'
  ]
});

// Deterministic native pricing (no MT). Uses ₹ and simple phrasing for en/hi/hi-latn.
async function composePricingAnswer(lang = 'en', flavor = 'tool_pricing', shopId = null) {
  const L = typeof canonicalizeLang === 'function' ? canonicalizeLang(lang) : String(lang ?? 'en').toLowerCase();
  const price = Number(process.env.PAID_PRICE_INR ?? 11);
  const trialDays = Number(process.env.TRIAL_DAYS ?? 3);    
  // Determine activation state (only include links when activated)
    let activated = false;
    try {
      if (shopId && typeof getUserPreference === 'function') {
        const pref = await getUserPreference(shopId);
        const plan = String(pref?.plan ?? '').toLowerCase();
        // Consider trial active only if not expired; paid is always active
        if (plan === 'trial' || plan === 'paid') activated = true;
      }
    } catch { /* noop */ }
  const map = {
    en: {
      tool: `Free trial is for ${trialDays} days • Post Trial, paid plan at ₹${price}/month`,            
      how: activated
              ? `Pay via Paytm → ${process.env.PAYTM_NUMBER} (${process.env.PAYTM_NAME}) or ${process.env.PAYMENT_LINK}`
              : `` // no link pre-trial
    },
    hi: {
      tool: `मुफ़्त ट्रायल ${trialDays} दिन • पेड प्लान ₹${price}/महीना`,            
      how: activated
              ? `पेमेंट: Paytm → ${process.env.PAYTM_NUMBER} (${process.env.PAYTM_NAME}) या ${process.env.PAYMENT_LINK}`
              : `` // no link pre-trial
    },
    'hi-latn': {
      tool: `Free trial ${trialDays} din • Trial ke baad, paid plan ₹${price}/mahina`,            
      how: activated
              ? `Payment: Paytm → ${process.env.PAYTM_NUMBER} (${process.env.PAYTM_NAME}) ya ${process.env.PAYMENT_LINK}`
              : `` // no link pre-trial
    }
  };
  const dict = map[L] ?? map.en;    
  const msg = dict.how ? `${dict.tool}\n${dict.how}` : `${dict.tool}`;
  return normalizeNumeralsToLatin(nativeglishWrap(msg, L));
}

// Helper: if target lang is non-English but output is mostly ASCII/English, replace with localized deterministic copy
function ensureLanguageOrFallback(out, language = 'en') {
  try {
    const lang = canonicalizeLang(language ?? 'en');
    const text = String(out ?? '').trim();
    if (!text) {              
        // Only fallback when output is empty
             return lang === 'hi-latn'
               ? getLocalizedQAFallback('hi-latn')
               : getLocalizedOnboarding(lang);
    }
    const nonAsciiLen = (text.match(/[^\x00-\x7F]/g) ?? []).length;
    const asciiRatio = text.length ? (text.length - nonAsciiLen) / text.length : 1;       
    // ⚠️ Do NOT treat ASCII as a reason to fallback for hi-latn.
       // Hinglish is expected to be ASCII; keep the model answer.
       // Optionally: fallback only if the text is "too short" (e.g., < 40 chars).
       if (lang === 'hi-latn' && text.length < 40) {
         return getLocalizedQAFallback('hi-latn');
       }
    // Native languages: if output is mostly ASCII (over 85%), show localized onboarding/fallback.
    if (lang !== 'en' && !lang.endsWith('-latn') && asciiRatio > 0.85) {
      return getLocalizedOnboarding(lang);
    }
    return enforceSingleScriptSafe(text, lang);
  } catch { return out; }
}


function getLocalizedOnboarding(lang = 'en') {
  switch (String(lang).toLowerCase()) {
    case 'hi':
      return `नमस्ते! WhatsApp पर स्टॉक अपडेट और एक्सपायरी ट्रैकिंग आसान बनाएं।\nकम स्टॉक अलर्ट और रीऑर्डर सुझाव से बिक्री बढ़ाएं。\nट्रायल शुरू करने के लिए “Start Trial” दबाएं。`;
    // add other languages as needed…
    default:
      return `Hey! Manage stock & expiry on WhatsApp.\nGet low‑stock alerts & smart reorder tips.\nPress “Start Trial” to begin.`;
  }
}
function getLocalizedQAFallback(lang = 'en') {
  switch (String(lang).toLowerCase()) {
    case 'hi':
      return `ठीक है! WhatsApp पर स्टॉक/एक्सपायरी ऑटोमेट करें; लो‑स्टॉक अलर्ट भी मिलेंगे。\nउदाहरण: sold milk 2 ltr • purchased Parle‑G 12 packets ₹10 exp +6m • short summary`;    
    case 'hi-latn':
    // Roman Hindi fallback when AI is unavailable or detects Hinglish
      return `Theek hai! WhatsApp par stock/expiry automate karo; low‑stock alerts milenge.\nUdaharan: sold milk 2 ltr • purchased Parle‑G 12 packets ₹10 exp +6m • short summary`;
    default:
      return `Automate stock & expiry on WhatsApp; get low‑stock alerts.\nTry: sold milk 2 ltr • purchased Parle‑G 12 packets ₹10 exp +6m • short summary`;
  }
}

async function composeAIOnboarding(language = 'en') {  
    const lang = canonicalizeLang(language ?? 'en');
      const sys =
        'You are a friendly, professional WhatsApp assistant for a small retail inventory tool. ' +
        'Respond ONLY in the target language/script; do NOT mix Roman and native. Keep brand names unchanged. ' +
      'Separate paragraphs with double newlines if multiple lines are needed.' +
      'Tone: conversational, helpful, approachable. Keep it concise. Use emojis sparingly. ' +
      'STYLE (respectful, professional): In Hindi or Hinglish, ALWAYS address the user with “aap / aapki / aapke / aapko / aapse”; NEVER use “tum…”. Use polite plural verb forms (“sakte hain”, “karenge”, “kar payenge”). ' +
      'Never invent features; stick to MANIFEST facts. End with a CTA line.';
  const manifest = JSON.stringify(SALES_AI_MANIFEST);
  const user =
    `Language: ${lang}\n` +
    `MANIFEST: ${manifest}\n` +      
    `Task: Write ONLY in ${lang} script. Produce 2 short lines of benefits from MANIFEST.capabilities, in natural ${lang}. ` +
    `Then a third line CTA: say how to start trial via the “Start Trial” button. ` +
    `If later asked product questions, answer only using MANIFEST.quickCommands; otherwise say "I'm not sure yet" and show 3 example commands. Maintain respectful “aap” tone and polite plurals.`;
  try {
    console.log('AI_AGENT_PRE_CALL', { kind: 'onboarding', language: lang });
    const resp = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        temperature: 0.5,
        max_tokens: 220
      },
      {
        headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 10000
      }
    );                              
    let body = String(resp.data?.choices?.[0]?.message?.content ?? '').trim();
        // Ensure localized text and enforce single script + ASCII numerals
        body = enforceSingleScriptSafe(body, lang);
    body = ensureLanguageOrFallback(body, lang);
    body = enforceSingleScript(body, lang);
    console.log('AI_AGENT_POST_CALL', { kind: 'onboarding', ok: !!body, length: body?.length || 0 });
    return body;
  } catch {
    // Deterministic, grounded fallback (no AI, no hallucination)        
    const fallback = getLocalizedOnboarding(lang);
    console.warn('AI_AGENT_FALLBACK_USED', { kind: 'onboarding' });
    return fallback;
  }
}

// NEW: Grounded sales Q&A for short questions like “benefits?”, “how does it help?”
async function composeAISalesAnswer(shopId, question, language = 'en') {
// Fast-pricing detector (English + Hindi)
  const q = String(question ?? '').trim();
  const isPricing = /\b(price|cost|charges?)\b/i.test(q) || /क़ीमत|कीमत|मूल्य|भाव|लागत/i.test(q);
  if (isPricing) {
    // Pick flavor based on activation + whether question seems inventory-related
    let activated = false;
    try {
      const pref = await getUserPreference(shopId);
      const plan = String(pref?.plan ?? '').toLowerCase();
      activated = (plan === 'trial' || plan === 'paid');
    } catch {}
    const flavor = (activated && /\b(inventory|stock|summary|sales)\b/i.test(q))
      ? 'inventory_pricing'
      : 'tool_pricing';      
  const pricingText = await composePricingAnswer(language, flavor, shopId); // pass shopId
    const aiNative = enforceSingleScriptSafe(pricingText, language);
    // brand preserved by nativeglishWrap (Patch 1)
    return normalizeNumeralsToLatin(nativeglishWrap(aiNative, language));
  }

const lang = canonicalizeLang(language ?? 'en');

  // ---------- Generic, extensible domain classification ----------
  // Optional: pull a saved category from preferences if you later store it
  async function getShopCategory(shopId) {
    try {
      const pref = await getUserPreference(shopId);
      const cat = String(pref?.shopCategory ?? '').toLowerCase().trim();
      return cat || null;
    } catch { return null; }
  }
  const DOMAIN_MAP = {
    mobile: {
      rx: /\b(mobile|mobiles|phone|smart ?phone|accessor(y|ies)|charger|earpho(ne|nes)|tempered\s?glass|cover|case)\b/i,
      examples: ['sold cover 2 pieces', 'purchased charger 10 pieces ₹120', 'stock earphones'],
      benefits: {
        'hi-latn': 'Aapki mobile shop ke liye: stock/expiry auto-update, low-stock alerts (covers, chargers, earphones), smart reorder tips.',
        hi: 'आपकी मोबाइल शॉप के लिए: स्टॉक/एक्सपायरी ऑटो‑अपडेट, लो‑स्टॉक अलर्ट (कवर, चार्जर, ईयरफ़ोन), स्मार्ट री‑ऑर्डर सुझाव।'
      }
    },
    garments: {
      rx: /\b(garment|garments|kapde|clothes|apparel|shirts?|t[- ]?shirts?|jeans|kurta|salwar|saree|dress|hoodie|sweater|size|xl|l|m|s|xxl)\b/i,
      examples: ['sold t-shirt L 3 pieces', 'purchased jeans 12 pieces ₹550', 'stock saree'],
      benefits: {
        'hi-latn': 'Kapdon ke liye: SKU/size tracking, low-stock alerts (sizes), fast reorder tips, daily summary.',
        hi: 'कपड़ों के लिए: SKU/साइज़ ट्रैकिंग, लो‑स्टॉक अलर्ट (साइज़), तेज री‑ऑर्डर सुझाव, दैनिक सारांश।'
      }
    },
    pickle: {
      rx: /\b(pickle|achaar|aachar|factory|batch|jar|bottle)\b/i,
      examples: ['sold mango pickle 5 bottles', 'purchased lemon pickle 20 jars ₹80 exp +6m', 'batches mango pickle'],
      benefits: {
        'hi-latn': 'Achar/pickle ke liye: batch & expiry tracking, low-stock alerts, smart reorder tips, daily summaries.',
        hi: 'अचार/पिकल के लिए: बैच व एक्सपायरी ट्रैकिंग, लो‑स्टॉक अलर्ट, स्मार्ट री‑ऑर्डर सुझाव, दैनिक सारांश।'
      }
    }
  };
  function classifyDomain(msg, hintedCategory = null) {
    const m = String(msg ?? '');
    const hint = String(hintedCategory ?? '').toLowerCase();
    // 1) explicit hint wins if present
    if (hint && DOMAIN_MAP[hint]) return hint;
    // 2) regex match
    for (const [key, cfg] of Object.entries(DOMAIN_MAP)) {
      if (cfg.rx.test(m)) return key;
    }
    return null;
  }

  // ---- NEW: topic & pricing flavor ----
  function isPricingQuestion(msg) {
    const t = String(msg ?? '').toLowerCase();
    const en = /\b(price|cost|charge|charges|rate)\b/;
    const hing = /\b(kimat|daam|rate|price kya|kitna|kitni)\b/;
    const hiNative = /(कीमत|दाम|भाव|रेट|कितना|कितनी)/;
    return en.test(t) || hing.test(t) || hiNative.test(msg);
  }
  function isBenefitQuestion(msg) {
    const t = String(msg ?? '').toLowerCase();
    return /\b(benefit|daily benefit|value|help|use case)\b/.test(t)
        || /(फ़ायदा|लाभ|मदद|दैनिक)/.test(msg)
        || /\b(fayda)\b/.test(t);
  }
  function isCapabilitiesQuestion(msg) {
    const t = String(msg ?? '').toLowerCase();
    return /\b(what.*do|what does it do|exactly.*does|how does it work|kya karta hai)\b/.test(t)
        || /(क्या करता है|किस काम का है|कैसे चलता है)/.test(msg)
        || /\b(kya karta hai)\b/.test(t);
  }
  function classifyQuestionTopic(msg) {
    if (isPricingQuestion(msg)) return 'pricing';
    if (isBenefitQuestion(msg)) return 'benefits';
    if (isCapabilitiesQuestion(msg)) return 'capabilities';
    return null;
  }

  function looksLikeInventoryPricing(msg) {
    const s = String(msg ?? '').toLowerCase();
    const unitRx = /(kg|kgs|g|gm|gms|ltr|ltrs|l|ml|packet|packets|piece|pieces|बॉक्स|टुकड़ा|नंग)/i;
    const moneyRx = /(?:₹|rs\.?|rupees)\s*\d+(?:\.\d+)?/i;
    const brandRx = /(milk|doodh|parle\-g|maggi|amul|oreo|frooti|marie gold|good day|dabur|tata|nestle)/i;
    return unitRx.test(s) || moneyRx.test(s) || brandRx.test(s);
  }
  const topic = classifyQuestionTopic(question);
  let pricingFlavor = null; // 'tool_pricing' | 'inventory_pricing' | null
  if (topic === 'pricing') {
    let activated = false;
    try {
      const pref = await getUserPreference(shopId);
      const plan = String(pref?.plan ?? '').toLowerCase();
      activated = (plan === 'trial' || plan === 'paid');
    } catch { /* noop */ }
    pricingFlavor = (activated && looksLikeInventoryPricing(question)) ? 'inventory_pricing' : 'tool_pricing';
  }

  // --------------------------------------------------------------------------
  // NEW: Short-circuit pricing questions with deterministic native answer
  // --------------------------------------------------------------------------
  if (topic === 'pricing') {
    // Compose deterministic native copy (no MT, single-script)
    const pricingText = await composePricingAnswer(lang, pricingFlavor);
    return pricingText;
  }
   
 // ---- NEW: Hinglish enforcement note ----
  const targetScriptNote =        
    lang === 'hi-latn'
        ? 'Respond ONLY in Roman Hindi (Hinglish; language code hi-Latn). Keep sentences short and natural Hinglish.'
        : `Respond ONLY in ${lang} native script.`;

  // If user asks about invoice, force an explicit line in the reply about PDFs
  const mustMentionInvoice = /\b(invoice|बिल|चालान)\b/i.test(String(question ?? ''));              
            
    const sys = `
    You are a helpful WhatsApp assistant. ${targetScriptNote}
    Be concise (3–5 short sentences). Use ONLY MANIFEST facts; never invent features.
    If pricing/cost is asked, include: Saamagrii.AI offers free trial for ${TRIAL_DAYS} days, then ₹${PAID_PRICE_INR}/month.
    Answer directly to the user's question topic; do not repeat onboarding slogans.
    ${mustMentionInvoice ? 'If asked about invoice, clearly state that sale invoices (PDF) are generated automatically in both trial and paid plans.' : ''}        
    Identity: If the user asks for your name or who you are (e.g., "what's your name", "tumhara naam kya hai", "तुम्हारा नाम क्या है"),
        reply with exactly: "Name - ${process.env.AGENT_NAME ?? 'Suhani'}, Saamagrii.AI <friend>".
        Localize the leading label ("Name"/localized equivalent) and the word "friend" to the user's language/script (hi → Devanagari; hi-Latn → Hinglish; bn/ta/te/kn/mr/gu → native),
        but always keep "Saamagrii.AI" in Latin. One sentence only; no emojis, no upsell; do not consult or reuse any translation caches.
    STYLE (respectful, professional):
    - In Hindi or Hinglish or any Native+English, ALWAYS address the user with “aap / aapki / aapke / aapko / aapse”.
    - NEVER use “tum / tumhari / tumhara / tumhare / tumko / tumse”.
    - Use polite plural verb forms: “sakte hain”, “karenge”, “kar payenge”; avoid “sakte ho”, “karoge”, “kar paoge”.
    - In Hindi or Hinglish or any Native+English, always ensure numerals/numbers are in roman script only - e.g. केवल ₹11 प्रति माह.
    FORMAT RULES (strict):
    - Do NOT use code fences (no triple backticks).
    - Do NOT use inline backticks (no backtick characters).
    - Avoid bullet lists; prefer short sentences.
    `.trim();

  const manifest = JSON.stringify(SALES_AI_MANIFEST);

  
    // Keep user instructions tight & topic-aware
      const topicGuide = (() => {
        switch (topic) {
          case 'pricing':
            return pricingFlavor === 'inventory_pricing'
              ? 'User is asking for PRODUCT PRICE. Give short guidance: how to set/see item rates (purchase entry with ₹rate, or "prices" / "products price" query). Avoid subscription pricing unless asked.'
              : 'User is asking for TOOL PRICE. Provide plan details (trial days & monthly price).';
          case 'benefits':
            return 'User is asking for BENEFITS. List 3 everyday, practical benefits (alerts, reorder tips, summaries). No pricing unless asked.';
          case 'capabilities':
            return 'User is asking WHAT IT DOES. State 3 core capabilities (stock updates, expiry tracking, summaries) in simple language.';
          default:
            return 'If topic unknown, give 2–3 most relevant capabilities succinctly.';
        }
      })();

  
    const user = (     
    (`Language: ${lang}
         MANIFEST: ${manifest}
         QuestionTopic: ${topic ?? 'unknown'}
         PricingFlavor: ${pricingFlavor ?? 'n/a'}
         UserQuestion: ${question}
         Rules: ${targetScriptNote}. Keep it crisp and on-topic.`).trim()
    );

  try {    
    // [UNIQ:QA-CACHE-KEY-002A] Robust key & variant lock for sales-qa
      const langExactAgent = ensureLangExact(lang);            // keep 'hi-latn' if present
      const topicForced = topic;
      const flavor = pricingFlavor;
      const userText = question;
      const promptHash = buildSalesQaCacheKey({
        langExact: langExactAgent,
        topicForced,
        pricingFlavor: flavor,
        text: userText
      });
      console.log('AI_AGENT_PRE_CALL', {
        kind: 'sales-qa', language: langExactAgent, topic: topicForced, pricingFlavor: flavor, promptHash
      });
      
    // [UNIQ:QA-PROMPT-PRICING-004] Topic-aware system prompt
      // Strengthen pricing so the model includes actual price tokens.
      // -------------------------------------------------------------------
      // Existing parts in your function: sys, manifest, topicGuide, user
      // We derive a topic-focused system prompt without touching your base sys.
      let sysForTopic = sys;
      if (topicForced === 'pricing') {
        sysForTopic = `${sys}
    
    You are answering a PRICING question for Saamagrii.AI.
    REQUIREMENTS:
    - Include at least one price token: use ₹ amounts or 'Rs'/'INR' plus digits.
    - Mention current plan(s) or trial info if applicable.
    - Keep the answer under 2 lines suitable for WhatsApp.
    - Do NOT describe generic benefits unless the user specifically asked for benefits.
    - Maintain respectful Hindi/Hinglish tone: “aap…” forms and polite plurals (“sakte hain”, “karenge”, “kar payenge”); never “tum…”.
    `;
      }
    const resp = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: sysForTopic }, { role: 'user', content: user }],
        temperature: 0.2,
        max_tokens: 220
      },
      {
        headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 10000
      }
    );               
    let out = String(resp.data?.choices?.[0]?.message?.content ?? '').trim();          
    try {
        console.log(`[${requestId}] [dbg] agentRaw="${out?.slice(0,200)}" lang=${langExactAgent} topic=${topicForced} flavor=${flavor}`);
      } catch (_) { /* no-op */ }   
          
    // ---- Domain-aware benefits (generic hook) ----
      let shopCat = await getShopCategory(shopId);
      const domain = classifyDomain(question, shopCat);
      if (topic === 'benefits' && domain && DOMAIN_MAP[domain]) {
        const cfg = DOMAIN_MAP[domain];
        const benefitLine = cfg.benefits[lang] || cfg.benefits['hi-latn'] || null;
        const ex = cfg.examples?.slice(0,3).join(' • ');
        if (benefitLine) out = `${benefitLine}\nUdaharan: ${ex}`;
      }

    // [UNIQ:PRICING-GUARD-003] Strict retry if pricing answer lacks price
      // -------------------------------------------------------------------
      if ((topicForced === 'pricing' || flavor) && !isPricingAnswer(out)) {
        console.warn(`[${requestId}] [UNIQ:PRICING-GUARD-003] First pricing answer lacked price tokens; retrying with stricter prompt.`);
        const sysPricingStrict = `${sysForTopic}
    
    Return a concise pricing answer that MUST include at least one price token:
    - Use ₹ amounts or 'Rs'/'INR' plus digits.
    - Mention plan/duration if relevant.
    - Keep under 2 lines for WhatsApp.
    `;
        try {
          const resp2 = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: sysPricingStrict },
              { role: 'user', content: user }
            ],
            max_tokens: 220,
            temperature: 0.2
          }, {
            headers: {
              'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: Number(process.env.SALES_QA_TIMEOUT_MS ?? 15000)
          });
          const out2 = String(resp2.data?.choices?.[0]?.message?.content ?? '').trim();
          if (isPricingAnswer(out2)) out = out2;
          console.log(`[${requestId}] [UNIQ:PRICING-GUARD-003] Retry pricing ok=${isPricingAnswer(out2)} length=${out2.length}`);
        } catch (e) {
          console.warn(`[${requestId}] [UNIQ:PRICING-GUARD-003] Strict retry failed: ${e?.message}`);
        }
      }

    // --- NEW: Hinglish-aware fallback + nativeglish anchors ---         
    // Avoid generic benefits fallback for pricing in *-latn flows        
    if (!(topicForced === 'pricing' && langExactAgent.endsWith('-latn'))) {
          out = ensureLanguageOrFallback(out, lang); // keep fallback for non-pricing topics
        }
        out = nativeglishWrap(out, lang);
        // Final single-script guard for any residual mixed content; de-echo first
        const out0 = normalizeTwoBlockFormat(out, lang);                
        out = enforceSingleScriptSafe(out0, lang);      
          
        // (kept compatible) Specific overrides still work if you ever pass flags
          if (topic === 'benefits' && typeof isMobileShop !== 'undefined' && isMobileShop) {
            if (lang === 'hi-latn') {
              // Hinglish, single-script, concise and domain-specific
              out = 'Aapki mobile shop ke liye daily fayda: stock/expiry auto-update, low-stock alerts (covers, chargers, earphones), smart reorder tips. “short summary” se aaj ki sales & low-stock ek line me mil jaayegi.';
            } else if (lang === 'hi') {
              // Native Hindi, single-script
              out = 'आपकी मोबाइल शॉप के लिए रोज़ाना फ़ायदा: स्टॉक/एक्सपायरी ऑटो‑अपडेट, लो‑स्टॉक अलर्ट (कवर, चार्जर, ईयरफ़ोन), स्मार्ट री‑ऑर्डर सुझाव। “छोटा सारांश” से आज की बिक्री व लो‑स्टॉक एक लाइन में मिल जाएगी।';
            }
          }

        try {        
          const q = String(question || '').toLowerCase();                
          const askedPrice = /(?:price|cost|charges?)/.test(q) || /(\bकीमत\b|\bमूल्य\b|\bदाम\b)/i.test(question) || /\b(kimat|daam|rate)\b/i.test(q);                     
          let _activated = false;
           try {
             const pref = await getUserPreference(shopId);
             const plan = String(pref?.plan ?? '').toLowerCase();
             _activated = (plan === 'trial' || plan === 'paid');
           } catch {}
           if (_activated && INLINE_PAYTM_IN_PRICING && askedPrice && pricingFlavor === 'tool_pricing') {
            // Keep it short and language-neutral (numbers/brand names OK in single-script output)
            const line = `\nPaytm → ${PAYTM_NUMBER} (${PAYTM_NAME})`;
            out = out + line;
          }
        } catch (_) { /* no-op */ }    
    // Final single-script guard for any residual mixed content
      const finalOut = enforceSingleScript(out, lang);
      console.log('AI_AGENT_POST_CALL', { kind: 'sales-qa', ok: !!out, length: out?.length ?? 0, topic, pricingFlavor });
      return finalOut;
  } catch {
    // --- NEW: contextual fallbacks (Hinglish-aware) ---
        console.warn('AI_AGENT_FALLBACK_USED', { kind: 'sales-qa', topic, pricingFlavor });
        if (lang === 'hi-latn') {
          if (topic === 'pricing') {
            if (pricingFlavor === 'inventory_pricing') {
              return `Inventory item ka rate set/dekhne ke liye entry me ₹rate likho: "purchased Parle-G 12 packets ₹10", ya "prices" command use karo.`;
            } else {
              return `Free trial ${TRIAL_DAYS} din ka hai; uske baad ₹${PAID_PRICE_INR}/month. Payment Paytm ${PAYTM_NUMBER} par ya link se ho sakta hai.`;
            }
          }
          if (topic === 'benefits') {                                            
            // Generic domain-aware Hinglish fallback
                  try {
                    const cat = await getShopCategory(shopId);
                    const dom = classifyDomain(question, cat);
                    if (dom && DOMAIN_MAP[dom]) {
                      const cfg = DOMAIN_MAP[dom];
                      const ex = cfg.examples?.slice(0,3).join(' • ');
                      return `${cfg.benefits['hi-latn']}\nUdaharan: ${ex}`;
                    }
                  } catch {}
                  return `Daily fayda: stock/expiry auto-update, low-stock alerts, smart reorder tips. Aaj ka "short summary" bhi milta hai.`;
          }
          if (topic === 'capabilities') {
            return `WhatsApp par stock update, expiry tracking, aur summaries. Bas "sold milk 2 ltr" ya "purchased Parle-G 12 packets ₹10 exp +6m" type karo.`;
          }
        }
        return getLocalizedQAFallback(lang);
  }
}

// ===== Access Gate & Onboarding =====
async function ensureAccessOrOnboard(From, Body, detectedLanguage) {
  try {
    const shopId = String(From).replace('whatsapp:', '');
    let lang = (detectedLanguage ?? 'en').toLowerCase();
    try {
      const pref = await getUserPreference(shopId);
      if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
    } catch {}
    const text = String(Body ?? '').trim().toLowerCase();
    // Fast path: "paid" confirmation (Hinglish + English variants)
    if (/\b(paid|payment done|paydone|maine pay kiya|paid ho gaya)\b/i.test(text)) {
      const ok = await markAuthUserPaid(shopId);
      if (ok.success) {
        return { allow: true, language: lang, upsellReason: 'paid_confirmed', suppressUpsell: true };
      }
      return { allow: true, language: lang, upsellReason: 'paid_verification_failed' };
    }
          
    // --- NEW GUARD: typed "start trial" intent (all supported languages) ---
        // Only trigger when user is NOT already activated (paid or active trial).
        // This does not affect the existing button flow (payload === 'activate_trial').
        try {
          const planInfo = await getUserPlan(shopId);
          const plan = String(planInfo?.plan ?? '').toLowerCase();
          const trialEnd = planInfo?.trialEndDate ? new Date(planInfo.trialEndDate) : null;
          const isActivated =
            (plan === 'paid') ||
            (plan === 'trial' && (!trialEnd || Date.now() <= trialEnd.getTime()));
          if (!isActivated && isStartTrialIntent(Body)) {
            // Reuse the same activation steps you use in the button path
            await activateTrialFlow(From, lang);
            return { allow: true, language: lang, upsellReason: 'trial_started' };
          }
        } catch { /* soft-fail: continue to normal onboarding */ }

    // Lookup record in AuthUsers
    const rec = await getAuthUserRecord(shopId);
    if (!rec) {
      // New user → return reason, let handler show onboarding + main content
      if (/^(1|yes|haan|start|trial|ok)$/i.test(text)) {
        const s = await startTrialForAuthUser(shopId, TRIAL_DAYS);
        if (s.success) {
          return { allow: true, language: lang, upsellReason: 'trial_started' };
        }
        return { allow: true, language: lang, upsellReason: 'new_user' };
      }
    }
    const status = rec?.fields ? String(rec.fields.StatusUser ?? '').toLowerCase() : '';
    const pref2 = await getUserPreference(shopId); // to read plan & trial end
    const plan = String(pref2?.plan ?? '').toLowerCase();
    const trialEnd = pref2?.trialEndDate ? new Date(pref2.trialEndDate) : null;
    // Only hard-block truly restricted states; otherwise let main content proceed and upsell later
    if (['deactivated','blacklisted','blocked'].includes(status)) {
      return { allow: false, language: lang, upsellReason: 'blocked' };
    }
    // Trial ended → gentle pay wall
    if (plan === 'trial' && trialEnd && Date.now() > trialEnd.getTime()) {
      return { allow: true, language: lang, upsellReason: 'trial_ended' };
    }
    // Active (trial or paid) → allow normal flows
    return { allow: true, language: lang, upsellReason: 'none' };
  } catch (e) {
    console.warn('[access-gate] soft-fail', e?.message);
    const lang = String(detectedLanguage ?? 'en').toLowerCase();
    // Never block the request; proceed with main flow
    return { allow: true, language: lang, upsellReason: 'soft_fail' };
  }
}

// DB-backed memory helpers (Airtable via database.js)
const { appendTurn, getRecentTurns, inferTopic } = require('../database');

const {
  BUSINESS_TIPS_EN,
  startEngagementTips,
  stopEngagementTips,
  withEngagementTips
} = require('./engagementTips');

// ===== Inactivity Nudge Config & Tracker =====
const NUDGE_OFF = String(process.env.NUDGE_OFF ?? '0').toLowerCase() === '1';
const NUDGE_HOURS = Number(process.env.NUDGE_HOURS ?? 12);              // threshold before nudge
const NUDGE_COOLDOWN_HOURS = Number(process.env.NUDGE_COOLDOWN_HOURS ?? 24);
const NUDGE_INTERVAL_MS = Number(process.env.NUDGE_INTERVAL_MS ?? (60 * 60 * 1000)); // run each hour
// Write tracker into writable dir (A)
const INACTIVITY_TRACK_FILE = path.join(STATE_DIR, 'inactivity_nudge_tracker.json');

function readNudgeTracker() {
  try {          
      if (!fs.existsSync(INACTIVITY_TRACK_FILE)) { console.log('[nudge] tracker missing:', INACTIVITY_TRACK_FILE); return {}; }
      const data = fs.readFileSync(INACTIVITY_TRACK_FILE, 'utf8'); return JSON.parse(data);
  } catch { return {}; }
}
function writeNudgeTracker(state) {
  try { fs.writeFileSync(INACTIVITY_TRACK_FILE, JSON.stringify(state, null, 2)); return true; }
  catch (e) { console.warn('[nudge] tracker write FAIL:', { file: INACTIVITY_TRACK_FILE, err: e?.message }); return false; }
}
function wasNudgedRecently(shopId, cooldownHours) {
  const state = readNudgeTracker();
  const last = state[shopId];
  if (!last) return false;
  const diffMs = Date.now() - new Date(last).getTime();
  return diffMs < (cooldownHours * 60 * 60 * 1000);
}
function markNudged(shopId) {
  const state = readNudgeTracker();
  state[shopId] = new Date().toISOString();
  writeNudgeTracker(state);
}

async function composeNudge(shopId, language, hours = NUDGE_HOURS) {
  // Prevent single-script clamping for multi-line bodies
  const NO_CLAMP_MARKER_ESC = '&lt;!NO_CLAMP!&gt;';
  const NO_CLAMP_MARKER_RAW = '<!NO_CLAMP!>'; // just in case some paths use the raw variant

  const base =
    NO_CLAMP_MARKER_ESC +
    `🟢 It’s been ${hours}+ hours since you used Saamagrii.AI.\n` +
    `Type "mode" to switch Purchase/Sale/Return or ask an inventory query.`;

  // Resilient translation: always fall back to base
  let msg;
  try {
    msg = await t(base, language ?? 'en', `nudge-${shopId}-${hours}`);
  } catch (_) {
    msg = base;
  }

  // Length guard: if translation is short/empty (e.g., "none", "Try:"), use base
  if (!msg || String(msg).trim().length < 20) {
    msg = base;
  }

  // Strip internal markers before returning (handles both escaped and raw forms)
  return stripMarkers(msg);
}

async function sendInactivityNudges() {
  if (NUDGE_OFF) return;
  try {
    const thresholdISO = new Date(Date.now() - NUDGE_HOURS * 60 * 60 * 1000).toISOString();
    const users = await getUsersInactiveSince(thresholdISO); // from database.js
    for (const u of users) {
      const shopId = u.shopId;
      if (!shopId) continue;
      if (wasNudgedRecently(shopId, NUDGE_COOLDOWN_HOURS)) continue; // respect cooldown
      // language preference
      let lang = 'en';
      try {
        const pref = await getUserPreference(shopId);
        if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
      } catch {}             
      let msg = await composeNudge(shopId, lang, NUDGE_HOURS);
          if (!msg) {
            // Absolute fallback (shouldn't trigger if composeNudge is healthy)
            msg =
              `🟢 It’s been ${NUDGE_HOURS}+ hours since you used Saamagrii.AI.\n` +
              `Type "mode" to switch Purchase/Sale/Return or ask an inventory query.`;
          }
       await sendMessageViaAPI(`whatsapp:${shopId}`, msg);
      markNudged(shopId);
      console.log(`[nudge] sent to ${shopId} (LastUsed=${u.lastUsed ?? '—'})`);
      // tiny delay to avoid rate limits
      await new Promise(r => setTimeout(r, 250));
    }
  } catch (e) {
    console.warn('[nudge] job failed:', e.message);
  }
}

function scheduleInactivityNudges() {
  if (NUDGE_OFF) {
    console.log('[nudge] OFF');
    return;
  }
  console.log(`[nudge] scheduler every ${Math.round(NUDGE_INTERVAL_MS/60000)} min; threshold ${NUDGE_HOURS}h; cooldown ${NUDGE_COOLDOWN_HOURS}h; tracker=${INACTIVITY_TRACK_FILE}`);
  // first kick after ~5 minutes, then at set interval
  setTimeout(() => {
    sendInactivityNudges();
    setInterval(sendInactivityNudges, NUDGE_INTERVAL_MS);
  }, 5 * 60 * 1000);
}

// ===== NEW: Day‑3 trial reminder (hourly scan) =====
async function sendTrialExpiryReminders() {
  try {
    const nowISO = new Date().toISOString();
    const due = await getTrialsExpiringBefore(nowISO);
    for (const u of due) {
      // skip if already reminded in last 24h
      const last = u.lastReminder ? new Date(u.lastReminder).getTime() : 0;
      if (Date.now() - last < 24 * 60 * 60 * 1000) continue;
      // language preference
      let lang = 'en';
      try { const pref = await getUserPreference(u.shopId); if (pref?.success && pref.language) lang = String(pref.language).toLowerCase(); } catch {}
      const body = await t(
        `⚠️ Your Saamagrii.AI trial ends today.\nPay ₹11 at: ${PAYMENT_LINK}\nOr Paytm → ${PAYTM_NUMBER} (${PAYTM_NAME})\nReply "paid" to activate ✅`,
        lang, `trial-reminder-${u.shopId}`
      );
      await sendMessageViaAPI(`whatsapp:${u.shopId}`, body);
      await setTrialReminderSent(u.id, new Date().toISOString());
      await new Promise(r => setTimeout(r, 250));
    }
  } catch (e) {
    console.warn('[trial-reminder] job failed:', e.message);
  }
}
function scheduleTrialExpiryReminders() {
  console.log('[trial-reminder] hourly scan enabled');
  setInterval(sendTrialExpiryReminders, 60 * 60 * 1000);
  setTimeout(sendTrialExpiryReminders, 30 * 1000);
}

// --- Gamification tracker (JSON file; same pattern as summary_tracker.json) ---
// Write tracker into writable dir (A)
const GAMIFY_TRACK_FILE = path.join(STATE_DIR, 'gamify_tracker.json');

/**
 * When streak messages are OFF, pretend the tracker is empty.
 * This prevents downstream "gamify" flows from sending anything.
 */
function readGamify() {
  try {
    // Gate: if streak/gamify is OFF, return empty immediately
    if (typeof __isStreakEnabled === 'function' && !__isStreakEnabled()) {
      // Optional: single diagnostic line
      console.log('[gamify] read ignored: streak OFF');
      return {};
    }

    if (!fs.existsSync(GAMIFY_TRACK_FILE)) {
      console.log('[gamify] tracker missing:', GAMIFY_TRACK_FILE);
      return {};
    }
    const data = fs.readFileSync(GAMIFY_TRACK_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.warn('[gamify] read failed:', e.message);
    return {};
  }
}

/**
 * When streak messages are OFF, do not write or create the tracker file.
 * Returns false to indicate no persistence while feature is disabled.
 */
function writeGamify(state) {
  try {
    // Gate: if streak/gamify is OFF, do nothing
    if (typeof __isStreakEnabled === 'function' && !__isStreakEnabled()) {
      console.log('[gamify] write skipped: streak OFF');
      return false;
    }

    fs.writeFileSync(GAMIFY_TRACK_FILE, JSON.stringify(state, null, 2));
    console.log('[gamify] tracker write OK:', GAMIFY_TRACK_FILE);
    return true;
  } catch (e) {
    console.warn('[gamify] write failed:', e.message);
    return false;
  }
}

// IST helpers
function todayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().split('T')[0]; // YYYY-MM-DD (IST day)
}
function isYesterdayIST(dateStr) {
  try {
    if (!dateStr) return false;
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const thenUTC = Date.UTC(y, m - 1, d);
    const [ty, tm, td] = todayIST().split('-').map(Number);
    const todayUTC = Date.UTC(ty, tm - 1, td);
    const diffDays = Math.round((todayUTC - thenUTC) / (24 * 3600 * 1000));
    return diffDays === 1;
  } catch { return false; }
}
// Points by action
function pointsFor(action) {
  switch (String(action).toLowerCase()) {
    case 'sold': return 2;
    case 'purchase':
    case 'purchased': return 1;
    case 'returned': return 1;
    default: return 1;
  }
}
// Badge rules
const ENTRY_BADGES = [1, 5, 10, 50];
const STREAK_BADGES = [3, 7, 30];
function maybeAwardBadges(gs) {
  const awarded = [];
  for (const n of ENTRY_BADGES) { const label = `${n} Entries`; if (gs.entries >= n && !gs.badges.includes(label)) { gs.badges.push(label); awarded.push(label); } }
  if (gs.entries >= 1 && !gs.badges.includes('First Entry')) { gs.badges.push('First Entry'); awarded.push('First Entry'); }
  for (const s of STREAK_BADGES) { const label = `${s}-Day Streak`; if (gs.streakDays >= s && !gs.badges.includes(label)) { gs.badges.push(label); awarded.push(label); } }
  return awarded;
}
// Update state per shop
function updateGamifyState(shopId, action) {
  const state = readGamify();
  const gs = state[shopId] || { points: 0, entries: 0, streakDays: 0, lastActivityDate: null, badges: [] };
  const today = todayIST();
  if (gs.lastActivityDate === today) {
    // same day, keep streak
  } else if (isYesterdayIST(gs.lastActivityDate)) {
    gs.streakDays += 1;
  } else {
    gs.streakDays = 1;
  }
  gs.points += pointsFor(action);
  gs.entries += 1;
  gs.lastActivityDate = today;
  const newlyAwarded = maybeAwardBadges(gs);
  state[shopId] = gs;
  writeGamify(state);
  return { ok: true, newlyAwarded, snapshot: gs };
}
// Short celebration text (base EN → localized via t())
function composeGamifyToast({ action, gs, newlyAwarded }) {
  const head = `🎉 Nice! +${pointsFor(action)} point(s) for ${action}.`;
  const body = `Total: ${gs.points} points • Streak: ${gs.streakDays} day(s) • Entries: ${gs.entries}`;
  const badges = (newlyAwarded && newlyAwarded.length) ? `🏅 New badge: ${newlyAwarded.join(', ')}` : '';
  return [head, body, badges].filter(Boolean).join('\n');
}


// ===== NEW ENV: how many alternative batches to show in the confirmation (default 2) =====
const SHOW_BATCH_SUGGESTIONS_COUNT = Number(process.env.SHOW_BATCH_SUGGESTIONS_COUNT ?? 2);

// Central wrapper: run any per-request logic with engagement tips
const TIPS_OFF = String(process.env.TIPS_OFF ?? '1').toLowerCase() === '1';
async function runWithTips({ From, language, requestId }, fn) {
  if (TIPS_OFF) return await fn(); // short-circuit: suppress all engagement tips    
  // Skip tips for this request if Q&A marked suppression
  try { if (requestId && suppressTipsFor.has(requestId)) return await fn(); } catch {}
  return await withEngagementTips(
    {
      From,
      language,
      requestId,
      firstDelayMs: Number(process.env.TIP_FIRST_DELAY_MS ?? 20000),
      intervalMs: Number(process.env.TIP_INTERVAL_MS ?? 990000),
      maxCount: Number(process.env.TIP_MAX_COUNT ?? 1),
      sendMessage: (to, body) => sendMessageViaAPI(to, body),
      translate: (msg, lang, rid) => t(msg, lang, rid), // enforce SINGLE_SCRIPT_MODE
    },
    fn
  );
}

const SUMMARY_TRACK_FILE_WRITABLE = path.join(STATE_DIR, 'summary_tracker.json');

// Add this function to track daily summaries
function updateSummaryTracker(shopId, date) {
  try {
    let tracker = {};
          
    // Read existing tracker if it exists
        if (fs.existsSync(SUMMARY_TRACK_FILE_WRITABLE)) {
          const data = fs.readFileSync(SUMMARY_TRACK_FILE_WRITABLE, 'utf8');
      tracker = JSON.parse(data);
    }
    
    // Update tracker
    tracker[shopId] = date;
    
    // Write back to file        
    fs.writeFileSync(SUMMARY_TRACK_FILE_WRITABLE, JSON.stringify(tracker, null, 2));
    console.log('[summary] tracker write OK:', SUMMARY_TRACK_FILE_WRITABLE);    
    return true;
  } catch (error) {
    console.error('Error updating summary tracker:', error.message);
    return false;
  }
}

// Add this function to check if summary was already sent
function wasSummarySent(shopId, date) {
  try {
    if (!fs.existsSync(SUMMARY_TRACK_FILE_WRITABLE)) {
      return false;
    }
    
    const data = fs.readFileSync(SUMMARY_TRACK_FILE_WRITABLE, 'utf8');
    const tracker = JSON.parse(data);
    
    return tracker[shopId] === date;
  } catch (error) {
    console.error('Error checking summary tracker:', error.message);
    return false;
  }
}

// Add this function to send daily summaries
async function sendDailySummaries() {
  try {
    console.log('Starting daily summary job...');
    
    // Get all shop IDs
    const shopIds = await getAllShopIDs();
    console.log(`Found ${shopIds.length} shops to process`);
    
    if (shopIds.length === 0) {
      console.log('No shops found to process');
      return;
    }
    
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    // Process shops with concurrency limit
    const concurrencyLimit = 5;
    const results = [];
    
    for (let i = 0; i < shopIds.length; i += concurrencyLimit) {
      const batch = shopIds.slice(i, i + concurrencyLimit);
      console.log(`Processing batch of ${batch.length} shops (${i + 1}-${i + batch.length} of ${shopIds.length})`);
      
      const batchPromises = batch.map(async (shopId) => {
        try {
          // Check if summary was already sent today
          if (wasSummarySent(shopId, dateStr)) {
            console.log(`Summary already sent for shop ${shopId} today`);
            return { shopId, success: true, skipped: true };
          }
          
          // Get user's preferred language
          let userLanguage = 'en';
          try {
            const userPref = await getUserPreference(shopId);
            if (userPref.success) {
              userLanguage = userPref.language;
            }
          } catch (error) {
            console.warn(`Failed to get user preference for shop ${shopId}:`, error.message);
          }
          
          // Use processShopSummary from dailySummary.js
          const result = await processShopSummary(shopId);
          
          // Update tracker if successful
          if (result.success) {
            updateSummaryTracker(shopId, dateStr);
          }
          
          return result;
          
        } catch (error) {
          console.error(`Error processing shop ${shopId}:`, error.message);
          return { shopId, success: false, error: error.message };
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error('Unexpected error in batch processing:', result.reason);
        }
      }
      
      // Add a small delay between batches to avoid rate limiting
      if (i + concurrencyLimit < shopIds.length) {
        console.log('Pausing between batches to avoid rate limiting...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Calculate success statistics
    const successCount = results.filter(r => r.success && !r.skipped).length;
    const skippedCount = results.filter(r => r.skipped).length;
    const failureCount = results.filter(r => !r.success).length;
    
    console.log(`Daily summary job completed: ${successCount} sent, ${skippedCount} skipped, ${failureCount} failed; tracker=${SUMMARY_TRACK_FILE_WRITABLE}`);
    
    return results;
  } catch (error) {
    console.error('Error in daily summary job:', error.message);
    throw error;
  }
}

  // Send AI Full Summaries to all shops (scheduled)
  async function sendFullAISummaries() {
    try {
      console.log('Starting AI Full Summary job...');
      const shopIds = await getAllShopIDs();
      console.log(`Found ${shopIds.length} shops to process`);
      if (shopIds.length === 0) return;
  
      const concurrencyLimit = 5;
      const results = [];
      for (let i = 0; i < shopIds.length; i += concurrencyLimit) {
        const batch = shopIds.slice(i, i + concurrencyLimit);
        const batchPromises = batch.map(async (shopId) => {
          try {
            // Pull preferred language; default en
            let userLanguage = 'en';
            try {
              const pref = await getUserPreference(shopId);
              if (pref?.success) userLanguage = pref.language;
            } catch (_) {}
  
            const insights = await generateFullScaleSummary(shopId, userLanguage, 'sched-ai-full');
            await sendMessageViaAPI(`whatsapp:${shopId}`, finalizeForSend(insights, userLanguage));
            return { shopId, success: true };
          } catch (err) {
            console.error(`AI Full Summary error for ${shopId}:`, err.message);
            return { shopId, success: false, error: err.message };
          }
        });
        const batchResults = await Promise.allSettled(batchPromises);
        batchResults.forEach(r => results.push(r.status === 'fulfilled' ? r.value : { success:false, error:String(r.reason)}));
        if (i + concurrencyLimit < shopIds.length) await new Promise(r => setTimeout(r, 2000));
      }
      const ok = results.filter(r => r.success).length;
      const bad = results.length - ok;
      console.log(`AI Full Summary job completed: ${ok} sent, ${bad} failed`);
      return results;
    } catch (e) {
      console.error('AI Full Summary job failed:', e.message);
      throw e;
    }
  }
  
  // Schedule AI Full Summary at 10 PM IST (16:30 UTC)
  function scheduleFullAISummary() {
    const now = new Date();
    const target = new Date();
    // 10:00 PM IST = 16:30 UTC
    target.setUTCHours(16, 30, 0, 0);
    if (now > target) target.setUTCDate(target.getUTCDate() + 1);
    const ms = target - now;
    console.log(`Scheduling AI Full Summary for ${target.toISOString()} (in ${ms}ms)`);
    setTimeout(() => {
      sendFullAISummaries()
        .then(() => scheduleFullAISummary())
        .catch(err => {
          console.error('AI Full Summary run errored:', err.message);
          setTimeout(scheduleFullAISummary, 60 * 60 * 1000);
        });
    }, ms);
  }

// Start the AI Full Summary scheduler (10 PM IST)
scheduleFullAISummary();

// Start the inactivity nudge scheduler (hourly)
scheduleInactivityNudges();

// Start trial expiry reminders (hourly)
scheduleTrialExpiryReminders();


// ===== AI Debounce (per shop) =====
const aiDebounce = new Map(); // shopId -> { timer, lastText, lastLang, lastReqId }

const AI_DEBOUNCE_MS = Number(process.env.AI_DEBOUNCE_MS ?? 0);
// Disable debouncing on serverless (timers may not fire reliably)
const SHOULD_DEBOUNCE = AI_DEBOUNCE_MS > 0 && !isServerless;
 
// STEP 9: Cancel any pending AI-debounced Q&A for this shop
function cancelAiDebounce(shopId) {
  const prev = aiDebounce.get(shopId);
  if (prev?.timer) clearTimeout(prev.timer);
  aiDebounce.delete(shopId);
}

// === Broken-output detector ===================================================
function looksBroken(s) {
  const t = String(s ?? '').trim();
  if (!t) return true;
  // Collapsed to an anchor like "PDF - ."
  if (/^pdf\s*[-–—]?\s*\.$/i.test(t)) return true;
  // Overly short with almost no letters in any supported scripts
  const letters = (t.match(/[A-Za-z\u0900-\u0D7F]/g) ?? []).length;
  return letters < 6;
}

function scheduleAiAnswer(shopId, From, text, lang, requestId) {
  const key = shopId;
  const prev = aiDebounce.get(key);
  if (prev?.timer) clearTimeout(prev.timer);
  aiDebounce.set(key, {
    lastText: text, lastLang: lang, lastReqId: requestId,
    timer: setTimeout(async () => {
      try {                
        const last = aiDebounce.get(key);                
        const ans = await composeAISalesAnswer(shopId, last.lastText, last.lastLang);                
        // Keep user's script preference & use scoped cache key to avoid generic reuse
        const topic = inferTopic(last.lastText); // sync helper from database.js (already imported)
        const cacheKey = buildTranslationCacheKey(last.lastReqId, topic, /*flavor*/ null, last.lastLang, last.lastText);                                
        const m0 = await tx(ans, last.lastLang, `whatsapp:${shopId}`, last.lastText, cacheKey);
                if (DEBUG_QA_SANITIZE) { try { console.log('[qa] rawOut len=%d: "%s"', String(ans ?? '').length, String(ans ?? '').slice(0, 120)); } catch {} }
                // De-echo before nativeglish/clamp to remove bilingual duplicates
                let msg0 = normalizeTwoBlockFormat(m0, last.lastLang);
                let msg = nativeglishWrap(msg0, last.lastLang);
                if (DEBUG_QA_SANITIZE) { try { console.log('[qa] after nativeglish len=%d: "%s"', msg.length, msg.slice(0, 120)); } catch {} }
                msg = enforceSingleScriptSafe(msg, last.lastLang);
                if (DEBUG_QA_SANITIZE) { try { console.log('[qa] after singleScriptSafe len=%d: "%s"', msg.length, msg.slice(0, 120)); } catch {} }
                if (looksBroken(msg)) {
                  msg = getLocalizedQAFallback(last.lastLang);
                  if (DEBUG_QA_SANITIZE) { try { console.log('[qa] broken detected → fallback len=%d', msg.length); } catch {} }
                }
                await sendMessageDedup(From, msg);        
        // Store the turn in DB
        try { await appendTurn(shopId, last.lastText, msg, inferTopic(last.lastText)); } catch (_) {}
      } finally { aiDebounce.delete(key); }
    }, AI_DEBOUNCE_MS)
  });
}

// STEP 8: Per-request idempotency for Content API template sends
const _sentTemplatesThisReq = new Set(); // keys: `${requestId}::${contentSid}`
async function sendContentTemplateOnce({ toWhatsApp, contentSid, requestId }) {

  const key = `${requestId}::${contentSid}`;
  if (_sentTemplatesThisReq.has(key)) return;
  try {
    await sendContentTemplate({ toWhatsApp, contentSid });
    _sentTemplatesThisReq.add(key);
  } catch (e) {
    console.warn('[contentTemplateOnce] send failed', { status: e?.response?.status, data: e?.response?.data });
  }
}

// STEP 10: Per-shop QUEUE for template sends + idempotent per request
const _contentQueues = new Map(); // shopId -> Promise chain
async function sendContentTemplateQueuedOnce({ toWhatsApp, contentSid, requestId }) {
  const key = `${requestId}::${contentSid}`;
  if (_sentTemplatesThisReq.has(key)) return; // idempotent in-request
  _sentTemplatesThisReq.add(key);
  const shopId = String(toWhatsApp).replace('whatsapp:', '');
  const prev = _contentQueues.get(shopId) || Promise.resolve();
  const next = prev.then(async () => {
    try {
      await sendContentTemplate({ toWhatsApp: shopId, contentSid });
    } catch (e) {
      console.warn('[contentQueuedOnce] send failed', { status: e?.response?.status, data: e?.response?.data, to: shopId });
    }
  }).catch(err => {
    console.warn('[contentQueuedOnce] chain error', err?.message);
  });
  _contentQueues.set(shopId, next.finally(() => {}));
  return next;
}

// Cache key prefix for command normalization (any-language -> English)
const COMMAND_NORM_PREFIX = 'cmdnorm:';


// Precompiled regex patterns for better performance
const regexPatterns = {
   // Added Gujarati buy verbs: ખરીદ્યું / ખરીદી / ખરીદ્યા / kharidi
   purchaseKeywords: /(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy|khareeda|ખરીદ્યું|ખરીદી|ખરીદ્યા|kharidi)/gi,
   // Added Gujarati sell verbs: વેચ્યું / વેચી / વેચ્યા (NOTE: we intentionally do NOT add ‘વેચાણ’ which is the noun “sales”)
   salesKeywords: /(बेचा|बेचे|becha|sold|बिक्री|વેચ્યું|વેચી|વેચ્યા)/gi,
   remainingKeywords: /(बचा|बचे|बाकी|remaining|left|bacha)/gi,
   returnKeywords: /(return(?:ed)?|customer\s+return|रिटर्न|वापस|परत|रीटर्न|રીટર્ન)/gi,
   dateFormats: /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})/gi,
   // Added Gujarati numerals [૦-૯]
   digits: /(\d+|[०-९]+|[૦-૯]+)/i,
   resetCommands: /(reset|start over|restart|cancel|exit|stop)/gi,
   conjunctions: /(and|&&;|aur|also|और|एवं)/gi,
  // NEW: split multi-item messages by newlines or bullets
  lineBreaks: /\r?\n|[•\u2022]/g
 };

// Centralized minimal Help (new copy), localized + tagged with footer
async function sendHelpMinimal(From, lang, requestId) {
  const base = [
    'Help:',
    '• WhatsApp or call: +91-9013283687',
    `• WhatsApp link: https://wa.link/6q3ol7`
  ].join('\n');     
  const cacheKey = buildTranslationCacheKey(requestId, 'help', 'n/a', lang, base);
  const msg = await tx(base, lang, From, 'help', cacheKey);
  try {
    const withTag = await tagWithLocalizedMode(From, msg, lang);
    await sendMessageViaAPI(From, withTag);
  } catch { await sendMessageViaAPI(From, msg); }
}

// Nativeglish demo: short, clear, localized with helpful English anchors
async function sendNativeglishDemo(From, lang, requestId) {
  const demo = [
    '🎬 Demo (उदाहरण):',
    '• sold milk 2 ltr — स्टॉक auto-update',
    '• purchased Parle-G 12 packets ₹10 — exp +6m',
    '• return 1 packet — instant add-back',
    'Try: "short summary" / "छोटा सारांश"'
  ].join('\n');     
  const cacheKey = buildTranslationCacheKey(requestId, 'demo', 'n/a', lang, demo);
  const msg = nativeglishWrap(await tx(demo, lang, From, demo, cacheKey), lang);
  try {
    const withTag = await tagWithLocalizedMode(From, msg, lang);
    await sendMessageViaAPI(From, withTag);
  } catch { await sendMessageViaAPI(From, msg); }
}
  
// STEP 11: Robust inbound sanitizer to drop UI badges & interactive echoes
function sanitizeInbound(body, numMedia, interactive = {}) {
  try {
    let text = String(body ?? '').trim();
    // Remove decorative quotes and bullets
    text = text
      .replace(/[«»]/g, '')
      .replace(/\u2022/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Prefer structured interactive IDs/text when body is just noise
    const lr = interactive?.list_reply || interactive?.ListResponse || interactive?.List
             || interactive?.Interactive || interactive?.ListPickerSelection
             || interactive?.SelectedListItem || interactive?.ListId || interactive?.ListReplyId;
    const btn = interactive?.button_reply || interactive?.ButtonPayload || interactive?.ButtonId || interactive?.PostbackData;
    const btnText = interactive?.ButtonText;
    if ((!text || /^mode$/i.test(text)) && (btnText || lr || btn)) {
      text = String(btnText || lr || btn || '').trim();
    }

    // Ignore pure “— mode —” echoes
    if (/^\s*[-–—]\s*mode\s*[-–—]\s*$/i.test(text)) return '';

    // Media-only messages: keep text as-is (media handler consumes)
    if (Number(numMedia ?? 0) > 0) return text;

    return text;
  } catch {
    return String(body ?? '').trim();
  }
}

  
// Global storage with cleanup mechanism
const globalState = {
  userPreferences: {},
  pendingProductUpdates: {},
  conversationState: {},
  lastCleanup: Date.now()
};

// Reset commands to allow users to exit any flow
const resetCommands = ['reset', 'start over', 'restart', 'cancel', 'exit', 'stop'];

// Expanded product list with common grocery items
const products = [
  // Branded items
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
  'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
  'Oreo', 'Sunfeast', 'Good Day', 'Marie Gold',
  // Basic groceries
  'flour', 'आटा', 'sugar', 'चीनी', 'salt', 'नमक',
  'rice', 'चावल', 'wheat', 'गेहूं', 'oil', 'तेल',
  // Vegetables
  'potato', 'आलू', 'potatoes', 'onion', 'प्याज', 'onions',
  'tomato', 'टमाटर', 'tomatoes', 'carrot', 'गाजर', 'carrots',
  'cabbage', 'पत्ता गोभी', 'cauliflower', 'फूलगोभी', 'spinach', 'पालक',
  // Fruits
  'apple', 'सेब', 'apples', 'banana', 'केला', 'bananas',
  'orange', 'संतरा', 'oranges', 'mango', 'आम', 'mangoes',
  // Dairy
  'milk', 'दूध', 'curd', 'दही', 'yogurt', 'butter', 'मक्खन',
  'cheese', 'पनीर', 'ghee', 'घी', 'cream', 'मलाई',
  // Spices
  'turmeric', 'हल्दी', 'cumin', 'जीरा', 'coriander', 'धनिया',
  'chili', 'मिर्च', 'pepper', 'काली मिर्च', 'cardamom', 'इलायची',
  // Packaged goods
  'packets', 'पैकेट', 'boxes', 'बॉक्स', 'bags', 'बैग्स',
  'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट',
  // Branded FMCG
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया', 'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata', 'Oreo', 'Frooti', 'फ्रूटी', 'Sunfeast', 'Marie Gold', 'Good Day', 'Bournvita', 'Complan', 'Horlicks', 'Boost', 'Real Juice', 'Slice', 'Maaza', 'Pepsi', 'Coca-Cola', 'Sprite', 'Thums Up', 'Limca', 'Kinley', 'Bisleri', 'Aquafina', 'Appy Fizz',
  // Groceries
  'flour', 'आटा', 'maida', 'मैदा', 'besan', 'बेसन', 'sugar', 'चीनी', 'salt', 'नमक', 'rice', 'चावल', 'wheat', 'गेहूं', 'dal', 'दाल', 'moong dal', 'मूंग दाल', 'masoor dal', 'मसूर दाल', 'chana dal', 'चना दाल', 'rajma', 'राजमा', 'soybean', 'सोयाबीन', 'poha', 'पोहा', 'suji', 'सूजी', 'rava', 'रवा', 'sabudana', 'साबूदाना',
  // Vegetables
  'potato', 'आलू', 'onion', 'प्याज', 'tomato', 'टमाटर', 'carrot', 'गाजर', 'cabbage', 'पत्ता गोभी', 'cauliflower', 'फूलगोभी', 'spinach', 'पालक', 'brinjal', 'बैंगन', 'ladyfinger', 'भिंडी', 'capsicum', 'शिमला मिर्च', 'green chili', 'हरी मिर्च', 'garlic', 'लहसुन', 'ginger', 'अदरक',
  // Fruits
  'apple', 'सेब', 'banana', 'केला', 'orange', 'संतरा', 'mango', 'आम', 'grapes', 'अंगूर', 'papaya', 'पपीता', 'watermelon', 'तरबूज', 'muskmelon', 'खरबूजा', 'guava', 'अमरूद', 'pomegranate', 'अनार', 'lemon', 'नींबू',
  // Dairy
  'milk', 'दूध', 'curd', 'दही', 'yogurt', 'butter', 'मक्खन', 'cheese', 'पनीर', 'ghee', 'घी', 'cream', 'मलाई', 'lassi', 'लस्सी', 'buttermilk', 'छाछ',
  // Spices
  'turmeric', 'हल्दी', 'cumin', 'जीरा', 'coriander', 'धनिया', 'chili powder', 'मिर्च पाउडर', 'garam masala', 'गरम मसाला', 'asafoetida', 'हींग', 'mustard seeds', 'सरसों', 'fenugreek', 'मेथी', 'cardamom', 'इलायची', 'cloves', 'लौंग', 'black pepper', 'काली मिर्च', 'bay leaf', 'तेज पत्ता',
  // Packaged goods
  'packets', 'पैकेट', 'boxes', 'बॉक्स', 'bags', 'बैग्स', 'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट', 'shampoo', 'शैम्पू', 'toothpaste', 'टूथपेस्ट', 'toothbrush', 'टूथब्रश', 'face wash', 'फेस वॉश', 'handwash', 'हैंडवॉश', 'sanitizer', 'सेनेटाइज़र',
  // Household
  'phenyl', 'फिनाइल', 'harpic', 'हार्पिक', 'lizol', 'लिज़ोल', 'matchbox', 'माचिस', 'mosquito coil', 'मच्छर अगरबत्ती', 'mosquito repellent', 'मच्छर भगाने वाला', 'tissue paper', 'टिशू पेपर', 'napkin', 'नैपकिन', 'garbage bag', 'कचरा बैग',
  // Baby & Personal Care
  'diapers', 'डायपर', 'baby powder', 'बेबी पाउडर', 'baby lotion', 'बेबी लोशन', 'face cream', 'फेस क्रीम', 'body lotion', 'बॉडी लोशन', 'hair oil', 'हेयर ऑयल', 'comb', 'कंघी', 'razor', 'रेज़र', 'shaving cream', 'शेविंग क्रीम',
  // Beverages
  'tea', 'चाय', 'coffee', 'कॉफी', 'green tea', 'ग्रीन टी', 'black tea', 'ब्लैक टी', 'cold drink', 'कोल्ड ड्रिंक', 'energy drink', 'एनर्जी ड्रिंक',
  // Snacks
  'namkeen', 'नमकीन', 'bhujia', 'भुजिया', 'sev', 'सेव', 'chakli', 'चकली', 'murukku', 'मुरुक्कु', 'mixture', 'मिक्चर', 'kurkure', 'कुर्कुरे', 'lays', 'लेज़', 'bingo', 'बिंगो',
  // Frozen & Ready-to-eat
  'frozen peas', 'फ्रोजन मटर', 'frozen corn', 'फ्रोजन कॉर्न', 'ready-to-eat meals', 'तैयार भोजन', 'instant noodles', 'इंस्टेंट नूडल्स', 'instant soup', 'इंस्टेंट सूप',
  // Bakery
  'bread', 'ब्रेड', 'bun', 'बन', 'cake', 'केक', 'pastry', 'पेस्ट्री', 'rusk', 'रस्क',
  // Condiments
  'ketchup', 'केचप', 'mayonnaise', 'मेयोनेज़', 'sauce', 'सॉस', 'pickle', 'अचार', 'jam', 'जैम', 'honey', 'शहद',
  // Others
  'ice cream', 'आइसक्रीम', 'chocolate', 'चॉकलेट', 'candy', 'कैंडी', 'mint', 'मिंट', 'mouth freshener', 'माउथ फ्रेशनर'  
];

// Number words mapping
const numberWords = {
  // English
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6,
  'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
  'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
  'eighteen': 18, 'nineteen': 19, 'twenty': 20, 'thirty': 30, 'forty': 40,
  'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90, 'hundred': 100,
  // Hindi
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'छह': 6,
  'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'ग्यारह': 11, 'बारह': 12,
  'तेरह': 13, 'चौदह': 14, 'पंद्रह': 15, 'सोलह': 16, 'सत्रह': 17,
  'अठारह': 18, 'उन्नीस': 19, 'बीस': 20, 'तीस': 30, 'चालीस': 40,
  'पचास': 50, 'साठ': 60, 'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90, 'सौ': 100,
  // Hinglish
  'ek': 1, 'do': 2, 'teen': 3, 'char': 4, 'paanch': 5, 'chhah': 6,
  'saat': 7, 'aath': 8, 'nau': 9, 'das': 10, 'gyaarah': 11, 'baarah': 12,
  'terah': 13, 'chaudah': 14, 'pandrah': 15, 'solah': 16, 'satrah': 17,
  'athaarah': 18, 'unnis': 19, 'bees': 20, 'tees': 30, 'chaalis': 40,
  'pachaas': 50, 'saath': 60, 'sattar': 70, 'assi': 80, 'nabbe': 90, 'sau': 100,
  // Special case: "सो" means 100 in Hindi when referring to quantity
  'सो': 100,
  // Hindi numerals (Devanagari digits)
  '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9,
  '१०': 10, '११': 11, '१२': 12, '१३': 13, '१४': 14, '१५': 15, '१६': 16
};

// Units mapping with normalization
const units = {
  'packets': 1, 'पैकेट': 1, 'packet': 1,
  'boxes': 1, 'बॉक्स': 1, 'box': 1,
  'kg': 1, 'किलो': 1, 'kilo': 1, 'kilogram': 1, 'kilograms': 1,
  'g': 0.001, 'gram': 0.001, 'grams': 0.001, 'ग्राम': 0.001,
  'liters': 1, 'लीटर': 1, 'litre': 1, 'litres': 1, 'liter': 1,
  'ml': 0.001, 'milliliter': 0.001, 'milliliters': 0.001, 'millilitre': 0.001, 'millilitres': 0.001,
  'pieces': 1, 'पीस': 1, 'piece': 1,
  'gm': 0.001, 'gms': 0.001, // Added common abbreviations
  'kgs': 1, 'kilos': 1, // Added common abbreviations
  'l': 1, 'ltr': 1, 'ltrs': 1, // Added common abbreviations
  'mls': 0.001 // Added common abbreviations
};

// Gujarati unit synonyms
 Object.assign(units, {
   'કિલો': 1, 'કિગ્રા': 1,
   'ગ્રામ': 0.001,
   'લિટર': 1,
   'પૅકેટ': 1, 'પેકેટ': 1,
   'બોક્સ': 1,
   'ટુકડો': 1, 'ટુકડાઓ': 1, 'નંગ': 1
 });

// Greetings mapping by language
const greetings = {
  'hi': ['hello', 'hi', 'hey', 'नमस्ते', 'नमस्कार', 'हाय'],
  'ta': ['vanakkam', 'வணக்கம்'],
  'te': ['నమస్కారం', 'హలో'],
  'kn': ['ನಮಸ್ಕಾರ', 'ಹಲೋ'],
  'bn': ['নমস্কার', 'হ্যালো'],
  'gu': ['નમસ્તે', 'હેલો'],
  'mr': ['नमस्कार', 'हॅलो'],
  'en': ['hello', 'hi', 'hey'],
  'fr': ['salut', 'bonjour', 'allo'],
  'es': ['hola', 'buenos dias'],
  'de': ['hallo', 'guten tag'],
  'it': ['ciao', 'buongiorno'],
  'pt': ['ola', 'bom dia'],
  'ru': ['привет', 'здравствуй'],
  'ja': ['こんにちは', 'やあ'],
  'zh': ['你好', '嗨']
};

// State management constants and functions
const STATE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function getUserState(from) {
  const shopId = from.replace('whatsapp:', '');
  const state = await getUserStateFromDB(shopId);
  return state;
}

async function setUserState(from, mode, data = {}) {
  const shopId = from.replace('whatsapp:', '');
  const result = await saveUserStateToDB(shopId, mode, data);
  if (result.success) {
    console.log(`[State] Set state for ${from}: ${mode}`);
  } else {
    console.error(`[State] Failed to set state for ${from}: ${result.error}`);
  }
}

async function clearUserState(from) {
  const shopId = from.replace('whatsapp:', '');
  const state = await getUserStateFromDB(shopId);
  if (state && state.id) {        
      await deleteUserStateFromDB(state.id);
    console.log(`[State] Cleared state for ${from}`);
  }
}

// Handle awaitingPriceExpiry unified correction
async function handleAwaitingPriceExpiry(From, Body, detectedLanguage, requestId) {
  const shopId = From.replace('whatsapp:', '');
  const state = await getUserStateFromDB(shopId);
  if (!state || state.mode !== 'awaitingPriceExpiry') return false;    
  // STRICT policy (new build):
    // We no longer create pending batches without price. If a state exists without a batchId,
    // treat it as non-legacy, clear it, and nudge the user to resend the line WITH price.
    if (!state?.data?.batchId) {
      try { await deleteUserStateFromDB(state.id); } catch (_) {}
      const msg = await t(
        'To record a purchase, please send one line WITH price, e.g., "purchased Milk 5 ltr @ ₹60/ltr".',
        detectedLanguage,
        'price-required-nudge'
      );
      const tagged = await tagWithLocalizedMode(From, finalizeForSend(msg, detectedLanguage), detectedLanguage);
      await sendMessageViaAPI(From, tagged);
      // Suppress late tail on the same requestId
      try { handledRequests.add(requestId); } catch (_) {}
      return true; // consume this turn; no capture
    }
  
  // NEW: allow "reset" while asking for price/expiry
    if (isResetMessage(Body)) {
      try {                   
            await deleteUserStateFromDB(state.id);          
      } catch (_) {}
      const ok = await t(
        `✅ Reset. I’ve cleared the pending price/expiry step.`,
        detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, ok);
      return true;
    }
      
    // HOIST: Prepare safe product/unit hints to avoid TDZ when reminder runs
    const __prodHint = String(state?.data?.product ?? 'item');
    const __unitHint = String(state?.data?.unit ?? 'unit');

    // ===== NEW: Allow "skip" to bypass price step entirely =====
      try {
        const b = String(Body ?? '').trim().toLowerCase();
        // Accept "skip" (en), and a simple Hindi transliteration "स्किप"
        if (b === 'skip' || b === 'स्किप') {                      
            // Clear price-await state and restore sticky Purchase mode (avoid 'none' → generic prompt)
                try { await deleteUserStateFromDB(state.id); } catch {}
                await setUserState(shopId, 'awaitingTransactionDetails', { action: 'purchased' });
            
                // Use exact language of THIS turn; prevents 'english'→Hindi drift
                const turnLang = await detectLanguageWithFallback(Body, From, requestId);
                const msg0 = await t('✅ Price step skipped. You can enter a new item.', turnLang, 'price-skip');
                const msg1 = finalizeForSend(msg0, turnLang);
                const tagged = await tagWithLocalizedMode(From, msg1, turnLang);
                await sendMessageViaAPI(From, tagged);
            
                // Suppress any late parse-error/default path on this same requestId
                try { handledRequests.add(requestId); } catch {}
                return true; // consume this turn
        }
      } catch (e) {
        console.warn('[awaitingPriceExpiry] skip handling failed:', e?.message);
      }
  
   // ===== NEW: Auto-park guard (transaction text while price is pending) =====
    try {
      const tNorm = String(Body ?? '').trim();
      if (looksLikeTxnLite(tNorm)) {
        // 1) Park previous draft so it appears in correction/pending lists               
        const langHint = detectedLanguage || await detectLanguageWithFallback(Body, From, 'price-await-exp');                
              await parkPendingPriceDraft(shopId, state, langHint);
              await sendPendingPriceReminder(
                From,
                { data: { product: __prodHint, unit: __unitHint, quantity: state?.data?.quantity } },
                langHint
              );
        // 3) Return false: let main routing parse this message as a fresh transaction
        return false;
      }
    } catch (e) {
      console.warn('[awaitingPriceExpiry] auto-park guard failed:', e?.message);            
      // Even if reminder fails, allow main router to process the fresh transaction:
      return false;
    }
    
    // ===== NEW: Gate price-handling — if reply isn't price-like, gently re-prompt with ₹ examples =====
    if (!isPriceLikeMessage(Body)) {         
    const prod = String(state?.data?.product ?? '').trim() || 'item';
        const unit = String(state?.data?.unit ?? 'unit');
        const gateSrc = composePriceReminderTextGeneric(detectedLanguage, { prod, unit })
          + `\nIf you type a new item line, I’ll capture it separately.`; // extra guidance
        const hint0 = await t(gateSrc, detectedLanguage, 'price-gate-hint');
        const hint = finalizeForSend(nativeglishWrap(hint0, detectedLanguage), detectedLanguage);
      // ANCHOR: UNIQ:PRICE-EXPIRY-ASKGATE-001
      await sendMessageViaAPI(From, finalizeForSend(hint, detectedLanguage));
      return true; // stay in price-await
    }

  console.log(`[awaitingPriceExpiry] Raw reply for ${shopId}:`, JSON.stringify(Body));
  const data = state.data || {};
  const { batchId, product, unit, quantity, purchaseDate, autoExpiry, needsPrice, isPerishable } = data;
  // Let the parser extract both price & explicit "exp ..." segment in any order
  const parsed = parsePriceAndExpiryFromText(Body, purchaseDate);
  
  // If user gave an expiry in the past, bump year forward relative to the purchase date
    if (parsed && parsed.expiryISO) {
      try {
        const bumped = bumpExpiryYearIfPast(parsed.expiryISO, purchaseDate || new Date().toISOString());
        if (bumped) parsed.expiryISO = bumped;
      } catch (_) {}
    }
    
  let updatedPrice = null;
  let updatedExpiryISO = null;

  // Decide expiry outcome
  if (parsed.skipExpiry) {
    updatedExpiryISO = null;
  } else if (parsed.ok) {
    updatedExpiryISO = autoExpiry || null;
  } else if (parsed.expiryISO) {
    updatedExpiryISO = parsed.expiryISO;
  } else {
    // no explicit instruction => keep auto if exists
    updatedExpiryISO = autoExpiry || null;
  }

  // Decide price outcome
  if (parsed.price && parsed.price > 0) {
    updatedPrice = parsed.price;
  }
  
  // ===== NEW: Idempotency guard (skip duplicate price application) =====
    if (updatedPrice && state?.data?.batchId) {
      if (seenDuplicatePriceTurn(shopId, state.data.batchId, Body)) {
        console.log(`[${requestId}] Duplicate price turn suppressed for batch=${state.data.batchId}`);
        // Confirm we received it, but avoid re-applying
        const ack = await t(`ℹ️ कीमत संदेश मिला — डुप्लिकेट था, इसलिए दोबारा लागू नहीं किया।`, detectedLanguage, 'price-dup-ack');
        await sendMessageViaAPI(From, finalizeForSend(ack, detectedLanguage));
        return true; // consumed, stay/clear as per your normal path
      }
    }
  
  // If user didn’t give a price but we still need one, prompt again (with examples)
  if (needsPrice && !updatedPrice) { 
    let again = await t(
      `Please share the purchase price and expiry for ${product}. You can also say expiry like "exp 20-09".`,
      detectedLanguage, 'ask-price-again'
    );
    // ANCHOR: UNIQ:PRICE-EXPIRY-ASKAGAIN-001
    await sendMessageViaAPI(From, finalizeForSend(again, detectedLanguage));
    return true; // stay in same state
  }

  // Apply updates
  try {
    if (updatedExpiryISO !== undefined && updatedExpiryISO !== autoExpiry && batchId) {
      await updateBatchExpiry(batchId, updatedExpiryISO);
    }
  } catch (e) {
    console.warn(`[${requestId}] updateBatchExpiry failed:`, e.message);
  }
  try {        
    if (updatedPrice && batchId) {
            await updateBatchPurchasePrice(batchId, updatedPrice, quantity);
            // NEW: shop-scoped product price upsert
            await upsertProduct({ shopId, name: product, price: updatedPrice, unit });
          } 
    try {                            
            // STRICT: only update inventory here if we have a positive price
                if (Number(updatedPrice) > 0) {
                  try { await updateInventory(shopId, product, quantity, unit); } catch (_) {}
                }
                console.log(`[handleAwaitingPriceExpiry] Inventory updated for ${product}: +${quantity} ${unit}`);                                         
                 
            // ✅ Confirmation: include current stock total if available; fallback to "(updated)"
              let stockLine = ' (Stock: updated)';
              try {
                const invNow = await getProductInventory(shopId, product);
                if (Number.isFinite(invNow?.quantity)) {
                  const unitDisp = displayUnit(unit, detectedLanguage);
                  stockLine = ` (Stock: now ${invNow.quantity} ${unitDisp})`;
                }
              } catch { /* keep fallback */ }
              let confirmation = `✅ Done:\n📦 Purchased ${quantity} ${unit} ${product}${stockLine}`;                            
              if (Number(updatedPrice) > 0) {
                    confirmation += `\n💰 Price: ₹${updatedPrice}`;
                  } else {
                    confirmation = ''; // suppress purchase confirmation entirely
                  }
              confirmation += `\n\n✅ Successfully updated 1 of 1 items`;
              // ANCHOR: UNIQ:PRICE-EXPIRY-CONFIRM-001
              const confTagged = await tagWithLocalizedMode(From, finalizeForSend(confirmation, detectedLanguage), detectedLanguage);
    
            // ===== NEW: Finalize — clear price-await state & return to sticky purchase mode =====
                  try {
                    await deleteUserStateFromDB(state.id);
                  } catch (e) {
                    console.warn('[awaitingPriceExpiry] failed to clear state:', e?.message);
                  }
                  // Re-set sticky "purchased" mode so user can continue verb-less lines
                  try {
                    await setUserState(`whatsapp:${shopId}`, 'awaitingTransactionDetails', { action: 'purchased' });
                    console.log(`[State] Sticky mode restored for ${shopId}: awaitingTransactionDetails`);
                  } catch (e) {
                    console.warn('[awaitingPriceExpiry] failed to set sticky purchase mode:', e?.message);
                  }
            } catch (e) {
                console.error(`[handleAwaitingPriceExpiry] Failed to update inventory:`, e.message);
            }
  } catch (e) {
    console.warn(`[${requestId}] price updates failed:`, e.message);
  }

  // Confirm and clear state - Update, not clearing unless explicitly required by user using 'Reset' type command     
    //if (state?.mode !== 'awaitingTransactionDetails') {
    //  await deleteUserStateFromDB(state.id);
    //}
  const lines = [];
  if (updatedPrice) lines.push(`Price: ₹${updatedPrice}`);
  if (isPerishable) {
    const shown = updatedExpiryISO ? formatDateForDisplay(updatedExpiryISO) : '—';
    lines.push(`Expiry: ${shown}`);
  }      
    
    // ===== NEW: Avoid double-notification if we already sent the confirmation above =====
    if (updatedPrice || updatedExpiryISO !== undefined) {
      // We already sent a "✅ Done" confirmation including ₹ and/or expiry.
      // To reduce noise, skip the secondary 'Saved' message unless there were no changes.
    } else {
    let done = await t(
      `✅ Saved for ${product} ${quantity} ${unit}\n` + (lines.length ? lines.join('\n') : 'No changes.'),
      detectedLanguage, 'saved-price-expiry'
    );
    // ANCHOR: UNIQ:PRICE-EXPIRY-SAVED-001
    await sendMessageViaAPI(From, finalizeForSend(done, detectedLanguage));
  return true;
      }
}

// Helper function to format dates for Airtable (YYYY-MM-DDTHH:mm:ss.sssZ)
function formatDateForAirtable(date) {
  if (date instanceof Date) {
    return date.toISOString();
  }
  if (typeof date === 'string') {
    if (date.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      // Already in ISO format with time
      return date;
    }
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Date only, add time component
      return `${date}T00:00:00.000Z`;
    }
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  }
  return null;
}


// Helper function to format date for display (DD/MM/YYYY HH:MM)
function formatDateForDisplay(date) {
    if (date instanceof Date) {
        // Convert to IST (UTC+5:30)
        const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
        const istTime = new Date(date.getTime() + istOffset);
        
        const day = istTime.getUTCDate().toString().padStart(2, '0');
        const month = (istTime.getUTCMonth() + 1).toString().padStart(2, '0');
        const year = istTime.getUTCFullYear();
        const hours = istTime.getUTCHours().toString().padStart(2, '0');
        const minutes = istTime.getUTCMinutes().toString().padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }
    if (typeof date === 'string') {
        if (date.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
            // ISO format with time
            const parsedDate = new Date(date);
            return formatDateForDisplay(parsedDate);
        }
        if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // Date only
            const [year, month, day] = date.split('-');
            return `${day}/${month}/${year}`;
        }
        const parsedDate = new Date(date);
        if (!isNaN(parsedDate.getTime())) {
            return formatDateForDisplay(parsedDate);
        }
    }
    return date;
}

// ===== NEW: Batch selection helper for sales (hints or default FIFO oldest) =====
async function selectBatchForSale(shopId, product, { byPurchaseISO=null, byExpiryISO=null, pick='fifo-oldest' } = {}) {
  const all = await getBatchRecords(shopId, product); // desc by PurchaseDate
  const withQty = (all || []).filter(b => (b.fields?.Quantity ?? 0) > 0);
  // match by purchase date
  if (byPurchaseISO) {
    const d = new Date(byPurchaseISO).toISOString().slice(0,10);
    const hit = withQty.find(b => String(b.fields.PurchaseDate).slice(0,10) === d);
    if (hit) return hit.fields.CompositeKey;
  }
  // match by expiry date
  if (byExpiryISO) {
    const d = new Date(byExpiryISO).toISOString().slice(0,10);
    const hit = withQty.find(b => String(b.fields.ExpiryDate || '').slice(0,10) === d);
    if (hit) return hit.fields.CompositeKey;
  }
  // keywords: latest/newest vs oldest/FIFO
  if (pick === 'latest' && withQty.length) return withQty[0].fields.CompositeKey;
  if (pick === 'oldest' && withQty.length) return withQty[withQty.length-1].fields.CompositeKey;
  // default FIFO (oldest)
  if (withQty.length) return withQty[withQty.length-1].fields.CompositeKey;
  return null;
}

// Offer override only when multiple batches with qty>0 exist.
async function shouldOfferBatchOverride(shopId, product) {
  try {
    const batches = await getBatchesForProductWithRemaining(shopId, product);
    return Array.isArray(batches) && batches.filter(b => (b.quantity ?? 0) > 0).length > 1;
  } catch { return false; }
}

function parseBatchOverrideCommand(text, baseISO = null) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;

  // Keywords
  if (/^batch\s+oldest$/.test(t)) return { pick: 'oldest' };
  if (/^batch\s+latest$/.test(t)) return { pick: 'latest' };

  
  // "batch dd-mm[/yyyy]" or "batch dd/mm[/yyyy]"
    let m = t.match(/^batch\s+(\d{1,2})\/\-(?:\/\-)?$/i);
    if (m) {
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      let yyyy = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : new Date().getFullYear();
      return { byPurchaseISO: new Date(Date.UTC(yyyy, parseInt(mm, 10) - 1, parseInt(dd, 10))).toISOString() };
    }
    // "exp dd-mm[/yyyy]" or "expiry dd/mm[/yyyy]"
    m = t.match(/^exp(?:iry)?\s+(\d{1,2})\/\-(?:\/\-)?$/i);
    if (m) {
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      let yyyy = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : new Date().getFullYear();
      return { byExpiryISO: new Date(Date.UTC(yyyy, parseInt(mm, 10) - 1, parseInt(dd, 10))).toISOString() };
    }

  return null;
}



// ===== NEW: Handle the 2-min post-sale override window =====
async function handleAwaitingBatchOverride(From, Body, detectedLanguage, requestId) {
  const shopId = From.replace('whatsapp:', '');
  const state = await getUserStateFromDB(shopId);
  if (!state || state.mode !== 'awaitingBatchOverride') return false;
  
// Self-heal: ensure action is present for any consumers that rely on state.data.action
  if (!state.data || !state.data.action) {
    try {
      await saveUserStateToDB(shopId, 'awaitingBatchOverride', { ...(state.data ?? {}), action: 'sold' });
    } catch (_) { /* best effort */ }
  }
 
  // Allow 'mode' / localized one-word switch while in the 2-min override window
    {
      const switchCmd = parseModeSwitchLocalized(Body);
      if (switchCmd) {
        try { await deleteUserStateFromDB(state.id); } catch (_) {}
        if (switchCmd.ask) {          
        await sendWelcomeFlowLocalized(From, detectedLanguage ?? 'en', requestId);
        return true;
        }
        if (switchCmd.set) {
          await setStickyMode(From, switchCmd.set); // purchased | sold | returned                  
        {
          let ack = await t(`✅ Mode set: ${switchCmd.set}`, detectedLanguage, `${requestId}::mode-set`);
          // ANCHOR: UNIQ:BATCH-OVERRIDE-MODE-SET-001
          await sendMessageViaAPI(From, finalizeForSend(ack, detectedLanguage));
        }
          return true;
        }
      }
    }
  
  // NEW: global reset inside override state
    if (isResetMessage(Body)) {
      try {                 
        //if (state?.mode !== 'awaitingTransactionDetails') {
        //  await deleteUserStateFromDB(state.id);
        //} 
      } catch (_) {}          
    let msg = await t(
      `✅ Reset. Cleared the current batch-selection window.`,
      detectedLanguage,
      requestId
    );
    // ANCHOR: UNIQ:BATCH-OVERRIDE-RESET-001
    await sendMessageViaAPI(From, finalizeForSend(msg, detectedLanguage));
      return true;
    }
  
  const data = state.data || {};
  const { saleRecordId, product, unit, quantity, oldCompositeKey, createdAtISO, timeoutSec=120, action='sold'} = data;
  const createdAt = new Date(createdAtISO || Date.now());
  if ((Date.now() - createdAt.getTime()) > (timeoutSec*1000)) {      
  //if (state?.mode !== 'awaitingTransactionDetails') {
  //  await deleteUserStateFromDB(state.id);
  //}
        
    let expired = await t(`⏳ Sorry, the 2‑min window to change batch has expired.`, detectedLanguage, requestId);
    // ANCHOR: UNIQ:BATCH-OVERRIDE-EXPIRED-001
    await sendMessageViaAPI(From, finalizeForSend(expired, detectedLanguage));
    return true;
  }

  const wanted = parseBatchOverrideCommand(Body);  
// DEBUG: see user input and parse result in logs
  try {
    console.log(`[${requestId}] [awaitingBatchOverride] text="${String(Body).trim()}" -> wanted=`, wanted);
  } catch (_) {}
    
  if (!wanted) {
     // If the message looks like a transaction, let the normal txn parser handle it
     if (looksLikeTransaction(String(Body))) {
       return false; // do NOT consume; downstream parser will use sticky 'sold'
     }
     // Otherwise (non-transaction chatter), show help
     
    let help = await t(
      COMPACT_MODE ? `Reply: batch DD-MM \n batch oldest \n batch latest (2 min)` :
      `Reply:\n• batch DD-MM (e.g., batch 12-09)\n• exp DD-MM (e.g., exp 20-09)\n• batch oldest \n batch latest\nWithin 2 min.`,
      detectedLanguage, requestId
    );
    // ANCHOR: UNIQ:BATCH-OVERRIDE-HELP-001
    await sendMessageViaAPI(From, finalizeForSend(help, detectedLanguage));
     return true;
   }

  const newKey = await selectBatchForSale(shopId, product, wanted);
  const newKeyNorm = normalizeCompositeKey(newKey);
  // DEBUG: show which composite key we are switching to (if any)
  try {
    console.log(`[${requestId}] [awaitingBatchOverride] product="${product}" newCompositeKey=`, newKey);
  } catch (_) {}
  if (!newKeyNorm) {
    const sorry = await t(
      `❌ Couldn’t find a matching batch with stock for ${product}. Try another date or "batches ${product}".`,
      detectedLanguage, requestId);
    await sendMessageViaAPI(From, sorry);
    return true;
  }

  const res = await reattributeSaleToBatch({
  saleRecordId, shopId, product,
      qty: Math.abs(quantity), unit,
      oldCompositeKey: normalizeCompositeKey(oldCompositeKey),
      newCompositeKey: newKeyNorm
  });
  if (!res.success) {        
    let fail = await t(
      `⚠️ Couldn’t find a matching batch with stock for ${product}. Try another date or "batches ${product}".`,
      detectedLanguage, requestId
    );
    // ANCHOR: UNIQ:BATCH-OVERRIDE-FAIL-001
    await sendMessageViaAPI(From, finalizeForSend(fail, detectedLanguage));
    return true;
  }
  
    
  //if (state?.mode !== 'awaitingTransactionDetails') {
  //  await deleteUserStateFromDB(state.id);
  //}
  const used = await getBatchByCompositeKey(newKeyNorm);
  const pd = used?.fields?.PurchaseDate ? formatDateForDisplay(used.fields.PurchaseDate) : '—';
  const ed = used?.fields?.ExpiryDate ? formatDateForDisplay(used.fields.ExpiryDate) : '—';      
    let ok = await t(
      `✅ Updated. ${product} sale now attributed to: Purchased ${pd} (Expiry ${ed}).`,
      detectedLanguage, requestId
    );
    // ANCHOR: UNIQ:BATCH-OVERRIDE-OK-001
    await sendMessageViaAPI(From, finalizeForSend(ok, detectedLanguage));
  return true;
}

// === NEW: Handle the 2‑min post‑purchase expiry override window ===
async function handleAwaitingPurchaseExpiryOverride(From, Body, detectedLanguage, requestId) {
  const shopId = From.replace('whatsapp:', '');
  const state = await getUserStateFromDB(shopId);
  if (!state || state.mode !== 'awaitingPurchaseExpiryOverride') return false;

  // Global reset allowed during window
  if (isResetMessage(Body)) {
    try {             
        await deleteUserStateFromDB(state.id);
    } catch (_) {}        
    let msg = await t(
      `✅ Reset. Cleared the expiry‑override window.`,
      detectedLanguage,
      requestId
    );
    // ANCHOR: UNIQ:EXPIRY-OVERRIDE-RESET-001
    await sendMessageViaAPI(From, finalizeForSend(msg, detectedLanguage));
    return true;
  }

  const data = state.data || {};
  const { batchId, product, createdAtISO, timeoutSec = 120, purchaseDateISO, currentExpiryISO } = data;
  const createdAt = new Date(createdAtISO || Date.now());
  if ((Date.now() - createdAt.getTime()) > (timeoutSec * 1000)) {        
    //if (state?.mode !== 'awaitingTransactionDetails') {
    //  await deleteUserStateFromDB(state.id);
    //}        
    let expired = await t(
      `⏳ Sorry, the 2‑min window to change expiry has expired.`,
      detectedLanguage,
      requestId
    );
    // ANCHOR: UNIQ:EXPIRY-OVERRIDE-EXPIRED-001
    await sendMessageViaAPI(From, finalizeForSend(expired, detectedLanguage));
    return true;
  }

  
// Avoid shadowing the translator helper `t(...)`
  const txt = String(Body).trim().toLowerCase();

  // Allow 'mode' / localized switch words during the override window too.
  // If user wants to switch context, clear this short-lived state and act.
  const switchCmd = parseModeSwitchLocalized(Body);      
    if (switchCmd) {
        // Optional: clear this short-lived override state when user switches context
        try { await deleteUserStateFromDB(state.id); } catch (_) {}
        if (switchCmd.ask) {
          await sendWelcomeFlowLocalized(From, detectedLanguage ?? 'en', requestId);
          return true;
        }
        if (switchCmd.set) {
          await setStickyMode(From, switchCmd.set);                      
         {
              let ack = await t(`✅ Mode set: ${switchCmd.set}`, detectedLanguage, `${requestId}::mode-set`);
              // ANCHOR: UNIQ:EXPIRY-OVERRIDE-MODE-SET-001
              await sendMessageViaAPI(From, finalizeForSend(ack, detectedLanguage));
            }
          return true;
        }
      }
  // Keep current
  if (txt === 'ok' || txt === 'okay') {        
    //if (state?.mode !== 'awaitingTransactionDetails') {
    //  await deleteUserStateFromDB(state.id);
    //}
    const kept = currentExpiryISO ? formatDateForDisplay(currentExpiryISO) : '—';        
    let keptMsg = await t(
      `✅ Kept expiry for ${product}: ${kept}`,
      detectedLanguage,
      requestId
    );
    // ANCHOR: UNIQ:EXPIRY-OVERRIDE-KEEP-001
    await sendMessageViaAPI(From, finalizeForSend(keptMsg, detectedLanguage));
    return true;
  }
  // Clear expiry
  if (txt === 'skip' || txt === 'clear') {
    try { await updateBatchExpiry(batchId, null); } catch (_) {}          
      //if (state?.mode !== 'awaitingTransactionDetails') {
      //  await deleteUserStateFromDB(state.id);
      //}        
    let clearedMsg = await t(`✅ Cleared expiry for ${product}.`, detectedLanguage, requestId);
    // ANCHOR: UNIQ:EXPIRY-OVERRIDE-CLEAR-001
    await sendMessageViaAPI(From, finalizeForSend(clearedMsg, detectedLanguage));
    return true;
  }

  // Set new expiry (supports: exp DD-MM / DD/MM/YYYY / +7d / +3m / +1y)
  const wanted = parseBatchOverrideCommand(Body) || {};
  let newISO = null;
  if (txt.startsWith('exp') || txt.startsWith('expiry')) {
    const raw = Body.replace(/^\s*(expiry|expires?|exp)\s*/i, '');
    newISO = parseExpiryTextToISO(raw, purchaseDateISO);
    if (newISO) newISO = bumpExpiryYearIfPast(newISO, purchaseDateISO || new Date().toISOString());
  } else if (wanted.byExpiryISO) {
    newISO = bumpExpiryYearIfPast(wanted.byExpiryISO, purchaseDateISO || new Date().toISOString());
  }
  
  if (!newISO) {          
    let help = await t(
      COMPACT_MODE ? `Reply: exp +7d | +3m | +1y • skip (clear)` :
      `Reply with:\n• exp +7d / exp +3m / exp +1y\n• skip (to clear)`,
      detectedLanguage, requestId
    );
    // ANCHOR: UNIQ:EXPIRY-OVERRIDE-HELP-001
    await sendMessageViaAPI(From, finalizeForSend(help, detectedLanguage));
      return true;
    }

  try { await updateBatchExpiry(batchId, newISO); } catch (_) {}      
    //if (state?.mode !== 'awaitingTransactionDetails') {
    //  await deleteUserStateFromDB(state.id);
    //}
  const shown = formatDateForDisplay(newISO);      
    let ok = await t(
      `✅ Updated. ${product} expiry set to ${shown}.`,
      detectedLanguage, requestId
    );
    // ANCHOR: UNIQ:EXPIRY-OVERRIDE-UPDATED-001
    await sendMessageViaAPI(From, finalizeForSend(ok, detectedLanguage));
  return true;
}


function parseExpiryTextToISO(text, baseISO = null) {
  if (!text) return null;
  const raw = String(text).trim();
  const base = baseISO ? new Date(baseISO) : new Date();
  if (isNaN(base)) return null;

  // Relative: +7d / +3m / +1y
  const rel = raw.match(/^\+(\d+)\s*([dmy])$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const d = new Date(base);
    if (unit === 'd') d.setDate(d.getDate() + n);
    if (unit === 'm') d.setMonth(d.getMonth() + n);
    if (unit === 'y') d.setFullYear(d.getFullYear() + n);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }

  // Absolute: 15-12, 15/12, 15-12-25, 15/12/2025
  const abs = raw.match(/^(\d{1,2})\/-(?:\/-)?$/);
  if (abs) {
    const dd = Math.min(31, parseInt(abs[1], 10));
    const mm = Math.max(1, Math.min(12, parseInt(abs[2], 10))) - 1;
    let yyyy = abs[3] ? parseInt(abs[3], 10) : base.getFullYear();
    if (abs[3] && abs[3].length === 2) yyyy = 2000 + yyyy;
    const d = new Date(Date.UTC(yyyy, mm, dd, 0, 0, 0, 0));
    return d.toISOString();
  }
  return null;
}


// Local fallback: normalize a date-like into an ISO date at midnight UTC
function toISODateUTC(dateLike) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// If an expiry ends up before the purchase date (e.g., user typed 14/11/2024 while today is 2025),
// bump the year until it is >= base date (max 2 bumps) and return ISO.
function bumpExpiryYearIfPast(proposedISO, baseISO) {
  if (!proposedISO) return null;
  const base = new Date(baseISO || new Date().toISOString());
  let d = new Date(proposedISO);
  if (isNaN(d.getTime())) return null;
  // Normalize both to midnight UTC to avoid off-by-hours
  d.setUTCHours(0, 0, 0, 0);
  const baseMid = new Date(base);
  baseMid.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 2 && d < baseMid; i++) {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString();
}

// Extract price (₹60 / 60 / 60.5) and expiry (same formats as above) in ONE shot
function parsePriceAndExpiryFromText(text, baseISO = null) {
  const out = { price: null, expiryISO: null, ok: false, skipExpiry: false };
  if (!text) return out;
  const t = String(text).trim().toLowerCase();
  if (t === 'ok' || t === 'okay') { out.ok = true; return out; }
  if (t === 'skip') { out.skipExpiry = true; return out; }

  // Prefer explicit exp/expiry/expires segment
  let dateToken = null;
  const m1 = text.match(/\b(?:expiry|expires?|exp)\b[^\d+]*([0-9]{1,2}[\/-][0-9]{1,2}(?:[\/-][0-9]{2,4})?|\+\d+\s*[dmy])/i);
  if (m1) dateToken = m1[1];

  // Otherwise: first date-like token anywhere
  if (!dateToken) {
    const m2 = text.match(/(\+\d+\s*[dmy]|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)/i);
    if (m2) dateToken = m2[1];
  }
  if (dateToken) {
    const iso = parseExpiryTextToISO(dateToken, baseISO);
    if (iso) out.expiryISO = iso;
  }

  // Price extraction: ₹60 / rs 60 / standalone number (avoid dates)
  const cleaned = text.replace(/\b(?:expiry|expires?|exp)\b[\s\S]*$/i, ' ');
  let pMatch = cleaned.match(/(?:₹|rs\.?\s*)(\d+(?:\.\d+)?)/i);
  if (!pMatch) {
    for (const tok of cleaned.split(/\s+/)) {
      if (/^\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?$/.test(tok)) continue; // skip dates
      const m = tok.match(/^(\d+(?:\.\d+)?)$/);
      if (m) { pMatch = m; break; }
    }
  }
  if (pMatch) {
    const p = parseFloat(pMatch[1]);
    if (Number.isFinite(p) && p > 0) out.price = p;
  }

  return out;
}



// Helper function to calculate days between two dates
function daysBetween(date1, date2) {
  const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds
  const diffDays = Math.round(Math.abs((date1 - date2) / oneDay));
  return diffDays;
}


// -------- Any-language -> English command normalizer --------
/**
 * normalizeCommandText
 *  - Input: user message in ANY language that likely represents one of the 8 quick commands
 *  - Output: an ENGLISH command phrase that matches your router regexes
 *    Examples:
 *      "आज की बिक्री"         -> "sales today"
 *      "Maggi का stock?"      -> "stock Maggi"
 *      "இந்த வார விற்பனை"     -> "sales week"
 *      "expiring कितने दिन?"  -> "expiring 30" (defaults to 30 if none given)
 *  - Guarantees: keeps BRAND/PRODUCT names and NUMBERS as-is, no quotes, one line.
 */
async function normalizeCommandText(text, detectedLanguage = 'en', requestId = 'cmd-norm') { 
// If the message clearly looks like a transaction (qty/unit + buy/sell verb), never rewrite it
   // into an English quick command like "sales today".
    
// ✅ Prevent double handling if Q&A or onboarding already replied
  if (handledRequests.has(requestId)) {
      console.log(`[router] skipping transaction parse (already handled)`, { requestId });
      return true;
  }

  if (looksLikeTransaction(text)) {
     return String(text).trim();
   }
  try {
    if (!text || !text.trim()) return text;        
    // [UNIQ:NORM-VAR-LOCK-001] Keep exact variant (e.g., 'hi-latn')
        const langExact = ensureLangExact(detectedLanguage || 'en');
        // If some upstream normalized to base 'hi', this defensive fix retains '-latn' when present.
        // Use langExact consistently for cache & logs to avoid cross-variant reuse.
    
        const lang = langExact; // keep original variable name below for minimal patch
      
    const raw = text.trim();
    const intent = resolveSummaryIntent(raw);
    if (intent) return intent;

    // Cache check
    const keyHash = crypto.createHash('sha1').update(`${langExact}::${raw}`).digest('hex'); // variant-safe
    const cacheKey = `${COMMAND_NORM_PREFIX}${lang}:${keyHash}`;
    const cached = languageCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < LANGUAGE_CACHE_TTL)) {
      console.log(`[${requestId}] Using cached command normalization (${lang})`);
      return cached.value;
    }

    const systemPrompt = [
      'You rewrite user commands about inventory into ENGLISH one-line commands for a WhatsApp bot.',
      'STRICT RULES:',
      '- KEEP brand/product names EXACTLY as user wrote them (do NOT translate brand names).',
      '- KEEP numbers as digits.',
      '- Map intents to these exact keywords:',
      '  • "stock <product>" (aka "inventory <product>" or "qty <product>")',
      '  • "low stock" or "stockout"',
      '  • "batches <product>" or "expiry <product>"',
      '  • "expiring <days>" (default to 30 if days not specified)',
      '  • "sales today|week|month"',
      '  • "top <N> products [today|week|month]" (default N=5, period=month if missing)',
      '  • "reorder" (or "reorder suggestions")',
      '  • "inventory value" (aka "stock value" or "value summary")',
      '  • "prices [<page>]" (aka "price updates [<page>]" or "stale prices [<page>]")',
      '  • "expired items" → "expiring 0"',
      '  • "show expired stock" → "expiring 0"',
      '  • "products [<page>]" or "list products [<page>]"',
      '  • "products search <term>" or "search products <term>"',      
      '  • "short summary" (aka "summary", "छोटा सारांश", "chhota saraansh")',
      '  • "full summary" (aka "पूरा सारांश", "poora saraansh", "विस्तृत सारांश", "vistrit saaransh")',
      'Output ONLY the rewritten English command, no quotes, no extra words.'
    ].join(' ');

    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: raw }
        ],
        temperature: 0.1,
        max_tokens: 120
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    let normalized = (response.data?.choices?.[0]?.message?.content || '').trim();
    // Safety: strip code fences/quotes if model adds them
    if (normalized.startsWith('```')) normalized = normalized.replace(/^```(?:\w+)?\s*/i, '').replace(/```$/i, '').trim();
    normalized = normalized.replace(/^"(.*)"$/, '$1').trim();
    if (!normalized) return text;

    // Cache & return
    languageCache.set(cacheKey, { value: normalized, timestamp: Date.now() });
    console.log(`[${requestId}] Normalized: "${raw}" (${langExact}) -> "${normalized}"`); // clearer logs
    return normalized;
  } catch (err) {
    console.warn(`[${requestId}] Command normalization failed:`, err?.message);
    // Gracefully fallback to original text if the API is unavailable
    return text;
  }
}

const EXAMPLE_PURCHASE_EN = [
  'Examples (purchased):',
  '• bought milk 10 liters @60 exp 20-09',
  '• purchased Parle-G 12 packets ₹10 exp +6m',
  '• khareeda doodh 5 ltr ₹58 expiry 25/09/2025'
].join('\n');

async function renderPurchaseExamples(language, requestId = 'examples') {
  return await t(EXAMPLE_PURCHASE_EN, language ?? 'en', requestId);
}


async function sendParseErrorWithExamples(From, detectedLanguage, requestId, header = `Sorry, I couldn't understand that.`) {  
  // Handled guard: if this request already replied anywhere, don't send apology
  try {
    if (handledRequests.has(requestId)) {
      console.log(`[${requestId}] Suppressing parse-error: request already handled`);
      return;
    }
  } catch (_) {}

  // --- PATCH C: Short-circuit generic parse-error if we're awaiting user input (price/expiry) ---
  try {
    const shopId = String(From).replace('whatsapp:', '');
    // Uses DB-backed state; already imported at top: getUserStateFromDB
    const state = await getUserStateFromDB(shopId);
    if (state && state.mode === 'awaitingPriceExpiry') {
      console.log(`[${requestId}] Suppressing parse-error message; user state=${state.mode}`);
      return; // Don't send the generic "Sorry..." while we're waiting for price/expiry reply
    }
  } catch (guardErr) {
    console.warn(`[${requestId}] Pending-state guard failed:`, guardErr.message);
    // fall through to normal parse-error behavior
  }
  // --- END PATCH C ---
  try {
    const examples = await renderPurchaseExamples(detectedLanguage, requestId + ':err-ex');        
    let msg = await t(
          `${header}\n\n${examples}`,
          detectedLanguage, requestId + ':err'
        );
        // ANCHOR: UNIQ:PARSE-ERROR-FINALIZE-001
        await sendMessageViaAPI(From, finalizeForSend(msg, detectedLanguage));
  } catch (e) {
    // Fallback to basic English if translation fails
    await sendMessageViaAPI(From, finalizeForSend(`${header}\n\n${EXAMPLE_PURCHASE_EN}`, 'en'));
  }
}


// ---------------- QUICK-QUERY ROUTER (English-only hotfix) ----------------
function _periodWindow(period) {
  const now = new Date();
  const p = (period || '').toLowerCase();
  if (p === 'today' || p === 'day') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { start, end, label: 'today' };
  }
  if (p.includes('week')) {
    const start = new Date(now); start.setDate(now.getDate() - 7);
    return { start, end: now, label: 'week' };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start, end: now, label: 'month' };
}

function _norm(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9\s]/g,'').trim(); }

// ====== Raw-body quick-query wrapper (de-duplicated) =========================
// IMPORTANT: The canonical command router is `handleQuickQueryEN(cmd, From, lang, source)`.
// This wrapper orchestrates the raw text once, then routes any normalized command
// to the canonical router (no self-recursion). It does *not* format inventory outputs.
async function routeQuickQueryRaw(rawBody, From, detectedLanguage, requestId) {
  const startTime = Date.now();
  const text = String(rawBody || '').trim();    
  const shopId = String(From).replace('whatsapp:', '');   

// ===== EARLY EXIT: questions win before any inventory/transaction parse =====
  let _lang = String(detectedLanguage ?? 'en').toLowerCase();
  let _orch = { language: _lang, kind: null, isQuestion: null, normalizedCommand: null };
  try {
    _orch = await applyAIOrchestration(text, From, _lang, requestId);
    _lang = _orch.language ?? _lang;
  } catch (_) { /* best-effort */ }
    
// ---------- Q&A branch remains local; inventory/summary delegates to canonical -----
  // If orchestrator classified it as a QUESTION, answer and exit.
  if (_orch.isQuestion === true || _orch.kind === 'question') {
    handledRequests.add(requestId); // prevent late apologies in this cycle
    const ans  = await composeAISalesAnswer(shopId, text, _lang);    
    const cacheKey = buildTranslationCacheKey(requestId, topicForced || 'qa', pricingFlavor || 'n/a', _lang, text);
    const msg0 = await tx(ans, _lang, From, text, cacheKey);
    const msg  = nativeglishWrap(msg0, _lang);
    await sendMessageQueued(From, msg);        
    try {
          const isActivated = await isUserActivated(shopId);
          await sendSalesQAButtons(From, _lang, isActivated);
        } catch (e) {
          console.warn(`[${requestId}] qa-buttons send failed:`, e?.message);
        }
    return true;
  }

  // If AI produced a normalized read-only command (summary/list/etc.), route to canonical and exit.
  if (_orch.normalizedCommand) {   
    handledRequests.add(requestId);
        const normalized = String(_orch.normalizedCommand).trim().toLowerCase();
        const raw = String(text).trim().toLowerCase();
    
        // Recursion guard #1: if normalizer returns the same command, dispatch inline (no re-orchestration)
        const sameCommand = normalized === raw;           
                
        // Recursion guard #2: cap re-entry depth based on requestId markers
          const aliasDepth =
            ((requestId || '').match(/:alias/g) || []).length +
            ((requestId || '').match(/::ai-norm/g) || []).length +   // handle double-colon marker
            ((requestId || '').match(/:ai-norm/g) || []).length;     // defensive: single-colon form
          const MAX_ALIAS_DEPTH = Number(process.env.MAX_ALIAS_DEPTH ?? 1);

        const tooDeep = aliasDepth >= MAX_ALIAS_DEPTH;
               
        // Helper: delegate normalized command to canonical handler
            const delegate = async (cmd, srcTag) =>
              await handleQuickQueryEN(cmd, From, _lang, `${requestId}${srcTag}`);
    
        // Avoid infinite loops: inline dispatch for summaries, or stop if depth exceeded
        if (sameCommand || tooDeep) {
                  
        // Always delegate (single hop) to canonical to keep single message style
              return await delegate(normalized, '::ai-norm');
                                    
        // Safe single hop: route once to canonical command router
            return await delegate(_orch.normalizedCommand, ':alias-raw');
  }

  // Question detection: prefer orchestrator; if null, use legacy detector.
  // This makes Q&A win BEFORE welcome, while gating (ensureAccessOrOnboard) remains non-AI.  [1](https://airindianew-my.sharepoint.com/personal/kunal_kansra_airindia_com/Documents/Microsoft%20Copilot%20Chat%20Files/whatsapp.js.txt)           
    let isQuestion = _orch.isQuestion;
     if (isQuestion == null) {
       const languagePinned = (_orch.language ?? (detectedLanguage ?? 'en')).toLowerCase();
       isQuestion = await looksLikeQuestion(text, languagePinned);
     }
    
      // ✅ Respect AI orchestration: if kind === 'question', exit early
      if (_orch.kind === 'question') {
          handledRequests.add(requestId);
          console.log(`[router] AI classified as question → skipping downstream parse`, { requestId });
          return true;
      }

  // Prevent greeting/onboarding on question turns (AI or legacy).  [1](https://airindianew-my.sharepoint.com/personal/kunal_kansra_airindia_com/Documents/Microsoft%20Copilot%20Chat%20Files/whatsapp.js.txt)
  try {
    if (isQuestion) {
      cancelAiDebounce(shopId);
    }
  } catch (_) {}
      
  // Robust question detection for *all* modes (no "?" required)
  isQuestion = await looksLikeQuestion(text, detectedLanguage);
  // Hard force: invoice/bill queries must go to Q&A
  const qForce = /\b(invoice|bill|बिल|चालान)\b/i.test(text);
  if (qForce) isQuestion = true;
  console.log('[router] entry', { requestId, isQuestion, qForce, text });
  
    // ===== STEP 14: "mode" keyword shows Purchase/Sale/Return buttons =====
    try {
      const MODE_ALIASES = [/^mode$/i, /^मोड$/i];
      const askMode = MODE_ALIASES.some(rx => rx.test(text)) && !isQuestion; // do not override Q&A
      if (askMode && !isQuestion) {
        // Show the quick-reply template in user's saved language (queued + idempotent)
        let lang = String(detectedLanguage || 'en').toLowerCase();
        try {
          const pref = await getUserPreference(shopId);
          if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
        } catch (_) {}
        await ensureLangTemplates(lang);
        const sids = getLangSids(lang) || {};
        const qrSid = sids.quickReplySid;
        if (qrSid) await sendContentTemplateQueuedOnce({ toWhatsApp: shopId, contentSid: qrSid, requestId });
        handledRequests.add(requestId);
        return true;
      }
    } catch (_) {}
          
    // ==== UPDATED HELP (minimal) — text commands ====
      try {
        const HELP_ALIASES = [/^help$/i, /^मदद$/i, /^सहायता$/i];
        const wantHelp = HELP_ALIASES.some(rx => rx.test(text));
        if (wantHelp) {
          let lang = String(detectedLanguage || 'en').toLowerCase();
          try {
            const pref = await getUserPreference(shopId);
            if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
          } catch (_) {}
          await sendHelpMinimal(From, lang, requestId);
          handledRequests.add(requestId);
          return true;
        }
      } catch (_) {}
  
    // ==== NUMERIC ONBOARDING TEXT: "3" → Help (minimal) for non-activated ====
      try {
        const NUM = text.replace(/\s+/g, '');
        if (NUM === '3') {
          let lang = String(detectedLanguage || 'en').toLowerCase();
          let activated = false;
          try {
            const pref = await getUserPreference(shopId);
            if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
            const plan = String(pref?.plan ?? '').toLowerCase();
            activated = (plan === 'trial' || plan === 'paid');
          } catch (_) {}
          if (!activated) {
            await sendHelpMinimal(From, lang, requestId);
            handledRequests.add(requestId);
            return true;
          }
        }
      } catch (_) {}
  
    // ===== STEP 17: Multilingual aliases for "short/full summary" =====
    try {
      // SUMMARY_ALIAS_MAP exists elsewhere in your code; reuse if present
      // We add an inline guard so this block is safe even if it's moved.
      const normalized = (() => {
        const lc = String(detectedLanguage || 'en').toLowerCase();
        const q = text.toLowerCase();
        // Known short/full alias arrays are defined in SUMMARY_ALIAS_MAP; fall back to regexes if absent.
        const SHORT_FALLBACK = [/^short\s+summary$/i, /^छोटा\s+सारांश$/i, /^संक्षिप्त\s+सारांश$/i];
        const FULL_FALLBACK  = [/^full\s+summary$/i,  /^पूरा\s+सारांश$/i,   /^विस्तृत\s+सारांश$/i];
        try {
          if (typeof SUMMARY_ALIAS_MAP === 'object') {
            const m = SUMMARY_ALIAS_MAP[lc] || {};
            const hitShort = (m.short || []).some(s => String(s).toLowerCase() === q);
            const hitFull  = (m.full  || []).some(s => String(s).toLowerCase() === q);
            if (hitShort) return 'short summary';
            if (hitFull)  return 'full summary';
          }
        } catch (_) {}
        if (SHORT_FALLBACK.some(rx => rx.test(text))) return 'short summary';
        if (FULL_FALLBACK.some(rx  => rx.test(text))) return 'full summary';
        return null;
      })();
      if (normalized) {                              
        // Route to canonical command router (normalized alias) — single source of truth
        await handleQuickQueryEN(normalized, From, detectedLanguage, `${requestId}:alias-raw`);
        handledRequests.add(requestId);
        return true;
      }
    } catch (_) {}
    
  // STEP 9: If this input is not a question, cancel any pending debounced Q&A
    // (prevents answering an outdated question after the user changed context)
    try {
      const isQ = (() => {
        const t = text.toLowerCase();
        return /\?$/.test(t) || /price|how|why|benefit|फायदा|क्यों|कैसे|कितना|कीमत/.test(t);
      })();
      if (!isQ) cancelAiDebounce(shopId);
    } catch (_) { /* best-effort */ }
  
  // FAST PATH: pure greeting → welcome and exit early (prevents ack/parse-error later)
  if (_isGreeting(text)) {
   await sendWelcomeFlowLocalized(From, detectedLanguage ?? 'en', requestId);
   handledRequests.add(requestId);
   return true;
 }
  
  // NEW: record activity (touch LastUsed) for every inbound
  try { await touchUserLastUsed(String(From).replace('whatsapp:', '')); } catch {}    
  // NEW: gate for paywall/onboarding    
  const gate = await ensureAccessOrOnboard(From, rawBody, detectedLanguage);                  
      // Send ack for non-question messages only (see Enhancement D)
        // Stronger question detection for Indian-language Qs               
        isQuestion = isQuestion ||
          /\?\s*$/.test(text) ||
          /\b(price|cost|charges?)\b/i.test(text) ||
          /(\bकीमत\b|\bमूल्य\b|\bलागत\b|\bकितना\b|\bक्यों\b|\bकैसे\b)/i.test(text);
     
          /**
             * Q&A BEFORE WELCOME:
             * If the user asks a question (price/benefits/how), answer via AI sales Q&A first,
             * even for new/unactivated users. This enables qa-sales mode reliably.
             */               
        if (isQuestion) {
            try {
              cancelAiDebounce(shopId); // reset any old pending answer
              // STEP 5: Debounce Q&A if enabled (prevents duplicate/tail sends)
              if (SHOULD_DEBOUNCE) {
                // use languagePinned if available, else detectedLanguage
                const langForDebounce = (typeof languagePinned === 'string' ? languagePinned : String(detectedLanguage ?? 'en').toLowerCase());
                scheduleAiAnswer(shopId, From, text, langForDebounce, requestId);
                handledRequests.add(requestId);
                return true; // early exit; actual answer will be sent by the debounce timer
              }
        
              // Immediate send path (serverless-safe); prefer languagePinned (e.g., hi-latn for Hinglish)
              const langForQa = (typeof languagePinned === 'string' ? languagePinned : String(detectedLanguage ?? 'en').toLowerCase());
              let ans;
              try {
                ans = await composeAISalesAnswer(shopId, text, langForQa);
              } catch (e) {
                console.warn('[sales-qa] composeAISalesAnswer failed, using localized fallback', e?.message);
                ans = getLocalizedQAFallback(langForQa);
              }
              const m0  = await tx(ans, langForQa, From, text, `${requestId}::sales-qa-first`);
              const msg = nativeglishWrap(m0, langForQa);
              console.log('[sales-qa] sending via API', { requestId, to: From, len: msg.length });
              await sendMessageViaAPI(From, finalizeForSend(msg, langForQa));
              console.log('[sales-qa] sent OK', { requestId });
        
              // STEP 7: Persist turn (parity with debounced path)
              try { await appendTurn(shopId, text, msg, inferTopic(text)); } catch (_) { /* best-effort */ }
              handledRequests.add(requestId);
              // Q&A → For non-activated users, show Onboarding QR (business gate remains non-AI)
              try {
                const activated = await isUserActivated(shopId);
                if (!activated) await sendOnboardingQR(shopId, langForQa ?? 'en');
              } catch (e) {
                console.warn('[sales-qa-first] onboarding send failed', { status: e?.response?.status, data: e?.response?.data, msg: e?.message });
              }
              // IMPORTANT: Do not schedule upsell/tips after Q&A
              try { suppressTipsFor.add(requestId); } catch {}
              console.log('[router] sales-qa branch completed', { requestId });            
              handledRequests.add(requestId); // ensure marked
              return true; // ✅ EARLY EXIT to prevent downstream parsing
              return true;
            } catch (e) {
              console.warn('[sales-qa] first-answer failed:', e?.message);
            }
          }
          
            // ===== NEW: If AI hinted a transaction, DO NOT auto-apply.
              // We keep deterministic transaction parsing/update and state windows.
              // (aiTxn is advisory; the normal parser continues to parse raw text.)  [1](https://airindianew-my.sharepoint.com/personal/kunal_kansra_airindia_com/Documents/Microsoft%20Copilot%20Chat%20Files/whatsapp.js.txt)
              if (orchestrated.aiTxn && !isQuestion) {
                console.log('[router] aiTxn hint (advisory)', { requestId, aiTxn: orchestrated.aiTxn });
                // No action here: fall through to existing deterministic transaction handlers.
                // Your existing purchase/sale/return parsers and "awaitingPriceExpiry/BatchOverride" flows remain intact.  [1](https://airindianew-my.sharepoint.com/personal/kunal_kansra_airindia_com/Documents/Microsoft%20Copilot%20Chat%20Files/whatsapp.js.txt)
              }
            
            // ====== Welcome/Onboarding WHEN appropriate (first-ever greeting/language, or session-expired greeting) ======
            try {                            
                if (await shouldWelcomeNow(shopId, text)) {
                await sendWelcomeFlowLocalized(From, detectedLanguage ?? 'en', requestId);
                handledRequests.add(requestId);
                return true;
              }
            } catch { /* best-effort */ }
                   
    // IMPORTANT: Only send the generic ack if we did NOT (and will not) show welcome.
      // At this point, welcome has already been checked above and returned if sent.           
      if (!isQuestion && !handledRequests.has(requestId)) {
         try { await sendMessageQueued(From, await t('Processing your message…', detectedLanguage, `${requestId}::ack`)); } catch {}
       }

    if (gate && gate.allow === false) {
      // truly blocked (deactivated/blacklisted)
      await sendMessageQueued(From, await t('Your access is currently restricted. Please contact support.', detectedLanguage, `${requestId}::blocked`));
      safeTrackResponseTime(startTime, requestId);
      return true;
    }
      
    // ====== Q&A FIRST for new/unactivated users (pricing/benefits), post-welcome ======
      // If user is unactivated and asks a question, answer via AI Sales Q&A instead of re-sending onboarding.
      if (isQuestion && gate && (gate.upsellReason === 'new_user' || gate.upsellReason === 'trial_ended')) {                
        const ans = await composeAISalesAnswer(shopId, text, detectedLanguage);
            // Send AI-native answer without MT; keep one script + readable anchors
            const aiNative = enforceSingleScriptSafe(ans, detectedLanguage);
            const msg = normalizeNumeralsToLatin(
              nativeglishWrap(aiNative, detectedLanguage)
            );
            await sendMessageQueued(From, msg);
        handledRequests.add(requestId);
        return true;
      }
  
  if (isResetMessage(text)) {
      await clearUserState(From);
      await sendMessageQueued(
        From,
        await t('✅ Reset. Mode cleared.', detectedLanguage, `${requestId}::reset`),
        detectedLanguage
      );
      await scheduleUpsell(gate?.upsellReason);
      return true;
    } 
    
  // --- Gamification progress quick query ---
    // Place early so it's responsive and doesn't collide with other commands
    if (/^(progress|gamification|badges)$/i.test(text)) {
      const shopId = From.replace('whatsapp:', '');
      const state = readGamify();
      const gs = state[shopId] || { points: 0, entries: 0, streakDays: 0, lastActivityDate: '—', badges: [] };
      const msgEn =
        `⭐ Progress\n` +
        `• Points: ${gs.points}\n` +
        `• Entries: ${gs.entries}\n` +
        `• Streak: ${gs.streakDays} day(s)\n` +
        `• Last activity: ${gs.lastActivityDate}\n` +
        (gs.badges.length ? `• Badges: ${gs.badges.join(', ')}` : `• Badges: —`);
      const msg = await t(msgEn, detectedLanguage, requestId);
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }
  
// Fallback: if an interactive list id leaked into Body, map it to command
  {
    const id = text.toLowerCase();
    const listMap = {
      'list_short_summary': 'short summary',
      'list_full_summary': 'full summary',
      'list_reorder_suggest': 'reorder suggestions',
      'list_sales_week': 'sales week',
      'list_expiring_30': 'expiring 30',
      'list_low': 'low stock',
      'list_expiring': 'expiring 0',
      'list_sales_day': 'sales today',
      'list_top_month': 'top 5 products month',
      'list_value': 'value summary'
    };
    if (listMap[id]) {             
        // Route list selection → canonical command router               
        const out = await handleQuickQueryEN(listMap[id], From, detectedLanguage, `${requestId}::listfb`);
            try { await maybeResendListPicker(From, detectedLanguage, requestId); } catch (_) {}
            return out;
    }
  }
  
    
  // —helper: schedule upsell after we send any main message
    async function scheduleUpsell(reason) {
      try {                
        // If this request has already been handled (e.g., we sent onboarding),
            // do NOT send another onboarding via upsell.
            if (requestId && handledRequests.has(requestId)) {
              return;
            }
        if (!reason || reason === 'none' || gate?.suppressUpsell) return;                
        // Footer suppression marker (read by tagWithLocalizedMode)
        const NO_FOOTER_MARKER = '<!NO_FOOTER!>';
        let body;
        switch (reason) {                                                  
            // ENHANCEMENT A: do not compose or send onboarding again for these cases
                    case 'new_user':
                    case 'trial_started':
                    case 'paid_confirmed':
                      return; // short-circuit: onboarding already handled elsewhere
            
                    case 'trial_ended':
                    case 'inactive':
                      body = await t(
                        `To continue, pay ₹11 via Paytm → ${PAYTM_NUMBER} (${PAYTM_NAME})
            Or pay at: ${PAYMENT_LINK}
            Reply "paid" after payment ✅`,
                        detectedLanguage, `${requestId}::up-pay`
                      );
                      break;
                    case 'paid_verification_failed':
                      body = await t(
                        `We couldn't verify your payment yet. Please try again or contact support.`,
                        detectedLanguage, `${requestId}::up-paid-fail`
                      );
                      break;
                    default:
                      return; // no upsell needed
        }              
      await sendMessageQueued(From, NO_FOOTER_MARKER + body);
      } catch (e) { console.warn('[upsell] failed:', e?.message); }
    }
  
    try {     
      // NEW: Smart sales Q&A for non-transaction, question-like prompts (benefits/clarifications)                                      
        if (!looksLikeTransaction(text) && isQuestion) {
            // STEP 5: Debounce Q&A if enabled (same behavior as early branch)
            if (SHOULD_DEBOUNCE) {
                scheduleAiAnswer(shopId, From, text, detectedLanguage, requestId);
                handledRequests.add(requestId);
                return true; // early exit; debounce will send the answer
              }                             
                
        const shopId = String(From).replace('whatsapp:', '');
            let ans;
            try {
              ans = await composeAISalesAnswer(shopId, text, detectedLanguage);
            } catch (e) {
              console.warn('[sales-qa] composeAISalesAnswer failed, using localized fallback', e?.message);
              ans = getLocalizedQAFallback(String(detectedLanguage ?? 'en').toLowerCase());
            }
            const m0  = await tx(ans, detectedLanguage, From, text, `${requestId}::sales-qa`);
            const msg = nativeglishWrap(m0, detectedLanguage);
            console.log('[sales-qa] sending via API', { requestId, to: From, len: msg.length });
            await sendMessageViaAPI(From, msg);
            console.log('[sales-qa] sent OK', { requestId });
                  
          // STEP 7: Persist turn (for parity with debounced path)
              try {
                await appendTurn(shopId, text, msg, inferTopic(text));
              } catch (_) { /* best-effort */ }
          handledRequests.add(requestId); // avoid any late parse-error or duplicate onboarding                   
          // Q&A → For non-activated users, show Onboarding QR
              try {
                const activated = await isUserActivated(shopId);
                if (!activated) {
                  await sendOnboardingQR(shopId, detectedLanguage ?? 'en');
                }
              } catch (e) {
                console.warn('[sales-qa] onboarding send failed', {
                  status: e?.response?.status, data: e?.response?.data, msg: e?.message
                });
              }
              // IMPORTANT: Do not schedule upsell/tips after Q&A
              try { suppressTipsFor.add(requestId); } catch {}
              console.log('[router] sales-qa (non-txn) branch completed', { requestId });
              return true;
        }

// NEW: Intercept post‑purchase expiry override first
    if (await handleAwaitingPurchaseExpiryOverride(From, text, detectedLanguage, requestId)) return true;
    // Intercept post‑sale batch override next
    if (await handleAwaitingBatchOverride(From, text, detectedLanguage, requestId)) return true;
    

// Greeting -> concise, actionable welcome (single-script friendly)
    
  if (/^\s*(hello|hi|hey|namaste|vanakkam|namaskar|hola|hallo)\s*$/i.test(text)) {                
    // Never welcome during a question turn — answer first
      if (!isQuestion && await shouldWelcomeNow(shopId, text)) {
      await sendWelcomeFlowLocalized(From, detectedLanguage ?? 'en', requestId);
      handledRequests.add(requestId);
      return true;
    }
    // If we've welcomed recently in this session, fall through to Q&A/other handlers
  }
  
  // ---------- LAST-RESORT: if it's a question and nothing has replied, send a crisp invoice answer ----------
  if (isQuestion && !handledRequests.has(requestId)) {
    try {
      const lang = String(detectedLanguage ?? 'en').toLowerCase();
      const ansBase =
        lang.startsWith('hi')
          ? 'Haan — sale ke baad invoice (PDF) auto-generate hota hai (trial/paid dono me). Example: “sold milk 2 ltr” ke baad PDF ban jayega.'
          : 'Yes — after a sale, an invoice (PDF) is generated automatically (trial & paid). Example: “sold milk 2 ltr”.';
      const msg = await tx(ansBase, lang, From, text, `${requestId}::sales-qa-fallback-final`);
      console.log('[sales-qa] FINAL FALLBACK sending via API', { requestId, to: From, len: msg.length });
      await sendMessageViaAPI(From, msg);
      handledRequests.add(requestId);
      console.log('[sales-qa] FINAL FALLBACK sent OK', { requestId });
      return true;
    } catch (e) {
      console.warn('[sales-qa] FINAL FALLBACK failed:', e?.message);
    }
  }
  console.log('[router] exit no-send', { requestId, isQuestion });

  // ---- Localized one-word switch handler (open options or set directly) ----
  {
    const switchCmd = parseModeSwitchLocalized(text);
    if (switchCmd) {
      if (switchCmd.ask) {                                                                       
        // Always show mode menus via welcome flow, regardless of session gating
              await sendWelcomeFlowLocalized(From, detectedLanguage ?? 'en', requestId);
              return true;
      }
      if (switchCmd.set) {
        await setStickyMode(From, switchCmd.set);
        await sendMessageQueued(
          From,
          await t(`✅ Mode set: ${switchCmd.set}`, detectedLanguage, `${requestId}::mode-set`),
          detectedLanguage
        );
        return true;
      }
    }
  }
    
  // =======================
  // Customer Return command
  // =======================
  // Pattern A: "return <product> <qty> <unit>"
  // Pattern B: "return <qty> <unit> <product>"
  let r1 = text.match(/^(?:customer\s+)?returns?\s+(.+?)\s+(\d+(?:\.\d+)?)\s+([A-Za-z\u0900-\u097F\u0A80-\u0AFF\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF]+)$/i);
  let r2 = text.match(/^(?:customer\s+)?returns?\s+(\d+(?:\.\d+)?)\s+([A-Za-z\u0900-\u097F\u0A80-\u0AFF\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF]+)\s+(.+)$/i);
  if (r1 || r2) {
    const shopId = From.replace('whatsapp:', '');
    const qty  = Number(r1 ? r1[2] : r2[1]);
    const unit = (r1 ? r1[3] : r2[2]).trim();
    const raw  = (r1 ? r1[1] : r2[3]).trim();
    const product = await translateProductName(raw, requestId + ':return');
    const result = await updateInventory(shopId, product, Math.abs(qty), unit); // add back
    let message = `↩️ Return processed — ${product}: +${qty} ${unit}`;
    if (result?.success) {
      const u = result.unit ?? unit;
      message += ` (Stock: ${result.newQuantity} ${u})`;
    }
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  // ==================================
  // Alias: "expired"/"expired items"
  // ==================================
  if (/^(expired(?:\s+items?)?|show\s+expired\s+stock)$/i.test(text)) {
    const shopId = From.replace('whatsapp:', '');
    const exp = await getExpiringProducts(shopId, 0, { strictExpired: true });
    let message = COMPACT_MODE ? `❌ Expired:` : `❌ Already expired:\n`;
    message += exp.length
      ? exp.map(p => `• ${p.name}: ${formatDateForDisplay(p.expiryDate)} (qty ${p.quantity})`).join('\n')
      : (COMPACT_MODE ? `None` : `No expired items.`);
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }
    
  // NEW (2.f): expiry <product> <date>
  // Accepted date formats: 20-09 | 20/09/2025 | +7d | +3m | +1y
  let m1 = text.match(/^expiry\s+(.+?)\s+([0-9+\/\-]{3,})$/i);
  if (m1) {
    const product = await translateProductName(m1[1], requestId + ':expiry-cmd');
    const iso = parseExpiryTextToISO(m1[2]);
    if (!iso) {
      const msg = await t(
        `Invalid date. Try: 20-09 | 20/09/2025 | +7d | +3m | +1y`,
        detectedLanguage, 'bad-expiry'
      );
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }
    const batches = await getBatchRecords(shopId, product);
    const latest = (batches || [])
      .filter(b => !!b?.fields?.PurchaseDate)
      .sort((a,b)=> new Date(b.fields.PurchaseDate) - new Date(a.fields.PurchaseDate))[0];
    if (!latest) {
      const msg = await t(`No batch found for ${product}.`, detectedLanguage, 'no-batch');
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }
    await updateBatchExpiry(latest.id, iso);
    const ok = await t(`✅ ${product} expiry set to ${formatDateForDisplay(iso)}`, detectedLanguage, 'expiry-set');
    await sendMessageQueued(From, ok);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }
  
  // Short Summary (on-demand) -- primary: "short summary", keep "summary" as alias
    if (/^\s*((short|quick|mini)\s*(summary|report|overview)|summary)\s*$/i.test(text)) {
      const shopId = From.replace('whatsapp:', '');

       // Check if AI summaries are available for this plan
      const canUseAI = await isFeatureAvailable(shopId, 'ai_summary');
      if (!canUseAI) {
        const planInfo = await getUserPlan(shopId);
        let errorMessage = 'Advanced AI summaries are only available on the Enterprise plan.';
        
        if (planInfo.plan === 'free_demo_first_50') {
          errorMessage = 'Your trial period has expired. Please upgrade to the Enterprise plan for advanced AI summaries.';
        }
        
        await sendMessageQueued(From, errorMessage);
        await scheduleUpsell(gate?.upsellReason);
        return true;
      }
            
      const msg = await generateInstantSummary(shopId, detectedLanguage, requestId);
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }
  
    // Full Summary (on-demand) -- swapped to non-AI Daily Summary
    if (/^\s*((full|detailed|complete|entire)\s*(summary|report|overview))\s*$/i.test(text)) {
      const shopId = From.replace('whatsapp:', '');

     // Check if AI summaries are available for this plan
      const canUseAI = await isFeatureAvailable(shopId, 'ai_summary');
      if (!canUseAI) {
        const planInfo = await getUserPlan(shopId);
        let errorMessage = 'Detailed AI summaries are only available on the Enterprise plan.';
        
        if (planInfo.plan === 'free_demo_first_50') {
          errorMessage = 'Your trial period has expired. Please upgrade to the Enterprise plan for detailed summaries.';
        }
        
        await sendMessageQueued(From, errorMessage);
        await scheduleUpsell(gate?.upsellReason);
        return true;
      }
      
      // Uses dailySummary.js non-AI builder + sender; it sends WhatsApp itself
      await processShopSummary(shopId); // sends localized message internally
      return true;
    }

    // 0) Inventory value (BEFORE any "stock <product>" matching)
        // Accepts: "inventory value", "stock value", "value summary",
        //          "total/overall/grand/gross inventory|stock value|valuation"
        
    if (/^\s*(?:(?:(?:total|overall|grand(?:\s*total)?|gross)\s+)?(?:inventory|stock)\s*(?:value|valuation)|value\s*summary)\s*$/i.test(text)) {               
        await handleQuickQueryEN('value summary', From, detectedLanguage, `${requestId}::alias-inv-value`);
          try { await maybeResendListPicker(From, detectedLanguage, requestId); } catch (_) {}
       handledRequests.add(requestId);
       return true;
     }
      
    // 0.5) List products (page/search) → canonical delegate
    {
      const pm = text.match(/^\s*(?:products|list\s+products)(?:\s+(?:page\s+)?(\d+))?\s*$/i);
      const sm = text.match(/^\s*(?:products\s+search|search\s+products)\s+(.+)\s*$/i);
      if (pm) {
        const page = pm[1] ? parseInt(pm[1], 10) : 1;
        const cmdCanon = page > 1 ? `products page ${page}` : `products`;              
        await handleQuickQueryEN(cmdCanon, From, detectedLanguage, `${requestId}::alias-products`);
        try { await maybeResendListPicker(From, detectedLanguage, requestId); } catch (_) {}
        handledRequests.add(requestId);
        return true;
      }
      if (sm) {
        const term = sm[1].trim();                
        await handleQuickQueryEN(`products search ${term}`, From, detectedLanguage, `${requestId}::alias-products-search`);
        try { await maybeResendListPicker(From, detectedLanguage, requestId); } catch (_) {}
        handledRequests.add(requestId);
        return true;
      }
    }

    // Prices needing update (paged): "prices", "prices 2", "price updates", "stale prices"
    {
      const pricePage = text.match(/^\s*(?:prices|price\s*updates|stale\s*prices)(?:\s+(?:page\s+)?(\d+))?\s*$/i);
      if (pricePage) {
        const page = pricePage[1] ? parseInt(pricePage[1], 10) : 1;
        const cmdCanon = page > 1 ? `prices page ${page}` : `prices`;               
        await handleQuickQueryEN(cmdCanon, From, detectedLanguage, `${requestId}::alias-prices`);
          try { await maybeResendListPicker(From, detectedLanguage, requestId); } catch (_) {}
        handledRequests.add(requestId);
        return true;
      }
    }
  
    // 1) Stock for product
    // Guard: don't let "inventory value/valuation/value summary" slip into stock branch  
    {
      const m = text.match(/^(?:stock|inventory|qty)\s+(.+)$/i);
      if (m) {
        const raw = m[1].trim();                
        await handleQuickQueryEN(`stock ${raw}`, From, detectedLanguage, `${requestId}::alias-stock`);
          try { await maybeResendListPicker(From, detectedLanguage, requestId); } catch (_) {}
        handledRequests.add(requestId);
        return true;
      }
    }

    // 2) Low stock / Stockout    
    if (/^(?:low\s*stock|stockout|out\s*of\s*stock)$/i.test(text)) {               
       await handleQuickQueryEN('low stock', From, detectedLanguage, `${requestId}::alias-low`);
       try { await maybeResendListPicker(From, detectedLanguage, requestId); } catch (_) {}
       handledRequests.add(requestId);
       return true;
     }
  
    // 3) Batches for product (purchase & expiry)      
    {
      const m = text.match(/^(?:batches?|expiry)\s+(.+)$/i);
      if (m) {
        const raw = m[1].trim();               
        await handleQuickQueryEN(`batches ${raw}`, From, detectedLanguage, `${requestId}::alias-batches`);
        try { await maybeResendListPicker(From, detectedLanguage, requestId); } catch (_) {}
        handledRequests.add(requestId);
        return true;
      }
    }

      // 4) Expiring soon
      // Allow "expiring 0" for already-expired items         
        m = text.match(/^expiring(?:\s+(\d+))?$/i);
         if (m) {
           const days = m[1] !== undefined ? Math.max(0, parseInt(m[1], 10)) : 30;
           const exactCmd = days === 0 ? 'expiring 0' : (days <= 7 ? 'expiring 7' : 'expiring 30');               
          await handleQuickQueryEN(exactCmd, From, detectedLanguage, `${requestId}::alias-expiring`);
            try { await maybeResendListPicker(From, detectedLanguage, requestID); } catch (_) {}
           handledRequests.add(requestId);
           return true;
         }

  // 5) Sales (today|week|month)
  m = text.match(/^sales\s+(today|this\s*week|week|this\s*month|month)$/i);
  if (m) {
    const { start, end, label } = _periodWindow(m[1]);
    const data = await getSalesDataForPeriod(shopId, start, end);
    let message = `💰 Sales (${label}): ${data.totalItems ?? 0} items`;
    if ((data.totalValue ?? 0) > 0) message += ` (₹${(data.totalValue).toFixed(2)})`;
    if ((data.topProducts ?? []).length > 0) {
      message += `\n\n🏷️ Top Sellers:\n` + data.topProducts.slice(0,5).map(p=>`• ${p.name}: ${p.quantity} ${p.unit}`).join('\n');
    }
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  // 6) Top N products
  m = text.match(/^top\s*(\d+)?\s*products?(?:\s*(today|week|month|this\s*week|this\s*month))?$/i);
  if (m) {
    const n = m[1] ? Math.max(1, parseInt(m[1],10)) : 5;
    const { start, end, label } = _periodWindow(m[2] || 'month');
    const data = await getSalesDataForPeriod(shopId, start, end);
    const top = (data.topProducts || []).slice(0, n);
    let message = `🏆 Top ${n} (${label}):\n`;
    message += top.length ? top.map((p,i)=>`${i+1}. ${p.name}: ${p.quantity} ${p.unit}`).join('\n') : 'No sales data.';
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

    // 7) Reorder suggestions (simple velocity heuristic)     
    if (/^(?:reorder(?:\s+suggestions)?|what\s+should\s+i\s+reorder)$/i.test(text)) {             
      await handleQuickQueryEN('reorder suggestions', From, detectedLanguage, `${requestId}::alias-reorder`);
        try { await maybeResendListPicker(From, detectedLanguage, requestId); } catch (_) {}
       handledRequests.add(requestId);
       return true;
     }
} finally {
  // No local stop; centralized wrapper handles stopping.
}
  return false; // not a quick query
}
}

// -------- NEW: Quick-query command handlers (8 core queries) --------
function parsePeriodKeyword(txt) {
  const t = (txt || '').toLowerCase().trim();
  if (t.includes('today') || t === 'day') return 'day';
  if (t.includes('week')) return 'week';
  return 'month'; // default
}

async function handleQueryCommand(Body, From, detectedLanguage, requestId) {
  const startTime = Date.now();
  const text = Body.trim();          
  // FAST PATH: pure greeting → welcome and exit early (prevents ack/parse-error later)
    if (_isGreeting(text)) {
      await sendWelcomeFlowLocalized(From, detectedLanguage ?? 'en', requestId);
      handledRequests.add(requestId);
      return true;
    }
  // NEW: record activity (touch LastUsed) for every inbound
  try { await touchUserLastUsed(String(From).replace('whatsapp:', '')); } catch {}    
  // NEW: gate for paywall/onboarding
  const gate = await ensureAccessOrOnboard(From, Body, detectedLanguage);        
  // Ack only if this request was not already handled (e.g., by the greeting short-circuit)
    if (!handledRequests.has(requestId)) {
      try {
        await sendMessageQueued(
          From,
          await t('Processing your message…', detectedLanguage, `${requestId}::ack`)
        );
      } catch {}
    }

  if (!gate.allow) return true; // already responded
  
  if (isResetMessage(text)) {
      await clearUserState(From);
      await sendMessageQueued(
        From,
        await t('✅ Reset. Mode cleared.', detectedLanguage, `${requestId}::reset`),
        detectedLanguage
      );
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }
  
  const shopId = From.replace('whatsapp:', '');
try{  
// NEW: Intercept post‑purchase expiry override first
    if (await handleAwaitingPurchaseExpiryOverride(From, text, detectedLanguage, requestId)) return true;
    // Intercept post‑sale batch override next
    if (await handleAwaitingBatchOverride(From, text, detectedLanguage, requestId)) return true;

// NEW (2.g): Greeting -> show purchase examples incl. expiry
    
  if (/^\s*(hello|hi|hey|namaste|vanakkam|namaskar|hola|hallo)\s*$/i.test(text)) {
    await sendWelcomeFlowLocalized(From, detectedLanguage || 'en', requestId);        
    // Mark this request as handled to avoid duplicate onboarding & parse-error afterwards
    handledRequests.add(requestId);
    try { await scheduleUpsell(gate?.upsellReason); } catch (_) {}
    return true;
   }
  

  // ---- Localized one-word switch handler (open options or set directly) ----
  {
    const switchCmd = parseModeSwitchLocalized(text);
    if (switchCmd) {
      if (switchCmd.ask) {              
        await sendWelcomeFlowLocalized(From, detectedLanguage ?? 'en', requestId);
              return true;
      }
      if (switchCmd.set) {
        await setStickyMode(From, switchCmd.set);
        await sendMessageQueued(
          From,
          await t(`✅ Mode set: ${switchCmd.set}`, detectedLanguage, `${requestId}::mode-set`),
          detectedLanguage
        );
        return true;
      }
    }
  }
    
  // =======================
  // Customer Return command
  // =======================
  // Pattern A: "return <product> <qty> <unit>"
  // Pattern B: "return <qty> <unit> <product>"
  let r1 = text.match(/^(?:customer\s+)?returns?\s+(.+?)\s+(\d+(?:\.\d+)?)\s+([A-Za-z\u0900-\u097F\u0A80-\u0AFF\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF]+)$/i);
  let r2 = text.match(/^(?:customer\s+)?returns?\s+(\d+(?:\.\d+)?)\s+([A-Za-z\u0900-\u097F\u0A80-\u0AFF\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF]+)\s+(.+)$/i);
  if (r1 || r2) {
    const shopId = From.replace('whatsapp:', '');
    const qty  = Number(r1 ? r1[2] : r2[1]);
    const unit = (r1 ? r1[3] : r2[2]).trim();
    const raw  = (r1 ? r1[1] : r2[3]).trim();
    const product = await translateProductName(raw, requestId + ':return');
    const result = await updateInventory(shopId, product, Math.abs(qty), unit); // add back
    let message = `↩️ Return processed — ${product}: +${qty} ${unit}`;
    if (result?.success) {
      const u = result.unit ?? unit;
      message += ` (Stock: ${result.newQuantity} ${u})`;
    }
    const msg = await t(message, detectedLanguage, requestId);       
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  // ==================================
  // Alias: "expired"/"expired items"
  // ==================================
  if (/^expired(?:\s+items?)?$/i.test(text)) {
    const shopId = From.replace('whatsapp:', '');
    const exp = await getExpiringProducts(shopId, 0, { strictExpired: true });
    let message = `❌ Already expired:\n`;
    message += exp.length
      ? exp.map(p => `• ${p.name}: ${formatDateForDisplay(p.expiryDate)} (qty ${p.quantity})`).join('\n')
      : `No expired items.`;
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  
  // NEW (2.f): expiry <product> <date>
  // Accepted date formats: 20-09 | 20/09/2025 | +7d | +3m | +1y
  let m = text.match(/^expiry\s+(.+?)\s+([0-9+\/\-]{3,})$/i);
  if (m) {
    const product = await translateProductName(m[1], requestId + ':expiry-cmd');
    const iso = parseExpiryTextToISO(m[2]);
    if (!iso) {
      const msg = await t(
        `Invalid date. Try: 20-09 | 20/09/2025 | +7d | +3m | +1y`,
        detectedLanguage, 'bad-expiry'
      );
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }
    const batches = await getBatchRecords(shopId, product);
    const latest = (batches || [])
      .filter(b => !!b?.fields?.PurchaseDate)
      .sort((a,b)=> new Date(b.fields.PurchaseDate) - new Date(a.fields.PurchaseDate))[0];
    if (!latest) {
      const msg = await t(`No batch found for ${product}.`, detectedLanguage, 'no-batch');
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }
    await updateBatchExpiry(latest.id, iso);
    const ok = await t(`✅ ${product} expiry set to ${formatDateForDisplay(iso)}`, detectedLanguage, 'expiry-set');
    await sendMessageQueued(From, ok);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  
  // 1) Inventory remaining for a specific product (+ advice)
  const stockMatch = text.match(/^(?:stock|inventory|qty)\s+(.+)$/i);
  if (stockMatch) {
    const raw = stockMatch[1].trim();
    const product = await translateProductName(raw, requestId + ':stock');
    const inv = await getProductInventory(shopId, product);
    if (!inv.success) {
      const msg = await t(`Error fetching stock for ${product}: ${inv.error}`, detectedLanguage, requestId);
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }
    // Compute simple advice from last 14 days velocity
    const now = new Date();
    const start = new Date(now); start.setDate(now.getDate() - 14);
    const sales = await getSalesDataForPeriod(shopId, start, now);
    const sold = (sales.records || []).filter(r => r.fields.Product === product)
      .reduce((s, r) => s + Math.abs(r.fields.Quantity ?? 0), 0);
    const dailyRate = sold / 14;
    const lead = 3, safety = 2;
    const coverNeeded = (lead + safety) * dailyRate;
    const advise = (dailyRate > 0 && inv.quantity <= coverNeeded)
      ? `Reorder ~${Math.max(0, Math.ceil(coverNeeded - inv.quantity))} ${singularize(inv.unit)} in next ${lead} days.`
      : (dailyRate === 0 ? `No recent sales for ${product}. Hold purchase.` : `Sufficient stock for ~${Math.floor(inv.quantity / (dailyRate || 1))} days.`);
    let message = `📦 Stock — ${product}: ${inv.quantity} ${inv.unit}\n`;
    if (dailyRate > 0) message += `Avg sale: ${dailyRate.toFixed(2)} /day\n`;
    message += `💡 ${advise}`;
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  // Prices needing update (paged)
  const pricesMatch = Body.trim().match(/^\s*(?:prices|price\s*updates|stale\s*prices)(?:\s+(?:page\s+)?(\d+))?\s*$/i);
  if (pricesMatch) {
    const page = pricesMatch[1] ? parseInt(pricesMatch[1], 10) : 1;      
    const out = await sendPriceUpdatesPaged(From, detectedLanguage, requestId, page);
     if (out) {
       await sendMessageQueued(From, out);
       await scheduleUpsell(gate?.upsellReason);
     }
     return true;
  }

  
  // 2) Low stock or stock-out items (+ advice)
  if (/^(?:low\s*stock|stockout|out\s*of\s*stock)\b/i.test(text)) {        
    let low = await getLowStockProducts(shopId, 5);
    low = sanitizeProductRows(low);
    const out = await getStockoutItems(shopId);
    let message = `⚠️ Low & Stockout:\n`;
    if (low.length === 0 && out.length === 0) {
      message += `Everything looks good.`;
    } else {
      if (low.length > 0) {
        message += `\nLow stock (≤5):\n` + low.map(p => `• ${p.name}: ${p.quantity} ${p.unit}`).join('\n');
      }
      if (out.length > 0) {
        message += `\n\nOut of stock:\n` + out.map(p => `• ${p.name}`).join('\n');
      }
      message += `\n\n💡 Advice: Prioritize ordering low-stock items first; consider substitutable SKUs to avoid lost sales.`;
    }
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  // 3) Batches remaining with purchase & expiry dates (+ advice)
  const batchMatch = text.match(/^(?:batches?|expiry)\s+(.+)$/i);
  if (batchMatch) {
    const raw = batchMatch[1].trim();
    const product = await translateProductName(raw, requestId + ':batches');
    const batches = await getBatchesForProductWithRemaining(shopId, product);
    if (batches.length === 0) {
      const msg = await t(`No active batches found for ${product}.`, detectedLanguage, requestId);
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }
    let message = `📦 Batches — ${product}:\n`;
    for (const b of batches) {
      const pd = formatDateForDisplay(b.purchaseDate);
      const ed = b.expiryDate ? formatDateForDisplay(b.expiryDate) : '—';
      message += `• ${b.quantity} ${b.unit} | Bought: ${pd} | Expiry: ${ed}\n`;
    }
    const soon = batches.filter(b => b.expiryDate && daysBetween(new Date(b.expiryDate), new Date()) <= 7);
   if (soon.length > 0) {
      message += `\n💡 Advice: ${soon.length} batch(es) expiring within 7 days — use FIFO & run a small discount to clear.`;
    }
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  // 4) Expiring soon items (default 30 days, or "expiring 15")  
  const expMatch = text.match(/^expiring(?:\s+(\d+))?$/i);
    if (expMatch) {
      const days = (expMatch[1] !== undefined) ? Math.max(0, parseInt(expMatch[1], 10)) : 30; // allow 0
      const expiring = await getExpiringProducts(shopId, days, { strictExpired: false });
      const header = days === 0
        ? `❌ Already expired:`
        : `⏰ Expiring in next ${days} day(s):`;
      let message = `${header}\n`;
      if (expiring.length === 0) {
        message += days === 0 ? `No expired items.` : `No items found.`;
      } else {
        message += expiring.map(p => `• ${p.name}: ${formatDateForDisplay(p.expiryDate)} (qty ${p.quantity})`).join('\n');
        message += days === 0
          ? `\n\n💡 Move expired stock off-shelf and consider supplier returns.`
          : `\n\n💡 Mark-down nearing expiry items (5–15%), move to eye-level shelves, and bundle if possible.`;
      }
      const msg = await t(message, detectedLanguage, requestId);
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }


  // 5) Sales summary for a day/week/month ("sales today|week|month")
  const salesMatch = text.match(/^sales\s+(today|this\s*week|week|this\s*month|month)$/i);
  if (salesMatch) {
    const period = parsePeriodKeyword(salesMatch[1]);
    const data = await getSalesSummaryPeriod(shopId, period);
    let message = `💰 Sales (${period}): ${data.totalItems ?? 0} items`;
    if ((data.totalValue ?? 0) > 0) message += ` (₹${(data.totalValue).toFixed(2)})`;
    if ((data.topProducts ?? []).length > 0) {
      message += `\n\n🏷️ Top Sellers:\n` + data.topProducts.slice(0, 5)
        .map(p => `• ${p.name}: ${p.quantity} ${p.unit}`).join('\n');
    }
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  // 6) Top N products (defaults: top 5 this month)
  const topMatch = text.match(/^top\s*(\d+)?\s*products?(?:\s*(today|week|month|this\s*week|this\s*month))?$/i);
  if (topMatch) {
    const limit = topMatch[1] ? Math.max(1, parseInt(topMatch[1], 10)) : 5;
    const period = parsePeriodKeyword(topMatch[2] || 'month');
    const data = await getTopSellingProductsForPeriod(shopId, period, limit);
    let message = `🏆 Top ${limit} (${period}):\n`;
    if ((data.top ?? []).length === 0) message += `No sales data.`;
    else {
      message += data.top.map((p, i) => `${i + 1}. ${p.name}: ${p.quantity} ${p.unit}`).join('\n');
    }
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  // 7) Reorder suggestions (velocity + lead/safety)
  if (/^what\s+should\s+i\s+reorder$|^reorder(\s+suggestions?)?$/i.test(text)) {      
  const { success, suggestions, days, leadTimeDays, safetyDays, error } =
    await getReorderSuggestions(shopId, { days: 30, leadTimeDays: 3, safetyDays: 2 /*, minDailyRate: 0.2 */ });
  
  if (!success) {
    const msg = await t(`Error creating suggestions: ${error}`, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }
  
  let message = `📋 Reorder Suggestions (based on ${days}d sales, lead ${leadTimeDays}d, safety ${safetyDays}d):\n`;
  if (suggestions.length === 0) {
    message += `No urgent reorders detected.`;
  } else {
    message += suggestions.slice(0, 10).map(s =>
      `• ${s.name}: stock ${s.currentQty} ${s.unit}, ~${s.dailyRate}/day → reorder ~${s.reorderQty} ${singularize(s.unit)}`
    ).join('\n');
    message += `\n\n💡 Advice: Confirm supplier lead-times. Increase safety days for volatile items.`;
  }
  const msg = await t(message, detectedLanguage, requestId);
  await sendMessageQueued(From, msg);
  await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  // 8) Inventory value summary    
  if (/^(?:inventory\s*value|stock\s*value|value\s*summary)$/i.test(text)) {
     const inv = await getInventorySummary(shopId);
     // NEW: inclusive low-stock count (≤ threshold, includes 0/negatives)
     const lowItems = await getLowStockProducts(shopId, 5);
     const lowCount = Array.isArray(lowItems) ? lowItems.length : 0;
     let message = COMPACT_MODE
     ? `📦 Inventory Summary:\n• Unique products: ${inv.totalProducts}\n• Total value: ₹${(inv.totalValue ?? 0).toFixed(2)}\n• 🟠 Low Stock Alerts: ${lowCount}`
     : `📦 Inventory: ${inv.totalProducts} items • ₹${(inv.totalValue ?? 0).toFixed(2)} • 🟠 Low Stock Alerts: ${lowCount}`;       
    
    if ((inv.totalPurchaseValue ?? 0) > 0) {
      message += `\n• Total cost: ₹${inv.totalPurchaseValue.toFixed(2)}`;
    }
    if ((inv.topCategories ?? []).length > 0) {
      message += `\n\n📁 By Category:\n` + inv.topCategories.map((c, i) =>
        `${i + 1}. ${c.name}: ₹${c.value.toFixed(2)} (${c.productCount} items)`).join('\n');
    }
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }
} finally {
  // No local stop; centralized wrapper handles stopping.
}
  return false; // not a command
}


// Performance tracking function
function trackResponseTime(startTime, requestId) {
  const duration = Date.now() - startTime;    
  if (typeof responseTimes !== 'undefined') {
     responseTimes.total += duration;
     responseTimes.count++;
     responseTimes.max = Math.max(responseTimes.max, duration);
   }
  console.log(`[${requestId}] Response time: ${duration}ms`);
  // Log slow responses (increased threshold)
  if (duration > 15000) {
    console.warn(`[${requestId}] Slow response detected: ${duration}ms`);
  }
}

// Optional defensive guard to avoid "total is not defined" surfacing in gate paths
function safeTrackResponseTime(startTime, requestId) {
  try { trackResponseTime(startTime, requestId); } catch (_) { /* ignore */ }
}
  
// Cache cleanup function
function cleanupCaches() {
  const now = Date.now();
  // Clean language cache
  for (const [key, value] of languageCache.entries()) {
    if (now - value.timestamp > LANGUAGE_CACHE_TTL) {
      languageCache.delete(key);
    }
  }
  // Clean product cache
  for (const [key, value] of productMatchCache.entries()) {
    if (now - value.timestamp > PRODUCT_CACHE_TTL) {
      productMatchCache.delete(key);
    }
  }
  // Clean inventory cache
  for (const [key, value] of inventoryCache.entries()) {
    if (now - value.timestamp > INVENTORY_CACHE_TTL) {
      inventoryCache.delete(key);
    }
  }
  // Clean product translation cache
  for (const [key, value] of productTranslationCache.entries()) {
    if (now - value.timestamp > PRODUCT_TRANSLATION_CACHE_TTL) {
      productTranslationCache.delete(key);
    }
  }
  // Clean global state every 5 minutes
  if (now - globalState.lastCleanup > 5 * 60 * 1000) {
    const FIVE_MINUTES = 5 * 60 * 1000;
    if (globalState.conversationState) {
      for (const [from, state] of Object.entries(globalState.conversationState)) {
        if (now - (state.timestamp || 0) > FIVE_MINUTES) {
          delete globalState.conversationState[from];
        }
      }
    }
    
    if (globalState.pendingProductUpdates) {
      for (const [from, pending] of Object.entries(globalState.pendingProductUpdates)) {
        if (now - (pending.timestamp || 0) > FIVE_MINUTES) {
          delete globalState.pendingProductUpdates[from];
        }
      }
    }
    globalState.lastCleanup = now;
  }
}

// Create interactive button message using Twilio's proper format
function createButtonMessage(message, buttons) {
  const twiml = new twilio.twiml.MessagingResponse();
  const messageObj = twiml.message();
  messageObj.body(message);
  // Add interactive buttons using Twilio's format
  const buttonsObj = messageObj.buttons();
  buttons.forEach(button => {
    buttonsObj.button({
      action: {
        type: 'reply',
        reply: {
          id: button.id,
          title: button.title
        }
      }
    });
  });
  return twiml.toString();
}

// Improved product name translation with direct mappings
// Accept an options flag so write-path can bypass translation entirely.
async function translateProductName(productName, requestId, options = {}) {
  try {   
    // First, extract just the product name
        const cleanProduct = extractProductName(productName);
        const forWrite = !!options.forWrite;
        if (forWrite) {
          // WRITE PATH → never translate/normalize; trust AI/voice exactly.
          console.log(`[${requestId}] Write-path product: "${cleanProduct}" (no translation)`);
          return cleanProduct;
        }
    
        // UI PATH cache: use cleaned product as the cache key
        const cacheKey = cleanProduct.toLowerCase();
        const cached = productTranslationCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < PRODUCT_TRANSLATION_CACHE_TTL)) {
          console.log(`[${requestId}] Using cached product translation: "${cleanProduct}" → "${cached.translation}"`);
          return cached.translation;
        }
    
    // Check if it's already a known product in English
    if (products.some(p => p.toLowerCase() === cleanProduct.toLowerCase())) {
      return cleanProduct;
    }
    
// Direct mappings (Hinglish/Indian scripts → English groceries/brands)
    // Extend first so we short-circuit AI for staples.
    const hindiToEnglish = {
      // Staples (potato/onion/tomato)
      'आलू': 'potato', 'aloo': 'potato', 'aaloo': 'potato', 'aluu': 'potato', 'aalu': 'potato',
      'प्याज़': 'onion', 'pyaz': 'onion', 'pyaaz': 'onion',
      'टमाटर': 'tomato', 'tamatar': 'tomato',
      // Common groceries
      'चीनी': 'sugar', 'cheeni': 'sugar',
      'दूध': 'milk', 'doodh': 'milk',
      'आटा': 'flour', 'aata': 'flour',
      'नमक': 'salt', 'namak': 'salt',
      'गेहूं': 'wheat', 'gehun': 'wheat',
      'तेल': 'oil', 'tel': 'oil',
      'मक्खन': 'butter', 'makkhan': 'butter',
      'दही': 'curd', 'dahi': 'curd',
      'पनीर': 'cheese', 'paneer': 'cheese',
      // Popular brands/ready drinks
      'फ्रूटी': 'Frooti', 'frooti': 'Frooti'
    };
    
    const lowerProductName = cleanProduct.toLowerCase();
    if (hindiToEnglish[lowerProductName]) {
      const translated = hindiToEnglish[lowerProductName];
      console.log(`[${requestId}] Translated product (mapping): "${cleanProduct}" → "${translated}"`);
      // Cache the result
      productTranslationCache.set(cacheKey, {
        translation: translated,
        timestamp: Date.now()
      });
      return translated;
    }
    
    
    const fuzzyMap = {
      'fruity': 'Frooti',
      'fruti': 'Frooti',
      'parleg': 'Parle-G',
      'oreo': 'Oreo'
    };
    
    const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/gi, '');
    const normalizedName = normalize(cleanProduct);
    
    if (fuzzyMap[normalizedName]) {
      return fuzzyMap[normalizedName];
    }
    
    // Try to translate using AI
    try {
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content: `Translate the following product name to English. If it's already in English, return it as is. Only return the translated product name, nothing else.`
            },
            {
              role: "user",
              content: cleanProduct
            }
          ],
          max_tokens: 50,
          temperature: 0.1
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
      
      const translated = response.data.choices[0].message.content.trim();
      console.log(`[${requestId}] Translated product (AI): "${cleanProduct}" → "${translated}"`);
      
      // Check if the translated product is in our known products list
      if (products.some(p => p.toLowerCase() === translated.toLowerCase())) {
        // Cache the result
        productTranslationCache.set(cacheKey, {
          translation: translated,
          timestamp: Date.now()
        });
        return translated;
      }
      
      // If not found, return the cleaned product name
      return cleanProduct;
    } catch (error) {
      console.warn(`[${requestId}] AI product translation failed:`, error.message);
      return cleanProduct;
    }
  } catch (error) {
    console.warn(`[${requestId}] Product translation failed:`, error.message);
    return productName;
  }
}

// Unified resolver for write-path vs UI-path names
async function getProductNamesForPaths(product, requestId) {
  // Always use raw AI product for DB writes
  const writeName = String(product ?? '').trim();
  // UI may show a translated display name (safe; bypass on failure)
  let displayName = writeName;
  try {
    displayName = await translateProductName(writeName, requestId, { forWrite: false });
  } catch (_) { /* keep writeName for UI if translation fails */ }
  return { writeName, displayName };
}

// Function to parse inventory updates using AI
async function parseInventoryUpdateWithAI(transcript, requestId) {
  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are an inventory parsing assistant. Extract inventory information from the user's message and return it in JSON format. If no action is specified, default to the user's current intent if known (e.g., sale, purchase, return).
          Extract the following fields:
          1. product: The name of the product (e.g., "Parle-G", "sugar", "milk") - ONLY the product name, no quantities or units
          2. quantity: The numerical quantity (as a number)
          3. unit: The unit of measurement (e.g., "packets", "kg", "liters", "pieces")
          4. action: The action being performed ("purchased", "sold", "remaining", "returned")
          5. price: The price per unit (if mentioned, otherwise null)
          6. totalPrice: The total price (if mentioned, otherwise null)        
          7. expiryDate (if present), parse tokens like: "exp", "expiry", "expires on", formats dd-mm, dd/mm/yyyy, +7d, +3m, +1y
          For the action field:
          - Use "purchased" for words like "bought", "purchased", "buy", "खरीदा", "खरीदे", "लिया", "खरीदी", "khareeda"
          - Use "sold" for words like "sold", "बेचा", "बेचे", "becha", "बिक्री", "becha"
          - Use "remaining" for words like "remaining", "left", "बचा", "बचे", "बाकी", "bacha"
          - Use "returned" for customer returns: words like "return", "returned", "customer return", "रिटर्न", "वापस", "परत", "રીટર્ન"
          If no action is specified, default to "purchased" for positive quantities and "sold" for negative quantities.
          If no unit is specified, infer the most appropriate unit based on the product type:
          - For biscuits, chips, etc.: "packets"
          - For milk, water, oil: "liters"
          - For flour, sugar, salt: "kg"
          - For individual items: "pieces"                    
          ALWAYS return a JSON ARRAY of objects (e.g., [{"product":"milk", ...}]), even if there is only one item.                  
          Omit fields that are null/unknown.
          If "price" is present, you may omit "totalPrice".
          Return only valid JSON (no extra text, no markdown, no code fences).`
                    },
                    {
                      role: "user",
                      content: transcript
                    }
                  ],
                  max_tokens: 500,
                  temperature: 0.1
                },
                {
                  headers: {
                    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                  },
                  timeout: 10000
                }
              );
              
              let content = response.data.choices[0].message.content.trim();                 
              const finishReason = response.data.choices?.[0]?.finish_reason;
                if (!content || finishReason === 'length') {
                  // Retry once with a larger cap (defensive)
                  const r2 = await axios.post(
                    'https://api.deepseek.com/v1/chat/completions',
                    {
                      model: "deepseek-chat",
                      messages: [
                        { role: "system", content: `You are an inventory parsing assistant. Extract inventory information from the user's message and return it in JSON format. If no action is specified, default to the user's current intent if known (e.g., sale, purchase, return).
          Extract the following fields:
          1. product: The name of the product (e.g., "Parle-G", "sugar", "milk") - ONLY the product name, no quantities or units
          2. quantity: The numerical quantity (as a number)
          3. unit: The unit of measurement (e.g., "packets", "kg", "liters", "pieces")
          4. action: The action being performed ("purchased", "sold", "remaining", "returned")
          5. price: The price per unit (if mentioned, otherwise null)
          6. totalPrice: The total price (if mentioned, otherwise null)        
          7. expiryDate (if present), parse tokens like: "exp", "expiry", "expires on", formats dd-mm, dd/mm/yyyy, +7d, +3m, +1y
          For the action field:
          - Use "purchased" for words like "bought", "purchased", "buy", "खरीदा", "खरीदे", "लिया", "खरीदी", "khareeda"
          - Use "sold" for words like "sold", "बेचा", "बेचे", "becha", "बिक्री", "becha"
          - Use "remaining" for words like "remaining", "left", "बचा", "बचे", "बाकी", "bacha"
          - Use "returned" for customer returns: words like "return", "returned", "customer return", "रिटर्न", "वापस", "परत", "રીટર્ન"
          If no action is specified, default to "purchased" for positive quantities and "sold" for negative quantities.
          If no unit is specified, infer the most appropriate unit based on the product type:
          - For biscuits, chips, etc.: "packets"
          - For milk, water, oil: "liters"
          - For flour, sugar, salt: "kg"
          - For individual items: "pieces"                    
          ALWAYS return a JSON ARRAY of objects (e.g., [{"product":"milk", ...}]), even if there is only one item.                  
          Omit fields that are null/unknown.
          If "price" is present, you may omit "totalPrice".
          Return only valid JSON (no extra text, no markdown, no code fences).` },
                        { role: "user", content: transcript }
                      ],
                      max_tokens: 1000,
                      temperature: 0.0
                    },
                    { 
                      headers: {
                    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                  },
                  timeout: 10000
                    }
                  );
                  content = r2.data.choices?.[0]?.message?.content?.trim() || content;
                }

              console.log(`[${requestId}] AI parsing result: ${content}`);
              
              // Clean up the response to remove markdown code blocks if present
              if (content.startsWith('```json')) {
                content = content.replace(/```json\n?/, '').replace(/\n?```$/, '');
              } else if (content.startsWith('```')) {
                content = content.replace(/```\n?/, '').replace(/\n?```$/, '');
              }
                          
              // If model returned adjacent objects without brackets, wrap into an array
                const cTrim1 = content.trim();
                if (!/^\s*\[/.test(cTrim1) && /}\s*(?:,\s*|\n)\s*{/.test(cTrim1)) {
                  content = `[${cTrim1.replace(/}\s*(?:,\s*|\n)\s*{/g, '},{')}]`;
                }
                // If array looks cut mid-stream, salvage up to the last complete object and close the bracket
                if (/^\s*\[/.test(content) && !/\]\s*$/.test(content)) {
                  const lastObjEnd = content.lastIndexOf('}');
                  if (lastObjEnd > 0) content = content.slice(0, lastObjEnd + 1) + ']';
                }
           
              // Parse the JSON response
    
              // If model returned multiple objects without array brackets, wrap them
                const cTrim = content.trim();
                if (!/^\s*\[/.test(cTrim) && /}\s*(?:,\s*|\n)\s*{/.test(cTrim)) {
                  content = `[${cTrim.replace(/}\s*(?:,\s*|\n)\s*{/g, '},{')}]`;
                }         
                try {
                const parsed = safeJsonParse(content);
                if (!parsed) {
                  console.error(`[${requestId}] Failed to parse AI response as JSON after cleanup`);
                  return null;
                }
                const updatesArray = Array.isArray(parsed) ? parsed : [parsed];
                
                return updatesArray.map(update => {
                // Convert quantity to number and ensure proper sign
                let quantity = typeof update.quantity === 'string' ? 
                              parseInt(update.quantity.replace(/[^\d.-]/g, '')) || 0 : 
                              Number(update.quantity) || 0;
                
                // Ensure action is properly set based on quantity
                
                let action = (update.action || '').toLowerCase();
                        if (!action) { action = quantity >= 0 ? 'purchased' : 'sold'; }
                        // Normalize common variants
                        if (action === 'return' || action === 'returns' || action === 'returned') action = 'returned';
                        // If transcript explicitly contains a return verb, prefer 'returned'
                        try {
                          const low = String(transcript || '').toLowerCase();
                          if (/(^|\s)(return|returned|रिटर्न|वापस|परत|રીટર્ન)(\s|$)/.test(low)) {
                            action = 'returned';
                          }
                        } catch(_) {}
                
                // Extract price information
                let price = update.price || 0;
                let totalPrice = update.totalPrice || 0;
                
                // Calculate missing values
                if (price > 0 && totalPrice === 0) {
                  totalPrice = price * Math.abs(quantity);
                } else if (totalPrice > 0 && price === 0 && quantity > 0) {
                  price = totalPrice / quantity;
                }
                
                // Ensure unit has a proper default
                const unit = update.unit || 'pieces';
                
                // Use AI-parsed product directly - NO re-processing!
                const product = String(update.product || '').trim();             
                // Use "now" as the base date for dd/mm or dd-mm inputs (so 15/12 -> 15/12/currentYear)           
                 const baseISO = new Date().toISOString(); // so dd/mm uses current year
                 const expiry = update.expiryDate
                   ? (parseExpiryTextToISO(update.expiryDate, baseISO) || toISODateUTC(update.expiryDate))
                   : null;
                  
                return {
                  product: product,
                  quantity: Math.abs(quantity), // Always store positive quantity
                  unit: unit,
                  action: action, // 'purchased' | 'sold' | 'remaining' | 'returned'
                  price: price,
                  totalPrice: totalPrice,
                  expiryISO: expiry,
                  isKnown: products.some(p => isProductMatch(product, p))
                };
              });
              } catch (parseError) {
                console.error(`[${requestId}] AI mapping error:`, parseError.message);
                console.error(`[${requestId}] Raw AI response:`, content);
                return null;
              }
            } catch (error) {
              console.error(`[${requestId}] AI parsing error:`, error.message);
              return null;
            }
          }

// Improved product extraction function
function extractProduct(transcript) {
  // Remove action words and numbers, but preserve product names
  const cleaned = transcript
    .replace(/(\d+|[०-९]+|[a-zA-Z]+)\s*(kg|किलो|grams?|ग्राम|packets?|पैकेट|boxes?|बॉक्स|liters?|लीटर)/gi, ' ')
    .replace(regexPatterns.purchaseKeywords, ' ')
    .replace(regexPatterns.salesKeywords, ' ')
    .replace(regexPatterns.remainingKeywords, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    
  // Strip common trailing price fragments: "at 50/piece" or "@60/litre"
    const priceTail = /\s+(?:at|@)\s*\d+(?:\.\d+)?(?:\/[A-Za-z]+)?\s*$/i;
    const nameOnly = cleaned.replace(priceTail, '').trim();

  // Try to match with known products first   
  for (const product of products) {
      if (nameOnly.toLowerCase().includes(product.toLowerCase()) ||
          product.toLowerCase().includes(nameOnly.toLowerCase())) {
        return product;
      }
    }
    return nameOnly;
}

// Improved parse single update with proper action detection and unit handling
function parseSingleUpdate(transcript) {
  const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/gi, '');
  // Try to extract product name more flexibly
  let product = extractProduct(transcript);
  let quantity = 0;
  let unit = '';
  let unitMultiplier = 1; 
// ① Prefer a number attached to a known unit (e.g., "5 packets" or "packets 5")
  const qtyUnitRx = /\b(\d+)\s*(packets?|boxes?|kg|kgs?|kilo|kilograms?|g|grams?|ml|mls?|ltr|l|liters?|litres?|pieces?|piece)\b|\b(packets?|boxes?|kg|kgs?|kilo|kilograms?|g|grams?|ml|mls?|ltr|l|liters?|litres?|pieces?|piece)\s*(\d+)\b/i;
  const qum = transcript.toLowerCase().match(qtyUnitRx);
  if (qum) {
    if (qum[1]) { // "<qty> <unit>"
      quantity = parseInt(qum[1], 10);
      unit = qum[2];
    } else {      // "<unit> <qty>"
      quantity = parseInt(qum[4], 10);
      unit = qum[3];
    }
  }
  // Try to match digits first (including Devanagari digits)
  const digitMatch = quantity ? null : transcript.match(regexPatterns.digits);
  if (digitMatch) {
    // Convert Devanagari digits to Arabic digits
    let digitStr = digitMatch[1];
    digitStr = digitStr.replace(/[०१२३४५६७८९]/g, d => '०१२३४५६७८९'.indexOf(d));
    quantity = parseInt(digitStr) || 0;
  } else {
    // Try to match number words
    const words = quantity ? [] : transcript.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (numberWords[word]) {
        quantity = numberWords[word];
        break;
      }
    }
  }
  // Extract units - prioritize common units  
  if (!unit) {
      for (const [unitName, multiplier] of Object.entries(units)) {
        if (transcript.toLowerCase().includes(unitName)) {
          unit = unitName;
          unitMultiplier = multiplier;
          break;
        }
      }
    }
  // Apply unit multiplier
  quantity = quantity * unitMultiplier;
  // Improved action detection with priority for purchase/sold over remaining
  const isPurchase = regexPatterns.purchaseKeywords.test(transcript);
  const isSold = regexPatterns.salesKeywords.test(transcript);
  const isRemaining = regexPatterns.remainingKeywords.test(transcript);
  let action, finalQuantity;
  // CRITICAL FIX: Proper action detection with correct math
  if (isSold) {
    action = 'sold';
    finalQuantity = -Math.abs(quantity); // Always negative for sales
  } else if (isPurchase) {
    action = 'purchased';
    finalQuantity = Math.abs(quantity); // Always positive for purchases
  } else if (isRemaining) {
    // Only treat as "remaining" if no other action is detected
    action = 'remaining';
    finalQuantity = Math.abs(quantity); // Positive for remaining
  } else {
    // Default based on context if no action words
    action = 'purchased'; // Default to purchase
    finalQuantity = Math.abs(quantity);
  }
  return {
  product,
  quantity: finalQuantity,
  unit,
  action,
  isKnown: products.some(p =>
    normalize(p).includes(normalize(product)) ||
    normalize(product).includes(normalize(p))
  )
};
}

// Validate if transcript is an inventory update - now allows unknown products
function isValidInventoryUpdate(parsed) {
  if (!parsed) {
    console.warn('[Validation] Parsed update is null or undefined');
    return false;
  }
  if (parsed.quantity === 0) {
    console.warn(`[Validation] Rejected due to zero quantity: ${JSON.stringify(parsed)}`);
  }
  if (!['purchased', 'sold', 'remaining', 'returned'].includes(parsed.action)) {
    console.warn(`[Validation] Rejected due to invalid action: ${parsed.action}`);
  }
  
  // Allow unknown products but require valid quantity and action    
  const normalizedAction = String(parsed.action ?? '').toLowerCase();
  const validAction = ['purchased', 'sold', 'remaining', 'returned'].includes(normalizedAction);
  const validQuantity = parsed.quantity !== 0;
  
  if (!validAction) {
    console.warn(`[Validation] Rejected due to invalid action: ${parsed.action}`);
  }
  if (!validQuantity) {
    console.warn(`[Validation] Rejected due to zero quantity: ${parsed.quantity}`);
  }
  
  return validQuantity && validAction;
}

// Improved handling of "bacha" vs "becha" confusion
async function validateTranscript(transcript, requestId, langHint = 'en') {
  try {
    // First, fix common mispronunciations before sending to DeepSeek
    let fixedTranscript = transcript;
    // More comprehensive patterns for fixing "bacha" to "becha"
    // Pattern 1: "बचा" followed by a quantity and product (most common case)
    fixedTranscript = fixedTranscript.replace(/(\d+)\s*(kg|किलो|packets?|पैकेट|grams?|ग्राम)\s*([a-zA-Z\s]+)\s+बचा/gi, (match, qty, unit, product) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${qty} ${unit} ${product} बेचा"`);
      return `${qty} ${unit} ${product} बेचा`;
    });
    // Pattern 2: "बचा" followed by a product and quantity
    fixedTranscript = fixedTranscript.replace(/([a-zA-Z\s]+)\s+(\d+)\s*(kg|किलो|packets?|पैकेट|grams?|ग्राम)\s+बचा/gi, (match, product, qty, unit) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${product} ${qty} ${unit} बेचा"`);
      return `${product} ${qty} ${unit} बेचा`;
    });
    // Pattern 3: Product followed by "बचा" and then purchase action
    fixedTranscript = fixedTranscript.replace(/([a-zA-Z\s]+)\s+बचा\s+.*?(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)/gi, (match, product, purchased) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${product} बेचा, ${purchased}"`);
      return `${product} बेचा, ${purchased}`;
    });
    // Pattern 4: Purchase action followed by product and "बचा"
    fixedTranscript = fixedTranscript.replace(/(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)\s+([a-zA-Z\s]+)\s+बचा/gi, (match, purchased, product) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${purchased} ${product}, बेचा ${product}"`);
      return `${purchased} ${product}, बेचा ${product}`;
    });
    // Pattern 5: Simple "बचा" at the end of a sentence with a product
    fixedTranscript = fixedTranscript.replace(/([a-zA-Z\s]+)\s+बचा[.!?]*$/gi, (match, product) => {
      // Only replace if it doesn't contain words indicating "remaining"
      if (!product.match(/(remaining|left|बाकी)/i)) {
        console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${product} बेचा"`);
        return `${product} बेचा`;
      }
      return match;
    });
    if (fixedTranscript !== transcript) {
      console.log(`[${requestId}] Fixed transcript: "${transcript}" → "${fixedTranscript}"`);
    }
    // Only use DeepSeek for minimal cleaning - just fix grammar and keep original language
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are an inventory assistant. Clean up this transcript but KEEP THE ORIGINAL LANGUAGE:
- Fix grammar errors
- Keep product names as they are (do not translate or change them)
- Keep numbers as they are (do not translate them)
- Return ONLY the cleaned text in the same language as the input, nothing else`
          },
          {
            role: "user",
            content: fixedTranscript
          }
        ],
        max_tokens: 50,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // Increased timeout
      }
    );
    
    const cleaned = response.data.choices[0].message.content.trim();
        // Single-script + ASCII numerals — guarantees parser stability across languages
        const langTarget = String(langHint ?? 'en').toLowerCase();
        const oneScript = enforceSingleScriptSafe(cleaned, langTarget);
        const normalized = normalizeNumeralsToLatin(oneScript);
        console.log(`[${requestId}] Cleaned transcript (single-script: ${langTarget}): "${normalized}"`);
        return normalized;
  } catch (error) {
    console.warn(`[${requestId}] Deepseek validation failed, using original:`, error.message);      
    const langTarget = String(langHint ?? 'en').toLowerCase();
       const oneScript = enforceSingleScriptSafe(String(transcript ?? ''), langTarget);
       const normalized = normalizeNumeralsToLatin(oneScript);
       return normalized;
  }
}

// Handle multiple inventory updates with batch tracking
async function updateMultipleInventory(shopId, updates, languageCode) {      
  
// Keep script/language stable for this turn (e.g., Hindi from STT)
  const lang = String(languageCode ?? 'en').toLowerCase();

  // --- NEW: per-shop recent price-nudge marker (global, lightweight) ---
  globalThis.__recentPriceNudge = globalThis.__recentPriceNudge ?? new Map(); // shopId -> ts(ms)
  const markNudged = () => {
    try { globalThis.__recentPriceNudge.set(shopId, Date.now()); } catch (_) {}
  };

  const results = [];
  const pendingNoPrice = [];   // <– used only to drive nudges; we DO NOT write for these
  const accepted = [];

  for (const update of updates) {  
  // NEW: lock the chosen sale price for this specific update (prevents ₹0 fallbacks)
    let chosenSalePrice = null;
  // Hoisted: keep a per-update confirmation line available beyond branch scope
    let confirmTextLine;
    let createdBatchEarly = false;
    try {
      
    // === RAW-vs-UI split ===
          // RAW for ALL DB writes; UI name only for human-facing messages                
      const productRawForDb = resolveProductNameForWrite(update); // uses gate DISABLE_PRODUCT_TRANSLATION_FOR_DB=1
        const productUiName   = update.productDisplay ?? update.product; // for display only
        const product         = productRawForDb; // MIN PATCH: alias to avoid ReferenceError across branches
          console.log(`[Update ${shopId}] Using RAW product for DB: "${productRawForDb}"`);
                  
      // === Handle customer returns (simple add-back; no batch, no price/expiry) ===
      if (update.action === 'returned') {
        let result;          // hoisted
        let newQty = null;   // hoisted, mutable
        let u = update.unit; // hoisted default
        try {
          // Persist the return (add back to stock)
                    
          // DB ops MUST use RAW name
                   result = await updateInventory(shopId, productRawForDb, Math.abs(update.quantity), update.unit);
                   const invAfter = await getProductInventory(shopId, productRawForDb);

          newQty = invAfter?.quantity ?? result?.newQuantity ?? null;
          u      = invAfter?.unit     ?? result?.unit       ?? u;
      
          // Fallback: second peek if the first didn’t yield usable numbers
          if (newQty === undefined || newQty === null) {
            try {
              const invPeek = await getProductInventory(shopId, product);
              if (invPeek?.success) {
                const q  = invPeek.quantity ?? invPeek.fields?.Quantity ?? null;
                const uu = invPeek.unit     ?? invPeek.fields?.Units    ?? null;
                if (q !== undefined && q !== null) {
                  newQty = q;
                  u = uu ?? u;
                }
              }
            } catch (_) { /* best-effort: continue silently */ }
          }
        } catch (e) {
          console.warn(`[Update ${shopId} - ${product}] Return failed:`, e.message);
        }
      
        // Build confirmation with the best-known stock numbers
        const unitText2  = u ? ` ${u}` : '';
        const stockText2 = (newQty !== undefined && newQty !== null)
          ? ` (Stock: ${newQty}${unitText2})`
          : '';
        confirmTextLine = `↩️ Returned ${Math.abs(update.quantity)}${unitText2} ${product}${stockText2}`;                        
                          
        // SINGLE-ITEM RETURN: do NOT send a separate confirmation here.
        // Keep confirmTextLine so the aggregated confirmation includes it.

        // Collect per-update result for aggregator
        results.push({
          product: productRawForDb,
          quantity: Math.abs(update.quantity),
          unit: update.unit,
          action: 'returned',
          success: !!result?.success,
          newQuantity: newQty,
          unitAfter: u,
          inlineConfirmText: confirmTextLine,
        });
      
        continue; // Move to next update
      }
      let needsPriceInput = false;
      // Get product price from database           
      let productPrice = 0;
            let productPriceUnit = null;
            try {
              const priceResult = await getProductPrice(productRawForDb, shopId);                            
              if (priceResult?.success && Number(priceResult.price) > 0) {
                 productPrice = toNumberSafe(priceResult.price);
                 productPriceUnit = priceResult.unit ?? null;
              }
            } catch (error) {
              console.warn(`[Update ${shopId} - ${product}] Could not fetch product price:`, error.message);
            }
            
    // === NEW PURCHASE FLOW: default expiry, price essential; do not block on expiry ===
        if (update.action === 'purchased') {
          let autoExpiry = null;
          let productMeta = null;
          try {                        
            // Prefer shop-scoped product meta for expiry hints
            productMeta = await getProductPrice(productRawForDb, shopId);
            if (productMeta?.success && productMeta.requiresExpiry) {
              const sd = Number(productMeta.shelfLifeDays ?? 0);
              if (sd > 0) {
                const ts = new Date();
                ts.setDate(ts.getDate() + sd);
                autoExpiry = ts.toISOString();
              } // else requiresExpiry=true but no shelf-life => leave blank
            }
          } catch (_) {}
    
          const purchaseDateISO = formatDateForAirtable(new Date());
          const priceFromMsg = Number(update.price ?? 0);
          const priceFromCatalog = Number(productMeta?.price ?? 0);
          const finalPrice = priceFromMsg > 0 ? priceFromMsg : (priceFromCatalog > 0 ? priceFromCatalog : 0);
    
          // Inline expiry from message (if any); else default/blank.
          const providedExpiryISO = bumpExpiryYearIfPast(update.expiryISO ?? null, purchaseDateISO);
          const expiryToUse = providedExpiryISO ?? autoExpiry ?? null;
                        
          // STRICT: if price is missing and backend doesn't know it => DO NOT CAPTURE; ask for price
                if (finalPrice <= 0) {
                  pendingNoPrice.push({ product: productRawForDb, unit: update.unit });
                  // Send localized nudges; no DB writes; mark as non-success to suppress purchase acks
                  try {                                          
                      if (pendingNoPrice.length === 1) {
                                  await sendPriceRequiredNudge(`whatsapp:${shopId}`, productRawForDb, update.unit, lang /* keep same script */);
                                } else {
                                  await sendMultiPriceRequiredNudge(`whatsapp:${shopId}`, pendingNoPrice.map(p => ({...p, product: productRawForDb})), lang);
                                }   
                  // --- NEW: remember we nudged price for this shop right now ---
                  markNudged();
                  } catch (_) {}
                  results.push({
                    product: productRawForDb,
                    quantity: update.quantity,
                    unit: update.unit,
                    action: update.action,
                    success: false,           // <— important: prevents “📦 Purchased …” ack lines
                    needsUserInput: true,
                    awaiting: 'price',
                    status: 'pending',
                    deferredPrice: true,
                    inlineConfirmText: ''
                  });
                  continue; // Move to next update; NO batch, NO inventory, NO state
                }
                          
          // If we have a price, continue with normal flow
          // Create batch immediately with defaulted expiry (or blank)
          const batchResult = await createBatchRecord({
            shopId,
            product: productRawForDb,
            quantity: update.quantity,
            unit: update.unit,
            purchaseDate: purchaseDateISO,
            expiryDate: expiryToUse,
            purchasePrice: finalPrice // may be 0 if unknown now
          });          
          
          if (batchResult?.success) createdBatchEarly = true;
      
          // Ensure inventory reflects the purchase *and* capture stock for summary lines
          let invResult;
          try {
            invResult = await updateInventory(shopId, productRawForDb, update.quantity, update.unit);
          } catch (_) {}
          const stockQty  = invResult?.newQuantity;
          const stockUnit = invResult?.unit ?? update.unit;
      
          // Save price if known now
          if (finalPrice > 0) {
            try { await upsertProduct({ shopId, name: productRawForDb, price: finalPrice, unit: update.unit }); } catch (_) {}
          }
      
          const isPerishable = !!(productMeta?.success && productMeta.requiresExpiry);
          const edDisplay = expiryToUse ? formatDateForDisplay(expiryToUse) : '—';
                            
          // Assign to hoisted holder so we can use it later safely
                  confirmTextLine = COMPACT_MODE
                    ? (isPerishable
                      ? `📦 Purchased ${update.quantity} ${update.unit} ${productRawForDb} @ ₹${finalPrice}. Exp: ${edDisplay}`
                      : `📦 Purchased ${update.quantity} ${update.unit} ${productRawForDb} @ ₹${finalPrice}`)
                    : `• ${productRawForDb}: ${update.quantity} ${update.unit} purchased @ ₹${finalPrice}`
                      + (isPerishable ? `\n Expiry: ${edDisplay}` : `\n Expiry: —`);

          // Open the 2-min expiry override window
          try {
            await saveUserStateToDB(shopId, 'awaitingPurchaseExpiryOverride', {
              batchId: batchResult?.id ?? null,
              product: productRawForDb,
              action: 'purchased',
              purchaseDateISO,
              currentExpiryISO: expiryToUse ?? null,
              createdAtISO: new Date().toISOString(),
              timeoutSec: 120
            });
          } catch (_) {}
      
          results.push({
            product: productRawForDb,
            quantity: update.quantity,
            unit: update.unit,
            action: update.action,
            success: true,     
            // ensure the summary has stock figures to avoid "undefined"
            newQuantity: stockQty,
            unitAfter: stockUnit,
            purchasePrice: finalPrice,
            totalValue: finalPrice * Math.abs(update.quantity),
            inlineConfirmText: confirmTextLine
          });
          continue; // done with purchase branch
        }
        // === END NEW block ===

      // Use provided price or fall back to database price            
      // NEW: reliable price/value without leaking block-scoped vars            
      const msgUnitPrice = toNumberSafe(update.price);                  
      const fromU = normalizeUnit(productPriceUnit || update.unit || 'pieces');   // normalize + default
       const toU   = normalizeUnit(update.unit || fromU);
       const factor = Number(unitConvFactor?.(fromU, toU));
       const dbAdjustedUnitPrice = Number.isFinite(factor) ? (productPrice * factor) : productPrice;
       const unitPriceForCalc = msgUnitPrice > 0 ? msgUnitPrice : dbAdjustedUnitPrice;

      const finalTotalPrice = Number.isFinite(update.totalPrice)
        ? Number(update.totalPrice)
        : (unitPriceForCalc * Math.abs(update.quantity));

      // Add validation for zero price
        if (unitPriceForCalc <= 0 && update.action === 'sold') {
          console.warn(`[Update ${shopId} - ${product}] Cannot process sale with zero price`);                    
          const errorMsg = await t(
                    `Cannot process sale: No valid price found for ${product}. Please set a price first.`,
                    languageCode,
                    'zero-price-error'
                  );
          await sendMessageViaAPI(`whatsapp:${shopId}`, errorMsg);
          results.push({
            product,
            quantity: update.quantity,
            unit: update.unit,
            action: update.action,
            success: false,
            error: 'Zero price not allowed for sales'
          });
          continue;
        }
      
      const priceSource = (Number(update.price) > 0)
         ? 'message'
         : (productPrice > 0 ? 'db' : null); // only mark db if it's actually > 0

      // Rest of the function remains the same...
      console.log(`[Update ${shopId} - ${product}] Processing update: ${update.quantity} ${update.unit}`);
      // Check if this is a sale (negative quantity)
      const isSale = update.action === 'sold';
      
      // For sales, determine which batch to use (with hints later; default FIFO oldest)
      let selectedBatchCompositeKey = null;
      if (isSale) {
        selectedBatchCompositeKey = await selectBatchForSale(
          shopId,
          productRawForDb,
          // For now, we default to FIFO oldest; inline hints can be added to `update` later if desired
          { byPurchaseISO: null, byExpiryISO: null, pick: 'fifo-oldest' }
        );
        selectedBatchCompositeKey = normalizeCompositeKey(selectedBatchCompositeKey);
        if (selectedBatchCompositeKey) {
          console.log(`[Update ${shopId} - ${product}] Selected batch (sale): ${selectedBatchCompositeKey}`);
        } else {
          console.warn(`[Update ${shopId} - ${product}] No batch with positive quantity found for sale allocation`);
        }
      }

      // Update the inventory using translated product name
      let result;
        if (isSale) {
          const saleGuard = await applySaleWithReconciliation(
            shopId,
            { productRawForDb, quantity: Math.abs(update.quantity), unit: update.unit, saleDate: new Date().toISOString(), language: languageCode },
            {
              // Optional overrides; otherwise read from UserPreferences:
              // allowNegative: false,
              // autoOpeningBatch: true,
              // onboardingDate: '2025-08-01T00:00:00.000Z'
            }
          );
          if (saleGuard.status === 'blocked' || saleGuard.status === 'error') {
            const msg = await t(
              `❌ Not enough stock for ${product}. You tried to sell ${update.quantity} ${update.unit}. ` +
              `Reply: "opening ${product} ${saleGuard.deficit} ${update.unit}" to set opening stock.`,
              languageCode,
              'neg-guard'
            );
            await sendMessageViaAPI(`whatsapp:${shopId}`, msg);
            results.push({ product, success: false, error: saleGuard.message ?? 'Insufficient stock', blocked: true, deficit: saleGuard.deficit });
            continue; // move to next update
          }
          // Keep a success flag similar to old `result` shape
          result = { success: true };          
          // NEW: fetch post-sale inventory so confirmation shows correct stock
              try {
                const invAfter = await getProductInventory(shopId, productRawForDb);
                if (invAfter && invAfter.quantity !== undefined) {
                  result.newQuantity = invAfter.quantity;
                  result.unit = invAfter.unit || update.unit;
                }
              } catch (e) {
                console.warn(`[Update ${shopId} - ${product}] Post-sale inventory fetch failed:`, e.message);
              }

          // Prefer the helper's opening-batch key if it created one
          if (!selectedBatchCompositeKey && saleGuard.selectedBatchCompositeKey) {
            selectedBatchCompositeKey = saleGuard.selectedBatchCompositeKey;
          }
        } else {
          // not a sale: keep original purchase/increase path
          result = await updateInventory(shopId, productRawForDb, update.quantity, update.unit);
        }

          
        // Create batch record for purchases only (skip if we already created above)
            if (!createdBatchEarly && update.action === 'purchased' && result.success && Number(finalPrice) > 0) {
            console.log(`[Update ${shopId} - ${product}] Creating batch record for purchase`);
            // Format current date with time for Airtable
            const formattedPurchaseDate = formatDateForAirtable(new Date());
            console.log(`[Update ${shopId} - ${product}] Using timestamp: ${formattedPurchaseDate}`);
            
            // Use database price (productPrice) or provided price
            const purchasePrice = productPrice > 0 ? productPrice : (finalPrice || 0);                          
            if (!(purchasePrice > 0)) {
                    console.warn(`[Update ${shopId} - ${product}] STRICT gate: skipping batch creation due to missing price`);
                  } else {
            console.log(`[Update ${shopId} - ${product}] Using purchasePrice: ${purchasePrice} (productPrice: ${productPrice}, finalPrice: ${finalPrice})`);
            
            const batchResult = await createBatchRecord({
              shopId,
              product: productRawForDb, 
              quantity: update.quantity,
              unit: update.unit, // Pass the unit
              purchaseDate: formattedPurchaseDate,
              expiryDate: null, // Will be updated later
              purchasePrice: purchasePrice // Pass the purchase price
            });
        if (batchResult.success) {
          console.log(`[Update ${shopId} - ${product}] Batch record created with ID: ${batchResult.id}`);
          // Add batch date to result for display
          result.batchDate = formattedPurchaseDate;
        } 
        else {
          console.error(`[update] Failed to create batch record: ${batchResult.error}`);
        }

      // ✅ Update product price in DB after purchase — only if we have a positive rate
      if (productPrice > 0) {
        try {          
          await upsertProduct({
                    shopId,
                    name: product,
                    price: productPrice,
                    unit: update.unit
                  });
          console.log(`[Update ${shopId} - ${product}] Product price updated in DB: ₹${productPrice}/${update.unit}`);
        } catch (err) {
          console.warn(`[Update ${shopId} - ${product}] Failed to update product price in DB:`, err.message);
        }
      } else {
        console.log(`[Update ${shopId} - ${product}] Skipped DB price update (no price provided).`);
      }
            }
      }
            // Create sales record for sales only
            if (isSale && result.success) {
              console.log(`[Update ${shopId} - ${product}] Creating sales record`);
              try {
                // Use database price (productPrice) if available, then fallback to finalPrice                      
                const salePrice = unitPriceForCalc; // Use pre-calculated unit price
                          // NEW: remember the actual sale price used for this transaction
                          chosenSalePrice = salePrice;
                const saleValue = salePrice * Math.abs(update.quantity);
                console.log(`[Update ${shopId} - ${product}] Sales record - salePrice: ${salePrice}, saleValue: ${saleValue}`);
                
                const salesResult = await createSalesRecord({
                  shopId,
                  product: productRawForDb,
                  quantity: -Math.abs(update.quantity),
                  unit: update.unit,
                  saleDate: new Date().toISOString(),
                  batchCompositeKey: selectedBatchCompositeKey, // Uses composite key
                  salePrice: salePrice, // Fixed: Use salePrice instead of finalPrice
                  saleValue: saleValue
                });
 
                // Add validation for zero price
                if (salePrice <= 0) {
                  console.warn(`[Update ${shopId} - ${product}] Invalid sale price: ${salePrice}`);                                    
                  const errorMsg = await t(
                              `Cannot process sale: No valid price found for ${product}. Please set a price first.`,
                              languageCode,
                              'invalid-price'
                            );
                  await sendMessageViaAPI(`whatsapp:${shopId}`, errorMsg);
                  continue; // Skip this update
                }
               
          if (salesResult.success) {
            console.log(`[Update ${shopId} - ${product}] Sales record created with ID: ${salesResult.id}`);

            const startTime = Date.now();
            
            // Generate and send invoice (non-blocking)          
            (async () => {
               try {
                console.log(`[Update ${shopId} - ${product}] Starting invoice generation process`);
                // Get shop details
                const shopDetailsResult = await getShopDetails(shopId);
                if (!shopDetailsResult.success) {
                  console.warn(`[Update ${shopId} - ${product}] Could not get shop details: ${shopDetailsResult.error}`);
                  return;
                }
                
                // Prepare sale record for invoice
                const saleRecordForInvoice = {
                  product: product,
                  quantity: Math.abs(update.quantity), // Convert to positive for display
                  unit: update.unit,
                  rate: salePrice, // Fixed: Use salePrice
                  saleDate: new Date().toISOString()
                };
                
                console.log(`[Update ${shopId} - ${product}] Sale record prepared:`, saleRecordForInvoice);
                
                // Generate invoice PDF
                const pdfPath = await generateInvoicePDF(shopDetailsResult.shopDetails, saleRecordForInvoice);
                console.log(`[Update ${shopId} - ${product}] Invoice generated: ${pdfPath}`);
                
                // Verify PDF file exists
                if (!fs.existsSync(pdfPath)) {
                  throw new Error(`Generated PDF file not found: ${pdfPath}`);
                }
                
                // Send the PDF to the shop owner
                const message = await sendPDFViaWhatsApp(`whatsapp:${shopId}`, pdfPath);
                console.log(`[Update ${shopId} - ${product}] Invoice sent to whatsapp:${shopId}. SID: ${message.sid}`);
                
              } catch (invoiceError) {
                console.error(`[Update ${shopId} - ${product}] Error generating/sending invoice:`, invoiceError.message);
                console.error(`[Update ${shopId} - ${product}] Stack trace:`, invoiceError.stack);   
            } finally {
                  // No local stop; centralized wrapper handles stopping for the whole request.
                }
            })();
            
            // Update batch quantity if a batch was selected
            if (selectedBatchCompositeKey) {                         
            // Log the actual delta we will apply (-abs) to avoid confusion
            console.log(`[Update ${shopId} - ${product}] About to update batch quantity. Composite key: "${selectedBatchCompositeKey}", Quantity change: ${-Math.abs(update.quantity)}`);
              try {                                 
                const batchUpdateResult = await updateBatchQuantityByCompositeKey(
                  normalizeCompositeKey(selectedBatchCompositeKey),
                   -Math.abs(update.quantity)
                 );

                if (batchUpdateResult.success) {
                  console.log(`[Update ${shopId} - ${product}] Updated batch quantity successfully`);
                  if (batchUpdateResult.recreated) {
                    console.log(`[Update ${shopId} - ${product}] Batch was recreated during update`);
                    result.batchRecreated = true;
                  }
                } else {
                  console.error(`[Update ${shopId} - ${product}] Failed to update batch quantity: ${batchUpdateResult.error}`);
                  result.batchIssue = true;
                  result.batchError = batchUpdateResult.error;
                }
              } catch (batchError) {
                console.error(`[Update ${shopId} - ${product}] Error updating batch quantity:`, batchError.message);
                result.batchIssue = true;
                result.batchError = batchError.message;
              }
            }

            // Add transaction logging
            console.log(`[Transaction] Sale processed - Product: ${product}, Qty: ${Math.abs(update.quantity)}, Price: ${salePrice}, Total: ${saleValue}`);
                                                
            // Send a single confirmation (dedup) and append stock if we have it
              await sendSaleConfirmationOnce(
                `whatsapp:${shopId}`,
                lang,
                'sale-confirmation', // requestId scope for dedupe
                {
                  product: productRawForDb,
                  qty: Math.abs(update.quantity),
                  unit: update.unit,
                  pricePerUnit: salePrice,
                  newQuantity: result?.newQuantity   // ensures "Stock: 5 liters" gets appended
                }
              );
                        
            // --- NEW: start a short override window (2 min) only if multiple batches exist ---
             try {
               if (await shouldOfferBatchOverride(shopId, productRawForDb)) {
                 await saveUserStateToDB(shopId, 'awaitingBatchOverride', {
                   saleRecordId: salesResult.id,
                   product,
                   action: 'purchased',
                   unit: update.unit,
                   quantity: Math.abs(update.quantity),
                   oldCompositeKey: selectedBatchCompositeKey,
                   createdAtISO: new Date().toISOString(),
                   timeoutSec: 120
                 });
               }
             } catch (_) {}

            // Compose confirmation message with used batch and up to N alternatives
            let altLines = '';
            try {
              const list = await getBatchesForProductWithRemaining(shopId, productRawForDb); // asc by PurchaseDate
              const used = selectedBatchCompositeKey;
              const alts = (list || []).filter(b => b.compositeKey !== used).slice(0, SHOW_BATCH_SUGGESTIONS_COUNT);
              if (alts.length) {
                const render = b => {
                  const pd = formatDateForDisplay(b.purchaseDate);
                  const ed = b.expiryDate ? formatDateForDisplay(b.expiryDate) : '—';
                  return `• ${pd} (qty ${b.quantity} ${b.unit}, exp ${ed})`;
                };
                altLines = '\n\nOther batches:\n' + alts.map(render).join('\n');
              }
            } catch (_) {}

            
// --- BEGIN COMPACT SALE CONFIRMATION ---            
                        
          const usedBatch = selectedBatchCompositeKey
             ? await getBatchByCompositeKey(normalizeCompositeKey(selectedBatchCompositeKey))
             : null;
            const pd = usedBatch?.fields?.PurchaseDate ? formatDateForDisplay(usedBatch.fields.PurchaseDate) : '—';
            const ed = usedBatch?.fields?.ExpiryDate ? formatDateForDisplay(usedBatch.fields.ExpiryDate) : '—';
            const offerOverride = await shouldOfferBatchOverride(shopId, productRawForDb).catch(() => false);

            const compactLine = (() => {
              const qty = Math.abs(update.quantity);
              const pricePart = salePrice > 0 ? ` @ ₹${salePrice}` : ''; // Fixed: Use salePrice
              const stockPart = (result?.newQuantity !== undefined)
                ? `. Stock: ${result.newQuantity} ${result?.unit ?? update.unit}`
                : '';
              return `✅ Sold ${qty} ${update.unit} ${productRawForDb}${pricePart}${stockPart}`;
            })();

            const verboseLines = (() => {
              const qty = Math.abs(update.quantity);
              const hdr = `✅ ${productRawForDb} — sold ${qty} ${update.unit}${salePrice > 0 ? ` @ ₹${salePrice}` : ''}`; // Fixed: Use salePrice
              const batchInfo = usedBatch ? `Used batch: Purchased ${pd} (Expiry ${ed})` : '';
              const overrideHelp = offerOverride
                ? `To change batch (within 2 min):\n• batch DD-MM   e.g., batch 12-09\n• exp DD-MM     e.g., exp 20-09\n• batch oldest  |  batch latest`
                : '';
              return [hdr, batchInfo, overrideHelp, altLines, `Full list → reply: batches ${product}`]
                .filter(Boolean)
                .join('\n');
            })();

                      
          // Unify confirmation building – always defined, avoid referencing undeclared vars later.
          // Assign to hoisted holder so we can use it later safely                   
          // We already sent a single, correct confirmation above; suppress any secondary summary line.
            confirmTextLine = '';  // <- prevents the later “Sold ... @ ₹0 ... Stock: ...” message from sending
        
          // Buffer and let outer renderer send single merged message
            // --- END COMPACT/VERBOSE SALE CONFIRMATION ---

          } else {
            console.error(`[Update ${shopId} - ${product}] Failed to create sales record: ${salesResult.error}`);
          }
        } catch (salesError) {
          console.error(`[Update ${shopId} - ${product}] Error creating sales record:`, salesError.message);
          result.salesError = salesError.message;
        }
      }
            
                           
          // NEW: Enrich outgoing item with price/value so renderer can show them
            // Use a single effective price everywhere; for *sales*, prefer the locked-in chosenSalePrice.
            const fallbackEffective = toNumberSafe(update.price ?? productPrice ?? 0);
            const effectivePrice = (update.action === 'sold')
              ? (chosenSalePrice ?? fallbackEffective)
              : fallbackEffective;
          const enriched = {
          productRawForDb,
          quantity: update.quantity,
          unit: update.unit,
          action: update.action,
          ...result,                       
          purchasePrice: update.action === 'purchased' ? effectivePrice : undefined,
          salePrice: update.action === 'sold' ? effectivePrice : undefined,
          totalValue: (update.action === 'purchased' || update.action === 'sold') ? (effectivePrice * Math.abs(update.quantity)): 0,
          inlineConfirmText: confirmTextLine,   // safe: defined if a purchase/sale branch built it
          priceSource,        
// mark updated only when we actually changed it from catalog
          priceUpdated: update.action === 'purchased'
            && (Number(update.price) > 0)
            && (Number(update.price) !== Number(productPrice))
        };          
      // Debug line to verify at runtime (you can remove later)
        console.log(
          `[Update ${shopId} - ${product}] priceSource=${priceSource}, `
          + `purchasePrice=${enriched.purchasePrice ?? '-'}, `
          + `salePrice=${enriched.salePrice ?? '-'}, `
          + `totalValue=${enriched.totalValue}`
        );
        results.push(enriched);
      
    } catch (error) {
      console.error(`[Update ${shopId} - ${update.product}] Error:`, error.message);
      results.push({
        product: update.product,
        quantity: update.quantity,
        unit: update.unit,
        action: update.action,
        success: false,
        error: error.message
      });
    }
  }
  return results;
}

// Generate response in multiple languages and scripts without labels
async function generateMultiLanguageResponse(message, languageCode, requestId) {
// [UNIQ:MLR-ENTRY-004] Hardened multi-language responder with strict script policy
  try { 
        // -----------------------------------------------------------------------
            // [UNIQ:ORCH-VAR-LOCK-001A] Lock the exact variant before any caching/hashing
            // -----------------------------------------------------------------------
            // NOTE: We keep 'hi-latn' as-is throughout. Do not normalize away '-latn'.
            const langExact = ensureLangExact(languageCode, 'en');
            const isRomanOnly = shouldUseRomanOnly(langExact); // existing helper                  
            // Decide render mode once: 'latin' for en/*-latn, else 'native'
            const renderMode = (String(langExact).toLowerCase() === 'en' || isRomanOnly) ? 'latin' : 'native';

            // If the language is English, return the message as is
            if (langExact === 'en') {
              return message;
            }
        
            // --- KEY: hash of FULL message prevents collisions and increases hits ---
            const hash = crypto.createHash('sha1').update(`${langExact}::${message}`).digest('hex'); // [UNIQ:MLR-ENTRY-004B]
            const cacheKey = `${langExact}:${hash}`;
            // 0) In-memory cache first (fastest)
            // Bypass cache entirely for *-latn to avoid generic cached replies
            const canUseCache = !(isRomanOnly && DISABLE_TRANSLATION_CACHE_FOR_LATN); // [UNIQ:MLR-CACHE-005A]
            const cached = canUseCache ? languageCache.get(cacheKey) : null;
            if (canUseCache && cached && (Date.now() - cached.timestamp < LANGUAGE_CACHE_TTL)) {
              console.log(`[${requestId}] Using cached translation for ${langExact}`);
              return cached.translation;
            }
    // 1) Persistent cache (Airtable) next
    try {
      const hit = canUseCache ? await getTranslationEntry(hash, langExact) : { success: false }; // [UNIQ:MLR-AIR-006]
      if (hit.success && hit.translatedText) {
        console.log(`[${requestId}] Translation cache hit in Airtable (${langExact})`);
        languageCache.set(cacheKey, { translation: hit.translatedText, timestamp: Date.now() });
        return hit.translatedText;
      }
    } catch (e) {
      console.warn(`[${requestId}] Translation Airtable lookup failed: ${e.message}`);
    }
        
    // If *-latn cache was disabled, purge any stale in-memory entry for safety
        if (isRomanOnly && DISABLE_TRANSLATION_CACHE_FOR_LATN) {
          languageCache.delete(cacheKey); // [UNIQ:MLR-CACHE-005B]
        }

    console.log(`[${requestId}] Translating to ${languageCode}: "${message}"`);
    // Fallback strategies:
    // 1. For common greetings, use predefined translations with both scripts
    const commonGreetings = {
      'hi': {
        native: 'नमस्ते',
        roman: 'Namaste'
      },
      'bn': {
        native: 'হ্যালো',
        roman: 'Hello'
      },
      'ta': {
        native: 'வணக்கம்',
        roman: 'Vanakkam'
      },
      'te': {
        native: 'నమస్కారం',
        roman: 'Namaskaram'
      },
      'kn': {
        native: 'ನಮಸ್ಕಾರ',
        roman: 'Namaskara'
      },
      'gu': {
        native: 'નમસ્તે',
        roman: 'Namaste'
      },
      'mr': {
        native: 'नमस्कार',
        roman: 'Namaskar'
      },
      'en': {
        native: 'Hello',
        roman: 'Hello'
      }
    };
    // Check if this is a common greeting
    const lowerMessage = message.toLowerCase();
    
const isShortGreeting = lowerMessage.split(/\s+/).length <= 3;
if (isShortGreeting && (
    lowerMessage.includes('hello') ||
    lowerMessage.includes('hi') ||
    lowerMessage.includes('नमस्ते')
)) {
  const greeting = commonGreetings[langExact] || commonGreetings['en'];            
    // SINGLE-SCRIPT fallback only (native for Indic, Latin for *-latn)
    const fallback = shouldUseRomanOnly(langExact) ? greeting.roman : greeting.native;

    // Optional: enforce ending punctuation for consistency
    if (!/[.!?]$/.test(fallback)) {
      fallback += '.';
    }
      // Cache greeting only if cache allowed for this language variant
      if (canUseCache) {
        languageCache.set(cacheKey, { translation: fallback, timestamp: Date.now() });
      }
  return fallback;
}

    // 2. For other messages, try the API
     let translated = '';
     let lastErr;
     for (let attempt = 1; attempt <= 2; attempt++) {
       try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",                        
                content: `
                You are a precise translator for WhatsApp.
                Return ONLY a SINGLE-BLOCK translation in the requested script (no second script).
                
                STYLE & TONE:
                - Use simple, easy-to-understand, day-to-day native language (conversational, not formal/literary).
                - Keep sentences short and natural; avoid bureaucratic phrasing or rare/technical words unless necessary.
                
                SCRIPT:
                - If Render = "native": write in the target language's native script (e.g., Devanagari for hi).
                - If Render = "latin": write in Latin transliteration (ASCII-preferred).
                
                COMMANDS & BUTTON LABELS:
                - Whenever any canonical command or button name appears, enclose it in "double quotes":
                  "low stock", "reorder suggestions", "expiring 0", "expiring 7", "expiring 30",
                  "short summary", "full summary", "sales today", "sales week", "sales month",
                  "top 5 products month", "inventory value", "stock value", "value summary",
                  "start trial", "demo", "help", "paid", "activate paid", "activate trial".
                - This quoting applies across all language variants (keep the translated term, but put it inside "double quotes").
                
                OTHER RULES:
                - Preserve common unit tokens: kg, g, ltr, liter, litre, ml, packet, piece, ₹.
                - Do NOT add labels, headings, or multiple paragraphs unless the source clearly needs it.
                - Do NOT invent extra punctuation; end with proper punctuation only if natural.
                `.trim()
          },
          {
            role: "user",                                                
            content: [
                              `Target: ${langExact}`,
                              `Render: ${renderMode}`,
                              `Text: "${message}"`
                            ].join('\n').trim() // [UNIQ:MLR-API-007B]
          }
        ],
        max_tokens: 600,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: TRANSLATE_TIMEOUT_MS // Increased timeout for better reliability
      }
    );
    
    translated = response.data.choices[0].message.content.trim();
         if (translated) break; // success
       } catch (err) {
         lastErr = err;
         const code = err?.code || err?.response?.status || 'unknown';
         console.warn(`[${requestId}] Translate attempt ${attempt} failed: ${code}`);
         if (attempt < 2) await new Promise(r => setTimeout(r, 600)); // small backoff
       }
     }
     if (!translated) {
       console.warn(`[${requestId}] Translation failed, using original: ${lastErr?.code || lastErr?.message || 'unknown'}`);
       return message; // keep current fallback behavior
     }

    const firstPassRaw = translated; // [UNIQ:SAN-TRUNC-012C] keep for fallback
    console.log(`[${requestId}] Raw translation response:`, translated);
    translated = normalizeTwoBlockFormat(translated, langExact); // [UNIQ:MLR-POST-008A]

    // Quick integrity check for SINGLE-BLOCK policy: tidy punctuation / minimal length only
        const endsNeatly = /[.!?]$/.test(String(translated).trim()); // [UNIQ:MLR-GUARD-009]
        const looksTooShort = String(translated).trim().length < 5;
        if (!endsNeatly || looksTooShort) {
      try {
        console.warn(`[${requestId}] Translation looks incomplete. Retrying with larger budget...`);
        const retry = await axios.post(
          'https://api.deepseek.com/v1/chat/completions',
          {
            model: "deepseek-chat",
            messages: [                                                        
            { role: "system", content: `
            You are a precise translator for WhatsApp.
            Single-block only; simple everyday native language; requested script only.
            Preserve unit tokens (kg, ltr, ₹). End with punctuation only if natural.
            Enclose canonical commands/button names in "double quotes" as specified.
            `.trim() },
                          { role: "user", content: [
                              `Target: ${langExact}`,
                              `Render: ${renderMode}`,
                              `Text: "${message}"`
                            ].join('\n').trim() } // [UNIQ:MLR-API-007C]
            ],
            max_tokens: Math.min(2000, Math.max(800, Math.ceil(message.length * 3))),
            temperature: 0.2
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 20000
          }
        );
        translated = normalizeTwoBlockFormat(retry.data.choices[0].message.content.trim(), langExact); // [UNIQ:MLR-GUARD-009A]
      } catch (e) {
        console.warn(`[${requestId}] Retry translation failed, using first translation:`, e.message);
      }
    }
      
    // [UNIQ:SAN-TRUNC-012D] Final min-length guard: avoid sending tiny/garbled stubs
      try {               
        const MIN_LEN2 = 25;
          if ((translated || '').trim().length < MIN_LEN2) {
          console.warn(`[${requestId}] Output too short (${translated.length}). Falling back to first-pass raw after sanitize.`);
          const fallbackClean = String(firstPassRaw || '')
            .replace(/`+/g, '')
            .replace(/^[\s.,\-–—•]+/u, '')
            .trim();
          if (fallbackClean.length >= MIN_LEN2) translated = fallbackClean;
        }
      } catch (_) {}

    // Last-resort guard: if still too long, prefer native script only
    const MAX_LENGTH = 1600;
    if (translated.length > MAX_LENGTH) {
      const parts = translated.split(/\n{2,}/);
      if (parts.length >= 2) translated = parts[0];
    }    
    
// After you have a valid `translated` value:
    if (translated && translated.trim()) {
      // 2) Save to Airtable (persistent cache) - non-blocking preferred, but safe to await
      try {               
        // Skip persistence for *-latn when cache disabled to avoid generic reuse
                if (!isRomanOnly || !DISABLE_TRANSLATION_CACHE_FOR_LATN) {
                  await upsertTranslationEntry({ // [UNIQ:MLR-AIR-006B]
                    key: hash,
                    language: langExact,
                    sourceText: message,
                    translatedText: translated
                  });
                }
      } catch (e) {
        console.warn(`[${requestId}] Failed to persist translation: ${e.message}`);
      }
      // 3) Save to in-memory cache
      if (canUseCache) languageCache.set(cacheKey, { translation: translated, timestamp: Date.now() });
      return translated;
    }

  } catch (error) {
    console.warn(`[${requestId}] Translation failed, using original:`, error.message);
    // 3. For other messages, return the original with a note in both scripts when possible
    console.log(`[${requestId}] Using original message for ${languageCode}`);
    return message;
  }
}

// Helper function to send system messages in user's preferred language
async function sendSystemMessage(message, from, detectedLanguage, requestId, response) {
  try {
    // Get user's preferred language
    let userLanguage = detectedLanguage;
    // Try to get user preference from database if not provided
    if (!userLanguage && from) {
      try {
        const shopId = from.replace('whatsapp:', '');
        const userPref = await getUserPreference(shopId);
        if (userPref.success) {
          userLanguage = userPref.language;
        }
      } catch (error) {
        console.warn(`[${requestId}] Failed to get user preference:`, error.message);
      }
    }
    // Default to English if no language is detected
    if (!userLanguage) {
      userLanguage = 'en';
    }
    // Generate multilingual response        
    const formattedMessage = await t(message, userLanguage, requestId);
        // Append localized mode footer
        const withTag = await tagWithLocalizedMode(from, formattedMessage, userLanguage);
        // If long, send via API (which auto-splits) and keep TwiML minimal        
    const MAX_LENGTH = 1600;
        if (withTag.length > MAX_LENGTH) {
          await sendMessageViaAPI(from, withTag, userLanguage);

      // Optional: small ack so Twilio gets a valid TwiML
      response.message('✅ Sent.');
      return withTag;
    }
    // Otherwise, TwiML is fine          
      response.message(withTag);
      return withTag;
    
  } catch (error) {
    console.error(`[${requestId}] Error sending system message:`, error.message);
    // Fallback to original message in English
    response.message(message);
    return message;
  }
finally {
  try { stopEngagementTips(requestId); } catch (_) {}
}
}


// Prefer HTTPS public URL for WhatsApp media (data: URLs often fail on WA routing).
// Set USE_BASE64_PDF=true to force base64 path (not recommended).
const USE_BASE64_PDF = String(process.env.USE_BASE64_PDF ?? 'false').toLowerCase() === 'true';
async function sendPDFViaWhatsApp(to, pdfPath) {
  const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  
  console.log(`[sendPDFViaWhatsApp] Preparing to send PDF: ${pdfPath}`);
  
  try {
    // Check if PDF file exists
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }
    
    // Get file stats for logging
    const stats = fs.statSync(pdfPath);
    console.log(`[sendPDFViaWhatsApp] PDF file size: ${stats.size} bytes`);
    
    // COPILOT-PATCH-PDF-CAPTION-001: dynamic caption based on filename
         const baseName = path.basename(pdfPath).toLowerCase();
         const isInventory = baseName.startsWith('inventory_short_');
         const isSalesRaw  = baseName.startsWith('sales_raw_');
         const caption     = isInventory
           ? 'Here is your inventory table:'
           : (isSalesRaw ? 'Here is your sales table:' : 'Here is your invoice:');
    
    // Prefer public URL flow unless explicitly overridden
        if (!USE_BASE64_PDF) {
          const fileName = path.basename(pdfPath);
          const baseUrl = process.env.PUBLIC_URL || `https://${process.env.RAILWAY_SERVICE_NAME}.railway.app`;
          const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
          const publicUrl = `${normalizedBaseUrl}/invoice/${fileName}`;
          console.log(`[sendPDFViaWhatsApp] Using public URL: ${publicUrl}`);
          const msg = await client.messages.create({
            body: caption,
            mediaUrl: [publicUrl],
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: formattedTo
          });
          console.log(`[sendPDFViaWhatsApp] Message sent successfully. SID: ${msg.sid}`);
          return msg;
        }
        // Optional base64 path (not recommended)
        const pdfBuffer = fs.readFileSync(pdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');
        console.log(`[sendPDFViaWhatsApp] Sending as base64 by override`);
        const msg64 = await client.messages.create({
          body: caption,
          mediaUrl: [`data:application/pdf;base64,${pdfBase64}`],
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: formattedTo
        });
        console.log(`[sendPDFViaWhatsApp] Message sent successfully. SID: ${msg64.sid}`);
        return msg64;
    
  } catch (error) {
    console.error(`[sendPDFViaWhatsApp] Error:`, error.message);
    
   
// If we were in base64 mode, still try URL as a last resort
    try {
      const fileName = path.basename(pdfPath);
      const baseUrl = process.env.PUBLIC_URL || `https://${process.env.RAILWAY_SERVICE_NAME}.railway.app`;
      const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
      const publicUrl = `${normalizedBaseUrl}/invoice/${fileName}`;
      console.log(`[sendPDFViaWhatsApp] Trying fallback URL: ${publicUrl}`);
      const fb = await client.messages.create({             
        body: (function () {
                   // COPILOT-PATCH-PDF-CAPTION-001 (fallback path)
                   const bn = fileName.toLowerCase();
                   if (bn.startsWith('inventory_short_')) return 'Here is your inventory table:';
                   if (bn.startsWith('sales_raw_'))      return 'Here is your sales table:';
                   return 'Here is your invoice:';
                 })(),
        mediaUrl: [publicUrl],
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: formattedTo
      });
      console.log(`[sendPDFViaWhatsApp] Fallback message sent. SID: ${fb.sid}`);
      return fb;
    } catch (fallbackError) {
      console.error(`[sendPDFViaWhatsApp] Fallback also failed:`, fallbackError.message);
      throw new Error(`Media send failed. Base64/primary error: ${error.message}, URL fallback error: ${fallbackError.message}`);
    }
  }
}

// === START: AI price extractor ===
async function aiExtractPriceUpdates(text, requestId) {
  try {
    // Strong, constrained instruction: return ONLY JSON we can parse.
    const systemMsg = [
      'You extract product price updates from user text.',
      'Return ONLY a valid JSON array. No markdown, no commentary.',
      'Each element: { "product": string, "price": number }',
      'Rules:',
      '1) Keep product name as user wrote it (same casing/script).',
      '2) Price: convert number-words to a numeric rupee value (e.g., "thirty two" => 32).',
      '3) If multiple items are present (comma/semicolon/and/aur/और/& separators), return each as a separate element.',
      '4) Ignore currency symbols and suffixes (₹, rs., /-).',
      '5) If an item lacks a numeric price, skip it.',
      '6) Do NOT include keys other than "product" and "price".',
    ].join(' ');

    const userMsg = [
      'Text:', text,
      '',
      'Return JSON array only, example:',
      '[ { "product": "milk", "price": 60 }, { "product": "Parle-G", "price": 49.5 } ]'
    ].join('\n');

    const resp = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user',   content: userMsg }
        ],
        temperature: 0.1,
        max_tokens: 200
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 12000
      }
    );

    let content = resp.data?.choices?.[0]?.message?.content?.trim?.() || '';
    // Strip code fences if any
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    }

    const parsed = safeJsonParse(content);
    if (!parsed) {
      console.warn(`[${requestId}] AI price extract: JSON parse failed. Raw:`, content);
      return { success: false, items: [] };
    }

    const array = Array.isArray(parsed) ? parsed : [parsed];
    const cleaned = [];
    for (const row of array) {
      const product = String(row?.product ?? '').trim();
      let price = row?.price;

      // Normalize price if AI returned string
      if (typeof price === 'string') {
        // Remove common symbols/spaces and parse
        const digits = price.replace(/[^\d.,\-]/g, '').replace(/,/g, '');
        price = parseFloat(digits);
      }

      if (product && Number.isFinite(price)) {
        cleaned.push({ product, price: Number(price) });
      }
    }

    return cleaned.length > 0
      ? { success: true, items: cleaned }
      : { success: false, items: [] };
  } catch (err) {
    console.warn(`[${requestId}] AI price extract failed:`, err.message);
    return { success: false, items: [] };
  }
}
// === END: AI price extractor ===


// Add this helper function to split messages
function splitMessage(message, maxLength = 1600) {
  if (message.length <= maxLength) {
    return [message];
  }
  
  const chunks = [];
  let currentChunk = '';
  
  // Split by paragraph breaks first, then by sentence-ending punctuation
  const sentences = message
    .split(/\n{2,}/)                               // paragraphs
    .flatMap(p => p.match(/[^.!?]+[.!?]*/g) || [p]); // sentences (fallback to whole paragraph)

  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length + 1 <= maxLength) {
      currentChunk += sentence + ' ';
    } else {
      // If adding this sentence would exceed the limit, push the current chunk and start a new one
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence + ' ';
      } else {
        // If the sentence itself is longer than maxLength, split by words
        const words = sentence.split(' ');
        for (const word of words) {
          if (currentChunk.length + word.length + 1 <= maxLength) {
            currentChunk += word + ' ';
          } else {
            chunks.push(currentChunk.trim());
            currentChunk = word + ' ';
          }
        }
      }
    }
  }
  
  // Add the last chunk if it has content
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// --- Price updates list (paged) ---
async function sendPriceUpdatesPaged(From, detectedLanguage, requestId, page = 1) {
  const PAGE_SIZE = 25;
  // Pull global backlog of products needing update
  const list = await getProductsNeedingPriceUpdate(); // [{id, name, currentPrice, unit, lastUpdated}, ...]
  const total = list.length;

  let header = `🧾 Price updates needed — ${total} item(s)`;    
  if (total === 0) {
      const msg0 = await t(`${header}\nAll prices look fresh.`, detectedLanguage, requestId);
      return msg0; // let handler send queued + upsell
    }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageSafe = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (pageSafe - 1) * PAGE_SIZE;
  const items = list.slice(start, start + PAGE_SIZE);

  let message = `${header}\nPage ${pageSafe}/${totalPages} — Showing ${items.length} of ${total}\n\n`;
  for (const p of items) {
    const price = Number(p.currentPrice ?? 0);
    const unit = p.unit ?? 'pieces';
    const last = p.lastUpdated ? formatDateForDisplay(p.lastUpdated) : 'never';
    message += `• ${p.name}: ₹${price}/${unit}  (last: ${last})\n`;
  }

  if (pageSafe < totalPages) {
    message += `\n➡️ Next page: "prices ${pageSafe + 1}"`;
  } else if (pageSafe > 1) {
    message += `\n⬅️ Previous page: "prices ${pageSafe - 1}"`;
  }

  
// Multilingual render and return (let handler send & upsell)
  const localized = await t(message.trim(), detectedLanguage, requestId);
  return localized;
}

// Add this helper function for robust JSON parsing
function safeJsonParse(str) {
  try {
    // First try direct JSON parse
    return JSON.parse(str);
  } catch (e) {
    try {
      // Remove any non-JSON content
      const jsonMatch = str.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // Try to fix common JSON issues
      let fixed = str
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // Fix keys without quotes
        .replace(/'/g, '"') // Replace single quotes with double quotes
        .replace(/(\w):(\s*)([^"\d][^,}\]\s]*)/g, '"$1":$2"$3"') // Fix unquoted string values
        .replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas
      
      return JSON.parse(fixed);
    } catch (e2) {
      console.error('JSON parsing failed even after cleanup:', e2.message);
      return null;
    }
  }
}


// Helper: singularize unit labels for nicer prompts (packet vs packets)
function singularize(unit) {
  if (!unit) return unit;
  const map = {
    packets: 'packet',
    boxes: 'box',
    pieces: 'piece',
    liters: 'liter',
    grams: 'gram',
    kgs: 'kg',
    mls: 'ml'
  };
  const u = String(unit).toLowerCase();
  return map[u] || unit.replace(/s$/i, '');
}


// === Robust price & unit helpers (added) ===
// Safe numeric coercion: handles "₹75,000", "75,000.50", etc.
function toNumberSafe(v) {
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const cleaned = String(v).replace(/[^\d.\-]/g, '').replace(/,/g, '');
  const p = parseFloat(cleaned);
  return Number.isFinite(p) ? p : 0;
}

// Unit normalization & simple conversion between common base units
const UNIT_NORMALS = {
  kg:'kg', kilo:'kg', kgs:'kg', kilogram:'kg', kilograms:'kg',
  g:'g', gram:'g', grams:'g',
  l:'l', liter:'l', litre:'l', liters:'l', litres:'l',
  ml:'ml', mls:'ml',
  piece:'piece', pieces:'piece',
  packet:'packet', packets:'packet',
  box:'box', boxes:'box'
};

function unitConvFactor(fromUnit, toUnit) {
  const f = UNIT_NORMALS[String(fromUnit || '').toLowerCase()];
  const t = UNIT_NORMALS[String(toUnit   || '').toLowerCase()];
  if (!f || !t) return 1;
  if (f === 'g'  && t === 'kg') return 1000;     // 1 kg = 1000 g
  if (f === 'kg' && t === 'g')  return 1/1000;
  if (f === 'ml' && t === 'l')  return 1000;     // 1 l  = 1000 ml
  if (f === 'l'  && t === 'ml') return 1/1000;
  return 1; // same or unknown pairs
}

// --- Small helper: build a minimal req-like object for the parser ---
function buildFakeReq(from, body) {
  return { body: { From: from, Body: body } };
}

// --- Unified helper: parse updates or handle a lone "return ..." message ---
async function parseOrReturn(transcript, from, detectedLanguage, requestId) {
  const updates = await parseMultipleUpdates(buildFakeReq(from, transcript),requestId);
  if (updates && updates.length > 0) return updates;
  const didReturn = await tryHandleReturnText(transcript, from, detectedLanguage, requestId);
  if (didReturn) return []; // already handled via API; caller should short-circuit
  return [];
}

// Helper: check if every result is still pending price
function allPendingPrice(results) {
  return Array.isArray(results) && results.length > 0 && results.every(r => r.needsPrice === true);
}

// NEW: aggregate counter that EXCLUDES deferred-price items to avoid “0 of 0”
function renderAggregateCounter(results) {
  const completed = results.filter(r => r.success && !r.deferredPrice);
  const totalCompleted = completed.length;
  const totalTried = results.filter(r => r.error || (r.success && !r.deferredPrice)).length;
  if (totalTried === 0) return ''; // nothing to report yet
  return `✅ Successfully updated ${totalCompleted} of ${totalTried} items`;
}


// Add this with your other helper functions
function isProductMatch(userInput, knownProduct) {
  if (!userInput || !knownProduct) return false;
  
  const normalize = (str) => {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  };
  
  const userNorm = normalize(userInput);
  const knownNorm = normalize(knownProduct);
  
  // 1. Exact match
  if (userNorm === knownNorm) return true;
  
  // 2. Substring match (either contains the other)
  if (userNorm.includes(knownNorm) || knownNorm.includes(userNorm)) return true;
  
  // 3. Word-based matching for multi-word products
  const userWords = userNorm.split(/\s+/).filter(word => word.length > 2);
  const knownWords = knownNorm.split(/\s+/).filter(word => word.length > 2);
  
  if (userWords.length === 0 || knownWords.length === 0) return false;
  
  // Check if any significant word from user input matches known product
  const hasWordMatch = userWords.some(userWord => 
    knownWords.some(knownWord => 
      userWord.includes(knownWord) || knownWord.includes(userWord)
    )
  );
  
  // Additional check: known product words in user input
  const hasReverseMatch = knownWords.some(knownWord =>
    userWords.some(userWord => 
      userWord.includes(knownWord) || knownWord.includes(userWord)
    )
  );
  
  return hasWordMatch || hasReverseMatch;
}

// Add this function near the top of your file (around line 50-60)
function normalize(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/gi, '').trim();
}

// --- IST date helpers ---
function getISTDate(d = new Date()) {
  // Returns a Date shifted to IST by offset math (no tz lib)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(d.getTime() + istOffsetMs);
}

function startEndOfISTDay(d = new Date()) {
  const ist = getISTDate(d);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth(), day = ist.getUTCDate();
  // start in IST:
  const startIST = new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
  const endIST = new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0));
  // Convert back to UTC clock for Airtable comparisons
  return { startUTC: new Date(startIST.getTime() - 5.5*60*60*1000),
           endUTC:   new Date(endIST.getTime() - 5.5*60*60*1000) };
}

function startOfISTWeek(d = new Date()) {
  // Monday start (common retail view)
  const ist = getISTDate(d);
  const day = ist.getUTCDay(); // 0 Sun .. 6 Sat
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const mondayIST = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + diffToMonday));
  // Return in UTC clock
  return new Date(mondayIST.getTime() - 5.5*60*60*1000);
}

function appendInlineGlossary(text, languageCode) {
  const lang = (languageCode || 'en').toLowerCase();
  const glos = {
    en: [
      ['Sales', 'Sales'],
      ['Items', 'Units sold'],
      ['WTD', 'Week-to-date'],
      ['Value', 'Revenue (₹)']
    ],
    hi: [
      ['Sales (बिक्री)', 'Sales'],
      ['Items (यूनिट)', 'Units sold'],
      ['WTD (साप्ताहिक)', 'Week-to-date'],
      ['Value (मूल्य)', 'Revenue (₹)']
    ],
    bn: [
      ['Sales (বিক্রি)', 'Sales'],
      ['Items (ইউনিট)', 'Units sold'],
      ['WTD (সাপ্তাহিক)', 'Week-to-date'],
      ['Value (মূল্য)', 'Revenue (₹)']
    ],
    ta: [
      ['Sales (விற்பனை)', 'Sales'],
      ['Items (அலகுகள்)', 'Units sold'],
      ['WTD (வாரம் வரை)', 'Week-to-date'],
      ['Value (மதிப்பு)', 'Revenue (₹)']
    ],
    te: [
      ['Sales (అమ్మకాలు)', 'Sales'],
      ['Items (యూనిట్లు)', 'Units sold'],
      ['WTD (వారం-వరకు)', 'Week-to-date'],
      ['Value (విలువ)', 'Revenue (₹)']
    ],
    kn: [
      ['Sales (ಮಾರಾಟ)', 'Sales'],
      ['Items (ಘಟಕಗಳು)', 'Units sold'],
      ['WTD (ವಾರದಿಂದ)', 'Week-to-date'],
      ['Value (ಮೌಲ್ಯ)', 'Revenue (₹)']
    ],
    mr: [
      ['Sales (विक्री)', 'Sales'],
      ['Items (युनिट)', 'Units sold'],
      ['WTD (आठवडा-ते-तारीख)', 'Week-to-date'],
      ['Value (मूल्य)', 'Revenue (₹)']
    ],
    gu: [
      ['Sales (વેચાણ)', 'Sales'],
      ['Items (એકમ)', 'Units sold'],
      ['WTD (અઠવાડિયા સુધી)', 'Week-to-date'],
      ['Value (કિંમત)', 'Revenue (₹)']
    ]
  };
  const list = glos[lang] || glos['en'];
  const lines = list.map(([k, v]) => `• ${k} = ${v}`).join('\n');
  return `${text}\n📘 Glossary:\n${lines}`;
}


// Add these functions after the existing helper functions

// Generate instant summary (concise, <300 words)
async function generateInstantSummary(shopId, languageCode, requestId) {    
// -- Activation gate: block only users who haven't started trial/paid
  try {
    const planInfo = await getUserPlan(shopId);
    const plan = String(planInfo?.plan ?? '').toLowerCase();
    const activated = (plan === 'trial' || plan === 'paid');
    if (!activated) {
      // Localized prompt to activate trial; no enterprise wording
      const prompt = 'To use summaries, please activate your FREE trial.\nReply "Start Trial" or tap the trial button.';
      return await t(prompt, languageCode, requestId);
    }
  } catch (_e) {
    // If plan lookup fails, be conservative and prompt to activate
    const prompt = 'To use summaries, please activate your FREE trial.\nReply "Start Trial" or tap the trial button.';
    return await t(prompt, languageCode, requestId);
  }
    try {
      console.log(`[${requestId}] Generating instant summary for shop ${shopId}`);
  
      // --- Today / Yesterday windows in IST (converted for Airtable queries)
      const { startUTC: todayStart, endUTC: todayEnd } = startEndOfISTDay(new Date());
      const { startUTC: yStart, endUTC: yEnd } = (() => {
        const d = new Date(); d.setDate(d.getDate() - 1);
        return startEndOfISTDay(d);
      })();
      const weekStartUTC = startOfISTWeek(new Date());
  
      // --- Data pulls
      const todaySales = await getTodaySalesSummary(shopId); // today
      const ySales = await getSalesDataForPeriod(shopId, yStart, yEnd); // yesterday
      const wtdSales = await getSalesDataForPeriod(shopId, weekStartUTC, new Date()); // week-to-date
      const inventorySummary = await getInventorySummary(shopId);
      const lowStockProducts = await getLowStockProducts(shopId, 5);
      const expiringProducts = await getExpiringProducts(shopId, 7, { strictExpired: false });
  
      // --- Compute deltas
      const tItems = todaySales?.totalItems ?? 0;
      const tValue = todaySales?.totalValue ?? 0;
      const yItems = ySales?.totalItems ?? 0;
      const yValue = ySales?.totalValue ?? 0;
      const wItems = wtdSales?.totalItems ?? 0;
      const wValue = wtdSales?.totalValue ?? 0;
  
      const dItems = tItems - yItems;
      const dValue = tValue - yValue;
  
      const sign = (n) => n > 0 ? `+${n}` : (n < 0 ? `${n}` : '—');
      const money = (n) => (n ?? 0) > 0 ? `₹${(n).toFixed(2)}` : '—';
  
      // --- Top movers today (top 3)
      const topToday = (todaySales?.topProducts ?? []).slice(0, 3);
      const topLines = topToday.length
        ? topToday.map(p => `• ${p.name}: ${p.quantity} ${p.unit}`).join('\n')
        : '—';
  
      // --- Build summary (English base; will be Nativeglish later)
      let summary = `📊 Short Summary (${formatDateForDisplay(new Date())})\n\n`;
      summary += `💰 Sales Today: ${tItems} items (${money(tValue)})\n`;
      summary += `↕︎ vs Yesterday: ${sign(dItems)} items (${sign(dValue === 0 ? 0 : dValue)} value)\n`;
      summary += `🗓 WTD: ${wItems} items (${money(wValue)})\n`;
  
      summary += `\n🏆 Top Movers Today:\n${topLines}\n`;
  
      // Inventory quick stats (if meaningful)
      if ((inventorySummary?.totalProducts ?? 0) > 0) {
        const invVal = inventorySummary?.totalValue ?? 0;
        summary += `\n📦 Inventory: ${inventorySummary.totalProducts} unique products (Value ~ ${money(invVal)})\n`;
      }
  
      // Low stock
      if (lowStockProducts.length > 0) {
        summary += `\n⚠️ Low Stock (≤5):\n`;
        summary += lowStockProducts.map(p => `• ${p.name}: ${p.quantity} ${p.unit}`).join('\n') + '\n';
      }
      // Expiring
      if (expiringProducts.length > 0) {
        summary += `\n⏰ Expiring Soon (≤7d):\n`;
        summary += expiringProducts.map(p => `• ${p.name}: ${formatDateForDisplay(p.expiryDate)} (qty ${p.quantity})`).join('\n') + '\n';
      }
  
      // --- Action CTAs (commands your router already supports)
      summary += `\n👉 Next actions:\n`;
      summary += `• low stock   • reorder   • expiring 7\n`;
      summary += `• prices      • inventory value\n`;
  
      // --- Inline Glossary (tiny, language-aware)
      summary = appendInlineGlossary(summary, languageCode);
  
      // --- Nativeglish render (single block)
      return renderNativeglishLabels(summary, languageCode);
    } catch (error) {
      console.error(`[${requestId}] Error generating instant summary:`, error.message);
      const errorMessage = `Sorry, I couldn't generate your summary right now. Please try again later.`;
      return renderNativeglishLabels(errorMessage, languageCode);
    }
  }


// Generate full-scale summary (detailed with AI insights)
async function generateFullScaleSummary(shopId, languageCode, requestId) {  
// -- Activation gate: block only users who haven't started trial/paid
  try {
    const planInfo = await getUserPlan(shopId);
    const plan = String(planInfo?.plan ?? '').toLowerCase();
    const activated = (plan === 'trial' || plan === 'paid');
    if (!activated) {
      // Localized prompt to activate trial; no enterprise wording
      const prompt = 'To use full summaries, please activate your FREE trial.\nReply "Start Trial" or tap the trial button.';
      return await t(prompt, languageCode, requestId);
    }
  } catch (_e) {
    // If plan lookup fails, be conservative and prompt to activate
    const prompt = 'To use full summaries, please activate your FREE trial.\nReply "Start Trial" or tap the trial button.';
    return await t(prompt, languageCode, requestId);
  }
  try {    
    console.log(`[${requestId}] Generating full-scale summary for shop ${shopId}`);
    
    // Get 30-day sales data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const salesData = await getSalesDataForPeriod(shopId, thirtyDaysAgo, new Date());
    // Get purchase data
    const purchaseData = await getPurchaseDataForPeriod(shopId, thirtyDaysAgo, new Date());
    // Get inventory summary
    const inventorySummary = await getInventorySummary(shopId);
    // Get low stock products
    const lowStockProducts = await getLowStockProducts(shopId, 5);
    // Get expiring products
    const expiringProducts = await getExpiringProducts(shopId, 7, { strictExpired: false });
    
    // Prepare data for AI analysis
    const contextData = {
      salesData,
      purchaseData,
      inventorySummary,
      lowStockProducts,
      expiringProducts,
      period: "30 days"
    };
                
    // Prefer AI insights; if service/key unavailable, higher-level catch will fallback
        const insights = await generateSummaryInsights(contextData, languageCode, requestId);
        return insights; // Nativeglish text

  } catch (error) {
    console.error(`[${requestId}] Error generating full-scale summary:`, error.message);    
    
    // Robust fallback: return a deterministic, data-backed summary (no plan/enterprise wording)
        try {
          return await generateInstantSummary(shopId, languageCode, requestId);
        } catch (_fallbackErr) {
          const errorMessage = `Sorry, I couldn't generate your detailed summary right now. Please try again later.`;
          return await t(errorMessage, languageCode, requestId);
        }
  }
}

// Generate AI-powered insights for full summary
async function generateSummaryInsights(data, languageCode, requestId) {
  const maxRetries = 3;
  let lastError;
  
  // Validate configuration
  try {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error('DEEPSEEK_API_KEY environment variable is not set');
    }
    console.log(`[${requestId}] DEEPSEEK_API_KEY is set, length: ${process.env.DEEPSEEK_API_KEY.length}`);
  } catch (error) {
    console.error(`[${requestId}] Configuration error:`, error.message);
    return generateFallbackSummary(data, languageCode, requestId);
  }

  // Get language name for Nativeglish
  const nativeLanguage = languageNames[languageCode] || languageCode;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let timeoutId;
    try {
      console.log(`[${requestId}] AI API call attempt ${attempt}/${maxRetries}`);
      
      // Limit the amount of data sent to prevent oversized requests
      const topSalesLimit = 5;
      const lowStockLimit = 5;
      const expiringLimit = 5;
      
      // Prepare a more concise prompt
      const prompt = `You are an inventory analysis assistant. Analyze the following shop data and provide insights in Native language (${nativeLanguage}) - ensure response is formal and respectful. Respond ONLY in one script: if Hindi, use Devanagari; if Hinglish, use Roman Hindi (hi-Latn). Do NOT mix native and Roman in the same message. Keep brand names unchanged. Also, add emoticons wherever required to make it more presentable.
      Sales Data (last 30 days):
      - Total items sold: ${data.salesData.totalItems || 0}
      - Total sales value: ₹${(data.salesData.totalValue || 0).toFixed(2)}
      - Top selling products: ${data.salesData.topProducts ? 
          data.salesData.topProducts.slice(0, topSalesLimit).map(p => `${p.name} (${p.quantity} ${p.unit})`).join(', ') : 'None'}
      Purchase Data (last 30 days):
      - Total items purchased: ${data.purchaseData.totalItems || 0}
      - Total purchase value: ₹${(data.purchaseData.totalValue || 0).toFixed(2)}
      - Most purchased products: ${data.purchaseData.topProducts ? 
          data.purchaseData.topProducts.slice(0, topSalesLimit).map(p => `${p.name} (${p.quantity} ${p.unit})`).join(', ') : 'None'}
      Current Inventory:
      - Total unique products: ${data.inventorySummary.totalProducts || 0}
      - Total inventory value: ₹${(data.inventorySummary.totalValue || 0).toFixed(2)}
      Low Stock Products:
      ${data.lowStockProducts.length > 0 ? 
          data.lowStockProducts.slice(0, lowStockLimit).map(p => `- ${p.name}: ${p.quantity} ${p.unit} left`).join('\n') : 'None'}
      Expiring Products (next 7 days):
      ${data.expiringProducts.length > 0 ? 
          data.expiringProducts.slice(0, expiringLimit).map(p => `- ${p.name}: Expires on ${formatDateForDisplay(p.expiryDate)}`).join('\n') : 'None'}
      Provide a comprehensive analysis with:
      1. Sales trends and patterns
      2. Inventory performance
      3. Recommendations for restocking
      4. Suggestions for reducing waste
      5. Actionable insights for business growth
      Format your response in Nativeglish (${nativeLanguage} + English mix) that is easy to understand for local shop owners. Keep the response under 500 words and focus on actionable insights. Respond ONLY in one script: if Hindi, use Devanagari; if Hinglish, use Roman Hindi (hi-Latn). Do NOT mix native and Roman in the same message. Keep brand names unchanged.`;
      
      console.log(`[${requestId}] Prompt length: ${prompt.length} characters`);
      console.log(`[${requestId}] Making API request to Deepseek...`);
        
        // Add input validation
        if (!data || typeof data !== 'object') {
          throw new Error('Invalid data format provided to AI');
        }
        
        const response = await axios.post(
          'https://api.deepseek.com/v1/chat/completions',
          {
            model: "deepseek-chat",
            messages: [
              {
                role: "system",
                content: `You are an expert inventory analyst providing concise, actionable insights for small business owners. Your response should be in Native language (${nativeLanguage}) for better readability but should be formal and respectful. Keep your response under 1500 characters. Respond ONLY in one script: if Hindi, use Devanagari; if Hinglish, use Roman Hindi (hi-Latn). Do NOT mix native and Roman in the same message. Keep brand names unchanged. Also, add emoticons wherever required to make it more presentable.`
              },
              {
                role: "user",
                content: prompt
              }
            ],
            max_tokens: 800,
            temperature: 0.5
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 60000
          }
        );
        
        // Validate response
        if (!response.data || !response.data.choices || !response.data.choices[0]) {
          throw new Error('Invalid AI response structure');
        }
        
        let insights = response.data.choices[0].message.content.trim();
        
        // Additional validation
        if (!insights || insights.length < 10) {
          throw new Error('AI response too short or empty');
        }
        
        // Minimal post-processing - just clean up formatting
        insights = insights.replace(/\n\s*\n\s*\n/g, '\n\n');
        insights = insights.replace(/^\s+|\s+$/g, '');
        
        console.log(`[${requestId}] Successfully generated insights, length: ${insights.length}`);
        return insights;
        
      } catch (error) {
        lastError = error;
        console.warn(`[${requestId}] AI API call attempt ${attempt} failed:`, error.message);
        
        // Enhanced error logging
        if (error.response) {
          console.error(`[${requestId}] API response status:`, error.response.status);
          console.error(`[${requestId}] API response data:`, error.response.data);
        }
        
        // More specific error handling
        if (error.code === 'ECONNABORTED') {
          console.error(`[${requestId}] Request timeout - AI service took too long to respond`);
        } else if (error.response?.status === 429) {
          console.error(`[${requestId}] Rate limit exceeded for AI service`);
        } else if (error.response?.status >= 500) {
          console.error(`[${requestId}] AI service server error`);
        }
        
        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          break;
        }
        
        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[${requestId}] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
  }
  
  // If all retries failed, use fallback
  console.error(`[${requestId}] All AI API attempts failed, using fallback`);
  console.error(`[${requestId}] Last error:`, lastError.message);
  return generateFallbackSummary(data, languageCode, requestId);
}

function generateFallbackSummary(data, languageCode, requestId) {
  console.log(`[${requestId}] Generating fallback summary for ${languageCode}`);
  
  let fallbackSummary = `📊 30-Day Business Summary:\n\n`;
  fallbackSummary += `💰 Sales: ${data.salesData.totalItems || 0} items (₹${(data.salesData.totalValue || 0).toFixed(2)})\n`;
  fallbackSummary += `📦 Purchases: ${data.purchaseData.totalItems || 0} items (₹${(data.purchaseData.totalValue || 0).toFixed(2)})\n`;
  fallbackSummary += `📋 Inventory: ${data.inventorySummary.totalProducts || 0} unique products (₹${(data.inventorySummary.totalValue || 0).toFixed(2)})\n`;
  
  if (data.lowStockProducts.length > 0) {
    fallbackSummary += `\n⚠️ Low Stock: ${data.lowStockProducts.length} products need restocking\n`;
    // Add top 3 low stock products
    data.lowStockProducts.slice(0, 3).forEach(product => {
      fallbackSummary += `• ${product.name}: Only ${product.quantity} ${product.unit} left\n`;
    });
  }
  
  if (data.expiringProducts.length > 0) {
    fallbackSummary += `\n⏰ Expiring Soon: ${data.expiringProducts.length} products\n`;
    // Add top 3 expiring products
    data.expiringProducts.slice(0, 3).forEach(product => {
      fallbackSummary += `• ${product.name}: Expires on ${formatDateForDisplay(product.expiryDate)}\n`;
    });
  }
  
  // Add top-selling products if available
  if (data.salesData.topProducts && data.salesData.topProducts.length > 0) {
    fallbackSummary += `\n🏆 Top Sellers:\n`;
    data.salesData.topProducts.slice(0, 3).forEach(product => {
      fallbackSummary += `• ${product.name}: ${product.quantity} ${product.unit}\n`;
    });
  }
  
  fallbackSummary += `\n💡 Consider reviewing your sales patterns and inventory turnover for better business decisions.`;
  
  console.log(`[${requestId}] Fallback summary generated, length: ${fallbackSummary.length}`);
  return t(fallbackSummary, languageCode, requestId);
}

// Add a new command handler for plan upgrades
async function handlePlanUpgrade(Body, From, detectedLanguage, requestId) {
  const shopId = From.replace('whatsapp:', '');
  
  // Simple command to upgrade to standard plan
  if (Body.toLowerCase().includes('upgrade to standard')) {
    await saveUserPlan(shopId, 'standard');
    const message = await t(
      'You have been upgraded to the Standard plan. You now have access to all standard features.',
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, message);
    return true;
  }
  
  // Command to upgrade to enterprise plan
  if (Body.toLowerCase().includes('upgrade to enterprise')) {
    await saveUserPlan(shopId, 'enterprise');    
    let message = await t(
      'You have been upgraded to the Enterprise plan. You now have access to all features including advanced AI analytics.',
      detectedLanguage,
      requestId
    );
    // ANCHOR: UNIQ:ENTERPRISE-UPGRADE-ACK-001
    await sendMessageViaAPI(From, finalizeForSend(message, detectedLanguage));
    return true;
  }
  
  return false;
}


// Add this function after the existing helper functions

// Create interactive button menu
async function createSummaryMenu(from, languageCode, requestId) {
  try {
    // Get user's preferred language
    let userLanguage = languageCode;
    
    // Menu options in different languages
    const menuOptions = {
      'hi': {
        instant: 'तत्काल सारांश',
        full: 'विस्तृत सारांश',
        instructions: 'कृपया एक विकल्प चुनें:'
      },
      'bn': {
        instant: 'তাত্ক্ষণিক সারসংক্ষেপ',
        full: 'বিস্তারিত সারসংক্ষেপ',
        instructions: 'অনুগ্রহ করে একটি বিকল্প নির্বাচন করুন:'
      },
      'ta': {
        instant: 'உடனடிச் சுருக்கம்',
        full: 'விரிவான சுருக்கம்',
        instructions: 'தயவுசெய்து ஒரு விருப்பத்தைத் தேர்ந்தெடுங்கள்:'
      },
      'te': {
        instant: 'తక్షణ సారాంశం',
        full: 'వివరణాత్మక సారాంశం',
        instructions: 'దయచేసి ఒక ఎంపికను ఎంచుకోండి:'
      },
      'kn': {
        instant: 'ತಕ್ಷಣ ಸಾರಾಂಶ',
        full: 'ವಿಸ್ತೃತ ಸಾರಾಂಶ',
        instructions: 'ದಯವಿಟ್ಟು ಒಂದು ಆಯ್ಕೆಯನ್ನು ಆರಿಸಿ:'
      },
      'gu': {
        instant: 'તાત્કાલિક સારાંશ',
        full: 'વિગતવાર સારાંશ',
        instructions: 'કૃપા કરીને એક વિકલ્પ પસંદ કરો:'
      },
      'mr': {
        instant: 'त्वरित सारांश',
        full: 'तपशीलवार सारांश',
        instructions: 'कृपया एक पर्याय निवडा:'
      },
      'en': {
        instant: 'Short Summary',
        full: 'Full Summary',
        instructions: 'Please select an option:'
      }
    };
    
    // Get options for user's language, fallback to English
    const options = menuOptions[userLanguage] || menuOptions['en'];
    
    // Create menu message
    let menuMessage = `📊 ${options.instructions}\n\n`;
    menuMessage += `1️⃣ ${options.instant}\n`;
    menuMessage += `2️⃣ ${options.full}\n\n`;
    menuMessage += `You can also type "short summary" or "full summary".`;
    
    // Generate multilingual response
    const formattedMessage = await t(menuMessage, userLanguage, requestId);
    
    // Create button message
    const twiml = new twilio.twiml.MessagingResponse();
    const messageObj = twiml.message();
    messageObj.body(formattedMessage);
    
    // Add interactive buttons
    const buttonsObj = messageObj.buttons();
    buttonsObj.button({
      action: {
        type: 'reply',
        reply: {
          id: 'instant_summary',
          title: options.instant
        }
      }
    });
    buttonsObj.button({
      action: {
        type: 'reply',
        reply: {
          id: 'full_summary',
          title: options.full
        }
      }
    });
    
    return twiml.toString();
  } catch (error) {
    console.error(`[${requestId}] Error creating summary menu:`, error.message);
    
    // Fallback to text menu
    const fallbackMessage = `📊 Please select an option:\n\n1. Instant Summary\n2. Detailed Summary\n\nYou can also type "summary" for instant or "full summary" for detailed.`;
    return await t(fallbackMessage, languageCode, requestId);
  }
}

// Handle price update command
// === START: handlePriceUpdate (PASTE-REPLACE) ===
async function handlePriceUpdate(Body, From, detectedLanguage, requestId) {
  const shopId = From.replace('whatsapp:', '');

  // Drop the prefix for AI & fallback parsing
  const userText = Body.replace(/^\s*(update\s+price|price\s+update)\s*/iu, '').trim();

  // 0) Try AI first (handles words, multiple items, mixed separators & scripts)
  const ai = await aiExtractPriceUpdates(userText, requestId);
  if (ai.success && ai.items.length > 0) {
    const results = await applyPriceUpdates(ai.items, shopId, detectedLanguage, requestId);
    await sendMessageViaAPI(From, results.message);
    return;
  }

  // 1) Fallback: deterministic end-anchored numeric-only parser
  //    (still supports multiple items, separators, ₹/rs, /-)
  const BULK_SPLIT = /(?:[,;]|(?:\s+(?:and|aur|और)\s+)|\s*&\s*)+/iu;
  const PRICE_AT_END =
    /(?:[:=\-–—]\s*)?(?:₹\s*|rs\.?\s*)?(?<int>\d{1,3}(?:,\d{3})*|\d+)(?:\.(?<frac>\d{1,2}))?(?:\s*\/-?)?\s*$/iu;

  function parseSegment(seg) {
    if (!seg) return null;
    const m = seg.match(PRICE_AT_END);
    if (!m) return null;

    let product = seg.slice(0, m.index)
      .replace(/\s+$/u, '')
      .replace(/[:=\-–—]\s*$/u, '')
      .trim()
      .replace(/\s+/g, ' ');

    const intPart = (m.groups.int || '').replace(/,/g, '');
    const fracPart = m.groups.frac ? `.${m.groups.frac}` : '';
    const price = parseFloat(intPart + fracPart);

    if (!product || Number.isNaN(price)) return null;
    return { product, price };
  }

  // Decide single vs bulk based on separators
  const looksBulk = BULK_SPLIT.test(userText);
  if (!looksBulk) {
    const single = parseSegment(userText);
    if (single) {
      const results = await applyPriceUpdates([single], shopId, detectedLanguage, requestId);
      await sendMessageViaAPI(From, results.message);
      return;
    }
  }

  const segments = userText
    .split(BULK_SPLIT)
    .map(s => s.trim())
    .filter(Boolean);

  if (segments.length > 1) {
    const pairs = segments.map(parseSegment).filter(Boolean);
    if (pairs.length > 0) {
      const results = await applyPriceUpdates(pairs, shopId, detectedLanguage, requestId);
      await sendMessageViaAPI(From, results.message);
      return;
    }
  }

  // 2) If neither AI nor fallback parsed anything
  const errorMessage =
    'Invalid format. Use:\n' +
    '• Single: "update price milk 60"\n' +
    '• Multiple: "update price milk 60, sugar 30, Parle-G 50"\n' +
    '  (You can also separate with: and / aur / और / & / ;)\n' +
    'You may also say prices in words (e.g., "milk sixty two") — I will convert them.';
  const formatted = await t(errorMessage, detectedLanguage, requestId);
  await sendMessageViaAPI(From, formatted);
}

// Helper that applies updates and builds a localized summary
async function applyPriceUpdates(items, shopId, detectedLanguage, requestId) {
  try {
    const allProducts = await getAllProducts();
    const map = new Map(allProducts.map(p => [p.name.toLowerCase(), p]));

    const lines = [];
    let updated = 0, created = 0, failed = 0;

    for (const { product, price } of items) {
      try {
        const key = product.toLowerCase();
        const existing = map.get(key);
        if (existing) {
          const res = await updateProductPrice(existing.id, price);
          if (res.success) {
            updated++;
            lines.push(`• ${product}: ₹${price} — ✅ updated`);
          } else {
            failed++;
            lines.push(`• ${product}: ₹${price} — ❌ ${res.error || 'update failed'}`);
          }
        } else {
          const res = await upsertProduct({ name: product, price, unit: 'pieces' });
          if (res.success) {
            created++;
            map.set(key, { id: res.id, name: product, price });
            lines.push(`• ${product}: ₹${price} — ✅ created`);
          } else {
            failed++;
            lines.push(`• ${product}: ₹${price} — ❌ ${res.error || 'create failed'}`);
          }
        }
      } catch (err) {
        failed++;
        lines.push(`• ${product}: ₹${price} — ❌ ${err.message}`);
      }
    }
    
    const header = chooseHeader(lines.length, COMPACT_MODE, /* isPrice */ true);
        let summary = header + (COMPACT_MODE
          ? (lines.length ? lines.join('\n') : '—')
          : (lines.length ? lines.join('\n') : 'No valid items found.'));
        if (!COMPACT_MODE) {
          summary += `\n\nUpdated: ${updated} • Created: ${created} • Failed: ${failed}`;
        }

    const formatted = await t(summary, detectedLanguage, requestId);
    return { message: formatted };
  } catch (err) {
    console.error(`[${requestId}] applyPriceUpdates error:`, err.message);
    const fallback = await t(
      'System error while applying price updates. Please try again.',
      detectedLanguage,
      requestId
    );
    return { message: fallback };
  }
}
// === END: handlePriceUpdate ===






// Send price list to user
async function sendPriceList(From, detectedLanguage, requestId) {
  try {
    const products = await getAllProducts();
    
    if (products.length === 0) {
      const noProductsMessage = 'No products found in price list.';
      const formattedMessage = await t(noProductsMessage, detectedLanguage, requestId);
      await sendMessageViaAPI(From, formattedMessage);
      return;
    }
    
    let message = '📋 Current Price List:\n\n';
    products.forEach(product => {
      message += `• ${product.name}: ₹${product.price}/${product.unit}\n`;
    });
    
    const formattedMessage = await t(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, formattedMessage);
  } catch (error) {
    console.error(`[${requestId}] Error sending price list:`, error.message);
    const errorMessage = 'Error fetching price list. Please try again.';
    const formattedMessage = await t(errorMessage, detectedLanguage, requestId);
    await sendMessageViaAPI(From, formattedMessage);
  }
}

// Schedule daily price update reminder at 8 AM
function schedulePriceUpdateReminder() {
  const now = new Date();
  const targetTime = new Date();
  
  // Set to 8 AM IST (2:30 UTC)
  targetTime.setUTCHours(2, 30, 0, 0);
  
  // If we've passed 2:30 UTC today, schedule for tomorrow
  if (now > targetTime) {
    targetTime.setUTCDate(targetTime.getUTCDate() + 1);
  }
  
  const msUntilTarget = targetTime - now;
  
  console.log(`Scheduling price update reminder for ${targetTime.toISOString()} (in ${msUntilTarget}ms)`);
  
  setTimeout(() => {
    sendPriceUpdateReminders()
      .then(() => {
        // Schedule for next day
        schedulePriceUpdateReminder();
      })
      .catch(error => {
        console.error('Price update reminder job failed:', error.message);
        // Retry in 1 hour
        setTimeout(schedulePriceUpdateReminder, 60 * 60 * 1000);
      });
  }, msUntilTarget);
}

// Send price update reminders to all shops
async function sendPriceUpdateReminders() {
  try {
    console.log('Starting price update reminder job...');
    
    // Get all shop IDs
    const shopIds = await getAllShopIDs();
    console.log(`Found ${shopIds.length} shops to process`);
    
    if (shopIds.length === 0) {
      console.log('No shops found to process');
      return;
    }
    
    // Get products needing price updates
    const productsNeedingUpdate = await getProductsNeedingPriceUpdate();
    console.log(`Found ${productsNeedingUpdate.length} products needing price updates`);
    
    if (productsNeedingUpdate.length === 0) {
      console.log('No products need price updates');
      return;
    }
    
    // Process shops with concurrency limit
    const concurrencyLimit = 5;
    const results = [];
    
    for (let i = 0; i < shopIds.length; i += concurrencyLimit) {
      const batch = shopIds.slice(i, i + concurrencyLimit);
      console.log(`Processing batch of ${batch.length} shops (${i + 1}-${i + batch.length} of ${shopIds.length})`);
      
      const batchPromises = batch.map(async (shopId) => {
        try {
          // Get user's preferred language
          let userLanguage = 'en';
          try {
            const userPref = await getUserPreference(shopId);
            if (userPref.success) {
              userLanguage = userPref.language;
            }
          } catch (error) {
            console.warn(`Failed to get user preference for shop ${shopId}:`, error.message);
          }
          
          // Create reminder message
          let message = '📢 Daily Price Update Reminder\n\n';
          message += 'Please check if prices have changed for any of these items:\n\n';
          
          // List first 5 products needing update
          productsNeedingUpdate.slice(0, 5).forEach(product => {
            message += `• ${product.name}: Currently ₹${product.currentPrice}/${product.unit}\n`;
          });
          
          if (productsNeedingUpdate.length > 5) {
            message += `\n... and ${productsNeedingUpdate.length - 5} more items`;
          }
          
          message += '\n\nTo update prices, reply with:\n';
          message += '"update price [product_name] [new_price]"\n\n';
          message += 'Example: "update price milk 60"\n\n';
          message += 'To check all products requiring price update, reply with:\n';
          message += '"prices"';
          
          const formattedMessage = await t(message, userLanguage, 'price-reminder');
          
          // Send reminder
          await sendMessageViaAPI(`whatsapp:${shopId}`, formattedMessage);
          
          return { shopId, success: true };
          
        } catch (error) {
          console.error(`Error processing shop ${shopId}:`, error.message);
          return { shopId, success: false, error: error.message };
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error('Unexpected error in batch processing:', result.reason);
        }
      }
      
      // Add a small delay between batches to avoid rate limiting
      if (i + concurrencyLimit < shopIds.length) {
        console.log('Pausing between batches to avoid rate limiting...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Calculate success statistics
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    console.log(`Price update reminder job completed: ${successCount} sent, ${failureCount} failed`);
    
    return results;
  } catch (error) {
    console.error('Error in price update reminder job:', error.message);
    throw error;
  }
}

// ================================
// (Optional) Customer Return fallback (regex-based)
// ================================
async function tryHandleReturnText(transcript, from, detectedLanguage, requestId) {
  const text = String(transcript ?? '').trim();
  // Pattern A: "return <product> <qty> <unit>"
  let m1 = text.match(/^(?:customer\s+)?returns?\s+(.+?)\s+(\d+(?:\.\d+)?)\s+([A-Za-z\u0900-\u097F\u0A80-\u0AFF\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF]+)$/i);
  // Pattern B: "return <qty> <unit> <product>"
  let m2 = text.match(/^(?:customer\s+)?returns?\s+(\d+(?:\.\d+)?)\s+([A-Za-z\u0900-\u097F\u0A80-\u0AFF\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF]+)\s+(.+)$/i);
  if (!m1 && !m2) return false;
  const shopId = from.replace('whatsapp:', '');
  const qty  = Number(m1 ? m1[2] : m2[1]);
  const unit = (m1 ? m1[3] : m2[2]).trim();
  const raw  = (m1 ? m1[1] : m2[3]).trim();
  const product = await translateProductName(raw, requestId + ':return-text');
  const result = await updateInventory(shopId, product, Math.abs(qty), unit);
  let message = `↩️ Return processed — ${product}: +${qty} ${unit}`;
  if (result?.success) {
    const u = result.unit ?? unit;
    message += ` (Stock: ${result.newQuantity} ${u})`;
  }
  const msg = await t(message, detectedLanguage, requestId);
  await sendMessageViaAPI(from, msg);
  return true;
}

  
// Start the scheduler when the module loads
schedulePriceUpdateReminder();

// Function to process confirmed transcription
async function processConfirmedTranscription(transcript, from, detectedLanguage, requestId, response, res) {
  const startTime = Date.now();
    
      try { 
    
    // --- NEW: global reset (works in any context) ---
        if (isResetMessage(transcript)) {
          try { await clearUserState(shopId); } catch (_) {}
          await sendSystemMessage(`✅ Reset. I’ve cleared any active steps.`, from, detectedLanguage, requestId, response);
          handledRequests.add(requestId);
          return res.send(response.toString());
        }
    

    // --- HARD GUARD: treat summary phrases as commands, not inventory updates
    const shopId = from.replace('whatsapp:', '');
    const intent = resolveSummaryIntent(transcript);        
    if (intent === 'short summary') {
      await handleQuickQueryEN(
        'short summary',
        from,
        _safeLang(orch?.language, detectedLanguage, 'en'),
        `${requestId}::voice-summary`
      );
      handledRequests.add(requestId);
      response.message('✅ Short summary sent.');
      return res.send(response.toString());
    }
    if (intent === 'full summary') {
      await handleQuickQueryEN(
        'full summary',
        from,
        _safeLang(orch?.language, detectedLanguage, 'en'),
        `${requestId}::voice-summary`
      );
      handledRequests.add(requestId);
      response.message('✅ Full summary sent.');
      return res.send(response.toString());
    }
        
    // ===== EARLY EXIT: AI orchestrator on confirmed transcript =====
      try {
        const orch = await applyAIOrchestration(transcript, from, detectedLanguage, requestId);
        const langExact = ensureLangExact(orch.language ?? detectedLanguage ?? 'en');
        
        // [SALES-QA-IDENTITY-ROUTER] short-circuit identity questions
          if (orch.identityAsked === true) {
            handledRequests.add(requestId);
            const idLine = identityTextByLanguage(langExact); // Saamagrii.AI stays Latin; "friend" localized
            const tagged = await tagWithLocalizedMode(From, idLine, langExact);
            await sendMessageViaAPI(From, finalizeForSend(tagged, langExact));
            return;
          }

        if (orch.isQuestion === true || orch.kind === 'question') {
          handledRequests.add(requestId);
          const ans = await composeAISalesAnswer(shopId, transcript, langExact);
          const msg = await t(ans, langExact, `${requestId}::sales-qa-confirmed`);
          await sendMessageViaAPI(from, msg);                    
          try {                          
                const buttonLang = langPinned.includes('-latn') ? langPinned.split('-')[0] : langPinned;
                await sendSalesQAButtons(From, buttonLang, isActivated);
                } catch (e) {
                  console.warn(`[${requestId}] qa-buttons send failed:`, e?.message);
                }
          return res.send(response.toString());
        }
        if (orch.normalizedCommand) {
          handledRequests.add(requestId);
          await routeQuickQueryRaw(orch.normalizedCommand, from, langExact, `${requestId}::ai-norm-confirmed`);
          return res.send(response.toString());
        }
      } catch (e) {
        console.warn(`[${requestId}] orchestrator (confirmed) early-exit error:`, e?.message);
        // fall through gracefully
      }
          
    console.log(`[${requestId}] [6] Parsing updates using AI...`);
      const updates = await parseOrReturn(transcript, from, detectedLanguage, requestId);
      if (!Array.isArray(updates) || updates.length === 0) {
        handledRequests.add(requestId);
        return res.send(response.toString()); // "return ..." case already replied
      }

    console.log(`[${requestId}] [7] Testing Airtable connection...`);
    const connectionTest = await testConnection();
    if (!connectionTest) {
      console.error(`[${requestId}] Airtable connection failed`);
      await sendSystemMessage(
        'Database connection error. Please try again later.',
        from,
        detectedLanguage,
        requestId,
        response
      );
      handledRequests.add(requestId);
      return res.send(response.toString());
    }
    console.log(`[${requestId}] [8] Updating inventory for ${updates.length} items...`);
    const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
    
      if (allPendingPrice(results)) {
        try {              
        const shopIdLocal = String(from ?? '').replace('whatsapp:', '');
        await setUserState(shopIdLocal, 'correction', {
            correctionState: {
              correctionType: 'price',
              pendingUpdate: results[0],
              detectedLanguage,
              id: results[0]?.correctionId
            }
          });
        } catch (_) {}
        // Price prompt already sent; do not send "Updates processed".
        handledRequests.add(requestId);
        return res.send(response.toString());
      }
    
    // NEW: short-circuit when unified price+expiry flow is pending for all items
      const allPendingUnified =
        Array.isArray(results) &&
        results.length > 0 &&
        results.every(r => r?.awaiting === 'price+expiry' || r?.needsUserInput === true);
      if (allPendingUnified) {
        // The unified prompt was already sent from updateMultipleInventory(); just ACK Twilio
        handledRequests.add(requestId);
        return res.send(response.toString());
      }

// Get user's preferred language for the response
     let userLanguage = detectedLanguage;
     try {
       const userPref = await getUserPreference(shopId);
       if (userPref.success) {
         userLanguage = userPref.language;
       }
     } catch (error) {
       console.warn(`[${requestId}] Failed to get user preference:`, error.message);
     }
 
        
        
        // Base message (will be populated only if we have non-pending results)
         let baseMessage = '';
         // Only send the summary message if there are non-pending results
         const totalProcessed = results.filter(r => r?.success && !r.needsPrice && !r.needsUserInput && !r.awaiting).length;
         if (totalProcessed > 0) {
           // Create base message in English first
           const header = chooseHeader(results.length, COMPACT_MODE, /*isPrice*/ false);
           baseMessage = header;
          let successCount = 0;
          let hasSales = false;
          let totalSalesValue = 0;
          let totalPurchaseValue = 0;
        
          // Debug: Log all results before processing
          console.log(`[Update ${shopId}] All results:`, results.map(r => ({
            product: r.product,
            action: r.action,
            success: r.success,
            needsPrice: r.needsPrice,
            purchasePrice: r.purchasePrice,
            salePrice: r.salePrice,
            totalValue: r.totalValue
          })));
        
          for (const result of results) {          
            // Skip items that are still pending user input
            if (result.needsPrice === true || result.needsUserInput === true || result.awaiting === 'price+expiry') {
              console.log(`[Update ${shopId}] Skipping result that needs input:`, result.product);
              continue;
            }
            
            if (result.success) {
              successCount++;
              
              const unitText = result.unit ? ` ${result.unit}` : '';

              // Calculate value for this result (same logic)
              let value = 0;
              if (result.action === 'purchased' && result.purchasePrice && result.purchasePrice > 0) {
                value = Math.abs(result.quantity) * result.purchasePrice;
                console.log(`[Update ${shopId}] Purchase value calculation: ${Math.abs(result.quantity)} * ${result.purchasePrice} = ${value}`);
              } else if (result.action === 'sold' && result.salePrice && result.salePrice > 0) {
                value = Math.abs(result.quantity) * result.salePrice;
                console.log(`[Update ${shopId}] Sale value calculation: ${Math.abs(result.quantity)} * ${result.salePrice} = ${value}`);
              }

              // Accumulate totals (unchanged)
              if (result.action === 'purchased') {
                totalPurchaseValue += value;
                console.log(`[Update ${shopId}] Added to totalPurchaseValue: ${totalPurchaseValue}`);
              } else if (result.action === 'sold') {
                totalSalesValue += value;
                console.log(`[Update ${shopId}] Added to totalSalesValue: ${totalSalesValue}`);
              }

              // Keep the "Price updated" line for purchases with a rate
              if (result.action === 'purchased' && (result.purchasePrice || 0) > 0) {
                baseMessage += `Price updated: ${result.product} at ₹${(result.purchasePrice).toFixed(2)}/${singularize(result.unit)}\n`;
              }

              // Use helper for the main confirmation line (Compact or Verbose)
              const line = formatResultLine(result, COMPACT_MODE);
              if (line) baseMessage += `${line}\n`;

              // Verbose mode: append value & batch lines (kept out of Compact for brevity)
              if (!COMPACT_MODE) {
                if (value > 0) {
                  baseMessage += `  (Value: ₹${value.toFixed(2)})\n`;
                }
                if (result.batchDate && result.action === 'purchased') {
                  baseMessage += `  Batch added: ${formatDateForDisplay(result.batchDate)}\n`;
                }
              }

              if (result.action === 'sold') {
                hasSales = true;
              }
            } else {          
            // Defensive: avoid "Error - undefined"
                const errText = result?.error ? String(result.error) : 'pending user input';                                
                // Use helper for error rendering too (produces ❌ line)
                                const errLine = formatResultLine({ ...result, success: false, error: errText }, COMPACT_MODE);
                                baseMessage += `${errLine}\n`;
            }
          }
        
          baseMessage += `\n✅ Successfully updated ${successCount} of ${totalProcessed} items`;
          
          const formattedResponse = await t(baseMessage, detectedLanguage, requestId);
          await sendMessageDedup(from, formattedResponse);
        }
        
        // Debug: Log final totals
        console.log(`[Update ${shopId}] Final totals - totalSalesValue: ${totalSalesValue}, totalPurchaseValue: ${totalPurchaseValue}`);
        
        
    // Add summary values (only if we started building baseMessage)
     if (baseMessage) {
       if (totalSalesValue > 0) {
         baseMessage += `\n💰 Total sales value: ₹${(totalSalesValue).toFixed(2)}`;
       }
       if (totalPurchaseValue > 0) {
         baseMessage += `\n📦 Total purchase value: ₹${(totalPurchaseValue).toFixed(2)}`;
       } else {
         console.log(`[Update ${shopId}] Not showing purchase value because totalPurchaseValue is 0`);
       }
     }
    if (hasSales) {
       baseMessage += `\n\nFor better batch tracking, please specify which batch was sold in your next message.`;
       // Set conversation state to await batch selection
       if (!globalState.conversationState) {
         globalState.conversationState = {};
       }
       globalState.conversationState[from] = {
         state: 'awaiting_batch_selection',
         language: userLanguage,
         timestamp: Date.now()
       };
     }
     
    // Only send completion message if baseMessage exists
     if (baseMessage) {
       // Add switch option in completion messages
       baseMessage += `\n\nYou can reply with a voice or text message. Examples:\n• Milk purchased - 5 litres\n• Oreo Biscuits sold - 9 packets\nWe'll automatically detect your input type.`;
       // Add reset option
       baseMessage += `\nTo reset the flow, reply "reset".`;
       // Translate the entire message to user's preferred language
       const translatedMessage = await t(baseMessage, userLanguage, requestId);
       // Send the message
       response.message(translatedMessage);
     }
    handledRequests.add(requestId);
    return res.send(response.toString()); 
  }
catch (error) {
    console.error(`[${requestId}] Error processing confirmed transcription:`, error.message);
    // Get user's preferred language for error message too
    let userLanguage = detectedLanguage;
    try {
      const shopId = from.replace('whatsapp:', '');
      const userPref = await getUserPreference(shopId);
      if (userPref.success) {
        userLanguage = userPref.language;
      }
    } catch (error) {
      console.warn(`[${requestId}] Failed to get user preference:`, error.message);
    }
    const errorMessage = await t(
      'System error. Please try again with a clear voice message.',
      userLanguage,
      requestId
    );
    response.message(errorMessage);
    handledRequests.add(requestId);
    return res.send(response.toString());
} finally {
}
}

// Function to confirm transcription with user
async function confirmTranscript(transcript, from, detectedLanguage, requestId) {
  const response = new twilio.twiml.MessagingResponse();
  await sendSystemMessage(
    `I heard: "${transcript}". Is this correct? You can reply with "yes" or "no", either by voice or text.`,
    from,
    detectedLanguage,
    requestId,
    response
  );
  
  // Save to database
  const shopId = from.replace('whatsapp:', '');
  await savePendingTranscription(shopId, transcript, detectedLanguage);
  
  return response.toString();
}

// Function to confirm product with user
async function confirmProduct(update, from, detectedLanguage, requestId) {
  const response = new twilio.twiml.MessagingResponse();
  await sendSystemMessage(
  `I heard: "${update.quantity} ${update.unit} of ${update.product}" (${update.action}).  
Is this correct?  
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`,
  from,
  detectedLanguage,
  requestId,
  response
);
  
  // Store the update temporarily
  globalState.pendingProductUpdates[from] = {
    update,
    detectedLanguage,
    timestamp: Date.now()
  };
  
  return response.toString();
}

// Function to check if a message is a batch selection response
function isBatchSelectionResponse(message) {
  const batchSelectionKeywords = ['oldest', 'newest', 'batch', 'expiry'];
  const lowerMessage = message.toLowerCase();
  for (const keyword of batchSelectionKeywords) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }
  if (lowerMessage.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) {
    return true;
  }
  if (lowerMessage.match(/\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i)) {
    return true;
  }
  return false;
}

// Function to check if a message is an expiry date update
function isExpiryDateUpdate(message) {
  const hasDateFormat = message.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/) ||
                        message.match(/\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i);
  const products = [
  // Branded items
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
  'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
  'Oreo', 'Sunfeast', 'Good Day', 'Marie Gold',
  // Basic groceries
  'flour', 'आटा', 'sugar', 'चीनी', 'salt', 'नमक',
  'rice', 'चावल', 'wheat', 'गेहूं', 'oil', 'तेल',
  // Vegetables
  'potato', 'आलू', 'potatoes', 'onion', 'प्याज', 'onions',
  'tomato', 'टमाटर', 'tomatoes', 'carrot', 'गाजर', 'carrots',
  'cabbage', 'पत्ता गोभी', 'cauliflower', 'फूलगोभी', 'spinach', 'पालक',
  // Fruits
  'apple', 'सेब', 'apples', 'banana', 'केला', 'bananas',
  'orange', 'संतरा', 'oranges', 'mango', 'आम', 'mangoes',
  // Dairy
  'milk', 'दूध', 'curd', 'दही', 'yogurt', 'butter', 'मक्खन',
  'cheese', 'पनीर', 'ghee', 'घी', 'cream', 'मलाई',
  // Spices
  'turmeric', 'हल्दी', 'cumin', 'जीरा', 'coriander', 'धनिया',
  'chili', 'मिर्च', 'pepper', 'काली मिर्च', 'cardamom', 'इलायची',
  // Packaged goods
  'packets', 'पैकेट', 'boxes', 'बॉक्स', 'bags', 'बैग्स',
  'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट',
  // Branded FMCG
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया', 'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata', 'Oreo', 'Frooti', 'फ्रूटी', 'Sunfeast', 'Marie Gold', 'Good Day', 'Bournvita', 'Complan', 'Horlicks', 'Boost', 'Real Juice', 'Slice', 'Maaza', 'Pepsi', 'Coca-Cola', 'Sprite', 'Thums Up', 'Limca', 'Kinley', 'Bisleri', 'Aquafina', 'Appy Fizz',
  // Groceries
  'flour', 'आटा', 'maida', 'मैदा', 'besan', 'बेसन', 'sugar', 'चीनी', 'salt', 'नमक', 'rice', 'चावल', 'wheat', 'गेहूं', 'dal', 'दाल', 'moong dal', 'मूंग दाल', 'masoor dal', 'मसूर दाल', 'chana dal', 'चना दाल', 'rajma', 'राजमा', 'soybean', 'सोयाबीन', 'poha', 'पोहा', 'suji', 'सूजी', 'rava', 'रवा', 'sabudana', 'साबूदाना',
  // Vegetables
  'potato', 'आलू', 'onion', 'प्याज', 'tomato', 'टमाटर', 'carrot', 'गाजर', 'cabbage', 'पत्ता गोभी', 'cauliflower', 'फूलगोभी', 'spinach', 'पालक', 'brinjal', 'बैंगन', 'ladyfinger', 'भिंडी', 'capsicum', 'शिमला मिर्च', 'green chili', 'हरी मिर्च', 'garlic', 'लहसुन', 'ginger', 'अदरक',
  // Fruits
  'apple', 'सेब', 'banana', 'केला', 'orange', 'संतरा', 'mango', 'आम', 'grapes', 'अंगूर', 'papaya', 'पपीता', 'watermelon', 'तरबूज', 'muskmelon', 'खरबूजा', 'guava', 'अमरूद', 'pomegranate', 'अनार', 'lemon', 'नींबू',
  // Dairy
  'milk', 'दूध', 'curd', 'दही', 'yogurt', 'butter', 'मक्खन', 'cheese', 'पनीर', 'ghee', 'घी', 'cream', 'मलाई', 'lassi', 'लस्सी', 'buttermilk', 'छाछ',
  // Spices
  'turmeric', 'हल्दी', 'cumin', 'जीरा', 'coriander', 'धनिया', 'chili powder', 'मिर्च पाउडर', 'garam masala', 'गरम मसाला', 'asafoetida', 'हींग', 'mustard seeds', 'सरसों', 'fenugreek', 'मेथी', 'cardamom', 'इलायची', 'cloves', 'लौंग', 'black pepper', 'काली मिर्च', 'bay leaf', 'तेज पत्ता',
  // Packaged goods
  'packets', 'पैकेट', 'boxes', 'बॉक्स', 'bags', 'बैग्स', 'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट', 'shampoo', 'शैम्पू', 'toothpaste', 'टूथपेस्ट', 'toothbrush', 'टूथब्रश', 'face wash', 'फेस वॉश', 'handwash', 'हैंडवॉश', 'sanitizer', 'सेनेटाइज़र',
  // Household
  'phenyl', 'फिनाइल', 'harpic', 'हार्पिक', 'lizol', 'लिज़ोल', 'matchbox', 'माचिस', 'mosquito coil', 'मच्छर अगरबत्ती', 'mosquito repellent', 'मच्छर भगाने वाला', 'tissue paper', 'टिशू पेपर', 'napkin', 'नैपकिन', 'garbage bag', 'कचरा बैग',
  // Baby & Personal Care
  'diapers', 'डायपर', 'baby powder', 'बेबी पाउडर', 'baby lotion', 'बेबी लोशन', 'face cream', 'फेस क्रीम', 'body lotion', 'बॉडी लोशन', 'hair oil', 'हेयर ऑयल', 'comb', 'कंघी', 'razor', 'रेज़र', 'shaving cream', 'शेविंग क्रीम',
  // Beverages
  'tea', 'चाय', 'coffee', 'कॉफी', 'green tea', 'ग्रीन टी', 'black tea', 'ब्लैक टी', 'cold drink', 'कोल्ड ड्रिंक', 'energy drink', 'एनर्जी ड्रिंक',
  // Snacks
  'namkeen', 'नमकीन', 'bhujia', 'भुजिया', 'sev', 'सेव', 'chakli', 'चकली', 'murukku', 'मुरुक्कु', 'mixture', 'मिक्चर', 'kurkure', 'कुर्कुरे', 'lays', 'लेज़', 'bingo', 'बिंगो',
  // Frozen & Ready-to-eat
  'frozen peas', 'फ्रोजन मटर', 'frozen corn', 'फ्रोजन कॉर्न', 'ready-to-eat meals', 'तैयार भोजन', 'instant noodles', 'इंस्टेंट नूडल्स', 'instant soup', 'इंस्टेंट सूप',
  // Bakery
  'bread', 'ब्रेड', 'bun', 'बन', 'cake', 'केक', 'pastry', 'पेस्ट्री', 'rusk', 'रस्क',
  // Condiments
  'ketchup', 'केचप', 'mayonnaise', 'मेयोनेज़', 'sauce', 'सॉस', 'pickle', 'अचार', 'jam', 'जैम', 'honey', 'शहद',
  // Others
  'ice cream', 'आइसक्रीम', 'chocolate', 'चॉकलेट', 'candy', 'कैंडी', 'mint', 'मिंट', 'mouth freshener', 'माउथ फ्रेशनर'  
];
  const hasProduct = products.some(p => message.toLowerCase().includes(p.toLowerCase()));
  return hasDateFormat && hasProduct;
}

// Handle batch selection response
async function handleBatchSelectionResponse(body, from, response, requestId, languageCode = 'en') {
  try {
    console.log(`[${requestId}] Processing batch selection response: "${body}"`);
    const shopId = from.replace('whatsapp:', '');
    const lowerBody = body.toLowerCase();
    let product = null;
    const products = [
  // Branded items
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
  'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
  'Oreo', 'Sunfeast', 'Good Day', 'Marie Gold',
  // Basic groceries
  'flour', 'आटा', 'sugar', 'चीनी', 'salt', 'नमक',
  'rice', 'चावल', 'wheat', 'गेहूं', 'oil', 'तेल',
  // Vegetables
  'potato', 'आलू', 'potatoes', 'onion', 'प्याज', 'onions',
  'tomato', 'टमाटर', 'tomatoes', 'carrot', 'गाजर', 'carrots',
  'cabbage', 'पत्ता गोभी', 'cauliflower', 'फूलगोभी', 'spinach', 'पालक',
  // Fruits
  'apple', 'सेब', 'apples', 'banana', 'केला', 'bananas',
  'orange', 'संतरा', 'oranges', 'mango', 'आम', 'mangoes',
  // Dairy
  'milk', 'दूध', 'curd', 'दही', 'yogurt', 'butter', 'मक्खन',
  'cheese', 'पनीर', 'ghee', 'घी', 'cream', 'मलाई',
  // Spices
  'turmeric', 'हल्दी', 'cumin', 'जीरा', 'coriander', 'धनिया',
  'chili', 'मिर्च', 'pepper', 'काली मिर्च', 'cardamom', 'इलायची',
  // Packaged goods
  'packets', 'पैकेट', 'boxes', 'बॉक्स', 'bags', 'बैग्स',
  'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट',
  // Branded FMCG
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया', 'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata', 'Oreo', 'Frooti', 'फ्रूटी', 'Sunfeast', 'Marie Gold', 'Good Day', 'Bournvita', 'Complan', 'Horlicks', 'Boost', 'Real Juice', 'Slice', 'Maaza', 'Pepsi', 'Coca-Cola', 'Sprite', 'Thums Up', 'Limca', 'Kinley', 'Bisleri', 'Aquafina', 'Appy Fizz',
  // Groceries
  'flour', 'आटा', 'maida', 'मैदा', 'besan', 'बेसन', 'sugar', 'चीनी', 'salt', 'नमक', 'rice', 'चावल', 'wheat', 'गेहूं', 'dal', 'दाल', 'moong dal', 'मूंग दाल', 'masoor dal', 'मसूर दाल', 'chana dal', 'चना दाल', 'rajma', 'राजमा', 'soybean', 'सोयाबीन', 'poha', 'पोहा', 'suji', 'सूजी', 'rava', 'रवा', 'sabudana', 'साबूदाना',
  // Vegetables
  'potato', 'आलू', 'onion', 'प्याज', 'tomato', 'टमाटर', 'carrot', 'गाजर', 'cabbage', 'पत्ता गोभी', 'cauliflower', 'फूलगोभी', 'spinach', 'पालक', 'brinjal', 'बैंगन', 'ladyfinger', 'भिंडी', 'capsicum', 'शिमला मिर्च', 'green chili', 'हरी मिर्च', 'garlic', 'लहसुन', 'ginger', 'अदरक',
  // Fruits
  'apple', 'सेब', 'banana', 'केला', 'orange', 'संतरा', 'mango', 'आम', 'grapes', 'अंगूर', 'papaya', 'पपीता', 'watermelon', 'तरबूज', 'muskmelon', 'खरबूजा', 'guava', 'अमरूद', 'pomegranate', 'अनार', 'lemon', 'नींबू',
  // Dairy
  'milk', 'दूध', 'curd', 'दही', 'yogurt', 'butter', 'मक्खन', 'cheese', 'पनीर', 'ghee', 'घी', 'cream', 'मलाई', 'lassi', 'लस्सी', 'buttermilk', 'छाछ',
  // Spices
  'turmeric', 'हल्दी', 'cumin', 'जीरा', 'coriander', 'धनिया', 'chili powder', 'मिर्च पाउडर', 'garam masala', 'गरम मसाला', 'asafoetida', 'हींग', 'mustard seeds', 'सरसों', 'fenugreek', 'मेथी', 'cardamom', 'इलायची', 'cloves', 'लौंग', 'black pepper', 'काली मिर्च', 'bay leaf', 'तेज पत्ता',
  // Packaged goods
  'packets', 'पैकेट', 'boxes', 'बॉक्स', 'bags', 'बैग्स', 'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट', 'shampoo', 'शैम्पू', 'toothpaste', 'टूथपेस्ट', 'toothbrush', 'टूथब्रश', 'face wash', 'फेस वॉश', 'handwash', 'हैंडवॉश', 'sanitizer', 'सेनेटाइज़र',
  // Household
  'phenyl', 'फिनाइल', 'harpic', 'हार्पिक', 'lizol', 'लिज़ोल', 'matchbox', 'माचिस', 'mosquito coil', 'मच्छर अगरबत्ती', 'mosquito repellent', 'मच्छर भगाने वाला', 'tissue paper', 'टिशू पेपर', 'napkin', 'नैपकिन', 'garbage bag', 'कचरा बैग',
  // Baby & Personal Care
  'diapers', 'डायपर', 'baby powder', 'बेबी पाउडर', 'baby lotion', 'बेबी लोशन', 'face cream', 'फेस क्रीम', 'body lotion', 'बॉडी लोशन', 'hair oil', 'हेयर ऑयल', 'comb', 'कंघी', 'razor', 'रेज़र', 'shaving cream', 'शेविंग क्रीम',
  // Beverages
  'tea', 'चाय', 'coffee', 'कॉफी', 'green tea', 'ग्रीन टी', 'black tea', 'ब्लैक टी', 'cold drink', 'कोल्ड ड्रिंक', 'energy drink', 'एनर्जी ड्रिंक',
  // Snacks
  'namkeen', 'नमकीन', 'bhujia', 'भुजिया', 'sev', 'सेव', 'chakli', 'चकली', 'murukku', 'मुरुक्कु', 'mixture', 'मिक्चर', 'kurkure', 'कुर्कुरे', 'lays', 'लेज़', 'bingo', 'बिंगो',
  // Frozen & Ready-to-eat
  'frozen peas', 'फ्रोजन मटर', 'frozen corn', 'फ्रोजन कॉर्न', 'ready-to-eat meals', 'तैयार भोजन', 'instant noodles', 'इंस्टेंट नूडल्स', 'instant soup', 'इंस्टेंट सूप',
  // Bakery
  'bread', 'ब्रेड', 'bun', 'बन', 'cake', 'केक', 'pastry', 'पेस्ट्री', 'rusk', 'रस्क',
  // Condiments
  'ketchup', 'केचप', 'mayonnaise', 'मेयोनेज़', 'sauce', 'सॉस', 'pickle', 'अचार', 'jam', 'जैम', 'honey', 'शहद',
  // Others
  'ice cream', 'आइसक्रीम', 'chocolate', 'चॉकलेट', 'candy', 'कैंडी', 'mint', 'मिंट', 'mouth freshener', 'माउथ फ्रेशनर'  
];
    for (const p of products) {
      if (lowerBody.includes(p.toLowerCase())) {
        product = p;
        break;
      }
    }
    if (!product) {
      await sendSystemMessage(
        'Please specify which product you are referring to.',
        from,
        languageCode,
        requestId,
        response
      );
      return;
    }
    const batches = await getBatchRecords(shopId, product);
    if (batches.length === 0) {
      await sendSystemMessage(
        `No batches found for ${product}.`,
        from,
        languageCode,
        requestId,
        response
      );
      return;
    }
    let selectedBatch = null;
    if (lowerBody.includes('oldest')) {
      selectedBatch = batches[batches.length - 1];
    } else if (lowerBody.includes('newest')) {
      selectedBatch = batches[0];
    } else {
      const dateMatch = body.match(regexPatterns.dateFormats);
      if (dateMatch) {
        const dateStr = dateMatch[0];
        const parsedDate = parseExpiryDate(dateStr);
        if (parsedDate) {
          selectedBatch = batches.find(batch => {
            if (!batch.fields.ExpiryDate) return false;
            const batchDate = new Date(batch.fields.ExpiryDate);
            return batchDate.getTime() === parsedDate.getTime();
          });
        }
      }
    }
    if (!selectedBatch) {
      selectedBatch = batches[batches.length - 1];
    }
    const dateMatch = body.match(regexPatterns.dateFormats);
    if (dateMatch) {
      const dateStr = dateMatch[0];
      const parsedDate = parseExpiryDate(dateStr);
      if (parsedDate) {
        const formattedDate = formatDateForAirtable(parsedDate);
        await updateBatchExpiry(selectedBatch.id, formattedDate);
        await sendSystemMessage(
          `✅ Updated expiry date for ${product} batch to ${formatDateForDisplay(parsedDate)}`,
          from,
          languageCode,
          requestId,
          response
        );
        return;
      }
    }
    await sendSystemMessage(
  `✅ Selected ${product} batch from ${formatDateForDisplay(selectedBatch.fields.PurchaseDate)}`,
  from,
  languageCode,
  requestId,
  response
);
    // Clear conversation state
    if (globalState.conversationState && globalState.conversationState[from]) {
      delete globalState.conversationState[from];
    }
  } catch (error) {
    console.error(`[${requestId}] Error handling batch selection response:`, error.message);
    await sendSystemMessage(
      'Error processing batch selection. Please try again.',
      from,
      languageCode,
      requestId,
      response
    );
  }
}

// Handle expiry date update
async function handleExpiryDateUpdate(body, from, response, requestId, languageCode = 'en') {
  try {
    console.log(`[${requestId}] Processing expiry date update: "${body}"`);
    const productMatch = body.match(/([a-zA-Z\s]+):?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
    if (!productMatch) {
      console.log(`[${requestId}] Invalid expiry date format`);
      await sendSystemMessage(
        'Invalid format. Please use: "Product: DD/MM/YYYY" or "Product: DD Month YYYY"',
        from,
        languageCode,
        requestId,
        response
      );
      return;
    }
    const product = productMatch[1].trim();
    const expiryDateStr = productMatch[2];
    console.log(`[${requestId}] Extracted product: "${product}", expiry date: "${expiryDateStr}"`);
    const expiryDate = parseExpiryDate(expiryDateStr);
    if (!expiryDate) {
      console.log(`[${requestId}] Failed to parse expiry date`);
      await sendSystemMessage(
        'Invalid date format. Please use: "Product: DD/MM/YYYY" or "Product: DD Month YYYY"',
        from,
        languageCode,
        requestId,
        response
      );
      return;
    }
    const shopId = from.replace('whatsapp:', '');
    console.log(`[${requestId}] Looking for recent batches for ${product}`);
    const batches = await getBatchRecords(shopId, product);
    if (batches.length === 0) {
      console.log(`[${requestId}] No recent purchase found for ${product}`);
      await sendSystemMessage(
        `No recent purchase found for ${product}. Please make a purchase first.`,
        from,
        languageCode,
        requestId,
        response
      );
      return;
    }
    const formattedExpiryDate = formatDateForAirtable(expiryDate);
console.log(`[${requestId}] Formatted expiry date: ${formattedExpiryDate}`);
const latestBatch = batches[0];
console.log(`[${requestId}] Updating batch ${latestBatch.id} (purchased: ${latestBatch.fields.PurchaseDate}) with expiry date`);
    const batchResult = await updateBatchExpiry(latestBatch.id, formattedExpiryDate);
    if (batchResult.success) {
      console.log(`[${requestId}] Successfully updated batch with expiry date`);
      await sendSystemMessage(
        `✅ Expiry date updated for ${product}: ${formatDateForDisplay(expiryDate)}`,
        from,
        languageCode,
        requestId,
        response
      );
    } else {
      console.error(`[${requestId}] Failed to update batch: ${batchResult.error}`);
      await sendSystemMessage(
        `Error updating expiry date for ${product}. Please try again.`,
        from,
        languageCode,
        requestId,
        response
      );
    }
  } catch (error) {
    console.error(`[${requestId}] Error handling expiry date update:`, error.message);
    await sendSystemMessage(
      'Error processing expiry date. Please try again.',
      from,
      languageCode,
      requestId,
      response
    );
  }
}

// Parse expiry date in various formats
function parseExpiryDate(dateStr) {
  // Try DD/MM/YYYY format
  const dmyMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1]);
    const month = parseInt(dmyMatch[2]);
    let year = parseInt(dmyMatch[3]);
    // Handle 2-digit year
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }
    return new Date(year, month - 1, day);
  }
  // Try "DD Month YYYY" format
  const monthMatch = dateStr.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (monthMatch) {
    const day = parseInt(monthMatch[1]);
    const monthNames = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    const month = monthNames.indexOf(monthMatch[2]);
    const year = parseInt(monthMatch[3]);
    return new Date(year, month, day);
  }
  return null;
}

// FIX: Improved greeting detection function
function detectGreetingLanguage(text) {
  const lowerText = text.toLowerCase();
  
  // Check for specific greeting words in each language
  const greetingPatterns = {
    'hi': ['नमस्ते', 'नमस्कार', 'हाय', 'हेलो'],
    'bn': ['নমস্কার', 'হ্যালো'],
    'ta': ['வணக்கம்'],
    'te': ['నమస్కారం', 'హలో'],
    'kn': ['ನಮಸ್ಕಾರ', 'ಹಲೋ'],
    'gu': ['નમસ્તે', 'હેલો'],
    'mr': ['नमस्कार', 'हॅलो'],
    'en': ['hello', 'hi', 'hey']
  };
  
  // Check each language's greeting patterns
  for (const [lang, greetings] of Object.entries(greetingPatterns)) {
    for (const greeting of greetings) {
      if (lowerText.includes(greeting)) {
        return lang;
      }
    }
  }
  
  return null;
}

// Add this function to check and update language preference

async function checkAndUpdateLanguage(text, from, currentLang, requestId) {  
try {
    const t = String(text || '').trim().toLowerCase();
    const shopId = String(from || '').replace('whatsapp:', '');
    // Explicit one-word language commands
    const TOKENS = {
      en: ['en','eng','english'],
      hi: ['hi','hin','hindi','हिंदी','हिन्दी'],
      bn: ['bn','ben','bengali','বাংলা'],
      ta: ['ta','tam','tamil','தமிழ்'],
      te: ['te','tel','telugu','తెలుగు'],
      kn: ['kn','kan','kannada','ಕನ್ನಡ'],
      mr: ['mr','mar','marathi','मराठी'],
      gu: ['gu','guj','gujarati','ગુજરાતી']
    };
    let wanted = null;
    for (const [code, words] of Object.entries(TOKENS)) {
      if (words.includes(t)) { wanted = code; break; }
    }
    if (wanted && wanted !== currentLang) {
      await saveUserPreference(shopId, wanted);
      return wanted;
    }
    return currentLang || 'en';
  } catch (e) {
    console.warn(`[${requestId}] checkAndUpdateLanguage failed: ${e.message}`);
    return currentLang || 'en';
  }
}

// Audio Processing Functions
async function downloadAudio(url) {
  console.log('[1] Downloading audio from:', url);
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 5000,
    auth: {
      username: process.env.ACCOUNT_SID,
      password: process.env.AUTH_TOKEN
    },
    headers: {
      'User-Agent': 'WhatsApp-Business-Automation/1.0'
    }
  });
  const hash = crypto.createHash('md5').update(data).digest('hex');
  console.log(`[1] Audio downloaded, size: ${data.length} bytes, MD5: ${hash}`);
  return data;
}

async function convertToFLAC(oggBuffer) {
  try {
    const inputHash = crypto.createHash('md5').update(oggBuffer).digest('hex');
    console.log(`[2] Converting audio, input size: ${oggBuffer.length} bytes, MD5: ${inputHash}`);
    fs.writeFileSync('/tmp/input.ogg', oggBuffer);
    execSync(
      `"${ffmpegPath}" -i /tmp/input.ogg -ar 16000 -ac 1 -c:a flac -compression_level 5 /tmp/output.flac`,
      { timeout: 3000 }
    );
    const flacBuffer = fs.readFileSync('/tmp/output.flac');
    const outputHash = crypto.createHash('md5').update(flacBuffer).digest('hex');
    console.log(`[2] Conversion complete, output size: ${flacBuffer.length} bytes, MD5: ${outputHash}`);
    // Clean up temporary files
    fs.unlinkSync('/tmp/input.ogg');
    fs.unlinkSync('/tmp/output.flac');
    return flacBuffer;
  } catch (error) {
    console.error('FFmpeg conversion failed:', error.message);
    throw new Error('Audio processing error');
  }
}

// Google Transcription with confidence tracking
async function googleTranscribe(flacBuffer, requestId) {
  try {
    const base64Key = process.env.GCP_BASE64_KEY?.trim();
    if (!base64Key) {
      throw new Error('GCP_BASE64_KEY environment variable not set');
    }
    let decodedKey;
    try {
      decodedKey = Buffer.from(base64Key, 'base64').toString('utf8');
    } catch (decodeErr) {
      throw new Error(`Base64 decoding failed: ${decodeErr.message}`);
    }
    let credentials;
    try {
      credentials = JSON.parse(decodedKey);
    } catch (parseErr) {
      throw new Error(`JSON parsing failed: ${parseErr.message}`);
    }
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    // Language priority that works well
    const languageConfigs = [
      { languageCode: 'en-IN', name: 'English (India)' },
      { languageCode: 'hi-IN', name: 'Hindi' },
      { languageCode: 'en-US', name: 'English (US)' }
    ];
    for (const langConfig of languageConfigs) {
      try {
        const baseConfig = {
          languageCode: langConfig.languageCode,
          useEnhanced: true,
          enableAutomaticPunctuation: true,
          audioChannelCount: 1,
          speechContexts: [{
            phrases: [
              'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
              'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
              'flour', 'आटा', 'sugar', 'चीनी', 'packets', 'पैकेट',
              '10', 'दस', '20', 'बीस', '50', 'पचास', '100', 'सौ',
              'kg', 'किलो', 'ग्राम', 'पैकेट', 'बॉक्स', 'किलोग्राम',
              'खरीदा', 'बेचा', 'बिक्री', 'क्रय', 'लिया', 'दिया', 'बचा',
              'sold', 'purchased', 'bought', 'ordered'
            ],
            boost: 32.0
          }]
        };
        // Model priority that works well
        const configs = [
          { ...baseConfig, model: 'telephony' },
          { ...baseConfig, model: 'latest_short' },
          { ...baseConfig, model: 'default' }
        ];
        for (const config of configs) {
          try {
            config.encoding = 'FLAC';
            config.sampleRateHertz = 16000;
            const audioContent = flacBuffer.toString('base64');
            console.log(`[${requestId}] Processing with ${config.model} model (${langConfig.name}), audio size: ${audioContent.length}`);
            const { data } = await client.request({
              url: 'https://speech.googleapis.com/v1/speech:recognize',
              method: 'POST',
              data: {
                audio: { content: audioContent },
                config
              },
              timeout: 8000
            });
            // Combine all results into a single transcript
            let fullTranscript = '';
            let confidenceSum = 0;
            let confidenceCount = 0;
            if (data.results && data.results.length > 0) {
              for (const result of data.results) {
                if (result.alternatives && result.alternatives.length > 0) {
                  const alternative = result.alternatives[0];
                  fullTranscript += alternative.transcript + ' ';
                  if (alternative.confidence) {
                    confidenceSum += alternative.confidence;
                    confidenceCount++;
                  }
                }
              }
            }
            fullTranscript = fullTranscript.trim();
            if (fullTranscript) {
              const avgConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;
              console.log(`[${requestId}] STT Success: ${config.model} model (${langConfig.name}) - Transcript: "${fullTranscript}" (Confidence: ${avgConfidence.toFixed(2)})`);
              return {
                transcript: fullTranscript,
                confidence: avgConfidence
              };
            }
          } catch (error) {
            console.warn(`[${requestId}] STT Attempt Failed:`, {
              model: config.model,
              language: langConfig.name,
              error: error.response?.data?.error?.message || error.message
            });
          }
        }
      } catch (error) {
        console.warn(`[${requestId}] Language ${langConfig.name} failed:`, error.message);
      }
    }
    throw new Error(`[${requestId}] All STT attempts failed`);
  } catch (error) {
    console.error(`[${requestId}] Google Transcription Error:`, error.message);
    throw error;
  }
}

// --- Minimal outbound sanitizer: strip NO_FOOTER sentinel ---
function sanitizeOutboundMessage(text) {
  let s = String(text ?? '');
  // strip common variants at the start (raw / html-escaped)
  s = s.replace(/^\s*!NO_FOOTER!\s*/i, '');
  s = s.replace(/^\s*<!NO_FOOTER!>\s*/i, '');
  s = s.replace(/^\s*&lt;!NO_FOOTER!&gt;\s*/i, '');
  return s;
}

// Function to send WhatsApp message via Twilio API (for async responses)
async function sendMessageViaAPI(to, body, tagOpts /* optional: forwarded to tagWithLocalizedMode */) {
  try {
    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    console.log(`[sendMessageViaAPI] Preparing to send message to: ${formattedTo}`);
    console.log(`[sendMessageViaAPI] Message length: ${String(body).length} characters`);
          
    // --- Honor NO_FOOTER sentinel (single and multi-part paths) ---
        const NO_FOOTER_RX = /^\s*(?:!NO_FOOTER!|<!NO_FOOTER!>|&lt;!NO_FOOTER!&gt;)\s*/i;
        const noFooter = NO_FOOTER_RX.test(String(body));
        const bodyStripped = String(body).replace(NO_FOOTER_RX, '');

    // Twilio hard limit for WhatsApp (exceeding returns Error 21617)
    // Ref: https://www.twilio.com/docs/api/errors/21617, https://help.twilio.com/articles/360033806753
    const MAX_LENGTH = 1600;
    const PART_SUFFIX = (i, n) => `\n\n(Part ${i} of ${n})`;

    // We will append the localized footer ONLY to the final part.
    // Measure footer length by tagging an empty string once.
    const emptyTagged = await tagWithLocalizedMode(formattedTo, '', 'en', tagOpts);
    const footerLen = emptyTagged.length; // e.g., «SALE • mode»

    // Smart line-based splitter that respects a given safe limit
    const smartSplit = (text, safeLimit) => {
      const out = [];
      let chunk = '';
      for (const line of String(text).split('\n')) {
        const add = chunk ? '\n' + line : line;
        if ((chunk + add).length > safeLimit) {
          if (chunk) out.push(chunk);
          // If a single line itself exceeds the safe limit, clamp it
          chunk = add.slice(0, safeLimit);
        } else {
          chunk += add;
        }
      }
      if (chunk) out.push(chunk);
      return out;
    };

    
    // --- NEW: append correct CTA after sending text ---
    const appendCTA = async () => {
      try {
        const shopId = formattedTo.replace('whatsapp:', '');
        // Resolve preferred language
        let lang = 'en';
        try {
          const pref = await getUserPreference(shopId);
          if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
        } catch (_e) {}
        // Read plan
        let plan = 'none';
        try {
          const planInfo = await getUserPlan(shopId);
          if (planInfo?.plan) plan = String(planInfo.plan).toLowerCase();
        } catch (_e) {}
        // Ensure templates exist
        await ensureLangTemplates(lang);
        const sids = getLangSids(lang);
        if (!sids) return;
        // Decide CTA:
        if (plan === 'paid') {
          // No CTA once paid
          return;
        }
        if (plan === 'trial') {
          // Show Paid CTA while on trial
          if (sids.activatePaidSid) {
            await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.activatePaidSid });
          }
          return;
        }
        // Not on trial/paid -> show Trial CTA
        if (sids.activateTrialSid) {
          await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.activateTrialSid });
        }
      } catch (ctaErr) {
        console.warn('[activate-cta] failed to append CTA:', ctaErr.message);
      }
    };
            
    // If the message fits, (conditionally) tag and send
        if (bodyStripped.length <= MAX_LENGTH) {
          console.log('[sendMessageViaAPI] Body (raw before tag):', JSON.stringify(bodyStripped));
          const finalText = noFooter
            ? bodyStripped                       // do NOT tag footer
            : await tagWithLocalizedMode(formattedTo, bodyStripped, 'en', tagOpts);
          console.log('[sendMessageViaAPI] Body (final after tag):', JSON.stringify(finalText));
                
      // [PATCH:TXN-CONFIRM-DEDUP-001] — suppress duplicate confirmations
                try {
                  if (_shouldSuppressTxnDuplicate(formattedTo, finalText)) {
                    console.log('[sendMessageViaAPI] Suppressed duplicate txn confirmation', { to: formattedTo });
                    await appendCTA(); // keep CTA behavior consistent
                    return { suppressed: true };
                  }
                } catch (_) {}

      const message = await client.messages.create({
        body: finalText,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: formattedTo
      });
      console.log(`[sendMessageViaAPI] Message sent successfully. SID: ${message.sid}`);
      await appendCTA(); // NEW
      return message;
    }

    // Multi-part path:
    // First split roughly, then re-split each part with exact room for the
    // "(Part i of n)" suffix and (only on the last part) the footer.
    let parts = smartSplit(bodyStripped, MAX_LENGTH - 14); // provisional
    const final = [];
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const suffix = PART_SUFFIX(i + 1, parts.length);
      const reserved = suffix.length + (isLast ? footerLen : 0);
      const safeLimit = MAX_LENGTH - reserved;
      const resplit = smartSplit(parts[i], safeLimit);
      for (const frag of resplit) final.push(frag);
    }

    console.log(`[sendMessageViaAPI] Splitting message into ${final.length} chunks`);
    const messageSids = [];
    for (let i = 0; i < final.length; i++) {
      const isLast = i === final.length - 1;
      let text = final[i] + PART_SUFFIX(i + 1, final.length);       
    // Append footer ONLY on the last part — unless NO_FOOTER was requested
          if (isLast && !noFooter) {
            text = await tagWithLocalizedMode(formattedTo, text, 'en', tagOpts);
          }
    
    // [PATCH:TXN-CONFIRM-DEDUP-001] — suppress duplicates even in multipart (rare for confirmations)
          try {
            if (_shouldSuppressTxnDuplicate(formattedTo, text)) {
              console.log('[sendMessageViaAPI] Suppressed duplicate txn confirmation (multipart)', { to: formattedTo });
              await appendCTA();
              return { suppressed: true };
            }
          } catch (_) {}

      console.log(`[sendMessageViaAPI] Sending part ${i+1}/${final.length} (${text.length} chars)`);
      const message = await client.messages.create({
        body: text,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: formattedTo
      });
      messageSids.push(message.sid);
      console.log(`[sendMessageViaAPI] Part ${i+1} sent successfully. SID: ${message.sid}`);

      // Small delay between parts to avoid rate limiting
      if (i < final.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    await appendCTA(); // NEW
    // Return the first SID and the list of part SIDs
    return { sid: messageSids[0], parts: messageSids };
  } catch (error) {
    console.error('Error sending WhatsApp message via API:', error);
    throw error;
  }
}

// ===== NEW: Serialize outbound sends per shop to avoid jumbled sequences =====
const _sendQueues = new Map(); // shopId -> Promise
async function sendMessageQueued(toWhatsApp, body) {
  try {
    const shopId = String(toWhatsApp).replace('whatsapp:', '');
    const prev = _sendQueues.get(shopId) || Promise.resolve();
    const next = prev
      .catch(() => {}) // swallow previous errors to keep queue alive
      .then(async () => {
        // single place to send; preserve your existing send function
        return await sendMessageViaAPI(toWhatsApp, body);
      });
    _sendQueues.set(shopId, next);
    return await next;
  } catch (e) {
    console.warn('[sendMessageQueued] failed:', e?.message);
    // fall back to direct send to avoid drop
    return await sendMessageViaAPI(toWhatsApp, body);
  }
}

// --- Dedicated, single-send Return confirmation (Option B: only for single-item) ----
async function sendReturnConfirmationOnce(
  toWhatsApp,
  languageCode,
  requestScope = 'return-confirmation',
  payload /* { product, qty, unit, newQuantity, reason } */
) {
  try {
    globalThis.__returnConfirmSent = globalThis.__returnConfirmSent || new Set();
    const key = `${toWhatsApp}::${requestScope}::${String(payload.product).toLowerCase()}::${payload.qty}::${payload.unit}`;
    if (__returnConfirmSent.has(key)) return false;
    __returnConfirmSent.add(key);

    const qty   = Math.abs(Number(payload.qty ?? 0)) || 0;
    const unit  = String(payload.unit ?? '').trim();
    const prod  = String(payload.product ?? '').trim();        
    const stock = (payload.newQuantity != null)
          ? ` (Stock: ${payload.newQuantity}${unit ? ' ' + unit : ''})`
          : '';
    const reasonLine = payload.reason ? `\nReason: ${payload.reason}` : '';

    const line = `↩️ Returned ${qty} ${unit} ${prod}${stock}${reasonLine}`;        
    const prepared = finalizeForSend(line, languageCode);
    await sendMessageViaAPI(toWhatsApp, prepared, { helpCta: true });
    return true;
  } catch (e) {
    console.warn('[return-confirmation] send failed:', e?.message);
    return false;
  }
}

// Async processing for voice messages
async function processVoiceMessageAsync(MediaUrl0, From, requestId, conversationState) {
  try {
    console.log(`[${requestId}] [1] Downloading audio...`);
    const audioBuffer = await downloadAudio(MediaUrl0);
    console.log(`[${requestId}] [2] Converting audio...`);
    const flacBuffer = await convertToFLAC(audioBuffer);                
    console.log(`[${requestId}] [3] Transcribing with Soniox (async REST)...`);
        const shopId = fromToShopId(From);
        // Write FLAC to a temp file for Soniox Files API upload
        const tmpDir = '/tmp';
        const tmpPath = `${tmpDir}/voice_${requestId}.flac`;                
        await fs.promises.writeFile(tmpPath, flacBuffer);
            // Decide exact language for this turn → prefer pinned over detector, avoid mid-turn downgrades.
            let pinnedPref = 'en';
            try {
              const pref = await getUserPreference(shopId);
              if (pref?.success && pref.language) pinnedPref = String(pref.language).toLowerCase();
            } catch {}
            const detectedSeed = normalizeLangExact(conversationState?.language || 'en');
            const langExactSeed = normalizeLangExact(pinnedPref || detectedSeed);
            const langHints = toSonioxHints(langExactSeed);      // single-language hint when possible
        
            // Transcribe via Soniox Async API (Files + Transcriptions)
            const { text: rawTranscript } = await transcribeFileWithSoniox(tmpPath, {
              langExact: langExactSeed,                          // let helper disable LID on single hint
              languageHints: langHints,
              model: process.env.SONIOX_ASYNC_MODEL || 'stt-async-v3'
            });
        // Heuristic confidence since async is final text; let env override (default 0.95).
        const confidence = Number(process.env.SONIOX_DEFAULT_CONFIDENCE ?? 0.95);

    console.log(`[${requestId}] [4] Validating transcript...`);
        
     // Best-effort language preference for script clamp inside validateTranscript           
     const prefRow = await getUserPreference(shopId).catch(() => ({ language: pinnedPref || 'en' }));
         const langPref = normalizeLangExact(prefRow?.language || 'en');
         const cleanTranscript = await validateTranscript(rawTranscript, requestId, langPref);
          
     console.log(`[${requestId}] [5] Detecting language...`);
          // Read pinned user preference (hi should be retained unless explicitly switched)
          
          try {
            const pref = await getUserPreference(shopId);
            if (pref?.success && pref.language) pinnedPref = String(pref.language).toLowerCase();
          } catch (_) { /* best effort */ }
      
          // Use robust detector (same behaviour as text path)
          let detectedLanguage = await detectLanguageWithFallback(cleanTranscript, From, requestId);                                       
          // Stabilize UI language for this turn: pinned wins unless explicit switch token present.
              let explicitSwitch = false;
              try {
                explicitSwitch = (typeof _matchLanguageToken === 'function') && _matchLanguageToken(cleanTranscript);
              } catch {}
              const uiLangExact = chooseUiLanguage(pinnedPref, detectedLanguage, explicitSwitch);
      
          // If we previously pinned a non-English preference (e.g., hi),
          // do NOT let a single voice turn flip it to en unless there is an explicit language switch.
          try {
            const explicitSwitch =
              (typeof _matchLanguageToken === 'function') && _matchLanguageToken(cleanTranscript);
            if (pinnedPref === 'hi' && detectedLanguage === 'en' && !explicitSwitch) {
              detectedLanguage = 'hi';
            }
          } catch (_) { /* noop */ }
          console.log(`[${requestId}] voice: pinned=${pinnedPref} → detected=${detectedLanguage}`);
            
    // ===== [PATCH:HYBRID-VOICE-ROUTE-004] BEGIN =====
      // Hybrid: allow non‑mutating diagnostic peeks inside sticky mode (no state change)
      try {
        const stickyAction =
          typeof getStickyActionQuick === 'function'
            ? (getStickyActionQuick.length > 0 ? await getStickyActionQuick(From) : await getStickyActionQuick())
            : null;
        const isPeek = !!classifyDiagnosticPeek(cleanTranscript);              
        if (ALLOW_READONLY_IN_STICKY && stickyAction && isPeek) {
           const ok = await handleDiagnosticPeek(From, cleanTranscript, requestId, stickyAction);
           if (ok) {
             try {
               const langForUi = String(detectedLanguage ?? 'en').toLowerCase();
               await maybeResendListPicker(From, langForUi, requestId);
             } catch (_) { /* best effort */ }
             return; // reply already sent via API; keep mode; stop voice flow
           }
         }
      } catch (_) { /* best-effort */ }
      // ===== [PATCH:HYBRID-VOICE-ROUTE-004] END =====

    // --- Minimal hook: Activate Paid Plan command (voice path) ---
    const lowerCmd = String(cleanTranscript || '').trim().toLowerCase();
    if (
      lowerCmd === 'activate paid' ||
      lowerCmd === 'paid' ||
      /activate\s+paid/i.test(lowerCmd) ||
      /start\s+paid/i.test(lowerCmd)
    ) {
      await sendPaidPlanCTA(From, uiLangExact || 'en');
      return;
    }
       
    // Save user preference (do not downgrade hi → en mid-turn)
        const willDowngrade = pinnedPref && pinnedPref !== 'en' && normalizeLangExact(detectedLanguage) === 'en';
        if (!willDowngrade) {
          await saveUserPreference(shopId, uiLangExact);     // persist exact combo (e.g., hi-latn)
        } else {
          console.log(`[${requestId}] voice: retained pinned pref=${pinnedPref}, skipped downgrading to en`);
        }
    
    // Heartbeat: keep sticky mode fresh while user is active
        try {
          const st = typeof getUserStateFromDB === 'function' ? await getUserStateFromDB(shopId) : null;
          if (st && st.mode === 'awaitingTransactionDetails' && typeof refreshUserStateTimestamp === 'function') {
            await refreshUserStateTimestamp(shopId);
          }
        } catch (_) {}
        
    // === NEW: typed "demo" intent (defensive, outside orchestrator) ===
      try {
        const langPinned = String(detectedLanguage ?? 'en').toLowerCase();
        const raw = String(cleanTranscript ?? '').trim().toLowerCase();
        const demoTokens = [
          'demo','डेमो','ডেমো','டெமோ','డెమో','ಡೆಮೊ','ડેમો',
          'demo please','डेमो देखें','डेमो देखो'
        ];
        if (demoTokens.some(t => raw.includes(t))) {
          await sendDemoVideoAndButtons(From, uiLangExact, `${requestId}::demo-voice`);
          handledRequests.add(requestId);
          return;
        }
      } catch (_) { /* soft-fail: continue */ }

    // --- Typed "start trial" guard (voice transcript) ---
      // Only trigger when user is NOT already activated (paid or active trial).
      // Does not affect the existing button flow.
      try {
        const planInfo = await getUserPlan(shopId);
        const plan = String(planInfo?.plan ?? '').toLowerCase();
        const trialEnd = planInfo?.trialEndDate ? new Date(planInfo.trialEndDate) : null;
        const isActivated =
          (plan === 'paid') ||
          (plan === 'trial' && (!trialEnd || Date.now() <= trialEnd.getTime()));
        if (!isActivated && isStartTrialIntent(cleanTranscript)) {
          await activateTrialFlow(From, (detectedLanguage ?? 'en').toLowerCase());
          try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: true }); } catch {}
          handledRequests.add(requestId);
          return;
        }
      } catch { /* soft-fail: continue */ }

    // ===== EARLY EXIT: AI orchestrator on the transcript =====
      try {
        const orch = await applyAIOrchestration(cleanTranscript, From, detectedLanguage, requestId);
          const FORCE_INVENTORY = !!orch?.forceInventory;
        /* VOICE_HANDLER_PATCH */
        try {
          if (orch?.normalizedCommand) {
            const normalized = String(orch.normalizedCommand).toLowerCase();
            if (_isTerminalCommand(normalized)) {
              handledRequests.add(requestId);
              await handleQuickQueryEN(
                normalized,
                From,
                _safeLang(orch.language, detectedLanguage, 'en'),
                `${requestId}::terminal-voice`
              );              
            // B: Immediately resurface the Inventory List-Picker after terminal command
                      try {
                        const langForUi = _safeLang(orch.language, detectedLanguage, 'en');
                        await maybeResendListPicker(From, langForUi, requestId);
                      } catch (_) { /* best effort */ }
              return;
            }
            if (_aliasDepth(requestId) >= MAX_ALIAS_DEPTH) {
              return;
            }
            return await handleQuickQueryEN(
              orch.normalizedCommand,
              From,
              _safeLang(orch.language, detectedLanguage, 'en'),
              `${requestId}:alias-voice`
            );
          }
        } catch (_) { /* noop */ }
        /* END VOICE_HANDLER_PATCH */
               
        // [UNIQ:ORCH-VAR-LOCK-ENTRY-02] keep exact variant
        const langExact = ensureLangExact(orch.language ?? detectedLanguage ?? 'en');

        // [SALES-QA-IDENTITY-ROUTER] short-circuit identity questions (voice path)
         if (orch.identityAsked === true) {
           handledRequests.add(requestId);
           const idLine = identityTextByLanguage(langExact); // Saamagrii.AI stays Latin; "friend" localized
           const tagged = await tagWithLocalizedMode(From, idLine, langExact);
           await sendMessageDedup(From, finalizeForSend(tagged, langExact));
           return;
         }

        // Question → answer & exit
        if (!FORCE_INVENTORY && (orch.isQuestion === true || orch.kind === 'question')) {
          handledRequests.add(requestId);
          const ans = await composeAISalesAnswer(shopId, cleanTranscript, uiLangExact);
          const msg = await t(ans, uiLangExact, `${requestId}::sales-qa-voice`);
          await sendMessageDedup(From, msg);                  
          try {
                  const isActivated = await isUserActivated(shopId);
                  const buttonLang = langExact.includes('-latn') ? langExact.split('-')[0] : langExact; // FIX: use langExact in voice path
                  await sendSalesQAButtons(From, buttonLang, isActivated);
                } catch (e) {
                  console.warn(`[${requestId}] qa-buttons send failed:`, e?.message);
                }                  
        // PAID-CTA: show activation card after the Q&A reply (throttled)
        try { await maybeShowPaidCTAAfterInteraction(From, langExact, { trialIntentNow: isStartTrialIntent(cleanTranscript) }); } catch (_) {}                    
        return;
        }
        // Read‑only normalized command → route & exit
        if (!FORCE_INVENTORY && orch.normalizedCommand) {
            // NEW: “demo” as a terminal command → play video + buttons
              if (orch.normalizedCommand.trim().toLowerCase() === 'demo') {
                handledRequests.add(requestId);
                await sendDemoVideoAndButtons(From, langPinned, `${requestId}::demo`);
                const twiml = new twilio.twiml.MessagingResponse(); twiml.message('');
                res.type('text/xml'); resp.safeSend(200, twiml.toString()); safeTrackResponseTime(requestStart, requestId);
                return;
              }
          handledRequests.add(requestId);
          await routeQuickQueryRaw(orch.normalizedCommand, From, uiLangExact, `${requestId}::ai-norm-voice`);
          try { await maybeShowPaidCTAAfterInteraction(From, langExact, { trialIntentNow: isStartTrialIntent(cleanTranscript) }); } catch (_) {}                        
          return;
        }
      } catch (e) {
        console.warn(`[${requestId}] orchestrator (voice) early-exit error:`, e?.message);
        // fall through gracefully
      }
      
    // First, try to parse as inventory update (higher priority)
    try {
      console.log(`[${requestId}] Attempting to parse as inventory update`);            
        const parsedUpdates = await parseMultipleUpdates({ From, Body: cleanTranscript },requestId);
            if (Array.isArray(parsedUpdates) && parsedUpdates.length > 0) {
        console.log(`[${requestId}] Parsed ${parsedUpdates.length} updates from voice message`);        
         
      // STRICT: render confirmation only AFTER commit results, and only for successful writes.
      const results = await updateMultipleInventory(shopId, parsedUpdates, detectedLanguage);

      // suppress confirmation immediately after a price‑nudge for this shop
      const shopIdLocal = String(From).replace('whatsapp:', '');
      const lastNudgeTs = globalThis.__recentPriceNudge?.get(shopIdLocal) ?? 0;
      const justNudged = lastNudgeTs && (Date.now() - lastNudgeTs) < 5000; // 5s window

      // Only include items that actually succeeded (no pending/nudge placeholders)            
      const processed = Array.isArray(results)
         ? results.filter(r => r?.success && !r.needsPrice && !r.needsUserInput && !r.awaiting)
         : [];

      // Single‑item shortcut (sold/purchased) → only if not just-nudged
      if (!justNudged && processed.length === 1) {
        const x = processed[0];
        const act = String(x.action).toLowerCase();
        if (x.needsPrice || x.awaiting || x.needsUserInput) { /* safety */ return; }
        const common = {
          product: x.product,
          qty: x.quantity,
          unit: x.unitAfter ?? x.unit ?? '',
          pricePerUnit: x.rate ?? x.salePrice ?? x.price ?? null,
          newQuantity: x.newQuantity
        };
        if (act === 'sold') {
          await sendSaleConfirmationOnce(From, detectedLanguage, requestId, common);
          // CTA gated: only last trial day
          try {
            const planInfo = await getUserPlan(shopId);
            const trialEnd = planInfo?.trialEndDate ? new Date(planInfo.trialEndDate) : null;
            const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / (1000*60*60*24)) : null;
            if (planInfo.plan === 'trial' && daysLeft === 1) {
              await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: false });
            }
          } catch (_) {}
          return;
        }
        if (act === 'purchased' && !x.needsPrice && !x.awaiting && !x.needsUserInput) {
          await sendPurchaseConfirmationOnce(From, detectedLanguage, requestId, common);
          // CTA gated: only last trial day
          try {
            const planInfo = await getUserPlan(shopId);
            const trialEnd = planInfo?.trialEndDate ? new Date(planInfo.trialEndDate) : null;
            const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / (1000*60*60*24)) : null;
            if (planInfo.plan === 'trial' && daysLeft === 1) {
              await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: false });
            }
          } catch (_) {}
          return;
        }
      }

      // Aggregated confirmation (only for successful writes, and not right after a price‑nudge)
      if (processed.length > 0) {               
        const header = chooseHeader(processed.length, COMPACT_MODE, /*isPrice*/ false);
            const isSingleReturn = (processed.length === 1) &&
              (String(processed[0].action).toLowerCase() === 'returned');
            let firstLineForReturn = '';
            if (isSingleReturn) {
              const r0 = processed[0];
              let raw0 = r0?.inlineConfirmText ? r0.inlineConfirmText : formatResultLine(r0, COMPACT_MODE, false);
              if (raw0) {
                const needsStock0 = COMPACT_MODE && r0.newQuantity !== undefined && !/\(Stock:/.test(raw0);
                if (needsStock0) raw0 += ` (Stock: ${r0.newQuantity} ${r0.unitAfter ?? r0.unit ?? ''})`;
                firstLineForReturn = raw0.trim();
              }
            }
            let message = isSingleReturn && firstLineForReturn
              ? `${firstLineForReturn}\n\n${header}`
              : header;

        let successCount = 0;                
        for (let i = 0; i < processed.length; i++) {
              const r = processed[i];
              if (isSingleReturn && i === 0) continue; // already placed above
          const rawLine = r?.inlineConfirmText ? r.inlineConfirmText : formatResultLine(r, COMPACT_MODE, false);
          if (!rawLine) continue;
          const needsStock = COMPACT_MODE && r.newQuantity !== undefined && !/\(Stock:/.test(rawLine);
          const stockPart = needsStock ? ` (Stock: ${r.newQuantity} ${r.unitAfter ?? r.unit ?? ''})` : '';
          message += `\n${String(rawLine).trim()}${stockPart}`;
          if (r.success) successCount++;
        }                
        const totalCount = Array.isArray(results) ? results.length : processed.length;
        message += `\n✅ Successfully updated ${successCount} of ${totalCount} items`;
        const formattedResponse = await t(message.trim(), uiLangExact, requestId);
        await sendMessageDedup(From, formattedResponse);
      }
      // else → nothing to confirm (nudged or zero success)         
          // CTA gated: only last trial day
           try {
             const planInfo = await getUserPlan(shopId);
             const trialEnd = planInfo?.trialEndDate ? new Date(planInfo.trialEndDate) : null;
             const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / (1000*60*60*24)) : null;
             if (planInfo.plan === 'trial' && daysLeft === 1) {
               await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: false });
             }
           } catch (_) {}
       return;
      }
    } catch (error) {
      console.warn(`[${requestId}] Failed to parse as inventory update:`, error.message);
    }
    
    // Only if not an inventory update, try quick queries        
    try {
        // Skip quick-query normalization when we're in sticky/txn context
        // or when the voice transcript looks transaction-like (qty+unit+price).
        const stickyAction = await getStickyActionQuick(); // closure version
        const looksTxn = looksLikeTxnLite(cleanTranscript);                
        const isDiag = !!classifyDiagnosticPeek(cleanTranscript);
            if ((stickyAction && !isDiag) || looksTxn) {
              console.log(`[${requestId}] [voice] skipping quick-query in sticky/txn turn (non-diagnostic)`);
            } else {          
      // [PATCH A] Greeting hard-stop in normalization block (exact anchor: "Quick‑query (voice) normalization failed, falling back.")
      // Do NOT normalize pure greetings like "Namaste"/"नमस्ते" — respond and exit early.
      if (_isGreeting(cleanTranscript)) {
        handledRequests.add(requestId);
        const greet = await t(
          '👋 Namaste! Please send your inventory update (e.g., "sold milk 2 ltr" or "purchase Oreo 10 packets").',
          detectedLanguage,
          requestId + '::greet'
        );
        await sendMessageDedup(From, greet);
        return;
      }
          const normalized = await normalizeCommandText(cleanTranscript, detectedLanguage, requestId + ':normalize');
          const handled = await routeQuickQueryRaw(normalized, From, detectedLanguage, requestId);
          if (handled) return; // reply already sent
        }
      } catch (e) {
        console.warn(`[${requestId}] Quick-query (voice) normalization failed, falling back.`, e?.message);
      }
    
    // Check if we're awaiting batch selection
    if (conversationState && conversationState.state === 'awaiting_batch_selection') {
      console.log(`[${requestId}] Awaiting batch selection response from voice`);
      // Check if the transcript contains batch selection keywords
      if (isBatchSelectionResponse(cleanTranscript)) {
        // Send follow-up message via Twilio API
        await client.messages.create({
          body: 'Processing your batch selection...',
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: From
        });
        await handleBatchSelectionResponse(cleanTranscript, From, new twilio.twiml.MessagingResponse(), requestId, conversationState.language);
        return;
      }
    }
    
    // Confidence-based confirmation
    const CONFIDENCE_THRESHOLD = Number(process.env.STT_CONFIDENCE_MIN_VOICE ?? 0.8);
    if (confidence < CONFIDENCE_THRESHOLD) {
      console.log(`[${requestId}] [5.5] Low confidence (${confidence}), requesting confirmation...`);
      
      // FIX: Set confirmation state before sending the request
      await setUserState(shopId, 'confirmation', {
        pendingTranscript: cleanTranscript,
        detectedLanguage,
        confidence,
        type: 'voice_confirmation'
      });
      
      // Send confirmation request via Twilio API
      const confirmationResponse = await confirmTranscript(cleanTranscript, From, detectedLanguage, requestId);
      
      // Extract just the message body from the TwiML
      let messageBody;
      try {
        const bodyMatch = confirmationResponse.match(/<Body>([^<]+)<\/Body>/);
        if (bodyMatch && bodyMatch[1]) {
          messageBody = bodyMatch[1];
        } else {
          // Fallback: If regex fails, try to get the message directly
          messageBody = confirmationResponse.toString();
          // Remove TwiML tags if present
          messageBody = messageBody.replace(/<[^>]*>/g, '').trim();
        }
      } catch (error) {
        console.error(`[${requestId}] Error extracting message body:`, error);
        messageBody = "Please confirm the transcription.";
      }
      
      await client.messages.create({
        body: messageBody,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: From
      });
      try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: isStartTrialIntent(cleanTranscript) }); } catch (_) {}
      return;
    } else {
      console.log(`[${requestId}] [5.5] High confidence (${confidence}), proceeding without confirmation...`);
      
      try {
                
        // Parse the transcript
            const updates = await parseMultipleUpdates({ From, Body: cleanTranscript },requestId);
            // Check if any updates are for unknown products (guard against null)
            const unknownProducts = Array.isArray(updates) ? updates.filter(u => !u.isKnown) : [];

        if (unknownProducts.length > 0) {
          console.log(`[${requestId}] Found ${unknownProducts.length} unknown products, requesting confirmation`);
          
          // FIX: Set confirmation state before sending the request
          await setUserState(shopId, 'confirmation', {
            pendingTranscript: cleanTranscript,
            detectedLanguage,
            confidence: 1.0, // High confidence since we're confirming product
            type: 'product_confirmation',
            unknownProducts
          });
          
          // Confirm the first unknown product via Twilio API
          const confirmationResponse = await confirmProduct(unknownProducts[0], From, detectedLanguage, requestId);
          
          // Extract just the message body from the TwiML
          let messageBody;
          try {
            const bodyMatch = confirmationResponse.match(/<Body>([^<]+)<\/Body>/);
            if (bodyMatch && bodyMatch[1]) {
              messageBody = bodyMatch[1];
            } else {
              // Fallback: If regex fails, try to get the message directly
              messageBody = confirmationResponse.toString();
              // Remove TwiML tags if present
              messageBody = messageBody.replace(/<[^>]*>/g, '').trim();
            }
          } catch (error) {
            console.error(`[${requestId}] Error extracting message body:`, error);
            messageBody = "Please confirm the product update.";
          }
          
          await client.messages.create({
            body: messageBody,
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: From
          });
          try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: isStartTrialIntent(cleanTranscript) }); } catch (_) {}
          return;
        }
        
        // Process the transcription and send result via Twilio API
        
        // Create a mock response object for processConfirmedTranscription
        const mockResponse = {
          message: (msg) => {
            // Extract just the message body from the TwiML
            let messageBody;
            try {
              const bodyMatch = msg.toString().match(/<Body>([^<]+)<\/Body>/);
              if (bodyMatch && bodyMatch[1]) {
                messageBody = bodyMatch[1];
              } else {
                // Fallback: If regex fails, try to get the message directly
                messageBody = msg.toString();
                // Remove TwiML tags if present
                messageBody = messageBody.replace(/<[^>]*>/g, '').trim();
              }
            } catch (error) {
              console.error(`[${requestId}] Error extracting message body:`, error);
              messageBody = "Processing complete.";
            }
            return client.messages.create({
              body: messageBody,
              from: process.env.TWILIO_WHATSAPP_NUMBER,
              to: From
            });
          },
          toString: () => '<Response><Message>Processing complete</Message></Response>'
        };
        
        // Create a mock res object
        const mockRes = {
          send: () => {
            // This is a no-op since we're sending via API
            return Promise.resolve();
          }
        };
        
        await processConfirmedTranscription(
          cleanTranscript,
          From,
          detectedLanguage,
          requestId,
          mockResponse,
          mockRes
        );
      } catch (processingError) {
        console.error(`[${requestId}] Error processing high confidence transcription:`, processingError);
        
        // Send error message via Twilio API
        await client.messages.create({
          body: 'Sorry, I had trouble processing your voice message. Please try again.',
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: From
        });
        try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: isStartTrialIntent(cleanTranscript) }); } catch (_) {}
      }
    }
  } catch (error) {          
      // Log Soniox validation errors when available (helps pinpoint 400 causes).
          if (error?.response?.data) {
            console.error(`[${requestId}] Soniox error body:`, JSON.stringify(error.response.data));
          }
          console.error(`[${requestId}] Error processing voice message:`, error?.message || error);
    
    // Send error message via Twilio API
    await client.messages.create({
      body: 'Sorry, I had trouble processing your voice message. Please try again.',
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: From
    });
  }
}

// Async processing for text messages
async function processTextMessageAsync(Body, From, requestId, conversationState) {
  try {
    console.log(`[${requestId}] [1] Parsing text message: "${Body}"`);
    let __handled = false;
    try { await sendProcessingAckQuickFromText(From, 'text', Body); } catch (_) {}
    
    // --- EARLY GUARD: typed "start trial" intent (same behavior as the button) ---
        try {
          const shopId = fromToShopId(From);
          const planInfo = await getUserPlan(shopId);
          const plan = String(planInfo?.plan ?? '').toLowerCase();
          const trialEnd = planInfo?.trialEndDate ? new Date(planInfo.trialEndDate) : null;
          const isActivated =
            (plan === 'paid') ||
            (plan === 'trial' && (!trialEnd || Date.now() <= trialEnd.getTime()));
          if (!isActivated && isStartTrialIntent(Body)) {
            await activateTrialFlow(From, (conversationState?.language ?? 'en').toLowerCase());
            try { await maybeShowPaidCTAAfterInteraction(From, (conversationState?.language ?? 'en'), { trialIntentNow: true }); } catch {}
            handledRequests.add(requestId); // suppress late parse-error/apology
            return; // exit early, like the "Start Trial" button
          }
        } catch (_) { /* soft-fail: continue */ }
        
    // === NEW: typed "demo" intent (defensive, outside orchestrator) ===
      try {
        const langPinned = String(conversationState?.language ?? 'en').toLowerCase();
        const raw = String(Body ?? '').trim().toLowerCase();
        const demoTokens = [
          'demo','डेमो','ডেমো','டெமோ','డెమో','ಡೆಮೊ','ડેમો',
          'demo please','डेमो देखें','डेमो देखो'
        ];
        if (demoTokens.some(t => raw.includes(t))) {
          await sendDemoVideoAndButtons(From, langPinned, `${requestId}::demo-text`);
          handledRequests.add(requestId);
          return;
        }
      } catch (_) { /* continue */ }
    
    // === FRONT-DOOR SUMMARY GUARD (text path) ===
    const intentAtEntry = resolveSummaryIntent(Body);        
    if (intentAtEntry === 'short summary') {
      await handleQuickQueryEN(
        'short summary',
        From,
        (conversationState?.language || 'en'),
        `${requestId}::text-summary`
      );
      try { await maybeResendListPicker(From, (conversationState?.language ?? 'en'), requestId); } catch (_) {}
      return;
    }
    if (intentAtEntry === 'full summary') {
      await handleQuickQueryEN(
        'full summary',
        From,
        (conversationState?.language || 'en'),
        `${requestId}::text-summary`
      );
      try { await maybeResendListPicker(From, (conversationState?.language ?? 'en'), requestId); } catch (_) {}
      return;
    } 
    
    // Check for common greetings with improved detection
    const lowerBody = Body.toLowerCase();
    
    // Handle numeric responses for product correction
    if (['1', '2', '3', '4'].includes(Body.trim())) {
      const pending = globalState.pendingProductUpdates[From];
      if (!pending) {
        console.log(`[${requestId}] No pending update found for correction response: ${Body.trim()}`);
        return;
      }
      
      console.log(`[${requestId}] Processing correction response: ${Body.trim()} for pending update:`, pending.update);
      
      let correctionType = '';
      let correctionMessage = '';
      
      switch (Body.trim()) {
        case '1':
          correctionType = 'product';
          correctionMessage = 'Please type the correct product name.';
          break;
        case '2':
          correctionType = 'quantity';
          correctionMessage = 'Please type the correct quantity and unit. Example: "5 packets"';
          break;
        case '3':
          correctionType = 'action';
          correctionMessage = 'Please specify if it was purchased, sold, or remaining.';
          break;
        case '4':
          correctionType = 'all';
          correctionMessage = 'Please type the full update. Example: "Milk purchased - 5 litres"';
          break;
      }
      
      console.log(`[${requestId}] Saving correction state to database:`, {
        shopId: From.replace('whatsapp:', ''),
        correctionType,
        pendingUpdate: pending.update,
        detectedLanguage: pending.detectedLanguage
      });
      
      // Save correction state to database
      const shopId = fromToShopId(From);
      const saveResult = await saveCorrectionState(shopId, correctionType, pending.update, pending.detectedLanguage);
      
      if (saveResult.success) {
        console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id}`);
        
        // FIX: Set correction state
        await setUserState(shopId, 'correction', {
          correctionState: {
            correctionType,
            pendingUpdate: pending.update,
            detectedLanguage: pending.detectedLanguage,
            id: saveResult.id
          }
        });
      }
      
      // Send correction message via API
      await client.messages.create({
        body: correctionMessage,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: From
      });
      
      return;
    }      
    
    // --- EARLY: handle 'mode' / localized mode switch --------------------------    
    let found; // ensure availability outside try
      let detectedLanguageMode = 'en';
    
    try {
     found = parseModeSwitchLocalized(Body); // supports: 'mode', 'mode <purchased|sale|return>', localized words
    
      if (found) {
        const shopId = fromToShopId(From);
                 
      // Detect language from this text turn and persist it as the new preference
            detectedLanguageMode = await detectLanguageWithFallback(Body, From, requestId);
            try {
              await saveUserPreference(shopId, detectedLanguageMode);
              console.log(`[${requestId}] Mode-set (text): saved DB language pref to ${detectedLanguageMode}`);
            } catch (e) {
              console.warn(`[${requestId}] Mode-set: saveUserPreference failed:`, e?.message);
            }
    
        // If user only asked to open "mode" UX (no direct set), show welcome flow and exit
        if (!found.set) {
          await sendWelcomeFlowLocalized(From, detectedLanguageMode, requestId);
          return true;
        }
      }
    } catch (_) { /* noop: continue to next paths */ }
    
    // If a direct mode set was detected, apply it and exit early
    if (found?.set) {
      const shopId = fromToShopId(From);
    
      await setStickyMode(From, found.set); // 'purchased' | 'sold' | 'returned'
    
      const badge = getModeBadge(found.set, detectedLanguageMode);
      const ack = await t(
        `✓ ${badge} mode set.\nType product line or press buttons.`,
        detectedLanguageMode,
        `${requestId}::mode-set`
      );
    
      // Resurface Purchase/Sale/Return quick-reply buttons (best effort)
      try {
        await ensureLangTemplates(detectedLanguageMode);
        const sids = getLangSids(detectedLanguageMode);
        if (sids?.quickReplySid) {
          await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.quickReplySid });
        }
      } catch (_) { /* best effort only */ }
    
      await sendMessageViaAPI(From, await tagWithLocalizedMode(From, ack, detectedLanguageMode));
      handledRequests.add(requestId);
      return; // STOP: do not fall into inventory parsing
    }
      
    let isGreeting = false;
    let greetingLang = 'en';
    // Use improved greeting detection
    const detectedGreetingLang = detectGreetingLanguage(Body);
    if (detectedGreetingLang) {
      // FIX: Only treat as greeting if it's primarily a greeting (short message)
      const words = Body.trim().split(/\s+/);
      if (words.length <= 3) {  // Only short messages are considered greetings
        isGreeting = true;
        greetingLang = detectedGreetingLang;
        console.log(`[${requestId}] Detected greeting in language: ${greetingLang}`);
        // Reset conversation state on greeting
        if (globalState.conversationState && globalState.conversationState[From]) {
          delete globalState.conversationState[From];
        }
        // Save user preference
        const shopId = fromToShopId(From);
        await saveUserPreference(shopId, greetingLang);
        console.log(`[${requestId}] Saved language preference: ${greetingLang} for user ${shopId}`);
        
        // FIX: Set greeting state
        await setUserState(shopId, 'greeting', { greetingLang });
        
        // Get user preference
        let userPreference = 'voice'; // Default to voice
        if (globalState.userPreferences[From]) {
          userPreference = globalState.userPreferences[From];
          console.log(`[${requestId}] User preference: ${userPreference}`);
        }
        
        // Use predefined greeting messages to avoid translation API calls
        const greetingMessages = {
          'hi': `नमस्ते! मैं देखता हूं कि आप ${userPreference} द्वारा अपडेट भेजना पसंद करते हैं। आज मैं आपकी कैसे मदद कर सकता हूं?\n\nNamaste! Main dekhta hoon ki aap ${userPreference} dwara update bhejna pasand karte hain. Aaj main aapki kaise madad kar sakta hoon?`,
          'bn': `হ্যালো! আমি দেখতে পাচ্ছি আপনি ${userPreference} দিয়ে আপডেট পাঠাতে পছন্দ করেন। আজ আমি আপনাকে কিভাবে সাহায্য করতে পারি?\n\nHello! Ami dekhte pachchi apni ${userPreference} diye update pathate pochondo koren. Aaj ami apnike kivabe sahaj korte pari?`,
          'ta': `வணக்கம்! நான் பார்க்கிறேன் நீங்கள் ${userPreference} மூலம் புதுப்பிப்புகளை அனுப்புவதை விரும்புகிறீர்கள். இன்று நான் உங்களுக்கு எப்படி உதவ முடியும்?\n\nVanakkam! Naan paarkiren neengal ${userPreference} mulam puthippugalai anupuvathai virumbukireergal. Indru naan ungaluku eppadi utha mudiyum?`,
          'te': `నమస్కారం! నేను చూస్తున్నాను మీరు ${userPreference} ద్వారా నవీకరణలను పంపించడాన్ని ఇష్టపడతారు. నేడు నేను మీకు ఎలా సహాయపడగలను?\n\nNamaskaram! Nenu chustunnanu miru ${userPreference} dwara naveekaralanu pampinchadanni istapadaru. Nedu nenu meeku ela saahayapadagalanu?`,
          'kn': `ನಮಸ್ಕಾರ! ನಾನು ನೋಡುತ್ತಿದ್ದೇನೆ ನೀವು ${userPreference} ಮೂಲಕ ನವೀಕರಣಗಳನ್ನು ಕಳುಹಿಸಲು ಇಷ್ಟಪಡುತ್ತೀರಿ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?\n\nNamaskara! Nanu noduttiddene neevu ${userPreference} moolaka naveekaragannannu kelisu baaasuttiri. Indu nanu nimage hege saahya madabahudu?`,
          'gu': `નમસ્તે! હું જોઉં છું કે તમે ${userPreference} દ્વારા અપડેટ્સ મોકલવાનું પસંદ કરો છો. આજે હું તમને કેવી રીતે મદદ કરી શકું?\n\nNamaste! Hu joo chu ke tame ${userPreference} dwara apdets moklavanu pasand karo cho. Aje hu tamne kavi rite madad kar shakum?`,
          'mr': `नमस्कार! मी पाहतो आपण ${userPreference} द्वारे अपडेट्स पाठवायला पसंत करता. आज मी तुम्हाला कशी मदत करू शकतो?\n\nNamaskar! Mi pahato aapan ${userPreference} dware apdets pathavayala pasant karta. Aaj mi tumhala kashi madad karu shakto?`,
          'en': `Hello! I see you prefer to send updates by ${userPreference}. How can I help you today?`
        };
        
        if (userPreference !== 'voice') {
          const greetingMessage = greetingMessages[greetingLang] || greetingMessages['en'];
          // Send via Twilio API
          await client.messages.create({
            body: greetingMessage,
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: From
          });
          return;
        }
        
        // Use text-based selection instead of buttons for broader compatibility
        const welcomeMessages = {
          'hi': `नमस्ते! आप अपना इन्वेंट्री अपडेट कैसे भेजना चाहेंगे?\n\nजवाब दें:\n• "1" वॉइस मैसेज के लिए\n• "2" टेक्स्ट मैसेज के लिए\n\nNamaste! Aap apna inventory update kaise bhejna chaahenge?\n\nJawaab dein:\n• "1" voice message ke liye\n• "2" text message ke liye`,
          'bn': `স্বাগতম! আপনি কিভাবে আপনার ইনভেন্টরি আপডেট পাঠাতে চান?\n\nউত্তর দিন:\n• "1" ভয়েস মেসেজের জন্য\n• "2" টেক্সট মেসেজের জন্য\n\nSwagatam! Apni kivabe apnar inventory update pathate chan?\n\nUttor din:\n• "1" voice message er jonno\n• "2" text message er jonno`,
          'ta': `வணக்கம்! நீங்கள் உங்கள் இன்வென்டரி புதுப்பிப்பை எப்படி அனுப்ப விரும்புகிறீர்கள்?\n\nபதிலளிக்கவும்:\n• "1" குரல் செய்திக்கு\n• "2" உரை செய்திக்கு\n\nVanakkam! Neengal ungal inventory puthippai eppadi anpu virumbukireergal?\n\nBadhilikavum:\n• "1" kural seithikku\n• "2"urai seithikku`,
          'te': `నమస్కారం! మీరు మీ ఇన్వెంటరీ నవీకరణను ఎలా పంపాలనుకుంటున్నారు?\n\nస్పందించండి:\n• "1" వాయిస్ సందేశం కోసం\n• "2" టెక్స్ట్ సందేశం కోసం\n\nNamaskaram! Meeru mee inventory naveekaranam ela paalana kosamee?\n\nSpandinchandi:\n• "1" voice message kosam\n• "2" text message kosam`,
          'kn': `ನಮಸ್ಕಾರ! ನೀವು ನಿಮ್ಮ ಇನ್ವೆಂಟರಿ ಅಪ್‌ಡೇಟ್ ಅನ್ನು ಹೇಗೆ ಕಳುಹಿಸಲು ಬಯಸುತ್ತೀರಿ?\n\n ಪ್ರತಿಕ್ರಿಯಿಸಿ:\n• "1" ಧ್ವನಿ ಸಂದೇಶಕ್ಕಾಗಿ\n• "2" ಪಠ್ಯ ಸಂದೇಶಕ್ಕಾಗಿ\n\nNamaskara! Neevu nimma inventory update annahege kelisu baaasuttiri?\n\nPratikriyisi:\n• "1" dhwani sandeshakkaagi\n• "2" patya sandeshakkaagi`,
          'gu': `નમસ્તે! તમે તમારું ઇન્વેન્ટરી અપડેટ કેવી રીતે મોકલવા માંગો છો?\n\n જવાબ આપો:\n• "1" વોઇસ મેસેજ માટે\n• "2" ટેક્સ્ટ મેસેજ માટે\n\nNamaste! Tame tamaru inventory update kevi rite moklava mango cho?\n\nJawaab aapo:\n• "1" voice message maate\n• "2" text message maate`,
          'mr': `नमस्कार! तुम्ही तुमचे इन्व्हेन्टरी अपडेट कसे पाठवायला इच्छिता?\n\n उत्तर द्या:\n• "1" व्हॉइस मेसेज साठी\n• "2" मजकूर मेसेज साठी\n\nNamaskar! Tumhi tumche inventory update kase pathavayla ichhita?\n\nUttar dya:\n• "1" voice message sathi\n• "2" majkur message sathi`,
          'en': `Welcome! How would you like to send your inventory update?\n\nReply:\n• "1" for Voice Message\n• "2" for Text Message`
        };
        
        const welcomeMessage = welcomeMessages[greetingLang] || welcomeMessages['en'];
        // Send via Twilio API
        await client.messages.create({
          body: welcomeMessage,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: From
        });
        return;
      }
    }
    
    // Check if we're awaiting batch selection
    if (conversationState && conversationState.state === 'awaiting_batch_selection') {
      console.log(`[${requestId}] Awaiting batch selection response`);
      if (isBatchSelectionResponse(Body)) {
        await handleBatchSelectionResponse(Body, From, new twilio.twiml.MessagingResponse(), requestId, conversationState.language);
        return;
      } else if (isExpiryDateUpdate(Body)) {
        await handleExpiryDateUpdate(Body, From, new twilio.twiml.MessagingResponse(), requestId, conversationState.language);
        return;
      }
    }
    
    // Detect language and save preference    
    // Always detect from text and override DB preference with this turn's language
    let detectedLanguage = await detectLanguageWithFallback(Body, From, requestId);
    
    // Persist the override (update user pref to this language)
    try {
      await saveUserPreference(fromToShopId(From), detectedLanguage);
      console.log(`[${requestId}] Text turn: saved DB language pref to ${detectedLanguage}`);
    } catch (e) {
      console.warn(`[${requestId}] Text turn: saveUserPreference failed:`, e?.message);
    }

    detectedLanguage = await checkAndUpdateLanguage(Body, From, detectedLanguage, requestId);
    console.log(`[${requestId}] Detected language for text update: ${detectedLanguage}`);
    
    // [PATCH A - TEXT PATH] Greeting hard-stop before any quick-query normalization/route
    // Prevent "Namaste"/"नमस्ते"/"hello" etc. from being normalized into commands like "short summary".
    if (_isGreeting(Body)) {
      handledRequests.add(requestId);
      const greetMsg = await t(
        '👋 Namaste! Please send your inventory update (e.g., "sold milk 2 ltr" or "purchase Oreo 10 packets").',
        detectedLanguage,
        requestId + '::greet-text'
      );
      await sendMessageDedup(From, greetMsg);
      try { await maybeResendListPicker(From, detectedLanguage, requestId); } catch (_) { /* best effort */ }
      return; // exit text handler early, no normalization
    }       
    
    // Hybrid: allow non‑mutating diagnostic peeks inside sticky mode (no state change)
      try {
        const stickyAction =
          typeof getStickyActionQuick === 'function'
            ? (getStickyActionQuick.length > 0 ? await getStickyActionQuick(From) : await getStickyActionQuick())
            : null;
        const isPeek = !!classifyDiagnosticPeek(Body);                
        if (ALLOW_READONLY_IN_STICKY && stickyAction && isPeek) {
           const ok = await handleDiagnosticPeek(From, Body, requestId, stickyAction);
           if (ok) {
             try {
               const langForUi = String(detectedLanguage ?? (conversationState?.language ?? 'en')).toLowerCase();
               await maybeResendListPicker(From, langForUi, requestId);
             } catch (_) { /* best effort */ }
             return; // reply already sent via API; keep mode; stop text flow
           }
         }
      } catch (_) { /* best-effort */ }

    // Heartbeat: keep sticky mode fresh while user is active
      try {
        const st = typeof getUserStateFromDB === 'function' ? await getUserStateFromDB(fromToShopId(From)) : null;
        if (st && st.mode === 'awaitingTransactionDetails' && typeof refreshUserStateTimestamp === 'function') {
          await refreshUserStateTimestamp(fromToShopId(From));
        }
      } catch (_) {}
     
    // --- Minimal hook: Activate Paid Plan command (text path) ---
    const lowerBodyCmd = String(Body || '').trim().toLowerCase();
    if (
      lowerBodyCmd === 'activate paid' ||
      lowerBodyCmd === 'paid' ||
      /activate\s+paid/i.test(lowerBodyCmd) ||
      /start\s+paid/i.test(lowerBodyCmd)
    ) {
      await sendPaidPlanCTA(From, detectedLanguage || 'en');
      return;
    }
              
        // PATCH: Run orchestration and parse in parallel; use parse result immediately for txn handling
         const orchPromise = applyAIOrchestration(Body, From, detectedLanguage, requestId);
         const parsedPromise = parseMultipleUpdates({ From, Body }, requestId);
         let parsedUpdatesEarly = [];
         try { parsedUpdatesEarly = await parsedPromise; } catch (_) {}
         try {
          const orch = await orchPromise;
          const FORCE_INVENTORY = !!orch?.forceInventory;
        // --- BEGIN TEXT HANDLER INSERT ---
        /* TEXT_HANDLER_PATCH */
        try {
          if (typeof orch !== 'undefined' && orch && orch.normalizedCommand) {
            const normalized = String(orch.normalizedCommand).toLowerCase();
            // Terminal → dispatch once, stop
            if (_isTerminalCommand(normalized)) {
              handledRequests.add(requestId); // suppress late parse-error/apology
              await handleQuickQueryEN(
                normalized,
                From,
                _safeLang(orch.language, detectedLanguage, 'en'),
                `${requestId}::terminal`
              );                          
            // B: Immediately resurface the Inventory List-Picker after terminal command
                      try {
                        const langForUi = _safeLang(orch.language, detectedLanguage, 'en');
                        await maybeResendListPicker(From, langForUi, requestId);
                      } catch (_) { /* best effort */ }
              return true;
            }
            // Alias-depth guard → do not recurse past cap
            if (_aliasDepth(requestId) >= MAX_ALIAS_DEPTH) {
              return true;
            }
            // Non-terminal normalized command → single hop
            return await handleQuickQueryEN(
              orch.normalizedCommand,
              From,
              _safeLang(orch.language, detectedLanguage, 'en'),
              `${requestId}:alias`
            );
          }
        } catch (_) { /* noop: fall through to existing paths */ }
        /* END TEXT_HANDLER_PATCH */

                
        // [UNIQ:ORCH-VAR-LOCK-ENTRY-01] keep exact variant
        const langExact = ensureLangExact(orch.language ?? detectedLanguage ?? 'en');
        
        // --- NEW: single-update fast path with parallel translation + DB update ---
            if (Array.isArray(parsedUpdatesEarly) && parsedUpdatesEarly.length === 1 && (FORCE_INVENTORY || !orch.isQuestion)) {
              const u = parsedUpdatesEarly[0];
              // Compose a minimal confirmation body (no stock suffix) from parsed update
              const baseBody =
                (String(u.action).toLowerCase() === 'sold'
                  ? composeSaleConfirmation({ product: u.productDisplay ?? u.product, qty: u.quantity, unit: u.unit, pricePerUnit: u.pricePerUnit, newQuantity: undefined })
                  : composePurchaseConfirmation({ product: u.productDisplay ?? u.product, qty: u.quantity, unit: u.unit, pricePerUnit: u.pricePerUnit, newQuantity: undefined }));
              // Start translation immediately while DB update runs
              const translateP = t(baseBody, langExact, `${requestId}::confirm-base`);
              // Kick DB update in parallel (single-item array)
              const shopIdLocal = fromToShopId(From);
              const dbP = updateMultipleInventory(shopIdLocal, [u], langExact);
              const dbRes = await dbP;                 // wait for DB only
              const r     = (dbRes || [])[0] || {};    // first result              
               if (!r?.success || r?.needsPrice || r?.awaiting || r?.needsUserInput) {
                 // Do not send a confirmation body if price is missing or further input is needed
                 return;
               }
              const unit  = u.unit ?? r.unitAfter ?? r.unit ?? '';
              const stockSuffix = (r?.newQuantity != null) ? ` (Stock: ${r.newQuantity} ${unit})` : '';
              const finalBody   = `${await translateP}${stockSuffix}`;
              await _sendConfirmOnceByBody(From, langExact, requestId, finalBody);
              try { await clearUserState(From); } catch (_){}
              try { await maybeShowPaidCTAAfterInteraction(From, langExact, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_){}
              handledRequests.add(requestId);
              return; // stop here; heavy work already done
            }

        // Question → answer & exit
        if (!FORCE_INVENTORY && (orch.isQuestion === true || orch.kind === 'question')) {
          handledRequests.add(requestId);
          const shopId = fromToShopId(From);
          const ans  = await composeAISalesAnswer(shopId, Body, langExact);
          const msg0 = await tx(ans, langExact, From, Body, `${requestId}::sales-qa-text`);
          const msg  = nativeglishWrap(msg0, langExact);
          await sendMessageDedup(From, msg);
            __handled = true;
          try {                          
            // Defensive: derive button language safely using detected preference
                    const isActivated = await isUserActivated(shopId);
                    let buttonLang = langExact;
                    try {
                      const pref = await getUserPreference(shopId);
                      if (pref?.success && pref.language) buttonLang = String(pref.language).toLowerCase();
                    } catch { /* best effort */ }
              await sendSalesQAButtons(From, buttonLang, isActivated);
            } catch (e) {
              console.warn(`[${requestId}] qa-buttons send failed:`, e?.message);
            }
            try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}                        
          return;
        }
        // Read‑only normalized command → route & exit
        if (!FORCE_INVENTORY && orch.normalizedCommand) {
            // NEW: “demo” as a terminal command → play video + buttons
              if (orch.normalizedCommand.trim().toLowerCase() === 'demo') {
                handledRequests.add(requestId);
                await sendDemoVideoAndButtons(From, detectedLanguage, `${requestId}::demo`);
                const twiml = new twilio.twiml.MessagingResponse(); twiml.message('');
                res.type('text/xml'); resp.safeSend(200, twiml.toString()); safeTrackResponseTime(requestStart, requestId);
                return;
              }
          handledRequests.add(requestId);                     
          // NEW: Localize low-stock section explicitly
              const cmd = String(orch.normalizedCommand).toLowerCase().trim();                            
              // NEW: alias slugs to canonical commands
                 if (cmd === 'list_low') cmd = 'low stock';
                 if (cmd === 'list_short_summary') cmd = 'short summary';
              if (cmd === 'low stock' || cmd === 'कम स्टॉक') {
                const shopId = String(From).replace('whatsapp:', '');
                try {
                  const low = await composeLowStockLocalized(shopId, langExact, `${requestId}::low-stock`);
                  await sendMessageDedup(From, low);
                } catch (e) {
                  console.warn('[low-stock] compose failed:', e?.message);
                  // Fallback to previous path
                  await routeQuickQueryRaw(orch.normalizedCommand, From, langExact, `${requestId}::ai-norm-text`);
                }
                _handled = true;
                return;
              }
              await routeQuickQueryRaw(orch.normalizedCommand, From, langExact, `${requestId}::ai-norm-text`);
          __handled = true;
          try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}          
          return;
        }
      } catch (e) {
        console.warn(`[${requestId}] orchestrator early-exit error:`, e?.message);
        // fall through gracefully
      }
      console.log(`[${requestId}] Attempting to parse as inventory update`);
    
    
    // First, try to parse as inventory update (higher priority)          
    // COPILOT-PATCH-TEXT-PARSE-FROM-1
      const parsedUpdates = await parseMultipleUpdates({ From, Body },requestId); // pass req-like object with From
      if (Array.isArray(parsedUpdates) && parsedUpdates.length > 0) {
      console.log(`[${requestId}] Parsed ${parsedUpdates.length} updates from text message`);          
         
    // Process inventory updates here - STRICT rendering AFTER results
     const shopId = fromToShopId(From);
     const results = await updateMultipleInventory(shopId, parsedUpdates, detectedLanguage);
     // suppress confirmation immediately after a price-nudge for this shop
     const shopIdLocal = String(From).replace('whatsapp:', '');
     const lastNudgeTs = globalThis.__recentPriceNudge?.get(shopIdLocal) ?? 0;
     const justNudged = lastNudgeTs && (Date.now() - lastNudgeTs) < 5000; // 5s window
    
     // Only include items that actually succeeded         
    const processed = Array.isArray(results)
       ? results.filter(r => r?.success && !r.needsPrice && !r.needsUserInput && !r.awaiting)
       : [];
    
     // Single-item shortcut (sold/purchased) → only if not just-nudged
     if (!justNudged && processed.length === 1) {
       const x = processed[0];
       const act = String(x.action).toLowerCase();
       if (x.needsPrice || x.awaiting || x.needsUserInput) return;
       const common = {
         product: x.product,
         qty: x.quantity,
         unit: x.unitAfter ?? x.unit ?? '',
         pricePerUnit: x.rate ?? x.salePrice ?? x.price ?? null,
         newQuantity: x.newQuantity
       };
       if (act === 'sold')  { await sendSaleConfirmationOnce(From, detectedLanguage, requestId, common); return; }
       if (act === 'purchased' && !x.needsPrice && !x.awaiting && !x.needsUserInput) { await sendPurchaseConfirmationOnce(From, detectedLanguage, requestId, common); return; }
     }
    
     // Aggregated confirmation (only for successful writes, and not right after a price-nudge)
     if (processed.length > 0) {            
     const header = chooseHeader(processed.length, COMPACT_MODE, /*isPrice*/ false);
         // Return-only: place the per-item line BEFORE header when it's a single-item return
          const isSingleReturn = (processed.length === 1) &&
            (String(processed[0].action).toLowerCase() === 'returned');
      
          // Precompute the first line with stock tail if needed (single return case)
          let firstLineForReturn = '';
          if (isSingleReturn) {
            const r0 = processed[0];
            let raw0 = r0?.inlineConfirmText ? r0.inlineConfirmText : formatResultLine(r0, COMPACT_MODE, false);
            if (raw0) {
              const needsStock0 = COMPACT_MODE && r0.newQuantity !== undefined && !/\(Stock:/.test(raw0);
              if (needsStock0) raw0 += ` (Stock: ${r0.newQuantity} ${r0.unitAfter ?? r0.unit ?? ''})`;
              firstLineForReturn = raw0.trim();
            }
          }
      
          let message = isSingleReturn && firstLineForReturn
            ? `${firstLineForReturn}\n\n${header}`
            : header;

       let successCount = 0;               
       for (let i = 0; i < processed.length; i++) {
              const r = processed[i];
              // Skip the first loop append when we've already placed the single Return line above
              if (isSingleReturn && i === 0) {
                successCount += r?.success ? 1 : 0;
                continue;
              }
         const rawLine = r?.inlineConfirmText ? r.inlineConfirmText : formatResultLine(r, COMPACT_MODE, false);
         if (!rawLine) continue;
         const needsStock = COMPACT_MODE && r.newQuantity !== undefined && !/\(Stock:/.test(rawLine);
         const stockPart = needsStock ? ` (Stock: ${r.newQuantity} ${r.unitAfter ?? r.unit ?? ''})` : '';
         message += `\n${String(rawLine).trim()}${stockPart}`;
         if (r.success) successCount++;
       }
       message += `\n✅ Successfully updated ${successCount} of ${processed.length} items`;
       const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
       await sendMessageDedup(From, formattedResponse);
     } // else → nothing to confirm (nudged or zero success)
        __handled = true;                
        // CTA gated: only last trial day
         try {
           const planInfo = await getUserPlan(shopId);
           const trialEnd = planInfo?.trialEndDate ? new Date(planInfo.trialEndDate) : null;
           const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / (1000*60*60*24)) : null;
           if (planInfo.plan === 'trial' && daysLeft === 1) {
             await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: false });
           }
         } catch (_) {}
     return;
    } else {
      console.log(`[${requestId}] Not a valid inventory update, checking for specialized operations`);          
          
    // Only if not an inventory update AND NOT in sticky/txn context, try quick queries
      try {
        const stickyAction = await getStickyActionQuick();
        const looksTxn = looksLikeTxnLite(Body);              
        const isDiag = !!classifyDiagnosticPeek(Body);
              if ((stickyAction && !isDiag) || looksTxn) {
                console.log(`[${requestId}] Skipping quick-query routing in sticky/txn turn (non-diagnostic)`);
              } else {
            const normalized = await normalizeCommandText(Body, detectedLanguage, requestId + ':normalize');
            // If normalization produced "start trial", do NOT route as a quick query—activate now.
            if (/^start\s+trial$/i.test(String(normalized))) {
              const shopId = fromToShopId(From);
              try {
                const planInfo = await getUserPlan(shopId);
                const plan = String(planInfo?.plan ?? '').toLowerCase();
                const trialEnd = planInfo?.trialEndDate ? new Date(planInfo.trialEndDate) : null;
                const isActivated = (plan === 'paid') || (plan === 'trial' && (!trialEnd || Date.now() <= trialEnd.getTime()));
                if (!isActivated) {
                  await activateTrialFlow(From, (detectedLanguage ?? 'en').toLowerCase());
                  try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: true }); } catch {}
                  __handled = true;
                  handledRequests.add(requestId);
                  return;
                }
              } catch (_) { /* continue to normal routing if any error */ }
            }
            const handledQuick = await routeQuickQueryRaw(normalized, From, detectedLanguage, requestId);
            if (handledQuick) {
              __handled = true;
              handledRequests.add(requestId);
              return;
            }
          }              
        } catch (e) {
          // Harden against accidental undefined references in quick-query helpers
          console.warn(`[${requestId}] Quick-query (normalize) routing failed; continuing.`, e?.message);
        }
    }
    

    // If we get here, it's not a valid inventory update and not a quick query
     // Check if any updates are for unknown products (use parsedUpdates from above)
     const unknownProducts = Array.isArray(parsedUpdates)
       ? parsedUpdates.filter(u => !u.isKnown)
       : [];
    if (unknownProducts.length > 0) {
      console.log(`[${requestId}] Found ${unknownProducts.length} unknown products, requesting confirmation`);
      
      // FIX: Set confirmation state before sending the request
      await setUserState(shopId, 'confirmation', {
        pendingTranscript: Body,
        detectedLanguage,
        confidence: 1.0, // High confidence since we're confirming product
        type: 'product_confirmation',
        unknownProducts
      });
      
      // Confirm the first unknown product
      const confirmationResponse = await confirmProduct(unknownProducts[0], From, detectedLanguage, requestId);
      
      // Extract message body with error handling
      let messageBody;
      try {
        const bodyMatch = confirmationResponse.match(/<Body>([^<]+)<\/Body>/);
        if (bodyMatch && bodyMatch[1]) {
          messageBody = bodyMatch[1];
        } else {
          // Fallback: If regex fails, try to get the message directly
          messageBody = confirmationResponse.toString();
          // Remove TwiML tags if present
          messageBody = messageBody.replace(/<[^>]*>/g, '').trim();
        }
      } catch (error) {
        console.error(`[${requestId}] Error extracting message body:`, error);
        messageBody = "Please confirm the product update.";
      }
      
      await client.messages.create({
        body: messageBody,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: From
      });
      try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}
      return;
    }
    
    // Create a mock response object for processConfirmedTranscription
    const mockResponse = {
      message: (msg) => {
        // Extract just the message body from the TwiML
        let messageBody;
        try {
          const bodyMatch = msg.toString().match(/<Body>([^<]+)<\/Body>/);
          if (bodyMatch && bodyMatch[1]) {
            messageBody = bodyMatch[1];
          } else {
            // Fallback: If regex fails, try to get the message directly
            messageBody = msg.toString();
            // Remove TwiML tags if present
            messageBody = messageBody.replace(/<[^>]*>/g, '').trim();
          }
        } catch (error) {
          console.error(`[${requestId}] Error extracting message body:`, error);
          messageBody = "Processing complete.";
        }
        return sendMessageViaAPI(From, messageBody);
      },
      toString: () => '<Response><Message>Processing complete</Message></Response>'
    };
    
    // Create a mock res object
    const mockRes = {
      send: () => {
        // This is a no-op since we're sending via API
        return Promise.resolve();
      }
    };
    
    await processConfirmedTranscription(
      Body,
      From,
      detectedLanguage,
      requestId,
      mockResponse,
      mockRes
    );
    
    // If we get here, it's not a valid inventory update
    console.log(`[${requestId}] Not a valid inventory update, checking for specialized operations`);
    
    // Get user preference
    let userPreference = 'voice'; // Default to voice
    if (globalState.userPreferences[From]) {
      userPreference = globalState.userPreferences[From];
      console.log(`[${requestId}] User preference: ${userPreference}`);
    }
    
    const defaultMessage = userPreference === 'voice'
      ? '🎤 Send inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.\n\nTo switch to text input, reply "switch to text".'
      : '📝 Type your inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.\n\nTo switch to voice input, reply "switch to voice".';
              
    // Only send the generic default if nothing else handled AND it is not a sticky/transaction turn
      if (!__handled) {
        const stickyAction3 = await getStickyActionQuick();
        const looksTxn3 = looksLikeTxnLite(Body);                
        const isDiag = !!classifyDiagnosticPeek(Body);
            if ((stickyAction3 && !isDiag) || looksTxn3) {
          console.log(`[${requestId}] Suppressing generic default in sticky/txn turn [text]`);
        } else {
          const translatedMessage = await t(defaultMessage, detectedLanguage, requestId);
          await sendMessageViaAPI(From, translatedMessage);
          try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}
        }
      }
    
  } catch (error) {
    console.error(`[${requestId}] Error processing text message:`, error);
    // Send error message via Twilio API        
    // STEP 6: global tail/apology guard — if a response was already sent, skip
    try { if (handledRequests.has(requestId)) return; } catch (_) {}
    await client.messages.create({
      body: 'Sorry, I had trouble processing your message. Please try again.',
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: From
    });
    try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}
  }
}


// Main handler (exported as default). We attach helper functions below.
 const whatsappHandler = async (req, res) => {
  const requestStart = Date.now();
  const response = new twilio.twiml.MessagingResponse();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;    
  // STEP 2: single-response guard for the webhook
  const resp = makeSafeResponder(res);
  try { cleanupCaches(); } catch (_) {}

  // --- Extract inbound fields early (so helpers can use them) ---
  let Body =
    (req.body && (req.body.Body || req.body.body)) || '';
  const From =
    (req.body && (req.body.From || req.body.from)) ||
    (req.body && req.body.WaId ? `whatsapp:${req.body.WaId}` : '');
  const shopId = fromToShopId(From);
  let __handled = false;
  
  // --- NEW: in-memory per-request dedupe guard (keep near the top) ---
  globalThis.handledRequests = globalThis.handledRequests || new Set();
  const hasBeenHandled = () => globalThis.handledRequests.has(requestId);
  const markHandled    = () => globalThis.handledRequests.add(requestId);

  // --- NEW: single-source inventory ack builder --- 
 async function sendInventoryAck(toWhatsApp, results, languageCode) {
   try {
     // NEW: suppress immediately after any recent price-nudge for this shop
     const shopId = String(toWhatsApp).replace('whatsapp:', '');
     const lastNudgeTs = globalThis.__recentPriceNudge?.get(shopId) ?? 0;
     const justNudged = lastNudgeTs && (Date.now() - lastNudgeTs) < 5000; // 5s window

     // Only confirm successful writes; skip pending/nudges         
    const lines = Array.isArray(results)
       ? results
         .filter(r => r?.success && !r.needsPrice && !r.awaiting && !r.needsUserInput)
         .map(r => r?.inlineConfirmText)
         .filter(Boolean)
       : [];

     if (justNudged || lines.length === 0) return;

     const body = lines.join('\n');
     await sendMessageViaAPI(toWhatsApp, finalizeForSend(body, languageCode));
   } catch (e) {
     console.warn('[router] inventory ack send failed:', e?.message);
   }
 }
  try {
      const NumMedia = Number(req.body?.NumMedia ?? 0);
      const ct0 = String(req.body?.MediaContentType0 ?? '').toLowerCase();
      const isAudio = NumMedia > 0 && /audio|ogg|opus|m4a|mp3|wav/.test(ct0);
      if (isAudio) {
        sendProcessingAckQuickFromText(From, 'voice', Body).catch(() => {});
      } else {
        // For plain text and non-audio media, send text ack ultra-early
        sendProcessingAckQuickFromText(From, 'text', Body).catch(() => {});
      }
    } catch { /* non-blocking */ }

  // (optional) quick log to confirm gate path in prod logs        
    try { 
      console.log('[webhook]', { From, shopId, Body: String(Body).slice(0,120) });
      globalThis.__lastPostTs = Date.now(); 
    } catch(_) {}
    
    // --- AUDIO-FIRST GATE (WhatsApp voice notes) ---
    // Route audio media to processVoiceMessageAsync BEFORE any text/interactive flow.
    const NumMedia = Number(req.body?.NumMedia || 0);
    const MediaUrl0 = req.body?.MediaUrl0 || req.body?.MediaUrl || '';
    const MediaContentType0 = String(req.body?.MediaContentType0 || req.body?.MediaContentType || '').toLowerCase();
    
    // Accept common WhatsApp audio types, including Opus-in-OGG
    const isAudio =
      NumMedia > 0 &&
      (
        MediaContentType0.startsWith('audio/') ||
        MediaContentType0.includes('audio/ogg') ||
        MediaContentType0.includes('codecs=opus')
      );
    
    // Optionally pull conversation state early (so voice handler can use it)
    let conversationState = null;
    try {         
    const shopIdCheck = fromToShopId(From);
        conversationState = (typeof getUserStateFromDB === 'function')
          ? await getUserStateFromDB(shopIdCheck)
          : await getUserState(shopIdCheck);
        // Heartbeat: keep sticky mode fresh for voice turns too
        if (conversationState && conversationState.mode === 'awaitingTransactionDetails' && typeof refreshUserStateTimestamp === 'function') {
          await refreshUserStateTimestamp(shopIdCheck);
        }
    } catch (_) { /* best-effort */ }
    
    if (isAudio && MediaUrl0) {
      try {
        console.log(`[${requestId}] [0] Routing to voice handler (NumMedia=${NumMedia}, ct=${MediaContentType0})`);
        await processVoiceMessageAsync(MediaUrl0, From, requestId, conversationState);
      } catch (e) {
        console.error(`[${requestId}] voice handler error:`, e?.message);
        // Fall through to minimal ack; downstream catch-all will not fire because we return here.
      }
    
      // Minimal TwiML ack to satisfy webhook single-response guard
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('');
      res.type('text/xml');
      resp.safeSend(200, twiml.toString());
      safeTrackResponseTime(requestStart, requestId);
      return; // EARLY EXIT: do not continue to text/interactive flow
    }
    // --- END AUDIO-FIRST GATE ---
  
    /**
       * NEW: Inbound sanitization to drop footer echoes & interactive noise.
       * Prevents noisy bodies like «कोई • मोड» (mode badges) and interactive echoes
       * from falling through to generic error paths.
       */
      try {
        const sanitized = sanitizeInbound(
          Body,
          req.body?.NumMedia,
          {
            button_reply: req.body?.ButtonPayload || req.body?.ButtonId,
            list_reply: req.body?.ListResponse || req.body?.List || req.body?.Interactive
          }
        );
        if (!sanitized) {
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message(''); // quiet ack; we intentionally ignore noise
          res.type('text/xml');
          resp.safeSend(200, twiml.toString());
          safeTrackResponseTime(requestStart, requestId);
          return;
        }
        Body = sanitized;
      } catch (_) { /* best-effort */ }

  /**
     * >>> NEW (Option B): Handle WhatsApp interactive events FIRST.
     * Processes Quick‑Reply button taps (ButtonPayload/ButtonText)
     * and List‑Picker selections (ListPickerSelection/SelectedListItem)
     * before doing language detection or any free‑text parsing.
     *
     * Why first? Twilio posts button/list selections to the same Incoming
     * Message Webhook as normal messages. Handling them up front prevents
     * them from falling through into free‑text logic.  
     */
    try {
      if (await handleInteractiveSelection(req)) {
        // We already replied using the Programmable Messaging API.
        // Return a minimal TwiML response to acknowledge the webhook.
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message('');                
        res.type('text/xml');
        resp.safeSend(200, twiml.toString());
        safeTrackResponseTime(requestStart, requestId);
        return;
      }
    } catch (e) {
      console.warn(`[${requestId}] interactiveSelection handler error:`, e.message);
      // Continue with normal text flow if something goes wrong.
    }
         
    // Language detection for TEXT turns: always persist the detected language
      const detectedLanguage = await detectLanguageWithFallback(Body, From, requestId);
      console.log(`[${requestId}] Detected language (text): ${detectedLanguage}`);
      try {
        await saveUserPreference(fromToShopId(From), detectedLanguage);
      } catch (e) {
        console.warn(`[${requestId}] Webhook text: saveUserPreference failed:`, e?.message);
      }
    
    // Single bounded sticky fetch up-front; pass it to orchestrator to avoid re-fetch.
    const stickyActionCached = await withTimeout(
      (typeof getStickyActionQuick === 'function'
        ? (getStickyActionQuick.length > 0 ? getStickyActionQuick(From) : getStickyActionQuick())
        : Promise.resolve(null)),
      150, // ms
      () => null
    );
    
    // Trial intent gate: only fetch plan when Body truly looks like "trial".
    try {
      if (isStartTrialIntent(Body)) {
        const planInfo = await withTimeout(getUserPlan(fromToShopId(From)), 500, () => null);
        const plan = String(planInfo?.plan ?? '').toLowerCase();
        const trialEnd = planInfo?.trialEndDate ? new Date(planInfo.trialEndDate) : null;
        const isActivated = (plan === 'paid') || (plan === 'trial' && (!trialEnd || Date.now() <= trialEnd.getTime()));
        if (!isActivated) {
          await activateTrialFlow(From, String(detectedLanguage ?? 'en').toLowerCase());
          try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: true }); } catch {}
          handledRequests.add(requestId);
          const twiml = new twilio.twiml.MessagingResponse(); twiml.message('');
          res.type('text/xml'); resp.safeSend(200, twiml.toString());
          safeTrackResponseTime(requestStart, requestId);
          return; // consume this turn
        }
      }
    } catch { /* best-effort; continue */ }

      // Hybrid: allow non‑mutating diagnostic peeks inside sticky mode (no state change)
        if (ALLOW_READONLY_IN_STICKY) {
          try {
            const stickyAction =
              typeof getStickyActionQuick === 'function'
                ? (getStickyActionQuick.length > 0 ? await getStickyActionQuick(From) : await getStickyActionQuick())
                : null;
            const isPeek = !!classifyDiagnosticPeek(Body);                      
            if (stickyAction && isPeek) {
               const ok = await handleDiagnosticPeek(From, Body, requestId, stickyAction);
               if (ok) {
                 // Immediately resurface the inventory List-Picker in the same turn
                 try {
                   const langForUi = String(detectedLanguage ?? 'en').toLowerCase();
                   await maybeResendListPicker(From, langForUi, requestId);
                 } catch (_) { /* best effort */ }
                 const twiml = new twilio.twiml.MessagingResponse(); twiml.message('');
                 res.type('text/xml'); resp.safeSend(200, twiml.toString());
                 safeTrackResponseTime(requestStart, requestId);
                 return; // early exit (reply sent via API)
               }
             }
          } catch (_) { /* best-effort */ }
        }

      // === NEW: typed "demo" intent (defensive, outside orchestrator) ===
          try {
            const langPinned = String(detectedLanguage ?? 'en').toLowerCase();
            const raw = String(Body ?? '').trim().toLowerCase();
            const demoTokens = [
              'demo','डेमो','ডেমো','டெமோ','డెమో','ಡೆಮೊ','ડેમો',
              'demo please','डेमो देखें','डेमो देखो'
            ];
            if (demoTokens.some(t => raw.includes(t))) {
              await sendDemoVideoAndButtons(From, langPinned, `${requestId}::demo-typed`);
              // Minimal TwiML ack; Content/PM API already replied
              const twiml = new twilio.twiml.MessagingResponse(); twiml.message('');
              res.type('text/xml');
              resp.safeSend(200, twiml.toString());
              safeTrackResponseTime(requestStart, requestId);
              return;
            }
          } catch (_) { /* best-effort; continue */ }
        
      // --- Typed "start trial" guard (webhook level, plain text) ---
      // Run after language detection so we can respond in the user's script.
      // Only triggers when the user is NOT already activated; button flow remains unchanged.
      try {
        const shopId = fromToShopId(From);
        const planInfo = await getUserPlan(shopId);
        const plan = String(planInfo?.plan ?? '').toLowerCase();
        const trialEnd = planInfo?.trialEndDate ? new Date(planInfo.trialEndDate) : null;
        const isActivated =
          (plan === 'paid') ||
          (plan === 'trial' && (!trialEnd || Date.now() <= trialEnd.getTime()));
        if (!isActivated && isStartTrialIntent(Body)) {
          await activateTrialFlow(From, (detectedLanguage ?? 'en').toLowerCase());
          try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: true }); } catch {}
          handledRequests.add(requestId);
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message('');
          res.type('text/xml');
          resp.safeSend(200, twiml.toString());
          safeTrackResponseTime(requestStart, requestId);
          return;
        }
      } catch { /* best-effort; continue */ }
  
    // 🔒 Front-door guard: if user is in onboarding capture, consume turn here
      try {
        const shopIdCheck = fromToShopId(From);
        const s = (typeof getUserStateFromDB === 'function')
          ? await getUserStateFromDB(shopIdCheck)
          : await getUserState(shopIdCheck);
        if (s && (s.mode === 'onboarding_trial_capture' || s.mode === 'onboarding_paid_capture')) {   
        // NEW: keep the session language on code-like inputs (GSTIN, etc.)
          const pref = await getUserPreference(shopId).catch(() => ({ language: 'en' }));
          const currentLang = String(pref?.language ?? 'en').toLowerCase();
          const langForStep = await checkAndUpdateLanguageSafe(String(Body ?? ''), From, currentLang, requestId);                  
        if (s.mode === 'onboarding_trial_capture') {
              await handleTrialOnboardingStep(From, Body, langForStep, requestId);
            } else {
              await handlePaidOnboardingStep(From, Body, langForStep, requestId);
            }
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message('');
          res.type('text/xml');
          resp.safeSend(200, twiml.toString());
          safeTrackResponseTime(requestStart, requestId);
          return;
        }
      } catch (_) { /* continue */ }

  // --- EARLY: 'mode' / localized switch for plain text (webhook level) ---        
    try {
      const found = Body && parseModeSwitchLocalized(Body);
      if (found) {
        const shopId = String(From).replace('whatsapp:', '');
        let langPinned = String(detectedLanguage || 'en').toLowerCase();
        await sendWelcomeFlowLocalized(From, langPinned, requestId);
        return true; // STOP: do not fall through
      }
    } catch (_) { /* noop */ }
    
  // ===== EARLY EXIT: AI orchestrator decides before any inventory parse =====
   try {
     const orch = await applyAIOrchestration(Body, From, detectedLanguage, requestId, stickyActionCached);
       let langPinned = String(orch.language ?? detectedLanguage ?? 'en').toLowerCase();        
    // Prefer the detector's script variant (e.g., hi-latn) when available
      if (/^-?latn$/i.test(String(detectedLanguage).split('-')[1]) && !String(langPinned).includes('-latn')) {
        langPinned = String(detectedLanguage).toLowerCase(); // e.g., 'hi-latn'
      }           
    // If orchestrator forced inventory (sticky txn turn), SKIP Q&A and normalized-command routing.
      const FORCE_INVENTORY = !!orch?.forceInventory;
            
      // [SALES-QA-IDENTITY-ROUTER] short-circuit identity questions (exact reply, no caches)
         if (orch.identityAsked === true) {
           handledRequests.add(requestId);
           const idLine = identityTextByLanguage(langPinned); // Saamagrii.AI stays Latin; "friend" localized
           const tagged = await tagWithLocalizedMode(From, idLine, langPinned);
           await sendMessageDedup(From, finalizeForSend(tagged, langPinned));
           // match this block's TwiML ack style
           const twiml = new twilio.twiml.MessagingResponse();
           twiml.message('');
           res.type('text/xml');
           resp.safeSend(200, twiml.toString());
           safeTrackResponseTime(requestStart, requestId);
           return;
         }

       // Question → answer & exit
       if (!FORCE_INVENTORY && (orch.isQuestion === true || orch.kind === 'question')) {
         handledRequests.add(requestId);
         const shopId = String(From).replace('whatsapp:', '');
         const ans = await composeAISalesAnswer(shopId, Body, langPinned);
         const msg0 = await tx(ans, langPinned, From, Body, `${requestId}::sales-qa`);
         const msg  = nativeglishWrap(msg0, langPinned);
         await sendMessageDedup(From, msg);
        __handled = true;
         try {
                  const isActivated = await isUserActivated(shopId);
                  const buttonLang = langPinned.includes('-latn') ? langPinned.split('-')[0] : langPinned;
                  await sendSalesQAButtons(From, buttonLang, isActivated);
                } catch (e) {
                  console.warn(`[${requestId}] qa-buttons send failed:`, e?.message);
                }
           try { await maybeShowPaidCTAAfterInteraction(From, langPinned, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}
         // minimal TwiML ack
         const twiml = new twilio.twiml.MessagingResponse();
         twiml.message('');
         res.type('text/xml');
         resp.safeSend(200, twiml.toString());
         safeTrackResponseTime(requestStart, requestId);
         return;
       }
       // Read‑only normalized command → route & exit
       if (!FORCE_INVENTORY && orch.normalizedCommand) {                   
       // NEW: “demo” as a terminal command → play video + buttons
              if (orch.normalizedCommand.trim().toLowerCase() === 'demo') {
                handledRequests.add(requestId);
                await sendDemoVideoAndButtons(From, langPinned, `${requestId}::demo`);
                const twiml = new twilio.twiml.MessagingResponse(); twiml.message('');
                res.type('text/xml'); resp.safeSend(200, twiml.toString()); safeTrackResponseTime(requestStart, requestId);
                return;
              }
         handledRequests.add(requestId);                  
         await handleQuickQueryEN(orch.normalizedCommand, From, langPinned, `${requestId}::ai-norm`);
             // B: After normalized command reply, if terminal, resurface List‑Picker
             try {
               const cmd = String(orch.normalizedCommand).toLowerCase().trim();
                if (typeof _isTerminalCommand === 'function' && _isTerminalCommand(cmd)) {
                  await maybeResendListPicker(From, langPinned, requestId);
                }
                // (Optional) If you want the List‑Picker after any read‑only command:
                // else { await maybeResendListPicker(From, langPinned, requestId); }
              } catch (_) { /* best effort */ }
         __handled = true;
         try { await maybeShowPaidCTAAfterInteraction(From, langPinned, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}
         const twiml = new twilio.twiml.MessagingResponse();
         twiml.message('');
         res.type('text/xml');
         resp.safeSend(200, twiml.toString());
         safeTrackResponseTime(requestStart, requestId);
         return;
       }
     } catch (e) {
       console.warn(`[${requestId}] orchestrator early-exit error:`, e?.message);
       // Fall through gracefully
     }
    
  // --- C) Welcome first for new users with greeting/language ---
    try {
      const shopId = String(From).replace('whatsapp:', '');
      // Use your existing helpers to classify greeting or explicit language selection
          
    const isGreetingOrLang =
        (typeof _isGreeting === 'function' && _isGreeting(Body)) ||
        (typeof _isLanguageChoice === 'function' && _isLanguageChoice(Body));
    
      // EXTRA GUARD: never welcome during a question turn
      const lower = Body.toLowerCase();
      const isQuestionPunc = /\?\s*$/.test(Body);
      const isPriceAskEn   = /\b(price|cost|charge|charges?)\b/i.test(lower);
      const isPriceAskHi   = /\b(कीमत|मूल्य|लागत|कितना|दाम)\b/i.test(lower);
      const isWhyHowHi     = /\b(क्यों|कैसे)\b/i.test(lower);
      const isBenefitsEn   = /\b(benefits?|advantage|how does it help)\b/i.test(lower);
      const isQuestion     = isQuestionPunc || isPriceAskEn || isPriceAskHi || isWhyHowHi || isBenefitsEn;
  
      // Show AI onboarding + interactive buttons only when shouldWelcomeNow says so           
      if (!isQuestion && isGreetingOrLang && await shouldWelcomeNow(shopId, Body)) {      
      const langForWelcome = (detectedLanguage || 'en').toLowerCase();
      await sendWelcomeFlowLocalized(From, langForWelcome, requestId);

        // Suppress late apologies / duplicate upsell for this request
        handledRequests.add(requestId);
        // Minimal TwiML ack for webhook (your Content API has already sent messages)
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message('');                
        res.type('text/xml');
        resp.safeSend(200, twiml.toString());
        safeTrackResponseTime(requestStart, requestId);
        return;
      }
    } catch (e) {
      console.warn(`[${requestId}] welcome short-circuit error:`, e?.message);
      // Fall through to normal flow if anything goes wrong
    }
    
  // >>> GATE FIRST: onboarding/paywall/trial/paid
    // This MUST run before any legacy authorization checks or routing.
    try {
      const gate = await ensureAccessOrOnboard(From, Body, detectedLanguage);
      if (!gate.allow) {
        // The gate already sent the appropriate reply (onboarding / paywall / trial end).
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(''); // minimal ack for webhook               
        res.type('text/xml');
        resp.safeSend(200, twiml.toString());
        safeTrackResponseTime(requestStart, requestId);
        return;
      }
    } catch (e) {
      console.warn(`[${requestId}] gate error:`, e.message);
      // If the gate fails for any reason, fall through to normal flow gracefully.
    }

  // === Centralized engagement tips: wrap the entire request handling ===    
  // use SAFE wrapper to avoid ReferenceError when runWithTips isn't loaded
    await invokeWithTips({ From, language: detectedLanguage, requestId }, async () => {
    // --- NEW: resolve pending price+expiry correction BEFORE deeper routing ---
          
      try {
            if (typeof handleAwaitingPriceExpiry === 'function') {
              const handledCombined = await handleAwaitingPriceExpiry(From, Body, detectedLanguage, requestId);
              if (handledCombined) {
                const twiml = new twilio.twiml.MessagingResponse();
                twiml.message('');                               
                res.type('text/xml');
                resp.safeSend(200, twiml.toString());
                safeTrackResponseTime(requestStart, requestId);
                  __handled = true;
                return; // exit early; wrapper 'finally' will stop tips
              }
            }
          } catch (e) {
      console.warn(`[${requestId}] awaitingPriceExpiry handler error:`, e.message);
      // continue normal routing
    }

    // --- Delegate to main request handler ---
    await handleRequest(req, res, response, requestId, requestStart);

    // --- FINAL CATCH-ALL: If nothing above handled the message, send examples ---           
    if (!resp.alreadySent()) {
        // COPILOT-PATCH-ROOT-PARSEERROR-GUARD (extended)
        // Do NOT send parse-error if:
        //  - start-trial intent is present (typed), or
        //  - gate already decided onboarding/trial, or
        //  - sticky/txn context
        const stickyAction = await getStickyActionQuick();
        const looksTxn = looksLikeTxnLite(Body);
        const trialIntent = isStartTrialIntent(Body);
        let suppressByGate = false;
        try {
          const gatePeek = await ensureAccessOrOnboard(From, Body, detectedLanguage);
          const rsn = String(gatePeek?.upsellReason ?? 'none').toLowerCase();
          suppressByGate = ['new_user','trial_started','trial_ended','paid_confirmed'].includes(rsn);
        } catch { /* noop */ }
        if (stickyAction || looksTxn || trialIntent || suppressByGate) {
          console.log(`[${requestId}] Suppressing parse-error (sticky/txn || trialIntent || gate=${suppressByGate})`);
        } else {
          await safeSendParseError(From, detectedLanguage, requestId);
        }
        // minimal TwiML ack (single-response guard)
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message('');
        res.type('text/xml');
        resp.safeSend(200, twiml.toString());
        safeTrackResponseTime(requestStart, requestId);
        __handled = true;
        return;
      }
  }); // <- tips auto-stop here even on early returns        
  // FINAL SAFETY: if we reached here without earlier returns, show CTA once more.
      try {
        const waFrom =
          (req?.body?.From && String(req.body.From).startsWith('whatsapp:'))
            ? req.body.From
            : `whatsapp:${String(req?.body?.WaId ?? '').replace(/^whatsapp:/, '')}`;
        await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: isStartTrialIntent(Body) });
      } catch (_) {}
};

// --- Attach helpers to the handler (so require('./api/whatsapp') has these) ---
// NOTE: These functions must already be defined above in this file.
//       e.g., sendWhatsAppPaidConfirmation, sendPaidPlanCTA
try { whatsappHandler.sendWhatsAppPaidConfirmation = sendWhatsAppPaidConfirmation; } catch (_) {}
try { whatsappHandler.sendPaidPlanCTA = sendPaidPlanCTA; } catch (_) {}
// If you also want to expose other utilities, attach them similarly:
// whatsappHandler.generateSummaryInsights = generateSummaryInsights; // (optional)

// Export the handler as the default export
module.exports = whatsappHandler;

async function handleRequest(req, res, response, requestId, requestStart) {  
  try {
    // Add request ID to the request object for logging
    req.requestId = requestId;
    
    // Clean up caches periodically
    cleanupCaches();
        
    // Ensure "updates" exists across all branches (prevents ReferenceError)
    let updates = [];

    
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
            
    const { MediaUrl0, NumMedia, SpeechResult, From, Body, ButtonText } = req.body;
    const shopId = fromToShopId(From);
    
    // AUTHENTICATION / SOFT GATE
        // ==========================
        console.log(`[${requestId}] Checking authentication for ${shopId}`);
        const authCheck = await checkUserAuthorization(From, Body, requestId);
        
        // Only block truly restricted states (deactivated/blacklisted/blocked)
        if (!authCheck.authorized) {
          console.log(`[${requestId}] User ${shopId} is restricted`);
          await sendUnauthorizedResponse(From, requestId);
          res.send('<Response></Response>');
          return;
        }
    
    // If user just authenticated, send success message
    if (authCheck.justAuthenticated) {
      console.log(`[${requestId}] User ${shopId} just authenticated successfully`);
      await sendAuthSuccessResponse(From, authCheck.user, requestId);
      res.send('<Response></Response>');
      return;
    }        
        
    // NEW USER: route smartly → Q&A for questions; Welcome for greeting/language picks
        if (authCheck.upsellReason === 'new_user') {
          const detectedLanguage = await detectLanguageWithFallback(Body ?? 'hello', From, requestId);
          const text = String(Body ?? '').trim();
          const isQuestion =
            /\?\s*$/.test(text) ||
            /\b(price|cost|charges?)\b/i.test(text) ||
            /(\bक़ीमत\b|\bमूल्य\b|\bलागत\b|\bकितना\b|\bक्यों\b|\bकैसे\b)/i.test(text);                
            const isGreetingOrLang =
              (typeof _isGreeting === 'function' ? _isGreeting(text) : false) ||
              (typeof _isLanguageChoice === 'function' ? _isLanguageChoice(text) : false);
    
          if (isQuestion) {
            // Answer first via sales‑QA (qa‑sales mode)
            try {
              console.log('[route] new_user + question → sales-qa');
              const ans = await composeAISalesAnswer(shopId, text, detectedLanguage);
              const msg = await t(ans, detectedLanguage, `${requestId}::sales-qa-first`);
              await sendMessageQueued(From, msg);
              handledRequests.add(requestId);
              const twiml = new twilio.twiml.MessagingResponse();
              twiml.message('');
              res.type('text/xml').send(twiml.toString());
              return;
            } catch (e) {
              console.warn('[route] sales-qa failed, falling back to welcome:', e?.message);
              // fall-through to welcome below
            }
          }
          // Show concise onboarding only for greeting/language taps
          if (isGreetingOrLang) {
            console.log('[route] new_user + greeting/lang → onboarding');
            await sendWelcomeFlowLocalized(From, detectedLanguage, requestId);
            try { handledRequests.add(requestId); } catch (_) {}
            try {
              const twiml = new twilio.twiml.MessagingResponse();
              twiml.message('');
              res.type('text/xml').send(twiml.toString());
            } catch (_) {
              res.status(200).end();
            }
            return;
          }
          // Neither a question nor greeting/lang: let downstream normal routers handle it.
          console.log('[route] new_user + other text → defer to normal handlers');
        }
    
        // TRIAL ENDED: gentle paywall prompt and end
        if (authCheck.upsellReason === 'trial_ended') {
          let lang = 'en';
          try { const p = await getUserPreference(shopId); if (p?.success && p.language) lang = p.language; } catch {}
          const payMsg = await t(
            `⚠️ Your Saamagrii.AI trial has ended.\nPay ₹11 at: ${PAYMENT_LINK}\nOr Paytm → ${PAYTM_NUMBER} (${PAYTM_NAME})\nReply "paid" to activate ✅`,
            lang,
            `${requestId}::paywall`
          );
          await sendMessageViaAPI(From, payMsg);
          res.send('<Response></Response>');
          return;
        }
   
    console.log(`[${requestId}] User ${shopId} is authorized, proceeding with request`);
    if (authCache.has(shopId) && Date.now() - authCache.get(shopId) < 5000) {
      console.log(`[${requestId}] Skipping duplicate processing for ${shopId}`);
      res.send('<Response></Response>');
      return;
    }
    
    // ADD BUTTON HANDLING HERE - RIGHT AFTER AUTHENTICATION
    // Handle button responses
    if (ButtonText) {
      console.log(`[${requestId}] Button response received: "${ButtonText}"`);
      
      // Get user's preferred language
      let userLanguage = 'en';
      try {
        const userPref = await getUserPreference(shopId);
        if (userPref.success) {
          userLanguage = userPref.language;
        }
      } catch (error) {
        console.warn(`[${requestId}] Failed to get user preference:`, error.message);
      }
      
      // Handle all button types
      switch(ButtonText) {
        case 'Instant Summary':
        case 'तत्काल सारांश':
        case 'তাত্ক্ষণিক সারসংক্ষেপ':
        case 'உடனடிச் சுருக்கம்':
        case 'తక్షణ సారాంశం':
        case 'ತಕ್ಷಣ ಸಾರಾಂಶ':
        case 'તાત્કાલિક સારાંશ':
        case 'त्वरित सारांश':
          // Instant summary handling
          const summary = await generateInstantSummary(shopId, userLanguage, requestId);
          await sendMessageViaAPI(From, summary);
          res.send('<Response></Response>');
          return;
          
        case 'Detailed Summary':
        case 'विस्तृत सारांश':
        case 'বিস্তারিত সারসংক্ষেপ':
        case 'விரிவான சுருக்கம்':
        case 'వివరణాత్మక సారాంశం':
        case 'ವಿಸ್ತೃತ ಸಾರಾಂಶ':
        case 'વિગતવાર સારાંશ':
        case 'तपशीलवार सारांश':
          // Full summary handling                 
        let generatingMessage = await t(
          'Generating your detailed summary with insights... This may take a moment.',
          userLanguage,
          requestId
        );
        await sendMessageViaAPI(From, finalizeForSend(generatingMessage, userLanguage));
              
          const fullSummary = await generateFullScaleSummary(shopId, userLanguage, requestId);
          await sendMessageViaAPI(From, fullSummary);
          res.send('<Response></Response>');
          return;
          
        // Add more button cases as needed
        default:
          console.warn(`[${requestId}] Unhandled button text: "${ButtonText}"`);
          // Send a response for unhandled buttons             
          let unhandledMessage = await t(
              'I didn\'t understand that button selection. Please try again.',
              userLanguage,
              requestId
            );
            await sendMessageViaAPI(From, finalizeForSend(unhandledMessage, userLanguage));
          res.send('<Response></Response>');
          return;
      }
    }
    
    // STATE-AWARE PROCESSING START
    // ============================
    
    // 1. Handle explicit reset commands FIRST (highest priority)
    if (isResetMessage(Body)) {
      console.log(`[${requestId}] Explicit reset command detected: "${Body}"`);
                
    // Clear ALL states (normalize to shopId)
     await clearUserState(shopId);
     if (globalState.conversationState && globalState.conversationState[shopId]) {
       delete globalState.conversationState[shopId];
     }
     if (globalState.pendingProductUpdates && globalState.pendingProductUpdates[shopId]) {
       delete globalState.pendingProductUpdates[shopId];
     }
      
      // Clear correction state from database
      try {
        const correctionStateResult = await getCorrectionState(shopId);
        if (correctionStateResult.success && correctionStateResult.correctionState) {
          await deleteCorrectionState(correctionStateResult.correctionState.id);
          console.log(`[${requestId}] Cleared correction state during reset`);
        }
      } catch (error) {
        console.warn(`[${requestId}] Failed to clear correction state:`, error.message);
      }
      
      // Send reset confirmation
      const detectedLanguage = await detectLanguageWithFallback(Body, From, requestId);
      const resetMessage = await t(
        'Flow has been reset. Type "mode" to select flow mode (Purchase/Sale/Return).',
        detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, finalizeForSend(resetMessage, detectedLanguage));
      res.send('<Response></Response>');
      try { 
        handledRequests.add(requestId); 
      } catch (_) { /* noop */ }
      return;
    }
            
    // 2. Get current user state (normalize to shopIdState — no "whatsapp:")
        const shopIdState = fromToShopId(From);
        console.log(`[${requestId}] Checking state for ${shopIdState} in database...`);
        // Use the DB-backed helper; fallback to shim if needed
        const currentState = (typeof getUserStateFromDB === 'function')
            ? await getUserStateFromDB(shopIdState)
            : await getUserState(shopIdState);
        console.log(
          `[${requestId}] Current state for ${shopIdState}:`,
          currentState ? currentState.mode : 'none'
        );
               
    // Heartbeat: if sticky, refresh timestamp so 5–10 min idle doesn't clear it
        if (currentState && currentState.mode === 'awaitingTransactionDetails' && typeof refreshUserStateTimestamp === 'function') {
          try { await refreshUserStateTimestamp(shopIdState); } catch (_) {}
        }

    // 3. EARLY GUARD: trial-onboarding capture → consume this turn and STOP
     if (currentState && currentState.mode === 'onboarding_trial_capture') {
       try {
         const langForStep = await detectLanguageWithFallback(String(Body ?? ''), From, requestId);
         await handleTrialOnboardingStep(From, String(Body ?? ''), String(langForStep ?? 'en').toLowerCase(), requestId);
       } catch (e) {
         console.warn(`[${requestId}] onboarding capture step error:`, e?.message);
       }
       // Minimal TwiML ack; reply already sent via API
       try {
         const twiml = new twilio.twiml.MessagingResponse();
         twiml.message('');
         res.type('text/xml').send(twiml.toString());
       } catch (_) { /* best-effort */ }
       return; // 🔒 Do not run greeting/AI/welcome or inventory parsing in this turn
     }
     // 4. Handle based on current state
    if (currentState) {
      switch (currentState.mode) {
        case 'greeting':
          await handleGreetingResponse(Body, From, currentState, requestId, res);
          handledRequests.add(requestId);
          res.headersSent = true;
          return;
          
        case 'correction':
          await handleCorrectionState(Body, From, currentState, requestId, res);
          handledRequests.add(requestId);
          res.headersSent = true;
          return;
          
        case 'confirmation':
          if (currentState.data.type === 'voice_confirmation') {
            await handleVoiceConfirmationState(Body, From, currentState, requestId, res);
            handledRequests.add(requestId);
            res.headersSent = true;
          } else if (currentState.data.type === 'text_confirmation') {
            await handleTextConfirmationState(Body, From, currentState, requestId, res);
            handledRequests.add(requestId);
            res.headersSent = true;
          } else if (currentState.data.type === 'product_confirmation') {
            await handleProductConfirmationState(Body, From, currentState, requestId, res);
            handledRequests.add(requestId);
            res.headersSent = true;
          } else {
            await handleConfirmationState(Body, From, currentState, requestId, res);
            handledRequests.add(requestId);
            res.headersSent = true;
          }
          return;
          
        case 'inventory':
          await handleInventoryState(Body, From, currentState, requestId, res);
          handledRequests.add(requestId);
          res.headersSent = true;
          return;
      }
    }
    
    // 4. No active state - process as new interaction
    await handleNewInteraction(Body, MediaUrl0, NumMedia, From, requestId, res);
    handledRequests.add(requestId);
    res.headersSent = true;
    
  } catch (error) {
    console.error(`[${requestId}] Processing Error:`, error.message);
    const errorMessage = await t(
      'System error. Please try again with a clear message.',
      'en',
      requestId
    );
    response.message(errorMessage);
    res.send(response.toString());
  }
}

// Simple confirmation function for corrected updates
async function confirmCorrectedUpdate(update, from, detectedLanguage, requestId) {
  const response = new twilio.twiml.MessagingResponse();
  
  const confirmationMessage = `I heard: "${update.quantity} ${update.unit} of ${update.product}" (${update.action}).  
Is this correct?  
Reply with "yes" or "no".`;
  
  await sendSystemMessage(confirmationMessage, from, detectedLanguage, requestId, response);
  
  // Store the update temporarily in global state with a different key
  const shopId = fromToShopId(from);
  if (!globalState.correctedUpdates) {
    globalState.correctedUpdates = {};
  }
  globalState.correctedUpdates[shopId] = {
    update,
    detectedLanguage,
    timestamp: Date.now()
  };
  
  return response.toString();
}

async function handleCorrectionState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling correction state with input: "${Body}"`);
  
  const shopId = fromToShopId(From);
  const correctionState = state.data.correctionState;
  
  // Check if user is trying to exit correction mode
  if (Body && ['exit', 'cancel', 'reset', 'start over'].some(cmd => Body.toLowerCase().includes(cmd))) {
    console.log(`[${requestId}] User exiting correction mode`);
    
    // Clear correction state
    await deleteCorrectionState(correctionState.id);
    await clearUserState(shopId);
    
    const exitMessage = await t(
      'Correction cancelled. You can start fresh with a new inventory update.',
      correctionState.detectedLanguage,
      requestId
    );
    
    await sendMessageViaAPI(From, exitMessage);
    res.send('<Response></Response>');
    return;
  }

  if (correctionState.correctionType === 'price') {
  const priceMatch = Body.trim().match(/(\d+(\.\d+)?)/);
  const priceValue = priceMatch ? parseFloat(priceMatch[1]) : NaN;

  if (!isNaN(priceValue) && priceValue > 0) {
    const updated = {
      ...correctionState.pendingUpdate,
      price: priceValue
    };

    const results = await updateMultipleInventory(shopId, [updated], correctionState.detectedLanguage);

    if (results[0].success) {
    await deleteCorrectionState(correctionState.id);
    await clearUserState(shopId);
  
    const result = results[0];
    const unitText = result.unit ? ` ${result.unit}` : '';
    const value = priceValue * result.quantity;
  
    let message = `✅ Price updated: ${result.product} at ₹${priceValue}/${result.unit}\n\n`;    
        
    {
        const r = {
          product: result.product,
          quantity: result.quantity,
          unit: result.unit,
          unitAfter: result.unit,
          action: result.action,
          success: true,
          newQuantity: result.newQuantity
        };
        const line = formatResultLine(r, COMPACT_MODE);
        message += COMPACT_MODE
          ? line
          : `✅ Updates processed:\n\n${line.startsWith('•') ? line : `• ${line.replace(/^✅\\s*/, '')}`}`;
      }
  
    if (result.action === 'sold') {
      message += `\n💰 Total sales value: ₹${value.toFixed(2)}`;
    } else if (result.action === 'purchased') {
      message += `\n📦 Total purchase value: ₹${value.toFixed(2)}`;
    }
  
    const translated = await t(message, correctionState.detectedLanguage, requestId);
    await sendMessageViaAPI(From, translated);
  } else {
      let message = `❌ Update failed: ${results[0].error ?? 'Unknown error'}\nPlease try again.`;
      const translated = await t(message, correctionState.detectedLanguage, requestId);
      await sendMessageViaAPI(From, translated);
    }

    return;
  } else {
    const retryMessage = await t(
      'Please enter a valid price (e.g., 15 or 20.5)',
      correctionState.detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, retryMessage);
    return;
  }
} else {
      const retryMessage = await t(
        'Please enter a valid price (e.g., 15 or 20.5)',
        correctionState.detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, retryMessage);
      res.send('<Response></Response>');
      return;
    }
  
  // Process correction based on type
  if (correctionState.correctionType === 'selection') {
    // Handle 1,2,3,4 selection
    if (['1', '2', '3', '4'].includes(Body.trim())) {
      let newCorrectionType = '';
      let followUpMessage = '';
      
      switch (Body.trim()) {
        case '1':
          newCorrectionType = 'product';
          followUpMessage = 'Please type the correct product name.';
          break;
        case '2':
          newCorrectionType = 'quantity';
          followUpMessage = 'Please type the correct quantity and unit. Example: "5 packets"';
          break;
        case '3':
          newCorrectionType = 'action';
          followUpMessage = 'Please specify if it was purchased, sold, or remaining.';
          break;
        case '4':
          newCorrectionType = 'all';
          followUpMessage = 'Please type the full update. Example: "Milk purchased - 5 litres"';
          break;
      }
      
      // Update correction state
      const updateResult = await saveCorrectionState(
        shopId, 
        newCorrectionType, 
        correctionState.pendingUpdate, 
        correctionState.detectedLanguage
      );
      
      if (updateResult.success) {
        // Update user state
        await setUserState(shopId, 'correction', {
          correctionState: {
            ...correctionState,
            correctionType: newCorrectionType,
            id: updateResult.id
          }
        });
        
        const translatedMessage = await t(
          followUpMessage,
          correctionState.detectedLanguage,
          requestId
        );
        
        await sendMessageViaAPI(From, translatedMessage);
      }
    } else {
      // Invalid selection
      const errorMessage = await t(
        'Please reply with 1, 2, 3, or 4. Or type "exit" to cancel.',
        correctionState.detectedLanguage,
        requestId
      );
      
      await sendMessageViaAPI(From, errorMessage);
    }
  } else {
    // Handle actual correction data (product name, quantity, etc.)
    let correctedUpdate = { ...correctionState.pendingUpdate };
    let isValidInput = true;
    
    switch (correctionState.correctionType) {
      case 'product':
        if (Body.trim().length > 0) {
          correctedUpdate.product = Body.trim();
        } else {
          isValidInput = false;
        }
        break;
      case 'quantity':
        try {      
        const fakeReq = { body: { From, Body } };
        const quantityUpdate = await parseMultipleUpdates(fakeReq,requestId);
          if (quantityUpdate.length > 0) {
            correctedUpdate.quantity = quantityUpdate[0].quantity;
            correctedUpdate.unit = quantityUpdate[0].unit;
          } else {
            isValidInput = false;
          }
        } catch (error) {
          console.error(`[${requestId}] Error parsing quantity correction:`, error.message);
          isValidInput = false;
        }
        break;
      case 'action':
        const lowerBody = Body.toLowerCase();
        if (lowerBody.includes('purchased') || lowerBody.includes('bought')) {
          correctedUpdate.action = 'purchased';
        } else if (lowerBody.includes('sold')) {
          correctedUpdate.action = 'sold';
        } else if (lowerBody.includes('remaining')) {
          correctedUpdate.action = 'remaining';
        } else {
          isValidInput = false;
        }
        break;
      case 'all':
        try {         
      const fakeReq = { body: { From, Body } };
      const fullUpdate = await parseMultipleUpdates(fakeReq,requestId);
          if (fullUpdate.length > 0) {
            correctedUpdate = fullUpdate[0];
          } else {
            isValidInput = false;
          }
        } catch (error) {
          console.error(`[${requestId}] Error parsing full update correction:`, error.message);
          isValidInput = false;
        }
        break;
    }
    
    if (isValidInput) {
      // Move to confirmation state
      await setUserState(shopId, 'confirmation', {
        correctedUpdate,
        detectedLanguage: correctionState.detectedLanguage,
        originalCorrectionId: correctionState.id
      });
      
      const confirmationMessage = await t(
        `I heard: "${correctedUpdate.quantity} ${correctedUpdate.unit} of ${correctedUpdate.product}" (${correctedUpdate.action}).  
Is this correct? Reply with "yes" or "no".`,
        correctionState.detectedLanguage,
        requestId
      );
      
      await sendMessageViaAPI(From, confirmationMessage);
    } else {
      // Invalid input - ask again
      let retryMessage = '';
      switch (correctionState.correctionType) {
        case 'product':
          retryMessage = 'Please provide a valid product name.';
          break;
        case 'quantity':
          retryMessage = 'Please provide a valid quantity and unit. Example: "5 packets"';
          break;
        case 'action':
          retryMessage = 'Please specify "purchased", "sold", or "remaining".';
          break;
        case 'all':
          retryMessage = 'Please provide a valid inventory update. Example: "Milk purchased - 5 litres"';
          break;
      }
      
      const translatedMessage = await t(
        retryMessage,
        correctionState.detectedLanguage,
        requestId
      );
      
      await sendMessageViaAPI(From, translatedMessage);
    }
  }
  
  res.send('<Response></Response>');
}

async function handleConfirmationState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling confirmation state with input: "${Body}"`);
       
  const { correctedUpdate, detectedLanguage, originalCorrectionId } = state.data;
  const shopId = From.replace('whatsapp:', '');
  
  const yesVariants = ['yes', 'haan', 'हाँ', 'ha', 'ok', 'okay'];
  const noVariants = ['no', 'nahin', 'नहीं', 'nahi', 'cancel'];
  
  if (yesVariants.includes(Body.toLowerCase())) {
    // Process the confirmed update
    const results = await updateMultipleInventory(shopId, [correctedUpdate], detectedLanguage);
    
    
    const processed = results.filter(r => !r.needsPrice && !r.needsUserInput && !r.awaiting);
      const header = chooseHeader(processed.length, COMPACT_MODE, false);
          
      // --- Single-sale confirmation (confirmation flow): one message + return ----
        if (processed.length === 1 && String(processed[0].action).toLowerCase() === 'sold') {
          const x = processed[0];
          await sendSaleConfirmationOnce(
            From,
            detectedLanguage,
            requestId,
            {
              product: x.product,
              qty: x.quantity,
              unit: x.unitAfter ?? x.unit ?? '',
              pricePerUnit: x.rate ?? x.salePrice ?? x.price ?? null,
              newQuantity: x.newQuantity
            }
          );
          // Clear state after sending the single confirmation
          await clearUserState(shopId);
          return;
        }
        // --------------------------------------------------------------------------
        let message = header;
    
      let successCount = 0;

      for (const r of processed) {
        const rawLine = r.inlineConfirmText ? r.inlineConfirmText : formatResultLine(r, COMPACT_MODE,false);
        if (!rawLine) continue;
        const needsStock = COMPACT_MODE && r.newQuantity !== undefined && !/\(Stock:/.test(rawLine);
        const stockPart = needsStock ? ` (Stock: ${r.newQuantity} ${r.unitAfter ?? r.unit ?? ''})` : '';
        message += `${rawLine}${stockPart}\n`;
        if (r.success) successCount++; 
      }

      message += `\n✅ Successfully updated ${successCount} of ${processed.length} items`;
      const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
      await sendMessageDedup(From, formattedResponse);
    
    // Clean up
    await deleteCorrectionState(originalCorrectionId);
    await clearUserState(shopId);
    
  } else if (noVariants.includes(Body.toLowerCase())) {
    // Go back to correction selection
    const correctionMessage = await t(
      `Please try again. What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`,
      detectedLanguage,
      requestId
    );
    
    // Update correction state back to selection
    await saveCorrectionState(shopId, 'selection', correctedUpdate, detectedLanguage);
    await setUserState(shopId, 'correction', {
      correctionState: {
        correctionType: 'selection',
        pendingUpdate: correctedUpdate,
        detectedLanguage,
        id: originalCorrectionId
      }
    });
    
    await sendMessageViaAPI(From, correctionMessage);
  } else {
    // Invalid response
    const errorMessage = await t(
      'Please reply with "yes" or "no".',
      detectedLanguage,
      requestId
    );
    
    await sendMessageViaAPI(From, errorMessage);
  }
  
  res.send('<Response></Response>');
}

async function handleInventoryState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling inventory state with input: "${Body}"`);
  
  const { updates, detectedLanguage } = state.data;
  const shopId = From.replace('whatsapp:', '');
  
  // Process the updates
  try {
    const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
    
    if (allPendingPrice(results)) {
        try {
          await setUserState(shopID, 'correction', {
            correctionState: {
              correctionType: 'price',
              pendingUpdate: results[0],
              detectedLanguage,
              id: results[0]?.correctionId
            }
          });
        } catch (_) {}
        res.send('<Response></Response>');
        return;
      }   
    
    // NEW: short-circuit when unified price+expiry flow is pending for all items
      const allPendingUnified =
        Array.isArray(results) &&
        results.length > 0 &&
        results.every(r => r?.awaiting === 'price+expiry' || r?.needsUserInput === true);
      if (allPendingUnified) {
        // The unified prompt was already sent from updateMultipleInventory(); just ACK Twilio
        return res.send(response.toString());
      } 
     
        // INLINE-CONFIRM aware single message
        const processed = results.filter(r => r?.success && !r.needsPrice && !r.needsUserInput && !r.awaiting);
        const header = chooseHeader(processed.length, COMPACT_MODE, false);
        let message = header;
        let successCount = 0;

        for (const r of processed) {
          const rawLine = r.inlineConfirmText ? r.inlineConfirmText : formatResultLine(r, COMPACT_MODE,false);
          if (!rawLine) continue;
          const needsStock = COMPACT_MODE && r.newQuantity !== undefined && !/\(Stock:/.test(rawLine);
          const stockPart = needsStock ? ` (Stock: ${r.newQuantity} ${r.unitAfter ?? r.unit ?? ''})` : '';
          message += `${rawLine}${stockPart}\n`;
          if (r.success) successCount++;
        }

        message += `\n✅ Successfully updated ${successCount} of ${processed.length} items`;

        const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
        await sendMessageDedup(From, formattedResponse);
    
    // Clear state after processing
    await clearUserState(From);
  } catch (error) {
    console.error(`[${requestId}] Error processing inventory updates:`, error.message);
    
    // If processing fails, try to parse the input again and enter correction flow
    try {
      const parsedUpdates = await parseMultipleUpdates(req,requestId);
      let update;
      
      if (parsedUpdates.length > 0) {
        update = parsedUpdates[0];
      } else {
        // Create a default update object
        update = {
          product: Body,
          quantity: 0,
          unit: '',
          action: 'purchased',
          isKnown: false
        };
      }
      
      // Save correction state
      const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
      
      if (saveResult.success) {
        await setUserState(shopID, 'correction', {
          correctionState: {
            correctionType: 'selection',
            pendingUpdate: update,
            detectedLanguage,
            id: saveResult.id
          }
        });
        
        const correctionMessage = `I had trouble processing your update. What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
        
        const translatedMessage = await t(correctionMessage, detectedLanguage, requestId);
        await sendMessageViaAPI(From, translatedMessage);
      } else {
        // If saving correction state fails, ask to retry
        const errorMessage = await t(
          'Please try again with a clear inventory update.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
        await clearUserState(From);
      }
    } catch (parseError) {
      console.error(`[${requestId}] Error in fallback parsing:`, parseError.message);
      
      // If even fallback fails, ask to retry
      const errorMessage = await t(
        'Please try again with a clear inventory update.',
        detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, errorMessage);
      await clearUserState(From);
    }
  }
  
  res.send('<Response></Response>');
}

async function handleNewInteraction(Body, MediaUrl0, NumMedia, From, requestId, res) {  
  console.log(`[${requestId}] Handling new interaction`);
  const shopId = fromToShopId(From);
   
  // 🔒 Early guard: if trial-onboarding capture is active, consume & stop
     try {
       const s = (typeof getUserStateFromDB === 'function')
          ? await getUserStateFromDB(shopId)
          : await getUserState(shopId);
               
          // Heartbeat: keep sticky mode fresh in new interactions
          try {
            const st = typeof getUserStateFromDB === 'function' ? await getUserStateFromDB(shopId) : null;
            if (st && st.mode === 'awaitingTransactionDetails' && typeof refreshUserStateTimestamp === 'function') {
              await refreshUserStateTimestamp(shopId);
            }
          } catch (_) {}

        if (s && s.mode === 'onboarding_trial_capture') {                  
        // NEW: keep the session language on code-like inputs (GSTIN, etc.)
          const pref = await getUserPreference(shopId).catch(() => ({ language: 'en' }));
          const currentLang = String(pref?.language ?? 'en').toLowerCase();
          const langForStep = await checkAndUpdateLanguageSafe(String(Body ?? ''), From, currentLang, requestId);
          await handleTrialOnboardingStep(From, String(Body ?? ''), String(langForStep ?? 'en').toLowerCase(), requestId);
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message('');
          res.type('text/xml').send(twiml.toString());
          return;
        }
      } catch (_) { /* continue normal flow */ }
    
  // Track whether this request has produced a final user-facing response
  let __handled = false;

  // ✅ Language
  let userLanguage = 'en';
  try {
    const userPref = await getUserPreference(shopId);
    if (userPref.success) {
      userLanguage = userPref.language;
    }
  } catch (error) {
    console.warn(`[${requestId}] Failed to get user preference:`, error.message);
  }
      
    // ✅ Detect/lock language variant (hi-latn, etc.)
    let detectedLanguage = userLanguage ?? 'en';
    try {
      detectedLanguage = await checkAndUpdateLanguageSafe(Body ?? '', From, userLanguage, requestId);
    } catch (e) {
    console.warn(`[${requestId}] Language detection failed, defaulting to ${detectedLanguage}:`, e.message);
  }
  console.log(`[${requestId}] Using detectedLanguage=${detectedLanguage} for new interaction`);    
    // Persist override for TEXT input (Body present). Voice path below remains unchanged.
    try {
      if (Body && Body.trim().length > 0) {
        await saveUserPreference(shopId, detectedLanguage);
        console.log(`[${requestId}] New interaction (text): saved DB language pref to ${detectedLanguage}`);
      }
    } catch (e) {
      console.warn(`[${requestId}] New interaction: saveUserPreference failed:`, e?.message);
    }
  // === NEW: typed "demo" intent (defensive, outside orchestrator) ===
      try {
        const langPinned = String(detectedLanguage ?? 'en').toLowerCase();
        const raw = String(Body ?? '').trim().toLowerCase();
        const demoTokens = [
          'demo','डेमो','ডেমো','டெமோ','డెమో','ಡೆಮೊ','ડેમો',
          'demo please','डेमो देखें','डेमो देखो'
        ];
        if (demoTokens.some(t => raw.includes(t))) {
          await sendDemoVideoAndButtons(From, langPinned, `${requestId}::demo-typed`);
          // Minimal TwiML ack; main send used Content/PM API
          const twiml = new twilio.twiml.MessagingResponse(); twiml.message('');
          res.type('text/xml').send(twiml.toString());
          return;
        }
      } catch (_) { /* continue normal flow */ }
    
  // --- Minimal hook: Activate Paid Plan command ---
    const lowerBodyCmd = String(Body || '').trim().toLowerCase();
    if (
      lowerBodyCmd === 'activate paid' ||
      lowerBodyCmd === 'paid' ||
      /activate\s+paid/i.test(lowerBodyCmd) ||
      /start\s+paid/i.test(lowerBodyCmd)
    ) {
      await sendPaidPlanCTA(From, detectedLanguage || 'en');
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('');
      res.type('text/xml').send(twiml.toString());
      return;
    }

  // --- EARLY GUARD: typed "start trial" intent (handles plain text like "I want to start trial")
  // Trigger BEFORE sticky-mode, parsing, or AI orchestration to mirror the Start Trial button behavior.
      try {
        const planInfo = await getUserPlan(shopId);
        const plan = String(planInfo?.plan ?? '').toLowerCase();
        const trialEnd = planInfo?.trialEndDate ? new Date(planInfo.trialEndDate) : null;
        const isActivated =
          (plan === 'paid') ||
          (plan === 'trial' && (!trialEnd || Date.now() <= trialEnd.getTime()));
        // Robust intent check: function detector OR simple normalized regex
        const lc = String(Body ?? '').toLowerCase();
        const typedTrial = isStartTrialIntent(Body) || /\bstart\s+trial\b/.test(lc);
        if (!isActivated && typedTrial) {
          await activateTrialFlow(From, (detectedLanguage ?? 'en').toLowerCase());
          // Suppress CTA in the same turn; mark handled to prevent late apologies
          try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: true }); } catch {}
          handledRequests.add(requestId);
          return res.send('<Response></Response>');
        }
      } catch (_) { /* soft-fail: continue */ }
    
  async function getStickyActionQuick() {
    try {        
    // ✅ read state by shopId (same key used to store/read)
          const stDb = (typeof getUserStateFromDB === 'function')
            ? await getUserStateFromDB(shopId)
            : await getUserState(shopId);
          const stMem = (globalThis?.globalState?.conversationState?.[shopId]) ?? null;
      const st = stDb || stMem || null;
      if (!st) return null;
      switch (st.mode) {
        case 'awaitingTransactionDetails': return st.data?.action ?? null;
        case 'awaitingBatchOverride': return 'sold';
        case 'awaitingPurchaseExpiryOverride': return 'purchased';
        default: return st.data?.action ?? null;
      }
    } catch {
      return null;
    }
  }

  // ✅ Sticky short-circuit: consume verb‑less txn lines BEFORE any QA/router
  try {
    const stickyAction = await getStickyActionQuick();
    if (stickyAction && looksLikeTxnLite(Body)) {
      console.log(`[${requestId}] [sticky] mode active=${stickyAction} → forcing inventory parse`);
      // COPILOT-PATCH-STICKY-PARSE-FROM
      const parsedUpdates = await parseMultipleUpdates({ From, Body },requestId);
      if (Array.isArray(parsedUpdates) && parsedUpdates.length > 0) {
        console.log(`[${requestId}] [sticky] Parsed ${parsedUpdates.length} updates`);                    
           
      // Commit first to get results
            const results = await updateMultipleInventory(shopId, parsedUpdates, detectedLanguage);
            const processed = results.filter(r => r?.success && !r.needsPrice && !r.needsUserInput && !r.awaiting);

      if (processed.length === 1) {
        const x = processed[0];
        const act = String(x.action).toLowerCase();
        const common = {
          product: x.product,
          qty: x.quantity,
          unit: x.unitAfter ?? x.unit ?? '',
          pricePerUnit: x.rate ?? x.salePrice ?? x.price ?? null,
          newQuantity: x.newQuantity
        };
        if (act === 'sold') {
          await sendSaleConfirmationOnce(From, detectedLanguage, requestId, common);
          __handled = true;              
          return res.send('<Response></Response>');
        }
        if (act === 'purchased' && !x.needsPrice && !x.awaiting && !x.needsUserInput) {
          await sendPurchaseConfirmationOnce(From, detectedLanguage, requestId, common);
          __handled = true;                    
          return res.send('<Response></Response>');
        }
      }
 
// Multi-line confirmation (send whenever there are successes)
      const shopIdLocal = String(From).replace('whatsapp:', '');
      const lastNudgeTs = globalThis.__recentPriceNudge?.get(shopIdLocal) ?? 0;
      const justNudged = lastNudgeTs && (Date.now() - lastNudgeTs) < 5000; // 5s window (informational only)
      const totalCount = Array.isArray(parsedUpdates) ? parsedUpdates.length : (Array.isArray(results) ? results.length : processed.length);
      if (processed.length > 0) {
        const header = chooseHeader(processed.length, COMPACT_MODE, false);
        let message = header;
        let successCount = 0;
        for (const r of processed) {
          const rawLine = r.inlineConfirmText ? r.inlineConfirmText : formatResultLine(r, COMPACT_MODE, false);
          if (!rawLine) continue;
          const needsStock = COMPACT_MODE && r.newQuantity !== undefined && !/\(Stock:/.test(rawLine);
          const stockPart = needsStock ? ` (Stock: ${r.newQuantity} ${r.unitAfter ?? r.unit ?? ''})` : '';
          message += `${String(rawLine).trim()}${stockPart}\n`;
          if (r.success) successCount++;
        }
        message += `\n✅ Successfully updated ${successCount} of ${totalCount} items`;
        const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
        await sendMessageDedup(From, formattedResponse);
      }
        __handled = true;
        return res.send('<Response></Response>');
      }
      // Fall through if no updates parsed
      console.log(`[${requestId}] [sticky] No updates parsed; continuing with normal flow`);
    }
  } catch (e) {
    console.warn(`[${requestId}] sticky short-circuit failed:`, e?.message);
  }

  // ✅ Price correction state (unchanged)      
    try {
       const currentState = (typeof getUserStateFromDB === 'function')
         ? await getUserStateFromDB(shopId)
         : await getUserState(shopId);
    if (currentState &&
        currentState.mode === 'correction' &&
        currentState.data.correctionState.correctionType === 'price') {
      try {
        const csRes = await getCorrectionState(shopId);
        if (csRes && csRes.success && csRes.correctionState &&
            csRes.correctionState.correctionType === 'price') {
          const priceValue = parseFloat(Body.trim());
          if (!Number.isNaN(priceValue) && priceValue > 0) {
            let pendingUpdate = csRes.correctionState.pendingUpdate;
            if (typeof pendingUpdate === 'string') {
              try { pendingUpdate = JSON.parse(pendingUpdate); } catch (_) {}
            }
            const detectedLanguageCorr = csRes.correctionState.detectedLanguage || userLanguage || 'en';
            const updated = { ...pendingUpdate, price: priceValue };
            const results = await updateMultipleInventory(shopId, [updated], detectedLanguageCorr);
            try { await deleteCorrectionState(csRes.correctionState.id); } catch (_){}
            try { await clearUserState(From); } catch (_){}

            let msg = '✅ Update processed:\n\n';
            const ok = results[0] && results[0].success;
            if (ok) {
              const r = results[0];
              const unitText = r.unit ? ` ${r.unit}` : '';
              msg += `• ${r.product}: ${r.quantity}${unitText} ${r.action} (Stock: ${r.newQuantity}${unitText})`;
            } else {
              msg += `• ${updated.product}: Error - ${results[0]?.error || 'Unknown error'}`;
            }
            const formatted = await t(msg, detectedLanguageCorr, requestId);
            await sendMessageViaAPI(From, formatted);
            res.send('<Response></Response>');
            return;
          }
        }
      } catch (e) {
        console.warn(`[${requestId}] Price state handling failed:`, e.message);
      }
    }
  } catch (e) {
    console.warn(`[${requestId}] Price state read failed:`, e.message);
  }

  // ✅ Numeric-only price fallback (unchanged)
  if (Body && /^\s*\d+(?:\.\d+)?\s*$/.test(Body)) {
    try {
      const csRes = await getCorrectionState(shopId);
      if (csRes && csRes.success && csRes.correctionState &&
          csRes.correctionState.correctionType === 'price') {
        const priceValue = parseFloat(Body.trim());
        if (!Number.isNaN(priceValue) && priceValue > 0) {
          let pendingUpdate = csRes.correctionState.pendingUpdate;
          if (typeof pendingUpdate === 'string') {
            try { pendingUpdate = JSON.parse(pendingUpdate); } catch (_){}
          }
          const detectedLanguageCorr = csRes.correctionState.detectedLanguage || userLanguage || 'en';
          const updated = { ...pendingUpdate, price: priceValue };
          const results = await updateMultipleInventory(shopId, [updated], detectedLanguageCorr);
          try { await deleteCorrectionState(csRes.correctionState.id); } catch (_){}
          try { await clearUserState(From); } catch (_){}

          let msg = '✅ Update processed:\n\n';
          const ok = results[0] && results[0].success;
          if (ok) {
            const r = results[0];
            const unitText = r.unit ? ` ${r.unit}` : '';
            msg += `• ${r.product}: ${r.quantity}${unitText} ${r.action} (Stock: ${r.newQuantity}${unitText})`;
          } else {
            msg += `• ${updated.product}: Error - ${results[0]?.error || 'Unknown error'}`;
          }
          const formatted = await t(msg, detectedLanguageCorr, requestId);
          await sendMessageViaAPI(From, formatted);
          res.send('<Response></Response>');
          return;
        }
      }
    } catch (e) {
      console.warn(`[${requestId}] Numeric price fallback failed:`, e.message);
    }
  }

  // ✅ Early price management command
  if (Body && /^\s*(update\s+price|price\s+update)\b/i.test(Body)) {
    try {
      await handlePriceUpdate(Body, From, detectedLanguage, requestId);
      return res.send('<Response></Response>');
    } catch (err) {
      console.error(`[${requestId}] Error in handlePriceUpdate:`, err.message);
      const msg = await t('System error. Please try again with a clear message.',
        detectedLanguage || 'en', requestId);
      await sendMessageViaAPI(From, msg);
      return res.send('<Response></Response>');
    }
  }

  // ✅ Greeting detection & welcome flow (unchanged logic)
  if (Body) {
    const greetingLang = detectGreetingLanguage(Body);
    if (greetingLang) {
      console.log(`[${requestId}] Detected greeting in language: ${greetingLang}`);
      await saveUserPreference(shopId, greetingLang);
      await sendWelcomeFlowLocalized(From, greetingLang, requestId);
      try {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message('');
        res.type('text/xml').send(twiml.toString());
      } catch (_) {
        res.status(200).end();
      }
      return;
    }
  }

  // ✅ Voice branch
  if (NumMedia && MediaUrl0 && (NumMedia !== '0' && NumMedia !== 0)) {
    res.send('<Response></Response>');
    processVoiceMessageAsync(MediaUrl0, From, requestId, null)
      .catch(error => console.error(`[${requestId}] Error in async voice processing:`, error));
    return;
  }

  // ✅ Text branch
  if (Body) {      
    // ===== EARLY EXIT: AI orchestrator before any inventory parse =====
    try {
      const orch = await applyAIOrchestration(Body, From, detectedLanguage, requestId);
      const langExact = ensureLangExact(orch.language ?? detectedLanguage ?? 'en');
      // COPILOT-PATCH-AIQA-GUARD-HNI-ENTRY
      const FORCE_INVENTORY = !!orch?.forceInventory;
            
      // [SALES-QA-IDENTITY-ROUTER] short-circuit identity questions (exact reply, no caches)
         if (orch.identityAsked === true) {
           handledRequests.add(requestId);
           const idLine = identityTextByLanguage(langExact); // Saamagrii.AI stays Latin; "friend" localized
           const tagged = await tagWithLocalizedMode(From, idLine, langExact);
           await sendMessageDedup(From, finalizeForSend(tagged, langExact));
           return res.send('<Response></Response>');
         }

      // Question → answer & exit
      if (!FORCE_INVENTORY && (orch.isQuestion === true || orch.kind === 'question')) {
        handledRequests.add(requestId);                
        const ans = await composeAISalesAnswer(shopId, Body, langExact);
            // Send AI-native answer without MT; keep one script + readable anchors
            const aiNative = enforceSingleScriptSafe(ans, langExact);
            const msg = normalizeNumeralsToLatin(
              nativeglishWrap(aiNative, langExact)
            );
            await sendMessageDedup(From, msg);
        try {
          const isActivated = await isUserActivated(shopId);
          const buttonLang = langExact.includes('-latn') ? langExact.split('-')[0] : langExact;
          await sendSalesQAButtons(From, buttonLang, isActivated);
        } catch (e) {
          console.warn(`[${requestId}] qa-buttons send failed:`, e?.message);
        }               
        __handled = true;
        try { await maybeShowPaidCTAAfterInteraction(From, langExact, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}
        return res.send('<Response></Response>');
      }

      // Read-only normalized command → route & exit
      if (!FORCE_INVENTORY && orch.normalizedCommand) {                  
      // NEW: “demo” as a terminal command → play video + buttons
              if (orch.normalizedCommand.trim().toLowerCase() === 'demo') {
                handledRequests.add(requestId);
                await sendDemoVideoAndButtons(From, langPinned, `${requestId}::demo`);
                const twiml = new twilio.twiml.MessagingResponse(); twiml.message('');
                res.type('text/xml'); resp.safeSend(200, twiml.toString()); safeTrackResponseTime(requestStart, requestId);
                return;
              }
        handledRequests.add(requestId);
        // NEW: Localize low-stock section explicitly
          const cmd = String(orch.normalizedCommand).toLowerCase().trim();                      
             // NEW: alias slugs to canonical commands
             if (cmd === 'list_low') cmd = 'low stock';
             if (cmd === 'list_short_summary') cmd = 'short summary';
          if (cmd === 'low stock' || cmd === 'कम स्टॉक') {
            const shopId = String(From).replace('whatsapp:', '');
            try {
              const low = await composeLowStockLocalized(shopId, langExact, `${requestId}::low-stock`);
              await sendMessageDedup(From, low);
            } catch (e) {
              console.warn('[low-stock] compose failed:', e?.message);
              // Fallback to previous path
              await routeQuickQueryRaw(orch.normalizedCommand, From, langExact, `${requestId}::ai-norm-text`);
            }
            _handled = true;
            return;
          }
          await routeQuickQueryRaw(orch.normalizedCommand, From, langExact, `${requestId}::ai-norm-text`);                  
          // B: After normalized command reply, if terminal, resurface List‑Picker
              try {
                const cmd = String(orch.normalizedCommand).toLowerCase().trim();
                if (typeof _isTerminalCommand === 'function' && _isTerminalCommand(cmd)) {
                  await maybeResendListPicker(From, langExact, requestId);
                }
                // (Optional) If you want the List‑Picker after any read‑only command:
                // else { await maybeResendListPicker(From, langExact, requestId); }
              } catch (_) { /* best effort */ }
        __handled = true;
        try { await maybeShowPaidCTAAfterInteraction(From, langExact, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}
        return res.send('<Response></Response>');
      }
    } catch (e) {
      console.warn(`[${requestId}] orchestrator early-exit error:`, e?.message);
      // fall through gracefully
    }

    console.log(`[${requestId}] Attempting to parse as inventory update`);

    // First, try to parse as inventory update (higher priority)
    // COPILOT-PATCH-HNI-PARSE-FROM
    const parsedUpdates = await parseMultipleUpdates({ From, Body },requestId); // pass req-like object
    if (Array.isArray(parsedUpdates) && parsedUpdates.length > 0) {
      console.log(`[${requestId}] Parsed ${parsedUpdates.length} updates from text message`);                   
    // Commit first to get results
      const results = await updateMultipleInventory(shopId, parsedUpdates, detectedLanguage);
      const processed = results.filter(r => r?.success && !r.needsPrice && !r.needsUserInput && !r.awaiting);
      if (processed.length === 1 && String(processed[0].action).toLowerCase() === 'sold') {
        const x = processed[0];
        await sendSaleConfirmationOnce(
          From,
          detectedLanguage,
          requestId,
          {
            product: x.product,
            qty: x.quantity,
            unit: x.unitAfter ?? x.unit ?? '',
            pricePerUnit: x.rate ?? x.salePrice ?? x.price ?? null,
            newQuantity: x.newQuantity
          }
        );
        return;
      }
  
  // Always send when we have successes; suppress only when nothing succeeded
  const shopIdLocal = String(From).replace('whatsapp:', '');
  const lastNudgeTs = globalThis.__recentPriceNudge?.get(shopIdLocal) ?? 0;
  const justNudged = lastNudgeTs && (Date.now() - lastNudgeTs) < 5000;
  const totalCount = Array.isArray(parsedUpdates) ? parsedUpdates.length : (Array.isArray(results) ? results.length : processed.length);
       
  if (processed.length > 0) {
      const header = chooseHeader(processed.length, COMPACT_MODE, false);
      let message = header;
      let successCount = 0;
      for (const r of processed) {
        const rawLine = r.inlineConfirmText ? r.inlineConfirmText : formatResultLine(r, COMPACT_MODE, false);
        if (!rawLine) continue;
        const needsStock = COMPACT_MODE && r.newQuantity !== undefined && !/\(Stock:/.test(rawLine);
        const stockPart = needsStock ? ` (Stock: ${r.newQuantity} ${r.unitAfter ?? r.unit ?? ''})` : '';
        message += `${rawLine}${stockPart}\n`;
        if (r.success) successCount++;
      }
      message += `\n✅ Successfully updated ${successCount} of ${totalCount} items`;
      const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
      await sendMessageDedup(From, formattedResponse);
    }
         __handled = true;
        try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: false }); } catch (_) {}
         return res.send('<Response></Response>');
    } else {
      console.log(`[${requestId}] Not a valid inventory update, checking for specialized operations`);
      // Only if not an inventory update, try quick queries
      try {
        // COPILOT-PATCH-QQ-GUARD-HNI
        const stickyAction = await getStickyActionQuick(From);
        const looksTxn = looksLikeTxnLite(Body);
        if (stickyAction || looksTxn) {                    
            const isDiag = !!classifyDiagnosticPeek(text);
              if (!isDiag) {
          console.log(`[${requestId}] [HNI] skipping quick-query in sticky/txn turn`);
              }
        } else {                     
            const normalized = await normalizeCommandText(Body, detectedLanguage, requestId + ':normalize');
            const handledQuick = await routeQuickQueryRaw(normalized, From, detectedLanguage, requestId);
          if (handledQuick) {
              __handled = true;
            return res.send('<Response></Response>'); // reply already sent via API
          }
        }
      } catch (e) {
        console.warn(`[${requestId}] Quick-query (normalize) routing failed; continuing.`, e?.message);
      }
    }
    
    // Price management commands
    const lowerBody = String(Body ?? '').toLowerCase();
    if (lowerBody.includes('update price')) {
      await handlePriceUpdate(Body, From, detectedLanguage, requestId);
      return;
    }
    if (lowerBody.includes('price list') || lowerBody.includes('prices')) {
      await sendPriceList(From, detectedLanguage, requestId);
      return;
    }

    // Try to parse as inventory update (second pass)
    // COPILOT-PATCH-HNI-PARSE-FROM-SECOND
    const updates = await parseMultipleUpdates({ From, Body },requestId);
    if (Array.isArray(updates) && updates.length > 0) {
      console.log(`[${requestId}] Parsed ${updates.length} updates from text message`);
      const handledCombined = await handleAwaitingPriceExpiry(From, Body, detectedLanguage, requestId);
      if (handledCombined) {
        try {
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message('');
          res.type('text/xml').send(twiml.toString());
          __handled = true;
          return;
        } catch (e){
          res.status(200).end();              
        __handled = true;
        return;
      }
      }
      await setUserState(shopId, 'inventory', { updates, detectedLanguage });
      const results = await updateMultipleInventory(shopId, updates, detectedLanguage);

      if (allPendingPrice(results)) {
        try {
          await setUserState(shopID, 'correction', {
            correctionState: {
              correctionType: 'price',
              pendingUpdate: results[0],
              detectedLanguage,
              id: results[0]?.correctionId
            }
          });
        } catch (_){}
        res.send('<Response></Response>');
        return;
      }

      const allPendingUnified =
        Array.isArray(results) &&
        results.length > 0 &&
        results.every(r => r?.awaiting === 'price+expiry' || r?.needsUserInput === true);
      if (allPendingUnified) {
        // unified prompt already sent
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message('');
        res.type('text/xml').send(twiml.toString());
        return;
      }

      const processed2 = results.filter(r => r?.success && !r.needsPrice && !r.needsUserInput && !r.awaiting);
      const header2 = chooseHeader(processed2.length, COMPACT_MODE, false);
      let message2 = header2;
      let successCount2 = 0;
      for (const r of processed2) {
        const rawLine = r.inlineConfirmText ? r.inlineConfirmText : formatResultLine(r, COMPACT_MODE,false);
        if (!rawLine) continue;
        const needsStock = COMPACT_MODE && r.newQuantity !== undefined && !/\(Stock:/.test(rawLine);
        const stockPart = needsStock ? ` (Stock: ${r.newQuantity} ${r.unitAfter ?? r.unit ?? ''})` : '';
        message2 += `${rawLine}${stockPart}\n`;
        if (r.success) successCount2++;
      }
      message2 += `\n✅ Successfully updated ${successCount2} of ${processed2.length} items`;
      const formattedResponse2 = await t(message2.trim(), detectedLanguage, requestId);
      await sendMessageDedup(From, formattedResponse2);
      await clearUserState(From);
        __handled = true;
      res.send('<Response></Response>');
      try { await maybeShowPaidCTAAfterInteraction(From, detectedLanguage, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}
      return;
    }
  }

  // ✅ Summary command handler (unchanged)
  if (Body) {
    const lowerBody = Body.toLowerCase();
    if (lowerBody.includes('summary')) {
      console.log(`[${requestId}] Summary command detected: "${Body}"`);
      let prefLang = 'en';
      try {
        const userPref2 = await getUserPreference(shopId);
        if (userPref2.success) {
          prefLang = userPref2.language;
        }
      } catch (error) {
        console.warn(`[${requestId}] Failed to get user preference:`, error.message);
      }

      if (lowerBody.includes('full')) {
        let summarySent = false;
        const generatingMessage = await t('🔍 Generating your detailed summary with insights... This may take a moment.', prefLang, requestId);
        await sendMessageViaAPI(From, generatingMessage);
        setTimeout(async () => {
          if (!summarySent) {
            const tip1 = await t('💡 Tip: Products with expiry dates under 7 days are 3x more likely to go unsold. Consider bundling or discounting them! Detailed summary being generated...', prefLang, requestId);
            await sendMessageViaAPI(From, tip1);
          }
        }, 10000);
        setTimeout(async () => {
          if (!summarySent) {
            const tip2 = await t('📦 Did you know? Low-stock alerts help prevent missed sales. Check your inventory weekly! Generating your summary right away...', prefLang, requestId);
            await sendMessageViaAPI(From, tip2);
          }
        }, 30000);
        const fullSummary = await generateFullScaleSummary(shopId, prefLang, requestId);
        summarySent = true;
        await sendMessageViaAPI(From, fullSummary);
        try { await maybeResendListPicker(From, prefLang, requestId); } catch (_) {}
      } else {
        const instantSummary = await generateInstantSummary(shopId, prefLang, requestId);
        await sendMessageViaAPI(From, instantSummary);
        try { await maybeResendListPicker(From, prefLang, requestId); } catch (_) {}
      }
      res.send('<Response></Response>');
      try { await maybeShowPaidCTAAfterInteraction(From, prefLang, { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}
      return;
    }
  }
      
    // Only send generic default if nothing else handled AND we're not in sticky/txn context
      if (!__handled) {
        const stickyAction3 = await getStickyActionQuick();
        const looksTxn3 = looksLikeTxnLite(Body);                
        const isDiag = !!classifyDiagnosticPeek(Body);                  
      // NEW: also suppress during onboarding captures (trial or paid)
        let isOnboardingCapture = false;
        try {
          const st = (typeof getUserStateFromDB === 'function')
            ? await getUserStateFromDB(shopId)
            : await getUserState(shopId);
          isOnboardingCapture = !!(st && (st.mode === 'onboarding_trial_capture' || st.mode === 'onboarding_paid_capture'));
        } catch (_) {}
        if (isOnboardingCapture || (stickyAction3 && !isDiag) || looksTxn3) {
          console.log(`[${requestId}] Suppressing generic default in sticky/txn turn`);
        } else {
          const defaultMessage = await t(
            'Type "mode" to switch Purchase/Sale/Return or ask an inventory query.',
            'en',
            requestId
          );
          await sendMessageViaAPI(From, defaultMessage);
        }
        res.send('<Response></Response>');
        try { await maybeShowPaidCTAAfterInteraction(From, 'en', { trialIntentNow: isStartTrialIntent(Body) }); } catch (_) {}
      }
}

async function handleGreetingResponse(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling greeting response with input: "${Body}"`);
  
  const { greetingLang } = state.data;
  
  // Handle input method selection (though we're removing this requirement)
  if (Body === '1' || Body === '2' || Body.toLowerCase() === 'voice' || Body.toLowerCase() === 'text') {
    // Send confirmation that we're ready for input
    const readyMessage = await t(
      `Perfect! Please send your inventory update now.`,
      greetingLang,
      requestId
    );
    
    await sendMessageViaAPI(From, readyMessage);
    
    // Clear the greeting state
    await clearUserState(From);
    
    res.send('<Response></Response>');
    return;
  }
  
  // If user sends something else, try to parse as inventory update
  const inventoryUpdates = await parseMultipleUpdates(Body,requestId);
  if (inventoryUpdates.length > 0) {
    console.log(`[${requestId}] Parsed ${inventoryUpdates.length} updates from text message`);
    
    const shopId = From.replace('whatsapp:', '');
    const detectedLanguage = await detectLanguageWithFallback(Body, From, requestId);
    // NEW: resolve pending combined corrections (price+expiry) BEFORE routing
          const handledCombined = await handleAwaitingPriceExpiry(From, Body, detectedLanguage, requestId);
          if (handledCombined) {
            safeTrackResponseTime(startTime, requestId);
            // If your handler normally replies with TwiML, you can ACK with minimal TwiML here
            // otherwise it's fine because we already sent via API.
            try {
              const twiml = new twilio.twiml.MessagingResponse();
              twiml.message(''); // minimal ack
              res.type('text/xml').send(twiml.toString());
            } catch (_) {
              res.status(200).end();
            }
            return;
          }
    const results = await updateMultipleInventory(shopId, inventoryUpdates, detectedLanguage);
                 
    // If inline confirmations were already produced (per item),
      // suppress the aggregated "second message" to avoid duplication.
      const hasInline = Array.isArray(results) && results.some(r => r?.inlineConfirmText);
      if (hasInline) {
        console.log(`[${requestId}] Suppressed aggregated ack (inline confirmations present)`);
      } else {          
    // Existing aggregated ack path retained when no inline confirms existed:
        const processed = results.filter(r => !r.needsPrice && !r.needsUserInput && !r.awaiting);
        const header = chooseHeader(processed.length, COMPACT_MODE, false);
        let message = header;
        let successCount = 0;
        for (const r of processed) {
          const rawLine = r.inlineConfirmText ? r.inlineConfirmText : formatResultLine(r, COMPACT_MODE,false);
          if (!rawLine) continue;
          const needsStock = COMPACT_MODE && r.newQuantity !== undefined && !/\(Stock:/.test(rawLine);
          const stockPart = needsStock ? ` (Stock: ${r.newQuantity} ${r.unitAfter ?? r.unit ?? ''})` : '';
          message += `${rawLine}${stockPart}\n`;
          if (r.success) successCount++;
        }
        message += `\n✅ Successfully updated ${successCount} of ${processed.length} items`;
        const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
        await sendMessageDedup(From, formattedResponse);
      }
    
    // Clear state after processing
    await clearUserState(From);
  } else {
    // If not a valid update, send help message
    const helpMessage = await t(
      `I didn't understand that. Type "mode" to switch Purchase/Sale/Return or ask an inventory query.`,
      greetingLang,
      requestId
    );
    
    await sendMessageViaAPI(From, helpMessage);
  }
  
  res.send('<Response></Response>');
}

function extractProductName(fullText) {
  // Remove quantity indicators and units
  let cleaned = fullText
    .replace(/\b\d+\s*(kg|kgs|gram|grams|g|pack|packs|packet|packets|box|boxes|piece|pieces|pc|pcs|litre|litres|liter|liters|l|ml)\b/gi, '')
    .replace(/\b(purchased|bought|sold|remaining|left|of)\b/gi, '')
    .replace(/^\d+\s*/, '')  // Remove leading numbers
    .replace(/\s+$/, '')     // Remove trailing spaces
    .trim();
  
  // Handle specific cases
  if (cleaned.toLowerCase().includes('packs of')) {
    cleaned = cleaned.replace(/(\d+)\s*packs\s+of\s+(.+)/i, '$2');
  }
  
  if (cleaned.toLowerCase().includes('kg of')) {
    cleaned = cleaned.replace(/(\d+)\s*kg\s+of\s+(.+)/i, '$2');
  }
  
  if (cleaned.toLowerCase().includes('litres of')) {
    cleaned = cleaned.replace(/(\d+)\s*litres?\s+of\s+(.+)/i, '$2');
  }
  
  console.log(`[Product Extraction] "${fullText}" → "${cleaned}"`);
  return cleaned;
}

async function handleVoiceConfirmationState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling voice confirmation with input: "${Body}"`);
  
  // Verify state persistence
  const persistenceCheck = await verifyStatePersistence(From, 'confirmation');
  if (!persistenceCheck) {
    console.error(`[${requestId}] State persistence failed, treating as new interaction`);
    await handleNewInteraction(Body, null, 0, From, requestId, res);
    return;
  }
  
  const { pendingTranscript, detectedLanguage, type } = state.data;
  const shopId = From.replace('whatsapp:', '');
  
  const yesVariants = ['yes', 'haan', 'हाँ', 'ha', 'ok', 'okay'];
  const noVariants = ['no', 'nahin', 'नहीं', 'nahi', 'cancel'];
  
  if (yesVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User confirmed voice transcription`);
    
    // Parse the transcript to get update details
    try {
      const updates = await parseMultipleUpdates(pendingTranscript,requestId);
      if (updates.length > 0) {
        
    // Process the confirmed updates
              
    const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
    
              // --- GUARD: suppress aggregated ack when inline confirmations already exist ---
              const hasInline = Array.isArray(results) && results.some(r => r?.inlineConfirmText);
              if (hasInline) {
                console.log(`[${requestId}] [voice-agg-guard] Suppressed aggregated ack (inline confirmations present)`);
              } else {
                const processed = results.filter(r => !r.needsPrice && !r.needsUserInput && !r.awaiting);
                const header = chooseHeader(processed.length, COMPACT_MODE, false);
                let message = header;
                let successCount = 0;
                for (const r of processed) {
                  const rawLine = r.inlineConfirmText ? r.inlineConfirmText : formatResultLine(r, COMPACT_MODE,false);
                  if (!rawLine) continue;
                  const needsStock = COMPACT_MODE && r.newQuantity !== undefined && !/\(Stock:/.test(rawLine);
                  const stockPart = needsStock ? ` (Stock: ${r.newQuantity} ${r.unitAfter ?? r.unit ?? ''})` : '';
                  message += `${rawLine}${stockPart}\n`;
                  if (r.success) successCount++;
                }
                message += `\n✅ Successfully updated ${successCount} of ${processed.length} items`;
                // FIX: Send via WhatsApp API instead of synchronous response
                const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
                await sendMessageDedup(From, formattedResponse);
              }
              // Clear state after processing (both branches)
              await clearUserState(From);
      } else {
        // If parsing failed, ask to retry
        const errorMessage = await t(
          'Sorry, I couldn\'t parse your inventory update. Please try again with a clear voice message.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
        await clearUserState(From);
      }
    } catch (parseError) {
      console.error(`[${requestId}] Error parsing transcript for confirmation:`, parseError.message);
      // If parsing failed, ask to retry            
      // STEP 6: Skip tail/apology if this request was already handled upstream
          if (handledRequests.has(requestId)) {
            return; // do not send late apology/tail
          }
      const errorMessage = await t(
        'Sorry, I had trouble processing your message. Please try again.',
        detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, errorMessage);
      await clearUserState(From);
    }
    
  } else if (noVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User rejected voice transcription`);
    
    // Parse the transcript to get update details
    try {
      const updates = await parseMultipleUpdates(pendingTranscript,requestId);
      let update;
      
      if (updates.length > 0) {
        // Take the first update (assuming one product per message for correction)
        update = updates[0];
      } else {
        // If parsing failed, create a default update object with the transcript as product
        update = {
          product: pendingTranscript,
          quantity: 0,
          unit: '',
          action: 'purchased',
          isKnown: false
        };
        console.log(`[${requestId}] Created default update object for correction:`, update);
      }
      
      // Save correction state to database with type 'selection'
      console.log(`[${requestId}] Saving correction state to database for shop: ${shopId}`);
      const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
      
      if (saveResult.success) {
        console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id}`);
        
        // Set correction state
        await setUserState(shopId, 'correction', {
          correctionState: {
            correctionType: 'selection',
            pendingUpdate: update,
            detectedLanguage,
            id: saveResult.id
          }
        });
        
        // Show correction options
        const correctionMessage = `I heard: "${update.quantity} ${update.unit} of ${update.product}" (${update.action}).  
What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
        
        const translatedMessage = await t(correctionMessage, detectedLanguage, requestId);
        await sendMessageViaAPI(From, translatedMessage);
      } else {
        console.error(`[${requestId}] Failed to save correction state: ${saveResult.error}`);
        // Fallback to asking for retry
        const errorMessage = await t(
          'Please try again with a clear voice message.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
      }
    } catch (parseError) {
      console.error(`[${requestId}] Error parsing transcript for correction:`, parseError.message);
      
      // Even if there's an error during parsing, create a default update object and proceed to correction
      const update = {
        product: pendingTranscript,
        quantity: 0,
        unit: '',
        action: 'purchased',
        isKnown: false
      };
      
      // Save correction state to database with type 'selection'
      console.log(`[${requestId}] Saving correction state to database for shop: ${shopId} (fallback)`);
      const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
      
      if (saveResult.success) {
        console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id} (fallback)`);
        
        // Set correction state
        await setUserState(shopID, 'correction', {
          correctionState: {
            correctionType: 'selection',
            pendingUpdate: update,
            detectedLanguage,
            id: saveResult.id
          }
        });
        
        // Show correction options
        const correctionMessage = `I heard: "${update.product}" (${update.action}).  
What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
        
        const translatedMessage = await t(correctionMessage, detectedLanguage, requestId);
        await sendMessageViaAPI(From, translatedMessage);
      } else {
        // If even the fallback fails, ask to retry
        const errorMessage = await t(
          'Please try again with a clear voice message.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
      }
    }
  } else {
    // Invalid response
    const errorMessage = await t(
      'Please reply with "yes" or "no".',
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, errorMessage);
  }
  
  res.send('<Response></Response>');
}

async function handleTextConfirmationState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling text confirmation with input: "${Body}"`);
  
  const { pendingTranscript, detectedLanguage, type } = state.data;
  const shopId = From.replace('whatsapp:', '');
  
  const yesVariants = ['yes', 'haan', 'हाँ', 'ha', 'ok', 'okay'];
  const noVariants = ['no', 'nahin', 'नहीं', 'nahi', 'cancel'];
  
  if (yesVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User confirmed text update`);
    
    // Parse the transcript to get update details
    try {      
        const updates = await parseMultipleUpdates(pendingTranscript,requestId);
              if (updates.length === 0) {
                // If parsing failed, ask to retry
                const errorMessage = await t(
                  'Sorry, I couldn\'t parse your inventory update. Please try again with a clear message.',
                  detectedLanguage,
                  requestId
                );
                await sendMessageViaAPI(From, errorMessage);
                await clearUserState(From);
                return;
              }
        
              // STRICT: split into accepted vs lacking-price (backend unknown)
              const langHint = await detectLanguageWithFallback(pendingTranscript, From, requestId);
              const lacking = [];
              const accepted = [];
              for (const u of updates) {
                try {
                  if (String(u?.action ?? '').toLowerCase() === 'purchased') {
                    const hasPrice = Number.isFinite(u?.pricePerUnit);
                    let backend = null;
                    try { backend = await getProductPrice(u.product, shopId); } catch {}
                    const priceKnown = !!(backend?.success && Number.isFinite(backend?.price));
                    if (!hasPrice && !priceKnown) {
                      lacking.push({ product: u.product, unit: u.unit }); // raw only
                      continue; // do NOT accept this line
                    }
                    if (!hasPrice && priceKnown) {
                      u.pricePerUnit = backend.price; // allow success if backend knows price
                    }
                  }
                  accepted.push(u);
                } catch {}
              }
        
              // 1) Commit accepted items
              if (accepted.length > 0) {
                const results = await updateMultipleInventory(shopId, accepted, detectedLanguage);
                const hasInline = Array.isArray(results) && results.some(r => r?.inlineConfirmText);
                if (!hasInline) {                  
              // --- STRICT: build lines only for successful writes and suppress right after a price nudge ---
               const shopIdLocal = String(From).replace('whatsapp:', '');
               const lastNudgeTs = globalThis.__recentPriceNudge?.get(shopIdLocal) ?? 0;
               const justNudged = lastNudgeTs && (Date.now() - lastNudgeTs) < 5000; // 5s window
              
               const successLines = Array.isArray(results)
                 ? results
                     .filter(r => r?.success)               // only successful writes
                     .map(r => r?.inlineConfirmText)
                     .filter(Boolean)
                 : [];
              
               // If nothing actually succeeded or we just nudged, do NOT send any confirmation
               if (justNudged || successLines.length === 0) {
                 // optional: log for diagnostics
                 console.log(`[${requestId}] agg-ack suppressed (justNudged=${justNudged}, successLines=${successLines.length})`);
              } else {
                 // Header only when there are successful items
                 const header = chooseHeader(successLines.length, COMPACT_MODE, /*isPrice*/ false);
                 const message = [header, ...successLines].join('\n').trim();
                 const formattedResponse = await t(message, detectedLanguage, requestId);
                 await sendMessageDedup(From, formattedResponse);
               }
                } else {
                  console.log(`[${requestId}] [text-agg-guard] Suppressed aggregated ack (inline confirmations present)`);
                }
              }
        
              // 2) Send nudges for items missing price (backend unknown) — no DB writes, no success
              if (lacking.length === 1) {
                await sendPriceRequiredNudge(From, lacking[0].product, lacking[0].unit, langHint);
              } else if (lacking.length > 1) {
                await sendMultiPriceRequiredNudge(From, lacking, langHint);
              }
        
              // Clear state after processing
              await clearUserState(From);
    } catch (parseError) {
      console.error(`[${requestId}] Error parsing transcript for confirmation:`, parseError.message);
      // If parsing failed, ask to retry           
      // STEP 6: Skip tail/apology if this request was already handled upstream
          if (handledRequests.has(requestId)) {
            return; // do not send late apology/tail
          }
      const errorMessage = await t(
        'Sorry, I had trouble processing your message. Please try again.',
        detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, errorMessage);
      await clearUserState(From);
    }
    
  } else if (noVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User rejected text update`);
    
    // Parse the transcript to get update details
    try {
      const updates = await parseMultipleUpdates(pendingTranscript,requestId);
      let update;
      
      if (updates.length > 0) {
        // Take the first update (assuming one product per message for correction)
        update = updates[0];
      } else {
        // FIX: If parsing failed, create a default update object with the transcript as product
        update = {
          product: pendingTranscript,
          quantity: 0,
          unit: '',
          action: 'purchased',
          isKnown: false
        };
        console.log(`[${requestId}] Created default update object for correction:`, update);
      }
      
      // Save correction state to database with type 'selection'
      console.log(`[${requestId}] Saving correction state to database for shop: ${shopId}`);
      const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
      
      if (saveResult.success) {
        console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id}`);
        
        // Set correction state
        await setUserState(shopID, 'correction', {
          correctionState: {
            correctionType: 'selection',
            pendingUpdate: update,
            detectedLanguage,
            id: saveResult.id
          }
        });
        
        // Show correction options
        const correctionMessage = `I heard: "${update.quantity} ${update.unit} of ${update.product}" (${update.action}).  
What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
        
        const translatedMessage = await t(correctionMessage, detectedLanguage, requestId);
        await sendMessageViaAPI(From, translatedMessage);
      } else {
        console.error(`[${requestId}] Failed to save correction state: ${saveResult.error}`);
        // Fallback to asking for retry
        const errorMessage = await t(
          'Please try again with a clear message.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
      }
    } catch (parseError) {
      console.error(`[${requestId}] Error parsing transcript for correction:`, parseError.message);
      
      // FIX: Even if there's an error during parsing, create a default update object and proceed to correction           
      // STEP 6: If already handled, avoid sending any late fallback
          if (handledRequests.has(requestId)) {
            return;
          }
      const update = {
        product: pendingTranscript,
        quantity: 0,
        unit: '',
        action: 'purchased',
        isKnown: false
      };
      
      // Save correction state to database with type 'selection'
      console.log(`[${requestId}] Saving correction state to database for shop: ${shopId} (fallback)`);
      const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
      
      if (saveResult.success) {
        console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id} (fallback)`);
        
        // Set correction state
        await setUserState(shopID, 'correction', {
          correctionState: {
            correctionType: 'selection',
            pendingUpdate: update,
            detectedLanguage,
            id: saveResult.id
          }
        });
        
        // Show correction options
        const correctionMessage = `I heard: "${update.product}" (${update.action}).  
What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
        
        const translatedMessage = await t(correctionMessage, detectedLanguage, requestId);
        await sendMessageViaAPI(From, translatedMessage);
      } else {
        // If even the fallback fails, ask to retry
        const errorMessage = await t(
          'Please try again with a clear message.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
      }
    }
  } else {
    // Invalid response
    const errorMessage = await t(
      'Please reply with "yes" or "no".',
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, errorMessage);
  }
  
  res.send('<Response></Response>');
}

async function handleProductConfirmationState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling product confirmation with input: "${Body}"`);
  
  const { pendingTranscript, detectedLanguage, unknownProducts } = state.data;
  const shopId = From.replace('whatsapp:', '');
  
  const yesVariants = ['yes', 'haan', 'हाँ', 'ha', 'ok', 'okay'];
  const noVariants = ['no', 'nahin', 'नहीं', 'nahi', 'cancel'];
  
  if (yesVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User confirmed unknown products`);
    
    // Process the updates even with unknown products
    const results = await updateMultipleInventory(shopId, unknownProducts, detectedLanguage);
    
    
const header = chooseHeader(processed.length, COMPACT_MODE, false);
      let message = header;
      let successCount = 0;

      for (const r of processed) {
        const rawLine = r.inlineConfirmText ? r.inlineConfirmText : formatResultLine(r, COMPACT_MODE,false);
        if (!rawLine) continue;
        const needsStock = COMPACT_MODE && r.newQuantity !== undefined && !/\(Stock:/.test(rawLine);
        const stockPart = needsStock ? ` (Stock: ${r.newQuantity} ${r.unitAfter ?? r.unit ?? ''})` : '';
        message += `${rawLine}${stockPart}\n`;
        if (r.success) successCount++;
      }

      message += `\n✅ Successfully updated ${successCount} of ${processed.length} items`;
      const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
      await sendMessageDedup(From, formattedResponse);
    
    // Clear state after processing
    await clearUserState(From);
    
  } else if (noVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User rejected unknown products`);
    
    // Take the first unknown product for correction
    const update = unknownProducts[0];
    
    // Save correction state to database with type 'selection'
    console.log(`[${requestId}] Saving correction state to database for shop: ${shopId}`);
    const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
    
    if (saveResult.success) {
      console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id}`);
      
      // Set correction state
      await setUserState(shopID, 'correction', {
        correctionState: {
          correctionType: 'selection',
          pendingUpdate: update,
          detectedLanguage,
          id: saveResult.id
        }
      });
      
      // Show correction options
      const correctionMessage = `I heard: "${update.quantity} ${update.unit} of ${update.product}" (${update.action}).  
What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
      
      const translatedMessage = await t(correctionMessage, detectedLanguage, requestId);
      await sendMessageViaAPI(From, translatedMessage);
    }
  } else {
    // Invalid response
    const errorMessage = await t(
      'Please reply with "yes" or "no".',
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, errorMessage);
  }
  
  res.send('<Response></Response>');
}

async function verifyStatePersistence(from, expectedMode) {
  const state = await getUserState(from);
  if (!state || state.mode !== expectedMode) {
    console.warn(`[State] Persistence check failed for ${from}. Expected: ${expectedMode}, Got: ${state ? state.mode : 'none'}`);
    return false;
  }
  console.log(`[State] Persistence check passed for ${from}: ${expectedMode}`);
  return true;
}

// Check user authentication
async function checkUserAuthorization(From, Body, requestId) {
  const shopId = String(From).replace('whatsapp:', ''); // keep leading + intact
  console.log(`[${requestId}] Checking authorization (soft) for shopId: "${shopId}"`);

  try {
    // Soft-gate lookup in AuthUsers (no hard block for new users)
    const rec = await getAuthUserRecord(shopId);
    if (!rec) {
      // Brand-new user → allow. If they typed “1/yes/start/trial/ok”, start trial now.
      const wantTrial = /^(1|yes|haan|start|trial|ok)$/i.test(String(Body || '').trim());
      if (wantTrial) {
        const s = await startTrialForAuthUser(shopId, Number(process.env.TRIAL_DAYS ?? 3));
        if (s?.success) {
          return { authorized: true, upsellReason: 'trial_started', justAuthenticated: true };
        }
      }
      return { authorized: true, upsellReason: 'new_user' };
    }
    // Existing record: check explicit restricted states only
    const status = String(rec.fields?.StatusUser ?? '').toLowerCase();
    if (['deactivated','blacklisted','blocked'].includes(status)) {
      return { authorized: false, upsellReason: 'blocked' };
    }
    // Trial-ended hinting (allow, but show paywall later)
    const pref = await getUserPreference(shopId);
    const plan = String(pref?.plan ?? '').toLowerCase();
    const trialEnd = pref?.trialEndDate ? new Date(pref.trialEndDate) : null;
    if (plan === 'trial' && trialEnd && Date.now() > trialEnd.getTime()) {
      return { authorized: true, upsellReason: 'trial_ended' };
    }
    // All good
    return { authorized: true, upsellReason: 'none' };
  } catch (e) {
    console.warn(`[${requestId}] Soft auth error: ${e.message}`);
    // Fail-open for new users to enable onboarding
    return { authorized: true, upsellReason: 'new_user' };
  }
}

// Send unauthorized response
async function sendUnauthorizedResponse(From, requestId) {
  const message = `🚫 Unauthorized Access

Sorry, you are not authorized to use this inventory system.

If you believe this is an error, please contact the administrator at +91-9013283687 to get your authentication code.

This is a secure system for authorized users only.`;
  
  await sendMessageViaAPI(From, message);
}

// Send authentication success response
async function sendAuthSuccessResponse(From, user, requestId) {
  const message = `✅ Authentication Successful!

Welcome${user.name ? ' ' + user.name : ''}! You are now authorized to use the inventory system.

You can now send inventory updates like:
• "10 Parle-G sold at 11/packet exp 22/11/2025"
• "5kg sugar purchased at 40/kg exp 11/12"

Your authentication code is: *${user.authCode}*
Please save this code for future use.`;
  
  await sendMessageViaAPI(From, message);
}

// Log performance metrics periodically
setInterval(() => {
  if (responseTimes.count > 0) {
    const avg = responseTimes.total / responseTimes.count;
    console.log(`Performance stats - Avg: ${avg.toFixed(2)}ms, Max: ${responseTimes.max}ms, Count: ${responseTimes.count}`);
    // Reset for next period
    responseTimes.total = 0;
    responseTimes.count = 0;
    responseTimes.max = 0;
  }
}, 60 * 1000);
