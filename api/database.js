const axios = require('axios');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
let AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';

// Clean the base ID
AIRTABLE_BASE_ID = AIRTABLE_BASE_ID
  .trim()
  .replace(/[;,\s]+$/, '')
  .replace(/[;,\s]+/g, '')
  .replace(/[^a-zA-Z0-9]/g, '');

const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Inventory';

// URL construction
const airtableBaseURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + TABLE_NAME;

// Format date for Airtable
function formatDateForAirtable(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Error logging
function logError(context, error) {
  console.error(`[${context}] Error:`, error.message);
  if (error.response) {
    console.error(`[${context}] Status:`, error.response.status);
    console.error(`[${context}] Data:`, error.response.data);
  }
}

// Airtable request helper
async function airtableRequest(config, context = 'Airtable Request') {
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
    logError(context, error);
    throw error;
  }
}

// Update inventory
async function updateInventory(shopId, product, quantityChange) {
  const context = `Update ${shopId} - ${product}`;
  
  try {
    console.log(`[${context}] Starting update: ${quantityChange}`);
    
    // Find existing record
    const filterFormula = 'AND({ShopID} = \'' + shopId + '\', {Product} = \'' + product + '\')';
    const findResult = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filterFormula }
    }, `${context} - Find`);
    
    let newQuantity;
    if (findResult.records.length > 0) {
      // Update existing record
      const recordId = findResult.records[0].id;
      const currentQty = findResult.records[0].fields.Quantity || 0;
      newQuantity = currentQty + quantityChange;
      
      const updateData = {
        fields: {
          Quantity: newQuantity,
          LastUpdated: formatDateForAirtable(new Date())
        }
      };
      
      await airtableRequest({
        method: 'patch',
        url: 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + recordId,
        data: updateData
      }, `${context} - Update`);
      
      console.log(`[${context}] Updated: ${currentQty} -> ${newQuantity}`);
    } else {
      // Create new record
      newQuantity = quantityChange;
      const createData = {
        fields: {
          ShopID: shopId,
          Product: product,
          Quantity: newQuantity,
          LastUpdated: formatDateForAirtable(new Date())
        }
      };
      
      await airtableRequest({
        method: 'post',
        data: createData
      }, `${context} - Create`);
      
      console.log(`[${context}] Created: ${newQuantity}`);
    }

    return { success: true, newQuantity };
  } catch (error) {
    logError(context, error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Simple connection test
async function testConnection() {
  const context = 'Connection Test';
  
  try {
    console.log(`[${context}] Testing connection...`);
    
    // Test table access
    const result = await airtableRequest({
      method: 'get',
      params: { maxRecords: 1 }
    }, `${context} - Table Access`);
    
    console.log(`[${context}] ✅ Connection successful`);
    console.log(`[${context}] Table contains ${result.records.length} records`);
    
    return true;
  } catch (error) {
    logError(context, error);
    return false;
  }
}

module.exports = { 
  updateInventory, 
  testConnection 
};
