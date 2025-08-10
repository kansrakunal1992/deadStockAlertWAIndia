const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const { updateInventory, testConnection, createBatchRecord, getBatchRecords, updateBatchExpiry } = require('./database');

// Helper function to format dates for Airtable (YYYY-MM-DD)
function formatDateForAirtable(date) {
  if (date instanceof Date) {
    return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
  }
  if (typeof date === 'string') {
    // If it's already a string in YYYY-MM-DD format, return as is
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return date;
    }
    // Otherwise, try to parse it
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString().split('T')[0];
    }
  }
  return null; // Invalid date
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
    // If it's already in YYYY-MM-DD format, convert to DD/MM/YYYY
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = date.split('-');
      return `${day}/${month}/${year}`;
    }
    // Otherwise, try to parse it
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate.getTime())) {
      return formatDateForDisplay(parsedDate);
    }
  }
  return date; // Return as is if can't parse
}

module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    const { MediaUrl0, NumMedia, SpeechResult, From, Body } = req.body;
    
    // Check if this is a text message with batch selection or expiry date
    if (!NumMedia && Body) {
      console.log(`[${requestId}] [1] Processing text message: "${Body}"`);
      
      // Check if this is a batch selection response
      if (isBatchSelectionResponse(Body)) {
        console.log(`[${requestId}] Message appears to be a batch selection response`);
        await handleBatchSelectionResponse(Body, From, response, requestId);
      } 
      // Check if this is an expiry date update
      else if (isExpiryDateUpdate(Body)) {
        console.log(`[${requestId}] Message appears to be an expiry date update`);
        await handleExpiryDateUpdate(Body, From, response, requestId);
      }
      // Otherwise, send default response
      else {
        console.log(`[${requestId}] Message does not appear to be a batch selection or expiry date update`);
        const defaultMessage = await generateMultiLanguageResponse(
          '🎤 Send inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.',
          'en', // Default to English
          requestId
        );
        response.message(defaultMessage);
      }
      
      return res.send(response.toString());
    }
    
    if (NumMedia > 0 && MediaUrl0) {
      console.log(`[${requestId}] [1] Downloading audio...`);
      const audioBuffer = await downloadAudio(MediaUrl0);
      
      console.log(`[${requestId}] [2] Converting audio...`);
      const flacBuffer = await convertToFLAC(audioBuffer);
      
      console.log(`[${requestId}] [3] Transcribing with Google STT...`);
      const rawTranscript = await googleTranscribe(flacBuffer, requestId);
      
      console.log(`[${requestId}] [4] Validating transcript...`);
      const cleanTranscript = await validateTranscript(rawTranscript, requestId);
      
      console.log(`[${requestId}] [5] Detecting language...`);
      const detectedLanguage = await detectLanguage(cleanTranscript, requestId);
      
      console.log(`[${requestId}] [6] Parsing multiple updates...`);
      const updates = parseMultipleUpdates(cleanTranscript);
      
      // RESTRICTION: Validate if there are any valid inventory updates
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
      const shopId = From.replace('whatsapp:', '');
      const results = await updateMultipleInventory(shopId, updates, detectedLanguage);
      
      // Format response message in multiple languages
      let message = '✅ Updates processed:\n\n';
      let successCount = 0;
      let hasSales = false;
      
      for (const result of results) {
        if (result.success) {
          successCount++;
          message += `• ${result.product}: ${result.quantity > 0 ? '+' : ''}${result.quantity} (Stock: ${result.newQuantity})\n`;
          
          // Add batch information for purchases
          if (result.quantity > 0 && result.batchDate) {
            message += `  Batch added: ${formatDateForDisplay(result.batchDate)}\n`;
          }
          
          // Check if this was a sale
          if (result.quantity < 0) {
            hasSales = true;
          }
        } else {
          message += `• ${result.product}: Error - ${result.error}\n`;
        }
      }
      
      message += `\n✅ Successfully updated ${successCount} of ${updates.length} items`;
      
      // Add batch selection prompt if there were sales
      if (hasSales) {
        message += `\n\nFor better batch tracking, please specify which batch was sold in your next message.`;
      }
      
      // Generate response in both Roman and native scripts
      const formattedResponse = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
      
      // Ensure the response is properly sent
      console.log(`[${requestId}] Sending WhatsApp response:`, formattedResponse);
      response.message(formattedResponse);
    }
    else if (SpeechResult) {
      console.log(`[${requestId}] [1] Using Twilio transcription`);
      response.message(`🔊 (Twilio): "${SpeechResult}"`);
    }
    else {
      console.log(`[${requestId}] [1] No media received`);
      const welcomeMessage = await generateMultiLanguageResponse(
        '🎤 Send inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.',
        'en', // Default to English
        requestId
      );
      response.message(welcomeMessage);
    }
  } catch (error) {
    console.error(`[${requestId}] Processing Error:`, error.message);
    const errorMessage = await generateMultiLanguageResponse(
      'System error. Please try again with a clear voice message.',
      'en', // Default to English
      requestId
    );
    response.message(errorMessage);
  }
  
  // Ensure the response is always sent
  console.log(`[${requestId}] Sending TwiML response`);
  res.setHeader('Content-Type', 'text/xml');
  res.send(response.toString());
};

