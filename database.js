const axios = require('axios');
const PAYMENTS_TABLE_NAME = process.env.AIRTABLE_PAYMENTS_TABLE_NAME || 'Payments';
const PENDING_TRANSCRIPTIONS_TABLE_NAME = process.env.AIRTABLE_PENDING_TRANSCRIPTIONS_TABLE_NAME || 'PendingTranscriptions';
const CORRECTION_STATE_TABLE_NAME = process.env.AIRTABLE_CORRECTION_STATE_TABLE_NAME || 'CorrectionState';
const USER_STATE_TABLE_NAME = process.env.AIRTABLE_USER_STATE_TABLE_NAME || 'UserState';
const TRANSLATIONS_TABLE_NAME = process.env.AIRTABLE_TRANSLATIONS_TABLE_NAME || 'Translations';
const STATE_TIMEOUT = Number(process.env.USER_STATE_TTL_MS ?? (60 * 60 * 1000)); // 60 minutes

// Canonicalize ShopID to digits-only (no whatsapp:, +91, 91, 0 prefixes)
function getCanonicalShopId(fromOrDigits) {
  const raw = String(fromOrDigits ?? '');
  const digits = raw.replace(/^whatsapp:/, '').replace(/\D+/g, '');
  // Strip leading country code 91 if present
  const canon = digits.startsWith('91') && digits.length >= 12 ? digits.slice(2) : digits.replace(/^0+/, '');
  return canon;
}

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_URL = 'https://deadstockalertwaindia-production.up.railway.app';
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
const PRODUCTS_TABLE_NAME = process.env.AIRTABLE_PRODUCTS_TABLE_NAME || 'Products';
// NEW: Conversation memory table
const CONVERSATION_TURNS_TABLE_NAME = process.env.AIRTABLE_CONVERSATION_TURNS_TABLE_NAME || 'conversation_turns';

// URL construction
const airtableBaseURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + TABLE_NAME;
const airtableBatchURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + BATCH_TABLE_NAME;
const airtableUserPreferencesURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + USER_PREFERENCES_TABLE_NAME;
const airtableSalesURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + SALES_TABLE_NAME;
const airtableProductsURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + PRODUCTS_TABLE_NAME;
const airtableTranslationsURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + TRANSLATIONS_TABLE_NAME;


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
    'packet': 'packets', 'पैकेट': 'packets', 'box': 'boxes', 'बॉक्स': 'boxes', 
    'કિલો': 'kg', 'કિગ્રા': 'kg', 'ગ્રામ': 'kg',
    'લિટર': 'liters',
    'પૅકેટ': 'packets', 'પેકેટ': 'packets',
    'બોક્સ': 'boxes',
    'ટુકડો': 'pieces', 'ટુકડાઓ': 'pieces', 'નંગ': 'pieces'
  };
  
  return unitMap[unit.toLowerCase()] || unit;
}

