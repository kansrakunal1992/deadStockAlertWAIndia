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
        // 1. Download audio from Twilio
        const audioUrl = body.MediaUrl0;
        const { data: audioBuffer } = await axios.get(audioUrl, {
          responseType: 'arraybuffer'
        });

        // 2. Transcribe with Google Cloud STT
        const transcript = await googleTranscribe(audioBuffer, 'hi-IN');
        
        // 3. Validate and reply
        if (transcript.match(/\d+/)) { // Check for numbers
          response.message(`✅ Transcribed: "${transcript}"\n\nReply "1" to confirm or "2" to re-record.`);
        } else {
          response.message('⚠️ No quantities detected. Say something like "10 Parle-G sold".');
        }

      } catch (error) {
        console.error('Transcription Error:', error.response?.data || error.message);
        
        // Fallback to Twilio's built-in STT
        if (body.SpeechResult) {
          response.message(`🔊 Twilio transcribed: "${body.SpeechResult}" (Lower accuracy)`);
        } else {
          response.message('❌ System busy. Please send audio again.');
        }
      }
    }
    // Handle confirmation
    else if (body.Body === '1') {
      response.message('🗃️ Updating inventory... (Step 3)');
    }
    // Default prompt
    else {
      response.message('🎤 Send a voice note: "10 Parle-G sold"');
    }
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// Google Cloud STT with service account authentication
async function googleTranscribe(audioBuffer, languageCode = 'hi-IN') {
  try {
    // Authenticate with service account JSON
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });

    const client = await auth.getClient();
    const audioBase64 = audioBuffer.toString('base64');

    // Boost Indian product terms
    const request = {
      audio: { content: audioBase64 },
      config: {
        languageCode: languageCode,
        enableAutomaticPunctuation: true,
        model: 'latest_short',
        speechContexts: [{
          phrases: [
            'Parle-G', 'Maggi', 'Dabur', 'kg', 'liter', 
            'beche', 'khareeda', 'सोल्ड', 'खरीदा'
          ],
          boost: 15.0
        }]
      }
    };

    const { data } = await client.request({
      url: 'https://speech.googleapis.com/v1/speech:recognize',
      method: 'POST',
      data: request
    });

    return data.results[0].alternatives[0].transcript;
  } catch (error) {
    console.error('Google STT Error:', error.message);
    throw error;
  }
}
