const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`[${requestId}] New request received:`, {
    method: req.method,
    hasMedia: !!req.body.MediaUrl0,
    mediaType: req.body.MediaContentType0,
    numMedia: req.body.NumMedia
  });
  
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    
    const { MediaUrl0, NumMedia, SpeechResult } = req.body;
    if (NumMedia > 0 && MediaUrl0) {
      console.log(`[${requestId}] [1] Downloading audio...`);
      const audioBuffer = await downloadAudio(MediaUrl0);
      
      console.log(`[${requestId}] [2] Converting audio...`);
      const flacBuffer = await convertToFLAC(audioBuffer);
      
      console.log(`[${requestId}] [3] Transcribing with Google STT...`);
      const transcript = await googleTranscribe(flacBuffer, requestId);
      
      response.message(`✅ Transcribed: "${transcript}"`);
    }
    else if (SpeechResult) {
      console.log(`[${requestId}] [1] Using Twilio transcription`);
      response.message(`🔊 (Twilio): "${SpeechResult}"`);
    }
    else {
      console.log(`[${requestId}] [1] No media received`);
      response.message('🎤 Send a voice note: "10 Parle-G sold"');
    }
  } catch (error) {
    console.error(`[${requestId}] Processing Error:`, {
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
    const inputHash = crypto.createHash('md5').update(oggBuffer).digest('hex');
    console.log(`[2] Converting audio, input size: ${oggBuffer.length} bytes, MD5: ${inputHash}`);
    
    fs.writeFileSync('/tmp/input.ogg', oggBuffer);
    execSync(
      'ffmpeg -i /tmp/input.ogg -ar 16000 -ac 1 -c:a flac -compression_level 5 /tmp/output.flac',
      { timeout: 3000 }
    );
    
    const flacBuffer = fs.readFileSync('/tmp/output.flac');
    const outputHash = crypto.createHash('md5').update(flacBuffer).digest('hex');
    console.log(`[2] Conversion complete, output size: ${flacBuffer.length} bytes, MD5: ${outputHash}`);
    
    // Clean up temporary files
    fs.unlinkSync('/tmp/input.ogg');
    fs.unlinkSync('/tmp/output.flac');
    
    return flacBuffer;
  } catch (error) {
    console.error('FFmpeg conversion failed:', error.message);
    throw new Error('Audio processing error');
  }
}

async function downloadAudio(url) {
  console.log('[1] Downloading audio from:', url);
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
  
  const hash = crypto.createHash('md5').update(data).digest('hex');
  console.log(`[1] Audio downloaded, size: ${data.length} bytes, MD5: ${hash}`);
  
  return data;
}

async function googleTranscribe(flacBuffer, requestId) {
  try {
    const base64Key = process.env.GCP_BASE64_KEY?.trim();
    
    if (!base64Key) {
      throw new Error('GCP_BASE64_KEY environment variable not set');
    }
    
    let decodedKey;
    try {
      decodedKey = Buffer.from(base64Key, 'base64').toString('utf8');
    } catch (decodeErr) {
      throw new Error(`Base64 decoding failed: ${decodeErr.message}`);
    }
    
    let credentials;
    try {
      credentials = JSON.parse(decodedKey);
    } catch (parseErr) {
      throw new Error(`JSON parsing failed: ${parseErr.message}`);
    }
    
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
        
        const audioContent = flacBuffer.toString('base64');
        console.log(`[${requestId}] Processing with ${config.model} model, audio size: ${audioContent.length}`);
        
        const { data } = await client.request({
          url: `https://speech.googleapis.com/v1/speech:recognize?_${Date.now()}`,
          method: 'POST',
          data: {
            audio: { content: audioContent },
            config
          },
          timeout: 8000
        });
        
        console.log(`[${requestId}] Google STT response:`, JSON.stringify(data, null, 2));
        
        const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;
        if (transcript) {
          console.log(`[${requestId}] STT Success: ${config.model} model - Transcript: "${transcript}"`);
          return transcript;
        }
      } catch (error) {
        console.warn(`[${requestId}] STT Attempt Failed:`, {
          model: config.model,
          error: error.response?.data?.error?.message || error.message
        });
      }
    }
    
    throw new Error(`[${requestId}] All STT attempts failed`);
  } catch (error) {
    console.error(`[${requestId}] Google Transcription Error:`, error.message);
    throw error;
  }
}
