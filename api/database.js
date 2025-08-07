const axios = require('axios');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
let AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';

// Debug function to analyze each character
function analyzeBaseID() {
  const raw = process.env.AIRTABLE_BASE_ID || '';
  console.log('=== CHARACTER ANALYSIS ===');
  console.log('Raw Base ID length:', raw.length);
  console.log('Raw Base ID chars:');
  
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    const charCode = raw.charCodeAt(i);
    console.log(`  Position ${i}: "${char}" (charCode: ${charCode})`);
  }
  
  // Clean the base ID character by character
  let cleaned = '';
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    const charCode = raw.charCodeAt(i);
    
    // Only keep alphanumeric characters
    if ((charCode >= 48 && charCode <= 57) ||  // 0-9
        (charCode >= 65 && charCode <= 90) ||  // A-Z
        (charCode >= 97 && charCode <= 122)) { // a-z
      cleaned += char;
    }
  }
  
  console.log('Cleaned Base ID:', cleaned);
  console.log('Cleaned Base ID length:', cleaned.length);
  console.log('=== END ANALYSIS ===');
  
  return cleaned;
}

// Use the analyzed and cleaned base ID
AIRTABLE_BASE_ID = analyzeBaseID();
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Inventory';

// Explicit URL construction (avoiding template literals)
const airtableBaseURL = 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + TABLE_NAME;

// Debug function to check all possible URLs
function debugURLs() {
  const raw = process.env.AIRTABLE_BASE_ID || '';
  const cleaned = AIRTABLE_BASE_ID;
  const baseURL = 'https://api.airtable.com/v0/' + cleaned;
  const fullURL = 'https://api.airtable.com/v0/' + cleaned + '/' + TABLE_NAME;
  
  console.log('=== URL DEBUG ===');
  console.log('Raw Base ID:', JSON.stringify(raw));
  console.log('Cleaned Base ID:', JSON.stringify(cleaned));
  console.log('Base URL:', baseURL);
  console.log('Full URL:', fullURL);
  console.log('=== END DEBUG ===');
  
  return { baseURL, fullURL };
}

// Enhanced error logging
function logError(context, error) {
  console.error(`[${context}] Error Details:`, {
    message: error.message,
    response: error.response ? {
      status: error.response.status,
      statusText: error.response.statusText,
      data: error.response.data,
      headers: error.response.headers
    } : 'No response',
    config: error.config ? {
      url: error.config.url,
      method: error.config.method,
      headers: error.config.headers
    } : 'No config'
  });
}

