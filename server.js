const express = require('express');
const whatsappHandler = require('./api/whatsapp');
const path = require('path');
const cron = require('node-cron');
const { runDailySummary } = require('./dailySummary');

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

// Daily summary endpoint (for manual testing)
app.post('/api/daily-summary', async (req, res) => {
  try {
    await runDailySummary();
    res.status(200).send('Daily summary job completed');
  } catch (error) {
    console.error('Error running daily summary:', error);
    res.status(500).send('Error running daily summary');
  }
});

app.post('/api/whatsapp', whatsappHandler);

// Static files (if needed)
app.use(express.static(path.join(__dirname, 'public')));

// Schedule daily summary at 8 PM every day
cron.schedule('30 18 * * *', () => {
  console.log('Running scheduled daily summary job at 8 PM');
  runDailySummary();
}, {
  scheduled: true,
  timezone: "Asia/Kolkata" // Adjust timezone as needed
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});
