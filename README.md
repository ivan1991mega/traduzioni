# 🎣 Lenza — Traduttore per articoli da pesca (IT · EN · 日本語)

App web che traduce descrizioni di canne, mulinelli, esche, artificiali e accessori da pesca tra italiano, inglese e giapponese, usando l'API di Claude (Anthropic). Rileva automaticamente la lingua del testo, lo riscrive in modo naturale e accattivante per una scheda prodotto e-commerce, e non supera mai i 500 caratteri. Ogni traduzione viene salvata in un "registro di pesca" (storico) consultabile e cancellabile.

Funzionalità:
- **3 lingue**: italiano, inglese, giapponese — scegli tu la lingua di destinazione, il testo di partenza viene riconosciuto in automatico.
- **Dark mode**: interruttore in alto a destra, preferenza salvata nel browser.
- **Ottimizzata per smartphone**: layout responsive, tasti e aree di tocco pensati per l'uso da telefono.
- **Dettatura vocale**: tasto microfono per registrare il testo da tradurre invece di digitarlo (richiede un browser con supporto al riconoscimento vocale, es. Chrome, Edge, Safari su iOS recenti).
- **Registro traduzioni**: storico consultabile, con possibilità di eliminare singole voci o svuotarlo del tutto.

## Struttura del progetto

```
fishtranslate/
├── server.js           # backend Express + integrazione Anthropic API
├── package.json
├── .env.example         # variabili d'ambiente di esempio
├── data/
│   └── history.json      # storico traduzioni (creato automaticamente)
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

## 1. Uso in locale

Requisiti: Node.js 18+ e una API key Anthropic (la trovi su [console.anthropic.com](https://console.anthropic.com/settings/keys)).

```bash
npm install
cp .env.example .env
```

Apri `.env` e incolla la tua chiave:

```
ANTHROPIC_API_KEY=sk-ant-la-tua-chiave-qui
CLAUDE_MODEL=claude-sonnet-5
PORT=3000
```

Avvia il server:

```bash
npm start
```

Apri [http://localhost:3000](http://localhost:3000).

## 2. Caricare il progetto su GitHub

**Da terminale:**

```bash
cd fishtranslate
git init
git add .
git commit -m "Lenza: IT/EN/JA, dark mode, mobile, dettatura vocale"
git remote add origin https://github.com/TUO-UTENTE/fishtranslate.git
git branch -M main
git push -u origin main
```

**Oppure a mano dal sito:**
1. Crea un repository vuoto su github.com/new (senza README).
2. Nella pagina del repository vai su **Add file → Upload files**.
3. Trascina tutto il contenuto della cartella `fishtranslate` (non lo zip, il contenuto estratto).
4. Non caricare `.env` (contiene la tua chiave segreta) né `node_modules`: carica solo `.env.example`.
5. Scrivi un messaggio di commit e clicca **Commit changes**.

## 3. Deploy su Railway

1. Vai su [railway.app](https://railway.app) e accedi con GitHub.
2. **New Project → Deploy from GitHub repo** e seleziona il repository.
3. Railway riconosce da solo il progetto Node.js grazie a `package.json` — nessuna configurazione di build necessaria.
4. In **Variables** aggiungi:
   - `ANTHROPIC_API_KEY` → la tua chiave
   - `CLAUDE_MODEL` → `claude-sonnet-5` (opzionale)
5. In **Settings → Networking → Generate Domain** ottieni il link pubblico per usare l'app dal telefono.

Ad ogni `git push` su `main`, Railway ripubblica l'app aggiornata.

### Nota sullo storico

Lo storico è salvato in un file JSON locale. Su Railway il filesystem è effimero: ad ogni nuovo deploy (non ad ogni riavvio) i dati vengono azzerati. Per uno storico permanente tra deploy, si può collegare in futuro un database Postgres (Railway lo offre con un click).

### Nota sulla dettatura vocale

Il riconoscimento vocale usa la Web Speech API del browser (non l'API di Claude), quindi funziona solo sui browser che la supportano e **richiede una connessione HTTPS** (Railway la fornisce automaticamente). In locale su `http://localhost` funziona comunque, ma su altri indirizzi HTTP non protetti i browser lo disabilitano per policy di sicurezza.

## Come funziona la traduzione

Il backend invia il testo a Claude specificando la lingua di destinazione scelta, e chiede di:
- riconoscere la lingua sorgente tra italiano, inglese e giapponese;
- se il testo è già nella lingua di destinazione richiesta, avvisare senza tradurre;
- altrimenti tradurre usando terminologia tecnica di pesca corretta (canne, azione, mulinelli, esche, ecc.), non una traduzione letterale, restando sempre entro i 500 caratteri.

Puoi modificare il tono o le regole editando la costante `SYSTEM_PROMPT` in `server.js`.

## Personalizzazioni rapide

- **Limite caratteri**: cambia `MAX_CHARS` in `server.js` (e `MAX_CHARS` in `public/app.js`, usato solo per la UI).
- **Lingue supportate**: `SUPPORTED_LANGS` e `LANG_LABELS` in `server.js`, più `LANG_NAMES` in `public/app.js` e i pulsanti in `index.html`.
- **Numero di traduzioni salvate nello storico**: `HISTORY_LIMIT` in `server.js`.
- **Colori/tema chiaro e scuro**: variabili in cima a `public/style.css` (`:root` e `html[data-theme="dark"]`).
