// /api/whatsapp.js
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs/promises');

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
      console.log('[1] Downloading audio...');
      const audioBuffer = await downloadAudio(MediaUrl0);
      
      // 3. Analyze audio
      const audioInfo = await analyzeAudio(audioBuffer);
      console.log('Audio Analysis:', {
        format: audioInfo.format,
        sampleRate: `${audioInfo.sampleRate}Hz`,
        size: `${audioInfo.sizeKB}KB`
      });

      // 4. Process transcription with proper fallbacks
      let transcript;
      try {
        if (audioInfo.format === 'OGG/Opus' && audioInfo.sampleRate === 8000) {
          console.log('[2] Optimizing for Twilio audio');
          const flacBuffer = await convertToFLAC(audioBuffer);
          transcript = await googleTranscribe(flacBuffer, {
            sampleRate: 16000,
            format: 'FLAC'
          });
        } else {
          console.log('[2] Using standard Google STT');
          transcript = await googleTranscribe(audioBuffer, {
            sampleRate: audioInfo.sampleRate,
            format: audioInfo.format.includes('OGG') ? 'OGG_OPUS' : 'LINEAR16'
          });
        }
      } catch (googleError) {
        console.error('Google STT failed, using Twilio fallback:', googleError.message);
        transcript = SpeechResult || 'Could not transcribe audio';
      }
      
      response.message(`✅ Transcribed: "${transcript}"`);
    }
    // Fallback to Twilio transcription
    else if (SpeechResult) {
      console.log('[1] Using Twilio transcription');
      response.message(`🔊 (Twilio): "${SpeechResult}"`);
    }
    // Default prompt
    else {
      console.log('[1] No media received');
      response.message('🎤 Send a voice note: "10 Parle-G sold"');
    }

  } catch (error) {
    console.error('Processing Error:', {
      error: error.message,
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

// Audio Analysis
async function analyzeAudio(buffer) {
  const header = buffer.slice(0, 4).toString('hex');
  const isOGG = header === '4f676753'; // OGG magic number
  
  return {
    format: isOGG ? 'OGG/Opus' : 'Unknown',
    sampleRate: isOGG ? 8000 : 16000, // Twilio uses 8kHz
    sizeKB: Math.round(buffer.length / 1024)
  };
}

// Convert OGG to FLAC and upsample to 16kHz
async function convertToFLAC(oggBuffer) {
  try {
    await fs.writeFile('/tmp/input.ogg', oggBuffer);
    
    execSync(
      'ffmpeg -i /tmp/input.ogg -ar 16000 -ac 1 -c:a flac -compression_level 5 /tmp/output.flac',
      { timeout: 3000 }
    );
    
    return fs.readFile('/tmp/output.flac');
  } catch (error) {
    console.error('Audio conversion failed:', error.message);
    throw new Error('Audio processing error');
  }
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

// Optimized Google STT with proper error handling
async function googleTranscribe(buffer, { sampleRate, format }) {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  
  // Enhanced configuration
  const config = {
    encoding: format,
    sampleRateHertz: sampleRate,
    languageCode: 'hi-IN',
    model: 'telephony',
    useEnhanced: true,
    speechContexts: [{
      phrases: [
        'Parle-G', 'Britannia', 'Sunfeast', 'Bourbon',
        '10', '20', '50', '100', '500',
        'kg', 'किलो', 'ग्राम', 'पैकेट',
        'खरीदा', 'बेचा', 'बिक्री', 'क्रय', 'लिया', 'दिया'
      ],
      boost: 30.0
    }]
  };

  try {
    const { data } = await client.request({
      url: 'https://speech.googleapis.com/v1/speech:recognize',
      method: 'POST',
      data: {
        audio: { content: buffer.toString('base64') },
        config
      },
      timeout: 8000
    });

    if (!data.results?.[0]?.alternatives?.[0]?.transcript) {
      throw new Error('Empty transcript received from Google');
    }
    
    return data.results[0].alternatives[0].transcript;
  } catch (error) {
    // Extract meaningful error message
    const errorMessage = error.response?.data?.error?.message || 
                         error.message || 
                         'Google STT service error';
    
    // Log detailed diagnostics
    console.error('Google STT Error:', {
      error: errorMessage,
      config: `${format}@${sampleRate}Hz`,
      bufferSize: `${Math.round(buffer.length / 1024)}KB`
    });
    
    throw new Error('Google speech recognition failed');
  }
}
