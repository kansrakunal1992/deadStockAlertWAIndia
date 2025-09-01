const PDFDocument = require('pdfkit');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const { getTodaySalesSummary, getSalesDataForPeriod } = require('./database');

// Create a temporary directory for PDFs if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Color scheme for the PDF
const colors = {
  primary: '#2c3e50',      // Dark blue
  secondary: '#3498db',   // Medium blue
  accent: '#e74c3c',      // Red accent
  success: '#27ae60',     // Green
  warning: '#f39c12',     // Orange
  light: '#ecf0f1',      // Light gray
  dark: '#34495e',       // Dark gray
  header: '#2980b9',     // Header blue
  tableHeader: '#34495e', // Table header
  evenRow: '#f8f9fa',    // Even row color
  oddRow: '#ffffff',     // Odd row color
  gst5: '#27ae60',       // Green for 5% GST
  gst12: '#e67e22',      // Orange for 12% GST
  gst18: '#e74c3c',      // Red for 18% GST
  gst28: '#8e44ad',      // Purple for 28% GST
  gst0: '#95a5a6'        // Gray for 0% GST
};

/**
 * Add a colored header section
 */
function addColoredHeader(doc, reportTitle, reportDate, shopId) {
  // Header background
  doc.rect(0, 0, doc.page.width, 80).fill(colors.header);
  
  // Company name in white
  doc.fillColor('white')
     .fontSize(14)
     .text('Inventory Management System', 50, 30, { align: 'center' });
  
  // GSTIN in white
  doc.fontSize(10)
     .text('GSTIN: 29ABCDE1234F1Z5', 50, 50, { align: 'center' });
  
  // Report title in white
  doc.fontSize(18)
     .text(reportTitle, 50, 70, { align: 'center' });
  
  // Shop ID and date in light gray
  doc.fillColor(colors.light)
     .fontSize(12)
     .text(`Shop ID: ${shopId}`, 50, 95, { align: 'center' });
  
  doc.text(`Report Period: ${reportDate}`, 50, 110, { align: 'center' });
  
  doc.moveDown(30);
}

/**
 * Add a colored section header
 */
function addSectionHeader(doc, title, color = colors.primary) {
  doc.rect(50, doc.y, doc.page.width - 100, 25).fill(color);
  
  doc.fillColor('white')
     .fontSize(14)
     .text(title, 50, doc.y + 15, { align: 'center' });
  
  doc.moveDown(35);
}

/**
 * Add a colored summary box
 */
function addSummaryBox(doc, label, value, color = colors.primary) {
  const boxWidth = 120;
  const boxHeight = 60;
  const x = doc.x;
  const y = doc.y;
  
  // Draw colored box
  doc.rect(x, y, boxWidth, boxHeight).fill(color);
  
  // Add label in white
  doc.fillColor('white')
     .fontSize(10)
     .text(label, x, y + 20, { width: boxWidth, align: 'center' });
  
  // Add value in white
  doc.fontSize(16)
     .text(value, x, y + 40, { width: boxWidth, align: 'center' });
  
  // Move to next position
  doc.x = x + boxWidth + 20;
  
  return { x, y, width: boxWidth, height: boxHeight };
}

/**
 * Add a colorful GST table
 */