// Helper function to make Airtable requests with retry logic
async function airtableRequest(config, context = 'Airtable Request', maxRetries = 3) {
  const headers = {
    'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
    'Content-Type': 'application/json'
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios({
        ...config,
        url: config.url || airtableBaseURL,
        headers,
        timeout: 10000 // 10 second timeout
      });
      
      console.log(`[${context}] Attempt ${attempt} successful`);
      return response.data;
    } catch (error) {
      logError(`${context} Attempt ${attempt}`, error);
      
      if (attempt === maxRetries) {
        throw new Error(`Failed after ${maxRetries} attempts: ${error.message}`);
      }
      
      // Wait before retry (exponential backoff)
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`[${context}] Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

// Update inventory with comprehensive error handling
async function updateInventory(shopId, product, quantityChange) {
  const context = `Update ${shopId} - ${product}`;
  
  try {
    console.log(`[${context}] Starting update with quantity change: ${quantityChange}`);
    
    // Validate inputs
    if (!shopId || !product) {
      throw new Error('Missing required fields: shopId or product');
    }
    
    if (typeof quantityChange !== 'number') {
      throw new Error('quantityChange must be a number');
    }
    
    // First, try to find existing record
    const filterFormula = 'AND({ShopID} = \'' + shopId + '\', {Product} = \'' + product + '\')';
    console.log(`[${context}] Searching with filter: ${filterFormula}`);
    
    const findResult = await airtableRequest(
      {
        method: 'get',
        params: {
          filterByFormula: filterFormula
        }
      },
      `${context} - Find Record`
    );
    
    console.log(`[${context}] Found ${findResult.records.length} existing records`);
    
    let newQuantity;
    if (findResult.records.length > 0) {
      // Update existing record
      const recordId = findResult.records[0].id;
      const currentQty = findResult.records[0].fields.Quantity || 0;
      newQuantity = currentQty + quantityChange;
      
      console.log(`[${context}] Updating record ${recordId}: ${currentQty} -> ${newQuantity}`);
      
      const updateData = {
        fields: {
          Quantity: newQuantity,
          LastUpdated: new Date().toISOString()
        }
      };

      await airtableRequest(
        {
          method: 'patch',
          url: 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + recordId,
          data: updateData
        },
        `${context} - Update Record`
      );
      
      console.log(`[${context}] Update successful`);
    } else {
      // Create new record
      newQuantity = quantityChange;
      const createData = {
        fields: {
          ShopID: shopId,
          Product: product,
          Quantity: newQuantity,
          LastUpdated: new Date().toISOString()
        }
      };

      console.log(`[${context}] Creating new record with quantity ${newQuantity}`);
      
      await airtableRequest(
        {
          method: 'post',
          data: createData
        },
        `${context} - Create Record`
      );
      
      console.log(`[${context}] Create successful`);
    }

    return { success: true, newQuantity };
  } catch (error) {
    logError(context, error);
    return { 
      success: false, 
      error: error.message,
      details: error.response?.data || 'No additional details'
    };
  }
}

// Comprehensive connection test
async function testConnection() {
  const context = 'Connection Test';
  
  try {
    console.log(`[${context}] Starting comprehensive test...`);
    
    // Debug URLs first
    const { baseURL, fullURL } = debugURLs();
    
    // Check environment variables with detailed logging
    console.log(`[${context}] Environment Variables:`);
    console.log(`  - Raw Base ID: "${process.env.AIRTABLE_BASE_ID}"`);
    console.log(`  - Cleaned Base ID: "${AIRTABLE_BASE_ID}"`);
    console.log(`  - Table Name: ${TABLE_NAME}`);
    console.log(`  - API Key: ${AIRTABLE_API_KEY ? AIRTABLE_API_KEY.substring(0, 15) + '...' : 'MISSING'}`);
    
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Missing required environment variables');
    }
    
    // Test 1: List accessible bases first
    console.log(`[${context}] Test 1: Listing accessible bases...`);
    const basesResponse = await axios({
      method: 'get',
      url: 'https://api.airtable.com/v0/meta/bases',
      headers: {
        'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    
    console.log(`[${context}] ✅ Bases list retrieved successfully`);
    console.log(`[${context}] Accessible bases:`, basesResponse.data.bases.map(b => ({ id: b.id, name: b.name })));
    
    // Check if our base is in the list
    const ourBase = basesResponse.data.bases.find(b => b.id === AIRTABLE_BASE_ID);
    if (!ourBase) {
      throw new Error(`Base ${AIRTABLE_BASE_ID} not accessible with this token`);
    }
    console.log(`[${context}] ✅ Our base found: ${ourBase.name} (${ourBase.id})`);
    
    // Test 2: Base access with detailed URL logging
    console.log(`[${context}] Test 2: Base access...`);
    console.log(`[${context}] Testing URL: ${baseURL}`);
    
    const baseTest = await axios({
      method: 'get',
      url: baseURL,
      headers: {
        'Authorization': 'Bearer ' + AIRTABLE_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    
    console.log(`[${context}] ✅ Base access successful`);
    console.log(`[${context}] Available tables:`, baseTest.data.tables.map(t => t.name));
    
    // Check if our table exists
    const ourTable = baseTest.data.tables.find(t => t.name === TABLE_NAME);
    if (!ourTable) {
      throw new Error(`Table "${TABLE_NAME}" not found in base`);
    }
    console.log(`[${context}] ✅ Our table found: ${ourTable.name} (${ourTable.id})`);
    
    // Test 3: Table access
    console.log(`[${context}] Test 3: Table access...`);
    const tableResult = await airtableRequest(
      { method: 'get', params: { maxRecords: 1 } },
      `${context} - Table Access`
    );
    
    console.log(`[${context}] ✅ Table access successful`);
    console.log(`[${context}] Table contains ${tableResult.records.length} records`);
    
    // Test 4: Write permissions (create a test record if table is empty)
    if (tableResult.records.length === 0) {
      console.log(`[${context}] Test 4: Write permissions (creating test record)...`);
      const testRecord = {
        fields: {
          ShopID: 'test-connection',
          Product: 'test-product',
          Quantity: 0,
          LastUpdated: new Date().toISOString()
        }
      };
      
      const createResult = await airtableRequest(
        { method: 'post', data: testRecord },
        `${context} - Write Test`
      );
      
      console.log(`[${context}] ✅ Write permissions successful`);
      console.log(`[${context}] Created test record: ${createResult.records[0].id}`);
      
      // Clean up test record
      await airtableRequest(
        { method: 'delete', url: 'https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/' + createResult.records[0].id },
        `${context} - Cleanup`
      );
      
      console.log(`[${context}] ✅ Test record cleaned up`);
    }
    
    console.log(`[${context}] 🎉 All tests passed! Connection is fully functional.`);
    return true;
    
  } catch (error) {
    logError(context, error);
    
    // Provide specific troubleshooting advice
    console.log(`[${context}] 🔍 Troubleshooting Advice:`);
    
    if (error.response?.status === 403) {
      console.log(`[${context}] • 403 Error: Check token permissions`);
      console.log(`[${context}] • Ensure token has: data.records:read, data.records:write, data.bases:read, schema.bases:read`);
      console.log(`[${context}] • Verify token has access to this base`);
    } else if (error.response?.status === 404) {
      console.log(`[${context}] • 404 Error: Base or table not found`);
      console.log(`[${context}] • Base ID should be: ${AIRTABLE_BASE_ID}`);
      console.log(`[${context}] • Table name should be: ${TABLE_NAME}`);
      console.log(`[${context}] • Check if base exists and token has access`);
      console.log(`[${context}] • Check for invisible characters in base ID`);
      console.log(`[${context}] • The URL being tested is: ${debugURLs().baseURL}`);
    } else if (error.message.includes('not accessible')) {
      console.log(`[${context}] • Base not accessible with this token`);
      console.log(`[${context}] • Create a new token with access to this base`);
    } else if (error.code === 'ECONNREFUSED') {
      console.log(`[${context}] • Connection refused: Check network connectivity`);
    } else if (error.code === 'ETIMEDOUT') {
      console.log(`[${context}] • Timeout: Airtable API may be slow`);
    }
    
    return false;
  }
}

// Helper function to validate Airtable configuration
function validateConfiguration() {
  const issues = [];
  
  if (!AIRTABLE_API_KEY) {
    issues.push('AIRTABLE_API_KEY is missing');
  } else if (!AIRTABLE_API_KEY.startsWith('pat')) {
    issues.push('AIRTABLE_API_KEY should start with "pat" (Personal Access Token)');
  }
  
  if (!AIRTABLE_BASE_ID) {
    issues.push('AIRTABLE_BASE_ID is missing');
  } else if (!AIRTABLE_BASE_ID.startsWith('app')) {
    issues.push('AIRTABLE_BASE_ID should start with "app"');
  }
  
  if (!TABLE_NAME) {
    issues.push('TABLE_NAME is missing');
  }
  
  if (issues.length > 0) {
    console.log('Configuration Issues:');
    issues.forEach(issue => console.log(`  • ${issue}`));
    return false;
  }
  
  return true;
}

module.exports = { 
  updateInventory, 
  testConnection,
  validateConfiguration 
};
