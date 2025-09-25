const twilio = require('twilio');
const axios = require('axios');
const crypto = require('crypto');
const {
    getAllShopIDs,
    getCurrentInventory,    
    getUserPreference,
    getUserPlan,
    isFeatureAvailable,
    isFirst50Shops,
    getTodaySalesSummary,
    getInventorySummary,
    getLowStockProducts,
    getExpiringProducts,
    getTranslationEntry,
    upsertTranslationEntry
} = require('./database');

// ====== DETERMINISTIC NATIVEGLISH LABEL RENDERER (no external API) ======
const NL_LABELS = {  
hi: {
    'Short Summary': 'संक्षिप्त सारांश',
    'Sales Today': 'आज की बिक्री',
    'vs Yesterday': 'कल के मुकाबले',
    'WTD': 'सप्ताह-पर्यंत',
    'Top Movers Today': 'आज के टॉप मूवर्स',
    'Inventory': 'भंडार',
    'Low Stock': 'स्टॉक कम',
    'Low Stock Alerts': 'स्टॉक कम अलर्ट',
    'Expiring Soon': 'शीघ्र समाप्त',
    'Next actions': 'अगले कदम',
    'Glossary': 'शब्दावली',
    'Daily Inventory Summary': 'दैनिक भंडार सारांश',
    'Sales': 'बिक्री',
    'GST Collected': 'एकत्रित GST',
    'Top Sellers': 'सबसे अधिक बिकने वाले',
    'Top Categories': 'शीर्ष श्रेणियाँ',
    'Current Inventory': 'वर्तमान भंडार',
    'Total Value': 'कुल मूल्य',
    'Total Cost': 'कुल लागत',
    'Profit Margin': 'लाभ मार्जिन',
    'Inventory by Category': 'वर्ग अनुसार भंडार',
    'Insights': 'अंतर्दृष्टि'
  },
  bn: {
    'Short Summary': 'সংক্ষিপ্ত সারাংশ',
    'Sales Today': 'আজকের বিক্রি',
    'vs Yesterday': 'গতকালের তুলনায়',
    'WTD': 'সপ্তাহ-পর্যন্ত',
    'Top Movers Today': 'আজকের শীর্ষ বিক্রিত',
    'Inventory': 'মজুত',
    'Low Stock': 'স্টক কম',
    'Low Stock Alerts': 'স্টক কম সতর্কতা',
    'Expiring Soon': 'শীঘ্রই মেয়াদোত্তীর্ণ',
    'Next actions': 'পরবর্তী পদক্ষেপ',
    'Glossary': 'শব্দতালিকা',
    'Daily Inventory Summary': 'দৈনিক মজুত সারাংশ',
    'Sales': 'বিক্রি',
    'GST Collected': 'সংগৃহীত GST',
    'Top Sellers': 'শীর্ষ বিক্রিত',
    'Top Categories': 'শীর্ষ শ্রেণী',
    'Current Inventory': 'বর্তমান মজুত',
    'Total Value': 'মোট মূল্য',
    'Total Cost': 'মোট খরচ',
    'Profit Margin': 'লাভের মার্জিন',
    'Inventory by Category': 'বিভাগ অনুযায়ী মজুত',
    'Insights': 'ইনসাইটস'
  },
  ta: {
    'Short Summary':'சுருக்கம்',
    'Sales Today':'இன்று விற்பனை',
    'vs Yesterday':'நேற்றுடன் ஒப்பிடுக',
    'WTD':'வாரம் வரை',
    'Top Movers Today':'இன்றைய மேல் நகர்வுகள்',
    'Inventory':'இருப்பு',
    'Low Stock':'இருப்பு குறைவு',
    'Low Stock Alerts':'இருப்பு குறைவு எச்சரிக்கை',
    'Expiring Soon':'விரைவில் காலாவதி',
    'Next actions':'அடுத்த செயல்கள்',
    'Glossary':'சொற்களஞ்சியம்',
    'Daily Inventory Summary':'தினசரி இருப்பு சுருக்கம்',
    'Sales':'விற்பனை',
    'GST Collected':'திரட்டிய GST',
    'Top Sellers':'அதிகம் விற்கப்பட்டவை',
    'Top Categories':'சிறந்த வகைகள்',
    'Current Inventory':'தற்போதைய இருப்பு',
    'Total Value':'மொத்த மதிப்பு',
    'Total Cost':'மொத்த செலவு',
    'Profit Margin':'லாப விகிதம்',
    'Inventory by Category':'வகை வாரியான இருப்பு',
    'Insights':'உள்ளடக்கங்கள்'
  },
  te: {
    'Short Summary':'సంక్షిప్త సారాంశం',
    'Sales Today':'ఈరోజు అమ్మకాలు',
    'vs Yesterday':'నిన్నతో పోల్చితే',
    'WTD':'వారం వరకు',
    'Top Movers Today':'ఈరోజు టాప్ మూవర్స్',
    'Inventory':'నిల్వ',
    'Low Stock':'తక్కువ నిల్వ',
    'Low Stock Alerts':'తక్కువ నిల్వ హెచ్చరికలు',
    'Expiring Soon':'త్వరలో గడువు ముగియనున్నవి',
    'Next actions':'తదుపరి చర్యలు',
    'Glossary':'పదకోశం',
    'Daily Inventory Summary':'రోజువారీ నిల్వ సారాంశం',
    'Sales':'అమ్మకాలు',
    'GST Collected':'సేకరించిన GST',
    'Top Sellers':'అత్యధికంగా అమ్మినవి',
    'Top Categories':'ఉత్తమ వర్గాలు',
    'Current Inventory':'ప్రస్తుత నిల్వ',
    'Total Value':'మొత్తం విలువ',
    'Total Cost':'మొత్తం ఖర్చు',
    'Profit Margin':'లాభ మార్జిన్',
    'Inventory by Category':'వర్గాల వారీ నిల్వ',
    'Insights':'అవగాహనలు'
  },
  kn: {
    'Short Summary':'ಸಂಕ್ಷಿಪ್ತ ಸಾರಾಂಶ',
    'Sales Today':'ಇಂದಿನ ಮಾರಾಟ',
    'vs Yesterday':'ನಿನ್ನೆ ಜೊತೆ ಹೋಲಿಕೆ',
    'WTD':'ವಾರದವರೆಗೆ',
    'Top Movers Today':'ಇಂದಿನ ಟಾಪ್ ಮೂವರ್ಸ್',
    'Inventory':'ಸಂಗ್ರಹ',
    'Low Stock':'ಕಡಿಮೆ ಸಂಗ್ರಹ',
    'Low Stock Alerts':'ಕಡಿಮೆ ಸಂಗ್ರಹ ಎಚ್ಚರಿಕೆ',
    'Expiring Soon':'ಶೀಘ್ರದಲ್ಲೇ ಅವಧಿ ಮುಗಿಯುವವು',
    'Next actions':'ಮುಂದಿನ ಕ್ರಮಗಳು',
    'Glossary':'ಪದಕೋಶ',
    'Daily Inventory Summary':'ದೈನಂದಿನ ಸಂಗ್ರಹ ಸಾರಾಂಶ',
    'Sales':'ಮಾರಾಟ',
    'GST Collected':'ಸಂಗ್ರಹಿಸಿದ GST',
    'Top Sellers':'ಅತ್ಯಂತ ಮಾರಾಟವಾದವು',
    'Top Categories':'ಅತ್ಯುತ್ತಮ ವರ್ಗಗಳು',
    'Current Inventory':'ಪ್ರಸ್ತುತ ಸಂಗ್ರಹ',
    'Total Value':'ಒಟ್ಟು ಮೌಲ್ಯ',
    'Total Cost':'ಒಟ್ಟು ವೆಚ್ಚ',
    'Profit Margin':'ಲಾಭ ಅಂಚು',
    'Inventory by Category':'ವರ್ಗಗಳ ಪ್ರಕಾರ ಸಂಗ್ರಹ',
    'Insights':'ಅಂತರ್ಗತಗಳು'
  },
  mr: {
    'Short Summary':'संक्षिप्त सारांश',
    'Sales Today':'आजची विक्री',
    'vs Yesterday':'कालच्या तुलनेत',
    'WTD':'आठवडा-पर्यंत',
    'Top Movers Today':'आजचे टॉप मूव्हर्स',
    'Inventory':'साठा',
    'Low Stock':'कमी साठा',
    'Low Stock Alerts':'कमी साठ्याची सूचना',
    'Expiring Soon':'लवकरच कालबाह्य',
    'Next actions':'पुढील कृती',
    'Glossary':'शब्दकोश',
    'Daily Inventory Summary':'दैनिक साठा सारांश',
    'Sales':'विक्री',
    'GST Collected':'आकारलेला GST',
    'Top Sellers':'टॉप विक्री',
    'Top Categories':'शीर्ष वर्ग',
    'Current Inventory':'वर्तमान साठा',
    'Total Value':'एकूण मूल्य',
    'Total Cost':'एकूण खर्च',
    'Profit Margin':'नफा मार्जिन',
    'Inventory by Category':'वर्गनिहाय साठा',
    'Insights':'इनसाइट्स'
  },
  gu: {
    'Short Summary':'સંક્ષિપ્ત સારાંશ',
    'Sales Today':'આજનું વેચાણ',
    'vs Yesterday':'કાલની તુલનામાં',
    'WTD':'અઠવાડિયા સુધી',
    'Top Movers Today':'આજના ટોપ મૂવર્સ',
    'Inventory':'જથ્થો',
    'Low Stock':'ઓછો જથ્થો',
    'Low Stock Alerts':'ઓછા જથ્થાની ચેતવણી',
    'Expiring Soon':'ટૂંક સમયમાં ગાળા પૂરા',
    'Next actions':'આગળની કાર્યવાહી',
    'Glossary':'શબ્દકોશ',
    'Daily Inventory Summary':'દૈનિક જથ્થો સારાંશ',
    'Sales':'વેચાણ',
    'GST Collected':'ઉઘરેલો GST',
    'Top Sellers':'ટોપ વેચાણ',
    'Top Categories':'શ્રેષ્ઠ શ્રેણીઓ',
    'Current Inventory':'વર્તમાન જથ્થો',
    'Total Value':'કુલ કિંમત',
    'Total Cost':'કુલ ખર્ચ',
    'Profit Margin':'નફાકીય માર్జિન',
    'Inventory by Category':'વર્ગ પ્રમાણે જથ્થો',
    'Insights':'ઇન્સાઇટ્સ'
  },
  en: {} // <-- critical fallback; keeps Object.keys(...) safe
};

