const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const { execSync } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const crypto = require('crypto');
const authCache = new Map();
const { processShopSummary } = require('../dailySummary');
const { generateInvoicePDF } = require('../pdfGenerator');
const { getShopDetails } = require('../database');
const TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS || 25000);
const languageNames = {
  'hi': 'Hindi',
  'bn': 'Bengali',
  'ta': 'Tamil',
  'te': 'Telugu',
  'kn': 'Kannada',
  'gu': 'Gujarati',
  'mr': 'Marathi',
  'en': 'English'
};

// Add this near the top of whatsapp.js
const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME;
const isServerless = isRailway || process.env.VERCEL || process.env.NETLIFY;
console.log('Environment detection:', {
  isRailway: !!isRailway,
  isServerless: !!isServerless,
  nodeVersion: process.version,
  platform: process.platform
});
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
  updateBatchQuantityByCompositeKey,
  savePendingTranscription,    // Add this
  getPendingTranscription,     // Add this
  deletePendingTranscription,
  saveCorrectionState,    // Add this
  getCorrectionState,     // Add this
  deleteCorrectionState,
  saveUserStateToDB,
  getUserStateFromDB,
  deleteUserStateFromDB,
  isUserAuthorized,
  deactivateUser,
  getTodaySalesSummary,
  getInventorySummary,
  getLowStockProducts,
  getExpiringProducts,
  getSalesDataForPeriod,
  getPurchaseDataForPeriod,
  getAllShopIDs,
  upsertProduct,
  getProductPrice,
  getAllProducts,
  updateProductPrice,
  getProductsNeedingPriceUpdate,
  getTranslationEntry,
  upsertTranslationEntry,
  getProductInventory,
  getStockoutItems,
  getBatchesForProductWithRemaining,
  getSalesSummaryPeriod,
  getTopSellingProductsForPeriod,
  getReorderSuggestions,
  getCurrentInventory
} = require('../database');

// Add this at the top of the file after the imports
const path = require('path');
const SUMMARY_TRACK_FILE = path.join(__dirname, 'summary_tracker.json');

// Add this function to track daily summaries
function updateSummaryTracker(shopId, date) {
  try {
    let tracker = {};
    
    // Read existing tracker if it exists
    if (fs.existsSync(SUMMARY_TRACK_FILE)) {
      const data = fs.readFileSync(SUMMARY_TRACK_FILE, 'utf8');
      tracker = JSON.parse(data);
    }
    
    // Update tracker
    tracker[shopId] = date;
    
    // Write back to file
    fs.writeFileSync(SUMMARY_TRACK_FILE, JSON.stringify(tracker, null, 2));
    
    return true;
  } catch (error) {
    console.error('Error updating summary tracker:', error.message);
    return false;
  }
}

// Add this function to check if summary was already sent
function wasSummarySent(shopId, date) {
  try {
    if (!fs.existsSync(SUMMARY_TRACK_FILE)) {
      return false;
    }
    
    const data = fs.readFileSync(SUMMARY_TRACK_FILE, 'utf8');
    const tracker = JSON.parse(data);
    
    return tracker[shopId] === date;
  } catch (error) {
    console.error('Error checking summary tracker:', error.message);
    return false;
  }
}

// Add this function to send daily summaries
async function sendDailySummaries() {
  try {
    console.log('Starting daily summary job...');
    
    // Get all shop IDs
    const shopIds = await getAllShopIDs();
    console.log(`Found ${shopIds.length} shops to process`);
    
    if (shopIds.length === 0) {
      console.log('No shops found to process');
      return;
    }
    
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    // Process shops with concurrency limit
    const concurrencyLimit = 5;
    const results = [];
    
    for (let i = 0; i < shopIds.length; i += concurrencyLimit) {
      const batch = shopIds.slice(i, i + concurrencyLimit);
      console.log(`Processing batch of ${batch.length} shops (${i + 1}-${i + batch.length} of ${shopIds.length})`);
      
      const batchPromises = batch.map(async (shopId) => {
        try {
          // Check if summary was already sent today
          if (wasSummarySent(shopId, dateStr)) {
            console.log(`Summary already sent for shop ${shopId} today`);
            return { shopId, success: true, skipped: true };
          }
          
          // Get user's preferred language
          let userLanguage = 'en';
          try {
            const userPref = await getUserPreference(shopId);
            if (userPref.success) {
              userLanguage = userPref.language;
            }
          } catch (error) {
            console.warn(`Failed to get user preference for shop ${shopId}:`, error.message);
          }
          
          // Use processShopSummary from dailySummary.js
          const result = await processShopSummary(shopId);
          
          // Update tracker if successful
          if (result.success) {
            updateSummaryTracker(shopId, dateStr);
          }
          
          return result;
          
        } catch (error) {
          console.error(`Error processing shop ${shopId}:`, error.message);
          return { shopId, success: false, error: error.message };
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error('Unexpected error in batch processing:', result.reason);
        }
      }
      
      // Add a small delay between batches to avoid rate limiting
      if (i + concurrencyLimit < shopIds.length) {
        console.log('Pausing between batches to avoid rate limiting...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Calculate success statistics
    const successCount = results.filter(r => r.success && !r.skipped).length;
    const skippedCount = results.filter(r => r.skipped).length;
    const failureCount = results.filter(r => !r.success).length;
    
    console.log(`Daily summary job completed: ${successCount} sent, ${skippedCount} skipped, ${failureCount} failed`);
    
    return results;
  } catch (error) {
    console.error('Error in daily summary job:', error.message);
    throw error;
  }
}

// Schedule daily summary at 11 PM
function scheduleDailySummary() {
    const now = new Date();
    const targetTime = new Date();
    
    // Set to 11 PM IST (17:30 UTC)
    targetTime.setUTCHours(17, 30, 0, 0);
    
    // If we've passed 17:30 UTC today, schedule for tomorrow
    if (now > targetTime) {
        targetTime.setUTCDate(targetTime.getUTCDate() + 1);
    }
    
    const msUntilTarget = targetTime - now;
    
    console.log(`Scheduling daily summary for ${targetTime.toISOString()} (in ${msUntilTarget}ms)`);
    
    setTimeout(() => {
        sendDailySummaries()
            .then(() => {
                // Schedule for next day
                scheduleDailySummary();
            })
            .catch(error => {
                console.error('Daily summary job failed:', error.message);
                // Retry in 1 hour
                setTimeout(scheduleDailySummary, 60 * 60 * 1000);
            });
    }, msUntilTarget);
}

// Start the scheduler when the module loads
scheduleDailySummary();

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
// Cache key prefix for command normalization (any-language -> English)
const COMMAND_NORM_PREFIX = 'cmdnorm:';


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

// State management constants and functions
const STATE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const RESET_COMMANDS = ['reset', 'start over', 'restart', 'cancel', 'exit', 'stop'];

async function getUserState(from) {
  const shopId = from.replace('whatsapp:', '');
  const state = await getUserStateFromDB(shopId);
  return state;
}

async function setUserState(from, mode, data = {}) {
  const shopId = from.replace('whatsapp:', '');
  const result = await saveUserStateToDB(shopId, mode, data);
  if (result.success) {
    console.log(`[State] Set state for ${from}: ${mode}`);
  } else {
    console.error(`[State] Failed to set state for ${from}: ${result.error}`);
  }
}

async function clearUserState(from) {
  const shopId = from.replace('whatsapp:', '');
  const state = await getUserStateFromDB(shopId);
  if (state && state.id) {
    await deleteUserStateFromDB(state.id);
    console.log(`[State] Cleared state for ${from}`);
  }
}

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
        // Convert to IST (UTC+5:30)
        const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
        const istTime = new Date(date.getTime() + istOffset);
        
        const day = istTime.getUTCDate().toString().padStart(2, '0');
        const month = (istTime.getUTCMonth() + 1).toString().padStart(2, '0');
        const year = istTime.getUTCFullYear();
        const hours = istTime.getUTCHours().toString().padStart(2, '0');
        const minutes = istTime.getUTCMinutes().toString().padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }
    if (typeof date === 'string') {
        if (date.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
            // ISO format with time
            const parsedDate = new Date(date);
            return formatDateForDisplay(parsedDate);
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


// -------- Any-language -> English command normalizer --------
/**
 * normalizeCommandText
 *  - Input: user message in ANY language that likely represents one of the 8 quick commands
 *  - Output: an ENGLISH command phrase that matches your router regexes
 *    Examples:
 *      "आज की बिक्री"         -> "sales today"
 *      "Maggi का stock?"      -> "stock Maggi"
 *      "இந்த வார விற்பனை"     -> "sales week"
 *      "expiring कितने दिन?"  -> "expiring 30" (defaults to 30 if none given)
 *  - Guarantees: keeps BRAND/PRODUCT names and NUMBERS as-is, no quotes, one line.
 */
async function normalizeCommandText(text, detectedLanguage = 'en', requestId = 'cmd-norm') {
  try {
    if (!text || !text.trim()) return text;
    const lang = (detectedLanguage || 'en').toLowerCase();
    // If English already, no need to normalize
    if (lang === 'en') return text.trim();

    const raw = text.trim();
    // Cache check
    const keyHash = crypto.createHash('sha1').update(`${lang}::${raw}`).digest('hex');
    const cacheKey = `${COMMAND_NORM_PREFIX}${lang}:${keyHash}`;
    const cached = languageCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < LANGUAGE_CACHE_TTL)) {
      console.log(`[${requestId}] Using cached command normalization (${lang})`);
      return cached.value;
    }

    const systemPrompt = [
      'You rewrite user commands about inventory into ENGLISH one-line commands for a WhatsApp bot.',
      'STRICT RULES:',
      '- KEEP brand/product names EXACTLY as user wrote them (do NOT translate brand names).',
      '- KEEP numbers as digits.',
      '- Map intents to these exact keywords:',
      '  • "stock <product>" (aka "inventory <product>" or "qty <product>")',
      '  • "low stock" or "stockout"',
      '  • "batches <product>" or "expiry <product>"',
      '  • "expiring <days>" (default to 30 if days not specified)',
      '  • "sales today|week|month"',
      '  • "top <N> products [today|week|month]" (default N=5, period=month if missing)',
      '  • "reorder" (or "reorder suggestions")',
      '  • "inventory value" (aka "stock value" or "value summary")',    
      '  • "products [<page>]" or "list products [<page>]"',
      '  • "products search <term>" or "search products <term>"',
      'Output ONLY the rewritten English command, no quotes, no extra words.'
    ].join(' ');

    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: raw }
        ],
        temperature: 0.1,
        max_tokens: 120
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    let normalized = (response.data?.choices?.[0]?.message?.content || '').trim();
    // Safety: strip code fences/quotes if model adds them
    if (normalized.startsWith('```')) normalized = normalized.replace(/^```(?:\w+)?\s*/i, '').replace(/```$/i, '').trim();
    normalized = normalized.replace(/^"(.*)"$/, '$1').trim();
    if (!normalized) return text;

    // Cache & return
    languageCache.set(cacheKey, { value: normalized, timestamp: Date.now() });
    console.log(`[${requestId}] Normalized: "${raw}" (${lang}) -> "${normalized}"`);
    return normalized;
  } catch (err) {
    console.warn(`[${requestId}] Command normalization failed:`, err?.message);
    // Gracefully fallback to original text if the API is unavailable
    return text;
  }
}


// ---------------- QUICK-QUERY ROUTER (English-only hotfix) ----------------
function _periodWindow(period) {
  const now = new Date();
  const p = (period || '').toLowerCase();
  if (p === 'today' || p === 'day') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { start, end, label: 'today' };
  }
  if (p.includes('week')) {
    const start = new Date(now); start.setDate(now.getDate() - 7);
    return { start, end: now, label: 'week' };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start, end: now, label: 'month' };
}

function _norm(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9\s]/g,'').trim(); }

