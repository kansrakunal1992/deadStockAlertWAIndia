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
const USER_PREFERENCES_TABLE_NAME = process.env.USER_PREFERENCES_TABLE_NAME || 'UserPreferences';
const SALES_TABLE_NAME = process.env.AIRTABLE_SALES_TABLE_NAME || 'Sales';

// URL construction
const airtableBaseURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + TABLE_NAME;
const airtableBatchURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + BATCH_TABLE_NAME;
const airtableUserPreferencesURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + USER_PREFERENCES_TABLE_NAME;
const airtableSalesURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + SALES_TABLE_NAME;

// Error logging
function logError(context, error) {
  console.error(`[${context}] Error:`, error.message);
  if (error.response) {
    console.error(`[${context}] Status:`, error.response.status);
    console.error(`[${context}] Data:`, error.response.data);
  }
}

// Unit normalization function
function normalizeUnit(unit) {
  // Add a safety check
  if (!unit) {
    return 'pieces'; // Default unit if none is provided
  }
  
  const unitMap = {
    'g': 'kg', 'gram': 'kg', 'grams': 'kg', 'ग्राम': 'kg',
    'ml': 'liters', 'milliliter': 'liters', 'milliliters': 'liters',
    'packet': 'packets', 'पैकेट': 'packets', 'box': 'boxes', 'बॉक्स': 'boxes'
  };
  
  return unitMap[unit.toLowerCase()] || unit;
}

// Convert quantity to base unit
function convertToBaseUnit(quantity, unit) {
  const normalizedUnit = normalizeUnit(unit);
  
  const conversionMap = {
    'kg': 1,
    'g': 0.001,
    'liters': 1,
    'ml': 0.001,
    'packets': 1,
    'boxes': 1,
    'pieces': 1
  };
  
  return quantity * (conversionMap[normalizedUnit] || 1);
}

// Airtable request helper with timeout and retry logic
async function airtableRequest(config, context = 'Airtable Request', maxRetries = 2) {
  const headers = {
    'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
    'Content-Type': 'application/json'
  };
  
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios({
        ...config,
        url: config.url || airtableBaseURL,
        headers,
        timeout: 10000 // 10 second timeout
      });
      return response.data;
    } catch (error) {
      lastError = error;
      console.warn(`[${context}] Attempt ${attempt} failed:`, error.message);
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        break;
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  logError(context, lastError);
  throw lastError;
}

// Airtable batch request helper with timeout and retry logic
async function airtableBatchRequest(config, context = 'Airtable Batch Request', maxRetries = 2) {
  const headers = {
    'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
    'Content-Type': 'application/json'
  };
  
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios({
        ...config,
        url: config.url || airtableBatchURL,
        headers,
        timeout: 10000 // 10 second timeout
      });
      return response.data;
    } catch (error) {
      lastError = error;
      console.warn(`[${context}] Attempt ${attempt} failed:`, error.message);
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        break;
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  logError(context, lastError);
  throw lastError;
}

// Airtable user preferences request helper with timeout and retry logic
async function airtableUserPreferencesRequest(config, context = 'Airtable User Preferences Request', maxRetries = 2) {
  const headers = {
    'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
    'Content-Type': 'application/json'
  };
  
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios({
        ...config,
        url: config.url || airtableUserPreferencesURL,
        headers,
        timeout: 10000 // 10 second timeout
      });
      return response.data;
    } catch (error) {
      lastError = error;
      console.warn(`[${context}] Attempt ${attempt} failed:`, error.message);
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        break;
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  logError(context, lastError);
  throw lastError;
}