// Convert quantity to base unit
function convertToBaseUnit(quantity, unit) {
  const u = String(unit || '').toLowerCase().trim();
  // weight
  if (u === 'g' || u === 'gram' || u === 'grams' || u === 'ग्राम' || u === 'ગ્રામ') return quantity * 0.001; // -> kg
  if (u === 'kg' || u === 'kilogram' || u === 'kilograms' || u === 'કિલો' || u === 'કિગ્રા') return quantity;

  // volume
  if (u === 'ml' || u === 'milliliter' || u === 'milliliters') return quantity * 0.001; // -> liters
  if (u === 'liter' || u === 'liters' || u === 'litre' || u === 'litres' || u === 'લિટર') return quantity;

  // countables
  if (u === 'packet' || u === 'packets' || u === 'पैकेट' || u === 'પૅકેટ' || u === 'પેકેટ') return quantity;
  if (u === 'box' || u === 'boxes' || u === 'बॉक्स' || u === 'બોક્સ') return quantity;
  if (u === 'piece' || u === 'pieces' || u === '' || u === 'टुकड़ा' || u === 'टुकड़े' || u === 'ટુકડો' || u === 'ટુકડાઓ' || u === 'નંગ') return quantity;
  return quantity; // default passthrough
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

// Airtable products request helper with timeout and retry logic
async function airtableProductsRequest(config, context = 'Airtable Products Request', maxRetries = 2) {
  const headers = {
    'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
    'Content-Type': 'application/json'
  };
  
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios({
        ...config,
        url: config.url || airtableProductsURL,
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

    const purchasePrice = batchData.purchasePrice || 0;
    const purchaseValue = purchasePrice * batchData.quantity;
    
    // Create new record
    const expiryISO = toAirtableDateTimeUTC(batchData.expiryDate);
      const fields = {
        ShopID: batchData.shopId,
        Product: batchData.product,
        Quantity: batchData.quantity,
        PurchaseDate: toAirtableDateTimeUTC(purchaseDate) || purchaseDate, // safe either way
        OriginalRecordID: batchData.batchId || '',
        Units: normalizedUnit,
        CompositeKey: compositeKey,
        PurchasePrice: purchasePrice,
        PurchaseValue: purchaseValue
      };
      if (expiryISO) fields.ExpiryDate = expiryISO; // OMIT if invalid/missing
      const createData = { fields };
      console.log(`[${context}] Using purchase date: ${fields.PurchaseDate}, expiry: ${expiryISO ?? '—'}`);

    
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
    // NEW: allow clearing expiry by sending null
        if (expiryDate === null) {
          const updateData = { fields: { ExpiryDate: null } };
          await airtableBatchRequest({
            method: 'patch',
            url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BATCH_TABLE_NAME}/${batchId}`,
            data: updateData
          }, context);
          console.log(`[${context}] Batch expiry cleared successfully`);
          return { success: true };
        }
    
        const expiryISO = toAirtableDateTimeUTC(expiryDate);
        if (!expiryISO) {
          throw new Error('Invalid expiry date for Airtable');
        }
        const updateData = { fields: { ExpiryDate: expiryISO } };
        await airtableBatchRequest({
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

// NEW: Update batch purchase price (and derived purchase value)
async function updateBatchPurchasePrice(batchId, price, quantityForValue = null) {
  const context = `Update Batch PurchasePrice ${batchId}`;
  try {
    const qty = Number(Math.abs(quantityForValue ?? 0));
    const fields = { PurchasePrice: Number(price) };
    if (qty > 0 && Number(price) > 0) {
      fields.PurchaseValue = Number(price) * qty;
    }
    await airtableBatchRequest({
      method: 'patch',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BATCH_TABLE_NAME}/${batchId}`,
      data: { fields }
    }, context);
    return { success: true };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// ===== NEW: Safe re-attribution of a sale to a different batch (two-phase with rollback) =====
async function reattributeSaleToBatch({ saleRecordId, shopId, product, qty, unit, oldCompositeKey, newCompositeKey }) {
  const context = `Reattribute ${shopId} - ${product}`;
  try {
    // 1) Put back into old batch
    const back = await updateBatchQuantityByCompositeKey(oldCompositeKey, +Math.abs(qty), unit);
    if (!back.success) return { success: false, error: `revert failed: ${back.error}` };

    // 2) Deduct from new batch; if it fails, revert step 1
    const take = await updateBatchQuantityByCompositeKey(newCompositeKey, -Math.abs(qty), unit);
    if (!take.success) {
      try { await updateBatchQuantityByCompositeKey(oldCompositeKey, -Math.abs(qty), unit); } catch (_) {}
      return { success: false, error: `new batch update failed: ${take.error}` };
    }

    // 3) Patch the sale record’s BatchCompositeKey
    await airtableSalesRequest({
      method: 'patch',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${SALES_TABLE_NAME}/${saleRecordId}`,
      data: { fields: { BatchCompositeKey: newCompositeKey } }
    }, `${context} - PatchSale`);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}


// Create a sales record
async function createSalesRecord(salesData) {
  const context = `Create Sales ${salesData.shopId} - ${salesData.product}`;
  try {
    console.log(`[${context}] Creating sales record for ${Math.abs(salesData.quantity)} units`);
    
    // Normalize unit before storing
    const normalizedUnit = salesData.unit ? normalizeUnit(salesData.unit) : 'pieces';
    
    // Calculate sale value
    const salePrice = salesData.salePrice || 0;
    const saleValue = salePrice * Math.abs(salesData.quantity);
    
    const createData = {
      fields: {
        ShopID: salesData.shopId,
        Product: salesData.product,
        Quantity: salesData.quantity, // This will be negative
        SaleDate: salesData.saleDate,
        BatchCompositeKey: salesData.batchCompositeKey || '', // Uses composite key
        SalePrice: salePrice,
        SaleValue: saleValue,
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
   // First, get current plan if it exists
   const currentPlan = await getUserPlan(shopId);
    
    // Format date for Airtable (YYYY-MM-DD)
    const now = new Date().toISOString().split('T')[0];
        
    // Use variant-aware lookup
        const prefRec = await getUserPreferencesRecord(shopId);
        if (prefRec) {
          const recordId = prefRec.id;
      const updateData = {
        fields: {
          Language: language,
          LastUpdated: now,          
          Plan: String(currentPlan.plan || 'free_demo').toLowerCase(),
          TrialEndDate: currentPlan.trialEndDate ? currentPlan.trialEndDate.toISOString() : null,
          ShopID: prefRec.fields.ShopID || shopId
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
          LastUpdated: now,
          Plan: 'free_demo',
          TrialEndDate: null
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

// Save user plan information
async function saveUserPlan(shopId, plan, trialEndDate = null) {
  const context = `Save User Plan ${shopId}`;
  try {    
const prefRec = await getUserPreferencesRecord(shopId);
    const planValue = String(plan).toLowerCase(); // normalize (expects 'paid' / 'trial' etc.)
    const trialISO = trialEndDate ? trialEndDate.toISOString() : null;
    if (prefRec) {
      // PATCH existing
      const patchData = {
        fields: {
          ShopID: prefRec.fields.ShopID || shopId,
          Plan: planValue,
          TrialEndDate: trialISO
        }
      };
      await airtableUserPreferencesRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_PREFERENCES_TABLE_NAME}/${prefRec.id}`,
        data: patchData
      }, `${context} - Update`);
    } else {
      // CREATE new (upsert)
      const digits = String(shopId ?? '').replace(/\D+/g, '');
      const canon = digits.startsWith('91') && digits.length >= 12 ? digits.slice(2) : digits.replace(/^0+/, '');
      const preferredShopId = `+91${canon}`; // match base convention
      const createData = {
        records: [{
          fields: {
            ShopID: preferredShopId,
            Language: 'en',
            Plan: planValue,
            TrialEndDate: trialISO
          }
        }]
      };
      await airtableUserPreferencesRequest({
        method: 'post',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_PREFERENCES_TABLE_NAME}`,
        data: createData
      }, `${context} - Create`);
    }
    return { success: true };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Get user plan information
async function getUserPlan(shopId) {
  const context = `Get User Plan ${shopId}`;
  try {
    const userPref = await getUserPreference(shopId);
    
    if (userPref.success) {
      return {
        plan: userPref.plan || 'free_demo',
        trialEndDate: userPref.trialEndDate ? new Date(userPref.trialEndDate) : null,
        shopId: shopId
      };
    }

    // Default plan
    return { 
      plan: 'free_demo', 
      trialEndDate: null,
      shopId 
    };
  } catch (error) {
    logError(context, error);
    return { 
      plan: 'free_demo', 
      trialEndDate: null,
      error: error.message 
    };
  }
}

// Check if shop is in first 50 (for free_demo_first_50 plan)
async function isFirst50Shops(shopId) {
  const context = `Check First 50 Shops ${shopId}`;
  try {
    // Get all shops with free_demo_first_50 plan
    const filterFormula = `{Plan} = 'free_demo_first_50'`;
    const result = await airtableUserPreferencesRequest({
      method: 'get',
      params: { filterByFormula: filterFormula }
    }, context);

    // If less than 50 shops have this plan, this shop qualifies
    return result.records.length < 50;
  } catch (error) {
    logError(context, error);
    return false;
  }
}

// Check if feature is available for user's plan
async function isFeatureAvailable(shopId, feature) {
  const context = `Check Feature Availability ${shopId}`;
  try {
    const { plan, trialEndDate } = await getUserPlan(shopId);
    
    // Check if trial has expired
    const isTrialExpired = trialEndDate && new Date() > trialEndDate;
    
    // Feature availability matrix
    const featureMatrix = {
      // Daily summaries
      'daily_summary': {
        'free_demo': true,  // 1 per day
        'free_demo_first_50': !isTrialExpired, // Unlimited during trial
        'standard': true,
        'enterprise': true
      },
      // AI summaries
      'ai_summary': {
        'free_demo': true,
        'free_demo_first_50': true, //!isTrialExpired, // Full access during trial
        'standard': true,
        'enterprise': true
      },
      // Replies limit
      'replies': {
        'free_demo': true, // 50 total
        'free_demo_first_50': !isTrialExpired, // Unlimited during trial
        'standard': true,
        'enterprise': true
      }
    };
    
    return featureMatrix[feature]?.[plan] || false;
  } catch (error) {
    logError(context, error);
    return false;
  }
}


// Get user preference from Airtable
async function getUserPreference(shopId) {
  const context = `Get User Preference ${shopId}`;
  try {        
    // Use variant-aware lookup
        const prefRec = await getUserPreferencesRecord(shopId);
        if (prefRec) {
          return {
            success: true,
            language: prefRec.fields.Language,
            plan: prefRec.fields.Plan ?? 'free_demo',
            trialEndDate: prefRec.fields.TrialEndDate ? new Date(prefRec.fields.TrialEndDate) : null,
            id: prefRec.id
          };
        }    
    return { success: true, language: 'en' }; // Default to English
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Get all shop IDs from Inventory table
async function getAllShopIDs() {
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
        const digits = String(shopId ?? '').replace(/\D+/g, '');
        const canon = digits.startsWith('91') && digits.length >= 12 ? digits.slice(2) : digits.replace(/^0+/, '');
        const preferredShopId = `+91${canon}`; // store with +91 to match your base
        const createData = {
          fields: {
            ShopID: preferredShopId,
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
    const canonicalId = getCanonicalShopId(shopId);
    const createData = {
      fields: {
        ShopID: canonicalId,
        StateMode: mode,
        StateData: JSON.stringify(data),
        Timestamp: new Date().toISOString()
      }
    };

    // Check if record already exists
    const filterFormula = `{ShopID} = '${canonicalId}'`;
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
    const canonicalId = getCanonicalShopId(shopId);
    const filterFormula = `{ShopID} = '${canonicalId}'`;

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
            
      // If TTL is set (> 0) and expired, return null (do not delete here)
            if (STATE_TIMEOUT > 0 && (Date.now() - timestamp.getTime() > STATE_TIMEOUT)) {
              return null; // caller can decide UX (e.g., prompt to continue or exit)
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
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS ?? 3);

// NEW: configurable paid plan duration (defaults to 30 days)
const PAID_DAYS = Number(process.env.PAID_DAYS ?? 30);

// In database.js, update these functions:

// Check if user is authorized
async function isUserAuthorized(shopId, authCode = null) {
  const context = `Check Authorization ${shopId}`;
  try {
    // Escape single quotes in the values for Airtable formula
    const escapedShopId = shopId.replace(/'/g, "''");
    const escapedAuthCode = authCode ? authCode.replace(/'/g, "''") : '';
    
    const conditions = [
  `{ShopID} = '${escapedShopId.replace(/'/g, "''")}'`,
  `{StatusUser} = 'active'`
    ];
    if (authCode) {
      conditions.push(`{AuthCode} = '${escapedAuthCode.replace(/'/g, "''")}'`);
    }
    const filterFormula = `AND(${conditions.join(', ')})`;
    
    console.log(`[${context}] Using filter formula: ${filterFormula}`);
    
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
    console.error(`[${context}] Error:`, error.message);
    console.error(`[${context}] Status:`, error.response?.status);
    console.error(`[${context}] Data:`, error.response?.data);
    return { success: false, error: error.message };
  }
}

// === NEW: fetch AuthUsers record by ShopID ===
async function getAuthUserRecord(shopId) {
  const context = `Get AuthUser ${shopId}`;
  try {
    // Build common variants for phone-format mismatches
    const digits = String(shopId || '').replace(/\D+/g, '');
    const canon = digits.startsWith('91') && digits.length >= 12 ? digits.slice(2) : digits.replace(/^0+/, '');
    const variants = Array.from(new Set([
      canon,
      `+91${canon}`,
      `91${canon}`,
      `0${canon}`
    ])).filter(Boolean);
    // Try each variant until we find a match
    for (const v of variants) {
      const filterByFormula = `{ShopID}='${String(v).replace(/'/g, "''")}'`;
      const result = await airtableRequest({
        method: 'get',
        params: { filterByFormula, maxRecords: 1 },
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}`
      }, `${context}::${v}`);
      if (result.records && result.records[0]) {
        return result.records[0];
      }
    }
    // No direct match — optionally, try a broader search (contains/startsWith) if needed
    return null;
  } catch (error) {
    logError(context, error);
    return null;
  }
}

// NEW: variant-aware lookup for UserPreferences by ShopID
async function getUserPreferencesRecord(shopId) {
  const context = `Get UserPreferences ${shopId}`;
  try {
    const digits = String(shopId ?? '').replace(/\D+/g, '');
    const canon = digits.startsWith('91') && digits.length >= 12 ? digits.slice(2) : digits.replace(/^0+/, '');
    const variants = Array.from(new Set([
      canon,
      `+91${canon}`,
      `91${canon}`,
      `0${canon}`
    ])).filter(Boolean);
    for (const v of variants) {
      const filterByFormula = `{ShopID}='${String(v).replace(/'/g, "''")}'`;
      const result = await airtableUserPreferencesRequest({
        method: 'get',
        params: { filterByFormula, maxRecords: 1 }
      }, `${context}::${v}`);
      if (result.records && result.records[0]) return result.records[0];
    }
    return null;
  } catch (error) {
    logError(context, error);
    return null;
  }
}

// --- [NEW ANCHOR: AuthUsers Onboarding Upsert] -----------------------------------------
// Upsert Name, GSTIN (optional), Address, Phone, CreatedDate BEFORE starting trial
async function upsertAuthUserDetails(shopId, { name, gstin = null, address = '', phone = null } = {}) {
  const context = `Upsert AuthUser Details ${shopId}`;
  try {
    const nowISO = new Date().toISOString();
    const record = await getAuthUserRecord(shopId);
    const fields = {
      ShopID: shopId,
      Name: String(name ?? '').trim(),
      Address: String(address ?? '').trim(),
      Phone: String(phone ?? shopId ?? '').trim(),
      CreatedDate: nowISO,
      ...(gstin && String(gstin).trim().toLowerCase() !== 'skip' ? { GSTIN: String(gstin).trim() } : {})
    };
    if (record) {
      await airtableRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}/${record.id}`,
        data: { fields }
      }, `${context} - Patch`);
      return { success: true, id: record.id, action: 'updated' };
    }
    const created = await airtableRequest({
      method: 'post',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}`,
      data: { fields }
    }, `${context} - Create`);
    return { success: true, id: created.id, action: 'created' };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// === NEW: start (or restart) a trial for this user ===
// === [UPDATED SIGNATURE] allow optional details captured during onboarding ===
async function startTrialForAuthUser(shopId, days = TRIAL_DAYS, details = null) {
  const context = `Start Trial ${shopId}`;
  try {    
    // 0) If onboarding details were provided, persist them first
        if (details && typeof upsertAuthUserDetails === 'function') {
          await upsertAuthUserDetails(shopId, {
            name: details.name,
            gstin: details.gstin,
            address: details.address,
            phone: details.phone ?? shopId
          });
        }
    const now = new Date();
    const end = new Date(now); end.setDate(end.getDate() + Number(days ?? 3));
    const existing = await getAuthUserRecord(shopId);
    const fields = {
      ShopID: shopId,
      StatusUser: 'active',
      LastUsed: now.toISOString()
    };
    if (existing) {
      await airtableRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}/${existing.id}`,
        data: { fields }
      }, `${context} - Patch`);
    } else {
      await airtableRequest({
        method: 'post',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}`,
        data: { fields }
      }, `${context} - Create`);
    }
    // persist plan + trial end in UserPreferences (you already have helpers)
    await saveUserPlan(shopId, 'trial', end); // writes TrialEndDate ISO
    return { success: true, start: now, end };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// === NEW: mark user as paid ===
