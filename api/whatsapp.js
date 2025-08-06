// /api/whatsapp.js (Vercel-compatible)
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  
  try {
    if (req.method !== 'POST') throw new Error('Only POST allowed');

    if (req.body.NumMedia > 0 && req.body.MediaContentType0 === 'audio/ogg') {
      console.log('[1] Downloading Twilio audio...');
      const audioBuffer = await downloadTwilioAudio(req.body.MediaUrl0);
      
      console.log('[2] Sending to Google STT...');
      const transcript = await googleTranscribe(audioBuffer);
      
      response.message(`✅ Transcribed: "${transcript}"`);
    } else {
      response.message('🎤 Send a voice note: "10 Parle-G sold"');
    }

  } catch (error) {
    console.error('Error:', error.message);
    response.message(`❌ Error: ${error.message.split('\n')[0]}`);
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

async function downloadTwilioAudio(url) {
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 5000,
    auth: {
      username: process.env.ACCOUNT_SID,
      password: process.env.AUTH_TOKEN
    }
  });
  return data;
}

async function googleTranscribe(buffer) {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  const { data } = await client.request({
    url: 'https://speech.googleapis.com/v1/speech:recognize',
    method: 'POST',
    data: {
      audio: { content: buffer.toString('base64') },
      config: {
        languageCode: 'hi-IN',
        encoding: 'OGG_OPUS', // Direct Twilio format support
        sampleRateHertz: 16000,
        enableAutomaticPunctuation: true,
        model: 'latest_short',
        speechContexts: [{
          phrases: ['Parle-G', 'Maggi', 'kg', '10', '20', 'खरीदा'],
          boost: 15.0
        }]
      }
    }
  });

  if (!data.results?.[0]?.alternatives?.[0]?.transcript) {
    throw new Error('Empty transcription result');
  }

  return data.results[0].alternatives[0].transcript;
}
