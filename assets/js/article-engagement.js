/**
 * article-engagement.js — The Sandlot Tribune
 *
 * Handles read counters, star ratings, and comments for all articles.
 * Import this module from any article page.
 *
 * Usage (add to bottom of article HTML):
 *
 *   <script type="module">
 *     import { initEngagement } from '../assets/js/article-engagement.js';
 *     initEngagement('season_preview_2026_ari');
 *   </script>
 *
 * Required HTML elements in the article (added by template):
 *   #engagement-view-count   — where "1,247 reads" appears
 *   #engagement-rating       — where "★ 4.2 (7)" appears (near byline)
 *   #rating-section          — the interactive rating widget container
 *   #comments-section        — the comments list + form container
 */

import { db } from './firebase-config.js';
import {
  ref, get, set, push, increment, onValue, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function starsHtml(avg, interactive = false, articleId = '') {
  const filled  = Math.round(avg);
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

// ─── Read Counter ────────────────────────────────────────────────────────────

async function trackView(articleId) {
  try {
    const viewRef = ref(db, `articles/${articleId}/views`);
    await set(viewRef, increment(1));
  } catch (e) {
    // Silent fail — don't break article if Firebase is misconfigured
  }
}

// ─── Rating Display (near byline — summary only) ─────────────────────────────

function listenRatingSummary(articleId, el) {
  if (!el) return;
  const ratingsRef = ref(db, `articles/${articleId}/ratings`);
  onValue(ratingsRef, snap => {
    const data = snap.val();
    if (!data) {
      el.innerHTML = '<span class="rating-summary-empty">No ratings yet</span>';
      return;
    }
    const values = Object.values(data).map(r => r.value).filter(v => typeof v === 'number');
    if (!values.length) {
      el.innerHTML = '<span class="rating-summary-empty">No ratings yet</span>';
      return;
    }
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
  const viewRef = ref(db, `articles/${articleId}/views`);
  onValue(viewRef, snap => {
    const v = snap.val() || 0;
    el.textContent = formatCount(v) + ' read' + (v !== 1 ? 's' : '');
  });
}

// ─── Rating Widget (interactive, bottom of article) ──────────────────────────

function renderRatingWidget(articleId, container) {
  if (!container) return;

  const storageKey = `rated_${articleId}`;
  const existing   = localStorage.getItem(storageKey);

  if (existing) {
    container.innerHTML =
      `<p class="rating-already-voted">You rated this article <strong>${existing} star${existing !== '1' ? 's' : ''}</strong>. Thank you!</p>`;
    return;
  }

  container.innerHTML = `
    <p class="rating-prompt">How would you rate this article?</p>
    <div class="rating-widget" id="rating-widget">
      ${starsHtml(0, true, articleId)}
    </div>
    <p class="rating-feedback" id="rating-feedback" aria-live="polite"></p>
  `;

  let hovered = 0;
  const widget = container.querySelector('#rating-widget');
  const stars  = Array.from(widget.querySelectorAll('.star-btn'));

  function updateStarDisplay(upTo) {
    stars.forEach((s, i) => {
      s.classList.toggle('active', i < upTo);
    });
  }

  stars.forEach((btn, idx) => {
    btn.addEventListener('mouseenter', () => { hovered = idx + 1; updateStarDisplay(hovered); });
    btn.addEventListener('mouseleave', () => { updateStarDisplay(0); });
    btn.addEventListener('click', async () => {
      const value = idx + 1;
      const feedback = container.querySelector('#rating-feedback');
      btn.disabled = true;
      stars.forEach(s => s.disabled = true);
      try {
        const ratingRef = ref(db, `articles/${articleId}/ratings`);
        await push(ratingRef, { value, timestamp: Date.now() });
        localStorage.setItem(storageKey, String(value));
        container.innerHTML =
          `<p class="rating-already-voted">You rated this article <strong>${value} star${value !== 1 ? 's' : ''}</strong>. Thank you!</p>`;
      } catch (e) {
        if (feedback) feedback.textContent = 'Could not save rating — please try again.';
        stars.forEach(s => s.disabled = false);
      }
    });
  });
}

// ─── Comments ────────────────────────────────────────────────────────────────

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

  list.innerHTML = sorted.map(c => `
    <div class="comment-item">
      <div class="comment-header">
        <span class="comment-name">${escapeHtml(c.name)}</span>
        <span class="comment-date">${timeAgo(c.timestamp)}</span>
      </div>
      <p class="comment-body">${escapeHtml(c.body).replace(/\n/g, '<br>')}</p>
    </div>
  `).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setupComments(articleId, container) {
  if (!container) return;

  container.innerHTML = `
    <div id="comments-list"><p class="comments-empty">Loading comments…</p></div>
    <form id="comment-form" class="comment-form" novalidate>
      <h4 class="comment-form-heading">Leave a Comment</h4>
      <div class="comment-form-fields">
        <input type="text" id="commenter-name" placeholder="Your name" maxlength="60" required>
        <textarea id="comment-body" placeholder="Write a comment…" rows="3" maxlength="1000" required></textarea>
      </div>
      <button type="submit" class="comment-submit">Post Comment</button>
      <p class="comment-error" id="comment-error" aria-live="polite"></p>
    </form>
  `;

  const commentsRef = ref(db, `articles/${articleId}/comments`);
  onValue(commentsRef, snap => renderComments(container, snap.val()));

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

    btn.disabled = true;
    btn.textContent = 'Posting…';
    try {
      await push(commentsRef, { name, body, timestamp: Date.now() });
      nameEl.value = '';
      bodyEl.value = '';
    } catch (err) {
      errorEl.textContent = 'Could not post comment — please try again.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Post Comment';
    }
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function initEngagement(articleId) {
  // 1. Track this page view
  trackView(articleId);

  // 2. Live view count (near byline)
  listenViewCount(articleId, document.getElementById('engagement-view-count'));

  // 3. Live rating summary (near byline)
  listenRatingSummary(articleId, document.getElementById('engagement-rating'));

  // 4. Interactive rating widget (bottom of article)
  renderRatingWidget(articleId, document.getElementById('rating-section'));

  // 5. Comments section (bottom of article)
  setupComments(articleId, document.getElementById('comments-section'));
}

/**
 * fetchCardRatings — call on hub pages (index pages) to populate card ratings.
 * Pass an array of article IDs; each must have an element with id="rating-{articleId}".
 *
 * Example:
 *   import { fetchCardRatings } from '../assets/js/article-engagement.js';
 *   fetchCardRatings(['season_preview_2026_ari', 'season_preview_2026_stl']);
 */
export function fetchCardRatings(articleIds) {
  articleIds.forEach(articleId => {
    const el = document.getElementById(`card-rating-${articleId}`);
    if (!el) return;
    const ratingsRef = ref(db, `articles/${articleId}/ratings`);
    onValue(ratingsRef, snap => {
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
