const axios = require('axios');

// WhatsApp UI constraints (see Twilio docs: quick-reply title <= 20 chars) 
// Ref: https://www.twilio.com/docs/content/twilio-quick-reply
const MAX_QR_TITLE = 20;
const clampTitle = (s) => {
  // Code-point safe clamping (handles Devanagari and other non-Latin scripts)
  const arr = [...String(s || '').trim()];
  return arr.slice(0, MAX_QR_TITLE).join('');
};
// Reuse for list item labels (common UX convention ~20 chars)
const clampItem = clampTitle;

// Accept either ACCOUNT_SID/AUTH_TOKEN or TWILIO_* to fit different envs
const ACCOUNT_SID = process.env.ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN  = process.env.AUTH_TOKEN  || process.env.TWILIO_AUTH_TOKEN;
const CONTENT_API_URL = 'https://content.twilio.com/v1/Content';
const TTL_MS = 24 * 60 * 60 * 1000; // refresh daily

// --- NEW: Paid confirmation labels (<=20 chars title) ---
const PAID_CONFIRM_LABELS = { 
  en: { body: 'Already completed the payment?', button: 'Paid' }, 
  // Hindi body made more conversational
  hi: { body: 'पेमेंट हो गया?', button: 'Paid' }, 
  gu: { body: 'ચુકવણી થઇ ગઈ?', button: 'Paid' }, 
  ta: { body: 'பணம் செலுத்திவிட்டீர்களா?', button: 'Paid' }, 
  te: { body: 'చెల్లింపు పూర్తయిందా?', button: 'Paid' }, 
  kn: { body: 'ಪಾವತಿ ಪೂರ್ಣವೇ?', button: 'Paid' }, 
  mr: { body: 'पेमेंट झाले का?', button: 'Paid' }, 
  bn: { body: 'পেমেন্ট সম্পন্ন?', button: 'Paid' } 
 }; 

if (!ACCOUNT_SID || !AUTH_TOKEN) {
   throw new Error('Missing ACCOUNT_SID or AUTH_TOKEN');
 }

// Helper: map script variants (e.g., 'hi-latn') to base language ('hi') for content labels
function normalizeLangForContent(lang) {
  const L = String(lang || 'en').toLowerCase();
  return L.endsWith('-latn') ? L.split('-')[0] : L;
}

 // ---------- LOCALIZATION DICTS (native script labels) ----------
 const QR_LABELS = {
   en: { purchase: 'Record Purchase', sale: 'Record Sale', ret: 'Record Return', body: 'What would you like to do?' },
   hi: { purchase: 'खरीद दर्ज करें', sale: 'बिक्री दर्ज करें', ret: 'रिटर्न दर्ज करें', body: 'क्या करना चाहेंगे?' },
   gu: { purchase: 'ખરીદી નોંધો', sale: 'વેચાણ નોંધો', ret: 'રીટર્ન નોંધો', body: 'તમે શું કરશો?' },
   ta: { purchase: 'கொள்முதல் பதிவு', sale: 'விற்பனை பதிவு', ret: 'ரிட்டர்ன் பதிவு', body: 'எதைச் செய்ய விரும்புகிறீர்கள்?' },
   te: { purchase: 'కొనుగోలు నమోదు', sale: 'అమ్మకం నమోదు', ret: 'రిటర్న్ నమోదు', body: 'మీరు ఏమి చేయాలనుకుంటున్నారు?' },
   kn: { purchase: 'ಖರೀದಿ ನೋಂದಣಿ', sale: 'ಮಾರಾಟ ನೋಂದಣಿ', ret: 'ರಿಟರ್ನ್ ನೋಂದಣಿ', body: 'ನೀವು ಏನು ಮಾಡಬೇಕು?' },
   mr: { purchase: 'खरेदी नोंदवा', sale: 'विक्री नोंदवा', ret: 'रिटर्न नोंदवा', body: 'आपण काय करणार?' },
   bn: { purchase: 'ক্রয় নথিভুক্ত', sale: 'বিক্রয় নথিভুক্ত', ret: 'রিটার্ন নথিভুক্ত', body: 'আপনি কী করতে চান?' }
 };
 
