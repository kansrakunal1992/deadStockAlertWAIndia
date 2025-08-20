const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const {
  updateInventory,
  testConnection,
  createBatchRecord,
  getBatchRecords,
  updateBatchExpiry,
  saveUserPreference,
  getUserPreference,
  createSalesRecord,
  updateBatchQuantity,
  batchUpdateInventory
} = require('../database');

// Performance tracking
const responseTimes = {
  total: 0,
  count: 0,
  max: 0
};

// Cache implementations
const languageCache = new Map();
const productMatchCache = new Map();
const inventoryCache = new Map();

// Cache TTL values
const LANGUAGE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const INVENTORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const PRODUCT_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Precompiled regex patterns for better performance
const regexPatterns = {
  purchaseKeywords: /(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)/gi,
  salesKeywords: /(बेचा|बेचे|becha|sold|बिक्री)/gi,
  remainingKeywords: /(बचा|बचे|बाकी|remaining|left)/gi,
  dateFormats: /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})/gi,
  digits: /(\d+|[०-९]+)/i,
  resetCommands: /(reset|start over|restart|cancel|exit|stop)/gi
};

// Global storage with cleanup mechanism
const globalState = {
  userPreferences: {},
  pendingTranscriptions: {},
  pendingProductUpdates: {},
  conversationState: {},
  lastCleanup: Date.now()
};

// Reset commands to allow users to exit any flow
const resetCommands = ['reset', 'start over', 'restart', 'cancel', 'exit', 'stop'];

// Expanded product list with common grocery items
const products = [
  // Branded items
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
  'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
  // Basic groceries
  'flour', 'आटा', 'sugar', 'चीनी', 'salt', 'नमक',
  'rice', 'चावल', 'wheat', 'गेहूं', 'oil', 'तेल',
  // Vegetables
  'potato', 'आलू', 'potatoes', 'onion', 'प्याज', 'onions',
  'tomato', 'टमाटर', 'tomatoes', 'carrot', 'गाजर', 'carrots',
  'cabbage', 'पत्ता गोभी', 'cauliflower', 'फूलगोभी', 'spinach', 'पालक',
  // Fruits
  'apple', 'सेब', 'apples', 'banana', 'केला', 'bananas',
  'orange', 'संतरा', 'oranges', 'mango', 'आम', 'mangoes',
  // Dairy
  'milk', 'दूध', 'curd', 'दही', 'yogurt', 'butter', 'मक्खन',
  'cheese', 'पनीर', 'ghee', 'घी', 'cream', 'मलाई',
  // Spices
  'turmeric', 'हल्दी', 'cumin', 'जीरा', 'coriander', 'धनिया',
  'chili', 'मिर्च', 'pepper', 'काली मिर्च', 'cardamom', 'इलायची',
  // Packaged goods
  'packets', 'पैकेट', 'boxes', 'बॉक्स', 'bags', 'बैग्स',
  'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट'
];

// Number words mapping
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
  'पचास': 50, 'साठ': 60, 'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90, 'सौ': 100,
  // Special case: "सो" means 100 in Hindi when referring to quantity
  'सो': 100,
  // Hindi numerals (Devanagari digits)
  '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9,
  '१०': 10, '११': 11, '१२': 12, '१३': 13, '१४': 14, '१५': 15, '१६': 16
};

// Units mapping
const units = {
  'packets': 1, 'पैकेट': 1,
  'boxes': 1, 'बॉक्स': 1,
  'kg': 1, 'किलो': 1, 'kilo': 1, 'kilogram': 1, 'kilograms': 1,
  'g': 0.001, 'gram': 0.001, 'grams': 0.001, 'ग्राम': 0.001,
  'liters': 1, 'लीटर': 1, 'litre': 1, 'litres': 1,
  'ml': 0.001, 'milliliter': 0.001, 'milliliters': 0.001, 'millilitre': 0.001, 'millilitres': 0.001,
  'pieces': 1, 'पीस': 1
};

// Greetings mapping by language
const greetings = {
  'hi': ['hello', 'hi', 'hey', 'नमस्ते', 'नमस्कार', 'हाय'],
  'ta': ['vanakkam', 'வணக்கம்'],
  'te': ['నమస్కారం', 'హలో'],
  'kn': ['ನಮಸ್ಕಾರ', 'ಹಲೋ'],
  'bn': ['নমস্কার', 'হ্যালো'],
  'gu': ['નમસ્તે', 'હેલો'],
  'mr': ['नमस्कार', 'हॅलो'],
  'en': ['hello', 'hi', 'hey'],
  'fr': ['salut', 'bonjour', 'allo'],
  'es': ['hola', 'buenos dias'],
  'de': ['hallo', 'guten tag'],
  'it': ['ciao', 'buongiorno'],
  'pt': ['ola', 'bom dia'],
  'ru': ['привет', 'здравствуй'],
  'ja': ['こんにちは', 'やあ'],
  'zh': ['你好', '嗨']
};

// Helper function to format dates for Airtable (YYYY-MM-DD)
function formatDateForAirtable(date) {
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  if (typeof date === 'string') {
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return date;
    }
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString().split('T')[0];
    }
  }
  return null;
}

// Helper function to format date for display (DD/MM/YYYY)
function formatDateForDisplay(date) {
  if (date instanceof Date) {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
  if (typeof date === 'string') {
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = date.split('-');
      return `${day}/${month}/${year}`;
    }
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate.getTime())) {
      return formatDateForDisplay(parsedDate);
    }
  }
  return date;
}

// Helper function to calculate days between two dates
function daysBetween(date1, date2) {
  const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds
  const diffDays = Math.round(Math.abs((date1 - date2) / oneDay));
  return diffDays;
}

// Performance tracking function
function trackResponseTime(startTime, requestId) {
  const duration = Date.now() - startTime;
  responseTimes.total += duration;
  responseTimes.count++;
  responseTimes.max = Math.max(responseTimes.max, duration);
  console.log(`[${requestId}] Response time: ${duration}ms`);
  
  // Log slow responses - increased threshold to 15 seconds
  if (duration > 15000) {
    console.warn(`[${requestId}] Slow response detected: ${duration}ms`);
  }
}

// Cache cleanup function
function cleanupCaches() {
  const now = Date.now();
  
  // Clean language cache
  for (const [key, value] of languageCache.entries()) {
    if (now - value.timestamp > LANGUAGE_CACHE_TTL) {
      languageCache.delete(key);
    }
  }
  
  // Clean product cache
  for (const [key, value] of productMatchCache.entries()) {
    if (now - value.timestamp > PRODUCT_CACHE_TTL) {
      productMatchCache.delete(key);
    }
  }
  
  // Clean inventory cache
  for (const [key, value] of inventoryCache.entries()) {
    if (now - value.timestamp > INVENTORY_CACHE_TTL) {
      inventoryCache.delete(key);
    }
  }
  
  // Clean global state every 5 minutes
  if (now - globalState.lastCleanup > 5 * 60 * 1000) {
    const FIVE_MINUTES = 5 * 60 * 1000;
    
    if (globalState.conversationState) {
      for (const [from, state] of Object.entries(globalState.conversationState)) {
        if (now - (state.timestamp || 0) > FIVE_MINUTES) {
          delete globalState.conversationState[from];
        }
      }
    }
    
    if (globalState.pendingTranscriptions) {
      for (const [from, pending] of Object.entries(globalState.pendingTranscriptions)) {
        if (now - (pending.timestamp || 0) > FIVE_MINUTES) {
          delete globalState.pendingTranscriptions[from];
        }
      }
    }
    
    if (globalState.pendingProductUpdates) {
      for (const [from, pending] of Object.entries(globalState.pendingProductUpdates)) {
        if (now - (pending.timestamp || 0) > FIVE_MINUTES) {
          delete globalState.pendingProductUpdates[from];
        }
      }
    }
    
    globalState.lastCleanup = now;
  }
}

// Enhanced language detection with fallback and caching
async function detectLanguageWithFallback(text, from, requestId) {
  try {
    // Check cache first
    const cacheKey = `${from}:${text.substring(0, 50)}`;
    const cached = languageCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < LANGUAGE_CACHE_TTL)) {
      console.log(`[${requestId}] Using cached language detection: ${cached.language}`);
      return cached.language;
    }
    
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `Detect the language of this text and respond with only the language code (e.g., "hi" for Hindi, "en" for English, "ta" for Tamil, etc.)`
          },
          {
            role: "user",
            content: text
          }
        ],
        max_tokens: 10,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000 // Add timeout to prevent hanging
      }
    );
    
    const languageCode = response.data.choices[0].message.content.trim().toLowerCase();
    console.log(`[${requestId}] Detected language: ${languageCode}`);
    
    // Cache the result
    languageCache.set(cacheKey, { language: languageCode, timestamp: Date.now() });
    return languageCode;
  } catch (error) {
    console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
    return 'en';
  }
}

// Create interactive button message using Twilio's proper format
function createButtonMessage(message, buttons) {
  const twiml = new twilio.twiml.MessagingResponse();
  const messageObj = twiml.message();
  messageObj.body(message);
  
  // Add interactive buttons using Twilio's format
  const buttonsObj = messageObj.buttons();
  buttons.forEach(button => {
    buttonsObj.button({
      action: {
        type: 'reply',
        reply: {
          id: button.id,
          title: button.title
        }
      }
    });
  });
  
  return twiml.toString();
}

