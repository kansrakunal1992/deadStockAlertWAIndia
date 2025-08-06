// /api/whatsapp.js
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const fs = require('fs'); // For debug logging (remove in production)

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  
  try {
    // 1. Validate request
    if (req.method !== 'POST') throw new Error('Invalid method');
    const { MediaUrl0, NumMedia, SpeechResult } = req.body;

    // 2. Handle voice note
    if (NumMedia > 0 && MediaUrl0) {
      console.log('[1] Downloading audio...');
      const audioBuffer = await downloadAudio(MediaUrl0);
      
      // DEBUG: Save original audio (remove in production)
      fs.writeFileSync('/tmp/original.ogg', audioBuffer);
      console.log('Original audio saved for inspection');

      // 3. Analyze audio (critical for debugging)
      const audioInfo = await analyzeAudio(audioBuffer);
      console.log('Audio Analysis:', audioInfo);

      // 4. Convert/transcribe based on analysis
      let transcript;
      if (audioInfo.bitrate < 16000) {
        console.log('[2] Low bitrate detected - using Twilio fallback');
        transcript = SpeechResult || 'Could not process low-quality audio';
      } else {
        console.log('[2] Sending to Google STT...');
        transcript = await googleTranscribe(audioBuffer, audioInfo);
      }
      
      response.message(`✅ Transcribed: "${transcript}"`);
    }
    // Fallback to Twilio transcription
    else if (SpeechResult) {
      response.message(`🔊 (Twilio): "${SpeechResult}"`);
    }
    // Default prompt
    else {
      response.message('🎤 Send a voice note: "10 Parle-G sold"');
    }

  } catch (error) {
    console.error('FATAL ERROR:', {
      message: error.message,
      stack: error.stack,
      twilioAudio: req.body.MediaUrl0 ? 'Exists' : 'Missing'
    });
    response.message('❌ System error. Please send audio again.');
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// Audio Analysis (Identify bitrate/format issues)
async function analyzeAudio(buffer) {
  const header = buffer.slice(0, 4).toString('hex');
  const isOGG = header === '4f676753'; // OGG magic number
  
  // Estimate bitrate (simplified)
  const duration = buffer.length / 16000; // Approximate
  const bitrate = duration > 0 ? (buffer.length * 8) / (duration * 1000) : 0; // kbps
  
  return {
    format: isOGG ? 'OGG/Opus' : 'Unknown',
    sampleRate: 16000, // Twilio's default
    bitrate: Math.round(bitrate),
    sizeKB: Math.round(buffer.length / 1024)
  };
}

// Download audio with Twilio auth
async function downloadAudio(url) {
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

// Google STT with format fallbacks
async function googleTranscribe(buffer, audioInfo) {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  
  // Try multiple encoding configurations
  const configs = [
    { encoding: 'OGG_OPUS', sampleRateHertz: 8000 }, // Twilio's actual sample rate
    { encoding: 'OGG_OPUS', sampleRateHertz: 16000 }, // Common standard
    { encoding: 'LINEAR16', sampleRateHertz: 16000 } // Fallback to WAV
  ];

  for (const config of configs) {
    try {
      const { data } = await client.request({
        url: 'https://speech.googleapis.com/v1/speech:recognize',
        method: 'POST',
        data: {
          audio: { content: buffer.toString('base64') },
          config: {
            languageCode: 'hi-IN',
            ...config,
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
        console.log(`Success with config: ${JSON.stringify(config)}`);
        return data.results[0].alternatives[0].transcript;
      }
    } catch (error) {
      console.warn(`Failed with ${config.encoding}@${config.sampleRateHertz}Hz:`, error.message);
    }
  }
  
  throw new Error('All Google STT attempts failed');
}
