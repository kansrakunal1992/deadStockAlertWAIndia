const PDFDocument = require('pdfkit');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const { getTodaySalesSummary, getSalesDataForPeriod, getProductPrice } = require('./database');

// Create a temporary directory for PDFs if it doesn't exist
const tempDir = process.env.NODE_ENV === 'production'
  ? '/tmp' // Use system temp directory in production
  : path.join(__dirname, 'temp'); // Use local temp directory in development

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  console.log(`[PDF Generator] Created temp directory: ${tempDir}`);
}

// Also create an invoices directory for better organization
const invoicesDir = path.join(tempDir, 'invoices');
if (!fs.existsSync(invoicesDir)) {
  fs.mkdirSync(invoicesDir, { recursive: true });
  console.log(`[PDF Generator] Created invoices directory: ${invoicesDir}`);
}

// Local logo path and caching
const logoPath = path.join(__dirname, 'assets', 'saamagrii_logo.png');
let logoImageBuffer = null;

/**
 * Load logo image from local file with caching
 */
function getLogoImage() {
  if (logoImageBuffer) {
    return logoImageBuffer;
  }
  try {
    if (fs.existsSync(logoPath)) {
      logoImageBuffer = fs.readFileSync(logoPath);
      console.log(`[PDF Generator] Logo loaded from local file: ${logoPath}`);
      return logoImageBuffer;
    } else {
      console.warn(`[PDF Generator] Logo file not found at: ${logoPath}`);
      return null;
    }
  } catch (error) {
    console.error('Failed to load logo from local file:', error);
    return null;
  }
}

// Color scheme for the PDF
const colors = {
  primary: '#1a237e', // Deep blue
  secondary: '#3949ab', // Medium blue
  accent: '#d32f2f', // Red accent
  success: '#388e3c', // Green
  warning: '#f57c00', // Orange
  light: '#f5f5f5', // Light gray
  dark: '#263238', // Dark gray
  header: '#283593', // Header blue
  tableHeader: '#37474f', // Table header
  evenRow: '#eceff1', // Even row color
  oddRow: '#ffffff', // Odd row color
  gst0: '#78909c', // Gray for 0% GST
  gst5: '#388e3c', // Green for 5% GST
  gst12: '#f57c00', // Orange for 12% GST
  gst18: '#d32f2f', // Red for 18% GST
  gst28: '#7b1fa2', // Purple for 28% GST
  gstSpecial: '#009688' // Teal for special rates
};

/**
 * Add a colored header section for reports
 */
function addColoredHeader(doc, reportTitle, reportDate, shopId) {
  // Header background
  doc.rect(0, 0, doc.page.width, 80).fill(colors.header);
  
  // Company name in white
  doc.fillColor('white');
  doc.fontSize(14);
  doc.text('Inventory Management System', 50, 30, { align: 'center' });
  
  // GSTIN in white
  doc.fontSize(10);
  doc.text('GSTIN: 29ABCDE1234F1Z5', 50, 50, { align: 'center' });
  
  // Report title in white
  doc.fontSize(18);
  doc.text(reportTitle, 50, 70, { align: 'center' });
  
  // Shop ID and date in light gray
  doc.fillColor(colors.light);
  doc.fontSize(12);
  doc.text(`Shop ID: ${shopId}`, 50, 95, { align: 'center' });
  doc.text(`Report Period: ${reportDate}`, 50, 110, { align: 'center' });
  
  doc.moveDown(30);
}

/**
 * Add a colored section header
 */
function addSectionHeader(doc, title, color = colors.primary) {
  doc.rect(50, doc.y, doc.page.width - 100, 25).fill(color);
  
  doc.fillColor('white');
  doc.fontSize(14);
  doc.text(title, 50, doc.y + 15, { align: 'center' });
  
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
  doc.fillColor('white');
  doc.fontSize(10);
  doc.text(label, x, y + 20, { width: boxWidth, align: 'center' });
  
  // Add value in white
  doc.fontSize(16);
  doc.text(value, x, y + 40, { width: boxWidth, align: 'center' });
  
  // Move to next position
  doc.x = x + boxWidth + 20;
  
  return { x, y, width: boxWidth, height: boxHeight };
}

