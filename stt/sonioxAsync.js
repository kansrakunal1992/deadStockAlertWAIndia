
// stt/sonioxAsync.js
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

/**
 * Transcribe a local audio file using Soniox REST API.
 * @param {string} filePath - path to local audio (ogg/wav/mp3…)
 * @param {object} opts - { languageHints: ['hi'], languageHintsStrict: true, model: 'stt-async-preview' }
 * @returns {Promise<{text:string, tokens?:Array, language?:string}>}
 */
async function transcribeFileWithSoniox(filePath, opts = {}) {
  const apiKey = process.env.SONIOX_API_KEY;
  if (!apiKey) throw new Error('SONIOX_API_KEY is missing');

  // 1) Upload file
  const uploadUrl = 'https://api.soniox.com/v1/files'; // Files API
  const fd = new FormData();
  fd.append('file', fs.createReadStream(filePath));

  const up = await axios.post(uploadUrl, fd, {
    headers: { Authorization: `Bearer ${apiKey}`, ...fd.getHeaders() },
    timeout: 60000
  });

  const fileId = up.data?.id;
  if (!fileId) throw new Error('Soniox upload failed');

  // 2) Create transcription job
  const jobUrl = 'https://api.soniox.com/v1/transcriptions';
  const model = opts.model || process.env.SONIOX_ASYNC_MODEL || 'stt-async-preview';
  const language_hints = opts.languageHints || (process.env.SONIOX_LANGUAGE_HINTS ? process.env.SONIOX_LANGUAGE_HINTS.split(',') : []);
  const language_hints_strict = typeof opts.languageHintsStrict === 'boolean'
    ? opts.languageHintsStrict
    : (process.env.SONIOX_LANGUAGE_HINTS_STRICT === '1');

  const job = await axios.post(jobUrl, {
    file_id: fileId,
    model,
    language_hints,
    language_hints_strict
  }, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 30000
  });

  const transcriptionId = job.data?.id;
  const statusUrl = `${jobUrl}/${transcriptionId}`;

  // 3) Poll status until done
  let done = false, text = '';
  for (let i = 0; i < 40 && !done; i++) {
    const s = await axios.get(statusUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000
    });
    const st = (s.data?.status || '').toLowerCase();
    if (st === 'completed') {
      text = s.data?.text || '';
      done = true;
    } else if (st === 'failed') {
      throw new Error(`Soniox transcription failed: ${s.data?.error || 'unknown'}`);
    } else {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  return { text };
}

module.exports = { transcribeFileWithSoniox };
