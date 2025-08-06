// /api/whatsapp.js
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  
  try {
    // 1. Validate request
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const { MediaUrl0, NumMedia, SpeechResult } = req.body;

    // 2. Handle voice note
    if (NumMedia > 0 && MediaUrl0) {
      console.log('Downloading audio...');
      const audioBuffer = await downloadAudio(MediaUrl0);
      
      // 3. Analyze audio (focus on sample rate)
      const audioInfo = await analyzeAudio(audioBuffer);
      console.log('Audio Analysis:', {
        format: audioInfo.format,
        sampleRate: `${audioInfo.sampleRate}Hz`,
        size: `${audioInfo.sizeKB}KB`,
        quality: audioInfo.sampleRate >= 16000 ? 'HD' : 'Standard'
      });

      // 4. Convert/transcribe based on analysis
      let transcript;
      if (audioInfo.sampleRate < 16000) {
        console.log('Standard quality audio - using Twilio fallback');
        transcript = SpeechResult || 'Could not process low-quality audio';
      } else {
        console.log('HD quality audio - sending to Google STT');
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
    console.error('Processing Error:', {
      error: error.message,
      stack: error.stack?.split('\n')[0], // Only first line of stack trace
      requestBody: { 
        hasMedia: !!req.body.MediaUrl0,
        mediaType: req.body.MediaContentType0 
      }
    });
    response.message('❌ System error. Please try again with a clear voice message.');
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// Audio Analysis (Focus on sample rate detection)
async function analyzeAudio(buffer) {
  const header = buffer.slice(0, 4).toString('hex');
  const isOGG = header === '4f676753'; // OGG magic number
  
  // Twilio voice notes are typically 8kHz OGG/Opus
  const sampleRate = isOGG ? 8000 : 16000; // Default assumption
  
  return {
    format: isOGG ? 'OGG/Opus' : 'Unknown',
    sampleRate, // Primary quality metric
    sizeKB: Math.round(buffer.length / 1024)
  };
}

// Secure audio download with Twilio auth
async function downloadAudio(url) {
  const { data } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 5000,
    auth: {
      username: process.env.ACCOUNT_SID,
      password: process.env.AUTH_TOKEN
    },
    headers: {
      'User-Agent': 'WhatsApp-Business-Automation/1.0'
    }
  });
  return data;
}

// Optimized Google STT with adaptive configuration
async function googleTranscribe(buffer, audioInfo) {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  
  // Configuration optimized for Twilio's audio
  const configs = [
    { 
      encoding: 'OGG_OPUS',
      sampleRateHertz: audioInfo.sampleRate, // Match input sample rate
      model: 'latest_short',
      languageCode: 'hi-IN',
      speechContexts: [{
        phrases: ['Parle-G', 'kg', '10', '20', 'खरीदा', 'बेचा'],
        boost: 20.0
      }]
    },
    { 
      encoding: 'LINEAR16',
      sampleRateHertz: 16000, // Fallback to standard
      model: 'default'
    }
  ];

  for (const config of configs) {
    try {
      const { data } = await client.request({
        url: 'https://speech.googleapis.com/v1/speech:recognize',
        method: 'POST',
        data: {
          audio: { content: buffer.toString('base64') },
          config
        },
        timeout: 10000
      });

      const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;
      if (transcript) {
        console.log(`STT Success: ${config.encoding}@${config.sampleRateHertz}Hz`);
        return transcript;
      }
    } catch (error) {
      console.warn(`STT Attempt Failed:`, {
        config: `${config.encoding}@${config.sampleRateHertz}Hz`,
        error: error.message
      });
    }
  }
  
  throw new Error('All STT attempts failed');
}