function addGSTTable(doc, gstBreakdown) {
  // Table header background
  doc.rect(50, doc.y, doc.page.width - 100, 25).fill(colors.tableHeader);
  
  // Table headers in white
  doc.fillColor('white');
  doc.fontSize(10);
  doc.text('Description', 50, doc.y + 15, { width: 120 });
  doc.text('Taxable Value (₹)', 170, doc.y + 15, { width: 100 });
  doc.text('CGST (₹)', 270, doc.y + 15, { width: 70 });
  doc.text('SGST (₹)', 340, doc.y + 15, { width: 70 });
  doc.text('IGST (₹)', 410, doc.y + 15, { width: 70 });
  doc.text('Total Tax (₹)', 480, doc.y + 15, { width: 80 });
  
  doc.moveDown(30);
  
  // Table rows with alternating colors
  let isEvenRow = false;
  
  Object.entries(gstBreakdown.byRate).forEach(([rate, data]) => {
    const rateLabel = rate === 0 ? 'Exempted' : `${rate * 100}%`;
    const rowColor = isEvenRow ? colors.evenRow : colors.oddRow;
    const textColor = rate === 0 ? colors.gst0 : 
                     rate === 0.05 ? colors.gst5 :
                     rate === 0.12 ? colors.gst12 :
                     rate === 0.18 ? colors.gst18 : colors.gst28;
    
    // Row background
    doc.rect(50, doc.y, doc.page.width - 100, 25).fill(rowColor);
    
    // Row text
    doc.fillColor(colors.dark);
    doc.fontSize(9);
    doc.text(`${rateLabel} (${data.category})`, 55, doc.y + 15, { width: 115 });
    
    doc.fillColor(textColor);
    doc.text(data.taxableValue.toFixed(2), 170, doc.y + 15, { width: 100 });
    doc.text(data.cgst.toFixed(2), 270, doc.y + 15, { width: 70 });
    doc.text(data.sgst.toFixed(2), 340, doc.y + 15, { width: 70 });
    doc.text(data.igst.toFixed(2), 410, doc.y + 15, { width: 70 });
    doc.text(data.totalTax.toFixed(2), 480, doc.y + 15, { width: 80 });
    
    doc.moveDown(30);
    isEvenRow = !isEvenRow;
  });
  
  // Total row with accent color
  doc.rect(50, doc.y, doc.page.width - 100, 25).fill(colors.accent);
  
  doc.fillColor('white');
  doc.fontSize(10);
  doc.text('Total', 55, doc.y + 15, { width: 115, underline: true });
  doc.text(gstBreakdown.totalTaxableValue.toFixed(2), 170, doc.y + 15, { width: 100 });
  doc.text(gstBreakdown.totalCGST.toFixed(2), 270, doc.y + 15, { width: 70 });
  doc.text(gstBreakdown.totalSGST.toFixed(2), 340, doc.y + 15, { width: 70 });
  doc.text(gstBreakdown.totalIGST.toFixed(2), 410, doc.y + 15, { width: 70 });
  doc.text(gstBreakdown.totalTax.toFixed(2), 480, doc.y + 15, { width: 80 });
  
  doc.moveDown(40);
}

/**
 * Add a colorful sales table
 */
