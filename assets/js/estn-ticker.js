/**
 * estn-ticker.js — Shared ESTN Ticker Loader
 *
 * Injects the ticker bar on any page that is enabled in the admin.
 * Include this as a module script on any page that should support the ticker.
 *
 * Page keys: 'home', 'league-records', 'season-deadlines',
 *            'between-the-chalk', 'tribune', 'rumblr', 'about'
 */

import { firestore } from './firebase-config.js';
import {
  doc, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Determine which page we're on from the URL path
function detectPageKey() {
  const path = window.location.pathname.toLowerCase();
  if (path.includes('league-records'))   return 'league-records';
  if (path.includes('season-deadlines')) return 'season-deadlines';
  if (path.includes('between-the-chalk'))return 'between-the-chalk';
  if (path.includes('tribune'))          return 'tribune';
  if (path.includes('rumblr'))           return 'rumblr';
  if (path.includes('about'))            return 'about';
  // Treat root / index.html as home (handled separately by estn-portal.js)
  return 'home';
}

function buildTickerHTML(firstItem) {
  return `
<div class="estn-ticker" id="estn-ticker-bar" role="status" aria-label="ESTN Ticker">
  <span class="estn-ticker-label">ESTN</span>
  <div class="estn-ticker-track">
    <span class="estn-ticker-text" id="estn-ticker-text">${firstItem}</span>
  </div>
</div>`;
}

function startTickerCycle(items, textEl) {
  if (!textEl || items.length <= 1) return;
  textEl.style.transition = 'opacity 0.4s ease';
  let idx = 0;
  setInterval(() => {
    textEl.style.opacity = '0';
    setTimeout(() => {
      idx = (idx + 1) % items.length;
      textEl.textContent = items[idx];
      textEl.style.opacity = '1';
    }, 400);
  }, 5000);
}

async function loadAndInjectTicker() {
  const pageKey = detectPageKey();

  // 'home' is handled by estn-portal.js — skip double-injection
  if (pageKey === 'home') return;

  try {
    const snap = await getDoc(doc(firestore, 'settings', 'ticker'));
    if (!snap.exists()) return;

    const td = snap.data();
    if (td.enabled === false) return;
    if (!td.items || !td.items.length) return;

    // Check if this page is allowed — if ticker_pages is absent/empty treat as "all pages"
    const allowedPages = td.ticker_pages;
    if (allowedPages && allowedPages.length > 0 && !allowedPages.includes(pageKey)) return;

    // Find insertion point: right after the <header>
    const header = document.querySelector('header.estn-portal-nav');
    if (!header) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildTickerHTML(td.items[0]);
    header.insertAdjacentElement('afterend', wrapper.firstElementChild);

    const textEl = document.getElementById('estn-ticker-text');
    startTickerCycle(td.items, textEl);
  } catch { /* silently fail */ }
}

loadAndInjectTicker();