// Airtable sales request helper with timeout and retry logic
async function airtableSalesRequest(config, context = 'Airtable Sales Request', maxRetries = 2) {
  const headers = {
    'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
    'Content-Type': 'application/json'
  };
  
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios({
        ...config,
        url: config.url || airtableSalesURL,
        headers,
        timeout: 10000 // 10 second timeout
      });
      return response.data;
    } catch (error) {
      lastError = error;
      console.warn(`[${context}] Attempt ${attempt} failed:`, error.message);
      
      // If this is the last attempt, throw the error
      if (attempt === maxRetries) {
        break;
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  logError(context, lastError);
  throw lastError;
}

// Update inventory using delete and recreate approach with proper unit handling
async function updateInventory(shopId, product, quantityChange, unit = '') {
  const context = `Update ${shopId} - ${product}`;
  try {
    console.log(`[${context}] Starting update: ${quantityChange} ${unit}`);
    
    // Normalize unit before processing
    const normalizedUnit = normalizeUnit(unit);
    
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
      const currentUnit = findResult.records[0].fields.Units || '';
      
      // Convert both quantities to base unit for proper calculation
      const currentBaseQty = convertToBaseUnit(currentQty, currentUnit);
      const changeBaseQty = convertToBaseUnit(quantityChange, normalizedUnit);
      
      // Calculate new quantity in base unit
      const newBaseQty = currentBaseQty + changeBaseQty;
      
      // Convert back to normalized unit for storage
      newQuantity = convertToBaseUnit(newBaseQty, normalizedUnit) / convertToBaseUnit(1, normalizedUnit);
      
      console.log(`[${context}] Found record ${recordId}, updating: ${currentQty} ${currentUnit} -> ${newQuantity} ${normalizedUnit} (change: ${quantityChange})`);
      
      // Delete the old record
      await airtableRequest({
        method: 'delete',
        url: 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + TABLE_NAME + '/' + recordId
      }, `${context} - Delete`);
      
      // Create new record with normalized unit
      const createData = {
        fields: {
          ShopID: shopId,
          Product: product,
          Quantity: newQuantity,
          Units: normalizedUnit
        }
      };
      
      await airtableRequest({
        method: 'post',
        data: createData
      }, `${context} - Recreate`);
    } else {
      // Create new record with normalized unit
      newQuantity = quantityChange;
      const createData = {
        fields: {
          ShopID: shopId,
          Product: product,
          Quantity: newQuantity,
          Units: normalizedUnit
        }
      };
      
      await airtableRequest({
        method: 'post',
        data: createData
      }, `${context} - Create`);
    }
    
    return { success: true, newQuantity, unit: normalizedUnit };
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
    
    // Normalize unit before storing
    const normalizedUnit = batchData.unit ? normalizeUnit(batchData.unit) : 'pieces';
    
    // Use provided purchase date or current timestamp
    const purchaseDate = batchData.purchaseDate || new Date().toISOString();
    
    // Generate composite key
    const compositeKey = `${batchData.shopId}|${batchData.product}|${purchaseDate}`;
    
    // Check if batch with same composite key already exists
    const existingBatch = await getBatchByCompositeKey(compositeKey);
    
    if (existingBatch) {
      console.log(`[${context}] Batch already exists, updating quantity`);
      const newQuantity = (existingBatch.fields.Quantity || 0) + batchData.quantity;
      
      const updateData = {
        fields: {
          Quantity: newQuantity
        }
      };
      
      const result = await airtableBatchRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BATCH_TABLE_NAME}/${existingBatch.id}`,
        data: updateData
      }, context);
      
      console.log(`[${context}] Updated existing batch with ID: ${existingBatch.id}`);
      return { success: true, id: existingBatch.id, compositeKey };
    }
    
    // Create new record
    const createData = {
  fields: {
    ShopID: batchData.shopId,
    Product: batchData.product,
    Quantity: batchData.quantity,
    PurchaseDate: purchaseDate,
    ExpiryDate: batchData.expiryDate,
    OriginalRecordID: batchData.batchId || '',
    Units: normalizedUnit,
    CompositeKey: compositeKey  // This will now work since it's a text field
  }
};
    
    console.log(`[${context}] Using purchase date: ${purchaseDate}`);
    
    const result = await airtableBatchRequest({
      method: 'post',
      data: createData
    }, context);
    
    console.log(`[${context}] Batch record created with ID: ${result.id}`);
    return { success: true, id: result.id, compositeKey };
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
    
    // Log batch dates for debugging
    result.records.forEach((record, index) => {
      console.log(`[${context}] Batch ${index + 1}: ID=${record.id}, Date=${record.fields.PurchaseDate}`);
    });
    
    return result.records;
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Update batch expiry date
async function updateBatchExpiry(batchId, expiryDate) {
  const context = `Update Batch Expiry ${batchId}`;
  try {
    console.log(`[${context}] Updating batch ${batchId} with expiry date ${expiryDate}`);
    const updateData = {
      fields: {
        ExpiryDate: expiryDate
      }
    };
    
    const result = await airtableBatchRequest({
      method: 'patch',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BATCH_TABLE_NAME}/${batchId}`,
      data: updateData
    }, context);
    
    console.log(`[${context}] Batch expiry date updated successfully`);
    return { success: true };
  } catch (error) {
    logError(context, error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Update batch quantity when items are sold with proper unit handling
async function updateBatchQuantity(batchId, quantityChange, unit = '') {
  const context = `Update Batch Quantity ${batchId}`;
  try {
    console.log(`[${context}] Updating batch ${batchId} quantity by ${quantityChange} ${unit}`);
    console.log(`[${context}] Batch ID type: ${typeof batchId}, Value: "${batchId}"`);
    
    // First, get the current batch record
console.log(`[${context}] Attempting to fetch batch with ID: "${batchId}"`);
const getResult = await airtableBatchRequest({
  method: 'get',
  url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BATCH_TABLE_NAME}/${batchId}`
}, `${context} - Get`);

console.log(`[${context}] API response status: ${getResult ? 'Success' : 'Failed'}`);
console.log(`[${context}] Records found: ${getResult.records ? getResult.records.length : 0}`);

if (!getResult.records || getResult.records.length === 0) {
  console.error(`[${context}] Batch record not found. Requested ID: "${batchId}"`);
  throw new Error('Batch record not found');
}
    
    const currentQuantity = getResult.records[0].fields.Quantity || 0;
    const currentUnit = getResult.records[0].fields.Units || '';
    
    // Normalize units and convert to base unit for calculation
    const normalizedUnit = normalizeUnit(unit) || currentUnit;
    const currentBaseQty = convertToBaseUnit(currentQuantity, currentUnit);
    const changeBaseQty = convertToBaseUnit(quantityChange, normalizedUnit);
    
    // Calculate new quantity in base unit
    const newBaseQty = Math.max(0, currentBaseQty + changeBaseQty); // Ensure quantity doesn't go negative
    
    // Convert back to original unit for storage
    const newQuantity = convertToBaseUnit(newBaseQty, currentUnit) / convertToBaseUnit(1, currentUnit);
    
    const updateData = {
      fields: {
        Quantity: newQuantity
      }
    };
    
    const result = await airtableBatchRequest({
      method: 'patch',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BATCH_TABLE_NAME}/${batchId}`,
      data: updateData
    }, context);
    
    console.log(`[${context}] Batch quantity updated from ${currentQuantity} to ${newQuantity} ${currentUnit}`);
    return { success: true, newQuantity };
  } catch (error) {
    logError(context, error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Create a sales record
async function createSalesRecord(salesData) {
  const context = `Create Sales ${salesData.shopId} - ${salesData.product}`;
  try {
    console.log(`[${context}] Creating sales record for ${Math.abs(salesData.quantity)} units`);
    
    // Normalize unit before storing
    const normalizedUnit = salesData.unit ? normalizeUnit(salesData.unit) : 'pieces';
    
    const createData = {
      fields: {
        ShopID: salesData.shopId,
        Product: salesData.product,
        Quantity: salesData.quantity, // This will be negative
        SaleDate: salesData.saleDate,
        BatchCompositeKey: salesData.batchCompositeKey || '', // Uses composite key
        SalePrice: salesData.salePrice || 0,
        Units: normalizedUnit
      }
    };
    
    const result = await airtableSalesRequest({
      method: 'post',
      data: createData
    }, context);
    
    console.log(`[${context}] Sales record created with ID: ${result.id}`);
    return { success: true, id: result.id };
  } catch (error) {
    logError(context, error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function getBatchByCompositeKey(compositeKey) {
  const context = `Get Batch by Composite Key`;
  try {
    const filterFormula = `{CompositeKey} = '${compositeKey}'`;
    const result = await airtableBatchRequest({
      method: 'get',
      params: { filterByFormula: filterFormula }
    }, context);
    
    if (result.records && result.records.length > 0) {
      return result.records[0];
    }
    return null;
  } catch (error) {
    logError(context, error);
    return null;
  }
}

async function updateBatchQuantityByCompositeKey(compositeKey, quantityChange, unit = '') {
  const context = `Update Batch by Composite Key`;
  try {
    console.log(`[${context}] Updating batch ${compositeKey} by ${quantityChange} ${unit}`);
    
    // Get the batch by composite key
    let batch = await getBatchByCompositeKey(compositeKey);
    
    if (!batch) {
      console.error(`[${context}] Batch not found for composite key: ${compositeKey}`);
      
      // Try to recreate the batch from the composite key
      const parts = compositeKey.split('|');
      if (parts.length === 3) {
        const [shopId, product, purchaseDate] = parts;
        console.log(`[${context}] Attempting to recreate batch`);
        
        // Create a new batch record with the same details
        const recreateResult = await createBatchRecord({
          shopId,
          product,
          quantity: 0, // Start with 0, we'll update it immediately
          unit,
          purchaseDate
        });
        
        if (recreateResult.success) {
          // Get the newly created batch
          batch = await getBatchByCompositeKey(compositeKey);
          if (batch) {
            console.log(`[${context}] Successfully recreated batch with ID: ${batch.id}`);
          }
        }
      }
      
      if (!batch) {
        console.error(`[${context}] Could not find or recreate batch for composite key: ${compositeKey}`);
        return {
          success: false,
          error: 'Batch record not found and could not be recreated',
          compositeKey
        };
      }
    }
    
    // Now try to update the batch
    try {
      const result = await updateBatchQuantity(batch.id, quantityChange, unit);
      return result;
    } catch (updateError) {
      console.error(`[${context}] Failed to update batch ${batch.id}:`, updateError.message);
      
      // If update failed, try to recreate the batch and update again
      console.log(`[${context}] Attempting to recreate and update batch`);
      
      const parts = compositeKey.split('|');
      if (parts.length === 3) {
        const [shopId, product, purchaseDate] = parts;
        
        // Get current quantity from the batch before it was deleted
        const currentQuantity = batch.fields.Quantity || 0;
        const newQuantity = Math.max(0, currentQuantity + quantityChange);
        
        // Create a new batch record with the updated quantity
        const recreateResult = await createBatchRecord({
          shopId,
          product,
          quantity: newQuantity,
          unit,
          purchaseDate
        });
        
        if (recreateResult.success) {
          console.log(`[${context}] Successfully recreated batch with updated quantity: ${newQuantity}`);
          return {
            success: true,
            newQuantity,
            recreated: true
          };
        }
      }
      
      return {
        success: false,
        error: `Failed to update batch: ${updateError.message}`,
        compositeKey
      };
    }
  } catch (error) {
    logError(context, error);
    return {
      success: false,
      error: error.message,
      compositeKey
    };
  }
}
    
    // Use the existing update function that uses record ID
    return await updateBatchQuantity(batch.id, quantityChange, unit);
  } catch (error) {
    logError(context, error);
    return {
      success: false,
      error: error.message,
      compositeKey
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

// Save user preference to Airtable with proper date format
async function saveUserPreference(shopId, language) {
  const context = `Save User Preference ${shopId}`;
  try {
    // Format date for Airtable (YYYY-MM-DD)
    const now = new Date().toISOString().split('T')[0];
    
    // Check if record already exists
    const filterFormula = `{ShopID} = '${shopId}'`;
    const findResult = await airtableUserPreferencesRequest({
      method: 'get',
      params: { filterByFormula: filterFormula }
    }, `${context} - Find`);
    
    if (findResult.records.length > 0) {
      // Update existing record
      const recordId = findResult.records[0].id;
      const updateData = {
        fields: {
          Language: language,
          LastUpdated: now
        }
      };
      
      await airtableUserPreferencesRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_PREFERENCES_TABLE_NAME}/${recordId}`,
        data: updateData
      }, `${context} - Update`);
    } else {
      // Create new record
      const createData = {
        fields: {
          ShopID: shopId,
          Language: language,
          LastUpdated: now
        }
      };
      
      await airtableUserPreferencesRequest({
        method: 'post',
        data: createData
      }, `${context} - Create`);
    }
    
    return { success: true };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Get user preference from Airtable
async function getUserPreference(shopId) {
  const context = `Get User Preference ${shopId}`;
  try {
    const filterFormula = `{ShopID} = '${shopId}'`;
    const result = await airtableUserPreferencesRequest({
      method: 'get',
      params: { filterByFormula: filterFormula }
    }, context);
    
    if (result.records.length > 0) {
      return {
        success: true,
        language: result.records[0].fields.Language
      };
    }
    
    return { success: true, language: 'en' }; // Default to English
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Get all shop IDs from Inventory table
async function getAllShopIds() {
  const context = 'Get All Shop IDs';
  try {
    const result = await airtableRequest({
      method: 'get',
      params: {
        fields: ['ShopID']
      }
    }, context);
    
    // Extract unique shop IDs
    const shopIds = [...new Set(result.records.map(record => record.fields.ShopID))];
    return shopIds;
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Get daily inventory updates for a shop
async function getDailyUpdates(shopId) {
  const context = `Get Daily Updates ${shopId}`;
  try {
    // Get today's date in ISO format
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    
    // Format dates for Airtable formula
    const startStr = startOfDay.toISOString();
    const endStr = endOfDay.toISOString();
    
    // Fixed field name from "created time" to "Created Time"
    const filterFormula = `AND({ShopID} = '${shopId}', IS_AFTER({Created Time}, "${startStr}"), IS_BEFORE({Created Time}, "${endStr}"))`;
    
    const result = await airtableRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula
      }
    }, context);
    
    return result.records;
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Get current inventory for a shop
async function getCurrentInventory(shopId) {
  const context = `Get Current Inventory ${shopId}`;
  try {
    const filterFormula = `{ShopID} = '${shopId}'`;
    const result = await airtableRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula
      }
    }, context);
    
    return result.records;
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Get batch records for a shop
async function getShopBatchRecords(shopId) {
  const context = `Get Shop Batches ${shopId}`;
  try {
    const filterFormula = `{ShopID} = '${shopId}'`;
    const result = await airtableBatchRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula,
        sort: [{ field: 'PurchaseDate', direction: 'desc' }]
      }
    }, context);
    
    return result.records;
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Get sales records for a shop in the last N days
async function getRecentSales(shopId, days = 7) {
  const context = `Get Recent Sales ${shopId}`;
  try {
    // Calculate date N days ago
    const today = new Date();
    const nDaysAgo = new Date(today);
    nDaysAgo.setDate(today.getDate() - days);
    
    // Format dates for Airtable formula
    const dateStr = nDaysAgo.toISOString();
    
    // Fixed field name from "created time" to "Created Time"
    const filterFormula = `AND({ShopID} = '${shopId}', {Quantity} < 0, IS_AFTER({Created Time}, "${dateStr}"))`;
    
    const result = await airtableRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula
      }
    }, context);
    
    return result.records;
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Get sales records for a shop
async function getShopSalesRecords(shopId, days = 7) {
  const context = `Get Shop Sales Records ${shopId}`;
  try {
    // Calculate date N days ago
    const today = new Date();
    const nDaysAgo = new Date(today);
    nDaysAgo.setDate(today.getDate() - days);
    
    // Format dates for Airtable formula
    const dateStr = nDaysAgo.toISOString();
    
    const filterFormula = `AND({ShopID} = '${shopId}', IS_AFTER({SaleDate}, "${dateStr}"))`;
    
    const result = await airtableSalesRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula,
        sort: [{ field: 'SaleDate', direction: 'desc' }]
      }
    }, context);
    
    return result.records;
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Batch update inventory function for processing multiple updates in parallel
async function batchUpdateInventory(updates) {
  const context = 'Batch Update Inventory';
  try {
    console.log(`[${context}] Starting batch update for ${updates.length} items`);
    
    // Process updates in parallel
    const promises = updates.map(async update => {
      const { shopId, product, quantityChange, unit = '' } = update;
      const itemContext = `Update ${shopId} - ${product}`;
      
      // Normalize unit before processing
      const normalizedUnit = normalizeUnit(unit);
      
      // Find existing record
      const filterFormula = 'AND({ShopID} = \'' + shopId + '\', {Product} = \'' + product + '\')';
      const findResult = await airtableRequest({
        method: 'get',
        params: { filterByFormula: filterFormula }
      }, `${itemContext} - Find`);
      
      let newQuantity;
      if (findResult.records.length > 0) {
        // Delete existing record and create new one
        const recordId = findResult.records[0].id;
        const currentQty = findResult.records[0].fields.Quantity || 0;
        const currentUnit = findResult.records[0].fields.Units || '';
        
        // Convert both quantities to base unit for proper calculation
        const currentBaseQty = convertToBaseUnit(currentQty, currentUnit);
        const changeBaseQty = convertToBaseUnit(quantityChange, normalizedUnit);
        
        // Calculate new quantity in base unit
        const newBaseQty = currentBaseQty + changeBaseQty;
        
        // Convert back to normalized unit for storage
        newQuantity = convertToBaseUnit(newBaseQty, normalizedUnit) / convertToBaseUnit(1, normalizedUnit);
        
        // Delete the old record
        await airtableRequest({
          method: 'delete',
          url: 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + TABLE_NAME + '/' + recordId
        }, `${itemContext} - Delete`);
        
        // Create new record
        const createData = {
          fields: {
            ShopID: shopId,
            Product: product,
            Quantity: newQuantity,
            Units: normalizedUnit
          }
        };
        
        await airtableRequest({
          method: 'post',
          data: createData
        }, `${itemContext} - Recreate`);
      } else {
        // Create new record
        newQuantity = quantityChange;
        const createData = {
          fields: {
            ShopID: shopId,
            Product: product,
            Quantity: newQuantity,
            Units: normalizedUnit
          }
        };
        
        await airtableRequest({
          method: 'post',
          data: createData
        }, `${itemContext} - Create`);
      }
      
      return { product, success: true, newQuantity, unit: normalizedUnit };
    });
    
    const results = await Promise.allSettled(promises);
    
    // Process results
    const finalResults = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        finalResults.push(result.value);
      } else {
        console.error(`[${context}] Error processing update ${index}:`, result.reason.message);
        finalResults.push({
          product: updates[index].product,
          success: false,
          error: result.reason.message
        });
      }
    });
    
    return finalResults;
  } catch (error) {
    logError(context, error);
    return updates.map(update => ({
      product: update.product,
      success: false,
      error: error.message
    }));
  }
}

module.exports = {
  updateInventory,
  testConnection,
  createBatchRecord,
  getBatchRecords,
  updateBatchExpiry,
  airtableRequest,
  saveUserPreference,
  getUserPreference,
  getAllShopIds,
  getDailyUpdates,
  getCurrentInventory,
  getShopBatchRecords,
  getRecentSales,
  createSalesRecord,
  updateBatchQuantity,
  getShopSalesRecords,
  batchUpdateInventory,
  getBatchByCompositeKey,           // Add this
  updateBatchQuantityByCompositeKey
  
};