function addSalesTable(doc, salesData) {
  // Table header background
  doc.rect(50, doc.y, doc.page.width - 100, 25).fill(colors.tableHeader);
  
  // Table headers in white
  doc.fillColor('white');
  doc.fontSize(8);
  doc.text('HSN Code', 50, doc.y + 15, { width: 60 });
  doc.text('Product Name', 110, doc.y + 15, { width: 90 });
  doc.text('Qty', 200, doc.y + 15, { width: 30 });
  doc.text('Unit', 230, doc.y + 15, { width: 40 });
  doc.text('Rate (₹)', 270, doc.y + 15, { width: 50 });
  doc.text('Taxable Val', 320, doc.y + 15, { width: 60 });
  doc.text('GST Rate', 380, doc.y + 15, { width: 50 });
  doc.text('GST Amt', 430, doc.y + 15, { width: 50 });
  doc.text('Total (₹)', 480, doc.y + 15, { width: 60 });
  
  doc.moveDown(30);
  
  // Table rows with alternating colors
  let isEvenRow = false;
  
  if (salesData.topProducts && salesData.topProducts.length > 0) {
    salesData.topProducts.forEach(product => {
      const rowColor = isEvenRow ? colors.evenRow : colors.oddRow;
      
      // Row background
      doc.rect(50, doc.y, doc.page.width - 100, 25).fill(rowColor);
      
      // GST rate color
      const gstRate = product.gstRate || 0;
      const gstColor = gstRate === 0 ? colors.gst0 : 
                       gstRate === 0.05 ? colors.gst5 :
                       gstRate === 0.12 ? colors.gst12 :
                       gstRate === 0.18 ? colors.gst18 : colors.gst28;
      
      // Row text
      doc.fillColor(colors.dark);
      doc.fontSize(8);
      doc.text(product.hsnCode || 'N/A', 55, doc.y + 15, { width: 55 });
      doc.text(product.name, 110, doc.y + 15, { width: 90 });
      doc.text(product.quantity, 200, doc.y + 15, { width: 30 });
      doc.text(product.unit, 230, doc.y + 15, { width: 40 });
      doc.text(product.rate.toFixed(2), 270, doc.y + 15, { width: 50 });
      doc.text(product.taxableValue.toFixed(2), 320, doc.y + 15, { width: 60 });
      
      doc.fillColor(gstColor);
      doc.text(`${(gstRate * 100).toFixed(0)}%`, 380, doc.y + 15, { width: 50 });
      doc.text(product.gstAmount.toFixed(2), 430, doc.y + 15, { width: 50 });
      doc.text(product.totalWithTax.toFixed(2), 480, doc.y + 15, { width: 60 });
      
      doc.moveDown(30);
      isEvenRow = !isEvenRow;
    });
  }
}

/**
 * Add a colored footer
 */
function addColoredFooter(doc) {
  const footerY = doc.page.height - 80;
  
  // Footer background
  doc.rect(0, footerY, doc.page.width, 80).fill(colors.dark);
  
  // Footer text in white
  doc.fillColor('white')
     .fontSize(8)
     .text('This is a computer-generated report. Please verify all details before use.', 50, footerY + 20, { align: 'center' })
     .text('GST rates are applied as per prevailing tax laws. HSN codes are for reference only.', 50, footerY + 35, { align: 'center' })
     .text(`Generated on ${moment().format('DD/MM/YYYY HH:mm')}`, 50, footerY + 50, { align: 'center' })
     .text('This report is generated for record-keeping purposes only.', 50, footerY + 65, { align: 'center' });
}

/**
 * Generate a PDF report of sales data with colorful design
 * @param {string} shopId - The shop ID
 * @param {string} period - 'today' or custom period
 * @param {Date} startDate - Start date for custom period
 * @param {Date} endDate - End date for custom period
 * @returns {Promise<string>} - Path to generated PDF file
 */