// Function to parse inventory updates using AI
async function parseInventoryUpdateWithAI(transcript, requestId) {
  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are an inventory parsing assistant. Extract inventory information from the user's message and return it in JSON format.
Extract the following fields:
1. product: The name of the product (e.g., "Parle-G biscuits", "sugar", "milk")
2. quantity: The numerical quantity (as a number)
3. unit: The unit of measurement (e.g., "packets", "kg", "liters", "pieces")
4. action: The action being performed ("purchased", "sold", "remaining")
For the action field:
- Use "purchased" for words like "bought", "purchased", "buy", "खरीदा", "खरीदे", "लिया", "खरीदी"
- Use "sold" for words like "sold", "बेचा", "बेचे", "becha", "बिक्री"
- Use "remaining" for words like "remaining", "left", "बचा", "बचे", "बाकी"
If no action is specified, default to "purchased" for positive quantities and "sold" for negative quantities.
If no unit is specified, infer the most appropriate unit based on the product type:
- For biscuits, chips, etc.: "packets"
- For milk, water, oil: "liters"
- For flour, sugar, salt: "kg"
- For individual items: "pieces"
Return only valid JSON with no additional text, markdown formatting, or code blocks.`
          },
          {
            role: "user",
            content: transcript
          }
        ],
        max_tokens: 150,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000 // Add timeout
      }
    );
    
    let content = response.data.choices[0].message.content.trim();
    console.log(`[${requestId}] AI parsing result: ${content}`);
    
    // Clean up the response to remove markdown code blocks if present
    if (content.startsWith('```json')) {
      content = content.replace(/```json\n?/, '').replace(/\n?```$/, '');
    } else if (content.startsWith('```')) {
      content = content.replace(/```\n?/, '').replace(/\n?```$/, '');
    }
    
    // Parse the JSON response
    try {
      const parsed = JSON.parse(content);
      return {
        product: parsed.product || '',
        quantity: parsed.quantity || 0,
        unit: parsed.unit || '',
        action: parsed.action || (parsed.quantity >= 0 ? 'purchased' : 'sold'),
        isKnown: products.some(p => 
          (parsed.product && p.toLowerCase().includes(parsed.product.toLowerCase())) ||
          (parsed.product && parsed.product.toLowerCase().includes(p.toLowerCase()))
        )
      };
    } catch (parseError) {
      console.error(`[${requestId}] Failed to parse AI response as JSON:`, parseError.message);
      return null;
    }
  } catch (error) {
    console.error(`[${requestId}] AI parsing error:`, error.message);
    return null;
  }
}

// Parse multiple inventory updates from transcript
async function parseMultipleUpdates(transcript) {
  const updates = [];
  
  // Try AI-based parsing first
  try {
    console.log(`[AI Parsing] Attempting to parse: "${transcript}"`);
    const aiUpdate = await parseInventoryUpdateWithAI(transcript, 'ai-parsing');
    if (aiUpdate && aiUpdate.product && aiUpdate.quantity !== 0) {
      console.log(`[AI Parsing] Successfully parsed: ${aiUpdate.quantity} ${aiUpdate.unit} of ${aiUpdate.product} (${aiUpdate.action})`);
      updates.push(aiUpdate);
      return updates;
    }
  } catch (error) {
    console.warn(`[AI Parsing] Failed, falling back to rule-based parsing:`, error.message);
  }
  
  // Fallback to rule-based parsing if AI fails
  // Better sentence splitting to handle "&" and other conjunctions
  const sentences = transcript.split(/[.!?&]+/);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed) {
      const update = parseSingleUpdate(trimmed);
      if (isValidInventoryUpdate(update)) {
        updates.push(update);
      }
    }
  }
  console.log(`[Rule-based Parsing] Parsed ${updates.length} valid updates from transcript`);
  return updates;
}

