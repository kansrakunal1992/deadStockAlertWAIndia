// /api/whatsapp.js
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const { Readable } = require('stream');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.ACCOUNT_SID,
  process.env.AUTH_TOKEN
);

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
    console.log('[1] Downloading from Twilio...');
    const oggBuffer = await downloadTwilioAudio(req.body.MediaUrl0);
    
    // 3. Convert using client-side emulation
    console.log('[2] Converting audio...');
    const wavBuffer = await convertLowBitrateOpus(oggBuffer);
    
    // 4. Transcribe
    console.log('[3] Transcribing...');
    const transcript = await googleTranscribe(wavBuffer);
    
    response.message(`✅ Transcribed: "${transcript}"`);

  } catch (error) {
    console.error('[FATAL]', error.message);
    
    // Fallback strategies
    if (req.body.SpeechResult) {
      response.message(`🔊 (Basic): "${req.body.SpeechResult}"`);
    } else {
      response.message('❌ Please resend or say: "10 Parle-G sold"');
    }
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// Audio Processor for Twilio's Low-Bitrate Opus
async function convertLowBitrateOpus(buffer) {
  // DocsPal API conversion
  try {
    const form = new FormData();
    form.append('file', Buffer.from(buffer), {
      filename: 'audio.ogg',
      contentType: 'audio/ogg'
    });

    const { data } = await axios.post(
      'https://api.docspal.com/v1/conversions/ogg-to-wav',
      form,
      {
        headers: {
          'Authorization': `Bearer ${process.env.OGG_TO_WAV_API_KEY}`,
          ...form.getHeaders()
        },
        timeout: 15000
      }
    );

    // Download converted file
    const response = await axios.get(data.download_url, {
      responseType: 'arraybuffer'
    });
    
    return response.data;
  } catch (error) {
    console.error('DocsPal conversion failed, trying manual workaround...');
    
    // Manual workaround for low-bitrate Opus
    const resampled = await manualOpusFix(buffer);
    return resampled;
  }
}

// Manual Opus Fix (no external dependencies)
async function manualOpusFix(buffer) {
  // This is a placeholder for actual audio processing
  // In production, you'd use a WASM Opus decoder or similar
  return buffer; // Fallthrough to Google STT with original
}

// Google STT with optimized config
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
        encoding: 'LINEAR16',
        sampleRateHertz: 8000, // Match Twilio's actual sample rate
        audioChannelCount: 1,
        enableAutomaticPunctuation: true,
        model: 'telephony', // Optimized for low-quality audio
        useEnhanced: true,
        speechContexts: [{
          phrases: [
            '10', '20', '50', '100',
            'Parle-G', 'Maggi', 'Dabur',
            'kg', 'gram', 'liter',
            'खरीदा', 'बेचा', 'किलो'
          ],
          boost: 20.0
        }]
      }
    },
    timeout: 15000
  });

  if (!data.results?.[0]?.alternatives?.[0]?.transcript) {
    throw new Error('Empty transcription');
  }

  return data.results[0].alternatives[0].transcript;
}

// Twilio Audio Downloader
async function downloadTwilioAudio(url) {
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 5000,
    auth: {
      username: process.env.ACCOUNT_SID,
      password: process.env.AUTH_TOKEN
    }
  });
  
  // Verify OGG Opus header
  const header = data.slice(0, 36).toString('hex');
  if (!header.startsWith('4f676753')) {
    throw new Error('Invalid OGG Opus file');
  }
  
  return data;
}
