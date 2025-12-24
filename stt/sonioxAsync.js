// stt/sonioxAsync.js
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

/**
 * Transcribe a local audio file using Soniox REST API.
* @param {string} filePath - path to local audio (ogg/wav/mp3…)
 * @param {object} opts - { languageHints: ['hi'], languageHintsStrict: true, model: 'stt-async-v3' }
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
  const model = opts.model || process.env.SONIOX_ASYNC_MODEL || 'stt-async-v3'; // async v3 is current. cite
    const language_hints = Array.isArray(opts.languageHints)
      ? opts.languageHints
      : (process.env.SONIOX_LANGUAGE_HINTS
          ? process.env.SONIOX_LANGUAGE_HINTS.split(',').map(s => s.trim()).filter(Boolean)
          : []);
    const language_hints_strict =
      typeof opts.languageHintsStrict === 'boolean'
        ? opts.languageHintsStrict
        : (process.env.SONIOX_LANGUAGE_HINTS_STRICT === '1');
  
    // Build payload (async v3: DO NOT include language_hints_strict — it triggers 400). cite
    const payload = { file_id: fileId, model };
    if (language_hints && language_hints.length > 0) payload.language_hints = language_hints;
    // Include strict restriction ONLY for real-time models (e.g., stt-rt-v3). cite
    if (/^stt-rt/.test(model) && language_hints_strict === true) {
      payload.language_hints_strict = true;
    }
  
    const job = await axios.post(jobUrl, payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8'
      },
      timeout: 30000,
      validateStatus: (s) => s >= 200 && s < 300
    });

  const transcriptionId = job.data?.id;
  const statusUrl = `${jobUrl}/${transcriptionId}`;
  const transcriptUrl = `${jobUrl}/${transcriptionId}/transcript`; // text is returned here for async

  // 3) Poll status until done
  let done = false, text = '';
  for (let i = 0; i < 40 && !done; i++) {          
      const s = await axios.get(statusUrl, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
            timeout: 10000
          });
    const st = (s.data?.status || '').toLowerCase();
    if (st === 'completed') {           
      // Fetch transcript text from the transcript endpoint (not in status response). cite
            const t = await axios.get(transcriptUrl, {
              headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
              timeout: 10000
            });
            text = t.data?.text || '';
      done = true;        
    } else if (st === 'error' || st === 'failed') {
         const msg = s.data?.error_message || s.data?.error || 'unknown';
         throw new Error(`Soniox transcription failed: ${msg}`);
    } else {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  return { text };
}

module.exports = { transcribeFileWithSoniox };
