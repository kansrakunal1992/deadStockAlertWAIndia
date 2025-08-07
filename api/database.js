const Airtable = require('airtable');

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

// Update inventory
async function updateInventory(shopId, product, quantityChange) {
  try {
    // Find existing record
    const records = await base('Inventory').select({
      filterByFormula: `AND({ShopID} = '${shopId}', {Product} = '${product}')`
    }).firstPage();
    
    let newQuantity;
    
    if (records.length > 0) {
      // Update existing record
      const currentQty = records[0].fields.Quantity || 0;
      newQuantity = currentQty + quantityChange;
      
      await base('Inventory').update(records[0].id, {
        Quantity: newQuantity,
        LastUpdated: new Date().toISOString()
      });
    } else {
      // Create new record
      newQuantity = quantityChange;
      await base('Inventory').create({
        ShopID: shopId,
        Product: product,
        Quantity: newQuantity,
        LastUpdated: new Date().toISOString()
      });
    }
    
    return { success: true, newQuantity };
  } catch (error) {
    console.error('Database error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { updateInventory };