// === UPDATED: List labels to match new menu across all supported languages ===
const LIST_LABELS = { 
  en: { 
   body: 'Query inventory', 
   button: 'Select an option', 
   items: { 
    short: ['Short Summary', ''], 
    full: ['Full Summary', ''], 
    low: ['Low stock', ''], 
    reorder: ['Reorder suggestions', ''], 
    // Expiry & period labels aligned to your choices
    exp0: ['Expired', ''], 
    exp30: ['Expires in 30 days', ''], 
    salesD: ['Sales today', ''], 
    salesW: ['Sales this week', ''], 
    top: ['Top 5 this month', ''], 
    value: ['Inventory value', ''] 
  } 
  },   
hi: { 
   body: 'इन्वेंटरी पूछें', 
   button: 'एक विकल्प चुनें', 
   items: { 
    short: ['शॉर्ट समरी', ''], 
    full: ['फुल समरी', ''], 
    low: ['कम स्टॉक', ''], 
    reorder: ['रीऑर्डर सुझाव', ''], 
    exp0: ['समाप्त', ''], 
    exp30: ['30 दिनों में समाप्त', ''], 
    salesD: ['आज की बिक्री', ''], 
    salesW: ['साप्ताहिक बिक्री', ''], 
    top: ['महीने की टॉप 5 बिक्री', ''], 
    value: ['इन्वेंटरी मूल्य', ''] 
   } 
  },   
gu: { 
   body: 'ઇન્વેન્ટરી પૂછો', 
   button: 'વિકલ્પ પસંદ કરો', 
   items: { 
    short: ['શોર્ટ સારાંશ', ''], 
    full: ['ફુલ સારાંશ', ''], 
    low: ['ઓછો સ્ટોક', ''], 
    reorder: ['રીઓર્ડર સૂચનો', ''], 
    exp0: ['સમાપ્ત', ''], 
    exp30: ['30 દિવસમાં સમાપ્ત', ''], 
    salesD: ['આજની વેચાણ', ''], 
    salesW: ['સાપ્તાહિક વેચાણ', ''], 
    top: ['આ મહિને ટોપ 5', ''], 
    value: ['ઇન્વેન્ટરી મૂલ્ય', ''] 
   } 
  }, 
ta: { 
   body: 'சரக்கு கேள்வி', 
   button: 'ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கவும்', 
   items: { 
    short: ['சுருக்கமான சுருக்கம்', ''], 
    full: ['முழு சுருக்கம்', ''], 
    low: ['குறைந்த சரக்கு', ''], 
    reorder: ['மீண்டும் ஆர்டர் பரிந்துரைகள்', ''], 
    exp0: ['காலாவதி', ''], 
    exp30: ['30 நாட்களில் காலாவதி', ''], 
    salesD: ['இன்றைய விற்பனை', ''], 
    salesW: ['வார விற்பனை', ''], 
    top: ['இந்த மாதம் Top 5', ''], 
    value: ['சரக்கு மதிப்பு', ''] 
   } 
  },   
te: { 
   body: 'ఇన్వెంటరీ ప్రశ్న', 
   button: 'ఒక ఎంపికను ఎంచుకోండి', 
   items: { 
    short: ['షార్ట్ సమరీ', ''], 
    full: ['ఫుల్ సమరీ', ''], 
    low: ['తక్కువ నిల్వ', ''], 
    reorder: ['రీఆర్డర్ సూచనలు', ''], 
    exp0: ['గడువు ముగిసింది', ''], 
    exp30: ['30 రోజుల్లో గడువు', ''], 
    salesD: ['ఈ రోజు అమ్మకాలు', ''], 
    salesW: ['వారపు అమ్మకాలు', ''], 
    top: ['ఈ నెల Top 5', ''], 
    value: ['ఇన్వెంటరీ విలువు', ''] 
   } 
  },   
kn: { 
   body: 'ಇನ್‌ವೆಂಟರಿ ಪ್ರಶ್ನೆ', 
   button: 'ಒಂದು ಆಯ್ಕೆ ಮಾಡಿ', 
   items: { 
    short: ['ಸಂಕ್ಷಿಪ್ತ ಸಾರಾಂಶ', ''], 
    full: ['ವಿಸ್ತೃತ ಸಾರಾಂಶ', ''], 
    low: ['ಕಡಿಮೆ ಸ್ಟಾಕ್', ''], 
    reorder: ['ಮರು ಆರ್ಡರ್ ಸಲಹೆಗಳು', ''], 
    exp0: ['ಅವಧಿ ಮುಗಿದಿದೆ', ''], 
    exp30: ['30 ದಿನಗಳಲ್ಲಿ ಅವಧಿ', ''], 
    salesD: ['ಇಂದಿನ ಮಾರಾಟ', ''], 
    salesW: ['ವಾರದ ಮಾರಾಟ', ''], 
    top: ['ಈ ತಿಂಗಳು Top 5', ''], 
    value: ['ಇನ್‌ವೆಂಟರಿ ಮೌಲ್ಯ', ''] 
   } 
  }, 
mr: { 
   body: 'इन्व्हेंटरी विचार', 
   button: 'एक पर्याय निवडा', 
   items: { 
    short: ['लघु सारांश', ''], 
    full: ['सविस्तर सारांश', ''], 
    low: ['कमी साठा', ''], 
    reorder: ['री-ऑर्डर सूचना', ''], 
    exp0: ['कालबाह्य', ''], 
    exp30: ['30 दिवसांत कालबाह्य', ''], 
    salesD: ['आजची विक्री', ''], 
    salesW: ['साप्ताहिक विक्री', ''], 
    top: ['या महिन्यात टॉप 5', ''], 
    value: ['इन्व्हेंटरी मूल्य', ''] 
   } 
  },  
bn: { 
   body: 'ইনভেন্টরি জিজ্ঞাসা', 
   button: 'একটি অপশন বাছুন', 
   items: { 
    short: ['সংক্ষিপ্ত সারাংশ', ''], 
    full: ['পূর্ণাঙ্গ সারাংশ', ''], 
    low: ['কম স্টক', ''], 
    reorder: ['রিঅর্ডার পরামর্শ', ''], 
    exp0: ['মেয়াদোত্তীর্ণ', ''], 
    exp30: ['৩০ দিনে মেয়াদোত্তীর্ণ', ''], 
    salesD: ['আজকের বিক্রি', ''], 
    salesW: ['সাপ্তাহিক বিক্রি', ''], 
    top: ['এই মাসের টপ ৫', ''], 
    value: ['ইনভেন্টরি মূল্য', ''] 
   } 
  } 
};
  
 // --- NEW: CTA labels ---
 const ACTIVATE_TRIAL_LABELS = {
   en: { body: 'Try Saamagrii.AI free for 3 days', button: 'Activate Trial Plan' },
   hi: { body: 'Saamagrii.AI को 3 दिन मुफ़्त में आज़माएँ', button: 'ट्रायल शुरू करें' },
   gu: { body: 'Saamagrii.AI ને 3 દિવસ મફત અજમાવો', button: 'ટ્રાયલ શરૂ કરો' },
   ta: { body: 'Saamagrii.AI ஐ 3 நாட்கள் இலவசமாக முயற்சி செய்யுங்கள்', button: 'ட்ரயல் பிளான் செயல்படுத்தவும்' },
   te: { body: 'Saamagrii.AI ను 3 రోజులు ఉచితంగా ప్రయత్నించండి', button: 'ట్రయల్ ప్లాన్ యాక్టివేట్ చేయండి' },
   kn: { body: 'Saamagrii.AI ಅನ್ನು 3 ದಿನ ಉಚಿತವಾಗಿ ಪ್ರಯತ್ನಿಸಿ', button: 'ಟ್ರಯಲ್ ಪ್ಲಾನ್ ಸಕ್ರಿಯಗೊಳಿಸಿ' },
   mr: { body: 'Saamagrii.AI 3 दिवस मोफत वापरून पहा', button: 'ट्रायल प्लॅन सक्रिय करा' },
   bn: { body: 'Saamagrii.AI ৩ দিন ফ্রি ট্রাই করুন', button: 'ট্রায়াল প্ল্যান সক্রিয় করুন' }
 };
 
