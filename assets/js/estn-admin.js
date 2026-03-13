/**
 * estn-admin.js — ESTN Portal Admin Dashboard Logic
 *
 * Access: protected by a hardcoded admin UID (same as Rumblr admin).
 * Manages: featured article, ticker, custom headlines, ad units,
 *          quick links, data status, programs visibility.
 */

import { firestore, auth } from './firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collection, query, where, orderBy, limit,
  getDocs, addDoc, deleteDoc, increment
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { AI_WRITERS } from './rumblr-app.js';

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
        ${MOVE_BTNS_HTML}
        <input class="estn-admin-input headline-text" type="text" value="${text.replace(/"/g, '&quot;')}" data-idx="${i}" placeholder="Headline text" style="flex:2;">
        <input class="estn-admin-input headline-url" type="text" value="${url.replace(/"/g, '&quot;')}" data-idx="${i}" placeholder="Edition slug (e.g. tex-sale)" style="flex:1;">
        <button class="estn-admin-remove-btn" data-idx="${i}">Remove</button>
      </div>
      ${date ? `<div style="font-size:0.7rem;color:#4A5568;font-family:'Oswald',sans-serif;letter-spacing:0.04em;">Added: ${formatHeadlineDate(date)}</div>` : ''}`;
    addMoveListeners(row);
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
        ${MOVE_BTNS_HTML}
        <input class="estn-admin-input headline-text" type="text" placeholder="Headline text" style="flex:2;">
        <input class="estn-admin-input headline-url" type="text" placeholder="Edition slug (e.g. tex-sale)" style="flex:1;">
        <button class="estn-admin-remove-btn">Remove</button>
      </div>`;
    row.querySelector('.estn-admin-remove-btn').addEventListener('click', () => row.remove());
    addMoveListeners(row);
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
      ${MOVE_BTNS_HTML}
      <input class="estn-admin-input link-label" type="text" value="${(link.label||'').replace(/"/g,'&quot;')}" placeholder="Link label">
      <input class="estn-admin-input link-url"   type="text" value="${(link.url  ||'').replace(/"/g,'&quot;')}" placeholder="URL (e.g. league-records/)">
      <button class="estn-admin-remove-btn">Remove</button>`;
    row.querySelector('.estn-admin-remove-btn').addEventListener('click', () => row.remove());
    addMoveListeners(row);
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
      ${MOVE_BTNS_HTML}
      <input class="estn-admin-input link-label" type="text" placeholder="Link label">
      <input class="estn-admin-input link-url"   type="text" placeholder="URL">
      <button class="estn-admin-remove-btn">Remove</button>`;
    row.querySelector('.estn-admin-remove-btn').addEventListener('click', () => row.remove());
    addMoveListeners(row);
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

// ── Programs Manager (full edit: name, subtitle, status, URL, enabled) ─────────
const DEFAULT_PROGRAMS_SEED = [
  { id: 'rumblr',   name: 'Rumblr',                subtitle: '', status: 'Now Live',      statusCls: 'live',        href: 'rumblr/',  logo: 'assets/images/rumblr-logo.png',          enabled: true },
  { id: 'tribune',  name: 'The Sandlot Tribune',   subtitle: '', status: 'Now Live',      statusCls: 'live',        href: 'tribune/', logo: 'assets/images/logo.png',                 enabled: true },
  { id: 'podcast',  name: 'Babe Ruth Podcast',     subtitle: '', status: 'Coming in 2026', statusCls: 'coming-soon', href: 'about/',   logo: 'assets/images/baberuth-podcast-logo.png', enabled: true },
];

