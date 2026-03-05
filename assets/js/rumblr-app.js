/**
 * rumblr-app.js — Rumblr Feed Logic
 * Handles feed loading, filtering, post rendering, and pagination.
 * Depends on: firebase-config.js (firestore, auth)
 */

import { firestore, auth } from './firebase-config.js';
import {
  collection, query, orderBy, limit, startAfter,
  where, getDocs, onSnapshot, doc, getDoc, updateDoc, increment
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initCompose }        from './rumblr-auth.js';
import { initInteractions }   from './rumblr-interactions.js';

// ── Constants ─────────────────────────────────────────────
const PAGE_SIZE    = 20;
const POSTS_COL    = collection(firestore, 'posts');

// ── AI Writers config ──────────────────────────────────────
export const AI_WRITERS = [
  { name: 'Jeff Passan',     handle: '@JeffPassan',    color: '#1E3A5F', initials: 'JP', image: '../assets/images/rumblr/jeff_passan.png' },
  { name: 'Ken Rosenthal',   handle: '@Ken_Rosenthal', color: '#C8102E', initials: 'KR', image: '../assets/images/rumblr/ken_rosenthal.png' },
  { name: 'Bob Nightengale', handle: '@BNightengale',  color: '#574C3F', initials: 'BN', image: '../assets/images/rumblr/bob_nightengale.png' },
  { name: 'Jon Heyman',      handle: '@JonHeyman',     color: '#2E6B3E', initials: 'JH', image: '../assets/images/rumblr/jon_heyman.png' },
  { name: 'Buster Olney',    handle: '@Buster_ESPN',   color: '#8B4513', initials: 'BO', image: '../assets/images/rumblr/buster_olney.png' },
  { name: 'Tim Kurkjian',    handle: '@TKurkjian',     color: '#4B0082', initials: 'TK', image: '../assets/images/rumblr/tim_kurkjian.png' },
  { name: 'Keith Law',       handle: '@Keithlaw',      color: '#B8860B', initials: 'KL', image: '../assets/images/rumblr/keith_law.png' },
  { name: 'Jason Stark',     handle: '@jaysonst',      color: '#C05020', initials: 'JST', image: '../assets/images/rumblr/jason_stark.png' },
  { name: 'Joel Sherman',    handle: '@joelsherman1',  color: '#1A6B8A', initials: 'JSH', image: '../assets/images/rumblr/joel_sherman.png' },
  { name: 'Peter Gammons',   handle: '@pgammo',        color: '#6B6B6B', initials: 'PG', image: '../assets/images/rumblr/peter_gammons.png' },
];

// ── State ─────────────────────────────────────────────────
let lastDoc        = null;
let activeFilter   = { type: 'all' };   // { type: 'all'|'tab'|'author'|'hashtag', value }
let currentUser    = null;
let currentUserDoc = null;
let loadingMore    = false;

// ── DOM refs (set after DOMContentLoaded) ─────────────────
let feedEl, filterBannerEl, loadMoreBtn, spinnerEl;

// ══════════════════════════════════════════════════════════
// Initialise
// ══════════════════════════════════════════════════════════
export function initFeed() {
  feedEl          = document.getElementById('rb-feed');
  filterBannerEl  = document.getElementById('rb-filter-banner');
  loadMoreBtn     = document.getElementById('rb-load-more-btn');
  spinnerEl       = document.getElementById('rb-spinner');

  // Auth state
  onAuthStateChanged(auth, async user => {
    currentUser = user;
    if (user) {
      const snap = await getDoc(doc(firestore, 'users', user.uid));
      currentUserDoc = snap.exists() ? snap.data() : null;
    } else {
      currentUserDoc = null;
    }
    renderAuthUI();
    initCompose(currentUser, currentUserDoc, refreshFeed);
  });

  // Tab listeners
  document.querySelectorAll('.rb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.rb-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabType = tab.dataset.tab;
      if (tabType === 'all') {
        clearFilter();
      } else {
        setFilter({ type: 'tab', value: tabType });
      }
    });
  });

  // Load initial feed
  loadFeed(true);

  // Load-more button
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => loadFeed(false));
  }

  // Populate author sidebar
  loadAuthorSidebar();

  // Hashtag search
  const hashSearch = document.getElementById('rb-hashtag-search');
  if (hashSearch) {
    hashSearch.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const tag = hashSearch.value.trim().replace(/^#/, '');
        if (tag) setFilter({ type: 'hashtag', value: tag });
      }
    });
  }
}

