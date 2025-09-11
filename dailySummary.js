const twilio = require('twilio');
const axios = require('axios');
const crypto = require('crypto');
const {
    getAllShopIDs,
    getCurrentInventory,    
    getUserPreference,
    getTodaySalesSummary,
    getInventorySummary,
    getLowStockProducts,
    getExpiringProducts,
    getTranslationEntry,
    upsertTranslationEntry
} = require('./database');

// ====== DETERMINISTIC NATIVEGLISH LABEL RENDERER (no external API) ======
const NL_LABELS = {
  // same dictionaries as in whatsapp.js (copy them verbatim)
  //  --- paste the entire NL_LABELS object from whatsapp.js here ---
};

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
//Removed

// Get inventory summary
//Removed

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
