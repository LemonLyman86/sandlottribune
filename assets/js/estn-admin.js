/**
 * estn-admin.js — ESTN Portal Admin Dashboard Logic
 *
 * Access: protected by a hardcoded admin UID (same as Rumblr admin).
 * Manages: featured article, ticker, custom headlines, ad units,
 *          quick links, data status, programs visibility.
 */

import { firestore, auth } from './firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── Set this to your Firebase Auth UID ───────────────────
const ADMIN_UID = 'xNRN4Ae3VTeYqXB4XvcsDMXVABZ2';
// ─────────────────────────────────────────────────────────

const AD_SLOTS = [
  { id: 'center_program', label: 'Center Column — Program Ad',         pool: 'program' },
  { id: 'center_parody1', label: 'Center Column — Parody Ad (top)',    pool: 'parody'  },
  { id: 'center_parody2', label: 'Center Column — Parody Ad (bottom)', pool: 'parody'  },
  { id: 'pillar',         label: 'Left Pillar — Compact Parody Ad',    pool: 'parody'  },
];

const ALL_ADS = [
  { id: 'gif',              name: 'GIF',             brand: 'Site Ad' },
  { id: 'lost-it',         name: 'Lost It',         brand: 'Site Ad' },
  { id: 'krispy-kremated', name: 'Krispy Kremated',  brand: 'Site Ad' },
  { id: 'spotty-wifi',     name: 'Spotty WiFi',     brand: 'Site Ad' },
  { id: 'stay-inn',        name: 'Stay Inn',        brand: 'Site Ad' },
  { id: 'oops',            name: 'Oops',            brand: 'Site Ad' },
  { id: 'wwf',             name: 'WWF',             brand: 'Site Ad' },
  { id: 'starwars-coffee', name: 'Starwars Coffee', brand: 'Site Ad' },
  { id: 'olympics',        name: 'Olympics',        brand: 'Site Ad' },
  { id: 'adobo',           name: 'Adobo',           brand: 'Site Ad' },
  { id: 'blink',           name: 'Blink',           brand: 'Site Ad' },
  { id: 'rumblr-ad',       name: 'Rumblr Ad',       brand: 'ESTN Program' },
  { id: 'tribune-ad',      name: 'Tribune Ad',      brand: 'ESTN Program' },
  { id: 'podcast-ad',      name: 'Podcast Ad',      brand: 'ESTN Program' },
];

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg, isError) {
  const el = document.getElementById('estn-toast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderLeftColor = isError ? '#F87171' : '#C8102E';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Firestore helpers ──────────────────────────────────────────────────────────
async function getSettings() {
  try {
    const snap = await getDoc(doc(firestore, 'settings', 'estn'));
    return snap.exists() ? snap.data() : {};
  } catch { return {}; }
}

async function saveSettings(data) {
  try {
    await setDoc(doc(firestore, 'settings', 'estn'), data, { merge: true });
  } catch (err) {
    const msg = err.code === 'permission-denied'
      ? 'Permission denied — update Firestore rules (see FIRESTORE_RULES.txt)'
      : (err.message || 'Unknown error');
    showToast('Save failed: ' + msg, true);
    throw err;
  }
}

// ── Static JSON data status ────────────────────────────────────────────────────
async function loadDataStatus() {
  const files = [
    { key: 'standings',    el: 'data-standings-updated'    },
    { key: 'matchups',     el: 'data-matchups-updated'     },
    { key: 'transactions', el: 'data-transactions-updated' },
  ];
  for (const f of files) {
    const el = document.getElementById(f.el);
    if (!el) continue;
    try {
      const res = await fetch(`../data/${f.key}.json?v=${Date.now()}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      el.textContent = data.updated
        ? new Date(data.updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : 'Unknown';
    } catch {
      el.textContent = 'File not found';
      el.style.color = '#F87171';
    }
  }
}

// ── Featured article ───────────────────────────────────────────────────────────
function initFeatured(settings) {
  const fa = settings.featured_article || {};
  const pinnedCb = document.getElementById('featured-pinned');
  const fieldsEl = document.getElementById('featured-fields');

  if (pinnedCb) {
    pinnedCb.checked = !!fa.pinned;
    fieldsEl.style.display = fa.pinned ? 'block' : 'none';
    pinnedCb.addEventListener('change', () => {
      fieldsEl.style.display = pinnedCb.checked ? 'block' : 'none';
    });
  }

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('featured-url',          fa.url);
  setVal('featured-title-input',  fa.title);
  setVal('featured-byline',       fa.byline);
  setVal('featured-excerpt-input',fa.excerpt);
  setVal('featured-image-url',    fa.image_url);
  setVal('sub-story-url',         fa.sub_story_url);
  setVal('sub-story-title',       fa.sub_story_title);
  setVal('sub-story-img',         fa.sub_story_img);

  document.getElementById('save-featured-btn')?.addEventListener('click', async () => {
    try {
      const pinned = document.getElementById('featured-pinned')?.checked ?? false;
      const getV = id => document.getElementById(id)?.value.trim() || '';
      await saveSettings({
        featured_article: {
          pinned,
          url:            getV('featured-url'),
          title:          getV('featured-title-input'),
          byline:         getV('featured-byline'),
          excerpt:        getV('featured-excerpt-input'),
          image_url:      getV('featured-image-url'),
          sub_story_url:  getV('sub-story-url'),
          sub_story_title:getV('sub-story-title'),
          sub_story_img:  getV('sub-story-img'),
        }
      });
      showToast('Featured article saved.');
    } catch { /* error shown by saveSettings */ }
  });
}

// ── Ticker ─────────────────────────────────────────────────────────────────────
const TICKER_PAGE_OPTIONS = [
  { key: 'home',             label: 'Home (Portal)'       },
  { key: 'league-records',   label: 'League Records'      },
  { key: 'season-deadlines', label: 'Season Events'       },
  { key: 'between-the-chalk',label: 'Between the Chalk'   },
  { key: 'tribune',          label: 'The Tribune'         },
  { key: 'rumblr',           label: 'Rumblr'              },
  { key: 'about',            label: 'About'               },
];

const TICKER_FALLBACK_ITEMS = [
  '2026 TSDL SEASON KICKS OFF IN MARCH',
  'RUMBLR IS LIVE — POST YOUR TAKES',
  'FA AUCTION: MARCH 22',
  'MILB DRAFT + LEGAL ROSTER DEADLINE: MARCH 15',
  'ESTN — MORE THAN A LEAGUE',
];

async function initTicker() {
  let tickerData = {};
  try {
    const snap = await getDoc(doc(firestore, 'settings', 'ticker'));
    if (snap.exists()) tickerData = snap.data();
  } catch { /* use defaults */ }

  const enabledEl = document.getElementById('ticker-enabled');
  const itemsEl   = document.getElementById('ticker-items');
  if (enabledEl) enabledEl.checked = tickerData.enabled !== false;

  // Populate items — fall back to hardcoded defaults when Firestore is empty
  if (itemsEl) {
    const items = (tickerData.items && tickerData.items.length)
      ? tickerData.items
      : TICKER_FALLBACK_ITEMS;
    itemsEl.value = items.join('\n');
  }

  // Populate page checkboxes
  const pagesGrid = document.getElementById('ticker-pages-grid');
  if (pagesGrid) {
    const allowedPages = tickerData.ticker_pages || [];  // empty = all pages
    const allChecked   = allowedPages.length === 0;
    pagesGrid.innerHTML = TICKER_PAGE_OPTIONS.map(p => `
      <label class="estn-admin-toggle-row" style="margin-bottom:8px;cursor:pointer;">
        <label class="estn-admin-toggle">
          <input type="checkbox" class="ticker-page-cb" data-page="${p.key}"
            ${(allChecked || allowedPages.includes(p.key)) ? 'checked' : ''}>
          <span class="estn-admin-toggle-slider"></span>
        </label>
        <span class="estn-admin-toggle-label">${p.label}</span>
      </label>`).join('');
  }

  document.getElementById('save-ticker-btn')?.addEventListener('click', async () => {
    try {
      const enabled = document.getElementById('ticker-enabled')?.checked ?? true;
      const raw = document.getElementById('ticker-items')?.value || '';
      const items = raw.split('\n').map(s => s.trim()).filter(Boolean);

      // Collect checked pages — if all checked, save empty array (means "all pages")
      const allCbs    = Array.from(document.querySelectorAll('.ticker-page-cb'));
      const checked   = allCbs.filter(cb => cb.checked).map(cb => cb.dataset.page);
      const tickerPages = checked.length === allCbs.length ? [] : checked;

      await setDoc(doc(firestore, 'settings', 'ticker'), {
        enabled,
        items,
        ticker_pages: tickerPages,
        updated_at: serverTimestamp()
      }, { merge: true });
      showToast('Ticker saved.');
    } catch (err) {
      const msg = err.code === 'permission-denied'
        ? 'Permission denied — update Firestore rules (see FIRESTORE_RULES.txt)'
        : (err.message || 'Unknown error');
      showToast('Save failed: ' + msg, true);
    }
  });
}

// ── Custom headlines ───────────────────────────────────────────────────────────
function formatHeadlineDate(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  } catch { return isoStr; }
}

function renderHeadlinesList(headlines) {
  const container = document.getElementById('headlines-list');
  if (!container) return;
  container.innerHTML = '';
  (headlines || []).forEach((h, i) => {
    const text = typeof h === 'string' ? h : (h.text || '');
    const date = typeof h === 'string' ? '' : (h.date || '');
    const url  = typeof h === 'string' ? '' : (h.url  || '');
    const row = document.createElement('div');
    row.className = 'estn-admin-link-row';
    row.style.flexDirection = 'column';
    row.style.alignItems = 'stretch';
    row.style.gap = '4px';
    row.dataset.date = date;
    row.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="estn-admin-input headline-text" type="text" value="${text.replace(/"/g, '&quot;')}" data-idx="${i}" placeholder="Headline text" style="flex:2;">
        <input class="estn-admin-input headline-url" type="text" value="${url.replace(/"/g, '&quot;')}" data-idx="${i}" placeholder="Edition slug (e.g. tex-sale)" style="flex:1;">
        <button class="estn-admin-remove-btn" data-idx="${i}">Remove</button>
      </div>
      ${date ? `<div style="font-size:0.7rem;color:#4A5568;font-family:'Oswald',sans-serif;letter-spacing:0.04em;">Added: ${formatHeadlineDate(date)}</div>` : ''}`;
    container.appendChild(row);
  });
  container.querySelectorAll('.estn-admin-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.estn-admin-link-row').remove());
  });
}

