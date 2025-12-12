const https = require('https');
const twilio = require('twilio');

// Reuse TLS connections for faster short API calls (ACKs, examples, etc.)
const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 1000, maxSockets: 50 });

// Initialize the Twilio client once per process
const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN, {
  httpClient: new twilio.HttpClient({ agent })
});

// Set Edge + Region for the SDK; the client will build the FQDN for you.
// IMPORTANT: Always set BOTH edge and region (Twilio SDKs require both for non-US routing).
// See: {product}.{edge}.{region}.twilio.com + SDK "edge"/"region" parameters.  [DOCS]
if (process.env.TWILIO_EDGE)  client.edge   = process.env.TWILIO_EDGE;   // e.g., 'singapore'
if (process.env.TWILIO_REGION) client.region = process.env.TWILIO_REGION; // e.g., 'us1'/'ie1'/'au1'

// Helpful startup log (observability)
try {
  const edge   = client.edge   || 'default';
  const region = client.region || 'us1';
  // Example FQDN shape the SDK would target: api.{edge}.{region}.twilio.com
  console.log('[twilioClient]', { edge, region, fqdn_hint: `api.${edge}.${region}.twilio.com` });
} catch (_) {}

module.exports = client;
