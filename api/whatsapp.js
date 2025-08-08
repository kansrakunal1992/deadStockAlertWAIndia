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

// FIXED: Parse single update with better action detection
function parseSingleUpdate(transcript) {
  const products = [
    'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
    'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
    'flour', 'आटा', 'sugar', 'चीनी', 'packets', 'पैकेट'
  ];
  
  // Find product (case-insensitive)
  const product = products.find(p => 
    transcript.toLowerCase().includes(p.toLowerCase())
  ) || 'Unknown';
  
  // Support for multiple number formats (digits, English words, Hindi words)
  const numberWords = {
    // English
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 
    'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
    'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
    'eighteen': 18, 'nineteen': 19, 'twenty': 20, 'thirty': 30, 'forty': 40, 
    'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90, 'hundred': 100,
    
    // Hindi
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'छह': 6, 
    'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'ग्यारह': 11, 'बारह': 12,
    'तेरह': 13, 'चौदह': 14, 'पंद्रह': 15, 'सोलह': 16, 'सत्रह': 17,
    'अठारह': 18, 'उन्नीस': 19, 'बीस': 20, 'तीस': 30, 'चालीस': 40, 
    'पचास': 50, 'साठ': 60, 'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90, 'सौ': 100
  };
  
  let quantity = 0;
  
  // Try to match digits first
  const digitMatch = transcript.match(/(\d+)/i);
  if (digitMatch) {
    quantity = parseInt(digitMatch[1]) || 0;
  } else {
    // Try to match number words
    const words = transcript.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (numberWords[word]) {
        quantity = numberWords[word];
        break;
      }
    }
  }
  
  // FIXED: Better action detection with priority for purchase/sold over remaining
  const isPurchase = /(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)/i.test(transcript);
  const isSold = /(बेचा|बेचे|becha|sold|बिक्री)/i.test(transcript);
  const isRemaining = /(बचा|बचे|बाकी|remaining|left)/i.test(transcript);
  
  // Determine the action and quantity
  let action, finalQuantity;
  
  if (isPurchase) {
    action = 'purchased';
    finalQuantity = quantity;  // Positive for purchases
  } else if (isSold) {
    action = 'sold';
    finalQuantity = -quantity;  // Negative for sales
  } else if (isRemaining) {
    // Only treat as "remaining" if no other action is detected
    action = 'remaining';
    finalQuantity = quantity;  // This will be handled as an absolute value
  } else {
    // Default to sold if no specific action is detected
    action = 'sold';
    finalQuantity = -quantity;  // Negative for sales
  }
  
  return {
    product,
    quantity: finalQuantity,
    action
  };
}

// FIXED: Handle multiple inventory updates
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
  
  // Check if action is purchase, sold, or remaining
  const validAction = ['purchased', 'sold', 'remaining'].includes(parsed.action);
  
  return validProduct && validQuantity && validAction;
}