async function generateSalesPDF(shopId, period = 'today', startDate = null, endDate = null) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`[PDF Generator] Generating sales PDF for shop ${shopId}, period: ${period}`);
      
      // Generate filename
      const timestamp = moment().format('YYYYMMDD_HHmmss');
      const fileName = `sales_report_${shopId.replace(/\D/g, '')}_${period}_${timestamp}.pdf`;
      const filePath = path.join(tempDir, fileName);
      
      // Create PDF document
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4'
      });
      
      // Pipe to file
      doc.pipe(fs.createWriteStream(filePath));
      
      // Add colored header
      let reportTitle = 'Daily Sales Report';
      let reportDate = moment().format('DD/MM/YYYY');
      
      if (period === 'week') {
        reportTitle = 'Weekly Sales Report';
        reportDate = `${moment().subtract(7, 'days').format('DD/MM/YYYY')} - ${moment().format('DD/MM/YYYY')}`;
      } else if (period === 'month') {
        reportTitle = 'Monthly Sales Report';
        reportDate = moment().format('MMMM YYYY');
      }
      
      addColoredHeader(doc, reportTitle, reportDate, shopId);
      
      // Get sales data
      let salesData;
      if (period === 'today') {
        salesData = await getTodaySalesSummary(shopId);
      } else {
        const startDate = period === 'week' 
          ? moment().subtract(7, 'days').toDate() 
          : moment().startOf('month').toDate();
        const endDate = new Date();
        salesData = await getSalesDataForPeriod(shopId, startDate, endDate);
      }
      
      // Calculate GST breakdown
      const gstBreakdown = calculateGSTBreakdown(salesData);
      
      // Add summary boxes in a row
      doc.x = 50;
      addSummaryBox(doc, 'Total Items', salesData.totalItems || 0, colors.primary);
      addSummaryBox(doc, 'Total Sales', `₹${gstBreakdown.totalWithTax.toFixed(2)}`, colors.success);
      addSummaryBox(doc, 'Total Tax', `₹${gstBreakdown.totalTax.toFixed(2)}`, colors.warning);
      addSummaryBox(doc, 'Taxable Value', `₹${gstBreakdown.totalTaxableValue.toFixed(2)}`, colors.secondary);
      
      doc.moveDown(40);
      
      // Add GST section
      addSectionHeader(doc, 'GST Summary', colors.primary);
      addGSTTable(doc, gstBreakdown);
      
      // Add sales details section
      addSectionHeader(doc, 'Detailed Sales Breakdown', colors.secondary);
      addSalesTable(doc, salesData);
      
      // Add footer
      addColoredFooter(doc);
      
      // Finalize PDF
      doc.end();
      
      console.log(`[PDF Generator] PDF generated successfully: ${filePath}`);
      resolve(filePath);
    } catch (error) {
      console.error('[PDF Generator] Error generating PDF:', error);
      reject(error);
    }
  });
}

/**
 * Generate an invoice PDF for a sale
 * @param {Object} shopDetails - Shop details from AuthUsers
 * @param {Object} saleRecord - Sale record details
 * @returns {Promise<string>} - Path to generated PDF file
 */
async function generateInvoicePDF(shopDetails, saleRecord) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`[PDF Generator] Generating invoice for shop ${shopDetails.shopId}`);
      
      // Generate filename
      const timestamp = moment().format('YYYYMMDD_HHmmss');
      const fileName = `invoice_${shopDetails.shopId.replace(/\D/g, '')}_${timestamp}.pdf`;
      const filePath = path.join(tempDir, fileName);
      
      // Create PDF document
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4'
      });
      
      // Pipe to file
      doc.pipe(fs.createWriteStream(filePath));
      
      // Add invoice header
      addInvoiceHeader(doc, shopDetails);
      
      // Add sale details
      addSaleDetails(doc, saleRecord);
      
      // Add totals
      addInvoiceTotals(doc, saleRecord);
      
      // Add footer
      addInvoiceFooter(doc);
      
      // Finalize PDF
      doc.end();
      
      console.log(`[PDF Generator] Invoice generated: ${filePath}`);
      resolve(filePath);
    } catch (error) {
      console.error('[PDF Generator] Error generating invoice:', error);
      reject(error);
    }
  });
}

// Helper functions for invoice generation
function addInvoiceHeader(doc, shopDetails) {
  // Header background
  doc.rect(0, 0, doc.page.width, 80).fill(colors.header);
  
  // Shop details in white
  doc.fillColor('white');
  doc.fontSize(14);
  doc.text('TAX INVOICE', 50, 30, { align: 'center' });
  
  doc.fontSize(10);
  doc.text(shopDetails.name, 50, 50, { align: 'center' });
  
  if (shopDetails.gstin && shopDetails.gstin !== 'N/A') {
    doc.text(`GSTIN: ${shopDetails.gstin}`, 50, 65, { align: 'center' });
  }
  
  // Invoice number and date
  const invoiceNumber = `INV-${shopDetails.shopId.replace(/\D/g, '')}-${moment().format('YYYYMMDDHHmmss')}`;
  doc.fillColor(colors.light);
  doc.fontSize(12);
  doc.text(`Invoice No: ${invoiceNumber}`, 50, 95, { align: 'center' });
  doc.text(`Date: ${moment().format('DD/MM/YYYY')}`, 50, 110, { align: 'center' });
  
  doc.moveDown(30);
}