// Helper function to split messages
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

function renderNativeglishLabels(text, languageCode) {
  const lang = (languageCode || 'en').toLowerCase();
  const dict = NL_LABELS[lang] || NL_LABELS.en;
  let out = text;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const key of Object.keys(dict)) {
    const native = dict[key];
    if (!native) continue;
    const re = new RegExp(esc(key), 'g');
    out = out.replace(re, `${native} (${key})`);
  }
  return out;
}

// Allow overriding translate timeout via env; default 30s
const TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS ?? 30000);

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

// Generate response in Nativeglish deterministically (no external API)
async function generateMultiLanguageResponse(message, languageCode) {
  return renderNativeglishLabels(message, languageCode);
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
        
        // Check if the message exceeds the WhatsApp limit (1600 characters)
        const MAX_LENGTH = 1600;
        if (body.length <= MAX_LENGTH) {
            let lastError;
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
        } else {
            // Split the message into chunks
            const chunks = splitMessage(body, MAX_LENGTH);
            console.log(`Splitting message into ${chunks.length} chunks`);
            
            const messageSids = [];
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                // Add part indicator for multi-part messages
                const partIndicator = `\n\n(Part ${i+1} of ${chunks.length})`;
                const chunkWithIndicator = chunk + partIndicator;

                console.log(`Sending part ${i+1}/${chunks.length} (${chunkWithIndicator.length} chars)`);
                
                let lastError;
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        const message = await client.messages.create({
                            body: chunkWithIndicator,
                            from: process.env.TWILIO_WHATSAPP_NUMBER,
                            to: formattedTo,
                            timeout: 10000 // 10 second timeout
                        });
                        
                        messageSids.push(message.sid);
                        console.log(`Part ${i+1} sent successfully. SID: ${message.sid}`);
                        
                        // Break out of retry loop on success
                        break;
                    } catch (error) {
                        lastError = error;
                        console.warn(`Attempt ${attempt} for part ${i+1} failed:`, error.message);
                        
                        // If this is the last attempt, throw the error
                        if (attempt === maxRetries) {
                            break;
                        }
                        
                        // Wait before retrying (exponential backoff)
                        const delay = Math.pow(2, attempt) * 1000;
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
                
                // If all retries failed for this chunk, throw the last error
                if (lastError) {
                    throw lastError;
                }
                
                // Add a small delay between parts to avoid rate limiting
                if (i < chunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            // Return the first message SID as the primary one
            return { sid: messageSids[0], parts: messageSids };
        }
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        console.error('Error details:', error.message);
        console.error('Error stack:', error.stack);
        throw error;
    }
}

