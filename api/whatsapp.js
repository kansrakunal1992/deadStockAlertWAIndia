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
          timeout: 5000, // 5-second timeout
          maxContentLength: 10 * 1024 * 1024, // 10MB max
          validateStatus: (status) => status === 200
        });

        // 3. Verify audio content
        if (!headers['content-type']?.includes('audio/ogg')) {
          throw new Error('Response is not audio - got content-type: ' + headers['content-type']);
        }

        // 4. Transcribe with Google Cloud STT
        const transcript = await googleTranscribe(audioBuffer, 'hi-IN');
        
        // 5. Validate transcription contains numbers
        if (!transcript.match(/\d+/)) {
          throw new Error('No quantities detected in transcript');
        }

        response.message(`✅ Transcribed: "${transcript}"\n\nReply "1" to confirm.`);

      } catch (error) {
        console.error('Voice Processing Error:', error.message);
        
        // Fallback 1: Try Twilio's built-in transcription
        if (body.SpeechResult) {
          response.message(`🔊 (Basic) Transcribed: "${body.SpeechResult}"`);
        } 
        // Fallback 2: Generic error message
        else {
          response.message('❌ Could not process. Please say: "10 Parle-G sold"');
        }
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

// Google Cloud Speech-to-Text with robust error handling
async function googleTranscribe(audioBuffer, languageCode = 'hi-IN') {
  try {
    // 1. Load and validate credentials
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    
    if (!credentials.private_key || !credentials.client_email) {
      throw new Error('Invalid Google Cloud credentials');
    }

    // 2. Authenticate with proper newline handling
    const auth = new GoogleAuth({
      credentials: {
        ...credentials,
        private_key: credentials.private_key.replace(/\\n/g, '\n') // Fix newlines
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      projectId: credentials.project_id
    });

    const client = await auth.getClient();
    const audioBase64 = audioBuffer.toString('base64');

    // 3. Prepare request with Indian retail context
    const request = {
      audio: { content: audioBase64 },
      config: {
        languageCode: languageCode,
        enableAutomaticPunctuation: true,
        model: 'latest_short',
        useEnhanced: true,
        speechContexts: [{
          phrases: [
            'Parle-G', 'Maggi', 'Dabur', 'kg', 'liter', 'pcs',
            'beche', 'khareeda', 'सोल्ड', 'खरीदा', 'किलो',
            '10', '20', '30', '40', '50' // Number boosts
          ],
          boost: 20.0
        }]
      }
    };

    // 4. Call Google STT API
    const { data } = await client.request({
      url: 'https://speech.googleapis.com/v1/speech:recognize',
      method: 'POST',
      data: request,
      timeout: 10000
    });

    if (!data.results || !data.results[0]?.alternatives[0]?.transcript) {
      throw new Error('Invalid Google STT response: ' + JSON.stringify(data));
    }

    return data.results[0].alternatives[0].transcript;

  } catch (error) {
    console.error('Google STT Error:', error.message);
    throw new Error('Failed to transcribe audio');
  }
}
