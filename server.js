const express = require('express');
const whatsappHandler = require('./api/whatsapp');
const bodyParser = require('body-parser'); // for raw body
try { require('dotenv').config(); } catch (_) {}
const fs = require('fs');
const path = require('path');
const os = require('os');
const cron = require('node-cron');
const { runDailySummary } = require('./dailySummary');
const {
  // existing
  getAllProducts,
  getProductPrice,
  upsertProduct,
  updateProductPrice,
  getProductsNeedingPriceUpdate,
  sendPriceUpdateReminders,
  // dashboard helpers (present in your codebase per whatsapp.js imports)
  // NOTE: these are used to aggregate across shops for dashboard views.
  getSalesDataForPeriod,
  getInventorySummary,
  getLowStockProducts,
  getExpiringProducts,
  getTopSellingProductsForPeriod,
  getReorderSuggestions,
  getAllShopIDs,
  getCurrentInventory,
  getShopDetails,
  recordPaymentEvent,
  markAuthUserPaid, 
  getUserPreference,
  setUserState
} = require('./database');

const crypto = require('crypto');          // NEW: HMAC for webhook signature

const app = express();

// Request logging middleware
// ==== Paid-confirm dedupe (lightweight persisted) ============================
// TTL can be tuned via env; default 6h
const PAID_CONFIRM_TTL_MS = Number(process.env.PAID_CONFIRM_TTL_MS ?? (6 * 60 * 60 * 1000));
const paidConfirmTrackerPath = path.join('/tmp', 'paid_confirm_tracker.json');
let paidTracker = {};
try {
  if (fs.existsSync(paidConfirmTrackerPath)) {
    paidTracker = JSON.parse(fs.readFileSync(paidConfirmTrackerPath, 'utf8'));
  }
} catch { /* noop */ }
function savePaidTracker() {
  try {
    fs.writeFileSync(paidConfirmTrackerPath, JSON.stringify(paidTracker, null, 2));
  } catch { /* noop */ }
}
function wasRecentlyConfirmed(shopId, eventId) {
  if (!shopId) return false;
  const rec = paidTracker[shopId];
  if (!rec) return false;
  const fresh = (Date.now() - (rec.at ?? 0)) < PAID_CONFIRM_TTL_MS;
  // Same eventId within TTL -> duplicate
  return fresh && rec.eventId === eventId;
}
function markConfirmed(shopId, eventId) {
  paidTracker[shopId] = { at: Date.now(), eventId };
  savePaidTracker();
}

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
// --- Resolve webhook path robustly (treat literal "" as empty and fallback) ---
const _rawWebhookPath = process.env.PAID_WEBHOOK_PATH;
let PAID_WEBHOOK_PATH_RESOLVED = (_rawWebhookPath || '/api/payment-webhook').trim();
if (PAID_WEBHOOK_PATH_RESOLVED === '""' || PAID_WEBHOOK_PATH_RESOLVED === '') {
  PAID_WEBHOOK_PATH_RESOLVED = '/api/payment-webhook';
}

// =============================================================================
// ==== Razorpay Payment Webhook (white-label, secure HMAC verification)  ======

