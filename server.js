const express = require('express');
const whatsappHandler = require('./api/whatsapp');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { runDailySummary } = require('./dailySummary');
const { 
  getAllProducts, 
  getProductPrice, 
  upsertProduct, 
  updateProductPrice, 
  getProductsNeedingPriceUpdate,
  sendPriceUpdateReminders
} = require('./database');
const app = express();
const tempDir = path.join(__dirname, 'temp');

// PDF serving route
app.get('/invoice/:fileName', (req, res) => {
  try {
    const fileName = req.params.fileName;
    
    // Security check: ensure fileName is safe
    if (!fileName || fileName.includes('..') || fileName.includes('/') || !fileName.endsWith('.pdf')) {
      console.error(`[PDF Server] Invalid filename: ${fileName}`);
      return res.status(400).send('Invalid filename');
    }
    
    // Try multiple possible paths
    const possiblePaths = [
      path.join('/tmp', 'invoices', fileName),  // Production path
      path.join(__dirname, 'temp', 'invoices', fileName),  // Development path
      path.join(__dirname, 'temp', fileName),  // Legacy path
    ];
    
    let filePath = null;
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        filePath = possiblePath;
        break;
      }
    }
    
    if (!filePath) {
      console.error(`[PDF Server] File not found. Tried paths:`, possiblePaths);
      return res.status(404).send('Invoice not found');
    }
    
    console.log(`[PDF Server] Serving file: ${filePath}`);
    
    // Get file stats for logging
    const stats = fs.statSync(filePath);
    console.log(`[PDF Server] File size: ${stats.size} bytes, created: ${stats.birthtime}`);
    
    // Send the file
    res.sendFile(filePath, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
    });
    
  } catch (error) {
    console.error(`[PDF Server] Error:`, error.message);
    res.status(500).send('Error serving invoice');
  }
});

// Middleware for parsing JSON and URL-encoded bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Add request ID to the request object for tracking
  req.requestId = requestId;
  
  console.log(`[${requestId}] ${req.method} ${req.url} - ${req.ip}`);
  
  // Log when the response is sent
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${requestId}] Response sent: ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// Middleware for webhook verification
app.use('/api/whatsapp', express.json({
  verify: (req, res, buf) => {
    const url = require('url').parse(req.url);
    if (req.method === 'POST' && url.pathname === '/api/whatsapp') {
      const signature = req.headers['x-twilio-signature'];
      const params = req.body;
      const twilio = require('twilio')(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
      
      if (!twilio.validateRequest(process.env.AUTH_TOKEN, signature, url, buf)) {
        console.error(`[${req.requestId}] Twilio signature validation failed`);
        throw new Error('Invalid signature');
      }
    }
  }
}));

// Health check endpoint with detailed system information
app.get('/health', (req, res) => {
  const healthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    memory: process.memoryUsage(),
    checks: {
      database: 'unknown',
      products: 'unknown',
      twilio: 'unknown',
      deepseek: 'unknown'
    }
  };
  
  // Check database connection
  const { testConnection, getAllProducts } = require('./database');
  testConnection()
    .then(isConnected => {
      healthCheck.checks.database = isConnected ? 'ok' : 'error';
    })
    .catch(() => {
      healthCheck.checks.database = 'error';
    })
    .finally(() => {
      // Check products table
      getAllProducts()
        .then(products => {
          healthCheck.checks.products = 'ok';
          healthCheck.productsCount = products.length;
        })
        .catch(() => {
          healthCheck.checks.products = 'error';
        })
        .finally(() => {
          // Check Twilio connection
          try {
            const twilio = require('twilio')(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
            twilio.api.accounts(process.env.ACCOUNT_SID).fetch()
              .then(() => {
                healthCheck.checks.twilio = 'ok';
                res.status(200).json(healthCheck);
              })
              .catch(() => {
                healthCheck.checks.twilio = 'error';
                res.status(200).json(healthCheck);
              });
          } catch (error) {
            healthCheck.checks.twilio = 'error';
            res.status(200).json(healthCheck);
          }
        });
    });
});

// Metrics endpoint for monitoring
app.get('/metrics', (req, res) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    activeRequests: app.get('activeConnections') || 0,
    environment: process.env.NODE_ENV || 'development'
  };
  
  res.status(200).json(metrics);
});

// Webhook verification endpoint
app.get('/api/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log(`[${req.requestId}] WEBHOOK_VERIFIED`);
      res.status(200).send(challenge);
    } else {
      console.warn(`[${req.requestId}] Webhook verification failed: invalid token`);
      res.sendStatus(403);
    }
  } else {
    console.warn(`[${req.requestId}] Webhook verification failed: missing parameters`);
    res.sendStatus(400);
  }
});

