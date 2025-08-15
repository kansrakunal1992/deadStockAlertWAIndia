const twilio = require('twilio');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const { updateInventory, testConnection, createBatchRecord, getBatchRecords, updateBatchExpiry } = require('./database');
// Global storage for user preferences and pending transcriptions
global.userPreferences = {};
global.pendingTranscriptions = {};
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
// FIXED: Create interactive button message
function createButtonMessage(message, buttons) {
  const response = new twilio.twiml.MessagingResponse();
  const messageObj = response.message({
    body: message
  });

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

  return response.toString();
}
// Function to process confirmed transcription
async function processConfirmedTranscription(transcript, from, detectedLanguage, requestId, response, res) {
  try {
    console.log(`[${requestId}] [6] Parsing multiple updates...`);
    const updates = parseMultipleUpdates(transcript);
    
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
        message += `• ${result.product}: ${result.quantity > 0 ? '+' : ''}${result.quantity} (Stock: ${result.newQuantity})\n`;
        
        if (result.quantity > 0 && result.batchDate) {
          message += `  Batch added: ${formatDateForDisplay(result.batchDate)}\n`;
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
    }
    
    const formattedResponse = await generateMultiLanguageResponse(message, detectedLanguage, requestId);
    
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
module.exports = async (req, res) => {
  const response = new twilio.twiml.MessagingResponse();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    
    const { MediaUrl0, NumMedia, SpeechResult, From, Body, ButtonText } = req.body;
    
    // Check for user preference
    let userPreference = 'voice'; // Default to voice
    if (global.userPreferences[From]) {
      userPreference = global.userPreferences[From];
      console.log(`[${requestId}] User preference: ${userPreference}`);
    }
    
    // Handle button responses
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
    
    // Handle confirmation responses
    if (Body && (Body.toLowerCase() === 'yes' || Body.toLowerCase() === 'no')) {
      console.log(`[${requestId}] Message appears to be a confirmation response: "${Body}"`);
      
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
    }
    
    // Handle text messages
    if (!NumMedia && Body) {
      console.log(`[${requestId}] [1] Processing text message: "${Body}"`);
      
      // Check for common greetings
      const greetings = {
        'hi': ['hello', 'hi', 'hey', 'नमस्ते', 'नमस्कार', 'हाय'],
        'ta': ['vanakkam', 'வணக்கம்'],
        'te': ['నమస్కారం', 'హలో'],
        'kn': ['ನಮಸ್ಕಾರ', 'ಹಲೋ'],
        'bn': ['নমস্কার', 'হ্যালো'],
        'gu': ['નમસ્તે', 'હેલો'],
        'mr': ['नमस्कार', 'हॅलो'],
        'en': ['hello', 'hi', 'hey']
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
        
        if (userPreference !== 'voice') {
          const preferenceMessage = await generateMultiLanguageResponse(
            `Welcome! I see you prefer to send updates by ${userPreference}. How can I help you today?`,
            greetingLang,
            requestId
          );
          response.message(preferenceMessage);
          return res.send(response.toString());
        }
        
        const welcomeMessage = await generateMultiLanguageResponse(
          'Welcome! How would you like to send your inventory update?',
          greetingLang,
          requestId
        );
        
        // Create interactive buttons
        const buttons = [
          { id: 'voice_input', title: 'Voice Message' },
          { id: 'text_input', title: 'Text Message' }
        ];
        
        const buttonResponse = createButtonMessage(welcomeMessage, buttons);
        return res.send(buttonResponse);
      }
      
      // Check for batch selection or expiry date updates
      if (isBatchSelectionResponse(Body)) {
        console.log(`[${requestId}] Message appears to be a batch selection response`);
        await handleBatchSelectionResponse(Body, From, response, requestId);
      } 
      else if (isExpiryDateUpdate(Body)) {
        console.log(`[${requestId}] Message appears to be an expiry date update`);
        await handleExpiryDateUpdate(Body, From, response, requestId);
      }
      else {
        console.log(`[${requestId}] Message does not appear to be a batch selection or expiry date update`);
        
        let detectedLanguage;
        try {
          detectedLanguage = await detectLanguageWithFallback(Body, requestId);
          console.log(`[${requestId}] Detected language for text update: ${detectedLanguage}`);
        } catch (error) {
          console.warn(`[${requestId}] Language detection failed, defaulting to English:`, error.message);
          detectedLanguage = 'en';
        }
        
        // Try to parse as inventory update
        const updates = parseMultipleUpdates(Body);
        
        if (updates.length > 0) {
          console.log(`[${requestId}] Parsed ${updates.length} updates from text message`);
          
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
          const defaultMessage = await generateMultiLanguageResponse(
            userPreference === 'voice' 
              ? '🎤 Send inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.'
              : '📝 Type your inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.',
            detectedLanguage,
            requestId
          );
          response.message(defaultMessage);
        }
      }
      
      return res.send(response.toString());
    }
    
    // Handle voice messages
    if (NumMedia > 0 && MediaUrl0) {
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
      
      // Confidence-based confirmation
      const CONFIDENCE_THRESHOLD = 0.8;
      
      if (confidence < CONFIDENCE_THRESHOLD) {
        console.log(`[${requestId}] [5.5] Low confidence (${confidence}), requesting confirmation...`);
        const confirmationResponse = await confirmTranscription(cleanTranscript, From, detectedLanguage, requestId);
        return res.send(confirmationResponse);
      } else {
        console.log(`[${requestId}] [5.5] High confidence (${confidence}), proceeding without confirmation...`);
        
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
    }
    else if (SpeechResult) {
      console.log(`[${requestId}] [1] Using Twilio transcription`);
      response.message(`🔊 (Twilio): "${SpeechResult}"`);
    }
    else {
      console.log(`[${requestId}] [1] No media received`);
      
      let detectedLanguage;
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
          '🎤 Send inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.',
          detectedLanguage,
          requestId
        );
      } else {
        welcomeMessage = await generateMultiLanguageResponse(
          '📝 Type your inventory update: "10 Parle-G sold". Expiry dates are suggested for better batch tracking.',
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
// NEW: Function to check if a message is a batch selection response
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
// NEW: Function to check if a message is an expiry date update
function isExpiryDateUpdate(message) {
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
        'en',
        requestId
      );
      response.message(errorMessage);
      return;
    }
    
    const batches = await getBatchRecords(shopId, product);
    
    if (batches.length === 0) {
      const errorMessage = await generateMultiLanguageResponse(
        `No batches found for ${product}.`,
        'en',
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
          'en',
          requestId
        );
        response.message(successMessage);
        return;
      }
    }
    
    const confirmMessage = await generateMultiLanguageResponse(
      `✅ Selected ${product} batch from ${formatDateForDisplay(selectedBatch.fields.PurchaseDate)}`,
      'en',
      requestId
    );
    response.message(confirmMessage);
  } catch (error) {
    console.error(`[${requestId}] Error handling batch selection response:`, error.message);
    const errorMessage = await generateMultiLanguageResponse(
      'Error processing batch selection. Please try again.',
      'en',
      requestId
    );
    response.message(errorMessage);
  }
}
// NEW: Handle expiry date update
async function handleExpiryDateUpdate(body, from, response, requestId) {
  try {
    console.log(`[${requestId}] Processing expiry date update: "${body}"`);
    
    const productMatch = body.match(/([a-zA-Z\s]+):?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
    
    if (!productMatch) {
      console.log(`[${requestId}] Invalid expiry date format`);
      const errorMessage = await generateMultiLanguageResponse(
        'Invalid format. Please use: "Product: DD/MM/YYYY" or "Product: DD Month YYYY"',
        'en',
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
        'en',
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
        'en',
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
        'en',
        requestId
      );
      response.message(successMessage);
    } else {
      console.error(`[${requestId}] Failed to update batch: ${batchResult.error}`);
      const errorMessage = await generateMultiLanguageResponse(
        `Error updating expiry date for ${product}. Please try again.`,
        'en',
        requestId
      );
      response.message(errorMessage);
    }
  } catch (error) {
    console.error(`[${requestId}] Error handling expiry date update:`, error.message);
    const errorMessage = await generateMultiLanguageResponse(
      'Error processing expiry date. Please try again.',
      'en',
      requestId
    );
    response.message(errorMessage);
  }
}
// Parse expiry date in various formats
function parseExpiryDate(dateStr) {
  const dmyMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1]);
    const month = parseInt(dmyMatch[2]);
    let year = parseInt(dmyMatch[3]);
    
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }
    
    return new Date(year, month - 1, day);
  }
  
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
    
    translated = translated.replace(/<translation in roman script>/gi, '');
    translated = translated.replace(/<translation in native script>/gi, '');
    translated = translated.replace(/\[roman script\]/gi, '');
    translated = translated.replace(/\[native script\]/gi, '');
    translated = translated.replace(/translation in roman script:/gi, '');
    translated = translated.replace(/translation in native script:/gi, '');
    
    translated = translated.replace(/^"(.*)"$/, '$1');
    translated = translated.replace(/"/g, '');
    
    translated = translated.replace(/\n\s*\n\s*\n/g, '\n\n');
    translated = translated.replace(/^\s+|\s+$/g, '');
    
    console.log(`[${requestId}] Cleaned multilingual response:`, translated);
    return translated;
  } catch (error) {
    console.warn(`[${requestId}] Translation failed, using original:`, error.message);
    return message;
  }
}
// Parse multiple inventory updates from transcript
function parseMultipleUpdates(transcript) {
  const updates = [];
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
  
  let product = 'Unknown';
  for (const p of products) {
    if (transcript.toLowerCase().includes(p.toLowerCase())) {
      product = p;
      break;
    }
  }
  
  const numberWords = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 
    'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
    'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
    'eighteen': 18, 'nineteen': 19, 'twenty': 20, 'thirty': 30, 'forty': 40, 
    'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90, 'hundred': 100,
    
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'छह': 6, 
    'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'ग्यारह': 11, 'बारह': 12,
    'तेरह': 13, 'चौदह': 14, 'पंद्रह': 15, 'सोलह': 16, 'सत्रह': 17,
    'अठारह': 18, 'उन्नीस': 19, 'बीस': 20, 'तीस': 30, 'चालीस': 40, 
    'पचास': 50, 'साठ': 60, 'सत्तर': 70, 'अस्सी': 80, 'नब्बे': 90, 'सौ': 100
  };
  
  let quantity = 0;
  
  const digitMatch = transcript.match(/(\d+)/i);
  if (digitMatch) {
    quantity = parseInt(digitMatch[1]) || 0;
  } else {
    const words = transcript.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (numberWords[word]) {
        quantity = numberWords[word];
        break;
      }
    }
  }
  
  const isPurchase = /(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)/i.test(transcript);
  const isSold = /(बेचा|बेचे|becha|sold|बिक्री)/i.test(transcript);
  const isRemaining = /(बचा|बचे|बाकी|remaining|left)/i.test(transcript);
  
  let action, finalQuantity;
  
  if (isPurchase) {
    action = 'purchased';
    finalQuantity = quantity;
  } else if (isSold) {
    action = 'sold';
    finalQuantity = -quantity;
  } else if (isRemaining) {
    action = 'remaining';
    finalQuantity = quantity;
  } else {
    action = 'sold';
    finalQuantity = -quantity;
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
      
      if (update.quantity > 0 && result.success) {
        console.log(`[Update ${shopId} - ${update.product}] Creating batch record for purchase`);
        const formattedPurchaseDate = formatDateForAirtable(new Date());
        
        const batchResult = await createBatchRecord({
          shopId,
          product: update.product,
          quantity: update.quantity,
          purchaseDate: formattedPurchaseDate,
          expiryDate: null
        });
        
        if (batchResult.success) {
          console.log(`[Update ${shopId} - ${update.product}] Batch record created with ID: ${batchResult.id}`);
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
  const validProduct = parsed.product !== 'Unknown';
  const validQuantity = parsed.quantity !== 0;
  const validAction = ['purchased', 'sold', 'remaining'].includes(parsed.action);
  
  return validProduct && validQuantity && validAction;
}
// Improved handling of "bacha" vs "becha" confusion
async function validateTranscript(transcript, requestId) {
  try {
    let fixedTranscript = transcript;
    
    fixedTranscript = fixedTranscript.replace(/(\d+)\s*(kg|किलो|packets?|पैकेट|grams?|ग्राम)\s*([a-zA-Z\s]+)\s+बचा/gi, (match, qty, unit, product) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${qty} ${unit} ${product} बेचा"`);
      return `${qty} ${unit} ${product} बेचा`;
    });
    
    fixedTranscript = fixedTranscript.replace(/([a-zA-Z\s]+)\s+(\d+)\s*(kg|किलो|packets?|पैकेट|grams?|ग्राम)\s+बचा/gi, (match, product, qty, unit) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${product} ${qty} ${unit} बेचा"`);
      return `${product} ${qty} ${unit} बेचा`;
    });
    
    fixedTranscript = fixedTranscript.replace(/([a-zA-Z\s]+)\s+बचा\s+.*?(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)/gi, (match, product, purchase) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${product} बेचा, ${purchase}"`);
      return `${product} बेचा, ${purchase}`;
    });
    
    fixedTranscript = fixedTranscript.replace(/(खरीदा|खरीदे|लिया|खरीदी|bought|purchased|buy)\s+([a-zA-Z\s]+)\s+बचा/gi, (match, purchase, product) => {
      console.log(`[${requestId}] Fixed mispronunciation: "${match}" → "${purchase} ${product}, बेचा ${product}"`);
      return `${purchase} ${product}, बेचा ${product}`;
    });
    
    fixedTranscript = fixedTranscript.replace(/([a-zA-Z\s]+)\s+बचा[.!?]*$/gi, (match, product) => {
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
