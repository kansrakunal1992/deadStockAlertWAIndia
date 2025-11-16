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

if (!ACCOUNT_SID || !AUTH_TOKEN) {
   throw new Error('Missing ACCOUNT_SID or AUTH_TOKEN');
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
      short:   ['Short Summary',           ''],
      full:    ['Full Summary',            ''],
      low:     ['Low stock',               ''],
      reorder: ['Reorder suggestions',     ''],
      exp0:    ['Expiring 0',              ''],
      exp30:   ['Expiring 30',             ''],
      salesD:  ['Sales today',             ''],
      salesW:  ['Sales week',              ''],
      top:     ['Top products month',      ''],
      value:   ['Inventory value',         '']
    }
  },
  hi: {
    body: 'इन्वेंटरी पूछें',
    button: 'एक विकल्प चुनें',
    items: {
      short:   ['शॉर्ट समरी',               ''],
      full:    ['फुल समरी',                 ''],
      low:     ['कम स्टॉक',                  ''],
      reorder: ['रीऑर्डर सुझाव',        ''],
      exp0:    ['आज एक्सपायर',               ''],
      exp30:   ['30 दिन में एक्सपायर',       ''],
      salesD:  ['आज की बिक्री',              ''],
      salesW:  ['साप्ताहिक बिक्री',          ''],
      top:     ['टॉप उत्पाद (माह)',          ''],
      value:   ['इन्वेंटरी मूल्य',            '']
    }
  },
  gu: {
    body: 'ઇન્વેન્ટરી પૂછો',
    button: 'વિકલ્પ પસંદ કરો',
    items: {
      short:   ['શોર્ટ સારાંશ',               ''],
      full:    ['ફુલ સારાંશ',                 ''],
      low:     ['ઓછો સ્ટોક',                  ''],
      reorder: ['રીઓર્ડર સૂચનો',              ''],
      exp0:    ['આજે સમાપ્તિ',                ''],
      exp30:   ['30 દિવસમાં સમાપ્તિ',         ''],
      salesD:  ['આજની વેચાણ',                 ''],
      salesW:  ['સાપ્તાહિક વેચાણ',            ''],
      top:     ['ટોપ પ્રોડક્ટ્સ (મહિનો)',      ''],
      value:   ['ઇન્વેન્ટરી મૂલ્ય',            '']
    }
  },
  ta: {
    body: 'சரக்கு கேள்வி',
    button: 'ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கவும்',
    items: {
      short:   ['சுருக்கமான சுருக்கம்',         ''],
      full:    ['முழு சுருக்கம்',               ''],
      low:     ['குறைந்த சரக்கு',                ''],
      reorder: ['மீண்டும் ஆர்டர் பரிந்துரைகள்',    ''],
      exp0:    ['இன்று காலாவதி',                ''],
      exp30:   ['30 நாட்களில் காலாவதி',          ''],
      salesD:  ['இன்றைய விற்பனை',                ''],
      salesW:  ['வார விற்பனை',                  ''],
      top:     ['சிறந்த பொருட்கள் (மாதம்)',      ''],
      value:   ['சரக்கு மதிப்பு',                 '']
    }
  },
  te: {
    body: 'ఇన్వెంటరీ ప్రశ్న',
    button: 'ఒక ఎంపికను ఎంచుకోండి',
    items: {
      short:   ['షార్ట్ సమరీ',                 ''],
      full:    ['ఫుల్ సమరీ',                   ''],
      low:     ['తక్కువ నిల్వ',                  ''],
      reorder: ['రీఆర్డర్ సూచనలు',              ''],
      exp0:    ['ఈ రోజు గడువు',                 ''],
      exp30:   ['30 రోజుల్లో గడువు',             ''],
      salesD:  ['ఈ రోజు అమ్మకాలు',               ''],
      salesW:  ['వారపు అమ్మకాలు',                ''],
      top:     ['టాప్ ఉత్పత్తులు (నెల)',         ''],
      value:   ['ఇన్వెంటరీ విలువ',               '']
    }
  },
  kn: {
    body: 'ಇನ್‌ವೆಂಟರಿ ಪ್ರಶ್ನೆ',
    button: 'ಒಂದು ಆಯ್ಕೆ ಮಾಡಿ',
    items: {
      short:   ['ಸಂಕ್ಷಿಪ್ತ ಸಾರಾಂಶ',             ''],
      full:    ['ವಿಸ್ತೃತ ಸಾರಾಂಶ',               ''],
      low:     ['ಕಡಿಮೆ ಸ್ಟಾಕ್',                   ''],
      reorder: ['ಮರು ಆರ್ಡರ್ ಸಲಹೆಗಳು',            ''],
      exp0:    ['ಇಂದು ಅವಧಿ',                     ''],
      exp30:   ['30 ದಿನಗಳಲ್ಲಿ ಅವಧಿ',              ''],
      salesD:  ['ಇಂದಿನ ಮಾರಾಟ',                   ''],
      salesW:  ['ವಾರದ ಮಾರಾಟ',                    ''],
      top:     ['ಅತ್ಯುತ್ತಮ ಉತ್ಪನ್ನಗಳು (ತಿಂಗಳು)',   ''],
      value:   ['ಇನ್‌ವೆಂಟರಿ ಮೌಲ್ಯ',               '']
    }
  },
  mr: {
    body: 'इन्व्हेंटरी विचार',
    button: 'एक पर्याय निवडा',
    items: {
      short:   ['लघु सारांश',                    ''],
      full:    ['सविस्तर सारांश',                 ''],
      low:     ['कमी साठा',                       ''],
      reorder: ['री-ऑर्डर सूचना',                 ''],
      exp0:    ['आज कालबाह्य',                    ''],
      exp30:   ['30 दिवसांत कालबाह्य',            ''],
      salesD:  ['आजची विक्री',                    ''],
      salesW:  ['साप्ताहिक विक्री',               ''],
      top:     ['टॉप उत्पादने (महिना)',           ''],
      value:   ['इन्व्हेंटरी मूल्य',              '']
    }
  },
  bn: {
    body: 'ইনভেন্টরি জিজ্ঞাসা',
    button: 'একটি অপশন বাছুন',
    items: {
      short:   ['সংক্ষিপ্ত সারাংশ',               ''],
      full:    ['পূর্ণাঙ্গ সারাংশ',                ''],
      low:     ['কম স্টক',                         ''],
      reorder: ['রিঅর্ডার সাজেশন',                 ''],
      exp0:    ['আজ মেয়াদোত্তীর্ণ',               ''],
      exp30:   ['৩০ দিনে মেয়াদোত্তীর্ণ',           ''],
      salesD:  ['আজকের বিক্রি',                    ''],
      salesW:  ['সাপ্তাহিক বিক্রি',                 ''],
      top:     ['শীর্ষ পণ্য (মাস)',                ''],
      value:   ['ইনভেন্টরি মূল্য',                 '']
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
 const ACTIVATE_PAID_LABELS = {
   en: { body: 'Upgrade to paid for uninterrupted access', button: 'Activate Paid Plan' },
   hi: { body: 'निरंतर सेवा हेतु पेड प्लान सक्रिय करें', button: 'पेड प्लान सक्रिय करें' },
   gu: { body: 'નિરંતર સેવા માટે પેઈડ પ્લાન સક્રિય કરો', button: 'પેઈડ પ્લાન સક્રિય કરો' },
   ta: { body: 'தொடர்ச்சி சேவைக்கு Paid Plan செயல்படுத்தவும்', button: 'Paid Plan செயல்படுத்து' },
   te: { body: 'నిరంతర సేవ కోసం Paid ప్లాన్ యాక్టివేట్ చేయండి', button: 'Paid ప్లాన్ యాక్టివేట్' },
   kn: { body: 'ನಿರಂತರ ಸೇವೆಗೆ ಪೈಡ್ ಪ್ಲಾನ್ ಸಕ್ರಿಯಗೊಳಿಸಿ', button: 'ಪೈಡ್ ಪ್ಲಾನ್ ಸಕ್ರಿಯಗೊಳಿಸಿ' },
   mr: { body: 'सतत सेवेसाठी पेड प्लॅन सक्रिय करा', button: 'पेड प्लॅन सक्रिय करा' },
   bn: { body: 'অবিচ্ছিন্ন সেবার জন্য Paid Plan সক্রিয় করুন', button: 'Paid Plan সক্রিয় করুন' }
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
   const l = QR_LABELS[lang] || QR_LABELS.en;
   const payload = {
    friendly_name: `saamagrii_welcome_qr_${lang}_${Date.now()}`,
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
   
const l  = LIST_LABELS[lang] ?? LIST_LABELS.en;
  const it = l.items;
  const payload = {
    friendly_name: `saamagrii_query_list_${lang}_${Date.now()}`, // force NEW ContentSid
    language: 'en',
    types: {
      'twilio/list-picker': {              
      body: l.body,
      button: clampTitle(l.button),   // clamp expand button text as well
        items: [
                   
         { item: clampItem(it.short[0]), id: 'list_short_summary', description: it.short[1] },
         { item: clampItem(it.full[0]),  id: 'list_full_summary',  description: it.full[1]  },
         { item: clampItem(it.low[0]),   id: 'list_low',           description: it.low[1]   },
          { item: it.reorder[0], id: 'list_reorder_suggest',  description: it.reorder[1] },
          { item: it.exp0[0],    id: 'list_expiring',         description: it.exp0[1]    },
          { item: it.exp30[0],   id: 'list_expiring_30',      description: it.exp30[1]   },
          { item: it.salesD[0],  id: 'list_sales_day',        description: it.salesD[1]  },
          { item: it.salesW[0],  id: 'list_sales_week',       description: it.salesW[1]  },
          { item: it.top[0],     id: 'list_top_month',        description: it.top[1]     },
          { item: it.value[0],   id: 'list_value',            description: it.value[1]   }
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
  const l = ACTIVATE_TRIAL_LABELS[lang] ?? ACTIVATE_TRIAL_LABELS.en;
  const payload = {
    friendly_name: `saamagrii_activate_trial_${lang}_${Date.now()}`,
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
  const l = ACTIVATE_PAID_LABELS[lang] ?? ACTIVATE_PAID_LABELS.en;
  const payload = {
    friendly_name: `saamagrii_activate_paid_${lang}_${Date.now()}`,
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

// lang -> { quickReplySid, listPickerSid, trialCtaSid, paidCtaSid, ts }
const sidsByLang = new Map();

async function ensureLangTemplates(lang) {
const language = String(lang || 'en').toLowerCase();
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
    onboardingQrSid: created?.onboardingQrSid ?? null,
    ts            : Date.now()
  };
  sidsByLang.set(language, bundle);
  return bundle;
}

function getLangSids(lang) {  
 const language = String(lang || 'en').toLowerCase();
   // Prefer cache; if not present, return nulls rather than force creation here.
   // The caller should have invoked ensureLangTemplates(language) first.
   return sidsByLang.get(language) || {
     quickReplySid : null,
     listPickerSid : null,
     trialCtaSid   : null,
     paidCtaSid    : null,
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
  try { trialCtaSid = await createActivateTrialCTAForLang(language); } catch (e) {
    console.warn('[contentCache] Trial CTA create failed:', e?.response?.data || e?.message);
  }
  try { paidCtaSid = await createActivatePaidCTAForLang(language); } catch (e) {
    console.warn('[contentCache] Paid CTA create failed:', e?.response?.data || e?.message);
  }    
  try { onboardingQrSid = await createOnboardingQuickReplyForLang(language); } catch (e) {
      console.warn('[contentCache] Onboarding QR create failed:', e?.response?.data ?? e?.message);
    }
  return { quickReplySid, listPickerSid, trialCtaSid, paidCtaSid, onboardingQrSid };
}

module.exports = { ensureLangTemplates, getLangSids };
