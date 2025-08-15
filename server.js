const express = require('express');
const whatsappHandler = require('./api/whatsapp');
const path = require('path');
const app = express();

// Middleware for webhook verification
app.use('/api/whatsapp', express.json({
  verify: (req, res, buf) => {
    const url = require('url').parse(req.url);
    if (req.method === 'POST' && url.pathname === '/api/whatsapp') {
      const signature = req.headers['x-twilio-signature'];
      const params = req.body;
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      
      if (!twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, buf)) {
        console.error('Twilio signature validation failed');
        throw new Error('Invalid signature');
      }
    }
  }
}));

app.use(express.urlencoded({ extended: true }));

// Webhook verification endpoint
app.get('/api/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

app.post('/api/whatsapp', whatsappHandler);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});