// Get today's sales summary
//Removed

// Get inventory summary
//Removed

// Process a single shop's daily summary
async function processShopSummary(shopId) {
  const context = `Process Shop ${shopId}`;
  
  try {
    console.log(`[${context}] Starting processing`);
    
    // Check plan and feature availability
    const canSendSummary = await isFeatureAvailable(shopId, 'daily_summary');
    if (!canSendSummary) {
      const planInfo = await getUserPlan(shopId);
      let errorMessage = 'Daily summaries are not available on your current plan.';
      
      if (planInfo.plan === 'free_demo') {
        errorMessage = 'You have reached your daily summary limit for the Free Demo plan.';
      } else if (planInfo.plan === 'free_demo_first_50') {
        errorMessage = 'Your trial period has expired. Please upgrade to continue using daily summaries.';
      }
      
      // Send error message to user
      const userPref = await getUserPreference(shopId);
      const userLanguage = userPref.success ? userPref.language : 'en';
      const formattedMessage = await generateMultiLanguageResponse(errorMessage, userLanguage);
      await sendWhatsAppMessage(shopId, formattedMessage);
      
      return { shopId, success: false, error: 'Plan limit reached' };
    }
    
    // Check if summary was already sent today (for free_demo plan)
    const planInfo = await getUserPlan(shopId);
    if (planInfo.plan === 'free_demo' && await wasSummarySentToday(shopId)) {
      const userPref = await getUserPreference(shopId);
      const userLanguage = userPref.success ? userPref.language : 'en';
      const errorMessage = await generateMultiLanguageResponse(
        'You have reached your daily summary limit for the Free Demo plan.',
        userLanguage
      );
      await sendWhatsAppMessage(shopId, errorMessage);
      return { shopId, success: false, error: 'Daily limit reached' };
    }
          
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
    
    // Calculate profit margin
    const profitMargin = inventorySummary.totalPurchaseValue > 0 
      ? ((todaySales.totalValue - inventorySummary.totalPurchaseValue) / inventorySummary.totalPurchaseValue * 100)
      : 0;
    
    // Format the message
    let message = `📊 Daily Inventory Summary (${formatDateForDisplay(new Date())}):\n\n`;
    
    // Sales information with enhanced details
    if (todaySales.totalItems > 0) {
      message += `💰 Sales: ${todaySales.totalItems} items (₹${todaySales.totalValue.toFixed(2)})\n`;    
      const gstCollected = Number(todaySales.totalGST ?? 0);
      if (gstCollected > 0) message += `📈 GST Collected: ₹${gstCollected.toFixed(2)}\n`;
      
      if (todaySales.topProducts.length > 0) {
        message += `\n🛒 Top Sellers:\n`;
        todaySales.topProducts.forEach((product, index) => {
          message += `${index + 1}. ${product.name}: ${product.quantity} ${product.unit} (₹${product.value.toFixed(2)})\n`;
        });
      }
      
      if (todaySales.topCategories?.length > 0) {
        message += `\n🏷️ Top Categories:\n`;
        todaySales.topCategories.forEach((category, index) => {
          message += `${index + 1}. ${category.name}: ₹${category.value.toFixed(2)}\n`;
        });
      }
    } else {
      message += `💰 No sales recorded today.\n`;
    }
    
    // Inventory overview with value breakdown
    message += `\n📦 Current Inventory: ${inventorySummary.totalProducts} unique products\n`;
    message += `💎 Total Value: ₹${inventorySummary.totalValue.toFixed(2)}\n`;
    
    if (inventorySummary.totalPurchaseValue > 0) {
      message += `💸 Total Cost: ₹${inventorySummary.totalPurchaseValue.toFixed(2)}\n`;
      message += `📊 Profit Margin: ${profitMargin.toFixed(1)}%\n`;
    }
    
    if (inventorySummary.topCategories?.length > 0) {
      message += `\n📋 Inventory by Category:\n`;
      inventorySummary.topCategories.forEach((category, index) => {
        message += `${index + 1}. ${category.name}: ${category.productCount} products (₹${category.value.toFixed(2)})\n`;
      });
    }
    
    // Low stock alerts with value impact
    if (lowStockProducts.length > 0) {
      message += `\n⚠️ Low Stock Alerts:\n`;
      lowStockProducts.forEach(product => {
        const productInfo = inventorySummary.inventory[product.name];
        const valueImpact = productInfo ? productInfo.estimatedValue : 0;
        message += `• ${product.name}: Only ${product.quantity} ${product.unit} left`;
        if (valueImpact > 0) {
          message += ` (₹${valueImpact.toFixed(2)} value)`;
        }
        message += `\n`;
      });
    }
    
    // Expiry alerts with value
    if (expiringProducts.length > 0) {
      message += `\n⏰ Expiring Soon:\n`;
      expiringProducts.forEach(product => {
        const productInfo = inventorySummary.inventory[product.name];
        const valueAtRisk = productInfo ? productInfo.estimatedValue : 0;
        message += `• ${product.name}: Expires on ${formatDateForDisplay(product.expiryDate)}`;
        if (valueAtRisk > 0) {
          message += ` (₹${valueAtRisk.toFixed(2)} at risk)`;
        }
        message += `\n`;
      });
    }
    
    // Add insights
    message += `\n💡 Insights:\n`;
    if (todaySales.totalItems > 0) {
      const avgSaleValue = todaySales.totalValue / todaySales.totalItems;
      message += `• Average sale value: ₹${avgSaleValue.toFixed(2)}\n`;
    }
    
    if (inventorySummary.totalProducts > 0) {
      const avgInventoryValue = inventorySummary.totalValue / inventorySummary.totalProducts;
      message += `• Average inventory value: ₹${avgInventoryValue.toFixed(2)}\n`;
    }

    // Add plan information
    message += `\n📋 Plan: ${planInfo.plan === 'free_demo' ? 'Free Demo' : 
      planInfo.plan === 'free_demo_first_50' ? 'Free Demo (First 50)' :
      planInfo.plan === 'standard' ? 'Standard' : 'Enterprise'}`;

    if (planInfo.trialEndDate) {
      const daysLeft = Math.ceil((planInfo.trialEndDate - new Date()) / (1000 * 60 * 60 * 24));
      if (daysLeft > 0) {
        message += `\n⏳ Trial days remaining: ${daysLeft}`;
      } else {
        message += `\n⚠️ Trial expired. Please upgrade to continue.`;
      }
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
        
        // Calculate overall statistics
        let totalSalesValue = 0;
        let totalPurchaseValue = 0;
        let totalGST = 0;
        let totalProducts = 0;
        
        // Process shops in parallel with a concurrency limit
        const concurrencyLimit = 5;
        const results = [];
        
        for (let i = 0; i < shopIds.length; i += concurrencyLimit) {
            const batch = shopIds.slice(i, i + concurrencyLimit);
            console.log(`Processing batch of ${batch.length} shops (${i + 1}-${i + batch.length} of ${shopIds.length})`);
            
            const batchPromises = batch.map(async (shopId) => {
                try {
                    const result = await processShopSummary(shopId);
                    
                    // Aggregate statistics
                    if (result.success) {
                        // Get detailed stats for this shop
                        const salesData = await getTodaySalesSummary(shopId);
                        const inventoryData = await getInventorySummary(shopId);
                        
                        totalSalesValue += salesData.totalValue;
                        totalPurchaseValue += inventoryData.totalPurchaseValue;
                        totalGST += salesData.totalGST;
                        totalProducts += inventoryData.totalProducts;
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
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;
        
        // Calculate overall metrics
        const overallProfitMargin = totalPurchaseValue > 0 
            ? ((totalSalesValue - totalPurchaseValue) / totalPurchaseValue * 100)
            : 0;
        
        console.log(`Daily summary job completed: ${successCount} successful, ${failureCount} failed`);
        console.log(`Overall Metrics:`);
        console.log(`- Total Sales Value: ₹${totalSalesValue.toFixed(2)}`);
        console.log(`- Total Purchase Value: ₹${totalPurchaseValue.toFixed(2)}`);
        console.log(`- Total GST Collected: ₹${totalGST.toFixed(2)}`);
        console.log(`- Overall Profit Margin: ${overallProfitMargin.toFixed(1)}%`);
        console.log(`- Total Products Tracked: ${totalProducts}`);
        
        return results;
    } catch (error) {
        console.error('Error in daily summary job:', error.message);
        throw error;
    }
}

module.exports = { processShopSummary, runDailySummary };
