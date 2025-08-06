// /api/whatsapp.js
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  
  try {
    // 1. Validate request
    if (req.method !== 'POST') throw new Error('Invalid method');
    const { MediaUrl0, NumMedia, SpeechResult } = req.body;

    // 2. Handle voice note
    if (NumMedia > 0 && MediaUrl0) {
      const audioBuffer = await downloadAudio(MediaUrl0);
      const transcript = await googleTranscribe(audioBuffer);
      response.message(`✅ Transcribed: "${transcript}"`);
    }
    // 3. Fallback to Twilio transcription
    else if (SpeechResult) {
      response.message(`🔊 (Basic): "${SpeechResult}"`);
    }
    // 4. Default prompt
    else {
      response.message('🎤 Send a voice note: "10 Parle-G sold"');
    }

  } catch (error) {
    console.error('Error:', error.message);
    response.message('❌ Processing failed. Please try again.');
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// Download audio with production Twilio auth
async function downloadAudio(url) {
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 5000,
    auth: {
      username: process.env.ACCOUNT_SID, // Use prod SID
      password: process.env.AUTH_TOKEN    // Use prod token
    }
  });
  return data;
}

// Google STT with production credentials
async function googleTranscribe(audioBuffer) {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  const { data } = await client.request({
    url: 'https://speech.googleapis.com/v1/speech:recognize',
    method: 'POST',
    data: {
      audio: { content: audioBuffer.toString('base64') },
      config: {
        languageCode: 'hi-IN',
        encoding: 'OGG_OPUS',
        sampleRateHertz: 16000,
        model: 'latest_short'
      }
    }
  });
  
  return data.results[0].alternatives[0].transcript;
}
