// Adjust these imports to your project:
// For PostgreSQL (pg):   const { pool } = require('./db'); // pg Pool
// For MySQL (mysql2):    const { pool } = require('./db'); // mysql2 Pool
const { pool } = require('./db');
const DIALECT = (process.env.DB_DIALECT || 'postgres').toLowerCase(); // 'postgres' | 'mysql'

/**
 * Append one conversation turn (user_text, ai_text) for a shop.
 * @param {string} shopId
 * @param {string} userText
 * @param {string} aiText
 * @param {string|null} topicTag
 */
async function appendTurn(shopId, userText, aiText, topicTag = null) {
  if (DIALECT === 'postgres') {
    const sql = `INSERT INTO conversation_turns (shop_id, user_text, ai_text, topic_tag)
                 VALUES ($1, $2, $3, $4)`;
    await pool.query(sql, [shopId, String(userText || ''), String(aiText || ''), topicTag]);
  } else {
    const sql = `INSERT INTO conversation_turns (shop_id, user_text, ai_text, topic_tag)
                 VALUES (?, ?, ?, ?)`;
    await pool.execute(sql, [shopId, String(userText || ''), String(aiText || ''), topicTag]);
  }
}

/**
 * Get last N conversation turns for a shop (most recent first).
 * @param {string} shopId
 * @param {number} n
 * @returns {Promise<Array<{user_text:string, ai_text:string}>>}
 */
async function getRecentTurns(shopId, n = 3) {
  if (DIALECT === 'postgres') {
    const sql = `SELECT user_text, ai_text
                 FROM conversation_turns
                 WHERE shop_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2`;
    const { rows } = await pool.query(sql, [shopId, n]);
    return rows || [];
  } else {
    const sql = `SELECT user_text, ai_text
                 FROM conversation_turns
                 WHERE shop_id = ?
                 ORDER BY created_at DESC
                 LIMIT ?`;
    const [rows] = await pool.execute(sql, [shopId, n]);
    return rows || [];
  }
}

/**
 * Simple topic inference (optional)
 * Helps you tag turns for analytics or conditional prompts.
 */
function inferTopic(userText = '') {
  const t = String(userText || '').toLowerCase();
  if (/[₹]|price|pricing|cost|rate|मूल्य|कीमत/.test(t)) return 'pricing';
  if (/trial|free|मुफ़्त|फ्री/.test(t)) return 'trial';
  if (/benefit|why|क्यों|फायदा|मदद|help/.test(t)) return 'benefits';
  if (/how|कैसे|किस तरह/.test(t)) return 'how-it-works';
  return null;
}

module.exports = {
  appendTurn,
  getRecentTurns,
  inferTopic
};
