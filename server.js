const express = require('express');
const whatsappHandler = require('./api/whatsapp');
const path = require('path');
const cron = require('node-cron');
const { runDailySummary } = require('./dailySummary');
const app = express();
const path = require('path');
const tempDir = path.join(__dirname, 'temp');

app.get('/invoice/:fileName', (req, res) => {
  const fileName = req.params.fileName;
  const filePath = path.join(tempDir, fileName);
  
  // Check if file exists
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Invoice not found');
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
      twilio: 'unknown',
      deepseek: 'unknown'
    }
  };
  
  // Check database connection
  const { testConnection } = require('./database');
  testConnection()
    .then(isConnected => {
      healthCheck.checks.database = isConnected ? 'ok' : 'error';
    })
    .catch(() => {
      healthCheck.checks.database = 'error';
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

