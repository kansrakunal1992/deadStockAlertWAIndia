const axios = require('axios');
const PENDING_TRANSCRIPTIONS_TABLE_NAME = process.env.AIRTABLE_PENDING_TRANSCRIPTIONS_TABLE_NAME || 'PendingTranscriptions';
const CORRECTION_STATE_TABLE_NAME = process.env.AIRTABLE_CORRECTION_STATE_TABLE_NAME || 'CorrectionState';
const USER_STATE_TABLE_NAME = process.env.AIRTABLE_USER_STATE_TABLE_NAME || 'UserState';
const STATE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
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
        CompositeKey: compositeKey
      }
    };
    
    console.log(`[${context}] Using purchase date: ${purchaseDate}`);
    
    const result = await airtableBatchRequest({
      method: 'post',
      data: createData
    }, context);
    
    console.log(`[${context}] Batch record created with ID: ${result.id}`);
    
    // NEW: Link the batch to the inventory record
    try {
      // Find the inventory record for this shop and product
      const filterFormula = 'AND({ShopID} = \'' + batchData.shopId + '\', {Product} = \'' + batchData.product + '\')';
      const inventoryResult = await airtableRequest({
        method: 'get',
        params: { filterByFormula: filterFormula }
      }, `${context} - Find Inventory`);
      
      if (inventoryResult.records.length > 0) {
        const inventoryRecord = inventoryResult.records[0];
        console.log(`[${context}] Found inventory record ${inventoryRecord.id}, linking to batch`);
        
        // Get current batch links (if any)
        const currentBatches = inventoryRecord.fields.Batches || [];
        
        // Avoid duplicate links
        if (!currentBatches.includes(result.id)) {
          const updatedBatches = [...currentBatches, result.id];
          
          const inventoryUpdateData = {
            fields: {
              Batches: updatedBatches
            }
          };
          
          await airtableRequest({
            method: 'patch',
            url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_NAME}/${inventoryRecord.id}`,
            data: inventoryUpdateData
          }, `${context} - Link Batch to Inventory`);
          
          console.log(`[${context}] Successfully linked batch to inventory record`);
        } else {
          console.log(`[${context}] Batch already linked to inventory record`);
        }
      } else {
        console.log(`[${context}] No inventory record found to link batch to`);
      }
    } catch (linkError) {
      console.warn(`[${context}] Warning: Could not link batch to inventory:`, linkError.message);
      // Don't fail the whole operation if linking fails
    }
    
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
console.log(`[${context}] Record ID: ${getResult.id ?? 'None'}`);

if (!getResult || !getResult.fields) {
  console.error(`[${context}] Batch record not found. Requested ID: "${batchId}"`);
  throw new Error('Batch record not found');
}

const currentQuantity = getResult.fields.Quantity ?? 0;
const currentUnit = getResult.fields.Units ?? '';

    
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
      console.log(`[${context}] Batch not found by composite key, recreating...`);
      return await recreateBatchAndUpdate(compositeKey, quantityChange, unit, context);
    }
    
    console.log(`[${context}] Found batch by composite key, ID: ${batch.id}`);
    
    // Try to update the batch
    try {
      console.log(`[${context}] Attempting to update batch ${batch.id}`);
      const result = await updateBatchQuantity(batch.id, quantityChange, unit);
      console.log(`[${context}] Successfully updated batch ${batch.id}`);
      return result;
    } catch (updateError) {
      console.error(`[${context}] Failed to update batch ${batch.id}:`, updateError.message);
      
      // Check if it's a "not found" error
      if (updateError.message.includes('not found') || updateError.message.includes('404')) {
        console.log(`[${context}] Batch appears to be deleted, recreating...`);
        return await recreateBatchAndUpdate(compositeKey, quantityChange, unit, context);
      }
      
      // For other errors, return the error
      return {
        success: false,
        error: updateError.message,
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

// Helper function to recreate batch and update it
async function recreateBatchAndUpdate(compositeKey, quantityChange, unit, context) {
  console.log(`[${context}] Starting batch recreation for composite key: ${compositeKey}`);
  
  const parts = compositeKey.split('|');
  if (parts.length !== 3) {
    console.error(`[${context}] Invalid composite key format: ${compositeKey}`);
    return {
      success: false,
      error: 'Invalid composite key format',
      compositeKey
    };
  }
  
  const [shopId, product, purchaseDate] = parts;
  
  try {
    console.log(`[${context}] Creating new batch record...`);
    // Create a new batch record
    const recreateResult = await createBatchRecord({
      shopId,
      product,
      quantity: 0, // Start with 0
      unit,
      purchaseDate
    });
    
    if (!recreateResult.success) {
      console.error(`[${context}] Failed to create batch: ${recreateResult.error}`);
      return {
        success: false,
        error: `Failed to recreate batch: ${recreateResult.error}`,
        compositeKey
      };
    }
    
    console.log(`[${context}] Batch created with ID: ${recreateResult.id}`);
    
    // Wait a moment for Airtable to process the creation
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Get the newly created batch
    console.log(`[${context}] Retrieving newly created batch...`);
    const newBatch = await getBatchByCompositeKey(compositeKey);
    if (!newBatch) {
      console.error(`[${context}] Could not retrieve recreated batch`);
      return {
        success: false,
        error: 'Failed to retrieve recreated batch',
        compositeKey
      };
    }
    
    console.log(`[${context}] Retrieved new batch with ID: ${newBatch.id}`);
    
    // Update the new batch quantity
    console.log(`[${context}] Updating recreated batch quantity...`);
    try {
      const updateResult = await updateBatchQuantity(newBatch.id, quantityChange, unit);
      console.log(`[${context}] Successfully updated recreated batch`);
      return {
        ...updateResult,
        recreated: true
      };
    } catch (updateError) {
      console.error(`[${context}] Failed to update recreated batch:`, updateError.message);
      return {
        success: false,
        error: `Failed to update recreated batch: ${updateError.message}`,
        compositeKey
      };
    }
  } catch (error) {
    console.error(`[${context}] Error during batch recreation:`, error.message);
    return {
      success: false,
      error: `Batch recreation failed: ${error.message}`,
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

// Save pending transcription to database
async function savePendingTranscription(shopId, transcript, detectedLanguage) {
  const context = `Save Pending Transcription ${shopId}`;
  try {
    const createData = {
      fields: {
        ShopID: shopId,
        Transcript: transcript,
        DetectedLanguage: detectedLanguage,
        Timestamp: new Date().toISOString()
      }
    };
    
    const result = await airtableRequest({
      method: 'post',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${PENDING_TRANSCRIPTIONS_TABLE_NAME}`,
      data: createData
    }, context);
    
    return { success: true, id: result.id };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Get pending transcription for a shop
async function getPendingTranscription(shopId) {
  const context = `Get Pending Transcription ${shopId}`;
  try {
    const filterFormula = `{ShopID} = '${shopId}'`;
    const result = await airtableRequest({
      method: 'get',
      params: { 
        filterByFormula: filterFormula,
        sort: [{ field: 'Timestamp', direction: 'desc' }]
      },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${PENDING_TRANSCRIPTIONS_TABLE_NAME}`
    }, context);
    
    if (result.records.length > 0) {
      return {
        success: true,
        transcript: result.records[0].fields.Transcript,
        detectedLanguage: result.records[0].fields.DetectedLanguage,
        id: result.records[0].id
      };
    }
    
    return { success: true, transcript: null };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Delete pending transcription
async function deletePendingTranscription(id) {
  const context = `Delete Pending Transcription ${id}`;
  try {
    await airtableRequest({
      method: 'delete',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${PENDING_TRANSCRIPTIONS_TABLE_NAME}/${id}`
    }, context);
    
    return { success: true };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Add new functions for correction state management
// Save correction state to database
async function saveCorrectionState(shopId, correctionType, pendingUpdate, detectedLanguage) {
  const context = `Save Correction State ${shopId}`;
  try {
    console.log(`[${context}] Starting to save correction state:`, {
      shopId,
      correctionType,
      pendingUpdate,
      detectedLanguage,
      tableName: CORRECTION_STATE_TABLE_NAME
    });
    
    const createData = {
      fields: {
        ShopID: shopId,
        CorrectionType: correctionType,
        PendingUpdate: JSON.stringify(pendingUpdate),
        DetectedLanguage: detectedLanguage,
        Timestamp: new Date().toISOString()
      }
    };
    
    console.log(`[${context}] Data to be saved:`, createData);
    console.log(`[${context}] Using table: ${CORRECTION_STATE_TABLE_NAME}`);
    console.log(`[${context}] Full URL: https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CORRECTION_STATE_TABLE_NAME}`);
    
    const result = await airtableRequest({
      method: 'post',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CORRECTION_STATE_TABLE_NAME}`,
      data: createData
    }, context);
    
    console.log(`[${context}] Airtable API response:`, result);
    console.log(`[${context}] Successfully saved correction state with ID: ${result.id}`);
    
    return { success: true, id: result.id };
  } catch (error) {
    console.error(`[${context}] Error saving correction state:`, error.message);
    if (error.response) {
      console.error(`[${context}] Airtable response status:`, error.response.status);
      console.error(`[${context}] Airtable response data:`, error.response.data);
    }
    if (error.config) {
      console.error(`[${context}] Request config:`, {
        url: error.config.url,
        method: error.config.method,
        headers: error.config.headers
      });
    }
    return { success: false, error: error.message };
  }
}

// Get correction state for a shop
// In database.js, update the getCorrectionState function:

async function getCorrectionState(shopId) {
  const context = `Get Correction State ${shopId}`;
  try {
    console.log(`[${context}] Starting to get correction state for shop: ${shopId}`);
    
    const filterFormula = `{ShopID} = '${shopId}'`;
    console.log(`[${context}] Using filter formula: ${filterFormula}`);
    
    const result = await airtableRequest({
      method: 'get',
      params: { 
        filterByFormula: filterFormula,
        sort: [{ field: 'Timestamp', direction: 'desc' }]
      },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CORRECTION_STATE_TABLE_NAME}`
    }, context);
    
    console.log(`[${context}] Airtable returned ${result.records.length} records`);
    
    if (result.records.length > 0) {
      const record = result.records[0];
      console.log(`[${context}] Found correction state:`, {
        id: record.id,
        correctionType: record.fields.CorrectionType,
        pendingUpdate: record.fields.PendingUpdate,
        detectedLanguage: record.fields.DetectedLanguage
      });
      
      return {
        success: true,
        id: record.id,
        correctionState: {  // FIX: Return the correction state as an object
          id: record.id,
          correctionType: record.fields.CorrectionType,
          pendingUpdate: JSON.parse(record.fields.PendingUpdate),
          detectedLanguage: record.fields.DetectedLanguage
        }
      };
    }
    
    console.log(`[${context}] No correction state found`);
    return { 
      success: true, 
      correctionState: null  // FIX: Explicitly return null
    };
  } catch (error) {
    console.error(`[${context}] Error getting correction state:`, error.message);
    if (error.response) {
      console.error(`[${context}] Airtable response:`, error.response.data);
    }
    return { success: false, error: error.message, correctionState: null };
  }
}

// Delete correction state
async function deleteCorrectionState(id) {
  const context = `Delete Correction State ${id}`;
  try {
    console.log(`[${context}] Starting to delete correction state with ID: ${id}`);
    
    await airtableRequest({
      method: 'delete',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CORRECTION_STATE_TABLE_NAME}/${id}`
    }, context);
    
    console.log(`[${context}] Successfully deleted correction state`);
    return { success: true };
  } catch (error) {
    console.error(`[${context}] Error deleting correction state:`, error.message);
    if (error.response) {
      console.error(`[${context}] Airtable response:`, error.response.data);
    }
    return { success: false, error: error.message };
  }
}

// Save user state to database
async function saveUserStateToDB(shopId, mode, data = {}) {
  const context = `Save User State ${shopId}`;
  try {
    const createData = {
      fields: {
        ShopID: shopId,
        StateMode: mode,
        StateData: JSON.stringify(data),
        Timestamp: new Date().toISOString()
      }
    };

    // Check if record already exists
    const filterFormula = `{ShopID} = '${shopId}'`;
    const findResult = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filterFormula },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_STATE_TABLE_NAME}`
    }, `${context} - Find`);

    if (findResult.records.length > 0) {
      // Update existing record
      const recordId = findResult.records[0].id;
      await airtableRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_STATE_TABLE_NAME}/${recordId}`,
        data: createData
      }, `${context} - Update`);
    } else {
      // Create new record
      await airtableRequest({
        method: 'post',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_STATE_TABLE_NAME}`,
        data: createData
      }, `${context} - Create`);
    }

    return { success: true };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Get user state from database
async function getUserStateFromDB(shopId) {
  const context = `Get User State ${shopId}`;
  try {
    const filterFormula = `{ShopID} = '${shopId}'`;
    const result = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filterFormula },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_STATE_TABLE_NAME}`
    }, context);

    if (result.records.length > 0) {
      const record = result.records[0];
      const stateMode = record.fields.StateMode;
      const stateData = record.fields.StateData ? JSON.parse(record.fields.StateData) : {};
      const timestamp = new Date(record.fields.Timestamp);

      // Check if state expired (5 minutes)
      if (Date.now() - timestamp.getTime() > STATE_TIMEOUT) {
        // Delete expired state
        await deleteUserStateFromDB(record.id);
        return null;
      }

      return {
        mode: stateMode,
        data: stateData,
        id: record.id
      };
    }

    return null;
  } catch (error) {
    logError(context, error);
    return null;
  }
}

// Delete user state from database
async function deleteUserStateFromDB(id) {
  const context = `Delete User State ${id}`;
  try {
    await airtableRequest({
      method: 'delete',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_STATE_TABLE_NAME}/${id}`
    }, context);
    return { success: true };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Constants for authentication
