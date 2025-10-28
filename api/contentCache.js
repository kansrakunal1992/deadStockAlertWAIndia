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

 const LIST_LABELS = {
   en: {
     body: 'Query inventory', button: 'Select an option',
     items: {
       stock: ['Stock for a product', 'Check qty'],
       low: ['Low stock', 'Items ≤5'],
       exp: ['Expiring soon', 'Next 30 days'],
       sales: ['Sales today', 'Daily sales'],
       top: ['Top products (month)', 'Best sellers'],
       value: ['Inventory value', 'Est. value']
     }
   },
   hi: {
     body: 'इन्वेंटरी पूछें', button: 'एक विकल्प चुनें',
     items: {
       stock: ['किसी उत्पाद का स्टॉक', 'मात्रा देखें'],
       low: ['कम स्टॉक', '≤5 आइटम'],
       exp: ['जल्द एक्सपायर', 'अगले 30 दिन'],
       sales: ['आज की बिक्री', 'दैनिक सार'],
       top: ['शीर्ष उत्पाद (माह)', 'सबसे अधिक बिकने वाले'],
       value: ['इन्वेंटरी मूल्य', 'अनुमानित']
     }
   },
   gu: {
     body: 'ઇન્વેન્ટરી પૂછો', button: 'વિકલ્પ પસંદ કરો',
     items: {
       stock: ['કોઈ પ્રોડક્ટનો સ્ટોક', 'જથ્થો જુઓ'],
       low: ['ઓછો સ્ટોક', '≤5 વસ્તુઓ'],
       exp: ['જલ્દી સમાપ્ત', 'આગામી 30 દિવસ'],
       sales: ['આજની વેચાણ', 'દૈનિક સાર'],
       top: ['ટોપ પ્રોડક્ટ (મહિનો)', 'બેસ્ટ સેલર્સ'],
       value: ['ઇન્વેન્ટરી મૂલ્ય', 'અંદાજિત']
     }
   },
   ta: {
     body: 'சரக்கு கேள்வி', button: 'விருப்பமொன்றைத் தேர்ந்தெடுக்கவும்',
     items: {
       stock: ['ஒரு பொருளின் இருப்பு', 'அளவு பார்க்க'],
       low: ['குறைவு இருப்பு', '≤5 ஐட்டங்கள்'],
       exp: ['விரைவில் காலாவதி', 'அடுத்த 30 நாட்கள்'],
       sales: ['இன்றைய விற்பனை', 'தினசரி சுருக்கம்'],
       top: ['சிறந்த பொருட்கள் (மாதம்)', 'அதிக விற்பனை'],
       value: ['இருப்பு மதிப்பு', 'மதிப்பீடு']
     }
   },
   te: {
     body: 'ఇన్వెంటరీ ప్రశ్న', button: 'ఒక ఎంపికను ఎంచుకోండి',
     items: {
       stock: ['ఉత్పత్తి నిల్వ', 'మొత్తం చూడండి'],
       low: ['తక్కువ నిల్వ', '≤5 అంశాలు'],
       exp: ['త్వరలో గడువు', 'తదుపరి 30రోజులు'],
       sales: ['ఈరోజు అమ్మకాలు', 'దినసరి సారాంశం'],
       top: ['టాప్ ఉత్పత్తులు (నెల)', 'బెస్ట్ సెలర్స్'],
       value: ['ఇన్వెంటరీ విలువ', 'అంచనా']
     }
   },
   kn: {
     body: 'ಇನ್‌ವೆಂಟರಿ ವಿಚಾರಿಸಿ', button: 'ಒಂದು ಆಯ್ಕೆ ಮಾಡಿ',
     items: {
       stock: ['ಉತ್ಪನ್ನದ ಸ್ಟಾಕ್', 'ಪ್ರಮಾಣ ನೋಡಿ'],
       low: ['ಕಡಿಮೆ ಸ್ಟಾಕ್', '≤5 ಐಟಂ'],
       exp: ['ಶೀಘ್ರವೇ ಅವಧಿ', 'ಮುಂದು 30 ದಿನ'],
       sales: ['ಇಂದಿನ ಮಾರಾಟ', 'ದೈನಂದಿನ ಸಾರಾಂಶ'],
       top: ['ಅತ್ಯುತ್ತಮ ಉತ್ಪನ್ನಗಳು (ತಿಂಗಳು)', 'ಬೆಸ್ಟ್ ಸೆಲ್ಲರ್ಸ್'],
       value: ['ಇನ್‌ವೆಂಟರಿ ಮೌಲ್ಯ', 'ಅಂದಾಜು']
     }
   },
   mr: {
     body: 'इन्व्हेंटरी चौकशी', button: 'पर्याय निवडा',
     items: {
       stock: ['उत्पादनाचा साठा', 'प्रमाण पहा'],
       low: ['कमी साठा', '≤5 वस्तू'],
       exp: ['लवकरच कालबाह्य', 'पुढील 30 दिवस'],
       sales: ['आजची विक्री', 'दैनिक सार'],
       top: ['शीर्ष उत्पादने (महिना)', 'बेस्ट सेलर्स'],
       value: ['साठ्याचे मूल्य', 'अंदाजित']
     }
   },
   bn: {
     body: 'ইনভেন্টরি জিজ্ঞাসা', button: 'একটি অপশন বাছুন',
     items: {
       stock: ['কোনো পণ্যের স্টক', 'পরিমাণ দেখুন'],
       low: ['স্টক কম', '≤5টি আইটেম'],
       exp: ['শিগগির মেয়াদোত্তীর্ণ', 'আগামী ৩০ দিন'],
       sales: ['আজকের বিক্রি', 'দৈনিক সার'],
       top: ['শীর্ষ পণ্য (মাস)', 'বেস্ট সেলার'],
       value: ['স্টক মূল্য', 'আনুমানিক']
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
   const l = LIST_LABELS[lang] || LIST_LABELS.en;
   const items = l.items;
   const payload = {
     friendly_name: `saamagrii_query_list_${lang}_${Date.now()}`,
     language: 'en',
     types: {
       'twilio/list-picker': {
         body: l.body,
         button: l.button,
         items: [
           { item: items.stock[0], id: 'list_stock',    description: items.stock[1] },
           { item: items.low[0],   id: 'list_low',      description: items.low[1] },
           { item: items.exp[0],   id: 'list_expiring', description: items.exp[1] },
           { item: items.sales[0], id: 'list_sales_day',description: items.sales[1] },
           { item: items.top[0],   id: 'list_top_month',description: items.top[1] },
           { item: items.value[0], id: 'list_value',    description: items.value[1] }
         ]
       }
     }
   };
   const { data } = await axios.post(CONTENT_API_URL, payload, {
     auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
   });
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
   return updated;
 }

 function getLangSids(lang = 'en') {
   return cache.get(lang) || null;
 }

 module.exports = { ensureLangTemplates, getLangSids };
