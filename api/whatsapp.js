// /api/whatsapp.js
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
  console.log('=== NEW REQUEST ===');
  console.log('Request Headers:', req.headers);
  console.log('Request Body:', JSON.stringify(req.body, null, 2));

  if (req.method === 'POST') {
    const body = req.body;
    console.log('[1] Received WhatsApp message with NumMedia:', body.NumMedia);

    // Handle voice note
    if (body.NumMedia > 0 && body.MediaContentType0 === 'audio/ogg') {
      console.log('[2] Audio attachment detected');
      console.log('MediaUrl0:', body.MediaUrl0);
      console.log('MediaContentType0:', body.MediaContentType0);

      try {
        // 1. Download and validate audio
        console.log('[3] Downloading audio from Twilio...');
        const { audioBuffer, headers } = await validateAndDownloadAudio(body.MediaUrl0);
        console.log('[4] Audio download completed');
        console.log('Audio Headers:', headers);
        console.log('Audio Buffer Length:', audioBuffer.length, 'bytes');

        // 2. Log initial audio format
        console.log('[5] Checking audio format...');
        const isWav = isValidWav(audioBuffer);
        console.log(`Audio is ${isWav ? 'WAV' : 'OGG'}`);
        console.log('First 16 bytes:', audioBuffer.slice(0, 16).toString('hex'));

        // 3. Convert audio if needed
        let processedBuffer = audioBuffer;
        if (!isWav) {
          console.log('[6] Converting OGG to WAV...');
          try {
            processedBuffer = await convertAudio(audioBuffer);
            console.log('[7] Conversion successful');
            console.log('Converted Buffer Length:', processedBuffer.length, 'bytes');
          } catch (convertError) {
            console.error('Conversion failed, using original:', convertError.message);
            processedBuffer = audioBuffer; // Fallback
          }
        }

        // 4. Transcribe
        console.log('[8] Sending to Google STT...');
        const transcript = await googleTranscribe(processedBuffer);
        console.log('[9] Transcription successful:', transcript);

        response.message(`✅ Transcribed: "${transcript}"`);

      } catch (error) {
        console.error('[ERROR] Processing failed:', error.message);
        console.error('Error Stack:', error.stack);
        response.message(`❌ Failed: ${error.message.split('\n')[0]}`);
      }
    }
  }

  console.log('=== END PROCESSING ===');
  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// Audio Processing Functions
async function validateAndDownloadAudio(url) {
  console.log('Validating audio URL:', url);
  if (!url || !url.startsWith('https://api.twilio.com/')) {
    throw new Error(`Invalid Twilio URL: ${url}`);
  }

  console.log('Downloading audio...');
  const { data, headers } = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 5000,
    validateStatus: null
  });

  console.log('Download completed. Status:', headers.status);
  if (headers.status !== 200) {
    console.error('Download failed. Response:', data.toString('utf8').slice(0, 200));
    throw new Error(`Twilio returned ${headers.status}`);
  }

  if (!headers['content-type']?.includes('audio/')) {
    throw new Error(`Expected audio, got ${headers['content-type']}`);
  }

  return { audioBuffer: data, headers };
}

async function convertAudio(buffer) {
  console.log('Starting audio conversion...');
  try {
    const result = execSync('ffmpeg -i pipe:0 -ar 16000 -ac 1 -f wav pipe:1 2>&1', {
      input: buffer,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log('FFmpeg output:', result.toString());
    return result;
  } catch (error) {
    console.error('FFmpeg Error:', error.stderr?.toString());
    throw error;
  }
}

function isValidWav(buffer) {
  return buffer.length > 12 && 
         buffer.toString('ascii', 0, 4) === 'RIFF' && 
         buffer.toString('ascii', 8, 12) === 'WAVE';
}

// Google STT Function
async function googleTranscribe(buffer) {
  console.log('Initializing Google STT...');
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  
  const client = await auth.getClient();
  const audioBase64 = buffer.toString('base64');
  console.log('Audio payload size:', Math.round(audioBase64.length / 1024), 'KB');

  console.log('Sending to Google STT API...');
  const { data, status } = await client.request({
    url: 'https://speech.googleapis.com/v1/speech:recognize',
    method: 'POST',
    data: {
      audio: { content: audioBase64 },
      config: {
        languageCode: 'hi-IN',
        encoding: 'LINEAR16',
        sampleRateHertz: 16000
      }
    }
  });
  
  console.log('Google API Response:', { status, data });
  if (!data.results?.[0]?.alternatives?.[0]?.transcript) {
    throw new Error('Empty transcription result');
  }
  
  return data.results[0].alternatives[0].transcript;
}
