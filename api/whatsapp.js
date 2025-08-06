// /api/whatsapp.js
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  
  try {
    // 1. Validate request method
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const { MediaUrl0, NumMedia, SpeechResult } = req.body;

    // 2. Handle voice note
    if (NumMedia > 0 && MediaUrl0) {
      console.log('[1] Downloading audio...');
      const audioBuffer = await downloadAudio(MediaUrl0);
      
      // 3. Analyze audio (simplified)
      const audioInfo = analyzeAudio(audioBuffer);
      console.log('Audio Analysis:', {
        format: audioInfo.format,
        sampleRate: `${audioInfo.sampleRate}Hz`,
        size: `${audioInfo.sizeKB}KB`
      });

      // 4. Process transcription
      let transcript;
      try {
        console.log('[2] Sending to Google STT...');
        transcript = await googleTranscribe(
          audioBuffer, 
          audioInfo.sampleRate,
          audioInfo.format.includes('OGG') ? 'OGG_OPUS' : 'LINEAR16'
        );
      } catch (error) {
        console.error('Google STT failed, using Twilio fallback:', error.message);
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

// Simple audio analysis
function analyzeAudio(buffer) {
  const header = buffer.slice(0, 4).toString('hex');
  return {
    format: header === '4f676753' ? 'OGG/Opus' : 'Unknown',
    sampleRate: 8000, // Twilio voice notes are always 8kHz
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
    },
    headers: {
      'User-Agent': 'WhatsApp-Business-Automation/1.0'
    }
  });
  return data;
}

// Google STT optimized for 8kHz audio
async function googleTranscribe(buffer, sampleRate, format) {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  
  // Configuration optimized for Twilio's 8kHz audio
  const config = {
    encoding: format,
    sampleRateHertz: sampleRate,
    languageCode: 'hi-IN',
    model: 'telephony',      // Specialized for phone audio
    useEnhanced: true,       // Better accuracy worth the cost
    enableAutomaticPunctuation: true,
    speechContexts: [{
      phrases: [
        // Products
        'Parle-G', 'Britannia', 'Sunfeast', 'Bourbon', 'Maggi', 
        // Quantities
        '10', '20', '50', '100', '500', '1000',
        // Units
        'kg', 'किलो', 'ग्राम', 'पैकेट', 'बॉक्स',
        // Actions
        'खरीदा', 'बेचा', 'बिक्री', 'क्रय', 'लिया', 'दिया', 'बचा'
      ],
      boost: 25.0  // Slightly reduced boost since we're not converting
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

    const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;
    if (!transcript) throw new Error('Empty transcript received');
    
    return transcript;
  } catch (error) {
    const errorDetails = error.response?.data?.error?.message || error.message;
    console.error('Google STT Error:', {
      error: errorDetails,
      config: `${format}@${sampleRate}Hz`,
      bufferSize: `${Math.round(buffer.length / 1024)}KB`
    });
    
    throw new Error('Speech recognition service failed');
  }
}