// Improved product extraction function
function extractProduct(transcript) {
  // Remove action words and numbers, but preserve product names
  const cleaned = transcript
    .replace(/(\d+|[०-९]+|[a-zA-Z]+)\s*(kg|किलो|grams?|ग्राम|packets?|पैकेट|boxes?|बॉक्स|liters?|लीटर)/gi, ' ')
    .replace(regexPatterns.purchaseKeywords, ' ')
    .replace(regexPatterns.salesKeywords, ' ')
    .replace(regexPatterns.remainingKeywords, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Try to match with known products first
  for (const product of products) {
    if (cleaned.toLowerCase().includes(product.toLowerCase()) ||
        product.toLowerCase().includes(cleaned.toLowerCase())) {
      return product;
    }
  }
  
  // If no match, return the cleaned text as potential product
  return cleaned;
}

// Parse single update with improved product detection
function parseSingleUpdate(transcript) {
  // Try to extract product name more flexibly
  let product = extractProduct(transcript);
  let quantity = 0;
  let unit = '';
  let unitMultiplier = 1;
  
  // Try to match digits first (including Devanagari digits)
  const digitMatch = transcript.match(regexPatterns.digits);
  if (digitMatch) {
    // Convert Devanagari digits to Arabic digits
    let digitStr = digitMatch[1];
    digitStr = digitStr.replace(/[०१२३४५६७८९]/g, d => '०१२३४५६७८९'.indexOf(d));
    quantity = parseInt(digitStr) || 0;
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
  
  // Extract units - prioritize common units
  for (const [unitName, multiplier] of Object.entries(units)) {
    if (transcript.toLowerCase().includes(unitName)) {
      unit = unitName;
      unitMultiplier = multiplier;
      break;
    }
  }
  
  // Apply unit multiplier
  quantity = quantity * unitMultiplier;
  
  // Better action detection with priority for purchase/sold over remaining
  const isPurchase = regexPatterns.purchaseKeywords.test(transcript);
  const isSold = regexPatterns.salesKeywords.test(transcript);
  const isRemaining = regexPatterns.remainingKeywords.test(transcript);
  
  let action, finalQuantity;
  if (isPurchase) {
    action = 'purchased';
    finalQuantity = quantity; // Positive for purchases
  } else if (isSold) {
    action = 'sold';
    finalQuantity = -quantity; // Negative for sales
  } else if (isRemaining) {
    // Only treat as "remaining" if no other action is detected
    action = 'remaining';
    finalQuantity = quantity; // This will be handled as an absolute value
  } else {
    // Default to purchased if no specific action is detected
    action = 'purchased';
    finalQuantity = quantity;
  }
  
  return {
    product,
    quantity: finalQuantity,
    unit,
    action,
    isKnown: products.some(p => product.toLowerCase().includes(p.toLowerCase()) ||
                             p.toLowerCase().includes(product.toLowerCase()))
  };
}

// Validate if transcript is an inventory update - now allows unknown products
function isValidInventoryUpdate(parsed) {
  // Allow unknown products but require valid quantity and action
  const validQuantity = parsed.quantity !== 0;
  const validAction = ['purchased', 'sold', 'remaining'].includes(parsed.action);
  return validQuantity && validAction;
}

// Improved handling of "bacha" vs "becha" confusion
async function validateTranscript(transcript, requestId) {
  try {
    // First, fix common mispronunciations before sending to DeepSeek
    let fixedTranscript = transcript;
    
    // More comprehensive patterns for fixing "bacha" to "becha"
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
    
    // Only use DeepSeek for minimal cleaning - just fix grammar and keep original language
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are an inventory assistant. Clean up this transcript but KEEP THE ORIGINAL LANGUAGE:
- Fix grammar errors
- Keep product names as they are (do not translate or change them)
- Keep numbers as they are (do not translate them)
- Return ONLY the cleaned text in the same language as the input, nothing else`
          },
          {
            role: "user",
            content: fixedTranscript
          }
        ],
        max_tokens: 50,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 3000 // Add timeout
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

// Handle multiple inventory updates with batch tracking
async function updateMultipleInventory(shopId, updates, languageCode) {
  try {
    console.log(`[Update ${shopId}] Processing ${updates.length} updates in batch`);
    
    // Prepare updates for batch processing
    const batchUpdates = updates.map(update => ({
      shopId,
      product: update.product,
      quantityChange: update.quantity,
      unit: update.unit
    }));
    
    // Process inventory updates in batch
    const inventoryResults = await batchUpdateInventory(batchUpdates);
    
    // Process batch records and sales records in parallel
    const batchPromises = [];
    const salesPromises = [];
    
    updates.forEach((update, index) => {
      const result = inventoryResults[index];
      
      if (result.success) {
        // Create batch record for purchases only (not for sales)
        if (update.action === 'purchased') {
          console.log(`[Update ${shopId} - ${update.product}] Creating batch record for purchase`);
          
          // Format current date for Airtable
          const formattedPurchaseDate = formatDateForAirtable(new Date());
          
          batchPromises.push(
            createBatchRecord({
              shopId,
              product: update.product,
              quantity: update.quantity,
              purchaseDate: formattedPurchaseDate,
              expiryDate: null // Will be updated later
            })
          );
        }
        
        // Create sales record for sales
        if (update.action === 'sold') {
          console.log(`[Update ${shopId} - ${update.product}] Creating sales record`);
          
          // Get available batches for this product
          salesPromises.push(
            (async () => {
              const batches = await getBatchRecords(shopId, update.product);
              let selectedBatchId = null;
              
              if (batches.length > 0) {
                // Use the oldest batch (FIFO - First In, First Out)
                selectedBatchId = batches[batches.length - 1].id;
                console.log(`[Update ${shopId} - ${update.product}] Selected batch ${selectedBatchId} for sale`);
              }
              
              const salesResult = await createSalesRecord({
                shopId,
                product: update.product,
                quantity: update.quantity, // This will be negative
                saleDate: new Date().toISOString(),
                batchId: selectedBatchId,
                salePrice: 0 // Could be enhanced to capture price
              });
              
              // Update batch quantity if a batch was selected
              if (selectedBatchId) {
                const batchUpdateResult = await updateBatchQuantity(selectedBatchId, update.quantity);
                if (batchUpdateResult.success) {
                  console.log(`[Update ${shopId} - ${update.product}] Updated batch quantity`);
                } else {
                  console.error(`[Update ${shopId} - ${update.product}] Failed to update batch quantity: ${batchUpdateResult.error}`);
                }
              }
              
              return salesResult;
            })()
          );
        }
      }
    });
    
    // Wait for all batch and sales operations to complete
    const [batchResults, salesResults] = await Promise.allSettled([
      Promise.all(batchPromises),
      Promise.all(salesPromises)
    ]);
    
    // Combine results
    const combinedResults = inventoryResults.map((result, index) => {
      const update = updates[index];
      const batchResult = batchResults.status === 'fulfilled' && batchResults.value[index];
      const salesResult = salesResults.status === 'fulfilled' && salesResults.value[index];
      
      return {
        product: update.product,
        quantity: update.quantity,
        unit: update.unit,
        ...result,
        batchDate: batchResult && batchResult.success ? formatDateForAirtable(new Date()) : null
      };
    });
    
    return combinedResults;
  } catch (error) {
    console.error(`[Update ${shopId}] Error in batch update:`, error.message);
    
    // Fallback to individual updates if batch fails
    console.log(`[Update ${shopId}] Falling back to individual updates`);
    const results = [];
    
    for (const update of updates) {
      try {
        console.log(`[Update ${shopId} - ${update.product}] Processing update: ${update.quantity} ${update.unit}`);
        
        // Check if this is a sale (negative quantity)
        const isSale = update.action === 'sold';
        
        // For sales, try to determine which batch to use
        let selectedBatchId = null;
        if (isSale) {
          // Get available batches for this product
          const batches = await getBatchRecords(shopId, update.product);
          if (batches.length > 0) {
            // Use the oldest batch (FIFO - First In, First Out)
            selectedBatchId = batches[batches.length - 1].id;
            console.log(`[Update ${shopId} - ${update.product}] Selected batch ${selectedBatchId} for sale`);
          }
        }
        
        // Update the inventory
        const result = await updateInventory(shopId, update.product, update.quantity, update.unit);
        
        // Create batch record for purchases only (not for sales)
        if (update.action === 'purchased' && result.success) {
          console.log(`[Update ${shopId} - ${update.product}] Creating batch record for purchase`);
          
          // Format current date for Airtable
          const formattedPurchaseDate = formatDateForAirtable(new Date());
          
          const batchResult = await createBatchRecord({
            shopId,
            product: update.product,
            quantity: update.quantity,
            purchaseDate: formattedPurchaseDate,
            expiryDate: null // Will be updated later
          });
          
          if (batchResult.success) {
            console.log(`[Update ${shopId} - ${update.product}] Batch record created with ID: ${batchResult.id}`);
            // Add batch date to result for display
            result.batchDate = formattedPurchaseDate;
          } else {
            console.error(`[${requestId}] Failed to create batch record: ${batchResult.error}`);
          }
        }
        
        // Create sales record for sales
        if (update.action === 'sold' && result.success) {
          console.log(`[Update ${shopId} - ${update.product}] Creating sales record`);
          
          const salesResult = await createSalesRecord({
            shopId,
            product: update.product,
            quantity: update.quantity, // This will be negative
            saleDate: new Date().toISOString(),
            batchId: selectedBatchId,
            salePrice: 0 // Could be enhanced to capture price
          });
          
          if (salesResult.success) {
            console.log(`[Update ${shopId} - ${update.product}] Sales record created with ID: ${salesResult.id}`);
            
            // Update batch quantity if a batch was selected
            if (selectedBatchId) {
              const batchUpdateResult = await updateBatchQuantity(selectedBatchId, update.quantity);
              if (batchUpdateResult.success) {
                console.log(`[Update ${shopId} - ${update.product}] Updated batch quantity`);
              } else {
                console.error(`[Update ${shopId} - ${update.product}] Failed to update batch quantity: ${batchUpdateResult.error}`);
              }
            }
          } else {
            console.error(`[Update ${shopId} - ${update.product}] Failed to create sales record: ${salesResult.error}`);
          }
        }
        
        results.push({
          product: update.product,
          quantity: update.quantity,
          unit: update.unit,
          ...result
        });
      } catch (error) {
        console.error(`[Update ${shopId} - ${update.product}] Error:`, error.message);
        results.push({
          product: update.product,
          quantity: update.quantity,
          unit: update.unit,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
}

// Generate response in multiple languages and scripts without labels
async function generateMultiLanguageResponse(message, languageCode, requestId) {
  try {
    // If the language is English, return the message as is
    if (languageCode === 'en') {
      return message;
    }
    
    // Check cache first
    const cacheKey = `${languageCode}:${message.substring(0, 50)}`;
    const cached = languageCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp < LANGUAGE_CACHE_TTL)) {
      console.log(`[${requestId}] Using cached translation for ${languageCode}`);
      return cached.translation;
    }
    
    console.log(`[${requestId}] Translating to ${languageCode}: "${message}"`);
    
    // Fallback strategies:
    // 1. For common greetings, use predefined translations with both scripts
    const commonGreetings = {
      'hi': {
        native: 'नमस्ते',
        roman: 'Namaste'
      },
      'bn': {
        native: 'হ্যালো',
        roman: 'Hello'
      },
      'ta': {
        native: 'வணக்கம்',
        roman: 'Vanakkam'
      },
      'te': {
        native: 'నమస్కారం',
        roman: 'Namaskaram'
      },
      'kn': {
        native: 'ನಮಸ್ಕಾರ',
        roman: 'Namaskara'
      },
      'gu': {
        native: 'નમસ્તે',
        roman: 'Namaste'
      },
      'mr': {
        native: 'नमस्कार',
        roman: 'Namaskar'
      },
      'en': {
        native: 'Hello',
        roman: 'Hello'
      }
    };
    
    // Check if this is a common greeting
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey') || 
        lowerMessage.includes('नमस्ते') || lowerMessage.includes('হ্যালো') || lowerMessage.includes('வணக்கம்')) {
      const greeting = commonGreetings[languageCode] || commonGreetings['en'];
      const fallback = `${greeting.native}\n\n${greeting.roman}`;
      console.log(`[${requestId}] Using fallback greeting for ${languageCode}:`, fallback);
      
      // Cache the result
      languageCache.set(cacheKey, { 
        translation: fallback, 
        timestamp: Date.now() 
      });
      
      return fallback;
    }
    
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are a multilingual assistant. Translate the given message to the target language and provide it in two formats:
Format your response exactly as:
Line 1: Translation in native script (e.g., Devanagari for Hindi)
Empty line
Line 3: Translation in Roman script (transliteration using English alphabet)
For example, for Hindi:
नमस्ते, आप कैसे हैं?
Namaste, aap kaise hain?
Do NOT include any labels like [Roman Script], [Native Script], <translation>, or any other markers. Just provide the translations one after the other with a blank line in between.`
          },
          {
            role: "user",
            content: `Translate this message to ${languageCode}: "${message}"`
          }
        ],
        max_tokens: 200,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // Increased to 10 seconds
      }
    );
    
    let translated = response.data.choices[0].message.content.trim();
    console.log(`[${requestId}] Raw translation response:`, translated);
    
    // Post-process to remove any labels that might have been included
    translated = translated.replace(/<translation in roman script>/gi, '');
    translated = translated.replace(/<translation in native script>/gi, '');
    translated = translated.replace(/\[roman script\]/gi, '');
    translated = translated.replace(/\[native script\]/gi, '');
    translated = translated.replace(/translation in roman script:/gi, '');
    translated = translated.replace(/translation in native script:/gi, '');
    
    // Remove quotes that might have been added
    translated = translated.replace(/^"(.*)"$/, '$1');
    translated = translated.replace(/"/g, '');
    
    // Remove extra blank lines
    translated = translated.replace(/\n\s*\n\s*\n/g, '\n\n');
    translated = translated.replace(/^\s+|\s+$/g, '');
    
    // Cache the result
    languageCache.set(cacheKey, { 
      translation: translated, 
      timestamp: Date.now() 
    });
    
    return translated;
  } catch (error) {
    console.warn(`[${requestId}] Translation failed, using original:`, error.message);
    
    // Fallback to a simple format
    return message;
  }
}

// Helper function to send system messages in user's preferred language
async function sendSystemMessage(message, from, detectedLanguage, requestId, response) {
  try {
    // Get user's preferred language
    let userLanguage = detectedLanguage;
    
    // Try to get user preference from database if not provided
    if (!userLanguage && from) {
      try {
        const shopId = from.replace('whatsapp:', '');
        const userPref = await getUserPreference(shopId);
        if (userPref.success) {
          userLanguage = userPref.language;
        }
      } catch (error) {
        console.warn(`[${requestId}] Failed to get user preference:`, error.message);
      }
    }
    
    // Default to English if no language is detected
    if (!userLanguage) {
      userLanguage = 'en';
    }
    
    // Generate multilingual response
    const formattedMessage = await generateMultiLanguageResponse(message, userLanguage, requestId);
    
    // Send the message
    response.message(formattedMessage);
    return formattedMessage;
  } catch (error) {
    console.error(`[${requestId}] Error sending system message:`, error.message);
    // Fallback to original message in English
    response.message(message);
    return message;
  }
}

