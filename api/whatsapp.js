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
  createSalesRecord,
  updateBatchQuantity
} = require('../database');

// Global storage for user preferences, pending transcriptions, and conversation state
global.userPreferences = {};
global.pendingTranscriptions = {};
global.pendingProductUpdates = {};
global.conversationState = {};

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

// Enhanced language detection with fallback
async function detectLanguageWithFallback(text, requestId) {
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
        }
      }
    );
    const languageCode = response.data.choices[0].message.content.trim().toLowerCase();
    console.log(`[${requestId}] Detected language: ${languageCode}`);
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
        }
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
    .replace(/(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)/gi, ' ')
    .replace(/(बेचा|बेचे|becha|sold|बिक्री)/gi, ' ')
    .replace(/(बचा|बचे|बाकी|remaining|left)/gi, ' ')
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
    'पचास': 50, 'साठ': 60, 'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90, 'सौ': 100,
    // Special case: "सो" means 100 in Hindi when referring to quantity
    'सो': 100,
    // Hindi numerals (Devanagari digits)
    '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9,
    '१०': 10, '११': 11, '१२': 12, '१३': 13, '१४': 14, '१५': 15, '१६': 16
  };
  
  let quantity = 0;
  let unit = '';
  let unitMultiplier = 1;
  
  // Try to match digits first (including Devanagari digits)
  const digitMatch = transcript.match(/(\d+|[०-९]+)/i);
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
  const units = {
    'packets': 1, 'पैकेट': 1,
    'boxes': 1, 'बॉक्स': 1,
    'kg': 1, 'किलो': 1, 'kilo': 1, 'kilogram': 1, 'kilograms': 1,
    'g': 0.001, 'gram': 0.001, 'grams': 0.001, 'ग्राम': 0.001,
    'liters': 1, 'लीटर': 1, 'litre': 1, 'litres': 1,
    'ml': 0.001, 'milliliter': 0.001, 'milliliters': 0.001, 'millilitre': 0.001, 'millilitres': 0.001,
    'pieces': 1, 'पीस': 1
  };
  
  // Check for units in the transcript
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
  const isPurchase = /(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)/i.test(transcript);
  const isSold = /(बेचा|बेचे|becha|sold|बिक्री)/i.test(transcript);
  const isRemaining = /(बचा|बचे|बाकी|remaining|left)/i.test(transcript);
  
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

