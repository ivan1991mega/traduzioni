require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const MAX_CHARS = 500;
const HISTORY_LIMIT = 200;
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

const SUPPORTED_LANGS = ['it', 'en', 'ja'];
const LANG_LABELS = { it: 'italiano', en: 'inglese', ja: 'giapponese' };

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[ATTENZIONE] ANTHROPIC_API_KEY non impostata. Le traduzioni falliranno finche\' non la configuri.');
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Storico su file JSON -------------------------------------------------

function ensureHistoryFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '[]', 'utf8');
}

function readHistory() {
  ensureHistoryFile();
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (err) {
    console.error('Errore lettura storico:', err);
    return [];
  }
}

function writeHistory(entries) {
  ensureHistoryFile();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries.slice(0, HISTORY_LIMIT), null, 2), 'utf8');
}

function addHistoryEntry(entry) {
  const entries = readHistory();
  entries.unshift(entry);
  writeHistory(entries);
}

// --- Traduzione ------------------------------------------------------------

const SYSTEM_PROMPT = `Sei un traduttore e copywriter specializzato in articoli da pesca: canne, mulinelli, esche naturali e artificiali, lenze, ami, accessori e abbigliamento tecnico da pesca.

Lavori con tre lingue possibili: italiano (it), inglese (en) e giapponese (ja).

Per ogni richiesta ricevi un testo e una lingua di destinazione esplicita. Il tuo compito:
1. Rileva automaticamente la lingua del testo ricevuto (una tra it, en, ja).
2. Se la lingua rilevata coincide gia' con la lingua di destinazione richiesta, NON tradurre: rispondi solo con {"error":"same_language","sourceLang":"<lingua rilevata>"}.
3. Altrimenti traduci il testo nella lingua di destinazione richiesta, riscrivendolo come una scheda prodotto e-commerce: chiaro, naturale per un madrelingua pescatore (mai una traduzione letterale o goffa), mantenendo esatte le informazioni tecniche (materiali, misure, peso, azione della canna, profondita' di pesca, ecc.).
4. Rendi il testo tradotto attraente e persuasivo quanto l'originale.
5. Il testo tradotto non deve MAI superare i ${MAX_CHARS} caratteri, spazi inclusi. Se necessario, sintetizza mantenendo le informazioni piu' rilevanti. Per il giapponese conta i caratteri (kanji/kana/punteggiatura), non le parole.
6. Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza markdown, backtick o testo aggiuntivo, in uno di questi due formati:
   - successo: {"sourceLang":"it|en|ja","targetLang":"it|en|ja","translation":"testo tradotto"}
   - stessa lingua: {"error":"same_language","sourceLang":"it|en|ja"}`;

function extractJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Risposta AI non in formato JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 529]);
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Riprova automaticamente le chiamate all'API Anthropic in caso di sovraccarico
// temporaneo (529) o rate limit (429), con backoff esponenziale + jitter.
async function callClaudeWithRetry(params) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (err) {
      lastErr = err;
      const status = err && err.status;
      const isRetryable = RETRYABLE_STATUS.has(status);
      if (!isRetryable || attempt === MAX_RETRIES) {
        throw err;
      }
      const backoff = 500 * Math.pow(2, attempt) + Math.random() * 300;
      console.warn(`Chiamata Anthropic fallita (status ${status}), riprovo tra ${Math.round(backoff)}ms [tentativo ${attempt + 1}/${MAX_RETRIES}]`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

app.post('/api/translate', async (req, res) => {
  try {
    const text = (req.body && req.body.text || '').toString().trim();
    let targetLang = (req.body && req.body.targetLang || '').toString().trim();

    if (!text) {
      return res.status(400).json({ error: 'Inserisci un testo da tradurre.' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: 'Testo troppo lungo (massimo 2000 caratteri in input).' });
    }
    if (!SUPPORTED_LANGS.includes(targetLang)) {
      targetLang = 'en';
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurata sul server.' });
    }

    const userMessage = `Lingua di destinazione richiesta: ${LANG_LABELS[targetLang]} (${targetLang})\n\nTesto da tradurre:\n${text}`;

    const response = await callClaudeWithRetry({
      model: MODEL,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    const rawText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    let parsed;
    try {
      parsed = extractJson(rawText);
    } catch (parseErr) {
      console.error('Errore parsing risposta AI:', rawText);
      return res.status(502).json({ error: 'Risposta AI non valida, riprova.' });
    }

    if (parsed.error === 'same_language') {
      const label = LANG_LABELS[parsed.sourceLang] || 'questa lingua';
      return res.status(400).json({
        error: `Il testo sembra gia' essere in ${label}. Scegli un'altra lingua di destinazione.`
      });
    }

    if (!parsed.translation || !parsed.sourceLang || !parsed.targetLang) {
      return res.status(502).json({ error: 'Risposta AI incompleta, riprova.' });
    }

    let translation = parsed.translation.toString();
    if (translation.length > MAX_CHARS) {
      translation = translation.slice(0, MAX_CHARS - 1).trim() + '…';
    }

    const entry = {
      id: crypto.randomUUID(),
      sourceLang: parsed.sourceLang,
      targetLang: parsed.targetLang,
      sourceText: text,
      translation,
      charCount: translation.length,
      createdAt: new Date().toISOString()
    };

    addHistoryEntry(entry);
    res.json(entry);
  } catch (err) {
    console.error('Errore traduzione:', err);

    const status = err && err.status;
    if (status === 401 || status === 403) {
      return res.status(500).json({ error: 'Chiave API non valida o non autorizzata. Controlla ANTHROPIC_API_KEY.' });
    }
    if (err && err.error && err.error.error && err.error.error.message && /credit balance/i.test(err.error.error.message)) {
      return res.status(500).json({ error: 'Credito Anthropic esaurito. Ricarica il saldo su console.anthropic.com.' });
    }
    if (status === 529 || status === 429) {
      return res.status(503).json({ error: 'Il servizio di traduzione e\' momentaneamente sovraccarico. Riprova tra qualche secondo.' });
    }

    res.status(500).json({ error: 'Errore durante la traduzione. Riprova tra poco.' });
  }
});

// --- Storico API -------------------------------------------------------

app.get('/api/history', (req, res) => {
  res.json(readHistory());
});

app.delete('/api/history/:id', (req, res) => {
  const entries = readHistory().filter((e) => e.id !== req.params.id);
  writeHistory(entries);
  res.json({ ok: true });
});

app.delete('/api/history', (req, res) => {
  writeHistory([]);
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: MODEL, supportedLangs: SUPPORTED_LANGS });
});

app.listen(PORT, () => {
  console.log(`Lenza in ascolto sulla porta ${PORT}`);
});