// ══════════════════════════════════════════════════════════
// Feed loading
// ══════════════════════════════════════════════════════════
async function loadFeed(reset = true) {
  if (loadingMore) return;
  loadingMore = true;

  if (reset) {
    lastDoc = null;
    feedEl.innerHTML = '';
    showSpinner(true);
  }
  if (loadMoreBtn) loadMoreBtn.style.display = 'none';

  try {
    const q = buildQuery();
    const snap = await getDocs(q);

    if (snap.empty && reset) {
      showEmpty();
      return;
    }

    snap.forEach(d => {
      feedEl.appendChild(renderPost(d.id, d.data()));
    });

    lastDoc = snap.docs[snap.docs.length - 1];

    // Show load-more if a full page was returned
    if (loadMoreBtn) {
      loadMoreBtn.style.display = snap.docs.length === PAGE_SIZE ? 'block' : 'none';
    }
  } catch (err) {
    console.error('Feed load error:', err);
    showToast('Error loading feed. Try refreshing.');
  } finally {
    showSpinner(false);
    loadingMore = false;
  }
}

function buildQuery() {
  let q;
  const base = [orderBy('timestamp', 'desc'), limit(PAGE_SIZE)];

  if (activeFilter.type === 'author') {
    q = query(POSTS_COL, where('author_handle', '==', activeFilter.value), ...base);
  } else if (activeFilter.type === 'hashtag') {
    q = query(POSTS_COL, where('hashtags', 'array-contains', '#' + activeFilter.value), ...base);
  } else if (activeFilter.type === 'tab' && activeFilter.value === 'writers') {
    q = query(POSTS_COL, where('author_type', '==', 'ai'), ...base);
  } else if (activeFilter.type === 'tab' && activeFilter.value === 'teams') {
    q = query(POSTS_COL, where('author_type', '==', 'user'), ...base);
  } else {
    // All top-level posts by recency (no composite index needed)
    q = query(POSTS_COL, ...base);
  }

  if (lastDoc) {
    // Rebuild with cursor (startAfter)
    if (activeFilter.type === 'author') {
      q = query(POSTS_COL, where('author_handle', '==', activeFilter.value),
                orderBy('timestamp', 'desc'), startAfter(lastDoc), limit(PAGE_SIZE));
    } else if (activeFilter.type === 'hashtag') {
      q = query(POSTS_COL, where('hashtags', 'array-contains', '#' + activeFilter.value),
                orderBy('timestamp', 'desc'), startAfter(lastDoc), limit(PAGE_SIZE));
    } else if (activeFilter.type === 'tab' && activeFilter.value === 'writers') {
      q = query(POSTS_COL, where('author_type', '==', 'ai'),
                orderBy('timestamp', 'desc'), startAfter(lastDoc), limit(PAGE_SIZE));
    } else if (activeFilter.type === 'tab' && activeFilter.value === 'teams') {
      q = query(POSTS_COL, where('author_type', '==', 'user'),
                orderBy('timestamp', 'desc'), startAfter(lastDoc), limit(PAGE_SIZE));
    } else {
      q = query(POSTS_COL, orderBy('timestamp', 'desc'), startAfter(lastDoc), limit(PAGE_SIZE));
    }
  }

  return q;
}

function refreshFeed() {
  loadFeed(true);
}