// Handle multiple inventory updates with batch tracking
async function updateMultipleInventory(shopId, updates, languageCode) {
  const results = [];
  for (const update of updates) {
    try {
      console.log(`[Update ${shopId} - ${update.product}] Processing update: ${update.quantity} ${update.unit}`);
      
      // Check if this is a sale (negative quantity)
      const isSale = update.quantity < 0;
      
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
      
      // Create batch record for purchases
      if (update.quantity > 0 && result.success) {
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
          console.error(`[Update ${shopId} - ${update.product}] Failed to create batch record: ${batchResult.error}`);
        }
      }
      
      // Create sales record for sales
      if (isSale && result.success) {
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
              console.log(`[Update ${shopId} - ${update.product}] Updated batch quantity: ${batchUpdateResult.newQuantity}`);
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

// Validate if transcript is an inventory update - now allows unknown products
function isValidInventoryUpdate(parsed) {
  // Allow unknown products but require valid quantity and action
  const validQuantity = parsed.quantity !== 0;
  const validAction = ['purchased', 'sold', 'remaining'].includes(parsed.action);
  return validQuantity && validAction;
}

// Function to process confirmed transcription
async function processConfirmedTranscription(transcript, from, detectedLanguage, requestId, response, res) {
  try {
    console.log(`[${requestId}] [6] Parsing updates using AI...`);
    const updates = await parseMultipleUpdates(transcript);
    
    if (updates.length === 0) {
      console.log(`[${requestId}] Rejected: No valid inventory updates`);
      const errorMessage = await generateMultiLanguageResponse(
        'Please send inventory updates only. Examples: "10 Parle-G sold", "5kg sugar purchased", "2 boxes Maggi bought". You can send multiple updates in one message!',
        detectedLanguage,
        requestId
      );
      response.message(errorMessage);
      return res.send(response.toString());
    }
    
    console.log(`[${requestId}] [7] Testing Airtable connection...`);
    const connectionTest = await testConnection();
    if (!connectionTest) {
      console.error(`[${requestId}] Airtable connection failed`);
      const errorMessage = await generateMultiLanguageResponse(
        'Database connection error. Please try again later.',
        detectedLanguage,
        requestId
      );
      response.message(errorMessage);
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
      if (!global.conversationState) {
        global.conversationState = {};
      }
      global.conversationState[from] = {
        state: 'awaiting_batch_selection',
        language: detectedLanguage
      };
    }
    
    // Add switch option in completion messages
    message += `\n\nTo switch input method, reply "switch to text" or "switch to voice".`;
    // Add reset option
    message += `\nTo reset the flow, reply "reset".`;
    
    // Use conversation state language if available
    let responseLanguage = detectedLanguage;
    if (global.conversationState && global.conversationState[from] && global.conversationState[from].language) {
      responseLanguage = global.conversationState[from].language;
    }
    
    const formattedResponse = await generateMultiLanguageResponse(message, responseLanguage, requestId);
    console.log(`[${requestId}] Sending WhatsApp response:`, formattedResponse);
    response.message(formattedResponse);
    return res.send(response.toString());
  } catch (error) {
    console.error(`[${requestId}] Error processing confirmed transcription:`, error.message);
    const errorMessage = await generateMultiLanguageResponse(
      'System error. Please try again with a clear voice message.',
      detectedLanguage,
      requestId
    );
    response.message(errorMessage);
    return res.send(response.toString());
  }
}

// Function to confirm transcription with user
async function confirmTranscription(transcript, from, detectedLanguage, requestId) {
  const response = new twilio.twiml.MessagingResponse();
  const confirmationMessage = await generateMultiLanguageResponse(
    `I heard: "${transcript}". Is this correct? Please reply with "yes" to confirm or "no" to try again.`,
    detectedLanguage,
    requestId
  );
  response.message(confirmationMessage);
  
  // Store the transcript temporarily
  global.pendingTranscriptions[from] = {
    transcript,
    detectedLanguage,
    timestamp: Date.now()
  };
  
  return response.toString();
}

// Function to confirm product with user
async function confirmProduct(update, from, detectedLanguage, requestId) {
  const response = new twilio.twiml.MessagingResponse();
  const confirmationMessage = await generateMultiLanguageResponse(
    `I heard you want to update: "${update.quantity > 0 ? '+' : ''}${update.quantity} ${update.product}" (${update.action}). Is this correct? Please reply with "yes" to confirm or "no" to try again.`,
    detectedLanguage,
    requestId
  );
  response.message(confirmationMessage);
  
  // Store the update temporarily
  global.pendingProductUpdates[from] = {
    update,
    detectedLanguage,
    timestamp: Date.now()
  };
  
  return response.toString();
}

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  try {
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
    if (global.userPreferences[From]) {
      userPreference = global.userPreferences[From];
      console.log(`[${requestId}] User preference: ${userPreference}`);
    }
    
    // Check conversation state
    let conversationState = null;
    if (global.conversationState && global.conversationState[From]) {
      conversationState = global.conversationState[From];
      console.log(`[${requestId}] Conversation state:`, conversationState);
    }
    
    // Handle button responses (if any)
    if (ButtonText) {
      console.log(`[${requestId}] Button clicked: ${ButtonText}`);
      
      // Store user preference
      if (!global.userPreferences) {
        global.userPreferences = {};
      }
      
      // Detect language for response
      let detectedLanguage = 'en';
      try {
        detectedLanguage = await detectLanguageWithFallback(ButtonText, requestId);
      } catch (error) {
        console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
      }
      
      if (ButtonText === 'Voice Message' || ButtonText === 'voice_input') {
        global.userPreferences[From] = 'voice';
        const voiceMessage = await generateMultiLanguageResponse(
          '🎤 Please send a voice message with your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,
          requestId
        );
        response.message(voiceMessage);
      } else if (ButtonText === 'Text Message' || ButtonText === 'text_input') {
        global.userPreferences[From] = 'text';
        const textMessage = await generateMultiLanguageResponse(
          '📝 Please type your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,
          requestId
        );
        response.message(textMessage);
      }
      
      return res.send(response.toString());
    }
    
    // Handle text-based selection responses
    if (Body && (Body === '1' || Body === '2' || Body.toLowerCase() === 'voice' || Body.toLowerCase() === 'text')) {
      console.log(`[${requestId}] Text-based selection: "${Body}"`);
      
      // Store user preference
      if (!global.userPreferences) {
        global.userPreferences = {};
      }
      
      // Detect language for response
      let detectedLanguage = 'en';
      try {
        detectedLanguage = await detectLanguageWithFallback(Body, requestId);
      } catch (error) {
        console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
      }
      
      if (Body === '1' || Body.toLowerCase() === 'voice') {
        global.userPreferences[From] = 'voice';
        const voiceMessage = await generateMultiLanguageResponse(
          '🎤 Please send a voice message with your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,
          requestId
        );
        response.message(voiceMessage);
      } else if (Body === '2' || Body.toLowerCase() === 'text') {
        global.userPreferences[From] = 'text';
        const textMessage = await generateMultiLanguageResponse(
          '📝 Please type your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,
          requestId
        );
        response.message(textMessage);
      }
      
      return res.send(response.toString());
    }
    
    // Handle input method switch commands
    if (Body) {
      const lowerBody = Body.toLowerCase();
      
      // Check for reset commands
      if (resetCommands.some(cmd => lowerBody.includes(cmd))) {
        console.log(`[${requestId}] User requested to reset the flow`);
        
        // Clear conversation state
        if (global.conversationState && global.conversationState[From]) {
          delete global.conversationState[From];
        }
        
        // Detect language for response
        let detectedLanguage = 'en';
        try {
          detectedLanguage = await detectLanguageWithFallback(Body, requestId);
        } catch (error) {
          console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
        }
        
        const resetMessage = await generateMultiLanguageResponse(
          'Flow has been reset. How would you like to send your inventory update?',
          detectedLanguage,
          requestId
        );
        response.message(resetMessage);
        return res.send(response.toString());
      }
      
      // Check for switch commands
      if (lowerBody.includes('switch to text') || lowerBody.includes('change to text') || lowerBody.includes('use text')) {
        console.log(`[${requestId}] User switching to text input`);
        
        // Store user preference
        if (!global.userPreferences) {
          global.userPreferences = {};
        }
        global.userPreferences[From] = 'text';
        
        // Detect language for response
        let detectedLanguage = 'en';
        try {
          detectedLanguage = await detectLanguageWithFallback(Body, requestId);
        } catch (error) {
          console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
        }
        
        const switchMessage = await generateMultiLanguageResponse(
          '✅ Switched to text input. Please type your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,
          requestId
        );
        response.message(switchMessage);
        return res.send(response.toString());
      }
      
      if (lowerBody.includes('switch to voice') || lowerBody.includes('change to voice') || lowerBody.includes('use voice')) {
        console.log(`[${requestId}] User switching to voice input`);
        
        // Store user preference
        if (!global.userPreferences) {
          global.userPreferences = {};
        }
        global.userPreferences[From] = 'voice';
        
        // Detect language for response
        let detectedLanguage = 'en';
        try {
          detectedLanguage = await detectLanguageWithFallback(Body, requestId);
        } catch (error) {
          console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
        }
        
        const switchMessage = await generateMultiLanguageResponse(
          '✅ Switched to voice input. Please send a voice message with your inventory update. Example: "10 Parle-G sold"',
          detectedLanguage,
          requestId
        );
        response.message(switchMessage);
        return res.send(response.toString());
      }
    }
    
    // Handle confirmation responses
    if (Body && (Body.toLowerCase() === 'yes' || Body.toLowerCase() === 'no')) {
      console.log(`[${requestId}] Message appears to be a confirmation response: "${Body}"`);
      
      // Check for pending transcriptions
      if (global.pendingTranscriptions[From]) {
        const pending = global.pendingTranscriptions[From];
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
          delete global.pendingTranscriptions[From];
          return;
        } else {
          console.log(`[${requestId}] User rejected transcription`);
          const errorMessage = await generateMultiLanguageResponse(
            'Please try again with a clear voice message.',
            pending.detectedLanguage,
            requestId
          );
          response.message(errorMessage);
          delete global.pendingTranscriptions[From];
          return res.send(response.toString());
        }
      }
      
      // Check for pending product updates
      if (global.pendingProductUpdates && global.pendingProductUpdates[From]) {
        const pending = global.pendingProductUpdates[From];
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
            if (!global.conversationState) {
              global.conversationState = {};
            }
            global.conversationState[From] = {
              state: 'awaiting_batch_selection',
              language: pending.detectedLanguage
            };
          }
          
          // Add switch option in completion messages
          message += `\n\nTo switch input method, reply "switch to text" or "switch to voice".`;
          // Add reset option
          message += `\nTo reset the flow, reply "reset".`;
          
          const formattedResponse = await generateMultiLanguageResponse(message, pending.detectedLanguage, requestId);
          response.message(formattedResponse);
          delete global.pendingProductUpdates[From];
          return res.send(response.toString());
        } else {
          console.log(`[${requestId}] User rejected product update`);
          const errorMessage = await generateMultiLanguageResponse(
            'Please try again with a clear message.',
            pending.detectedLanguage,
            requestId
          );
          response.message(errorMessage);
          delete global.pendingProductUpdates[From];
          return res.send(response.toString());
        }
      }
    }
    
    // Handle text messages
    if (Body && (NumMedia === '0' || NumMedia === 0 || !NumMedia)) {
      console.log(`[${requestId}] [1] Processing text message: "${Body}"`);
      
      // Check for common greetings
      const greetings = {
        'en': ['hello', 'hi', 'hey'],
        'hi': ['नमस्ते', 'नमस्कार', 'हाय'],
        'ta': ['vanakkam', 'வணக்கம்'],
        'te': ['నమస్కారం', 'హలో'],
        'kn': ['ನಮಸ್ಕಾರ', 'ಹಲೋ'],
        'bn': ['নমস্কার', 'হ্যালো'],
        'gu': ['નમસ્તે', 'હેલો'],
        'mr': ['नमस्कार', 'हॅलो'],
        'fr': ['salut', 'bonjour', 'coucou'],
        'es': ['hola', 'buenos días'],
        'de': ['hallo', 'guten tag'],
        'it': ['ciao', 'buongiorno'],
        'pt': ['olá', 'bom dia'],
        'ru': ['привет', 'здравствуйте'],
        'ja': ['こんにちは', 'やあ'],
        'zh': ['你好', '嗨']
      };
      
      const lowerBody = Body.toLowerCase();
      let isGreeting = false;
      let greetingLang = 'en';
      
      for (const [lang, greetingList] of Object.entries(greetings)) {
        if (greetingList.some(g => lowerBody.includes(g))) {
          isGreeting = true;
          greetingLang = lang;
          break;
        }
      }
      
      if (isGreeting) {
        console.log(`[${requestId}] Detected greeting in language: ${greetingLang}`);
        
        // Reset conversation state on greeting
        if (global.conversationState && global.conversationState[From]) {
          delete global.conversationState[From];
        }
        
        // Save user preference
        const shopId = From.replace('whatsapp:', '');
        await saveUserPreference(shopId, greetingLang);
        
        if (userPreference !== 'voice') {
          const preferenceMessage = await generateMultiLanguageResponse(
            `Welcome! I see you prefer to send updates by ${userPreference}. How can I help you today?`,
            greetingLang,
            requestId
          );
          response.message(preferenceMessage);
          return res.send(response.toString());
        }
        
        // Use text-based selection instead of buttons for broader compatibility
        const welcomeMessage = await generateMultiLanguageResponse(
          'Welcome! How would you like to send your inventory update?\n\nReply:\n• "1" for Voice Message\n• "2" for Text Message',
          greetingLang,
          requestId
        );
        response.message(welcomeMessage);
        return res.send(response.toString());
      }
      
      // Check if we're awaiting batch selection
      if (conversationState && conversationState.state === 'awaiting_batch_selection') {
        console.log(`[${requestId}] Awaiting batch selection response`);
        await handleBatchSelectionResponse(Body, From, response, requestId, conversationState.language);
        return res.send(response.toString());
      }
      
      // First, try to parse as inventory update
      console.log(`[${requestId}] Attempting to parse as inventory update first`);
      
      let detectedLanguage = conversationState ? conversationState.language : 'en';
      try {
        detectedLanguage = await detectLanguageWithFallback(Body, requestId);
        console.log(`[${requestId}] Detected language for text update: ${detectedLanguage}`);
      } catch (error) {
        console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
        detectedLanguage = 'en';
      }
      
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
          res.send(confirmationResponse);
          return;
        }
        
        await processConfirmedTranscription(
          Body,
          From,
          detectedLanguage,
          requestId,
          response,
          res
        );
        return;
      } else {
        console.log(`[${requestId}] Not a valid inventory update, checking for specialized operations`);
        
        // Check for batch selection or expiry date updates only if in the appropriate state
        if (conversationState && conversationState.state === 'awaiting_batch_selection') {
          if (isBatchSelectionResponse(Body)) {
            console.log(`[${requestId}] Message appears to be a batch selection response`);
            await handleBatchSelectionResponse(Body, From, response, requestId, conversationState.language);
            return res.send(response.toString());
          } else if (isExpiryDateUpdate(Body)) {
            console.log(`[${requestId}] Message appears to be an expiry date update`);
            await handleExpiryDateUpdate(Body, From, response, requestId, conversationState.language);
            return res.send(response.toString());
          }
        }
        
        const defaultMessage = await generateMultiLanguageResponse(
          userPreference === 'voice'
            ? '🎤 Send inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.\n\nTo switch to text input, reply "switch to text".'
            : '📝 Type your inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.\n\nTo switch to voice input, reply "switch to voice".',
          detectedLanguage,
          requestId
        );
        response.message(defaultMessage);
      }
      
      return res.send(response.toString());
    }
    
    // Handle voice messages
    if (NumMedia && MediaUrl0 && (NumMedia !== '0' && NumMedia !== 0)) {
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
      const detectedLanguage = await detectLanguageWithFallback(cleanTranscript, requestId);
      
      // Save user preference
      const shopId = From.replace('whatsapp:', '');
      await saveUserPreference(shopId, detectedLanguage);
      
      // Check if we're awaiting batch selection
      if (conversationState && conversationState.state === 'awaiting_batch_selection') {
        console.log(`[${requestId}] Awaiting batch selection response from voice`);
        
        // Check if the transcript contains batch selection keywords
        if (isBatchSelectionResponse(cleanTranscript)) {
          await handleBatchSelectionResponse(cleanTranscript, From, response, requestId, conversationState.language);
          return res.send(response.toString());
        }
      }
      
      // Confidence-based confirmation
      const CONFIDENCE_THRESHOLD = 0.8;
      if (confidence < CONFIDENCE_THRESHOLD) {
        console.log(`[${requestId}] [5.5] Low confidence (${confidence}), requesting confirmation...`);
        const confirmationResponse = await confirmTranscription(cleanTranscript, From, detectedLanguage, requestId);
        return res.send(confirmationResponse);
      } else {
        console.log(`[${requestId}] [5.5] High confidence (${confidence}), proceeding without confirmation...`);
        
        // Parse the transcript
        const updates = await parseMultipleUpdates(cleanTranscript);
        
        // Check if any updates are for unknown products
        const unknownProducts = updates.filter(u => !u.isKnown);
        if (unknownProducts.length > 0) {
          console.log(`[${requestId}] Found ${unknownProducts.length} unknown products, requesting confirmation`);
          
          // Confirm the first unknown product
          const confirmationResponse = await confirmProduct(unknownProducts[0], From, detectedLanguage, requestId);
          return res.send(confirmationResponse);
        }
        
        await processConfirmedTranscription(
          cleanTranscript,
          From,
          detectedLanguage,
          requestId,
          response,
          res
        );
        return;
      }
    } else if (SpeechResult) {
      console.log(`[${requestId}] [1] Using Twilio transcription`);
      response.message(`🔊 (Twilio): "${SpeechResult}"`);
    } else {
      console.log(`[${requestId}] [1] No media received`);
      
      let detectedLanguage = conversationState ? conversationState.language : 'en';
      try {
        detectedLanguage = await detectLanguageWithFallback(Body || "", requestId);
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
  res.send(response.toString());
};

// Function to check if a message is a batch selection response
function isBatchSelectionResponse(message) {
  // Only check for batch selection if we're in the appropriate state
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
  // Only check for expiry date updates if we're in the appropriate state
  const products = [
    'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
    'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
    'flour', 'आटा', 'sugar', 'चीनी', 'packets', 'पैकेट',
    'potato', 'आलू', 'onion', 'प्याज', 'tomato', 'टमाटर'
  ];
  
  // Check if message contains a date pattern
  const hasDate = message.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/) ||
                  message.match(/\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i);
  
  if (!hasDate) {
    return false;
  }
  
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
      const errorMessage = await generateMultiLanguageResponse(
        'Please specify which product you are referring to.',
        languageCode,
        requestId
      );
      response.message(errorMessage);
      return;
    }
    
    const batches = await getBatchRecords(shopId, product);
    if (batches.length === 0) {
      const errorMessage = await generateMultiLanguageResponse(
        `No batches found for ${product}.`,
        languageCode,
        requestId
      );
      response.message(errorMessage);
      return;
    }
    
    let selectedBatch = null;
    if (lowerBody.includes('oldest')) {
      selectedBatch = batches[batches.length - 1];
    } else if (lowerBody.includes('newest')) {
      selectedBatch = batches[0];
    } else {
      const dateMatch = body.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})/i);
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
    
    const dateMatch = body.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})/i);
    if (dateMatch) {
      const dateStr = dateMatch[0];
      const parsedDate = parseExpiryDate(dateStr);
      if (parsedDate) {
        const formattedDate = formatDateForAirtable(parsedDate);
        await updateBatchExpiry(selectedBatch.id, formattedDate);
        const successMessage = await generateMultiLanguageResponse(
          `✅ Updated expiry date for ${product} batch to ${formatDateForDisplay(parsedDate)}`,
          languageCode,
          requestId
        );
        response.message(successMessage);
        return;
      }
    }
    
    const confirmMessage = await generateMultiLanguageResponse(
      `✅ Selected ${product} batch from ${formatDateForDisplay(selectedBatch.fields.PurchaseDate)}`,
      languageCode,
      requestId
    );
    response.message(confirmMessage);
    
    // Clear conversation state
    if (global.conversationState && global.conversationState[from]) {
      delete global.conversationState[from];
    }
  } catch (error) {
    console.error(`[${requestId}] Error handling batch selection response:`, error.message);
    const errorMessage = await generateMultiLanguageResponse(
      'Error processing batch selection. Please try again.',
      languageCode,
      requestId
    );
    response.message(errorMessage);
  }
}

