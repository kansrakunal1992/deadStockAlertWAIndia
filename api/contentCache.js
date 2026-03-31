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

// --- NEW: Undo-correction CTA (single-button quick reply) ---
const UNDO_CORRECTION_LABELS = { 
  en: { body: 'Mistake? Press Undo within 5 min. Ignore to auto-lock.', button: 'Undo' },
  hi: { body: 'गलती हुई? 5 मिनट में Undo दबाएँ। Ignore करेंगे तो अपने-आप लॉक हो जाएगा.', button: 'Undo' },
  gu: { body: 'ભૂલ થઈ? 5 મિનિટમાં Undo દબાવો. Ignore કરશો તો આપમેળે લોક થઈ જશે.', button: 'Undo' },
  ta: { body: 'தவறா? 5 நிமிடத்தில் Undo அழுத்தவும். கவனிக்காவிட்டால் தானாக பூட்டப்படும்.', button: 'Undo' },
  te: { body: 'తప్పా? 5 నిమిషాల్లో Undo నొక్కండి. Ignore చేస్తే ఆటో-లాక్ అవుతుంది.', button: 'Undo' },
  kn: { body: 'ತಪ್ಪಾ? 5 ನಿಮಿಷಗಳಲ್ಲಿ Undo ಒತ್ತಿ. Ignore ಮಾಡಿದರೆ ಸ್ವಯಂ ಲಾಕ್.', button: 'Undo' },
  mr: { body: 'चूक झाली? 5 मिनिटांत Undo दाबा. Ignore केल्यास आपोआप लॉक होईल.', button: 'Undo' },
  bn: { body: 'ভুল হয়েছে? ৫ মিনিটে Undo চাপুন। Ignore করলে নিজে থেকেই লক হবে।', button: 'Undo' }
};

if (!ACCOUNT_SID || !AUTH_TOKEN) {
   console.warn('[contentCache] No Twilio creds -- Content API disabled (Meta mode)');
 }

async function createUndoCorrectionCTAForLang(lang) {
  const base = normalizeLangForContent(lang);

  const undoTitle = getUndoLabelForLang(base);   // localized title: "Undo"/"ठीक करें"/native
  const bodyLoc   = getUndoBodyForLang(base);    // simple local body referencing the title

  const payload = {
    friendly_name: `saamagrii_undo_correction_${base}_${Date.now()}`,
    language: base,
    types: {
      'twilio/quick-reply': {
        body: bodyLoc,
        actions: [
          { type: 'QUICK_REPLY', title: undoTitle, id: 'undo_last_txn' }
        ]
      }
    }
  };

  const { data } = await axios.post(CONTENT_API_URL, payload, {
    auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
  });
  console.log(`[contentCache] Created Undo-Correction for ${lang}: ContentSid=${data.sid}`);
  return data.sid;
}

// Helper: map script variants (e.g., 'hi-latn') to base language ('hi') for content labels
function normalizeLangForContent(lang) {
  const L = String(lang || 'en').toLowerCase();
  return L.endsWith('-latn') ? L.split('-')[0] : L;
}

// 4.a: Localized "Undo" button title (≤ 20 chars)
// Using native-script labels exactly as provided in the context.
function getUndoLabelForLang(lang) {
  const L = normalizeLangForContent(lang);
  const map = {
    en: 'Undo',
    hi: 'ठीक करें',         // Hindi
    gu: 'ઠીક કરો',          // Gujarati
    bn: 'ঠিক করুন',         // Bengali
    mr: 'दुरुस्त करा',      // Marathi (updated from "ठीक करा")
    ta: 'சரி செய்',          // Tamil
    te: 'సరి చేయండి',        // Telugu (updated from "సరిచేయి")
    pa: 'ਠੀਕ ਕਰੋ',           // Punjabi (Gurmukhi) - newly added
    // kn remains as-is (not specified in provided context)
    kn: 'ಸರಿಪಡಿಸಿ'          // Kannada (retained)
  };
  const label = map[L] ?? map.en;
  return clampTitle(label); // Twilio quick-reply title limit ≤ 20 (see MAX_QR_TITLE)
}

