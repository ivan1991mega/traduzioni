const OUTPUT_W = 850;
const OUTPUT_H = 566;
const ANALYSIS_SIZE = 220;
const BG_THRESHOLD = 32;
const SUBJECT_PADDING = 1.18;
const MAX_ZOOM = 5;
const WHITE_BG_INNER_T = 22;
const WHITE_BG_OUTER_T = 78;

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
    node,
    frameEl: node.querySelector('[data-role="frame"]'),
    imgEl: node.querySelector('[data-role="img"]'),
    zoomEl: node.querySelector('[data-role="zoom"]'),
    autoCenterBtn: node.querySelector('[data-role="auto-center-btn"]'),
    whiteBgBtn: node.querySelector('[data-role="white-bg-btn"]'),
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
// Stima il colore di sfondo dal bordo del RITAGLIO gia' centrato (non della
// foto intera) e lo uniforma verso il bianco puro, con una zona di transizione
// morbida per evitare bordi netti/frastagliati attorno al prodotto. E'
// un'euristica basata sul colore, non un vero riconoscimento del soggetto:
// funziona bene su sfondi chiari/tendenzialmente uniformi anche se non
// perfetti, ma non su sfondi molto complessi o dai colori simili al prodotto.
function applyWhiteBackground(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const bg = estimateBorderColor(data, w, h);
  if (!bg) return;

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bg[0];
    const dg = data[i + 1] - bg[1];
    const db = data[i + 2] - bg[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);

    if (dist <= WHITE_BG_INNER_T) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    } else if (dist < WHITE_BG_OUTER_T) {
      const keep = (dist - WHITE_BG_INNER_T) / (WHITE_BG_OUTER_T - WHITE_BG_INNER_T);
      data[i] = Math.round(255 * (1 - keep) + data[i] * keep);
      data[i + 1] = Math.round(255 * (1 - keep) + data[i + 1] * keep);
      data[i + 2] = Math.round(255 * (1 - keep) + data[i + 2] * keep);
    }
    // oltre la soglia esterna: probabile soggetto, pixel invariato
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
      applyWhiteBackground(ctx, OUTPUT_W, OUTPUT_H);
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