async function handleQuickQueryEN(rawBody, From, detectedLanguage, requestId) {
  const text = String(rawBody || '').trim();
  const shopId = From.replace('whatsapp:', '');


// 0) Inventory value (BEFORE any "stock <product>" matching)
    // Accepts: "inventory value", "stock value", "value summary",
    //          "total/overall/grand/gross inventory|stock value|valuation"
    if (/^\s*(?:(?:(?:total|overall|grand(?:\s*total)?|gross)\s+)?(?:inventory|stock)\s*(?:value|valuation)|value\s*summary)\s*$/i.test(text)) {
    const inv = await getInventorySummary(shopId);
    let message = `📦 Inventory Summary:\n• Unique products: ${inv.totalProducts}\n• Total value: ₹${(inv.totalValue ?? 0).toFixed(2)}`;
    if ((inv.totalPurchaseValue ?? 0) > 0) message += `\n• Total cost: ₹${inv.totalPurchaseValue.toFixed(2)}`;
    if ((inv.topCategories ?? []).length > 0) {
      message += `\n\n📁 By Category:\n` +
        inv.topCategories.map((c,i)=>`${i+1}. ${c.name}: ₹${c.value.toFixed(2)} (${c.productCount} items)`).join('\n');
    }
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }


// 0.5) List products (with optional page or search)
  //   - "products" | "list products"           => page 1
  //   - "products 2" | "list products 2"       => page 2
  //   - "products page 3"                      => page 3
  //   - "products search maggi"                => search
  //   - "search products maggi"                => search
  let pm = text.match(/^\s*(?:products|list\s+products)(?:\s+(?:page\s+)?(\d+))?\s*$/i);
  let sm = text.match(/^\s*(?:products\s+search|search\s+products)\s+(.+)\s*$/i);
  if (pm || sm) {
    const PAGE_SIZE = 25;
    const page = pm ? Math.max(1, parseInt(pm[1] || '1', 10)) : 1;
    const query = sm ? sm[1].trim() : '';
    // Fetch inventory for this shop
    const list = await getCurrentInventory(shopId);
    // Build unique items map (use last non-empty qty/unit)
    const map = new Map();
    for (const r of list) {
      const name = r?.fields?.Product?.trim();
      if (!name) continue;
      const qty  = r?.fields?.Quantity ?? 0;
      const unit = r?.fields?.Units || 'pieces';
      map.set(name.toLowerCase(), { name, qty, unit });
    }
    let items = Array.from(map.values());
    // Optional search
    if (query) {
      const q = query.toLowerCase();
      items = items.filter(x => x.name.toLowerCase().includes(q));
    }
    // Sort: by name (case-insensitive)
    items.sort((a,b) => a.name.localeCompare(b.name, undefined, {sensitivity:'base'}));
    // Paging
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const pageSafe = Math.min(page, totalPages);
    const start = (pageSafe - 1) * PAGE_SIZE;
    const pageItems = items.slice(start, start + PAGE_SIZE);
    // Build message
    let header = query
      ? `🧾 Products matching “${query}” — ${pageItems.length} of ${total}`
      : `🧾 Products — Page ${pageSafe}/${totalPages} — ${pageItems.length} of ${total}`;
    if (total === 0) {
      const msg0 = await generateMultiLanguageResponse(`${header}\nNo products found.`, detectedLanguage, requestId);
      await sendMessageViaAPI(From, msg0);
      return true;
    }
    const lines = pageItems.map(p => `• ${p.name} — ${p.qty} ${p.unit}`);
    let message = `${header}\n\n${lines.join('\n')}`;
    if (!query && pageSafe < totalPages) {
      message += `\n\n➡️ Next page: "products ${pageSafe+1}"`;
    } else if (query && pageSafe < totalPages) {
      message += `\n\n➡️ Next page: "products ${pageSafe+1}" (repeat the search term)`;
    }
    message += `\n🔎 Search: "products search <term>"`;
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  
// 1) Stock for product
  // Guard: don't let "inventory value/valuation/value summary" slip into stock branch
  let m = text.match(/^(?:stock|inventory|qty)\s+(?!value\b|valuation\b|summary\b)(.+)$/i);

  if (m) {
    // Clean tail punctuation like "?", "!" etc.
    const rawQuery = m[1].trim().replace(/[?।。.!,;:\u0964\u0965]+$/u, '');
    const product = await translateProductName(rawQuery, requestId + ':qq-stock');

    // --- Precise DB lookup first (preferred) ---
    try {
      const exact = await getProductInventory(shopId, product);
      if (exact?.success) {
        const qty  = exact.quantity ?? 0;
        const unit = exact.unit || 'pieces';
        const message = `📦 Stock — ${product}: ${qty} ${unit}`;
        const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
        await sendMessageViaAPI(From, msg);
        return true;
      }
    } catch (e) {
      console.warn(`[${requestId}] getProductInventory failed:`, e?.message);
    }

    // --- Fallback: fuzzy scan of full inventory (only if available) ---
    try {
      const list = await getCurrentInventory(shopId);
      const qN = _norm(product);
      let best = null, bestScore = 0;
      for (const r of list) {
        const name = r?.fields?.Product;
        if (!name) continue; // ignore blank names to avoid "undefined"
        const n = _norm(name);
        if (!n || !qN) continue;
        let score = 0;
        if (n === qN) score = 3;                                   // exact
        else if (n.includes(qN) || qN.includes(n)) score = 2;      // substring
        else {
          const qw = qN.split(/\s+/).filter(w => w.length > 2);
          const nw = n.split(/\s+/).filter(w => w.length > 2);
          const overlap = qw.filter(w => nw.includes(w)).length;
          if (overlap > 0) score = 1;                              // token overlap
        }
        if (score > bestScore) { bestScore = score; best = r; }
      }
      let message;
      if (!best) {
        message = `📦 ${rawQuery}: not found in inventory.`;
      } else {
        const qty  = best?.fields?.Quantity ?? 0;
        const unit = best?.fields?.Units || 'pieces';
        const name = best?.fields?.Product || product;
        message = `📦 Stock — ${name}: ${qty} ${unit}`;
      }
      const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
      await sendMessageViaAPI(From, msg);
      return true;
    } catch (e) {
      console.warn(`[${requestId}] Fallback list scan failed:`, e?.message);
      const msg = await generateMultiLanguageResponse(
        `📦 ${rawQuery}: not found in inventory.`,
        detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, msg);
      return true;
    }
  }


  // 2) Low stock / Stockout
  if (/^(?:low\s*stock|stockout|out\s*of\s*stock)$/i.test(text)) {
    const low = await getLowStockProducts(shopId, 5);
    const all = await getCurrentInventory(shopId);
    const out = all.filter(r => (r.fields.Quantity ?? 0) <= 0).map(r => ({
      name: r.fields.Product, unit: r.fields.Units || 'pieces'
    }));
    let message = `⚠️ Low & Stockout:\n`;
    if (low.length === 0 && out.length === 0) message += `Everything looks good.`;
    else {
      if (low.length) message += `\nLow stock (≤5):\n` + low.map(p=>`• ${p.name}: ${p.quantity} ${p.unit}`).join('\n');
      if (out.length) message += `\n\nOut of stock:\n` + out.map(p=>`• ${p.name}`).join('\n');
      message += `\n\n💡 Advice: Prioritize ordering low-stock items first.`;
    }
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  
// 3) Batches for product (purchase & expiry)
  m = text.match(/^(?:batches?|expiry)\s+(.+)$/i);
  if (m) {
   const rawQuery = m[1].trim().replace(/[?।。.!,;:\u0964\u0965]+$/u, '');
    const product = await translateProductName(rawQuery, requestId + ':qq-batches');

    // --- Exact helper first ---
    try {
      // Prefer the helper that returns only remaining batches for a product
      const exact = await getBatchesForProductWithRemaining(shopId, product);
      if (Array.isArray(exact) && exact.length > 0) {
        const lines = exact.map(b => {
          const q  = b.quantity ?? b.fields?.Quantity ?? 0;
          const u  = b.unit || b.fields?.Units || 'pieces';
          const pd = b.purchaseDate || b.fields?.PurchaseDate || null;
          const ed = b.expiryDate   || b.fields?.ExpiryDate   || null;
          return `• ${q} ${u} | Bought: ${formatDateForDisplay(pd || '—')} | Expiry: ${formatDateForDisplay(ed || '—')}`;
        }).join('\n');
        let message = `📦 Batches — ${product}:\n${lines}`;
        const soon = exact.filter(b => (b.expiryDate || b.fields?.ExpiryDate) &&
                        daysBetween(new Date(b.expiryDate || b.fields?.ExpiryDate), new Date()) <= 7);
        if (soon.length) message += `\n\n💡 ${soon.length} batch(es) expiring ≤7 days — clear with FIFO/discounts.`;
        const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
        await sendMessageViaAPI(From, msg);
        return true;
      }
    } catch (e) {
      console.warn(`[${requestId}] getBatchesForProductWithRemaining failed:`, e?.message);
    }

    // --- Safe fuzzy fallback ---
    try {
      const all = await getBatchRecords(shopId, product);
      // Filter valid product-named records; group by product to pick a best match
      const valid = all.filter(b => !!b?.fields?.Product && (b.fields.Quantity ?? 0) > 0);
      const qN = _norm(product);
      const scored = valid.map(b => {
        const n = _norm(b.fields.Product);
        let score = 0;
        if (n === qN) score = 3;
        else if (n.includes(qN) || qN.includes(n)) score = 2;
        else {
          const qw = qN.split(/\s+/).filter(w => w.length > 2);
          const nw = n.split(/\s+/).filter(w => w.length > 2);
          const overlap = qw.filter(w => nw.includes(w)).length;
          if (overlap > 0) score = 1;
        }
        return { score, rec: b };
      }).sort((a,b) => b.score - a.score);

      const topName = scored.length ? scored[0].rec.fields.Product : null;
      const active = valid.filter(b => b.fields.Product === topName);
      let message;
      if (!active.length) {
        message = `📦 No active batches found for ${rawQuery}.`;
      } else {
        const lines = active.map(b => {
          const q  = b.fields.Quantity ?? 0;
          const u  = b.fields.Units || 'pieces';
          const pd = b.fields.PurchaseDate ? formatDateForDisplay(b.fields.PurchaseDate) : '—';
          const ed = b.fields.ExpiryDate   ? formatDateForDisplay(b.fields.ExpiryDate)   : '—';
          return `• ${q} ${u} | Bought: ${pd} | Expiry: ${ed}`;
        }).join('\n');
        message = `📦 Batches — ${topName || product}:\n${lines}`;
        const soon = active.filter(b => b.fields.ExpiryDate && daysBetween(new Date(b.fields.ExpiryDate), new Date()) <= 7);
        if (soon.length) message += `\n\n💡 ${soon.length} batch(es) expiring ≤7 days — clear with FIFO/discounts.`;
      }
      const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
      await sendMessageViaAPI(From, msg);
      return true;
    } catch (e) {
      console.warn(`[${requestId}] Fallback batches scan failed:`, e?.message);
      const msg = await generateMultiLanguageResponse(
        `📦 No active batches found for ${rawQuery}.`,
        detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, msg);
      return true;
    }
  }

  // 4) Expiring soon
  m = text.match(/^expiring(?:\s+(\d+))?$/i);
  if (m) {
    const days = m[1] ? Math.max(1, parseInt(m[1],10)) : 30;
    const exp = await getExpiringProducts(shopId, days);
    let message = `⏰ Expiring in next ${days} day(s):\n`;
    if (!exp.length) message += `No items found.`;
    else {
      message += exp.map(p=>`• ${p.name}: ${formatDateForDisplay(p.expiryDate)} (qty ${p.quantity})`).join('\n');
      message += `\n\n💡 Move to eye‑level, bundle, or mark‑down 5–15%.`;
    }
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  // 5) Sales (today|week|month)
  m = text.match(/^sales\s+(today|this\s*week|week|this\s*month|month)$/i);
  if (m) {
    const { start, end, label } = _periodWindow(m[1]);
    const data = await getSalesDataForPeriod(shopId, start, end);
    let message = `💰 Sales (${label}): ${data.totalItems ?? 0} items`;
    if ((data.totalValue ?? 0) > 0) message += ` (₹${(data.totalValue).toFixed(2)})`;
    if ((data.topProducts ?? []).length > 0) {
      message += `\n\n🏷️ Top Sellers:\n` + data.topProducts.slice(0,5).map(p=>`• ${p.name}: ${p.quantity} ${p.unit}`).join('\n');
    }
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  // 6) Top N products
  m = text.match(/^top\s*(\d+)?\s*products?(?:\s*(today|week|month|this\s*week|this\s*month))?$/i);
  if (m) {
    const n = m[1] ? Math.max(1, parseInt(m[1],10)) : 5;
    const { start, end, label } = _periodWindow(m[2] || 'month');
    const data = await getSalesDataForPeriod(shopId, start, end);
    const top = (data.topProducts || []).slice(0, n);
    let message = `🏆 Top ${n} (${label}):\n`;
    message += top.length ? top.map((p,i)=>`${i+1}. ${p.name}: ${p.quantity} ${p.unit}`).join('\n') : 'No sales data.';
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  // 7) Reorder suggestions (simple velocity heuristic)
  if (/^reorder(\s+suggestions?)?$|^what\s+should\s+i\s+reorder$/i.test(text)) {
    // last 30 days sales velocity
    const now = new Date(); const start = new Date(now); start.setDate(now.getDate()-30);
    const sales = await getSalesDataForPeriod(shopId, start, now);
    const inv = await getCurrentInventory(shopId);
    const soldMap = new Map();
    for (const r of (sales.records || [])) {
      const p = r.fields.Product; const q = Math.abs(r.fields.Quantity ?? 0);
      if (!p) continue; soldMap.set(p, (soldMap.get(p)||0)+q);
    }
    const days = 30, lead=3, safety=2;
    const suggestions = [];
    for (const r of inv) {
      const name = r.fields.Product; const unit = r.fields.Units || 'pieces';
      const current = r.fields.Quantity ?? 0; const sold = soldMap.get(name) || 0;
      const daily = sold/days;
      const coverNeeded = (lead+safety)*daily;
      const reorderQty = Math.max(0, Math.ceil(coverNeeded - current));
      if (reorderQty > 0) suggestions.push({name, unit, current, daily: Number(daily.toFixed(2)), reorderQty});
    }
    suggestions.sort((a,b)=> (b.reorderQty-a.reorderQty) || (b.daily-a.daily));
    let message = `📋 Reorder Suggestions (30d, lead ${lead}d + safety ${safety}d):\n`;
    message += suggestions.length
      ? suggestions.slice(0,10).map(s=>`• ${s.name}: stock ${s.current} ${s.unit}, ~${s.daily}/day → reorder ~${s.reorderQty} ${singularize(s.unit)}`).join('\n')
      : 'No urgent reorders detected.';
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  return false; // not a quick query
}

// -------- NEW: Quick-query command handlers (8 core queries) --------

function parsePeriodKeyword(txt) {
  const t = (txt || '').toLowerCase().trim();
  if (t.includes('today') || t === 'day') return 'day';
  if (t.includes('week')) return 'week';
  return 'month'; // default
}

async function handleQueryCommand(Body, From, detectedLanguage, requestId) {
  const text = Body.trim();
  const shopId = From.replace('whatsapp:', '');

  // 1) Inventory remaining for a specific product (+ advice)
  const stockMatch = text.match(/^(?:stock|inventory|qty)\s+(.+)$/i);
  if (stockMatch) {
    const raw = stockMatch[1].trim();
    const product = await translateProductName(raw, requestId + ':stock');
    const inv = await getProductInventory(shopId, product);
    if (!inv.success) {
      const msg = await generateMultiLanguageResponse(`Error fetching stock for ${product}: ${inv.error}`, detectedLanguage, requestId);
      await sendMessageViaAPI(From, msg);
      return true;
    }
    // Compute simple advice from last 14 days velocity
    const now = new Date();
    const start = new Date(now); start.setDate(now.getDate() - 14);
    const sales = await getSalesDataForPeriod(shopId, start, now);
    const sold = (sales.records || []).filter(r => r.fields.Product === product)
      .reduce((s, r) => s + Math.abs(r.fields.Quantity ?? 0), 0);
    const dailyRate = sold / 14;
    const lead = 3, safety = 2;
    const coverNeeded = (lead + safety) * dailyRate;
    const advise = (dailyRate > 0 && inv.quantity <= coverNeeded)
      ? `Reorder ~${Math.max(0, Math.ceil(coverNeeded - inv.quantity))} ${singularize(inv.unit)} in next ${lead} days.`
      : (dailyRate === 0 ? `No recent sales for ${product}. Hold purchase.` : `Sufficient stock for ~${Math.floor(inv.quantity / (dailyRate || 1))} days.`);
    let message = `📦 Stock — ${product}: ${inv.quantity} ${inv.unit}\n`;
    if (dailyRate > 0) message += `Avg sale: ${dailyRate.toFixed(2)} /day\n`;
    message += `💡 ${advise}`;
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  // 2) Low stock or stock-out items (+ advice)
  if (/^(?:low\s*stock|stockout|out\s*of\s*stock)\b/i.test(text)) {
    const low = await getLowStockProducts(shopId, 5);
    const out = await getStockoutItems(shopId);
    let message = `⚠️ Low & Stockout:\n`;
    if (low.length === 0 && out.length === 0) {
      message += `Everything looks good.`;
    } else {
      if (low.length > 0) {
        message += `\nLow stock (≤5):\n` + low.map(p => `• ${p.name}: ${p.quantity} ${p.unit}`).join('\n');
      }
      if (out.length > 0) {
        message += `\n\nOut of stock:\n` + out.map(p => `• ${p.name}`).join('\n');
      }
      message += `\n\n💡 Advice: Prioritize ordering low-stock items first; consider substitutable SKUs to avoid lost sales.`;
    }
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  // 3) Batches remaining with purchase & expiry dates (+ advice)
  const batchMatch = text.match(/^(?:batches?|expiry)\s+(.+)$/i);
  if (batchMatch) {
    const raw = batchMatch[1].trim();
    const product = await translateProductName(raw, requestId + ':batches');
    const batches = await getBatchesForProductWithRemaining(shopId, product);
    if (batches.length === 0) {
      const msg = await generateMultiLanguageResponse(`No active batches found for ${product}.`, detectedLanguage, requestId);
      await sendMessageViaAPI(From, msg);
      return true;
    }
    let message = `📦 Batches — ${product}:\n`;
    for (const b of batches) {
      const pd = formatDateForDisplay(b.purchaseDate);
      const ed = b.expiryDate ? formatDateForDisplay(b.expiryDate) : '—';
      message += `• ${b.quantity} ${b.unit} | Bought: ${pd} | Expiry: ${ed}\n`;
    }
    const soon = batches.filter(b => b.expiryDate && daysBetween(new Date(b.expiryDate), new Date()) <= 7);
   if (soon.length > 0) {
      message += `\n💡 Advice: ${soon.length} batch(es) expiring within 7 days — use FIFO & run a small discount to clear.`;
    }
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  // 4) Expiring soon items (default 30 days, or "expiring 15")
  const expMatch = text.match(/^expiring(?:\s+(\d+))?$/i);
  if (expMatch) {
    const days = expMatch[1] ? Math.max(1, parseInt(expMatch[1], 10)) : 30;
    const expiring = await getExpiringProducts(shopId, days);
    let message = `⏰ Expiring in next ${days} day(s):\n`;
    if (expiring.length === 0) {
      message += `No items found.`;
    } else {
      message += expiring.map(p => `• ${p.name}: ${formatDateForDisplay(p.expiryDate)} (qty ${p.quantity})`).join('\n');
      message += `\n\n💡 Advice: Mark-down nearing expiry items (5–15%), move to eye-level shelves, and bundle if possible.`;
    }
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  // 5) Sales summary for a day/week/month ("sales today|week|month")
  const salesMatch = text.match(/^sales\s+(today|this\s*week|week|this\s*month|month)$/i);
  if (salesMatch) {
    const period = parsePeriodKeyword(salesMatch[1]);
    const data = await getSalesSummaryPeriod(shopId, period);
    let message = `💰 Sales (${period}): ${data.totalItems ?? 0} items`;
    if ((data.totalValue ?? 0) > 0) message += ` (₹${(data.totalValue).toFixed(2)})`;
    if ((data.topProducts ?? []).length > 0) {
      message += `\n\n🏷️ Top Sellers:\n` + data.topProducts.slice(0, 5)
        .map(p => `• ${p.name}: ${p.quantity} ${p.unit}`).join('\n');
    }
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  // 6) Top N products (defaults: top 5 this month)
  const topMatch = text.match(/^top\s*(\d+)?\s*products?(?:\s*(today|week|month|this\s*week|this\s*month))?$/i);
  if (topMatch) {
    const limit = topMatch[1] ? Math.max(1, parseInt(topMatch[1], 10)) : 5;
    const period = parsePeriodKeyword(topMatch[2] || 'month');
    const data = await getTopSellingProductsForPeriod(shopId, period, limit);
    let message = `🏆 Top ${limit} (${period}):\n`;
    if ((data.top ?? []).length === 0) message += `No sales data.`;
    else {
      message += data.top.map((p, i) => `${i + 1}. ${p.name}: ${p.quantity} ${p.unit}`).join('\n');
    }
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  // 7) Reorder suggestions (velocity + lead/safety)
  if (/^what\s+should\s+i\s+reorder$|^reorder(\s+suggestions?)?$/i.test(text)) {
    const { success, suggestions, days, leadTimeDays, safetyDays, error } =
      await getReorderSuggestions(shopId, { days: 30, leadTimeDays: 3, safetyDays: 2 });
    if (!success) {
      const msg = await generateMultiLanguageResponse(`Error creating suggestions: ${error}`, detectedLanguage, requestId);
      await sendMessageViaAPI(From, msg);
      return true;
    }
    let message = `📋 Reorder Suggestions (based on ${days}d sales, lead ${leadTimeDays}d, safety ${safetyDays}d):\n`;
    if (suggestions.length === 0) {
      message += `No urgent reorders detected.`;
    } else {
      message += suggestions.slice(0, 10).map(s =>
        `• ${s.name}: stock ${s.currentQty} ${s.unit}, ~${s.dailyRate}/day → reorder ~${s.reorderQty} ${singularize(s.unit)}`
      ).join('\n');
      message += `\n\n💡 Advice: Confirm supplier lead-times. Increase safety days for volatile items.`;
    }
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  // 8) Inventory value summary
  if (/^(?:inventory\s*value|stock\s*value|value\s*summary)$/i.test(text)) {
    const inv = await getInventorySummary(shopId);
    let message = `📦 Inventory Summary:\n• Unique products: ${inv.totalProducts}\n• Total value: ₹${(inv.totalValue ?? 0).toFixed(2)}`;
    if ((inv.totalPurchaseValue ?? 0) > 0) {
      message += `\n• Total cost: ₹${inv.totalPurchaseValue.toFixed(2)}`;
    }
    if ((inv.topCategories ?? []).length > 0) {
      message += `\n\n📁 By Category:\n` + inv.topCategories.map((c, i) =>
        `${i + 1}. ${c.name}: ₹${c.value.toFixed(2)} (${c.productCount} items)`).join('\n');
    }
    const msg = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, msg);
    return true;
  }

  return false; // not a command
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
    
    // First, extract just the product name
    const cleanProduct = extractProductName(productName);
    
    // Check if it's already a known product in English
    if (products.some(p => p.toLowerCase() === cleanProduct.toLowerCase())) {
      return cleanProduct;
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
    
    const lowerProductName = cleanProduct.toLowerCase();
    if (hindiToEnglish[lowerProductName]) {
      const translated = hindiToEnglish[lowerProductName];
      console.log(`[${requestId}] Translated product (mapping): "${cleanProduct}" → "${translated}"`);
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
    const normalizedName = normalize(cleanProduct);
    
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
              content: cleanProduct
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
      console.log(`[${requestId}] Translated product (AI): "${cleanProduct}" → "${translated}"`);
      
      // Check if the translated product is in our known products list
      if (products.some(p => p.toLowerCase() === translated.toLowerCase())) {
        // Cache the result
        productTranslationCache.set(cacheKey, {
          translation: translated,
          timestamp: Date.now()
        });
        return translated;
      }
      
      // If not found, return the cleaned product name
      return cleanProduct;
    } catch (error) {
      console.warn(`[${requestId}] AI product translation failed:`, error.message);
      return cleanProduct;
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
          1. product: The name of the product (e.g., "Parle-G", "sugar", "milk") - ONLY the product name, no quantities or units
          2. quantity: The numerical quantity (as a number)
          3. unit: The unit of measurement (e.g., "packets", "kg", "liters", "pieces")
          4. action: The action being performed ("purchased", "sold", "remaining")
          5. price: The price per unit (if mentioned, otherwise null)
          6. totalPrice: The total price (if mentioned, otherwise null)
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
                  timeout: 10000
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
                const parsed = safeJsonParse(content);
                if (!parsed) {
                  console.error(`[${requestId}] Failed to parse AI response as JSON after cleanup`);
                  return null;
                }
                const updatesArray = Array.isArray(parsed) ? parsed : [parsed];
                
                return updatesArray.map(update => {
                // Convert quantity to number and ensure proper sign
                let quantity = typeof update.quantity === 'string' ? 
                              parseInt(update.quantity.replace(/[^\d.-]/g, '')) || 0 : 
                              Number(update.quantity) || 0;
                
                // Ensure action is properly set based on quantity
                let action = update.action || '';
                if (!action) {
                  action = quantity >= 0 ? 'purchased' : 'sold';
                }
                
                // Extract price information
                let price = update.price || 0;
                let totalPrice = update.totalPrice || 0;
                
                // Calculate missing values
                if (price > 0 && totalPrice === 0) {
                  totalPrice = price * Math.abs(quantity);
                } else if (totalPrice > 0 && price === 0 && quantity > 0) {
                  price = totalPrice / quantity;
                }
                
                // Ensure unit has a proper default
                const unit = update.unit || 'pieces';
                
                // Use AI-parsed product directly - NO re-processing!
                const product = String(update.product || '').trim();
                
                return {
                  product: product,
                  quantity: Math.abs(quantity), // Always store positive quantity
                  unit: unit,
                  action: action,
                  price: price,
                  totalPrice: totalPrice,
                  isKnown: products.some(p => isProductMatch(product, p))
                };
              });
              } catch (parseError) {
                console.error(`[${requestId}] Failed to parse AI response as JSON:`, parseError.message);
                console.error(`[${requestId}] Raw AI response:`, content);
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
    
    // ✅ RETURN AI RESULTS IMMEDIATELY if successful
    if (aiUpdate && aiUpdate.length > 0 && aiUpdate[0].product) {
      console.log(`[AI Parsing] Successfully parsed ${aiUpdate.length} updates using AI`);
      return aiUpdate;
    }
    
    console.log(`[AI Parsing] No valid AI results, falling back to rule-based parsing`);
  } catch (error) {
    console.warn(`[AI Parsing] Failed, falling back to rule-based parsing:`, error.message);
  }
  
  // Fallback to rule-based parsing ONLY if AI fails
  // Better sentence splitting to handle conjunctions
  const sentences = transcript.split(regexPatterns.conjunctions);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed) {
      try {
        let update = parseSingleUpdate(trimmed);
        if (update && update.product) {
          // Only translate if not already processed by AI
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

      // Get product price from database
      let productPrice = 0;
      try {
        const priceResult = await getProductPrice(product);
        if (priceResult.success) {    
          productPrice = Number(priceResult.price) || 0;
        }
      } catch (error) {
        console.warn(`[Update ${shopId} - ${product}] Could not fetch product price:`, error.message);
      }
      
      // For purchases, ask for price if not available
      if (update.action === 'purchased' && productPrice === 0 && !update.price) {
      // Save pending update to database and keep the id
      const saveRes = await saveCorrectionState(shopId, 'price', update, languageCode);

    
      // Prompt user for price
      const promptMessage = await generateMultiLanguageResponse(
        `What is the price per ${singularize(update.unit)} for ${product}?`,
        languageCode,
        'price-prompt'
      );
    
      await sendMessageViaAPI(`whatsapp:${shopId}`, promptMessage);

      
  // Put the user into 'correction' mode for price so the next number is captured as price
        try {
          await setUserState(`whatsapp:${shopId}`, 'correction', {
            correctionState: {
              correctionType: 'price',
              pendingUpdate: update,
              detectedLanguage: languageCode,
              id: saveRes && saveRes.id
            }
          });
        } catch (e) {
          console.warn(`[Update ${shopId} - ${product}] Failed to set user state for price correction:`, e.message);
        }
        
      results.push({
        product: product,
        quantity: update.quantity,
        unit: update.unit,
        action: update.action,
        success: false,
        needsPrice: true,
        message: 'Prompted user for missing price',
        error: 'Missing price',
        correctionId: saveRes && saveRes.id
      });
    
      continue;
    }
      
      // Use provided price or fall back to database price      
      // NEW: reliable price/value
        const finalPrice = (update.price ?? productPrice) || 0;
        const finalTotalPrice = Number.isFinite(update.totalPrice)
          ? update.totalPrice
          : (finalPrice * Math.abs(update.quantity));
          const priceSource = (update.price && Number(update.price) > 0)
            ? 'message'
            : (productPrice > 0 ? 'db' : null); // only mark db if it’s actually > 0

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
      const result = await updateInventory(shopId, product, update.action === 'sold' ? -update.quantity : update.quantity, update.unit);
          // Create batch record for purchases only
          if (update.action === 'purchased' && result.success) {
            console.log(`[Update ${shopId} - ${product}] Creating batch record for purchase`);
            // Format current date with time for Airtable
            const formattedPurchaseDate = formatDateForAirtable(new Date());
            console.log(`[Update ${shopId} - ${product}] Using timestamp: ${formattedPurchaseDate}`);
            
            // Use database price (productPrice) or provided price
            const purchasePrice = productPrice > 0 ? productPrice : (finalPrice || 0);
            console.log(`[Update ${shopId} - ${product}] Using purchasePrice: ${purchasePrice} (productPrice: ${productPrice}, finalPrice: ${finalPrice})`);
            
            const batchResult = await createBatchRecord({
              shopId,
              product: product, // Use translated product
              quantity: update.quantity,
              unit: update.unit, // Pass the unit
              purchaseDate: formattedPurchaseDate,
              expiryDate: null, // Will be updated later
              purchasePrice: purchasePrice // Pass the purchase price
            });
        if (batchResult.success) {
          console.log(`[Update ${shopId} - ${product}] Batch record created with ID: ${batchResult.id}`);
          // Add batch date to result for display
          result.batchDate = formattedPurchaseDate;
        } 
        else {
          console.error(`[update] Failed to create batch record: ${batchResult.error}`);
        }

      // ✅ Update product price in DB after purchase — only if we have a positive rate
      if (productPrice > 0) {
        try {
          await upsertProduct({
            name: product,
            price: productPrice,
            unit: update.unit
          });
          console.log(`[Update ${shopId} - ${product}] Product price updated in DB: ₹${productPrice}/${update.unit}`);
        } catch (err) {
          console.warn(`[Update ${shopId} - ${product}] Failed to update product price in DB:`, err.message);
        }
      } else {
        console.log(`[Update ${shopId} - ${product}] Skipped DB price update (no price provided).`);
      }
      }
            // Create sales record for sales only
            if (isSale && result.success) {
              console.log(`[Update ${shopId} - ${product}] Creating sales record`);
              try {
                // Use database price (productPrice) if available, then fallback to finalPrice
                const salePrice = productPrice || finalPrice || 0;
                const saleValue = salePrice * Math.abs(update.quantity);
                console.log(`[Update ${shopId} - ${product}] Sales record - salePrice: ${salePrice}, saleValue: ${saleValue}`);
                
                const salesResult = await createSalesRecord({
                  shopId,
                  product: product,
                  quantity: -Math.abs(update.quantity),
                  unit: update.unit,
                  saleDate: new Date().toISOString(),
                  batchCompositeKey: selectedBatchCompositeKey, // Uses composite key
                  salePrice: salePrice,
                  saleValue: saleValue
                });
          
          if (salesResult.success) {
            console.log(`[Update ${shopId} - ${product}] Sales record created with ID: ${salesResult.id}`);

            // Generate and send invoice (non-blocking)
            (async () => {
              try {
                console.log(`[Update ${shopId} - ${product}] Starting invoice generation process`);
                
                // Get shop details
                const shopDetailsResult = await getShopDetails(shopId);
                if (!shopDetailsResult.success) {
                  console.warn(`[Update ${shopId} - ${product}] Could not get shop details: ${shopDetailsResult.error}`);
                  return;
                }
                
                // Prepare sale record for invoice
                const saleRecordForInvoice = {
                  product: product,
                  quantity: Math.abs(update.quantity), // Convert to positive for display
                  unit: update.unit,
                  rate: salePrice,
                  saleDate: new Date().toISOString()
                };
                
                console.log(`[Update ${shopId} - ${product}] Sale record prepared:`, saleRecordForInvoice);
                
                // Generate invoice PDF
                const pdfPath = await generateInvoicePDF(shopDetailsResult.shopDetails, saleRecordForInvoice);
                console.log(`[Update ${shopId} - ${product}] Invoice generated: ${pdfPath}`);
                
                // Verify PDF file exists
                if (!fs.existsSync(pdfPath)) {
                  throw new Error(`Generated PDF file not found: ${pdfPath}`);
                }
                
                // Send the PDF to the shop owner
                const message = await sendPDFViaWhatsApp(`whatsapp:${shopId}`, pdfPath);
                console.log(`[Update ${shopId} - ${product}] Invoice sent to whatsapp:${shopId}. SID: ${message.sid}`);
                
              } catch (invoiceError) {
                console.error(`[Update ${shopId} - ${product}] Error generating/sending invoice:`, invoiceError.message);
                console.error(`[Update ${shopId} - ${product}] Stack trace:`, invoiceError.stack);
              }
            })();

            // Update batch quantity if a batch was selected
            if (selectedBatchCompositeKey) {
              console.log(`[Update ${shopId} - ${product}] About to update batch quantity. Composite key: "${selectedBatchCompositeKey}", Quantity change: ${update.quantity}`);
              try {
                const batchUpdateResult = await updateBatchQuantityByCompositeKey(
                  selectedBatchCompositeKey, 
                  -Math.abs(update.quantity)
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
            
       // NEW: Enrich outgoing item with price/value so renderer can show them
        const enriched = {
          product,
          quantity: update.quantity,
          unit: update.unit,
          action: update.action,
          ...result,
          purchasePrice: update.action === 'purchased' ? (productPrice || finalPrice || 0) : undefined,
          salePrice:     update.action === 'sold'      ? (productPrice || finalPrice || 0) : undefined,
          totalValue:    (update.action === 'purchased' || update.action === 'sold') ? (productPrice * Math.abs(update.quantity)) : 0,
          priceSource,
          priceUpdated:  update.action === 'purchased' && (productPrice > 0)
        };      
        // Debug line to verify at runtime (you can remove later)
        console.log(`[Update ${shopId} - ${product}] priceSource=${priceSource}, purchasePrice=${enriched.purchasePrice ?? '-'}, salePrice=${enriched.salePrice ?? '-'}, totalValue=${enriched.totalValue}`);

      results.push(enriched);
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
    // --- KEY: hash of FULL message prevents collisions and increases hits ---
    const hash = crypto.createHash('sha1').update(`${languageCode}::${message}`).digest('hex');
    const cacheKey = `${languageCode}:${hash}`;
    // 0) In-memory cache first (fastest)


    const cached = languageCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < LANGUAGE_CACHE_TTL)) {
      console.log(`[${requestId}] Using cached translation for ${languageCode}`);
      return cached.translation;
    }

    
// 1) Persistent cache (Airtable) next
    try {
      const hit = await getTranslationEntry(hash, languageCode);
      if (hit.success && hit.translatedText) {
        console.log(`[${requestId}] Translation cache hit in Airtable (${languageCode})`);
        languageCache.set(cacheKey, { translation: hit.translatedText, timestamp: Date.now() });
        return hit.translatedText;
      }
    } catch (e) {
      console.warn(`[${requestId}] Translation Airtable lookup failed: ${e.message}`);
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
     let translated = '';
     let lastErr;
     for (let attempt = 1; attempt <= 2; attempt++) {
       try {
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
        max_tokens: 600,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: TRANSLATE_TIMEOUT_MS // Increased timeout for better reliability
      }
    );
    
    translated = response.data.choices[0].message.content.trim();
         if (translated) break; // success
       } catch (err) {
         lastErr = err;
         const code = err?.code || err?.response?.status || 'unknown';
         console.warn(`[${requestId}] Translate attempt ${attempt} failed: ${code}`);
         if (attempt < 2) await new Promise(r => setTimeout(r, 600)); // small backoff
       }
     }
     if (!translated) {
       console.warn(`[${requestId}] Translation failed, using original: ${lastErr?.code || lastErr?.message || 'unknown'}`);
       return message; // keep current fallback behavior
     }

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

// Quick integrity check: ensure we have 2 blocks and not cut mid-sentence
    const endsNeatly = /[.!?]$/.test(translated.trim());
    const hasTwoBlocks = translated.includes('\n\n');
    if (!hasTwoBlocks || !endsNeatly) {
      try {
        console.warn(`[${requestId}] Translation looks incomplete. Retrying with larger budget...`);
        const retry = await axios.post(
          'https://api.deepseek.com/v1/chat/completions',
          {
            model: "deepseek-chat",
            messages: [
              { role: "system", content: `Return COMPLETE translation as two blocks (native script, blank line, roman transliteration). Do not omit the ending punctuation.` },
              { role: "user", content: `Translate this message to ${languageCode}: "${message}"` }
            ],
            max_tokens: Math.min(2000, Math.max(800, Math.ceil(message.length * 3))),
            temperature: 0.2
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 20000
          }
        );
        translated = retry.data.choices[0].message.content.trim();
      } catch (e) {
        console.warn(`[${requestId}] Retry translation failed, using first translation:`, e.message);
      }
    }
    // Last-resort guard: if still too long, prefer native script only
    const MAX_LENGTH = 1600;
    if (translated.length > MAX_LENGTH) {
      const parts = translated.split(/\n{2,}/);
      if (parts.length >= 2) translated = parts[0];
    }    
    
// After you have a valid `translated` value:
    if (translated && translated.trim()) {
      // 2) Save to Airtable (persistent cache) - non-blocking preferred, but safe to await
      try {
        await upsertTranslationEntry({
          key: hash,
          language: languageCode,
          sourceText: message,
          translatedText: translated
        });
      } catch (e) {
        console.warn(`[${requestId}] Failed to persist translation: ${e.message}`);
      }
      // 3) Save to in-memory cache
      languageCache.set(cacheKey, { translation: translated, timestamp: Date.now() });
      return translated;
    }

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
// If long, send via API (which auto-splits) and keep TwiML minimal
    const MAX_LENGTH = 1600;
    if (formattedMessage.length > MAX_LENGTH) {
     await sendMessageViaAPI(from, formattedMessage);
      // Optional: small ack so Twilio gets a valid TwiML
      response.message('✅ Sent.');
      return formattedMessage;
    }
    // Otherwise, TwiML is fine
    response.message(formattedMessage);
    return formattedMessage;
    
  } catch (error) {
    console.error(`[${requestId}] Error sending system message:`, error.message);
    // Fallback to original message in English
    response.message(message);
    return message;
  }
}

async function sendPDFViaWhatsApp(to, pdfPath) {
  const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
  const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  
  console.log(`[sendPDFViaWhatsApp] Preparing to send PDF: ${pdfPath}`);
  
  try {
    // Check if PDF file exists
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }
    
    // Get file stats for logging
    const stats = fs.statSync(pdfPath);
    console.log(`[sendPDFViaWhatsApp] PDF file size: ${stats.size} bytes`);
    
    // Read the PDF file as base64
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    
    console.log(`[sendPDFViaWhatsApp] PDF read successfully, converting to base64`);
    
    // Send using Twilio's media URL with base64 data
    const message = await client.messages.create({
      body: 'Here is your invoice:',
      mediaUrl: [`data:application/pdf;base64,${pdfBase64}`],
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: formattedTo
    });
    
    console.log(`[sendPDFViaWhatsApp] Message sent successfully. SID: ${message.sid}`);
    return message;
    
  } catch (error) {
    console.error(`[sendPDFViaWhatsApp] Error:`, error.message);
    
    // Try fallback with public URL
    try {
      const fileName = path.basename(pdfPath);
      const baseUrl = process.env.PUBLIC_URL || `https://${process.env.RAILWAY_SERVICE_NAME}.railway.app`;
      const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
      const publicUrl = `${normalizedBaseUrl}/invoice/${fileName}`;
      
      console.log(`[sendPDFViaWhatsApp] Trying fallback URL: ${publicUrl}`);
      
      const fallbackMessage = await client.messages.create({
        body: 'Here is your invoice:',
        mediaUrl: [publicUrl],
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: formattedTo
      });
      
      console.log(`[sendPDFViaWhatsApp] Fallback message sent. SID: ${fallbackMessage.sid}`);
      return fallbackMessage;
      
    } catch (fallbackError) {
      console.error(`[sendPDFViaWhatsApp] Fallback also failed:`, fallbackError.message);
      throw new Error(`Both base64 and URL methods failed. Base64 error: ${error.message}, URL error: ${fallbackError.message}`);
    }
  }
}

// === START: AI price extractor ===
async function aiExtractPriceUpdates(text, requestId) {
  try {
    // Strong, constrained instruction: return ONLY JSON we can parse.
    const systemMsg = [
      'You extract product price updates from user text.',
      'Return ONLY a valid JSON array. No markdown, no commentary.',
      'Each element: { "product": string, "price": number }',
      'Rules:',
      '1) Keep product name as user wrote it (same casing/script).',
      '2) Price: convert number-words to a numeric rupee value (e.g., "thirty two" => 32).',
      '3) If multiple items are present (comma/semicolon/and/aur/और/& separators), return each as a separate element.',
      '4) Ignore currency symbols and suffixes (₹, rs., /-).',
      '5) If an item lacks a numeric price, skip it.',
      '6) Do NOT include keys other than "product" and "price".',
    ].join(' ');

    const userMsg = [
      'Text:', text,
      '',
      'Return JSON array only, example:',
      '[ { "product": "milk", "price": 60 }, { "product": "Parle-G", "price": 49.5 } ]'
    ].join('\n');

    const resp = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user',   content: userMsg }
        ],
        temperature: 0.1,
        max_tokens: 200
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 12000
      }
    );

    let content = resp.data?.choices?.[0]?.message?.content?.trim?.() || '';
    // Strip code fences if any
    if (content.startsWith('```')) {
      content = content.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    }

    const parsed = safeJsonParse(content);
    if (!parsed) {
      console.warn(`[${requestId}] AI price extract: JSON parse failed. Raw:`, content);
      return { success: false, items: [] };
    }

    const array = Array.isArray(parsed) ? parsed : [parsed];
    const cleaned = [];
    for (const row of array) {
      const product = String(row?.product ?? '').trim();
      let price = row?.price;

      // Normalize price if AI returned string
      if (typeof price === 'string') {
        // Remove common symbols/spaces and parse
        const digits = price.replace(/[^\d.,\-]/g, '').replace(/,/g, '');
        price = parseFloat(digits);
      }

      if (product && Number.isFinite(price)) {
        cleaned.push({ product, price: Number(price) });
      }
    }

    return cleaned.length > 0
      ? { success: true, items: cleaned }
      : { success: false, items: [] };
  } catch (err) {
    console.warn(`[${requestId}] AI price extract failed:`, err.message);
    return { success: false, items: [] };
  }
}
// === END: AI price extractor ===


// Add this helper function to split messages
function splitMessage(message, maxLength = 1600) {
  if (message.length <= maxLength) {
    return [message];
  }
  
  const chunks = [];
  let currentChunk = '';
  
  // Split by paragraph breaks first, then by sentence-ending punctuation
  const sentences = message
    .split(/\n{2,}/)                               // paragraphs
    .flatMap(p => p.match(/[^.!?]+[.!?]*/g) || [p]); // sentences (fallback to whole paragraph)

  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length + 1 <= maxLength) {
      currentChunk += sentence + ' ';
    } else {
      // If adding this sentence would exceed the limit, push the current chunk and start a new one
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence + ' ';
      } else {
        // If the sentence itself is longer than maxLength, split by words
        const words = sentence.split(' ');
        for (const word of words) {
          if (currentChunk.length + word.length + 1 <= maxLength) {
            currentChunk += word + ' ';
          } else {
            chunks.push(currentChunk.trim());
            currentChunk = word + ' ';
          }
        }
      }
    }
  }
  
  // Add the last chunk if it has content
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Add this helper function for robust JSON parsing
function safeJsonParse(str) {
  try {
    // First try direct JSON parse
    return JSON.parse(str);
  } catch (e) {
    try {
      // Remove any non-JSON content
      const jsonMatch = str.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // Try to fix common JSON issues
      let fixed = str
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // Fix keys without quotes
        .replace(/'/g, '"') // Replace single quotes with double quotes
        .replace(/(\w):(\s*)([^"\d][^,}\]\s]*)/g, '"$1":$2"$3"') // Fix unquoted string values
        .replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas
      
      return JSON.parse(fixed);
    } catch (e2) {
      console.error('JSON parsing failed even after cleanup:', e2.message);
      return null;
    }
  }
}


// Helper: singularize unit labels for nicer prompts (packet vs packets)
function singularize(unit) {
  if (!unit) return unit;
  const map = {
    packets: 'packet',
    boxes: 'box',
    pieces: 'piece',
    liters: 'liter',
    grams: 'gram',
    kgs: 'kg',
    mls: 'ml'
  };
  const u = String(unit).toLowerCase();
  return map[u] || unit.replace(/s$/i, '');
}


// Helper: check if every result is still pending price
function allPendingPrice(results) {
  return Array.isArray(results) && results.length > 0 && results.every(r => r.needsPrice === true);
}


// Add this with your other helper functions
function isProductMatch(userInput, knownProduct) {
  if (!userInput || !knownProduct) return false;
  
  const normalize = (str) => {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  };
  
  const userNorm = normalize(userInput);
  const knownNorm = normalize(knownProduct);
  
  // 1. Exact match
  if (userNorm === knownNorm) return true;
  
  // 2. Substring match (either contains the other)
  if (userNorm.includes(knownNorm) || knownNorm.includes(userNorm)) return true;
  
  // 3. Word-based matching for multi-word products
  const userWords = userNorm.split(/\s+/).filter(word => word.length > 2);
  const knownWords = knownNorm.split(/\s+/).filter(word => word.length > 2);
  
  if (userWords.length === 0 || knownWords.length === 0) return false;
  
  // Check if any significant word from user input matches known product
  const hasWordMatch = userWords.some(userWord => 
    knownWords.some(knownWord => 
      userWord.includes(knownWord) || knownWord.includes(userWord)
    )
  );
  
  // Additional check: known product words in user input
  const hasReverseMatch = knownWords.some(knownWord =>
    userWords.some(userWord => 
      userWord.includes(knownWord) || knownWord.includes(userWord)
    )
  );
  
  return hasWordMatch || hasReverseMatch;
}

// Add this function near the top of your file (around line 50-60)
function normalize(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/gi, '').trim();
}

// Add these functions after the existing helper functions

// Generate instant summary (concise, <300 words)
async function generateInstantSummary(shopId, languageCode, requestId) {
  try {
    console.log(`[${requestId}] Generating instant summary for shop ${shopId}`);
    
    // Get today's sales data
    const todaySales = await getTodaySalesSummary(shopId);
    // Get inventory summary
    const inventorySummary = await getInventorySummary(shopId);
    // Get low stock products
    const lowStockProducts = await getLowStockProducts(shopId, 5);
    // Get expiring products
    const expiringProducts = await getExpiringProducts(shopId, 7);
    
    // Format the summary
    let summary = `📊 Today's Summary (${formatDateForDisplay(new Date())}):\n\n`;
    
    // Sales information
    if (todaySales.totalItems > 0) {
      summary += `💰 Sales: ${todaySales.totalItems} items`;
      if (todaySales.totalValue > 0) {
        summary += ` (₹${todaySales.totalValue.toFixed(2)})`;
      }
      summary += `\n`;
      
      if (todaySales.topProducts.length > 0) {
        summary += `\n🛒 Top Sellers:\n`;
        todaySales.topProducts.forEach(product => {
          summary += `• ${product.name}: ${product.quantity} ${product.unit}\n`;
        });
      }
    } else {
      summary += `💰 No sales recorded today.\n`;
    }
    
    // Low stock alerts
    if (lowStockProducts.length > 0) {
      summary += `\n⚠️ Low Stock Alerts:\n`;
      lowStockProducts.forEach(product => {
        summary += `• ${product.name}: Only ${product.quantity} ${product.unit} left\n`;
      });
    }
    
    // Expiry alerts
    if (expiringProducts.length > 0) {
      summary += `\n⏰ Expiring Soon:\n`;
      expiringProducts.forEach(product => {
        summary += `• ${product.name}: Expires on ${formatDateForDisplay(product.expiryDate)}\n`;
      });
    }
    
    // Generate multilingual response
    return await generateMultiLanguageResponse(summary, languageCode, requestId);
  } catch (error) {
    console.error(`[${requestId}] Error generating instant summary:`, error.message);
    
    // Fallback error message in user's language
    const errorMessage = `Sorry, I couldn't generate your summary right now. Please try again later.`;
    return await generateMultiLanguageResponse(errorMessage, languageCode, requestId);
  }
}

// Generate full-scale summary (detailed with AI insights)
async function generateFullScaleSummary(shopId, languageCode, requestId) {
  try {
    console.log(`[${requestId}] Generating full-scale summary for shop ${shopId}`);
    
    // Get 30-day sales data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const salesData = await getSalesDataForPeriod(shopId, thirtyDaysAgo, new Date());
    // Get purchase data
    const purchaseData = await getPurchaseDataForPeriod(shopId, thirtyDaysAgo, new Date());
    // Get inventory summary
    const inventorySummary = await getInventorySummary(shopId);
    // Get low stock products
    const lowStockProducts = await getLowStockProducts(shopId, 5);
    // Get expiring products
    const expiringProducts = await getExpiringProducts(shopId, 7);
    
    // Prepare data for AI analysis
    const contextData = {
      salesData,
      purchaseData,
      inventorySummary,
      lowStockProducts,
      expiringProducts,
      period: "30 days"
    };
    
    // Generate AI-powered insights
    const insights = await generateSummaryInsights(contextData, languageCode, requestId);
    
    // Generate multilingual response
    return insights;
  } catch (error) {
    console.error(`[${requestId}] Error generating full-scale summary:`, error.message);
    
    // Fallback error message in user's language
    const errorMessage = `Sorry, I couldn't generate your detailed summary right now. Please try again later.`;
    return await generateMultiLanguageResponse(errorMessage, languageCode, requestId);
  }
}

// Generate AI-powered insights for full summary
async function generateSummaryInsights(data, languageCode, requestId) {
  const maxRetries = 3;
  let lastError;
  
  // Validate configuration
  try {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error('DEEPSEEK_API_KEY environment variable is not set');
    }
    console.log(`[${requestId}] DEEPSEEK_API_KEY is set, length: ${process.env.DEEPSEEK_API_KEY.length}`);
  } catch (error) {
    console.error(`[${requestId}] Configuration error:`, error.message);
    return generateFallbackSummary(data, languageCode, requestId);
  }

  // Get language name for Nativeglish
  const nativeLanguage = languageNames[languageCode] || languageCode;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let timeoutId;
    try {
      console.log(`[${requestId}] AI API call attempt ${attempt}/${maxRetries}`);
      
      // Limit the amount of data sent to prevent oversized requests
      const topSalesLimit = 5;
      const lowStockLimit = 5;
      const expiringLimit = 5;
      
      // Prepare a more concise prompt
      const prompt = `You are an inventory analysis assistant. Analyze the following shop data and provide insights in Nativeglish (${nativeLanguage} mixed with English) - ensure response is formal and respectful.
      Sales Data (last 30 days):
      - Total items sold: ${data.salesData.totalItems || 0}
      - Total sales value: ₹${(data.salesData.totalValue || 0).toFixed(2)}
      - Top selling products: ${data.salesData.topProducts ? 
          data.salesData.topProducts.slice(0, topSalesLimit).map(p => `${p.name} (${p.quantity} ${p.unit})`).join(', ') : 'None'}
      Purchase Data (last 30 days):
      - Total items purchased: ${data.purchaseData.totalItems || 0}
      - Total purchase value: ₹${(data.purchaseData.totalValue || 0).toFixed(2)}
      - Most purchased products: ${data.purchaseData.topProducts ? 
          data.purchaseData.topProducts.slice(0, topSalesLimit).map(p => `${p.name} (${p.quantity} ${p.unit})`).join(', ') : 'None'}
      Current Inventory:
      - Total unique products: ${data.inventorySummary.totalProducts || 0}
      - Total inventory value: ₹${(data.inventorySummary.totalValue || 0).toFixed(2)}
      Low Stock Products:
      ${data.lowStockProducts.length > 0 ? 
          data.lowStockProducts.slice(0, lowStockLimit).map(p => `- ${p.name}: ${p.quantity} ${p.unit} left`).join('\n') : 'None'}
      Expiring Products (next 7 days):
      ${data.expiringProducts.length > 0 ? 
          data.expiringProducts.slice(0, expiringLimit).map(p => `- ${p.name}: Expires on ${formatDateForDisplay(p.expiryDate)}`).join('\n') : 'None'}
      Provide a comprehensive analysis with:
      1. Sales trends and patterns
      2. Inventory performance
      3. Recommendations for restocking
      4. Suggestions for reducing waste
      5. Actionable insights for business growth
      Format your response in Nativeglish (${nativeLanguage} + English mix) that is easy to understand for local shop owners. Keep the response under 500 words and focus on actionable insights.`;
      
      console.log(`[${requestId}] Prompt length: ${prompt.length} characters`);
      console.log(`[${requestId}] Making API request to Deepseek...`);
      
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content: `You are an expert inventory analyst providing concise, actionable insights for small business owners. Your response should be in Nativeglish (${nativeLanguage} mixed with English) for better readability and understanding but should be formal and respectful. Keep your response under 1500 characters.`
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: 800,
          temperature: 0.5
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // Increased timeout to 60 seconds
        }
      );
      
      console.log(`[${requestId}] API response received, status: ${response.status}`);
      
      let insights = response.data.choices[0].message.content.trim();
      
      // Minimal post-processing - just clean up formatting
      insights = insights.replace(/\n\s*\n\s*\n/g, '\n\n');
      insights = insights.replace(/^\s+|\s+$/g, '');
      
      console.log(`[${requestId}] Successfully generated insights, length: ${insights.length}`);
      return insights;
      
    } catch (error) {
      lastError = error;
      console.warn(`[${requestId}] AI API call attempt ${attempt} failed:`, error.message);
      
      if (error.response) {
        console.error(`[${requestId}] API response status:`, error.response.status);
        console.error(`[${requestId}] API response data:`, error.response.data);
      }
      
      if (error.code === 'ECONNABORTED') {
        console.error(`[${requestId}] Request was aborted (likely timeout)`);
      }
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        break;
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`[${requestId}] Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // If all retries failed, use fallback
  console.error(`[${requestId}] All AI API attempts failed, using fallback`);
  console.error(`[${requestId}] Last error:`, lastError.message);
  return generateFallbackSummary(data, languageCode, requestId);
}

function generateFallbackSummary(data, languageCode, requestId) {
  console.log(`[${requestId}] Generating fallback summary for ${languageCode}`);
  
  let fallbackSummary = `📊 30-Day Business Summary:\n\n`;
  fallbackSummary += `💰 Sales: ${data.salesData.totalItems || 0} items (₹${(data.salesData.totalValue || 0).toFixed(2)})\n`;
  fallbackSummary += `📦 Purchases: ${data.purchaseData.totalItems || 0} items (₹${(data.purchaseData.totalValue || 0).toFixed(2)})\n`;
  fallbackSummary += `📋 Inventory: ${data.inventorySummary.totalProducts || 0} unique products (₹${(data.inventorySummary.totalValue || 0).toFixed(2)})\n`;
  
  if (data.lowStockProducts.length > 0) {
    fallbackSummary += `\n⚠️ Low Stock: ${data.lowStockProducts.length} products need restocking\n`;
    // Add top 3 low stock products
    data.lowStockProducts.slice(0, 3).forEach(product => {
      fallbackSummary += `• ${product.name}: Only ${product.quantity} ${product.unit} left\n`;
    });
  }
  
  if (data.expiringProducts.length > 0) {
    fallbackSummary += `\n⏰ Expiring Soon: ${data.expiringProducts.length} products\n`;
    // Add top 3 expiring products
    data.expiringProducts.slice(0, 3).forEach(product => {
      fallbackSummary += `• ${product.name}: Expires on ${formatDateForDisplay(product.expiryDate)}\n`;
    });
  }
  
  // Add top-selling products if available
  if (data.salesData.topProducts && data.salesData.topProducts.length > 0) {
    fallbackSummary += `\n🏆 Top Sellers:\n`;
    data.salesData.topProducts.slice(0, 3).forEach(product => {
      fallbackSummary += `• ${product.name}: ${product.quantity} ${product.unit}\n`;
    });
  }
  
  fallbackSummary += `\n💡 Consider reviewing your sales patterns and inventory turnover for better business decisions.`;
  
  console.log(`[${requestId}] Fallback summary generated, length: ${fallbackSummary.length}`);
  return generateMultiLanguageResponse(fallbackSummary, languageCode, requestId);
}

module.exports = { generateSummaryInsights };

// Add this function after the existing helper functions

// Create interactive button menu
async function createSummaryMenu(from, languageCode, requestId) {
  try {
    // Get user's preferred language
    let userLanguage = languageCode;
    
    // Menu options in different languages
    const menuOptions = {
      'hi': {
        instant: 'तत्काल सारांश',
        full: 'विस्तृत सारांश',
        instructions: 'कृपया एक विकल्प चुनें:'
      },
      'bn': {
        instant: 'তাত্ক্ষণিক সারসংক্ষেপ',
        full: 'বিস্তারিত সারসংক্ষেপ',
        instructions: 'অনুগ্রহ করে একটি বিকল্প নির্বাচন করুন:'
      },
      'ta': {
        instant: 'உடனடிச் சுருக்கம்',
        full: 'விரிவான சுருக்கம்',
        instructions: 'தயவுசெய்து ஒரு விருப்பத்தைத் தேர்ந்தெடுங்கள்:'
      },
      'te': {
        instant: 'తక్షణ సారాంశం',
        full: 'వివరణాత్మక సారాంశం',
        instructions: 'దయచేసి ఒక ఎంపికను ఎంచుకోండి:'
      },
      'kn': {
        instant: 'ತಕ್ಷಣ ಸಾರಾಂಶ',
        full: 'ವಿಸ್ತೃತ ಸಾರಾಂಶ',
        instructions: 'ದಯವಿಟ್ಟು ಒಂದು ಆಯ್ಕೆಯನ್ನು ಆರಿಸಿ:'
      },
      'gu': {
        instant: 'તાત્કાલિક સારાંશ',
        full: 'વિગતવાર સારાંશ',
        instructions: 'કૃપા કરીને એક વિકલ્પ પસંદ કરો:'
      },
      'mr': {
        instant: 'त्वरित सारांश',
        full: 'तपशीलवार सारांश',
        instructions: 'कृपया एक पर्याय निवडा:'
      },
      'en': {
        instant: 'Instant Summary',
        full: 'Detailed Summary',
        instructions: 'Please select an option:'
      }
    };
    
    // Get options for user's language, fallback to English
    const options = menuOptions[userLanguage] || menuOptions['en'];
    
    // Create menu message
    let menuMessage = `📊 ${options.instructions}\n\n`;
    menuMessage += `1️⃣ ${options.instant}\n`;
    menuMessage += `2️⃣ ${options.full}\n\n`;
    menuMessage += `You can also type "summary" for instant or "full summary" for detailed.`;
    
    // Generate multilingual response
    const formattedMessage = await generateMultiLanguageResponse(menuMessage, userLanguage, requestId);
    
    // Create button message
    const twiml = new twilio.twiml.MessagingResponse();
    const messageObj = twiml.message();
    messageObj.body(formattedMessage);
    
    // Add interactive buttons
    const buttonsObj = messageObj.buttons();
    buttonsObj.button({
      action: {
        type: 'reply',
        reply: {
          id: 'instant_summary',
          title: options.instant
        }
      }
    });
    buttonsObj.button({
      action: {
        type: 'reply',
        reply: {
          id: 'full_summary',
          title: options.full
        }
      }
    });
    
    return twiml.toString();
  } catch (error) {
    console.error(`[${requestId}] Error creating summary menu:`, error.message);
    
    // Fallback to text menu
    const fallbackMessage = `📊 Please select an option:\n\n1. Instant Summary\n2. Detailed Summary\n\nYou can also type "summary" for instant or "full summary" for detailed.`;
    return await generateMultiLanguageResponse(fallbackMessage, languageCode, requestId);
  }
}

// Handle price update command
// === START: handlePriceUpdate (PASTE-REPLACE) ===
async function handlePriceUpdate(Body, From, detectedLanguage, requestId) {
  const shopId = From.replace('whatsapp:', '');

  // Drop the prefix for AI & fallback parsing
  const userText = Body.replace(/^\s*update\s+price\s*/iu, '').trim();

  // 0) Try AI first (handles words, multiple items, mixed separators & scripts)
  const ai = await aiExtractPriceUpdates(userText, requestId);
  if (ai.success && ai.items.length > 0) {
    const results = await applyPriceUpdates(ai.items, shopId, detectedLanguage, requestId);
    await sendMessageViaAPI(From, results.message);
    return;
  }

  // 1) Fallback: deterministic end-anchored numeric-only parser
  //    (still supports multiple items, separators, ₹/rs, /-)
  const BULK_SPLIT = /(?:[,;]|(?:\s+(?:and|aur|और)\s+)|\s*&\s*)+/iu;
  const PRICE_AT_END =
    /(?:[:=\-–—]\s*)?(?:₹\s*|rs\.?\s*)?(?<int>\d{1,3}(?:,\d{3})*|\d+)(?:\.(?<frac>\d{1,2}))?(?:\s*\/-?)?\s*$/iu;

  function parseSegment(seg) {
    if (!seg) return null;
    const m = seg.match(PRICE_AT_END);
    if (!m) return null;

    let product = seg.slice(0, m.index)
      .replace(/\s+$/u, '')
      .replace(/[:=\-–—]\s*$/u, '')
      .trim()
      .replace(/\s+/g, ' ');

    const intPart = (m.groups.int || '').replace(/,/g, '');
    const fracPart = m.groups.frac ? `.${m.groups.frac}` : '';
    const price = parseFloat(intPart + fracPart);

    if (!product || Number.isNaN(price)) return null;
    return { product, price };
  }

  // Decide single vs bulk based on separators
  const looksBulk = BULK_SPLIT.test(userText);
  if (!looksBulk) {
    const single = parseSegment(userText);
    if (single) {
      const results = await applyPriceUpdates([single], shopId, detectedLanguage, requestId);
      await sendMessageViaAPI(From, results.message);
      return;
    }
  }

  const segments = userText
    .split(BULK_SPLIT)
    .map(s => s.trim())
    .filter(Boolean);

  if (segments.length > 1) {
    const pairs = segments.map(parseSegment).filter(Boolean);
    if (pairs.length > 0) {
      const results = await applyPriceUpdates(pairs, shopId, detectedLanguage, requestId);
      await sendMessageViaAPI(From, results.message);
      return;
    }
  }

  // 2) If neither AI nor fallback parsed anything
  const errorMessage =
    'Invalid format. Use:\n' +
    '• Single: "update price milk 60"\n' +
    '• Multiple: "update price milk 60, sugar 30, Parle-G 50"\n' +
    '  (You can also separate with: and / aur / और / & / ;)\n' +
    'You may also say prices in words (e.g., "milk sixty two") — I will convert them.';
  const formatted = await generateMultiLanguageResponse(errorMessage, detectedLanguage, requestId);
  await sendMessageViaAPI(From, formatted);
}

// Helper that applies updates and builds a localized summary
async function applyPriceUpdates(items, shopId, detectedLanguage, requestId) {
  try {
    const allProducts = await getAllProducts();
    const map = new Map(allProducts.map(p => [p.name.toLowerCase(), p]));

    const lines = [];
    let updated = 0, created = 0, failed = 0;

    for (const { product, price } of items) {
      try {
        const key = product.toLowerCase();
        const existing = map.get(key);
        if (existing) {
          const res = await updateProductPrice(existing.id, price);
          if (res.success) {
            updated++;
            lines.push(`• ${product}: ₹${price} — ✅ updated`);
          } else {
            failed++;
            lines.push(`• ${product}: ₹${price} — ❌ ${res.error || 'update failed'}`);
          }
        } else {
          const res = await upsertProduct({ name: product, price, unit: 'pieces' });
          if (res.success) {
            created++;
            map.set(key, { id: res.id, name: product, price });
            lines.push(`• ${product}: ₹${price} — ✅ created`);
          } else {
            failed++;
            lines.push(`• ${product}: ₹${price} — ❌ ${res.error || 'create failed'}`);
          }
        }
      } catch (err) {
        failed++;
        lines.push(`• ${product}: ₹${price} — ❌ ${err.message}`);
      }
    }

    let summary = '✅ Price updates processed:\n\n' + (lines.join('\n') || 'No valid items found.');
    summary += `\n\nUpdated: ${updated}`;
    summary += `  •  Created: ${created}`;
    if (failed > 0) summary += `  •  Failed: ${failed}`;

    const formatted = await generateMultiLanguageResponse(summary, detectedLanguage, requestId);
    return { message: formatted };
  } catch (err) {
    console.error(`[${requestId}] applyPriceUpdates error:`, err.message);
    const fallback = await generateMultiLanguageResponse(
      'System error while applying price updates. Please try again.',
      detectedLanguage,
      requestId
    );
    return { message: fallback };
  }
}
// === END: handlePriceUpdate ===






// Send price list to user
async function sendPriceList(From, detectedLanguage, requestId) {
  try {
    const products = await getAllProducts();
    
    if (products.length === 0) {
      const noProductsMessage = 'No products found in price list.';
      const formattedMessage = await generateMultiLanguageResponse(noProductsMessage, detectedLanguage, requestId);
      await sendMessageViaAPI(From, formattedMessage);
      return;
    }
    
    let message = '📋 Current Price List:\n\n';
    products.forEach(product => {
      message += `• ${product.name}: ₹${product.price}/${product.unit}\n`;
    });
    
    const formattedMessage = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, formattedMessage);
  } catch (error) {
    console.error(`[${requestId}] Error sending price list:`, error.message);
    const errorMessage = 'Error fetching price list. Please try again.';
    const formattedMessage = await generateMultiLanguageResponse(errorMessage, detectedLanguage, requestId);
    await sendMessageViaAPI(From, formattedMessage);
  }
}

// Schedule daily price update reminder at 8 AM
function schedulePriceUpdateReminder() {
  const now = new Date();
  const targetTime = new Date();
  
  // Set to 8 AM IST (2:30 UTC)
  targetTime.setUTCHours(2, 30, 0, 0);
  
  // If we've passed 2:30 UTC today, schedule for tomorrow
  if (now > targetTime) {
    targetTime.setUTCDate(targetTime.getUTCDate() + 1);
  }
  
  const msUntilTarget = targetTime - now;
  
  console.log(`Scheduling price update reminder for ${targetTime.toISOString()} (in ${msUntilTarget}ms)`);
  
  setTimeout(() => {
    sendPriceUpdateReminders()
      .then(() => {
        // Schedule for next day
        schedulePriceUpdateReminder();
      })
      .catch(error => {
        console.error('Price update reminder job failed:', error.message);
        // Retry in 1 hour
        setTimeout(schedulePriceUpdateReminder, 60 * 60 * 1000);
      });
  }, msUntilTarget);
}

// Send price update reminders to all shops
async function sendPriceUpdateReminders() {
  try {
    console.log('Starting price update reminder job...');
    
    // Get all shop IDs
    const shopIds = await getAllShopIDs();
    console.log(`Found ${shopIds.length} shops to process`);
    
    if (shopIds.length === 0) {
      console.log('No shops found to process');
      return;
    }
    
    // Get products needing price updates
    const productsNeedingUpdate = await getProductsNeedingPriceUpdate();
    console.log(`Found ${productsNeedingUpdate.length} products needing price updates`);
    
    if (productsNeedingUpdate.length === 0) {
      console.log('No products need price updates');
      return;
    }
    
    // Process shops with concurrency limit
    const concurrencyLimit = 5;
    const results = [];
    
    for (let i = 0; i < shopIds.length; i += concurrencyLimit) {
      const batch = shopIds.slice(i, i + concurrencyLimit);
      console.log(`Processing batch of ${batch.length} shops (${i + 1}-${i + batch.length} of ${shopIds.length})`);
      
      const batchPromises = batch.map(async (shopId) => {
        try {
          // Get user's preferred language
          let userLanguage = 'en';
          try {
            const userPref = await getUserPreference(shopId);
            if (userPref.success) {
              userLanguage = userPref.language;
            }
          } catch (error) {
            console.warn(`Failed to get user preference for shop ${shopId}:`, error.message);
          }
          
          // Create reminder message
          let message = '📢 Daily Price Update Reminder\n\n';
          message += 'Please check if prices have changed for any of these items:\n\n';
          
          // List first 5 products needing update
          productsNeedingUpdate.slice(0, 5).forEach(product => {
            message += `• ${product.name}: Currently ₹${product.currentPrice}/${product.unit}\n`;
          });
          
          if (productsNeedingUpdate.length > 5) {
            message += `\n... and ${productsNeedingUpdate.length - 5} more items`;
          }
          
          message += '\n\nTo update prices, reply with:\n';
          message += '"update price [product_name] [new_price]"\n\n';
          message += 'Example: "update price milk 60"';
          
          const formattedMessage = await generateMultiLanguageResponse(message, userLanguage, 'price-reminder');
          
          // Send reminder
          await sendMessageViaAPI(`whatsapp:${shopId}`, formattedMessage);
          
          return { shopId, success: true };
          
        } catch (error) {
          console.error(`Error processing shop ${shopId}:`, error.message);
          return { shopId, success: false, error: error.message };
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error('Unexpected error in batch processing:', result.reason);
        }
      }
      
      // Add a small delay between batches to avoid rate limiting
      if (i + concurrencyLimit < shopIds.length) {
        console.log('Pausing between batches to avoid rate limiting...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Calculate success statistics
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    console.log(`Price update reminder job completed: ${successCount} sent, ${failureCount} failed`);
    
    return results;
  } catch (error) {
    console.error('Error in price update reminder job:', error.message);
    throw error;
  }
}

// Start the scheduler when the module loads
schedulePriceUpdateReminder();

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
    
      if (allPendingPrice(results)) {
        try {
          await setUserState(from, 'correction', {
            correctionState: {
              correctionType: 'price',
              pendingUpdate: results[0],
              detectedLanguage,
              id: results[0]?.correctionId
            }
          });
        } catch (_) {}
        // Price prompt already sent; do not send "Updates processed".
        return res.send(response.toString());
      }
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
    let totalSalesValue = 0;
    let totalPurchaseValue = 0;

    for (const result of results.filter(r => !r.needsPrice)) {
      if (result.success) {
        successCount++;
        const unitText = result.unit ? ` ${result.unit}` : '';

        // Calculate value for this result using enriched object
        let value = 0;
        if (result.action === 'purchased' && result.purchasePrice) {
          value = Math.abs(result.quantity) * result.purchasePrice;
        } else if (result.action === 'sold' && result.salePrice) {
          value = Math.abs(result.quantity) * result.salePrice;
        }

        // Accumulate totals
        if (result.action === 'purchased') {
          totalPurchaseValue += value;
        } else if (result.action === 'sold') {
          totalSalesValue += value;
        }

        // Show "Price updated" line for purchases that carried a rate
        if (result.action === 'purchased' && (result.purchasePrice || 0) > 0) {
         baseMessage += `Price updated: ${result.product} at ₹${(result.purchasePrice).toFixed(2)}/${singularize(result.unit)}\n`;
        }

        // Format based on action type
        if (result.action === 'purchased') {
          baseMessage += `• ${result.product}: ${result.quantity}${unitText} purchased (Stock: ${result.newQuantity}${unitText})`;
          if (value > 0) {
            baseMessage += ` (Value: ₹${value.toFixed(2)})`;
          }
          baseMessage += `\n`;
          if (result.batchDate) {
            baseMessage += `  Batch added: ${formatDateForDisplay(result.batchDate)}\n`;
          }
        } else if (result.action === 'sold') {
          baseMessage += `• ${result.product}: ${Math.abs(result.quantity)}${unitText} sold (Stock: ${result.newQuantity}${unitText})`;
          if (value > 0) {
            baseMessage += ` (Value: ₹${value.toFixed(2)})`;
          }
          baseMessage += `\n`;
          hasSales = true;
        } else if (result.action === 'remaining') {
          baseMessage += `• ${result.product}: ${result.quantity}${unitText} remaining (Stock: ${result.newQuantity}${unitText})\n`;
        }
      } else {
        baseMessage += `• ${result.product}: Error - ${result.error}\n`;
      }
    }

    baseMessage += `\n✅ Successfully updated ${successCount} of ${updates.length} items`;
    // Add summary values
    if (totalSalesValue > 0) {
      baseMessage += `\n💰 Total sales value: ₹${(totalSalesValue).toFixed(2)}`;
    }
    if (totalPurchaseValue > 0) {
      baseMessage += `\n📦 Total purchase value: ₹${(totalPurchaseValue).toFixed(2)}`;
    }
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
  }
catch (error) {
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
  
  // Save to database
  const shopId = from.replace('whatsapp:', '');
  await savePendingTranscription(shopId, transcript, detectedLanguage);
  
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
4 – All wrong, I'll type it instead`,
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
      `"${ffmpegPath}" -i /tmp/input.ogg -ar 16000 -ac 1 -c:a flac -compression_level 5 /tmp/output.flac`,
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
    
    console.log(`[sendMessageViaAPI] Preparing to send message to: ${formattedTo}`);
    console.log(`[sendMessageViaAPI] Message length: ${body.length} characters`);
    
    // Check if the message exceeds the WhatsApp limit (1600 characters)
    const MAX_LENGTH = 1600;
    if (body.length <= MAX_LENGTH) {
      const message = await client.messages.create({
        body: body,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: formattedTo
      });
      console.log(`[sendMessageViaAPI] Message sent successfully. SID: ${message.sid}`);
      return message;
    } else {
      // Split the message into chunks
      const chunks = splitMessage(body, MAX_LENGTH);
      console.log(`[sendMessageViaAPI] Splitting message into ${chunks.length} chunks`);
      
      const messageSids = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        // Add part indicator for multi-part messages
        const partIndicator = `\n\n(Part ${i+1} of ${chunks.length})`;
        const chunkWithIndicator = chunk + partIndicator;

        console.log(`[sendMessageViaAPI] Sending part ${i+1}/${chunks.length} (${chunkWithIndicator.length} chars)`);
        
        const message = await client.messages.create({
          body: chunkWithIndicator,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: formattedTo
        });
        messageSids.push(message.sid);
        console.log(`[sendMessageViaAPI] Part ${i+1} sent successfully. SID: ${message.sid}`);
        
        // Add a small delay between parts to avoid rate limiting
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Return the first message SID as the primary one
      return { sid: messageSids[0], parts: messageSids };
    }
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
    
// 🌐 Try multilingual quick-queries (normalize to English) BEFORE parsing updates
    try {
      const normalized = await normalizeCommandText(cleanTranscript, detectedLanguage, requestId + ':normalize');
      const handled = await handleQuickQueryEN(normalized, From, detectedLanguage, requestId);
      if (handled) return; // reply already sent
    } catch (e) {
      console.warn(`[${requestId}] Quick-query (voice) normalization failed, falling back.`, e?.message);
    }
    
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
      
      // FIX: Set confirmation state before sending the request
      await setUserState(From, 'confirmation', {
        pendingTranscript: cleanTranscript,
        detectedLanguage,
        confidence,
        type: 'voice_confirmation'
      });
      
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
      return;
    } else {
      console.log(`[${requestId}] [5.5] High confidence (${confidence}), proceeding without confirmation...`);
      // Parse the transcript
      const updates = await parseMultipleUpdates(cleanTranscript);
    // Check if any updates are for unknown products
    const unknownProducts = updates.filter(u => !u.isKnown);
    if (unknownProducts.length > 0) {
      console.log(`[${requestId}] Found ${unknownProducts.length} unknown products, requesting confirmation`);
      
      // FIX: Set confirmation state before sending the request
      await setUserState(From, 'confirmation', {
        pendingTranscript: cleanTranscript,
        detectedLanguage,
        confidence: 1.0, // High confidence since we're confirming product
        type: 'product_confirmation',
        unknownProducts
      });
      
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
    
    // Handle numeric responses for product correction
    if (['1', '2', '3', '4'].includes(Body.trim())) {
      const pending = globalState.pendingProductUpdates[From];
      if (!pending) {
        console.log(`[${requestId}] No pending update found for correction response: ${Body.trim()}`);
        return;
      }
      
      console.log(`[${requestId}] Processing correction response: ${Body.trim()} for pending update:`, pending.update);
      
      let correctionType = '';
      let correctionMessage = '';
      
      switch (Body.trim()) {
        case '1':
          correctionType = 'product';
          correctionMessage = 'Please type the correct product name.';
          break;
        case '2':
          correctionType = 'quantity';
          correctionMessage = 'Please type the correct quantity and unit. Example: "5 packets"';
          break;
        case '3':
          correctionType = 'action';
          correctionMessage = 'Please specify if it was purchased, sold, or remaining.';
          break;
        case '4':
          correctionType = 'all';
          correctionMessage = 'Please type the full update. Example: "Milk purchased - 5 litres"';
          break;
      }
      
      console.log(`[${requestId}] Saving correction state to database:`, {
        shopId: From.replace('whatsapp:', ''),
        correctionType,
        pendingUpdate: pending.update,
        detectedLanguage: pending.detectedLanguage
      });
      
      // Save correction state to database
      const shopId = From.replace('whatsapp:', '');
      const saveResult = await saveCorrectionState(shopId, correctionType, pending.update, pending.detectedLanguage);
      
      if (saveResult.success) {
        console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id}`);
        
        // FIX: Set correction state
        await setUserState(From, 'correction', {
          correctionState: {
            correctionType,
            pendingUpdate: pending.update,
            detectedLanguage: pending.detectedLanguage,
            id: saveResult.id
          }
        });
      }
      
      // Send correction message via API
      const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
      await client.messages.create({
        body: correctionMessage,
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: From
      });
      
      return;
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
        
        // FIX: Set greeting state
        await setUserState(From, 'greeting', { greetingLang });
        
        // Get user preference
        let userPreference = 'voice'; // Default to voice
        if (globalState.userPreferences[From]) {
          userPreference = globalState.userPreferences[From];
          console.log(`[${requestId}] User preference: ${userPreference}`);
        }
        
        // Use predefined greeting messages to avoid translation API calls
        const greetingMessages = {
          'hi': `नमस्ते! मैं देखता हूं कि आप ${userPreference} द्वारा अपडेट भेजना पसंद करते हैं। आज मैं आपकी कैसे मदद कर सकता हूं?\n\nNamaste! Main dekhta hoon ki aap ${userPreference} dwara update bhejna pasand karte hain. Aaj main aapki kaise madad kar sakta hoon?`,
          'bn': `হ্যালো! আমি দেখতে পাচ্ছি আপনি ${userPreference} দিয়ে আপডেট পাঠাতে পছন্দ করেন। আজ আমি আপনাকে কিভাবে সাহায্য করতে পারি?\n\nHello! Ami dekhte pachchi apni ${userPreference} diye update pathate pochondo koren. Aaj ami apnike kivabe sahaj korte pari?`,
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
       
    
    // Detect language and save preference
    let detectedLanguage = conversationState ? conversationState.language : 'en';
    detectedLanguage = await checkAndUpdateLanguage(Body, From, detectedLanguage, requestId);

    // 🌐 Any-language quick-queries: normalize to English BEFORE any inventory parsing
    try {   
      const normalized = await normalizeCommandText(Body, detectedLanguage, requestId + ':normalize');
      const handledQuick = await handleQuickQueryEN(normalized, From, detectedLanguage, requestId);
      if (handledQuick) return;
    } catch (e) {
      console.warn(`[${requestId}] Quick-query (EN) handling failed, continuing to parser.`, e?.message);
    }

    console.log(`[${requestId}] Attempting to parse as inventory update (no quick-query match)`);

    console.log(`[${requestId}] Detected language for text update: ${detectedLanguage}`);
    
    // Try to parse as inventory update
    const updates = await parseMultipleUpdates(Body);
    if (updates.length > 0) {
      console.log(`[${requestId}] Parsed ${updates.length} updates from text message`);
      
      // Check if any updates are for unknown products
      const unknownProducts = updates.filter(u => !u.isKnown);
      if (unknownProducts.length > 0) {
        console.log(`[${requestId}] Found ${unknownProducts.length} unknown products, requesting confirmation`);
        
        // FIX: Set confirmation state before sending the request
        await setUserState(From, 'confirmation', {
          pendingTranscript: Body,
          detectedLanguage,
          confidence: 1.0, // High confidence since we're confirming product
          type: 'product_confirmation',
          unknownProducts
        });
        
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
  
  await handleRequest(req, res, response, requestId, requestStart);
};

  async function handleRequest(req, res, response, requestId, requestStart) {  
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
    const shopId = From.replace('whatsapp:', '');

    // AUTHENTICATION CHECK FIRST
    // =========================
    console.log(`[${requestId}] Checking authentication for ${shopId}`);
    const authCheck = await checkUserAuthorization(From, Body, requestId);
    
    if (!authCheck.authorized) {
      console.log(`[${requestId}] User ${shopId} is not authorized`);
      await sendUnauthorizedResponse(From, requestId);
      res.send('<Response></Response>');
      return;
    }
    
    // If user just authenticated, send success message
    if (authCheck.justAuthenticated) {
      console.log(`[${requestId}] User ${shopId} just authenticated successfully`);
      await sendAuthSuccessResponse(From, authCheck.user, requestId);
      res.send('<Response></Response>');
      return;
    }
    
    console.log(`[${requestId}] User ${shopId} is authorized, proceeding with request`);

    if (authCache.has(shopId) && Date.now() - authCache.get(shopId) < 5000) {
      console.log(`[${requestId}] Skipping duplicate processing for ${shopId}`);
      res.send('<Response></Response>');
      return;
    }
    
    // ADD BUTTON HANDLING HERE - RIGHT AFTER AUTHENTICATION
    // Handle button responses
    if (ButtonText) {
      console.log(`[${requestId}] Button response received: "${ButtonText}"`);
      
      // Get user's preferred language
      let userLanguage = 'en';
      try {
        const userPref = await getUserPreference(shopId);
        if (userPref.success) {
          userLanguage = userPref.language;
        }
      } catch (error) {
        console.warn(`[${requestId}] Failed to get user preference:`, error.message);
      }
      
      // Handle summary buttons
      if (ButtonText === 'Instant Summary' || ButtonText === 'तत्काल सारांश' || ButtonText === 'তাত্ক্ষণিক সারসংক্ষেপ' || 
          ButtonText === 'உடனடிச் சுருக்கம்' || ButtonText === 'తక్షణ సారాంశం' || ButtonText === 'ತಕ್ಷಣ ಸಾರಾಂಶ' || 
          ButtonText === 'તાત્કાલિક સારાંશ' || ButtonText === 'त्वरित सारांश') {
        // Instant summary
        const summary = await generateInstantSummary(shopId, userLanguage, requestId);
        await sendMessageViaAPI(From, summary);
        res.send('<Response></Response>');
        return;
      } else if (ButtonText === 'Detailed Summary' || ButtonText === 'विस्तृत सारांश' || ButtonText === 'বিস্তারিত সারসংক্ষেপ' || 
                 ButtonText === 'விரிவான சுருக்கம்' || ButtonText === 'వివరణాత్మక సారాంశం' || ButtonText === 'ವಿಸ್ತೃತ ಸಾರಾಂಶ' || 
                 ButtonText === 'વિગતવાર સારાંશ' || ButtonText === 'तपशीलवार सारांश') {
        // Full summary
        const generatingMessage = await generateMultiLanguageResponse(
          'Generating your detailed summary with insights... This may take a moment.',
          userLanguage,
          requestId
        );
        
        // Send initial message
        await sendMessageViaAPI(From, generatingMessage);
        
        // Generate and send full summary
        const fullSummary = await generateFullScaleSummary(shopId, userLanguage, requestId);
        await sendMessageViaAPI(From, fullSummary);
        res.send('<Response></Response>');
        return;
      }
    }
    
    // STATE-AWARE PROCESSING START
    // ============================
    
    // 1. Handle explicit reset commands FIRST (highest priority)
    if (Body && RESET_COMMANDS.some(cmd => Body.toLowerCase().includes(cmd))) {
      console.log(`[${requestId}] Explicit reset command detected: "${Body}"`);
      
      // Clear ALL states
      await clearUserState(From);
      if (globalState.conversationState && globalState.conversationState[From]) {
        delete globalState.conversationState[From];
      }
      if (globalState.pendingProductUpdates && globalState.pendingProductUpdates[From]) {
        delete globalState.pendingProductUpdates[From];
      }
      
      // Clear correction state from database
      try {
        const correctionStateResult = await getCorrectionState(shopId);
        if (correctionStateResult.success && correctionStateResult.correctionState) {
          await deleteCorrectionState(correctionStateResult.correctionState.id);
          console.log(`[${requestId}] Cleared correction state during reset`);
        }
      } catch (error) {
        console.warn(`[${requestId}] Failed to clear correction state:`, error.message);
      }
      
      // Send reset confirmation
      const detectedLanguage = await detectLanguageWithFallback(Body, From, requestId);
      const resetMessage = await generateMultiLanguageResponse(
        'Flow has been reset. How would you like to send your inventory update?',
        detectedLanguage,
        requestId
      );
      
      await sendMessageViaAPI(From, resetMessage);
      res.send('<Response></Response>');
      return;
    }
    
    // 2. Get current user state
    console.log(`[${requestId}] Checking state for ${From} in database...`);
    const currentState = await getUserState(From);
    console.log(`[${requestId}] Current state for ${From}:`, currentState ? currentState.mode : 'none');
    
    // 3. Handle based on current state
    if (currentState) {
    switch (currentState.mode) {
      case 'greeting':
        await handleGreetingResponse(Body, From, currentState, requestId, res);
        return;
        
      case 'correction':
        await handleCorrectionState(Body, From, currentState, requestId, res);
        return;
        
      case 'confirmation':
        if (currentState.data.type === 'voice_confirmation') {
          await handleVoiceConfirmationState(Body, From, currentState, requestId, res);
        } else if (currentState.data.type === 'text_confirmation') {
          await handleTextConfirmationState(Body, From, currentState, requestId, res);
        } else if (currentState.data.type === 'product_confirmation') {
          await handleProductConfirmationState(Body, From, currentState, requestId, res);
        } else {
          await handleConfirmationState(Body, From, currentState, requestId, res);
        }
        return;
        
      case 'inventory':
        await handleInventoryState(Body, From, currentState, requestId, res);
        return;
    }
  }
    
    // 4. No active state - process as new interaction
    await handleNewInteraction(Body, MediaUrl0, NumMedia, From, requestId, res);
    
  } catch (error) {
    console.error(`[${requestId}] Processing Error:`, error.message);
    const errorMessage = await generateMultiLanguageResponse(
      'System error. Please try again with a clear message.',
      'en',
      requestId
    );
    response.message(errorMessage);
    res.send(response.toString());
  }
};

// Simple confirmation function for corrected updates
async function confirmCorrectedUpdate(update, from, detectedLanguage, requestId) {
  const response = new twilio.twiml.MessagingResponse();
  
  const confirmationMessage = `I heard: "${update.quantity} ${update.unit} of ${update.product}" (${update.action}).  
Is this correct?  
Reply with "yes" or "no".`;
  
  await sendSystemMessage(confirmationMessage, from, detectedLanguage, requestId, response);
  
  // Store the update temporarily in global state with a different key
  const shopId = from.replace('whatsapp:', '');
  if (!globalState.correctedUpdates) {
    globalState.correctedUpdates = {};
  }
  globalState.correctedUpdates[shopId] = {
    update,
    detectedLanguage,
    timestamp: Date.now()
  };
  
  return response.toString();
}

async function handleCorrectionState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling correction state with input: "${Body}"`);
  
  const shopId = From.replace('whatsapp:', '');
  const correctionState = state.data.correctionState;
  
  // Check if user is trying to exit correction mode
  if (Body && ['exit', 'cancel', 'reset', 'start over'].some(cmd => Body.toLowerCase().includes(cmd))) {
    console.log(`[${requestId}] User exiting correction mode`);
    
    // Clear correction state
    await deleteCorrectionState(correctionState.id);
    await clearUserState(From);
    
    const exitMessage = await generateMultiLanguageResponse(
      'Correction cancelled. You can start fresh with a new inventory update.',
      correctionState.detectedLanguage,
      requestId
    );
    
    await sendMessageViaAPI(From, exitMessage);
    res.send('<Response></Response>');
    return;
  }

  if (correctionState.correctionType === 'price') {
  const priceMatch = Body.trim().match(/(\d+(\.\d+)?)/);
  const priceValue = priceMatch ? parseFloat(priceMatch[1]) : NaN;

  if (!isNaN(priceValue) && priceValue > 0) {
    const updated = {
      ...correctionState.pendingUpdate,
      price: priceValue
    };

    const results = await updateMultipleInventory(shopId, [updated], correctionState.detectedLanguage);

    if (results[0].success) {
    await deleteCorrectionState(correctionState.id);
    await clearUserState(From);
  
    const result = results[0];
    const unitText = result.unit ? ` ${result.unit}` : '';
    const value = priceValue * result.quantity;
  
    let message = `✅ Price updated: ${result.product} at ₹${priceValue}/${result.unit}\n\n`;
  
    message += `✅ Updates processed:\n\n• ${result.product}: ${result.quantity}${unitText} ${result.action} (Stock: ${result.newQuantity}${unitText})`;
  
    if (result.action === 'sold') {
      message += `\n💰 Total sales value: ₹${value.toFixed(2)}`;
    } else if (result.action === 'purchased') {
      message += `\n📦 Total purchase value: ₹${value.toFixed(2)}`;
    }
  
    const translated = await generateMultiLanguageResponse(message, correctionState.detectedLanguage, requestId);
    await sendMessageViaAPI(From, translated);
  } else {
      let message = `❌ Update failed: ${results[0].error ?? 'Unknown error'}\nPlease try again.`;
      const translated = await generateMultiLanguageResponse(message, correctionState.detectedLanguage, requestId);
      await sendMessageViaAPI(From, translated);
    }

    return;
  } else {
    const retryMessage = await generateMultiLanguageResponse(
      'Please enter a valid price (e.g., 15 or 20.5)',
      correctionState.detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, retryMessage);
    return;
  }
} else {
      const retryMessage = await generateMultiLanguageResponse(
        'Please enter a valid price (e.g., 15 or 20.5)',
        correctionState.detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, retryMessage);
      res.send('<Response></Response>');
      return;
    }
  
  // Process correction based on type
  if (correctionState.correctionType === 'selection') {
    // Handle 1,2,3,4 selection
    if (['1', '2', '3', '4'].includes(Body.trim())) {
      let newCorrectionType = '';
      let followUpMessage = '';
      
      switch (Body.trim()) {
        case '1':
          newCorrectionType = 'product';
          followUpMessage = 'Please type the correct product name.';
          break;
        case '2':
          newCorrectionType = 'quantity';
          followUpMessage = 'Please type the correct quantity and unit. Example: "5 packets"';
          break;
        case '3':
          newCorrectionType = 'action';
          followUpMessage = 'Please specify if it was purchased, sold, or remaining.';
          break;
        case '4':
          newCorrectionType = 'all';
          followUpMessage = 'Please type the full update. Example: "Milk purchased - 5 litres"';
          break;
      }
      
      // Update correction state
      const updateResult = await saveCorrectionState(
        shopId, 
        newCorrectionType, 
        correctionState.pendingUpdate, 
        correctionState.detectedLanguage
      );
      
      if (updateResult.success) {
        // Update user state
        await setUserState(From, 'correction', {
          correctionState: {
            ...correctionState,
            correctionType: newCorrectionType,
            id: updateResult.id
          }
        });
        
        const translatedMessage = await generateMultiLanguageResponse(
          followUpMessage,
          correctionState.detectedLanguage,
          requestId
        );
        
        await sendMessageViaAPI(From, translatedMessage);
      }
    } else {
      // Invalid selection
      const errorMessage = await generateMultiLanguageResponse(
        'Please reply with 1, 2, 3, or 4. Or type "exit" to cancel.',
        correctionState.detectedLanguage,
        requestId
      );
      
      await sendMessageViaAPI(From, errorMessage);
    }
  } else {
    // Handle actual correction data (product name, quantity, etc.)
    let correctedUpdate = { ...correctionState.pendingUpdate };
    let isValidInput = true;
    
    switch (correctionState.correctionType) {
      case 'product':
        if (Body.trim().length > 0) {
          correctedUpdate.product = Body.trim();
        } else {
          isValidInput = false;
        }
        break;
      case 'quantity':
        try {
          const quantityUpdate = await parseMultipleUpdates(Body);
          if (quantityUpdate.length > 0) {
            correctedUpdate.quantity = quantityUpdate[0].quantity;
            correctedUpdate.unit = quantityUpdate[0].unit;
          } else {
            isValidInput = false;
          }
        } catch (error) {
          console.error(`[${requestId}] Error parsing quantity correction:`, error.message);
          isValidInput = false;
        }
        break;
      case 'action':
        const lowerBody = Body.toLowerCase();
        if (lowerBody.includes('purchased') || lowerBody.includes('bought')) {
          correctedUpdate.action = 'purchased';
        } else if (lowerBody.includes('sold')) {
          correctedUpdate.action = 'sold';
        } else if (lowerBody.includes('remaining')) {
          correctedUpdate.action = 'remaining';
        } else {
          isValidInput = false;
        }
        break;
      case 'all':
        try {
          const fullUpdate = await parseMultipleUpdates(Body);
          if (fullUpdate.length > 0) {
            correctedUpdate = fullUpdate[0];
          } else {
            isValidInput = false;
          }
        } catch (error) {
          console.error(`[${requestId}] Error parsing full update correction:`, error.message);
          isValidInput = false;
        }
        break;
    }
    
    if (isValidInput) {
      // Move to confirmation state
      await setUserState(From, 'confirmation', {
        correctedUpdate,
        detectedLanguage: correctionState.detectedLanguage,
        originalCorrectionId: correctionState.id
      });
      
      const confirmationMessage = await generateMultiLanguageResponse(
        `I heard: "${correctedUpdate.quantity} ${correctedUpdate.unit} of ${correctedUpdate.product}" (${correctedUpdate.action}).  
Is this correct? Reply with "yes" or "no".`,
        correctionState.detectedLanguage,
        requestId
      );
      
      await sendMessageViaAPI(From, confirmationMessage);
    } else {
      // Invalid input - ask again
      let retryMessage = '';
      switch (correctionState.correctionType) {
        case 'product':
          retryMessage = 'Please provide a valid product name.';
          break;
        case 'quantity':
          retryMessage = 'Please provide a valid quantity and unit. Example: "5 packets"';
          break;
        case 'action':
          retryMessage = 'Please specify "purchased", "sold", or "remaining".';
          break;
        case 'all':
          retryMessage = 'Please provide a valid inventory update. Example: "Milk purchased - 5 litres"';
          break;
      }
      
      const translatedMessage = await generateMultiLanguageResponse(
        retryMessage,
        correctionState.detectedLanguage,
        requestId
      );
      
      await sendMessageViaAPI(From, translatedMessage);
    }
  }
  
  res.send('<Response></Response>');
}

async function handleConfirmationState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling confirmation state with input: "${Body}"`);
  
  const { correctedUpdate, detectedLanguage, originalCorrectionId } = state.data;
  const shopId = From.replace('whatsapp:', '');
  
  const yesVariants = ['yes', 'haan', 'हाँ', 'ha', 'ok', 'okay'];
  const noVariants = ['no', 'nahin', 'नहीं', 'nahi', 'cancel'];
  
  if (yesVariants.includes(Body.toLowerCase())) {
    // Process the confirmed update
    const results = await updateMultipleInventory(shopId, [correctedUpdate], detectedLanguage);
    
    let message = '✅ Update processed:\n\n';
    let successCount = 0;
    
    for (const result of results) {
      if (result.success) {
        successCount++;
        const unitText = result.unit ? ` ${result.unit}` : '';
        message += `• ${result.product}: ${result.quantity} ${unitText} ${result.action} (Stock: ${result.newQuantity}${unitText})\n`;
      } else {
        message += `• ${result.product}: Error - ${result.error}\n`;
      }
    }
    
    message += `\n✅ Successfully updated ${successCount} of 1 item`;
    
    const formattedResponse = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, formattedResponse);
    
    // Clean up
    await deleteCorrectionState(originalCorrectionId);
    await clearUserState(From);
    
  } else if (noVariants.includes(Body.toLowerCase())) {
    // Go back to correction selection
    const correctionMessage = await generateMultiLanguageResponse(
      `Please try again. What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`,
      detectedLanguage,
      requestId
    );
    
    // Update correction state back to selection
    await saveCorrectionState(shopId, 'selection', correctedUpdate, detectedLanguage);
    await setUserState(From, 'correction', {
      correctionState: {
        correctionType: 'selection',
        pendingUpdate: correctedUpdate,
        detectedLanguage,
        id: originalCorrectionId
      }
    });
    
    await sendMessageViaAPI(From, correctionMessage);
  } else {
    // Invalid response
    const errorMessage = await generateMultiLanguageResponse(
      'Please reply with "yes" or "no".',
      detectedLanguage,
      requestId
    );
    
    await sendMessageViaAPI(From, errorMessage);
  }
  
  res.send('<Response></Response>');
}

async function handleInventoryState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling inventory state with input: "${Body}"`);
  
  const { updates, detectedLanguage } = state.data;
  const shopId = From.replace('whatsapp:', '');
  
  // Process the updates
  try {
    const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
    
    if (allPendingPrice(results)) {
        try {
          await setUserState(From, 'correction', {
            correctionState: {
              correctionType: 'price',
              pendingUpdate: results[0],
              detectedLanguage,
              id: results[0]?.correctionId
            }
          });
        } catch (_) {}
        res.send('<Response></Response>');
        return;
      }

    let message = '✅ Updates processed:\n\n';
    let successCount = 0;
    
    for (const result of results.filter(r => !r.needsPrice)) {
      if (result.success) {
        successCount++;
        const unitText = result.unit ? ` ${result.unit}` : '';
        message += `• ${result.product}: ${result.quantity} ${unitText} ${result.action} (Stock: ${result.newQuantity}${unitText})\n`;
      } else {
        message += `• ${result.product}: Error - ${result.error}\n`;
      }
    }
    
    const totalProcessed = results.filter(r => !r.needsPrice).length;
    message += `\n✅ Successfully updated ${successCount} of ${totalProcessed} items`;
  
    const formattedResponse = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, formattedResponse);
    
    // Clear state after processing
    await clearUserState(From);
  } catch (error) {
    console.error(`[${requestId}] Error processing inventory updates:`, error.message);
    
    // If processing fails, try to parse the input again and enter correction flow
    try {
      const parsedUpdates = await parseMultipleUpdates(Body);
      let update;
      
      if (parsedUpdates.length > 0) {
        update = parsedUpdates[0];
      } else {
        // Create a default update object
        update = {
          product: Body,
          quantity: 0,
          unit: '',
          action: 'purchased',
          isKnown: false
        };
      }
      
      // Save correction state
      const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
      
      if (saveResult.success) {
        await setUserState(From, 'correction', {
          correctionState: {
            correctionType: 'selection',
            pendingUpdate: update,
            detectedLanguage,
            id: saveResult.id
          }
        });
        
        const correctionMessage = `I had trouble processing your update. What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
        
        const translatedMessage = await generateMultiLanguageResponse(correctionMessage, detectedLanguage, requestId);
        await sendMessageViaAPI(From, translatedMessage);
      } else {
        // If saving correction state fails, ask to retry
        const errorMessage = await generateMultiLanguageResponse(
          'Please try again with a clear inventory update.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
        await clearUserState(From);
      }
    } catch (parseError) {
      console.error(`[${requestId}] Error in fallback parsing:`, parseError.message);
      
      // If even fallback fails, ask to retry
      const errorMessage = await generateMultiLanguageResponse(
        'Please try again with a clear inventory update.',
        detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, errorMessage);
      await clearUserState(From);
    }
  }
  
  res.send('<Response></Response>');
}

async function handleNewInteraction(Body, MediaUrl0, NumMedia, From, requestId, res) {
  console.log(`[${requestId}] Handling new interaction`);
  const shopId = From.replace('whatsapp:', '');

   // ✅ Get user's language preference for personalized processing message
  let userLanguage = 'en';
  try {
    const userPref = await getUserPreference(shopId);
    if (userPref.success) {
      userLanguage = userPref.language;
    }
  } catch (error) {
    console.warn(`[${requestId}] Failed to get user preference:`, error.message);
  }
  
  // ✅ Send immediate "Processing..." response in user's language
  try {
    // Create processing message in native script + Roman transliteration
    const processingMessages = {
      'hi': `आपके संदेश को संसाधित किया जा रहा है...\n\nAapke sandesh ko sansadhit kiya ja raha hai...`,
      'bn': `আপনার বার্তা প্রক্রিয়া করা হচ্ছে...\n\nApnā bārtā prakriẏā karā haẏēchē...`,
      'ta': `உங்கள் செய்தி செயலாக்கப்படுகிறது...\n\nUṅkaḷ ceyti ceyalākkappaṭukiṟatu...`,
      'te': `మీ సందేశం ప్రాసెస్ అవుతోంది...\n\nMī sandēśaṁ prāsēs avutōndi...`,
      'kn': `ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಪ್ರಕ್ರಿಯೆಗೊಳಿಸಲಾಗುತ್ತಿದೆ...\n\nNim'ma sandēśavannu prakriyegoḷisalāguttide...`,
      'gu': `તમારા સંદેશને પ્રક્રિયા કરવામાં આવે છે...\n\nTamārā sandēśanē prakriyā karavāmāṁ āvē chē...`,
      'mr': `तुमचा संदेश प्रक्रिया केला जात आहे...\n\nTumcā sandēś prakriyā kēlā jāt āhē...`,
      'en': `Processing your message...`  // ✅ Only once for English
    };
    
    const processingMessage = processingMessages[userLanguage] || processingMessages['en'];
    
    await sendMessageViaAPI(From, processingMessage);
    
    // ✅ Add 2-second delay before actual processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
  } catch (error) {
    console.warn(`[${requestId}] Failed to send processing message:`, error.message);
  }

  
// NEW ✅: Detect language for this message; use it for command handlers & replies
  let detectedLanguage = userLanguage || 'en';
  try {
    detectedLanguage = await checkAndUpdateLanguage(Body || '', From, userLanguage, requestId);
  } catch (e) {
    console.warn(
      `[${requestId}] Language detection failed, defaulting to ${detectedLanguage}:`,
      e.message
    );
  }
  console.log(`[${requestId}] Using detectedLanguage=${detectedLanguage} for new interaction`);
  
  // --- Fallback: numeric-only message treated as a price reply if a price correction exists ---
   if (Body && /^\s*\d+(?:\.\d+)?\s*$/.test(Body)) {
     try {
       const csRes = await getCorrectionState(shopId);
       if (csRes && csRes.success && csRes.correctionState
           && csRes.correctionState.correctionType === 'price') {
         const priceValue = parseFloat(Body.trim());
         if (!Number.isNaN(priceValue) && priceValue > 0) {
           // pendingUpdate can be an object or a JSON string - normalize it
           let pendingUpdate = csRes.correctionState.pendingUpdate;
           if (typeof pendingUpdate === 'string') {
             try { pendingUpdate = JSON.parse(pendingUpdate); } catch (_) {}
           }
           // apply the price and process
           const detectedLanguage = csRes.correctionState.detectedLanguage || userLanguage || 'en';
           const updated = { ...pendingUpdate, price: priceValue };
           const results = await updateMultipleInventory(shopId, [updated], detectedLanguage);
   
           // clean up the correction record and any stale user state
           try { await deleteCorrectionState(csRes.correctionState.id); } catch (_) {}
           try { await clearUserState(From); } catch (_) {}
   
           // Build a short success/failure response (no need to over-message)
           let msg = '✅ Update processed:\n\n';
           const ok = results[0] && results[0].success;
           if (ok) {
             const r = results[0];
             const unitText = r.unit ? ` ${r.unit}` : '';
             msg += `• ${r.product}: ${r.quantity}${unitText} ${r.action} (Stock: ${r.newQuantity}${unitText})`;
           } else {
             msg += `• ${updated.product}: Error - ${results[0]?.error || 'Unknown error'}`;
           }
           const formatted = await generateMultiLanguageResponse(msg, detectedLanguage, requestId);
           await sendMessageViaAPI(From, formatted);
           res.send('<Response></Response>');
           return;
         }
       }
     } catch (e) {
       console.warn(`[${requestId}] Numeric price fallback failed:`, e.message);
       // continue with normal flow if fallback didn’t match
     }
   }

  // NEW ✅: Handle the "update price ..." command EARLY and safely pass detectedLanguage
  if (Body && /^\s*update\s+price\b/i.test(Body)) {
    try {
      // Assumes you already computed `detectedLanguage` earlier in this function.
      // If not, see “Heads‑up” below.
      await handlePriceUpdate(Body, From, detectedLanguage, requestId);
      // Prevent fall-through / double responses
      return res.send('<Response></Response>');
    } catch (err) {
      console.error(`[${requestId}] Error in handlePriceUpdate:`, err.message);
      const msg = await generateMultiLanguageResponse(
        'System error. Please try again with a clear message.',
        detectedLanguage || 'en',
        requestId
      );
      await sendMessageViaAPI(From, msg);
      return res.send('<Response></Response>');
    }
  }

  
  // Check for greetings
  if (Body) {
    const greetingLang = detectGreetingLanguage(Body);
    if (greetingLang) {
      console.log(`[${requestId}] Detected greeting in language: ${greetingLang}`);
      
      // Save user preference
      const shopId = From.replace('whatsapp:', '');
      await saveUserPreference(shopId, greetingLang);
      
      // Send welcome message with examples - no input method selection
      const welcomeMessage = await generateMultiLanguageResponse(
        `Welcome! I'm ready for your inventory update. You can send:
          • Voice or Text message: "5kg sugar purchased at 20rs/kg", "10 Parle-G sold at 10rs/packet"
          • Get an automated invoice pdf to send to customer upon a sale
          • Get instant summary: "summary"
          • Get detailed summary: "full summary"
          
          
          What would you like to update?`,
        greetingLang,
        requestId
      );
      
      await sendMessageViaAPI(From, welcomeMessage);
      res.send('<Response></Response>');
      return;
    }
  }
  
  // Handle voice messages
  if (NumMedia && MediaUrl0 && (NumMedia !== '0' && NumMedia !== 0)) {
    // Process voice asynchronously
    res.send('<Response><Message>Processing your voice message...</Message></Response>');
    processVoiceMessageAsync(MediaUrl0, From, requestId, null)
      .catch(error => {
        console.error(`[${requestId}] Error in async voice processing:`, error);
      });
    return;
  }
  
      // Handle text messages
      if (Body) {
        
      
// 🌐 Any-language quick-queries (normalize to English) BEFORE parsing as inventory update
    try {
      const normalized = await normalizeCommandText(Body, detectedLanguage, requestId + ':normalize');
      const handledQuick = await handleQuickQueryEN(normalized, From, detectedLanguage, requestId);
      if (handledQuick) {
        return res.send('<Response></Response>'); // reply already sent via API
      }
    } catch (e) {
      console.warn(`[${requestId}] Quick-query (normalize) routing failed; continuing.`, e?.message);
    }
  
        // Check for price management commands
        const lowerBody = Body.toLowerCase();
        
        if (lowerBody.includes('update price')) {
          await handlePriceUpdate(Body, From, detectedLanguage, requestId);
          return;
        }
        
        if (lowerBody.includes('price list') || lowerBody.includes('prices')) {
          await sendPriceList(From, detectedLanguage, requestId);
          return;
        }
        
        // Try to parse as inventory update
        const updates = await parseMultipleUpdates(Body);
        if (updates.length > 0) {
          console.log(`[${requestId}] Parsed ${updates.length} updates from text message`);
          
          // Set user state to inventory mode
          const detectedLanguage = await detectLanguageWithFallback(Body, From, requestId);
          await setUserState(From, 'inventory', { updates, detectedLanguage });
          
          // Process the updates
          const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
          // If every item is waiting for price, a prompt has already been sent.
              if (allPendingPrice(results)) {
                // Move user into 'correction' flow with price type so the next number goes to price handler.
                try {
                  await setUserState(From, 'correction', {
                    correctionState: {
                      correctionType: 'price',
                      pendingUpdate: results[0],
                      detectedLanguage,
                      id: results[0]?.correctionId
                    }
                  });
                } catch (_) {}
                res.send('<Response></Response>');
                return;
              }

      
      let message = '✅ Updates processed:\n\n';
      let successCount = 0;
      
      for (const result of results.filter(r => !r.needsPrice)) {
        if (result.success) {
          successCount++;
          const unitText = result.unit ? ` ${result.unit}` : '';
          message += `• ${result.product}: ${result.quantity} ${unitText} ${result.action} (Stock: ${result.newQuantity}${unitText})\n`;
        } else {
          message += `• ${result.product}: Error - ${result.error}\n`;
        }
      }
            
      const totalProcessed = results.filter(r => !r.needsPrice).length;
      message += `\n✅ Successfully updated ${successCount} of ${totalProcessed} items`

      
      const formattedResponse = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
      await sendMessageViaAPI(From, formattedResponse);
      
      // Clear state after processing
      await clearUserState(From);
      
      res.send('<Response></Response>');
      return;
    }
  }

  // In handleNewInteraction function, add this before the default response:

// Handle summary commands
if (Body) {
  const lowerBody = Body.toLowerCase();
  
  // Check for summary commands
  if (lowerBody.includes('summary')) {
    console.log(`[${requestId}] Summary command detected: "${Body}"`);
    
    // Get user's preferred language
    let userLanguage = 'en';
    try {
      const userPref = await getUserPreference(shopId);
      if (userPref.success) {
        userLanguage = userPref.language;
      }
    } catch (error) {
      console.warn(`[${requestId}] Failed to get user preference:`, error.message);
    }
    
    // Determine summary type
    if (lowerBody.includes('full')) {
      // Full summary
      // Flag to track if summary has been sent
      let summarySent = false;
      
      // Send initial "processing" message
      const generatingMessage = await generateMultiLanguageResponse(
        '🔍 Generating your detailed summary with insights... This may take a moment.',
        userLanguage,
        requestId
      );
      await sendMessageViaAPI(From, generatingMessage);
      
      // Schedule fun facts only if summary hasn't been sent
      setTimeout(async () => {
        if (!summarySent) {
          const tip1 = await generateMultiLanguageResponse(
            '💡 Tip: Products with expiry dates under 7 days are 3x more likely to go unsold. Consider bundling or discounting them! Detailed summary being generated...',
            userLanguage,
            requestId
          );
          await sendMessageViaAPI(From, tip1);
        }
      }, 10000);
      
      setTimeout(async () => {
        if (!summarySent) {
          const tip2 = await generateMultiLanguageResponse(
            '📦 Did you know? Low-stock alerts help prevent missed sales. Check your inventory weekly! Generating your summary right away...',
            userLanguage,
            requestId
          );
          await sendMessageViaAPI(From, tip2);
        }
      }, 30000);
      
      // Generate and send full summary
      const fullSummary = await generateFullScaleSummary(shopId, userLanguage, requestId);
      summarySent = true;
      await sendMessageViaAPI(From, fullSummary);
      
    } else {
      // Instant summary
      const instantSummary = await generateInstantSummary(shopId, userLanguage, requestId);
      await sendMessageViaAPI(From, instantSummary);
    }
    
    res.send('<Response></Response>');
    return;
  }
}
  
  // Default response for unrecognized input
  const defaultMessage = await generateMultiLanguageResponse(
    'Please send an inventory update like "10 Parle-G sold" or start with "Hello" for options.',
    'en',
    requestId
  );
  
  await sendMessageViaAPI(From, defaultMessage);
  res.send('<Response></Response>');
}

async function handleGreetingResponse(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling greeting response with input: "${Body}"`);
  
  const { greetingLang } = state.data;
  
  // Handle input method selection (though we're removing this requirement)
  if (Body === '1' || Body === '2' || Body.toLowerCase() === 'voice' || Body.toLowerCase() === 'text') {
    // Send confirmation that we're ready for input
    const readyMessage = await generateMultiLanguageResponse(
      `Perfect! Please send your inventory update now.`,
      greetingLang,
      requestId
    );
    
    await sendMessageViaAPI(From, readyMessage);
    
    // Clear the greeting state
    await clearUserState(From);
    
    res.send('<Response></Response>');
    return;
  }
  
  // If user sends something else, try to parse as inventory update
  const updates = await parseMultipleUpdates(Body);
  if (updates.length > 0) {
    console.log(`[${requestId}] Parsed ${updates.length} updates from text message`);
    
    const shopId = From.replace('whatsapp:', '');
    const detectedLanguage = await detectLanguageWithFallback(Body, From, requestId);
    const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
    
    let message = '✅ Updates processed:\n\n';
    let successCount = 0;
    
    for (const result of results) {
      if (result.success) {
        successCount++;
        const unitText = result.unit ? ` ${result.unit}` : '';
        message += `• ${result.product}: ${result.quantity} ${unitText} ${result.action} (Stock: ${result.newQuantity}${unitText})\n`;
      } else {
        message += `• ${result.product}: Error - ${result.error}\n`;
      }
    }
    
    message += `\n✅ Successfully updated ${successCount} of ${updates.length} items`;
    
    const formattedResponse = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, formattedResponse);
    
    // Clear state after processing
    await clearUserState(From);
  } else {
    // If not a valid update, send help message
    const helpMessage = await generateMultiLanguageResponse(
      `I didn't understand that. Please send an inventory update like "10 Parle-G sold".`,
      greetingLang,
      requestId
    );
    
    await sendMessageViaAPI(From, helpMessage);
  }
  
  res.send('<Response></Response>');
}

function extractProductName(fullText) {
  // Remove quantity indicators and units
  let cleaned = fullText
    .replace(/\b\d+\s*(kg|kgs|gram|grams|g|pack|packs|packet|packets|box|boxes|piece|pieces|pc|pcs|litre|litres|liter|liters|l|ml)\b/gi, '')
    .replace(/\b(purchased|bought|sold|remaining|left|of)\b/gi, '')
    .replace(/^\d+\s*/, '')  // Remove leading numbers
    .replace(/\s+$/, '')     // Remove trailing spaces
    .trim();
  
  // Handle specific cases
  if (cleaned.toLowerCase().includes('packs of')) {
    cleaned = cleaned.replace(/(\d+)\s*packs\s+of\s+(.+)/i, '$2');
  }
  
  if (cleaned.toLowerCase().includes('kg of')) {
    cleaned = cleaned.replace(/(\d+)\s*kg\s+of\s+(.+)/i, '$2');
  }
  
  if (cleaned.toLowerCase().includes('litres of')) {
    cleaned = cleaned.replace(/(\d+)\s*litres?\s+of\s+(.+)/i, '$2');
  }
  
  console.log(`[Product Extraction] "${fullText}" → "${cleaned}"`);
  return cleaned;
}

async function handleVoiceConfirmationState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling voice confirmation with input: "${Body}"`);
  
  // Verify state persistence
  const persistenceCheck = await verifyStatePersistence(From, 'confirmation');
  if (!persistenceCheck) {
    console.error(`[${requestId}] State persistence failed, treating as new interaction`);
    await handleNewInteraction(Body, null, 0, From, requestId, res);
    return;
  }
  
  const { pendingTranscript, detectedLanguage, type } = state.data;
  const shopId = From.replace('whatsapp:', '');
  
  const yesVariants = ['yes', 'haan', 'हाँ', 'ha', 'ok', 'okay'];
  const noVariants = ['no', 'nahin', 'नहीं', 'nahi', 'cancel'];
  
  if (yesVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User confirmed voice transcription`);
    
    // Parse the transcript to get update details
    try {
      const updates = await parseMultipleUpdates(pendingTranscript);
      if (updates.length > 0) {
        // Process the confirmed updates
        const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
        
        let message = '✅ Updates processed:\n\n';
        let successCount = 0;
        
        for (const result of results) {
          if (result.success) {
            successCount++;
            const unitText = result.unit ? ` ${result.unit}` : '';
            message += `• ${result.product}: ${result.quantity} ${unitText} ${result.action} (Stock: ${result.newQuantity}${unitText})\n`;
          } else {
            message += `• ${result.product}: Error - ${result.error}\n`;
          }
        }
        
        message += `\n✅ Successfully updated ${successCount} of ${updates.length} items`;
        
        // FIX: Send via WhatsApp API instead of synchronous response
        const formattedResponse = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
        await sendMessageViaAPI(From, formattedResponse);
        
        // Clear state after processing
        await clearUserState(From);
      } else {
        // If parsing failed, ask to retry
        const errorMessage = await generateMultiLanguageResponse(
          'Sorry, I couldn\'t parse your inventory update. Please try again with a clear voice message.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
        await clearUserState(From);
      }
    } catch (parseError) {
      console.error(`[${requestId}] Error parsing transcript for confirmation:`, parseError.message);
      // If parsing failed, ask to retry
      const errorMessage = await generateMultiLanguageResponse(
        'Sorry, I had trouble processing your message. Please try again.',
        detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, errorMessage);
      await clearUserState(From);
    }
    
  } else if (noVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User rejected voice transcription`);
    
    // Parse the transcript to get update details
    try {
      const updates = await parseMultipleUpdates(pendingTranscript);
      let update;
      
      if (updates.length > 0) {
        // Take the first update (assuming one product per message for correction)
        update = updates[0];
      } else {
        // If parsing failed, create a default update object with the transcript as product
        update = {
          product: pendingTranscript,
          quantity: 0,
          unit: '',
          action: 'purchased',
          isKnown: false
        };
        console.log(`[${requestId}] Created default update object for correction:`, update);
      }
      
      // Save correction state to database with type 'selection'
      console.log(`[${requestId}] Saving correction state to database for shop: ${shopId}`);
      const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
      
      if (saveResult.success) {
        console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id}`);
        
        // Set correction state
        await setUserState(From, 'correction', {
          correctionState: {
            correctionType: 'selection',
            pendingUpdate: update,
            detectedLanguage,
            id: saveResult.id
          }
        });
        
        // Show correction options
        const correctionMessage = `I heard: "${update.quantity} ${update.unit} of ${update.product}" (${update.action}).  
What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
        
        const translatedMessage = await generateMultiLanguageResponse(correctionMessage, detectedLanguage, requestId);
        await sendMessageViaAPI(From, translatedMessage);
      } else {
        console.error(`[${requestId}] Failed to save correction state: ${saveResult.error}`);
        // Fallback to asking for retry
        const errorMessage = await generateMultiLanguageResponse(
          'Please try again with a clear voice message.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
      }
    } catch (parseError) {
      console.error(`[${requestId}] Error parsing transcript for correction:`, parseError.message);
      
      // Even if there's an error during parsing, create a default update object and proceed to correction
      const update = {
        product: pendingTranscript,
        quantity: 0,
        unit: '',
        action: 'purchased',
        isKnown: false
      };
      
      // Save correction state to database with type 'selection'
      console.log(`[${requestId}] Saving correction state to database for shop: ${shopId} (fallback)`);
      const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
      
      if (saveResult.success) {
        console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id} (fallback)`);
        
        // Set correction state
        await setUserState(From, 'correction', {
          correctionState: {
            correctionType: 'selection',
            pendingUpdate: update,
            detectedLanguage,
            id: saveResult.id
          }
        });
        
        // Show correction options
        const correctionMessage = `I heard: "${update.product}" (${update.action}).  
What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
        
        const translatedMessage = await generateMultiLanguageResponse(correctionMessage, detectedLanguage, requestId);
        await sendMessageViaAPI(From, translatedMessage);
      } else {
        // If even the fallback fails, ask to retry
        const errorMessage = await generateMultiLanguageResponse(
          'Please try again with a clear voice message.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
      }
    }
  } else {
    // Invalid response
    const errorMessage = await generateMultiLanguageResponse(
      'Please reply with "yes" or "no".',
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, errorMessage);
  }
  
  res.send('<Response></Response>');
}

async function handleTextConfirmationState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling text confirmation with input: "${Body}"`);
  
  const { pendingTranscript, detectedLanguage, type } = state.data;
  const shopId = From.replace('whatsapp:', '');
  
  const yesVariants = ['yes', 'haan', 'हाँ', 'ha', 'ok', 'okay'];
  const noVariants = ['no', 'nahin', 'नहीं', 'nahi', 'cancel'];
  
  if (yesVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User confirmed text update`);
    
    // Parse the transcript to get update details
    try {
      const updates = await parseMultipleUpdates(pendingTranscript);
      if (updates.length > 0) {
        // Process the confirmed updates
        const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
        let message = '✅ Updates processed:\n\n';
        let successCount = 0;
        for (const result of results) {
          if (result.success) {
            successCount++;
            const unitText = result.unit ? ` ${result.unit}` : '';
            message += `• ${result.product}: ${result.quantity} ${unitText} ${result.action} (Stock: ${result.newQuantity}${unitText})\n`;
          } else {
            message += `• ${result.product}: Error - ${result.error}\n`;
          }
        }
        message += `\n✅ Successfully updated ${successCount} of ${updates.length} items`;
        const formattedResponse = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
        await sendMessageViaAPI(From, formattedResponse);
        
        // Clear state after processing
        await clearUserState(From);
      } else {
        // If parsing failed, ask to retry
        const errorMessage = await generateMultiLanguageResponse(
          'Sorry, I couldn\'t parse your inventory update. Please try again with a clear message.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
        await clearUserState(From);
      }
    } catch (parseError) {
      console.error(`[${requestId}] Error parsing transcript for confirmation:`, parseError.message);
      // If parsing failed, ask to retry
      const errorMessage = await generateMultiLanguageResponse(
        'Sorry, I had trouble processing your message. Please try again.',
        detectedLanguage,
        requestId
      );
      await sendMessageViaAPI(From, errorMessage);
      await clearUserState(From);
    }
    
  } else if (noVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User rejected text update`);
    
    // Parse the transcript to get update details
    try {
      const updates = await parseMultipleUpdates(pendingTranscript);
      let update;
      
      if (updates.length > 0) {
        // Take the first update (assuming one product per message for correction)
        update = updates[0];
      } else {
        // FIX: If parsing failed, create a default update object with the transcript as product
        update = {
          product: pendingTranscript,
          quantity: 0,
          unit: '',
          action: 'purchased',
          isKnown: false
        };
        console.log(`[${requestId}] Created default update object for correction:`, update);
      }
      
      // Save correction state to database with type 'selection'
      console.log(`[${requestId}] Saving correction state to database for shop: ${shopId}`);
      const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
      
      if (saveResult.success) {
        console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id}`);
        
        // Set correction state
        await setUserState(From, 'correction', {
          correctionState: {
            correctionType: 'selection',
            pendingUpdate: update,
            detectedLanguage,
            id: saveResult.id
          }
        });
        
        // Show correction options
        const correctionMessage = `I heard: "${update.quantity} ${update.unit} of ${update.product}" (${update.action}).  
What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
        
        const translatedMessage = await generateMultiLanguageResponse(correctionMessage, detectedLanguage, requestId);
        await sendMessageViaAPI(From, translatedMessage);
      } else {
        console.error(`[${requestId}] Failed to save correction state: ${saveResult.error}`);
        // Fallback to asking for retry
        const errorMessage = await generateMultiLanguageResponse(
          'Please try again with a clear message.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
      }
    } catch (parseError) {
      console.error(`[${requestId}] Error parsing transcript for correction:`, parseError.message);
      
      // FIX: Even if there's an error during parsing, create a default update object and proceed to correction
      const update = {
        product: pendingTranscript,
        quantity: 0,
        unit: '',
        action: 'purchased',
        isKnown: false
      };
      
      // Save correction state to database with type 'selection'
      console.log(`[${requestId}] Saving correction state to database for shop: ${shopId} (fallback)`);
      const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
      
      if (saveResult.success) {
        console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id} (fallback)`);
        
        // Set correction state
        await setUserState(From, 'correction', {
          correctionState: {
            correctionType: 'selection',
            pendingUpdate: update,
            detectedLanguage,
            id: saveResult.id
          }
        });
        
        // Show correction options
        const correctionMessage = `I heard: "${update.product}" (${update.action}).  
What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
        
        const translatedMessage = await generateMultiLanguageResponse(correctionMessage, detectedLanguage, requestId);
        await sendMessageViaAPI(From, translatedMessage);
      } else {
        // If even the fallback fails, ask to retry
        const errorMessage = await generateMultiLanguageResponse(
          'Please try again with a clear message.',
          detectedLanguage,
          requestId
        );
        await sendMessageViaAPI(From, errorMessage);
      }
    }
  } else {
    // Invalid response
    const errorMessage = await generateMultiLanguageResponse(
      'Please reply with "yes" or "no".',
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, errorMessage);
  }
  
  res.send('<Response></Response>');
}

async function handleProductConfirmationState(Body, From, state, requestId, res) {
  console.log(`[${requestId}] Handling product confirmation with input: "${Body}"`);
  
  const { pendingTranscript, detectedLanguage, unknownProducts } = state.data;
  const shopId = From.replace('whatsapp:', '');
  
  const yesVariants = ['yes', 'haan', 'हाँ', 'ha', 'ok', 'okay'];
  const noVariants = ['no', 'nahin', 'नहीं', 'nahi', 'cancel'];
  
  if (yesVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User confirmed unknown products`);
    
    // Process the updates even with unknown products
    const results = await updateMultipleInventory(shopId, unknownProducts, detectedLanguage);
    
    let message = '✅ Updates processed:\n\n';
    let successCount = 0;
    
    for (const result of results) {
      if (result.success) {
        successCount++;
        const unitText = result.unit ? ` ${result.unit}` : '';
        message += `• ${result.product}: ${result.quantity} ${unitText} ${result.action} (Stock: ${result.newQuantity}${unitText})\n`;
      } else {
        message += `• ${result.product}: Error - ${result.error}\n`;
      }
    }
    
    message += `\n✅ Successfully updated ${successCount} of ${unknownProducts.length} items`;
    
    const formattedResponse = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    await sendMessageViaAPI(From, formattedResponse);
    
    // Clear state after processing
    await clearUserState(From);
    
  } else if (noVariants.includes(Body.toLowerCase())) {
    console.log(`[${requestId}] User rejected unknown products`);
    
    // Take the first unknown product for correction
    const update = unknownProducts[0];
    
    // Save correction state to database with type 'selection'
    console.log(`[${requestId}] Saving correction state to database for shop: ${shopId}`);
    const saveResult = await saveCorrectionState(shopId, 'selection', update, detectedLanguage);
    
    if (saveResult.success) {
      console.log(`[${requestId}] Successfully saved correction state with ID: ${saveResult.id}`);
      
      // Set correction state
      await setUserState(From, 'correction', {
        correctionState: {
          correctionType: 'selection',
          pendingUpdate: update,
          detectedLanguage,
          id: saveResult.id
        }
      });
      
      // Show correction options
      const correctionMessage = `I heard: "${update.quantity} ${update.unit} of ${update.product}" (${update.action}).  
What needs to be corrected?
Reply with:
1 – Product is wrong
2 – Quantity is wrong
3 – Action is wrong
4 – All wrong, I'll type it instead`;
      
      const translatedMessage = await generateMultiLanguageResponse(correctionMessage, detectedLanguage, requestId);
      await sendMessageViaAPI(From, translatedMessage);
    }
  } else {
    // Invalid response
    const errorMessage = await generateMultiLanguageResponse(
      'Please reply with "yes" or "no".',
      detectedLanguage,
      requestId
    );
    await sendMessageViaAPI(From, errorMessage);
  }
  
  res.send('<Response></Response>');
}

async function verifyStatePersistence(from, expectedMode) {
  const state = await getUserState(from);
  if (!state || state.mode !== expectedMode) {
    console.warn(`[State] Persistence check failed for ${from}. Expected: ${expectedMode}, Got: ${state ? state.mode : 'none'}`);
    return false;
  }
  console.log(`[State] Persistence check passed for ${from}: ${expectedMode}`);
  return true;
}

// Check user authentication
async function checkUserAuthorization(From, Body, requestId) {
  const shopId = From.replace('whatsapp:', '');
  console.log(`[${requestId}] Checking authorization for shopId: "${shopId}"`);
  
  // First check if user is already authorized
  const authResult = await isUserAuthorized(shopId);
  console.log(`[${requestId}] Auth result:`, authResult);
  
  if (authResult.success) {
    return { authorized: true, user: authResult.user };
  }
  
  // If not authorized, check if they're sending an auth code
  if (Body && Body.length >= 6 && Body.length <= 8) {
    const authCode = Body.trim().toUpperCase();
    console.log(`[${requestId}] Checking auth code: "${authCode}"`);
    const authCheck = await isUserAuthorized(shopId, authCode);
    console.log(`[${requestId}] Auth check result:`, authCheck);
    
    if (authCheck.success) {
      return { authorized: true, user: authCheck.user, justAuthenticated: true };
    }
  }
  
  return { authorized: false };
}

// Send unauthorized response
async function sendUnauthorizedResponse(From, requestId) {
  const message = `🚫 Unauthorized Access

Sorry, you are not authorized to use this inventory system.

If you believe this is an error, please contact the administrator to get your authentication code.

This is a secure system for authorized users only.`;
  
  await sendMessageViaAPI(From, message);
}

// Send authentication success response
async function sendAuthSuccessResponse(From, user, requestId) {
  const message = `✅ Authentication Successful!

Welcome${user.name ? ' ' + user.name : ''}! You are now authorized to use the inventory system.

You can now send inventory updates like:
• "10 Parle-G sold"
• "5kg sugar purchased"

Your authentication code is: *${user.authCode}*
Please save this code for future use.`;
  
  await sendMessageViaAPI(From, message);
}

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
