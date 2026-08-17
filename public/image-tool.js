const OUTPUT_W = 850;
const OUTPUT_H = 566;
const ANALYSIS_SIZE = 220;
const BG_THRESHOLD = 32;
const SUBJECT_PADDING = 1.18;
const MAX_ZOOM = 5;
const WHITE_BG_DEFAULT_INTENSITY = 78;
const WHITE_BG_RAMP = 56;
const WHITE_BG_PROTECT_BONUS = 45;

const themeToggle = document.getElementById('theme-toggle');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const cardsGrid = document.getElementById('cards-grid');
const cardTemplate = document.getElementById('card-template');
const batchBar = document.getElementById('batch-bar');
const batchCount = document.getElementById('batch-count');
const formatSelect = document.getElementById('format-select');
const qualitySlider = document.getElementById('quality-slider');
const qualityValue = document.getElementById('quality-value');
const downloadAllBtn = document.getElementById('download-all-btn');
const clearAllBtn = document.getElementById('clear-all-btn');
const zipProgress = document.getElementById('zip-progress');

let items = [];
let nextId = 1;

// ---------------- Tema (condiviso con il traduttore) ----------------

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

// ---------------- Utility ----------------

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function sanitizeBaseName(name) {
  const base = name.replace(/\.[^/.]+$/, '');
  return base.replace(/[^a-z0-9\-_]+/gi, '-').slice(0, 60) || 'immagine';
}

function extForMime(mime) {
  return mime === 'image/webp' ? 'webp' : 'jpg';
}

// ---------------- Caricamento file ----------------

['dragenter', 'dragover'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (e) => {
  const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
  handleFiles(files);
});

dropzone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  handleFiles(Array.from(fileInput.files || []));
  fileInput.value = '';
});

function handleFiles(files) {
  files.forEach((file) => addImageItem(file));
}

function addImageItem(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();

  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  cardsGrid.appendChild(node);

  const item = {
    id: nextId++,
    file,
    url,
    naturalW: 0,
    naturalH: 0,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    detection: null,
    whiteBackground: false,
    whiteBgIntensity: WHITE_BG_DEFAULT_INTENSITY,
    node,
    frameEl: node.querySelector('[data-role="frame"]'),
    imgEl: node.querySelector('[data-role="img"]'),
    zoomEl: node.querySelector('[data-role="zoom"]'),
    autoCenterBtn: node.querySelector('[data-role="auto-center-btn"]'),
    whiteBgBtn: node.querySelector('[data-role="white-bg-btn"]'),
    whiteBgIntensityEl: node.querySelector('[data-role="white-bg-intensity"]'),
    outputSizeEl: node.querySelector('[data-role="output-size"]'),
    outputThumbEl: node.querySelector('[data-role="output-thumb"]'),
    debounceTimer: null
  };

  node.querySelector('[data-role="filename"]').textContent = file.name;
  node.querySelector('[data-role="original-size"]').textContent = formatBytes(file.size);

  img.onload = () => {
    item.naturalW = img.naturalWidth;
    item.naturalH = img.naturalHeight;
    item.imgEl.src = url;
    item.detection = detectSubject(img, item.naturalW, item.naturalH);
    applyAutoCenter(item, { silent: true });
  };
  img.onerror = () => {
    item.outputSizeEl.textContent = 'immagine non leggibile';
    node.querySelector('[data-role="download-btn"]').disabled = true;
  };
  img.src = url;

  setupDrag(item);

  item.zoomEl.addEventListener('input', () => {
    item.zoom = parseFloat(item.zoomEl.value);
    render(item);
    schedulePreview(item);
  });

  if (item.autoCenterBtn) {
    item.autoCenterBtn.addEventListener('click', () => applyAutoCenter(item));
  }

  if (item.whiteBgBtn) {
    item.whiteBgBtn.addEventListener('click', () => {
      item.whiteBackground = !item.whiteBackground;
      item.whiteBgBtn.setAttribute('aria-pressed', item.whiteBackground ? 'true' : 'false');
      if (item.whiteBgIntensityEl) {
        item.whiteBgIntensityEl.hidden = !item.whiteBackground;
      }
      schedulePreview(item);
    });
  }

  if (item.whiteBgIntensityEl) {
    item.whiteBgIntensityEl.addEventListener('input', () => {
      item.whiteBgIntensity = parseFloat(item.whiteBgIntensityEl.value);
      schedulePreview(item);
    });
  }

  node.querySelector('.card-remove').addEventListener('click', () => removeItem(item));
  node.querySelector('[data-role="download-btn"]').addEventListener('click', () => downloadSingle(item));

  window.addEventListener('resize', () => render(item));

  items.push(item);
  updateBatchBar();
}

