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
// In dailySummary.js, replace the generateMultiLanguageResponse function
async function generateMultiLanguageResponse(message, languageCode) {
  try {
    // If the language is English, return the message as is
    if (languageCode === 'en') {
      return message;
    }
    
    // Simplified translations for common messages
    const simpleTranslations = {
      'hi': {
        'daily inventory summary': 'आज की इन्वेंट्री रिपोर्ट\n\nAaj ki inventory report',
        'sales': 'बिक्री\n\nSales',
        'no sales recorded': 'कोई बिक्री नहीं हुई\n\nKoi bikri nahi hui',
        'low stock alerts': 'कम सामान की चेतावनी\n\nKam saman ki chetavni',
        'expiring soon': 'जल्द खत्म हो रहा\n\nJald khatm ho raha',
        'thank you': 'शुक्रिया\n\nShukriya'
      },
      'bn': {
        'daily inventory summary': 'আজকের ইনভেন্টরি রিপোর্ট\n\nAajker inventory report',
        'sales': 'বিক্রি\n\nBikri',
        'no sales recorded': 'কোনো বিক্রি রেকর্ড করা হয়নি\n\nKono bikri record kora hoyeni',
        'low stock alerts': 'কম স্টক সতর্কতা\n\nKom stock sotorkota',
        'expiring soon': 'শীঘ্রই মেয়াদ উত্তীর্ণ হচ্ছে\n\nShighroi meyar uttirno hochchhe',
        'thank you': 'ধন্যবাদ\n\nDhonnobad'
      },
      'ta': {
        'daily inventory summary': 'இன்றைய இன்வென்டரி சுருக்கம்\n\nInraiya inventory summary',
        'sales': 'விற்பனை\n\nVippanai',
        'no sales recorded': 'பதிவு செய்யப்பட்ட விற்பனை இல்லை\n\nPadu seyyappatta vippanai illai',
        'low stock alerts': 'குறைந்த ஸ்டாக் எச்சரிக்கைகள்\n\nKurina stock alerts',
        'expiring soon': 'விரைவில் காலாவதியும்\n\nViraivil kaalavadivum',
        'thank you': 'நன்றி\n\nNandri'
      },
      'te': {
        'daily inventory summary': 'నేడు ఇన్వెంటరీ సారాంశం\n\nNedu inventory saaramsham',
        'sales': 'అమ్మకాలు\n\nAmmakaalu',
        'no sales recorded': 'నమోదు చేసిన అమ్మకాలు లేవు\n\nNodu chesina ammakaalu levu',
        'low stock alerts': 'తక్కువ స్టాక్ హెచ్చరికలు\n\nTakkuva stock hchharikalu',
        'expiring soon': 'త్వరలో గడదీయబోయేవి\n\nTwralo gadadiboyevi',
        'thank you': 'ధన్యవాదాలు\n\nDhanyavaadalu'
      },
      'kn': {
        'daily inventory summary': 'ಇಂದಿನ ಇನ್ವೆಂಟರಿ ಸಾರಾಂಶ\n\nIndina inventory saaransha',
        'sales': 'ಮಾರಾಟಗಳು\n\nMaarataḷu',
        'no sales recorded': 'ದಾಖಲಾದ ಮಾರಾಟಗಳಿಲ್ಲ\n\nDaakhaada maaraṭagilla',
        'low stock alerts': 'ಕಡಿಮೆ ಸ್ಟಾಕ್ ಎಚ್ಚರಿಕೆಗಳು\n\nKaḍime stock heccharikegaḷu',
        'expiring soon': 'ಶೀಘ್ರವೇ ಮುಕ್ತಾಯವಾಗುತ್ತಿರುವುದು\n\nShighrave muktaayavaguttiruvudu',
        'thank you': 'ಧನ್ಯವಾದಗಳು\n\nDhanyavaadagaḷu'
      },
      'gu': {
        'daily inventory summary': 'આજની ઇન્વેન્ટરી સારાંશ\n\nAajni inventory saaraansh',
        'sales': 'વેચાણ\n\nVechaan',
        'no sales recorded': 'નોંધાયેલ કોઈ વેચાણ નથી\n\nNodhaayel koi vechaan nathi',
        'low stock alerts': 'ઓછા સ્ટોક ના અલર્ટ\n\nOchha stock na alert',
        'expiring soon': 'ટૂંકમાં નિવૃત્તિ થઈ રહી છે\n\nToonkaam nivruti thi rahi che',
        'thank you': 'આભાર\n\nAabhaar'
      },
      'mr': {
        'daily inventory summary': 'आजचे इन्व्हेन्टरी सारांश\n\nAajche inventory saaransh',
        'sales': 'विक्री\n\nVikri',
        'no sales recorded': 'नोंदीविक्री नाही\n\nNodhivikri naahi',
        'low stock alerts': 'कमी स्टॉक अलर्ट\n\nKami stock alert',
        'expiring soon': 'लवकरच समाप्त होणारे\n\nLavakach samapt honaare',
        'thank you': 'धन्यवाद\n\nDhanyavaad'
      }
    };
    
    // Check if we have a simple translation for this message
    const lowerMessage = message.toLowerCase();
    const translations = simpleTranslations[languageCode] || simpleTranslations['en'];
    
    for (const [key, value] of Object.entries(translations)) {
      if (lowerMessage.includes(key)) {
        return value;
      }
    }
    
    // For other messages, try the API with a simplified prompt
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `You are a multilingual assistant. Translate the given message to the target language using simple, everyday language that anyone can understand. Avoid formal or literary expressions.

Format your response exactly as:
Line 1: Translation in native script (simple, colloquial language)
Empty line
Line 3: Translation in Roman script (transliteration using English alphabet)

For example, for Hindi:
हाय, आप कैसे हो?
Haay, aap kaise ho?

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
