const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const { MediaUrl0, NumMedia, SpeechResult } = req.body;

    if (NumMedia > 0 && MediaUrl0) {
      console.log('[1] Downloading audio...');
      const audioBuffer = await downloadAudio(MediaUrl0);
      
      console.log('[2] Converting audio...');
      const flacBuffer = await convertToFLAC(audioBuffer);
      
      console.log('[3] Transcribing with Google STT...');
      const transcript = await googleTranscribe(flacBuffer);
      
      response.message(`✅ Transcribed: "${transcript}"`);
    }
    else if (SpeechResult) {
      console.log('[1] Using Twilio transcription');
      response.message(`🔊 (Twilio): "${SpeechResult}"`);
    }
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

async function convertToFLAC(oggBuffer) {
  try {
    fs.writeFileSync('/tmp/input.ogg', oggBuffer);
    execSync(
      'ffmpeg -i /tmp/input.ogg -ar 16000 -ac 1 -c:a flac -compression_level 5 /tmp/output.flac',
      { timeout: 3000 }
    );
    return fs.readFileSync('/tmp/output.flac');
  } catch (error) {
    console.error('FFmpeg conversion failed:', error.message);
    throw new Error('Audio processing error');
  }
}

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

async function googleTranscribe(flacBuffer) {
  const rawJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const cleanedJson = rawJson.replace(/\\n/g, '\n');
  const credentials = JSON.parse(cleanedJson);

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  
  const baseConfig = {
    languageCode: 'hi-IN',
    useEnhanced: true,
    enableAutomaticPunctuation: true,
    audioChannelCount: 1,
    speechContexts: [{
      phrases: [
        'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
        '10', 'दस', '20', 'बीस', '50', 'पचास', '100', 'सौ',
        'kg', 'किलो', 'ग्राम', 'पैकेट', 'बॉक्स', 'किलोग्राम',
        'खरीदा', 'बेचा', 'बिक्री', 'क्रय', 'लिया', 'दिया', 'बचा',
        'sold', 'purchased', 'bought', 'ordered'
      ],
      boost: 32.0
    }]
  };

  const configs = [
    { ...baseConfig, model: 'telephony' },
    { ...baseConfig, model: 'latest_short' },
    { ...baseConfig, model: 'default' }
  ];

  for (const config of configs) {
    try {
      config.encoding = 'FLAC';
      config.sampleRateHertz = 16000;

      const { data } = await client.request({
        url: 'https://speech.googleapis.com/v1/speech:recognize',
        method: 'POST',
        data: {
          audio: { content: flacBuffer.toString('base64') },
          config
        },
        timeout: 8000
      });

      const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;
      if (transcript) {
        console.log(`STT Success: ${config.model} model`);
        return transcript;
      }
    } catch (error) {
      console.warn(`STT Attempt Failed:`, {
        model: config.model,
        error: error.response?.data?.error?.message || error.message
      });
    }
  }
  throw new Error('All STT attempts failed');
}