// Handle expiry date update
async function handleExpiryDateUpdate(body, from, response, requestId, languageCode = 'en') {
  try {
    console.log(`[${requestId}] Processing expiry date update: "${body}"`);
    
    const productMatch = body.match(/([a-zA-Z\s]+):?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
    if (!productMatch) {
      console.log(`[${requestId}] Invalid expiry date format`);
      const errorMessage = await generateMultiLanguageResponse(
        'Invalid format. Please use: "Product: DD/MM/YYYY" or "Product: DD Month YYYY"',
        languageCode,
        requestId
      );
      response.message(errorMessage);
      return;
    }
    
    const product = productMatch[1].trim();
    const expiryDateStr = productMatch[2];
    console.log(`[${requestId}] Extracted product: "${product}", expiry date: "${expiryDateStr}"`);
    
    const expiryDate = parseExpiryDate(expiryDateStr);
    if (!expiryDate) {
      console.log(`[${requestId}] Failed to parse expiry date`);
      const errorMessage = await generateMultiLanguageResponse(
        'Invalid date format. Please use: "Product: DD/MM/YYYY" or "Product: DD Month YYYY"',
        languageCode,
        requestId
      );
      response.message(errorMessage);
      return;
    }
    
    const shopId = from.replace('whatsapp:', '');
    console.log(`[${requestId}] Looking for recent batches for ${product}`);
    
    const batches = await getBatchRecords(shopId, product);
    if (batches.length === 0) {
      console.log(`[${requestId}] No recent purchase found for ${product}`);
      const errorMessage = await generateMultiLanguageResponse(
        `No recent purchase found for ${product}. Please make a purchase first.`,
        languageCode,
        requestId
      );
      response.message(errorMessage);
      return;
    }
    
    const formattedExpiryDate = formatDateForAirtable(expiryDate);
    console.log(`[${requestId}] Formatted expiry date: ${formattedExpiryDate}`);
    
    const latestBatch = batches[0];
    console.log(`[${requestId}] Updating batch ${latestBatch.id} with expiry date`);
    
    const batchResult = await updateBatchExpiry(latestBatch.id, formattedExpiryDate);
    if (batchResult.success) {
      console.log(`[${requestId}] Successfully updated batch with expiry date`);
      const successMessage = await generateMultiLanguageResponse(
        `✅ Expiry date updated for ${product}: ${formatDateForDisplay(expiryDate)}`,
        languageCode,
        requestId
      );
      response.message(successMessage);
    } else {
      console.error(`[${requestId}] Failed to update batch: ${batchResult.error}`);
      const errorMessage = await generateMultiLanguageResponse(
        `Error updating expiry date for ${product}. Please try again.`,
        languageCode,
        requestId
      );
      response.message(errorMessage);
    }
  } catch (error) {
    console.error(`[${requestId}] Error handling expiry date update:`, error.message);
    const errorMessage = await generateMultiLanguageResponse(
      'Error processing expiry date. Please try again.',
      languageCode,
      requestId
    );
    response.message(errorMessage);
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

// Generate response in multiple languages and scripts without labels
async function generateMultiLanguageResponse(message, languageCode, requestId) {
  try {
    // If the language is English, return the message as is
    if (languageCode === 'en') {
      return message;
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
        }
      }
    );
    
    let translated = response.data.choices[0].message.content.trim();
    console.log(`[${requestId}] Raw multilingual response:`, translated);
    
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
    
    console.log(`[${requestId}] Cleaned multilingual response:`, translated);
    return translated;
  } catch (error) {
    console.warn(`[${requestId}] Translation failed, using original:`, error.message);
    return message;
  }
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
    
    // Language priority
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
