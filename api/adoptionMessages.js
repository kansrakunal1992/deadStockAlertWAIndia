// =============================================================================
// adoptionMessages.js — Saamagrii.AI Adoption Flow Message Templates
// Single source of truth for all 8 stages across 8 languages.
// Used by: whatsapp.js, billTrigger.js, trialEndingSummary.js
//
// LANGUAGES: en, hi, mr, gu, bn, ta, te, kn
// PRICING: ₹11/month for premium features
//
// SCRIPT POLICY — strictly enforced:
//   hi → pure Devanagari. No Latin words. Borrowed words transliterated.
//   mr → pure Devanagari (same policy as hi)
//   gu → pure Gujarati script
//   bn → pure Bengali script
//   ta → pure Tamil script
//   te → pure Telugu script
//   kn → pure Kannada script
//   en → English
//   Allowed exceptions across all languages:
//     • Product names that are always Latin (Parle-G, GSTIN)
//     • ₹ rupee symbol
//     • Arabic numerals (0-9)
//     • WhatsApp-specific command words in *bold* (bot trigger words)
// =============================================================================

'use strict';

function baseLang(langExact) {
  return String(langExact ?? 'en').toLowerCase().replace(/-latn$/, '').split(/[-_]/)[0];
}

// ---------------------------------------------------------------------------
// STAGE 0 — First message after language selection (<2 seconds)
// Formula: greeting → one instruction → bold example → voice signal. Max 4 lines.
// ---------------------------------------------------------------------------
const STAGE_0_PROMPTS = {
  hi: `नमस्ते! 👋\n\nबस बोलो — अभी जो बिका हो वो:\n\n🎤 *"10 Parle-G बिका"*\n\nवॉइस नोट भेजो या टाइप करो। मैं सेव कर लूंगा।`,
  mr: `नमस्कार! 👋\n\nआत्ता काय विकलं ते सांगा:\n\n🎤 *"10 Parle-G विकलं"*\n\nव्हॉइस नोट किंवा टाइप करा — मी सेव करतो.`,
  gu: `નમસ્તે! 👋\n\nહમણાં જ શું વેચ્યું તે કહો:\n\n🎤 *"10 Parle-G વેચ્યા"*\n\nવૉઇસ નોટ મોકલો અથવા ટાઇપ કરો — હું સેવ કરીશ.`,
  bn: `নমস্কার! 👋\n\nএখন কী বিক্রি হল সেটা বলুন:\n\n🎤 *"10 Parle-G বিক্রি"*\n\nভয়েস নোট পাঠান বা টাইপ করুন — আমি সেভ করব।`,
  ta: `வணக்கம்! 👋\n\nஇப்போது என்ன விற்றீர்கள் என்று சொல்லுங்கள்:\n\n🎤 *"10 Parle-G விற்றது"*\n\nவாய்ஸ் நோட் அனுப்புங்கள் அல்லது தட்டச்சு செய்யுங்கள் — நான் சேமிக்கிறேன்.`,
  te: `నమస్కారం! 👋\n\nఇప్పుడు ఏం అమ్మారో చెప్పండి:\n\n🎤 *"10 Parle-G అమ్మాను"*\n\nవాయిస్ నోట్ పంపండి లేదా టైప్ చేయండి — నేను సేవ్ చేస్తాను.`,
  kn: `ನಮಸ್ಕಾರ! 👋\n\nಈಗ ಏನು ಮಾರಿದಿರಿ ಅದನ್ನು ಹೇಳಿ:\n\n🎤 *"10 Parle-G ಮಾರಿದ್ದೇನೆ"*\n\nವಾಯ್ಸ್ ನೋಟ್ ಕಳಿಸಿ ಅಥವಾ ಟೈಪ್ ಮಾಡಿ — ನಾನು ಸೇವ್ ಮಾಡುತ್ತೇನೆ.`,
  en: `Hello! 👋\n\nJust tell me what sold today:\n\n🎤 *"10 Parle-G sold"*\n\nVoice note or type — I'll save it instantly.`,
};