// NEW: Function to check if a message is a batch selection response
function isBatchSelectionResponse(message) {
  // Check for batch selection keywords
  const batchSelectionKeywords = ['oldest', 'newest', 'batch', 'expiry'];
  const lowerMessage = message.toLowerCase();
  
  for (const keyword of batchSelectionKeywords) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }
  
  // Check for date format (DD/MM/YYYY)
  if (lowerMessage.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/)) {
    return true;
  }
  
  // Check for month format (DD Month YYYY)
  if (lowerMessage.match(/\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i)) {
    return true;
  }
  
  return false;
}

// NEW: Function to check if a message is an expiry date update
function isExpiryDateUpdate(message) {
  // Check for product name followed by expiry date
  const products = [
    'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
    'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
    'flour', 'आटा', 'sugar', 'चीनी', 'packets', 'पैकेट'
  ];
  
  for (const product of products) {
    if (message.toLowerCase().includes(product.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

// NEW: Handle batch selection response
async function handleBatchSelectionResponse(body, from, response, requestId) {
  try {
    console.log(`[${requestId}] Processing batch selection response: "${body}"`);
    
    const shopId = from.replace('whatsapp:', '');
    const lowerBody = body.toLowerCase();
    
    // Extract product name from the message
    let product = null;
    const products = [
      'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
      'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
      'flour', 'आटा', 'sugar', 'चीनी', 'packets', 'पैकेट'
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
        'en', // Default to English
        requestId
      );
      response.message(errorMessage);
      return;
    }
    
    // Get all batches for this product
    const batches = await getBatchRecords(shopId, product);
    
    if (batches.length === 0) {
      const errorMessage = await generateMultiLanguageResponse(
        `No batches found for ${product}.`,
        'en', // Default to English
        requestId
      );
      response.message(errorMessage);
      return;
    }
    
    // Determine which batch was selected
    let selectedBatch = null;
    
    if (lowerBody.includes('oldest')) {
      // Select the oldest batch
      selectedBatch = batches[batches.length - 1];
    } else if (lowerBody.includes('newest')) {
      // Select the newest batch
      selectedBatch = batches[0];
    } else {
      // Try to extract a date from the message
      const dateMatch = body.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})/i);
      
      if (dateMatch) {
        const dateStr = dateMatch[0];
        const parsedDate = parseExpiryDate(dateStr);
        
        if (parsedDate) {
          // Find batch with matching expiry date
          selectedBatch = batches.find(batch => {
            if (!batch.fields.ExpiryDate) return false;
            const batchDate = new Date(batch.fields.ExpiryDate);
            return batchDate.getTime() === parsedDate.getTime();
          });
        }
      }
    }
    
    if (!selectedBatch) {
      // Default to oldest batch if no specific selection was made
      selectedBatch = batches[batches.length - 1];
    }
    
    // Update the batch with the specified expiry date if provided
    if (dateMatch) {
      const dateStr = dateMatch[0];
      const parsedDate = parseExpiryDate(dateStr);
      
      if (parsedDate) {
        const formattedDate = formatDateForAirtable(parsedDate);
        await updateBatchExpiry(selectedBatch.id, formattedDate);
        
        const successMessage = await generateMultiLanguageResponse(
          `✅ Updated expiry date for ${product} batch to ${formatDateForDisplay(parsedDate)}`,
          'en', // Default to English
          requestId
        );
        response.message(successMessage);
        return;
      }
    }
    
    // If no date was provided, just confirm the batch selection
    const confirmMessage = await generateMultiLanguageResponse(
      `✅ Selected ${product} batch from ${formatDateForDisplay(selectedBatch.fields.PurchaseDate)}`,
      'en', // Default to English
      requestId
    );
    response.message(confirmMessage);
  } catch (error) {
    console.error(`[${requestId}] Error handling batch selection response:`, error.message);
    const errorMessage = await generateMultiLanguageResponse(
      'Error processing batch selection. Please try again.',
      'en', // Default to English
      requestId
    );
    response.message(errorMessage);
  }
}