// Function to process confirmed transcription
async function processConfirmedTranscription(transcript, from, detectedLanguage, requestId, response, res) {
  try {
    console.log(`[${requestId}] [6] Parsing updates using AI...`);
    const updates = await parseMultipleUpdates(transcript);
    
    if (updates.length === 0) {
      console.log(`[${requestId}] Rejected: No valid inventory updates`);
      await sendSystemMessage(
        'Please send inventory updates only. Examples: "10 Parle-G sold", "5kg sugar purchased", "2 boxes Maggi bought". You can send multiple updates in one message!',
        from,
        detectedLanguage,
        requestId,
        response
      );
      return res.send(response.toString());
    }
    
    console.log(`[${requestId}] [7] Testing Airtable connection...`);
    const connectionTest = await testConnection();
    if (!connectionTest) {
      console.error(`[${requestId}] Airtable connection failed`);
      await sendSystemMessage(
        'Database connection error. Please try again later.',
        from,
        detectedLanguage,
        requestId,
        response
      );
      return res.send(response.toString());
    }
    
    console.log(`[${requestId}] [8] Updating inventory for ${updates.length} items...`);
    const shopId = from.replace('whatsapp:', '');
    const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
    
    let message = '✅ Updates processed:\n\n';
    let successCount = 0;
    let hasSales = false;
    
    for (const result of results) {
      if (result.success) {
        successCount++;
        const unitText = result.unit ? ` ${result.unit}` : '';
        message += `• ${result.product}: ${result.quantity > 0 ? '+' : ''}${result.quantity}${unitText} (Stock: ${result.newQuantity}${unitText})\n`;
        
        if (result.quantity > 0 && result.batchDate) {
          message += ` Batch added: ${formatDateForDisplay(result.batchDate)}\n`;
        }
        
        if (result.quantity < 0) {
          hasSales = true;
        }
      } else {
        message += `• ${result.product}: Error - ${result.error}\n`;
      }
    }
    
    message += `\n✅ Successfully updated ${successCount} of ${updates.length} items`;
    
    if (hasSales) {
      message += `\n\nFor better batch tracking, please specify which batch was sold in your next message.`;
      
      // Set conversation state to await batch selection
      if (!globalState.conversationState) {
        globalState.conversationState = {};
      }
      globalState.conversationState[from] = {
        state: 'awaiting_batch_selection',
        language: detectedLanguage,
        timestamp: Date.now()
      };
    }
    
    // Add switch option in completion messages
    message += `\n\nTo switch input method, reply "switch to text" or "switch to voice".`;
    
    // Add reset option
    message += `\nTo reset the flow, reply "reset".`;
    
    // Use conversation state language if available
    let responseLanguage = detectedLanguage;
    if (globalState.conversationState && globalState.conversationState[from] && globalState.conversationState[from].language) {
      responseLanguage = globalState.conversationState[from].language;
    }
    
    await sendSystemMessage(message, from, responseLanguage, requestId, response);
    return res.send(response.toString());
  } catch (error) {
    console.error(`[${requestId}] Error processing confirmed transcription:`, error.message);
    await sendSystemMessage(
      'System error. Please try again with a clear voice message.',
      from,
      detectedLanguage,
      requestId,
      response
    );
    return res.send(response.toString());
  }
}

// Function to confirm transcription with user
async function confirmTranscription(transcript, from, detectedLanguage, requestId) {
  const response = new twilio.twiml.MessagingResponse();
  await sendSystemMessage(
    `I heard: "${transcript}". Is this correct? Please reply with "yes" to confirm or "no" to try again.`,
    from,
    detectedLanguage,
    requestId,
    response
  );
  
  // Store the transcript temporarily
  globalState.pendingTranscriptions[from] = {
    transcript,
    detectedLanguage,
    timestamp: Date.now()
  };
  
  return response.toString();
}

// Function to confirm product with user
async function confirmProduct(update, from, detectedLanguage, requestId) {
  const response = new twilio.twiml.MessagingResponse();
  await sendSystemMessage(
    `I heard you want to update: "${update.quantity > 0 ? '+' : ''}${update.quantity} ${update.product}" (${update.action}). Is this correct? Please reply with "yes" to confirm or "no" to try again.`,
    from,
    detectedLanguage,
    requestId,
    response
  );
  
  // Store the update temporarily
  globalState.pendingProductUpdates[from] = {
    update,
    detectedLanguage,
    timestamp: Date.now()
  };
  
  return response.toString();
}

// Function to check if a message is a batch selection response
function isBatchSelectionResponse(message) {
  const batchSelectionKeywords = ['oldest', 'newest', 'batch', 'expiry'];
  const lowerMessage = message.toLowerCase();
  
  for (const keyword of batchSelectionKeywords) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }
  
  if (lowerMessage.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) {
    return true;
  }
  
  if (lowerMessage.match(/\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i)) {
    return true;
  }
  
  return false;
}

