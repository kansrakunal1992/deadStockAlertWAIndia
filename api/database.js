const axios = require('axios');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = 'Inventory';

const airtableBaseURL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_NAME}`;

// Helper function to make Airtable requests
async function airtableRequest(config) {
  const headers = {
    'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    const response = await axios({
      ...config,
      url: config.url || airtableBaseURL,
      headers
    });
    return response.data;
  } catch (error) {
    console.error('Airtable API Error:', error.response?.data || error.message);
    throw error;
  }
}

// Update inventory
async function updateInventory(shopId, product, quantityChange) {
  try {
    console.log(`Updating Airtable: ${shopId} - ${product} (${quantityChange})`);
    
    // First, try to find existing record
    const filterFormula = `AND({ShopID} = '${shopId}', {Product} = '${product}')`;
    const findConfig = {
      method: 'get',
      params: {
        filterByFormula: filterFormula
      }
    };

    const findResult = await airtableRequest(findConfig);
    console.log(`Found ${findResult.records.length} existing records`);

    let newQuantity;
    if (findResult.records.length > 0) {
      // Update existing record
      const recordId = findResult.records[0].id;
      const currentQty = findResult.records[0].fields.Quantity || 0;
      newQuantity = currentQty + quantityChange;

      const updateData = {
        fields: {
          Quantity: newQuantity,
          LastUpdated: new Date().toISOString()
        }
      };

      console.log(`Updating record ${recordId} to quantity ${newQuantity}`);
      await airtableRequest({
        method: 'patch',
        url: `${airtableBaseURL}/${recordId}`,
        data: updateData
      });
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

      console.log(`Creating new record for ${product} with quantity ${newQuantity}`);
      await airtableRequest({
        method: 'post',
        data: createData
      });
    }

    return { success: true, newQuantity };
  } catch (error) {
    console.error('Database error:', error.message);
    return { success: false, error: error.message };
  }
}

// Test connection
async function testConnection() {
  try {
    console.log('Testing Airtable connection...');
    console.log('Base URL:', airtableBaseURL);
    console.log('API Key:', AIRTABLE_API_KEY ? 'Set' : 'Missing');
    
    const result = await airtableRequest({ method: 'get' });
    console.log('Airtable connection successful');
    console.log('Table contains', result.records.length, 'records');
    return true;
  } catch (error) {
    console.error('Airtable connection failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return false;
  }
}

module.exports = { updateInventory, testConnection };
