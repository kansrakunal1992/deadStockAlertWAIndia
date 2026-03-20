// =============================================================================
// adoptionMessages.js — Saamagrii.AI Adoption Flow Message Templates
// Single source of truth for all 8 stages across 8 languages.
// Used by: whatsapp.js, billTrigger.js, trialEndingSummary.js
//
// LANGUAGES: en, hi, mr, gu, bn, ta, te, kn
// STAGES:
//   0 — Language selected (first message, <2 sec)
//   0b — 2-hour silent follow-up (if no first entry)
//   1b — Bill hook line (appended to every sale confirmation)
//   2 — Trial activation (quiet unlock)
//   3 — Evening nudge Day 1 (6:30pm IST)
//   4 — Morning brief Day 2 (8:30am IST) — uses real data, passed as params
//   5a — Shop name ask (after 2nd confirmed entry)
//   5b — Area ask (after name received)
//   5c — GSTIN ask (after area received)
//   7b — Bill sent confirmation (after PDF sent)
//   7c — Bill request when shop name not yet captured
//   8 — Trial ending summary (Day 3 evening, uses real data)
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Base language extractor — strips -latn variants, lowercases
// ---------------------------------------------------------------------------
function baseLang(langExact) {
  return String(langExact ?? 'en').toLowerCase().replace(/-latn$/, '').split(/[-_]/)[0];
}

// ---------------------------------------------------------------------------
// STAGE 0 — First message after language selection
// Formula: greeting → one instruction → bold example → voice signal
// Max 4 lines. No "assistant". No "app". No feature list.
// ---------------------------------------------------------------------------
const STAGE_0_PROMPTS = {
  hi: `नमस्ते! 👋\n\nबस बोलो — अभी जो बिका हो वो:\n\n🎤 *"10 Parle-G बिका"*\n\nVoice note भेजो या type करो। मैं save कर लूंगा।`,
  mr: `नमस्कार! 👋\n\nआत्ता काय विकलं ते सांगा:\n\n🎤 *"10 Parle-G विकलं"*\n\nVoice note किंवा type करा — मी save करतो.`,
  gu: `નમસ્તે! 👋\n\nહમણાં જ શું વેચ્યું તે કહો:\n\n🎤 *"10 Parle-G વેચ્યા"*\n\nVoice note મોકલો અથવા type કરો — હું save કરીશ.`,
  bn: `নমস্কার! 👋\n\nএখন কী বিক্রি হল সেটা বলুন:\n\n🎤 *"10 Parle-G বিক্রি"*\n\nVoice note পাঠান বা type করুন — আমি save করব।`,
  ta: `வணக்கம்! 👋\n\nஇப்போது என்ன விற்றீர்கள் என்று சொல்லுங்கள்:\n\n🎤 *"10 Parle-G விற்றது"*\n\nVoice note அனுப்புங்கள் அல்லது type செய்யுங்கள் — நான் save செய்கிறேன்.`,
  te: `నమస్కారం! 👋\n\nఇప్పుడు ఏం అమ్మారో చెప్పండి:\n\n🎤 *"10 Parle-G అమ్మాను"*\n\nVoice note పంపండి లేదా type చేయండి — నేను save చేస్తాను.`,
  kn: `ನಮಸ್ಕಾರ! 👋\n\nಈಗ ಏನು ಮಾರಿದಿರಿ ಅದನ್ನು ಹೇಳಿ:\n\n🎤 *"10 Parle-G ಮಾರಿದ್ದೇನೆ"*\n\nVoice note ಕಳಿಸಿ ಅಥವಾ type ಮಾಡಿ — ನಾನು save ಮಾಡುತ್ತೇನೆ.`,
  en: `Hello! 👋\n\nJust tell me what sold today:\n\n🎤 *"10 Parle-G sold"*\n\nVoice note or type — I'll save it instantly.`,
};

