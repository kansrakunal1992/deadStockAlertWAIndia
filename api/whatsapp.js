const twilio = require('twilio');
const axios = require('axios');
const FormData = require('form-data');

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

      console.log('[2] Uploading to AssemblyAI...');
      const transcript = await transcribeWithAssemblyAI(audioBuffer);

      response.message(`✅ Transcribed: "${transcript}"`);
    } else if (SpeechResult) {
      console.log('[1] Using Twilio transcription');
      response.message(`🔊 (Twilio): "${SpeechResult}"`);
    } else {
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

async function transcribeWithAssemblyAI(buffer) {
  const uploadRes = await axios.post(
    'https://api.assemblyai.com/v2/upload',
    buffer,
    {
      headers: {
        authorization: process.env.ASSEMBLYAI_API_KEY,
        'Content-Type': 'application/octet-stream'
      }
    }
  );

  const transcriptRes = await axios.post(
    'https://api.assemblyai.com/v2/transcript',
    {
      audio_url: uploadRes.data.upload_url,
      language_code: 'hi',
      punctuate: true,
      boost_param: {
        phrases: [
          'Parle-G', 'Britannia', 'Sunfeast', 'Bourbon', 'Maggi',
          '10', '20', '50', '100', '500', '1000',
          'kg', 'किलो', 'ग्राम', 'पैकेट', 'बॉक्स',
          'खरीदा', 'बेचा', 'बिक्री', 'क्रय', 'लिया', 'दिया', 'बचा'
        ]
      }
    },
    {
      headers: {
        authorization: process.env.ASSEMBLYAI_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );

  const transcriptId = transcriptRes.data.id;

  // Polling for completion
  for (let i = 0; i < 20; i++) {
    const statusRes = await axios.get(
      `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
      {
        headers: {
          authorization: process.env.ASSEMBLYAI_API_KEY
        }
      }
    );

    if (statusRes.data.status === 'completed') {
      return statusRes.data.text;
    } else if (statusRes.data.status === 'error') {
      throw new Error('AssemblyAI transcription failed');
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('AssemblyAI transcription timed out');
}