function getStage0Message(langExact) {
  return STAGE_0_PROMPTS[baseLang(langExact)] ?? STAGE_0_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 0b — 2-hour silent follow-up (once, daytime only, if no first entry)
// ---------------------------------------------------------------------------
const STAGE_0B_PROMPTS = {
  hi: `📦 दुकान अभी व्यस्त होगी।\n\nजब समय मिले — बस एक चीज़ बोलो जो आज बिकी।\n🎤 ३० सेकंड। बस।`,
  mr: `📦 दुकान आत्ता व्यस्त असेल.\n\nवेळ मिळाल्यावर — फक्त एक गोष्ट सांगा जी आज विकली.\n🎤 ३० सेकंद. बस.`,
  gu: `📦 દુકાન અત્યારે વ્યસ્ત હશે.\n\nસમય મળે ત્યારે — આજ વેચ્યું એ એક વસ્તુ કહો.\n🎤 ૩૦ સેકન્ડ. બસ.`,
  bn: `📦 দোকান এখন ব্যস্ত হবে।\n\nসময় পেলে — শুধু একটা জিনিস বলুন যা আজ বিক্রি হয়েছে।\n🎤 ৩০ সেকেন্ড। ব্যস।`,
  ta: `📦 கடை இப்போது பிஸியாக இருக்கும்.\n\nநேரம் கிடைக்கும்போது — இன்று என்ன விற்றது என்று ஒன்று சொல்லுங்கள்.\n🎤 30 நொடி. அவ்வளவுதான்.`,
  te: `📦 షాప్ ఇప్పుడు బిజీగా ఉంటుంది.\n\nసమయం దొరికినప్పుడు — ఈరోజు ఒక్క వస్తువు అమ్మారో చెప్పండి.\n🎤 30 సెకన్లు. అంతే.`,
  kn: `📦 ಅಂಗಡಿ ಈಗ ಬ್ಯುಸಿ ಆಗಿರಬಹುದು.\n\nಸಮಯ ಸಿಕ್ಕಾಗ — ಇಂದು ಒಂದು ವಸ್ತು ಮಾರಿದ್ದರೆ ಹೇಳಿ.\n🎤 30 ಸೆಕೆಂಡ್. ಅಷ್ಟೇ.`,
  en: `📦 Shop must be busy right now.\n\nWhen you get a moment — just say one thing that sold today.\n🎤 30 seconds. That's all.`,
};

function getStage0bMessage(langExact) {
  return STAGE_0B_PROMPTS[baseLang(langExact)] ?? STAGE_0B_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 1b — Bill hook (appended after every sale confirmation)
// "बिल" is both Devanagari word and bot trigger — isBillRequest() matches both.
// ---------------------------------------------------------------------------
const STAGE_1B_BILL_HOOK = {
  hi: `📄 ग्राहक को बिल चाहिए? बोलो — *"बिल"*`,
  mr: `📄 ग्राहकाला बिल हवे? सांगा — *"बिल"*`,
  gu: `📄 ગ્રાહકને બિલ જોઈએ? કહો — *"બિલ"*`,
  bn: `📄 ক্রেতাকে বিল দিতে হবে? বলুন — *"বিল"*`,
  ta: `📄 வாடிக்கையாளருக்கு பில் வேண்டுமா? சொல்லுங்கள் — *"பில்"*`,
  te: `📄 కస్టమర్‌కి బిల్ కావాలా? చెప్పండి — *"బిల్"*`,
  kn: `📄 ಗ್ರಾಹಕರಿಗೆ ಬಿಲ್ ಬೇಕಾ? ಹೇಳಿ — *"ಬಿಲ್"*`,
  en: `📄 Need a bill for the customer? Say — *"bill"*`,
};

function getStage1bBillHook(langExact) {
  return STAGE_1B_BILL_HOOK[baseLang(langExact)] ?? STAGE_1B_BILL_HOOK.en;
}

// ---------------------------------------------------------------------------
// STAGE 2 — Trial activation (quiet unlock, not announcement)
// Tone: "ab aur bhi kar sakte ho". Udhaar example always included.
// ---------------------------------------------------------------------------
const STAGE_2_PROMPTS = {
  hi: ({ days }) =>
    `${days} दिनों के लिए सब कुछ खुल गया। 🔓\n\nअब यह भी आज़माओ:\n🎤 *"आज कितना बिका?"* — रोज़ का हिसाब\n🎤 *"राजू को ₹200 उधार दिया"* — किसी का उधार याद रखो\n\nबेसिक स्टॉक एंट्री हमेशा मुफ़्त रहेगी। ✅`,

  mr: ({ days }) =>
    `${days} दिवसांसाठी सगळं उघडलं. 🔓\n\nहे पण आज़मावा:\n🎤 *"आज किती विकलं?"* — रोजचा हिशोब\n🎤 *"राजूला ₹200 उधार दिला"* — कोणाचं उधार लक्षात ठेवा\n\nबेसिक स्टॉक एंट्री नेहमी मोफत राहील. ✅`,

  gu: ({ days }) =>
    `${days} દિવસ માટે બધું ખૂલ્યું. 🔓\n\nઆ પણ અજમાવો:\n🎤 *"આજ કેટલું વેચ્યું?"* — રોજનો હિસાબ\n🎤 *"રાજૂને ₹200 ઉધારે આપ્યા"* — કોઈનું ઉધારૂ યાદ રાખો\n\nબેઝિક સ્ટૉક એન્ટ્રી હંમેશા મફત રહેશે. ✅`,

  bn: ({ days }) =>
    `${days} দিনের জন্য সব কিছু খুলে গেল. 🔓\n\nএগুলোও চেষ্টা করুন:\n🎤 *"আজ কতটুকু বিক্রি হল?"* — রোজকার হিসাব\n🎤 *"রাজুকে ₹200 ধার দিলাম"* — কারও ধার মনে রাখুন\n\nবেসিক স্টক এন্ট্রি সবসময় বিনামূল্যে থাকবে. ✅`,

  ta: ({ days }) =>
    `${days} நாட்களுக்கு எல்லாம் திறந்தது. 🔓\n\nஇவற்றையும் முயற்சி செய்யுங்கள்:\n🎤 *"இன்று எவ்வளவு விற்றது?"* — தினசரி கணக்கு\n🎤 *"ராஜுவுக்கு ₹200 கடன் கொடுத்தேன்"* — யாரோ கடன் நினைவில் வையுங்கள்\n\nஅடிப்படை சரக்கு பதிவு எப்போதும் இலவசம். ✅`,

  te: ({ days }) =>
    `${days} రోజులకు అన్నీ తెరుచుకున్నాయి. 🔓\n\nఇవి కూడా ప్రయత్నించండి:\n🎤 *"ఈరోజు ఎంత అమ్మారు?"* — రోజువారీ లెక్క\n🎤 *"రాజుకి ₹200 అప్పు ఇచ్చాను"* — ఎవరి అప్పో గుర్తుంచుకోండి\n\nప్రాథమిక స్టాక్ ఎంట్రీ ఎప్పుడూ ఉచితం. ✅`,

  kn: ({ days }) =>
    `${days} ದಿನಗಳಿಗೆ ಎಲ್ಲವೂ ತೆರೆಯಿತು. 🔓\n\nಇವನ್ನೂ ಪ್ರಯತ್ನಿಸಿ:\n🎤 *"ಇಂದು ಎಷ್ಟು ಮಾರಿದ್ದೇನೆ?"* — ದಿನದ ಲೆಕ್ಕ\n🎤 *"ರಾಜುಗೆ ₹200 ಸಾಲ ಕೊಟ್ಟಿದ್ದೇನೆ"* — ಯಾರದ್ದೋ ಸಾಲ ನೆನಪಿಡಿ\n\nಮೂಲ ಸ್ಟಾಕ್ ಎಂಟ್ರಿ ಯಾವಾಗಲೂ ಉಚಿತ. ✅`,

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
// Vague input explicitly OK. "30 seconds" anchor. Zero guilt framing.
// ---------------------------------------------------------------------------
const STAGE_3_PROMPTS = {
  hi: `📦 आज की दुकान कैसी रही?\n\nबस बोल दो — *"आज 3 चीज़ें बिकीं"*\nमैं हिसाब लगा लूंगा। 🎤 ३० सेकंड।`,
  mr: `📦 आज दुकान कशी झाली?\n\nफक्त सांगा — *"आज ३ गोष्टी विकल्या"*\nमी हिशोब लावतो. 🎤 ३० सेकंद.`,
  gu: `📦 આજ દુકાન કેવી ગઈ?\n\nબસ કહો — *"આજ ૩ વસ્તુ વેચી"*\nહું હિસાબ લગાડીશ. 🎤 ૩૦ સેકન્ડ.`,
  bn: `📦 আজ দোকান কেমন চলল?\n\nশুধু বলুন — *"আজ ৩টা জিনিস বিক্রি"*\nআমি হিসাব করব. 🎤 ৩০ সেকেন্ড.`,
  ta: `📦 இன்று கடை எப்படி நடந்தது?\n\nசொல்லுங்கள் — *"இன்று 3 பொருட்கள் விற்றது"*\nநான் கணக்கு போடுகிறேன். 🎤 30 நொடி.`,
  te: `📦 ఈరోజు షాప్ ఎలా జరిగింది?\n\nచెప్పండి — *"ఈరోజు 3 వస్తువులు అమ్మారు"*\nనేను లెక్క వేస్తాను. 🎤 30 సెకన్లు.`,
  kn: `📦 ಇಂದು ಅಂಗಡಿ ಹೇಗೆ ಹೋಯಿತು?\n\nಹೇಳಿ — *"ಇಂದು 3 ವಸ್ತುಗಳು ಮಾರಾಟ"*\nನಾನು ಲೆಕ್ಕ ಹಾಕುತ್ತೇನೆ. 🎤 30 ಸೆಕೆಂಡ್.`,
  en: `📦 How did the shop go today?\n\nJust say — *"sold about 5 things"*\nI'll sort it out. 🎤 30 seconds.`,
};

function getStage3Message(langExact) {
  return STAGE_3_PROMPTS[baseLang(langExact)] ?? STAGE_3_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 4 — Morning brief (8:30am IST, Day 2+). Real data required.
// params: { shopName, lowStockItems[{product, qty, unit}], salesTotal, langExact }
// ---------------------------------------------------------------------------
function getStage4Message({ shopName, lowStockItems = [], salesTotal = 0, langExact = 'en' }) {
  const lang = baseLang(langExact);
  const name = shopName ? `, ${shopName}` : '';
  const salesStr = `₹${Number(salesTotal).toLocaleString('en-IN')}`;
  const topLow = (lowStockItems ?? []).slice(0, 3);

  const REORDER_EXAMPLE = {
    hi: `🎤 बोलो — *"Parle-G 2 बॉक्स आया"*`,
    mr: `🎤 सांगा — *"Parle-G 2 बॉक्स आले"*`,
    gu: `🎤 કહો — *"Parle-G 2 બૉક્સ આવ્યા"*`,
    bn: `🎤 বলুন — *"Parle-G 2 বাক্স এসেছে"*`,
    ta: `🎤 சொல்லுங்கள் — *"Parle-G 2 பெட்டி வந்தது"*`,
    te: `🎤 చెప్పండి — *"Parle-G 2 పెట్టెలు వచ్చాయి"*`,
    kn: `🎤 ಹೇಳಿ — *"Parle-G 2 ಪೆಟ್ಟಿಗೆ ಬಂತು"*`,
    en: `🎤 Say — *"Parle-G 2 boxes in"*`,
  };

  const HEADERS = {
    hi: (n) => `☀️ कल का हिसाब${n}:`,
    mr: (n) => `☀️ कालचा हिशोब${n}:`,
    gu: (n) => `☀️ ગઈ કાલનો હિસાબ${n}:`,
    bn: (n) => `☀️ গতকালের হিসাব${n}:`,
    ta: (n) => `☀️ நேற்றைய கணக்கு${n}:`,
    te: (n) => `☀️ నిన్నటి లెక్క${n}:`,
    kn: (n) => `☀️ ನಿನ್ನೆಯ ಲೆಕ್ಕ${n}:`,
    en: (n) => `☀️ Yesterday's summary${n}:`,
  };

  const STOCK_SUFFIX = {
    hi: 'बचा', mr: 'शिल्लक', gu: 'બાકી',
    bn: 'বাকি', ta: 'மீதி', te: 'మిగిలింది',
    kn: 'ಉಳಿದಿದೆ', en: 'left',
  };

  const SALES_LINE = {
    hi: (s) => `📊 कल की कमाई: ${s}`,
    mr: (s) => `📊 कालची कमाई: ${s}`,
    gu: (s) => `📊 ગઈ કાલની કમાણી: ${s}`,
    bn: (s) => `📊 গতকালের আয়: ${s}`,
    ta: (s) => `📊 நேற்றைய வருவாய்: ${s}`,
    te: (s) => `📊 నిన్న ఆదాయం: ${s}`,
    kn: (s) => `📊 ನಿನ್ನೆಯ ಗಳಿಕೆ: ${s}`,
    en: (s) => `📊 Yesterday's sales: ${s}`,
  };

  const REORDER_Q = {
    hi: `\nआज क्या मंगाना है?`,
    mr: `\nआज काय मागवायचे आहे?`,
    gu: `\nઆજ શું મંગાવવાનું છે?`,
    bn: `\nআজ কী অর্ডার করতে হবে?`,
    ta: `\nஇன்று என்ன ஆர்டர் செய்ய வேண்டும்?`,
    te: `\nఈరోజు ఏమి ఆర్డర్ చేయాలి?`,
    kn: `\nಇಂದು ಏನು ಆರ್ಡರ್ ಮಾಡಬೇಕು?`,
    en: `\nWhat are you ordering today?`,
  };

  const NO_DATA_NOTE = {
    hi: `\n(यह आपका पहला दिन था — आज से असली डेटा आना शुरू होगा।)`,
    mr: `\n(हा तुमचा पहिला दिवस होता — आजपासून खरी माहिती येईल.)`,
    gu: `\n(આ તમારો પ્રથમ દિવસ હતો — આજથી ખરો ડેટા આવવા શરૂ થશે.)`,
    bn: `\n(এটা আপনার প্রথম দিন ছিল — আজ থেকে আসল তথ্য আসবে।)`,
    ta: `\n(இது உங்கள் முதல் நாள் — இன்றிலிருந்து உண்மையான தரவு வரும்.)`,
    te: `\n(ఇది మీ మొదటి రోజు — ఈరోజు నుండి నిజమైన డేటా వస్తుంది.)`,
    kn: `\n(ಇದು ನಿಮ್ಮ ಮೊದಲ ದಿನ — ಇಂದಿನಿಂದ ನಿಜವಾದ ಮಾಹಿತಿ ಬರುತ್ತದೆ.)`,
    en: `\n(That was your first day — real data starts from today.)`,
  };

  const header     = (HEADERS[lang]    ?? HEADERS.en)(name);
  const salesLine  = (SALES_LINE[lang] ?? SALES_LINE.en)(salesStr);
  const reorderQ   = REORDER_Q[lang]   ?? REORDER_Q.en;
  const reorderEx  = REORDER_EXAMPLE[lang] ?? REORDER_EXAMPLE.en;
  const noDataNote = NO_DATA_NOTE[lang] ?? NO_DATA_NOTE.en;
  const suffix     = STOCK_SUFFIX[lang] ?? STOCK_SUFFIX.en;

  const lines = [header, ''];

  if (topLow.length > 0) {
    for (const item of topLow) {
      lines.push(`📉 ${item.product}: ${item.qty} ${item.unit ?? ''} ${suffix}`.trimEnd());
    }
  }

  if (salesTotal > 0) lines.push(salesLine);
  if (topLow.length === 0 && salesTotal === 0) lines.push(noDataNote.trim());

  lines.push('');
  lines.push(reorderQ.trim());
  lines.push(reorderEx);

  return lines.filter(l => l !== null && l !== undefined).join('\n');
}

// ---------------------------------------------------------------------------
// STAGE 5a — Shop name ask (after 2nd confirmed entry)
// ---------------------------------------------------------------------------
const STAGE_5A_PROMPTS = {
  hi: `एक बात — आपकी दुकान का नाम क्या है?\n\n(तो आपकी एंट्रियों और बिल पर नाम दिखेगा — जैसे "राम किराना स्टोर") 🏪`,
  mr: `एक गोष्ट — तुमच्या दुकानाचे नाव काय आहे?\n\n(तर तुमच्या नोंदी आणि बिलावर नाव दिसेल — जसे "राम किराणा स्टोर") 🏪`,
  gu: `એક વાત — તમારી દુકાનનું નામ શું છે?\n\n(તો તમારી એન્ટ્રીઓ અને બિલ પર નામ દેખાશે — જેમ કે "રામ કિરાણા સ્ટોર") 🏪`,
  bn: `একটা কথা — আপনার দোকানের নাম কী?\n\n(তাহলে আপনার এন্ট্রি ও বিলে নাম দেখাবে — যেমন "রাম কিরানা স্টোর") 🏪`,
  ta: `ஒரு விஷயம் — உங்கள் கடையின் பெயர் என்ன?\n\n(உங்கள் பதிவுகள் மற்றும் பில்லில் பெயர் காண்பிக்கும் — எ.கா. "ராம் கிரானா ஸ்டோர்") 🏪`,
  te: `ఒక్క విషయం — మీ షాప్ పేరు ఏమిటి?\n\n(అప్పుడు మీ నమోదులు మరియు బిల్ పై పేరు కనిపిస్తుంది — ఉదా. "రామ్ కిరానా స్టోర్") 🏪`,
  kn: `ಒಂದು ವಿಷಯ — ನಿಮ್ಮ ಅಂಗಡಿಯ ಹೆಸರು ಏನು?\n\n(ನಿಮ್ಮ ನಮೂದುಗಳು ಮತ್ತು ಬಿಲ್ ಮೇಲೆ ಹೆಸರು ಕಾಣಿಸಿಕೊಳ್ಳುತ್ತದೆ — ಉದಾ. "ರಾಮ್ ಕಿರಾಣಾ ಸ್ಟೋರ್") 🏪`,
  en: `One thing — what's your shop name?\n\n(So it shows on your entries and bills — like "Ram Kirana Store") 🏪`,
};

function getStage5aMessage(langExact) {
  return STAGE_5A_PROMPTS[baseLang(langExact)] ?? STAGE_5A_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 5b — Area ask (after name received)
// ---------------------------------------------------------------------------
const STAGE_5B_PROMPTS = {
  hi: `और आप कहाँ हैं? बस इलाका बताओ।\n\n(कम स्टॉक का अलर्ट सही समय पर आए इसलिए। 📍)`,
  mr: `आणि तुम्ही कुठे आहात? फक्त परिसर सांगा.\n\n(कमी स्टॉकचा अलर्ट योग्य वेळी यावा म्हणून. 📍)`,
  gu: `અને તમે ક્યાં છો? બસ વિસ્તાર જણાવો.\n\n(ઓછા સ્ટૉકનો અલર્ટ સાચા સમયે આવે એ માટે. 📍)`,
  bn: `আর আপনি কোথায়? শুধু এলাকা বলুন।\n\n(কম স্টকের সতর্কতা সঠিক সময়ে আসুক তাই। 📍)`,
  ta: `நீங்கள் எங்கே இருக்கிறீர்கள்? இடம் மட்டும் சொல்லுங்கள்.\n\n(குறைந்த சரக்கு எச்சரிக்கை சரியான நேரத்தில் வர வேண்டும் என்பதால். 📍)`,
  te: `మీరు ఎక్కడ ఉన్నారు? ప్రాంతం మాత్రమే చెప్పండి.\n\n(తక్కువ స్టాక్ హెచ్చరిక సరైన సమయంలో రావడానికి. 📍)`,
  kn: `ನೀವು ಎಲ್ಲಿದ್ದೀರಿ? ಪ್ರದೇಶ ಮಾತ್ರ ಹೇಳಿ.\n\n(ಕಡಿಮೆ ಸ್ಟಾಕ್ ಎಚ್ಚರಿಕೆ ಸರಿಯಾದ ಸಮಯಕ್ಕೆ ಬರಲಿ ಎಂದು. 📍)`,
  en: `And where are you? Just tell me the area.\n\n(So low-stock alerts reach you at the right time. 📍)`,
};

function getStage5bMessage(langExact) {
  return STAGE_5B_PROMPTS[baseLang(langExact)] ?? STAGE_5B_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 5c — GSTIN ask (softest ask, after area, skip very prominent)
// GSTIN stays Latin (official govt acronym). Native-script skip variants
// are already in _isSkipGST() in whatsapp.js.
// ---------------------------------------------------------------------------
const STAGE_5C_PROMPTS = {
  hi: `GSTIN है? तो ग्राहकों को पक्का टैक्स बिल भेज सकते हो।\n\nनहीं है तो कोई बात नहीं — बस *"स्किप"* लिखो। ✅`,
  mr: `GSTIN आहे? तर ग्राहकांना खरे टॅक्स बिल पाठवता येईल.\n\nनसेल तर काही हरकत नाही — फक्त *"स्किप"* लिहा. ✅`,
  gu: `GSTIN છે? તો ગ્રાહકોને પાક્કું ટૅક્સ બિલ મોકલી શકો.\n\nનથી તો કોઈ વાત નહીં — બસ *"સ્કિપ"* લખો. ✅`,
  bn: `GSTIN আছে? তাহলে ক্রেতাদের পাকা ট্যাক্স বিল পাঠাতে পারবেন।\n\nনেই তো কোনো সমস্যা নেই — শুধু *"স্কিপ"* লিখুন। ✅`,
  ta: `GSTIN இருக்கிறதா? அப்படியென்றால் வாடிக்கையாளர்களுக்கு சரியான வரி பில் அனுப்பலாம்.\n\nஇல்லையென்றால் பரவாயில்லை — *"ஸ்கிப்"* என்று எழுதுங்கள். ✅`,
  te: `GSTIN ఉందా? అయితే కస్టమర్లకి సక్రమంగా పన్ను బిల్ పంపవచ్చు.\n\nలేకపోతే పర్వాలేదు — *"స్కిప్"* అని రాయండి. ✅`,
  kn: `GSTIN ಇದೆಯಾ? ಹಾಗಾದರೆ ಗ್ರಾಹಕರಿಗೆ ಸರಿಯಾದ ತೆರಿಗೆ ಬಿಲ್ ಕಳಿಸಬಹುದು.\n\nಇಲ್ಲದಿದ್ದರೆ ಪರವಾಗಿಲ್ಲ — *"ಸ್ಕಿಪ್"* ಎಂದು ಬರೆಯಿರಿ. ✅`,
  en: `Got a GSTIN? Then customers can get proper tax bills.\n\nNo GSTIN? No problem — just type *"skip"*. ✅`,
};

function getStage5cMessage(langExact) {
  return STAGE_5C_PROMPTS[baseLang(langExact)] ?? STAGE_5C_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 7b — Bill sent confirmation (after PDF dispatched)
// ---------------------------------------------------------------------------
const STAGE_7B_PROMPTS = {
  hi: `📄 बिल भेज दिया।\n\nग्राहक को भेज दो। ✅`,
  mr: `📄 बिल पाठवले.\n\nग्राहकाला पाठवा. ✅`,
  gu: `📄 બિલ મોકલ્યું.\n\nગ્રાહકને મોકલો. ✅`,
  bn: `📄 বিল পাঠিয়ে দিলাম।\n\nক্রেতাকে পাঠিয়ে দিন। ✅`,
  ta: `📄 பில் அனுப்பிவிட்டேன்.\n\nவாடிக்கையாளருக்கு அனுப்புங்கள். ✅`,
  te: `📄 బిల్ పంపించాను.\n\nకస్టమర్‌కి పంపండి. ✅`,
  kn: `📄 ಬಿಲ್ ಕಳಿಸಿದ್ದೇನೆ.\n\nಗ್ರಾಹಕರಿಗೆ ಕಳಿಸಿ. ✅`,
  en: `📄 Bill sent.\n\nForward it to the customer. ✅`,
};

function getStage7bMessage(langExact) {
  return STAGE_7B_PROMPTS[baseLang(langExact)] ?? STAGE_7B_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 7c — Bill requested but shop name not yet captured
// ---------------------------------------------------------------------------
const STAGE_7C_PROMPTS = {
  hi: `📄 बिल बनाने के लिए — दुकान का नाम बताओ?\n\n(एक बार बताओ, हमेशा के लिए सेव।) 🏪`,
  mr: `📄 बिल बनवण्यासाठी — दुकानाचे नाव सांगा?\n\n(एकदा सांगा, कायमचे सेव.) 🏪`,
  gu: `📄 બિલ બનાવવા માટે — દુકાનનું નામ જણાવો?\n\n(એક વાર જણાવો, હંમેશ માટે સેવ.) 🏪`,
  bn: `📄 বিল বানাতে — দোকানের নাম বলুন?\n\n(একবার বললেই হবে, সবসময়ের জন্য সেভ।) 🏪`,
  ta: `📄 பில் உருவாக்க — கடையின் பெயர் சொல்லுங்கள்?\n\n(ஒருமுறை சொன்னால் போதும், எப்போதும் சேமிக்கப்படும்.) 🏪`,
  te: `📄 బిల్ తయారు చేయడానికి — షాప్ పేరు చెప్పండి?\n\n(ఒక్కసారి చెప్పండి, ఎప్పటికీ సేవ్.) 🏪`,
  kn: `📄 ಬಿಲ್ ಮಾಡಲು — ಅಂಗಡಿಯ ಹೆಸರು ಹೇಳಿ?\n\n(ಒಂದು ಸಲ ಹೇಳಿದರಾಯಿತು, ಯಾವಾಗಲೂ ಸೇವ್.) 🏪`,
  en: `📄 To make the bill — what's your shop name?\n\n(Tell me once, saved forever.) 🏪`,
};

function getStage7cMessage(langExact) {
  return STAGE_7C_PROMPTS[baseLang(langExact)] ?? STAGE_7C_PROMPTS.en;
}

// ---------------------------------------------------------------------------
// STAGE 8 — Trial ending summary (Day 3 evening, real data)
// PRICING: ₹11/month — correct price. NOT ₹299.
// params: { entriesCount, billsCount, udhaarEntries[{customer, balance}], days, langExact }
// ---------------------------------------------------------------------------
function getStage8Message({ entriesCount = 0, billsCount = 0, udhaarEntries = [], days = 3, langExact = 'en' }) {
  const lang = baseLang(langExact);

  const HEADERS = {
    hi: `इन ${days} दिनों में:`,
    mr: `या ${days} दिवसांत:`,
    gu: `આ ${days} દિવસોમાં:`,
    bn: `এই ${days} দিনে:`,
    ta: `இந்த ${days} நாட்களில்:`,
    te: `ఈ ${days} రోజుల్లో:`,
    kn: `ಈ ${days} ದಿನಗಳಲ್ಲಿ:`,
    en: `In these ${days} days:`,
  };

  const ENTRY_LINE = {
    hi: (n) => `📦 ${n} एंट्रियाँ सेव हुईं`,
    mr: (n) => `📦 ${n} नोंदी सेव झाल्या`,
    gu: (n) => `📦 ${n} એન્ટ્રી સેવ થઈ`,
    bn: (n) => `📦 ${n}টি এন্ট্রি সেভ হয়েছে`,
    ta: (n) => `📦 ${n} பதிவுகள் சேமிக்கப்பட்டன`,
    te: (n) => `📦 ${n} నమోదులు సేవ్ అయ్యాయి`,
    kn: (n) => `📦 ${n} ನಮೂದುಗಳು ಸೇವ್ ಆದವು`,
    en: (n) => `📦 ${n} entries saved`,
  };

  const BILL_LINE = {
    hi: (n) => `📄 ${n} बिल बने`,
    mr: (n) => `📄 ${n} बिले बनली`,
    gu: (n) => `📄 ${n} બિલ બન્યા`,
    bn: (n) => `📄 ${n}টি বিল তৈরি হয়েছে`,
    ta: (n) => `📄 ${n} பில்கள் உருவாயின`,
    te: (n) => `📄 ${n} బిల్లులు తయారయ్యాయి`,
    kn: (n) => `📄 ${n} ಬಿಲ್‌ಗಳು ಆದವು`,
    en: (n) => `📄 ${n} bills created`,
  };

  const UDHAAR_LINE = {
    hi: (name, amt) => `💰 ${name} का ₹${amt} उधार दर्ज है`,
    mr: (name, amt) => `💰 ${name} चे ₹${amt} उधार नोंदले आहे`,
    gu: (name, amt) => `💰 ${name} નું ₹${amt} ઉધારૂ નોંધ્યું છે`,
    bn: (name, amt) => `💰 ${name} এর ₹${amt} ধার নথিভুক্ত আছে`,
    ta: (name, amt) => `💰 ${name} கடன் ₹${amt} பதிவு செய்யப்பட்டுள்ளது`,
    te: (name, amt) => `💰 ${name} అప్పు ₹${amt} నమోదు ఉంది`,
    kn: (name, amt) => `💰 ${name} ಸಾಲ ₹${amt} ದಾಖಲಾಗಿದೆ`,
    en: (name, amt) => `💰 ${name}'s ₹${amt} credit is on record`,
  };

  // ₹11/month — verified correct price
  const FOOTER = {
    hi: `कल ट्रायल खत्म होगा। मुफ़्त प्लान में स्टॉक एंट्री जारी रहेगी।\nबाकी सुविधाएँ — ₹11/महीना।\n\nअभी फ़ैसला मत करो। कल तक सोचो।`,
    mr: `उद्या ट्रायल संपेल. मोफत प्लानमध्ये स्टॉक एंट्री चालू राहील.\nइतर सुविधा — ₹11/महिना.\n\nआत्ता निर्णय करू नका. उद्यापर्यंत विचार करा.`,
    gu: `કાલે ટ્રાયલ ખતમ થશે. મફત પ્લાનમાં સ્ટૉક એન્ટ્રી ચાલુ રહેશે.\nબાકી સુવિધાઓ — ₹11/મહિનો.\n\nહવે નિર્ણય ન કરો. કાલ સુધી વિચારો.`,
    bn: `কাল ট্রায়াল শেষ হবে। বিনামূল্যে পরিকল্পনায় স্টক এন্ট্রি চলতে থাকবে।\nবাকি সুবিধা — ₹11/মাস।\n\nএখন সিদ্ধান্ত নেবেন না। কাল পর্যন্ত ভাবুন।`,
    ta: `நாளை ட்ரயல் முடியும். இலவச திட்டத்தில் சரக்கு பதிவு தொடரும்.\nமற்ற வசதிகள் — ₹11/மாதம்.\n\nஇப்போது முடிவு செய்யாதீர்கள். நாளை வரை யோசியுங்கள்.`,
    te: `రేపు ట్రయల్ అయిపోతుంది. ఉచిత ప్లాన్‌లో స్టాక్ ఎంట్రీ కొనసాగుతుంది.\nమిగతా సదుపాయాలు — ₹11/నెల.\n\nఇప్పుడు నిర్ణయం చేయకండి. రేపటి వరకు ఆలోచించండి.`,
    kn: `ನಾಳೆ ಟ್ರಯಲ್ ಮುಗಿಯುತ್ತದೆ. ಉಚಿತ ಯೋಜನೆಯಲ್ಲಿ ಸ್ಟಾಕ್ ಎಂಟ್ರಿ ಮುಂದುವರಿಯುತ್ತದೆ.\nಉಳಿದ ಸೌಲಭ್ಯಗಳು — ₹11/ತಿಂಗಳು.\n\nಈಗ ನಿರ್ಧಾರ ಮಾಡಬೇಡಿ. ನಾಳೆಯವರೆಗೆ ಯೋಚಿಸಿ.`,
    en: `Trial ends tomorrow. Stock entry stays free.\nOther features — ₹11/month.\n\nDon't decide now. Sleep on it.`,
  };

  const lines = [HEADERS[lang] ?? HEADERS.en, ''];

  if (entriesCount > 0) lines.push((ENTRY_LINE[lang] ?? ENTRY_LINE.en)(entriesCount));
  if (billsCount > 0) lines.push((BILL_LINE[lang] ?? BILL_LINE.en)(billsCount));

  const topUdhaar = udhaarEntries.slice(0, 1)[0];
  if (topUdhaar) {
    lines.push((UDHAAR_LINE[lang] ?? UDHAAR_LINE.en)(topUdhaar.customer, topUdhaar.balance));
  }

  lines.push('');
  lines.push(FOOTER[lang] ?? FOOTER.en);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// BILL INTENT DETECTOR — kept as regex (keyword matching, no AI needed)
// Covers: Latin "bill", Devanagari "बिल", Bengali "বিল", Gujarati "બિલ" etc.
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
  /\b(બિલ)\b/i,
];

function isBillRequest(text) {
  return BILL_INTENT_PATTERNS.some(re => re.test(String(text ?? '').trim()));
}

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