function getStage0Message(langExact) {
  return STAGE_0_PROMPTS[baseLang(langExact)] ?? STAGE_0_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 0b — 2-hour silent follow-up (sent once, daytime only, if no entry)
// Acknowledges they're busy. Smallest possible ask. "30 seconds" anchor.
// ---------------------------------------------------------------------------
const STAGE_0B_PROMPTS = {
  hi: `📦 दुकान busy होगी अभी।\n\nजब time मिले — बस एक चीज़ बोलो जो आज बिकी।\n🎤 30 seconds। बस।`,
  mr: `📦 दुकान busy असेल आत्ता.\n\nवेळ मिळाल्यावर — फक्त एक गोष्ट सांगा जी आज विकली.\n🎤 30 seconds. बस.`,
  gu: `📦 દુકાન busy હશે અત્યારે.\n\njab time mile — bes ek vastu bolo je aaj vechayi.\n🎤 30 seconds. bas.`,
  bn: `📦 দোকান এখন busy হবে।\n\nসময় পেলে — শুধু একটা জিনিস বলুন যা আজ বিক্রি হয়েছে।\n🎤 30 seconds। ব্যস।`,
  ta: `📦 கடை இப்போது busy-ஆக இருக்கும்.\n\nநேரம் கிடைக்கும்போது — இன்று என்ன விற்றது என்று ஒன்று சொல்லுங்கள்.\n🎤 30 seconds. அவ்வளவுதான்.`,
  te: `📦 షాప్ ఇప్పుడు busy గా ఉంటుంది.\n\nసమయం దొరికినప్పుడు — ఈరోజు ఒక్క వస్తువు అమ్మారో చెప్పండి.\n🎤 30 seconds. అంతే.`,
  kn: `📦 ಅಂಗಡಿ ಈಗ busy ಆಗಿರಬಹುದು.\n\nಸಮಯ ಸಿಕ್ಕಾಗ — ಇಂದು ಒಂದು ವಸ್ತು ಮಾರಿದ್ದರೆ ಹೇಳಿ.\n🎤 30 seconds. ಅಷ್ಟೇ.`,
  en: `📦 Shop must be busy right now.\n\nWhen you get a moment — just say one thing that sold today.\n🎤 30 seconds. That's all.`,
};

function getStage0bMessage(langExact) {
  return STAGE_0B_PROMPTS[baseLang(langExact)] ?? STAGE_0B_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 1b — Bill hook line (appended after every sale confirmation)
// Single line. Surfaces bill feature at the point of sale.
// ---------------------------------------------------------------------------
const STAGE_1B_BILL_HOOK = {
  hi: `📄 Customer को bill चाहिए? बोलो — *"bill"*`,
  mr: `📄 Customer ला bill हवा? सांगा — *"bill"*`,
  gu: `📄 Customer ને bill જોઈએ? કહો — *"bill"*`,
  bn: `📄 Customer-কে bill দিতে হবে? বলুন — *"bill"*`,
  ta: `📄 Customer-க்கு bill வேண்டுமா? சொல்லுங்கள் — *"bill"*`,
  te: `📄 Customer కి bill కావాలా? చెప్పండి — *"bill"*`,
  kn: `📄 Customer ಗೆ bill ಬೇಕಾ? ಹೇಳಿ — *"bill"*`,
  en: `📄 Need a bill for the customer? Say — *"bill"*`,
};

function getStage1bBillHook(langExact) {
  return STAGE_1B_BILL_HOOK[baseLang(langExact)] ?? STAGE_1B_BILL_HOOK.en;
}

// ---------------------------------------------------------------------------
// STAGE 2 — Trial activation (quiet unlock)
// NOT an announcement. Tone: "ab aur bhi kar sakte ho"
// Shows 2 voice commands + udhaar (stickiest feature) + free tier reassurance.
// ---------------------------------------------------------------------------
const STAGE_2_PROMPTS = {
  hi: ({ days }) =>
    `${days} din ke liye sab kuch khul gaya. 🔓\n\nAb ye bhi try karo:\n🎤 *"Aaj kitna bika?"* — रोज़ का हिसाब\n🎤 *"Raju ko ₹200 udhaar diya"* — किसी का उधार याद रखो\n\nBasic stock entry हमेशा free रहेगी। ✅`,

  mr: ({ days }) =>
    `${days} दिवसांसाठी सगळं उघडलं. 🔓\n\nहे पण try करा:\n🎤 *"आज किती विकलं?"* — रोजचा हिशोब\n🎤 *"Raju ला ₹200 उधार दिला"* — कोणाचं उधार लक्षात ठेवा\n\nBasic stock entry नेहमी free राहील. ✅`,

  gu: ({ days }) =>
    `${days} divas mate badhu khulyu. 🔓\n\nAa pan try karo:\n🎤 *"Aaj ketlu vechayu?"* — rozno hisaab\n🎤 *"Raju ne ₹200 udhaar aapya"* — koynu udhaar yaad rakho\n\nBasic stock entry hamesha free raheshe. ✅`,

  bn: ({ days }) =>
    `${days} দিনের জন্য সব কিছু খুলে গেল. 🔓\n\nএগুলোও try করুন:\n🎤 *"আজ কতটুকু বিক্রি হল?"* — রোজকার হিসাব\n🎤 *"Raju কে ₹200 ধার দিলাম"* — কারও ধার মনে রাখুন\n\nBasic stock entry সবসময় free থাকবে. ✅`,

  ta: ({ days }) =>
    `${days} நாட்களுக்கு எல்லாம் திறந்தது. 🔓\n\nஇவற்றையும் try செய்யுங்கள்:\n🎤 *"இன்று எவ்வளவு விற்றது?"* — தினசரி கணக்கு\n🎤 *"Raju-க்கு ₹200 கடன் கொடுத்தேன்"* — யாரோ கடன் நினைவில் வையுங்கள்\n\nBasic stock entry எப்போதும் free. ✅`,

  te: ({ days }) =>
    `${days} రోజులకు అన్నీ తెరుచుకున్నాయి. 🔓\n\nఇవి కూడా try చేయండి:\n🎤 *"ఈరోజు ఎంత అమ్మారు?"* — రోజువారీ లెక్క\n🎤 *"Raju కి ₹200 అప్పు ఇచ్చాను"* — ఎవరి అప్పో గుర్తుంచుకోండి\n\nBasic stock entry ఎప్పుడూ free. ✅`,

  kn: ({ days }) =>
    `${days} ದಿನಗಳಿಗೆ ಎಲ್ಲವೂ ತೆರೆಯಿತು. 🔓\n\nಇವನ್ನೂ try ಮಾಡಿ:\n🎤 *"ಇಂದು ಎಷ್ಟು ಮಾರಿದ್ದೇನೆ?"* — ದಿನದ ಲೆಕ್ಕ\n🎤 *"Raju ಗೆ ₹200 ಸಾಲ ಕೊಟ್ಟಿದ್ದೇನೆ"* — ಯಾರದ್ದೋ ಸಾಲ ನೆನಪಿಡಿ\n\nBasic stock entry ಯಾವಾಗಲೂ free. ✅`,

  en: ({ days }) =>
    `Everything's unlocked for ${days} days. 🔓\n\nTry these too:\n🎤 *"How much sold today?"* — daily summary\n🎤 *"Raju owes ₹200"* — credit tracking\n\nBasic stock entry stays free forever. ✅`,
};

function getStage2Message(langExact, days = 3) {
  const lang = baseLang(langExact);
  const fn = STAGE_2_PROMPTS[lang] ?? STAGE_2_PROMPTS.en;
  return fn({ days });
}

// ---------------------------------------------------------------------------
// STAGE 3 — Evening nudge (6:30pm IST, Day 1)
// Vague input explicitly allowed. "30 seconds" anchor. No guilt.
// ---------------------------------------------------------------------------
const STAGE_3_PROMPTS = {
  hi: `📦 आज की दुकान कैसी रही?\n\nबस बोल दो — *"aaj 3 cheezein biki"*\nमैं hisaab लगा लूंगा। 🎤 30 seconds।`,
  mr: `📦 आज दुकान कशी झाली?\n\nफक्त सांगा — *"aaj 3 goshti vikli"*\nमी हिशोब लावतो. 🎤 30 seconds.`,
  gu: `📦 Aaj dukaan kaisi rahi?\n\nBas bolo — *"aaj 3 vastu vechai"*\nHu hisaab lagavish. 🎤 30 seconds.`,
  bn: `📦 আজ দোকান কেমন চলল?\n\nশুধু বলুন — *"aaj 3 jinish bikechhe"*\nআমি হিসাব করব. 🎤 30 seconds.`,
  ta: `📦 இன்று கடை எப்படி நடந்தது?\n\nசொல்லுங்கள் — *"இன்று 3 பொருட்கள் விற்றது"*\nநான் கணக்கு போடுகிறேன். 🎤 30 seconds.`,
  te: `📦 ఈరోజు షాప్ ఎలా జరిగింది?\n\nచెప్పండి — *"ఈరోజు 3 వస్తువులు అమ్మారు"*\nనేను లెక్క వేస్తాను. 🎤 30 seconds.`,
  kn: `📦 ಇಂದು ಅಂಗಡಿ ಹೇಗೆ ಹೋಯಿತು?\n\nಹೇಳಿ — *"ಇಂದು 3 ವಸ್ತುಗಳು ಮಾರಾಟವಾದವು"*\nನಾನು ಲೆಕ್ಕ ಹಾಕುತ್ತೇನೆ. 🎤 30 seconds.`,
  en: `📦 How did the shop go today?\n\nJust say — *"sold about 5 things"*\nI'll sort it out. 🎤 30 seconds.`,
};

function getStage3Message(langExact) {
  return STAGE_3_PROMPTS[baseLang(langExact)] ?? STAGE_3_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 4 — Morning brief (8:30am IST, Day 2+)
// Uses REAL data. Low-stock items first. Ends with reorder action prompt.
// params: { shopName, lowStockItems[{product, qty, unit}], salesTotal, lang }
// ---------------------------------------------------------------------------
function getStage4Message({ shopName, lowStockItems = [], salesTotal = 0, langExact = 'en' }) {
  const lang = baseLang(langExact);
  const name = shopName ? `, ${shopName}` : '';
  const salesStr = `₹${Number(salesTotal).toLocaleString('en-IN')}`;

  // Low stock lines — top 3 only to keep message tight
  const topLow = (lowStockItems ?? []).slice(0, 3);

  const REORDER_EXAMPLE = {
    hi: `🎤 बोलो — *"Parle-G 2 box aaya"*`,
    mr: `🎤 सांगा — *"Parle-G 2 box aale"*`,
    gu: `🎤 Bolo — *"Parle-G 2 box aavya"*`,
    bn: `🎤 বলুন — *"Parle-G 2 box esechhe"*`,
    ta: `🎤 சொல்லுங்கள் — *"Parle-G 2 box வந்தது"*`,
    te: `🎤 చెప్పండి — *"Parle-G 2 box వచ్చింది"*`,
    kn: `🎤 ಹೇಳಿ — *"Parle-G 2 box ಬಂತು"*`,
    en: `🎤 Say — *"Parle-G 2 boxes in"*`,
  };

  const HEADERS = {
    hi:  (n) => `☀️ कल का हिसाब${n}:`,
    mr:  (n) => `☀️ कालचा हिशोब${n}:`,
    gu:  (n) => `☀️ Kaleno hisaab${n}:`,
    bn:  (n) => `☀️ গতকালের হিসাব${n}:`,
    ta:  (n) => `☀️ நேற்றைய கணக்கு${n}:`,
    te:  (n) => `☀️ నిన్నటి లెక్క${n}:`,
    kn:  (n) => `☀️ ನಿನ್ನೆಯ ಲೆಕ್ಕ${n}:`,
    en:  (n) => `☀️ Yesterday's summary${n}:`,
  };

  const SALES_LINE = {
    hi:  (s) => `📊 कल की कमाई: ${s}`,
    mr:  (s) => `📊 कालची कमाई: ${s}`,
    gu:  (s) => `📊 Kaleni kamaani: ${s}`,
    bn:  (s) => `📊 গতকালের আয়: ${s}`,
    ta:  (s) => `📊 நேற்றைய வருவாய்: ${s}`,
    te:  (s) => `📊 నిన్న ఆదాయం: ${s}`,
    kn:  (s) => `📊 ನಿನ್ನೆಯ ಗಳಿಕೆ: ${s}`,
    en:  (s) => `📊 Yesterday's sales: ${s}`,
  };

  const REORDER_Q = {
    hi:  `\nआज क्या मंगाना है?`,
    mr:  `\nआज काय मागवायचे आहे?`,
    gu:  `\nAaj shu mangavanu chhe?`,
    bn:  `\nআজ কী অর্ডার করতে হবে?`,
    ta:  `\nஇன்று என்ன ஆர்டர் செய்ய வேண்டும்?`,
    te:  `\nఈరోజు ఏమి ఆర్డర్ చేయాలి?`,
    kn:  `\nಇಂದು ಏನು ಆರ್ಡರ್ ಮಾಡಬೇಕು?`,
    en:  `\nWhat are you ordering today?`,
  };

  const NO_DATA_NOTE = {
    hi:  `\n(यह आपका पहला दिन था — आज से real data आना शुरू होगा।)`,
    mr:  `\n(हा तुमचा पहिला दिवस होता — आजपासून real data येईल.)`,
    gu:  `\n(Aa tamaro pahelo divas hato — aajthee real data aavse.)`,
    bn:  `\n(এটা আপনার প্রথম দিন ছিল — আজ থেকে real data আসবে।)`,
    ta:  `\n(இது உங்கள் முதல் நாள் — இன்றிலிருந்து real data வரும்.)`,
    te:  `\n(ఇది మీ మొదటి రోజు — ఈరోజు నుండి real data వస్తుంది.)`,
    kn:  `\n(ಇದು ನಿಮ್ಮ ಮೊದಲ ದಿನ — ಇಂದಿನಿಂದ real data ಬರುತ್ತದೆ.)`,
    en:  `\n(That was your first day — real data starts from today.)`,
  };

  const header = (HEADERS[lang] ?? HEADERS.en)(name);
  const salesLine = (SALES_LINE[lang] ?? SALES_LINE.en)(salesStr);
  const reorderQ = REORDER_Q[lang] ?? REORDER_Q.en;
  const reorderEx = REORDER_EXAMPLE[lang] ?? REORDER_EXAMPLE.en;
  const noDataNote = NO_DATA_NOTE[lang] ?? NO_DATA_NOTE.en;

  const lines = [header, ''];

  if (topLow.length > 0) {
    for (const item of topLow) {
      lines.push(`📉 ${item.product}: ${item.qty} ${item.unit ?? ''} बचे`.trim());
    }
  }

  if (salesTotal > 0) {
    lines.push(salesLine);
  }

  if (topLow.length === 0 && salesTotal === 0) {
    lines.push(noDataNote.trim());
  }

  lines.push('');
  lines.push(reorderQ.trim());
  lines.push(reorderEx);

  return lines.filter(l => l !== null && l !== undefined).join('\n');
}

// ---------------------------------------------------------------------------
// STAGE 5a — Shop name ask (after 2nd confirmed entry)
// Frame: personalisation benefit (bill + entries will show shop name)
// ---------------------------------------------------------------------------
const STAGE_5A_PROMPTS = {
  hi: `एक बात — आपकी दुकान का नाम क्या है?\n\n(तो आपकी entries और bill पर नाम दिखेगा — जैसे "राम किराना स्टोर") 🏪`,
  mr: `एक गोष्ट — तुमच्या दुकानाचे नाव काय आहे?\n\n(तर तुमच्या entries आणि bill वर नाव दिसेल — जसे "Ram Kirana Store") 🏪`,
  gu: `Ek vaat — tamari dukaannu naam shu chhe?\n\n(To tamari entries ane bill par naam dekhase — jem ke "Ram Kirana Store") 🏪`,
  bn: `একটা কথা — আপনার দোকানের নাম কী?\n\n(তাহলে আপনার entries ও bill-এ নাম দেখাবে — যেমন "Ram Kirana Store") 🏪`,
  ta: `ஒரு விஷயம் — உங்கள் கடையின் பெயர் என்ன?\n\n(உங்கள் entries மற்றும் bill-ல் பெயர் காண்பிக்கும் — எ.கா. "Ram Kirana Store") 🏪`,
  te: `ఒక్క విషయం — మీ షాప్ పేరు ఏమిటి?\n\n(అప్పుడు మీ entries మరియు bill పై పేరు కనిపిస్తుంది — ఉదా. "Ram Kirana Store") 🏪`,
  kn: `ಒಂದು ವಿಷಯ — ನಿಮ್ಮ ಅಂಗಡಿಯ ಹೆಸರು ಏನು?\n\n(ನಿಮ್ಮ entries ಮತ್ತು bill ಮೇಲೆ ಹೆಸರು ಕಾಣಿಸಿಕೊಳ್ಳುತ್ತದೆ — ಉದಾ. "Ram Kirana Store") 🏪`,
  en: `One thing — what's your shop name?\n\n(So it shows on your entries and bills — like "Ram Kirana Store") 🏪`,
};

function getStage5aMessage(langExact) {
  return STAGE_5A_PROMPTS[baseLang(langExact)] ?? STAGE_5A_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 5b — Area ask (after name received)
// Frame: low-stock alerts arrive at the right time
// ---------------------------------------------------------------------------
const STAGE_5B_PROMPTS = {
  hi: `और आप कहाँ हैं? बस area बताओ।\n\n(कम stock का alert सही time पर आए इसलिए। 📍)`,
  mr: `आणि तुम्ही कुठे आहात? फक्त area सांगा.\n\n(कमी stock चा alert योग्य वेळी यावा म्हणून. 📍)`,
  gu: `Ane tame kyan chho? Bas area batavo.\n\n(Ochhaa stock no alert sahi time par aave te mate. 📍)`,
  bn: `আর আপনি কোথায়? শুধু area বলুন।\n\n(কম stock-এর alert সঠিক সময়ে আসুক তাই। 📍)`,
  ta: `நீங்கள் எங்கே இருக்கிறீர்கள்? Area மட்டும் சொல்லுங்கள்.\n\n(குறைந்த stock alert சரியான நேரத்தில் வர வேண்டும் என்பதால். 📍)`,
  te: `మీరు ఎక్కడ ఉన్నారు? Area మాత్రమే చెప్పండి.\n\n(తక్కువ stock alert సరైన సమయంలో రావడానికి. 📍)`,
  kn: `ನೀವು ಎಲ್ಲಿದ್ದೀರಿ? Area ಮಾತ್ರ ಹೇಳಿ.\n\n(ಕಡಿಮೆ stock alert ಸರಿಯಾದ ಸಮಯಕ್ಕೆ ಬರಲಿ ಎಂದು. 📍)`,
  en: `And where are you? Just tell me the area.\n\n(So low-stock alerts reach you at the right time. 📍)`,
};

function getStage5bMessage(langExact) {
  return STAGE_5B_PROMPTS[baseLang(langExact)] ?? STAGE_5B_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 5c — GSTIN ask (after area received — softest ask, skip prominent)
// Frame: customers get proper tax bills
// ---------------------------------------------------------------------------
const STAGE_5C_PROMPTS = {
  hi: `GSTIN है? तो customers को proper tax bill भेज सकते हो।\n\nनहीं है तो कोई बात नहीं — बस *"skip"* लिखो। ✅`,
  mr: `GSTIN आहे? तर customers ला proper tax bill पाठवता येईल.\n\nनसेल तर काही हरकत नाही — फक्त *"skip"* लिहा. ✅`,
  gu: `GSTIN chhe? To customers ne proper tax bill mokali shakasho.\n\nNathi to koi vaat nahi — bas *"skip"* lakho. ✅`,
  bn: `GSTIN আছে? তাহলে customers কে proper tax bill পাঠাতে পারবেন।\n\nনেই তো কোনো সমস্যা নেই — শুধু *"skip"* লিখুন। ✅`,
  ta: `GSTIN இருக்கிறதா? அப்படியென்றால் customers-க்கு proper tax bill அனுப்பலாம்.\n\nஇல்லையென்றால் பரவாயில்லை — *"skip"* என்று எழுதுங்கள். ✅`,
  te: `GSTIN ఉందా? అయితే customers కి proper tax bill పంపవచ్చు.\n\nలేకపోతే పర్వాలేదు — *"skip"* అని రాయండి. ✅`,
  kn: `GSTIN ಇದೆಯಾ? ಹಾಗಾದರೆ customers ಗೆ proper tax bill ಕಳಿಸಬಹುದು.\n\nಇಲ್ಲದಿದ್ದರೆ ಪರವಾಗಿಲ್ಲ — *"skip"* ಎಂದು ಬರೆಯಿರಿ. ✅`,
  en: `Got a GSTIN? Then customers can get proper tax bills.\n\nNo GSTIN? No problem — just type *"skip"*. ✅`,
};

function getStage5cMessage(langExact) {
  return STAGE_5C_PROMPTS[baseLang(langExact)] ?? STAGE_5C_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 7b — Bill sent confirmation
// After PDF has been sent. Two lines max.
// ---------------------------------------------------------------------------
const STAGE_7B_PROMPTS = {
  hi: `📄 Bill भेज दिया।\n\nCustomer को forward कर दो। ✅`,
  mr: `📄 Bill पाठवला.\n\nCustomer ला forward करा. ✅`,
  gu: `📄 Bill mokali didho.\n\nCustomer ne forward karo. ✅`,
  bn: `📄 Bill পাঠিয়ে দিলাম।\n\nCustomer কে forward করুন। ✅`,
  ta: `📄 Bill அனுப்பிவிட்டேன்.\n\nCustomer-க்கு forward செய்யுங்கள். ✅`,
  te: `📄 Bill పంపించాను.\n\nCustomer కి forward చేయండి. ✅`,
  kn: `📄 Bill ಕಳಿಸಿದ್ದೇನೆ.\n\nCustomer ಗೆ forward ಮಾಡಿ. ✅`,
  en: `📄 Bill sent.\n\nForward it to the customer. ✅`,
};

function getStage7bMessage(langExact) {
  return STAGE_7B_PROMPTS[baseLang(langExact)] ?? STAGE_7B_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 7c — Bill requested but shop name not yet captured
// Opportunity to capture shop name organically (customer is waiting for bill)
// ---------------------------------------------------------------------------
const STAGE_7C_PROMPTS = {
  hi: `📄 Bill बनाने के लिए — दुकान का नाम बताओ?\n\n(एक बार बताओ, हमेशा के लिए save।) 🏪`,
  mr: `📄 Bill बनवण्यासाठी — दुकानाचे नाव सांगा?\n\n(एकदा सांगा, कायमचे save.) 🏪`,
  gu: `📄 Bill banavaavaa maate — dukaannu naam batavo?\n\n(Ek vaar batavo, hamesha ne maate save.) 🏪`,
  bn: `📄 Bill বানাতে — দোকানের নাম বলুন?\n\n(একবার বললেই হবে, সবসময়ের জন্য save।) 🏪`,
  ta: `📄 Bill உருவாக்க — கடையின் பெயர் சொல்லுங்கள்?\n\n(ஒருமுறை சொன்னால் போதும், எப்போதும் save.) 🏪`,
  te: `📄 Bill తయారు చేయడానికి — షాప్ పేరు చెప్పండి?\n\n(ఒక్కసారి చెప్పండి, ఎప్పటికీ save.) 🏪`,
  kn: `📄 Bill ಮಾಡಲು — ಅಂಗಡಿಯ ಹೆಸರು ಹೇಳಿ?\n\n(ಒಂದು ಸಲ ಹೇಳಿದರಾಯಿತು, ಯಾವಾಗಲೂ save.) 🏪`,
  en: `📄 To make the bill — what's your shop name?\n\n(Tell me once, saved forever.) 🏪`,
};

function getStage7cMessage(langExact) {
  return STAGE_7C_PROMPTS[baseLang(langExact)] ?? STAGE_7C_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 8 — Trial ending summary (Day 3 evening)
// NOT a warning. A quiet summary of real value created + soft offer.
// params: { entriesCount, billsCount, udhaarEntries[{name, amount}], days, langExact }
// ---------------------------------------------------------------------------
function getStage8Message({ entriesCount = 0, billsCount = 0, udhaarEntries = [], days = 3, langExact = 'en' }) {
  const lang = baseLang(langExact);

  const HEADERS = {
    hi: `इन ${days} दिनों में:`,
    mr: `या ${days} दिवसांत:`,
    gu: `Aa ${days} divaso maa:`,
    bn: `এই ${days} দিনে:`,
    ta: `இந்த ${days} நாட்களில்:`,
    te: `ఈ ${days} రోజుల్లో:`,
    kn: `ಈ ${days} ದಿನಗಳಲ್ಲಿ:`,
    en: `In these ${days} days:`,
  };

  const ENTRY_LINE = {
    hi: (n) => `📦 ${n} entries save हुईं`,
    mr: (n) => `📦 ${n} entries save झाल्या`,
    gu: (n) => `📦 ${n} entries save thayi`,
    bn: (n) => `📦 ${n} entries save হয়েছে`,
    ta: (n) => `📦 ${n} entries save ஆனது`,
    te: (n) => `📦 ${n} entries save అయ్యాయి`,
    kn: (n) => `📦 ${n} entries save ಆದವು`,
    en: (n) => `📦 ${n} entries saved`,
  };

  const BILL_LINE = {
    hi: (n) => `📄 ${n} bills बने`,
    mr: (n) => `📄 ${n} bills बनले`,
    gu: (n) => `📄 ${n} bills banaya`,
    bn: (n) => `📄 ${n} bills তৈরি হয়েছে`,
    ta: (n) => `📄 ${n} bills உருவாயின`,
    te: (n) => `📄 ${n} bills తయారయ్యాయి`,
    kn: (n) => `📄 ${n} bills ಆದವು`,
    en: (n) => `📄 ${n} bills created`,
  };

  const UDHAAR_LINE = {
    hi: (name, amt) => `💰 ${name} का ₹${amt} udhaar record है`,
    mr: (name, amt) => `💰 ${name} चे ₹${amt} उधार record आहे`,
    gu: (name, amt) => `💰 ${name} nu ₹${amt} udhaar record chhe`,
    bn: (name, amt) => `💰 ${name} এর ₹${amt} ধার record আছে`,
    ta: (name, amt) => `💰 ${name} கடன் ₹${amt} record உள்ளது`,
    te: (name, amt) => `💰 ${name} అప్పు ₹${amt} record ఉంది`,
    kn: (name, amt) => `💰 ${name} ಸಾಲ ₹${amt} record ಇದೆ`,
    en: (name, amt) => `💰 ${name}'s ₹${amt} credit is on record`,
  };

  const FOOTER = {
    hi: `कल trial खत्म होगा। Free plan में stock entry जारी रहेगी।\nबाकी features — ₹299/month।\n\nअभी decide मत करो। कल तक सोचो।`,
    mr: `उद्या trial संपेल. Free plan मध्ये stock entry चालू राहील.\nबाकी features — ₹299/month.\n\nआत्ता decide करू नका. उद्यापर्यंत विचार करा.`,
    gu: `Kal trial khatam thashe. Free plan maa stock entry chalu raheshe.\nBakia features — ₹299/month.\n\nAbhi decide na karo. Kal sudhi vicharjo.`,
    bn: `কাল trial শেষ হবে। Free plan-এ stock entry চলতে থাকবে।\nবাকি features — ₹299/month।\n\nএখন decide করবেন না। কাল পর্যন্ত ভাবুন।`,
    ta: `நாளை trial முடியும். Free plan-ல் stock entry தொடரும்.\nமற்ற features — ₹299/month.\n\nஇப்போது decide செய்யாதீர்கள். நாளை வரை யோசியுங்கள்.`,
    te: `రేపు trial అయిపోతుంది. Free plan లో stock entry కొనసాగుతుంది.\nమిగతా features — ₹299/month.\n\nఇప్పుడు decide చేయకండి. రేపటి వరకు ఆలోచించండి.`,
    kn: `ನಾಳೆ trial ಮುಗಿಯುತ್ತದೆ. Free plan ನಲ್ಲಿ stock entry ಮುಂದುವರಿಯುತ್ತದೆ.\nಉಳಿದ features — ₹299/month.\n\nಈಗ decide ಮಾಡಬೇಡಿ. ನಾಳೆಯವರೆಗೆ ಯೋಚಿಸಿ.`,
    en: `Trial ends tomorrow. Stock entry stays free.\nOther features — ₹299/month.\n\nDon't decide now. Sleep on it.`,
  };

  const lines = [HEADERS[lang] ?? HEADERS.en, ''];

  if (entriesCount > 0) {
    lines.push((ENTRY_LINE[lang] ?? ENTRY_LINE.en)(entriesCount));
  }

  if (billsCount > 0) {
    lines.push((BILL_LINE[lang] ?? BILL_LINE.en)(billsCount));
  }

  // Show top udhaar entry by name if any (highest retention anchor)
  const topUdhaar = udhaarEntries.slice(0, 1)[0];
  if (topUdhaar) {
    lines.push((UDHAAR_LINE[lang] ?? UDHAAR_LINE.en)(topUdhaar.customer, topUdhaar.balance));
  }

  lines.push('');
  lines.push(FOOTER[lang] ?? FOOTER.en);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// BILL INTENT DETECTOR — used by billTrigger.js
// Returns true if the message is asking for a bill/receipt
// ---------------------------------------------------------------------------
const BILL_INTENT_PATTERNS = [
  /\b(bill|receipt|invoice|rasid|raseed|patta|parchi|tax\s*bill|bil)\b/i,
  /\b(bill\s*(chahiye|do|bhejo|banao|de\s*do|bana\s*do))\b/i,
  /\b(customer\s*(ko|ke\s*liye)\s*bill)\b/i,
  /\b(बिल|रसीद|पर्ची|टैक्स\s*बिल)\b/i,
  /\b(বিল|রসিদ)\b/i,
  /\b(bill\s*(joiye|apo|mokalo))\b/i,
  /\b(பில்|ரசீது)\b/i,
  /\b(బిల్|రసీదు)\b/i,
  /\b(ಬಿಲ್|ರಸೀದು)\b/i,
];

function isBillRequest(text) {
  const t = String(text ?? '').trim();
  return BILL_INTENT_PATTERNS.some(re => re.test(t));
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
module.exports = {
  baseLang,
  getStage0Message,
  getStage0bMessage,
  getStage1bBillHook,
  getStage2Message,
  getStage3Message,
  getStage4Message,
  getStage5aMessage,
  getStage5bMessage,
  getStage5cMessage,
  getStage7bMessage,
  getStage7cMessage,
  getStage8Message,
  isBillRequest,
};
