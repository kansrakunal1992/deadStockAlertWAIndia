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
  batchUpdateInventory,
  getBatchByCompositeKey,           // Add this
  updateBatchQuantityByCompositeKey
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
const productTranslationCache = new Map();

// Cache TTL values
const LANGUAGE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const INVENTORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const PRODUCT_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const PRODUCT_TRANSLATION_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// Precompiled regex patterns for better performance
const regexPatterns = {
  purchaseKeywords: /(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy|khareeda)/gi,
  salesKeywords: /(बेचा|बेचे|becha|sold|बिक्री|becha)/gi,
  remainingKeywords: /(बचा|बचे|बाकी|remaining|left|bacha)/gi,
  dateFormats: /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})/gi,
  digits: /(\d+|[०-९]+)/i,
  resetCommands: /(reset|start over|restart|cancel|exit|stop)/gi,
  conjunctions: /(and|&|aur|also|और|एवं)/gi
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
  'Oreo', 'Sunfeast', 'Good Day', 'Marie Gold',
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
  'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट',
  // Branded FMCG
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया', 'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata', 'Oreo', 'Frooti', 'फ्रूटी', 'Sunfeast', 'Marie Gold', 'Good Day', 'Bournvita', 'Complan', 'Horlicks', 'Boost', 'Real Juice', 'Slice', 'Maaza', 'Pepsi', 'Coca-Cola', 'Sprite', 'Thums Up', 'Limca', 'Kinley', 'Bisleri', 'Aquafina', 'Appy Fizz',
  // Groceries
  'flour', 'आटा', 'maida', 'मैदा', 'besan', 'बेसन', 'sugar', 'चीनी', 'salt', 'नमक', 'rice', 'चावल', 'wheat', 'गेहूं', 'dal', 'दाल', 'moong dal', 'मूंग दाल', 'masoor dal', 'मसूर दाल', 'chana dal', 'चना दाल', 'rajma', 'राजमा', 'soybean', 'सोयाबीन', 'poha', 'पोहा', 'suji', 'सूजी', 'rava', 'रवा', 'sabudana', 'साबूदाना',
  // Vegetables
  'potato', 'आलू', 'onion', 'प्याज', 'tomato', 'टमाटर', 'carrot', 'गाजर', 'cabbage', 'पत्ता गोभी', 'cauliflower', 'फूलगोभी', 'spinach', 'पालक', 'brinjal', 'बैंगन', 'ladyfinger', 'भिंडी', 'capsicum', 'शिमला मिर्च', 'green chili', 'हरी मिर्च', 'garlic', 'लहसुन', 'ginger', 'अदरक',
  // Fruits
  'apple', 'सेब', 'banana', 'केला', 'orange', 'संतरा', 'mango', 'आम', 'grapes', 'अंगूर', 'papaya', 'पपीता', 'watermelon', 'तरबूज', 'muskmelon', 'खरबूजा', 'guava', 'अमरूद', 'pomegranate', 'अनार', 'lemon', 'नींबू',
  // Dairy
  'milk', 'दूध', 'curd', 'दही', 'yogurt', 'butter', 'मक्खन', 'cheese', 'पनीर', 'ghee', 'घी', 'cream', 'मलाई', 'lassi', 'लस्सी', 'buttermilk', 'छाछ',
  // Spices
  'turmeric', 'हल्दी', 'cumin', 'जीरा', 'coriander', 'धनिया', 'chili powder', 'मिर्च पाउडर', 'garam masala', 'गरम मसाला', 'asafoetida', 'हींग', 'mustard seeds', 'सरसों', 'fenugreek', 'मेथी', 'cardamom', 'इलायची', 'cloves', 'लौंग', 'black pepper', 'काली मिर्च', 'bay leaf', 'तेज पत्ता',
  // Packaged goods
  'packets', 'पैकेट', 'boxes', 'बॉक्स', 'bags', 'बैग्स', 'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट', 'shampoo', 'शैम्पू', 'toothpaste', 'टूथपेस्ट', 'toothbrush', 'टूथब्रश', 'face wash', 'फेस वॉश', 'handwash', 'हैंडवॉश', 'sanitizer', 'सेनेटाइज़र',
  // Household
  'phenyl', 'फिनाइल', 'harpic', 'हार्पिक', 'lizol', 'लिज़ोल', 'matchbox', 'माचिस', 'mosquito coil', 'मच्छर अगरबत्ती', 'mosquito repellent', 'मच्छर भगाने वाला', 'tissue paper', 'टिशू पेपर', 'napkin', 'नैपकिन', 'garbage bag', 'कचरा बैग',
  // Baby & Personal Care
  'diapers', 'डायपर', 'baby powder', 'बेबी पाउडर', 'baby lotion', 'बेबी लोशन', 'face cream', 'फेस क्रीम', 'body lotion', 'बॉडी लोशन', 'hair oil', 'हेयर ऑयल', 'comb', 'कंघी', 'razor', 'रेज़र', 'shaving cream', 'शेविंग क्रीम',
  // Beverages
  'tea', 'चाय', 'coffee', 'कॉफी', 'green tea', 'ग्रीन टी', 'black tea', 'ब्लैक टी', 'cold drink', 'कोल्ड ड्रिंक', 'energy drink', 'एनर्जी ड्रिंक',
  // Snacks
  'namkeen', 'नमकीन', 'bhujia', 'भुजिया', 'sev', 'सेव', 'chakli', 'चकली', 'murukku', 'मुरुक्कु', 'mixture', 'मिक्चर', 'kurkure', 'कुर्कुरे', 'lays', 'लेज़', 'bingo', 'बिंगो',
  // Frozen & Ready-to-eat
  'frozen peas', 'फ्रोजन मटर', 'frozen corn', 'फ्रोजन कॉर्न', 'ready-to-eat meals', 'तैयार भोजन', 'instant noodles', 'इंस्टेंट नूडल्स', 'instant soup', 'इंस्टेंट सूप',
  // Bakery
  'bread', 'ब्रेड', 'bun', 'बन', 'cake', 'केक', 'pastry', 'पेस्ट्री', 'rusk', 'रस्क',
  // Condiments
  'ketchup', 'केचप', 'mayonnaise', 'मेयोनेज़', 'sauce', 'सॉस', 'pickle', 'अचार', 'jam', 'जैम', 'honey', 'शहद',
  // Others
  'ice cream', 'आइसक्रीम', 'chocolate', 'चॉकलेट', 'candy', 'कैंडी', 'mint', 'मिंट', 'mouth freshener', 'माउथ फ्रेशनर'  
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
  // Hinglish
  'ek': 1, 'do': 2, 'teen': 3, 'char': 4, 'paanch': 5, 'chhah': 6,
  'saat': 7, 'aath': 8, 'nau': 9, 'das': 10, 'gyaarah': 11, 'baarah': 12,
  'terah': 13, 'chaudah': 14, 'pandrah': 15, 'solah': 16, 'satrah': 17,
  'athaarah': 18, 'unnis': 19, 'bees': 20, 'tees': 30, 'chaalis': 40,
  'pachaas': 50, 'saath': 60, 'sattar': 70, 'assi': 80, 'nabbe': 90, 'sau': 100,
  // Special case: "सो" means 100 in Hindi when referring to quantity
  'सो': 100,
  // Hindi numerals (Devanagari digits)
  '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9,
  '१०': 10, '११': 11, '१२': 12, '१३': 13, '१४': 14, '१५': 15, '१६': 16
};

