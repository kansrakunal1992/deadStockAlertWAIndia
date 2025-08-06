// /api/whatsapp.js (Final Working Version)
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

    // 2. Download and prepare audio
    console.log('Downloading audio...');
    const audioBuffer = await downloadTwilioAudio(req.body.MediaUrl0);
    
    // 3. Special handling for Twilio's low-bitrate Opus
    console.log('Preparing audio for Google STT...');
    const sttPayload = prepareAudioPayload(audioBuffer);

    // 4. Transcribe with error recovery
    console.log('Sending to Google STT...');
    const transcript = await transcribeWithRetry(sttPayload);
    
    response.message(`✅ Transcribed: "${transcript}"`);

  } catch (error) {
    console.error('FINAL ERROR:', error.message);
    response.message(`❌ Failed: ${error.message.includes('audio') ? 'Invalid audio - try again' : 'System error'}`);
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// Audio Processor
function prepareAudioPayload(buffer) {
  // Twilio's specific Opus configuration (8kHz, mono, very low bitrate)
  return {
    content: buffer.toString('base64'),
    config: {
      languageCode: 'hi-IN',
      encoding: 'OGG_OPUS',
      sampleRateHertz: 8000, // Matches Twilio's actual sample rate
      enableAutomaticPunctuation: true,
      model: 'latest_short',
      audioChannelCount: 1,
      speechContexts: [{
        phrases: ['Parle-G', 'kg', '10', '20', 'खरीदा'],
        boost: 20.0
      }]
    }
  };
}

// Transcription with retry logic
async function transcribeWithRetry(payload, attempt = 1) {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  
  try {
    const { data } = await client.request({
      url: 'https://speech.googleapis.com/v1/speech:recognize',
      method: 'POST',
      data: { audio: { content: payload.content }, config: payload.config },
      timeout: 10000
    });

    if (data.results?.[0]?.alternatives?.[0]?.transcript) {
      return data.results[0].alternatives[0].transcript;
    }
    throw new Error('Empty transcription');
    
  } catch (error) {
    if (attempt >= 3) throw error;
    
    // Adjust parameters for retry
    payload.config.sampleRateHertz = 16000; // Try standard rate
    console.log(`Retry ${attempt} with adjusted parameters...`);
    return transcribeWithRetry(payload, attempt + 1);
  }
}

// Twilio Downloader
async function downloadTwilioAudio(url) {
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 5000,
    auth: {
      username: process.env.ACCOUNT_SID,
      password: process.env.AUTH_TOKEN
    }
  });
  
  // Verify OGG header
  if (data.slice(0, 4).toString('hex') !== '4f676753') {
    throw new Error('Invalid OGG file');
  }
  
  return data;
}
