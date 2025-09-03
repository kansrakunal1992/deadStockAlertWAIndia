const twilio = require('twilio');
const axios = require('axios');
const {
    getAllShopIDs,
    getDailyUpdates,
    getCurrentInventory,
    getUserPreference,
    getShopBatchRecords,
    getRecentSales,
    getShopSalesRecords
} = require('./database');

// Helper function to format dates for display (DD/MM/YYYY)
function formatDateForDisplay(date) {
    if (date instanceof Date) {
        // Convert to IST (UTC+5:30)
        const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
        const istTime = new Date(date.getTime() + istOffset);
        
        const day = istTime.getUTCDate().toString().padStart(2, '0');
        const month = (istTime.getUTCMonth() + 1).toString().padStart(2, '0');
        const year = istTime.getUTCFullYear();
        return `${day}/${month}/${year}`;
    }
    return date;
}

// Helper function to calculate days between two dates
function daysBetween(date1, date2) {
    const oneDay = 24 * 60 * 60 * 1000; // hours*minutes*seconds*milliseconds
    const diffDays = Math.round(Math.abs((date1 - date2) / oneDay));
    return diffDays;
}

// Generate response in multiple languages and scripts without labels
async function generateMultiLanguageResponse(message, languageCode) {
  try {
    // If the language is English, return the message as is
    if (languageCode === 'en') {
      return message;
    }
    
    // Common greetings with native and roman scripts
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
      return `${greeting.native}\n\n${greeting.roman}`;
    }
    
    // For other messages, try the API
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
        timeout: 5000
      }
    );
    
    let translated = response.data.choices[0].message.content.trim();
    
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
    
    return translated;
  } catch (error) {
    console.warn('Translation failed, using original:', error.message);
    return message;
  }
}

// Send WhatsApp message with enhanced error handling and retry logic
async function sendWhatsAppMessage(to, body, maxRetries = 2) {
    try {
        // Check if required environment variables are set
        if (!process.env.ACCOUNT_SID) {
            throw new Error('ACCOUNT_SID environment variable is not set');
        }
        if (!process.env.AUTH_TOKEN) {
            throw new Error('AUTH_TOKEN environment variable is not set');
        }
        if (!process.env.TWILIO_WHATSAPP_NUMBER) {
            throw new Error('TWILIO_WHATSAPP_NUMBER environment variable is not set');
        }
        
        console.log(`Sending WhatsApp message to: ${to}`);
        console.log(`Using Twilio WhatsApp number: ${process.env.TWILIO_WHATSAPP_NUMBER}`);
        
        // Initialize Twilio client
        const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
        
        // Ensure the to number is in the format 'whatsapp:+<number>'
        const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
        console.log(`Formatted to: ${formattedTo}`);
        
        let lastError;
        
        // Retry logic with exponential backoff
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const message = await client.messages.create({
                    body: body,
                    from: process.env.TWILIO_WHATSAPP_NUMBER,
                    to: formattedTo,
                    timeout: 10000 // 10 second timeout
                });
                
                console.log(`Message sent successfully. SID: ${message.sid}`);
                return message;
            } catch (error) {
                lastError = error;
                console.warn(`Attempt ${attempt} failed:`, error.message);
                
                // If this is the last attempt, throw the error
                if (attempt === maxRetries) {
                    break;
                }
                
                // Wait before retrying (exponential backoff)
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
        throw error;
    }
}

