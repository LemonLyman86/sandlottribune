/**
 * article-engagement.js — The Sandlot Tribune
 *
 * Handles read counters, star ratings, and comments for all articles.
 * Styles are injected automatically — no per-article CSS needed.
 *
 * Usage (add to bottom of article HTML):
 *
 *   <script type="module">
 *     import { initEngagement } from '../assets/js/article-engagement.js';
 *     initEngagement('season_preview_2026_ari');
 *   </script>
 *
 * Required HTML elements in the article:
 *   #engagement-view-count   — where "1,247 reads" appears (near byline)
 *   #engagement-rating       — where "★ 4.2 (7)" appears (near byline)
 *   #rating-section          — the interactive rating widget container
 *   #comments-section        — the comments list + form container
 */

import { db } from './firebase-config.js';
import {
  ref, get, set, push, increment, onValue, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ─── Style Injection ─────────────────────────────────────────────────────────

function injectEngagementStyles() {
  if (document.getElementById('estn-engagement-styles')) return;
  const style = document.createElement('style');
  style.id = 'estn-engagement-styles';
  style.textContent = `
/* ── Engagement Section Wrapper ── */
.article-engagement-section {
  border-top: 2px solid #e8e8e8;
  margin-top: 56px;
  padding-top: 40px;
}
.article-engagement-section + .article-engagement-section {
  border-top: 1px solid #e8e8e8;
  margin-top: 48px;
}
.article-engagement-section h3 {
  font-family: 'Arial', 'Helvetica Neue', sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #1a1a1a;
  margin: 0 0 24px;
  padding-bottom: 10px;
  border-bottom: 3px solid #BA2B2B;
  display: inline-block;
}

/* ── Near-byline summary ── */
.engagement-byline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 10px;
}
#engagement-view-count {
  font-family: 'Arial', sans-serif;
  font-size: 0.78em;
  color: #999;
}
#engagement-rating {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'Arial', sans-serif;
  font-size: 0.78em;
  color: #999;
  min-height: 1.2em;
}

/* ── Stars (summary / card) ── */
.stars-row { display: inline-flex; gap: 1px; line-height: 1; }
.star-pip  { color: #d0d0d0; font-size: 1em; }
.star-pip.filled { color: #F4A623; }
.rating-avg   { font-weight: 700; color: #1a1a1a; margin-left: 3px; }
.rating-count { color: #999; }
.rating-summary-empty { color: #bbb; font-style: italic; }

/* ── Rating Widget ── */
.rating-prompt {
  font-family: 'Arial', sans-serif;
  font-size: 0.9rem;
  color: #444;
  margin: 0 0 14px;
  font-weight: 500;
}
.rating-widget {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.star-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 2.2rem;
  color: #d0d0d0;
  padding: 0 2px;
  line-height: 1;
  transition: color 0.1s, transform 0.1s;
  -webkit-tap-highlight-color: transparent;
}
.star-btn:hover,
.star-btn.active { color: #F4A623; transform: scale(1.15); }
.rating-feedback {
  font-family: 'Arial', sans-serif;
  font-size: 0.82rem;
  color: #e03030;
  margin: 4px 0 0;
  min-height: 1.2em;
}
.rating-already-voted {
  font-family: 'Arial', sans-serif;
  font-size: 0.9rem;
  color: #2e7d32;
  background: #f0faf0;
  border: 1px solid #c8e6c9;
  border-radius: 6px;
  padding: 12px 16px;
  margin: 0;
  display: inline-block;
}

/* ── Comments List ── */
#comments-list { margin-bottom: 36px; }

.comments-empty {
  font-family: 'Arial', sans-serif;
  font-size: 0.88rem;
  color: #999;
  font-style: italic;
  margin: 0 0 24px;
}

.comment-item {
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 12px;
  padding: 18px 0;
  border-bottom: 1px solid #f0f0f0;
}
.comment-item:first-child { border-top: 1px solid #f0f0f0; }

.comment-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #BA2B2B;
  color: #fff;
  font-family: 'Arial', sans-serif;
  font-size: 0.88rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.comment-main { min-width: 0; }

.comment-header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.comment-name {
  font-family: 'Arial', sans-serif;
  font-size: 0.88rem;
  font-weight: 700;
  color: #1a1a1a;
}
.comment-date {
  font-family: 'Arial', sans-serif;
  font-size: 0.75rem;
  color: #aaa;
  margin-left: auto;
}
.comment-body {
  font-family: 'Georgia', serif;
  font-size: 0.9rem;
  line-height: 1.65;
  color: #333;
  margin: 0;
}

/* ── Comment Form ── */
.comment-form-heading {
  font-family: 'Arial', sans-serif;
  font-size: 0.82rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #555;
  margin: 0 0 14px;
}
.comment-form { margin-top: 8px; }

.comment-form-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}
.comment-form input[type="text"],
.comment-form textarea {
  font-family: 'Arial', sans-serif;
  font-size: 0.9rem;
  color: #1a1a1a;
  background: #fafafa;
  border: 1.5px solid #ddd;
  border-radius: 4px;
  padding: 10px 14px;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 0.15s, box-shadow 0.15s;
  resize: vertical;
  outline: none;
}
.comment-form input[type="text"]:focus,
.comment-form textarea:focus {
  border-color: #BA2B2B;
  box-shadow: 0 0 0 3px rgba(186,43,43,0.10);
  background: #fff;
}
.comment-form input::placeholder,
.comment-form textarea::placeholder { color: #bbb; }

.comment-submit {
  font-family: 'Arial', sans-serif;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: #BA2B2B;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 10px 22px;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.comment-submit:hover  { background: #9a2020; }
.comment-submit:active { transform: scale(0.98); }
.comment-submit:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.comment-error {
  font-family: 'Arial', sans-serif;
  font-size: 0.8rem;
  color: #c00;
  margin: 8px 0 0;
  min-height: 1.2em;
}

/* ── Card ratings (hub pages) ── */
.card-rating-row .stars-row { gap: 0; }
.card-rating-row .star-pip  { font-size: 0.75em; }
.card-rating-row .rating-avg   { font-size: 0.72em; }
.card-rating-row .rating-count { font-size: 0.68em; }

@media (max-width: 600px) {
  .star-btn { font-size: 1.9rem; }
  .comment-item { grid-template-columns: 34px 1fr; gap: 10px; }
  .comment-avatar { width: 34px; height: 34px; font-size: 0.78rem; }
}
  `;
  document.head.appendChild(style);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function getInitials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  '#BA2B2B','#1E3A5F','#2E6B3E','#8B4513',
  '#4B0082','#B8860B','#1A6B8A','#574C3F',
];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function starsHtml(avg, interactive = false) {
  const filled = Math.round(avg);
  let html = '<span class="stars-row">';
  for (let i = 1; i <= 5; i++) {
    if (interactive) {
      html += `<button class="star-btn${i <= filled ? ' active' : ''}" data-value="${i}" aria-label="${i} star${i > 1 ? 's' : ''}" title="${i} star${i > 1 ? 's' : ''}">★</button>`;
    } else {
      html += `<span class="star-pip${i <= filled ? ' filled' : ''}">★</span>`;
    }
  }
  html += '</span>';
  return html;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Read Counter ─────────────────────────────────────────────────────────────

async function trackView(articleId) {
  try {
    await set(ref(db, `articles/${articleId}/views`), increment(1));
  } catch (e) { /* silent */ }
}

// ─── Rating Summary (near byline) ────────────────────────────────────────────

function listenRatingSummary(articleId, el) {
  if (!el) return;
  onValue(ref(db, `articles/${articleId}/ratings`), snap => {
    const data = snap.val();
    if (!data) { el.innerHTML = '<span class="rating-summary-empty">No ratings yet</span>'; return; }
    const values = Object.values(data).map(r => r.value).filter(v => typeof v === 'number');
    if (!values.length) { el.innerHTML = '<span class="rating-summary-empty">No ratings yet</span>'; return; }
    const avg   = values.reduce((a, b) => a + b, 0) / values.length;
    const count = values.length;
    el.innerHTML =
      starsHtml(avg) +
      `<span class="rating-avg">${avg.toFixed(1)}</span>` +
      `<span class="rating-count">(${count} rating${count !== 1 ? 's' : ''})</span>`;
  });
}

function listenViewCount(articleId, el) {
  if (!el) return;
  onValue(ref(db, `articles/${articleId}/views`), snap => {
    const v = snap.val() || 0;
    el.textContent = formatCount(v) + ' read' + (v !== 1 ? 's' : '');
  });
}

// ─── Rating Widget ────────────────────────────────────────────────────────────

function renderRatingWidget(articleId, container) {
  if (!container) return;
  const storageKey = `rated_${articleId}`;
  const existing   = localStorage.getItem(storageKey);

  if (existing) {
    container.innerHTML =
      `<p class="rating-already-voted">You rated this article <strong>${existing} star${existing !== '1' ? 's' : ''}</strong> — thanks for the feedback!</p>`;
    return;
  }

  container.innerHTML = `
    <p class="rating-prompt">How would you rate this article?</p>
    <div class="rating-widget" id="rating-widget">
      ${starsHtml(0, true)}
    </div>
    <p class="rating-feedback" id="rating-feedback" aria-live="polite"></p>
  `;

  const widget = container.querySelector('#rating-widget');
  const stars  = Array.from(widget.querySelectorAll('.star-btn'));

  function paint(upTo) {
    stars.forEach((s, i) => s.classList.toggle('active', i < upTo));
  }

  stars.forEach((btn, idx) => {
    btn.addEventListener('mouseenter', () => paint(idx + 1));
    btn.addEventListener('mouseleave', () => paint(0));
    btn.addEventListener('click', async () => {
      const value    = idx + 1;
      const feedback = container.querySelector('#rating-feedback');
      stars.forEach(s => s.disabled = true);
      try {
        await push(ref(db, `articles/${articleId}/ratings`), { value, timestamp: Date.now() });
        localStorage.setItem(storageKey, String(value));
        container.innerHTML =
          `<p class="rating-already-voted">You rated this article <strong>${value} star${value !== 1 ? 's' : ''}</strong> — thanks for the feedback!</p>`;
      } catch (e) {
        if (feedback) feedback.textContent = 'Could not save rating — please try again.';
        stars.forEach(s => s.disabled = false);
      }
    });
  });
}

// ─── Comments ─────────────────────────────────────────────────────────────────

function renderComments(container, comments) {
  const list = container.querySelector('#comments-list');
  if (!list) return;
  if (!comments || !Object.keys(comments).length) {
    list.innerHTML = '<p class="comments-empty">No comments yet. Be the first!</p>';
    return;
  }
  const sorted = Object.entries(comments)
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => b.timestamp - a.timestamp);

  list.innerHTML = sorted.map(c => {
    const initials = getInitials(c.name || '?');
    const color    = avatarColor(c.name || '');
    return `
    <div class="comment-item">
      <div class="comment-avatar" style="background:${color}">${initials}</div>
      <div class="comment-main">
        <div class="comment-header">
          <span class="comment-name">${escapeHtml(c.name)}</span>
          <span class="comment-date">${timeAgo(c.timestamp)}</span>
        </div>
        <p class="comment-body">${escapeHtml(c.body).replace(/\n/g, '<br>')}</p>
      </div>
    </div>`;
  }).join('');
}

function setupComments(articleId, container) {
  if (!container) return;

  container.innerHTML = `
    <div id="comments-list"><p class="comments-empty">Loading…</p></div>
    <form id="comment-form" class="comment-form" novalidate>
      <h4 class="comment-form-heading">Join the discussion</h4>
      <div class="comment-form-fields">
        <input type="text" id="commenter-name" placeholder="Your name" maxlength="60" required>
        <textarea id="comment-body" placeholder="What do you think?" rows="3" maxlength="1000" required></textarea>
      </div>
      <button type="submit" class="comment-submit">Post Comment</button>
      <p class="comment-error" id="comment-error" aria-live="polite"></p>
    </form>
  `;

  onValue(ref(db, `articles/${articleId}/comments`), snap => renderComments(container, snap.val()));

  container.querySelector('#comment-form').addEventListener('submit', async e => {
    e.preventDefault();
    const nameEl  = container.querySelector('#commenter-name');
    const bodyEl  = container.querySelector('#comment-body');
    const errorEl = container.querySelector('#comment-error');
    const btn     = container.querySelector('.comment-submit');
    const name    = nameEl.value.trim();
    const body    = bodyEl.value.trim();
    errorEl.textContent = '';

    if (!name) { errorEl.textContent = 'Please enter your name.'; nameEl.focus(); return; }
    if (!body) { errorEl.textContent = 'Please write a comment.'; bodyEl.focus(); return; }

    btn.disabled    = true;
    btn.textContent = 'Posting…';
    try {
      await push(ref(db, `articles/${articleId}/comments`), { name, body, timestamp: Date.now() });
      nameEl.value = '';
      bodyEl.value = '';
    } catch (err) {
      errorEl.textContent = 'Could not post comment — please try again.';
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Post Comment';
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initEngagement(articleId) {
  injectEngagementStyles();
  trackView(articleId);
  listenViewCount(articleId, document.getElementById('engagement-view-count'));
  listenRatingSummary(articleId, document.getElementById('engagement-rating'));
  renderRatingWidget(articleId, document.getElementById('rating-section'));
  setupComments(articleId, document.getElementById('comments-section'));
}

/**
 * fetchCardRatings — call on hub pages to populate article card ratings.
 * Each article ID must have a matching element with id="card-rating-{articleId}".
 */
export function fetchCardRatings(articleIds) {
  articleIds.forEach(articleId => {
    const el = document.getElementById(`card-rating-${articleId}`);
    if (!el) return;
    onValue(ref(db, `articles/${articleId}/ratings`), snap => {
      const data = snap.val();
      if (!data) { el.innerHTML = ''; return; }
      const values = Object.values(data).map(r => r.value).filter(v => typeof v === 'number');
      if (!values.length) { el.innerHTML = ''; return; }
      const avg   = values.reduce((a, b) => a + b, 0) / values.length;
      const count = values.length;
      el.innerHTML =
        starsHtml(avg) +
        `<span class="rating-avg">${avg.toFixed(1)}</span>` +
        `<span class="rating-count">(${count})</span>`;
    });
  });
}
