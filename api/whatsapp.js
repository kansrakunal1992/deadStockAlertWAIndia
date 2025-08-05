// /api/whatsapp.js
const twilio = require('twilio');
const axios = require('axios');
const FormData = require('form-data');

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();

  if (req.method === 'POST') {
    const body = req.body;

    if (body.NumMedia > 0 && body.MediaContentType0 === 'audio/ogg') {
      try {
        // Debug: Log key (remove later)
        console.log('DeepSeek Key:', process.env.DEEPSEEK_KEY?.slice(0, 5) + '...');

        const audioUrl = body.MediaUrl0;
        const { data: audioBuffer } = await axios.get(audioUrl, {
          responseType: 'arraybuffer'
        });

        // Transcribe
        const transcript = await deepseekTranscribe(audioBuffer, 'en');
        response.message(`✅ Transcribed: "${transcript}"`);
        
      } catch (error) {
        console.error('DeepSeek Error:', error.response?.data || error.message);
        response.message('❌ System error. Please try again later.');
      }
    }
  }

  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

async function deepseekTranscribe(audioBuffer, language) {
  const formData = new FormData();
  formData.append('audio_file', audioBuffer, {
    filename: 'audio.ogg',
    contentType: 'audio/ogg'
  });

  const { data } = await axios.post(
    'https://api.deepseek.com/v1/stt',
    formData,
    {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_KEY}`,
        ...formData.getHeaders()
      },
      timeout: 10000
    }
  );
  return data.text;
}
