const https = require('https');
const twilio = require('twilio');

// Reuse TLS connections to Twilio for near-real-time short messages
const keepAliveAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 1000, maxSockets: 50 });

// Optional: set closest public Edge via env (e.g., TWILIO_EDGE=singapore)
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, {
  httpClient: new twilio.HttpClient({ agent: keepAliveAgent })
});
if (process.env.TWILIO_EDGE) client.edge = process.env.TWILIO_EDGE;   // e.g., 'singapore', 'dublin'
if (process.env.TWILIO_REGION) client.region = process.env.TWILIO_REGION; // e.g., 'us1', 'ie1', 'au1'

module.exports = client;
