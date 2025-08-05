// /api/whatsapp.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const twilio = require('twilio');
  const response = new twilio.twiml.MessagingResponse();

  const incomingMsg = req.body.Body.toLowerCase().trim();

  if (incomingMsg.includes('inventory')) {
    response.message('🚀 Reply with a voice note: *"Sold 10 Parle-G, bought 5kg Sugar"*');
  } else {
    response.message('⚠️ Send "inventory" to start.');
  }

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(response.toString());
}
