// Language combo adapter for Soniox + UI
// Keeps language codes exact (e.g., 'hi' or 'hi-latn'), maps to Soniox hints,
// and provides helpers to stabilize UI language/script across turns.

const SUPPORTED_BASE = new Set(['hi','bn','ta','te','kn','mr','gu','en']);

function normalizeLangExact(lang) {
  const L = String(lang || 'en').toLowerCase();
  const m = L.match(/^([a-z]{2})(-latn)?$/);
  if (!m) return 'en';
  const base = m[1];
  const latn = !!m[2];
  return SUPPORTED_BASE.has(base) ? (latn ? `${base}-latn` : base) : 'en';
}

// Map exact language (incl. -latn) to Soniox async language_hints.
// For *-latn (romanized/hinglish), hint 'en' to prefer Latin script tokens.
function toSonioxHints(langExact) {
  const L = normalizeLangExact(langExact);
  if (L.endsWith('-latn')) return ['en'];
  const base = L;
  return [base];
}

// Decide if we should disable language identification in async mode:
// when we have a single, known hint, LID off reduces drift into other languages.
function shouldDisableLID(hints) {
  return Array.isArray(hints) && hints.length === 1;
}

// Choose UI language: pinned takes priority; otherwise detected language.
// Avoid downgrading pinned non-English to 'en' mid-turn unless user explicitly switches.
function chooseUiLanguage(pinned, detected, explicitSwitch = false) {
  const P = normalizeLangExact(pinned);
  const D = normalizeLangExact(detected);
  if (P !== 'en' && D === 'en' && !explicitSwitch) return P;
  return P || D || 'en';
}

module.exports = {
  normalizeLangExact,
  toSonioxHints,
  shouldDisableLID,
  chooseUiLanguage,
};