// [PATCH ANCHOR: CTA-PAID-LABELS]
 const ACTIVATE_PAID_LABELS = { 
  en: { body: 'Upgrade to paid plan for uninterrupted access', button: 'Activate Paid Plan' }, 
  // Body simplified to match everyday phrasing; button shortened to avoid clamping
  hi: { body: 'सेवा चालू रखने हेतु पेड प्लान चालू करें', button: 'पेड प्लान चालू करें' }, 
  gu: { body: 'સેવા ચાલુ રાખવા માટે પેઇડ પ્લાન શરૂ કરો', button: 'પેઇડ પ્લાન શરૂ કરો' }, 
  ta: { body: 'சேவை தொடர வேண்டில் கட்டண திட்டம் தொடங்கு', button: 'கட்டண திட்டம் தொடங்கு' }, 
  te: { body: 'సేవ కొనసాగేందుకు పెయిడ్ ప్లాన్ ప్రారంభించు', button: 'పెయిడ్ ప్లాన్ ప్రారంభించు' }, 
  kn: { body: 'ಸೇವೆ ಮುಂದುವರೆಯಲು ಪೈಡ್ ಪ್ಲಾನ್ ಸಕ್ರಿಯ ಮಾಡಿ', button: 'ಪೈಡ್ ಪ್ಲಾನ್ ಸಕ್ರಿಯ ಮಾಡಿ' }, 
  mr: { body: 'सेवा चालू ठेवण्यासाठी पेड प्लॅन सक्रिय करा', button: 'पेड प्लॅन सक्रिय करा' }, 
  bn: { body: 'সেবা চালু রাখতে পেইড প্ল্যান চালু করুন', button: 'পেইড প্ল্যান চালু করুন' } 
 }; 