// Units mapping with normalization
const units = {
  'packets': 1, 'पैकेट': 1, 'packet': 1,
  'boxes': 1, 'बॉक्स': 1, 'box': 1,
  'kg': 1, 'किलो': 1, 'kilo': 1, 'kilogram': 1, 'kilograms': 1,
  'g': 0.001, 'gram': 0.001, 'grams': 0.001, 'ग्राम': 0.001,
  'liters': 1, 'लीटर': 1, 'litre': 1, 'litres': 1, 'liter': 1,
  'ml': 0.001, 'milliliter': 0.001, 'milliliters': 0.001, 'millilitre': 0.001, 'millilitres': 0.001,
  'pieces': 1, 'पीस': 1, 'piece': 1,
  'gm': 0.001, 'gms': 0.001, // Added common abbreviations
  'kgs': 1, 'kilos': 1, // Added common abbreviations
  'l': 1, 'ltr': 1, 'ltrs': 1, // Added common abbreviations
  'mls': 0.001 // Added common abbreviations
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

// Helper function to format dates for Airtable (YYYY-MM-DDTHH:mm:ss.sssZ)
function formatDateForAirtable(date) {
  if (date instanceof Date) {
    return date.toISOString();
  }
  if (typeof date === 'string') {
    if (date.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      // Already in ISO format with time
      return date;
    }
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Date only, add time component
      return `${date}T00:00:00.000Z`;
    }
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  }
  return null;
}