const AUTH_USERS_TABLE_NAME = process.env.AIRTABLE_AUTH_USERS_TABLE_NAME || 'AuthUsers';
const AUTH_CODE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// In database.js, update these functions:

// Check if user is authorized
async function isUserAuthorized(shopId, authCode = null) {
  const context = `Check Authorization ${shopId}`;
  try {
    let filterFormula = `{ShopID} = '${shopId}' AND {StatusUser} = 'active'`;
    
    if (authCode) {
      filterFormula += ` AND {AuthCode} = '${authCode}'`;
    }
    
    const result = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filterFormula },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}`
    }, context);
    
    if (result.records.length > 0) {
      // Update last used timestamp
      const recordId = result.records[0].id;
      await airtableRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}/${recordId}`,
        data: {
          fields: {
            LastUsed: new Date().toISOString()
          }
        }
      }, `${context} - Update Last Used`);
      
      return { 
        success: true, 
        user: {
          id: recordId,
          shopId: result.records[0].fields.ShopID,
          name: result.records[0].fields.Name || '',
          authCode: result.records[0].fields.AuthCode
        }
      };
    }
    
    return { success: false, error: 'User not found or inactive' };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Deactivate user (optional, if you want to deactivate programmatically)
async function deactivateUser(shopId) {
  const context = `Deactivate User ${shopId}`;
  try {
    const filterFormula = `{ShopID} = '${shopId}'`;
    const result = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filterFormula },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}`
    }, `${context} - Find`);
    
    if (result.records.length > 0) {
      const recordId = result.records[0].id;
      await airtableRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}/${recordId}`,
        data: {
          fields: {
            StatusUser: 'inactive'
          }
        }
      }, `${context} - Deactivate`);
      return { success: true };
    }
    
    return { success: false, error: 'User not found' };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
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
  updateBatchQuantityByCompositeKey,
  savePendingTranscription,    // Add this
  getPendingTranscription,     // Add this
  deletePendingTranscription,
  saveCorrectionState,    // Add this
  getCorrectionState,     // Add this
  deleteCorrectionState,
  saveUserStateToDB,
  getUserStateFromDB,
  deleteUserStateFromDB,
  isUserAuthorized,
  deactivateUser
};