// Process a single shop's daily summary
// Process a single shop's daily summary
async function processShopSummary(shopId) {
  const context = `Process Shop ${shopId}`;
  
  try {
    console.log(`[${context}] Starting processing`);
    
    // Get user preference
    const userPref = await getUserPreference(shopId);
    const userLanguage = userPref.success ? userPref.language : 'en';
    console.log(`[${context}] User language: ${userLanguage}`);
    
    // Get today's sales data
    const todaySales = await getTodaySalesSummary(shopId);
    console.log(`[${context}] Today's sales: ${todaySales.totalItems} items`);
    
    // Get inventory summary
    const inventorySummary = await getInventorySummary(shopId);
    console.log(`[${context}] Inventory: ${inventorySummary.totalProducts} products`);
    
    // Get low stock products
    const lowStockProducts = await getLowStockProducts(shopId, 5);
    console.log(`[${context}] Low stock products: ${lowStockProducts.length}`);
    
    // Get expiring products
    const expiringProducts = await getExpiringProducts(shopId, 7);
    console.log(`[${context}] Expiring products: ${expiringProducts.length}`);
    
    // Format the message
    let message = `📊 Daily Inventory Summary (${formatDateForDisplay(new Date())}):\n\n`;
    
    // Sales information
    if (todaySales.totalItems > 0) {
      message += `💰 Sales: ${todaySales.totalItems} items`;
      if (todaySales.totalValue > 0) {
        message += ` (₹${todaySales.totalValue.toFixed(2)})`;
      }
      message += `\n`;
      
      if (todaySales.topProducts.length > 0) {
        message += `\n🛒 Top Sellers:\n`;
        todaySales.topProducts.forEach(product => {
          message += `• ${product.name}: ${product.quantity} ${product.unit}\n`;
        });
      }
    } else {
      message += `💰 No sales recorded today.\n`;
    }
    
    // Inventory overview
    message += `\n📦 Current Inventory: ${inventorySummary.totalProducts} unique products`;
    if (inventorySummary.totalValue > 0) {
      message += ` (₹${inventorySummary.totalValue.toFixed(2)})`;
    }
    message += `\n`;
    
    // Low stock alerts
    if (lowStockProducts.length > 0) {
      message += `\n⚠️ Low Stock Alerts:\n`;
      lowStockProducts.forEach(product => {
        message += `• ${product.name}: Only ${product.quantity} ${product.unit} left\n`;
      });
    }
    
    // Expiry alerts
    if (expiringProducts.length > 0) {
      message += `\n⏰ Expiring Soon:\n`;
      expiringProducts.forEach(product => {
        message += `• ${product.name}: Expires on ${formatDateForDisplay(product.expiryDate)}\n`;
      });
    }
    
    message += `\nThank you for using our inventory management system!`;
    
    // Generate multilingual response
    const formattedMessage = await generateMultiLanguageResponse(message, userLanguage);
    
    // Send the message
    await sendWhatsAppMessage(shopId, formattedMessage);
    console.log(`[${context}] Daily summary sent successfully`);
    
    return { shopId, success: true };
  } catch (error) {
    console.error(`[${context}] Error:`, error.message);
    return { shopId, success: false, error: error.message };
  }
}

// Main function to run daily summary with parallel processing
async function runDailySummary() {
    try {
        console.log('Starting daily summary job...');
        
        // Log environment variables for debugging (without exposing sensitive data)
        console.log('Environment variables check:');
        console.log(`ACCOUNT_SID set: ${!!process.env.ACCOUNT_SID}`);
        console.log(`AUTH_TOKEN set: ${!!process.env.AUTH_TOKEN}`);
        console.log(`TWILIO_WHATSAPP_NUMBER: ${process.env.TWILIO_WHATSAPP_NUMBER}`);
        console.log(`DEEPSEEK_API_KEY set: ${!!process.env.DEEPSEEK_API_KEY}`);
        
        // Get all shop IDs
        const shopIds = await getAllShopIDs();
        console.log(`Found ${shopIds.length} shops to process`);
        
        if (shopIds.length === 0) {
            console.log('No shops found to process');
            return [];
        }
        
        // Process shops in parallel with a concurrency limit
        const concurrencyLimit = 5; // Process 5 shops at a time
        const results = [];
        
        for (let i = 0; i < shopIds.length; i += concurrencyLimit) {
            const batch = shopIds.slice(i, i + concurrencyLimit);
            console.log(`Processing batch of ${batch.length} shops (${i + 1}-${i + batch.length} of ${shopIds.length})`);
            
            const batchPromises = batch.map(shopId => 
                processShopSummary(shopId).catch(error => {
                    console.error(`Error processing shop ${shopId}:`, error.message);
                    return { shopId, success: false, error: error.message };
                })
            );
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            // Process results
            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    // This shouldn't happen since we're catching errors in the promises
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
        
        console.log(`Daily summary job completed: ${successCount} successful, ${failureCount} failed`);
        
        return results;
    } catch (error) {
        console.error('Error in daily summary job:', error.message);
        throw error;
    }
}

module.exports = { processShopSummary };
