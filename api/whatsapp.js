// /api/whatsapp.js
const twilio = require('twilio');
const axios = require('axios');
const FormData = require('form-data');

// Initialize Twilio client with your environment variables
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

        // 2. Transcribe with Google Cloud STT (optimized for Indian accents)
        const transcript = await googleTranscribe(audioBuffer, 'hi-IN'); // Hindi-India
        
        // 3. Validate and reply
        if (transcript.match(/\d+/)) { // Check if numbers detected
          response.message(`✅ Transcribed: "${transcript}"\n\nReply "1" to confirm or "2" to re-record.`);
        } else {
          response.message('⚠️ No quantities detected. Say something like "10 Parle-G sold".');
        }

      } catch (error) {
        console.error('Transcription Error:', error.response?.data || error.message);
        
        // Fallback to Twilio's built-in STT if Google fails
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

// Google Cloud Speech-to-Text (Indian accent optimized)
async function googleTranscribe(audioBuffer, languageCode = 'hi-IN') {
  const audioBase64 = audioBuffer.toString('base64');

  const { data } = await axios.post(
    `https://speech.googleapis.com/v1/speech:recognize?key=${process.env.GOOGLE_CLOUD_KEY}`,
    {
      audio: { content: audioBase64 },
      config: {
        languageCode: languageCode,
        enableAutomaticPunctuation: true,
        model: 'latest_short', // Best for voice notes
        speechContexts: [{ // Boost Indian product names
          phrases: [
            'Parle-G', 'Maggi', 'Dabur', 'kg', 'liter', 
            'beche', 'khareeda', 'सोल्ड', 'खरीदा' // Hindi terms
          ],
          boost: 15.0
        }]
      }
    },
    { timeout: 10000 } // 10s timeout
  );

  return data.results[0].alternatives[0].transcript;
}