// ══════════════════════════════════════════════════════════
// Post rendering
// ══════════════════════════════════════════════════════════
export function renderPost(postId, data, isReply = false) {
  const el = document.createElement('div');
  el.className = 'rb-post';
  el.dataset.postId = postId;

  const timeAgo = formatTimeAgo(data.timestamp?.toDate ? data.timestamp.toDate() : new Date());
  const content  = linkifyContent(data.content || '');

  // Profile link: use handle for AI writers (author_uid is null), uid for regular users
  const profileHref = data.author_uid
    ? `profile.html?uid=${data.author_uid}`
    : `profile.html?handle=${encodeURIComponent(data.author_handle || '')}`;

  // Avatar: use image if available, fall back to colored initials
  const avatarHtml = data.author_image
    ? `<img class="rb-post-avatar rb-post-avatar-img" src="${escHtml(data.author_image)}"
           alt="${escHtml(data.author_name)}" title="${escHtml(data.author_name)}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
       <div class="rb-post-avatar" style="background:${data.author_avatar_color || '#555'};display:none;"
            title="${escHtml(data.author_name)}">${escHtml(data.author_initials || '??')}</div>`
    : `<div class="rb-post-avatar" style="background:${data.author_avatar_color || '#555'}"
           title="${escHtml(data.author_name)}">${escHtml(data.author_initials || '??')}</div>`;

  // Article link (if post references an article)
  const articleLinkHtml = data.article_url
    ? `<a class="rb-article-link" href="${escHtml(data.article_url)}" onclick="event.stopPropagation()">
         Read Article &rarr;
       </a>`
    : '';

  el.innerHTML = `
    <div class="rb-post-avatar-wrap">
      ${avatarHtml}
    </div>
    <div class="rb-post-body">
      <div class="rb-post-header">
        <a class="rb-post-name" href="${profileHref}" onclick="event.stopPropagation()">
          ${escHtml(data.author_name)}
        </a>
        ${data.author_verified ? '<span class="rb-verified" title="Verified">⚾</span>' : ''}
        <span class="rb-post-handle">${escHtml(data.author_handle)}</span>
        <span class="rb-post-time">${timeAgo}</span>
      </div>
      <div class="rb-post-content">${content}</div>
      ${articleLinkHtml}
      <div class="rb-engagement">
        <button class="rb-engage-btn rb-reply-btn" title="Reply" onclick="event.stopPropagation()">
          <span class="rb-engage-icon">💬</span>
          <span class="rb-reply-count">${data.reply_count || 0}</span>
        </button>
        <button class="rb-engage-btn rb-repost-btn" title="Repost" onclick="event.stopPropagation()">
          <span class="rb-engage-icon">🔁</span>
          <span class="rb-repost-count">${data.repost_count || 0}</span>
        </button>
        <button class="rb-engage-btn rb-like-btn" title="Like" onclick="event.stopPropagation()">
          <span class="rb-engage-icon rb-heart">🤍</span>
          <span class="rb-like-count">${data.like_count || 0}</span>
        </button>
        <button class="rb-engage-btn rb-share-btn" title="Copy link" onclick="event.stopPropagation()">
          <span class="rb-engage-icon">🔗</span>
        </button>
      </div>
    </div>
  `;

  // Navigate to post page on card click (but not on links/buttons)
  el.addEventListener('click', e => {
    if (e.target.closest('a, button')) return;
    window.location.href = `post.html?id=${postId}`;
  });

  // Wire up interactions after render
  initInteractions(el, postId, data, currentUser);

  return el;
}