// 4.b: Local body text lines that reference the localized button title.
// Phrases aligned exactly to the provided native-script context.
function getUndoBodyForLang(lang) {
  const L = normalizeLangForContent(lang);
  const undo = getUndoLabelForLang(L); // embeds localized button text
  const map = {        
    en: `Made a mistake? Tap "${undo}" within 5 minutes to revert.`,
        hi: `कोई गलती हुई है? 5 मिनट के भीतर "${undo}" दबाएँ।`,
        gu: `કોઈ ભૂલ થઈ છે? 5 મિનિટમાં "${undo}" દબાવો.`,
        bn: `ভুল হয়েছে? ৫ মিনিটের মধ্যে "${undo}" চাপুন।`,
        mr: `चूक झाली आहे का? 5 मिनिटांत "${undo}" दाबा.`,
        ta: `ஏதாவது தவறு நடந்ததா? 5 நிமிடங்களுக்குள் "${undo}" அழுத்தவும்.`,
        te: `ఏదైనా తప్పు జరిగిందా? 5 నిమిషాల్లో "${undo}" నొక్కండి.`,
        pa: `ਕੋਈ ਗਲਤੀ ਹੋ ਗਈ ਹੈ? 5 ਮਿੰਟਾਂ ਵਿੱਚ "${undo}" ਦਬਾਓ।`,
        kn: `ತಪ್ಪಾ? 5 ನಿಮಿಷಗಳಲ್ಲಿ "${undo}" ಒತ್ತಿ.`
  };
  return map[L] ?? map.en;
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
    exp0: ['समाप्त समान', ''], 
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
      en: { body: '🆓 Start your FREE trial (3 days). No payment/card needed.', button: 'Start Free Trial' },
      hi: { body: '🆓 3 दिन का फ्री ट्रायल शुरू करें। कोई पेमेंट/कार्ड नहीं।', button: 'फ्री ट्रायल शुरू करें' },
      gu: { body: '🆓 3 દિવસનો ફ્રી ટ્રાયલ શરૂ કરો. પેમેન્ટ/કાર્ડ નહીં.', button: 'ફ્રી ટ્રાયલ શરૂ કરો' },
      ta: { body: '🆓 3 நாட்கள் இலவச ட்ரயல் தொடங்குங்கள். பணம்/கார்டு தேவையில்லை.', button: 'இலவச ட்ரயல்' },
      te: { body: '🆓 3 రోజుల ఉచిత ట్రయల్ ప్రారంభించండి. చెల్లింపు/కార్డు అవసరం లేదు.', button: 'ఉచిత ట్రయల్' },
      kn: { body: '🆓 3 ದಿನಗಳ ಉಚಿತ ಟ್ರಯಲ್ ಪ್ರಾರಂಭಿಸಿ. ಪಾವತಿ/ಕಾರ್ಡ್ ಅಗತ್ಯವಿಲ್ಲ.', button: 'ಉಚಿತ ಟ್ರಯಲ್' },
      mr: { body: '🆓 3 दिवसांचा फ्री ट्रायल सुरू करा. पेमेंट/कार्डची गरज नाही.', button: 'फ्री ट्रायल सुरू करा' },
      bn: { body: '🆓 ৩ দিনের ফ্রি ট্রায়াল শুরু করুন। পেমেন্ট/কার্ড লাগবে না।', button: 'ফ্রি ট্রায়াল' }
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

// ——— NEW: 3-button Onboarding Quick-Reply (Start Free Trial • Demo • Help) ———
// Keep titles short (≤ 20) in every language.
const ONBOARDING_QR_LABELS = {
  en: { body: 'Get started — no payment needed', start: 'Start Free Trial', demo: 'Demo', help: 'Help' },
  hi: { body: 'शुरुआत करें — कोई पेमेंट नहीं', start: 'फ्री ट्रायल शुरू करें', demo: 'डेमो', help: 'मदद' },
  gu: { body: 'શરૂઆત કરો — પેમેન્ટ નહીં',     start: 'ફ્રી ટ્રાયલ શરૂ કરો', demo: 'ડેમો', help: 'મદદ' },
  ta: { body: 'தொடங்குங்கள் — பணம் தேவையில்லை', start: 'இலவச ட்ரயல்', demo: 'டெமோ', help: 'உதவி' },
  te: { body: 'ప్రారంభించండి — చెల్లింపు లేదు', start: 'ఉచిత ట్రయల్', demo: 'డెమో', help: 'సహాయం' }, // clamp will enforce length
  kn: { body: 'ಆರಂಭಿಸಿ — ಪಾವತಿ ಇಲ್ಲ',          start: 'ಉಚಿತ ಟ್ರಯಲ್', demo: 'ಡೆಮೊ', help: 'ಸಹಾಯ' },
  mr: { body: 'सुरुवात करा — पेमेंट नाही',     start: 'फ्री ट्रायल सुरू करा', demo: 'डेमो', help: 'मदत' },
  bn: { body: 'শুরু করুন — পেমেন্ট লাগবে না',  start: 'ফ্রি ট্রায়াল', demo: 'ডেমো', help: 'সাহায্য' }
};

// ——— NEW: Existing user chooser QR (Pick existing products • Add new product) ———
// Titles are clamped to <= 20 chars by clampTitle().
const EXISTING_USER_PRODUCT_MODE_QR_LABELS = {  
  en: { body: 'How do you want to add items?', pick: 'Choose existing', add: 'Add new product' },
  hi: { body: 'आप कैसे जोड़ना चाहेंगे?', pick: 'पुराना चुनें', add: 'नया प्रोडक्ट जोड़ें' },
  bn: { body: 'কীভাবে যোগ করবেন?', pick: 'আগেরটা বাছুন', add: 'নতুন পণ্য যোগ' },
  ta: { body: 'எப்படி சேர்க்க விரும்புகிறீர்?', pick: 'இருப்பதை தேர்வு', add: 'புதிய பொருள்' },
  te: { body: 'ఎలా జోడించాలి?', pick: 'ఉన్నది ఎంచుకో', add: 'కొత్త ప్రోడక్ట్' },
  kn: { body: 'ಹೇಗೆ ಸೇರಿಸಬೇಕು?', pick: 'ಇರಿರುವದು ಆಯ್ಕೆ', add: 'ಹೊಸ ಪ್ರೊಡಕ್ಟ್' },
  mr: { body: 'कसं जोडायचं?', pick: 'जुने निवडा', add: 'नवीन प्रॉडक्ट' },
  gu: { body: 'કેવી રીતે ઉમેરશો?', pick: 'હાલનું પસંદ', add: 'નવું પ્રોડક્ટ' }
};

// ——— NEW: Demo Practice Mode (1/3, 2/3, 3/3) single-button quick replies ———
// Titles must be <= 20 chars; clampTitle() enforces.
const DEMO_PRACTICE_QR_LABELS = {
  en: { t1: 'Practice Mode (1/3)', t2: 'Practice Mode (2/3)', t3: 'Practice Mode (3/3)' },
  hi: { t1: 'प्रैक्टिस मोड (1/3)', t2: 'प्रैक्टिस मोड (2/3)', t3: 'प्रैक्टिस मोड (3/3)' },
  bn: { t1: 'প্র্যাকটিস মোড (1/3)', t2: 'প্র্যাকটিস মোড (2/3)', t3: 'প্র্যাকটিস মোড (3/3)' },
  gu: { t1: 'પ્રેક્ટિસ મોડ (1/3)', t2: 'પ્રેક્ટિસ મોડ (2/3)', t3: 'પ્રેક્ટિસ મોડ (3/3)' },
  ta: { t1: 'பிராக்டிஸ் (1/3)', t2: 'பிராக்டிஸ் (2/3)', t3: 'பிராக்டிஸ் (3/3)' },
  te: { t1: 'ప్రాక్టీస్ (1/3)', t2: 'ప్రాక్టీస్ (2/3)', t3: 'ప్రాక్టీస్ (3/3)' },
  kn: { t1: 'ಪ್ರಾಕ್ಟೀಸ್ (1/3)', t2: 'ಪ್ರಾಕ್ಟೀಸ್ (2/3)', t3: 'ಪ್ರಾಕ್ಟೀಸ್ (3/3)' },
  mr: { t1: 'प्रॅक्टिस (1/3)', t2: 'प्रॅक्टिस (2/3)', t3: 'प्रॅक्टिस (3/3)' },
};

// NEW: Demo practice prompt for step (2/3) — ask for product name, quantity & price (generic example)
const DEMO_PRACTICE_PROMPTS = {
  en: 'Now share product name, quantity & price.\nExample: Milk 2 ltr @ ₹50',
  hi: 'अब प्रोडक्ट का नाम, मात्रा और कीमत भेजें।\nउदाहरण: दूध 2 लीटर @ ₹50',
  bn: 'এখন পণ্যের নাম, পরিমাণ ও দাম পাঠান।\nউদাহরণ: দুধ 2 লিটার @ ₹50',
  gu: 'હવે પ્રોડક્ટનું નામ, જથ્થો અને ભાવ મોકલો.\nઉદાહરણ: દૂધ 2 લિટર @ ₹50',
  ta: 'இப்போது பொருள் பெயர், அளவு & விலை அனுப்புங்கள்.\nஉதாரணம்: பால் 2 லிட்டர் @ ₹50',
  te: 'ఇప్పుడు ప్రోడక్ట్ పేరు, పరిమాణం & ధర పంపండి.\nఉదాహరణ: పాలు 2 లీటర్ @ ₹50',
  kn: 'ಈಗ ಉತ್ಪನ್ನ ಹೆಸರು, ಪ್ರಮಾಣ & ಬೆಲೆ ಕಳುಹಿಸಿ.\nಉದಾಹರಣೆ: ಹಾಲು 2 ಲೀಟರ್ @ ₹50',
  mr: 'आता प्रॉडक्टचे नाव, प्रमाण आणि किंमत पाठवा.\nउदाहरण: दूध 2 लिटर @ ₹50',
};

// NEW: Demo practice click-hints for steps (1/3) and (2/3)
const DEMO_PRACTICE_CLICK_HINTS = {
  // {btn} will be replaced with the localized button title shown to the user
  en: { s1: 'Tap the button below “{btn}” to record a purchase.', s2: 'Tap the button below “{btn}” to add a new product.' },
  hi: { s1: 'नीचे दिए बटन “{btn}” पर क्लिक करें — खरीद दर्ज करने के लिए।', s2: 'नीचे दिए बटन “{btn}” पर क्लिक करें — नया प्रोडक्ट जोड़ने के लिए।' },
  bn: { s1: 'নিচের বাটন “{btn}” চাপ দিন — ক্রয় নথিভুক্ত করতে।', s2: 'নিচের বাটন “{btn}” চাপ দিন — নতুন পণ্য যোগ করতে।' },
  gu: { s1: 'નીચેના બટન “{btn}” પર ક્લિક કરો — ખરીદી નોંધવા માટે।', s2: 'નીચેના બટન “{btn}” પર ક્લિક કરો — નવું પ્રોડક્ટ ઉમેરવા માટે।' },
  ta: { s1: 'கீழே உள்ள “{btn}” பொத்தானை அழுத்துங்கள் — கொள்முதல் பதிவு செய்ய.', s2: 'கீழே உள்ள “{btn}” பொத்தானை அழுத்துங்கள் — புதிய பொருள் சேர்க்க.' },
  te: { s1: 'క్రింది బటన్ “{btn}” నొక్కండి — కొనుగోలు నమోదు చేయడానికి.', s2: 'క్రింది బటన్ “{btn}” నొక్కండి — కొత్త ప్రోడక్ట్ జోడించడానికి.' },
  kn: { s1: 'ಕೆಳಗಿನ ಬಟನ್ “{btn}” ಒತ್ತಿ — ಖರೀದಿ ನೋಂದಣಿ ಮಾಡಲು.', s2: 'ಕೆಳಗಿನ ಬಟನ್ “{btn}” ಒತ್ತಿ — ಹೊಸ ಪ್ರೊಡಕ್ಟ್ ಸೇರಿಸಲು.' },
  mr: { s1: 'खालील बटन “{btn}” दाबा — खरेदी नोंदवण्यासाठी.', s2: 'खालील बटन “{btn}” दाबा — नवीन प्रॉडक्ट जोडण्यासाठी.' },
};

async function createDemoPractice1QRForLang(lang) {
  const base = normalizeLangForContent(lang);
  const l = DEMO_PRACTICE_QR_LABELS[base] ?? DEMO_PRACTICE_QR_LABELS.en;
  const btnTitle = clampTitle((QR_LABELS[base] ?? QR_LABELS.en).purchase);
  const payload = {
    friendly_name: `saamagrii_demo_practice_1_${base}_${Date.now()}`,
    language: base,
    types: {
      'twilio/quick-reply': {
       body: `${l.t1}\n${((DEMO_PRACTICE_CLICK_HINTS[base] ?? DEMO_PRACTICE_CLICK_HINTS.en).s1).replace('{btn}', btnTitle)}`,
        actions: [ { type: 'QUICK_REPLY', title: btnTitle, id: 'demo_purchase' } ]
      }
    }
  };
  const { data } = await axios.post(CONTENT_API_URL, payload, { auth: { username: ACCOUNT_SID, password: AUTH_TOKEN } });
  console.log(`[contentCache] Created Demo-Practice-1 for ${lang}: ContentSid=${data.sid}`);
  return data.sid;
}

async function createDemoPractice2QRForLang(lang) {
  const base = normalizeLangForContent(lang);
  const l = DEMO_PRACTICE_QR_LABELS[base] ?? DEMO_PRACTICE_QR_LABELS.en;
  const btnTitle = clampTitle((EXISTING_USER_PRODUCT_MODE_QR_LABELS[base] ?? EXISTING_USER_PRODUCT_MODE_QR_LABELS.en).add);
  const payload = {
    friendly_name: `saamagrii_demo_practice_2_${base}_${Date.now()}`,
    language: base,
    types: {
      'twilio/quick-reply': {                    
            body: `${l.t2}\n${((DEMO_PRACTICE_CLICK_HINTS[base] ?? DEMO_PRACTICE_CLICK_HINTS.en).s2).replace('{btn}', btnTitle)}`,
            actions: [ { type: 'QUICK_REPLY', title: btnTitle, id: 'demo_add_product' } ]
      }
    }
  };
  const { data } = await axios.post(CONTENT_API_URL, payload, { auth: { username: ACCOUNT_SID, password: AUTH_TOKEN } });
  console.log(`[contentCache] Created Demo-Practice-2 for ${lang}: ContentSid=${data.sid}`);
  return data.sid;
}

async function createDemoPractice3QRForLang(lang) {
  const base = normalizeLangForContent(lang);
  const l = DEMO_PRACTICE_QR_LABELS[base] ?? DEMO_PRACTICE_QR_LABELS.en;
  const payload = {
    friendly_name: `saamagrii_demo_practice_3_${base}_${Date.now()}`,
    language: base,
    types: {
      'twilio/quick-reply': {
        body: l.t3,
        actions: [ { type: 'QUICK_REPLY', title: clampTitle(l.t3), id: 'demo_practice_3' } ]
      }
    }
  };
  const { data } = await axios.post(CONTENT_API_URL, payload, { auth: { username: ACCOUNT_SID, password: AUTH_TOKEN } });
  console.log(`[contentCache] Created Demo-Practice-3 for ${lang}: ContentSid=${data.sid}`);
  return data.sid;
}

// ——— NEW: Demo flow single-button QRs (Step A / Step B) ———
// IDs MUST match whatsapp.js handlers: demo_purchase, demo_add_product
// Titles must be <= 20 chars (clampTitle enforces).
const DEMO_QR_LABELS = {
  en: { bodyA: 'Practice (1/3)', bodyB: 'Practice (2/3)' },
  hi: { bodyA: 'Practice (1/3)', bodyB: 'Practice (2/3)' },
  bn: { bodyA: 'Practice (1/3)', bodyB: 'Practice (2/3)' },
  gu: { bodyA: 'Practice (1/3)', bodyB: 'Practice (2/3)' },
  ta: { bodyA: 'Practice (1/3)', bodyB: 'Practice (2/3)' },
  te: { bodyA: 'Practice (1/3)', bodyB: 'Practice (2/3)' },
  kn: { bodyA: 'Practice (1/3)', bodyB: 'Practice (2/3)' },
  mr: { bodyA: 'Practice (1/3)', bodyB: 'Practice (2/3)' },
};

async function createDemoPurchaseQRForLang(lang) {
  const base = normalizeLangForContent(lang);
  const l = DEMO_QR_LABELS[base] ?? DEMO_QR_LABELS.en;
  // Reuse purchase title from your QR_LABELS
  const title = clampTitle((QR_LABELS[base] ?? QR_LABELS.en).purchase);
  const payload = {
    friendly_name: `saamagrii_demo_purchase_${base}_${Date.now()}`,
    language: base,
    types: {
      'twilio/quick-reply': {
        body: l.bodyA,
        actions: [
          { type: 'QUICK_REPLY', title, id: 'demo_purchase' }
        ]
      }
    }
  };
  const { data } = await axios.post(CONTENT_API_URL, payload, {
    auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
  });
  console.log(`[contentCache] Created Demo-Purchase for ${lang}: ContentSid=${data.sid}`);
  return data.sid;
}

async function createDemoAddProductQRForLang(lang) {
  const base = normalizeLangForContent(lang);
  const l = DEMO_QR_LABELS[base] ?? DEMO_QR_LABELS.en;
  // Reuse "add" title from your existing chooser labels (already <=20 via clampTitle)
  const title = clampTitle((EXISTING_USER_PRODUCT_MODE_QR_LABELS[base] ?? EXISTING_USER_PRODUCT_MODE_QR_LABELS.en).add);
  const payload = {
    friendly_name: `saamagrii_demo_add_product_${base}_${Date.now()}`,
    language: base,
    types: {
      'twilio/quick-reply': {
        body: l.bodyB,
        actions: [
          { type: 'QUICK_REPLY', title, id: 'demo_add_product' }
        ]
      }
    }
  };
  const { data } = await axios.post(CONTENT_API_URL, payload, {
    auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
  });
  console.log(`[contentCache] Created Demo-Add-Product for ${lang}: ContentSid=${data.sid}`);
  return data.sid;
}

async function createOnboardingQuickReplyForLang(lang) {
  const base = normalizeLangForContent(lang);
  const l = ONBOARDING_QR_LABELS[base] ?? ONBOARDING_QR_LABELS.en;
  const payload = {
    friendly_name: `saamagrii_onboard_qr_${lang}_${Date.now()}`,
    language: base,
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

// ——— NEW: Existing-user product mode chooser (2-button quick reply) ———
async function createExistingUserProductModeQRForLang(lang) {
  const base = normalizeLangForContent(lang);
  const l = EXISTING_USER_PRODUCT_MODE_QR_LABELS[base] ?? EXISTING_USER_PRODUCT_MODE_QR_LABELS.en;
  const payload = {
    friendly_name: `saamagrii_existing_product_mode_${base}_${Date.now()}`,
    language: base,
    types: {
      'twilio/quick-reply': {
        body: l.body,
        actions: [
          { type: 'QUICK_REPLY', title: clampTitle(l.add), id: 'add_new_product_as_is' }
        ]
      }
    }
  };
  const { data } = await axios.post(CONTENT_API_URL, payload, {
    auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
  });
  console.log(`[contentCache] Created Existing-User Product Mode QR for ${lang}: ContentSid=${data.sid}`);
  return data.sid;
}

 async function createQuickReplyForLang(lang) {       
   const base = normalizeLangForContent(lang);
   const l = QR_LABELS[base] ?? QR_LABELS.en;
   const payload = {
    friendly_name: `saamagrii_welcome_qr_${base}_${Date.now()}`,
     language: base, // stamp correct metadata for diagnostics/consistency
     types: {
       'twilio/quick-reply': {
         body: l.body,
         actions: [                         
              { type: 'QUICK_REPLY', title: clampTitle(l.purchase), id: 'qr_purchase' },
              { type: 'QUICK_REPLY', title: clampTitle(l.sale),     id: 'qr_sale'     },
              { type: 'QUICK_REPLY', title: clampTitle(l.ret),      id: 'qr_return'   }
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
    language: base, // metadata aligned to base language
    types: {
      'twilio/list-picker': {              
      body: l.body,
      button: clampTitle(l.button),   // clamp expand button text as well              
      items: [                             
              { item: clampItem(it.short[0]),  id: 'list_short_summary',   description: it.short[1]  },
              { item: clampItem(it.full[0]),   id: 'list_full_summary',    description: it.full[1]   },
              { item: clampItem(it.low[0]),    id: 'list_low',             description: it.low[1]    },
              { item: clampItem(it.reorder[0]),id: 'list_reorder_suggest', description: it.reorder[1]},
              { item: clampItem(it.exp0[0]),   id: 'list_expiring',        description: it.exp0[1]   },
              { item: clampItem(it.exp30[0]),  id: 'list_expiring_30',     description: it.exp30[1]  },
              { item: clampItem(it.salesD[0]), id: 'list_sales_day',       description: it.salesD[1] },
              { item: clampItem(it.salesW[0]), id: 'list_sales_week',      description: it.salesW[1] },
              { item: clampItem(it.top[0]),    id: 'list_top_month',       description: it.top[1]    },
              { item: clampItem(it.value[0]),  id: 'list_value',           description: it.value[1]  }
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
    language: base,
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
    language: base,
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
    language: base,
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
  return getLangSids(lang);
console.log(`[contentCache] ensureLangTemplates(lang=${lang})`);
const language = normalizeLangForContent(lang);
  // Fast path with TTL
  const cached = sidsByLang.get(language);
  if (cached && (Date.now() - (cached.ts || 0) < TTL_MS)) {      
  //console.log(`[contentCache] cache-hit for ${language}`, {
  //      quickReplySid      : !!cached.quickReplySid,
  //      listPickerSid      : !!cached.listPickerSid,
  //      trialCtaSid        : !!cached.trialCtaSid,
  //      paidCtaSid         : !!cached.paidCtaSid,
  //      paidConfirmSid     : !!cached.paidConfirmSid,
  //      onboardingQrSid    : !!cached.onboardingQrSid,
  //      correctionUndoSid  : !!cached.correctionUndoSid,
  //      ts                 : cached.ts
  //    });
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
    existingProductModeQrSid: created?.existingProductModeQrSid ?? null,
    demoPractice1Sid: created?.demoPractice1Sid ?? null,
    demoPractice2Sid: created?.demoPractice2Sid ?? null,
    demoPractice3Sid: created?.demoPractice3Sid ?? null,
    correctionUndoSid: created?.correctionUndoSid ?? null, // NEW
    demoPurchaseSid: created?.demoPurchaseSid ?? null,     // NEW
    demoAddProductSid: created?.demoAddProductSid ?? null, // NEW
    ts            : Date.now()
  };
  sidsByLang.set(language, bundle);
    
  console.log(`[contentCache] cache-set for ${language}`, {
      quickReplySid      : !!bundle.quickReplySid,
      listPickerSid      : !!bundle.listPickerSid,
      trialCtaSid        : !!bundle.trialCtaSid,
      paidCtaSid         : !!bundle.paidCtaSid,
      paidConfirmSid     : !!bundle.paidConfirmSid,
      onboardingQrSid    : !!bundle.onboardingQrSid,
      correctionUndoSid  : !!bundle.correctionUndoSid,          
      demoPurchaseSid : !!bundle.demoPurchaseSid,
      demoAddProductSid : !!bundle.demoAddProductSid,
      ts                 : bundle.ts
    });

  return bundle;
}

function getLangSids(lang) {  
   return {
     quickReplySid: null, listPickerSid: null, trialCtaSid: null,
     paidCtaSid: null, paidConfirmSid: null, onboardingQrSid: null,
     correctionUndoSid: null, demoPurchaseSid: null, demoAddProductSid: null,
     existingProductModeQrSid: null, demoPractice1Sid: null,
     demoPractice2Sid: null, demoPractice3Sid: null
   };
   const language = normalizeLangForContent(lang);
   return sidsByLang.get(language) || {
     quickReplySid : null,
     listPickerSid : null,
     trialCtaSid   : null,
     paidCtaSid    : null,
     paidConfirmSid: null,
     onboardingQrSid: null,
     correctionUndoSid: null // NEW     
     ,demoPurchaseSid: null  // NEW
     ,demoAddProductSid: null // NEW
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
  let correctionUndoSid = null; // NEW
  let onboardingQrSid = null;
  let existingProductModeQrSid = null;
  let paidConfirmSid = null;        
  let demoPractice1Sid = null;
  let demoPractice2Sid = null;
  let demoPractice3Sid = null;
  let demoPurchaseSid = null;
  let demoAddProductSid = null;    
  // NEW: Demo Practice Mode QRs
   try { demoPractice1Sid = await createDemoPractice1QRForLang(language); } catch (e) { console.warn('[contentCache] Demo-Practice-1 create failed:', e?.response?.data ?? e?.message); }
   try { demoPractice2Sid = await createDemoPractice2QRForLang(language); } catch (e) { console.warn('[contentCache] Demo-Practice-2 create failed:', e?.response?.data ?? e?.message); }
   try { demoPractice3Sid = await createDemoPractice3QRForLang(language); } catch (e) { console.warn('[contentCache] Demo-Practice-3 create failed:', e?.response?.data ?? e?.message); }
  
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
  try { existingProductModeQrSid = await createExistingUserProductModeQRForLang(language); } catch (e) {
      console.warn('[contentCache] Existing-User Product Mode QR create failed:', e?.response?.data ?? e?.message);
    }
  // NEW: Undo CTA
  try { correctionUndoSid = await createUndoCorrectionCTAForLang(language); } catch (e) { console.warn('[contentCache] Undo-Correction CTA create failed:', e?.response?.data ?? e?.message); }  
  // NEW: Demo flow QRs
  try { demoPurchaseSid = await createDemoPurchaseQRForLang(language); } catch (e) { console.warn('[contentCache] Demo-Purchase QR create failed:', e?.response?.data ?? e?.message); }
  try { demoAddProductSid = await createDemoAddProductQRForLang(language); } catch (e) { console.warn('[contentCache] Demo-Add-Product QR create failed:', e?.response?.data ?? e?.message); }
  return { quickReplySid, listPickerSid, trialCtaSid, paidCtaSid, onboardingQrSid, paidConfirmSid, correctionUndoSid, existingProductModeQrSid, demoPractice1Sid, demoPractice2Sid, demoPractice3Sid };
}

module.exports = { ensureLangTemplates, getLangSids };