/**
 * Calculate GST breakdown
 */
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
  doc.fillColor('white');
  doc.fontSize(8);
  doc.text('This is a computer-generated report. Please verify all details before use.', 50, footerY + 20, { align: 'center' });
  doc.text('GST rates are applied as per prevailing tax laws. HSN codes are for reference only.', 50, footerY + 35, { align: 'center' });
  doc.text(`Generated on ${moment().format('DD/MM/YYYY HH:mm')}`, 50, footerY + 50, { align: 'center' });
  doc.text('This report is generated for record-keeping purposes only.', 50, footerY + 65, { align: 'center' });
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
      try {
        if (period === 'today') {
          salesData = await getTodaySalesSummary(shopId);
        } else {
          const startDate = period === 'week'
            ? moment().subtract(7, 'days').toDate()
            : moment().startOf('month').toDate();
          const endDate = new Date();
          salesData = await getSalesDataForPeriod(shopId, startDate, endDate);
        }
      } catch (dbError) {
        console.error('[PDF Generator] Database error:', dbError);
        salesData = {
          totalItems: 0,
          totalValue: 0,
          topProducts: []
        };
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
 * Add a professional invoice header - SINGLE PAGE VERSION
 */
async function addInvoiceHeader(doc, shopDetails) {
  // Header background - increased height to accommodate logo
  doc.rect(0, 0, doc.page.width, 90).fill(colors.header);
  
  // Get logo image from local file
  const logoBuffer = getLogoImage();
  
  // Add logo at top left if available
  if (logoBuffer) {
    doc.image(logoBuffer, 10, 10, { width: 40, height: 40 });
  }
  
  // Add "Generated by Saamagrii.AI" text below logo
  doc.fillColor('white');
  doc.fontSize(9);
  doc.text('Generated by Saamagrii.AI', 10, 55);
  
  // Invoice title - centered
  doc.fontSize(20);
  doc.text('TAX INVOICE', 0, 25, { align: 'center' });
  
  // Shop details - centered (with safety checks)
  doc.fontSize(12);
  doc.text(shopDetails?.name || 'Shop Name', 0, 45, { align: 'center' });
  
  if (shopDetails?.gstin && shopDetails.gstin !== 'N/A') {
    doc.text(`GSTIN: ${shopDetails.gstin}`, 0, 65, { align: 'center' });
  }
  
  // Invoice details - adjusted positioning to prevent overlap
  const invoiceNumber = `INV-${shopDetails?.shopId?.replace(/\D/g, '') || '000000'}-${moment().format('YYYYMMDDHHmmss')}`;
  
  // Two-column layout with better spacing
  doc.fillColor(colors.dark);
  doc.fontSize(10);
  
  // Left column (Invoice details) - fixed positions with more spacing
  let yPos = 105; // Starting Y position
  
  doc.text('Invoice No:', 40, yPos);
  // Add invoice number with width constraint to prevent overlap
  doc.text(invoiceNumber, 100, yPos, { width: 120 }); // Increased width from 100 to 120
  
  yPos += 20; // Increased spacing from 15 to 20
  doc.text('Date:', 40, yPos);
  doc.text(moment().format('DD/MM/YYYY'), 100, yPos);
  
  yPos += 20; // Increased spacing from 15 to 20
  doc.text('Time:', 40, yPos);
  doc.text(moment().format('HH:mm'), 100, yPos);
  
  // Right column (Billing info) - moved further right to avoid overlap
  yPos = 105; // Reset to same starting Y position
  doc.text('Bill To:', 280, yPos); // Moved from 250 to 280
  yPos += 20; // Increased spacing
  doc.text(shopDetails?.name || 'Shop Name', 280, yPos);
  
  if (shopDetails?.address) {
    yPos += 20; // Increased spacing
    doc.text(shopDetails.address, 280, yPos, { width: 180 });
  }
  
  return yPos + 30;
}

/**
 * Add sale details in a compact table format - SINGLE PAGE VERSION
 */
function addSaleDetails(doc, shopDetails, saleRecord, productInfo) {
  // Section title
  doc.fontSize(14);
  doc.fillColor(colors.primary);
  doc.text('Invoice Details', 40, 180);
  
  // Table header
  let yPos = 205;
  doc.rect(40, yPos, doc.page.width - 80, 25).fill(colors.tableHeader);
  doc.fillColor('white');
  doc.fontSize(10);
  doc.text('Description', 45, yPos + 15, { width: 150 });
  doc.text('HSN/SAC', 195, yPos + 15, { width: 60 });
  doc.text('Qty', 255, yPos + 15, { width: 30 });
  doc.text('Rate (₹)', 285, yPos + 15, { width: 60 });
  doc.text('Taxable Val', 320, yPos + 15, { width: 60 });
  doc.text('GST Rate', 380, yPos + 15, { width: 50 });
  doc.text('GST Amt', 430, yPos + 15, { width: 50 });
  doc.text('Total (₹)', 480, yPos + 15, { width: 60 });
  
  // Product row
  yPos += 25;
  doc.rect(40, yPos, doc.page.width - 80, 25).fill(colors.oddRow);
  doc.fillColor(colors.dark);
  doc.fontSize(10);
  
  // Use dynamic rate and product info
  const rate = isNaN(saleRecord.rate) ? 0 : Number(saleRecord.rate);
  const quantity = isNaN(saleRecord.quantity) ? 0 : Number(saleRecord.quantity);
  
  // GST calculation based on product category
  let gstRate = 0.18; // Default 18%
  if (productInfo.category === 'Dairy') {
    gstRate = 0.05; // 5% for dairy
  } else if (productInfo.category === 'Essential') {
    gstRate = 0; // 0% for essential items
  } else if (productInfo.category === 'Packaged') {
    gstRate = 0.12; // 12% for packaged goods
  }
  
  const taxableValue = rate * quantity;
  const gstAmount = taxableValue * gstRate;
  const totalWithTax = taxableValue + gstAmount;
  
  doc.text(saleRecord.product || 'Product', 45, yPos + 15, { width: 150 });
  doc.text(productInfo.hsnCode || 'N/A', 195, yPos + 15, { width: 60 });
  doc.text(quantity.toString(), 255, yPos + 15, { width: 30 });
  doc.text(rate.toFixed(2), 285, yPos + 15, { width: 60 });
  doc.text(taxableValue.toFixed(2), 320, yPos + 15, { width: 60 });
  
  // GST rate with color coding
  const gstColor = gstRate === 0 ? colors.gst0 :
    gstRate === 0.05 ? colors.gst5 :
    gstRate === 0.12 ? colors.gst12 :
    gstRate === 0.18 ? colors.gst18 : colors.gst28;
  
  doc.fillColor(gstColor);
  doc.text(`${(gstRate * 100).toFixed(0)}%`, 380, yPos + 15, { width: 50 });
  doc.fillColor(colors.dark);
  doc.text(gstAmount.toFixed(2), 430, yPos + 15, { width: 50 });
  doc.text(totalWithTax.toFixed(2), 480, yPos + 15, { width: 60 });
  
  return {
    yPos: yPos + 35,
    taxableValue,
    gstAmount,
    totalWithTax,
    gstRate
  };
}

/**
 * Add invoice totals with GST breakdown - SINGLE PAGE VERSION
 */
function addInvoiceTotals(doc, saleDetails) {
  const { taxableValue, gstAmount, totalWithTax, gstRate } = saleDetails;
  
  const cgst = gstAmount / 2;
  const sgst = gstAmount / 2;
  
  // Payment details box - compact
  const boxX = 300;
  const boxWidth = 200;
  let yPos = 270;
  
  // Box background
  doc.rect(boxX - 10, yPos - 5, boxWidth + 20, 130).fill(colors.light);
  doc.rect(boxX - 10, yPos - 5, boxWidth + 20, 130).lineWidth(1).stroke(colors.dark);
  
  // Totals
  doc.fillColor(colors.dark);
  doc.fontSize(10);
  doc.text('Taxable Value:', boxX, yPos, { width: 100, align: 'right' });
  doc.text(`₹${taxableValue.toFixed(2)}`, boxX + 110, yPos);
  
  yPos += 15;
  doc.text(`CGST (${(gstRate/2)*100}%):`, boxX, yPos, { width: 100, align: 'right' });
  doc.text(`₹${cgst.toFixed(2)}`, boxX + 110, yPos);
  
  yPos += 15;
  doc.text(`SGST (${(gstRate/2)*100}%):`, boxX, yPos, { width: 100, align: 'right' });
  doc.text(`₹${sgst.toFixed(2)}`, boxX + 110, yPos);
  
  yPos += 15;
  doc.text('GST Amount:', boxX, yPos, { width: 100, align: 'right' });
  doc.text(`₹${gstAmount.toFixed(2)}`, boxX + 110, yPos);
  
  yPos += 15;
  doc.rect(boxX - 10, yPos, boxWidth + 20, 1).fill(colors.accent);
  
  yPos += 10;
  doc.fontSize(12);
  doc.fillColor(colors.accent);
  doc.text('Total:', boxX, yPos, { width: 100, align: 'right' });
  doc.text(`₹${totalWithTax.toFixed(2)}`, boxX + 110, yPos);
  
  // Amount in words
  yPos += 30;
  doc.fontSize(10);
  doc.fillColor(colors.dark);
  doc.text('Amount in Words:', 40, yPos);
  
  yPos += 15;
  doc.text(`${numberToWords(totalWithTax)} Rupees Only`, 40, yPos);
  
  // Add GSTIN and tax information
  yPos += 25;
  doc.fontSize(9);
  doc.text('GSTIN: 29ABCDE1234F1Z5', 40, yPos);
  yPos += 12;
  doc.text('Tax Rate: Applicable as per GST laws', 40, yPos);
  
  return yPos + 40;
}

/**
 * Add professional invoice footer - SINGLE PAGE VERSION
 */
function addInvoiceFooter(doc) {
  // Calculate footer position dynamically
  const footerY = doc.page.height - 60;
  
  // Footer background - reduced height
  doc.rect(0, footerY, doc.page.width, 60).fill(colors.dark);
  
  // Footer content
  doc.fillColor('white');
  doc.fontSize(9);
  doc.text('This is a computer-generated invoice.', 0, footerY + 15, { align: 'center' });
  doc.text(`Generated on ${moment().format('DD/MM/YYYY HH:mm')}`, 0, footerY + 30, { align: 'center' });
  doc.text('Thank you for your business!', 0, footerY + 45, { align: 'center' });
  
  // Signature line
  doc.lineJoin('miter').rect(350, footerY + 35, 150, 1).stroke('white');
  doc.text('Authorized Signatory', 350, footerY + 45, { align: 'center' });
}

/**
 * Helper function to convert numbers to words (Indian currency)
 */
function numberToWords(num) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  
  const convert = (n) => {
    if (n === 0) return 'Zero';
    if (n < 10) return ones[n];
    if (n >= 10 && n < 20) return teens[n - 10];
    if (n >= 20 && n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n >= 100 && n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
    if (n >= 1000 && n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n >= 100000 && n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return n.toString();
  };
  
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  
  let result = '';
  
  if (rupees > 0) {
    result = convert(rupees);
    result += rupees === 1 ? ' Rupee' : ' Rupees';
  }
  
  if (paise > 0) {
    if (rupees > 0) result += ' and ';
    result += convert(paise);
    result += paise === 1 ? ' Paisa' : ' Paise';
  }
  
  return result || 'Zero Rupees';
}

/**
 * Generate an invoice PDF for a sale - SINGLE PAGE VERSION
 */
async function generateInvoicePDF(shopDetails, saleRecord) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`[PDF Generator] Generating single-page invoice for shop ${shopDetails?.shopId}`);
      
      // Get product price from database
      let productPrice = 0;
      let productUnit = 'pieces';
      let productCategory = 'General';
      let hsnCode = 'N/A';
      
      try {
        const priceResult = await getProductPrice(saleRecord.product);
        if (priceResult.success) {
          productPrice = priceResult.price;
          productUnit = priceResult.unit;
          productCategory = priceResult.category;
          hsnCode = priceResult.hsnCode || 'N/A';
        }
      } catch (error) {
        console.warn('[PDF Generator] Could not fetch product price:', error.message);
      }
      
      // Use provided rate or fall back to database price
      const rate = saleRecord.rate || productPrice;
      
      // Generate filename with timestamp
      const timestamp = moment().format('YYYYMMDD_HHmmss');
      const fileName = `invoice_${shopDetails?.shopId?.replace(/\D/g, '') || '000000'}_${timestamp}.pdf`;
      
      // Use the invoices directory
      const filePath = path.join(invoicesDir, fileName);
      
      console.log(`[PDF Generator] File path: ${filePath}`);
      
      // Create PDF document with single page settings
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        bufferPages: false // Disable page buffering to ensure single page
      });
      
      // Ensure the directory exists before writing
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Pipe to file
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);
      
      // Prepare product info
      const productInfo = {
        hsnCode: hsnCode,
        category: productCategory,
        unit: productUnit
      };
      
      // Add invoice header
      await addInvoiceHeader(doc, shopDetails || {});
      
      // Add sale details with product info
      const saleDetails = addSaleDetails(doc, shopDetails || {}, saleRecord || {}, productInfo);
      
      // Add totals with calculated values
      addInvoiceTotals(doc, {
        taxableValue: saleDetails.taxableValue,
        gstAmount: saleDetails.gstAmount,
        totalWithTax: saleDetails.totalWithTax,
        gstRate: saleDetails.gstRate
      });
      
      // Add footer
      addInvoiceFooter(doc);
      
      // Finalize PDF and wait for it to be written
      doc.end();
      
      stream.on('finish', () => {
        console.log(`[PDF Generator] Single-page PDF generation completed: ${filePath}`);
        
        // Verify the file was actually created
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          console.log(`[PDF Generator] File size: ${stats.size} bytes`);
          resolve(filePath);
        } else {
          reject(new Error(`PDF file was not created: ${filePath}`));
        }
      });
      
      stream.on('error', (error) => {
        console.error(`[PDF Generator] Stream error:`, error);
        reject(error);
      });
      
    } catch (error) {
      console.error('[PDF Generator] Error generating PDF:', error);
      reject(error);
    }
  });
}

// Export the functions
module.exports = {
  generateSalesPDF,
  generateInvoicePDF
};