// =============================================================================
// Mount RAW body handler for this route so we can verify signature on bytes
app.post(
  PAID_WEBHOOK_PATH_RESOLVED,
  bodyParser.raw({ type: '*/*' }), // raw body ONLY for this route
  async (req, res) => {
    const requestId = req.requestId;
    try {
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error(`[${requestId}] Missing RAZORPAY_WEBHOOK_SECRET`);
        return res.sendStatus(500);
      }

      // Signature header name used by Razorpay (case-insensitive)
      const signatureHeader =
        req.get('X-Razorpay-Signature') || req.get('x-razorpay-signature');
      if (!signatureHeader) {
        console.warn(`[${requestId}] Razorpay webhook missing signature header`);
        return res.sendStatus(400);
      }

      // Ensure we have a Buffer for HMAC (guard against prior JSON parsing)
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

      // Razorpay uses HMAC-SHA256 for webhook signatures
      const computed = crypto.createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');
      if (computed !== signatureHeader) {
        console.warn(`[${requestId}] Razorpay webhook signature mismatch`);
        return res.sendStatus(403);
      }

      console.log(
        `[${requestId}] Razorpay webhook: path=${PAID_WEBHOOK_PATH_RESOLVED} signature OK`
      );

      // ---- ACK EARLY to stop Razorpay retries (process async) ----
      // Razorpay treats non-2xx or >5s as failure and retries for ~24h. Early 200 prevents duplicates.
      // We continue processing below in setImmediate().
      res.status(200).json({ ok: true });
      // ----------------------------------------------------------------

      setImmediate(async () => {
        let payload;
        try {
          payload = JSON.parse(rawBody.toString('utf8'));
        } catch {
          const qs = require('querystring');
          payload = qs.parse(rawBody.toString('utf8'));
        }

        // ==== Razorpay payload mapping ====
        const entity = payload?.payload?.payment?.entity || {};
        const status = String(entity.status || '').toLowerCase();
        const notes = entity.notes || {};

        // Razorpay's unique event ID (recommended for idempotency)
        const razorEventId =
          req.get('x-razorpay-event-id') ||
          req.get('X-Razorpay-Event-Id') ||
          payload?.event || // fallback if header missing
          crypto.createHash('sha256').update(rawBody).digest('hex'); // last resort: body hash

        const buyerPhone = String(entity.contact || '').trim(); // payer-entered phone

        // Canonicalize shopId (digits only; strip +91/91/leading zeros)
        const canon = s => {
          const d = String(s || '').replace(/\D+/g, '');
          return d.startsWith('91') && d.length >= 12 ? d.slice(2) : d.replace(/^0+/, '');
        };
        const rawNotesShopId = String(notes.shopId || '').trim();
        const resolvedCanon = canon(rawNotesShopId) || canon(buyerPhone);

        console.log(
          `[${requestId}] Razorpay webhook raw: notes.shopId="${rawNotesShopId}" ` +
          `contact="${buyerPhone}" → resolved canon=${resolvedCanon}`
        );

        const shopId = resolvedCanon;
        if (!shopId) {
          console.warn(`[${requestId}] Razorpay webhook: missing shopId/contact`);
          return; // already 200-ACKed; just stop processing
        }

        // Build E.164 WhatsApp 'From' for Twilio: whatsapp:+91XXXXXXXXXX
        const toE164 = (canon10) => {
          const d = String(canon10 || '').replace(/\D+/g, '');
          const c = d.startsWith('91') && d.length >= 12 ? d.slice(2) : d.replace(/^0+/, '');
          return `+91${c}`;
        };
        const fromWhatsApp = `whatsapp:${toE164(shopId)}`;
        console.log(`[${requestId}] WhatsApp paid confirm target=${fromWhatsApp}`);

        // ---- Idempotency Guard: suppress duplicates within TTL ----
        if (wasRecentlyConfirmed(shopId, razorEventId)) {
          console.log(
            `[${requestId}] [paid-confirm] suppressed duplicate for shop=${shopId} event=${razorEventId}`
          );
          return;
        }

        // record event (audit)
        try {
          await recordPaymentEvent({
            shopId,
            // Razorpay sends amount in paise
            amount:
              (typeof entity.amount === 'number'
                ? entity.amount
                : Number(entity.amount || 0)) / 100,
            status,
            gateway: 'razorpay',
            payload
          });
        } catch (e) {
          console.warn(
            `[${requestId}] recordPaymentEvent (razorpay) failed: ${e?.message}`
          );
        }

        // Mark paid on successful statuses
        if (
          status === 'captured' ||
          status === 'authorized' ||
          status === 'success' ||
          status === 'successful' ||
          status === 'credit'
        ) {
          const r = await markAuthUserPaid(shopId);
          console.log(`[${requestId}] markAuthUserPaid(${shopId}) ->`, r);
          if (!r?.success) {
            console.error(
              `[${requestId}] markAuthUserPaid failed: ${r?.error}`
            );
            // We already ACKed; just stop processing here
            return;
          }
                              
          // Optional: set onboarding state for paid-capture (best effort)
          try { await setUserState(shopId, 'onboarding_paid_capture'); } catch (_) {}
          // Non-blocking WhatsApp confirmation (once-only) + name prompt (once-only)
          try {                                
          const wa = whatsappHandler; // reuse the module you already required at top
                    // Resolve user preferred language (fallback to 'en')
                    let lang = 'en';
                    try {
                      const pref = await getUserPreference(shopId);
                      if (pref?.success && pref.language) {
                        lang = String(pref.language).toLowerCase();
                      }
                    } catch (_) {}
                    if (wa && typeof wa.sendPaidConfirmationOnce === 'function') {
                      // Prefer the once-only confirmation sender
                      await wa.sendPaidConfirmationOnce(
                        fromWhatsApp,
                        lang,
                        r.paidStart ?? new Date().toISOString(),
                        req.requestId
                      );
                      // Then prompt for shop name once-only
                      if (typeof wa.sendOnboardNamePromptOnce === 'function') {
                        await wa.sendOnboardNamePromptOnce(fromWhatsApp, lang);
                      }
                      markConfirmed(shopId, razorEventId);
                    } else if (wa && typeof wa.sendWhatsAppPaidConfirmation === 'function') {
                      // Back-compat: fall back to the older sender if once-only is not exported yet
                      await wa.sendWhatsAppPaidConfirmation(fromWhatsApp);
                      markConfirmed(shopId, razorEventId);
                    } else {
                      // Last-resort fallback: Twilio direct send
                      try {
                        const twilio = require('twilio')(
                          process.env.ACCOUNT_SID,
                          process.env.AUTH_TOKEN
                        );
                        const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER; // e.g., 'whatsapp:+14155238886'
                        if (!WHATSAPP_NUMBER) {
                          console.warn(
                            `[${requestId}] Twilio fallback skipped: WHATSAPP_NUMBER env not set`
                          );
                        } else {
                          await twilio.messages.create({
                            from: WHATSAPP_NUMBER,
                            to: fromWhatsApp,
                            body:
                              '✅ Your Saamagrii.AI Paid Plan is now active. Enjoy full access!',
                          });
                          markConfirmed(shopId, razorEventId);
                        }
                      } catch (twErr) {
                        console.warn(
                          `[${requestId}] Twilio fallback paid confirm failed: ${twErr?.message}`
                        );
                      }
                    }
          } catch (e) {
            console.warn(
              `[${requestId}] WhatsApp paid confirm (razorpay) failed: ${e?.message}`
            );
          }
        } else {
          console.log(
            `[${requestId}] Razorpay webhook received non-capture status: ${status}`
          );
        }

        // already ACKed — just finish the async handler
        return;
      }); // <-- end setImmediate callback

      // Outer try: we already ACKed; simply return.
      return;
    } catch (err) {
      // Outer catch: we already ACKed; log and return.
      console.error(`[${requestId}] Razorpay webhook error:`, err.message);
      return;
    }
  }
);


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
           
    // ===== [PATCH:PRICES-SHOP-SCOPE-SERVER-001] BEGIN =====
        // Optional shop scoping via ?shopId=whatsapp:+91XXXXXXXXXX or +91XXXXXXXXXX or 10-digit
        const rawShopId = (req.query.shopId ?? '').toString().trim();
        const canon = s => {
          const d = String(s ?? '').replace(/\D+/g, '');
          return d.startsWith('91') && d.length >= 12 ? d.slice(2) : d;
        };
        const shopId = rawShopId ? `+91${canon(rawShopId)}` : null;
        const products = await getProductsNeedingPriceUpdate(shopId);
        // ===== [PATCH:PRICES-SHOP-SCOPE-SERVER-001] END =====
    
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
    // ===== [PATCH:PRICES-REMINDER-SERVER-003] BEGIN =====
        const rawShopId = (req.query.shopId ?? req.body?.shopId ?? '').toString().trim();
        const canon = s => {
          const d = String(s ?? '').replace(/\D+/g, '');
          return d.startsWith('91') && d.length >= 12 ? d.slice(2) : d;
        };
        const shopId = rawShopId ? `+91${canon(rawShopId)}` : null;
        // If your DB layer supports a scoped variant, prefer it; else fall back to global.
        const runner = typeof sendPriceUpdateReminders === 'function'
          ? (shopId ? () => sendPriceUpdateReminders(shopId) : () => sendPriceUpdateReminders())
          : async () => {
              // Minimal fallback: no-op or log if function missing.
              console.warn('[price-reminders] sendPriceUpdateReminders() not available');
            };
        runner()
        // ===== [PATCH:PRICES-REMINDER-SERVER-003] END =====

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