function initPrograms(settings) {
  const container = document.getElementById('programs-toggles');
  const saveBtn   = document.getElementById('save-programs-btn');
  if (!container) return;

  // Use Firestore programs array or seed from defaults (migrate hidden_programs)
  let programs;
  if (Array.isArray(settings.programs) && settings.programs.length > 0) {
    programs = settings.programs.map(p => ({ ...p }));
  } else {
    const hidden = new Set(settings.hidden_programs || []);
    programs = DEFAULT_PROGRAMS_SEED.map(p => ({ ...p, enabled: !hidden.has(p.id) }));
  }

  function renderProgramRows() {
    container.innerHTML = '';
    programs.forEach((p, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'border:1px solid #2D3748;border-radius:6px;padding:12px;margin-bottom:10px;background:#0D1117;';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <label class="estn-admin-toggle" style="flex-shrink:0;">
            <input type="checkbox" class="prog-enabled" ${p.enabled !== false ? 'checked' : ''}>
            <span class="estn-admin-toggle-slider"></span>
          </label>
          <span style="font-family:'Oswald',sans-serif;font-size:0.8rem;color:#E2E8F0;">${esc(p.name || p.id)}</span>
        </div>
        <div class="estn-admin-field-grid">
          <div class="estn-admin-field">
            <label class="estn-admin-label">Program Name</label>
            <input class="estn-admin-input prog-name" type="text" value="${esc(p.name || '')}" placeholder="Program name">
          </div>
          <div class="estn-admin-field">
            <label class="estn-admin-label">Subtitle (optional)</label>
            <input class="estn-admin-input prog-subtitle" type="text" value="${esc(p.subtitle || '')}" placeholder="Tagline under the name">
          </div>
          <div class="estn-admin-field">
            <label class="estn-admin-label">Status Badge Text</label>
            <input class="estn-admin-input prog-status" type="text" value="${esc(p.status || '')}" placeholder="e.g. Now Live, Coming in 2026">
          </div>
          <div class="estn-admin-field">
            <label class="estn-admin-label">Badge Style</label>
            <select class="estn-admin-input prog-status-cls">
              <option value="live" ${p.statusCls === 'live' ? 'selected' : ''}>Live (red)</option>
              <option value="coming-soon" ${p.statusCls === 'coming-soon' ? 'selected' : ''}>Coming Soon (grey)</option>
              <option value="beta" ${p.statusCls === 'beta' ? 'selected' : ''}>Beta (blue)</option>
            </select>
          </div>
          <div class="estn-admin-field" style="grid-column:span 2;">
            <label class="estn-admin-label">Link URL (relative to site root)</label>
            <input class="estn-admin-input prog-href" type="text" value="${esc(p.href || '')}" placeholder="e.g. rumblr/">
          </div>
        </div>
      `;
      // Keep programs array in sync with inputs
      row.querySelector('.prog-enabled').addEventListener('change',    e => { programs[i].enabled   = e.target.checked; });
      row.querySelector('.prog-name').addEventListener('input',        e => { programs[i].name      = e.target.value; });
      row.querySelector('.prog-subtitle').addEventListener('input',    e => { programs[i].subtitle  = e.target.value; });
      row.querySelector('.prog-status').addEventListener('input',      e => { programs[i].status    = e.target.value; });
      row.querySelector('.prog-status-cls').addEventListener('change', e => { programs[i].statusCls = e.target.value; });
      row.querySelector('.prog-href').addEventListener('input',        e => { programs[i].href      = e.target.value; });
      container.appendChild(row);
    });
  }

  renderProgramRows();

  saveBtn?.addEventListener('click', async () => {
    try {
      await saveSettings({ programs });
      showToast('Programs saved.');
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
  // Auto-activate tab from URL hash (e.g. #rumblr from redirect)
  const hashTab = window.location.hash.replace('#', '');
  if (hashTab) {
    const t = document.querySelector(`.estn-admin-tab[data-tab="${hashTab}"]`);
    if (t) t.click();
  }
}

// ── Up / down move buttons ─────────────────────────────────────────────────────
const MOVE_BTNS_HTML = `<div class="row-move-btns"><button class="row-move-btn move-up" title="Move up">&#9650;</button><button class="row-move-btn move-dn" title="Move down">&#9660;</button></div>`;
function addMoveListeners(row) {
  row.querySelector('.move-up')?.addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (prev && !prev.classList.contains('header-row')) row.parentNode.insertBefore(row, prev);
  });
  row.querySelector('.move-dn')?.addEventListener('click', () => {
    const next = row.nextElementSibling;
    if (next) row.parentNode.insertBefore(next, row);
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
  trade_analysis: 'Trade Analysis', general_analysis: 'General Analysis', editorial: 'Editorial', analysis: 'Analysis',
};

const FALLBACK_BTC_ARTICLES = [
  { id:'season_preview_2026_sdp', title:'2026 TSDL Season Preview: San Diego Padres',    author:'Peter Gammons', date:'Mar 12, 2026', type:'season_preview', typeLabel:'Season Preview', url:'../season-previews/season_preview_2026_sdp.html', thumbnail:'../assets/images/sdp-preview.png', enabled:true },
  { id:'custom-lad_2026',           title:'Los Angeles Dodgers Make First Moves In TSDL', author:'Jason Stark',   date:'Mar 8, 2026',  type:'general_analysis', typeLabel:'Ownership & Transactions', url:'../between-the-chalk/custom-lad_2026.html',            thumbnail:'../assets/images/lad.png',  enabled:true },
  { id:'lad_expansion_draft_2026',  title:'Gone West: The Rangers Are Sold, the Dodgers Are Born, and the Entire League Just Got More Interesting', author:'Peter Gammons', date:'Mar 7, 2026', type:'general_analysis', typeLabel:'Ownership & Transactions', url:'../between-the-chalk/lad_expansion_draft_2026.html', thumbnail:'../assets/images/lad.png',  enabled:true },
  { id:'season_preview_2026_sea', title:'2026 TSDL Season Preview: Seattle Mariners',   author:'Ken Rosenthal', date:'Feb 28, 2026', type:'season_preview', typeLabel:'Season Preview', url:'../season-previews/season_preview_2026_sea.html', thumbnail:'../assets/images/sea-preview.png', enabled:true },
  { id:'season_preview_2026_atl', title:'2026 TSDL Season Preview: Atlanta Braves',     author:'Tim Kurkjian',  date:'Feb 28, 2026', type:'season_preview', typeLabel:'Season Preview', url:'../season-previews/season_preview_2026_atl.html', thumbnail:'../assets/images/atl-preview.png', enabled:true },
  { id:'season_preview_2026_lva', title:'2026 TSDL Season Preview: Las Vegas Athletics',author:'Keith Law',     date:'Feb 27, 2026', type:'season_preview', typeLabel:'Season Preview', url:'../season-previews/season_preview_2026_lva.html', thumbnail:'../assets/images/lva-preview.png', enabled:true },
  { id:'season_preview_2026_stl', title:'2026 TSDL Season Preview: St. Louis Cardinals',author:'Buster Olney',  date:'Feb 27, 2026', type:'season_preview', typeLabel:'Season Preview', url:'../season-previews/season_preview_2026_stl.html', thumbnail:'../assets/images/stl-preview.png', enabled:true },
  { id:'season_preview_2026_ari', title:'2026 TSDL Season Preview: Arizona Diamondbacks',author:'Jeff Passan', date:'Feb 26, 2026', type:'season_preview', typeLabel:'Season Preview', url:'../season-previews/season_preview_2026_ari.html', thumbnail:'../assets/images/ari-preview.png', enabled:true },
];

function createBTCRow(article) {
  const row = document.createElement('div');
  row.className = 'btc-article-row btc-article-row--edit';
  row.setAttribute('draggable', 'true');
  row.dataset.id = article.id || `a_${Date.now()}`;

  // Build type options
  const typeOpts = Object.entries(BTC_TYPE_LABELS).map(([v, l]) =>
    `<option value="${v}" ${article.type === v ? 'selected' : ''}>${l}</option>`
  ).join('');

  // Edit link for Firestore-based articles
  const isFirestore = (article.url || '').includes('view.html?slug=');
  const slugMatch   = isFirestore ? (article.url.match(/slug=([^&]+)/) || [])[1] : null;
  const editLinkHtml = isFirestore && slugMatch
    ? `<a href="btc-editor.html?slug=${esc(slugMatch)}" class="rb-admin-btn-edit" style="text-decoration:none;white-space:nowrap;flex-shrink:0;" title="Open full editor">&#9998; Editor</a>`
    : '';

  row.innerHTML = `
    ${MOVE_BTNS_HTML}
    <div style="display:flex;flex-direction:column;gap:3px;align-items:center;flex-shrink:0;">
      <img class="btc-row-thumb btc-thumb-preview" src="${esc(article.thumbnail)}" alt="" onerror="this.style.opacity='0.15'" style="width:56px;height:38px;object-fit:cover;border-radius:3px;background:#1A202C;">
      <input class="estn-admin-input btc-row-thumb-input" type="text" value="${esc(article.thumbnail)}" placeholder="Thumb URL" style="width:80px;font-size:0.6rem;padding:2px 4px;" title="Thumbnail image URL">
    </div>
    <div class="btc-row-meta" style="min-width:0;display:flex;flex-direction:column;gap:3px;">
      <input class="estn-admin-input btc-row-title-input" type="text" value="${esc(article.title)}" placeholder="Article title" style="width:100%;font-size:0.8rem;font-family:'Oswald',sans-serif;">
      <div style="display:flex;gap:5px;">
        <input class="estn-admin-input btc-row-author-input" type="text" value="${esc(article.author)}" placeholder="Author" style="flex:1;font-size:0.7rem;padding:3px 6px;">
        <input class="estn-admin-input btc-row-date-input"   type="text" value="${esc(article.date)}"   placeholder="Date" style="width:100px;font-size:0.7rem;padding:3px 6px;">
      </div>
      <input class="estn-admin-input btc-row-url-input" type="text" value="${esc(article.url)}" placeholder="Article URL (e.g. ../season-previews/...html or view.html?slug=...)" style="width:100%;font-size:0.65rem;padding:2px 6px;color:#A0AEC0;" title="URL of the article file">
    </div>
    <select class="estn-admin-input btc-row-type-select" style="font-size:0.65rem;padding:3px 6px;width:auto;flex-shrink:0;" title="Article category">${typeOpts}</select>
    ${editLinkHtml}
    <label class="estn-admin-toggle" title="Enabled in nav" style="flex-shrink:0;">
      <input type="checkbox" class="btc-enabled-toggle" ${article.enabled !== false ? 'checked' : ''}>
      <span class="estn-admin-toggle-slider"></span>
    </label>
    <button class="admin-delete-btn" title="Remove" style="flex-shrink:0;">&times;</button>
  `;

  // Live-update thumbnail preview when URL changes
  const thumbInput   = row.querySelector('.btc-row-thumb-input');
  const thumbPreview = row.querySelector('.btc-thumb-preview');
  thumbInput?.addEventListener('input', () => {
    thumbPreview.src = thumbInput.value.trim() || '';
  });

  row.querySelector('.admin-delete-btn').addEventListener('click', () => row.remove());
  addMoveListeners(row);
  return row;
}

function readBTCArticles() {
  return Array.from(document.querySelectorAll('#btc-article-rows .btc-article-row')).map(row => {
    const type = row.querySelector('.btc-row-type-select')?.value || '';
    return {
      id:        row.dataset.id,
      title:     row.querySelector('.btc-row-title-input')?.value?.trim()  || '',
      author:    row.querySelector('.btc-row-author-input')?.value?.trim() || '',
      date:      row.querySelector('.btc-row-date-input')?.value?.trim()   || '',
      type,
      typeLabel: BTC_TYPE_LABELS[type] || type,
      url:       row.querySelector('.btc-row-url-input')?.value?.trim()    || '',
      thumbnail: row.querySelector('.btc-row-thumb-input')?.value?.trim()  || '',
      enabled:   row.querySelector('.btc-enabled-toggle')?.checked !== false,
    };
  });
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
  const wrap = document.createElement('div');
  wrap.className = 'event-row-wrap';
  wrap.setAttribute('draggable', 'true');  // drag the whole wrap

  // ── Summary row (always visible) ──
  const row = document.createElement('div');
  row.className = 'event-row';
  row.dataset.id = ev.id || `ev_${Date.now()}`;
  row.innerHTML = `
    ${MOVE_BTNS_HTML}
    <div class="event-row-meta">
      <div class="event-row-name ev-display-name">${esc(ev.name)}</div>
      <div class="event-row-dates ev-display-dates">${esc(ev.startDate)}${ev.endDate ? ' – ' + esc(ev.endDate) : ''}</div>
    </div>
    <span class="event-cat-chip ev-display-cat ${esc(ev.category)}">${esc(CAT_LABELS[ev.category] || ev.category)}</span>
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
    <button class="ev-edit-btn" title="Edit event" style="background:#1E3A5F;color:#60A5FA;border:none;border-radius:4px;padding:3px 10px;font-family:'Oswald',sans-serif;font-size:0.72rem;cursor:pointer;white-space:nowrap;">Edit &#9660;</button>
    <button class="admin-delete-btn" title="Remove">&times;</button>
  `;

  // ── Expand-edit area (hidden by default) ──
  const editArea = document.createElement('div');
  editArea.className = 'ev-edit-area';
  editArea.style.display = 'none';
  editArea.innerHTML = `
    <div class="estn-admin-field-grid" style="max-width:680px;margin-top:10px;">
      <div class="estn-admin-field">
        <label class="estn-admin-label">Event Name</label>
        <input class="estn-admin-input ev-edit-name" type="text" value="${esc(ev.name)}" placeholder="Event name">
      </div>
      <div class="estn-admin-field">
        <label class="estn-admin-label">Category</label>
        <select class="estn-admin-input ev-edit-cat">
          <option value="preseason"  ${ev.category==='preseason'  ?'selected':''}>Pre-Season</option>
          <option value="inseason"   ${ev.category==='inseason'   ?'selected':''}>In-Season</option>
          <option value="playoffs"   ${ev.category==='playoffs'   ?'selected':''}>Playoffs</option>
          <option value="offseason"  ${ev.category==='offseason'  ?'selected':''}>Off-Season</option>
        </select>
      </div>
      <div class="estn-admin-field">
        <label class="estn-admin-label">Start Date</label>
        <input class="estn-admin-input ev-edit-start" type="text" value="${esc(ev.startDate)}" placeholder="YYYY-MM-DD">
      </div>
      <div class="estn-admin-field">
        <label class="estn-admin-label">End Date (optional)</label>
        <input class="estn-admin-input ev-edit-end" type="text" value="${esc(ev.endDate || '')}" placeholder="YYYY-MM-DD">
      </div>
      <div class="estn-admin-field" style="grid-column:span 2;">
        <label class="estn-admin-label">Description</label>
        <textarea class="estn-admin-textarea ev-edit-desc" rows="2">${esc(ev.description || '')}</textarea>
      </div>
    </div>
    <button class="ev-collapse-btn" style="margin-top:8px;background:#1A2030;color:#718096;border:1px solid #2D3748;border-radius:4px;padding:3px 10px;font-family:'Oswald',sans-serif;font-size:0.72rem;cursor:pointer;">Collapse &#9650;</button>
  `;

  // Toggle expand/collapse
  row.querySelector('.ev-edit-btn').addEventListener('click', () => {
    const open = editArea.style.display !== 'none';
    editArea.style.display = open ? 'none' : 'block';
    row.querySelector('.ev-edit-btn').textContent = open ? 'Edit ▼' : 'Collapse ▲';
  });
  editArea.querySelector('.ev-collapse-btn').addEventListener('click', () => {
    editArea.style.display = 'none';
    row.querySelector('.ev-edit-btn').textContent = 'Edit ▼';
  });

  // Keep summary display in sync as user edits
  editArea.querySelector('.ev-edit-name').addEventListener('input', e => {
    row.querySelector('.ev-display-name').textContent = e.target.value;
  });
  editArea.querySelector('.ev-edit-start').addEventListener('input', () => {
    const s = editArea.querySelector('.ev-edit-start').value;
    const e2 = editArea.querySelector('.ev-edit-end').value;
    row.querySelector('.ev-display-dates').textContent = s + (e2 ? ' – ' + e2 : '');
  });
  editArea.querySelector('.ev-edit-end').addEventListener('input', () => {
    const s = editArea.querySelector('.ev-edit-start').value;
    const e2 = editArea.querySelector('.ev-edit-end').value;
    row.querySelector('.ev-display-dates').textContent = s + (e2 ? ' – ' + e2 : '');
  });
  editArea.querySelector('.ev-edit-cat').addEventListener('change', e => {
    const cat = e.target.value;
    const chip = row.querySelector('.ev-display-cat');
    chip.className = `event-cat-chip ev-display-cat ${cat}`;
    chip.textContent = CAT_LABELS[cat] || cat;
  });

  row.querySelector('.admin-delete-btn').addEventListener('click', () => wrap.remove());

  wrap.appendChild(row);
  wrap.appendChild(editArea);
  addMoveListeners(wrap);  // must be after children are appended so querySelector finds the buttons
  return wrap;
}

function readEvents() {
  return Array.from(document.querySelectorAll('#events-rows .event-row-wrap')).map(wrap => {
    const row      = wrap.querySelector('.event-row');
    const editArea = wrap.querySelector('.ev-edit-area');
    const name     = editArea?.querySelector('.ev-edit-name')?.value?.trim()  || row?.querySelector('.ev-display-name')?.textContent || '';
    const cat      = editArea?.querySelector('.ev-edit-cat')?.value           || '';
    const start    = editArea?.querySelector('.ev-edit-start')?.value?.trim() || '';
    const end      = editArea?.querySelector('.ev-edit-end')?.value?.trim()   || '';
    const desc     = editArea?.querySelector('.ev-edit-desc')?.value?.trim()  || '';
    return {
      id:             row?.dataset.id           || '',
      name,
      category:       cat,
      startDate:      start,
      endDate:        end,
      description:    desc,
      statusOverride: row?.querySelector('.ev-status-override')?.value || null,
      enabled:        row?.querySelector('.ev-enabled-toggle')?.checked !== false,
    };
  });
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
    ${MOVE_BTNS_HTML}
    <button class="admin-delete-btn" title="Remove">&times;</button>
  `;
  row.querySelector('.admin-delete-btn').addEventListener('click', () => row.remove());
  addMoveListeners(row);
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
    ${MOVE_BTNS_HTML}
    <button class="admin-delete-btn" title="Remove">&times;</button>
  `;
  row.querySelector('.admin-delete-btn').addEventListener('click', () => row.remove());
  addMoveListeners(row);
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
        ${MOVE_BTNS_HTML}
        <button class="admin-delete-btn trib-ed-delete" data-slug="${esc(ed.slug)}" title="Remove from index">&times;</button>
      `;
      row.querySelector('.trib-ed-delete').addEventListener('click', () => {
        if (confirm(`Remove "${ed.headline}" from the Tribune index?\n\nThe Firestore content will remain and can be restored.`)) {
          row.remove();
        }
      });
      addMoveListeners(row);
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
  initRumblrTab();
});

// ══════════════════════════════════════════════════════════════════════════════
// Rumblr Tab — ported from rumblr-admin.js
// Uses existing esc(), showToast(), firestore, and AI_WRITERS from imports above.
// ══════════════════════════════════════════════════════════════════════════════

// Working copy of AI writers (loaded from Firestore, falls back to hardcoded)
let _rumblrWriters = [...AI_WRITERS];

async function initRumblrTab() {
  // 3A: Load writers from Firestore, or seed if first time
  try {
    const snap = await getDoc(doc(firestore, 'settings', 'ai_writers'));
    if (snap.exists() && Array.isArray(snap.data().writers) && snap.data().writers.length) {
      _rumblrWriters = snap.data().writers;
    } else {
      // Seed Firestore with hardcoded defaults on first use
      await setDoc(doc(firestore, 'settings', 'ai_writers'), { writers: AI_WRITERS }, { merge: true });
      _rumblrWriters = [...AI_WRITERS];
    }
  } catch (e) {
    console.warn('Could not load AI writers from Firestore, using defaults:', e);
    _rumblrWriters = [...AI_WRITERS];
  }

  loadPendingUsersRumblr();
  loadAllUsersRumblr();
  loadAIWritersRumblr();
  loadRecentPostsRumblr();
  initWriterPanelsRumblr();
}

// ── Pending Verifications ─────────────────────────────────────────────────────
async function loadPendingUsersRumblr() {
  const container = document.getElementById('rb-pending-list');
  const badge     = document.getElementById('rb-pending-badge');
  if (!container) return;

  try {
    const snap = await getDocs(query(
      collection(firestore, 'users'),
      where('verified', '==', false)
    ));

    if (badge) {
      badge.textContent = snap.size;
      badge.style.display = snap.size > 0 ? 'inline' : 'none';
    }

    if (snap.empty) {
      container.innerHTML = '<p style="color:#4A5568;font-family:\'Marcellus\',serif;font-size:0.82rem;">No pending accounts.</p>';
      return;
    }

    container.innerHTML = '';
    snap.forEach(d => {
      const u = d.data();
      const avatarHtml = u.avatar_url
        ? `<img src="${esc(u.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none';">`
        : esc((u.team_abbrev || '?').slice(0, 3));
      const row = document.createElement('div');
      row.className = 'rb-admin-user-row';
      row.innerHTML = `
        <div class="rb-post-avatar" style="background:${u.team_color || '#555'};width:36px;height:36px;font-size:0.72rem;overflow:hidden;">${avatarHtml}</div>
        <div class="rb-admin-user-info">
          <div class="rb-admin-user-name">${esc(u.display_name)} &nbsp;<span style="color:#718096;">${esc(u.handle)}</span></div>
          <div class="rb-admin-user-detail">${esc(u.team_name)} &nbsp;&middot;&nbsp; ${esc(u.email)}</div>
          <div class="rb-admin-user-detail" style="color:#4A5568;">Joined ${u.joined_at?.toDate ? u.joined_at.toDate().toLocaleDateString() : '—'}</div>
        </div>
        <button class="rb-admin-btn-approve" data-uid="${d.id}">Approve</button>
        <button class="rb-admin-btn-reject"  data-uid="${d.id}">Reject</button>
      `;
      row.querySelector('.rb-admin-btn-approve').addEventListener('click', () => approveUserRumblr(d.id, row, badge));
      row.querySelector('.rb-admin-btn-reject').addEventListener('click',  () => rejectUserRumblr(d.id, u.email, row, badge));
      container.appendChild(row);
    });
  } catch (e) {
    container.innerHTML = '<p style="color:#F87171;font-family:\'Marcellus\',serif;font-size:0.82rem;">Error loading pending users.</p>';
    console.error('loadPendingUsersRumblr:', e);
  }
}

async function approveUserRumblr(uid, rowEl, badgeEl) {
  if (!confirm('Approve this account and grant the ⚾ verified badge?')) return;
  await updateDoc(doc(firestore, 'users', uid), { verified: true });
  rowEl.remove();
  showToast('Account approved!');
  if (badgeEl) {
    const n = Math.max(0, parseInt(badgeEl.textContent) - 1);
    badgeEl.textContent = n;
    badgeEl.style.display = n > 0 ? 'inline' : 'none';
  }
}

async function rejectUserRumblr(uid, email, rowEl, badgeEl) {
  if (!confirm(`Reject and delete account for ${email}? This cannot be undone.`)) return;
  await deleteDoc(doc(firestore, 'users', uid));
  rowEl.remove();
  showToast('Account rejected and profile deleted.');
  if (badgeEl) {
    const n = Math.max(0, parseInt(badgeEl.textContent) - 1);
    badgeEl.textContent = n;
    badgeEl.style.display = n > 0 ? 'inline' : 'none';
  }
}

// ── All Accounts ──────────────────────────────────────────────────────────────
async function loadAllUsersRumblr() {
  const container = document.getElementById('rb-all-users-list');
  if (!container) return;

  try {
    const snap = await getDocs(query(
      collection(firestore, 'users'),
      orderBy('joined_at', 'desc'),
      limit(50)
    ));

    if (snap.empty) {
      container.innerHTML = '<p style="color:#4A5568;font-family:\'Marcellus\',serif;font-size:0.82rem;">No accounts yet.</p>';
      return;
    }

    container.innerHTML = '';
    snap.forEach(d => {
      const u = d.data();
      const displayName = u.display_name || u.email || '(unknown)';
      const avatarHtml = u.avatar_url
        ? `<img src="${esc(u.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none';">`
        : esc((u.team_abbrev || '?').slice(0, 3));

      const row = document.createElement('div');
      row.className = 'rb-admin-user-row';
      row.innerHTML = `
        <div class="rb-post-avatar" style="background:${u.team_color || '#555'};width:36px;height:36px;font-size:0.72rem;overflow:hidden;">${avatarHtml}</div>
        <div class="rb-admin-user-info">
          <div class="rb-admin-user-name">${esc(displayName)} ${u.verified ? '<span class="rb-verified" title="Verified">⚾</span>' : ''}</div>
          <div class="rb-admin-user-detail">${esc(u.handle || '')} &nbsp;&middot;&nbsp; ${esc(u.team_name || u.account_type || '')}</div>
          <div class="rb-admin-user-detail" style="color:#4A5568;font-size:0.78rem;">${esc(u.email || '')}</div>
        </div>
        <span style="font-family:'Oswald',sans-serif;font-size:0.8rem;color:#718096;">${u.post_count || 0} posts</span>
        ${!u.verified ? `<button class="rb-admin-btn-approve" data-uid="${d.id}">Verify</button>` : ''}
        <button class="rb-admin-btn-edit-avatar-rumblr" title="Edit avatar URL"
          style="font-size:0.72rem;padding:3px 8px;background:#1A2030;border:1px solid #2D3748;color:#E2E8F0;border-radius:4px;cursor:pointer;">&#9998;</button>
        <button class="rb-admin-btn-reject rb-admin-btn-del-user-rumblr" data-uid="${d.id}"
          style="font-size:0.72rem;padding:3px 8px;" title="Delete profile">&#128465;</button>
      `;

      const verifyBtn = row.querySelector('.rb-admin-btn-approve');
      if (verifyBtn) verifyBtn.addEventListener('click', () => approveUserRumblr(d.id, verifyBtn.parentElement, null));

      const avatarCircle = row.querySelector('.rb-post-avatar');
      row.querySelector('.rb-admin-btn-edit-avatar-rumblr').addEventListener('click', async () => {
        const newUrl = prompt(`Avatar URL for ${displayName}:\n(leave blank to remove)`, u.avatar_url || '');
        if (newUrl === null) return;
        const url = newUrl.trim() || null;
        await updateDoc(doc(firestore, 'users', d.id), { avatar_url: url });
        u.avatar_url = url;
        avatarCircle.innerHTML = url
          ? `<img src="${esc(url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none';">`
          : esc((u.team_abbrev || '?').slice(0, 3));
        showToast('Avatar updated!');
      });

      row.querySelector('.rb-admin-btn-del-user-rumblr').addEventListener('click', async () => {
        if (!confirm(`Delete account for ${u.email || displayName}? Removes the Firestore profile but NOT their Firebase Auth login.`)) return;
        await deleteDoc(doc(firestore, 'users', d.id));
        row.remove();
        showToast('Profile deleted.');
      });

      container.appendChild(row);
    });
  } catch (e) {
    container.innerHTML = '<p style="color:#F87171;font-family:\'Marcellus\',serif;font-size:0.82rem;">Error loading accounts.</p>';
    console.error('loadAllUsersRumblr:', e);
  }
}

// ── AI Writers ────────────────────────────────────────────────────────────────
function loadAIWritersRumblr() {
  const container = document.getElementById('rb-ai-writers-list');
  if (!container) return;

  function renderWriterRows() {
    container.innerHTML = '';
    _rumblrWriters.forEach((w, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'border:1px solid #2D3748;border-radius:6px;padding:10px 12px;margin-bottom:8px;background:#0D1117;';
      row.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
          <div class="rb-post-avatar rw-avatar-preview" style="background:${esc(w.color||'#555')};width:40px;height:40px;flex-shrink:0;overflow:hidden;border-radius:50%;">
            <img src="${esc(w.image||'')}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';">
          </div>
          <span style="font-family:'Oswald',sans-serif;font-size:0.85rem;color:#E2E8F0;flex:1;">${esc(w.name)}</span>
          <button class="admin-delete-btn rw-delete" title="Remove writer" style="flex-shrink:0;">&times;</button>
        </div>
        <div class="estn-admin-field-grid" style="max-width:680px;">
          <div class="estn-admin-field">
            <label class="estn-admin-label">Display Name</label>
            <input class="estn-admin-input rw-name" type="text" value="${esc(w.name||'')}" placeholder="e.g. Jeff Passan">
          </div>
          <div class="estn-admin-field">
            <label class="estn-admin-label">Handle</label>
            <input class="estn-admin-input rw-handle" type="text" value="${esc(w.handle||'')}" placeholder="@Handle">
          </div>
          <div class="estn-admin-field">
            <label class="estn-admin-label">Avatar Image URL</label>
            <input class="estn-admin-input rw-image" type="text" value="${esc(w.image||'')}" placeholder="https://…">
          </div>
          <div class="estn-admin-field">
            <label class="estn-admin-label">Avatar Color (fallback)</label>
            <input class="estn-admin-input rw-color" type="color" value="${esc(w.color||'#1E3A5F')}" style="height:32px;padding:2px 4px;width:80px;">
          </div>
          <div class="estn-admin-field" style="grid-column:span 2;">
            <label class="estn-admin-label">Bio</label>
            <input class="estn-admin-input rw-bio" type="text" value="${esc(w.bio||'')}" placeholder="Short bio text">
          </div>
          <div class="estn-admin-field">
            <label class="estn-admin-label">Followers</label>
            <input class="estn-admin-input rw-followers" type="number" value="${w.stats?.followers||0}" min="0">
          </div>
          <div class="estn-admin-field">
            <label class="estn-admin-label">Following</label>
            <input class="estn-admin-input rw-following" type="number" value="${w.stats?.following||0}" min="0">
          </div>
          <div class="estn-admin-field">
            <label class="estn-admin-label">Posts</label>
            <input class="estn-admin-input rw-posts" type="number" value="${w.stats?.posts||0}" min="0">
          </div>
          <div class="estn-admin-field">
            <label class="estn-admin-label">Initials (avatar fallback)</label>
            <input class="estn-admin-input rw-initials" type="text" value="${esc(w.initials||'')}" placeholder="JP" style="width:60px;">
          </div>
        </div>
      `;
      // Live update avatar preview when image/color changes
      const imgInput   = row.querySelector('.rw-image');
      const colInput   = row.querySelector('.rw-color');
      const nameInput  = row.querySelector('.rw-name');
      const avatarDiv  = row.querySelector('.rw-avatar-preview');
      const imgEl      = avatarDiv.querySelector('img');
      imgInput.addEventListener('input', () => { imgEl.src = imgInput.value.trim(); imgEl.style.display = ''; });
      colInput.addEventListener('input', () => { avatarDiv.style.background = colInput.value; });
      // Live update displayed name in header
      nameInput.addEventListener('input', () => {
        row.querySelector('span').textContent = nameInput.value;
      });
      // Delete
      row.querySelector('.rw-delete').addEventListener('click', () => {
        _rumblrWriters.splice(i, 1);
        renderWriterRows();
      });
      container.appendChild(row);
    });
  }

  renderWriterRows();

  // "Add Writer" button
  document.getElementById('rb-add-writer-btn')?.addEventListener('click', () => {
    _rumblrWriters.push({ name:'New Writer', handle:'@NewWriter', color:'#2D3748', initials:'NW', image:'', bio:'', bannerColor:'#0D1117', stats:{ followers:0, following:0, posts:0 } });
    renderWriterRows();
    container.lastElementChild?.scrollIntoView({ behavior:'smooth' });
  });

  // "Save AI Writers" button
  document.getElementById('rb-save-writers-btn')?.addEventListener('click', async () => {
    // Read current values from inputs back into _rumblrWriters
    const rows = container.querySelectorAll(':scope > div');
    _rumblrWriters = Array.from(rows).map(row => ({
      name:        row.querySelector('.rw-name')?.value?.trim()       || '',
      handle:      row.querySelector('.rw-handle')?.value?.trim()     || '',
      image:       row.querySelector('.rw-image')?.value?.trim()      || '',
      color:       row.querySelector('.rw-color')?.value              || '#555',
      bio:         row.querySelector('.rw-bio')?.value?.trim()        || '',
      initials:    row.querySelector('.rw-initials')?.value?.trim()   || '',
      bannerColor: '#0D1117',
      stats: {
        followers: parseInt(row.querySelector('.rw-followers')?.value) || 0,
        following: parseInt(row.querySelector('.rw-following')?.value) || 0,
        posts:     parseInt(row.querySelector('.rw-posts')?.value)     || 0,
      },
    }));
    try {
      await setDoc(doc(firestore, 'settings', 'ai_writers'), { writers: _rumblrWriters });
      showToast('AI Writers saved.');
      // Refresh dropdowns
      _repopulateWriterDropdowns();
    } catch (err) {
      showToast('Error saving writers: ' + (err.message || 'unknown'), true);
    }
  });
}

function _repopulateWriterDropdowns() {
  ['rb-new-post-writer', 'rb-reply-writer', 'rb-follow-writer'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    // Clear all but placeholder
    while (sel.options.length > 1) sel.remove(1);
    _rumblrWriters.forEach((w, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${w.name} (${w.handle})`;
      sel.appendChild(opt);
    });
    sel.value = cur;
  });
}

// ── Recent Posts ──────────────────────────────────────────────────────────────
async function loadRecentPostsRumblr() {
  const container = document.getElementById('rb-recent-posts-list');
  if (!container) return;

  try {
    const snap = await getDocs(query(
      collection(firestore, 'posts'),
      orderBy('timestamp', 'desc'),
      limit(100)
    ));

    if (snap.empty) {
      container.innerHTML = '<p style="color:#4A5568;font-family:\'Marcellus\',serif;font-size:0.82rem;">No posts yet.</p>';
      return;
    }

    const allPosts = [];
    snap.forEach(d => allPosts.push({ id: d.id, ...d.data() }));

    // Wire up the static filter buttons already in HTML
    let activeFilter = 'all';
    const filterBar = document.getElementById('rb-post-filter-bar');
    if (filterBar) {
      filterBar.querySelectorAll('.rb-admin-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          filterBar.querySelectorAll('.rb-admin-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeFilter = btn.dataset.filter;
          renderPostsRumblr();
        });
      });
    }

    function renderPostsRumblr() {
      container.innerHTML = '';
      const filtered = allPosts.filter(p => {
        if (activeFilter === 'ai')      return p.author_type === 'ai' && !p.parent_post_id;
        if (activeFilter === 'user')    return p.author_type !== 'ai' && !p.parent_post_id;
        if (activeFilter === 'reply')   return !!p.parent_post_id;
        return true;
      });

      if (!filtered.length) {
        container.innerHTML = '<p style="color:#4A5568;font-family:\'Marcellus\',serif;font-size:0.82rem;">No posts in this category.</p>';
        return;
      }

      filtered.forEach(p => {
        const isAI    = p.author_type === 'ai';
        const isReply = !!p.parent_post_id;
        const typeLabel = isReply ? 'reply' : isAI ? 'ai' : 'user';
        const typeColor = isReply ? '#4A5568' : isAI ? '#2E6B3E' : '#1E3A5F';

        const row = document.createElement('div');
        row.className = 'rb-admin-post-row';
        row.innerHTML = `
          <div class="rb-admin-post-header">
            <div class="rb-post-avatar" style="background:${p.author_avatar_color || '#555'};width:28px;height:28px;font-size:0.65rem;flex-shrink:0;">
              ${p.author_initials || '?'}
            </div>
            <span class="rb-admin-post-name">${esc(p.author_name)}</span>
            <span class="rb-admin-post-handle">${esc(p.author_handle)}</span>
            <span class="rb-admin-type-badge" style="background:${typeColor};">${typeLabel}</span>
            <span class="rb-admin-post-ts">${p.timestamp?.toDate ? p.timestamp.toDate().toLocaleString() : ''}</span>
          </div>
          ${isReply ? `<div style="font-size:0.72rem;color:#4A5568;margin-bottom:5px;">&#8618; Reply to <code style="background:#0D1117;padding:1px 4px;border-radius:3px;font-size:0.7rem;">${p.parent_post_id}</code></div>` : ''}
          <div class="rb-admin-post-content">${esc(p.content)}</div>
          <div class="rb-admin-post-actions">
            <button class="rb-admin-btn-edit">&#9998; Edit</button>
            <button class="rb-admin-btn-reject">&#128465; Delete</button>
            <span class="rb-admin-post-stats">&#9829; ${p.like_count || 0} &nbsp; &#128172; ${p.reply_count || 0} &nbsp; &#8635; ${p.repost_count || 0}</span>
          </div>
          <div class="rb-admin-edit-area">
            <textarea class="rb-admin-edit-textarea" rows="3">${esc(p.content)}</textarea>
            <div class="rb-admin-edit-btns">
              <button class="estn-admin-btn rb-save-edit-btn" style="font-size:0.78rem;padding:4px 14px;">Save</button>
              <button class="estn-admin-btn secondary rb-cancel-edit-btn" style="font-size:0.78rem;padding:4px 14px;">Cancel</button>
            </div>
          </div>
        `;

        const contentDiv   = row.querySelector('.rb-admin-post-content');
        const editArea     = row.querySelector('.rb-admin-edit-area');
        const editTextarea = row.querySelector('.rb-admin-edit-textarea');
        const editBtn      = row.querySelector('.rb-admin-btn-edit');

        row.querySelector('.rb-admin-btn-reject').addEventListener('click', async () => {
          if (!confirm('Delete this post permanently?')) return;
          await deleteDoc(doc(firestore, 'posts', p.id));
          row.remove();
          const idx = allPosts.findIndex(x => x.id === p.id);
          if (idx !== -1) allPosts.splice(idx, 1);
          showToast('Post deleted.');
        });

        editBtn.addEventListener('click', () => {
          editArea.style.display = 'block';
          editBtn.style.display = 'none';
          editTextarea.focus();
        });

        row.querySelector('.rb-cancel-edit-btn').addEventListener('click', () => {
          editArea.style.display = 'none';
          editBtn.style.display = '';
          editTextarea.value = p.content;
        });

        row.querySelector('.rb-save-edit-btn').addEventListener('click', async () => {
          const newContent = editTextarea.value.trim();
          if (!newContent) { showToast('Content cannot be empty.'); return; }
          await updateDoc(doc(firestore, 'posts', p.id), { content: newContent });
          p.content = newContent;
          contentDiv.textContent = newContent;
          editArea.style.display = 'none';
          editBtn.style.display = '';
          showToast('Post updated.');
        });

        container.appendChild(row);
      });
    }

    renderPostsRumblr();
  } catch (e) {
    container.innerHTML = '<p style="color:#F87171;font-family:\'Marcellus\',serif;font-size:0.82rem;">Error loading posts.</p>';
    console.error('loadRecentPostsRumblr:', e);
  }
}

// ── Writer Reply + Follow Panels ──────────────────────────────────────────────
function initWriterPanelsRumblr() {
  // Populate all writer dropdowns from _rumblrWriters
  ['rb-new-post-writer', 'rb-reply-writer', 'rb-follow-writer'].forEach(selectId => {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    _rumblrWriters.forEach((w, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${w.name} (${w.handle})`;
      sel.appendChild(opt);
    });
  });

  // ── Handle autofill (Writer Follow) ─────────────────────────────────────
  const followHandleInput = document.getElementById('rb-follow-handle');
  const followHandleDL    = document.getElementById('rb-follow-handle-list');
  let _handlesFetched = false;
  followHandleInput?.addEventListener('focus', async () => {
    if (_handlesFetched || !followHandleDL) return;
    _handlesFetched = true;
    try {
      const snap = await getDocs(query(
        collection(firestore, 'users'),
        orderBy('handle'),
        limit(50)
      ));
      snap.forEach(d => {
        const handle = d.data().handle;
        if (handle) {
          const opt = document.createElement('option');
          opt.value = handle;
          followHandleDL.appendChild(opt);
        }
      });
    } catch { /* autofill optional — silently ignore errors */ }
  });

  // ── Create New Writer Post ───────────────────────────────────────────────
  const newPostContent = document.getElementById('rb-new-post-content');
  const newPostChar    = document.getElementById('rb-new-post-char');
  if (newPostContent && newPostChar) {
    newPostContent.addEventListener('input', () => {
      newPostChar.textContent = (280 - newPostContent.value.length) + ' remaining';
    });
  }

  const newPostBtn = document.getElementById('rb-new-post-btn');
  if (newPostBtn) {
    newPostBtn.addEventListener('click', async () => {
      const writerIdx = document.getElementById('rb-new-post-writer')?.value;
      const content   = newPostContent?.value.trim();
      const imageUrl  = document.getElementById('rb-new-post-image')?.value.trim() || null;
      const resultEl  = document.getElementById('rb-new-post-result');

      if (writerIdx === '' || !content) {
        showToast('Select a writer and enter post content.');
        return;
      }
      const writer   = _rumblrWriters[parseInt(writerIdx)];
      const hashtags = [...content.matchAll(/#(\w+)/g)].map(m => '#' + m[1]);

      newPostBtn.disabled = true;
      try {
        await addDoc(collection(firestore, 'posts'), {
          content,
          image_url:           imageUrl,
          author_type:         'ai',
          author_name:         writer.name,
          author_handle:       writer.handle,
          author_uid:          null,
          author_avatar_color: writer.color,
          author_initials:     writer.initials,
          author_image:        writer.image,
          author_verified:     true,
          hashtags,
          is_ai_generated:     true,
          like_count:          0,
          reply_count:         0,
          repost_count:        0,
          timestamp:           serverTimestamp(),
        });
        if (resultEl) {
          resultEl.style.display = 'block';
          resultEl.style.color   = '#48BB78';
          resultEl.textContent   = `Post published as ${writer.name}!`;
        }
        if (newPostContent) newPostContent.value = '';
        if (newPostChar)    newPostChar.textContent = '280 remaining';
        if (document.getElementById('rb-new-post-image')) document.getElementById('rb-new-post-image').value = '';
        showToast(`Post published as ${writer.name}`);
      } catch (err) {
        console.error('New writer post error:', err);
        showToast('Error publishing post. Check console.', true);
      } finally {
        newPostBtn.disabled = false;
      }
    });
  }

  // Char counter
  const replyContent = document.getElementById('rb-reply-content');
  const replyChar    = document.getElementById('rb-reply-char');
  if (replyContent && replyChar) {
    replyContent.addEventListener('input', () => {
      replyChar.textContent = (280 - replyContent.value.length) + ' remaining';
    });
  }

  // Writer Reply submit
  const replyBtn = document.getElementById('rb-reply-submit-btn');
  if (replyBtn) {
    replyBtn.addEventListener('click', async () => {
      const writerIdx = document.getElementById('rb-reply-writer')?.value;
      const postId    = document.getElementById('rb-reply-post-id')?.value.trim();
      const content   = replyContent?.value.trim();
      const resultEl  = document.getElementById('rb-reply-result');

      if (writerIdx === '' || !postId || !content) {
        showToast('Fill in all fields before posting.');
        return;
      }
      const writer = _rumblrWriters[parseInt(writerIdx)];
      const hashtags = [...content.matchAll(/#(\w+)/g)].map(m => '#' + m[1]);

      replyBtn.disabled = true;
      try {
        const parentSnap = await getDoc(doc(firestore, 'posts', postId));
        if (!parentSnap.exists()) {
          showToast('Post ID not found. Double-check and try again.');
          replyBtn.disabled = false;
          return;
        }
        await addDoc(collection(firestore, 'posts'), {
          content,
          parent_post_id:      postId,
          author_type:         'ai',
          author_name:         writer.name,
          author_handle:       writer.handle,
          author_uid:          null,
          author_avatar_color: writer.color,
          author_initials:     writer.initials,
          author_image:        writer.image,
          author_verified:     true,
          hashtags,
          is_ai_generated:     true,
          like_count:          0,
          reply_count:         0,
          repost_count:        0,
          timestamp:           serverTimestamp(),
        });
        await updateDoc(doc(firestore, 'posts', postId), { reply_count: increment(1) });
        if (resultEl) {
          resultEl.style.display = 'block';
          resultEl.style.color = '#48BB78';
          resultEl.textContent = `Reply posted as ${writer.name}!`;
        }
        if (replyContent) replyContent.value = '';
        if (replyChar) replyChar.textContent = '280 remaining';
        showToast(`Reply posted as ${writer.name}`);
      } catch (err) {
        console.error('Writer reply error:', err);
        showToast('Error posting reply. Check console.', true);
      } finally {
        replyBtn.disabled = false;
      }
    });
  }

  // Writer Follow submit
  const followBtn = document.getElementById('rb-follow-submit-btn');
  if (followBtn) {
    followBtn.addEventListener('click', async () => {
      const writerIdx  = document.getElementById('rb-follow-writer')?.value;
      const userHandle = document.getElementById('rb-follow-handle')?.value.trim();
      const resultEl   = document.getElementById('rb-follow-result');

      if (writerIdx === '' || !userHandle) {
        showToast('Select a writer and enter a handle.');
        return;
      }
      const writer = _rumblrWriters[parseInt(writerIdx)];
      const handle = userHandle.startsWith('@') ? userHandle : '@' + userHandle;
      const followId = `ai_${writer.handle.replace(/[^a-zA-Z0-9]/g, '_')}_${handle.replace(/[^a-zA-Z0-9]/g, '_')}`;

      followBtn.disabled = true;
      try {
        await setDoc(doc(firestore, 'ai_follows', followId), {
          follower_handle: writer.handle,
          follower_type:   'ai',
          followed_handle: handle,
          timestamp:       serverTimestamp(),
        });
        if (resultEl) {
          resultEl.style.display = 'block';
          resultEl.style.color = '#48BB78';
          resultEl.textContent = `${writer.name} is now following ${handle}`;
        }
        const handleInput = document.getElementById('rb-follow-handle');
        if (handleInput) handleInput.value = '';
        showToast(`${writer.name} now follows ${handle}`);
      } catch (err) {
        console.error('Writer follow error:', err);
        showToast('Error recording follow. Check console.', true);
      } finally {
        followBtn.disabled = false;
      }
    });
  }
}
