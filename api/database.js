const axios = require('axios');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Inventory';

const airtableBaseURL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_NAME}`;

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
    'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
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
    const filterFormula = `AND({ShopID} = '${shopId}', {Product} = '${product}')`;
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
          url: `${airtableBaseURL}/${recordId}`,
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
    
    // Check environment variables
    console.log(`[${context}] Environment Variables:`);
    console.log(`  - Base ID: ${AIRTABLE_BASE_ID || 'MISSING'}`);
    console.log(`  - Table Name: ${TABLE_NAME}`);
    console.log(`  - API Key: ${AIRTABLE_API_KEY ? AIRTABLE_API_KEY.substring(0, 15) + '...' : 'MISSING'}`);
    
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Missing required environment variables');
    }
    
    // Test 1: Base access
    console.log(`[${context}] Test 1: Base access...`);
    const baseURL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
    const baseTest = await axios({
      method: 'get',
      url: baseURL,
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    
    console.log(`[${context}] ✅ Base access successful`);
    console.log(`[${context}] Available tables:`, baseTest.data.tables.map(t => t.name));
    
    // Test 2: Table access
    console.log(`[${context}] Test 2: Table access...`);
    const tableResult = await airtableRequest(
      { method: 'get', params: { maxRecords: 1 } },
      `${context} - Table Access`
    );
    
    console.log(`[${context}] ✅ Table access successful`);
    console.log(`[${context}] Table contains ${tableResult.records.length} records`);
    
    // Test 3: Write permissions (create a test record if table is empty)
    if (tableResult.records.length === 0) {
      console.log(`[${context}] Test 3: Write permissions (creating test record)...`);
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
        { method: 'delete', url: `${airtableBaseURL}/${createResult.records[0].id}` },
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
      console.log(`[${context}] • 404 Error: Check base ID and table name`);
      console.log(`[${context}] • Base ID should be: ${AIRTABLE_BASE_ID}`);
      console.log(`[${context}] • Table name should be: ${TABLE_NAME}`);
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