function removeItem(item) {
  URL.revokeObjectURL(item.url);
  if (item.outputThumbEl && item.outputThumbEl.dataset.blobUrl) {
    URL.revokeObjectURL(item.outputThumbEl.dataset.blobUrl);
  }
  item.node.remove();
  items = items.filter((i) => i.id !== item.id);
  updateBatchBar();
}

clearAllBtn.addEventListener('click', () => {
  if (!items.length) return;
  if (!confirm('Rimuovere tutte le immagini caricate?')) return;
  items.forEach((item) => URL.revokeObjectURL(item.url));
  items = [];
  cardsGrid.innerHTML = '';
  updateBatchBar();
});

function updateBatchBar() {
  batchBar.hidden = items.length === 0;
  batchCount.textContent = `${items.length} immagine${items.length === 1 ? '' : 'i'}`;
}

// ---------------- Ritaglio: drag & zoom ----------------

function render(item) {
  if (!item.naturalW) return;
  const rect = item.frameEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const baseScale = Math.max(rect.width / item.naturalW, rect.height / item.naturalH);
  const scale = baseScale * item.zoom;
  const dispW = item.naturalW * scale;
  const dispH = item.naturalH * scale;
  const maxX = Math.max(0, (dispW - rect.width) / 2);
  const maxY = Math.max(0, (dispH - rect.height) / 2);

  item.offsetX = clamp(item.offsetX, -maxX, maxX);
  item.offsetY = clamp(item.offsetY, -maxY, maxY);

  item.imgEl.style.transform = `translate(-50%, -50%) translate(${item.offsetX}px, ${item.offsetY}px) scale(${scale})`;

  item._frameRect = rect;
  item._scale = scale;
}

function setupDrag(item) {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origX = 0;
  let origY = 0;

  item.frameEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = item.offsetX;
    origY = item.offsetY;
    item.frameEl.setPointerCapture(e.pointerId);
  });

  item.frameEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    item.offsetX = origX + (e.clientX - startX);
    item.offsetY = origY + (e.clientY - startY);
    render(item);
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) => {
    item.frameEl.addEventListener(evt, () => {
      if (!dragging) return;
      dragging = false;
      schedulePreview(item);
    });
  });
}

// ---------------- Rilevamento automatico del soggetto ----------------
//
// Euristica pensata per le tipiche foto prodotto (esche, artificiali, ecc.)
// su sfondo pressoche' uniforme: stima il colore di sfondo dal bordo della
// foto, individua i pixel che se ne discostano (il prodotto) e ne calcola
// il riquadro e il baricentro, cosi' da poter centrare e zoomare il ritaglio
// sul soggetto invece che sul centro geometrico dell'immagine.

function medianChannel(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Stima il colore di sfondo campionando l'anello esterno di un ImageData
// (bordo = presumibilmente sfondo, sia nella foto originale sia nel ritaglio finale).
function estimateBorderColor(data, w, h) {
  const marginX = Math.max(1, Math.round(w * 0.04));
  const marginY = Math.max(1, Math.round(h * 0.04));
  const rs = [], gs = [], bs = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < marginX || x >= w - marginX || y < marginY || y >= h - marginY) {
        const idx = (y * w + x) * 4;
        rs.push(data[idx]);
        gs.push(data[idx + 1]);
        bs.push(data[idx + 2]);
      }
    }
  }
  if (!rs.length) return null;
  return [medianChannel(rs), medianChannel(gs), medianChannel(bs)];
}