async function markAuthUserPaid(shopId) {
  const context = `Mark Paid ${shopId}`;
  try {
    const rec = await getAuthUserRecord(shopId);
    if (!rec) return { success: false, error: 'User not found' };
    await airtableRequest({
      method: 'patch',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}/${rec.id}`,
      data: { fields: { StatusUser: 'active', LastUsed: new Date().toISOString() } }
    }, `${context} - Patch`);        
    // NEW: set unified end date for PAID into TrialEndDate (single field for both trial & paid)
        const start = new Date();
        const end = new Date(start.getTime() + PAID_DAYS * 24 * 60 * 60 * 1000);
        await saveUserPlan(shopId, 'paid', end); // writes TrialEndDate = paidStart + PAID_DAYS
        return { success: true, id: rec.id, paidStart: start.toISOString(), paidEnd: end.toISOString() };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// ===== NEW: recordPaymentEvent (optional audit trail in Airtable) ============
async function recordPaymentEvent({ shopId, amount, status, gateway = 'razorpay', payload = {} }) {
  const context = `Record Payment ${shopId}`;
  try {
    const createData = {
      fields: {
        ShopID: String(shopId || '').trim(),
        Amount: Number(amount || 0),
        Status: String(status || '').toLowerCase(),
        Gateway: gateway,
        Payload: JSON.stringify(payload || {}),
        Timestamp: new Date().toISOString()
      }
    };
    const result = await airtableRequest({
      method: 'post',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${PAYMENTS_TABLE_NAME}`,
      data: createData
    }, `${context} - Create`);
    return { success: true, id: result.id };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// === NEW: trials expiring before an ISO threshold (UserPreferences table) ===
async function getTrialsExpiringBefore(thresholdISO) {
  const context = 'Get Trials Expiring';
  try {
    const esc = s => String(s).replace(/'/g, "''");
    const iso = esc(thresholdISO);
    const filterByFormula =
      `AND({Plan}='trial', {TrialEndDate} <= DATETIME_PARSE("${iso}", "YYYY-MM-DDTHH:mm:ss.SSSZ"))`;
    const result = await airtableUserPreferencesRequest({
      method: 'get',
      params: { filterByFormula }
    }, context);
    return (result.records ?? []).map(r => ({
      id: r.id,
      shopId: r.fields.ShopID,
      trialEnd: r.fields.TrialEndDate ?? null,
      lastReminder: r.fields.LastTrialReminder ?? r.fields.LastReminder ?? null
    }));
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// === NEW: stamp last reminder time on UserPreferences ===
async function setTrialReminderSent(recordId, whenISO = new Date().toISOString()) {
  const context = `Set Trial Reminder ${recordId}`;
  try {
    await airtableUserPreferencesRequest({
      method: 'patch',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_PREFERENCES_TABLE_NAME}/${recordId}`,
      data: { fields: { LastTrialReminder: whenISO } }
    }, context);
    return { success: true };
  } catch (error) {     
  // If this base doesn't have LastTrialReminder yet, retry with legacy LastReminder
      const type = error?.response?.data?.error?.type;
      if (String(type).includes('UNKNOWN_FIELD_NAME')) {
        try {
          await airtableUserPreferencesRequest({
            method: 'patch',
            url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_PREFERENCES_TABLE_NAME}/${recordId}`,
            data: { fields: { LastReminder: whenISO } }
          }, context + '::fallback');
          return { success: true, fallback: 'LastReminder' };
        } catch (e2) {
          logError(context + '::fallback', e2);
          return { success: false, error: e2.message };
        }
      }
      logError(context, error);
      return { success: false, error: error.message };
  }
}

// NEW: Touch AuthUsers.LastUsed for arbitrary inbound activity (lightweight)
async function touchUserLastUsed(shopId) {
  const context = `Touch LastUsed ${shopId}`;
  try {
    const escapedShopId = shopId.replace(/'/g, "''");
    const filterFormula = `{ShopID} = '${escapedShopId}'`;
    const find = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filterFormula },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}`
    }, `${context} - Find`);
    if (find.records.length > 0) {
      const recordId = find.records[0].id;
      await airtableRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}/${recordId}`,
        data: { fields: { LastUsed: new Date().toISOString() } }
      }, `${context} - Patch`);
      return { success: true };
    }
    return { success: false, error: 'User not found' };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// NEW: List active users whose LastUsed is older than a threshold