// ——— NEW: 3-button Onboarding Quick-Reply (Start Trial • Demo • Help) ———
// Keep titles short (≤ 20) in every language.
const ONBOARDING_QR_LABELS = {
  en: { body: 'Get started on WhatsApp', start: 'Start Trial', demo: 'Demo', help: 'Help' },
  hi: { body: 'WhatsApp पर शुरुआत करें', start: 'ट्रायल शुरू करें', demo: 'डेमो', help: 'मदद' },
  gu: { body: 'WhatsApp પર શરૂઆત કરો',   start: 'ટ્રાયલ શરૂ કરો',  demo: 'ડેમો', help: 'મદદ' },
  ta: { body: 'WhatsAppல் தொடங்கவும்',    start: 'ட்ரயல் தொடங்க',   demo: 'டெமோ', help: 'உதவி' },
  te: { body: 'WhatsAppలో ప్రారంభించండి',  start: 'ట్రయల్ ప్రారంభించండి', demo: 'డెమో', help: 'సహాయం' }, // clamp will enforce length
  kn: { body: 'WhatsApp ನಲ್ಲಿ ಆರಂಭಿಸಿ',     start: 'ಟ್ರಯಲ್ ಆರಂಭಿಸಿ',  demo: 'ಡೆಮೋ', help: 'ಸಹಾಯ' },
  mr: { body: 'WhatsApp वर सुरुवात करा',    start: 'ट्रायल सुरू करा', demo: 'डेमो', help: 'मदत' },
  bn: { body: 'WhatsApp-এ শুরু করুন',       start: 'ট্রায়াল শুরু',    demo: 'ডেমো', help: 'সাহায্য' }
};

