const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const { updateInventory, testConnection } = require('./database');

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    const { MediaUrl0, NumMedia, SpeechResult, From } = req.body;
    
    if (NumMedia > 0 && MediaUrl0) {
      console.log(`[${requestId}] [1] Downloading audio...`);
      const audioBuffer = await downloadAudio(MediaUrl0);
      
      console.log(`[${requestId}] [2] Converting audio...`);
      const flacBuffer = await convertToFLAC(audioBuffer);
      
      console.log(`[${requestId}] [3] Transcribing with Google STT...`);
      const rawTranscript = await googleTranscribe(flacBuffer, requestId);
      
      console.log(`[${requestId}] [4] Validating transcript...`);
      const cleanTranscript = await validateTranscript(rawTranscript, requestId);
      
      console.log(`[${requestId}] [5] Parsing multiple updates...`);
      const updates = parseMultipleUpdates(cleanTranscript);
      
      // RESTRICTION: Validate if there are any valid inventory updates
      if (updates.length === 0) {
        console.log(`[${requestId}] Rejected: No valid inventory updates`);
        response.message(
          '❌ Please send inventory updates only:\n\n' +
          'Examples:\n' +
          '• "10 Parle-G sold"\n' +
          '• "5kg sugar purchased"\n' +
          '• "2 boxes Maggi bought"\n\n' +
          'You can send multiple updates in one message!'
        );
        return res.send(response.toString());
      }
      
      console.log(`[${requestId}] [6] Testing Airtable connection...`);
      const connectionTest = await testConnection();
      if (!connectionTest) {
        console.error(`[${requestId}] Airtable connection failed`);
        response.message('❌ Database connection error. Please try again later.');
        return res.send(response.toString());
      }
      
      console.log(`[${requestId}] [7] Updating inventory for ${updates.length} items...`);
      const shopId = From.replace('whatsapp:', '');
      const results = await updateMultipleInventory(shopId, updates);
      
      // Format response message
      let message = '✅ Updates processed:\n\n';
      let successCount = 0;
      
      for (const result of results) {
        if (result.success) {
          successCount++;
          message += `• ${result.product}: ${result.quantity > 0 ? '+' : ''}${result.quantity} (Stock: ${result.newQuantity})\n`;
        } else {
          message += `• ${result.product}: Error - ${result.error}\n`;
        }
      }
      
      message += `\n✅ Successfully updated ${successCount} of ${updates.length} items`;
      response.message(message);
    }
    else if (SpeechResult) {
      console.log(`[${requestId}] [1] Using Twilio transcription`);
      response.message(`🔊 (Twilio): "${SpeechResult}"`);
    }
    else {
      console.log(`[${requestId}] [1] No media received`);
      response.message('🎤 Send inventory update: "10 Parle-G sold"');
    }
  } catch (error) {
    console.error(`[${requestId}] Processing Error:`, error.message);
    response.message('❌ System error. Please try again with a clear voice message.');
  }
  
  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// NEW: Parse multiple inventory updates from transcript
function parseMultipleUpdates(transcript) {
  const updates = [];
  const sentences = transcript.split(/[.!?]+/);
  
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed) {
      const update = parseSingleUpdate(trimmed);
      if (isValidInventoryUpdate(update)) {
        updates.push(update);
      }
    }
  }
  
  console.log(`Parsed ${updates.length} valid updates from transcript`);
  return updates;
}

// Modified: Parse single update (used by multi-update parser)
function parseSingleUpdate(transcript) {
  const products = [
    'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
    'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
    'flour', 'आटा', 'sugar', 'चीनी', 'packets', 'पैकेट'
  ];
  
  const product = products.find(p => 
    transcript.toLowerCase().includes(p.toLowerCase())
  ) || 'Unknown';
  
  const quantityMatch = transcript.match(/(\d+|दस|बीस|पचास|सौ)/i);
  let quantity = 0;
  
  if (quantityMatch) {
    const num = quantityMatch[1];
    const hindiToEnglish = {
      'दस': 10, 'बीस': 20, 'पचास': 50, 'सौ': 100
    };
    quantity = hindiToEnglish[num] || parseInt(num) || 0;
  }
  
  const isPurchase = /(खरीदा|लिया|bought|purchased)/i.test(transcript);
  
  return {
    product,
    quantity: isPurchase ? quantity : -quantity,
    action: isPurchase ? 'purchased' : 'sold'
  };
}