async function getUsersInactiveSince(thresholdISO) {
  const context = 'Get Inactive Users';
  try {
    // Build a safe filter: either LastUsed is blank OR older than threshold
    // thresholdISO like: 2025-11-14T00:00:00.000Z
    const esc = (s) => String(s).replace(/'/g, "''");
    const iso = esc(thresholdISO);
    const filterByFormula =
      `OR( {LastUsed}=BLANK(), {LastUsed} < DATETIME_PARSE('${iso}', 'YYYY-MM-DDTHH:mm:ss.SSSZ') )`;

    const result = await airtableRequest({
      method: 'get',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}`,
      params: {
        filterByFormula,
        fields: ['ShopID', 'LastUsed'],
        pageSize: 100
      }
    }, context);

    const rows = result.records || [];
    return rows
      .filter(r => r?.fields?.ShopID)
      .map(r => ({
        shopId: r.fields.ShopID,
        lastUsed: r.fields.LastUsed || null
      }));
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Deactivate user
async function deactivateUser(shopId) {
  const context = `Deactivate User ${shopId}`;
  try {
    const escapedShopId = shopId.replace(/'/g, "''");
    const filterFormula = `{ShopID} = '${escapedShopId}'`;
    
    console.log(`[${context}] Using filter formula: ${filterFormula}`);
    
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
    console.error(`[${context}] Error:`, error.message);
    console.error(`[${context}] Status:`, error.response?.status);
    console.error(`[${context}] Data:`, error.response?.data);
    return { success: false, error: error.message };
  }
}

// Add these functions to the module.exports object

// Get today's sales summary
async function getTodaySalesSummary(shopId) {
  const context = `Get Today Sales Summary ${shopId}`;
  try {    
    // Timezone-safe Airtable formula: treat 'today' in Asia/Kolkata (IST)
        const filterFormula = `AND(
          {ShopID} = '${shopId}',
          {Quantity} < 0,
          IS_SAME(SET_TIMEZONE({SaleDate}, 'Asia/Kolkata'), TODAY(), 'day')
        )`;
    
    const result = await airtableSalesRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula
      }
    }, context);
    
    // Calculate summary
    let totalItems = 0;
    let totalValue = 0;
    const productSales = {};
    
    result.records.forEach(record => {
      const product = record.fields.Product;
      const quantity = Math.abs(record.fields.Quantity || 0);
      const salePrice = record.fields.SalePrice || 0;
      const unit = record.fields.Units || '';
      
      totalItems += quantity;
      totalValue += quantity * salePrice;
      
      if (!productSales[product]) {
        productSales[product] = { quantity: 0, unit, value: 0 };
      }
      
      productSales[product].quantity += quantity;
      productSales[product].value += quantity * salePrice;
    });
    
    // Sort products by quantity sold
    const topProducts = Object.entries(productSales)
      .sort((a, b) => b[1].quantity - a[1].quantity)
      .slice(0, 5)
      .map(([name, data]) => ({
        name,
        quantity: data.quantity,
        unit: data.unit,
        value: data.value
      }));
    
    return {
      totalItems,
      totalValue,
      topProducts
    };
  } catch (error) {
    logError(context, error);
    return {
      totalItems: 0,
      totalValue: 0,
      topProducts: []
    };
  }
}

// Get inventory summary
async function getInventorySummary(shopId) {
  const context = `Get Inventory Summary ${shopId}`;
  try {
    // 1) Pull inventory records for this shop
    const filterFormula = `{ShopID} = '${shopId.replace(/'/g, "''")}'`;
    const invResult = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filterFormula }
    }, context);
      
  // 2) Pull shop-scoped products (name, price, unit, category)
      const products = await getAllProducts(shopId); // [{name, price, unit, category, ...}]
    const priceMap = new Map(products.map(p => [String(p.name).toLowerCase(), {
      price: Number(p.price ?? 0),
      unit: p.unit ?? 'pieces',
      category: p.category ?? 'General'
    }]));

    let totalProducts = 0;
    let totalValue = 0;
    const inventory = {};
    const byCategory = new Map(); // category -> { value, productCount }

    for (const record of (invResult.records || [])) {
      const product = String(record.fields.Product || '').trim();
      if (!product) continue;

      const qty = Number(record.fields.Quantity ?? 0);
      const unit = record.fields.Units ?? 'pieces';
      totalProducts++;

      const key = product.toLowerCase();
      const meta = priceMap.get(key) || { price: 0, unit: unit, category: 'General' };
      const price = Number(meta.price || 0);
      const category = meta.category || 'General';

      // Value = qty * price (fallback to qty*10 if no price)
      const estimatedValue = qty * (price > 0 ? price : 10);
      totalValue += estimatedValue;

      inventory[product] = {
        quantity: qty,
        unit,
        pricePerUnit: price,       // could be 0 if unknown
        estimatedValue
      };

      // Category aggregation
      const catEntry = byCategory.get(category) || { value: 0, productCount: 0 };
      catEntry.value += estimatedValue;
      catEntry.productCount += 1;
      byCategory.set(category, catEntry);
    }

    // Convert category map to sorted array (desc by value)
    const topCategories = Array.from(byCategory.entries())
      .map(([name, agg]) => ({ name, value: agg.value, productCount: agg.productCount }))
      .sort((a, b) => b.value - a.value);

    // (Optional) Keep totalPurchaseValue if you rely on it in summaries; we don't compute it here.
    const totalPurchaseValue = 0;

    return {
      totalProducts,
      totalValue,
      totalPurchaseValue, // remains 0 unless you add batch-cost aggregation
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

// Get low stock products
async function getLowStockProducts(shopId, threshold = 5) {
  const context = `Get Low Stock Products ${shopId}`;
  try {
    const filterFormula = `{ShopID} = '${shopId}'`;
    
    const result = await airtableRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula
      }
    }, context);
    
    // Find products with quantity below threshold
    const lowStockProducts = [];
    
    result.records.forEach(record => {
      const product = record.fields.Product;
      const quantity = record.fields.Quantity || 0;
      const unit = record.fields.Units || '';
      
      if (quantity < threshold && quantity > 0) {
        lowStockProducts.push({
          name: product,
          quantity,
          unit
        });
      }
    });
    
    // Sort by quantity (lowest first)
    lowStockProducts.sort((a, b) => a.quantity - b.quantity);
    
    return lowStockProducts;
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Get expiring products
async function getExpiringProducts(shopId, daysAhead = 7) {
  const context = `Get Expiring Products ${shopId}`;
  try {
    // Calculate date N days ahead
    const today = new Date();
    const nDaysAhead = new Date(today);
    nDaysAhead.setDate(today.getDate() + daysAhead);
    
    // Format date for Airtable formula
    const dateStr = nDaysAhead.toISOString();
    
    const filterFormula = `AND({ShopID} = '${shopId}', IS_BEFORE({ExpiryDate}, "${dateStr}"), {ExpiryDate} != BLANK())`;
    
    const result = await airtableBatchRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula,
        sort: [{ field: 'ExpiryDate', direction: 'asc' }]
      }
    }, context);
    
    // Process expiring products
    const expiringProducts = [];
    
    result.records.forEach(record => {
      const product = record.fields.Product;
      const expiryDate = record.fields.ExpiryDate;
      const quantity = record.fields.Quantity || 0;
      
      if (quantity > 0) {
        expiringProducts.push({
          name: product,
          expiryDate: new Date(expiryDate),
          quantity
        });
      }
    });
    
    return expiringProducts;
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Get sales data for a period
async function getSalesDataForPeriod(shopId, startDate, endDate) {
  const context = `Get Sales Data For Period ${shopId}`;
  try {
    // Format dates for Airtable formula
    const startStr = startDate.toISOString();
    const endStr = endDate.toISOString();      
        
    const filterFormula = `AND(
          {ShopID} = '${shopId}',
          {Quantity} < 0,
          IS_AFTER(SET_TIMEZONE({SaleDate}, 'Asia/Kolkata'), DATETIME_PARSE(\"${startStr}\")),
          IS_BEFORE(SET_TIMEZONE({SaleDate}, 'Asia/Kolkata'), DATETIME_PARSE(\"${endStr}\"))
        )`;
  
    const result = await airtableSalesRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula
      }
    }, context);
    
    // Calculate summary
    let totalItems = 0;
    let totalValue = 0;
    const productSales = {};
    
    result.records.forEach(record => {
      const product = record.fields.Product;
      const quantity = Math.abs(record.fields.Quantity || 0);
      const salePrice = record.fields.SalePrice || 0;
      const unit = record.fields.Units || '';
      
      totalItems += quantity;
      totalValue += quantity * salePrice;
      
      if (!productSales[product]) {
        productSales[product] = { quantity: 0, unit, value: 0 };
      }
      
      productSales[product].quantity += quantity;
      productSales[product].value += quantity * salePrice;
    });
    
    // Sort products by quantity sold
    const topProducts = Object.entries(productSales)
      .sort((a, b) => b[1].quantity - a[1].quantity)
      .slice(0, 10)
      .map(([name, data]) => ({
        name,
        quantity: data.quantity,
        unit: data.unit,
        value: data.value
      }));
    
    return {
      totalItems,
      totalValue,
      topProducts,
      records: result.records
    };
  } catch (error) {
    logError(context, error);
    return {
      totalItems: 0,
      totalValue: 0,
      topProducts: [],
      records: []
    };
  }
}

