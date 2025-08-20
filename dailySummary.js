const twilio = require('twilio');
const axios = require('axios');
const {
    getAllShopIds,
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
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
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
                timeout: 5000 // Add timeout
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
async function processShopSummary(shopId) {
    const context = `Process Shop ${shopId}`;
    
    try {
        console.log(`[${context}] Starting processing`);
        
        // Get user preference
        const userPref = await getUserPreference(shopId);
        const userLanguage = userPref.success ? userPref.language : 'en';
        console.log(`[${context}] User language: ${userLanguage}`);
        
        // Get sales records from the dedicated Sales table
        const salesRecords = await getShopSalesRecords(shopId, 1); // Get today's sales
        console.log(`[${context}] Found ${salesRecords.length} sales records`);
        
        // Get current inventory
        const currentInventory = await getCurrentInventory(shopId);
        console.log(`[${context}] Found ${currentInventory.length} inventory items`);
        
        // Get batch records for this shop
        const batchRecords = await getShopBatchRecords(shopId);
        console.log(`[${context}] Found ${batchRecords.length} batch records`);
        
        // Calculate summary
        let totalSales = 0;
        let totalSalesValue = 0;
        const salesDetails = {};
        
        // Process sales records
        salesRecords.forEach(record => {
            const product = record.fields.Product;
            const quantity = Math.abs(record.fields.Quantity || 0); // Convert to positive for display
            const salePrice = record.fields.SalePrice || 0;
            
            totalSales += quantity;
            totalSalesValue += quantity * salePrice;
            salesDetails[product] = (salesDetails[product] || 0) + quantity;
        });
        
        // Check for deadstock - Option 1: Items with stock < 5
        const deadstockOption1 = [];
        const lowStockThreshold = 5; // Items with stock less than this are considered deadstock
        
        currentInventory.forEach(record => {
            const product = record.fields.Product;
            const quantity = record.fields.Quantity || 0;
            const unit = record.fields.Units || '';
            
            if (quantity < lowStockThreshold && quantity > 0) {
                deadstockOption1.push({
                    product,
                    quantity,
                    unit
                });
            }
        });
        
        // Check for deadstock - Option 2: Items not sold in last 7 days and in stock for > 30 days
        const deadstockOption2 = [];
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);
        
        // Get recent sales (last 7 days)
        const recentSales = await getRecentSales(shopId, 7);
        console.log(`[${context}] Found ${recentSales.length} recent sales records`);
        
        // Create a set of products sold in the last 7 days
        const productsSoldRecently = new Set();
        recentSales.forEach(record => {
            productsSoldRecently.add(record.fields.Product);
        });
        
        // Create a map of product to earliest purchase date
        const productPurchaseDates = {};
        batchRecords.forEach(record => {
            const product = record.fields.Product;
            const purchaseDate = new Date(record.fields.PurchaseDate);
            
            if (!productPurchaseDates[product] || purchaseDate < productPurchaseDates[product]) {
                productPurchaseDates[product] = purchaseDate;
            }
        });
        
        // Check each product in current inventory
        currentInventory.forEach(record => {
            const product = record.fields.Product;
            const quantity = record.fields.Quantity || 0;
            const unit = record.fields.Units || '';
            
            if (quantity > 0) {
                // Check if product was purchased more than 30 days ago
                if (productPurchaseDates[product] && productPurchaseDates[product] < thirtyDaysAgo) {
                    // Check if product has not been sold in the last 7 days
                    if (!productsSoldRecently.has(product)) {
                        deadstockOption2.push({
                            product,
                            quantity,
                            unit,
                            daysInStock: daysBetween(productPurchaseDates[product], today)
                        });
                    }
                }
            }
        });
        
        // Format the message
        let message = `📊 Daily Inventory Summary (${formatDateForDisplay(new Date())}):\n\n`;
        message += `💰 Total Sales: ${totalSales} items`;
        if (totalSalesValue > 0) {
            message += ` (Value: ₹${totalSalesValue.toFixed(2)})`;
        }
        message += `\n`;
        
        if (Object.keys(salesDetails).length > 0) {
            message += `\n🛒 Sales Details:\n`;
            for (const [product, quantity] of Object.entries(salesDetails)) {
                // Find the unit for this product
                const inventoryRecord = currentInventory.find(r => r.fields.Product === product);
                const unit = inventoryRecord ? inventoryRecord.fields.Units || '' : '';
                const unitText = unit ? ` ${unit}` : '';
                
                message += `• ${product}: ${quantity}${unitText} sold\n`;
            }
        }
        
        // Add deadstock alerts
        if (deadstockOption1.length > 0 || deadstockOption2.length > 0) {
            message += `\n⚠️ Deadstock Alert:\n\n`;
            
            if (deadstockOption1.length > 0) {
                message += `Option 1 - Low Stock (less than 5 items):\n`;
                deadstockOption1.forEach(item => {
                    const unitText = item.unit ? ` ${item.unit}` : '';
                    message += `• ${item.product}: Only ${item.quantity}${unitText} left\n`;
                });
                message += `\n`;
            }
            
            if (deadstockOption2.length > 0) {
                message += `Option 2 - Slow Moving (not sold in 7 days, in stock > 30 days):\n`;
                deadstockOption2.forEach(item => {
                    const unitText = item.unit ? ` ${item.unit}` : '';
                    message += `• ${item.product}: ${item.quantity}${unitText} in stock for ${item.daysInStock} days\n`;
                });
                message += `\n`;
            }
        }
        
        message += `Thank you for using our inventory management system!`;
        
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
        const shopIds = await getAllShopIds();
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

module.exports = { runDailySummary };
