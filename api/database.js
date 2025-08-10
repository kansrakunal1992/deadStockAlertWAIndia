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
const BATCH_TABLE_NAME = process.env.AIRTABLE_BATCH_TABLE_NAME || 'InventoryBatches';

// URL construction
const airtableBaseURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + TABLE_NAME;
const airtableBatchURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + BATCH_TABLE_NAME;

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

// Airtable batch request helper
async function airtableBatchRequest(config, context = 'Airtable Batch Request') {
  const headers = {
    'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
    'Content-Type': 'application/json'
  };
  
  try {
    const response = await axios({
      ...config,
      url: config.url || airtableBatchURL,
      headers,
      timeout: 10000
    });
    
    return response.data;
  } catch (error) {
    logError(context, error);
    throw error;
  }
}

// Update inventory using delete and recreate approach
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
      // Delete existing record and create new one (instead of update)
      const recordId = findResult.records[0].id;
      const currentQty = findResult.records[0].fields.Quantity || 0;
      newQuantity = currentQty + quantityChange;
      
      console.log(`[${context}] Found record ${recordId}, deleting and recreating: ${currentQty} -> ${newQuantity}`);
      
      // Delete the old record
      await airtableRequest({
        method: 'delete',
        url: 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + TABLE_NAME + '/' + recordId
      }, `${context} - Delete`);
      
      // Create new record
      const createData = {
        fields: {
          ShopID: shopId,
          Product: product,
          Quantity: newQuantity
        }
      };
      
      await airtableRequest({
        method: 'post',
        data: createData
      }, `${context} - Recreate`);
    } else {
      // Create new record
      newQuantity = quantityChange;
      const createData = {
        fields: {
          ShopID: shopId,
          Product: product,
          Quantity: newQuantity
        }
      };
      
      await airtableRequest({
        method: 'post',
        data: createData
      }, `${context} - Create`);
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

// Create a batch record for tracking purchases with expiry dates
async function createBatchRecord(batchData) {
  const context = `Create Batch ${batchData.shopId} - ${batchData.product}`;
  
  try {
    console.log(`[${context}] Creating batch record for ${batchData.quantity} units`);
    
    const createData = {
      fields: {
        ShopID: batchData.shopId,
        Product: batchData.product,
        Quantity: batchData.quantity,
        PurchaseDate: batchData.purchaseDate,
        ExpiryDate: batchData.expiryDate,
        OriginalRecordID: batchData.batchId || ''
      }
    };
    
    const result = await airtableBatchRequest({
      method: 'post',
      data: createData
    }, context);
    
    console.log(`[${context}] Batch record created with ID: ${result.id}`);
    return { success: true, id: result.id };
  } catch (error) {
    logError(context, error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

// Get batch records for a specific product
async function getBatchRecords(shopId, product) {
  const context = `Get Batches ${shopId} - ${product}`;
  
  try {
    console.log(`[${context}] Retrieving batch records`);
    
    const filterFormula = 'AND({ShopID} = \'' + shopId + '\', {Product} = \'' + product + '\')';
    const result = await airtableBatchRequest({
      method: 'get',
      params: { 
        filterByFormula: filterFormula,
        sort: [{ field: 'PurchaseDate', direction: 'desc' }]
      }
    }, context);
    
    console.log(`[${context}] Found ${result.records.length} batch records`);
    return result.records;
  } catch (error) {
    logError(context, error);
    return [];
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
  testConnection,
  createBatchRecord,
  getBatchRecords
};