// Get purchase data for a period
async function getPurchaseDataForPeriod(shopId, startDate, endDate) {
  const context = `Get Purchase Data For Period ${shopId}`;
  try {
    // Format dates for Airtable formula
    const startStr = startDate.toISOString();
    const endStr = endDate.toISOString();
    
    const filterFormula = `AND({ShopID} = '${shopId}', IS_AFTER({PurchaseDate}, "${startStr}"), IS_BEFORE({PurchaseDate}, "${endStr}"))`;
    
    const result = await airtableBatchRequest({
      method: 'get',
      params: {
        filterByFormula: filterFormula
      }
    }, context);
    
    // Calculate summary
    let totalItems = 0;
    let totalValue = 0;
    const productPurchases = {};
    
    result.records.forEach(record => {
      const product = record.fields.Product;
      const quantity = record.fields.Quantity || 0;
      const unit = record.fields.Units || '';
      
      // Estimate purchase value (this could be enhanced with actual purchase prices)
      const estimatedValue = quantity * 8; // Simple estimation
      totalItems += quantity;
      totalValue += estimatedValue;
      
      if (!productPurchases[product]) {
        productPurchases[product] = { quantity: 0, unit, value: 0 };
      }
      
      productPurchases[product].quantity += quantity;
      productPurchases[product].value += estimatedValue;
    });
    
    // Sort products by quantity purchased
    const topProducts = Object.entries(productPurchases)
      .sort((a, b) => b[1].quantity - a[1].quantity)
      .slice(0, 10)
      .map(([name, data]) => ({
        name,
        quantity: data.quantity,
        unit: data.unit,
        value: data.value
      }));
    
    return {
      totalItems,
      totalValue,
      topProducts,
      records: result.records
    };
  } catch (error) {
    logError(context, error);
    return {
      totalItems: 0,
      totalValue: 0,
      topProducts: [],
      records: []
    };
  }
}

// In database.js, update the getShopDetails function
async function getShopDetails(shopId) {
  const context = `Get Shop Details ${shopId}`;
  try {
    const escapedShopId = shopId.replace(/'/g, "''");
    const filterFormula = `{ShopID} = '${escapedShopId}'`;
    
    const result = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filterFormula },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AUTH_USERS_TABLE_NAME}`
    }, context);

    if (result.records.length > 0) {
      const record = result.records[0];
      return {
        success: true,
        shopDetails: {
          id: record.id,
          shopId: record.fields.ShopID,
          name: record.fields.Name || '',
          gstin: record.fields.GSTIN || 'N/A',  // Handle missing GSTIN
          phone: record.fields.Phone || record.fields.ShopID || 'N/A',  // Fallback to ShopID
          address: record.fields.Address || ''  // Handle missing address
        }
      };
    }

    return { success: false, error: 'Shop not found' };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Create or update product with price
// Helper: escape single quotes for Airtable formulas
function escapeFormula(val) {
  return String(val ?? '').replace(/'/g, "''");
}

// NEW: shop-scoped upsert (requires ShopID)
async function upsertProduct(productData) {
  const context = `Upsert Product ${productData.name}`;
  try {
    const { shopId, name, price, unit, category, hsnCode } = productData;
    const nameLc = String(name).toLowerCase().trim();
    const filterFormula =
      `AND({ShopID}='${escapeFormula(shopId)}', LOWER(TRIM({Name}))='${escapeFormula(nameLc)}')`;
    const findResult = await airtableProductsRequest({
      method: 'get',
      params: { filterByFormula: filterFormula, maxRecords: 1 }
    }, `${context} - Find`);

    const sanitizedPrice = (typeof price === 'number')
      ? price
      : parseFloat(String(price).replace(/[^\d.]/g, '')) || 0;

    const productRecord = {
      fields: {
        ShopID: shopId,
        Name: name.trim(),
        Price: sanitizedPrice,
        Unit: unit ?? 'pieces',
        Category: category ?? 'General',
        HSNCode: hsnCode ?? '',
        LastUpdated: new Date().toISOString()
      }
    };

    if (findResult.records.length > 0) {
      const recordId = findResult.records[0].id;
      await airtableProductsRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${PRODUCTS_TABLE_NAME}/${recordId}`,
        data: productRecord
      }, `${context} - Update`);
      return { success: true, id: recordId, action: 'updated' };
    } else {
      const result = await airtableProductsRequest({
        method: 'post',
        data: productRecord
      }, `${context} - Create`);
      return { success: true, id: result.id, action: 'created' };
    }
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}