// ══════════════════════════════════════════════════════════
// Author sidebar — Users: ESTN Writers (collapsible) + TSDL Owners
// ══════════════════════════════════════════════════════════
async function loadAuthorSidebar() {
  const sidebar = document.getElementById('rb-author-sidebar');
  if (!sidebar) return;

  // ── ESTN Writers (collapsible) ──────────────────────────
  const writersSection = document.getElementById('rb-writers-section');
  if (writersSection) {
    writersSection.innerHTML = AI_WRITERS.map(w => `
      <div class="rb-sidebar-link rb-sidebar-writer" data-handle="${w.handle}" role="button" tabindex="0">
        <div class="rb-sidebar-avatar-wrap">
          <img class="rb-sidebar-avatar-img" src="${w.image}" alt="${w.name}"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
          <div class="rb-sidebar-avatar" style="background:${w.color};display:none;">${w.initials}</div>
        </div>
        <span>${w.name}</span>
      </div>
    `).join('');

    writersSection.querySelectorAll('.rb-sidebar-writer').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.rb-sidebar-link').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        setFilter({ type: 'author', value: el.dataset.handle });
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter') el.click(); });
    });
  }

  // Collapsible toggle
  const writersToggle = document.getElementById('rb-writers-toggle');
  if (writersToggle && writersSection) {
    writersToggle.addEventListener('click', () => {
      const isOpen = writersSection.style.display !== 'none';
      writersSection.style.display = isOpen ? 'none' : 'block';
      const chevron = writersToggle.querySelector('.rb-group-chevron');
      if (chevron) chevron.textContent = isOpen ? '▶' : '▼';
    });
  }

  // ── TSDL Owners (dynamic from Firestore) ───────────────
  const ownersSection = document.getElementById('rb-owners-section');
  if (ownersSection) {
    try {
      const snap = await getDocs(query(
        collection(firestore, 'users'),
        where('author_type', '!=', 'ai'),
        orderBy('author_type'),
        orderBy('joined_at', 'desc'),
        limit(30)
      ));

      if (snap.empty) {
        // Fallback: query without filter (users collection has all team owners)
        const allSnap = await getDocs(query(
          collection(firestore, 'users'),
          orderBy('joined_at', 'asc'),
          limit(30)
        ));
        renderOwners(ownersSection, allSnap);
      } else {
        renderOwners(ownersSection, snap);
      }
    } catch (err) {
      // Simple fallback query
      try {
        const snap = await getDocs(query(
          collection(firestore, 'users'),
          orderBy('joined_at', 'asc'),
          limit(30)
        ));
        renderOwners(ownersSection, snap);
      } catch (_) {
        ownersSection.innerHTML = '<div style="font-size:0.8rem;color:var(--rb-subtle);padding:4px 16px;">No accounts yet.</div>';
      }
    }
  }
}

