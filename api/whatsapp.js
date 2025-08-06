// /api/whatsapp.js (Google STT accepts OGG directly)
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

// Initialize Twilio
const twilioClient = twilio(
  process.env.ACCOUNT_SID,
  process.env.AUTH_TOKEN
);

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  
  try {
    if (req.method !== 'POST') throw new Error('Only POST allowed');

    // Handle voice note
    if (req.body.NumMedia > 0 && req.body.MediaContentType0 === 'audio/ogg') {
      const audioBuffer = await downloadAudio(req.body.MediaUrl0);
      const transcript = await googleTranscribe(audioBuffer);
      response.message(`✅ Transcribed: "${transcript}"`);
    } 
    // Handle text commands
    else {
      response.message('🎤 Send a voice note: "10 Parle-G sold"');
    }

  } catch (error) {
    console.error('Error:', error);
    response.message(`❌ Error: ${error.message.split('\n')[0]}`);
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// Download audio (no conversion needed)
async function downloadAudio(url) {
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 5000
  });
  return data;
}

// Google STT (accepts OGG)
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
        encoding: 'OGG_OPUS', // Direct OGG support
        sampleRateHertz: 16000
      }
    }
  });

  return data.results[0].alternatives[0].transcript;
}