// Get product price  
  // NEW: shop-scoped price fetch with global fallback
  async function getProductPrice(productName, shopId = null) {
    const context = `Get Product Price ${productName}`;
  try {          
      const nameLower = productName.toLowerCase().trim();               
      const shopScoped = shopId
            ? `AND({ShopID}='${escapeFormula(shopId)}', OR(LOWER(TRIM({Name}))='${escapeFormula(nameLower)}', FIND('${escapeFormula(nameLower)}', LOWER(TRIM({Name})))>0))`
            : `OR(LOWER(TRIM({Name}))='${escapeFormula(nameLower)}', FIND('${escapeFormula(nameLower)}', LOWER(TRIM({Name})))>0)`;
      
          // Try primary lookup; if it throws (e.g., invalid formula), fall back gracefully
          let result = null;
          try {
            result = await airtableProductsRequest({
              method: 'get',
              params: {
                filterByFormula: shopScoped,
                maxRecords: 1,
                sort: [{ field: 'LastUpdated', direction: 'desc' }]
              }
            }, `${context} - Primary`);
          } catch (e) {
            console.warn(`[${context}] primary lookup failed, falling back:`, e?.message);
          }
    
    if (result.records && result.records.length > 0) {
      const rec = result.records[0];
      const raw = rec.fields.Price;
      // Coerce "₹ 20", "Rs 20/-" → 20
      const priceNum = (typeof raw === 'number')
        ? raw
        : parseFloat(String(raw).replace(/[^\d.]/g, '')) || 0;
      
      
      return {
            success: true,
            price: priceNum,
            unit: rec.fields.Unit ?? 'pieces',
            category: rec.fields.Category ?? 'General',
            hsnCode: rec.fields.HSNCode ?? '',
            // NEW: Layer A (auto-expiry hints)
            requiresExpiry: !!rec.fields.RequiresExpiry,
            shelfLifeDays: Number(rec.fields.DefaultShelfLifeDays ?? 0),
            autoExpiryCandidate: !!rec.fields.RequiresExpiry && Number(rec.fields.DefaultShelfLifeDays ?? 0) > 0
          };
    }    
        
    // Fallback to global (ShopID blank or missing) if shop-scoped not found
        if (shopId) {
          const globalResult = await airtableProductsRequest({
            method: 'get',
            params: {
              filterByFormula:
                `AND(OR({ShopID}='' , {ShopID}=BLANK()), OR(LOWER(TRIM({Name}))='${escapeFormula(nameLower)}', FIND('${escapeFormula(nameLower)}', LOWER(TRIM({Name})))>0))`,
              maxRecords: 1,
              sort: [{ field: 'LastUpdated', direction: 'desc' }]
            }
          }, `${context} - GlobalFallback`);
          if (globalResult.records && globalResult.records.length > 0) {
            const rec = globalResult.records[0];
            const raw = rec.fields.Price;
            const priceNum = (typeof raw === 'number')
              ? raw
              : parseFloat(String(raw).replace(/[^\d.]/g, '')) || 0;
            return {
              success: true,
              price: priceNum,
              unit: rec.fields.Unit ?? 'pieces',
              category: rec.fields.Category ?? 'General',
              hsnCode: rec.fields.HSNCode ?? '',
              requiresExpiry: !!rec.fields.RequiresExpiry,
              shelfLifeDays: Number(rec.fields.DefaultShelfLifeDays ?? 0)
            };
          }
        }
    
    return { success: false, error: 'Product not found' };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}


// Get all products  
  // NEW: optionally shop-scoped list
  async function getAllProducts(shopId = null) {
    const context = 'Get All Products';
  try {          
      const params = {
            sort: [{ field: 'Name', direction: 'asc' }]
          };
          if (shopId) {
            params.filterByFormula = `{ShopID}='${escapeFormula(shopId)}'`;
          }
          const result = await airtableProductsRequest({ method: 'get', params }, context);
   
    return result.records.map(record => ({
      id: record.id,
      shopId: record.fields.ShopID ?? '',
      name: record.fields.Name,
      price: record.fields.Price || 0,
      unit: record.fields.Unit || 'pieces',
      category: record.fields.Category || 'General',
      hsnCode: record.fields.HSNCode || '',
      lastUpdated: record.fields.LastUpdated
    }));
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Update product price
async function updateProductPrice(productId, newPrice) {
  const context = `Update Product Price ${productId}`;
  try {
    const updateData = {
      fields: {
        Price: newPrice,
        LastUpdated: new Date().toISOString()
      }
    };
    
    await airtableProductsRequest({
      method: 'patch',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${PRODUCTS_TABLE_NAME}/${productId}`,
      data: updateData
    }, context);
    
    return { success: true };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Get products needing price update (no price updated in last 7 days)  
  // NEW: optionally shop-scoped stale price list
  async function getProductsNeedingPriceUpdate(shopId = null) {
    const context = 'Get Products Needing Price Update';
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateISO = sevenDaysAgo.toISOString();
    
    let filterFormula = `OR(
      IS_BEFORE(
        {LastUpdated},
        DATETIME_PARSE("${dateISO}", "YYYY-MM-DDTHH:mm:ss.SSSZ")
      ),
      {LastUpdated} = BLANK(),
      {Price} = 0,
      {Price} = BLANK()          
      )`;
          if (shopId) {
            filterFormula = `AND({ShopID}='${escapeFormula(shopId)}', ${filterFormula})`;
          }
          const result = await airtableProductsRequest({
            method: 'get',
            params: {
              filterByFormula: filterFormula,
              sort: [{ field: 'LastUpdated', direction: 'asc' }]
            }
          }, context);
    
    return result.records.map(record => ({
      id: record.id,
      shopId: record.fields.ShopID ?? '',
      name: record.fields.Name,
      currentPrice: record.fields.Price || 0,
      unit: record.fields.Unit || 'pieces',
      lastUpdated: record.fields.LastUpdated
    }));
  } catch (error) {
    logError(context, error);
    return [];
  }
}


// ======== TRANSLATION PERSISTENT CACHE HELPERS ========
async function getTranslationEntry(key, language) {
  const context = `Get Translation ${language} ${key.slice(0,8)}…`;
  try {
    const esc = s => String(s).replace(/'/g, "''");
    const filterFormula = `AND({Key}='${esc(key)}', {Language}='${esc(language)}')`;
    const result = await airtableRequest({
      method: 'get',
      url: airtableTranslationsURL,
      params: { filterByFormula: filterFormula, maxRecords: 1 }
    }, context);
    if (result.records && result.records.length > 0) {
      const rec = result.records[0];
      return {
        success: true,
        id: rec.id,
        translatedText: rec.fields.TranslatedText || '',
        sourceText: rec.fields.SourceText || ''
      };
    }
    return { success: true, id: null, translatedText: null };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

async function upsertTranslationEntry({ key, language, sourceText, translatedText }) {
  const context = `Upsert Translation ${language} ${key.slice(0,8)}…`;
  try {
    // Try find existing
    const existing = await getTranslationEntry(key, language);
    const nowISO = new Date().toISOString();
    const fields = {
      Key: key,
      Language: language,
      SourceText: sourceText,
      TranslatedText: translatedText,
      LastUpdated: nowISO
    };
    if (existing.success && existing.id) {
      await airtableRequest({
        method: 'patch',
        url: `${airtableTranslationsURL}/${existing.id}`,
        data: { fields }
      }, `${context} - Update`);
      return { success: true, id: existing.id, action: 'updated' };
    }
    const created = await airtableRequest({
      method: 'post',
      url: airtableTranslationsURL,
      data: { fields }
    }, `${context} - Create`);
    return { success: true, id: created.id, action: 'created' };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}


// ====== NEW HELPERS FOR QUICK QUERIES ======

// Get inventory record for a specific product
async function getProductInventory(shopId, productName) {
  const context = `Get Product Inventory ${shopId} - ${productName}`;
  try {
    const filterFormula = `AND({ShopID} = '${shopId.replace(/'/g,"''")}', {Product} = '${productName.replace(/'/g,"''")}')`;
    const result = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filterFormula, maxRecords: 1 }
    }, context);
     if (result.records.length > 0) {
      const rec = result.records[0];
      return {
        success: true,
        product: rec.fields.Product,
        quantity: rec.fields.Quantity ?? 0,
        unit: rec.fields.Units ?? 'pieces',
        id: rec.id
      };
    }
    return { success: true, product: productName, quantity: 0, unit: 'pieces', id: null };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Get items that are out of stock (<= 0)
async function getStockoutItems(shopId) {
  const context = `Get Stockout Items ${shopId}`;
  try {
    const filterFormula = `AND({ShopID} = '${shopId.replace(/'/g,"''")}', OR({Quantity} = 0, {Quantity} < 0, {Quantity} = BLANK()))`;
    const result = await airtableRequest({ method: 'get', params: { filterByFormula: filterFormula } }, context);
    return result.records.map(rec => ({
      name: rec.fields.Product,
      quantity: rec.fields.Quantity ?? 0,
      unit: rec.fields.Units ?? 'pieces'
    }));
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Get positive-remaining batches for a product with purchase & expiry dates
async function getBatchesForProductWithRemaining(shopId, productName) {
  const context = `Get Batches For Product ${shopId} - ${productName}`;
  try {
    const filterFormula = `AND({ShopID}='${shopId.replace(/'/g,"''")}',{Product}='${productName.replace(/'/g,"''")}', {Quantity} > 0)`;
    const result = await airtableBatchRequest({
      method: 'get',
      params: { filterByFormula: filterFormula, sort: [{ field: 'PurchaseDate', direction: 'asc' }] }
    }, context);
    return result.records.map(r => ({
      id: r.id,
      product: r.fields.Product,
      quantity: r.fields.Quantity ?? 0,
      unit: r.fields.Units ?? 'pieces',
      purchaseDate: r.fields.PurchaseDate,
      expiryDate: r.fields.ExpiryDate ?? null,
      compositeKey: r.fields.CompositeKey
    }));
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Rolling period helper (day, week, month)
function getPeriodWindow(period) {
  const now = new Date();
  if (!period) return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: now };
  const p = period.toLowerCase();
  if (p === 'day' || p === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { start, end };
  }
  if (p.includes('week')) {
    // last 7 days rolling
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    return { start, end: now };
  }
  // default: this month-to-date
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = now;
  return { start, end };
}

// Sales summary by friendly period ("day|week|month")
async function getSalesSummaryPeriod(shopId, period = 'day') {
  const { start, end } = getPeriodWindow(period);
  return await getSalesDataForPeriod(shopId, start, end);
}

// Top-N sellers by friendly period
async function getTopSellingProductsForPeriod(shopId, period = 'month', limit = 5) {
  const data = await getSalesSummaryPeriod(shopId, period);
  const top = (data.topProducts ?? []).slice(0, limit);
  return { success: true, top, totalItems: data.totalItems ?? 0, totalValue: data.totalValue ?? 0 };
}

// Heuristic reorder suggestions: velocity-based with lead & safety days
async function getReorderSuggestions(shopId, { days = 30, leadTimeDays = 3, safetyDays = 2, minDailyRate = 0.2 } = {}) {
  const context = `Get Reorder Suggestions ${shopId}`;
  try {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - days);
    const sales = await getSalesDataForPeriod(shopId, start, now);
    const inventoryRecords = await getCurrentInventory(shopId);

    const soldMap = new Map(); // product -> qty sold
    for (const rec of (sales.records ?? [])) {
      const p = rec.fields.Product;
      const q = Math.abs(rec.fields.Quantity ?? 0);
      if (!p) continue;
      soldMap.set(p, (soldMap.get(p) ?? 0) + q);
    }
    const dayCount = Math.max(1, Math.round((now - start) / (24 * 60 * 60 * 1000)));        
    const suggestions = [];
    
        // Tunables: more forgiving defaults for general retail
        const MIN_DAILY_RATE = Math.min(0.05, minDailyRate ?? 0.05); // don’t skip too aggressively
        const BUFFER_DAYS = 2;                                      // extra beyond lead+safety
        const TARGET_COVER_DAYS = leadTimeDays + safetyDays + BUFFER_DAYS;
        const MIN_QTY_PER_ORDER = 1;     // floor
        const ROUND_TO_PACK_SIZE = 1;    // set to e.g., 6, 12, 24 if packs/cartons
    
        for (const rec of (inventoryRecords ?? [])) {
          const product = rec.fields.Product;
          const currentQty = Number(rec.fields.Quantity ?? 0);
          const unit = rec.fields.Units ?? 'pieces';
          const soldQty = Number(soldMap.get(product) ?? 0);
          const dailyRate = soldQty / dayCount; // avg per day
    
          // Ignore truly dormant items (no movement & plenty stock)
          if (dailyRate < MIN_DAILY_RATE && currentQty > 0) continue;
    
          const effectiveRate = Math.max(dailyRate, MIN_DAILY_RATE / 2); // tiny epsilon to compute cover
          const daysCover = currentQty / effectiveRate; // how many days current stock lasts
          if (daysCover >= TARGET_COVER_DAYS) continue; // enough cover; skip
    
          // Order so that projected cover reaches TARGET_COVER_DAYS
          const deficitDays = TARGET_COVER_DAYS - daysCover; // > 0
          const rawQty = deficitDays * effectiveRate;
          let reorderQty = Math.ceil(rawQty);
    
          // Apply floors and pack rounding
          reorderQty = Math.max(reorderQty, MIN_QTY_PER_ORDER);
          if (ROUND_TO_PACK_SIZE > 1) {
            reorderQty = Math.ceil(reorderQty / ROUND_TO_PACK_SIZE) * ROUND_TO_PACK_SIZE;
          }
    
          if (reorderQty > 0) {
            suggestions.push({
              name: product,
              unit,
              currentQty,
              dailyRate: Number(dailyRate.toFixed(2)),
              daysCover: Number(daysCover.toFixed(1)),
              targetCoverDays: TARGET_COVER_DAYS,
              reorderQty
            });
          }
        }

    // Sort by (reorderQty descending, dailyRate descending)   
    suggestions.sort((a, b) => (b.reorderQty - a.reorderQty) || (b.dailyRate - a.dailyRate));
        return {
          success: true,
          suggestions,
          days,
          leadTimeDays,
          safetyDays,
          targetCoverDays: TARGET_COVER_DAYS
        };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message, suggestions: [] };
  }
}

// --- New: safe sale helper that never leaves inventory negative ---
async function applySaleWithReconciliation(
  shopId,
  { product, quantity, unit = 'pieces', saleDate = new Date().toISOString(), language = 'en' },
  overrides = {}
){
  const ctx = `ApplySale ${shopId} - ${product}`;
  try {
    // Preferences with fallbacks (these fields are optional in Airtable)
    const pref = await getUserPreference(shopId).catch(() => ({ success: true, language: 'en' }));
    const allowNegative = overrides.allowNegative ?? pref.AllowNegativeInventory ?? false;
    const autoOpening   = overrides.autoOpeningBatch ?? pref.AutoCreateOpeningBatch ?? true;
    const onboardingISO = overrides.onboardingDate ?? pref.OnboardingDate ?? saleDate;
    const openingPrice  = Number(overrides.openingPrice ?? 0) || 0;

    // Current stock
    const inv = await getProductInventory(shopId, product);
    const currentQty = Number(inv?.quantity ?? 0);
    const need = Math.max(0, quantity - currentQty);

    // Enough stock? Normal sale path
    if (need === 0) {
      await updateInventory(shopId, product, -quantity, unit);
      return { status: 'ok', deficit: 0, selectedBatchCompositeKey: null };
    }

    // Hard-floor (no negative): auto-create Opening Balance batch then sell
    if (!allowNegative) {
      if (!autoOpening) {
        return { status: 'blocked', deficit: need, message: 'Insufficient stock' };
      }
      // Opening Balance batch for the deficit
      await createBatchRecord({
        shopId, product,
        quantity: need,
        unit,
        purchaseDate: onboardingISO,
        expiryDate: null,
        purchasePrice: openingPrice
      });
      // Boost then subtract
      await updateInventory(shopId, product, +need, unit);
      await updateInventory(shopId, product, -quantity, unit);
      const compKey = `${shopId}\n${product}\n${onboardingISO}`;
      return { status: 'auto-adjusted', deficit: need, selectedBatchCompositeKey: compKey };
    }

    // Soft-negative path: allow, but log correction task to reconcile later
    await updateInventory(shopId, product, -quantity, unit); // may go negative
    try {
      await saveCorrectionState(
        shopId,
        'negativeStock',
        { product, unit, currentQty, saleQty: quantity, deficit: need, saleDate },
        language
      );
    } catch (_) {}
    return { status: 'negative', deficit: need, selectedBatchCompositeKey: null };
  } catch (e) {
    console.error(`[${ctx}] Error:`, e.message);
    return { status: 'error', error: e.message };
  }
}

// --- Helper: normalize to Airtable-safe DateTime (UTC ISO) or return null
function toAirtableDateTimeUTC(dateLike) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return null;
  // Trim milliseconds (optional) to keep things tidy
  d.setMilliseconds(0);
  return d.toISOString(); // e.g. 2025-09-20T00:00:00.000Z
}

// ========== Conversation Memory (Airtable) ==========
// Append a conversation turn
async function appendTurn(shopId, userText, aiText, topicTag = null) {
  const context = `Append Conversation Turn ${shopId}`;
  try {
    const fields = {
      ShopID: String(shopId),
      UserText: String(userText || ''),
      AiText: String(aiText || ''),
      TopicTag: topicTag || null,
      Timestamp: new Date().toISOString(),
    };
    const result = await airtableRequest({
      method: 'post',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CONVERSATION_TURNS_TABLE_NAME}`,
      data: { fields }
    }, context);
    return { success: true, id: result.id };
  } catch (error) {
    logError(context, error);
    return { success: false, error: error.message };
  }
}

// Fetch last N conversation turns (most recent first)
async function getRecentTurns(shopId, n = 3) {
  const context = `Get Conversation Turns ${shopId}`;
  try {
    const filterByFormula = `{ShopID}='${String(shopId).replace(/'/g, "''")}'`;
    const result = await airtableRequest({
      method: 'get',
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CONVERSATION_TURNS_TABLE_NAME}`,
      params: {
        filterByFormula,
        sort: [{ field: 'Timestamp', direction: 'desc' }],
        maxRecords: n
      }
    }, context);
    return (result.records || []).map(r => ({
      user_text: r.fields.UserText || '',
      ai_text: r.fields.AiText || ''
    }));
  } catch (error) {
    logError(context, error);
    return [];
  }
}

// Lightweight topic classifier (pricing, trial, benefits, how-it-works, other)
function inferTopic(userText = '') {
  const t = String(userText || '').toLowerCase();
  if (/[₹]|price|pricing|cost|rate|मूल्य|कीमत/.test(t)) return 'pricing';
  if (/trial|free|मुफ़्त|फ्री/.test(t)) return 'trial';
  if (/benefit|help|क्यों|फायदा|मदद/.test(t)) return 'benefits';
  if (/how|कैसे|किस तरह/.test(t)) return 'how-it-works';
  return 'other';
}

// Lightweight: refresh the existing user state timestamp if present
async function refreshUserStateTimestamp(shopId) {
  const context = `Refresh User State ${shopId}`;
  try {
    const canonicalId = getCanonicalShopId(shopId);
    const filterFormula = `{ShopID}='${canonicalId}'`;
    const find = await airtableRequest({
      method: 'get',
      params: { filterByFormula: filterFormula, maxRecords: 1 },
      url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_STATE_TABLE_NAME}`
    }, `${context} - Find`);
    if (find.records && find.records[0]) {
      const recordId = find.records[0].id;
      await airtableRequest({
        method: 'patch',
        url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${USER_STATE_TABLE_NAME}/${recordId}`,
        data: { fields: { Timestamp: new Date().toISOString() } }
      }, `${context} - Patch`);
      return { success: true, id: recordId };
    }
    return { success: true, id: null }; // nothing to refresh
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
  getAllShopIDs,
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
  deactivateUser,        
  getAuthUserRecord,         // NEW
  startTrialForAuthUser,     // NEW
  markAuthUserPaid,          // NEW
  getTrialsExpiringBefore,   // NEW
  setTrialReminderSent,      // NEW
  touchUserLastUsed,
  getUsersInactiveSince,
  getTodaySalesSummary,
  getInventorySummary,
  getUserPreferencesRecord,
  getLowStockProducts,
  getExpiringProducts,
  getSalesDataForPeriod,
  getPurchaseDataForPeriod,
  getShopDetails,
  upsertProduct,
  getProductPrice,
  getAllProducts,
  updateProductPrice,
  getProductsNeedingPriceUpdate,
  getTranslationEntry,
  upsertTranslationEntry,
  getProductInventory,
  getStockoutItems,
  getBatchesForProductWithRemaining,
  getPeriodWindow,
  getSalesSummaryPeriod,
  getTopSellingProductsForPeriod,
  getReorderSuggestions,
  applySaleWithReconciliation,
  updateBatchPurchasePrice,
  reattributeSaleToBatch,    
  appendTurn,
  getRecentTurns,
  inferTopic,
  saveUserPlan, 
  getUserPlan, 
  isFirst50Shops, 
  isFeatureAvailable,
  upsertAuthUserDetails,
  recordPaymentEvent,
  refreshUserStateTimestamp
};