function detectSubject(img, naturalW, naturalH) {
  try {
    const scale = Math.min(1, ANALYSIS_SIZE / Math.max(naturalW, naturalH));
    const w = Math.max(1, Math.round(naturalW * scale));
    const h = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const bg = estimateBorderColor(data, w, h);
    if (!bg) return null;

    // 2. proiezioni riga/colonna dei pixel "diversi dallo sfondo"
    const rowSum = new Float32Array(h);
    const colSum = new Float32Array(w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const dr = data[idx] - bg[0];
        const dg = data[idx + 1] - bg[1];
        const db = data[idx + 2] - bg[2];
        if (Math.sqrt(dr * dr + dg * dg + db * db) > BG_THRESHOLD) {
          rowSum[y]++;
          colSum[x]++;
        }
      }
    }

    // 3. riquadro del soggetto: righe/colonne con una quota minima di pixel "primo piano"
    const minColFrac = h * 0.015;
    const minRowFrac = w * 0.015;
    let minX = -1, maxX = -1, minY = -1, maxY = -1;
    for (let x = 0; x < w; x++) {
      if (colSum[x] > minColFrac) {
        if (minX === -1) minX = x;
        maxX = x;
      }
    }
    for (let y = 0; y < h; y++) {
      if (rowSum[y] > minRowFrac) {
        if (minY === -1) minY = y;
        maxY = y;
      }
    }
    if (minX === -1 || minY === -1) return null;

    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    // scena troppo "piena" (sfondo non uniforme) o soggetto troppo minuscolo: non affidabile
    if (bboxW > w * 0.94 && bboxH > h * 0.94) return null;
    if (bboxW < w * 0.03 || bboxH < h * 0.03) return null;

    // 4. baricentro dei pixel di primo piano dentro il riquadro (gestisce bene soggetti asimmetrici/laterali)
    let sumX = 0, sumY = 0, count = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = (y * w + x) * 4;
        const dr = data[idx] - bg[0];
        const dg = data[idx + 1] - bg[1];
        const db = data[idx + 2] - bg[2];
        if (Math.sqrt(dr * dr + dg * dg + db * db) > BG_THRESHOLD) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }
    const cx = count ? sumX / count : (minX + maxX) / 2;
    const cy = count ? sumY / count : (minY + maxY) / 2;

    const toNatX = naturalW / w;
    const toNatY = naturalH / h;

    return {
      cx: cx * toNatX,
      cy: cy * toNatY,
      bboxW: bboxW * toNatX,
      bboxH: bboxH * toNatY
    };
  } catch (err) {
    console.warn('Rilevamento soggetto non riuscito, uso il centro immagine', err);
    return null;
  }
}

function applyAutoCenter(item, opts) {
  const silent = opts && opts.silent;
  const rect = item.frameEl.getBoundingClientRect();
  if (!rect.width || !rect.height || !item.naturalW) return;

  const baseScale = Math.max(rect.width / item.naturalW, rect.height / item.naturalH);

  if (!item.detection) {
    // nessun soggetto rilevabile: centro standard, nessuna sorpresa per l'utente
    if (!silent) {
      item.zoom = 1;
      item.offsetX = 0;
      item.offsetY = 0;
      item.zoomEl.value = 1;
    }
    render(item);
    schedulePreview(item);
    return;
  }

  const { cx, cy, bboxW, bboxH } = item.detection;
  const maxZoom = parseFloat(item.zoomEl.max) || MAX_ZOOM;

  const scaleForW = rect.width / (bboxW * SUBJECT_PADDING);
  const scaleForH = rect.height / (bboxH * SUBJECT_PADDING);
  const targetScale = Math.min(scaleForW, scaleForH);
  const zoom = clamp(targetScale / baseScale, 1, maxZoom);
  const scale = baseScale * zoom;

  item.zoom = zoom;
  item.zoomEl.value = zoom;
  item.offsetX = (item.naturalW / 2 - cx) * scale;
  item.offsetY = (item.naturalH / 2 - cy) * scale;

  render(item);
  schedulePreview(item);
}

// ---------------- Sfondo bianco uniforme ----------------
//
// Versione avanzata: invece di un unico colore di sfondo "medio" per tutta
// la foto, stima come lo sfondo varia punto per punto (utile quando la luce
// non e' perfettamente uniforme). Individua inoltre l'area del prodotto e la
// protegge con soglie piu' severe, per non erodere parti chiare/riflettenti
// del prodotto scambiandole per sfondo.

