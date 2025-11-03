 const axios = require('axios');

 const ACCOUNT_SID = process.env.ACCOUNT_SID;
 const AUTH_TOKEN  = process.env.AUTH_TOKEN;
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
      reorder: ['रीऑर्डर सजेस्टions',        ''],
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


 const cache = new Map(); // lang -> { quickReplySid, listPickerSid, ts }

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
        button: l.button,
        items: [
          { item: it.short[0],   id: 'list_short_summary',    description: it.short[1]   },
          { item: it.full[0],    id: 'list_full_summary',     description: it.full[1]    },
          { item: it.low[0],     id: 'list_low',              description: it.low[1]     },
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

 async function ensureLangTemplates(lang = 'en') {
   const now = Date.now();
   const entry = cache.get(lang);
   if (entry && (now - entry.ts) < TTL_MS) return entry;
   const quickReplySid = await createQuickReplyForLang(lang);
   const listPickerSid = await createListPickerForLang(lang);
   const updated = { quickReplySid, listPickerSid, ts: now };
   cache.set(lang, updated);
   console.log(`[contentCache] Cached SIDs for ${lang}: QR=${quickReplySid}, LP=${listPickerSid}`);
   return updated;
 }

 function getLangSids(lang = 'en') {
   return cache.get(lang) || null;
 }

 module.exports = { ensureLangTemplates, getLangSids };