// FIXED: Improved handling of "bacha" vs "becha" confusion
async function validateTranscript(transcript, requestId) {
  try {
    // First, fix common mispronunciations before sending to DeepSeek
    let fixedTranscript = transcript;
    
    // IMPROVED: More comprehensive patterns for fixing "bacha" to "becha"
    
    // Pattern 1: "बचा" followed by a quantity and product (most common case)
    fixedTranscript = fixedTranscript.replace(/(\d+)\s*(kg|किलो|packets?|पैकेट|grams?|ग्राम)\s*([a-zA-Z\s]+)\s+बचा/gi, (match, qty, unit, product) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${qty} ${unit} ${product} बेचा"`);
      return `${qty} ${unit} ${product} बेचा`;
    });
    
    // Pattern 2: "बचा" followed by a product and quantity
    fixedTranscript = fixedTranscript.replace(/([a-zA-Z\s]+)\s+(\d+)\s*(kg|किलो|packets?|पैकेट|grams?|ग्राम)\s+बचा/gi, (match, product, qty, unit) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${product} ${qty} ${unit} बेचा"`);
      return `${product} ${qty} ${unit} बेचा`;
    });
    
    // Pattern 3: Product followed by "बचा" and then purchase action
    fixedTranscript = fixedTranscript.replace(/([a-zA-Z\s]+)\s+बचा\s+.*?(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)/gi, (match, product, purchase) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${product} बेचा, ${purchase}"`);
      return `${product} बेचा, ${purchase}`;
    });
    
    // Pattern 4: Purchase action followed by product and "बचा"
    fixedTranscript = fixedTranscript.replace(/(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)\s+([a-zA-Z\s]+)\s+बचा/gi, (match, purchase, product) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${purchase} ${product}, बेचा ${product}"`);
      return `${purchase} ${product}, बेचा ${product}`;
    });
    
    // Pattern 5: Simple "बचा" at the end of a sentence with a product
    fixedTranscript = fixedTranscript.replace(/([a-zA-Z\s]+)\s+बचा[.!?]*$/gi, (match, product) => {
      // Only replace if it doesn't contain words indicating "remaining"
      if (!product.match(/(remaining|left|बाकी)/i)) {
        console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${product} बेचा"`);
        return `${product} बेचा`;
      }
      return match;
    });
    
    if (fixedTranscript !== transcript) {
      console.log(`[${requestId}] Fixed transcript: "${transcript}" → "${fixedTranscript}"`);
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
            - Convert number words to digits (e.g., "five" → "5")
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

// FIXED: Combine all speech segments into a single transcript and detect language
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
    
    // Try multiple languages to support multilingual input
    const languageConfigs = [
      { languageCode: 'hi-IN', name: 'Hindi' },
      { languageCode: 'en-IN', name: 'English (India)' },
      { languageCode: 'en-US', name: 'English (US)' }
    ];
    
    for (const langConfig of languageConfigs) {
      try {
        const baseConfig = {
          languageCode: langConfig.languageCode,
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
            console.log(`[${requestId}] Processing with ${config.model} model (${langConfig.name}), audio size: ${audioContent.length}`);
            const { data } = await client.request({
              url: 'https://speech.googleapis.com/v1/speech:recognize',
              method: 'POST',
              data: {
                audio: { content: audioContent },
                config
              },
              timeout: 8000
            });
            
            // Combine all results into a single transcript
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
              console.log(`[${requestId}] STT Success: ${config.model} model (${langConfig.name}) - Transcript: "${fullTranscript}"`);
              return fullTranscript;
            }
          } catch (error) {
            console.warn(`[${requestId}] STT Attempt Failed:`, {
              model: config.model,
              language: langConfig.name,
              error: error.response?.data?.error?.message || error.message
            });
          }
        }
      } catch (error) {
        console.warn(`[${requestId}] Language ${langConfig.name} failed:`, error.message);
      }
    }
    throw new Error(`[${requestId}] All STT attempts failed`);
  } catch (error) {
    console.error(`[${requestId}] Google Transcription Error:`, error.message);
    throw error;
  }
}

// Helper function for Airtable requests
async function airtableRequest(config, context = 'Airtable Request') {
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  let AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
  
  // Clean the base ID
  AIRTABLE_BASE_ID = AIRTABLE_BASE_ID
    .trim()
    .replace(/[;,\s]+$/, '')
    .replace(/[;,\s]+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');
    
  const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Inventory';
  const airtableBaseURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + TABLE_NAME;
  
  const headers = {
    'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
    'Content-Type': 'application/json'
  };
  
  try {
    const response = await axios({
      ...config,
      url: config.url || airtableBaseURL,
      headers,
      timeout: 10000
    });
    
    return response.data;
  } catch (error) {
    console.error(`[${context}] Error:`, error.message);
    if (error.response) {
      console.error(`[${context}] Status:`, error.response.status);
      console.error(`[${context}] Data:`, error.response.data);
    }
    throw error;
  }
}