// Function to check if a message is an expiry date update
function isExpiryDateUpdate(message) {
  const products = [
    'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
    'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
    'flour', 'आटा', 'sugar', 'चीनी', 'packets', 'पैकेट',
    'potato', 'आलू', 'onion', 'प्याज', 'tomato', 'टमाटर'
  ];
  
  for (const product of products) {
    if (message.toLowerCase().includes(product.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

// Handle batch selection response
async function handleBatchSelectionResponse(body, from, response, requestId, languageCode = 'en') {
  try {
    console.log(`[${requestId}] Processing batch selection response: "${body}"`);
    
    const shopId = from.replace('whatsapp:', '');
    const lowerBody = body.toLowerCase();
    
    let product = null;
    const products = [
      'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
      'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
      'flour', 'आटा', 'sugar', 'चीनी', 'packets', 'पैकेट',
      'potato', 'आलू', 'onion', 'प्याज', 'tomato', 'टमाटर'
    ];
    
    for (const p of products) {
      if (lowerBody.includes(p.toLowerCase())) {
        product = p;
        break;
      }
    }
    
    if (!product) {
      await sendSystemMessage(
        'Please specify which product you are referring to.',
        from,
        languageCode,
        requestId,
        response
      );
      return;
    }
    
    const batches = await getBatchRecords(shopId, product);
    if (batches.length === 0) {
      await sendSystemMessage(
        `No batches found for ${product}.`,
        from,
        languageCode,
        requestId,
        response
      );
      return;
    }
    
    let selectedBatch = null;
    
    if (lowerBody.includes('oldest')) {
      selectedBatch = batches[batches.length - 1];
    } else if (lowerBody.includes('newest')) {
      selectedBatch = batches[0];
    } else {
      const dateMatch = body.match(regexPatterns.dateFormats);
      if (dateMatch) {
        const dateStr = dateMatch[0];
        const parsedDate = parseExpiryDate(dateStr);
        if (parsedDate) {
          selectedBatch = batches.find(batch => {
            if (!batch.fields.ExpiryDate) return false;
            const batchDate = new Date(batch.fields.ExpiryDate);
            return batchDate.getTime() === parsedDate.getTime();
          });
        }
      }
    }
    
    if (!selectedBatch) {
      selectedBatch = batches[batches.length - 1];
    }
    
    const dateMatch = body.match(regexPatterns.dateFormats);
    if (dateMatch) {
      const dateStr = dateMatch[0];
      const parsedDate = parseExpiryDate(dateStr);
      if (parsedDate) {
        const formattedDate = formatDateForAirtable(parsedDate);
        await updateBatchExpiry(selectedBatch.id, formattedDate);
        await sendSystemMessage(
          `✅ Updated expiry date for ${product} batch to ${formatDateForDisplay(parsedDate)}`,
          from,
          languageCode,
          requestId,
          response
        );
        return;
      }
    }
    
    await sendSystemMessage(
      `✅ Selected ${product} batch from ${formatDateForDisplay(selectedBatch.fields.PurchaseDate)}`,
      from,
      languageCode,
      requestId,
      response
    );
    
    // Clear conversation state
    if (globalState.conversationState && globalState.conversationState[from]) {
      delete globalState.conversationState[from];
    }
  } catch (error) {
    console.error(`[${requestId}] Error handling batch selection response:`, error.message);
    await sendSystemMessage(
      'Error processing batch selection. Please try again.',
      from,
      languageCode,
      requestId,
      response
    );
  }
}

// Handle expiry date update
async function handleExpiryDateUpdate(body, from, response, requestId, languageCode = 'en') {
  try {
    console.log(`[${requestId}] Processing expiry date update: "${body}"`);
    
    const productMatch = body.match(/([a-zA-Z\s]+):?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
    
    if (!productMatch) {
      console.log(`[${requestId}] Invalid expiry date format`);
      await sendSystemMessage(
        'Invalid format. Please use: "Product: DD/MM/YYYY" or "Product: DD Month YYYY"',
        from,
        languageCode,
        requestId,
        response
      );
      return;
    }
    
    const product = productMatch[1].trim();
    const expiryDateStr = productMatch[2];
    
    console.log(`[${requestId}] Extracted product: "${product}", expiry date: "${expiryDateStr}"`);
    
    const expiryDate = parseExpiryDate(expiryDateStr);
    if (!expiryDate) {
      console.log(`[${requestId}] Failed to parse expiry date`);
      await sendSystemMessage(
        'Invalid date format. Please use: "Product: DD/MM/YYYY" or "Product: DD Month YYYY"',
        from,
        languageCode,
        requestId,
        response
      );
      return;
    }
    
    const shopId = from.replace('whatsapp:', '');
    console.log(`[${requestId}] Looking for recent batches for ${product}`);
    
    const batches = await getBatchRecords(shopId, product);
    if (batches.length === 0) {
      console.log(`[${requestId}] No recent purchase found for ${product}`);
      await sendSystemMessage(
        `No recent purchase found for ${product}. Please make a purchase first.`,
        from,
        languageCode,
        requestId,
        response
      );
      return;
    }
    
    const formattedExpiryDate = formatDateForAirtable(expiryDate);
    console.log(`[${requestId}] Formatted expiry date: ${formattedExpiryDate}`);
    
    const latestBatch = batches[0];
    console.log(`[${requestId}] Updating batch ${latestBatch.id} with expiry date`);
    
    const batchResult = await updateBatchExpiry(latestBatch.id, formattedExpiryDate);
    if (batchResult.success) {
      console.log(`[${requestId}] Successfully updated batch with expiry date`);
      await sendSystemMessage(
        `✅ Expiry date updated for ${product}: ${formatDateForDisplay(expiryDate)}`,
        from,
        languageCode,
        requestId,
        response
      );
    } else {
      console.error(`[${requestId}] Failed to update batch: ${batchResult.error}`);
      await sendSystemMessage(
        `Error updating expiry date for ${product}. Please try again.`,
        from,
        languageCode,
        requestId,
        response
      );
    }
  } catch (error) {
    console.error(`[${requestId}] Error handling expiry date update:`, error.message);
    await sendSystemMessage(
      'Error processing expiry date. Please try again.',
      from,
      languageCode,
      requestId,
      response
    );
  }
}

// Parse expiry date in various formats
function parseExpiryDate(dateStr) {
  // Try DD/MM/YYYY format
  const dmyMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1]);
    const month = parseInt(dmyMatch[2]);
    let year = parseInt(dmyMatch[3]);
    
    // Handle 2-digit year
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }
    
    return new Date(year, month - 1, day);
  }
  
  // Try "DD Month YYYY" format
  const monthMatch = dateStr.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (monthMatch) {
    const day = parseInt(monthMatch[1]);
    const monthNames = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"];
    const month = monthNames.indexOf(monthMatch[2]);
    const year = parseInt(monthMatch[3]);
    
    return new Date(year, month, day);
  }
  
  return null;
}

// Add this function to check and update language preference
async function checkAndUpdateLanguage(text, from, currentLanguage, requestId) {
  // Skip language detection for simple selection responses
  const lowerText = text.toLowerCase();
  if (['1', '2', 'voice', 'text', 'yes', 'no'].includes(lowerText)) {
    console.log(`[${requestId}] Skipping language detection for simple response: "${text}"`);
    return currentLanguage || 'en';
  }
  
  try {
    const detectedLanguage = await detectLanguageWithFallback(text, from, requestId);
    
    // If the detected language is different from the current language, update the conversation state
    if (currentLanguage && detectedLanguage !== currentLanguage) {
      console.log(`[${requestId}] Language changed from ${currentLanguage} to ${detectedLanguage}`);
      
      if (!globalState.conversationState) {
        globalState.conversationState = {};
      }
      
      globalState.conversationState[from] = {
        state: globalState.conversationState[from]?.state || null,
        language: detectedLanguage,
        timestamp: Date.now()
      };
      
      // Also update the user preference
      const shopId = from.replace('whatsapp:', '');
      saveUserPreference(shopId, detectedLanguage)
        .then(result => {
          if (result.success) {
            console.log(`[${requestId}] Saved language preference: ${detectedLanguage} for user ${shopId}`);
          } else {
            console.warn(`[${requestId}] Failed to save language preference: ${result.error}`);
          }
        })
        .catch(error => {
          console.error(`[${requestId}] Error saving language preference:`, error.message);
        });
    }
    
    return detectedLanguage;
  } catch (error) {
    console.warn(`[${requestId}] Language detection failed, using current language:`, error.message);
    return currentLanguage || 'en';
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

// Google Transcription with confidence tracking
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
    
    // Language priority that works well
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
              'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
              'flour', 'आटा', 'sugar', 'चीनी', 'packets', 'पैकेट',
              '10', 'दस', '20', 'बीस', '50', 'पचास', '100', 'सौ',
              'kg', 'किलो', 'ग्राम', 'पैकेट', 'बॉक्स', 'किलोग्राम',
              'खरीदा', 'बेचा', 'बिक्री', 'क्रय', 'लिया', 'दिया', 'बचा',
              'sold', 'purchased', 'bought', 'ordered'
            ],
            boost: 32.0
          }]
        };
        
        // Model priority that works well
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
            let confidenceSum = 0;
            let confidenceCount = 0;
            
            if (data.results && data.results.length > 0) {
              for (const result of data.results) {
                if (result.alternatives && result.alternatives.length > 0) {
                  const alternative = result.alternatives[0];
                  fullTranscript += alternative.transcript + ' ';
                  
                  if (alternative.confidence) {
                    confidenceSum += alternative.confidence;
                    confidenceCount++;
                  }
                }
              }
            }
            
            fullTranscript = fullTranscript.trim();
            
            if (fullTranscript) {
              const avgConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;
              console.log(`[${requestId}] STT Success: ${config.model} model (${langConfig.name}) - Transcript: "${fullTranscript}" (Confidence: ${avgConfidence.toFixed(2)})`);
              
              return {
                transcript: fullTranscript,
                confidence: avgConfidence
              };
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

// Function to send WhatsApp message via Twilio API (for async responses)
async function sendMessageViaAPI(to, body) {
  try {
    const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
    
    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    
    console.log(`Sending WhatsApp message to: ${formattedTo}`);
    console.log(`Message body: ${body}`);
    
    const message = await client.messages.create({
      body: body,
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: formattedTo
    });
    
    console.log(`Message sent successfully via API. SID: ${message.sid}`);
    return message;
  } catch (error) {
    console.error('Error sending WhatsApp message via API:', error);
    throw error;
  }
}

// Function to process voice messages asynchronously
async function processVoiceMessageAsync(mediaUrl, from, requestId, conversationState) {
  try {
    console.log(`[${requestId}] [1] Downloading audio...`);
    const audioBuffer = await downloadAudio(mediaUrl);
    
    console.log(`[${requestId}] [2] Converting audio...`);
    const flacBuffer = await convertToFLAC(audioBuffer);
    
    console.log(`[${requestId}] [3] Transcribing with Google STT...`);
    const transcriptionResult = await googleTranscribe(flacBuffer, requestId);
    const rawTranscript = transcriptionResult.transcript;
    const confidence = transcriptionResult.confidence;
    
    console.log(`[${requestId}] [4] Validating transcript...`);
    const cleanTranscript = await validateTranscript(rawTranscript, requestId);
    
    console.log(`[${requestId}] [5] Detecting language...`);
    const detectedLanguage = await checkAndUpdateLanguage(cleanTranscript, from, conversationState?.language, requestId);
    
    // Check if we're awaiting batch selection
    if (conversationState && conversationState.state === 'awaiting_batch_selection') {
      console.log(`[${requestId}] Awaiting batch selection response from voice`);
      
      // Check if the transcript contains batch selection keywords
      if (isBatchSelectionResponse(cleanTranscript)) {
        // Send follow-up message via Twilio API
        await sendMessageViaAPI(from, 'Processing your batch selection...');
        await handleBatchSelectionResponse(cleanTranscript, from, { message: (msg) => sendMessageViaAPI(from, msg) }, requestId, conversationState.language);
        return;
      }
    }
    
    // Confidence-based confirmation
    const CONFIDENCE_THRESHOLD = 0.8;
    if (confidence < CONFIDENCE_THRESHOLD) {
      console.log(`[${requestId}] [5.5] Low confidence (${confidence}), requesting confirmation...`);
      
      // Send confirmation request via Twilio API
      const confirmationResponse = await confirmTranscription(cleanTranscript, from, detectedLanguage, requestId);
      // Extract just the message body from the TwiML
      const messageBody = confirmationResponse.match(/<Body>([^<]+)<\/Body>/)?.[1] || confirmationResponse;
      await sendMessageViaAPI(from, messageBody);
    } else {
      console.log(`[${requestId}] [5.5] High confidence (${confidence}), proceeding without confirmation...`);
      
      // Parse the transcript
      const updates = await parseMultipleUpdates(cleanTranscript);
      
      // Check if any updates are for unknown products
      const unknownProducts = updates.filter(u => !u.isKnown);
      if (unknownProducts.length > 0) {
        console.log(`[${requestId}] Found ${unknownProducts.length} unknown products, requesting confirmation`);
        
        // Confirm the first unknown product via Twilio API
        const confirmationResponse = await confirmProduct(unknownProducts[0], from, detectedLanguage, requestId);
        // Extract just the message body from the TwiML
        const messageBody = confirmationResponse.match(/<Body>([^<]+)<\/Body>/)?.[1] || confirmationResponse;
        await sendMessageViaAPI(from, messageBody);
        return;
      }
      
      // Process the transcription and send result via Twilio API
      const processResponse = new twilio.twiml.MessagingResponse();
      await processConfirmedTranscription(
        cleanTranscript,
        from,
        detectedLanguage,
        requestId,
        processResponse,
        { send: (response) => {
          // Extract the message body and send via Twilio API
          const messageBody = response.toString().match(/<Body>([^<]+)<\/Body>/)?.[1] || response.toString();
          sendMessageViaAPI(from, messageBody);
        }}
      );
    }
  } catch (error) {
    console.error(`[${requestId}] Error processing voice message:`, error);
    
    // Send error message via Twilio API
    await sendMessageViaAPI(from, 'Sorry, I had trouble processing your voice message. Please try again.');
  }
}

// Function to process text messages asynchronously
async function processTextMessageAsync(body, from, detectedLanguage, requestId, conversationState) {
  try {
    console.log(`[${requestId}] [1] Parsing text message: "${body}"`);
    
    // Try to parse as inventory update
    const updates = await parseMultipleUpdates(body);
    
    if (updates.length > 0) {
      console.log(`[${requestId}] Parsed ${updates.length} updates from text message`);
      
      // Check if any updates are for unknown products
      const unknownProducts = updates.filter(u => !u.isKnown);
      if (unknownProducts.length > 0) {
        console.log(`[${requestId}] Found ${unknownProducts.length} unknown products, requesting confirmation`);
        
        // Confirm the first unknown product via Twilio API
        const confirmationResponse = await confirmProduct(unknownProducts[0], from, detectedLanguage, requestId);
        // Extract just the message body from the TwiML
        const messageBody = confirmationResponse.match(/<Body>([^<]+)<\/Body>/)?.[1] || confirmationResponse;
        await sendMessageViaAPI(from, messageBody);
        return;
      }
      
      // Process the confirmed update
      const shopId = from.replace('whatsapp:', '');
      const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
      
      let message = '✅ Updates processed:\n\n';
      let successCount = 0;
      let hasSales = false;
      
      for (const result of results) {
        if (result.success) {
          successCount++;
          const unitText = result.unit ? ` ${result.unit}` : '';
          message += `• ${result.product}: ${result.quantity > 0 ? '+' : ''}${result.quantity}${unitText} (Stock: ${result.newQuantity}${unitText})\n`;
          
          if (result.quantity > 0 && result.batchDate) {
            message += ` Batch added: ${formatDateForDisplay(result.batchDate)}\n`;
          }
          
          if (result.quantity < 0) {
            hasSales = true;
          }
        } else {
          message += `• ${result.product}: Error - ${result.error}\n`;
        }
      }
      
      message += `\n✅ Successfully updated ${successCount} of ${updates.length} items`;
      
      if (hasSales) {
        message += `\n\nFor better batch tracking, please specify which batch was sold in your next message.`;
        
        // Set conversation state to await batch selection
        if (!globalState.conversationState) {
          globalState.conversationState = {};
        }
        globalState.conversationState[from] = {
          state: 'awaiting_batch_selection',
          language: detectedLanguage,
          timestamp: Date.now()
        };
      }
      
      // Add switch option in completion messages
      message += `\n\nTo switch input method, reply "switch to text" or "switch to voice".`;
      
      // Add reset option
      message += `\nTo reset the flow, reply "reset".`;
      
      // Send the message via Twilio API
      await sendMessageViaAPI(from, message);
    } else {
      console.log(`[${requestId}] Not a valid inventory update, sending help message`);
      
      const defaultMessage = await generateMultiLanguageResponse(
        'Please send inventory updates only. Examples: "10 Parle-G sold", "5kg sugar purchased", "2 boxes Maggi bought". You can send multiple updates in one message!',
        detectedLanguage,
        requestId
      );
      
      // Send the message via Twilio API
      await sendMessageViaAPI(from, defaultMessage);
    }
  } catch (error) {
    console.error(`[${requestId}] Error processing text message:`, error);
    
    // Send error message via Twilio API
    await sendMessageViaAPI(from, 'Sorry, I had trouble processing your message. Please try again.');
  }
}

// Main module exports
module.exports = async (req, res) => {
  const requestStart = Date.now();
  const response = new twilio.twiml.MessagingResponse();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Clean up caches periodically
    cleanupCaches();
    
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    
    const { MediaUrl0, NumMedia, SpeechResult, From, Body, ButtonText } = req.body;
    
    // Log the received values for debugging
    console.log(`[${requestId}] Received values:`, {
      NumMedia: typeof NumMedia,
      NumMediaValue: NumMedia,
      Body: typeof Body,
      BodyValue: Body
    });
    
    // Check for user preference
    let userPreference = 'voice'; // Default to voice
    if (globalState.userPreferences[From]) {
      userPreference = globalState.userPreferences[From];
      console.log(`[${requestId}] User preference: ${userPreference}`);
    }
    
    // Check conversation state
    let conversationState = null;
    if (globalState.conversationState && globalState.conversationState[From]) {
      conversationState = globalState.conversationState[From];
      console.log(`[${requestId}] Conversation state:`, conversationState);
    }
    
    // Handle button responses (if any)
    if (ButtonText) {
      console.log(`[${requestId}] Button clicked: ${ButtonText}`);
      
      // Store user preference
      if (!globalState.userPreferences) {
        globalState.userPreferences = {};
      }
      
      // Determine the user's language - don't re-detect for button clicks
      let detectedLanguage = 'en';
      
      // First check conversation state
      if (conversationState && conversationState.language) {
        detectedLanguage = conversationState.language;
        console.log(`[${requestId}] Using language from conversation state: ${detectedLanguage}`);
      } 
      // Then check user preference from database
      else if (From) {
        try {
          const shopId = From.replace('whatsapp:', '');
          const userPref = await getUserPreference(shopId);
          if (userPref.success) {
            detectedLanguage = userPref.language;
            console.log(`[${requestId}] Using language from user preference: ${detectedLanguage}`);
          }
        } catch (error) {
          console.warn(`[${requestId}] Failed to get user preference:`, error.message);
        }
      }
      
      // Set input method preference based on button text
      if (ButtonText === 'Voice Message' || ButtonText === 'voice_input') {
        globalState.userPreferences[From] = 'voice';
        
        const voiceMessage = await generateMultiLanguageResponse(
          '🎤 Please send a voice message with your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,  // Use the preserved language
          requestId
        );
        response.message(voiceMessage);
      } else if (ButtonText === 'Text Message' || ButtonText === 'text_input') {
        globalState.userPreferences[From] = 'text';
        
        const textMessage = await generateMultiLanguageResponse(
          '📝 Please type your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,  // Use the preserved language
          requestId
        );
        response.message(textMessage);
      }
      
      trackResponseTime(requestStart, requestId);
      return res.send(response.toString());
    }
    
    // Handle text-based selection responses
    if (Body && (Body === '1' || Body === '2' || Body.toLowerCase() === 'voice' || Body.toLowerCase() === 'text')) {
      console.log(`[${requestId}] Text-based selection: "${Body}"`);
      
      // Store user preference for input method
      if (!globalState.userPreferences) {
        globalState.userPreferences = {};
      }
      
      // Determine the user's language - don't re-detect for simple selections
      let detectedLanguage = 'en';
      
      // First check conversation state
      if (conversationState && conversationState.language) {
        detectedLanguage = conversationState.language;
        console.log(`[${requestId}] Using language from conversation state: ${detectedLanguage}`);
      } 
      // Then check user preference from database
      else if (From) {
        try {
          const shopId = From.replace('whatsapp:', '');
          const userPref = await getUserPreference(shopId);
          if (userPref.success) {
            detectedLanguage = userPref.language;
            console.log(`[${requestId}] Using language from user preference: ${detectedLanguage}`);
          }
        } catch (error) {
          console.warn(`[${requestId}] Failed to get user preference:`, error.message);
        }
      }
      
      // Set input method preference based on response
      if (Body === '1' || Body.toLowerCase() === 'voice') {
        globalState.userPreferences[From] = 'voice';
        
        const voiceMessage = await generateMultiLanguageResponse(
          '🎤 Please send a voice message with your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,  // Use the preserved language
          requestId
        );
        response.message(voiceMessage);
      } else if (Body === '2' || Body.toLowerCase() === 'text') {
        globalState.userPreferences[From] = 'text';
        
        const textMessage = await generateMultiLanguageResponse(
          '📝 Please type your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,  // Use the preserved language
          requestId
        );
        response.message(textMessage);
      }
      
      trackResponseTime(requestStart, requestId);
      return res.send(response.toString());
    }
    
    // Handle input method switch commands
    if (Body) {
      const lowerBody = Body.toLowerCase();
      
      // Check for reset commands
      if (resetCommands.some(cmd => lowerBody.includes(cmd))) {
        console.log(`[${requestId}] User requested reset`);
        
        // Clear conversation state
        if (globalState.conversationState && globalState.conversationState[From]) {
          delete globalState.conversationState[From];
        }
        
        // Detect language for response
        let detectedLanguage = 'en';
        try {
          detectedLanguage = await detectLanguageWithFallback(Body, From, requestId);
        } catch (error) {
          console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
        }
        
        const resetMessage = await generateMultiLanguageResponse(
          'Flow has been reset. How would you like to send your inventory update?',
          detectedLanguage,
          requestId
        );
        response.message(resetMessage);
        
        trackResponseTime(requestStart, requestId);
        return res.send(response.toString());
      }
      
      // Check for switch commands
      if (lowerBody.includes('switch to text') || lowerBody.includes('change to text') || lowerBody.includes('use text')) {
        console.log(`[${requestId}] User switching to text input`);
        
        // Store user preference
        if (!globalState.userPreferences) {
          globalState.userPreferences = {};
        }
        globalState.userPreferences[From] = 'text';
        
        // Detect language for response
        let detectedLanguage = 'en';
        try {
          detectedLanguage = await detectLanguageWithFallback(Body, From, requestId);
        } catch (error) {
          console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
        }
        
        const switchMessage = await generateMultiLanguageResponse(
          '✅ Switched to text input. Please type your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,
          requestId
        );
        response.message(switchMessage);
        
        trackResponseTime(requestStart, requestId);
        return res.send(response.toString());
      }
      
      if (lowerBody.includes('switch to voice') || lowerBody.includes('change to voice') || lowerBody.includes('use voice')) {
        console.log(`[${requestId}] User switching to voice input`);
        
        // Store user preference
        if (!globalState.userPreferences) {
          globalState.userPreferences = {};
        }
        globalState.userPreferences[From] = 'voice';
        
        // Detect language for response
        let detectedLanguage = 'en';
        try {
          detectedLanguage = await detectLanguageWithFallback(Body, From, requestId);
        } catch (error) {
          console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
        }
        
        const switchMessage = await generateMultiLanguageResponse(
          '✅ Switched to voice input. Please send a voice message with your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,
          requestId
        );
        response.message(switchMessage);
        
        trackResponseTime(requestStart, requestId);
        return res.send(response.toString());
      }
    }
    
    // Handle confirmation responses
    if (Body && (Body.toLowerCase() === 'yes' || Body.toLowerCase() === 'no')) {
      console.log(`[${requestId}] Message appears to be a confirmation response: "${Body}"`);
      
      // Check for pending transcriptions
      if (globalState.pendingTranscriptions[From]) {
        const pending = globalState.pendingTranscriptions[From];
        
        if (Body.toLowerCase() === 'yes') {
          console.log(`[${requestId}] User confirmed transcription: "${pending.transcript}"`);
          await processConfirmedTranscription(
            pending.transcript,
            From,
            pending.detectedLanguage,
            requestId,
            response,
            res
          );
          delete globalState.pendingTranscriptions[From];
          trackResponseTime(requestStart, requestId);
          return;
        } else {
          console.log(`[${requestId}] User rejected transcription`);
          
          const errorMessage = await generateMultiLanguageResponse(
            'Please try again with a clear voice message.',
            pending.detectedLanguage,
            requestId
          );
          response.message(errorMessage);
          delete globalState.pendingTranscriptions[From];
          trackResponseTime(requestStart, requestId);
          return res.send(response.toString());
        }
      }
      
      // Check for pending product updates
      if (globalState.pendingProductUpdates && globalState.pendingProductUpdates[From]) {
        const pending = globalState.pendingProductUpdates[From];
        
        if (Body.toLowerCase() === 'yes') {
          console.log(`[${requestId}] User confirmed product update: "${pending.update.product}"`);
          
          // Process the confirmed update
          const shopId = From.replace('whatsapp:', '');
          const results = await updateMultipleInventory(shopId, [pending.update], pending.detectedLanguage);
          
          let message = '✅ Update processed:\n\n';
          let successCount = 0;
          let hasSales = false;
          
          for (const result of results) {
            if (result.success) {
              successCount++;
              const unitText = result.unit ? ` ${result.unit}` : '';
              message += `• ${result.product}: ${result.quantity > 0 ? '+' : ''}${result.quantity}${unitText} (Stock: ${result.newQuantity}${unitText})\n`;
              
              if (result.quantity > 0 && result.batchDate) {
                message += ` Batch added: ${formatDateForDisplay(result.batchDate)}\n`;
              }
              
              if (result.quantity < 0) {
                hasSales = true;
              }
            } else {
              message += `• ${result.product}: Error - ${result.error}\n`;
            }
          }
          
          message += `\n✅ Successfully updated ${successCount} of 1 item`;
          
          if (hasSales) {
            message += `\n\nFor better batch tracking, please specify which batch was sold in your next message.`;
            
            // Set conversation state to await batch selection
            if (!globalState.conversationState) {
              globalState.conversationState = {};
            }
            globalState.conversationState[From] = {
              state: 'awaiting_batch_selection',
              language: pending.detectedLanguage,
              timestamp: Date.now()
            };
          }
          
          // Add switch option in completion messages
          message += `\n\nTo switch input method, reply "switch to text" or "switch to voice".`;
          
          // Add reset option
          message += `\nTo reset the flow, reply "reset".`;
          
          const formattedResponse = await generateMultiLanguageResponse(message, pending.detectedLanguage, requestId);
          response.message(formattedResponse);
          
          delete globalState.pendingProductUpdates[From];
          trackResponseTime(requestStart, requestId);
          return res.send(response.toString());
        } else {
          console.log(`[${requestId}] User rejected product update`);
          
          const errorMessage = await generateMultiLanguageResponse(
            'Please try again with a clear message.',
            pending.detectedLanguage,
            requestId
          );
          response.message(errorMessage);
          delete globalState.pendingProductUpdates[From];
          trackResponseTime(requestStart, requestId);
          return res.send(response.toString());
        }
      }
    }
    
    // Handle text messages
    if (Body && (NumMedia === '0' || NumMedia === 0 || !NumMedia)) {
      console.log(`[${requestId}] [1] Processing text message: "${Body}"`);
      
      // Check for common greetings with optimized detection
      const lowerBody = Body.toLowerCase();
      let isGreeting = false;
      let greetingLang = 'en';
      
      // Quick check for common greetings in any language
      const quickGreetings = ['hello', 'hi', 'hey', 'नमस्ते', 'হ্যালো', 'வணக்கம்', 'నమస్కారం', 'ನಮಸ್ಕಾರ', 'નમસ્તે', 'नमस्कार'];
      
      if (quickGreetings.some(g => lowerBody.includes(g))) {
        isGreeting = true;
        
        // Determine specific language
        for (const [lang, greetingList] of Object.entries(greetings)) {
          if (greetingList.some(g => lowerBody.includes(g))) {
            greetingLang = lang;
            break;
          }
        }
        
        console.log(`[${requestId}] Detected greeting in language: ${greetingLang}`);
        
        // Reset conversation state on greeting
        if (globalState.conversationState && globalState.conversationState[From]) {
          delete globalState.conversationState[From];
        }
        
        // Save user preference asynchronously (don't wait for it)
        const shopId = From.replace('whatsapp:', '');
        saveUserPreference(shopId, greetingLang)
          .then(result => {
            if (result.success) {
              console.log(`[${requestId}] Saved language preference: ${greetingLang} for user ${shopId}`);
            } else {
              console.warn(`[${requestId}] Failed to save language preference: ${result.error}`);
            }
          })
          .catch(error => {
            console.error(`[${requestId}] Error saving language preference:`, error.message);
          });
        
        console.log(`[${requestId}] Processing greeting without waiting for preference save`);
        
        // Use predefined greeting messages to avoid translation API calls
        const greetingMessages = {
          'hi': `नमस्ते! मैं देखता हूं कि आप ${userPreference} द्वारा अपडेट भेजना पसंद करते हैं। आज मैं आपकी कैसे मदद कर सकता हूं?\n\nNamaste! Main dekhta hoon ki aap ${userPreference} dwara update bhejna pasand karte hain. Aaj main aapki kaise madad kar sakta hoon?`,
          'bn': `হ্যালো! আমি দেখতে পাচ্ছি আপনি ${userPreference} দিয়ে আপডেট পাঠাতে পছন্দ করেন। আজ আমি আপনাকে কিভাবে সাহায্য করতে পারি?\n\nHello! Ami dekhte pachchi apni ${userPreference} diye update pathate pochondo koren. Aaj ami apnake kivabe sahaj korte pari?`,
          'ta': `வணக்கம்! நான் பார்க்கிறேன் நீங்கள் ${userPreference} மூலம் புதுப்பிப்புகளை அனுப்புவதை விரும்புகிறீர்கள். இன்று நான் உங்களுக்கு எப்படி உதவ முடியும்?\n\nVanakkam! Naan paarkiren neengal ${userPreference} mulam puthippugalai anupuvathai virumbukireergal. Indru naan ungaluku eppadi utha mudiyum?`,
          'te': `నమస్కారం! నేను చూస్తున్నాను మీరు ${userPreference} ద్వారా నవీకరణలను పంపించడాన్ని ఇష్టపడతారు. నేడు నేను మీకు ఎలా సహాయపడగలను?\n\nNamaskaram! Nenu chustunnanu miru ${userPreference} dwara naveekaralanu pampinchadanni istapadaru. Nedu nenu meeku ela saahayapadagalanu?`,
          'kn': `ನಮಸ್ಕಾರ! ನಾನು ನೋಡುತ್ತಿದ್ದೇನೆ ನೀವು ${userPreference} ಮೂಲಕ ನವೀಕರಣಗಳನ್ನು ಕಳುಹಿಸಲು ಇಷ್ಟಪಡುತ್ತೀರಿ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?\n\nNamaskara! Nanu noduttiddene neevu ${userPreference} moolaka naveekaragannannu kelisu ishtaputtiri. Indu nanu nimage hege saahya madabahudu?`,
          'gu': `નમસ્તે! હું જોઉં છું કે તમે ${userPreference} દ્વારા અપડેટ્સ મોકલવાનું પસંદ કરો છો. આજે હું તમને કેવી રીતે મદદ કરી શકું?\n\nNamaste! Hu joo chu ke tame ${userPreference} dwara apdets moklavanu pasand karo cho. Aje hu tamne kavi rite madad kar shakum?`,
          'mr': `नमस्कार! मी पाहतो आपण ${userPreference} द्वारे अपडेट्स पाठवायला पसंत करता. आज मी तुम्हाला कशी मदत करू शकतो?\n\nNamaskar! Mi pahato aapan ${userPreference} dwara apdets pathavayala pasand karta. Aaj mi tumhala kashi madad karu shakto?`,
          'en': `Hello! I see you prefer to send updates by ${userPreference}. How can I help you today?`
        };
        
        if (userPreference !== 'voice') {
          const greetingMessage = greetingMessages[greetingLang] || greetingMessages['en'];
          response.message(greetingMessage);
          
          trackResponseTime(requestStart, requestId);
          return res.send(response.toString());
        }
        
        // Use text-based selection instead of buttons for broader compatibility
        const welcomeMessages = {
          'hi': `नमस्ते! आप अपना इन्वेंट्री अपडेट कैसे भेजना चाहेंगे?\n\nजवाब दें:\n• "1" वॉइस मैसेज के लिए\n• "2" टेक्स्ट मैसेज के लिए\n\nNamaste! Aap apna inventory update kaise bhejna chaahenge?\n\nJawaab dein:\n• "1" voice message ke liye\n• "2" text message ke liye`,
          'bn': `স্বাগতম! আপনি কিভাবে আপনার ইনভেন্টরি আপডেট পাঠাতে চান?\n\nউত্তর দিন:\n• "1" ভয়েস মেসেজের জন্য\n• "2" টেক্সট মেসেজের জন্য\n\nSwagatam! Apni kivabe apnar inventory update pathate chan?\n\nUttor din:\n• "1" voice message er jonno\n• "2" text message er jonno`,
          'ta': `வணக்கம்! நீங்கள் உங்கள் இன்வென்டரி புதுப்பிப்பை எப்படி அனுப்ப விரும்புகிறீர்கள்?\n\nபதிலளிக்கவும்:\n• "1" குரல் செய்திக்கு\n• "2" உரை செய்திக்கு\n\nVanakkam! Neengal ungal inventory puthippai eppadi anpu virumbukireergal?\n\nBadhilikavum:\n• "1" kural seithikku\n• "2"urai seithikku`,
          'te': `నమస్కారం! మీరు మీ ఇన్వెంటరీ నవీకరణను ఎలా పంపాలనుకుంటున్నారు?\n\nస్పందించండి:\n• "1" వాయిస్ సందేశం కోసం\n• "2" టెక్స్ట్ సందేశం కోసం\n\nNamaskaram! Meeru mee inventory naveekaranam ela paalana kosamee?\n\nSpandinchandi:\n• "1" voice message kosam\n• "2" text message kosam`,
          'kn': `ನಮಸ್ಕಾರ! ನೀವು ನಿಮ್ಮ ಇನ್ವೆಂಟರಿ ಅಪ್‌ಡೇಟ್ ಅನ್ನು ಹೇಗೆ ಕಳುಹಿಸಲು ಬಯಸುತ್ತೀರಿ?\n\n ಪ್ರತಿಕ್ರಿಯಿಸಿ:\n• "1" ಧ್ವನಿ ಸಂದೇಶಕ್ಕಾಗಿ\n• "2" ಪಠ್ಯ ಸಂದೇಶಕ್ಕಾಗಿ\n\nNamaskara! Neevu nimma inventory update annahege kelisu baaasuttiri?\n\nPratikriyisi:\n• "1" dhwani sandeshakkaagi\n• "2" patya sandeshakkaagi`,
          'gu': `નમસ્તે! તમે તમારું ઇન્વેન્ટરી અપડેટ કેવી રીતે મોકલવા માંગો છો?\n\n જવાબ આપો:\n• "1" વોઇસ મેસેજ માટે\n• "2" ટેક્સ્ટ મેસેજ માટે\n\nNamaste! Tame tamaru inventory update kevi rite moklava mango cho?\n\nJawaab aapo:\n• "1" voice message maate\n• "2" text message maate`,
          'mr': `नमस्कार! तुम्ही तुमचे इन्व्हेन्टरी अपडेट कसे पाठवायला इच्छिता?\n\n उत्तर द्या:\n• "1" व्हॉइस मेसेज साठी\n• "2" मजकूर मेसेज साठी\n\nNamaskar! Tumhi tumche inventory update kase pathavayla ichhita?\n\nUttar dya:\n• "1" voice message sathi\n• "2" majkur message sathi`,
          'en': `Welcome! How would you like to send your inventory update?\n\nReply:\n• "1" for Voice Message\n• "2" for Text Message`
        };
        
        const welcomeMessage = welcomeMessages[greetingLang] || welcomeMessages['en'];
        response.message(welcomeMessage);
        
        trackResponseTime(requestStart, requestId);
        return res.send(response.toString());
      }
      
      // Check if we're awaiting batch selection
      if (conversationState && conversationState.state === 'awaiting_batch_selection') {
        console.log(`[${requestId}] Awaiting batch selection response`);
        await handleBatchSelectionResponse(Body, From, response, requestId, conversationState.language);
        trackResponseTime(requestStart, requestId);
        return res.send(response.toString());
      }
      
      // Check for batch selection or expiry date updates only if in the appropriate state
      if (conversationState && conversationState.state === 'awaiting_batch_selection') {
        if (isBatchSelectionResponse(Body)) {
          console.log(`[${requestId}] Message appears to be a batch selection response`);
          await handleBatchSelectionResponse(Body, From, response, requestId, conversationState.language);
          trackResponseTime(requestStart, requestId);
          return res.send(response.toString());
        } else if (isExpiryDateUpdate(Body)) {
          console.log(`[${requestId}] Message appears to be an expiry date update`);
          await handleExpiryDateUpdate(Body, From, response, requestId, conversationState.language);
          trackResponseTime(requestStart, requestId);
          return res.send(response.toString());
        }
      }
      
      console.log(`[${requestId}] Attempting to parse as inventory update first`);
      
      // Detect language and update preference
      let detectedLanguage = conversationState ? conversationState.language : 'en';
      detectedLanguage = await checkAndUpdateLanguage(Body, From, detectedLanguage, requestId);
      console.log(`[${requestId}] Detected language for text update: ${detectedLanguage}`);
      
      // Try to parse as inventory update
      const updates = await parseMultipleUpdates(Body);
      
      if (updates.length > 0) {
        console.log(`[${requestId}] Parsed ${updates.length} updates from text message`);
        
        // Check if any updates are for unknown products
        const unknownProducts = updates.filter(u => !u.isKnown);
        if (unknownProducts.length > 0) {
          console.log(`[${requestId}] Found ${unknownProducts.length} unknown products, requesting confirmation`);
          
          // Confirm the first unknown product
          const confirmationResponse = await confirmProduct(unknownProducts[0], From, detectedLanguage, requestId);
          trackResponseTime(requestStart, requestId);
          res.send(confirmationResponse);
          return;
        }
        
        // Send immediate response and process asynchronously
        response.message('Processing your inventory update...');
        res.send(response.toString());
        
        // Process the text message asynchronously
        processTextMessageAsync(Body, From, detectedLanguage, requestId, conversationState)
          .catch(error => {
            console.error(`[${requestId}] Error in async text processing:`, error);
          });
          
        trackResponseTime(requestStart, requestId);
        return;
      } else {
        console.log(`[${requestId}] Not a valid inventory update, checking for specialized operations`);
        
        const defaultMessage = await generateMultiLanguageResponse(
          userPreference === 'voice'
            ? '🎤 Send inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.\n\nTo switch to text input, reply "switch to text".'
            : '📝 Type your inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.\n\nTo switch to voice input, reply "switch to voice".',
          detectedLanguage,
          requestId
        );
        
        response.message(defaultMessage);
      }
      
      trackResponseTime(requestStart, requestId);
      return res.send(response.toString());
    }
    
    // Handle voice messages
    if (NumMedia && MediaUrl0 && (NumMedia !== '0' && NumMedia !== 0)) {
      // Send immediate response for voice messages
      response.message('Processing your voice message...');
      res.send(response.toString());
      
      // Process audio asynchronously
      processVoiceMessageAsync(MediaUrl0, From, requestId, conversationState)
        .catch(error => {
          console.error(`[${requestId}] Error processing voice message:`, error);
        });
        
      trackResponseTime(requestStart, requestId);
      return;
    } else if (SpeechResult) {
      console.log(`[${requestId}] [1] Using Twilio transcription`);
      response.message(`🔊 (Twilio): "${SpeechResult}"`);
    } else {
      console.log(`[${requestId}] [1] No media received`);
      
      let detectedLanguage = conversationState ? conversationState.language : 'en';
      try {
        detectedLanguage = await detectLanguageWithFallback(Body || "", From, requestId);
        console.log(`[${requestId}] Detected language for welcome message: ${detectedLanguage}`);
      } catch (error) {
        console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
        detectedLanguage = 'en';
      }
      
      let welcomeMessage;
      if (userPreference === 'voice') {
        welcomeMessage = await generateMultiLanguageResponse(
          '🎤 Send inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.\n\nTo switch to text input, reply "switch to text".',
          detectedLanguage,
          requestId
        );
      } else {
        welcomeMessage = await generateMultiLanguageResponse(
          '📝 Type your inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.\n\nTo switch to voice input, reply "switch to voice".',
          detectedLanguage,
          requestId
        );
      }
      
      response.message(welcomeMessage);
    }
  } catch (error) {
    console.error(`[${requestId}] Processing Error:`, error.message);
    
    const errorMessage = await generateMultiLanguageResponse(
      'System error. Please try again with a clear voice message.',
      'en',
      requestId
    );
    response.message(errorMessage);
  }
  
  console.log(`[${requestId}] Sending TwiML response`);
  res.setHeader('Content-Type', 'text/xml');
  trackResponseTime(requestStart, requestId);
  res.send(response.toString());
};

// Log performance metrics periodically
setInterval(() => {
  if (responseTimes.count > 0) {
    const avg = responseTimes.total / responseTimes.count;
    console.log(`Performance stats - Avg: ${avg.toFixed(2)}ms, Max: ${responseTimes.max}ms, Count: ${responseTimes.count}`);
    
    // Reset for next period
    responseTimes.total = 0;
    responseTimes.count = 0;
    responseTimes.max = 0;
  }
}, 60 * 1000);
