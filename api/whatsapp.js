// /api/whatsapp.js (Final Verified Version)
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const { execSync } = require('child_process');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.ACCOUNT_SID,
  process.env.AUTH_TOKEN
);

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  console.log('\n=== NEW REQUEST ===', new Date().toISOString());

  try {
    if (req.method !== 'POST') {
      throw new Error('Only POST requests allowed');
    }

    console.log('[1] Request Body:', JSON.stringify({
      NumMedia: req.body.NumMedia,
      MediaContentType0: req.body.MediaContentType0,
      Body: req.body.Body?.length > 50 ? req.body.Body.slice(0, 50) + '...' : req.body.Body
    }, null, 2));

    // Handle voice note
    if (req.body.NumMedia > 0 && req.body.MediaContentType0 === 'audio/ogg') {
      console.log('[2] Processing voice note...');
      const transcript = await processVoiceNote(req.body.MediaUrl0);
      response.message(`✅ Transcribed: "${transcript}"`);
    } 
    // Handle text commands
    else if (req.body.Body?.toLowerCase().includes('inventory')) {
      console.log('[2] Processing text command');
      response.message('🎤 Send a voice note: "10 Parle-G sold"');
    }
    // Default response
    else {
      console.log('[2] Unrecognized input');
      response.message('Please send a voice note or type "inventory"');
    }

  } catch (error) {
    console.error('[ERROR]', error.message);
    console.error('Stack:', error.stack);
    response.message(`❌ Error: ${error.message.split('\n')[0]}`);
  }

  console.log('=== END PROCESSING ===\n');
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(response.toString());
};

// Voice Note Processor
async function processVoiceNote(audioUrl) {
  console.log('[3] Downloading audio...');
  const { audioBuffer, headers } = await validateAndDownloadAudio(audioUrl);

  console.log('[4] Audio Info:', {
    size: `${(audioBuffer.length / 1024).toFixed(2)} KB`,
    headers: {
      'content-type': headers['content-type'],
      'content-length': headers['content-length']
    },
    firstBytes: audioBuffer.slice(0, 4).toString('hex')
  });

  console.log('[5] Converting audio if needed...');
  const processedBuffer = await convertAudio(audioBuffer);

  console.log('[6] Transcribing...');
  return await googleTranscribe(processedBuffer);
}

// Audio Helpers
async function validateAndDownloadAudio(url) {
  if (!url || !url.startsWith('https://api.twilio.com/')) {
    throw new Error(`Invalid audio URL: ${url}`);
  }

  const { data, headers, status } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 10000,
    validateStatus: null
  });

  if (status !== 200) {
    throw new Error(`Twilio audio download failed (${status}): ${data.toString().slice(0, 100)}`);
  }

  if (!headers['content-type']?.includes('audio/')) {
    throw new Error(`Invalid content-type: ${headers['content-type']}`);
  }

  return { audioBuffer: data, headers };
}

async function convertAudio(buffer) {
  try {
    if (isValidWav(buffer)) {
      console.log('Audio is already WAV format');
      return buffer;
    }

    console.log('Converting OGG to WAV via FFmpeg...');
    return execSync('ffmpeg -i pipe:0 -ar 16000 -ac 1 -f wav pipe:1 2>&1', {
      input: buffer,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024 // 10MB
    });
  } catch (error) {
    console.warn('Conversion failed, using original:', error.message);
    return buffer; // Fallback
  }
}

function isValidWav(buffer) {
  return buffer.length > 12 && 
         buffer.toString('ascii', 0, 4) === 'RIFF' && 
         buffer.toString('ascii', 8, 12) === 'WAVE';
}

// Google STT
async function googleTranscribe(buffer) {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  const client = await auth.getClient();
  const audioBase64 = buffer.toString('base64');

  console.log('[7] Sending to Google STT (size:', `${Math.round(audioBase64.length / 1024)} KB)`);
  const { data } = await client.request({
    url: 'https://speech.googleapis.com/v1/speech:recognize',
    method: 'POST',
    data: {
      audio: { content: audioBase64 },
      config: {
        languageCode: 'hi-IN',
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        enableAutomaticPunctuation: true,
        model: 'latest_short',
        speechContexts: [{
          phrases: ['Parle-G', 'Maggi', 'kg', 'liter', '10', '20', 'खरीदा'],
          boost: 15.0
        }]
      }
    },
    timeout: 15000
  });

  if (!data.results?.[0]?.alternatives?.[0]?.transcript) {
    throw new Error('Empty transcription: ' + JSON.stringify(data));
  }

  console.log('[8] Transcription success');
  return data.results[0].alternatives[0].transcript;
}
