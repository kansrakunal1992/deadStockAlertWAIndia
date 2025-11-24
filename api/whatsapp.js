const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { execSync } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// ---------------------------------------------------------------------------
// STEP 2: HOISTED GLOBALS (fix early references like "handledRequests is not defined")
// Place all global Sets/Maps and TTLs at the very top, right after imports.
// ---------------------------------------------------------------------------
// Handled/apology guard: track per-request success to prevent late apologies
const handledRequests = new Set();            // <- used by parse-error & upsell schedulers
// --- Defensive shim: provide a safe setUserState if not present (prevents runtime errors)
if (typeof globalThis.setUserState !== 'function') {      
    globalThis.setUserState = async function setUserState(from, mode, data = {}) {
        try {
          const shopId = String(from ?? '').replace('whatsapp:', '');
          if (typeof saveUserStateToDB === 'function') {
            const r = await saveUserStateToDB(shopId, mode, data);
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
      const shopId = String(from ?? '').replace('whatsapp:', '');
      if (typeof getUserStateFromDB === 'function') {
        return await getUserStateFromDB(shopId);
      }
    } catch (_) {}
    return null;
  };
}
// Caches
const languageCache = new Map();
const productMatchCache = new Map();
const inventoryCache = new Map();
const productTranslationCache = new Map();
// TTLs
const LANGUAGE_CACHE_TTL = 24 * 60 * 60 * 1000;          // 24 hours
const INVENTORY_CACHE_TTL = 5 * 60 * 1000;               // 5 minutes
const PRODUCT_CACHE_TTL = 60 * 60 * 1000;                // 1 hour
const PRODUCT_TRANSLATION_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// [UNIQ:ORCH-VAR-LOCK-001] Variant lock & Sales-QA cache helpers
// ============================================================================
// Keep exact language variant (e.g., 'hi-latn') instead of normalizing to 'hi'
function ensureLangExact(languageDetected, fallback = 'en') {
  const l = String(languageDetected || fallback).toLowerCase().trim();
  // Do NOT convert 'hi-latn' -> 'hi' (this caused cache/template mismatches)
  return l;
}
// Normalize user question for cache key purposes
function normalizeUserTextForKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s₹\.]/gu, '');
}
// Build a robust Sales-QA key that separates language variants & topics
// Using base64 for log readability (your logs show base64 promptHash values)
function buildSalesQaCacheKey({ langExact, topicForced, pricingFlavor, text }) {
  // crypto is already imported in your file; reuse it here
  const payload = [
    'sales-qa',
    String(langExact || 'en'),
    String(topicForced || 'none'),
    String(pricingFlavor || 'none'),
    normalizeUserTextForKey(text)
  ].join('::');
  return crypto.createHash('sha1').update(payload).digest('base64');
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

// === Single-block formatter with de-duplication for echoes ===================
function normalizeTwoBlockFormat(raw, languageCode) {
  if (!raw) return '';
  const L = String(languageCode ?? 'en').toLowerCase();
  const romanOnly = shouldUseRomanOnly(L);
  let s = String(raw ?? '')
    .replace(/[`"<>\[\]]/g, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
  const punct = /[.!?]$/;
  // De-echo: drop exact duplicate lines and bilingual echoes
  const lines = s.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const uniq = [];
  const seen = new Set();
  for (const l of lines) {
    const key = l.toLowerCase();
    if (!seen.has(key)) { uniq.push(l); seen.add(key); }
  }
  s = uniq.join('\n');
  if (romanOnly) {
    if (!s) return '';
    return punct.test(s) ? s : (s + '.');
  }
  const parts = s.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const nonAscii = /[^\x00-\x7F]/;
  if (parts.length >= 2) {
    const nativeBlock = parts.find(p => nonAscii.test(p)) ?? parts[0] ?? '';
    const safeNative = nativeBlock ? (punct.test(nativeBlock) ? nativeBlock : nativeBlock + '.') : '';
    return safeNative;
  }
  return punct.test(s) ? s : (s + '.');
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
async function parseMultipleUpdates(reqOrText) {
  // Shape detection: request-like vs plain text
  const isReq = reqOrText && typeof reqOrText === 'object';
  const from =
    (isReq && (reqOrText.body?.From || reqOrText.From)) || null;
  const transcript =
    (isReq && (reqOrText.body?.Body || reqOrText.Body)) ||
    (!isReq ? String(reqOrText ?? '') : '');

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
  const t = String(transcript || '').trim();       
  // Prefer DB state; use in-memory fallback if DB read is transiently null
  const userState = (await getUserStateFromDB(shopId)) || globalState.conversationState[shopId] || null;

  // Standardize valid actions - use 'sold' consistently
  const VALID_ACTIONS = ['purchase', 'sold', 'remaining', 'returned'];
  
  // Get pending action from user state if available    
  let pendingAction = null;
    if (userState) {
      if (userState.mode === 'awaitingTransactionDetails' && userState.data?.action) {
        pendingAction = userState.data.action;              // purchase | sold | returned
      } else if (userState.mode === 'awaitingBatchOverride') {
        pendingAction = 'sold';                             // still in SALE context
      } else if (userState.mode === 'awaitingPurchaseExpiryOverride') {
        pendingAction = 'purchase';                         // still in PURCHASE context
      }
      if (pendingAction) {
        console.log(`[parseMultipleUpdates] Using pending action from state: ${pendingAction}`);
      }
    }
  
  // Never treat summary commands as inventory messages
  if (resolveSummaryIntent(t)) return [];
  // NEW: ignore read-only inventory queries outright
  if (isReadOnlyQuery(t)) {
    console.log('[Parser] Read-only query detected; skipping update parsing.');
    return [];
  }  
 // NEW: only attempt update parsing if message looks like a transaction
 // Relax when we already have a sticky mode/pending action (consume verb-less lines)
   if (!looksLikeTransaction(t) && !pendingAction) {
    console.log('[Parser] Not transaction-like; skipping update parsing.');
    return [];
  }
        
  // Try AI-based parsing first  
  try {
    console.log(`[AI Parsing] Attempting to parse: "${transcript}"`);  
    const aiUpdate = await parseInventoryUpdateWithAI(transcript, 'ai-parsing');
    // Only accept AI results if they are valid inventory updates (qty > 0 + valid action)
    if (aiUpdate && aiUpdate.length > 0) {          
    const cleaned = aiUpdate.map(update => {
        try {
          // Apply state override with validation            
          const normalizedPendingAction = String(pendingAction ?? '').toLowerCase();
          const ACTION_MAP = {                     
            purchase: 'purchase',
            buy: 'purchase',
            bought: 'purchase',
            sold: 'sold',
            sale: 'sold',
            return: 'returned',
            returned: 'returned'
          };
          
          const finalAction = ACTION_MAP[normalizedPendingAction] ?? normalizedPendingAction;
          
          if (['purchase', 'sold', 'remaining', 'returned'].includes(finalAction)) {
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
      
      // Simple parser for verb-less lines like: "milk 10 litres at 40/litre"
      function parseSimpleWithoutVerb(s, actionHint) {
        try {
          const mQty = s.match(/(^|\s)(\d+(?:\.\d+)?)(?=\s*(ltr|l|liter|litre|liters|litres|kg|g|gm|ml|packet|packets|piece|pieces)\b)/i);
          const mUnit = s.match(/\b(ltr|l|liter|litre|liters|litres|kg|g|gm|ml|packet|packets|piece|pieces)\b/i);
          const mPrice = s.match(/\b(?:at|@)\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(ltr|l|liter|litre|liters|litres|kg|g|gm|ml|packet|packets|piece|pieces))?/i);
          const idxQty = mQty ? s.indexOf(mQty[2]) : -1;
          if (idxQty < 1 || !mUnit) return null;
          const product = s.slice(0, idxQty).replace(/\bat\b$/i, '').trim();
          const qty = parseFloat(mQty[2]);
          const unitToken = mUnit[1].toLowerCase();
          const price = mPrice ? parseFloat(mPrice[1]) : null;
          return { action: actionHint || 'purchase', product, quantity: qty, unit: unitToken, pricePerUnit: price, expiry: null };
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
            purchase: 'purchase',
            buy: 'purchase',
            bought: 'purchase',
            sold: 'sold',
            sale: 'sold',
            return: 'returned',
            returned: 'returned'
          };
          
          const finalAction = ACTION_MAP[normalizedPendingAction] ?? normalizedPendingAction;
          
          if (['purchase', 'sold', 'remaining', 'returned'].includes(finalAction)) {
            update.action = finalAction;
            console.log(`[Rule Parsing] Overriding action with normalized state action: ${update.action}`);
          } else {
            console.warn(`[AI Parsing] Invalid action in state: ${pendingAction}`);
          }      
          // Only translate if not already processed by AI
          update.product = await translateProductName(update.product, 'rule-parsing');                                               
            } else if (pendingAction) {
                      // Verb-less fallback: only when sticky mode exists AND AI has already failed
                      const normalizedPendingAction = String(pendingAction ?? '').toLowerCase();
                      const ACTION_MAP = { purchase:'purchase', buy:'purchase', bought:'purchase', sold:'sold', sale:'sold', return:'returned', returned:'returned' };
                      const finalAction = ACTION_MAP[normalizedPendingAction] ?? normalizedPendingAction;
                      const alt = parseSimpleWithoutVerb(trimmed, finalAction);
                      if (alt) {
                        alt.product = await translateProductName(alt.product, 'rule-parsing');
                        if (isValidInventoryUpdate(alt)) {
                          updates.push(alt);
                          continue;
                        }
                      }
        }
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
  return updates;
}

// SAFE SHIM: ensure nativeglishWrap exists even if bundling misses the real one
if (typeof nativeglishWrap !== 'function') {
  function nativeglishWrap(text, lang) {
    try {
      const anchors = ['kg','kgs','g','gm','gms','ltr','ltrs','l','ml','packet','packets','piece','pieces','₹','Rs','MRP'];
      let out = String(text ?? '');
      anchors.forEach(tok => {
        const rx = new RegExp(`\\b${tok}\\b`, 'gi');
        out = out.replace(rx, tok);
      });
      return out;
    } catch {
      return String(text ?? '');
    }
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
        `Tip: “${SWITCH_WORD.hi}” लिखें Purchase/Sale/Return बदलने के लिए`
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
        `Tip: “${SWITCH_WORD.bn}” টাইপ করুন Purchase/Sale/Return বদলাতে`
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
        `Tip: “${SWITCH_WORD.ta}” என தட்டச்சு செய்து Purchase/Sale/Return மாறவும்`
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
        `Tip: “${SWITCH_WORD.te}” టైప్ చేసి Purchase/Sale/Return మార్చండి`
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
        `Tip: “${SWITCH_WORD.kn}” ಎಂದು ಟೈಪ್ ಮಾಡಿ Purchase/Sale/Return ಬದಲಿಸಿ`
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
        `Tip: “${SWITCH_WORD.mr}” टाइप करा Purchase/Sale/Return बदलण्यासाठी`
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
        `Tip: “${SWITCH_WORD.gu}” લખો Purchase/Sale/Return બદલવા`
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
        `Tip: type “${SWITCH_WORD.hi}” to switch Purchase/Sale/Return`
      ].join('\n');

    default: // English
      return [
        'Demo:',
        'User: sold milk 2 ltr',
        'Bot: ✅ Sold 2 ltr milk @ ₹? each — Stock: (updated)',
        'User: purchase Parle-G 12 packets ₹10 exp +6m',
        'Bot: ✅ Purchased 12 packets Parle-G — Price: ₹10',
        '      Expiry: set to +6 months',
        'User: short summary',
        'Bot: 📊 Short Summary — Sales Today, Low Stock, Expiring Soon…',
        '',
        'Tip: type “mode” to switch Purchase/Sale/Return'
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

// Return true if user's text is romanized for the target language (so reply should be roman)
function preferRomanFor(lang, sourceText) {
  const t = String(sourceText || '').trim();
  if (!t) return false;
  const lc = String(lang || 'en').toLowerCase();
  switch (lc) {
    case 'hi':
    case 'mr': return !_hasDevanagari(t);
    case 'bn': return !_hasBengali(t);
    case 'ta': return !_hasTamil(t);
    case 'te': return !_hasTelugu(t);
    case 'kn': return !_hasKannada(t);
    case 'gu': return !_hasGujarati(t);
    default:   return false;
  }
}

// NEW: Force -Latn variant when source looks Roman Indic (Hinglish)
function forceLatnIfRoman(languageCode, sourceText) {
  const raw = String(sourceText ?? '');
  const ascii = /^[\x00-\x7F]+$/.test(raw);
  const romanIndicTokens = /\b(kya|kyu|kaise|kab|kitna|daam|kimat|fayda|nuksan|bana|sakte|skte|hai|h|kharid|bech|karo)\b/i;
  if (ascii && romanIndicTokens.test(raw)) {
    const base = String(languageCode ?? 'hi').toLowerCase().replace(/-latn$/,'');
    return `${base}-latn`;
  }
  return languageCode;
}

// Localization helper: centralize generateMultiLanguageResponse + single-script clamp
// === SAFETY: single-script clamp with short-message guard =====================
const NO_CLAMP_MARKER = '<!NO_CLAMP!>'; // opt out of clamps when needed (help/tutorials)

function enforceSingleScriptSafe(out, lang) {
  // Allow explicit opt-out (tutorial/help that you want bilingual)
  if (String(out ?? '').startsWith(NO_CLAMP_MARKER)) {
    return String(out).slice(NO_CLAMP_MARKER.length);
  }
  if (!SINGLE_SCRIPT_MODE) return out;    
  // ALWAYS clamp for all languages (English, Roman-Indic, native scripts).
  // This guarantees a single-script output in every case.
  return enforceSingleScript(out, lang);
}
async function t(text, languageCode, requestId) {
  const out = await generateMultiLanguageResponse(text, languageCode, requestId);
  return enforceSingleScriptSafe(out, languageCode);
}

/**
 * tx: Translation wrapper with script preservation (roman/native).
 * If the user typed roman for lang, try `${lang}-Latn` first and fall back to `${lang}`.
 */
async function tx(message, lang, fromOrShopId, sourceText, cacheKey) {  
// Decide final target language: force -Latn when user text looks Hinglish
  let L = String(lang ?? 'en').toLowerCase();
  L = forceLatnIfRoman(L, sourceText);
  const preferRoman = preferRomanFor(L, sourceText);

  try {       
    if (preferRoman || L.endsWith('-latn')) {
          return await t(message, L, cacheKey); // already *-Latn
        }
        return await t(message, L, cacheKey);
  } catch (_) {
    try { return await t(message, L, cacheKey); } catch { return String(message); }
  }
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

// "Nativeglish": keep helpful English anchors (units, brand words) in otherwise localized text.
function nativeglishWrap(text, lang) {
  try {
    const u = ['kg','kgs','g','ltr','l','ml','packet','packets','piece','pieces','₹','Rs','MRP'];
    // ensure numerals and unit tokens remain Latin where helpful
    let out = String(text ?? '');
    u.forEach(tok => {
      const rx = new RegExp(`\\b${tok}\\b`, 'gi');
      out = out.replace(rx, tok); // normalize casing
    });
    return out;
  } catch { return String(text ?? ''); }
}

// ---- NEW: helper to sanitize after late string edits (e.g., replacing labels)
function sanitizeAfterReplace(text, lang) {
  try {
    const wrapped = nativeglishWrap(text, lang);
    return enforceSingleScript(wrapped, lang);
  } catch {
    return text;
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
      case 'awaitingPurchaseExpiryOverride': return 'purchase';
      default: return st.data?.action ?? null;
    }
  } catch { return null; }
}
function looksLikeTxnLite(s) {
  const t = String(s ?? '').toLowerCase();
  const hasNum = /\d/.test(t);
  const hasUnit = /\b(ltr|l|liter|litre|liters|litres|kg|g|gm|ml|packet|packets|piece|pieces|box|boxes)\b/i.test(t);
  const hasPrice = /\b(?:@|at)\s*\d+(?:\.\d+)?(?:\s*\/\s*(ltr|l|liter|litre|liters|litres|kg|g|gm|ml|packet|packets|piece|pieces|box|boxes))?/i.test(t)
                 || /(?:₹|rs\.?|inr)\s*\d+(?:\.\d+)?/i.test(t);
  // Verb-less acceptance: number + unit is sufficient in sticky mode; price is optional
  return (hasNum && hasUnit) || (hasUnit && hasPrice);
}

/**
 * applyAIOrchestration(text, From, detectedLanguageHint, requestId)
 * Merges orchestrator advice into our routing variables:
 * - language: prefer AI language if present; persist preference (best-effort).
 * - isQuestion: true if kind === 'question'.
 * - normalizedCommand: exact English command if kind === 'command'.
 * - aiTxn: parsed transaction skeleton (NEVER auto-applied; deterministic parser still decides).
 * NOTE: All business gating (ensureAccessOrOnboard, trial/paywall, template sends) stays non-AI.  [1](https://airindianew-my.sharepoint.com/personal/kunal_kansra_airindia_com/Documents/Microsoft%20Copilot%20Chat%20Files/whatsapp.js.txt)
 */
async function applyAIOrchestration(text, From, detectedLanguageHint, requestId) {     
    if (!USE_AI_ORCHESTRATOR) return { language: detectedLanguageHint, isQuestion: null, normalizedCommand: null, aiTxn: null };
      const shopId = String(From ?? '').replace('whatsapp:', '');
      // ---- Sticky-mode clamp: if user is in purchase/sale/return, force inventory routing
      try {
        const stickyAction = await getStickyActionQuick(From);
        if (stickyAction && looksLikeTxnLite(text)) {
          const language = ensureLangExact(detectedLanguageHint ?? 'en');
          console.log('[orchestrator]', { requestId, language, kind: 'transaction', normalizedCommand: '—', topicForced: null, pricingFlavor: null, sticky: stickyAction });
          // Force router away from Sales-Q&A; downstream inventory parser will consume this turn
          return { language, isQuestion: false, normalizedCommand: null, aiTxn: null, questionTopic: null, pricingFlavor: null, forceInventory: true };
        }
      } catch (_) { /* best-effort; fall through to AI orchestrator */ }
      const o = await aiOrchestrate(text);
    
    // --- NEW: Normalize summary intent into the command contract ---------------
      // Router recognizes only: greeting | question | transaction | command | other.
      // If resolveSummaryIntent sees a summary, force it into 'command'.
      try {
        const summaryCmd = resolveSummaryIntent(text); // 'short summary' | 'full summary' | null
        if (summaryCmd) {
          // Never use kind='summary' in orchestrator output.
          o.kind = 'command';
          o.command = { normalized: summaryCmd };
        }
      } catch (_) {
        // best-effort: ignore if resolver throws
      }
    
// ---- NEW: topic detection helpers (pricing/benefits/capabilities) ----
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
  // inventory-looking text: product names/units/money hints
  function looksLikeInventoryPricing(msg) {
    const s = String(msg ?? '').toLowerCase();
    const unitRx = /(kg|kgs|g|gm|gms|ltr|ltrs|l|ml|packet|packets|piece|pieces|बॉक्स|टुकड़ा|नंग)/i;
    const moneyRx = /(?:₹|rs\.?|rupees)\s*\d+(?:\.\d+)?/i;
    const brandRx = /(milk|doodh|parle\-g|maggi|amul|oreo|frooti|marie gold|good day|dabur|tata|nestle)/i;
    return unitRx.test(s) || moneyRx.test(s) || brandRx.test(s);
  }

  // ---- NEW: force question routing when a topic is detected ----
  const topicForced = classifyQuestionTopic(text);
  if (topicForced) {
    o.kind = 'question';
  }
  // ---- NEW: attach topic + pricing flavor (tool vs inventory) for downstream use ----
  let pricingFlavor = null; // 'tool_pricing' | 'inventory_pricing' | null
  if (topicForced === 'pricing') {
    let activated = false;
    try {
      const pref = await getUserPreference(shopId);
      const plan = String(pref?.plan ?? '').toLowerCase();
      activated = (plan === 'trial' || plan === 'paid');
    } catch { /* best effort */ }
    if (activated && looksLikeInventoryPricing(text)) {
      pricingFlavor = 'inventory_pricing';
    } else {
      pricingFlavor = 'tool_pricing';
    }
  }

  
    // [UNIQ:ORCH-LANG-LOCK-004] Prefer the exact variant from the detector
      // Keep 'hi-latn' if the hint carries it, even when orchestrator returns 'hi'
      // ---------------------------------------------------------------------
      const hintedLang = ensureLangExact(detectedLanguageHint ?? 'en');
      const orchestratedLang = ensureLangExact(o.language ?? hintedLang);
      const language = hintedLang.endsWith('-latn') ? hintedLang : orchestratedLang;
    
      // Persist language preference best-effort (with exact variant)
      try {
        if (typeof saveUserPreference === 'function') {
          await saveUserPreference(shopId, language);
        }
      } catch (_) {}
      
  let isQuestion = o.kind === 'question';
  let normalizedCommand = o.kind === 'command' && o?.command?.normalized ? o.command.normalized : null;
  const aiTxn = o.kind === 'transaction' ? o.transaction : null;
  // Note: summaries now appear as kind='command' with normalizedCommand.  
  // Final sticky-mode safety: never let Sales-Q&A trigger in active transaction mode
   try {
    const stickyAction = await getStickyActionQuick(From);
    if (stickyAction) { isQuestion = false; normalizedCommand = null; }
  } catch (_) { /* noop */ }
    console.log('[orchestrator]', {
        requestId, language, kind: o.kind,
        normalizedCommand: normalizedCommand ?? '—',
        topicForced, pricingFlavor
      });
      return { language, isQuestion, normalizedCommand, aiTxn, questionTopic: topicForced, pricingFlavor };
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
        return await getUserStateFromDB(shopId);
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
  'hello', 'hi', 'hey', 'namaste',
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
const { generateInvoicePDF } = require('../pdfGenerator');
const { getShopDetails } = require('../database');
const TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS || 25000);
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
    bn: 'আপনার বার্তা প্রক্রিয়াকরণ হচ্ছে…',
    ta: 'உங்கள் செய்தி செயலாக்கப்படுகிறது…',
    te: 'మీ సందేశాన్ని ప్రాసెస్ చేస్తున్నాం…',
    kn: 'ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಸಂಸ್ಕರಿಸಲಾಗುತ್ತಿದೆ…',
    mr: 'आपला संदेश प्रक्रिया होत आहे…',
    gu: 'તમારો સંદેશ પ્રોસેસ થઈ રહ્યો છે…'
  },
  fallbackHint: {
    en: 'Type “mode” to switch context or ask for a summary.',
    hi: '“मोड” लिखें संदर्भ बदलने या सारांश पूछने के लिए।',
    bn: 'প্রসঙ্গ বদলাতে বা সারাংশ জানতে “mode” লিখুন।',
    ta: 'சூழலை மாற்ற அல்லது சுருக்கம் கேட்க “mode” என்று தட்டச்சு செய்யவும்.',
    te: 'సందర్భం మార్చడానికి లేదా సారాంశం అడగడానికి “mode” టైప్ చేయండి.',
    kn: 'ಸಂದರ್ಬ ಬದಲಿಸಲು ಅಥವಾ ಸಾರಾಂಶಕ್ಕಾಗಿ “mode” ಎಂದು ಟೈಪ್ ಮಾಡಿ.',
    mr: 'संदर्भ बदलण्यासाठी किंवा सारांश विचारण्यासाठी “mode” टाइप करा.',
    gu: 'સંદર્ભ બદલવા અથવા સારાંશ માગવા “mode” ટાઈપ કરો.'
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
  'stock value'
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
  for (const c of candidates) { if (c) return String(c).toLowerCase(); }
  return 'en';
}

// ==== SINGLE SOURCE: Language detection (heuristic + optional AI) ====
// Must be declared BEFORE any calls (e.g., in handleRequest or module.exports).
async function detectLanguageWithFallback(text, from, requestId) {
  return (async () => {
    try {
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
            
      // 2) AI pass for Romanized Indic / ambiguous ASCII
            const useAI = _shouldUseAI(text, detectedLanguage);
            if (useAI) {
              const ai = await aiDetectLangIntent(text);
              if (ai.language) detectedLanguage = ai.language;                            
              // OVERRIDE: if AI returned native 'hi' but text looks Hinglish ASCII → lock to hi-Latn
              detectedLanguage = forceLatnIfRoman(detectedLanguage, text);
              try {
                const shopId = String(from ?? '').replace('whatsapp:', '');
                if (typeof saveUserPreference === 'function') await saveUserPreference(shopId, detectedLanguage);
              } catch (_e) {}
              console.log(`[${requestId}] AI lang=${ai.language} intent=${ai.intent}`);
            }
            // 3) Optional AI if non-ASCII but heuristics left it at 'en'
            if (!useAI && detectedLanguage === 'en' && !/^[a-z0-9\s.,!?'\"@:/\-]+$/i.test(lowerText)) {
              try {
                const ai = await aiDetectLangIntent(text);
                if (ai.language) detectedLanguage = ai.language;
              } catch (e) {
                console.warn(`[${requestId}] AI language detection failed: ${e.message}`);
              }
            }

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
    if (typeof sendParseErrorWithExamples === 'function') {
      await sendParseErrorWithExamples(From, detectedLanguage, requestId, header);
    } else {                             
        // Ultra-compact fallback in user's language (ensure msg is defined)
              const msg = await t(
                header ?? 'Sorry, I could not understand that. Try: "sold milk 2 ltr" or "short summary".',
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
  'mode', 'switch', 'change', 'badlo',
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

// ===== Language detection re-entry guard + explicit tokens =====
const _langDetectInFlight = new Set(); // from (whatsapp:+91...) -> boolean
const LANGUAGE_TOKENS = {
  // two-way synonyms for quick, explicit language switches
  en: new Set(['en','eng','english']),
  hi: new Set(['hi','hin','hindi','हिंदी','हिन्दी']),
  bn: new Set(['bn','ben','bengali','বাংলা']),
  ta: new Set(['ta','tam','tamil','தமிழ்']),
  te: new Set(['te','tel','telugu','తెలుగు']),
  kn: new Set(['kn','kan','kannada',' ಕನ್ನಡ','ಕನ್ನಡ']),
  mr: new Set(['mr','mar','marathi','मराठी']),
  gu: new Set(['gu','guj','gujarati','ગુજરાતી'])
};
function _matchLanguageToken(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  for (const [code, set] of Object.entries(LANGUAGE_TOKENS)) {
    if (set.has(t)) return code;
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
  'खरीद': 'purchase', 'बिक्री': 'sold', 'वापसी': 'returned',
  // bn
  'ক্রয়': 'purchase', 'বিক্রি': 'sold', 'রিটার্ন': 'returned',
  // ta
  'கொள்முதல்': 'purchase', 'விற்பனை': 'sold', 'ரிட்டர்ன்': 'returned',
  // te
  'కొనుగోలు': 'purchase', 'అమ్మకం': 'sold', 'రిటర్న్': 'returned',
  // kn
  'ಖರೀದಿ': 'purchase', 'ಮಾರಾಟ': 'sold', 'ರಿಟರ್ನ್': 'returned',
  // mr
  'खरेदी': 'purchase', 'विक्री': 'sold', 'परत': 'returned',
  // gu
  'ખરીદી': 'purchase', 'વેચાણ': 'sold', 'રીટર્ન': 'returned'
};

// Accept one-word localized switch triggers or direct-set actions
function parseModeSwitchLocalized(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const t = raw.toLowerCase();

  // Direct English form: "mode <purchase|sale|return>"
  const m = t.match(/^mode\s+(purchase|sale|return)$/i);
  if (m) return { set: m[1] };

  // Localized direct-set (single word): e.g., 'खरीद', 'விற்பனை'
  const setLocal = LOCAL_SET_WORDS[raw] || LOCAL_SET_WORDS[t];
  if (setLocal) return { set: setLocal };

  // One-word ask (open options): if it matches any fallback token
  const singleWord = t.replace(/\s+/g, ' ');
  const isSingle = !/\s/.test(singleWord);
  const inFallbacks = SWITCH_FALLBACKS.some(x => String(x).toLowerCase() === singleWord);
  if (isSingle && inFallbacks) return { ask: true };

  // Phrase contains switch hint: open options
  const containsFallback = SWITCH_FALLBACKS.some(x => t.includes(String(x).toLowerCase()));
  if (containsFallback) return { ask: true };

  return null;
}

// Normalize and persist sticky mode
async function setStickyMode(from, actionOrWord) {
  const map = {
    purchase: 'purchase', buy: 'purchase', bought: 'purchase',
    sale: 'sold', sell: 'sold', sold: 'sold',
    return: 'returned', returned: 'returned'
  };
  const norm = (map[actionOrWord] || actionOrWord || '').toLowerCase();
  const finalAction = ['purchase', 'sold', 'returned'].includes(norm) ? norm : 'purchase';
  await setUserState(from, 'awaitingTransactionDetails', { action: finalAction });
}

// ===== LOCALIZED FOOTER TAG: append «<MODE_BADGE> • <SWITCH_WORD>» to every message =====
async function tagWithLocalizedMode(from, text, detectedLanguageHint = null) {
  try {        
    // Marker to opt-out of footer for specific messages (onboarding/upsell)
        const NO_FOOTER_MARKER = '<!NO_FOOTER!>';
        if (String(text).startsWith(NO_FOOTER_MARKER)) {
          return String(text).slice(NO_FOOTER_MARKER.length);
        }
    // Guard: if footer already present, do not append again
    if (/«.+\s•\s.+»$/.test(text)) return text;

    const shopId = String(from).replace('whatsapp:', '');
    
// 1) Read current state and derive the *effective* action used for footer
    const state = await getUserStateFromDB(shopId);
    let action = null; // 'purchase' | 'sold' | 'returned' | null
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
          action = 'purchase';
          break;
        default:
          action = state.data?.action ?? null;
      }
    }

    // 2) Resolve language to use: prefer saved user preference; else detected hint; else 'en'
    let lang = String(detectedLanguageHint || 'en').toLowerCase();
    try {
      const pref = await getUserPreference(shopId);
      if (pref?.success && pref.language) lang = String(pref.language).toLowerCase();
    } catch (_) { /* ignore */ }

    // 3) Build badge in user language
    const badge = getModeBadge(action, lang);        // e.g., 'बिक्री', 'விற்பனை', 'SALE'
    const switchWord = getSwitchWordFor(lang);       // e.g., 'मोड', 'மோட்', 'mode'
    const tag = `«${badge} • ${switchWord}»`;

    // 4) Append on a new line; keep WA length constraints safe
    return text.endsWith('\n') ? (text + tag) : (text + '\n' + tag);
  } catch {
    // Fallback if anything fails
    return text + '\n«NONE • mode»';
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


const { sendContentTemplate } = require('./whatsappButtons');
const { ensureLangTemplates, getLangSids } = require('./contentCache');

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
                                          
            // 0) INTRO (AI onboarding benefits) — FIRST
                try {                                                                        
                    // Compose then translate intro — use per-shop cacheKey to avoid stale blended output
                          const introKey = `welcome-intro::${toNumber}::${String(detectedLanguage).toLowerCase()}`;
                          let introText = await t(
                            await composeAIOnboarding(detectedLanguage),
                            detectedLanguage ?? 'en',
                            introKey
                          );
                          // Replace hardcoded "Start Trial" with the actual localized button label,
                          // then re-sanitize after replacement to enforce single-script output.
                        const startTrialLabel = getStaticLabel('startTrialBtn', detectedLanguage);                                                
                        introText = introText.replace(/"Start Trial"/g, `"${startTrialLabel}"`);
                        introText = sanitizeAfterReplace(introText, detectedLanguage ?? 'en');                        
                        // Suppress footer for onboarding promo
                            const NO_FOOTER_MARKER = '<!NO_FOOTER!>';
                            await sendMessageQueued(From, NO_FOOTER_MARKER + introText);
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
                // Suppress footer for trial CTA text fallback
                    const NO_FOOTER_MARKER = '<!NO_FOOTER!>';
                    await sendMessageQueued(
                      From,
                      NO_FOOTER_MARKER + await t(ctaText, detectedLanguage ?? 'en', 'welcome-gate')
                    );
             }
        try { markWelcomed(toNumber); } catch {}
             return; // still skip menus until activation
           }
         
    // 3) Guarded template sends (only if SIDs exist), with plan-aware hint
      try {                  
          await ensureLangTemplates(detectedLanguage); // creates once per lang, then reuses
              const sids = getLangSids(detectedLanguage);
              // (Re-ordered) First send the light plan-aware hint / welcome line
              await sendMessageQueued(From, await t(getStaticLabel('fallbackHint', detectedLanguage), detectedLanguage ?? 'en', 'welcome-hint'));
              // Then send buttons (Quick-Reply followed by List-Picker)
              if (sids?.quickReplySid) {
                try {
                  await sendContentTemplate({ toWhatsApp: toNumber, contentSid: sids.quickReplySid });
                } catch (e) {
                  const status = e?.response?.status;
                  const data = e?.response?.data;
                  console.warn('[welcome] quickReply send failed', { status, data, sid: sids?.quickReplySid });
                }
              }
              if (sids?.listPickerSid) {
                try {
                  await sendContentTemplate({ toWhatsApp: toNumber, contentSid: sids.listPickerSid });
                } catch (e) {
                  const status = e?.response?.status;
                  const data = e?.response?.data;
                  console.warn('[welcome] listPicker send failed', { status, data, sid: sids?.listPickerSid });
                }
              }
      } catch (e) {
        // 4) Plain-text fallback if template orchestration failed before we could try any send
        // Enriched logging: show Twilio status/body when available
        const status = e?.response?.status;
        const data   = e?.response?.data;
        console.warn('[welcome] template orchestration failed', { status, data, message: e?.message });                
        // Localized fallback hint                    
        const fhLabel = getStaticLabel('fallbackHint', detectedLanguage);
        const fhText  = await t(fhLabel, detectedLanguage ?? 'en', 'welcome-fallback');
        await sendMessageQueued(From, fhText);
      }
  try { markWelcomed(toNumber); } catch {}
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

 
// Map button taps / list selections to your existing quick-query router
 // Robust to multiple Twilio payload shapes + safe fallback
 async function handleInteractiveSelection(req) {
  const raw = req.body || {};
  const from = raw.From;     
  const shopIdTop = String(from ?? '').replace('whatsapp:', '');
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
    let activated = false;
    try {
      const pref = await getUserPreference(shopId);
      const plan = String(pref?.plan ?? '').toLowerCase();
      activated = (plan === 'trial' || plan === 'paid');
    } catch (_) {}
  
   // Quick‑Reply buttons (payload IDs are language‑independent)
   if (payload === 'qr_purchase') {         
    // 4C: If not activated (Q&A/onboarding context), soft-hint instead of entering flow
         if (!activated) {
           const hint = await t('ℹ️ To record a transaction, send a message like “purchase sugar 5 kg” or “sold milk 2 ltr”.', lang, 'txn-hint-purchase');
           await sendMessageViaAPI(from, hint);
           return true;
         }
         await setUserState(from, 'awaitingTransactionDetails', { action: 'purchase' });                 
         // In-memory sticky mode fallback (align with sale/return branches)
            try {
              const shopIdLocal = String(from).replace('whatsapp:', '');
              globalState.conversationState[shopIdLocal] = { mode: 'awaitingTransactionDetails', data: { action: 'purchase' }, ts: Date.now() };
            } catch (_) { /* noop */ }
        const msg0 = await t('Examples (purchase):\n• milk 10 ltr ₹60 exp +7d\n• दूध 10 लीटर ₹60 exp +7d', lang, 'txn-examples-purchase');
        await sendMessageViaAPI(from, dedupeBullets(msg0));
        return true;
   }
   if (payload === 'qr_sale') {       
    if (!activated) {
           const hint = await t('ℹ️ To record a transaction, send a message like “sold milk 2 ltr” or “purchase sugar 5 kg”.', lang, 'txn-hint-sale');
           await sendMessageViaAPI(from, hint);
           return true;
         }
         await setUserState(from, 'awaitingTransactionDetails', { action: 'sold' });               
        try {
              const shopIdLocal = String(from).replace('whatsapp:', '');
              globalState.conversationState[shopIdLocal] = { mode: 'awaitingTransactionDetails', data: { action: 'sold' }, ts: Date.now() };
            } catch (_) {}
         const msg = await t('Examples (sale):\n• sugar 2 kg\n• doodh 3 ltr', lang, 'txn-examples-sale');
         await sendMessageViaAPI(from, dedupeBullets(msg));
         return true;
   }
   if (payload === 'qr_return') {        
    if (!activated) {
           const hint = await t('ℹ️ To record a transaction, send a message like “return Parle-G 3 packets” or “return milk 1 liter”.', lang, 'txn-hint-return');
           await sendMessageViaAPI(from, hint);
           return true;
         }
         await setUserState(from, 'awaitingTransactionDetails', { action: 'returned' });      
         try {
              const shopIdLocal = String(from).replace('whatsapp:', '');
              globalState.conversationState[shopIdLocal] = { mode: 'awaitingTransactionDetails', data: { action: 'returned' }, ts: Date.now() };
            } catch (_) {}
         const msg = await t('Examples (return):\n• Parle-G 3 packets\n• milk 1 liter', lang, 'txn-examples-return');
         await sendMessageViaAPI(from, dedupeBullets(msg));
         return true;
   }
 
  // --- NEW: Activate Trial Plan ---
  if (payload === 'activate_trial') {       
    // shopId/lang already prepared above; use activation gate too
        if (activated) {
          const msg = await t('✅ You already have access.', lang, `cta-trial-already-${shopId}`);
          await sendMessageViaAPI(from, msg);
          return true;
        }
    // Treat tap as explicit confirmation to start trial
        
    const start = await startTrialForAuthUser(shopId, TRIAL_DAYS);
        if (start.success) {
            const planNote = `🎉 Trial activated for ${TRIAL_DAYS} days!`;
            let msg;
            try {                               
                msg = await t(
                                `${planNote}\nTry:\n• sold milk 2 ltr\n• purchase Parle-G 12 packets ₹10 exp +6m`,
                                lang,
                                `cta-trial-ok-${shopId}`
                            );
            } catch (e) {
                console.warn('[trial-activated] translation failed:', e.message);
            }
                       
            // ✅ Guard: skip cache if suspiciously short (e.g., "Try:")
                    if (!msg || msg.trim().length < 20 || /^none$/i.test(msg.trim())) {
                        console.warn('[trial-activated] cache value too short or invalid, using fallback');
                        msg = `${planNote}\nTry:\n• sold milk 2 ltr\n• purchase Parle-G 12 packets ₹10 exp +6m`;
                    }
    
            // Diagnostic logging before send
            console.log('[trial-activated] sending ack message:', { to: from, msg });
    
            try {
                const resp = await sendMessageViaAPI(from, msg);
                console.log('[trial-activated] ack send OK:', { sid: resp?.sid, to: from });                                
                // ✅ NEW: Overwrite translation cache with clean text for future calls
                            async function overwriteTranslationCache(key, lang, text) {
                                try {
                                    await upsertTranslationEntry({ key, lang, text });
                                    console.log(`[cache-update] Overwritten key=${key}, lang=${lang}`);
                                } catch (e) {
                                    console.error('[cache-update] Failed:', e.message);
                                }
                            }
                
                            await overwriteTranslationCache(
                                `cta-trial-ok-${shopId}`,
                                lang,
                                `${planNote}\nTry:\n• sold milk 2 ltr\n• purchase Parle-G 12 packets ₹10 exp +6m`
                            );
            } catch (err) {
                console.error('[trial-activated] ack send FAILED:', {
                    error: err?.message,
                    code: err?.code,
                    status: err?.status,
                    data: err?.response?.data
                });
            }
            
      // NEW: Immediately send activated menus (Quick-Reply + List-Picker)
          try {
            await ensureLangTemplates(lang);
            const sids = getLangSids(lang);
            // Purchase/Sale/Return Quick-Reply
            if (sids?.quickReplySid) {
              try {
                const r1 = await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.quickReplySid });
                console.log('[trial-activated] quickReply OK', { sid: r1?.sid, to: shopId });
              } catch (e) {
                console.warn('[trial-activated] quickReply FAIL', { status: e?.response?.status, data: e?.response?.data, to: shopId });
              }
            }
            // Inventory List-Picker
            if (sids?.listPickerSid) {
              try {
                const r2 = await sendContentTemplate({ toWhatsApp: shopId, contentSid: sids.listPickerSid });
                console.log('[trial-activated] listPicker OK', { sid: r2?.sid, to: shopId });
              } catch (e) {
                console.warn('[trial-activated] listPicker FAIL', { status: e?.response?.status, data: e?.response?.data, to: shopId });
              }
            }
          } catch (e) {
            console.warn('[trial-activated] menu orchestration failed', { status: e?.response?.status, data: e?.response?.data });
          }      
    } else {
      const msg = await t(
        `Sorry, we couldn't start your trial right now. Please try again.`,
        lang, `cta-trial-fail-${shopId}`
      );
      await sendMessageViaAPI(from, msg);
    }
    return true;
  }
  
  // --- NEW: Demo button ---
  if (payload === 'show_demo') {           
  // new: rich multilingual demo
  await sendDemoTranscriptLocalized(from, lang, `cta-demo-${shopId}`);
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
    const msg = await t(
      `To activate the paid plan, pay ₹11 via Paytm → ${PAYTM_NUMBER} (${PAYTM_NAME})\n`
      + `Or pay at: ${PAYMENT_LINK}\nReply "paid" after payment ✅`,
      lang, `cta-paid-${shopId}`
    );
    await sendMessageViaAPI(from, msg);
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
            await route('short summary'); return true;
        
          case 'list_full_summary':
            await route('full summary'); return true;
        
          case 'list_reorder_suggest':
            await route('reorder suggestions'); return true;
        
          case 'list_sales_week':
            await route('sales week'); return true;
        
          case 'list_expiring_30':
            await route('expiring 30'); return true;
        
          // keep existing IDs working:
          case 'list_low':
            await route('low stock'); return true;
        
          case 'list_expiring': // your "Expiring 0"
            await route('expiring 0'); return true;
        
          case 'list_sales_day':
            await route('sales today'); return true;
        
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
  const hasDigits = regexPatterns.digits.test(s);
  const mentionsMoney =
    /(?:₹|rs\.?|rupees)\s*\d+(?:\.\d+)?/i.test(s)
    ||
    /(?:@|at)\s*(?:\d+(?:\.\d+)?)\s*(?:per\s+)?(kg|liter|litre|liters|litres|packet|packets|box|boxes|piece|pieces|ml|g|kg|ltr)/i.test(s);
  const hasUnit =
    /(kg|g|gram|grams|ml|ltr|l|liter|litre|liters|litres|packet|packets|box|boxes|piece|pieces|किलो|किग्रा|ग्राम|लिटर|पॅकेट|पेकट|बॉक्स|टुकडो|टुकडाओ|नंग)/i.test(s);
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
  reattributeSaleToBatch
} = require('../database');

// --- No-op fallback for builds where cleanupCaches isn't bundled
if (typeof cleanupCaches === 'undefined') {
  function cleanupCaches() { /* noop */ }
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
// ===== Paywall / Trial / Links (env-driven) =====
const PAYTM_NUMBER = String(process.env.PAYTM_NUMBER ?? '9013283687');
const PAYTM_NAME   = String(process.env.PAYTM_NAME   ?? 'Saamagrii.AI Support Team');
const TRIAL_DAYS   = Number(process.env.TRIAL_DAYS   ?? 3);
const PAID_PRICE_INR = Number(process.env.PAID_PRICE_INR ?? 11);
const INLINE_PAYTM_IN_PRICING = String(process.env.INLINE_PAYTM_IN_PRICING ?? 'false').toLowerCase() === 'true';
const WHATSAPP_LINK = String(process.env.WHATSAPP_LINK ?? 'https://wa.link/6q3ol7');
const PAYMENT_LINK  = String(process.env.PAYMENT_LINK  ?? '<payment_link>');

// NEW: Trial CTA ContentSid (Quick-Reply template)
const TRIAL_CTA_SID = String(process.env.TRIAL_CTA_SID ?? '').trim();

// === NEW: Onboarding benefits video (default URL; per-language fallbacks optional) ===
// You provided: https://kansrakunal1992.github.io/deadStockAlertWAIndia/Saamagrii.AI_ व्यापार बढ़ाएं.mp4
// Set this in env for prod; we also allow hi/hi-Latn overrides if you later add them.
const ONBOARDING_VIDEO_URL       = String(process.env.ONBOARDING_VIDEO_URL ?? 'https://kansrakunal1992.github.io/deadStockAlertWAIndia/saamagrii-benefits-hi.mp4').trim();
const ONBOARDING_VIDEO_URL_HI    = String(process.env.ONBOARDING_VIDEO_URL_HI    ?? '').trim();
const ONBOARDING_VIDEO_URL_HI_LATN = String(process.env.ONBOARDING_VIDEO_URL_HI_LATN ?? '').trim();

/**
 * Canonical activation gate:
 * Only 'trial' (explicit user action) or 'paid' are considered activated.
 * No implicit mapping for 'free_demo_first_50', 'demo', or ''.
 */
async function isUserActivated(shopId) {
  try {
    const pref = await getUserPreference(shopId);
    const plan = String(pref?.plan ?? '').toLowerCase();
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
 * enforceSingleScript(out, lang)
 * If SINGLE_SCRIPT_MODE is on, keep only one script:
 *  - For English or any *-Latn target: keep ASCII-ish paragraphs; strip native script.
 *  - For native (non-Latn, non-English): keep non-ASCII paragraphs; drop ASCII-only dupes.
 *  - Inline sanitization keeps ₹, numerals & common punctuations.
 */

function enforceSingleScript(out, lang) {
  // Original clamp (kept for comprehensive handling).
  if (!SINGLE_SCRIPT_MODE) return out;
  const L = String(lang ?? 'en').toLowerCase();
  const roman = isRomanTarget(L);
  const english = (L === 'en');
  const text = String(out ?? '');
  const normalized = text.replace(/\r?\n/g, '\n').replace(/\n{1,}/g, '\n\n');
  const parts = normalized.split(/\n\s*\n/);
  const nonAscii = /[^\x00-\x7F]/;
  if (parts.length >= 2) {
    if (english || roman) {
      const kept = parts.filter(p => !nonAscii.test(p)).join('\n\n');
      return kept || parts.join('\n\n');
    } else {
      const kept = parts.filter(p => nonAscii.test(p)).join('\n\n');
      return kept || parts[0];
    }
  }
  const hasAscii = /[a-zA-Z]/.test(text);
  const hasNonAscii = nonAscii.test(text);
  if (hasAscii && hasNonAscii) {
    return (english || roman)
      ? text.replace(/[^\x00-\x7F₹\s.,@:%/\-\+\*\!?'"\(\)\u2013\u2014]/g, '')
      : text.replace(/[a-zA-Z]/g, '');
  }
  if (english || roman) {
    return text.replace(/[^\x00-\x7F₹\s.,@:%/\-\+\*\!?'"\(\)\u2013\u2014]/g, '');
  }
  return text;
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
    if (r.success) {
      const symbol = r.action === 'returned' ? '↩️' : '✅';
      return `${symbol} ${act} ${qty} ${unit} ${r.product}${stockPart}`.trim();
    }
    return `❌ ${r.product} — ${r.error ?? 'Error'}`;
  }
  const tail = r.success ? '✅' : `❌ ${r.error ?? 'Error'}`;
  return `• ${r.product}: ${qty} ${unit} ${act}${stockPart} ${tail}`.trim();
}

// --- Single-sale confirmation (compose & send once) --------------------------
const saleConfirmTracker = new Set();

function composeSaleConfirmation({ product, qty, unit, pricePerUnit, newQuantity }) {
  const total = Number.isFinite(pricePerUnit) ? (pricePerUnit * Math.abs(qty)) : null;
  const priceTxt = Number.isFinite(pricePerUnit)
    ? `@ ₹${pricePerUnit} each — Total: ₹${total}`
    : `@ ₹? each`;
  const header = `✅ Sold ${Math.abs(qty)} ${unit} ${product} ${priceTxt}`.trim();
  const stockLine = Number.isFinite(newQuantity) ? `Stock: ${newQuantity} ${unit}` : '';
  return stockLine ? `${header}\n${stockLine}` : header;
}

async function sendSaleConfirmationOnce(From, detectedLanguage, requestId, info) {
  // Gate duplicates per request
  if (saleConfirmTracker.has(requestId)) return;
  saleConfirmTracker.add(requestId);
  const body = composeSaleConfirmation(info);
  const msg = await t(body, detectedLanguage ?? 'en', requestId);
  await sendMessageViaAPI(From, msg);
}
// ----------------------------------------------------------------------------- 


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
   */
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
          // Add more as needed later (bn, ta, te, kn, mr, gu) — fall back to English for now
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
  const shopId = String(From).replace('whatsapp:', '');

  const sendTagged = async (body) => {    
// keep existing per-command cache key (already unique & scoped)
    const msg0 = await tx(body, lang, From, cmd, `qq-${cmd}-${shopId}`);
    const msg = await tagWithLocalizedMode(From, msg0, lang);
    await sendMessageViaAPI(From, msg);
  };
              
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
      hasAny = !!(today?.totalSales || inv?.totalValue || (inv?.lowStock||[]).length);
    } catch (_) {}
    if (!hasAny) {
      await sendTagged('📊 Short Summary — Aaj abhi koi transaction nahi hua.\nTip: “sold milk 2 ltr” try karo.');
      return true;
    }
    const lines = [];
    try { const s = await getTodaySalesSummary(shopId); if (s?.totalSales) lines.push(`Sales Today: ₹${s.totalSales}`); } catch (_){}
    try { const l = await getLowStockProducts(shopId) || []; if (l.length) lines.push(`Low Stock: ${l.slice(0,5).map(x=>x.product).join(', ')}`);} catch(_){}
    try { const e = await getExpiringProducts(shopId, 7) || []; if (e.length) lines.push(`Expiring Soon: ${e.slice(0,5).map(x=>x.product).join(', ')}`);} catch(_){}
    const body = `📊 Short Summary\n${lines.join('\n') || '—'}`;
    await sendTagged(body);
    return true;
  }
  if (cmd === 'full summary') {
    try {
      const insights = await generateFullScaleSummary(shopId, lang, `qq-full-${shopId}`);
      await sendTagged(insights);
    } catch (_) {
      await sendTagged('📊 Full Summary — snapshot unavailable. Try: “short summary”.');
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
    // Then add a compact Demo/Help CTA line (text) to keep momentum        
    // Use localized minimal Help/Demo CTA; avoid English-only fallbacks
      const ctaEn = 'Reply “Demo” to see a quick walkthrough; “Help” for support & contact.';
      const cta = await t(ctaEn, lang, 'qa-buttons-cta'); // will localize via deterministic DICT above if MT missing
    await sendMessageQueued(From, cta);
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
    'User: purchase Parle-G 12 packets ₹10 exp +6m',
    'Bot: ✅ Purchased 12 packets Parle-G — Price: ₹10',
    '      Expiry: set to +6 months',
    'User: short summary',
    'Bot: 📊 Short Summary — Sales Today, Low Stock, Expiring Soon…',
    '',
    'Tip: type “mode” to switch Purchase/Sale/Return'
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

// Helper: if target lang is non-English but output is mostly ASCII/English, replace with localized deterministic copy
function ensureLanguageOrFallback(out, language = 'en') {
  try {
    const lang = String(language ?? 'en').toLowerCase();
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
      return `ठीक है! WhatsApp पर स्टॉक/एक्सपायरी ऑटोमेट करें; लो‑स्टॉक अलर्ट भी मिलेंगे。\nउदाहरण: sold milk 2 ltr • purchase Parle‑G 12 packets ₹10 exp +6m • short summary`;    
    case 'hi-latn':
    // Roman Hindi fallback when AI is unavailable or detects Hinglish
      return `Theek hai! WhatsApp par stock/expiry automate karo; low‑stock alerts milenge.\nUdaharan: sold milk 2 ltr • purchase Parle‑G 12 packets ₹10 exp +6m • short summary`;
    default:
      return `Automate stock & expiry on WhatsApp; get low‑stock alerts.\nTry: sold milk 2 ltr • purchase Parle‑G 12 packets ₹10 exp +6m • short summary`;
  }
}

async function composeAIOnboarding(language = 'en') {
  const lang = (language || 'en').toLowerCase();       
  const sys =
      'You are a friendly, professional WhatsApp assistant for a small retail inventory tool. ' +
      'Respond ONLY in one script: if Hindi, use Devanagari; if Hinglish, use Roman Hindi (hi-Latn). Do NOT mix native and Roman in the same message. Keep brand names unchanged.' +
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
    // Ensure localized text and clamp to single script even if MT blends lines
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
  
const lang = (language ?? 'en').toLowerCase();        

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
      examples: ['sold cover 2 pieces', 'purchase charger 10 pieces ₹120', 'stock earphones'],
      benefits: {
        'hi-latn': 'Aapki mobile shop ke liye: stock/expiry auto-update, low-stock alerts (covers, chargers, earphones), smart reorder tips.',
        hi: 'आपकी मोबाइल शॉप के लिए: स्टॉक/एक्सपायरी ऑटो‑अपडेट, लो‑स्टॉक अलर्ट (कवर, चार्जर, ईयरफ़ोन), स्मार्ट री‑ऑर्डर सुझाव।'
      }
    },
    garments: {
      rx: /\b(garment|garments|kapde|clothes|apparel|shirts?|t[- ]?shirts?|jeans|kurta|salwar|saree|dress|hoodie|sweater|size|xl|l|m|s|xxl)\b/i,
      examples: ['sold t-shirt L 3 pieces', 'purchase jeans 12 pieces ₹550', 'stock saree'],
      benefits: {
        'hi-latn': 'Kapdon ke liye: SKU/size tracking, low-stock alerts (sizes), fast reorder tips, daily summary.',
        hi: 'कपड़ों के लिए: SKU/साइज़ ट्रैकिंग, लो‑स्टॉक अलर्ट (साइज़), तेज री‑ऑर्डर सुझाव, दैनिक सारांश।'
      }
    },
    pickle: {
      rx: /\b(pickle|achaar|aachar|factory|batch|jar|bottle)\b/i,
      examples: ['sold mango pickle 5 bottles', 'purchase lemon pickle 20 jars ₹80 exp +6m', 'batches mango pickle'],
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

  // ---- NEW: Hinglish enforcement note ----
  const targetScriptNote =
    lang === 'hi-latn'
      ? 'Respond ONLY in Roman Hindi (Hinglish; language code hi-Latn). Keep sentences short and natural Hinglish.'
      : `Respond ONLY in ${lang} script.`;

  // If user asks about invoice, force an explicit line in the reply about PDFs
  const mustMentionInvoice = /\b(invoice|बिल|चालान)\b/i.test(String(question ?? ''));              
            
    const sys = `
    You are a helpful WhatsApp assistant. ${targetScriptNote}
    Be concise (3–5 short sentences). Use ONLY MANIFEST facts; never invent features.
    If pricing/cost is asked, include: free trial for ${TRIAL_DAYS} days, then ₹${PAID_PRICE_INR}/month.
    Answer directly to the user's question topic; do not repeat onboarding slogans.
    ${mustMentionInvoice ? 'If asked about invoice, clearly state that sale invoices (PDF) are generated automatically in both trial and paid plans.' : ''}
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
        temperature: 0.5,
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
            max_tokens: 400,
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
             if (INLINE_PAYTM_IN_PRICING && askedPrice && pricingFlavor === 'tool_pricing') {
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
              return `Inventory item ka rate set/dekhne ke liye entry me ₹rate likho: "purchase Parle-G 12 packets ₹10", ya "prices" command use karo.`;
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
            return `WhatsApp par stock update, expiry tracking, aur summaries. Bas "sold milk 2 ltr" ya "purchase Parle-G 12 packets ₹10 exp +6m" type karo.`;
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
  const base =
    `🟢 It’s been ${hours}+ hours since you used Saamagrii.AI.\n` +
    `Try a quick entry:\n• sold milk 2 ltr\n• purchase Parle-G 12 packets ₹10 exp +6m\n` +
    `Or type “mode” to switch context.`;
  // translate & single-script sanitize
  return await t(base, language ?? 'en', `nudge-${shopId}-${hours}`);
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
      const msg = await composeNudge(shopId, lang, NUDGE_HOURS);
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

function readGamify() {
  try {          
      if (!fs.existsSync(GAMIFY_TRACK_FILE)) { console.log('[gamify] tracker missing:', GAMIFY_TRACK_FILE); return {}; }
      const data = fs.readFileSync(GAMIFY_TRACK_FILE, 'utf8'); return JSON.parse(data);
  } catch (e) {
    console.warn('[gamify] read failed:', e.message);
    return {};
  }
}
function writeGamify(state) {
  try {
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
            await sendMessageViaAPI(`whatsapp:${shopId}`, insights);
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
                await sendMessageQueued(From, msg);        
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

// === NEW: Onboarding Benefits Video Sender ==========================================
// Sends a WhatsApp video with a localized, single-script caption.
// Called during onboarding for unactivated users, after intro text and before buttons.
async function sendOnboardingBenefitsVideo(From, lang = 'en') {
  try {
    const toNumber = String(From).replace('whatsapp:', '');
    const L = String(lang ?? 'en').toLowerCase();

    // Prefer per-language URLs if provided; else fallback to default
    let videoUrl = ONBOARDING_VIDEO_URL;
    if (L === 'hi'      && ONBOARDING_VIDEO_URL_HI)      videoUrl = ONBOARDING_VIDEO_URL_HI;
    if (L === 'hi-latn' && ONBOARDING_VIDEO_URL_HI_LATN) videoUrl = ONBOARDING_VIDEO_URL_HI_LATN;

    if (!videoUrl) {
      console.warn('[onboard-video] No video URL configured; skipping');
      return;
    }                   
        
    // DEFENSIVE: percent-encode any spaces/Unicode; log both forms
        const rawUrl = videoUrl;
        let encodedUrl = rawUrl;
        try { encodedUrl = encodeURI(rawUrl); }
        catch (e) { console.warn('[onboard-video] encodeURI failed; using raw URL', { error: e?.message, rawUrl }); }
        console.log('[onboard-video] media URL snapshot', { rawUrl, encodedUrl, lang: L });

    // Short localized caption; enforce single script; suppress footer badges        
    const NO_FOOTER_MARKER = '<!NO_FOOTER!>';
        const captionEn = 'Manage stock & expiry on WhatsApp • Low-stock alerts • Smart reorder tips';
        let caption0 = await t(captionEn, L, 'onboard-video-caption');
        let caption  = NO_FOOTER_MARKER + enforceSingleScript(caption0, L);
        
    // Send via Twilio Messages API as video media
        const accountSid   = process.env.ACCOUNT_SID;
        const authToken    = process.env.AUTH_TOKEN;
    const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER; // e.g. 'whatsapp:+14155238886'
       
    if (accountSid && authToken && fromWhatsApp) {
          // Direct Twilio send using ENCODED URL
          const twilioClient = require('twilio')(accountSid, authToken);
          try {
            const resp = await twilioClient.messages.create({
              from: fromWhatsApp,
              to: `whatsapp:${toNumber}`,
              mediaUrl: [encodedUrl],
              body: caption,
            });
            console.log('[onboard-video] sent', { sid: resp?.sid, to: toNumber, url: encodedUrl, rawUrl, lang: L });
            return;
          } catch (err) {
            // Deep diagnostics: error code/status/body and the URL we attempted
            const code       = err?.code ?? err?.status;
            const message    = err?.message ?? err?.moreInfo;
            const respStatus = err?.status ?? err?.response?.status;
            const respData   = err?.response?.data;
            console.warn('[onboard-video] Twilio send failed', {
              code, message, respStatus, respData, attemptedUrl: encodedUrl, rawUrl, lang: L
            });
            // Fall through to try the abstraction path next
          }
        } else {
          console.warn('[onboard-video] Missing Twilio creds or from number; will try abstraction fallback', {
            hasSid: !!accountSid, hasToken: !!authToken, hasFrom: !!fromWhatsApp
          });
        }
    
        // Fallback: use your abstraction if it supports mediaUrl (keeps queueing/backoff consistent)
        try {
          if (typeof sendMessageViaAPI === 'function') {
            await sendMessageViaAPI(From, caption, { mediaUrl: encodedUrl });
            console.log('[onboard-video] sent via sendMessageViaAPI (fallback)', { to: toNumber, url: encodedUrl, rawUrl, lang: L });
            return;
          } else {
            console.warn('[onboard-video] sendMessageViaAPI not found or not a function; cannot use fallback');
          }
        } catch (e) {
          console.warn('[onboard-video] fallback sendMessageViaAPI failed', {
            error: e?.message, attemptedUrl: encodedUrl, rawUrl, lang: L
          });
        }
    
        // If we reach here, both paths failed
        console.warn('[onboard-video] send wrapper failed', { error: e?.message });
  } catch (e) {
    console.warn('[onboard-video] send failed', e?.message);
  }
}

// Nativeglish demo: short, clear, localized with helpful English anchors
async function sendNativeglishDemo(From, lang, requestId) {
  const demo = [
    '🎬 Demo (उदाहरण):',
    '• sold milk 2 ltr — स्टॉक auto-update',
    '• purchase Parle-G 12 packets ₹10 — exp +6m',
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

  // If user didn’t give a price but we still need one, prompt again (with examples)
  if (needsPrice && !updatedPrice) {
    const again = await t(
      `Please say or type the price per unit, like "₹60 per kg" or "₹10 per packet". You can also say expiry like "exp 20-09".`,
      detectedLanguage, 'ask-price-again'
    );
    await sendMessageViaAPI(From, again);
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
                await updateInventory(shopId, product, quantity, unit);
                console.log(`[handleAwaitingPriceExpiry] Inventory updated for ${product}: +${quantity} ${unit}`);
                    
    // ✅ ADD: Confirmation message to user
                const confirmation = `✅ Done:\n✅ Purchased ${quantity} ${unit} ${product} (Stock: updated)\n\n✅ Successfully updated 1 of 1 items`;
                await sendMessageViaAPI(From, confirmation)
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
  const done = await t(
    `✅ Saved for ${product} ${quantity} ${unit}\n` + (lines.length ? lines.join('\n') : 'No changes.'),
    detectedLanguage, 'saved-price-expiry'
  );
  await sendMessageViaAPI(From, done);
  return true;
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
          await setStickyMode(From, switchCmd.set); // purchase | sold | returned
          await sendMessageViaAPI(
            From,
            await t(`✅ Mode set: ${switchCmd.set}`, detectedLanguage, `${requestId}::mode-set`)
          );
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
      const msg = await t(
        `✅ Reset. Cleared the current batch-selection window.`,
        detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, msg);
      return true;
    }
  
  const data = state.data || {};
  const { saleRecordId, product, unit, quantity, oldCompositeKey, createdAtISO, timeoutSec=120, action='sold'} = data;
  const createdAt = new Date(createdAtISO || Date.now());
  if ((Date.now() - createdAt.getTime()) > (timeoutSec*1000)) {      
  //if (state?.mode !== 'awaitingTransactionDetails') {
  //  await deleteUserStateFromDB(state.id);
  //}
    const msg = await t(
      `⏳ Sorry, the 2‑min window to change batch has expired.`, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
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
     const help = await t(
       COMPACT_MODE
         ? `Reply: batch DD-MM \n batch oldest \n batch latest (2 min)`
         : `Reply:\n• batch DD-MM (e.g., batch 12-09)\n• exp DD-MM (e.g., exp 20-09)\n• batch oldest \n batch latest\nWithin 2 min.`,
       detectedLanguage, requestId
     );
     await sendMessageViaAPI(From, help);
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
    const fail = await t(
      `⚠️ Could not switch batch: ${res.error}`, detectedLanguage, requestId);
    await sendMessageViaAPI(From, fail);
    return true;
  }
  
    
  //if (state?.mode !== 'awaitingTransactionDetails') {
  //  await deleteUserStateFromDB(state.id);
  //}
  const used = await getBatchByCompositeKey(newKeyNorm);
  const pd = used?.fields?.PurchaseDate ? formatDateForDisplay(used.fields.PurchaseDate) : '—';
  const ed = used?.fields?.ExpiryDate ? formatDateForDisplay(used.fields.ExpiryDate) : '—';
  const ok = await t(
    `✅ Updated. ${product} sale now attributed to: Purchased ${pd} (Expiry ${ed}).`,
    detectedLanguage, requestId);
  await sendMessageViaAPI(From, ok);
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
    const msg = await t(
      `✅ Reset. Cleared the expiry‑override window.`,
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, msg);
    return true;
  }

  const data = state.data || {};
  const { batchId, product, createdAtISO, timeoutSec = 120, purchaseDateISO, currentExpiryISO } = data;
  const createdAt = new Date(createdAtISO || Date.now());
  if ((Date.now() - createdAt.getTime()) > (timeoutSec * 1000)) {        
    //if (state?.mode !== 'awaitingTransactionDetails') {
    //  await deleteUserStateFromDB(state.id);
    //}
    const msg = await t(
      `⏳ Sorry, the 2‑min window to change expiry has expired.`,
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, msg);
    return true;
  }

  
// Avoid shadowing the translator helper `t(...)`
  const txt = String(Body).trim().toLowerCase();

  // Allow 'mode' / localized switch words during the override window too.
  // If user wants to switch context, clear this short-lived state and act.
  const switchCmd = parseModeSwitchLocalized(Body);
  if (switchCmd) {
    try { await deleteUserStateFromDB(state.id); } catch (_) {}
    if (switchCmd.ask) {
      await sendWelcomeFlowLocalized(From, detectedLanguage ?? 'en', requestId);
      return true;
    }
    if (switchCmd.set) {
      await setStickyMode(From, switchCmd.set);
      await sendMessageViaAPI(
        From,
        await t(`✅ Mode set: ${switchCmd.set}`, detectedLanguage, `${requestId}::mode-set`)
      );
      return true;
    }
  }
  // Keep current
  if (txt === 'ok' || txt === 'okay') {        
    //if (state?.mode !== 'awaitingTransactionDetails') {
    //  await deleteUserStateFromDB(state.id);
    //}
    const kept = currentExpiryISO ? formatDateForDisplay(currentExpiryISO) : '—';
    const msg = await t(
      `✅ Kept expiry for ${product}: ${kept}`,
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, msg);
    return true;
  }
  // Clear expiry
  if (txt === 'skip' || txt === 'clear') {
    try { await updateBatchExpiry(batchId, null); } catch (_) {}          
      //if (state?.mode !== 'awaitingTransactionDetails') {
      //  await deleteUserStateFromDB(state.id);
      //}
    const msg = await t(
      `✅ Cleared expiry for ${product}.`,
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, msg);
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
      const help = await t(
        COMPACT_MODE
          ? `Reply: exp +7d | +3m | +1y  • skip (clear)`
          : `Reply with: 
  • exp +7d / exp +3m / exp +1y
  • skip (to clear)`,
        detectedLanguage, requestId
      );
      await sendMessageViaAPI(From, help);
      return true;
    }

  try { await updateBatchExpiry(batchId, newISO); } catch (_) {}      
    //if (state?.mode !== 'awaitingTransactionDetails') {
    //  await deleteUserStateFromDB(state.id);
    //}
  const shown = formatDateForDisplay(newISO);
  const ok = await t(
    `✅ Updated. ${product} expiry set to ${shown}.`,
    detectedLanguage, requestId
  );
  await sendMessageViaAPI(From, ok);
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
  'Examples (purchase):',
  '• bought milk 10 liters @60 exp 20-09',
  '• purchase Parle-G 12 packets ₹10 exp +6m',
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
    const msg = await t(
      `${header}\n\n${examples}`,
      detectedLanguage, requestId + ':err'
    );
    await sendMessageViaAPI(From, msg);
  } catch (e) {
    // Fallback to basic English if translation fails
    await sendMessageViaAPI(From, `${header}\n\n${EXAMPLE_PURCHASE_EN}`);
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
// to the canonical router (no self-recursion).
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

  // If AI produced a normalized read-only command (summary/list/etc.), route it and exit.
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
        // Helper: direct dispatch for summary commands with activation gate
        const dispatchSummaryInline = async (cmd) => {
          try {
            const planInfo = await getUserPlan(shopId);
            const plan = String(planInfo?.plan ?? '').toLowerCase();
            const activated = (plan === 'trial' || plan === 'paid');
    
            const sendTagged = async (body) => {
              const msg0 = await tx(body, _lang, From, cmd, `qq-${cmd}-${shopId}`);
              const msg = await tagWithLocalizedMode(From, msg0, _lang);
              await sendMessageViaAPI(From, msg);
            };
    
            if (!activated) {
              const prompt = await t(
                'To use summaries, please activate your FREE trial.\nReply "Start Trial" or tap the trial button.',
                _lang,
                `cta-summary-${shopId}`
              );
              await sendTagged(prompt);
              return true;
            }
    
            if (cmd === 'short summary') {
              // Build concise snapshot (data-backed)
              let hasAny = false;
              try {
                const today = await getTodaySalesSummary(shopId);
                const inv = await getInventorySummary(shopId);
                hasAny = !!(today?.totalSales || inv?.totalValue || (inv?.lowStock ?? []).length);
              } catch (_) {}
              if (!hasAny) {
                await sendTagged('📊 Short Summary — Aaj abhi koi transaction nahi hua.\nTip: “sold milk 2 ltr” try karo.');
                return true;
              }
              const lines = [];
              try { const s = await getTodaySalesSummary(shopId); if (s?.totalSales) lines.push(`Sales Today: ₹${s.totalSales}`); } catch (_) {}
              try { const l = await getLowStockProducts(shopId) ?? []; if (l.length) lines.push(`Low Stock: ${l.slice(0,5).map(x=>x.product).join(', ')}`); } catch (_) {}
              try { const e = await getExpiringProducts(shopId, 7) ?? []; if (e.length) lines.push(`Expiring Soon: ${e.slice(0,5).map(x=>x.product).join(', ')}`); } catch (_) {}
              const body = `📊 Short Summary\n${lines.join('\n') || '—'}`;
              await sendTagged(body);
              return true;
            }
    
            if (cmd === 'full summary') {
              try {
                const insights = await generateFullScaleSummary(shopId, _lang, `qq-full-${shopId}`);
                await sendTagged(insights);
              } catch (_) {
                await sendTagged('📊 Full Summary — snapshot unavailable. Try: “short summary”.');
              }
              return true;
            }
          } catch (e) {
            console.warn(`[${requestId}] inline summary dispatch failed:`, e?.message);
          }
          // Fallback: do not recurse further; stop here
          return true;
        };
    
        // Avoid infinite loops: inline dispatch for summaries, or stop if depth exceeded
        if (sameCommand || tooDeep) {
          if (normalized === 'short summary' || normalized === 'full summary') {
            return await dispatchSummaryInline(normalized);
          }
          // If not a summary, stop recursion to avoid loops
          return true;
        }
                    
        // Safe single hop: route once to canonical command router
        return await handleQuickQueryEN(_orch.normalizedCommand, From, _lang, `${requestId}:alias-raw`);
  }
      
    // (Fix) Remove undefined 'orchestrated' and use _orch consistently
     // (Fix) Ensure languagePinned is defined before use
     if (_orch.normalizedCommand) {
       try {
         const languagePinned = (_orch.language ?? (detectedLanguage ?? 'en')).toLowerCase();                 
        // Route to canonical command router (no recursion into this wrapper)
         await handleQuickQueryEN(_orch.normalizedCommand, From, languagePinned, `${requestId}::ai-norm`);
         handledRequests.add(requestId);
         return true;
       } catch (e) {
         console.warn('[router] ai-normalized command failed, falling back:', e?.message);
       }
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
        // Route to canonical command router (normalized alias)
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
              await sendMessageViaAPI(From, msg);
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
        const msg = await t(ans, detectedLanguage, `${requestId}::sales-qa-first`);
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
        return await handleQuickQueryEN(listMap[id], From, detectedLanguage, `${requestId}::listfb`);
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
            if (await shouldWelcomeNow(shopId, text)) {
            await sendWelcomeFlowLocalized(From, detectedLanguage ?? 'en', requestId);
            return true;
                  }
                  // If welcome was shown recently, do nothing here; fall through to other handlers.
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
    const exp = await getExpiringProducts(shopId, 0);
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
    const inv = await getInventorySummary(shopId);
    let message = `📦 Inventory Summary:\n• Unique products: ${inv.totalProducts}\n• Total value: ₹${(inv.totalValue ?? 0).toFixed(2)}`;
    if ((inv.totalPurchaseValue ?? 0) > 0) message += `\n• Total cost: ₹${inv.totalPurchaseValue.toFixed(2)}`;
    if ((inv.topCategories ?? []).length > 0) {
      message += `\n\n📁 By Category:\n` +
        inv.topCategories.map((c,i)=>`${i+1}. ${c.name}: ₹${c.value.toFixed(2)} (${c.productCount} items)`).join('\n');
    }
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }


// 0.5) List products (with optional page or search)
  //   - "products" | "list products"           => page 1
  //   - "products 2" | "list products 2"       => page 2
  //   - "products page 3"                      => page 3
  //   - "products search maggi"                => search
  //   - "search products maggi"                => search
  let pm = text.match(/^\s*(?:products|list\s+products)(?:\s+(?:page\s+)?(\d+))?\s*$/i);
  let sm = text.match(/^\s*(?:products\s+search|search\s+products)\s+(.+)\s*$/i);
  if (pm || sm) {
    const PAGE_SIZE = 25;
    const page = pm ? Math.max(1, parseInt(pm[1] || '1', 10)) : 1;
    const query = sm ? sm[1].trim() : '';
    // Fetch inventory for this shop
    const list = await getCurrentInventory(shopId);
    // Build unique items map (use last non-empty qty/unit)
    const map = new Map();
    for (const r of list) {
      const name = r?.fields?.Product?.trim();
      if (!name) continue;
      const qty  = r?.fields?.Quantity ?? 0;
      const unit = r?.fields?.Units || 'pieces';
      map.set(name.toLowerCase(), { name, qty, unit });
    }
    let items = Array.from(map.values());
    // Optional search
    if (query) {
      const q = query.toLowerCase();
      items = items.filter(x => x.name.toLowerCase().includes(q));
    }
    // Sort: by name (case-insensitive)
    items.sort((a,b) => a.name.localeCompare(b.name, undefined, {sensitivity:'base'}));
    // Paging
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const pageSafe = Math.min(page, totalPages);
    const start = (pageSafe - 1) * PAGE_SIZE;
    const pageItems = items.slice(start, start + PAGE_SIZE);
    // Build message
    let header = query
      ? `🧾 Products matching “${query}” — ${pageItems.length} of ${total}`
      : `🧾 Products — Page ${pageSafe}/${totalPages} — ${pageItems.length} of ${total}`;
        
    if (total === 0) {
        const msg0 = await t(`${header}\nNo products found.`, detectedLanguage, requestId);
        await sendMessageQueued(From, msg0);
        await scheduleUpsell(gate?.upsellReason);
        return true;
      }

    const lines = pageItems.map(p => `• ${p.name} — ${p.qty} ${p.unit}`);
    let message = `${header}\n\n${lines.join('\n')}`;
    if (!query && pageSafe < totalPages) {
      message += `\n\n➡️ Next page: "products ${pageSafe+1}"`;
    } else if (query && pageSafe < totalPages) {
      message += `\n\n➡️ Next page: "products ${pageSafe+1}" (repeat the search term)`;
    }
    message += `\n🔎 Search: "products search <term>"`;
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  // Prices needing update (paged): "prices", "prices 2", "price updates", "stale prices"
let pricePage = text.match(/^\s*(?:prices|price\s*updates|stale\s*prices)(?:\s+(?:page\s+)?(\d+))?\s*$/i);
if (pricePage) {
  const page = pricePage[1] ? parseInt(pricePage[1], 10) : 1;    
  const out = await sendPriceUpdatesPaged(From, detectedLanguage, requestId, page);
   if (out) {
     await sendMessageQueued(From, out);
     await scheduleUpsell(gate?.upsellReason);
   }
   return true;
}

  
// 1) Stock for product
  // Guard: don't let "inventory value/valuation/value summary" slip into stock branch
  let m = text.match(/^(?:stock|inventory|qty)\s+(?!value\b|valuation\b|summary\b)(.+)$/i);

  if (m) {
    // Clean tail punctuation like "?", "!" etc.
    const rawQuery = m[1].trim().replace(/[?।。.!,;:\u0964\u0965]+$/u, '');
    const product = await translateProductName(rawQuery, requestId + ':qq-stock');

    // --- Precise DB lookup first (preferred) ---
    try {
      const exact = await getProductInventory(shopId, product);
      if (exact?.success) {
        const qty  = exact.quantity ?? 0;
        const unit = exact.unit || 'pieces';
        const message = `📦 Stock — ${product}: ${qty} ${unit}`;
        const msg = await t(message, detectedLanguage, requestId);
        await sendMessageQueued(From, msg);
        await scheduleUpsell(gate?.upsellReason);
        return true;
      }
    } catch (e) {
      console.warn(`[${requestId}] getProductInventory failed:`, e?.message);
    }

    // --- Fallback: fuzzy scan of full inventory (only if available) ---
    try {
      const list = await getCurrentInventory(shopId);
      const qN = _norm(product);
      let best = null, bestScore = 0;
      for (const r of list) {
        const name = r?.fields?.Product;
        if (!name) continue; // ignore blank names to avoid "undefined"
        const n = _norm(name);
        if (!n || !qN) continue;
        let score = 0;
        if (n === qN) score = 3;                                   // exact
        else if (n.includes(qN) || qN.includes(n)) score = 2;      // substring
        else {
          const qw = qN.split(/\s+/).filter(w => w.length > 2);
          const nw = n.split(/\s+/).filter(w => w.length > 2);
          const overlap = qw.filter(w => nw.includes(w)).length;
          if (overlap > 0) score = 1;                              // token overlap
        }
        if (score > bestScore) { bestScore = score; best = r; }
      }
      let message;
      if (!best) {
        message = `📦 ${rawQuery}: not found in inventory.`;
      } else {
        const qty  = best?.fields?.Quantity ?? 0;
        const unit = best?.fields?.Units || 'pieces';
        const name = best?.fields?.Product || product;
        message = `📦 Stock — ${name}: ${qty} ${unit}`;
      }
      const msg = await t(message, detectedLanguage, requestId);
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    } catch (e) {
      console.warn(`[${requestId}] Fallback list scan failed:`, e?.message);
      const msg = await t(
        `📦 ${rawQuery}: not found in inventory.`,
        detectedLanguage,
        requestId
      );
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }
  }


  // 2) Low stock / Stockout    
  if (/^(?:low\s*stock|stockout|out\s*of\s*stock)$/.test(text)) {
     let low = await getLowStockProducts(shopId, 5);
     low = sanitizeProductRows(low);
    const all = await getCurrentInventory(shopId);
    const out = all.filter(r => (r.fields.Quantity ?? 0) <= 0).map(r => ({
      name: r.fields.Product, unit: r.fields.Units || 'pieces'
    }));
    let message = `⚠️ Low & Stockout:\n`;
    if (low.length === 0 && out.length === 0) message += `Everything looks good.`;
    else {
      if (low.length) message += `\nLow stock (≤5):\n` + low.map(p=>`• ${p.name}: ${p.quantity} ${p.unit}`).join('\n');
      if (out.length) message += `\n\nOut of stock:\n` + out.map(p=>`• ${p.name}`).join('\n');
      message += `\n\n💡 Advice: Prioritize ordering low-stock items first.`;
    }
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }

  
// 3) Batches for product (purchase & expiry)
  m = text.match(/^(?:batches?|expiry)\s+(.+)$/i);
  if (m) {
   const rawQuery = m[1].trim().replace(/[?।。.!,;:\u0964\u0965]+$/u, '');
    const product = await translateProductName(rawQuery, requestId + ':qq-batches');

    // --- Exact helper first ---
    try {
      // Prefer the helper that returns only remaining batches for a product
      const exact = await getBatchesForProductWithRemaining(shopId, product);
      if (Array.isArray(exact) && exact.length > 0) {
        const lines = exact.map(b => {
          const q  = b.quantity ?? b.fields?.Quantity ?? 0;
          const u  = b.unit || b.fields?.Units || 'pieces';
          const pd = b.purchaseDate || b.fields?.PurchaseDate || null;
          const ed = b.expiryDate   || b.fields?.ExpiryDate   || null;
          return `• ${q} ${u} | Bought: ${formatDateForDisplay(pd || '—')} | Expiry: ${formatDateForDisplay(ed || '—')}`;
        }).join('\n');
        let message = `📦 Batches — ${product}:\n${lines}`;
        const soon = exact.filter(b => (b.expiryDate || b.fields?.ExpiryDate) &&
                        daysBetween(new Date(b.expiryDate || b.fields?.ExpiryDate), new Date()) <= 7);
        if (soon.length) message += `\n\n💡 ${soon.length} batch(es) expiring ≤7 days — clear with FIFO/discounts.`;
        const msg = await t(message, detectedLanguage, requestId);
        await sendMessageQueued(From, msg);
        await scheduleUpsell(gate?.upsellReason);
        return true;
      }
    } catch (e) {
      console.warn(`[${requestId}] getBatchesForProductWithRemaining failed:`, e?.message);
    }

    // --- Safe fuzzy fallback ---
    try {
      const all = await getBatchRecords(shopId, product);
      // Filter valid product-named records; group by product to pick a best match
      const valid = all.filter(b => !!b?.fields?.Product && (b.fields.Quantity ?? 0) > 0);
      const qN = _norm(product);
      const scored = valid.map(b => {
        const n = _norm(b.fields.Product);
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
          const u  = b.fields.Units || 'pieces';
          const pd = b.fields.PurchaseDate ? formatDateForDisplay(b.fields.PurchaseDate) : '—';
          const ed = b.fields.ExpiryDate   ? formatDateForDisplay(b.fields.ExpiryDate)   : '—';
          return `• ${q} ${u} | Bought: ${pd} | Expiry: ${ed}`;
        }).join('\n');
        message = `📦 Batches — ${topName || product}:\n${lines}`;
        const soon = active.filter(b => b.fields.ExpiryDate && daysBetween(new Date(b.fields.ExpiryDate), new Date()) <= 7);
        if (soon.length) message += `\n\n💡 ${soon.length} batch(es) expiring ≤7 days — clear with FIFO/discounts.`;
      }
      const msg = await t(message, detectedLanguage, requestId);
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    } catch (e) {
      console.warn(`[${requestId}] Fallback batches scan failed:`, e?.message);
      const msg = await t(
        `📦 No active batches found for ${rawQuery}.`,
        detectedLanguage,
        requestId
      );
      await sendMessageQueued(From, msg);
      await scheduleUpsell(gate?.upsellReason);
      return true;
    }
  }

  // 4) Expiring soon
  // Allow "expiring 0" for already-expired items
  m = text.match(/^expiring(?:\s+(\d+))?$/i);
  if (m) {
    const days = m[1] !== undefined ? Math.max(0, parseInt(m[1], 10)) : 30; // allow 0
    const exp = await getExpiringProducts(shopId, days);
    const header = days === 0
      ? `❌ Already expired:`
      : `⏰ Expiring in next ${days} day(s):`;
    let message = `${header}\n`;
    if (!exp.length) message += days === 0 ? `No expired items.` : `No items found.`;
    else {
      message += exp
        .map(p => `• ${p.name}: ${formatDateForDisplay(p.expiryDate)} (qty ${p.quantity})`)
        .join('\n');
      message += days === 0
        ? `\n\n💡 Move expired stock off-shelf and create a return-to-supplier note if applicable.`
        : `\n\n💡 Move to eye‑level, bundle, or mark‑down 5–15%.`;
    }
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
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
  if (/^reorder(\s+suggestions?)?$|^what\s+should\s+i\s+reorder$/i.test(text)) {
    // last 30 days sales velocity
    const now = new Date(); const start = new Date(now); start.setDate(now.getDate()-30);
    const sales = await getSalesDataForPeriod(shopId, start, now);
    const inv = await getCurrentInventory(shopId);
    const soldMap = new Map();
    for (const r of (sales.records || [])) {
      const p = r.fields.Product; const q = Math.abs(r.fields.Quantity ?? 0);
      if (!p) continue; soldMap.set(p, (soldMap.get(p)||0)+q);
    }
    const days = 30, lead=3, safety=2;
    const suggestions = [];
    for (const r of inv) {
      const name = r.fields.Product; const unit = r.fields.Units || 'pieces';
      const current = r.fields.Quantity ?? 0; const sold = soldMap.get(name) || 0;
      const daily = sold/days;
      const coverNeeded = (lead+safety)*daily;
      const reorderQty = Math.max(0, Math.ceil(coverNeeded - current));
      if (reorderQty > 0) suggestions.push({name, unit, current, daily: Number(daily.toFixed(2)), reorderQty});
    }
    suggestions.sort((a,b)=> (b.reorderQty-a.reorderQty) || (b.daily-a.daily));
    let message = `📋 Reorder Suggestions (30d, lead ${lead}d + safety ${safety}d):\n`;
    message += suggestions.length
      ? suggestions.slice(0,10).map(s=>`• ${s.name}: stock ${s.current} ${s.unit}, ~${s.daily}/day → reorder ~${s.reorderQty} ${singularize(s.unit)}`).join('\n')
      : 'No urgent reorders detected.';
    const msg = await t(message, detectedLanguage, requestId);
    await sendMessageQueued(From, msg);
    await scheduleUpsell(gate?.upsellReason);
    return true;
  }  
} finally {
  // No local stop; centralized wrapper handles stopping.
}
  return false; // not a quick query
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
        await scheduleUpsell(gate?.upsellReason);
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
    const exp = await getExpiringProducts(shopId, 0);
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
      const expiring = await getExpiringProducts(shopId, days);
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
      await getReorderSuggestions(shopId, { days: 30, leadTimeDays: 3, safetyDays: 2 });
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
    let message = COMPACT_MODE
        ? `📦 Inventory: ${inv.totalProducts} items • ₹${(inv.totalValue ?? 0).toFixed(2)}`
        : `📦 Inventory Summary:\n• Unique products: ${inv.totalProducts}\n• Total value: ₹${(inv.totalValue ?? 0).toFixed(2)}`;
    
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
async function translateProductName(productName, requestId) {
  try {
    // Check cache first
    const cacheKey = productName.toLowerCase();
    const cached = productTranslationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < PRODUCT_TRANSLATION_CACHE_TTL)) {
      console.log(`[${requestId}] Using cached product translation: "${productName}" → "${cached.translation}"`);
      return cached.translation;
    }
    
    // First, extract just the product name
    const cleanProduct = extractProductName(productName);
    
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
async function validateTranscript(transcript, requestId) {
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
    fixedTranscript = fixedTranscript.replace(/([a-zA-Z\s]+)\s+बचा\s+.*?(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)/gi, (match, product, purchase) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${product} बेचा, ${purchase}"`);
      return `${product} बेचा, ${purchase}`;
    });
    // Pattern 4: Purchase action followed by product and "बचा"
    fixedTranscript = fixedTranscript.replace(/(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)\s+([a-zA-Z\s]+)\s+बचा/gi, (match, purchase, product) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${purchase} ${product}, बेचा ${product}"`);
      return `${purchase} ${product}, बेचा ${product}`;
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
    console.log(`[${requestId}] Cleaned transcript: "${cleaned}"`);
    return cleaned;
  } catch (error) {
    console.warn(`[${requestId}] Deepseek validation failed, using original:`, error.message);
    return transcript;
  }
}

// Handle multiple inventory updates with batch tracking
async function updateMultipleInventory(shopId, updates, languageCode) {
  const results = [];
  for (const update of updates) {  
  // NEW: lock the chosen sale price for this specific update (prevents ₹0 fallbacks)
    let chosenSalePrice = null;
  // Hoisted: keep a per-update confirmation line available beyond branch scope
    let confirmTextLine;
    let createdBatchEarly = false;
    try {
      // Translate product name before processing
      const translatedProduct = await translateProductName(update.product, 'update');
      console.log(`[Update ${shopId}] Using translated product: "${translatedProduct}"`);
      // Use translated product for all operations
      const product = translatedProduct;
      
      // === NEW: Handle customer returns (simple add-back; no batch, no price/expiry) ===
      if (update.action === 'returned') {
        let result;
        try {
          result = await updateInventory(shopId, product, Math.abs(update.quantity), update.unit);
          // Fetch post-update for confirmation
          const invAfter = await getProductInventory(shopId, product);
          const unitText = update.unit ? ` ${update.unit}` : '';
          const newQty = invAfter?.quantity ?? result?.newQuantity;
          const u = invAfter?.unit ?? result?.unit ?? update.unit;            
          const compact = COMPACT_MODE
                    ? `↩️ Returned ${Math.abs(update.quantity)} ${u ?? ''} ${product}. Stock: ${newQty ?? ''} ${u ?? ''}`.trim()
                    : `↩️ Return processed — ${product}: +${Math.abs(update.quantity)} ${u ?? ''}`.trim()
                        + (newQty !== undefined ? ` (Stock: ${newQty} ${u ?? ''})` : '');
          const message = await t(compact, languageCode, 'return-ok');
          await sendMessageViaAPI(`whatsapp:${shopId}`, message);
        } catch (e) {
          console.warn(`[Update ${shopId} - ${product}] Return failed:`, e.message);
        }
        results.push({
          product, quantity: Math.abs(update.quantity), unit: update.unit, action: 'returned',
          success: !!result?.success, newQuantity: result?.newQuantity, unitAfter: result?.unit
        });
              
        // --- Gamify toast for successful return ---
                try {
                  if (result?.success) {
                    const gam = updateGamifyState(String(shopId), update.action);
                    const toast = await t(composeGamifyToast({ action: update.action, gs: gam.snapshot, newlyAwarded: gam.newlyAwarded }), languageCode, 'gamify-toast');
                    await sendMessageViaAPI(`whatsapp:${shopId}`, toast);
                  }
                } catch (e) { console.warn('[gamify] toast failed:', e.message); }
        
        continue; // Move to next update
      }

      let needsPriceInput = false;
      // Get product price from database           
      let productPrice = 0;
            let productPriceUnit = null;
            try {
              const priceResult = await getProductPrice(product, shopId);
              if (priceResult?.success) {
                productPrice     = toNumberSafe(priceResult.price);
                productPriceUnit = priceResult.unit || null;
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
            productMeta = await getProductPrice(product, shopId);
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
    
          // Check if we need to ask for price
          if (finalPrice <= 0) {
            console.log(`[Update ${shopId} - ${product}] No price available, asking for input`);
            
            // Create batch first without price
            const batchResult = await createBatchRecord({
              shopId,
              product,
              quantity: update.quantity,
              unit: update.unit,
              purchaseDate: purchaseDateISO,
              expiryDate: expiryToUse,
              purchasePrice: 0 // Will be updated later
            });
            
            if (batchResult?.success) createdBatchEarly = true;
            
            // Set state to await price input
            await setUserState(`whatsapp:${shopId}`, 'awaitingPriceExpiry', {
              batchId: batchResult?.id ?? null,
              product,
              unit: update.unit,
              quantity: update.quantity,
              purchaseDate: purchaseDateISO,
              autoExpiry: expiryToUse ?? null,
              needsPrice: true,
              isPerishable: !!(productMeta?.success && productMeta.requiresExpiry)
            });
            
            // Send price request message
            const isPerishable = !!(productMeta?.success && productMeta.requiresExpiry);
            const edDisplay = expiryToUse ? formatDateForDisplay(expiryToUse) : '—';
                
            const prompt = await t(
              [
                `Captured ✅ ${product} ${update.quantity} ${update.unit} — awaiting price.`,
                isPerishable ? `Expiry set: ${edDisplay}` : `No expiry needed.`,
                ``,
                `Please send price per ${update.unit}, e.g. "₹60" or "₹60 per ${update.unit}".`,
                `You can adjust expiry later (within 2 min) after price is saved:`,
                `• exp +7d / exp +3m / exp +1y`,
                `• skip (to clear)`
              ].join('\n'),
              languageCode, 'ask-price-only'
            );
            await sendMessageViaAPI(`whatsapp:${shopId}`, prompt);
            
            // Return result indicating we need user input
            results.push({
              product, 
              quantity: update.quantity, 
              unit: update.unit, 
              action: update.action,                                         
              success: true, 
              needsUserInput: true, 
              awaiting: 'price', 
              status: 'pending',
              deferredPrice: true,
              // include latest stock even in pending case (nice to have; harmless if undefined)
              newQuantity: update.quantity, // Since we just added this quantity
              unitAfter: update.unit
            });
            continue; // Move to next update
          }

                          
          // If we have a price, continue with normal flow
          // Create batch immediately with defaulted expiry (or blank)
          const batchResult = await createBatchRecord({
            shopId,
            product,
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
            invResult = await updateInventory(shopId, product, update.quantity, update.unit);
          } catch (_) {}
          const stockQty  = invResult?.newQuantity;
          const stockUnit = invResult?.unit ?? update.unit;
      
          // Save price if known now
          if (finalPrice > 0) {
            try { await upsertProduct({ shopId, name: product, price: finalPrice, unit: update.unit }); } catch (_) {}
          }
      
          const isPerishable = !!(productMeta?.success && productMeta.requiresExpiry);
          const edDisplay = expiryToUse ? formatDateForDisplay(expiryToUse) : '—';
                            
          // Assign to hoisted holder so we can use it later safely
                  confirmTextLine = COMPACT_MODE
                    ? (isPerishable
                      ? `✅ Purchased ${update.quantity} ${update.unit} ${product} @ ₹${finalPrice}. Exp: ${edDisplay}`
                      : `✅ Purchased ${update.quantity} ${update.unit} ${product} @ ₹${finalPrice}`)
                    : `• ${product}: ${update.quantity} ${update.unit} purchased @ ₹${finalPrice}`
                      + (isPerishable ? `\n Expiry: ${edDisplay}` : `\n Expiry: —`);

          // Open the 2-min expiry override window
          try {
            await saveUserStateToDB(shopId, 'awaitingPurchaseExpiryOverride', {
              batchId: batchResult?.id ?? null,
              product,
              action: 'purchase',
              purchaseDateISO,
              currentExpiryISO: expiryToUse ?? null,
              createdAtISO: new Date().toISOString(),
              timeoutSec: 120
            });
          } catch (_) {}
      
          results.push({
            product,
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
          
          // --- Gamify toast for successful purchase ---
                try {
                  const gam = updateGamifyState(String(shopId), update.action);
                  const toast = await t(composeGamifyToast({ action: update.action, gs: gam.snapshot, newlyAwarded: gam.newlyAwarded }), languageCode, 'gamify-toast');
                  await sendMessageViaAPI(`whatsapp:${shopId}`, toast);
                } catch (e) { console.warn('[gamify] toast failed:', e.message); }

          continue; // done with purchase branch
        }
        // === END NEW block ===

      // Use provided price or fall back to database price            
      // NEW: reliable price/value without leaking block-scoped vars            
      const msgUnitPrice = toNumberSafe(update.price);
            const dbAdjustedUnitPrice = productPrice * unitConvFactor(productPriceUnit, update.unit);
            const unitPriceForCalc = msgUnitPrice > 0 ? msgUnitPrice : (dbAdjustedUnitPrice || 0);

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
          product,
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
            { product, quantity: Math.abs(update.quantity), unit: update.unit, saleDate: new Date().toISOString(), language: languageCode },
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
                const invAfter = await getProductInventory(shopId, product);
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
          result = await updateInventory(shopId, product, update.quantity, update.unit);
        }

          
        // Create batch record for purchases only (skip if we already created above)
            if (!createdBatchEarly && update.action === 'purchased' && result.success) {
            console.log(`[Update ${shopId} - ${product}] Creating batch record for purchase`);
            // Format current date with time for Airtable
            const formattedPurchaseDate = formatDateForAirtable(new Date());
            console.log(`[Update ${shopId} - ${product}] Using timestamp: ${formattedPurchaseDate}`);
            
            // Use database price (productPrice) or provided price
            const purchasePrice = productPrice > 0 ? productPrice : (finalPrice || 0);
            console.log(`[Update ${shopId} - ${product}] Using purchasePrice: ${purchasePrice} (productPrice: ${productPrice}, finalPrice: ${finalPrice})`);
            
            const batchResult = await createBatchRecord({
              shopId,
              product: product, // Use translated product
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
                  product: product,
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
                languageCode,
                'sale-confirmation', // requestId scope for dedupe
                {
                  product,
                  qty: Math.abs(update.quantity),
                  unit: update.unit,
                  pricePerUnit: salePrice,
                  newQuantity: result?.newQuantity   // ensures "Stock: 5 liters" gets appended
                }
              );
                        
            // --- NEW: start a short override window (2 min) only if multiple batches exist ---
             try {
               if (await shouldOfferBatchOverride(shopId, product)) {
                 await saveUserStateToDB(shopId, 'awaitingBatchOverride', {
                   saleRecordId: salesResult.id,
                   product,
                   action: 'purchase',
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
              const list = await getBatchesForProductWithRemaining(shopId, product); // asc by PurchaseDate
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
            const offerOverride = await shouldOfferBatchOverride(shopId, product).catch(() => false);

            const compactLine = (() => {
              const qty = Math.abs(update.quantity);
              const pricePart = salePrice > 0 ? ` @ ₹${salePrice}` : ''; // Fixed: Use salePrice
              const stockPart = (result?.newQuantity !== undefined)
                ? `. Stock: ${result.newQuantity} ${result?.unit ?? update.unit}`
                : '';
              return `✅ Sold ${qty} ${update.unit} ${product}${pricePart}${stockPart}`;
            })();

            const verboseLines = (() => {
              const qty = Math.abs(update.quantity);
              const hdr = `✅ ${product} — sold ${qty} ${update.unit}${salePrice > 0 ? ` @ ₹${salePrice}` : ''}`; // Fixed: Use salePrice
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
          product,
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
             
        // --- Gamify toast for successful non-return branch (purchase handled earlier; sale here) ---
        try {
          if (result && result.success) {
            const gam = updateGamifyState(String(shopId), update.action);
            const toast = await t(composeGamifyToast({ action: update.action, gs: gam.snapshot, newlyAwarded: gam.newlyAwarded }), languageCode, 'gamify-toast');
            await sendMessageViaAPI(`whatsapp:${shopId}`, toast);
          }
        } catch (e) { console.warn('[gamify] toast failed:', e.message); }
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
            const langExact = ensureLangExact(languageCode || 'en');
            const isRomanOnly = shouldUseRomanOnly(langExact); // existing helper
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
    let fallback;
      if (shouldUseRomanOnly(langExact)) {               // [UNIQ:MLR-GREET-011]
        fallback = greeting.roman;                       // SINGLE-SCRIPT (roman)
      } else {
        fallback = `${greeting.native}\n\n${greeting.roman}`; // two-block default
      }        
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
            content: `You are a multilingual assistant. Translate the given message to the target language and provide it in two formats:
Format your response exactly as:
Line 1: Translation in native script (e.g., Devanagari for Hindi)
Empty line
Line 3: Translation in Roman script (transliteration using English alphabet)
For example, for Hindi:
नमस्ते, आप कैसे हैं?
Namaste, aap kaise hain?
Do NOT include any labels like [Roman Script], [Native Script], <translation>, or any other markers. Just provide the translations one after the other with a blank line in between.`
          },
          {
            role: "user",
            content: `Translate this message to ${langExact}: "${message}"` // [UNIQ:MLR-API-007B]
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

// Quick integrity check: ensure we have 2 blocks and not cut mid-sentence    
    const endsNeatly = /[.!?]$/.test(String(translated).trim());  // [UNIQ:MLR-GUARD-009]
    const hasTwoBlocks = String(translated).includes('\n\n');
    if (!hasTwoBlocks || !endsNeatly) {
      try {
        console.warn(`[${requestId}] Translation looks incomplete. Retrying with larger budget...`);
        const retry = await axios.post(
          'https://api.deepseek.com/v1/chat/completions',
          {
            model: "deepseek-chat",
            messages: [
              { role: "system", content: `Return COMPLETE translation as two blocks (native script, blank line, roman transliteration). Do not omit the ending punctuation.` },
              { role: "user", content: `Translate this message to ${langExact}: "${message}"` } // [UNIQ:MLR-API-007C }
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
        const MIN_LEN = 25;
        if ((translated || '').trim().length < MIN_LEN) {
          console.warn(`[${requestId}] Output too short (${translated.length}). Falling back to first-pass raw after sanitize.`);
          const fallbackClean = String(firstPassRaw || '')
            .replace(/`+/g, '')
            .replace(/^[\s.,\-–—•]+/u, '')
            .trim();
          if (fallbackClean.length >= MIN_LEN) translated = fallbackClean;
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
  const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
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
    
    
    // Prefer public URL flow unless explicitly overridden
        if (!USE_BASE64_PDF) {
          const fileName = path.basename(pdfPath);
          const baseUrl = process.env.PUBLIC_URL || `https://${process.env.RAILWAY_SERVICE_NAME}.railway.app`;
          const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
          const publicUrl = `${normalizedBaseUrl}/invoice/${fileName}`;
          console.log(`[sendPDFViaWhatsApp] Using public URL: ${publicUrl}`);
          const msg = await client.messages.create({
            body: 'Here is your invoice:',
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
          body: 'Here is your invoice:',
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
        body: 'Here is your invoice:',
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
  const updates = await parseMultipleUpdates(buildFakeReq(from, transcript));
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
      const expiringProducts = await getExpiringProducts(shopId, 7);
  
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
    const expiringProducts = await getExpiringProducts(shopId, 7);
    
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
      const prompt = `You are an inventory analysis assistant. Analyze the following shop data and provide insights in Nativeglish (${nativeLanguage} mixed with English) - ensure response is formal and respectful.
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
      Format your response in Nativeglish (${nativeLanguage} + English mix) that is easy to understand for local shop owners. Keep the response under 500 words and focus on actionable insights.`;
      
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
                content: `You are an expert inventory analyst providing concise, actionable insights for small business owners. Your response should be in Nativeglish (${nativeLanguage} mixed with English) for better readability but should be formal and respectful. Keep your response under 1500 characters.`
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

module.exports = { generateSummaryInsights };

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
    const message = await t(
      'You have been upgraded to the Enterprise plan. You now have access to all features including advanced AI analytics.',
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, message);
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
          try { await clearUserState(from); } catch (_) {}
          await sendSystemMessage(`✅ Reset. I’ve cleared any active steps.`, from, detectedLanguage, requestId, response);
          handledRequests.add(requestId);
          return res.send(response.toString());
        }
    

    // --- HARD GUARD: treat summary phrases as commands, not inventory updates
    const shopId = from.replace('whatsapp:', '');
    const intent = resolveSummaryIntent(transcript);
    if (intent === 'short summary') {
      const msg = await generateInstantSummary(shopId, detectedLanguage, requestId);
      // send via API to avoid Twilio body-length issues; then ack Twilio
      await sendMessageViaAPI(from, msg);
      response.message('✅ Short summary sent.');
      handledRequests.add(requestId);
      return res.send(response.toString());
    }
    if (intent === 'full summary') {
      await processShopSummary(shopId); // Sends Nativeglish itself
      response.message('✅ Full summary sent.');
      handledRequests.add(requestId);
      return res.send(response.toString());
    }       

        
    // ===== EARLY EXIT: AI orchestrator on confirmed transcript =====
      try {
        const orch = await applyAIOrchestration(transcript, from, detectedLanguage, requestId);
        const langExact = ensureLangExact(orch.language ?? detectedLanguage ?? 'en');
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
          await handleQuickQueryEN(orch.normalizedCommand, from, langExact, `${requestId}::ai-norm-confirmed`);
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
          await setUserState(from, 'correction', {
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
         const totalProcessed = results.filter(r => !r.needsPrice && !r.needsUserInput && !r.awaiting).length;
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
          await sendMessageViaAPI(from, formattedResponse);
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

// Function to send WhatsApp message via Twilio API (for async responses)

async function sendMessageViaAPI(to, body) {
  try {
    const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    console.log(`[sendMessageViaAPI] Preparing to send message to: ${formattedTo}`);
    console.log(`[sendMessageViaAPI] Message length: ${String(body).length} characters`);

    // Twilio hard limit for WhatsApp (exceeding returns Error 21617)
    // Ref: https://www.twilio.com/docs/api/errors/21617, https://help.twilio.com/articles/360033806753
    const MAX_LENGTH = 1600;
    const PART_SUFFIX = (i, n) => `\n\n(Part ${i} of ${n})`;

    // We will append the localized footer ONLY to the final part.
    // Measure footer length by tagging an empty string once.
    const emptyTagged = await tagWithLocalizedMode(formattedTo, '', 'en');
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
    
    // If the message fits, tag once and send
    if (String(body).length <= MAX_LENGTH) {
      const tagged = await tagWithLocalizedMode(formattedTo, body, 'en');
      const message = await client.messages.create({
        body: tagged,
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
    let parts = smartSplit(body, MAX_LENGTH - 14); // provisional
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
      // Append footer ONLY on the last part
      if (isLast) {
        text = await tagWithLocalizedMode(formattedTo, text, 'en');
      }

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


// Async processing for voice messages
async function processVoiceMessageAsync(MediaUrl0, From, requestId, conversationState) {
  try {
    console.log(`[${requestId}] [1] Downloading audio...`);
    const audioBuffer = await downloadAudio(MediaUrl0);
    console.log(`[${requestId}] [2] Converting audio...`);
    const flacBuffer = await convertToFLAC(audioBuffer);
    console.log(`[${requestId}] [3] Transcribing with Google STT...`);
    const transcriptionResult = await googleTranscribe(flacBuffer, requestId);
    const rawTranscript = transcriptionResult.transcript;
    const confidence = transcriptionResult.confidence;
    console.log(`[${requestId}] [4] Validating transcript...`);
    const cleanTranscript = await validateTranscript(rawTranscript, requestId);
    console.log(`[${requestId}] [5] Detecting language...`);
    const detectedLanguage = await checkAndUpdateLanguage(cleanTranscript, From, conversationState?.language, requestId);
    
    // Save user preference
    const shopId = From.replace('whatsapp:', '');
    await saveUserPreference(shopId, detectedLanguage);
       
    // ===== EARLY EXIT: AI orchestrator on the transcript =====
      try {
        const orch = await applyAIOrchestration(cleanTranscript, From, detectedLanguage, requestId);                  
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
              return true;
            }
            if (_aliasDepth(requestId) >= MAX_ALIAS_DEPTH) {
              return true;
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

        // Question → answer & exit
        if (orch.isQuestion === true || orch.kind === 'question') {
          handledRequests.add(requestId);
          const ans = await composeAISalesAnswer(shopId, cleanTranscript, langExact);
          const msg = await t(ans, langExact, `${requestId}::sales-qa-voice`);
          await sendMessageViaAPI(From, msg);                  
          try {
                  const isActivated = await isUserActivated(shopId);
                  const buttonLang = langPinned.includes('-latn') ? langPinned.split('-')[0] : langPinned;
                  await sendSalesQAButtons(From, buttonLang, isActivated);
                } catch (e) {
                  console.warn(`[${requestId}] qa-buttons send failed:`, e?.message);
                }
          return;
        }
        // Read‑only normalized command → route & exit
        if (orch.normalizedCommand) {
          handledRequests.add(requestId);
          await handleQuickQueryEN(orch.normalizedCommand, From, langExact, `${requestId}::ai-norm-voice`);
          return;
        }
      } catch (e) {
        console.warn(`[${requestId}] orchestrator (voice) early-exit error:`, e?.message);
        // fall through gracefully
      }
      
    // First, try to parse as inventory update (higher priority)
    try {
      console.log(`[${requestId}] Attempting to parse as inventory update`);            
        const parsedUpdates = await parseMultipleUpdates(cleanTranscript);
            if (Array.isArray(parsedUpdates) && parsedUpdates.length > 0) {
        console.log(`[${requestId}] Parsed ${parsedUpdates.length} updates from voice message`);
        
        // Process the updates
        const results = await updateMultipleInventory(shopId, parsedUpdates, detectedLanguage);
        
        
// Send results (INLINE-CONFIRM aware; single message)
          const processed = results.filter(r => !r.needsPrice && !r.needsUserInput && !r.awaiting);
                  
          // --- Single-sale confirmation (voice): send ONE crisp message and return ---
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
                  // try common fields in your result object for per-unit price:
                  pricePerUnit: x.rate ?? x.salePrice ?? x.price ?? null,
                  newQuantity: x.newQuantity
                }
              );
              return;
            }

          const header = chooseHeader(processed.length, COMPACT_MODE, /*isPrice*/ false);
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

          message += `\n✅ Successfully updated ${successCount} of ${processed.length} items`;
          const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
          await sendMessageViaAPI(From, formattedResponse);
       return;
      }
    } catch (error) {
      console.warn(`[${requestId}] Failed to parse as inventory update:`, error.message);
    }
    
    // Only if not an inventory update, try quick queries
    try {
      const normalized = await normalizeCommandText(cleanTranscript, detectedLanguage, requestId + ':normalize');
      const handled = await routeQuickQueryRaw(normalized, From, detectedLanguage, requestId);
      if (handled) return; // reply already sent
    } catch (e) {
      console.warn(`[${requestId}] Quick-query (voice) normalization failed, falling back.`, e?.message);
    }
    
    // Check if we're awaiting batch selection
    if (conversationState && conversationState.state === 'awaiting_batch_selection') {
      console.log(`[${requestId}] Awaiting batch selection response from voice`);
      // Check if the transcript contains batch selection keywords
      if (isBatchSelectionResponse(cleanTranscript)) {
        // Send follow-up message via Twilio API
        const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
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
    const CONFIDENCE_THRESHOLD = 0.8;
    if (confidence < CONFIDENCE_THRESHOLD) {
      console.log(`[${requestId}] [5.5] Low confidence (${confidence}), requesting confirmation...`);
      
      // FIX: Set confirmation state before sending the request
      await setUserState(From, 'confirmation', {
        pendingTranscript: cleanTranscript,
        detectedLanguage,
        confidence,
        type: 'voice_confirmation'
      });
      
      // Send confirmation request via Twilio API
      const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
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
      return;
    } else {
      console.log(`[${requestId}] [5.5] High confidence (${confidence}), proceeding without confirmation...`);
      
      try {
                
        // Parse the transcript
            const updates = await parseMultipleUpdates(cleanTranscript);
            // Check if any updates are for unknown products (guard against null)
            const unknownProducts = Array.isArray(updates) ? updates.filter(u => !u.isKnown) : [];

        if (unknownProducts.length > 0) {
          console.log(`[${requestId}] Found ${unknownProducts.length} unknown products, requesting confirmation`);
          
          // FIX: Set confirmation state before sending the request
          await setUserState(From, 'confirmation', {
            pendingTranscript: cleanTranscript,
            detectedLanguage,
            confidence: 1.0, // High confidence since we're confirming product
            type: 'product_confirmation',
            unknownProducts
          });
          
          // Confirm the first unknown product via Twilio API
          const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
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
          return;
        }
        
        // Process the transcription and send result via Twilio API
        const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
        
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
        const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
        await client.messages.create({
          body: 'Sorry, I had trouble processing your voice message. Please try again.',
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: From
        });
      }
    }
  } catch (error) {
    console.error(`[${requestId}] Error processing voice message:`, error);
    
    // Send error message via Twilio API
    const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
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
    
    // === FRONT-DOOR SUMMARY GUARD (text path) ===
    const intentAtEntry = resolveSummaryIntent(Body);
    if (intentAtEntry === 'short summary') {
      const shopId = From.replace('whatsapp:', '');
      const msg = await generateInstantSummary(shopId, conversationState?.language || 'en', requestId);
      await sendMessageViaAPI(From, msg);
      return;
    }
    if (intentAtEntry === 'full summary') {
      const shopId = From.replace('whatsapp:', '');
      await processShopSummary(shopId); // sends itself (now Nativeglish via dailySummary.js patch)
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
      const shopId = From.replace('whatsapp:', '');
      const saveResult = await saveCorrectionState(shopId, correctionType, pending.update, pending.detectedLanguage);
      
      if (saveResult.success) {
        console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id}`);
        
        // FIX: Set correction state
        await setUserState(From, 'correction', {
          correctionState: {
            correctionType,
            pendingUpdate: pending.update,
            detectedLanguage: pending.detectedLanguage,
            id: saveResult.id
          }
        });
      }
      
      // Send correction message via API
      const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
      await client.messages.create({
        body: correctionMessage,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: From
      });
      
      return;
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
        const shopId = From.replace('whatsapp:', '');
        await saveUserPreference(shopId, greetingLang);
        console.log(`[${requestId}] Saved language preference: ${greetingLang} for user ${shopId}`);
        
        // FIX: Set greeting state
        await setUserState(From, 'greeting', { greetingLang });
        
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
          const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
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
        const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
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
    let detectedLanguage = conversationState ? conversationState.language : 'en';
    detectedLanguage = await checkAndUpdateLanguage(Body, From, detectedLanguage, requestId);
    console.log(`[${requestId}] Detected language for text update: ${detectedLanguage}`);
        
    // ===== EARLY EXIT: AI orchestrator decides before any inventory parse =====
      try {
        const orch = await applyAIOrchestration(Body, From, detectedLanguage, requestId);                  
        // --- BEGIN TEXT HANDLER INSERT ---
        /* TEXT_HANDLER_PATCH */
        try {
          if (orch?.normalizedCommand) {
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

        // Question → answer & exit
        if (orch.isQuestion === true || orch.kind === 'question') {
          handledRequests.add(requestId);
          const shopId = From.replace('whatsapp:', '');
          const ans  = await composeAISalesAnswer(shopId, Body, langExact);
          const msg0 = await tx(ans, langExact, From, Body, `${requestId}::sales-qa-text`);
          const msg  = nativeglishWrap(msg0, langExact);
          await sendMessageViaAPI(From, msg);
          try {
              const isActivated = await isUserActivated(shopId);
              const buttonLang = langPinned.includes('-latn') ? langPinned.split('-')[0] : langPinned;
              await sendSalesQAButtons(From, buttonLang, isActivated);
            } catch (e) {
              console.warn(`[${requestId}] qa-buttons send failed:`, e?.message);
            }
          return;
        }
        // Read‑only normalized command → route & exit
        if (orch.normalizedCommand) {
          handledRequests.add(requestId);
          await handleQuickQueryEN(orch.normalizedCommand, From, langExact, `${requestId}::ai-norm-text`);
          return;
        }
      } catch (e) {
        console.warn(`[${requestId}] orchestrator early-exit error:`, e?.message);
        // fall through gracefully
      }
      console.log(`[${requestId}] Attempting to parse as inventory update`);
    
    
    // First, try to parse as inventory update (higher priority)
      const parsedUpdates = parseMultipleUpdates(Body); // <— pass text, not req
      if (Array.isArray(parsedUpdates) && parsedUpdates.length > 0) {
      console.log(`[${requestId}] Parsed ${parsedUpdates.length} updates from text message`);
      
      // Process inventory updates here
      const shopId = From.replace('whatsapp:', '');
      const results = await updateMultipleInventory(shopId, parsedUpdates, detectedLanguage);
      
      
// Send results (INLINE-CONFIRM aware; single message)
        const processed = results.filter(r => !r.needsPrice && !r.needsUserInput && !r.awaiting);
              
      // --- Single-sale confirmation (text #1): send ONE crisp message and return -
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

        message += `\n✅ Successfully updated ${successCount} of ${processed.length} items`;
        const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
        await sendMessageViaAPI(From, formattedResponse);
     return;
    } else {
      console.log(`[${requestId}] Not a valid inventory update, checking for specialized operations`);
      
      // Only if not an inventory update, try quick queries
      try {
        const normalized = await normalizeCommandText(Body, detectedLanguage, requestId + ':normalize');
        const handledQuick = await routeQuickQueryRaw(normalized, From, detectedLanguage, requestId);
        if (handledQuick) {
          return; // reply already sent via API
        }
      } catch (e) {
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
      await setUserState(From, 'confirmation', {
        pendingTranscript: Body,
        detectedLanguage,
        confidence: 1.0, // High confidence since we're confirming product
        type: 'product_confirmation',
        unknownProducts
      });
      
      // Confirm the first unknown product
      const confirmationResponse = await confirmProduct(unknownProducts[0], From, detectedLanguage, requestId);
      
      // Send via Twilio API
      const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
      
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
    
    const translatedMessage = await t(defaultMessage, detectedLanguage, requestId);
    
    // Send via Twilio API
    await sendMessageViaAPI(From, translatedMessage);
    
  } catch (error) {
    console.error(`[${requestId}] Error processing text message:`, error);
    // Send error message via Twilio API        
    // STEP 6: global tail/apology guard — if a response was already sent, skip
    try { if (handledRequests.has(requestId)) return; } catch (_) {}
    const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
    await client.messages.create({
      body: 'Sorry, I had trouble processing your message. Please try again.',
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: From
    });
  }
}


// Main module exports
module.exports = async (req, res) => {
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

  // (optional) quick log to confirm gate path in prod logs
    try { console.log('[webhook]', { From, Body: String(Body).slice(0,120) }); } catch(_) {}
      
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

  // Language detection (also persists preference)
  const detectedLanguage = await detectLanguageWithFallback(Body, From, requestId);  
      
  // ===== EARLY EXIT: AI orchestrator decides before any inventory parse =====
   try {
     const orch = await applyAIOrchestration(Body, From, detectedLanguage, requestId);
       let langPinned = String(orch.language ?? detectedLanguage ?? 'en').toLowerCase();        
    // Prefer the detector's script variant (e.g., hi-latn) when available
      if (/^-?latn$/i.test(String(detectedLanguage).split('-')[1]) && !String(langPinned).includes('-latn')) {
        langPinned = String(detectedLanguage).toLowerCase(); // e.g., 'hi-latn'
      }
       // Question → answer & exit
       if (orch.isQuestion === true || orch.kind === 'question') {
         handledRequests.add(requestId);
         const shopId = String(From).replace('whatsapp:', '');
         const ans = await composeAISalesAnswer(shopId, Body, langPinned);
         const msg0 = await tx(ans, langPinned, From, Body, `${requestId}::sales-qa`);
         const msg  = nativeglishWrap(msg0, langPinned);
         await sendMessageQueued(From, msg);                
         try {
                  const isActivated = await isUserActivated(shopId);
                  const buttonLang = langPinned.includes('-latn') ? langPinned.split('-')[0] : langPinned;
                  await sendSalesQAButtons(From, buttonLang, isActivated);
                } catch (e) {
                  console.warn(`[${requestId}] qa-buttons send failed:`, e?.message);
                }
         // minimal TwiML ack
         const twiml = new twilio.twiml.MessagingResponse();
         twiml.message('');
         res.type('text/xml');
         resp.safeSend(200, twiml.toString());
         safeTrackResponseTime(requestStart, requestId);
         return;
       }
       // Read‑only normalized command → route & exit
       if (orch.normalizedCommand) {
         handledRequests.add(requestId);
         await handleQuickQueryEN(orch.normalizedCommand, From, langPinned, `${requestId}::ai-norm`);
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
      await safeSendParseError(From, detectedLanguage, requestId);           
      // minimal TwiML ack (single-response guard)
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('');
      res.type('text/xml');
      resp.safeSend(200, twiml.toString());
      safeTrackResponseTime(requestStart, requestId);
      return;
    }
  }); // <- tips auto-stop here even on early returns
};



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
    const shopId = From.replace('whatsapp:', '');
        
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
          const generatingMessage = await t(
            'Generating your detailed summary with insights... This may take a moment.',
            userLanguage,
            requestId
          );
          await sendMessageViaAPI(From, generatingMessage);
          const fullSummary = await generateFullScaleSummary(shopId, userLanguage, requestId);
          await sendMessageViaAPI(From, fullSummary);
          res.send('<Response></Response>');
          return;
          
        // Add more button cases as needed
        default:
          console.warn(`[${requestId}] Unhandled button text: "${ButtonText}"`);
          // Send a response for unhandled buttons
          const unhandledMessage = await t(
            'I didn\'t understand that button selection. Please try again.',
            userLanguage,
            requestId
          );
          await sendMessageViaAPI(From, unhandledMessage);
          res.send('<Response></Response>');
          return;
      }
    }
    
    // STATE-AWARE PROCESSING START
    // ============================
    
    // 1. Handle explicit reset commands FIRST (highest priority)
    if (isResetMessage(Body)) {
      console.log(`[${requestId}] Explicit reset command detected: "${Body}"`);
      
      // Clear ALL states
      await clearUserState(From);
      if (globalState.conversationState && globalState.conversationState[From]) {
        delete globalState.conversationState[From];
      }
      if (globalState.pendingProductUpdates && globalState.pendingProductUpdates[From]) {
        delete globalState.pendingProductUpdates[From];
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
        'Flow has been reset. How would you like to send your inventory update?',
        detectedLanguage,
        requestId
      );
      
      await sendMessageViaAPI(From, resetMessage);
      res.send('<Response></Response>');
      return;
    }
    
    // 2. Get current user state        
    console.log(`[${requestId}] Checking state for ${From} in database...`);
      // Use the DB-backed helper; avoids ReferenceError and aligns with other state calls            
      const currentState = (typeof getUserStateFromDB === 'function')
          ? await getUserStateFromDB(From)
          : await getUserState(From); // fallback to shim if needed
    console.log(`[${requestId}] Current state for ${From}:`, currentState ? currentState.mode : 'none');
    
    // 3. Handle based on current state
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
  const shopId = from.replace('whatsapp:', '');
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
  
  const shopId = From.replace('whatsapp:', '');
  const correctionState = state.data.correctionState;
  
  // Check if user is trying to exit correction mode
  if (Body && ['exit', 'cancel', 'reset', 'start over'].some(cmd => Body.toLowerCase().includes(cmd))) {
    console.log(`[${requestId}] User exiting correction mode`);
    
    // Clear correction state
    await deleteCorrectionState(correctionState.id);
    await clearUserState(From);
    
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
    await clearUserState(From);
  
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
        await setUserState(From, 'correction', {
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
        const quantityUpdate = await parseMultipleUpdates(fakeReq);
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
      const fullUpdate = await parseMultipleUpdates(fakeReq);
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
      await setUserState(From, 'confirmation', {
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
          await clearUserState(From);
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
      await sendMessageViaAPI(From, formattedResponse);
    
    // Clean up
    await deleteCorrectionState(originalCorrectionId);
    await clearUserState(From);
    
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
    await setUserState(From, 'correction', {
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
          await setUserState(From, 'correction', {
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
        await sendMessageViaAPI(From, formattedResponse);
    
    // Clear state after processing
    await clearUserState(From);
  } catch (error) {
    console.error(`[${requestId}] Error processing inventory updates:`, error.message);
    
    // If processing fails, try to parse the input again and enter correction flow
    try {
      const parsedUpdates = await parseMultipleUpdates(req);
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
        await setUserState(From, 'correction', {
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
  const shopId = From.replace('whatsapp:', '');

 // Check if user already has a plan assigned
  const planInfo = await getUserPlan(shopId);
  
  // If no plan assigned, assign appropriate plan
  if (!planInfo.plan || planInfo.plan === 'free_demo') {
    // Check if this shop qualifies for first 50 plan
    const isFirst50 = await isFirst50Shops(shopId);
    
    let plan = 'demo';
    let trialEndDate = null;
    
    if (isFirst50) {
      plan = 'demo';
      // Set trial end date to 14 days from now
      trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 14);
    }
    
    // Save the plan
    await saveUserPlan(shopId, plan, trialEndDate);
    
    console.log(`Assigned plan: ${plan} to shop ${shopId}`);
  }
  
   // ✅ Get user's language preference for personalized processing message
  let userLanguage = 'en';
  try {
    const userPref = await getUserPreference(shopId);
    if (userPref.success) {
      userLanguage = userPref.language;
    }
  } catch (error) {
    console.warn(`[${requestId}] Failed to get user preference:`, error.message);
  }
  
  // ✅ Send immediate "Processing..." response in user's language
  try {
    // Create processing message in native script + Roman transliteration
    const processingMessages = {
      'hi': `आपके संदेश को संसाधित किया जा रहा है...`,
      'bn': `আপনার বার্তা প্রক্রিয়া করা হচ্ছে...`,
      'ta': `உங்கள் செய்தி செயலாக்கப்படுகிறது...`,
      'te': `మీ సందేశం ప్రాసెస్ అవుతోంది...`,
      'kn': `ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಪ್ರಕ್ರಿಯೆಗೊಳಿಸಲಾಗುತ್ತಿದೆ...`,
      'gu': `તમારા સંદેશને પ્રક્રિયા કરવામાં આવે છે...`,
      'mr': `तुमचा संदेश प्रक्रिया केला जात आहे...`,
      'en': `Processing your message...`  // ✅ Only once for English
    };
    
    const processingMessage = processingMessages[userLanguage] || processingMessages['en'];
    
    await sendMessageViaAPI(From, processingMessage);
    
    // ✅ Add 2-second delay before actual processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
  } catch (error) {
    console.warn(`[${requestId}] Failed to send processing message:`, error.message);
  }

  
// NEW ✅: Detect language for this message; use it for command handlers & replies
  let detectedLanguage = userLanguage || 'en';
  try {
    detectedLanguage = await checkAndUpdateLanguage(Body || '', From, userLanguage, requestId);
  } catch (e) {
    console.warn(
      `[${requestId}] Language detection failed, defaulting to ${detectedLanguage}:`,
      e.message
    );
  }
  console.log(`[${requestId}] Using detectedLanguage=${detectedLanguage} for new interaction`);

  // Add state check for price updates before the numeric check
    const currentState = await getUserState(From);
    if (currentState && currentState.mode === 'correction' && 
        currentState.data.correctionState.correctionType === 'price') {
      try {
        const csRes = await getCorrectionState(shopId);
        if (csRes && csRes.success && csRes.correctionState
            && csRes.correctionState.correctionType === 'price') {
          const priceValue = parseFloat(Body.trim());
          if (!Number.isNaN(priceValue) && priceValue > 0) {
            // pendingUpdate can be an object or a JSON string - normalize it
            let pendingUpdate = csRes.correctionState.pendingUpdate;
            if (typeof pendingUpdate === 'string') {
              try { pendingUpdate = JSON.parse(pendingUpdate); } catch (_) {}
            }
            // apply the price and process
            const detectedLanguage = csRes.correctionState.detectedLanguage || userLanguage || 'en';
            const updated = { ...pendingUpdate, price: priceValue };
            const results = await updateMultipleInventory(shopId, [updated], detectedLanguage);
    
            // clean up the correction record and any stale user state
            try { await deleteCorrectionState(csRes.correctionState.id); } catch (_) {}
            try { await clearUserState(From); } catch (_) {}
    
            // Build a short success/failure response
            let msg = '✅ Update processed:\n\n';
            const ok = results[0] && results[0].success;
            if (ok) {
              const r = results[0];
              const unitText = r.unit ? ` ${r.unit}` : '';
              msg += `• ${r.product}: ${r.quantity}${unitText} ${r.action} (Stock: ${r.newQuantity}${unitText})`;
            } else {
              msg += `• ${updated.product}: Error - ${results[0]?.error || 'Unknown error'}`;
            }
            const formatted = await t(msg, detectedLanguage, requestId);
            await sendMessageViaAPI(From, formatted);
            res.send('<Response></Response>');
            return;
          }
        }
      } catch (e) {
        console.warn(`[${requestId}] Price state handling failed:`, e.message);
        // continue with normal flow if handling failed
      }
    }

  // --- Fallback: numeric-only message treated as a price reply if a price correction exists ---
   if (Body && /^\s*\d+(?:\.\d+)?\s*$/.test(Body)) {
     try {
       const csRes = await getCorrectionState(shopId);
       if (csRes && csRes.success && csRes.correctionState
           && csRes.correctionState.correctionType === 'price') {
         const priceValue = parseFloat(Body.trim());
         if (!Number.isNaN(priceValue) && priceValue > 0) {
           // pendingUpdate can be an object or a JSON string - normalize it
           let pendingUpdate = csRes.correctionState.pendingUpdate;
           if (typeof pendingUpdate === 'string') {
             try { pendingUpdate = JSON.parse(pendingUpdate); } catch (_) {}
           }
           // apply the price and process
           const detectedLanguage = csRes.correctionState.detectedLanguage || userLanguage || 'en';
           const updated = { ...pendingUpdate, price: priceValue };
           const results = await updateMultipleInventory(shopId, [updated], detectedLanguage);
   
           // clean up the correction record and any stale user state
           try { await deleteCorrectionState(csRes.correctionState.id); } catch (_) {}
           try { await clearUserState(From); } catch (_) {}
   
           // Build a short success/failure response (no need to over-message)
           let msg = '✅ Update processed:\n\n';
           const ok = results[0] && results[0].success;
           if (ok) {
             const r = results[0];
             const unitText = r.unit ? ` ${r.unit}` : '';
             msg += `• ${r.product}: ${r.quantity}${unitText} ${r.action} (Stock: ${r.newQuantity}${unitText})`;
           } else {
             msg += `• ${updated.product}: Error - ${results[0]?.error || 'Unknown error'}`;
           }
           const formatted = await t(msg, detectedLanguage, requestId);
           await sendMessageViaAPI(From, formatted);
           res.send('<Response></Response>');
           return;
         }
       }
     } catch (e) {
       console.warn(`[${requestId}] Numeric price fallback failed:`, e.message);
       // continue with normal flow if fallback didn’t match
     }
   }

  // NEW ✅: Handle the "update price ..." command EARLY and safely pass detectedLanguage
  if (Body && /^\s*(update\s+price|price\s+update)\b/i.test(Body)) {
    try {
      // Assumes you already computed `detectedLanguage` earlier in this function.
      // If not, see “Heads‑up” below.
      await handlePriceUpdate(Body, From, detectedLanguage, requestId);
      // Prevent fall-through / double responses
      return res.send('<Response></Response>');
    } catch (err) {
      console.error(`[${requestId}] Error in handlePriceUpdate:`, err.message);
      const msg = await t(
        'System error. Please try again with a clear message.',
        detectedLanguage || 'en',
        requestId
      );
      await sendMessageViaAPI(From, msg);
      return res.send('<Response></Response>');
    }
  }

  
  // Check for greetings
  if (Body) {
    const greetingLang = detectGreetingLanguage(Body);
    if (greetingLang) {
      console.log(`[${requestId}] Detected greeting in language: ${greetingLang}`);
      
      // Save user preference
      const shopId = From.replace('whatsapp:', '');
      await saveUserPreference(shopId, greetingLang);
      
      
      // Send INTERACTIVE welcome (Quick‑Reply + List‑Picker) using ContentSid templates
            // Keep the rest of the function's behavior unchanged.
            await sendWelcomeFlowLocalized(From, greetingLang, requestId);
            // Minimal TwiML ack so Twilio is satisfied; avoid double text sends downstream.
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
  
  // Handle voice messages
  if (NumMedia && MediaUrl0 && (NumMedia !== '0' && NumMedia !== 0)) {
    // Process voice asynchronously
    res.send('<Response><Message>Processing your voice message...</Message></Response>');
    processVoiceMessageAsync(MediaUrl0, From, requestId, null)
      .catch(error => {
        console.error(`[${requestId}] Error in async voice processing:`, error);
      });
    return;
  }
  
      // Handle text messages
      if (Body) {
                
        // ===== EARLY EXIT: AI orchestrator before any inventory parse =====
            try {
              const orch = await applyAIOrchestration(Body, From, detectedLanguage, requestId);
              const langExact = ensureLangExact(orch.language ?? detectedLanguage ?? 'en');
              // Question → answer & exit
              if (orch.isQuestion === true || orch.kind === 'question') {
                handledRequests.add(requestId);
                const ans  = await composeAISalesAnswer(shopId, Body, langExact);
                const msg0 = await tx(ans, langExact, From, Body, `${requestId}::sales-qa-text`);
                const msg  = nativeglishWrap(msg0, langExact);
                await sendMessageViaAPI(From, msg);
                try {
                  const isActivated = await isUserActivated(shopId);
                  const buttonLang = langPinned.includes('-latn') ? langPinned.split('-')[0] : langPinned;
                  await sendSalesQAButtons(From, buttonLang, isActivated);
                } catch (e) {
                  console.warn(`[${requestId}] qa-buttons send failed:`, e?.message);
                }
                return res.send('<Response></Response>');
              }
              // Read‑only normalized command → route & exit
              if (orch.normalizedCommand) {
                handledRequests.add(requestId);
                await handleQuickQueryEN(orch.normalizedCommand, From, langExact, `${requestId}::ai-norm-text`);
                return res.send('<Response></Response>');
              }
            } catch (e) {
              console.warn(`[${requestId}] orchestrator early-exit error:`, e?.message);
              // fall through gracefully
            }
        console.log(`[${requestId}] Attempting to parse as inventory update`);
                
        // First, try to parse as inventory update (higher priority)
            const parsedUpdates = parseMultipleUpdates(Body); // pass text, not request
            if (Array.isArray(parsedUpdates) && parsedUpdates.length > 0) {
          console.log(`[${requestId}] Parsed ${parsedUpdates.length} updates from text message`);
          
          // Process the updates
          const shopId = From.replace('whatsapp:', '');
          const results = await updateMultipleInventory(shopId, parsedUpdates, detectedLanguage);
          
          
          // Send results (INLINE-CONFIRM aware; single message)
            const processed = results.filter(r => !r.needsPrice && !r.needsUserInput && !r.awaiting);
                        
            // --- Single-sale confirmation (text #1): send ONE crisp message and return -
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
            await sendMessageViaAPI(From, formattedResponse);

          return res.send('<Response></Response>');
        } else {
          console.log(`[${requestId}] Not a valid inventory update, checking for specialized operations`);
          
          // Only if not an inventory update, try quick queries
          try {
            const normalized = await normalizeCommandText(Body, detectedLanguage, requestId + ':normalize');
            const handledQuick = await routeQuickQueryRaw(normalized, From, detectedLanguage, requestId);
            if (handledQuick) {
              return res.send('<Response></Response>'); // reply already sent via API
            }
          } catch (e) {
            console.warn(`[${requestId}] Quick-query (normalize) routing failed; continuing.`, e?.message);
          }
        }
  
        // Check for price management commands
        const lowerBody = Body.toLowerCase();
        
        if (lowerBody.includes('update price')) {
          await handlePriceUpdate(Body, From, detectedLanguage, requestId);
          return;
        }
        
        if (lowerBody.includes('price list') || lowerBody.includes('prices')) {
          await sendPriceList(From, detectedLanguage, requestId);
          return;
        }
        
                
        // Try to parse as inventory update
          const updates = parseMultipleUpdates(Body);
          if (Array.isArray(updates) && updates.length > 0) {
          console.log(`[${requestId}] Parsed ${updates.length} updates from text message`);
          const shopId = From.replace('whatsapp:', '');
          
          // Set user state to inventory mode
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
          
          await setUserState(From, 'inventory', { updates, detectedLanguage });
          
          // Process the updates
          const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
          // If every item is waiting for price, a prompt has already been sent.
              if (allPendingPrice(results)) {
                // Move user into 'correction' flow with price type so the next number goes to price handler.
                try {
                  await setUserState(From, 'correction', {
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

        message += `\n✅ Successfully updated ${successCount} of ${processed.length} items`

        const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
        await sendMessageViaAPI(From, formattedResponse);
      
      // Clear state after processing
      await clearUserState(From);
      
      res.send('<Response></Response>');
      return;
    }
  }

  // In handleNewInteraction function, add this before the default response:

// Handle summary commands
if (Body) {
  const lowerBody = Body.toLowerCase();
  
  // Check for summary commands
  if (lowerBody.includes('summary')) {
    console.log(`[${requestId}] Summary command detected: "${Body}"`);
    
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
    
    // Determine summary type
    if (lowerBody.includes('full')) {
      // Full summary
      // Flag to track if summary has been sent
      let summarySent = false;
      
      // Send initial "processing" message
      const generatingMessage = await t(
        '🔍 Generating your detailed summary with insights... This may take a moment.',
        userLanguage,
        requestId
      );
      await sendMessageViaAPI(From, generatingMessage);
      
      // Schedule fun facts only if summary hasn't been sent
      setTimeout(async () => {
        if (!summarySent) {
          const tip1 = await t(
            '💡 Tip: Products with expiry dates under 7 days are 3x more likely to go unsold. Consider bundling or discounting them! Detailed summary being generated...',
            userLanguage,
            requestId
          );
          await sendMessageViaAPI(From, tip1);
        }
      }, 10000);
      
      setTimeout(async () => {
        if (!summarySent) {
          const tip2 = await t(
            '📦 Did you know? Low-stock alerts help prevent missed sales. Check your inventory weekly! Generating your summary right away...',
            userLanguage,
            requestId
          );
          await sendMessageViaAPI(From, tip2);
        }
      }, 30000);
      
      // Generate and send full summary
      const fullSummary = await generateFullScaleSummary(shopId, userLanguage, requestId);
      summarySent = true;
      await sendMessageViaAPI(From, fullSummary);
      
    } else {
      // Instant summary
      const instantSummary = await generateInstantSummary(shopId, userLanguage, requestId);
      await sendMessageViaAPI(From, instantSummary);
    }
    
    res.send('<Response></Response>');
    return;
  }
}
  
  // Default response for unrecognized input
  const defaultMessage = await t(
    'Please send an inventory update like "10 Parle-G sold" or start with "Hello" for options.',
    'en',
    requestId
  );
  
  await sendMessageViaAPI(From, defaultMessage);
  res.send('<Response></Response>');
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
  const inventoryUpdates = await parseMultipleUpdates(Body);
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
              
    
// INLINE-CONFIRM aware single message
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

      message += `\n✅ Successfully updated ${successCount} of ${processed.length} items`
      
      const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
      await sendMessageViaAPI(From, formattedResponse);
    
    // Clear state after processing
    await clearUserState(From);
  } else {
    // If not a valid update, send help message
    const helpMessage = await t(
      `I didn't understand that. Please send an inventory update like "10 Parle-G sold".`,
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
      const updates = await parseMultipleUpdates(pendingTranscript);
      if (updates.length > 0) {
        
// Process the confirmed updates
          const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
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
          await sendMessageViaAPI(From, formattedResponse);
        
        // Clear state after processing
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
      const updates = await parseMultipleUpdates(pendingTranscript);
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
        await setUserState(From, 'correction', {
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
        await setUserState(From, 'correction', {
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
      const updates = await parseMultipleUpdates(pendingTranscript);     
      if (updates.length > 0) {
                // Process the confirmed updates
                const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
      
                // Consider only non-pending items for rendering & counts
                const processed = results.filter(r => !r.needsPrice && !r.needsUserInput && !r.awaiting);
                const header = chooseHeader(processed.length, COMPACT_MODE, /*isPrice*/ false);
                let message = header;
                let successCount = 0;
      
                for (const r of processed) {
                  // Prefer inlineConfirmText (buffered in updateMultipleInventory)
                  const rawLine = r.inlineConfirmText ? r.inlineConfirmText : formatResultLine(r, COMPACT_MODE,false);
                  if (!rawLine) continue;
      
                  // In Compact, ensure stock is shown once, if not already present
                  const needsStock = COMPACT_MODE
                    && r.newQuantity !== undefined
                    && !/\(Stock:/.test(rawLine);
                  const stockPart = needsStock
                    ? ` (Stock: ${r.newQuantity} ${r.unitAfter ?? r.unit ?? ''})`
                    : '';
      
                  message += `${rawLine}${stockPart}\n`;
                  if (r.success) successCount++;
                }
      
                // Tail line once, based on processed items only
                message += `\n✅ Successfully updated ${successCount} of ${processed.length} items`;
      
                const formattedResponse = await t(message.trim(), detectedLanguage, requestId);
                await sendMessageViaAPI(From, formattedResponse);
      
                // Clear state after processing
                await clearUserState(From);
              } else {
        // If parsing failed, ask to retry
        const errorMessage = await t(
          'Sorry, I couldn\'t parse your inventory update. Please try again with a clear message.',
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
    console.log(`[${requestId}] User rejected text update`);
    
    // Parse the transcript to get update details
    try {
      const updates = await parseMultipleUpdates(pendingTranscript);
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
        await setUserState(From, 'correction', {
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
        await setUserState(From, 'correction', {
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
      await sendMessageViaAPI(From, formattedResponse);
    
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
      await setUserState(From, 'correction', {
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
