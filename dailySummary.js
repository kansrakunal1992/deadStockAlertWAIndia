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
}
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

// Send WhatsApp message with enhanced error handling
async function sendWhatsAppMessage(to, body) {
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
// Create and send message
const message = await client.messages.create({
body: body,
from: process.env.TWILIO_WHATSAPP_NUMBER,
to: formattedTo
});
console.log(`Message sent successfully. SID: ${message.sid}`);
return message;
} catch (error) {
console.error('Error sending WhatsApp message:', error);
console.error('Error details:', error.message);
console.error('Error stack:', error.stack);
throw error;
}
}

// Main function to run daily summary
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
for (const shopId of shopIds) {
try {
console.log(`Processing shop: ${shopId}`);
// Get user preference
const userPref = await getUserPreference(shopId);
const userLanguage = userPref.success ? userPref.language : 'en';
console.log(`User language: ${userLanguage}`);
// Get sales records for today
const todaySales = await getShopSalesRecords(shopId, 1);
console.log(`Found ${todaySales.length} sales records for today`);
// Get sales records for the last 7 days for comparison
const weekSales = await getShopSalesRecords(shopId, 7);
console.log(`Found ${weekSales.length} sales records for the last 7 days`);
// Get current inventory
const currentInventory = await getCurrentInventory(shopId);
console.log(`Found ${currentInventory.length} inventory items`);
// Get batch records for this shop
const batchRecords = await getShopBatchRecords(shopId);
console.log(`Found ${batchRecords.length} batch records`);
// Calculate summary
let totalSales = 0;
let totalSalesValue = 0; // If tracking prices
const salesDetails = {};
const salesByHour = {}; // For sales pattern analysis
todaySales.forEach(record => {
const product = record.fields.Product;
const quantity = record.fields.Quantity || 0;
const salePrice = record.fields.SalePrice || 0;
const saleDate = new Date(record.fields.SaleDate);
const hour = saleDate.getHours();
totalSales += quantity;
totalSalesValue += quantity * salePrice;
salesDetails[product] = (salesDetails[product] || 0) + quantity;
// Track sales by hour
if (!salesByHour[hour]) {
salesByHour[hour] = 0;
}
salesByHour[hour] += quantity;
});
// Calculate comparison with previous days
let yesterdaySales = 0;
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const yesterdayStart = new Date(yesterday);
yesterdayStart.setHours(0, 0, 0, 0);
const yesterdayEnd = new Date(yesterday);
yesterdayEnd.setHours(23, 59, 59, 999);
weekSales.forEach(record => {
const saleDate = new Date(record.fields.SaleDate);
if (saleDate >= yesterdayStart && saleDate <= yesterdayEnd) {
yesterdaySales += record.fields.Quantity || 0;
}
});
// Calculate sales trend
let salesTrend = '';
if (yesterdaySales > 0) {
const percentChange = ((totalSales - yesterdaySales) / yesterdaySales) * 100;
if (percentChange > 0) {
salesTrend = `📈 Sales are up ${percentChange.toFixed(1)}% from yesterday`;
} else if (percentChange < 0) {
salesTrend = `📉 Sales are down ${Math.abs(percentChange).toFixed(1)}% from yesterday`;
} else {
salesTrend = `➡️ Sales are the same as yesterday`;
}
} else {
salesTrend = `📊 No sales data available for yesterday`;
}
// Find peak sales hour
let peakHour = null;
let peakSales = 0;
for (const [hour, sales] of Object.entries(salesByHour)) {
if (sales > peakSales) {
peakSales = sales;
peakHour = parseInt(hour);
}
}
// Check for deadstock - Items with stock < 5
const deadstockOption1 = [];
const lowStockThreshold = 5;
currentInventory.forEach(record => {
const product = record.fields.Product;
const quantity = record.fields.Quantity || 0;
if (quantity < lowStockThreshold && quantity > 0) {
deadstockOption1.push({
product,
quantity
});
}
});
// Check for deadstock - Items not sold in last 7 days and in stock for > 30 days
const deadstockOption2 = [];
const today = new Date();
const thirtyDaysAgo = new Date(today);
thirtyDaysAgo.setDate(today.getDate() - 30);
// Create a set of products sold in the last 7 days
const productsSoldRecently = new Set();
weekSales.forEach(record => {
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
if (quantity > 0) {
// Check if product was purchased more than 30 days ago
if (productPurchaseDates[product] && productPurchaseDates[product] < thirtyDaysAgo) {
// Check if product has not been sold in the last 7 days
if (!productsSoldRecently.has(product)) {
deadstockOption2.push({
product,
quantity,
daysInStock: daysBetween(productPurchaseDates[product], today)
});
}
}
}
});
// Format the message
let message = `📊 Daily Inventory Summary (${formatDateForDisplay(new Date())}):\n\n`;
message += `💰 Total Sales: ${totalSales} items\n`;
if (totalSalesValue > 0) {
message += `💵 Sales Value: ₹${totalSalesValue.toFixed(2)}\n`;
}
message += `${salesTrend}\n\n`;
if (peakHour !== null) {
message += `⏰ Peak Sales Hour: ${peakHour}:00 (${peakSales} items)\n\n`;
}
if (Object.keys(salesDetails).length > 0) {
message += `🛒 Sales Details:\n`;
for (const [product, quantity] of Object.entries(salesDetails)) {
message += `• ${product}: ${quantity} sold\n`;
}
message += `\n`;
}
// Add deadstock alerts
if (deadstockOption1.length > 0 || deadstockOption2.length > 0) {
message += `⚠️ Deadstock Alert:\n\n`;
if (deadstockOption1.length > 0) {
message += `Low Stock (less than 5 items):\n`;
deadstockOption1.forEach(item => {
message += `• ${item.product}: Only ${item.quantity} left\n`;
});
message += `\n`;
}
if (deadstockOption2.length > 0) {
message += `Slow Moving (not sold in 7 days, in stock > 30 days):\n`;
deadstockOption2.forEach(item => {
message += `• ${item.product}: ${item.quantity} in stock for ${item.daysInStock} days\n`;
});
message += `\n`;
}
}
message += `Thank you for using our inventory management system!`;
// Generate multilingual response
const formattedMessage = await generateMultiLanguageResponse(message, userLanguage);
// Send the message
await sendWhatsAppMessage(shopId, formattedMessage);
console.log(`Daily summary sent to ${shopId}`);
} catch (error) {
console.error(`Error processing shop ${shopId}:`, error.message);
}
}
console.log('Daily summary job completed successfully');
} catch (error) {
console.error('Error in daily summary job:', error.message);
}
}

module.exports = { runDailySummary };
