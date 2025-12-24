const { SpeechClient } = require('@google-cloud/speech').v2;
const fs = require('fs');

const client = new SpeechClient();

// Parse STT_LANG_CODES env (comma-separated, no spaces)
function parseLangCatalog() {
  const raw = String(process.env.STT_LANG_CODES ?? 'en-IN,hi-IN,bn-IN').trim();
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Pick up to 3 languages per request (Google limit), using context:
// 1) user preferred language (if known)
// 2) last detected text language (if provided)
// 3) fallbacks from catalog (English-IN + Hindi-IN + Bengali-IN by default)
function pickLanguageCandidates(prefLang, lastTextLang, catalog) {
  const uniq = new Set();
  const push = (code) => { if (code && !uniq.has(code)) uniq.add(code); };
  push(prefLang);
  push(lastTextLang);
  // opinionated defaults
  push('en-IN'); push('hi-IN'); push('bn-IN');
  // fill from catalog
  for (const c of catalog) push(c);
  return Array.from(uniq).slice(0, 3); // <= 3 per request  [1](https://deepwiki.com/googleapis/google-cloud-node/4.2-speech-to-text-client)
}

/**
 * Transcribe WhatsApp voice note with Google STT v2.
 * @param {Buffer|string} input - Buffer or file path of audio.
 * @param {object} opts
 * @param {string} [opts.prefLang]      - user's stored preference (e.g., 'hi-IN')
 * @param {string} [opts.lastTextLang]  - last detected language from a text turn
 * @returns {{text:string, language:string}}
 */
async function transcribeWhatsAppVoice(input, opts = {}) {
  const region = String(process.env.STT_REGION ?? 'global').trim();     // recognizer location  [2](https://articles.speakatoo.com/speech-to-text-in-indian-languages-a-complete-guide-for-2025/)
  const model  = String(process.env.STT_MODEL ?? 'short').trim();       // 'short'|'long'|...   [3](https://ai-labs.olakrutrim.com/models/IndicST-Dataset)
  const denoiser = String(process.env.STT_ENABLE_DENOISER ?? 'false').toLowerCase() === 'true';

  const catalog = parseLangCatalog();
  const langCodes = pickLanguageCandidates(opts.prefLang, opts.lastTextLang, catalog);

  const content = Buffer.isBuffer(input) ? input : fs.readFileSync(input);

  const config = {
    // v2 auto-detects sample rate, channels, and encoding (OGG_OPUS/WAV/FLAC etc.).  [2](https://articles.speakatoo.com/speech-to-text-in-indian-languages-a-complete-guide-for-2025/)
    autoDecodingConfig: {},
    languageCodes: langCodes,
    model,
    features: {
      enableAutomaticPunctuation: true,
      diarizationConfig: { enableSpeakerDiarization: true },            // multi-speaker shops  [4](blob:https://m365.cloud.microsoft/db8d53e9-4df0-4e3e-8e2a-0243c05f53f7)
      ...(denoiser ? { denoiserConfig: { enableDenoiser: true } } : {}) // noise robustness     [4](blob:https://m365.cloud.microsoft/db8d53e9-4df0-4e3e-8e2a-0243c05f53f7)
    }
  };

  const request = {
    recognizer: `projects/${process.env.GCP_PROJECT}/locations/${region}/recognizers/_`,
    config,
    content
  };

  const response = await client.recognize(request);
  const result   = response.results?.[0];
  const text     = (result?.alternatives?.[0]?.transcript ?? '').trim();
  const language = result?.languageCode ?? (langCodes[0] ?? 'en-IN');
  return { text, language };
}

module.exports = { transcribeWhatsAppVoice, parseLangCatalog, pickLanguageCandidates };