// NEW: Handle multiple inventory updates
async function updateMultipleInventory(shopId, updates) {
  const results = [];
  
  for (const update of updates) {
    try {
      const result = await updateInventory(shopId, update.product, update.quantity);
      results.push({
        product: update.product,
        quantity: update.quantity,
        ...result
      });
    } catch (error) {
      results.push({
        product: update.product,
        quantity: update.quantity,
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
}

// RESTRICTION: Validate if transcript is an inventory update
function isValidInventoryUpdate(parsed) {
  // Check if product is known (not "Unknown")
  const validProduct = parsed.product !== 'Unknown';
  
  // Check if quantity is non-zero
  const validQuantity = parsed.quantity !== 0;
  
  // Check if action is purchase or sale
  const validAction = ['purchased', 'sold'].includes(parsed.action);
  
  return validProduct && validQuantity && validAction;
}

// FIXED: Handle "bacha" vs "becha" confusion
async function validateTranscript(transcript, requestId) {
  try {
    // First, fix common mispronunciations before sending to DeepSeek
    let fixedTranscript = transcript;
    
    // Fix "bacha" to "becha" when it's likely meant as "sold"
    // This pattern looks for "bacha" followed by product names or quantities
    fixedTranscript = fixedTranscript.replace(/bacha\s+(\d+\s*)?(kg|packets?|kilos?)?\s*([a-zA-Z\s]+)?/gi, (match, qty, unit, product) => {
      // If it's followed by a quantity or product, it's likely "sold" not "remaining"
      if (qty || unit || (product && !product.includes('remaining'))) {
        return match.replace('bacha', 'becha');
      }
      return match;
    });
    
    // Also handle the case where "bacha" appears at the end of a sentence
    fixedTranscript = fixedTranscript.replace(/([a-zA-Z\s]+)\s+bacha[.!?]*$/gi, (match, product) => {
      // If it's a product name followed by "bacha", it's likely "sold"
      if (product && !product.includes('remaining')) {
        return product + ' becha';
      }
      return match;
    });
    
    if (fixedTranscript !== transcript) {
      console.log(`[${requestId}] Fixed mispronunciations: "${transcript}" → "${fixedTranscript}"`);
    }
    
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are an inventory assistant. Clean up this transcript:
            - Fix grammar errors
            - Convert to English if needed
            - Ensure product names are correct
            - Return ONLY the cleaned text, nothing else`
          },
          {
            role: "user",
            content: fixedTranscript
          }
        ],
        max_tokens: 50,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const cleaned = response.data.choices[0].message.content.trim();
    console.log(`[${requestId}] Cleaned transcript: "${cleaned}"`);
    return cleaned;
  } catch (error) {
    console.warn(`[${requestId}] Deepseek validation failed, using original:`, error.message);
    return transcript;
  }
}

// Audio Processing Functions
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

// FIXED: Combine all speech segments into a single transcript
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
          url: 'https://speech.googleapis.com/v1/speech:recognize',
          method: 'POST',
          data: {
            audio: { content: audioContent },
            config
          },
          timeout: 8000
        });
        console.log(`[${requestId}] Google STT response:`, JSON.stringify(data, null, 2));
        
        // FIXED: Combine all results into a single transcript
        let fullTranscript = '';
        if (data.results && data.results.length > 0) {
          for (const result of data.results) {
            if (result.alternatives && result.alternatives.length > 0) {
              fullTranscript += result.alternatives[0].transcript + ' ';
            }
          }
        }
        
        fullTranscript = fullTranscript.trim();
        
        if (fullTranscript) {
          console.log(`[${requestId}] STT Success: ${config.model} model - Transcript: "${fullTranscript}"`);
          return fullTranscript;
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
