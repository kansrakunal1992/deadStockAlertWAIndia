const twilio = require('twilio');
const axios = require('axios');
const {
    getAllShopIDs,
    getDailyUpdates,
    getCurrentInventory,
    getUserPreference,
    getShopBatchRecords,
    getRecentSales,
    getShopSalesRecords,
    getProductPrice,
    getAllProducts
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

// Get today's sales summary
async function getTodaySalesSummary(shopId) { 
  const context = `Get Today Sales Summary ${shopId}`;
  try {
    // Get today's date in ISO format
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    
    // Format dates for Airtable formula
    const startStr = startOfDay.toISOString();
    const endStr = endOfDay.toISOString();
    
    const filterFormula = `AND({ShopID} = '${shopId}', {Quantity} < 0, IS_AFTER({SaleDate}, "${startStr}"), IS_BEFORE({SaleDate}, "${endStr}"))`;
    
    const result = await airtableSalesRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula
      }
    }, context);
    
    // Calculate summary
    let totalItems = 0;
    let totalValue = 0;
    let totalGST = 0;
    const productSales = {};
    const categorySales = {};
    
    for (const record of result.records) {
      const product = record.fields.Product;
      const quantity = Math.abs(record.fields.Quantity || 0);
      const salePrice = record.fields.SalePrice || 0;
      const saleValue = record.fields.SaleValue || 0;
      const unit = record.fields.Units || '';
      
      totalItems += quantity;
      totalValue += saleValue;
      
      // Get product category for GST calculation
      let category = 'General';
      let gstRate = 0.18;
      try {
        let productInfo = {};
          try {
            productInfo = await getProductPrice(product);
          } catch (error) {
            console.warn(`Could not get product info for ${product}:`, error.message);
          }
        if (productInfo.success) {
          category = productInfo.category;
          // Set GST rate based on category
          if (category === 'Dairy') gstRate = 0.05;
          else if (category === 'Essential') gstRate = 0;
          else if (category === 'Packaged') gstRate = 0.12;
        }
      } catch (error) {
        console.warn(`Could not get product info for ${product}:`, error.message);
      }
      
      const gstAmount = (saleValue / (1 + gstRate)) * gstRate;
      totalGST += gstAmount;
      
      if (!productSales[product]) {
        productSales[product] = { quantity: 0, unit, value: 0, gst: 0 };
      }
      
      productSales[product].quantity += quantity;
      productSales[product].value += saleValue;
      productSales[product].gst += gstAmount;
      
      // Track by category
      if (!categorySales[category]) {
        categorySales[category] = { quantity: 0, value: 0, gst: 0 };
      }
      
      categorySales[category].quantity += quantity;
      categorySales[category].value += saleValue;
      categorySales[category].gst += gstAmount;
    };
    
    // Sort products by quantity sold
    const topProducts = Object.entries(productSales)
      .sort((a, b) => b[1].quantity - a[1].quantity)
      .slice(0, 5)
      .map(([name, data]) => ({
        name,
        quantity: data.quantity,
        unit: data.unit,
        value: data.value,
        gst: data.gst
      }));
    
    // Sort categories by value
    const topCategories = Object.entries(categorySales)
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 3)
      .map(([name, data]) => ({
        name,
        quantity: data.quantity,
        value: data.value,
        gst: data.gst
      }));
    
    return {
      totalItems,
      totalValue,
      totalGST,
      topProducts,
      topCategories
    };
  } catch (error) {
    logError(context, error);
    return {
      totalItems: 0,
      totalValue: 0,
      totalGST: 0,
      topProducts: [],
      topCategories: []
    };
  }
}

// Get inventory summary
async function getInventorySummary(shopId) {
  const context = `Get Inventory Summary ${shopId}`;
  try {
    const filterFormula = `{ShopID} = '${shopId}'`;
    
    const result = await airtableRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula
      }
    }, context);
    
    // Calculate summary
    let totalProducts = 0;
    let totalValue = 0;
    let totalPurchaseValue = 0;
    const inventory = {};
    const categoryInventory = {};
    
    for (const record of result.records) {
      const product = record.fields.Product;
      const quantity = record.fields.Quantity || 0;
      const unit = record.fields.Units || '';
      
      totalProducts++;
      
      // Get actual product price for better valuation
      let productPrice = 10; // Default fallback
      let category = 'General';
      
      try {
          let priceResult = {};
          try {
            priceResult = await getProductPrice(product);
          } catch (error) {
            console.warn(`Could not get price for ${product}:`, error.message);
          }
        if (priceResult.success) {
          productPrice = priceResult.price;
          category = priceResult.category;
        }
      } catch (error) {
        console.warn(`Could not get price for ${product}:`, error.message);
      }
      
      const estimatedValue = quantity * productPrice;
      totalValue += estimatedValue;
      
      inventory[product] = {
        quantity,
        unit,
        estimatedValue,
        productPrice,
        category
      };
      
      // Track by category
      if (!categoryInventory[category]) {
        categoryInventory[category] = { quantity: 0, value: 0, products: [] };
      }
      
      categoryInventory[category].quantity += quantity;
      categoryInventory[category].value += estimatedValue;
      categoryInventory[category].products.push(product);
    };
    
    // Get total purchase value from batches
    try {
      const batches = await getShopBatchRecords(shopId);
      batches.forEach(batch => {
        const purchaseValue = batch.fields.PurchaseValue || 0;
        totalPurchaseValue += purchaseValue;
      });
    } catch (error) {
      console.warn(`Could not get batch records for ${shopId}:`, error.message);
    }
    
    // Sort categories by value
    const topCategories = Object.entries(categoryInventory)
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 3)
      .map(([name, data]) => ({
        name,
        quantity: data.quantity,
        value: data.value,
        productCount: data.products.length
      }));
    
    return {
      totalProducts,
      totalValue,
      totalPurchaseValue,
      inventory,
      topCategories
    };
  } catch (error) {
    logError(context, error);
    return {
      totalProducts: 0,
      totalValue: 0,
      totalPurchaseValue: 0,
      inventory: {},
      topCategories: []
    };
  }
}

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
    
    // Calculate profit margin
    const profitMargin = inventorySummary.totalPurchaseValue > 0 
      ? ((todaySales.totalValue - inventorySummary.totalPurchaseValue) / inventorySummary.totalPurchaseValue * 100)
      : 0;
    
    // Format the message
    let message = `📊 Daily Inventory Summary (${formatDateForDisplay(new Date())}):\n\n`;
    
    // Sales information with enhanced details
    if (todaySales.totalItems > 0) {
      message += `💰 Sales: ${todaySales.totalItems} items (₹${todaySales.totalValue.toFixed(2)})\n`;
      message += `📈 GST Collected: ₹${todaySales.totalGST.toFixed(2)}\n`;
      
      if (todaySales.topProducts.length > 0) {
        message += `\n🛒 Top Sellers:\n`;
        todaySales.topProducts.forEach((product, index) => {
          message += `${index + 1}. ${product.name}: ${product.quantity} ${product.unit} (₹${product.value.toFixed(2)})\n`;
        });
      }
      
      if (todaySales.topCategories.length > 0) {
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
    
    if (inventorySummary.topCategories.length > 0) {
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

module.exports = { processShopSummary };
