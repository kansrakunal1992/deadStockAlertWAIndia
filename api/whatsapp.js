// /api/whatsapp.js
const twilio = require('twilio');
const axios = require('axios');
const FormData = require('form-data');

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

        // 2. Transcribe with DeepSeek
        const transcript = await deepseekTranscribe(audioBuffer, 'hi');
        
        // 3. Reply with transcript
        response.message(`✅ Transcribed: "${transcript}"\n\nReply "1" to confirm or "2" to re-record.`);
      } catch (error) {
        console.error('Error:', error.message);
        response.message('❌ Failed to process. Please try again.');
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

// DeepSeek Transcription (Updated with your env vars)
async function deepseekTranscribe(audioBuffer, language) {
  const formData = new FormData();
  formData.append('audio_file', audioBuffer, {
    filename: 'audio.ogg',
    contentType: 'audio/ogg'
  });
  formData.append('language', language);

  const { data } = await axios.post(
    'https://api.deepseek.com/v1/stt',
    formData,
    {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_KEY}`,
        ...formData.getHeaders()
      }
    }
  );
  return data.text;
}

// Initialize Twilio client with your env var names
const twilioClient = twilio(
  process.env.ACCOUNT_SID,    // Matches your Vercel env
  process.env.AUTH_TOKEN      // Matches your Vercel env
);
