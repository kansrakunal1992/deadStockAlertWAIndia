'use strict';
// =============================================================================
// lib/utils.js — Pure utility functions (no external dependencies)
// Extracted from api/whatsapp.js. All functions are stateless and side-effect-free.
// Import anywhere without circular dependency risk.
// =============================================================================

function extractProduct(transcript) {
  // Remove action words and numbers, but preserve product names
  const cleaned = transcript
    .replace(/(\d+|[०-९]+|[a-zA-Z]+)\s*(kg|किलो|grams?|ग्राम|packets?|पैकेट|boxes?|बॉक्स|liters?|लीटर)/gi, ' ')
    .replace(regexPatterns.purchaseKeywords, ' ')
    .replace(regexPatterns.salesKeywords, ' ')
    .replace(regexPatterns.remainingKeywords, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    
  // Strip common trailing price fragments: "at 50/piece" or "@60/litre"
    const priceTail = /\s+(?:at|@)\s*\d+(?:\.\d+)?(?:\/[A-Za-z]+)?\s*$/i;
    const nameOnly = cleaned.replace(priceTail, '').trim();

  // Try to match with known products first   
  for (const product of products) {
      if (nameOnly.toLowerCase().includes(product.toLowerCase()) ||
          product.toLowerCase().includes(nameOnly.toLowerCase())) {
        return product;
      }
    }
    return nameOnly;
}

function isValidInventoryUpdate(parsed) {
  if (!parsed) {
    console.warn('[Validation] Parsed update is null or undefined');
    return false;
  }
  if (parsed.quantity === 0) {
    console.warn(`[Validation] Rejected due to zero quantity: ${JSON.stringify(parsed)}`);
  }
  if (!['purchased', 'sold', 'remaining', 'returned'].includes(parsed.action)) {
    console.warn(`[Validation] Rejected due to invalid action: ${parsed.action}`);
  }
  
  // Allow unknown products but require valid quantity and action    
  const normalizedAction = String(parsed.action ?? '').toLowerCase();
  const validAction = ['purchased', 'sold', 'remaining', 'returned'].includes(normalizedAction);
  const validQuantity = parsed.quantity !== 0;
  
  if (!validAction) {
    console.warn(`[Validation] Rejected due to invalid action: ${parsed.action}`);
  }
  if (!validQuantity) {
    console.warn(`[Validation] Rejected due to zero quantity: ${parsed.quantity}`);
  }
  
  return validQuantity && validAction;
}

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

function toNumberSafe(v) {
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const cleaned = String(v).replace(/[^\d.\-]/g, '').replace(/,/g, '');
  const p = parseFloat(cleaned);
  return Number.isFinite(p) ? p : 0;
}

function unitConvFactor(fromUnit, toUnit) {
  const f = UNIT_NORMALS[String(fromUnit || '').toLowerCase()];
  const t = UNIT_NORMALS[String(toUnit   || '').toLowerCase()];
  if (!f || !t) return 1;
  if (f === 'g'  && t === 'kg') return 1000;     // 1 kg = 1000 g
  if (f === 'kg' && t === 'g')  return 1/1000;
  if (f === 'ml' && t === 'l')  return 1000;     // 1 l  = 1000 ml
  if (f === 'l'  && t === 'ml') return 1/1000;
  return 1; // same or unknown pairs
}

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

function normalize(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/gi, '').trim();
}

function getISTDate(d = new Date()) {
  // Returns a Date shifted to IST by offset math (no tz lib)
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(d.getTime() + istOffsetMs);
}

function startEndOfISTDay(d = new Date()) {
  const ist = getISTDate(d);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth(), day = ist.getUTCDate();
  // start in IST:
  const startIST = new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
  const endIST = new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0));
  // Convert back to UTC clock for Airtable comparisons
  return { startUTC: new Date(startIST.getTime() - 5.5*60*60*1000),
           endUTC:   new Date(endIST.getTime() - 5.5*60*60*1000) };
}

function startOfISTWeek(d = new Date()) {
  // Monday start (common retail view)
  const ist = getISTDate(d);
  const day = ist.getUTCDay(); // 0 Sun .. 6 Sat
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const mondayIST = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + diffToMonday));
  // Return in UTC clock
  return new Date(mondayIST.getTime() - 5.5*60*60*1000);
}

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

function sanitizeOutboundMessage(text) {
  let s = String(text ?? '');
  // strip common variants at the start (raw / html-escaped)
  s = s.replace(/^\s*!NO_FOOTER!\s*/i, '');
  s = s.replace(/^\s*<!NO_FOOTER!>\s*/i, '');
  s = s.replace(/^\s*&lt;!NO_FOOTER!&gt;\s*/i, '');
  return s;
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

module.exports = {
  extractProduct,
  isValidInventoryUpdate,
  splitMessage,
  safeJsonParse,
  singularize,
  toNumberSafe,
  unitConvFactor,
  isProductMatch,
  normalize,
  getISTDate,
  startEndOfISTDay,
  startOfISTWeek,
  isBatchSelectionResponse,
  isExpiryDateUpdate,
  parseExpiryDate,
  detectGreetingLanguage,
  sanitizeOutboundMessage,
  extractProductName
};