// Helper function to format date for display (DD/MM/YYYY HH:MM)
function formatDateForDisplay(date) {
  if (date instanceof Date) {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }
  if (typeof date === 'string') {
    if (date.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      // ISO format with time
      const parsedDate = new Date(date);
      const day = parsedDate.getDate().toString().padStart(2, '0');
      const month = (parsedDate.getMonth() + 1).toString().padStart(2, '0');
      const year = parsedDate.getFullYear();
      const hours = parsedDate.getHours().toString().padStart(2, '0');
      const minutes = parsedDate.getMinutes().toString().padStart(2, '0');
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    }
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Date only
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
  // Log slow responses (increased threshold)
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
  // Clean product translation cache
  for (const [key, value] of productTranslationCache.entries()) {
    if (now - value.timestamp > PRODUCT_TRANSLATION_CACHE_TTL) {
      productTranslationCache.delete(key);
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

// Improved language detection with script detection and fallback
async function detectLanguageWithFallback(text, from, requestId) {
  try {
    // Check cache first
    const cacheKey = `${from}:${text.substring(0, 50)}`;
    const cached = languageCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < LANGUAGE_CACHE_TTL)) {
      console.log(`[${requestId}] Using cached language detection: ${cached.language}`);
      return cached.language;
    }
    // First, try to detect script for more accurate language detection
    const lowerText = text.toLowerCase();
    let detectedLanguage = 'en'; // Default to English
    // Check for specific language scripts first
    if (/[\u0900-\u097F]/.test(text)) {
  const englishKeywords = ['milk', 'sold', 'purchased', 'bought', 'Oreo', 'Frooti', 'Maggi', 'Amul'];
  if (englishKeywords.some(word => text.toLowerCase().includes(word.toLowerCase()))) {
    detectedLanguage = 'en';
  } else {
    detectedLanguage = 'hi';
  }
}
    else if (/[\u0980-\u09FF]/.test(text)) { // Bengali script
      detectedLanguage = 'bn';
    } else if (/[\u0B80-\u0BFF]/.test(text)) { // Tamil script
      detectedLanguage = 'ta';
    } else if (/[\u0C00-\u0C7F]/.test(text)) { // Telugu script
      detectedLanguage = 'te';
    } else if (/[\u0C80-\u0CFF]/.test(text)) { // Kannada script
      detectedLanguage = 'kn';
    } else if (/[\u0A80-\u0AFF]/.test(text)) { // Gujarati script
      detectedLanguage = 'gu';
    } else {
      // For Latin script, check for specific greeting words
      if (lowerText.includes('hello') || lowerText.includes('hi') || lowerText.includes('hey')) {
        detectedLanguage = 'en';
      } else if (lowerText.includes('नमस्ते') || lowerText.includes('नमस्कार')) {
        detectedLanguage = 'hi';
      } else if (lowerText.includes('வணக்கம்')) {
        detectedLanguage = 'ta';
      } else if (lowerText.includes('నమస్కారం')) {
        detectedLanguage = 'te';
      } else if (lowerText.includes('ನಮಸ್ಕಾರ')) {
        detectedLanguage = 'kn';
      } else if (lowerText.includes('নমস্কার')) {
        detectedLanguage = 'bn';
      } else if (lowerText.includes('નમસ્તે')) {
        detectedLanguage = 'gu';
      } else if (lowerText.includes('नमस्कार')) {
        detectedLanguage = 'mr';
      }
    }
    // If we couldn't detect by script or keywords, use AI
    if (detectedLanguage === 'en') {
      try {
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
            timeout: 10000 // Increased timeout
          }
        );
        detectedLanguage = response.data.choices[0].message.content.trim().toLowerCase();
      } catch (error) {
        console.warn(`[${requestId}] AI language detection failed, defaulting to English:`, error.message);
        detectedLanguage = 'en';
      }
    }
    console.log(`[${requestId}] Detected language: ${detectedLanguage}`);
    // Save the detected language preference
    if (from) {
      const shopId = from.replace('whatsapp:', '');
      // Don't wait for this to complete
      saveUserPreference(shopId, detectedLanguage)
        .catch(error => console.warn(`[${requestId}] Failed to save language preference:`, error.message));
      console.log(`[${requestId}] Saved language preference: ${detectedLanguage} for user ${shopId}`);
    }
    // Cache the result
    languageCache.set(cacheKey, { language: detectedLanguage, timestamp: Date.now() });
    return detectedLanguage;
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

// Improved product name translation with direct mappings
async function translateProductName(productName, requestId) {
  try {
    // Check cache first
    const cacheKey = productName.toLowerCase();
    const cached = productTranslationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < PRODUCT_TRANSLATION_CACHE_TTL)) {
      console.log(`[${requestId}] Using cached product translation: "${productName}" → "${cached.translation}"`);
      return cached.translation;
    }
    // First check if it's already a known product in English
    if (products.some(p => p.toLowerCase() === productName.toLowerCase())) {
      return productName;
    }
    // Direct Hindi to English mappings for common products
    const hindiToEnglish = {
      'चीनी': 'sugar', 'cheeni': 'sugar',
      'दूध': 'milk', 'doodh': 'milk',
      'आटा': 'flour', 'aata': 'flour',
      'नमक': 'salt', 'namak': 'salt',
      'गेहूं': 'wheat', 'gehun': 'wheat',
      'तेल': 'oil', 'tel': 'oil',
      'मक्खन': 'butter', 'makkhan': 'butter',
      'दही': 'curd', 'dahi': 'curd',
      'पनीर': 'cheese', 'paneer': 'cheese',
      'फ्रूटी': 'Frooti', 'frooti': 'Frooti'
    };
    const lowerProductName = productName.toLowerCase();
    if (hindiToEnglish[lowerProductName]) {
      const translated = hindiToEnglish[lowerProductName];
      console.log(`[${requestId}] Translated product (mapping): "${productName}" → "${translated}"`);
      // Cache the result
      productTranslationCache.set(cacheKey, {
        translation: translated,
        timestamp: Date.now()
      });
      return translated;
    }
    const fuzzyMap = {
  'fruity': 'Frooti',
  'fruti': 'Frooti',
  'parleg': 'Parle-G',
  'oreo': 'Oreo'
};
 
const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/gi, '');
const normalizedName = normalize(productName);
 
if (fuzzyMap[normalizedName]) {
  return fuzzyMap[normalizedName];
}
    // Try to translate using AI
    try {
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content: `Translate the following product name to English. If it's already in English, return it as is. Only return the translated product name, nothing else.`
            },
            {
              role: "user",
              content: productName
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
          timeout: 5000
        }
      );
      const translated = response.data.choices[0].message.content.trim();
      console.log(`[${requestId}] Translated product (AI): "${productName}" → "${translated}"`);
      // Check if the translated product is in our known products list
      if (products.some(p => p.toLowerCase() === translated.toLowerCase())) {
        // Cache the result
        productTranslationCache.set(cacheKey, {
          translation: translated,
          timestamp: Date.now()
        });
        return translated;
      }
      // If not found, return original
      return productName;
    } catch (error) {
      console.warn(`[${requestId}] AI product translation failed:`, error.message);
      return productName;
    }
  } catch (error) {
    console.warn(`[${requestId}] Product translation failed:`, error.message);
    return productName;
  }
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
- Use "purchased" for words like "bought", "purchased", "buy", "खरीदा", "खरीदे", "लिया", "खरीदी", "khareeda"
- Use "sold" for words like "sold", "बेचा", "बेचे", "becha", "बिक्री", "becha"
- Use "remaining" for words like "remaining", "left", "बचा", "बचे", "बाकी", "bacha"
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
        timeout: 10000 // Increased timeout
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
      const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/gi, '');
      const parsed = JSON.parse(content);
      let quantity = parsed.quantity || 0;
      // FIX: Ensure sales have negative quantities
      if (parsed.action === 'sold') {
        quantity = -Math.abs(quantity);
      } else if (parsed.action === 'purchased') {
        quantity = Math.abs(quantity);
      }
      return {
        product: parsed.product || '',
        quantity: quantity,
        unit: parsed.unit || '',
        action: parsed.action || (quantity >= 0 ? 'purchased' : 'sold'),
        isKnown: products.some(p =>
        normalize(p).includes(normalize(parsed.product)) ||
        normalize(parsed.product).includes(normalize(p))
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
      aiUpdate.product = await translateProductName(aiUpdate.product, 'ai-parsing');
      console.log(`[AI Parsing] Successfully parsed: ${aiUpdate.quantity} ${aiUpdate.unit} of ${aiUpdate.product} (${aiUpdate.action})`);
      updates.push(aiUpdate);
      return updates;
    }

  } catch (error) {
    console.warn(`[AI Parsing] Failed, falling back to rule-based parsing:`, error.message);
  }
  // Fallback to rule-based parsing if AI fails
  // Better sentence splitting to handle conjunctions
  const sentences = transcript.split(regexPatterns.conjunctions);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed) {
      try {
        let update = parseSingleUpdate(trimmed);
        if (update && update.product) {
          update.product = await translateProductName(update.product, 'rule-parsing');
        }
        if (isValidInventoryUpdate(update)) {
          updates.push(update);
        }
      } catch (err) {
        console.warn(`[parseMultipleUpdates] Failed to parse sentence: "${trimmed}"`, err.message);
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

// Improved parse single update with proper action detection and unit handling
function parseSingleUpdate(transcript) {
  const normalize = str => str.toLowerCase().replace(/[^a-z0-9]/gi, '');
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
  // Improved action detection with priority for purchase/sold over remaining
  const isPurchase = regexPatterns.purchaseKeywords.test(transcript);
  const isSold = regexPatterns.salesKeywords.test(transcript);
  const isRemaining = regexPatterns.remainingKeywords.test(transcript);
  let action, finalQuantity;
  // CRITICAL FIX: Proper action detection with correct math
  if (isSold) {
    action = 'sold';
    finalQuantity = -Math.abs(quantity); // Always negative for sales
  } else if (isPurchase) {
    action = 'purchased';
    finalQuantity = Math.abs(quantity); // Always positive for purchases
  } else if (isRemaining) {
    // Only treat as "remaining" if no other action is detected
    action = 'remaining';
    finalQuantity = Math.abs(quantity); // Positive for remaining
  } else {
    // Default based on context if no action words
    action = 'purchased'; // Default to purchase
    finalQuantity = Math.abs(quantity);
  }
  return {
  product,
  quantity: finalQuantity,
  unit,
  action,
  isKnown: products.some(p =>
    normalize(p).includes(normalize(product)) ||
    normalize(product).includes(normalize(p))
  )
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
        timeout: 10000 // Increased timeout
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
  const results = [];
  for (const update of updates) {
    try {
      // Translate product name before processing
      const translatedProduct = await translateProductName(update.product, 'update');
      console.log(`[Update ${shopId}] Using translated product: "${translatedProduct}"`);
      // Use translated product for all operations
      const product = translatedProduct;
      // Rest of the function remains the same...
      console.log(`[Update ${shopId} - ${product}] Processing update: ${update.quantity} ${update.unit}`);
      // Check if this is a sale (negative quantity)
      const isSale = update.action === 'sold';
      // For sales, try to determine which batch to use
let selectedBatchCompositeKey = null;
if (isSale) {
  // Get available batches for this product using translated name
  const batches = await getBatchRecords(shopId, product);
  if (batches.length > 0) {
    // Use the oldest batch (FIFO - First In, First Out)

    // Filter out batches with zero or undefined quantity
const validBatches = batches.filter(batch => {
  const qty = batch.fields.Quantity ?? 0;
  return qty > 0;
});

if (validBatches.length > 0) {
  const oldestValidBatch = validBatches[validBatches.length - 1];
  selectedBatchCompositeKey = oldestValidBatch.fields.CompositeKey;
  console.log(`[Update ${shopId} - ${product}] Selected valid batch with composite key: ${selectedBatchCompositeKey}`);
  console.log(`[Update ${shopId} - ${product}] Batch details:`, JSON.stringify(oldestValidBatch.fields));
} else {
  console.warn(`[Update ${shopId} - ${product}] No valid batch with quantity > 0 found`);
  selectedBatchCompositeKey = null;
}

    
    console.log(`[Update ${shopId} - ${product}] Selected batch with composite key: ${selectedBatchCompositeKey}`);
    
    
    // Verify the batch exists before proceeding
    const selectedBatch = await getBatchByCompositeKey(selectedBatchCompositeKey);
    
    if (!selectedBatch) {
      console.warn(`[Update ${shopId} - ${product}] Selected batch no longer exists, trying to find alternative`);
      
      // Try to find an alternative batch
      const existingBatches = batches.filter(batch => batch.fields.CompositeKey);
      
      if (existingBatches.length > 0) {
        // Use the newest batch as alternative
        selectedBatchCompositeKey = existingBatches[0].fields.CompositeKey;
        console.log(`[Update ${shopId} - ${product}] Using alternative batch: ${selectedBatchCompositeKey}`);
      } else {
        console.error(`[Update ${shopId} - ${product}] No alternative batch found`);
        selectedBatchCompositeKey = null;
      }
    }
  }
}
      // Update the inventory using translated product name
      const result = await updateInventory(shopId, product, update.quantity, update.unit);
      // Create batch record for purchases only
if (update.action === 'purchased' && result.success) {
  console.log(`[Update ${shopId} - ${product}] Creating batch record for purchase`);
  // Format current date with time for Airtable
  const formattedPurchaseDate = formatDateForAirtable(new Date());
  console.log(`[Update ${shopId} - ${product}] Using timestamp: ${formattedPurchaseDate}`);
  const batchResult = await createBatchRecord({
    shopId,
    product: product, // Use translated product
    quantity: update.quantity,
    unit: update.unit, // Pass the unit
    purchaseDate: formattedPurchaseDate,
    expiryDate: null // Will be updated later
  });
        if (batchResult.success) {
          console.log(`[Update ${shopId} - ${product}] Batch record created with ID: ${batchResult.id}`);
          // Add batch date to result for display
          result.batchDate = formattedPurchaseDate;
        } else {
          console.error(`[update] Failed to create batch record: ${batchResult.error}`);
        }
      }
           // Create sales record for sales only
      if (isSale && result.success) {
        console.log(`[Update ${shopId} - ${product}] Creating sales record`);
        try {
          // FIX: Pass the unit parameter to avoid undefined error
          const salesResult = await createSalesRecord({
            shopId,
            product: product,
            quantity: update.quantity,
            unit: update.unit,
            saleDate: new Date().toISOString(),
            batchCompositeKey: selectedBatchCompositeKey, // Uses composite key
            salePrice: 0
          });
          
          if (salesResult.success) {
            console.log(`[Update ${shopId} - ${product}] Sales record created with ID: ${salesResult.id}`);
            // Update batch quantity if a batch was selected
            if (selectedBatchCompositeKey) {
              console.log(`[Update ${shopId} - ${product}] About to update batch quantity. Composite key: "${selectedBatchCompositeKey}", Quantity change: ${update.quantity}`);
              try {
                const batchUpdateResult = await updateBatchQuantityByCompositeKey(
                  selectedBatchCompositeKey, 
                  update.quantity
                );
                
                if (batchUpdateResult.success) {
                  console.log(`[Update ${shopId} - ${product}] Updated batch quantity successfully`);
                  
                  // If the batch was recreated, add a note to the result
                  if (batchUpdateResult.recreated) {
                    console.log(`[Update ${shopId} - ${product}] Batch was recreated during update`);
                    result.batchRecreated = true;
                  }
                } else {
                  console.error(`[Update ${shopId} - ${product}] Failed to update batch quantity: ${batchUpdateResult.error}`);
                  result.batchIssue = true;
                  result.batchError = batchUpdateResult.error;
                }
              } catch (batchError) {
                console.error(`[Update ${shopId} - ${product}] Error updating batch quantity:`, batchError.message);
                result.batchIssue = true;
                result.batchError = batchError.message;
              }
            }
          } else {
            console.error(`[Update ${shopId} - ${product}] Failed to create sales record: ${salesResult.error}`);
          }
        } catch (salesError) {
          console.error(`[Update ${shopId} - ${product}] Error creating sales record:`, salesError.message);
          result.salesError = salesError.message;
        }
      }
      results.push({
        product: product, // Use translated product
        quantity: update.quantity,
        unit: update.unit,
        action: update.action,
        ...result
      });
    } catch (error) {
      console.error(`[Update ${shopId} - ${update.product}] Error:`, error.message);
      results.push({
        product: update.product,
        quantity: update.quantity,
        unit: update.unit,
        action: update.action,
        success: false,
        error: error.message
      });
    }
  }
  return results;
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
    
const isShortGreeting = lowerMessage.split(/\s+/).length <= 3;
if (isShortGreeting && (
    lowerMessage.includes('hello') ||
    lowerMessage.includes('hi') ||
    lowerMessage.includes('नमस्ते')
)) {
  const greeting = commonGreetings[languageCode] || commonGreetings['en'];
  const fallback = `${greeting.native}\n\n${greeting.roman}`;
  languageCache.set(cacheKey, { translation: fallback, timestamp: Date.now() });
  return fallback;
}

    // 2. For other messages, try the API
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
        timeout: 15000 // Increased timeout for better reliability
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
    // 3. For other messages, return the original with a note in both scripts when possible
    console.log(`[${requestId}] Using original message for ${languageCode}`);
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
    // Get user's preferred language for the response
    let userLanguage = detectedLanguage;
    try {
      const userPref = await getUserPreference(shopId);
      if (userPref.success) {
        userLanguage = userPref.language;
      }
    } catch (error) {
      console.warn(`[${requestId}] Failed to get user preference:`, error.message);
    }
    // Create base message in English first
    let baseMessage = '✅ Updates processed:\n\n';
    let successCount = 0;
    let hasSales = false;
    for (const result of results) {
      if (result.success) {
        successCount++;
        const unitText = result.unit ? ` ${result.unit}` : '';
        // Format based on action type
        if (result.action === 'purchased') {
          baseMessage += `• ${result.product}: ${result.quantity} ${unitText} purchased (Stock: ${result.newQuantity}${unitText})\n`;
          if (result.batchDate) {
            baseMessage += ` Batch added: ${formatDateForDisplay(result.batchDate)}\n`;
          }
        } else if (result.action === 'sold') {
          baseMessage += `• ${result.product}: ${Math.abs(result.quantity)} ${unitText} sold (Stock: ${result.newQuantity}${unitText})\n`;
          hasSales = true;
        } else if (result.action === 'remaining') {
          baseMessage += `• ${result.product}: ${result.quantity} ${unitText} remaining (Stock: ${result.newQuantity}${unitText})\n`;
        }
      } else {
        baseMessage += `• ${result.product}: Error - ${result.error}\n`;
      }
    }
    baseMessage += `\n✅ Successfully updated ${successCount} of ${updates.length} items`;
    if (hasSales) {
      baseMessage += `\n\nFor better batch tracking, please specify which batch was sold in your next message.`;
      // Set conversation state to await batch selection
      if (!globalState.conversationState) {
        globalState.conversationState = {};
      }
      globalState.conversationState[from] = {
        state: 'awaiting_batch_selection',
        language: userLanguage,
        timestamp: Date.now()
      };
    }
    // Add switch option in completion messages
    baseMessage += `\n\nYou can reply with a voice or text message. Examples:\n• Milk purchased - 5 litres\n• Oreo Biscuits sold - 9 packets\nWe'll automatically detect your input type.`;
    // Add reset option
    baseMessage += `\nTo reset the flow, reply "reset".`;
    // Translate the entire message to user's preferred language
    const translatedMessage = await generateMultiLanguageResponse(baseMessage, userLanguage, requestId);
    // Send the message
    response.message(translatedMessage);
    return res.send(response.toString());
  } catch (error) {
    console.error(`[${requestId}] Error processing confirmed transcription:`, error.message);
    // Get user's preferred language for error message too
    let userLanguage = detectedLanguage;
    try {
      const shopId = from.replace('whatsapp:', '');
      const userPref = await getUserPreference(shopId);
      if (userPref.success) {
        userLanguage = userPref.language;
      }
    } catch (error) {
      console.warn(`[${requestId}] Failed to get user preference:`, error.message);
    }
    const errorMessage = await generateMultiLanguageResponse(
      'System error. Please try again with a clear voice message.',
      userLanguage,
      requestId
    );
    response.message(errorMessage);
    return res.send(response.toString());
  }
}

// Function to confirm transcription with user
async function confirmTranscript(transcript, from, detectedLanguage, requestId) {
  const response = new twilio.twiml.MessagingResponse();
  await sendSystemMessage(
    `I heard: "${transcript}". Is this correct? You can reply with "yes" or "no", either by voice or text.`,
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
  `I heard: "${update.quantity} ${update.unit} of ${update.product}" (${update.action}).  
Is this correct?  
Reply with:  
1 – Product is wrong  
2 – Quantity is wrong  
3 – Action is wrong  
4 – All wrong, I’ll type it instead`,
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
  const hasDateFormat = message.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/) ||
                        message.match(/\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i);
  const products = [
  // Branded items
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
  'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
  'Oreo', 'Sunfeast', 'Good Day', 'Marie Gold',
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
  'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट',
  // Branded FMCG
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया', 'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata', 'Oreo', 'Frooti', 'फ्रूटी', 'Sunfeast', 'Marie Gold', 'Good Day', 'Bournvita', 'Complan', 'Horlicks', 'Boost', 'Real Juice', 'Slice', 'Maaza', 'Pepsi', 'Coca-Cola', 'Sprite', 'Thums Up', 'Limca', 'Kinley', 'Bisleri', 'Aquafina', 'Appy Fizz',
  // Groceries
  'flour', 'आटा', 'maida', 'मैदा', 'besan', 'बेसन', 'sugar', 'चीनी', 'salt', 'नमक', 'rice', 'चावल', 'wheat', 'गेहूं', 'dal', 'दाल', 'moong dal', 'मूंग दाल', 'masoor dal', 'मसूर दाल', 'chana dal', 'चना दाल', 'rajma', 'राजमा', 'soybean', 'सोयाबीन', 'poha', 'पोहा', 'suji', 'सूजी', 'rava', 'रवा', 'sabudana', 'साबूदाना',
  // Vegetables
  'potato', 'आलू', 'onion', 'प्याज', 'tomato', 'टमाटर', 'carrot', 'गाजर', 'cabbage', 'पत्ता गोभी', 'cauliflower', 'फूलगोभी', 'spinach', 'पालक', 'brinjal', 'बैंगन', 'ladyfinger', 'भिंडी', 'capsicum', 'शिमला मिर्च', 'green chili', 'हरी मिर्च', 'garlic', 'लहसुन', 'ginger', 'अदरक',
  // Fruits
  'apple', 'सेब', 'banana', 'केला', 'orange', 'संतरा', 'mango', 'आम', 'grapes', 'अंगूर', 'papaya', 'पपीता', 'watermelon', 'तरबूज', 'muskmelon', 'खरबूजा', 'guava', 'अमरूद', 'pomegranate', 'अनार', 'lemon', 'नींबू',
  // Dairy
  'milk', 'दूध', 'curd', 'दही', 'yogurt', 'butter', 'मक्खन', 'cheese', 'पनीर', 'ghee', 'घी', 'cream', 'मलाई', 'lassi', 'लस्सी', 'buttermilk', 'छाछ',
  // Spices
  'turmeric', 'हल्दी', 'cumin', 'जीरा', 'coriander', 'धनिया', 'chili powder', 'मिर्च पाउडर', 'garam masala', 'गरम मसाला', 'asafoetida', 'हींग', 'mustard seeds', 'सरसों', 'fenugreek', 'मेथी', 'cardamom', 'इलायची', 'cloves', 'लौंग', 'black pepper', 'काली मिर्च', 'bay leaf', 'तेज पत्ता',
  // Packaged goods
  'packets', 'पैकेट', 'boxes', 'बॉक्स', 'bags', 'बैग्स', 'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट', 'shampoo', 'शैम्पू', 'toothpaste', 'टूथपेस्ट', 'toothbrush', 'टूथब्रश', 'face wash', 'फेस वॉश', 'handwash', 'हैंडवॉश', 'sanitizer', 'सेनेटाइज़र',
  // Household
  'phenyl', 'फिनाइल', 'harpic', 'हार्पिक', 'lizol', 'लिज़ोल', 'matchbox', 'माचिस', 'mosquito coil', 'मच्छर अगरबत्ती', 'mosquito repellent', 'मच्छर भगाने वाला', 'tissue paper', 'टिशू पेपर', 'napkin', 'नैपकिन', 'garbage bag', 'कचरा बैग',
  // Baby & Personal Care
  'diapers', 'डायपर', 'baby powder', 'बेबी पाउडर', 'baby lotion', 'बेबी लोशन', 'face cream', 'फेस क्रीम', 'body lotion', 'बॉडी लोशन', 'hair oil', 'हेयर ऑयल', 'comb', 'कंघी', 'razor', 'रेज़र', 'shaving cream', 'शेविंग क्रीम',
  // Beverages
  'tea', 'चाय', 'coffee', 'कॉफी', 'green tea', 'ग्रीन टी', 'black tea', 'ब्लैक टी', 'cold drink', 'कोल्ड ड्रिंक', 'energy drink', 'एनर्जी ड्रिंक',
  // Snacks
  'namkeen', 'नमकीन', 'bhujia', 'भुजिया', 'sev', 'सेव', 'chakli', 'चकली', 'murukku', 'मुरुक्कु', 'mixture', 'मिक्चर', 'kurkure', 'कुर्कुरे', 'lays', 'लेज़', 'bingo', 'बिंगो',
  // Frozen & Ready-to-eat
  'frozen peas', 'फ्रोजन मटर', 'frozen corn', 'फ्रोजन कॉर्न', 'ready-to-eat meals', 'तैयार भोजन', 'instant noodles', 'इंस्टेंट नूडल्स', 'instant soup', 'इंस्टेंट सूप',
  // Bakery
  'bread', 'ब्रेड', 'bun', 'बन', 'cake', 'केक', 'pastry', 'पेस्ट्री', 'rusk', 'रस्क',
  // Condiments
  'ketchup', 'केचप', 'mayonnaise', 'मेयोनेज़', 'sauce', 'सॉस', 'pickle', 'अचार', 'jam', 'जैम', 'honey', 'शहद',
  // Others
  'ice cream', 'आइसक्रीम', 'chocolate', 'चॉकलेट', 'candy', 'कैंडी', 'mint', 'मिंट', 'mouth freshener', 'माउथ फ्रेशनर'  
];
  const hasProduct = products.some(p => message.toLowerCase().includes(p.toLowerCase()));
  return hasDateFormat && hasProduct;
}

// Handle batch selection response
async function handleBatchSelectionResponse(body, from, response, requestId, languageCode = 'en') {
  try {
    console.log(`[${requestId}] Processing batch selection response: "${body}"`);
    const shopId = from.replace('whatsapp:', '');
    const lowerBody = body.toLowerCase();
    let product = null;
    const products = [
  // Branded items
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
  'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
  'Oreo', 'Sunfeast', 'Good Day', 'Marie Gold',
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
  'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट',
  // Branded FMCG
  'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया', 'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata', 'Oreo', 'Frooti', 'फ्रूटी', 'Sunfeast', 'Marie Gold', 'Good Day', 'Bournvita', 'Complan', 'Horlicks', 'Boost', 'Real Juice', 'Slice', 'Maaza', 'Pepsi', 'Coca-Cola', 'Sprite', 'Thums Up', 'Limca', 'Kinley', 'Bisleri', 'Aquafina', 'Appy Fizz',
  // Groceries
  'flour', 'आटा', 'maida', 'मैदा', 'besan', 'बेसन', 'sugar', 'चीनी', 'salt', 'नमक', 'rice', 'चावल', 'wheat', 'गेहूं', 'dal', 'दाल', 'moong dal', 'मूंग दाल', 'masoor dal', 'मसूर दाल', 'chana dal', 'चना दाल', 'rajma', 'राजमा', 'soybean', 'सोयाबीन', 'poha', 'पोहा', 'suji', 'सूजी', 'rava', 'रवा', 'sabudana', 'साबूदाना',
  // Vegetables
  'potato', 'आलू', 'onion', 'प्याज', 'tomato', 'टमाटर', 'carrot', 'गाजर', 'cabbage', 'पत्ता गोभी', 'cauliflower', 'फूलगोभी', 'spinach', 'पालक', 'brinjal', 'बैंगन', 'ladyfinger', 'भिंडी', 'capsicum', 'शिमला मिर्च', 'green chili', 'हरी मिर्च', 'garlic', 'लहसुन', 'ginger', 'अदरक',
  // Fruits
  'apple', 'सेब', 'banana', 'केला', 'orange', 'संतरा', 'mango', 'आम', 'grapes', 'अंगूर', 'papaya', 'पपीता', 'watermelon', 'तरबूज', 'muskmelon', 'खरबूजा', 'guava', 'अमरूद', 'pomegranate', 'अनार', 'lemon', 'नींबू',
  // Dairy
  'milk', 'दूध', 'curd', 'दही', 'yogurt', 'butter', 'मक्खन', 'cheese', 'पनीर', 'ghee', 'घी', 'cream', 'मलाई', 'lassi', 'लस्सी', 'buttermilk', 'छाछ',
  // Spices
  'turmeric', 'हल्दी', 'cumin', 'जीरा', 'coriander', 'धनिया', 'chili powder', 'मिर्च पाउडर', 'garam masala', 'गरम मसाला', 'asafoetida', 'हींग', 'mustard seeds', 'सरसों', 'fenugreek', 'मेथी', 'cardamom', 'इलायची', 'cloves', 'लौंग', 'black pepper', 'काली मिर्च', 'bay leaf', 'तेज पत्ता',
  // Packaged goods
  'packets', 'पैकेट', 'boxes', 'बॉक्स', 'bags', 'बैग्स', 'biscuits', 'बिस्कुट', 'chips', 'soap', 'साबुन', 'detergent', 'डिटर्जेंट', 'shampoo', 'शैम्पू', 'toothpaste', 'टूथपेस्ट', 'toothbrush', 'टूथब्रश', 'face wash', 'फेस वॉश', 'handwash', 'हैंडवॉश', 'sanitizer', 'सेनेटाइज़र',
  // Household
  'phenyl', 'फिनाइल', 'harpic', 'हार्पिक', 'lizol', 'लिज़ोल', 'matchbox', 'माचिस', 'mosquito coil', 'मच्छर अगरबत्ती', 'mosquito repellent', 'मच्छर भगाने वाला', 'tissue paper', 'टिशू पेपर', 'napkin', 'नैपकिन', 'garbage bag', 'कचरा बैग',
  // Baby & Personal Care
  'diapers', 'डायपर', 'baby powder', 'बेबी पाउडर', 'baby lotion', 'बेबी लोशन', 'face cream', 'फेस क्रीम', 'body lotion', 'बॉडी लोशन', 'hair oil', 'हेयर ऑयल', 'comb', 'कंघी', 'razor', 'रेज़र', 'shaving cream', 'शेविंग क्रीम',
  // Beverages
  'tea', 'चाय', 'coffee', 'कॉफी', 'green tea', 'ग्रीन टी', 'black tea', 'ब्लैक टी', 'cold drink', 'कोल्ड ड्रिंक', 'energy drink', 'एनर्जी ड्रिंक',
  // Snacks
  'namkeen', 'नमकीन', 'bhujia', 'भुजिया', 'sev', 'सेव', 'chakli', 'चकली', 'murukku', 'मुरुक्कु', 'mixture', 'मिक्चर', 'kurkure', 'कुर्कुरे', 'lays', 'लेज़', 'bingo', 'बिंगो',
  // Frozen & Ready-to-eat
  'frozen peas', 'फ्रोजन मटर', 'frozen corn', 'फ्रोजन कॉर्न', 'ready-to-eat meals', 'तैयार भोजन', 'instant noodles', 'इंस्टेंट नूडल्स', 'instant soup', 'इंस्टेंट सूप',
  // Bakery
  'bread', 'ब्रेड', 'bun', 'बन', 'cake', 'केक', 'pastry', 'पेस्ट्री', 'rusk', 'रस्क',
  // Condiments
  'ketchup', 'केचप', 'mayonnaise', 'मेयोनेज़', 'sauce', 'सॉस', 'pickle', 'अचार', 'jam', 'जैम', 'honey', 'शहद',
  // Others
  'ice cream', 'आइसक्रीम', 'chocolate', 'चॉकलेट', 'candy', 'कैंडी', 'mint', 'मिंट', 'mouth freshener', 'माउथ फ्रेशनर'  
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
console.log(`[${requestId}] Updating batch ${latestBatch.id} (purchased: ${latestBatch.fields.PurchaseDate}) with expiry date`);
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

// FIX: Improved greeting detection function
function detectGreetingLanguage(text) {
  const lowerText = text.toLowerCase();
  
  // Check for specific greeting words in each language
  const greetingPatterns = {
    'hi': ['नमस्ते', 'नमस्कार', 'हाय', 'हेलो'],
    'bn': ['নমস্কার', 'হ্যালো'],
    'ta': ['வணக்கம்'],
    'te': ['నమస్కారం', 'హలో'],
    'kn': ['ನಮಸ್ಕಾರ', 'ಹಲೋ'],
    'gu': ['નમસ્તે', 'હેલો'],
    'mr': ['नमस्कार', 'हॅलो'],
    'en': ['hello', 'hi', 'hey']
  };
  
  // Check each language's greeting patterns
  for (const [lang, greetings] of Object.entries(greetingPatterns)) {
    for (const greeting of greetings) {
      if (lowerText.includes(greeting)) {
        return lang;
      }
    }
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
    // Use improved greeting detection for greetings
    if (detectGreetingLanguage(text)) {
      const detectedLanguage = detectGreetingLanguage(text);
      console.log(`[${requestId}] Detected greeting language: ${detectedLanguage}`);
      return detectedLanguage;
    }
    // Fall back to AI detection for non-greetings
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
      await saveUserPreference(shopId, detectedLanguage);
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
      { languageCode: 'en-IN', name: 'English (India)' },
      { languageCode: 'hi-IN', name: 'Hindi' },
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

// Async processing for voice messages
async function processVoiceMessageAsync(MediaUrl0, From, requestId, conversationState) {
  try {
    console.log(`[${requestId}] [1] Downloading audio...`);
    const audioBuffer = await downloadAudio(MediaUrl0);
    console.log(`[${requestId}] [2] Converting audio...`);
    const flacBuffer = await convertToFLAC(audioBuffer);
    console.log(`[${requestId}] [3] Transcribing with Google STT...`);
    const transcriptionResult = await googleTranscribe(flacBuffer, requestId);
    const rawTranscript = transcriptionResult.transcript;
    const confidence = transcriptionResult.confidence;
    console.log(`[${requestId}] [4] Validating transcript...`);
    const cleanTranscript = await validateTranscript(rawTranscript, requestId);
    console.log(`[${requestId}] [5] Detecting language...`);
    const detectedLanguage = await checkAndUpdateLanguage(cleanTranscript, From, conversationState?.language, requestId);
    // Save user preference
    const shopId = From.replace('whatsapp:', '');
    await saveUserPreference(shopId, detectedLanguage);
    // Check if we're awaiting batch selection
    if (conversationState && conversationState.state === 'awaiting_batch_selection') {
      console.log(`[${requestId}] Awaiting batch selection response from voice`);
      // Check if the transcript contains batch selection keywords
      if (isBatchSelectionResponse(cleanTranscript)) {
        // Send follow-up message via Twilio API
        const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
        await client.messages.create({
          body: 'Processing your batch selection...',
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: From
        });
        await handleBatchSelectionResponse(cleanTranscript, From, new twilio.twiml.MessagingResponse(), requestId, conversationState.language);
        return;
      }
    }
    // Confidence-based confirmation
    const CONFIDENCE_THRESHOLD = 0.8;
    if (confidence < CONFIDENCE_THRESHOLD) {
      console.log(`[${requestId}] [5.5] Low confidence (${confidence}), requesting confirmation...`);
      // Send confirmation request via Twilio API
      const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
      const confirmationResponse = await confirmTranscript(cleanTranscript, From, detectedLanguage, requestId);
      // Extract just the message body from the TwiML
      let messageBody;
      try {
        const bodyMatch = confirmationResponse.match(/<Body>([^<]+)<\/Body>/);
        if (bodyMatch && bodyMatch[1]) {
          messageBody = bodyMatch[1];
        } else {
          // Fallback: If regex fails, try to get the message directly
          messageBody = confirmationResponse.toString();
          // Remove TwiML tags if present
          messageBody = messageBody.replace(/<[^>]*>/g, '').trim();
        }
      } catch (error) {
        console.error(`[${requestId}] Error extracting message body:`, error);
        messageBody = "Please confirm the transcription.";
      }
      await client.messages.create({
        body: messageBody,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: From
      });
    } else {
      console.log(`[${requestId}] [5.5] High confidence (${confidence}), proceeding without confirmation...`);
      // Parse the transcript
      const updates = await parseMultipleUpdates(cleanTranscript);
      // Check if any updates are for unknown products
      const unknownProducts = updates.filter(u => !u.isKnown);
      if (unknownProducts.length > 0) {
        console.log(`[${requestId}] Found ${unknownProducts.length} unknown products, requesting confirmation`);
        // Confirm the first unknown product via Twilio API
        const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
        const confirmationResponse = await confirmProduct(unknownProducts[0], From, detectedLanguage, requestId);
        // Extract just the message body from the TwiML
        let messageBody;
        try {
          const bodyMatch = confirmationResponse.match(/<Body>([^<]+)<\/Body>/);
          if (bodyMatch && bodyMatch[1]) {
            messageBody = bodyMatch[1];
          } else {
            // Fallback: If regex fails, try to get the message directly
            messageBody = confirmationResponse.toString();
            // Remove TwiML tags if present
            messageBody = messageBody.replace(/<[^>]*>/g, '').trim();
          }
        } catch (error) {
          console.error(`[${requestId}] Error extracting message body:`, error);
          messageBody = "Please confirm the product update.";
        }
        await client.messages.create({
          body: messageBody,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: From
        });
        return;
      }
      // Process the transcription and send result via Twilio API
      const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
      // Create a mock response object for processConfirmedTranscription
      const mockResponse = {
        message: (msg) => {
          // Extract just the message body from the TwiML
          let messageBody;
          try {
            const bodyMatch = msg.toString().match(/<Body>([^<]+)<\/Body>/);
            if (bodyMatch && bodyMatch[1]) {
              messageBody = bodyMatch[1];
            } else {
              // Fallback: If regex fails, try to get the message directly
              messageBody = msg.toString();
              // Remove TwiML tags if present
              messageBody = messageBody.replace(/<[^>]*>/g, '').trim();
            }
          } catch (error) {
            console.error(`[${requestId}] Error extracting message body:`, error);
            messageBody = "Processing complete.";
          }
          return client.messages.create({
            body: messageBody,
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: From
          });
        },
        toString: () => '<Response><Message>Processing complete</Message></Response>'
      };
      // Create a mock res object
      const mockRes = {
        send: () => {
          // This is a no-op since we're sending via API
          return Promise.resolve();
        }
      };
      await processConfirmedTranscription(
        cleanTranscript,
        From,
        detectedLanguage,
        requestId,
        mockResponse,
        mockRes
      );
    }
  } catch (error) {
    console.error(`[${requestId}] Error processing voice message:`, error);
    // Send error message via Twilio API
    const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
    await client.messages.create({
      body: 'Sorry, I had trouble processing your voice message. Please try again.',
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: From
    });
  }
}

// Async processing for text messages
async function processTextMessageAsync(Body, From, requestId, conversationState) {
  try {
    console.log(`[${requestId}] [1] Parsing text message: "${Body}"`);
    // Check for common greetings with improved detection
    const lowerBody = Body.toLowerCase();
    if (['1', '2', '3', '4'].includes(Body.trim())) {
  const pending = globalState.pendingProductUpdates[From];
  if (!pending) return;
  switch (Body.trim()) {
    case '1':
      await sendSystemMessage('Please type the correct product name.', From, pending.detectedLanguage, requestId, response);
      break;
    case '2':
      await sendSystemMessage('Please type the correct quantity and unit.', From, pending.detectedLanguage, requestId, response);
      break;
    case '3':
      await sendSystemMessage('Please specify if it was purchased, sold, or remaining.', From, pending.detectedLanguage, requestId, response);
      break;
    case '4':
      await sendSystemMessage('Please type the full update. Example: "Milk purchased - 5 litres"', From, pending.detectedLanguage, requestId, response);
      break;
  }
  return res.send(response.toString());
}

    let isGreeting = false;
    let greetingLang = 'en';
    // Use improved greeting detection
    const detectedGreetingLang = detectGreetingLanguage(Body);
    if (detectedGreetingLang) {
      // FIX: Only treat as greeting if it's primarily a greeting (short message)
      const words = Body.trim().split(/\s+/);
      if (words.length <= 3) {  // Only short messages are considered greetings
        isGreeting = true;
        greetingLang = detectedGreetingLang;
        console.log(`[${requestId}] Detected greeting in language: ${greetingLang}`);
        // Reset conversation state on greeting
        if (globalState.conversationState && globalState.conversationState[From]) {
          delete globalState.conversationState[From];
        }
        // Save user preference
        const shopId = From.replace('whatsapp:', '');
        await saveUserPreference(shopId, greetingLang);
        console.log(`[${requestId}] Saved language preference: ${greetingLang} for user ${shopId}`);
        // Get user preference
        let userPreference = 'voice'; // Default to voice
        if (globalState.userPreferences[From]) {
          userPreference = globalState.userPreferences[From];
          console.log(`[${requestId}] User preference: ${userPreference}`);
        }
        // Use predefined greeting messages to avoid translation API calls
        const greetingMessages = {
          'hi': `नमस्ते! मैं देखता हूं कि आप ${userPreference} द्वारा अपडेट भेजना पसंद करते हैं। आज मैं आपकी कैसे मदद कर सकता हूं?\n\nNamaste! Main dekhta hoon ki aap ${userPreference} dwara update bhejna pasand karte hain. Aaj main aapki kaise madad kar sakta hoon?`,
          'bn': `হ্যালো! আমি দেখতে পাচ্ছি আপনি ${userPreference} দিয়ে আপডেট পাঠাতে পছন্দ করেন। আজ আমি আপনাকে কিভাবে সাহায্য করতে পারি?\n\nHello! Ami dekhte pachchi apni ${userPreference} diye update pathate pochondo koren. Aaj ami apnake kivabe sahaj korte pari?`,
          'ta': `வணக்கம்! நான் பார்க்கிறேன் நீங்கள் ${userPreference} மூலம் புதுப்பிப்புகளை அனுப்புவதை விரும்புகிறீர்கள். இன்று நான் உங்களுக்கு எப்படி உதவ முடியும்?\n\nVanakkam! Naan paarkiren neengal ${userPreference} mulam puthippugalai anupuvathai virumbukireergal. Indru naan ungaluku eppadi utha mudiyum?`,
          'te': `నమస్కారం! నేను చూస్తున్నాను మీరు ${userPreference} ద్వారా నవీకరణలను పంపించడాన్ని ఇష్టపడతారు. నేడు నేను మీకు ఎలా సహాయపడగలను?\n\nNamaskaram! Nenu chustunnanu miru ${userPreference} dwara naveekaralanu pampinchadanni istapadaru. Nedu nenu meeku ela saahayapadagalanu?`,
          'kn': `ನಮಸ್ಕಾರ! ನಾನು ನೋಡುತ್ತಿದ್ದೇನೆ ನೀವು ${userPreference} ಮೂಲಕ ನವೀಕರಣಗಳನ್ನು ಕಳುಹಿಸಲು ಇಷ್ಟಪಡುತ್ತೀರಿ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?\n\nNamaskara! Nanu noduttiddene neevu ${userPreference} moolaka naveekaragannannu kelisu baaasuttiri. Indu nanu nimage hege saahya madabahudu?`,
          'gu': `નમસ્તે! હું જોઉં છું કે તમે ${userPreference} દ્વારા અપડેટ્સ મોકલવાનું પસંદ કરો છો. આજે હું તમને કેવી રીતે મદદ કરી શકું?\n\nNamaste! Hu joo chu ke tame ${userPreference} dwara apdets moklavanu pasand karo cho. Aje hu tamne kavi rite madad kar shakum?`,
          'mr': `नमस्कार! मी पाहतो आपण ${userPreference} द्वारे अपडेट्स पाठवायला पसंत करता. आज मी तुम्हाला कशी मदत करू शकतो?\n\nNamaskar! Mi pahato aapan ${userPreference} dware apdets pathavayala pasant karta. Aaj mi tumhala kashi madad karu shakto?`,
          'en': `Hello! I see you prefer to send updates by ${userPreference}. How can I help you today?`
        };
        if (userPreference !== 'voice') {
          const greetingMessage = greetingMessages[greetingLang] || greetingMessages['en'];
          // Send via Twilio API
          const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
          await client.messages.create({
            body: greetingMessage,
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: From
          });
          return;
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
        // Send via Twilio API
        const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
        await client.messages.create({
          body: welcomeMessage,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: From
        });
        return;
      }
    }
    // Check if we're awaiting batch selection
    if (conversationState && conversationState.state === 'awaiting_batch_selection') {
      console.log(`[${requestId}] Awaiting batch selection response`);
      if (isBatchSelectionResponse(Body)) {
        await handleBatchSelectionResponse(Body, From, new twilio.twiml.MessagingResponse(), requestId, conversationState.language);
        return;
      } else if (isExpiryDateUpdate(Body)) {
        await handleExpiryDateUpdate(Body, From, new twilio.twiml.MessagingResponse(), requestId, conversationState.language);
        return;
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
        // Send via Twilio API
        const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
        // Extract message body with error handling
        let messageBody;
        try {
          const bodyMatch = confirmationResponse.match(/<Body>([^<]+)<\/Body>/);
          if (bodyMatch && bodyMatch[1]) {
            messageBody = bodyMatch[1];
          } else {
            // Fallback: If regex fails, try to get the message directly
            messageBody = confirmationResponse.toString();
            // Remove TwiML tags if present
            messageBody = messageBody.replace(/<[^>]*>/g, '').trim();
          }
        } catch (error) {
          console.error(`[${requestId}] Error extracting message body:`, error);
          messageBody = "Please confirm the product update.";
        }
        await client.messages.create({
          body: messageBody,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: From
        });
        return;
      }
      // Create a mock response object for processConfirmedTranscription
      const mockResponse = {
        message: (msg) => {
          // Extract just the message body from the TwiML
          let messageBody;
          try {
            const bodyMatch = msg.toString().match(/<Body>([^<]+)<\/Body>/);
            if (bodyMatch && bodyMatch[1]) {
              messageBody = bodyMatch[1];
            } else {
              // Fallback: If regex fails, try to get the message directly
              messageBody = msg.toString();
              // Remove TwiML tags if present
              messageBody = messageBody.replace(/<[^>]*>/g, '').trim();
            }
          } catch (error) {
            console.error(`[${requestId}] Error extracting message body:`, error);
            messageBody = "Processing complete.";
          }
          return sendMessageViaAPI(From, messageBody);
        },
        toString: () => '<Response><Message>Processing complete</Message></Response>'
      };
      // Create a mock res object
      const mockRes = {
        send: () => {
          // This is a no-op since we're sending via API
          return Promise.resolve();
        }
      };
      await processConfirmedTranscription(
        Body,
        From,
        detectedLanguage,
        requestId,
        mockResponse,
        mockRes
      );
    } else {
      console.log(`[${requestId}] Not a valid inventory update, checking for specialized operations`);
      // Get user preference
      let userPreference = 'voice'; // Default to voice
      if (globalState.userPreferences[From]) {
        userPreference = globalState.userPreferences[From];
        console.log(`[${requestId}] User preference: ${userPreference}`);
      }
      const defaultMessage = userPreference === 'voice'
        ? '🎤 Send inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.\n\nTo switch to text input, reply "switch to text".'
        : '📝 Type your inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.\n\nTo switch to voice input, reply "switch to voice".';
      const translatedMessage = await generateMultiLanguageResponse(defaultMessage, detectedLanguage, requestId);
      // Send via Twilio API
      await sendMessageViaAPI(From, translatedMessage);
    }
  } catch (error) {
    console.error(`[${requestId}] Error processing text message:`, error);
    // Send error message via Twilio API
    const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
    await client.messages.create({
      body: 'Sorry, I had trouble processing your message. Please try again.',
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: From
    });
  }
}

// Main module exports
module.exports = async (req, res) => {
  const requestStart = Date.now();
  const response = new twilio.twiml.MessagingResponse();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  try {
    // Add request ID to the request object for logging
    req.requestId = requestId;
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
          detectedLanguage, // Use the preserved language
          requestId
        );
        response.message(voiceMessage);
      } else if (ButtonText === 'Text Message' || ButtonText === 'text_input') {
        globalState.userPreferences[From] = 'text';
        const textMessage = await generateMultiLanguageResponse(
          '📝 Please type your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage, // Use the preserved language
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
          detectedLanguage, // Use the preserved language
          requestId
        );
        response.message(voiceMessage);
      } else if (Body === '2' || Body.toLowerCase() === 'text') {
        globalState.userPreferences[From] = 'text';
        const textMessage = await generateMultiLanguageResponse(
          '📝 Please type your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage, // Use the preserved language
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
        const yesVariants = ['yes', 'haan', 'हाँ', 'ha', 'ok', 'okay'];
const noVariants = ['no', 'nahin', 'नहीं', 'nahi', 'cancel'];
 
const lowerBody = Body.toLowerCase();
 
if (yesVariants.includes(lowerBody)) {
  // confirm
} else if (noVariants.includes(lowerBody)) {
  // reject
} else {
  // fallback to AI
const aiResponse = await axios.post('https://api.deepseek.com/v1/chat/completions', {
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "Is the following message a confirmation (yes) or rejection (no)? Reply only with 'yes' or 'no'." },
      { role: "user", content: Body }
    ],
    max_tokens: 5,
    temperature: 0.1
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 5000
  });
 
  const aiAnswer = aiResponse.data.choices[0].message.content.trim().toLowerCase();
  if (aiAnswer === 'yes') {
    // confirm
  } else if (aiAnswer === 'no') {
    // reject
  }
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
              // Format based on action type
              if (result.action === 'purchased') {
                message += `• ${result.product}: ${result.quantity} ${unitText} purchased (Stock: ${result.newQuantity}${unitText})\n`;
                if (result.batchDate) {
                  message += ` Batch added: ${formatDateForDisplay(result.batchDate)}\n`;
                }
              } else if (result.action === 'sold') {
                message += `• ${result.product}: ${Math.abs(result.quantity)} ${unitText} sold (Stock: ${result.newQuantity}${unitText})\n`;
                hasSales = true;
              } else if (result.action === 'remaining') {
                message += `• ${result.product}: ${result.quantity} ${unitText} remaining (Stock: ${result.newQuantity}${unitText})\n`;
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
      // Send immediate response and process asynchronously
      response.message('Processing your message...');
      res.send(response.toString());
      // Process text asynchronously
      processTextMessageAsync(Body, From, requestId, conversationState)
        .catch(error => {
          console.error(`[${requestId}] Error in async text processing:`, error);
        });
      trackResponseTime(requestStart, requestId);
      return;
    }
    // Handle voice messages
    if (NumMedia && MediaUrl0 && (NumMedia !== '0' && NumMedia !== 0)) {
      // Send immediate response
      response.message('Processing your voice message...');
      res.send(response.toString());
      // Process audio asynchronously
      processVoiceMessageAsync(MediaUrl0, From, requestId, conversationState)
        .catch(error => {
          console.error(`[${requestId}] Error in async voice processing:`, error);
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