// Daily summary endpoint (for manual testing)
app.post('/api/daily-summary', async (req, res) => {
  const requestId = req.requestId;
  
  try {
    console.log(`[${requestId}] Manual daily summary triggered`);
    
    // Send immediate response
    res.status(202).json({
      status: 'processing',
      message: 'Daily summary job started',
      timestamp: new Date().toISOString()
    });
    
    // Run the daily summary in the background
    runDailySummary()
      .then(results => {
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;
        
        console.log(`[${requestId}] Daily summary completed: ${successCount} successful, ${failureCount} failed`);
      })
      .catch(error => {
        console.error(`[${requestId}] Daily summary failed:`, error.message);
      });
  } catch (error) {
    console.error(`[${requestId}] Error triggering daily summary:`, error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to start daily summary',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Product management endpoints

// Get all products
app.get('/api/products', async (req, res) => {
  const requestId = req.requestId;
  
  try {
    console.log(`[${requestId}] Getting all products`);
    
    const products = await getAllProducts();
    
    res.status(200).json({
      success: true,
      count: products.length,
      products: products,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[${requestId}] Error getting products:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get products',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get single product by name
app.get('/api/products/:name', async (req, res) => {
  const requestId = req.requestId;
  const productName = decodeURIComponent(req.params.name);
  
  try {
    console.log(`[${requestId}] Getting product: ${productName}`);
    
    const productInfo = await getProductPrice(productName);
    
    if (productInfo.success) {
      res.status(200).json({
        success: true,
        product: {
          name: productName,
          price: productInfo.price,
          unit: productInfo.unit,
          category: productInfo.category,
          hsnCode: productInfo.hsnCode
        },
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Product not found',
        message: `Product '${productName}' not found in database`
      });
    }
  } catch (error) {
    console.error(`[${requestId}] Error getting product:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get product',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Create or update product
app.post('/api/products', async (req, res) => {
  const requestId = req.requestId;
  
  try {
    console.log(`[${requestId}] Creating/updating product`);
    
    const { name, price, unit, category, hsnCode } = req.body;
    
    // Validate required fields
    if (!name || price === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Product name and price are required'
      });
    }
    
    const result = await upsertProduct({
      name: name.trim(),
      price: Number(price),
      unit: unit || 'pieces',
      category: category || 'General',
      hsnCode: hsnCode || ''
    });
    
    if (result.success) {
      res.status(result.action === 'created' ? 201 : 200).json({
        success: true,
        action: result.action,
        productId: result.id,
        message: `Product ${result.action} successfully`,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: 'Failed to create/update product'
      });
    }
  } catch (error) {
    console.error(`[${requestId}] Error creating/updating product:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create/update product',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update product price
app.put('/api/products/:id/price', async (req, res) => {
  const requestId = req.requestId;
  const productId = req.params.id;
  
  try {
    console.log(`[${requestId}] Updating product price: ${productId}`);
    
    const { price } = req.body;
    
    if (price === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing price field',
        message: 'Price is required'
      });
    }
    
    const result = await updateProductPrice(productId, Number(price));
    
    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Product price updated successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: 'Failed to update product price'
      });
    }
  } catch (error) {
    console.error(`[${requestId}] Error updating product price:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update product price',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get products needing price update
app.get('/api/products/needing-update', async (req, res) => {
  const requestId = req.requestId;
  
  try {
    console.log(`[${requestId}] Getting products needing price update`);
    
    const products = await getProductsNeedingPriceUpdate();
    
    res.status(200).json({
      success: true,
      count: products.length,
      products: products,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[${requestId}] Error getting products needing update:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get products needing update',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Trigger price update reminders
app.post('/api/price-reminders', async (req, res) => {
  const requestId = req.requestId;
  
  try {
    console.log(`[${requestId}] Manual trigger for price update reminders`);
    
    // Send immediate response
    res.status(202).json({
      status: 'processing',
      message: 'Price update reminders job started',
      timestamp: new Date().toISOString()
    });
    
    // Run the reminders in the background
    sendPriceUpdateReminders()
      .then(results => {
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;
        
        console.log(`[${requestId}] Price update reminders completed: ${successCount} sent, ${failureCount} failed`);
      })
      .catch(error => {
        console.error(`[${requestId}] Price update reminders failed:`, error.message);
      });
  } catch (error) {
    console.error(`[${requestId}] Error triggering price update reminders:`, error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to start price update reminders',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// WhatsApp webhook endpoint
app.post('/api/whatsapp', whatsappHandler);

// Static files (if needed)
app.use(express.static(path.join(__dirname, 'public')));

// 404 handler
app.use((req, res) => {
  console.warn(`[${req.requestId}] 404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  const requestId = req.requestId || 'unknown';
  
  console.error(`[${requestId}] Unhandled error:`, err);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: isDevelopment ? err.message : 'Something went wrong',
    requestId: requestId
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  // In production, you might want to use a monitoring service here
  if (process.env.NODE_ENV === 'production') {
    // Example: Send to monitoring service
    // monitoringService.captureException(reason);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  
  // In production, you might want to use a monitoring service here
  if (process.env.NODE_ENV === 'production') {
    // Example: Send to monitoring service
    // monitoringService.captureException(error);
  }
  
  // Exit with error
  process.exit(1);
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`Received ${signal}, starting graceful shutdown...`);
  
  // Close the server
  server.close(() => {
    console.log('Server closed, exiting process');
    process.exit(0);
  });
  
  // Force exit after timeout
  setTimeout(() => {
    console.error('Forced exit after timeout');
    process.exit(1);
  }, 10000);
};

// Listen for shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Schedule daily summary at 11 PM every day (Asia/Kolkata timezone)
cron.schedule('0 23 * * *', () => {
  console.log('Running scheduled daily summary job at 11 PM');
  
  runDailySummary()
    .then(results => {
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;
      
      console.log(`Scheduled daily summary completed: ${successCount} successful, ${failureCount} failed`);
    })
    .catch(error => {
      console.error('Scheduled daily summary failed:', error.message);
    });
}, {
  scheduled: true,
  timezone: "Asia/Kolkata"
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`✅ Server running on ${HOST}:${PORT}`);
  console.log(`📊 Health check available at: http://${HOST}:${PORT}/health`);
  console.log(`📈 Metrics available at: http://${HOST}:${PORT}/metrics`);
  console.log(`⏰ Daily summary scheduled for 11 PM Asia/Kolkata time`);
});

// Track active connections
app.set('activeConnections', 0);

server.on('connection', (socket) => {
  app.set('activeConnections', app.get('activeConnections') + 1);
  
  socket.on('close', () => {
    app.set('activeConnections', app.get('activeConnections') - 1);
  });
});

// Log when server is shutting down
process.on('exit', () => {
  console.log('Server process exiting');
});

// Add to server.js - clean up old PDFs daily
const cleanupOldPDFs = () => {
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
  const now = Date.now();
  let deletedCount = 0;
  let totalSize = 0;
  
  const cleanDirectory = (dir) => {
    if (!fs.existsSync(dir)) return;
    
    fs.readdir(dir, (err, files) => {
      if (err) return;
      
      files.forEach(file => {
        if (file.endsWith('.pdf')) {
          const filePath = path.join(dir, file);
          fs.stat(filePath, (err, stats) => {
            if (err) return;
            
            if (now - stats.mtime.getTime() > maxAge) {
              fs.unlink(filePath, err => {
                if (err) {
                  console.error('Failed to delete old PDF:', err);
                } else {
                  deletedCount++;
                  totalSize += stats.size;
                  console.log(`[Cleanup] Deleted old PDF: ${file} (${stats.size} bytes)`);
                }
              });
            }
          });
        }
      });
    });
  };
  
  // Clean both temp directories
  cleanDirectory(path.join('/tmp', 'invoices'));
  cleanDirectory(path.join(__dirname, 'temp', 'invoices'));
  cleanDirectory(path.join(__dirname, 'temp'));
  
  if (deletedCount > 0) {
    console.log(`[Cleanup] Completed: Deleted ${deletedCount} PDFs, freed ${totalSize} bytes`);
  }
};

// Run daily at 2 AM
const scheduleCleanup = () => {
  const now = new Date();
  const targetTime = new Date(now);
  targetTime.setHours(2, 0, 0, 0); // 2 AM
  
  // If we've passed 2 AM today, schedule for tomorrow
  if (now > targetTime) {
    targetTime.setDate(targetTime.getDate() + 1);
  }
  
  const msUntilTarget = targetTime - now;
  
  setTimeout(() => {
    cleanupOldPDFs();
    // Schedule next cleanup
    scheduleCleanup();
  }, msUntilTarget);
};

// Start the scheduler
scheduleCleanup();

// Add this to your server.js or a separate test file
app.get('/test-correction-state', async (req, res) => {
  const shopId = req.query.shopId || 'test-shop';
  
  console.log(`[Test] Testing correction state operations for shop: ${shopId}`);
  
  // Test saving correction state
  const testUpdate = {
    product: 'Test Product',
    quantity: 5,
    unit: 'packets',
    action: 'purchased'
  };
  
  const saveResult = await saveCorrectionState(shopId, 'product', testUpdate, 'en');
  console.log(`[Test] Save result:`, saveResult);
  
  if (!saveResult.success) {
    return res.status(500).json({ error: 'Failed to save correction state', details: saveResult.error });
  }
  
  // Test getting correction state
  const getResult = await getCorrectionState(shopId);
  console.log(`[Test] Get result:`, getResult);
  
  if (!getResult.success) {
    return res.status(500).json({ error: 'Failed to get correction state', details: getResult.error });
  }
  
  // Test deleting correction state
  const deleteResult = await deleteCorrectionState(saveResult.id);
  console.log(`[Test] Delete result:`, deleteResult);
  
  if (!deleteResult.success) {
    return res.status(500).json({ error: 'Failed to delete correction state', details: deleteResult.error });
  }
  
  res.json({
    success: true,
    message: 'All correction state operations successful',
    saveResult,
    getResult,
    deleteResult
  });
});