async function createOnboardingQuickReplyForLang(lang) {
  const l = ONBOARDING_QR_LABELS[lang] ?? ONBOARDING_QR_LABELS.en;
  const payload = {
    friendly_name: `saamagrii_onboard_qr_${lang}_${Date.now()}`,
    language: 'en',
    types: {
      'twilio/quick-reply': {
        body: l.body,
        actions: [
          { type: 'QUICK_REPLY', title: clampTitle(l.start), id: 'activate_trial' },
          { type: 'QUICK_REPLY', title: clampTitle(l.demo),  id: 'show_demo' },
          { type: 'QUICK_REPLY', title: clampTitle(l.help),  id: 'show_help' }
        ]
      }
    }
  };
  const { data } = await axios.post(CONTENT_API_URL, payload, {
    auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
  });
  console.log(`[contentCache] Created Onboarding QR for ${lang}: ContentSid=${data.sid}`);
  return data.sid;
}

 async function createQuickReplyForLang(lang) {
   const base = normalizeLangForContent(lang);
   const l = QR_LABELS[base] ?? QR_LABELS.en;
   const payload = {
    friendly_name: `saamagrii_welcome_qr_${base}_${Date.now()}`,
     language: 'en', // metadata only; labels are already localized
     types: {
       'twilio/quick-reply': {
         body: l.body,
         actions: [
           { type: 'QUICK_REPLY', title: l.purchase, id: 'qr_purchase' },
           { type: 'QUICK_REPLY', title: l.sale,     id: 'qr_sale'     },
           { type: 'QUICK_REPLY', title: l.ret,      id: 'qr_return'   }
         ]
       }
     }
   };
   const { data } = await axios.post(CONTENT_API_URL, payload, {
     auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
   });
   return data.sid; // HX… ContentSid
 }

async function createListPickerForLang(lang) {
   const base = normalizeLangForContent(lang);
const l = LIST_LABELS[base] ?? LIST_LABELS.en;
  const it = l.items;
  const payload = {
    friendly_name: `saamagrii_query_list_${base}_${Date.now()}`, // force NEW ContentSid
    language: 'en',
    types: {
      'twilio/list-picker': {              
      body: l.body,
      button: clampTitle(l.button),   // clamp expand button text as well              
      items: [ 
              { item: clampItem(it.short[0]),  id: 'list_short_summary',  description: it.short[1] }, 
              { item: clampItem(it.full[0]),   id: 'list_full_summary',   description: it.full[1] }, 
              { item: clampItem(it.low[0]),    id: 'list_low',            description: it.low[1] }, 
              { item: clampItem(it.reorder[0]),id: 'list_reorder_suggest',description: it.reorder[1] }, 
              { item: clampItem(it.exp0[0]),   id: 'list_expiring',       description: it.exp0[1] }, 
              { item: clampItem(it.exp30[0]),  id: 'list_expiring_30',    description: it.exp30[1] }, 
              { item: clampItem(it.salesD[0]), id: 'list_sales_day',      description: it.salesD[1] }, 
              { item: clampItem(it.salesW[0]), id: 'list_sales_week',     description: it.salesW[1] }, 
              { item: clampItem(it.top[0]),    id: 'list_top_month',      description: it.top[1] }, 
              { item: clampItem(it.value[0]),  id: 'list_value',          description: it.value[1] } 
            ] 
      }
    }
  };

   const { data } = await axios.post(CONTENT_API_URL, payload, {
     auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
   });
  console.log(`[contentCache] Created List-Picker for ${lang}: ContentSid=${data.sid}`);
   return data.sid;
 }

// --- NEW: Trial CTA (single-button quick reply) ---
async function createActivateTrialCTAForLang(lang) {
  const base = normalizeLangForContent(lang);
  const l = ACTIVATE_TRIAL_LABELS[base] ?? ACTIVATE_TRIAL_LABELS.en;
  const payload = {
    friendly_name: `saamagrii_activate_trial_${base}_${Date.now()}`,
    language: 'en',
    types: {
      'twilio/quick-reply': {              
      body: l.body,
      actions: [ { type: 'QUICK_REPLY', title: clampTitle(l.button), id: 'activate_trial' } ]
      }
    }
  };
  const { data } = await axios.post(CONTENT_API_URL, payload, {
    auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
  });
  console.log(`[contentCache] Created Activate-Trial for ${lang}: ContentSid=${data.sid}`);
  return data.sid;
}

// --- NEW: Paid CTA (single-button quick reply) ---
async function createActivatePaidCTAForLang(lang) {
  const base = normalizeLangForContent(lang);
  const l = ACTIVATE_PAID_LABELS[base] ?? ACTIVATE_PAID_LABELS.en;
  const payload = {
    friendly_name: `saamagrii_activate_paid_${base}_${Date.now()}`,
    language: 'en',
    types: {
      'twilio/quick-reply': {              
      body: l.body,
      actions: [ { type: 'QUICK_REPLY', title: clampTitle(l.button), id: 'activate_paid' } ]
      }
    }
  };
  const { data } = await axios.post(CONTENT_API_URL, payload, {
    auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
  });
  console.log(`[contentCache] Created Activate-Paid for ${lang}: ContentSid=${data.sid}`);
  return data.sid;
}