function solve3x3(M) {
  const A = M.map((row) => row.slice());
  for (let i = 0; i < 3; i++) {
    let maxRow = i;
    for (let k = i + 1; k < 3; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    if (Math.abs(A[i][i]) < 1e-6) return null;
    for (let k = i + 1; k < 3; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let sum = A[i][3];
    for (let j = i + 1; j < 3; j++) sum -= A[i][j] * x[j];
    x[i] = sum / A[i][i];
  }
  return x;
}

// Interpola il colore di sfondo atteso in ogni punto (x,y) come un piano
// (a + b*x + c*y), stimato per regressione dai pixel del bordo. Cattura bene
// i gradienti di luce tipici delle foto "quasi uniformi ma non perfette".
function fitBackgroundPlane(data, w, h) {
  const marginX = Math.max(1, Math.round(w * 0.04));
  const marginY = Math.max(1, Math.round(h * 0.04));
  const step = Math.max(1, Math.round(Math.max(w, h) / 140));

  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  let scRs = 0, scGs = 0, scBs = 0, sxcR = 0, sxcG = 0, sxcB = 0, sycR = 0, sycG = 0, sycB = 0;

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (x < marginX || x >= w - marginX || y < marginY || y >= h - marginY) {
        const idx = (y * w + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        scRs += r; scGs += g; scBs += b;
        sxcR += x * r; sxcG += x * g; sxcB += x * b;
        sycR += y * r; sycG += y * g; sycB += y * b;
      }
    }
  }
  if (n < 10) return null;

  const base = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
  const coefR = solve3x3([base[0].concat(scRs), base[1].concat(sxcR), base[2].concat(sycR)]);
  const coefG = solve3x3([base[0].concat(scGs), base[1].concat(sxcG), base[2].concat(sycG)]);
  const coefB = solve3x3([base[0].concat(scBs), base[1].concat(sxcB), base[2].concat(sycB)]);
  if (!coefR || !coefG || !coefB) return null;

  return { coefR, coefG, coefB };
}

function planeAt(coef, x, y) {
  return clamp(coef[0] + coef[1] * x + coef[2] * y, 0, 255);
}

function applyWhiteBackground(ctx, w, h, intensity) {
  const outerT = intensity || WHITE_BG_DEFAULT_INTENSITY;
  const innerT = Math.max(6, outerT - WHITE_BG_RAMP);
  const outerTProtected = outerT + WHITE_BG_PROTECT_BONUS;
  const innerTProtected = Math.max(outerT - 8, innerT + 16);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const plane = fitBackgroundPlane(data, w, h);
  const fallbackBg = plane ? null : estimateBorderColor(data, w, h);
  if (!plane && !fallbackBg) return;

  function bgAt(x, y) {
    if (plane) {
      return [planeAt(plane.coefR, x, y), planeAt(plane.coefG, x, y), planeAt(plane.coefB, x, y)];
    }
    return fallbackBg;
  }

  // Passata 1: distanza dallo sfondo locale + proiezioni riga/colonna per individuare
  // l'area del prodotto da proteggere (stessa tecnica del rilevamento soggetto).
  const rawDist = new Float32Array(w * h);
  const rowSum = new Float32Array(h);
  const colSum = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const bg = bgAt(x, y);
      const dr = data[idx] - bg[0];
      const dg = data[idx + 1] - bg[1];
      const db = data[idx + 2] - bg[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      rawDist[y * w + x] = dist;
      if (dist > outerT) {
        rowSum[y]++;
        colSum[x]++;
      }
    }
  }

  // Piccolo livellamento (media 3x3) della mappa distanze: riduce le zone
  // "a chiazze" dovute a rumore/texture del sensore fotografico, senza
  // spostare in modo significativo i bordi veri del soggetto.
  const distMap = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += rawDist[yy * w + xx];
          count++;
        }
      }
      distMap[y * w + x] = sum / count;
    }
  }

  const minColFrac = h * 0.015;
  const minRowFrac = w * 0.015;
  let minX = -1, maxX = -1, minY = -1, maxY = -1;
  for (let x = 0; x < w; x++) {
    if (colSum[x] > minColFrac) { if (minX === -1) minX = x; maxX = x; }
  }
  for (let y = 0; y < h; y++) {
    if (rowSum[y] > minRowFrac) { if (minY === -1) minY = y; maxY = y; }
  }

  let protect = null;
  if (minX !== -1 && minY !== -1 && !(maxX - minX > w * 0.94 && maxY - minY > h * 0.94)) {
    const padX = (maxX - minX) * 0.06;
    const padY = (maxY - minY) * 0.06;
    // Il margine di sfumatura e' proporzionale alla dimensione del soggetto,
    // cosi' la transizione verso le soglie normali e' graduale e non un
    // confine netto (che produrrebbe i "riquadri" visibili).
    const feather = Math.max(28, Math.min(maxX - minX, maxY - minY) * 0.18);
    protect = {
      minX: Math.max(0, minX - padX),
      maxX: Math.min(w, maxX + padX),
      minY: Math.max(0, minY - padY),
      maxY: Math.min(h, maxY + padY),
      feather
    };
  }

  // Peso di protezione sfumato: 1 dentro il riquadro del soggetto, 0 oltre il
  // margine di sfumatura, con una rampa morbida in mezzo (nessun confine netto).
  function protectWeight(x, y) {
    if (!protect) return 0;
    const dx = Math.max(protect.minX - x, 0, x - protect.maxX);
    const dy = Math.max(protect.minY - y, 0, y - protect.maxY);
    const dist = Math.sqrt(dx * dx + dy * dy);
    return clamp(1 - dist / protect.feather, 0, 1);
  }

  // Passata 2: applica lo sbiancamento. Le soglie si spostano gradualmente
  // verso valori piu' severi avvicinandosi all'area del prodotto, invece di
  // cambiare di scatto sul bordo del riquadro rilevato.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const dist = distMap[y * w + x];
      const pw = protectWeight(x, y);
      const oT = outerT + pw * WHITE_BG_PROTECT_BONUS;
      const iT = innerT + pw * (innerTProtected - innerT);

      if (dist <= iT) {
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
      } else if (dist < oT) {
        const keep = (dist - iT) / (oT - iT);
        data[idx] = Math.round(255 * (1 - keep) + data[idx] * keep);
        data[idx + 1] = Math.round(255 * (1 - keep) + data[idx + 1] * keep);
        data[idx + 2] = Math.round(255 * (1 - keep) + data[idx + 2] * keep);
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// ---------------- Export su canvas ----------------

function exportItem(item, mime, quality) {
  return new Promise((resolve) => {
    const rect = item.frameEl.getBoundingClientRect();
    const baseScale = Math.max(rect.width / item.naturalW, rect.height / item.naturalH);
    const dispScale = baseScale * item.zoom;

    const cropWNat = rect.width / dispScale;
    const cropHNat = rect.height / dispScale;
    const centerXNat = item.naturalW / 2 - item.offsetX / dispScale;
    const centerYNat = item.naturalH / 2 - item.offsetY / dispScale;
    const sx = clamp(centerXNat - cropWNat / 2, 0, Math.max(0, item.naturalW - cropWNat));
    const sy = clamp(centerYNat - cropHNat / 2, 0, Math.max(0, item.naturalH - cropHNat));

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_W;
    canvas.height = OUTPUT_H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(item.imgEl, sx, sy, cropWNat, cropHNat, 0, 0, OUTPUT_W, OUTPUT_H);

    if (item.whiteBackground) {
      applyWhiteBackground(ctx, OUTPUT_W, OUTPUT_H, item.whiteBgIntensity);
    }

    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

function schedulePreview(item) {
  clearTimeout(item.debounceTimer);
  item.outputSizeEl.textContent = '850×566 · calcolo…';
  item.debounceTimer = setTimeout(() => updatePreviewSize(item), 350);
}

async function updatePreviewSize(item) {
  if (!item.naturalW) return;
  const mime = formatSelect.value;
  const quality = parseFloat(qualitySlider.value);
  const blob = await exportItem(item, mime, quality);
  if (blob) {
    item.outputSizeEl.textContent = `850×566 · ${formatBytes(blob.size)}`;
    if (item.outputThumbEl) {
      const oldUrl = item.outputThumbEl.dataset.blobUrl;
      const newUrl = URL.createObjectURL(blob);
      item.outputThumbEl.src = newUrl;
      item.outputThumbEl.dataset.blobUrl = newUrl;
      item.outputThumbEl.hidden = false;
      if (oldUrl) URL.revokeObjectURL(oldUrl);
    }
  }
}

// ---------------- Impostazioni globali ----------------

qualitySlider.addEventListener('input', () => {
  qualityValue.textContent = `${Math.round(parseFloat(qualitySlider.value) * 100)}%`;
  items.forEach((item) => schedulePreview(item));
});

formatSelect.addEventListener('change', () => {
  items.forEach((item) => schedulePreview(item));
});

// ---------------- Download ----------------

async function downloadSingle(item) {
  const mime = formatSelect.value;
  const quality = parseFloat(qualitySlider.value);
  const blob = await exportItem(item, mime, quality);
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${sanitizeBaseName(item.file.name)}-850x566.${extForMime(mime)}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

downloadAllBtn.addEventListener('click', async () => {
  if (!items.length || typeof JSZip === 'undefined') return;

  downloadAllBtn.disabled = true;
  const zip = new JSZip();
  const mime = formatSelect.value;
  const quality = parseFloat(qualitySlider.value);
  const usedNames = new Set();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    zipProgress.hidden = false;
    zipProgress.textContent = `Preparazione file ${i + 1}/${items.length}…`;

    const blob = await exportItem(item, mime, quality);
    if (!blob) continue;

    let name = `${sanitizeBaseName(item.file.name)}-850x566.${extForMime(mime)}`;
    let counter = 2;
    while (usedNames.has(name)) {
      name = `${sanitizeBaseName(item.file.name)}-850x566-${counter}.${extForMime(mime)}`;
      counter++;
    }
    usedNames.add(name);
    zip.file(name, blob);
  }

  zipProgress.textContent = 'Compressione ZIP…';
  const content = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content);
  a.download = 'lenza-immagini-850x566.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);

  zipProgress.hidden = true;
  downloadAllBtn.disabled = false;
});
