const LANG_NAMES = { it: 'Italiano', en: 'English', ja: '日本語' };
const MAX_CHARS = 500;

const sourceText = document.getElementById('source-text');
const inputCount = document.getElementById('input-count');
const translateBtn = document.getElementById('translate-btn');
const detectedLangPill = document.getElementById('detected-lang');
const targetLangPill = document.getElementById('target-lang');
const resultText = document.getElementById('result-text');
const resultCount = document.getElementById('result-count');
const copyBtn = document.getElementById('copy-btn');
const errorBanner = document.getElementById('error-banner');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const gaugeFill = document.getElementById('gauge-fill');
const gaugeLure = document.getElementById('gauge-lure');
const themeToggle = document.getElementById('theme-toggle');
const langToggle = document.getElementById('lang-toggle');
const langButtons = langToggle.querySelectorAll('.lang-btn');
const micBtn = document.getElementById('mic-btn');
const micLangSelect = document.getElementById('mic-lang');

// ---------------- Tema chiaro/scuro ----------------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('lenza-theme', theme);
}

(function initTheme() {
  const stored = localStorage.getItem('lenza-theme');
  if (stored) {
    applyTheme(stored);
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }
})();

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ---------------- Lingua di destinazione ----------------

let targetLang = localStorage.getItem('lenza-target-lang') || 'en';

function setTargetLang(lang) {
  targetLang = lang;
  localStorage.setItem('lenza-target-lang', lang);
  langButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.lang === lang));
  targetLangPill.textContent = LANG_NAMES[lang];
  targetLangPill.dataset.active = 'true';
}

langButtons.forEach((btn) => {
  btn.addEventListener('click', () => setTargetLang(btn.dataset.lang));
});

setTargetLang(targetLang);

// ---------------- Errori ----------------

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function hideError() {
  errorBanner.hidden = true;
  errorBanner.textContent = '';
}

// ---------------- Scandaglio caratteri ----------------

function updateGauge(chars) {
  const pct = Math.min(chars / MAX_CHARS, 1) * 100;
  const over = chars > MAX_CHARS;
  gaugeFill.style.height = pct + '%';
  gaugeFill.style.setProperty('--fill', pct + '%');
  gaugeFill.dataset.over = over ? 'true' : 'false';
  gaugeLure.style.top = (100 - pct) + '%';
  gaugeLure.style.left = pct + '%';
  gaugeLure.dataset.over = over ? 'true' : 'false';
}

const longInputHint = document.getElementById('long-input-hint');

sourceText.addEventListener('input', () => {
  const len = sourceText.value.length;
  inputCount.textContent = `${len} caratteri`;
  translateBtn.disabled = len === 0;
  longInputHint.hidden = len <= MAX_CHARS;
});

// ---------------- Traduzione ----------------

async function translate() {
  const text = sourceText.value.trim();
  if (!text) return;

  hideError();
  translateBtn.disabled = true;
  translateBtn.querySelector('.btn-label').textContent = 'Traduco…';

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, targetLang })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Errore durante la traduzione.');
    }

    detectedLangPill.textContent = LANG_NAMES[data.sourceLang] || data.sourceLang;
    detectedLangPill.dataset.active = 'true';
    setTargetLang(data.targetLang);

    resultText.textContent = data.translation;
    resultText.dataset.empty = 'false';
    resultCount.textContent = `${data.charCount} / ${MAX_CHARS} caratteri`;
    copyBtn.disabled = false;

    updateGauge(data.charCount);
    prependHistoryEntry(data);
  } catch (err) {
    console.error(err);
    showError(err.message || 'Qualcosa e\' andato storto. Riprova.');
  } finally {
    translateBtn.disabled = sourceText.value.trim().length === 0;
    translateBtn.querySelector('.btn-label').textContent = 'Traduci';
  }
}

translateBtn.addEventListener('click', translate);

sourceText.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    translate();
  }
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(resultText.textContent);
    const original = copyBtn.textContent;
    copyBtn.textContent = 'Copiato ✓';
    setTimeout(() => { copyBtn.textContent = original; }, 1400);
  } catch (err) {
    console.error('Copia non riuscita', err);
  }
});

// ---------------- Input vocale ----------------

let recognition = null;
let isListening = false;

function setupSpeechRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    micBtn.disabled = true;
    micBtn.title = 'Riconoscimento vocale non supportato da questo browser';
    return;
  }

  recognition = new Ctor();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    micBtn.dataset.recording = 'true';
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.dataset.recording = 'false';
  };

  recognition.onerror = (event) => {
    isListening = false;
    micBtn.dataset.recording = 'false';
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      showError('Riconoscimento vocale non riuscito. Riprova o digita il testo.');
    }
  };

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((r) => r[0].transcript)
      .join(' ')
      .trim();
    if (!transcript) return;

    const current = sourceText.value;
    const needsSpace = current && !/[\s\n]$/.test(current);
    sourceText.value = (current + (needsSpace ? ' ' : '') + transcript).slice(0, 2000);
    sourceText.dispatchEvent(new Event('input'));
  };
}