// --- NEW: Builder for the single-button "Paid" confirm ---
async function createPaidConfirmCTAForLang(lang) {
  const base = normalizeLangForContent(lang);
  const l = PAID_CONFIRM_LABELS[base] ?? PAID_CONFIRM_LABELS.en;
  const payload = {
    friendly_name: `saamagrii_paid_confirm_${base}_${Date.now()}`,
    language: 'en',
    types: {
      'twilio/quick-reply': {
        body: l.body,
        actions: [
          { type: 'QUICK_REPLY', title: clampTitle(l.button), id: 'confirm_paid' }
        ]
      }
    }
  };
  const { data } = await axios.post(CONTENT_API_URL, payload, {
    auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
  });
  console.log(`[contentCache] Created Paid-Confirm for ${lang}: ContentSid=${data.sid}`);
  return data.sid;
}

// lang -> { quickReplySid, listPickerSid, trialCtaSid, paidCtaSid, ts }
const sidsByLang = new Map();

async function ensureLangTemplates(lang) {
const language = normalizeLangForContent(lang);
  // Fast path with TTL
  const cached = sidsByLang.get(language);
  if (cached && (Date.now() - (cached.ts || 0) < TTL_MS)) {
    return cached;
  }
  // (Re)create or fetch once
  const created = await actuallyCreateOrFetchTemplates(language);
  const bundle = {
    quickReplySid : created?.quickReplySid || null,
    listPickerSid : created?.listPickerSid || null,
    trialCtaSid   : created?.trialCtaSid   || null,
    paidCtaSid    : created?.paidCtaSid    || null,
    paidConfirmSid: created?.paidConfirmSid ?? null,
    onboardingQrSid: created?.onboardingQrSid ?? null,
    ts            : Date.now()
  };
  sidsByLang.set(language, bundle);
  return bundle;
}

function getLangSids(lang) {  
 const language = normalizeLangForContent(lang);
   // Prefer cache; if not present, return nulls rather than force creation here.
   // The caller should have invoked ensureLangTemplates(language) first.
   return sidsByLang.get(language) || {
     quickReplySid : null,
     listPickerSid : null,
     trialCtaSid   : null,
     paidCtaSid    : null,
     paidConfirmSid: null,
     onboardingQrSid: null
   };
}

// =========================
// Helper (rename your existing builder to this, or inline your current logic)
// =========================
async function actuallyCreateOrFetchTemplates(language) {
// Create all four pieces of content programmatically; no approval needed
  // for session (inbound) use within 24h window.
  const [quickReplySid, listPickerSid] = await Promise.all([
    createQuickReplyForLang(language),
    createListPickerForLang(language)
  ]);
  // Trial/Paid CTAs and Onboarding QR are independent; errors shouldn't block menus
  let trialCtaSid = null, paidCtaSid = null;
  let onboardingQrSid = null;
  let paidConfirmSid = null;
  try { trialCtaSid = await createActivateTrialCTAForLang(language); } catch (e) {
    console.warn('[contentCache] Trial CTA create failed:', e?.response?.data || e?.message);
  }
  try { paidCtaSid = await createActivatePaidCTAForLang(language); } catch (e) {
    console.warn('[contentCache] Paid CTA create failed:', e?.response?.data || e?.message);
  }  
  try { paidConfirmSid = await createPaidConfirmCTAForLang(language); } catch (e) {
      console.warn('[contentCache] Paid-Confirm CTA create failed:', e?.response?.data ?? e?.message);
    }
  try { onboardingQrSid = await createOnboardingQuickReplyForLang(language); } catch (e) {
      console.warn('[contentCache] Onboarding QR create failed:', e?.response?.data ?? e?.message);
    }
  return { quickReplySid, listPickerSid, trialCtaSid, paidCtaSid, onboardingQrSid, paidConfirmSid };
}

module.exports = { ensureLangTemplates, getLangSids };