// =========================
// Dashboard filters support
// =========================
// Helper: normalize shop meta and match query filters
function normalizeShopMeta(details) {
  // Adjust these keys if your Airtable uses different names
  const state   = (details.state   || details.State   || details.fields?.State   || '').trim();
  const city    = (details.city    || details.City    || details.fields?.City    || '').trim();
  const segment = (details.segment || details.Segment || details.fields?.Segment || '').trim();
  const shopId  = (details.shopId  || details.ShopId  || details.fields?.ShopId  || details.id || '').toString();
  const shopName= (details.shopName|| details['Shop Name'] || details.fields?.['Shop Name'] || '').trim();
  return { state, city, segment, shopId, shopName };
}
function matchesFilter(meta, q) {
  if (q.state   && meta.state.toLowerCase()   !== String(q.state).toLowerCase()) return false;
  if (q.city    && meta.city.toLowerCase()    !== String(q.city).toLowerCase()) return false;
  if (q.segment && meta.segment.toLowerCase() !== String(q.segment).toLowerCase()) return false;
  if (q.shopId  && meta.shopId.toString()     !== String(q.shopId)) return false;
  return true;
}
async function shopMetaMap(shopIds) {
  const map = new Map();
  for (const id of shopIds) {
    try {
      const d = await getShopDetails(id);
      if (d?.success && d.shopDetails) {
        map.set(id, normalizeShopMeta({ ...d.shopDetails, shopId: id }));
      } else {
        map.set(id, normalizeShopMeta({ shopId: id })); // minimal
      }
    } catch {
      map.set(id, normalizeShopMeta({ shopId: id }));
    }
  }
  return map;
}
// Endpoint to fetch distinct filter options
app.get('/api/dashboard/filters', async (req, res) => {
  try {
    const shopIds = await getAllShopIDs();
    const metas = await shopMetaMap(shopIds);
    const states  = new Set(), cities = new Set(), segments = new Set();
    for (const m of metas.values()) {
      if (m.state)   states.add(m.state);
      if (m.city)    cities.add(m.city);
      if (m.segment) segments.add(m.segment);
    }
    res.json({ states: [...states].sort(), cities: [...cities].sort(), segments: [...segments].sort(), shopCount: shopIds.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



// =========================
// Dashboards (JSON APIs)
// =========================
// These endpoints power dashboard.html/js in /public.
// Front-end calls:
//  - /api/dashboard/summary?period=today|week|month
//  - /api/dashboard/top-products?period=today|week|month&limit=10
//  - /api/dashboard/low-stock?limit=50
//  - /api/dashboard/expiring?days=30
//  - /api/dashboard/reorder
//  - /api/dashboard/prices/stale?page=1

function periodWindow(period) {
  const now = new Date();
  const p = String(period || 'month').toLowerCase();
  if (p === 'today' || p === 'day') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { start, end, label: 'today' };
  }
  if (p.includes('week')) {
    const start = new Date(now); start.setDate(now.getDate() - 7);
    return { start, end: now, label: 'week' };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start, end: now, label: 'month' };
}
const toNum = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

async function aggregateSales(periodKey) {
  const { start, end } = periodWindow(periodKey);
  const shopIds = await getAllShopIDs(); // from your DB layer
  const meta = await shopMetaMap(shopIds);
  let totalItems = 0, totalValue = 0;
  const topMap = new Map(); // name -> { quantity, unit }
  const CONC = 5; // mild concurrency to respect Airtable limits

  for (let i = 0; i < shopIds.length; i += CONC) {
    const batch = shopIds.slice(i, i + CONC);
    await Promise.all(batch.map(async (shopId) => {           
      const m = meta.get(shopId) || normalizeShopMeta({ shopId });
      if (!matchesFilter(m, q)) return;
      const data = await getSalesDataForPeriod(shopId, start, end);
      totalItems += toNum(data.totalItems);
      totalValue += toNum(data.totalValue);
      for (const p of (data.topProducts || [])) {
        const prev = topMap.get(p.name) || { quantity: 0, unit: p.unit };
        prev.quantity += toNum(p.quantity);
        prev.unit = p.unit || prev.unit;
        topMap.set(p.name, prev);
      }
    }));
    // tiny pause to be gentle with Airtable API limits
    await new Promise(r => setTimeout(r, 250));
  }
  const top = Array.from(topMap.entries())
    .map(([name, v]) => ({ name, quantity: v.quantity, unit: v.unit }))
    .sort((a,b) => b.quantity - a.quantity)
    .slice(0, 10);
  return { totalItems, totalValue, top };
}

// KPI summary (network-wide)
app.get('/api/dashboard/summary', async (req, res) => {
  try {     
    const { period = 'month', state, city, segment, shopId } = req.query;
    const agg = await aggregateSales(period, { state, city, segment, shopId });
    res.json({ period, ...agg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Top products (network-wide)
app.get('/api/dashboard/top-products', async (req, res) => {
  try {
    const { period = 'month', state, city, segment, shopId } = req.query;
    const limit = Math.max(1, Number(req.query.limit || 10));
    const agg = await aggregateSales(period, { state, city, segment, shopId });
    res.json({ period, items: agg.top.slice(0, limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Low stock (network-wide, dedup by product name)
app.get('/api/dashboard/low-stock', async (req, res) => {
  try {
    const limit = Math.max(1, Number(req.query.limit || 50));
    const shopIds = await getAllShopIDs();        
    const { state, city, segment, shopId } = req.query;
    const meta = await shopMetaMap(shopIds);
    const items = [];
    for (const shopId of shopIds) {           
      const m = meta.get(sid) || normalizeShopMeta({ shopId: sid });
      if (!matchesFilter(m, { state, city, segment, shopId })) continue;
      const low = await getLowStockProducts(shopId, 5);
      for (const p of low) {
        items.push({
          name: p.name || p.fields?.Product,
          quantity: toNum(p.quantity ?? p.fields?.Quantity),
          unit: p.unit || p.fields?.Units || 'pieces',                    
          shopId: sid,
          state: m.state, city: m.city, segment: m.segment
        });
      }
    }
    // Deduplicate by name (pick strictest qty)
    const pick = new Map();
    for (const r of items) {
      const k = String(r.name).toLowerCase();
      const prev = pick.get(k);
      if (!prev || r.quantity < prev.quantity) pick.set(k, r);
    }
    res.json({ items: Array.from(pick.values()).slice(0, limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Expiring (network-wide)
app.get('/api/dashboard/expiring', async (req, res) => {
  try {
    const days = Math.max(0, Number(req.query.days || 30));
    const shopIds = await getAllShopIDs();        
    const { state, city, segment, shopId } = req.query;
    const meta = await shopMetaMap(shopIds);
    const items = [];        
    for (const sid of shopIds) {
          const m = meta.get(sid) || normalizeShopMeta({ shopId: sid });
          if (!matchesFilter(m, { state, city, segment, shopId })) continue;
          const exp = await getExpiringProducts(sid, days);
    for (const p of exp) {
        items.push({
          name: p.name,
          quantity: toNum(p.quantity),
          expiryDate: p.expiryDate,                    
          displayDate: p.expiryDate,
          shopId: sid,
          state: m.state, city: m.city, segment: m.segment
        });
      }
    }
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reorder suggestions (30d velocity, lead=3, safety=2)
app.get('/api/dashboard/reorder', async (req, res) => {
  try {
    const shopIds = await getAllShopIDs();        
    const { state, city, segment, shopId } = req.query;
    const meta = await shopMetaMap(shopIds);
    const items = [];        
    for (const sid of shopIds) {
          const m = meta.get(sid) || normalizeShopMeta({ shopId: sid });
          if (!matchesFilter(m, { state, city, segment, shopId })) continue;
          const { success, suggestions } =
            await getReorderSuggestions(sid, { days: 30, leadTimeDays: 3, safetyDays: 2 });
      if (!success) continue;
      for (const s of suggestions) {
        items.push({
          name: s.name,
          unit: s.unit,
          currentQty: toNum(s.currentQty),
          dailyRate: toNum(s.dailyRate),
          reorderQty: toNum(s.reorderQty),                    
          shopId: sid,
          state: m.state, city: m.city, segment: m.segment
        });
      }
    }
    items.sort((a,b) => (b.reorderQty - a.reorderQty) || (b.dailyRate - a.dailyRate));
    res.json({ items: items.slice(0, 100) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stale prices (global backlog, paged)
app.get('/api/dashboard/prices/stale', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const PAGE_SIZE = 50;        
    // ===== [PATCH:PRICES-SHOP-SCOPE-SERVER-002] BEGIN =====
        // Optional filters: shopId query to scope the stale list
        const rawShopId = (req.query.shopId ?? '').toString().trim();
        const canon = s => {
          const d = String(s ?? '').replace(/\D+/g, '');
          return d.startsWith('91') && d.length >= 12 ? d.slice(2) : d;
        };
        const shopId = rawShopId ? `+91${canon(rawShopId)}` : null;
        const list = await getProductsNeedingPriceUpdate(shopId);
        // ===== [PATCH:PRICES-SHOP-SCOPE-SERVER-002] END =====
    const start = (page - 1) * PAGE_SIZE;
    const slice = list.slice(start, start + PAGE_SIZE).map(it => ({
      name: it.name,
      currentPrice: toNum(it.currentPrice),
      unit: it.unit || 'pieces',
      lastUpdated: it.lastUpdated
    }));
    res.json({ page, total: list.length, items: slice });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Add this endpoint to your server.js file
app.post('/api/enroll', async (req, res) => {
  const requestId = req.requestId;
  
  try {
    console.log(`[${requestId}] Processing enrollment form submission`);
    
    const { mobile, shopName, state, country } = req.body;
    
    // Validate required fields
    if (!mobile || !shopName || !state || !country) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'All fields are required'
      });
    }
    
    // Create record in Airtable
    const Airtable = require('airtable');
    const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
    const tableName = 'Enrollments'; // Change this to your actual table name
    
    const record = await base(tableName).create([
      {
        "fields": {
          "Mobile": mobile,
          "Shop Name": shopName,
          "State": state,
          "Country": country,
          "Submission Date": new Date().toISOString()
        }
      }
    ]);
    
    console.log(`[${requestId}] Enrollment record created with ID: ${record[0].getId()}`);
    
    res.status(201).json({
      success: true,
      message: 'Enrollment submitted successfully',
      recordId: record[0].getId(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[${requestId}] Error processing enrollment:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to submit enrollment',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

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
  scheduled: false,
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
  console.log('[fast-classifier-gate]', String(process.env.ENABLE_FAST_CLASSIFIER ?? ''));
  console.log('[fast-classifier-timeout-ms]', Number(process.env.FAST_CLASSIFIER_TIMEOUT_MS ?? 1200));
  console.log('[use-ai-orchestrator]', String(process.env.USE_AI_ORCHESTRATOR ?? ''));
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