micBtn.addEventListener('click', () => {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
    return;
  }
  hideError();
  recognition.lang = micLangSelect.value;
  try {
    recognition.start();
  } catch (err) {
    console.error('Impossibile avviare il riconoscimento vocale', err);
  }
});

setupSpeechRecognition();

// ---------------- Storico ----------------

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function buildEntryNode(entry) {
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.dataset.id = entry.id;

  el.innerHTML = `
    <div class="log-meta">
      <span class="log-direction">${(entry.sourceLang || '').toUpperCase()} → ${(entry.targetLang || '').toUpperCase()}</span>
      <span class="log-time">${formatTime(entry.createdAt)}</span>
    </div>
    <div class="log-src">
      <span class="log-label">Originale</span>
      ${escapeHtml(entry.sourceText)}
    </div>
    <div class="log-tgt">
      <span class="log-label">Tradotto</span>
      ${escapeHtml(entry.translation)}
    </div>
    <button class="log-delete" title="Elimina voce" aria-label="Elimina voce">✕</button>
  `;

  el.querySelector('.log-delete').addEventListener('click', () => deleteHistoryEntry(entry.id, el));
  return el;
}

function prependHistoryEntry(entry) {
  historyEmpty.style.display = 'none';
  historyList.insertBefore(buildEntryNode(entry), historyList.firstChild);
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const entries = await res.json();
    historyList.innerHTML = '';
    if (!entries.length) {
      historyList.appendChild(historyEmpty);
      historyEmpty.style.display = 'block';
      return;
    }
    entries.forEach((entry) => historyList.appendChild(buildEntryNode(entry)));
  } catch (err) {
    console.error('Errore caricamento storico', err);
  }
}

async function deleteHistoryEntry(id, node) {
  try {
    await fetch(`/api/history/${id}`, { method: 'DELETE' });
    node.remove();
    if (!historyList.children.length) {
      historyList.appendChild(historyEmpty);
      historyEmpty.style.display = 'block';
    }
  } catch (err) {
    console.error('Errore eliminazione voce', err);
  }
}

clearHistoryBtn.addEventListener('click', async () => {
  if (!confirm('Svuotare tutto il registro delle traduzioni?')) return;
  try {
    await fetch('/api/history', { method: 'DELETE' });
    historyList.innerHTML = '';
    historyList.appendChild(historyEmpty);
    historyEmpty.style.display = 'block';
  } catch (err) {
    console.error('Errore svuotamento registro', err);
  }
});

// Init
updateGauge(0);
loadHistory();    applyTheme(prefersDark ? 'dark' : 'light');
  }
})();

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ---------------- Lingua di destinazione ----------------

let targetLang = localStorage.getItem('lenza-target-lang') || 'en';

function setTargetLang(lang) {
  targetLang = lang;
  localStorage.setItem('lenza-target-lang', lang);
  langButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.lang === lang));
  targetLangPill.textContent = LANG_NAMES[lang];
  targetLangPill.dataset.active = 'true';
}

langButtons.forEach((btn) => {
  btn.addEventListener('click', () => setTargetLang(btn.dataset.lang));
});

setTargetLang(targetLang);

// ---------------- Errori ----------------

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function hideError() {
  errorBanner.hidden = true;
  errorBanner.textContent = '';
}

// ---------------- Scandaglio caratteri ----------------

function updateGauge(chars) {
  const pct = Math.min(chars / MAX_CHARS, 1) * 100;
  const over = chars > MAX_CHARS;
  gaugeFill.style.height = pct + '%';
  gaugeFill.style.setProperty('--fill', pct + '%');
  gaugeFill.dataset.over = over ? 'true' : 'false';
  gaugeLure.style.top = (100 - pct) + '%';
  gaugeLure.style.left = pct + '%';
  gaugeLure.dataset.over = over ? 'true' : 'false';
}

const longInputHint = document.getElementById('long-input-hint');

sourceText.addEventListener('input', () => {
  const len = sourceText.value.length;
  inputCount.textContent = `${len} caratteri`;
  translateBtn.disabled = len === 0;
  longInputHint.hidden = len <= MAX_CHARS;
});

// ---------------- Traduzione ----------------

