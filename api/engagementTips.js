// api/engagementTips.js
// Multilingual Engagement Tips (send while long replies are processing)

const DEFAULT_FIRST_DELAY_MS = Number(process.env.TIP_FIRST_DELAY_MS || 10000);  // 10s
const DEFAULT_INTERVAL_MS    = Number(process.env.TIP_INTERVAL_MS    || 990000);  // 990s
const DEFAULT_MAX_COUNT      = Number(process.env.TIP_MAX_COUNT      || 1);      // avoid spam

// Short, useful business/inventory tips (localized at send-time)
const BUSINESS_TIPS_EN = [
  "💡 Helpful tip: Focus on your top sellers: ABC analysis helps the top 20% SKUs drive 80% revenue. Generating response...",
  "🔔 Helpful tip: Prevent stockouts: set automated reorder alerts for fast-movers. Generating response...",
  "📋 Helpful tip: Do small cycle counts weekly—fewer surprises, better accuracy. Generating response...",
  "🧩 Helpful tip: Bundle slow movers with best-sellers to clear stock without deep discounts. Generating response...",
  "🧭 Helpful tip: Unify online+offline inventory data to avoid overselling. Generating response...",
  "🎯 Helpful tip: Break big goals into weekly targets—it’s easier to track and win. Generating response...",
  "🧰 Helpful tip: Systemize repeat tasks so new staff can follow the same playbook. Generating response...",
  "🤝 Helpful tip: Keep communication clear—customers return when updates are transparent. Generating response...",
  "🚚 Helpful tip: Review supplier lead times—adjust safety stock for volatility. Generating response...",
  "🧾 Helpful tip: Track margins by category; invest where ROI is consistent. Generating response...",
  "🪙 Helpful tip: Cash is oxygen: trim dead stock to free up working capital. Generating response...",
  "🧠 Helpful tip: Forecast from recent velocity (e.g., 30/60/90d) + seasonality for smarter reorders. Generating response..."
];

// Per-request tip loop state
const tipLoops = new Map(); // requestId -> { timer, interval, count, canceled, cfg, localized }

function startEngagementTips({
  From,
  language = 'en',
  requestId,
  tips = BUSINESS_TIPS_EN,
  firstDelayMs = DEFAULT_FIRST_DELAY_MS,
  intervalMs   = DEFAULT_INTERVAL_MS,
  maxCount     = DEFAULT_MAX_COUNT,
  // dependency injection from whatsapp.js
  sendMessage,   // (to, body) => Promise
  translate,     // (text, lang, reqId) => Promise<string>
}) {
  if (!From || !requestId) return () => {};
  if (tipLoops.has(requestId)) return () => stopEngagementTips(requestId);

  const state = {
    canceled: false,
    count: 0,
    cfg: { From, language, requestId, tips, firstDelayMs, intervalMs, maxCount, sendMessage, translate },
    timer: null,
    interval: null,
    localized: null
  };
  tipLoops.set(requestId, state);

  // Pre-translate all tips once per request to avoid per-tick latency
  (async () => {
    try {
      state.localized = await Promise.all(
        tips.map(t => translate(t, language, requestId + ':tip'))
      );
    } catch {
      state.localized = tips.slice(); // fallback EN
    }
  })();

  const sendNext = async () => {
    if (state.canceled) return;
    if (state.count >= state.cfg.maxCount) return stopEngagementTips(requestId);
    const arr = state.localized?.length ? state.localized : state.cfg.tips;
    const tip = arr[state.count % arr.length];
    try { await state.cfg.sendMessage(state.cfg.From, tip); }
    catch (e) { console.warn(`[${state.cfg.requestId}] tip send failed:`, e?.message); }
    state.count++;
  };

  // First tip after delay (skipped if final reply completes faster)
  
  state.timer = setTimeout(async () => {
      if (state.canceled) return;
      await sendNext();
      // No interval loop; single tip only.
    }, state.cfg.firstDelayMs);

  try { state.timer.unref?.(); } catch {}
  try { state.interval?.unref?.(); } catch {}

  return () => stopEngagementTips(requestId);
}

function stopEngagementTips(requestId) {
  const s = tipLoops.get(requestId);
  if (!s) return;
  s.canceled = true;
  try { if (s.timer)    clearTimeout(s.timer); } catch {}
  try { if (s.interval) clearInterval(s.interval); } catch {}
  tipLoops.delete(requestId);
}

async function withEngagementTips(cfg, fn) {
  const stop = startEngagementTips(cfg);
  try { return await fn(); }
  finally { stop(); }
}

module.exports = {
  BUSINESS_TIPS_EN,
  startEngagementTips,
  stopEngagementTips,
  withEngagementTips
};