function initHeadlines(settings) {
  renderHeadlinesList(settings.custom_headlines || []);

  document.getElementById('add-headline-btn')?.addEventListener('click', () => {
    const container = document.getElementById('headlines-list');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'estn-admin-link-row';
    row.style.flexDirection = 'column';
    row.style.alignItems = 'stretch';
    row.style.gap = '4px';
    row.dataset.date = new Date().toISOString();
    row.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;">
        <input class="estn-admin-input headline-text" type="text" placeholder="Headline text" style="flex:2;">
        <input class="estn-admin-input headline-url" type="text" placeholder="Edition slug (e.g. tex-sale)" style="flex:1;">
        <button class="estn-admin-remove-btn">Remove</button>
      </div>`;
    row.querySelector('.estn-admin-remove-btn').addEventListener('click', () => row.remove());
    container.appendChild(row);
  });

  document.getElementById('save-headlines-btn')?.addEventListener('click', async () => {
    try {
      const rows = document.querySelectorAll('#headlines-list .estn-admin-link-row');
      const headlines = Array.from(rows).map(r => ({
        text: r.querySelector('.headline-text')?.value.trim() || '',
        url:  r.querySelector('.headline-url')?.value.trim()  || '',
        date: r.dataset.date || '',
      })).filter(h => h.text);
      await saveSettings({ custom_headlines: headlines });
      showToast('Headlines saved.');
    } catch { /* error shown by saveSettings */ }
  });
}

// ── Ad units ───────────────────────────────────────────────────────────────────
function initAds(settings) {
  const disabled  = new Set(settings.disabled_ads || []);
  const pinned    = settings.ad_slots || {};

  const PROGRAM_IDS = new Set(['rumblr-ad', 'tribune-ad', 'podcast-ad']);

  // ── Slot assignment dropdowns ──
  const slotsGrid = document.getElementById('ad-slots-grid');
  if (slotsGrid) {
    slotsGrid.innerHTML = AD_SLOTS.map(slot => {
      const pool = ALL_ADS.filter(a =>
        slot.pool === 'program' ? PROGRAM_IDS.has(a.id) : !PROGRAM_IDS.has(a.id)
      );
      const options = [
        `<option value="">— Random —</option>`,
        ...pool.map(ad =>
          `<option value="${ad.id}"${pinned[slot.id] === ad.id ? ' selected' : ''}>${ad.name}</option>`
        )
      ].join('');
      return `
        <div class="estn-admin-field">
          <label class="estn-admin-label">${slot.label}</label>
          <select class="estn-admin-input" id="slot-${slot.id}">${options}</select>
        </div>`;
    }).join('');
  }

  // ── Enable / disable toggles ──
  const grid = document.getElementById('ad-toggles-grid');
  if (grid) {
    grid.innerHTML = ALL_ADS.map(ad => `
      <div class="estn-admin-ad-row">
        <div class="estn-admin-ad-name">
          ${ad.name}
          <span class="estn-admin-ad-brand">${ad.brand}</span>
        </div>
        <label class="estn-admin-toggle">
          <input type="checkbox" id="ad-${ad.id}" ${!disabled.has(ad.id) ? 'checked' : ''}>
          <span class="estn-admin-toggle-slider"></span>
        </label>
      </div>`).join('');
  }

  document.getElementById('save-ads-btn')?.addEventListener('click', async () => {
    try {
      const disabledAds = ALL_ADS
        .filter(ad => !document.getElementById(`ad-${ad.id}`)?.checked)
        .map(ad => ad.id);
      const adSlots = {};
      for (const slot of AD_SLOTS) {
        const val = document.getElementById(`slot-${slot.id}`)?.value || '';
        if (val) adSlots[slot.id] = val;
      }
      await saveSettings({ disabled_ads: disabledAds, ad_slots: adSlots });
      showToast('Ad settings saved.');
    } catch { /* error shown by saveSettings */ }
  });
}

// ── Quick links ────────────────────────────────────────────────────────────────
const DEFAULT_LINKS = [
  { label: 'League Records',    url: 'league-records/'    },
  { label: 'Season Deadlines',  url: 'season-deadlines/'  },
  { label: 'Between The Chalk', url: 'between-the-chalk/' },
  { label: 'Season Previews',   url: 'season-previews/'   },
];

function renderLinksList(links) {
  const container = document.getElementById('quick-links-list');
  if (!container) return;
  container.innerHTML = '';
  (links || []).forEach(link => {
    const row = document.createElement('div');
    row.className = 'estn-admin-link-row';
    row.innerHTML = `
      <input class="estn-admin-input link-label" type="text" value="${(link.label||'').replace(/"/g,'&quot;')}" placeholder="Link label">
      <input class="estn-admin-input link-url"   type="text" value="${(link.url  ||'').replace(/"/g,'&quot;')}" placeholder="URL (e.g. league-records/)">
      <button class="estn-admin-remove-btn">Remove</button>`;
    row.querySelector('.estn-admin-remove-btn').addEventListener('click', () => row.remove());
    container.appendChild(row);
  });
}

function initQuickLinks(settings) {
  renderLinksList(settings.quick_links || DEFAULT_LINKS);

  document.getElementById('add-link-btn')?.addEventListener('click', () => {
    const container = document.getElementById('quick-links-list');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'estn-admin-link-row';
    row.innerHTML = `
      <input class="estn-admin-input link-label" type="text" placeholder="Link label">
      <input class="estn-admin-input link-url"   type="text" placeholder="URL">
      <button class="estn-admin-remove-btn">Remove</button>`;
    row.querySelector('.estn-admin-remove-btn').addEventListener('click', () => row.remove());
    container.appendChild(row);
  });

  document.getElementById('save-links-btn')?.addEventListener('click', async () => {
    try {
      const rows = document.querySelectorAll('#quick-links-list .estn-admin-link-row');
      const links = Array.from(rows).map(r => ({
        label: r.querySelector('.link-label')?.value.trim() || '',
        url:   r.querySelector('.link-url')?.value.trim()   || '',
      })).filter(l => l.label && l.url);
      await saveSettings({ quick_links: links });
      showToast('Quick links saved.');
    } catch { /* error shown by saveSettings */ }
  });

  document.getElementById('reset-links-btn')?.addEventListener('click', async () => {
    try {
      renderLinksList(DEFAULT_LINKS);
      await saveSettings({ quick_links: null });
      showToast('Quick links reset to defaults.');
    } catch { /* error shown by saveSettings */ }
  });
}

// ── Programs visibility ────────────────────────────────────────────────────────
function initPrograms(settings) {
  const hidden = new Set(settings.hidden_programs || []);
  const setCb = (id, programId) => {
    const el = document.getElementById(id);
    if (el) el.checked = !hidden.has(programId);
  };
  setCb('prog-rumblr',  'rumblr');
  setCb('prog-tribune', 'tribune');
  setCb('prog-podcast', 'podcast');

  document.getElementById('save-programs-btn')?.addEventListener('click', async () => {
    try {
      const hiddenPrograms = [];
      const check = (id, progId) => { if (!document.getElementById(id)?.checked) hiddenPrograms.push(progId); };
      check('prog-rumblr',  'rumblr');
      check('prog-tribune', 'tribune');
      check('prog-podcast', 'podcast');
      await saveSettings({ hidden_programs: hiddenPrograms });
      showToast('Programs visibility saved.');
    } catch { /* error shown by saveSettings */ }
  });
}

// ── Tab switching ──────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.estn-admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.estn-admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.estn-tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(`tab-${tab.dataset.tab}`);
      if (panel) panel.classList.add('active');
    });
  });
}

// ── Drag-to-reorder ────────────────────────────────────────────────────────────
function makeDraggable(container) {
  let dragSrc = null;
  container.addEventListener('dragstart', e => {
    dragSrc = e.target.closest('[draggable="true"]');
    if (dragSrc) setTimeout(() => dragSrc.classList.add('dragging'), 0);
  });
  container.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('dragging');
    dragSrc = null;
  });
  container.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('[draggable="true"]');
    if (!target || target === dragSrc || !dragSrc) return;
    const rect = target.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    container.insertBefore(dragSrc, after ? target.nextSibling : target);
  });
}

// ── HTML escape helper ─────────────────────────────────────────────────────────
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── BTC article manager ────────────────────────────────────────────────────────
const BTC_TYPE_LABELS = {
  season_preview: 'Season Preview', power_rankings: 'Power Rankings',
  weekly_recap: 'Weekly Recap', matchup_preview: 'Matchup Preview',
  trade_analysis: 'Trade Analysis',
};

const FALLBACK_BTC_ARTICLES = [
  { id:'season_preview_2026_sea', title:'2026 TSDL Season Preview: Seattle Mariners',   author:'Ken Rosenthal', date:'Feb 28, 2026', type:'season_preview', typeLabel:'Season Preview', url:'../season-previews/season_preview_2026_sea.html', thumbnail:'../assets/images/sea-preview.png', enabled:true },
  { id:'season_preview_2026_atl', title:'2026 TSDL Season Preview: Atlanta Braves',     author:'Tim Kurkjian',  date:'Feb 28, 2026', type:'season_preview', typeLabel:'Season Preview', url:'../season-previews/season_preview_2026_atl.html', thumbnail:'../assets/images/atl-preview.png', enabled:true },
  { id:'season_preview_2026_lva', title:'2026 TSDL Season Preview: Las Vegas Athletics',author:'Keith Law',     date:'Feb 27, 2026', type:'season_preview', typeLabel:'Season Preview', url:'../season-previews/season_preview_2026_lva.html', thumbnail:'../assets/images/lva-preview.png', enabled:true },
  { id:'season_preview_2026_stl', title:'2026 TSDL Season Preview: St. Louis Cardinals',author:'Buster Olney',  date:'Feb 27, 2026', type:'season_preview', typeLabel:'Season Preview', url:'../season-previews/season_preview_2026_stl.html', thumbnail:'../assets/images/stl-preview.png', enabled:true },
  { id:'season_preview_2026_ari', title:'2026 TSDL Season Preview: Arizona Diamondbacks',author:'Jeff Passan', date:'Feb 26, 2026', type:'season_preview', typeLabel:'Season Preview', url:'../season-previews/season_preview_2026_ari.html', thumbnail:'../assets/images/ari-preview.png', enabled:true },
];

function createBTCRow(article) {
  const row = document.createElement('div');
  row.className = 'btc-article-row';
  row.setAttribute('draggable', 'true');
  row.dataset.id       = article.id || `a_${Date.now()}`;
  row.dataset.author   = article.author   || '';
  row.dataset.date     = article.date     || '';
  row.dataset.type     = article.type     || '';
  row.dataset.typeLabel= article.typeLabel|| '';
  row.dataset.url      = article.url      || '';
  row.dataset.thumb    = article.thumbnail|| '';
  row.innerHTML = `
    <span class="drag-handle" title="Drag to reorder">&#8942;</span>
    <img class="btc-row-thumb" src="${esc(article.thumbnail)}" alt="" onerror="this.style.opacity='0.15'">
    <div class="btc-row-meta">
      <div class="btc-row-title">${esc(article.title)}</div>
      <div class="btc-row-sub">${esc(article.author)} &middot; ${esc(article.date)}</div>
    </div>
    <span class="btc-row-type">${esc(article.typeLabel || article.type)}</span>
    <label class="estn-admin-toggle" title="Enabled in nav">
      <input type="checkbox" class="btc-enabled-toggle" ${article.enabled !== false ? 'checked' : ''}>
      <span class="estn-admin-toggle-slider"></span>
    </label>
    <button class="admin-delete-btn" title="Remove">&times;</button>
  `;
  row.querySelector('.admin-delete-btn').addEventListener('click', () => row.remove());
  return row;
}

function readBTCArticles() {
  return Array.from(document.querySelectorAll('#btc-article-rows .btc-article-row')).map(row => ({
    id:        row.dataset.id,
    title:     row.querySelector('.btc-row-title')?.textContent || '',
    author:    row.dataset.author,
    date:      row.dataset.date,
    type:      row.dataset.type,
    typeLabel: row.dataset.typeLabel,
    url:       row.dataset.url,
    thumbnail: row.dataset.thumb,
    enabled:   row.querySelector('.btc-enabled-toggle')?.checked !== false,
  }));
}

async function initBTC() {
  let articles;
  try {
    const snap = await getDoc(doc(firestore, 'settings', 'btc'));
    articles = (snap.exists() && Array.isArray(snap.data().articles) && snap.data().articles.length)
      ? snap.data().articles : FALLBACK_BTC_ARTICLES;
  } catch { articles = FALLBACK_BTC_ARTICLES; }

  const container = document.getElementById('btc-article-rows');
  if (!container) return;
  articles.forEach(a => container.appendChild(createBTCRow(a)));
  makeDraggable(container);

  document.getElementById('btc-add-btn')?.addEventListener('click', () => {
    const getV = id => document.getElementById(id)?.value.trim() || '';
    const type = getV('btc-add-type');
    const article = {
      id: `article_${Date.now()}`,
      title:     getV('btc-add-title'),
      author:    getV('btc-add-author'),
      date:      getV('btc-add-date'),
      type,
      typeLabel: BTC_TYPE_LABELS[type] || type,
      url:       getV('btc-add-url'),
      thumbnail: getV('btc-add-thumb'),
      enabled:   true,
    };
    if (!article.title || !article.url) { showToast('Title and URL are required.', true); return; }
    container.appendChild(createBTCRow(article));
    ['btc-add-title','btc-add-author','btc-add-date','btc-add-url','btc-add-thumb'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  });

  document.getElementById('save-btc-btn')?.addEventListener('click', async () => {
    try {
      const articles = readBTCArticles();
      await setDoc(doc(firestore, 'settings', 'btc'), { articles });
      showToast('BTC article list saved.');
    } catch (err) {
      const msg = err.code === 'permission-denied'
        ? 'Permission denied — update Firestore rules (see FIRESTORE_RULES.txt)'
        : (err.message || 'Unknown error');
      showToast('Save failed: ' + msg, true);
    }
  });
}

// ── Events manager ─────────────────────────────────────────────────────────────
const FALLBACK_EVENTS = [
  { id:'keeper-deadline',   name:'Keeper Declaration Deadline', category:'preseason', startDate:'2026-03-01', endDate:'',           description:'Submit your keeper list by midnight.' },
  { id:'expansion-draft',   name:'Expansion Draft',             category:'preseason', startDate:'2026-03-07', endDate:'2026-03-14', description:'Expansion teams select from the available pool.' },
  { id:'fa-auction',        name:'FA Auction Draft',            category:'preseason', startDate:'2026-03-22', endDate:'',           description:'Main auction — $260 budget per team.' },
  { id:'milb-draft',        name:'MiLB Draft',                  category:'preseason', startDate:'2026-03-23', endDate:'',           description:'Prospect draft following the FA auction.' },
  { id:'season-start',      name:'Regular Season Begins',       category:'inseason',  startDate:'2026-03-26', endDate:'',           description:'Week 1 matchups begin.' },
  { id:'trade-deadline',    name:'Trade Deadline',              category:'inseason',  startDate:'2026-08-31', endDate:'',           description:'No trades after this date.' },
  { id:'waiver-freeze',     name:'Waiver Wire Freeze',          category:'playoffs',  startDate:'2026-09-14', endDate:'',           description:'Roster moves freeze before playoffs.' },
  { id:'playoffs-begin',    name:'Playoffs Begin',              category:'playoffs',  startDate:'2026-09-15', endDate:'',           description:'Top 8 teams advance to the bracket.' },
  { id:'championship',      name:'Championship Week',           category:'playoffs',  startDate:'2026-09-29', endDate:'2026-10-05', description:'TSDL World Series — final week.' },
  { id:'offseason-begins',  name:'Off-Season Begins',           category:'offseason', startDate:'2026-10-06', endDate:'',           description:'Contracts, cuts, and roster planning begin.' },
];

const CAT_LABELS = { preseason:'Pre-Season', inseason:'In-Season', playoffs:'Playoffs', offseason:'Off-Season' };

function createEventRow(ev) {
  const row = document.createElement('div');
  row.className = 'event-row';
  row.setAttribute('draggable', 'true');
  row.dataset.id   = ev.id   || `ev_${Date.now()}`;
  row.dataset.desc = ev.description || '';
  row.innerHTML = `
    <span class="drag-handle" title="Drag to reorder">&#8942;</span>
    <div class="event-row-meta">
      <div class="event-row-name">${esc(ev.name)}</div>
      <div class="event-row-dates">${esc(ev.startDate)}${ev.endDate ? ' – ' + esc(ev.endDate) : ''}</div>
    </div>
    <span class="event-cat-chip ${esc(ev.category)}">${esc(CAT_LABELS[ev.category] || ev.category)}</span>
    <select class="estn-admin-input ev-status-override" style="font-size:0.72rem;padding:3px 6px;width:auto;">
      <option value="">Auto</option>
      <option value="upcoming"   ${ev.statusOverride==='upcoming'   ?'selected':''}>Force: Upcoming</option>
      <option value="inprogress" ${ev.statusOverride==='inprogress' ?'selected':''}>Force: In Progress</option>
      <option value="past"       ${ev.statusOverride==='past'       ?'selected':''}>Force: Past</option>
    </select>
    <label class="estn-admin-toggle" title="Visible on calendar">
      <input type="checkbox" class="ev-enabled-toggle" ${ev.enabled !== false ? 'checked' : ''}>
      <span class="estn-admin-toggle-slider"></span>
    </label>
    <button class="admin-delete-btn" title="Remove">&times;</button>
  `;
  // Store mutable fields as data attrs for read-back
  row.dataset.name      = ev.name      || '';
  row.dataset.category  = ev.category  || '';
  row.dataset.startDate = ev.startDate || '';
  row.dataset.endDate   = ev.endDate   || '';
  row.querySelector('.admin-delete-btn').addEventListener('click', () => row.remove());
  return row;
}

function readEvents() {
  return Array.from(document.querySelectorAll('#events-rows .event-row')).map(row => ({
    id:             row.dataset.id,
    name:           row.dataset.name,
    category:       row.dataset.category,
    startDate:      row.dataset.startDate,
    endDate:        row.dataset.endDate,
    description:    row.dataset.desc,
    statusOverride: row.querySelector('.ev-status-override')?.value || null,
    enabled:        row.querySelector('.ev-enabled-toggle')?.checked !== false,
  }));
}

async function initEvents() {
  let events;
  try {
    const snap = await getDoc(doc(firestore, 'settings', 'events'));
    events = (snap.exists() && Array.isArray(snap.data().events) && snap.data().events.length)
      ? snap.data().events : FALLBACK_EVENTS;
  } catch { events = FALLBACK_EVENTS; }

  const container = document.getElementById('events-rows');
  if (!container) return;
  events.forEach(ev => container.appendChild(createEventRow(ev)));
  makeDraggable(container);

  document.getElementById('ev-add-btn')?.addEventListener('click', () => {
    const getV = id => document.getElementById(id)?.value.trim() || '';
    const ev = {
      id: `ev_${Date.now()}`,
      name:        getV('ev-add-name'),
      category:    getV('ev-add-cat'),
      startDate:   getV('ev-add-start'),
      endDate:     getV('ev-add-end'),
      description: getV('ev-add-desc'),
      enabled:     true,
    };
    if (!ev.name || !ev.startDate) { showToast('Name and start date are required.', true); return; }
    container.appendChild(createEventRow(ev));
    ['ev-add-name','ev-add-start','ev-add-end','ev-add-desc'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  });

  document.getElementById('save-events-btn')?.addEventListener('click', async () => {
    try {
      const events = readEvents();
      await setDoc(doc(firestore, 'settings', 'events'), { events });
      showToast('Events saved.');
    } catch (err) {
      const msg = err.code === 'permission-denied'
        ? 'Permission denied — update Firestore rules (see FIRESTORE_RULES.txt)'
        : (err.message || 'Unknown error');
      showToast('Save failed: ' + msg, true);
    }
  });
}

// ── League Records manager ─────────────────────────────────────────────────────
const FALLBACK_CHAMPIONS = [
  { year:2022, abbrev:'ATL', team:'Atlanta Braves',      owner:'Justin Winward', seed:1, note:'Inaugural champion' },
  { year:2023, abbrev:'MIL', team:'Milwaukee Brewers',   owner:'',               seed:1, note:'' },
  { year:2024, abbrev:'LVA', team:'Las Vegas Athletics', owner:'Mike DiMauro',   seed:1, note:'Back-to-back champs' },
  { year:2025, abbrev:'ARI', team:'Arizona Diamondbacks',owner:'Cote Nichols',   seed:8, note:'#8 seed Cinderella run' },
];

const FALLBACK_RECORDS = [
  { category:'Single Season', stat:'Best Regular Season Record', value:'17-2',  team:'MIL', season:2023, notes:'' },
  { category:'Single Season', stat:'Most Points Scored',         value:'—',     team:'',    season:'',   notes:'TBD' },
  { category:'Single Season', stat:'Lowest Playoff Seed to Win', value:'#8',    team:'ARI', season:2025, notes:'Arizona Diamondbacks' },
];

function createChampRow(champ, isNew) {
  const row = document.createElement('div');
  row.className = 'champion-row';
  row.setAttribute('draggable', isNew ? 'false' : 'false');
  row.innerHTML = `
    <input class="estn-admin-input champ-year"   type="text" value="${esc(champ.year)}"   placeholder="2026" style="font-size:0.8rem;padding:5px 8px;">
    <input class="estn-admin-input champ-abbrev" type="text" value="${esc(champ.abbrev)}" placeholder="ATL"  style="font-size:0.8rem;padding:5px 8px;text-transform:uppercase;">
    <input class="estn-admin-input champ-team"   type="text" value="${esc(champ.team)}"   placeholder="Team name" style="font-size:0.8rem;padding:5px 8px;">
    <input class="estn-admin-input champ-owner"  type="text" value="${esc(champ.owner)}"  placeholder="Owner name" style="font-size:0.8rem;padding:5px 8px;">
    <input class="estn-admin-input champ-seed"   type="text" value="${esc(champ.seed)}"   placeholder="1"   style="font-size:0.8rem;padding:5px 8px;">
    <input class="estn-admin-input champ-note"   type="text" value="${esc(champ.note)}"   placeholder="Notable achievement" style="font-size:0.8rem;padding:5px 8px;">
    <button class="admin-delete-btn" title="Remove">&times;</button>
  `;
  row.querySelector('.admin-delete-btn').addEventListener('click', () => row.remove());
  return row;
}

function createRecordRow(rec) {
  const row = document.createElement('div');
  row.className = 'record-row';
  row.innerHTML = `
    <input class="estn-admin-input rec-category" type="text" value="${esc(rec.category)}" placeholder="Single Season" style="font-size:0.8rem;padding:5px 8px;">
    <input class="estn-admin-input rec-stat"     type="text" value="${esc(rec.stat)}"     placeholder="Best Record"    style="font-size:0.8rem;padding:5px 8px;">
    <input class="estn-admin-input rec-value"    type="text" value="${esc(rec.value)}"    placeholder="17-2"           style="font-size:0.8rem;padding:5px 8px;">
    <input class="estn-admin-input rec-team"     type="text" value="${esc(rec.team)}"     placeholder="MIL"            style="font-size:0.8rem;padding:5px 8px;text-transform:uppercase;">
    <input class="estn-admin-input rec-season"   type="text" value="${esc(rec.season)}"   placeholder="2023"           style="font-size:0.8rem;padding:5px 8px;">
    <input class="estn-admin-input rec-notes"    type="text" value="${esc(rec.notes)}"    placeholder="Notes"          style="font-size:0.8rem;padding:5px 8px;">
    <button class="admin-delete-btn" title="Remove">&times;</button>
  `;
  row.querySelector('.admin-delete-btn').addEventListener('click', () => row.remove());
  return row;
}

function readChampions() {
  return Array.from(document.querySelectorAll('#champions-rows .champion-row')).map(row => ({
    year:   row.querySelector('.champ-year')?.value.trim()   || '',
    abbrev: row.querySelector('.champ-abbrev')?.value.trim() || '',
    team:   row.querySelector('.champ-team')?.value.trim()   || '',
    owner:  row.querySelector('.champ-owner')?.value.trim()  || '',
    seed:   row.querySelector('.champ-seed')?.value.trim()   || '',
    note:   row.querySelector('.champ-note')?.value.trim()   || '',
  }));
}

function readRecords() {
  return Array.from(document.querySelectorAll('#records-rows .record-row')).map(row => ({
    category: row.querySelector('.rec-category')?.value.trim() || '',
    stat:     row.querySelector('.rec-stat')?.value.trim()     || '',
    value:    row.querySelector('.rec-value')?.value.trim()    || '',
    team:     row.querySelector('.rec-team')?.value.trim()     || '',
    season:   row.querySelector('.rec-season')?.value.trim()   || '',
    notes:    row.querySelector('.rec-notes')?.value.trim()    || '',
  }));
}

async function initRecords() {
  let champions, records;
  try {
    const snap = await getDoc(doc(firestore, 'settings', 'league-records'));
    const data = snap.exists() ? snap.data() : {};
    champions = (Array.isArray(data.champions) && data.champions.length) ? data.champions : FALLBACK_CHAMPIONS;
    records   = (Array.isArray(data.records)   && data.records.length)   ? data.records   : FALLBACK_RECORDS;
  } catch {
    champions = FALLBACK_CHAMPIONS;
    records   = FALLBACK_RECORDS;
  }

  const champsContainer  = document.getElementById('champions-rows');
  const recordsContainer = document.getElementById('records-rows');
  if (!champsContainer || !recordsContainer) return;

  champions.forEach(c => champsContainer.appendChild(createChampRow(c)));
  records.forEach(r => recordsContainer.appendChild(createRecordRow(r)));

  document.getElementById('champ-add-btn')?.addEventListener('click', () => {
    champsContainer.appendChild(createChampRow({ year:'', abbrev:'', team:'', owner:'', seed:'', note:'' }));
  });

  document.getElementById('record-add-btn')?.addEventListener('click', () => {
    recordsContainer.appendChild(createRecordRow({ category:'', stat:'', value:'', team:'', season:'', notes:'' }));
  });

  document.getElementById('save-records-btn')?.addEventListener('click', async () => {
    try {
      const champions = readChampions();
      const records   = readRecords();
      await setDoc(doc(firestore, 'settings', 'league-records'), { champions, records });
      showToast('League records saved.');
    } catch (err) {
      const msg = err.code === 'permission-denied'
        ? 'Permission denied — update Firestore rules (see FIRESTORE_RULES.txt)'
        : (err.message || 'Unknown error');
      showToast('Save failed: ' + msg, true);
    }
  });
}

// ── Tribune editions manager ───────────────────────────────────────────────────
async function initTribune() {
  // Hardcoded fallback list for existing static editions
  const STATIC_EDITIONS = [
    { slug:'lad-milb', vol:'Vol. 5, No. 2', date:'March 10, 2026', dateIso:'2026-03-10', year:2026, headline:'Dodgers Make MiLB Selections', section:'Transactions & Moves', firestoreContent:false },
    { slug:'tex-sale', vol:'Vol. 5, No. 1', date:'March 7, 2026',  dateIso:'2026-03-07', year:2026, headline:'TEX Cleared For Sale',          section:'Ownership & League News', firestoreContent:false },
  ];

  let firestoreEditions = [];
  try {
    const snap = await getDoc(doc(firestore, 'settings', 'tribune'));
    if (snap.exists() && Array.isArray(snap.data().editions)) {
      firestoreEditions = snap.data().editions;
    }
  } catch { /* Firestore unavailable, use static list */ }

  // Merge: Firestore first (newest), then static ones not in Firestore
  const slugsInFirestore = new Set(firestoreEditions.map(e => e.slug));
  const allEditions = [
    ...firestoreEditions,
    ...STATIC_EDITIONS.filter(e => !slugsInFirestore.has(e.slug)),
  ];

  const container = document.getElementById('tribune-edition-rows');
  if (!container) return;

  if (!allEditions.length) {
    container.innerHTML = '<p class="estn-admin-hint">No editions yet. Click New Edition to create the first one.</p>';
  } else {
    container.innerHTML = '';
    allEditions.forEach(ed => {
      const row = document.createElement('div');
      row.className = 'tribune-edition-row';
      row.dataset.slug = ed.slug;
      row.innerHTML = `
        <div class="trib-ed-row-meta">
          <div class="trib-ed-row-vol">${esc(ed.vol)}</div>
          <div class="trib-ed-row-hed">${esc(ed.headline)}</div>
          <div class="trib-ed-row-date">${esc(ed.date)}${ed.section ? ' &middot; ' + esc(ed.section) : ''}</div>
        </div>
        <span class="trib-ed-source-chip ${ed.firestoreContent ? 'live' : 'static'}">${ed.firestoreContent ? 'Live' : 'Static'}</span>
        <a href="tribune-editor.html?slug=${encodeURIComponent(ed.slug)}" class="estn-admin-btn secondary" style="text-decoration:none;font-size:0.7rem;padding:5px 12px;">Edit</a>
        <button class="admin-delete-btn trib-ed-delete" data-slug="${esc(ed.slug)}" title="Remove from index">&times;</button>
      `;
      row.querySelector('.trib-ed-delete').addEventListener('click', () => {
        if (confirm(`Remove "${ed.headline}" from the Tribune index?\n\nThe Firestore content will remain and can be restored.`)) {
          row.remove();
        }
      });
      container.appendChild(row);
    });
  }

  // Save index order
  document.getElementById('save-tribune-btn')?.addEventListener('click', async () => {
    try {
      const rows = Array.from(document.querySelectorAll('#tribune-edition-rows .tribune-edition-row'));
      const slugOrder = rows.map(r => r.dataset.slug).filter(Boolean);
      // Build ordered edition list from known data
      const orderedEditions = slugOrder.map(slug => {
        return firestoreEditions.find(e => e.slug === slug)
            || STATIC_EDITIONS.find(e => e.slug === slug)
            || { slug };
      });
      await setDoc(doc(firestore, 'settings', 'tribune'), { editions: orderedEditions }, { merge: true });
      showToast('Tribune index saved.');
    } catch (err) {
      showToast('Save failed: ' + (err.message || 'Unknown error'), true);
    }
  });
}

// ── Main init ──────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  const gateEl = document.getElementById('estn-admin-gate');
  const dashEl = document.getElementById('estn-admin-dash');

  if (!user) {
    window.location.href = '../rumblr/login.html?redirect=estn/admin.html';
    return;
  }
  if (user.uid !== ADMIN_UID) {
    if (gateEl) gateEl.style.display = 'block';
    return;
  }

  // Authorized
  if (gateEl) gateEl.style.display = 'none';
  if (dashEl) dashEl.style.display = 'block';

  setupTabs();

  const settings = await getSettings();

  initFeatured(settings);
  initTicker();
  initHeadlines(settings);
  initAds(settings);
  initQuickLinks(settings);
  initPrograms(settings);
  loadDataStatus();
  initBTC();
  initEvents();
  initRecords();
  initTribune();
});