async function translate() {
  const text = sourceText.value.trim();
  if (!text) return;

  hideError();
  translateBtn.disabled = true;
  translateBtn.querySelector('.btn-label').textContent = 'Traduco…';

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, targetLang })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Errore durante la traduzione.');
    }

    detectedLangPill.textContent = LANG_NAMES[data.sourceLang] || data.sourceLang;
    detectedLangPill.dataset.active = 'true';
    setTargetLang(data.targetLang);

    resultText.textContent = data.translation;
    resultText.dataset.empty = 'false';
    resultCount.textContent = `${data.charCount} / ${MAX_CHARS} caratteri`;
    copyBtn.disabled = false;

    updateGauge(data.charCount);
    prependHistoryEntry(data);
  } catch (err) {
    console.error(err);
    showError(err.message || 'Qualcosa e\' andato storto. Riprova.');
  } finally {
    translateBtn.disabled = sourceText.value.trim().length === 0;
    translateBtn.querySelector('.btn-label').textContent = 'Traduci';
  }
}

translateBtn.addEventListener('click', translate);

sourceText.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    translate();
  }
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(resultText.textContent);
    const original = copyBtn.textContent;
    copyBtn.textContent = 'Copiato ✓';
    setTimeout(() => { copyBtn.textContent = original; }, 1400);
  } catch (err) {
    console.error('Copia non riuscita', err);
  }
});

// ---------------- Input vocale ----------------

let recognition = null;
let isListening = false;

function setupSpeechRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    micBtn.disabled = true;
    micBtn.title = 'Riconoscimento vocale non supportato da questo browser';
    return;
  }

  recognition = new Ctor();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    micBtn.dataset.recording = 'true';
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.dataset.recording = 'false';
  };

  recognition.onerror = (event) => {
    isListening = false;
    micBtn.dataset.recording = 'false';
    if (event.error !== 'aborted' && event.error !== 'no-speech') {
      showError('Riconoscimento vocale non riuscito. Riprova o digita il testo.');
    }
  };

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((r) => r[0].transcript)
      .join(' ')
      .trim();
    if (!transcript) return;

    const current = sourceText.value;
    const needsSpace = current && !/[\s\n]$/.test(current);
    sourceText.value = (current + (needsSpace ? ' ' : '') + transcript).slice(0, 2000);
    sourceText.dispatchEvent(new Event('input'));
  };
}

micBtn.addEventListener('click', () => {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
    return;
  }
  hideError();
  recognition.lang = micLangSelect.value;
  try {
    recognition.start();
  } catch (err) {
    console.error('Impossibile avviare il riconoscimento vocale', err);
  }
});

setupSpeechRecognition();

// ---------------- Storico ----------------

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function buildEntryNode(entry) {
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.dataset.id = entry.id;

  el.innerHTML = `
    <div class="log-meta">
      <span class="log-direction">${(entry.sourceLang || '').toUpperCase()} → ${(entry.targetLang || '').toUpperCase()}</span>
      <span class="log-time">${formatTime(entry.createdAt)}</span>
    </div>
    <div class="log-src">
      <span class="log-label">Originale</span>
      ${escapeHtml(entry.sourceText)}
    </div>
    <div class="log-tgt">
      <span class="log-label">Tradotto</span>
      ${escapeHtml(entry.translation)}
    </div>
    <button class="log-delete" title="Elimina voce" aria-label="Elimina voce">✕</button>
  `;

  el.querySelector('.log-delete').addEventListener('click', () => deleteHistoryEntry(entry.id, el));
  return el;
}

function prependHistoryEntry(entry) {
  historyEmpty.style.display = 'none';
  historyList.insertBefore(buildEntryNode(entry), historyList.firstChild);
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const entries = await res.json();
    historyList.innerHTML = '';
    if (!entries.length) {
      historyList.appendChild(historyEmpty);
      historyEmpty.style.display = 'block';
      return;
    }
    entries.forEach((entry) => historyList.appendChild(buildEntryNode(entry)));
  } catch (err) {
    console.error('Errore caricamento storico', err);
  }
}

async function deleteHistoryEntry(id, node) {
  try {
    await fetch(`/api/history/${id}`, { method: 'DELETE' });
    node.remove();
    if (!historyList.children.length) {
      historyList.appendChild(historyEmpty);
      historyEmpty.style.display = 'block';
    }
  } catch (err) {
    console.error('Errore eliminazione voce', err);
  }
}

clearHistoryBtn.addEventListener('click', async () => {
  if (!confirm('Svuotare tutto il registro delle traduzioni?')) return;
  try {
    await fetch('/api/history', { method: 'DELETE' });
    historyList.innerHTML = '';
    historyList.appendChild(historyEmpty);
    historyEmpty.style.display = 'block';
  } catch (err) {
    console.error('Errore svuotamento registro', err);
  }
});

// Init
updateGauge(0);
loadHistory();