// NEW: Handle expiry date update
async function handleExpiryDateUpdate(body, from, response, requestId) {
  try {
    console.log(`[${requestId}] Processing expiry date update: "${body}"`);
    
    // Extract product and expiry date from the message
    const productMatch = body.match(/([a-zA-Z\s]+):?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
    
    if (!productMatch) {
      console.log(`[${requestId}] Invalid expiry date format`);
      const errorMessage = await generateMultiLanguageResponse(
        'Invalid format. Please use: "Product: DD/MM/YYYY" or "Product: DD Month YYYY"',
        'en', // Default to English
        requestId
      );
      response.message(errorMessage);
      return;
    }
    
    const product = productMatch[1].trim();
    const expiryDateStr = productMatch[2];
    
    console.log(`[${requestId}] Extracted product: "${product}", expiry date: "${expiryDateStr}"`);
    
    // Parse the expiry date
    const expiryDate = parseExpiryDate(expiryDateStr);
    if (!expiryDate) {
      console.log(`[${requestId}] Failed to parse expiry date`);
      const errorMessage = await generateMultiLanguageResponse(
        'Invalid date format. Please use: "Product: DD/MM/YYYY" or "Product: DD Month YYYY"',
        'en', // Default to English
        requestId
      );
      response.message(errorMessage);
      return;
    }
    
    // Get the most recent batch for this product
    const shopId = from.replace('whatsapp:', '');
    console.log(`[${requestId}] Looking for recent batches for ${product}`);
    const batches = await getBatchRecords(shopId, product);
    
    if (batches.length === 0) {
      console.log(`[${requestId}] No recent purchase found for ${product}`);
      const errorMessage = await generateMultiLanguageResponse(
        `No recent purchase found for ${product}. Please make a purchase first.`,
        'en', // Default to English
        requestId
      );
      response.message(errorMessage);
      return;
    }
    
    // Format the expiry date for Airtable
    const formattedExpiryDate = formatDateForAirtable(expiryDate);
    console.log(`[${requestId}] Formatted expiry date: ${formattedExpiryDate}`);
    
    // Update the most recent batch with expiry date
    const latestBatch = batches[0];
    console.log(`[${requestId}] Updating batch ${latestBatch.id} with expiry date`);
    const batchResult = await updateBatchExpiry(latestBatch.id, formattedExpiryDate);
    
    if (batchResult.success) {
      console.log(`[${requestId}] Successfully updated batch with expiry date`);
      const successMessage = await generateMultiLanguageResponse(
        `✅ Expiry date updated for ${product}: ${formatDateForDisplay(expiryDate)}`,
        'en', // Default to English
        requestId
      );
      response.message(successMessage);
    } else {
      console.error(`[${requestId}] Failed to update batch: ${batchResult.error}`);
      const errorMessage = await generateMultiLanguageResponse(
        `Error updating expiry date for ${product}. Please try again.`,
        'en', // Default to English
        requestId
      );
      response.message(errorMessage);
    }
  } catch (error) {
    console.error(`[${requestId}] Error handling expiry date update:`, error.message);
    const errorMessage = await generateMultiLanguageResponse(
      'Error processing expiry date. Please try again.',
      'en', // Default to English
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

// Detect language of transcript
async function detectLanguage(transcript, requestId) {
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
            content: transcript
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
            content: `You are a multilingual assistant. Translate the given message to the target language and provide it in both Roman script and native script (if applicable).
            
            Format your response exactly as:
            <translation in Roman script>
            
            <translation in native script>
            
            Do not include any labels like [Roman Script] or [Native Script]. Just provide the translations one after the other with a blank line in between.`
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
    
    const translated = response.data.choices[0].message.content.trim();
    console.log(`[${requestId}] Generated multilingual response:`, translated);
    return translated;
  } catch (error) {
    console.warn(`[${requestId}] Translation failed, using original:`, error.message);
    return message;
  }
}

// Parse multiple inventory updates from transcript
function parseMultipleUpdates(transcript) {
  const updates = [];
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
  
  console.log(`Parsed ${updates.length} valid updates from transcript`);
  return updates;
}

// Parse single update with better action detection
function parseSingleUpdate(transcript) {
  const products = [
    'Parle-G', 'पारले-जी', 'Britannia', 'ब्रिटानिया',
    'Maggi', 'Nestle', 'Dabur', 'Amul', 'Tata',
    'flour', 'आटा', 'sugar', 'चीनी', 'packets', 'पैकेट'
  ];
  
  // Improved product matching with partial matches
  let product = 'Unknown';
  for (const p of products) {
    if (transcript.toLowerCase().includes(p.toLowerCase())) {
      product = p;
      break;
    }
  }
  
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
  
  // Better action detection with priority for purchase/sold over remaining
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

// Handle multiple inventory updates with batch tracking
async function updateMultipleInventory(shopId, updates, languageCode) {
  const results = [];
  
  for (const update of updates) {
    try {
      console.log(`[Update ${shopId} - ${update.product}] Processing update: ${update.quantity}`);
      
      const result = await updateInventory(shopId, update.product, update.quantity);
      
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
      
      results.push({
        product: update.product,
        quantity: update.quantity,
        ...result
      });
    } catch (error) {
      console.error(`[Update ${shopId} - ${update.product}] Error:`, error.message);
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

// Validate if transcript is an inventory update
function isValidInventoryUpdate(parsed) {
  // Check if product is known (not "Unknown")
  const validProduct = parsed.product !== 'Unknown';
  
  // Check if quantity is non-zero
  const validQuantity = parsed.quantity !== 0;
  
  // Check if action is purchase, sold, or remaining
  const validAction = ['purchased', 'sold', 'remaining'].includes(parsed.action);
  
  return validProduct && validQuantity && validAction;
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
            - Ensure product names are correct (e.g., "flower" should be "flour")
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

// FIXED: Revert to original transcription settings that worked well
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
    
    // REVERTED: Back to original language priority that worked well
    const languageConfigs = [
      { languageCode: 'hi-IN', name: 'Hindi' },  // Back to Hindi first
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
          // SIMPLIFIED: Back to original speech context that worked well
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
        
        // REVERTED: Back to original model priority that worked well
        const configs = [
          { ...baseConfig, model: 'telephony' },  // Back to telephony first
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