function addSaleDetails(doc, saleRecord) {
  // Table header
  doc.rect(50, doc.y, doc.page.width - 100, 25).fill(colors.tableHeader);
  
  doc.fillColor('white')
     .fontSize(10)
     .text('Description', 55, doc.y + 15, { width: 200 })
     .text('HSN/SAC', 255, doc.y + 15, { width: 70 })
     .text('Qty', 325, doc.y + 15, { width: 40 })
     .text('Rate', 365, doc.y + 15, { width: 50 })
     .text('Taxable Value', 415, doc.y + 15, { width: 70 });
  
  doc.moveDown(30);
  
  // Product row
  doc.rect(50, doc.y, doc.page.width - 100, 25).fill(colors.oddRow);
  
  doc.fillColor(colors.dark)
     .fontSize(10)
     .text(saleRecord.product, 55, doc.y + 15, { width: 200 })
     .text('N/A', 255, doc.y + 15, { width: 70 }) // HSN code not available
     .text(saleRecord.quantity, 325, doc.y + 15, { width: 40 })
     .text(saleRecord.rate.toFixed(2), 365, doc.y + 15, { width: 50 })
     .text((saleRecord.quantity * saleRecord.rate).toFixed(2), 415, doc.y + 15, { width: 70 });
  
  doc.moveDown(40);
}

function addInvoiceTotals(doc, saleRecord) {
  const taxableValue = saleRecord.quantity * saleRecord.rate;
  const gstRate = 0.18; // Default 18% GST
  const gstAmount = taxableValue * gstRate;
  const total = taxableValue + gstAmount;
  
  // Taxable value
  doc.fontSize(10);
  doc.text('Taxable Value:', 400, doc.y, { width: 100, align: 'right' });
  doc.text(taxableValue.toFixed(2), 510, doc.y, { width: 70, align: 'right' });
  
  doc.moveDown(15);
  
  // GST
  doc.text(`CGST @${gstRate*100}%:`, 400, doc.y, { width: 100, align: 'right' });
  doc.text((gstAmount/2).toFixed(2), 510, doc.y, { width: 70, align: 'right' });
  
  doc.moveDown(15);
  
  doc.text(`SGST @${gstRate*100}%:`, 400, doc.y, { width: 100, align: 'right' });
  doc.text((gstAmount/2).toFixed(2), 510, doc.y, { width: 70, align: 'right' });
  
  doc.moveDown(15);
  
  // Total
  doc.fontSize(12);
  doc.text('Total:', 400, doc.y, { width: 100, align: 'right' });
  doc.text(total.toFixed(2), 510, doc.y, { width: 70, align: 'right' });
  
  doc.moveDown(40);
}

function addInvoiceFooter(doc) {
  const footerY = doc.page.height - 80;
  
  doc.fontSize(8)
     .text('This is a computer-generated invoice.', 50, footerY)
     .text(`Generated on ${moment().format('DD/MM/YYYY HH:mm')}`, 50, footerY + 15);
}

function calculateGSTBreakdown(salesData) {
  // Simple GST calculation - you can enhance this based on your needs
  const totalTaxableValue = salesData.totalValue || 0;
  const totalTax = totalTaxableValue * 0.18; // 18% GST
  const totalWithTax = totalTaxableValue + totalTax;
  
  return {
    totalTaxableValue,
    totalCGST: totalTax / 2,
    totalSGST: totalTax / 2,
    totalIGST: 0,
    totalTax,
    totalWithTax,
    byRate: {
      '0.18': {
        category: 'Standard',
        taxableValue: totalTaxableValue,
        cgst: totalTax / 2,
        sgst: totalTax / 2,
        igst: 0,
        totalTax: totalTax
      }
    }
  };
}

// Update module.exports
module.exports = { 
  generateSalesPDF,
  generateInvoicePDF 
};
