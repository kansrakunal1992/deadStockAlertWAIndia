// /api/whatsapp.js
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.ACCOUNT_SID,
  process.env.AUTH_TOKEN
);

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  
  try {
    if (req.method !== 'POST') throw new Error('Only POST requests allowed');

    // Handle voice note
    if (req.body.NumMedia > 0 && req.body.MediaContentType0 === 'audio/ogg') {
      console.log('Processing voice note from:', req.body.MediaUrl0);
      const audioBuffer = await downloadTwilioAudio(req.body.MediaUrl0);
      const transcript = await googleTranscribe(audioBuffer);
      response.message(`✅ Transcribed: "${transcript}"`);
    } 
    // Handle text
    else {
      response.message('🎤 Send a voice note: "10 Parle-G sold"');
    }

  } catch (error) {
    console.error('Error:', error.message);
    response.message(`❌ Error: ${error.message.split('\n')[0]}`);
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// Fixed Twilio Audio Download with Auth
async function downloadTwilioAudio(url) {
  try {
    console.log('Downloading audio with Twilio auth...');
    const { data } = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 5000,
      auth: {
        username: process.env.ACCOUNT_SID,
        password: process.env.AUTH_TOKEN
      },
      headers: {
        'Accept': 'audio/ogg',
        'User-Agent': 'TwilioWhatsApp/1.0'
      }
    });
    console.log('Audio downloaded successfully');
    return data;
  } catch (error) {
    console.error('Download failed:', {
      status: error.response?.status,
      headers: error.response?.headers,
      data: error.response?.data?.toString('utf8')
    });
    throw new Error('Failed to download audio from Twilio');
  }
}

// Google STT (unchanged)
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
        encoding: 'OGG_OPUS',
        sampleRateHertz: 16000
      }
    }
  });
  
  return data.results[0].alternatives[0].transcript;
}
