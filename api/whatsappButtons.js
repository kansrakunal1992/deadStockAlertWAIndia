const axios = require('axios');
// Support both env schemes: ACCOUNT_SID/AUTH_TOKEN or TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN
const ACCOUNT_SID = process.env.ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN  = process.env.AUTH_TOKEN  || process.env.TWILIO_AUTH_TOKEN;
const MSID        = process.env.MESSAGING_SERVICE_SID || process.env.MSID || '';
const FROM_WA     = process.env.TWILIO_WHATSAPP_NUMBER || process.env.WHATSAPP_FROM || '';
 
if (!ACCOUNT_SID || !AUTH_TOKEN) {
  throw new Error('Missing ACCOUNT_SID/TWILIO_ACCOUNT_SID or AUTH_TOKEN/TWILIO_AUTH_TOKEN');
}
if (!MSID && !FROM_WA) {
  throw new Error('Provide MESSAGING_SERVICE_SID (preferred) or TWILIO_WHATSAPP_NUMBER');
}

const CONTENT_API_URL  = 'https://content.twilio.com/v1/Content';
const MESSAGES_API_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
const DEFAULT_TIMEOUT  = Number(process.env.TWILIO_HTTP_TIMEOUT_MS || 15000);
const RETRY_STATUSES   = new Set([429, 500, 502, 503, 504]);

 // ---- Create Quick Reply (3 buttons) ----
 // WhatsApp in-session supports 3 quick-reply buttons per message (titles ≤ 20 chars). [1](https://www.twilio.com/docs/content/twilio-quick-reply)
 async function createQuickReplyWelcome() {
   const payload = {
     friendly_name: 'saamagrii_welcome_qr',
     language: 'en',
     types: {
       'twilio/quick-reply': {
         body: 'What would you like to do?',
         actions: [
           { type: 'QUICK_REPLY', title: 'Record Purchase', id: 'qr_purchase' },
           { type: 'QUICK_REPLY', title: 'Record Sale',     id: 'qr_sale' },
           { type: 'QUICK_REPLY', title: 'Record Return',   id: 'qr_return' }
         ]
       }
     }
   };
   const { data } = await axios.post(CONTENT_API_URL, payload, {
     auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
   });
   return data.sid; // ContentSid
 }

 // ---- Create List Picker (up to 10 items), in-session only (no approval). [2](https://www.twilio.com/docs/content/twiliolist-picker)
 async function createQueryListPicker() {
   const payload = {
     friendly_name: 'saamagrii_query_list',
     language: 'en',
     types: {
       'twilio/list-picker': {
         body: 'Query inventory',
         button: 'Select an option',
         items: [
           { item: 'Short Summary', id: 'list_short_summary',      description: '' },
           { item: 'Full Summary', id: 'list_full_summary',      description: '' },
           { item: 'Low stock',           id: 'list_low',        description: '' },
           { item: 'Reorder suggestions',           id: 'list_reorder_suggest',        description: '' },
           { item: 'Expiring 0',       id: 'list_expiring',   description: '' },
           { item: 'Expiring 30',       id: 'list_expiring_30',   description: '' },
           { item: 'Sales today',         id: 'list_sales_day',  description: '' },
           { item: 'Sales week',         id: 'list_sales_week',  description: '' },
           { item: 'Top products month',id: 'list_top_month',  description: '' },
           { item: 'Inventory value',     id: 'list_value',      description: '' }
         ]
       }
     }
   };
   const { data } = await axios.post(CONTENT_API_URL, payload, {
     auth: { username: ACCOUNT_SID, password: AUTH_TOKEN }
   });
   return data.sid; // ContentSid
 }

 // ---- Send a ContentSid to WhatsApp via Messages API ----
 // You can send rich content using ContentSid + MessagingServiceSid or From (WA sender). [3](https://www.twilio.com/docs/content/create-and-send-your-first-content-api-template)
 
async function sendContentTemplate({ toWhatsApp, contentSid, contentVariables = {} }) {
  const params = new URLSearchParams({
    To: `whatsapp:${toWhatsApp}`,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(contentVariables)
  });
  if (MSID) params.append('MessagingServiceSid', MSID);
  else      params.append('From', FROM_WA);

  let attempt = 0;
  const maxAttempts = 2; // one retry for transient 429/5xx
  while (true) {
    try {
      const { status, data } = await axios.post(
        MESSAGES_API_URL,
        params,
        {
          auth: { username: ACCOUNT_SID, password: AUTH_TOKEN },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: DEFAULT_TIMEOUT
        }
      );
      console.log('[sendContentTemplate] OK', { status, sid: data?.sid, to: toWhatsApp, contentSid, msid: MSID || null });
      return data;
    } catch (e) {
      const status = e?.response?.status || 0;
      const body   = e?.response?.data;
      console.warn('[sendContentTemplate] FAIL', {
        status, body, to: toWhatsApp, contentSid, msid: MSID || null, from: FROM_WA || null, attempt
      });
      if (attempt < maxAttempts && RETRY_STATUSES.has(status)) {
        attempt++;
        await new Promise(r => setTimeout(r, 400 + 250 * attempt));
        continue;
      }
      throw e;
    }
  }
}

 module.exports = {
   createQuickReplyWelcome,
   createQueryListPicker,
   sendContentTemplate
 };
