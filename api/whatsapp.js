// /api/whatsapp.js (100% Vercel-compatible)
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  
  try {
    // 1. Validate request
    if (req.method !== 'POST') throw new Error('Only POST allowed');
    if (!req.body.NumMedia || req.body.MediaContentType0 !== 'audio/ogg') {
      response.message('🎤 Send a voice note: "10 Parle-G sold"');
      return res.send(response.toString());
    }

    // 2. Download audio
    console.log('Downloading audio from:', req.body.MediaUrl0);
    const audioBuffer = await axios.get(req.body.MediaUrl0, {
      responseType: 'arraybuffer',
      timeout: 5000,
      auth: {
        username: process.env.ACCOUNT_SID,
        password: process.env.AUTH_TOKEN
      }
    }).then(res => res.data);

    // 3. Verify audio header (OGG magic number)
    const header = audioBuffer.slice(0, 4).toString('hex');
    if (header !== '4f676753') throw new Error('Invalid OGG file');

    // 4. Transcribe
    console.log('Sending to Google STT (size:', audioBuffer.length, 'bytes)');
    const transcript = await transcribeOGG(audioBuffer);
    response.message(`✅ Transcribed: "${transcript}"`);

  } catch (error) {
    console.error('ERROR:', error.message);
    response.message(`❌ Failed: ${error.message.split('\n')[0]}`);
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// Google STT with OGG fallbacks
async function transcribeOGG(buffer) {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  
  // Try both OGG_OPUS and WEBM_OPUS encodings
  const encodings = ['OGG_OPUS', 'WEBM_OPUS'];
  
  for (const encoding of encodings) {
    try {
      const { data } = await client.request({
        url: 'https://speech.googleapis.com/v1/speech:recognize',
        method: 'POST',
        data: {
          audio: { content: buffer.toString('base64') },
          config: {
            languageCode: 'hi-IN',
            encoding: encoding,
            sampleRateHertz: 16000,
            model: 'latest_short',
            speechContexts: [{
              phrases: ['Parle-G', 'kg', '10', '20', 'खरीदा'],
              boost: 15.0
            }]
          }
        },
        timeout: 10000
      });

      if (data.results?.[0]?.alternatives?.[0]?.transcript) {
        console.log('Success with encoding:', encoding);
        return data.results[0].alternatives[0].transcript;
      }
    } catch (e) {
      console.warn(`Failed with ${encoding}:`, e.message);
    }
  }
  
  throw new Error('All encoding attempts failed');
}
