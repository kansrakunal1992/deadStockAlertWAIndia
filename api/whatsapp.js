// /api/whatsapp.js
const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.ACCOUNT_SID,
  process.env.AUTH_TOKEN
);

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();

  if (req.method === 'POST') {
    const body = req.body;

    // Handle voice note
    if (body.NumMedia > 0 && body.MediaContentType0 === 'audio/ogg') {
      try {
        // 1. Validate Twilio audio URL
        const audioUrl = body.MediaUrl0;
        if (!audioUrl || !audioUrl.startsWith('https://api.twilio.com')) {
          throw new Error('Invalid Twilio audio URL');
        }

        // 2. Download audio with strict validation
        const { data: audioBuffer, headers } = await axios.get(audioUrl, {
          responseType: 'arraybuffer',
          timeout: 5000,
          maxContentLength: 10 * 1024 * 1024,
          validateStatus: (status) => status === 200
        });

        // 3. Verify audio content
        if (!headers['content-type']?.includes('audio/ogg')) {
          throw new Error('Invalid audio content type: ' + headers['content-type']);
        }

        // 4. Transcribe with Google Cloud STT
        const transcript = await googleTranscribe(audioBuffer);
        
        // 5. Validate transcription
        if (!transcript.match(/\d+/)) {
          throw new Error('No quantities detected');
        }

        response.message(`✅ Transcribed: "${transcript}"\n\nReply "1" to confirm.`);

      } catch (error) {
        console.error('Processing Error:', error.message);
        response.message(error.message.includes('audio') ? 
          '❌ Invalid audio. Say "10 Parle-G sold"' : 
          '🔊 Basic Transcription: "' + (body.SpeechResult || 'Not available') + '"');
      }
    }
    // Handle confirmation
    else if (body.Body === '1') {
      response.message('🗃️ Inventory update initiated...');
    }
    // Default prompt
    else {
      response.message('🎤 Send voice note: "10 Parle-G sold"');
    }
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// Google Cloud Speech-to-Text with credential fixes
async function googleTranscribe(audioBuffer) {
  try {
    // 1. Parse credentials with proper newline handling
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    const privateKey = credentials.private_key.replace(/\\n/g, '\n');

    // 2. Authenticate
    const auth = new GoogleAuth({
      credentials: {
        ...credentials,
        private_key: privateKey
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });

    const client = await auth.getClient();
    const audioBase64 = audioBuffer.toString('base64');

    // 3. Prepare optimized request
    const request = {
      audio: { content: audioBase64 },
      config: {
        languageCode: 'hi-IN',
        enableAutomaticPunctuation: true,
        model: 'latest_short',
        speechContexts: [{
          phrases: [
            'Parle-G', 'Maggi', 'Dabur', 'kg', 'liter',
            '10', '20', '30', '40', '50',
            'beche', 'khareeda', 'किलो'
          ],
          boost: 20.0
        }]
      }
    };

    // 4. Call API
    const { data } = await client.request({
      url: 'https://speech.googleapis.com/v1/speech:recognize',
      method: 'POST',
      data: request,
      timeout: 10000
    });

    if (!data.results?.[0]?.alternatives?.[0]?.transcript) {
      throw new Error('Empty transcription result');
    }

    return data.results[0].alternatives[0].transcript;

  } catch (error) {
    console.error('Google STT Error:', error.response?.data || error.message);
    throw new Error('Failed to transcribe: ' + error.message.split('\n')[0]);
  }
}
