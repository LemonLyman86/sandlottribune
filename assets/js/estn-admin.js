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
  await setDoc(doc(firestore, 'settings', 'estn'), data, { merge: true });
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
  });
}

// ── Ticker ─────────────────────────────────────────────────────────────────────
async function initTicker() {
  try {
    const snap = await getDoc(doc(firestore, 'settings', 'ticker'));
    if (snap.exists()) {
      const td = snap.data();
      const enabledEl = document.getElementById('ticker-enabled');
      const itemsEl   = document.getElementById('ticker-items');
      if (enabledEl) enabledEl.checked = td.enabled !== false;
      if (itemsEl && td.items) itemsEl.value = td.items.join('\n');
    }
  } catch { /* use defaults */ }

  document.getElementById('save-ticker-btn')?.addEventListener('click', async () => {
    const enabled = document.getElementById('ticker-enabled')?.checked ?? true;
    const raw = document.getElementById('ticker-items')?.value || '';
    const items = raw.split('\n').map(s => s.trim()).filter(Boolean);
    await setDoc(doc(firestore, 'settings', 'ticker'), {
      enabled,
      items,
      updated_at: serverTimestamp()
    }, { merge: true });
    showToast('Ticker saved.');
  });
}

// ── Custom headlines ───────────────────────────────────────────────────────────
function renderHeadlinesList(headlines) {
  const container = document.getElementById('headlines-list');
  if (!container) return;
  container.innerHTML = '';
  (headlines || []).forEach((h, i) => {
    const row = document.createElement('div');
    row.className = 'estn-admin-link-row';
    row.innerHTML = `
      <input class="estn-admin-input" type="text" value="${h.replace(/"/g, '&quot;')}" data-idx="${i}" placeholder="Headline text">
      <button class="estn-admin-remove-btn" data-idx="${i}">Remove</button>`;
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
    row.innerHTML = `
      <input class="estn-admin-input" type="text" placeholder="Headline text">
      <button class="estn-admin-remove-btn">Remove</button>`;
    row.querySelector('.estn-admin-remove-btn').addEventListener('click', () => row.remove());
    container.appendChild(row);
  });

  document.getElementById('save-headlines-btn')?.addEventListener('click', async () => {
    const inputs = document.querySelectorAll('#headlines-list .estn-admin-input');
    const headlines = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
    await saveSettings({ custom_headlines: headlines });
    showToast('Headlines saved.');
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
    const rows = document.querySelectorAll('#quick-links-list .estn-admin-link-row');
    const links = Array.from(rows).map(r => ({
      label: r.querySelector('.link-label')?.value.trim() || '',
      url:   r.querySelector('.link-url')?.value.trim()   || '',
    })).filter(l => l.label && l.url);
    await saveSettings({ quick_links: links });
    showToast('Quick links saved.');
  });

  document.getElementById('reset-links-btn')?.addEventListener('click', async () => {
    renderLinksList(DEFAULT_LINKS);
    await saveSettings({ quick_links: null });
    showToast('Quick links reset to defaults.');
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
    const hiddenPrograms = [];
    const check = (id, progId) => { if (!document.getElementById(id)?.checked) hiddenPrograms.push(progId); };
    check('prog-rumblr',  'rumblr');
    check('prog-tribune', 'tribune');
    check('prog-podcast', 'podcast');
    await saveSettings({ hidden_programs: hiddenPrograms });
    showToast('Programs visibility saved.');
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

  const settings = await getSettings();

  initFeatured(settings);
  initTicker();
  initHeadlines(settings);
  initAds(settings);
  initQuickLinks(settings);
  initPrograms(settings);
  loadDataStatus();
});