function renderOwners(container, snap) {
  if (snap.empty) {
    container.innerHTML = '<div style="font-size:0.8rem;color:var(--rb-subtle);padding:4px 16px;">No accounts yet.</div>';
    return;
  }
  container.innerHTML = snap.docs.map(d => {
    const u = d.data();
    const avatarHtml = u.avatar_url
      ? `<img class="rb-sidebar-avatar-img" src="${escHtml(u.avatar_url)}" alt="${escHtml(u.display_name)}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
         <div class="rb-sidebar-avatar" style="background:${u.team_color||'#555'};display:none;">${escHtml((u.team_abbrev||'?').slice(0,3))}</div>`
      : `<div class="rb-sidebar-avatar" style="background:${u.team_color||'#555'}">${escHtml((u.team_abbrev||'?').slice(0,3))}</div>`;
    return `
      <div class="rb-sidebar-link rb-sidebar-owner" data-uid="${d.id}" data-handle="${escHtml(u.handle||'')}" role="button" tabindex="0">
        <div class="rb-sidebar-avatar-wrap">${avatarHtml}</div>
        <div>
          <div>${escHtml(u.display_name)}</div>
          <div style="font-size:0.75rem;color:var(--rb-subtle);">${escHtml(u.team_name||'')}</div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.rb-sidebar-owner').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.rb-sidebar-link').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      setFilter({ type: 'author', value: el.dataset.handle });
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.click(); });
  });
}

// ══════════════════════════════════════════════════════════
// Filtering
// ══════════════════════════════════════════════════════════
export function setFilter(filter) {
  activeFilter = filter;
  updateFilterBanner();
  loadFeed(true);
}

export function clearFilter() {
  activeFilter = { type: 'all' };
  if (filterBannerEl) filterBannerEl.style.display = 'none';
  document.querySelectorAll('.rb-sidebar-link').forEach(e => e.classList.remove('active'));
  loadFeed(true);
}

function updateFilterBanner() {
  if (!filterBannerEl) return;
  if (activeFilter.type === 'all') {
    filterBannerEl.style.display = 'none';
    return;
  }
  const label = activeFilter.type === 'hashtag'
    ? `Posts tagged <strong>#${activeFilter.value}</strong>`
    : activeFilter.type === 'author'
    ? `Posts by <strong>${activeFilter.value}</strong>`
    : `Tab: <strong>${activeFilter.value}</strong>`;
  filterBannerEl.style.display = 'flex';
  filterBannerEl.querySelector('.rb-filter-label').innerHTML = label;
}

// ══════════════════════════════════════════════════════════
// Auth UI
// ══════════════════════════════════════════════════════════
function renderAuthUI() {
  const signInBtn  = document.getElementById('rb-signin-btn');
  const signOutBtn = document.getElementById('rb-signout-btn');
  const userMenu   = document.getElementById('rb-user-menu');
  const composeWrap = document.getElementById('rb-compose-wrap');
  const profileLink = document.getElementById('rb-profile-link');

  if (currentUser) {
    if (signInBtn)  signInBtn.style.display  = 'none';
    if (signOutBtn) signOutBtn.style.display = 'inline-flex';
    if (userMenu)   userMenu.style.display   = 'flex';
    if (composeWrap) composeWrap.style.display = 'block';
    // Set profile link to include user's UID so their profile loads correctly
    if (profileLink) profileLink.href = `profile.html?uid=${currentUser.uid}`;

    if (currentUserDoc && userMenu) {
      const av = userMenu.querySelector('.rb-header-avatar');
      if (av) {
        if (currentUserDoc.avatar_url) {
          av.innerHTML = `<img src="${escHtml(currentUserDoc.avatar_url)}" alt="Profile"
                              style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
                              onerror="this.style.display='none';">`;
        } else {
          av.style.background = currentUserDoc.team_color || '#555';
          av.textContent = (currentUserDoc.team_abbrev || '?').slice(0, 3);
        }
      }
    }
  } else {
    if (signInBtn)  signInBtn.style.display  = 'inline-flex';
    if (signOutBtn) signOutBtn.style.display = 'none';
    if (userMenu)   userMenu.style.display   = 'none';
    if (composeWrap) composeWrap.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════
function linkifyContent(text) {
  return escHtml(text).replace(/#(\w+)/g,
    (_, tag) => `<span class="rb-hashtag" data-tag="${tag}" onclick="window.__rumblrHashtag('${tag}')">#${tag}</span>`
  );
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTimeAgo(date) {
  if (!date) return '';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)    return `${diff}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function showSpinner(on) {
  if (spinnerEl) spinnerEl.style.display = on ? 'block' : 'none';
}

function showEmpty() {
  feedEl.innerHTML = `
    <div class="rb-empty">
      <div class="rb-empty-icon">📭</div>
      <div class="rb-empty-msg">No Rumbl'ings here yet.</div>
      <div class="rb-empty-sub">Check back after the next update!</div>
    </div>
  `;
}

export function showToast(msg) {
  const container = document.querySelector('.rb-toast-container')
    || (() => {
      const c = document.createElement('div');
      c.className = 'rb-toast-container';
      document.body.appendChild(c);
      return c;
    })();
  const toast = document.createElement('div');
  toast.className = 'rb-toast';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Global callback for hashtag clicks (called from inline onclick)
window.__rumblrHashtag = tag => {
  // Deactivate tabs
  document.querySelectorAll('.rb-tab').forEach(t => t.classList.remove('active'));
  setFilter({ type: 'hashtag', value: tag });
};
