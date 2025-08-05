// /api/whatsapp.js
const twilio = require('twilio');

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  
  if (req.method === 'POST') {
    const body = req.body;
    if (body.Body?.toLowerCase().includes('inventory')) {
      response.message('🚀 Reply with a voice note: *"Sold 10 Parle-G"*');
    } else {
      response.message('⚠️ Send "inventory" to start.');
    }
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};
