/**
 * rumblr-app.js — Rumblr Feed Logic
 * Handles feed loading, filtering, post rendering, and pagination.
 * Depends on: firebase-config.js (firestore, auth)
 */

import { firestore, auth } from './firebase-config.js';
import {
  collection, query, orderBy, limit, startAfter,
  where, getDocs, onSnapshot, doc, getDoc, updateDoc, increment,
  setDoc, deleteDoc, getCountFromServer, addDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { initCompose }        from './rumblr-auth.js';
import { initInteractions }   from './rumblr-interactions.js';

// ── Constants ─────────────────────────────────────────────
const PAGE_SIZE    = 20;
const POSTS_COL    = collection(firestore, 'posts');

// ── User avatar cache (avoids redundant Firestore reads) ──
const userAvatarCache = {}; // uid → url|null
async function fetchUserAvatar(uid) {
  if (uid in userAvatarCache) return userAvatarCache[uid];
  try {
    const snap = await getDoc(doc(firestore, 'users', uid));
    const url = snap.exists() ? (snap.data().avatar_url || null) : null;
    userAvatarCache[uid] = url;
    return url;
  } catch { return null; }
}

// ── AI Writers config ──────────────────────────────────────
export const AI_WRITERS = [
  { name: 'Jeff Passan',     handle: '@JeffPassan',    color: '#1E3A5F', initials: 'JP',  image: '../assets/images/rumblr/jeff_passan.png',    bio: 'MLB Insider @ESPN. Breaking news, deep analysis, and the occasional dad joke. Covering the game since 2000.',     bannerColor: '#0D1E40', stats: { followers: 2847302, following: 412,  posts: 8441  } },
  { name: 'Ken Rosenthal',   handle: '@Ken_Rosenthal', color: '#C8102E', initials: 'KR',  image: '../assets/images/rumblr/ken_rosenthal.png',  bio: 'Fox Sports / The Athletic. 30+ years covering baseball. Still faster than your timeline.',                      bannerColor: '#3A0510', stats: { followers: 814500,  following: 1203, posts: 21044 } },
  { name: 'Bob Nightengale', handle: '@BNightengale',  color: '#574C3F', initials: 'BN',  image: '../assets/images/rumblr/bob_nightengale.png', bio: 'USA Today baseball columnist. Hot takes, roster moves, and bad coffee.',                                          bannerColor: '#2B2318', stats: { followers: 502800,  following: 822,  posts: 15300 } },
  { name: 'Jon Heyman',      handle: '@JonHeyman',     color: '#2E6B3E', initials: 'JH',  image: '../assets/images/rumblr/jon_heyman.png',     bio: 'MLB Network / FanSided. First to know, first to tweet. Blocking trolls since 2009.',                              bannerColor: '#0E2B18', stats: { followers: 618000,  following: 544,  posts: 18720 } },
  { name: 'Buster Olney',    handle: '@Buster_ESPN',   color: '#8B4513', initials: 'BO',  image: '../assets/images/rumblr/buster_olney.png',   bio: "ESPN. Author. Former NYT Yankees beat reporter. Watching baseball since '78.",                                    bannerColor: '#3A1A05', stats: { followers: 724100,  following: 310,  posts: 11200 } },
  { name: 'Tim Kurkjian',    handle: '@TKurkjian',     color: '#4B0082', initials: 'TK',  image: '../assets/images/rumblr/tim_kurkjian.png',   bio: 'ESPN analyst. Author of "Is This a Great Game or What?" Spoiler: Yes. Yes it is.',                                bannerColor: '#1E0038', stats: { followers: 221000,  following: 178,  posts: 9440  } },
  { name: 'Keith Law',       handle: '@Keithlaw',      color: '#B8860B', initials: 'KL',  image: '../assets/images/rumblr/keith_law.png',      bio: "The Athletic. Prospect guru. Rates your favorite team's farm system too low on purpose.",                         bannerColor: '#2E2000', stats: { followers: 312500,  following: 290,  posts: 7830  } },
  { name: 'Jason Stark',     handle: '@jaysonst',      color: '#C05020', initials: 'JST', image: '../assets/images/rumblr/jason_stark.png',    bio: 'The Athletic. Hall of Fame voter. Covering baseball since the Reagan administration.',                             bannerColor: '#2E0E00', stats: { followers: 396000,  following: 201,  posts: 12100 } },
  { name: 'Joel Sherman',    handle: '@joelsherman1',  color: '#1A6B8A', initials: 'JSH', image: '../assets/images/rumblr/joel_sherman.png',   bio: 'NY Post baseball columnist. Breaking transactions, deadline drama, and Yankee gossip.',                            bannerColor: '#081E2A', stats: { followers: 281000,  following: 430,  posts: 13650 } },
  { name: 'Peter Gammons',   handle: '@pgammo',        color: '#6B6B6B', initials: 'PG',  image: '../assets/images/rumblr/peter_gammons.png',  bio: 'Baseball Hall of Fame writer. Legendary reporter. Godfather of baseball journalism.',                              bannerColor: '#1A1A1A', stats: { followers: 194000,  following: 112,  posts: 5820  } },
];

// ── State ─────────────────────────────────────────────────
let lastDoc        = null;
let activeFilter   = { type: 'all' };   // { type: 'all'|'tab'|'author'|'hashtag'|'following', value }
let currentUser    = null;
let currentUserDoc = null;
let loadingMore    = false;
let followedHandles = [];  // handles the current user follows
let feedInitialized = false;

// Called by post.html (and any page that doesn't run initFeed) to inject auth context
// so that renderPost() can correctly show edit/delete menus on own posts.
export function setCurrentUser(user, userDoc) {
  currentUser    = user;
  currentUserDoc = userDoc || null;
}

// ── DOM refs (set after DOMContentLoaded) ─────────────────
let feedEl, filterBannerEl, loadMoreBtn, spinnerEl;

// ── Load AI writers from Firestore (overrides hardcoded AI_WRITERS if present) ─
(async () => {
  try {
    const snap = await getDoc(doc(firestore, 'settings', 'ai_writers'));
    if (snap.exists() && Array.isArray(snap.data().writers) && snap.data().writers.length) {
      // Splice in-place so existing references (exports) stay valid
      AI_WRITERS.splice(0, AI_WRITERS.length, ...snap.data().writers);
    }
  } catch { /* non-critical — falls back to hardcoded */ }
})();

// ══════════════════════════════════════════════════════════
// Initialise
// ══════════════════════════════════════════════════════════
export function initFeed() {
  if (feedInitialized) return;
  feedInitialized = true;
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
      await loadFollows(user.uid);
    } else {
      currentUserDoc = null;
      followedHandles = [];
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
    // "Following" tab needs special handling when no follows exist
    if (activeFilter.type === 'following' && followedHandles.length === 0) {
      feedEl.innerHTML = `
        <div class="rb-empty">
          <div class="rb-empty-icon">👀</div>
          <div class="rb-empty-msg">You're not following anyone yet.</div>
          <div class="rb-empty-sub">Follow writers and team accounts to see their posts here.</div>
        </div>`;
      showSpinner(false);
      loadingMore = false;
      return;
    }

    const { q, clientSort } = buildQuery();
    const snap = await getDocs(q);

    if (snap.empty && reset) {
      showEmpty();
      showSpinner(false);
      loadingMore = false;
      return;
    }

    // Client-side sort when Firestore orderBy can't be used (avoids composite index requirement)
    let docs = [...snap.docs];
    if (clientSort) {
      docs.sort((a, b) => {
        const ta = a.data().timestamp?.toMillis?.() || 0;
        const tb = b.data().timestamp?.toMillis?.() || 0;
        return tb - ta;
      });
    }

    // Filter out replies (posts with a parent) — they only appear on the post detail page
    docs = docs.filter(d => !d.data().parent_post_id);
    docs.forEach(d => feedEl.appendChild(renderPost(d.id, d.data())));

    // Cursor pagination only for the "all" feed (no composite index needed there)
    if (!clientSort) {
      lastDoc = snap.docs[snap.docs.length - 1];
      if (loadMoreBtn) {
        loadMoreBtn.style.display = snap.docs.length === PAGE_SIZE ? 'block' : 'none';
      }
    }
  } catch (err) {
    console.error('Feed load error:', err);
    showToast('Error loading feed. Try refreshing.');
  } finally {
    showSpinner(false);
    loadingMore = false;
  }
}

// Returns { q, clientSort }
// clientSort=true means we fetched without orderBy and must sort client-side;
// this avoids the Firestore composite index requirement for where()+orderBy() combos.
function buildQuery() {
  // "All" feed: native Firestore order + cursor pagination
  if (activeFilter.type === 'all' || !activeFilter.type) {
    if (lastDoc) {
      return { q: query(POSTS_COL, orderBy('timestamp', 'desc'), startAfter(lastDoc), limit(PAGE_SIZE)), clientSort: false };
    }
    return { q: query(POSTS_COL, orderBy('timestamp', 'desc'), limit(PAGE_SIZE)), clientSort: false };
  }

  // Filtered queries: no orderBy (avoids composite index); sort client-side after fetch
  const FILTERED_LIMIT = 60;

  if (activeFilter.type === 'tab' && activeFilter.value === 'writers') {
    return { q: query(POSTS_COL, where('author_type', '==', 'ai'), limit(FILTERED_LIMIT)), clientSort: true };
  }
  if (activeFilter.type === 'tab' && activeFilter.value === 'teams') {
    return { q: query(POSTS_COL, where('author_type', '==', 'user'), limit(FILTERED_LIMIT)), clientSort: true };
  }
  if (activeFilter.type === 'hashtag') {
    return { q: query(POSTS_COL, where('hashtags', 'array-contains', '#' + activeFilter.value), limit(FILTERED_LIMIT)), clientSort: true };
  }
  if (activeFilter.type === 'author') {
    return { q: query(POSTS_COL, where('author_handle', '==', activeFilter.value), limit(FILTERED_LIMIT)), clientSort: true };
  }
  if (activeFilter.type === 'following' && followedHandles.length > 0) {
    // Firestore 'in' supports up to 30 values
    const handles = followedHandles.slice(0, 30);
    return { q: query(POSTS_COL, where('author_handle', 'in', handles), limit(FILTERED_LIMIT)), clientSort: true };
  }

  // Fallback
  return { q: query(POSTS_COL, orderBy('timestamp', 'desc'), limit(PAGE_SIZE)), clientSort: false };
}

function refreshFeed() {
  loadFeed(true);
}

// ══════════════════════════════════════════════════════════
// Follows
// ══════════════════════════════════════════════════════════
export async function loadFollows(uid) {
  try {
    const snap = await getDocs(
      query(collection(firestore, 'follows'), where('follower_uid', '==', uid))
    );
    followedHandles = snap.docs.map(d => d.data().followed_handle);
  } catch (_) {
    followedHandles = [];
  }
}

// Toggle follow/unfollow for a handle. Returns true if now following, false if unfollowed.
export async function toggleFollow(handle, type = 'user', followedUid = null) {
  if (!currentUser) return null;
  const followId = `${currentUser.uid}_${handle.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const followRef = doc(firestore, 'follows', followId);
  const isFollowing = followedHandles.includes(handle);

  if (isFollowing) {
    await deleteDoc(followRef);
    followedHandles = followedHandles.filter(h => h !== handle);
    return false;
  } else {
    await setDoc(followRef, {
      follower_uid:    currentUser.uid,
      followed_handle: handle,
      followed_type:   type,
      followed_uid:    followedUid,
      timestamp:       new Date().toISOString(),
    });
    followedHandles = [...followedHandles, handle];
    return true;
  }
}

export function isFollowing(handle) {
  return followedHandles.includes(handle);
}

export function getCurrentUser() {
  return currentUser;
}

// ══════════════════════════════════════════════════════════
// Profile stats (used by profile.html)
// ══════════════════════════════════════════════════════════
export async function loadProfileStats(handle, uid) {
  const followsColl = collection(firestore, 'follows');
  const aiFollowsColl = collection(firestore, 'ai_follows');
  try {
    const [followerSnap, aiFollowerSnap, followingSnap, postSnap] = await Promise.all([
      getDocs(query(followsColl,   where('followed_handle', '==', handle))),
      getDocs(query(aiFollowsColl, where('followed_handle', '==', handle))).catch(() => ({ size: 0 })),
      uid ? getDocs(query(followsColl, where('follower_uid',    '==', uid)))    : Promise.resolve({ size: 0 }),
      uid ? getDocs(query(collection(firestore, 'posts'), where('author_uid', '==', uid))) : Promise.resolve({ size: 0 }),
    ]);
    return {
      followers: followerSnap.size + (aiFollowerSnap.size || 0),
      following: followingSnap.size,
      posts:     postSnap.size,
    };
  } catch (_) {
    return { followers: 0, following: 0, posts: 0 };
  }
}

// ══════════════════════════════════════════════════════════
// Trending hashtags (used by index.html sidebar)
// ══════════════════════════════════════════════════════════
export async function loadTrendingHashtags(containerEl) {
  if (!containerEl) return;
  try {
    const snap = await getDocs(query(POSTS_COL, orderBy('timestamp', 'desc'), limit(200)));
    const counts = {};
    snap.docs.forEach(d => {
      const tags = d.data().hashtags || [];
      tags.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    });
    const top5 = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top5.length === 0) {
      containerEl.innerHTML = '<div style="color:var(--rb-subtle);font-size:0.8rem;padding:4px 0;">No trending tags yet.</div>';
      return;
    }
    containerEl.innerHTML = top5.map(([tag, count]) => `
      <div class="rb-trending-tag" data-tag="${tag.replace(/^#/, '')}" role="button" tabindex="0">
        <span class="rb-trending-name">${tag}</span>
        <span class="rb-trending-count">${count}</span>
      </div>
    `).join('');
    containerEl.querySelectorAll('.rb-trending-tag').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.rb-tab').forEach(t => t.classList.remove('active'));
        window.__rumblrHashtag(el.dataset.tag);
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter') el.click(); });
    });
  } catch (err) {
    console.error('Trending hashtags error:', err);
  }
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

  // Avatar: use stored image → AI_WRITERS lookup → colored initials fallback
  const writerImage = data.author_image ||
    AI_WRITERS.find(w => w.handle === data.author_handle)?.image || null;
  const avatarHtml = writerImage
    ? `<img class="rb-post-avatar rb-post-avatar-img" src="${escHtml(writerImage)}"
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

  // Attached image (16:9, stored in Firebase Storage)
  const imageHtml = data.image_url
    ? `<div class="rb-post-image-wrap" onclick="event.stopPropagation()">
         <img class="rb-post-image" src="${escHtml(data.image_url)}"
              alt="Post image" loading="lazy"
              onerror="this.parentElement.style.display='none';">
       </div>`
    : '';

  const isOwnPost = currentUser && data.author_uid && data.author_uid === currentUser.uid;
  const moreMenuHtml = isOwnPost
    ? `<div class="rb-post-more-wrap">
         <button class="rb-post-more-btn" title="More options" onclick="event.stopPropagation()">&#x22EF;</button>
         <div class="rb-post-more-menu" style="display:none;">
           <button class="rb-post-edit-btn">Edit</button>
           <button class="rb-post-delete-btn">Delete</button>
         </div>
       </div>`
    : '';

  const editedBadge = data.edited ? '<span class="rb-edited-badge">(edited)</span>' : '';

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
        <span class="rb-post-time">${timeAgo}${editedBadge}</span>
        ${moreMenuHtml}
      </div>
      <div class="rb-post-content">${content}</div>
      ${articleLinkHtml}
      ${imageHtml}
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

  // For user posts without a stored author_image, async-fetch avatar from their profile.
  // Uses module-level cache so each user is fetched at most once per session.
  if (!writerImage && data.author_uid) {
    fetchUserAvatar(data.author_uid).then(url => {
      if (!url) return;
      const wrap = el.querySelector('.rb-post-avatar-wrap');
      if (!wrap) return;
      wrap.innerHTML = `
        <img class="rb-post-avatar rb-post-avatar-img" src="${escHtml(url)}"
             alt="${escHtml(data.author_name)}" title="${escHtml(data.author_name)}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
        <div class="rb-post-avatar" style="background:${data.author_avatar_color || '#555'};display:none;"
             title="${escHtml(data.author_name)}">${escHtml(data.author_initials || '??')}</div>`;
    });
  }

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
        window.location.href = `profile.html?handle=${encodeURIComponent(el.dataset.handle)}`;
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
      window.location.href = `profile.html?uid=${el.dataset.uid}`;
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
  const signInBtn    = document.getElementById('rb-signin-btn');
  const signOutBtn   = document.getElementById('rb-signout-btn');
  const userMenu     = document.getElementById('rb-user-menu');
  const composeWrap  = document.getElementById('rb-compose-wrap');
  const profileLink  = document.getElementById('rb-profile-link');
  const followingTab = document.getElementById('rb-tab-following');
  const authSection  = document.getElementById('rb-auth-section');   // "Join the Rumbl"
  const profileCard  = document.getElementById('rb-profile-card');   // mini profile card

  if (currentUser) {
    if (signInBtn)   signInBtn.style.display   = 'none';
    if (signOutBtn)  signOutBtn.style.display  = 'inline-flex';
    if (userMenu)    userMenu.style.display    = 'flex';
    if (composeWrap) composeWrap.style.display = 'block';
    if (followingTab) followingTab.style.display = 'flex';
    if (authSection) authSection.style.display = 'none';
    if (profileCard) profileCard.style.display = 'block';
    // Set profile link to include user's UID so their profile loads correctly
    if (profileLink) profileLink.href = `profile.html?uid=${currentUser.uid}`;

    if (currentUserDoc) {
      // Header avatar
      if (userMenu) {
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
      // Mini profile card in left sidebar
      if (profileCard) {
        const cardAvEl   = profileCard.querySelector('.rb-card-avatar');
        const cardName   = profileCard.querySelector('.rb-card-name');
        const cardHandle = profileCard.querySelector('.rb-card-handle');
        const cardLink   = profileCard.querySelector('.rb-card-profile-link');
        if (cardName)   cardName.textContent   = currentUserDoc.display_name || '';
        if (cardHandle) cardHandle.textContent = currentUserDoc.handle || '';
        if (cardLink)   cardLink.href          = `profile.html?uid=${currentUser.uid}`;
        if (cardAvEl) {
          if (currentUserDoc.avatar_url) {
            cardAvEl.innerHTML = `<img src="${escHtml(currentUserDoc.avatar_url)}" alt="Profile"
              style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
              onerror="this.style.display='none';">`;
            cardAvEl.style.background = 'transparent';
          } else {
            cardAvEl.style.background = currentUserDoc.team_color || '#555';
            cardAvEl.textContent = (currentUserDoc.team_abbrev || '?').slice(0, 3);
          }
        }
        // Load post/following counts for card
        loadProfileStats(currentUserDoc.handle, currentUser.uid).then(stats => {
          const statsEl = profileCard.querySelector('.rb-card-stats');
          if (statsEl) {
            statsEl.textContent = `${stats.posts} posts · ${stats.following} following`;
          }
        });
      }
    }

    // Notification bell
    const notifBtn = document.getElementById('rb-notif-btn');
    if (notifBtn) {
      notifBtn.style.display = 'flex';
      initNotificationBell(currentUser.uid);
    }
  } else {
    if (signInBtn)   signInBtn.style.display   = 'inline-flex';
    if (signOutBtn)  signOutBtn.style.display  = 'none';
    if (userMenu)    userMenu.style.display    = 'none';
    if (composeWrap) composeWrap.style.display = 'none';
    if (followingTab) followingTab.style.display = 'none';
    if (authSection) authSection.style.display = 'block';
    if (profileCard) profileCard.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════
export function linkifyContent(text) {
  return escHtml(text)
    .replace(/#(\w+)/g,
      (_, tag) => `<span class="rb-hashtag" data-tag="${tag}" onclick="window.__rumblrHashtag('${tag}')">#${tag}</span>`)
    .replace(/@(\w+)/g,
      (_, handle) => `<a class="rb-mention" href="profile.html?handle=@${handle}" onclick="event.stopPropagation()">@${handle}</a>`);
}

export function escHtml(str) {
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

// ══════════════════════════════════════════════════════════
// Notifications
// ══════════════════════════════════════════════════════════

/**
 * Write in-app notifications for all followers of `authorHandle`
 * who have opted in for the given notification type.
 * type: 'new_post' | 'new_reply'
 */
export async function notifyFollowers(authorHandle, authorName, postId, content, type) {
  try {
    const followsSnap = await getDocs(
      query(collection(firestore, 'follows'), where('followed_handle', '==', authorHandle))
    );
    if (followsSnap.empty) return;

    const preview = (content || '').slice(0, 100) + (content && content.length > 100 ? '…' : '');
    const notifCol = collection(firestore, 'notifications');
    const writes = [];

    followsSnap.forEach(fdoc => {
      const fdata = fdoc.data();
      const wantNotif = type === 'new_post'
        ? fdata.notify_posts !== false && fdata.notify_posts === true
        : fdata.notify_replies !== false && fdata.notify_replies === true;
      if (!wantNotif) return;
      if (!fdata.follower_uid) return;

      writes.push(addDoc(notifCol, {
        recipient_uid: fdata.follower_uid,
        type,
        actor_handle: authorHandle,
        actor_name:   authorName,
        post_id:      postId,
        preview,
        read:         false,
        timestamp:    serverTimestamp(),
      }));
    });

    await Promise.all(writes);
  } catch (err) {
    console.warn('notifyFollowers error:', err);
  }
}

/** Returns unread notification count for the current user. */
export async function loadNotificationCount(uid) {
  try {
    const snap = await getDocs(
      query(collection(firestore, 'notifications'),
        where('recipient_uid', '==', uid),
        where('read', '==', false),
        limit(50))
    );
    return snap.size;
  } catch { return 0; }
}

/** Returns up to `maxCount` notifications for uid, newest first. */
export async function loadNotifications(uid, maxCount = 20) {
  try {
    const snap = await getDocs(
      query(collection(firestore, 'notifications'),
        where('recipient_uid', '==', uid),
        orderBy('timestamp', 'desc'),
        limit(maxCount))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

/** Mark all unread notifications as read for uid. */
export async function markNotificationsRead(uid) {
  try {
    const snap = await getDocs(
      query(collection(firestore, 'notifications'),
        where('recipient_uid', '==', uid),
        where('read', '==', false),
        limit(50))
    );
    await Promise.all(snap.docs.map(d => updateDoc(d.ref, { read: true })));
  } catch { /* silent */ }
}

/** Update notification preferences on a follow doc. */
export async function updateFollowNotifPref(followerUid, handle, field, value) {
  if (!followerUid) return;
  try {
    const followId = `${followerUid}_${handle.replace(/[^a-zA-Z0-9]/g, '_')}`;
    await updateDoc(doc(firestore, 'follows', followId), { [field]: value });
  } catch { /* follow doc may not exist */ }
}

/** Get notification prefs for a single follow relationship. Returns {notify_posts, notify_replies}. */
export async function getFollowNotifPrefs(followerUid, handle) {
  if (!followerUid) return {};
  try {
    const followId = `${followerUid}_${handle.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const snap = await getDoc(doc(firestore, 'follows', followId));
    return snap.exists() ? { notify_posts: snap.data().notify_posts || false, notify_replies: snap.data().notify_replies || false } : {};
  } catch { return {}; }
}

// ── Notification bell UI ────────────────────────────────────────────────────────
let notifPanelOpen = false;

export async function initNotificationBell(uid) {
  const bellBtn   = document.getElementById('rb-notif-btn');
  const badge     = document.getElementById('rb-notif-badge');
  const panel     = document.getElementById('rb-notif-panel');
  const markBtn   = document.getElementById('rb-notif-mark-read');
  const listEl    = document.getElementById('rb-notif-list');
  if (!bellBtn || !panel) return;

  // Load initial count
  async function refreshCount() {
    const count = await loadNotificationCount(uid);
    if (badge) {
      badge.textContent = count > 9 ? '9+' : count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  }
  await refreshCount();

  bellBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    notifPanelOpen = !notifPanelOpen;
    panel.classList.toggle('hidden', !notifPanelOpen);

    if (notifPanelOpen && listEl) {
      listEl.innerHTML = '<div class="rb-notif-loading">Loading…</div>';
      const notifs = await loadNotifications(uid, 20);
      if (notifs.length === 0) {
        listEl.innerHTML = '<div class="rb-notif-empty">No notifications yet.</div>';
      } else {
        listEl.innerHTML = notifs.map(n => {
          const action = n.type === 'new_post' ? 'posted a new Rumbl\'ing' : 'replied to a post';
          const ts = n.timestamp?.toDate ? formatTimeAgo(n.timestamp.toDate()) : '';
          return `
            <a class="rb-notif-item ${n.read ? 'read' : 'unread'}" href="post.html?id=${n.post_id}">
              <div class="rb-notif-dot ${n.read ? '' : 'active'}"></div>
              <div class="rb-notif-body">
                <div class="rb-notif-text">
                  <strong>${escHtml(n.actor_name)}</strong> ${action}
                </div>
                <div class="rb-notif-preview">${escHtml(n.preview)}</div>
                <div class="rb-notif-time">${ts}</div>
              </div>
            </a>`;
        }).join('');
      }
      // Mark all read and reset badge
      await markNotificationsRead(uid);
      if (badge) badge.style.display = 'none';
    }
  });

  // Close panel when clicking outside
  document.addEventListener('click', () => {
    if (notifPanelOpen) {
      notifPanelOpen = false;
      panel.classList.add('hidden');
    }
  });

  if (markBtn) {
    markBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await markNotificationsRead(uid);
      if (listEl) listEl.querySelectorAll('.rb-notif-item').forEach(el => {
        el.classList.remove('unread'); el.classList.add('read');
        const dot = el.querySelector('.rb-notif-dot');
        if (dot) dot.classList.remove('active');
      });
      if (badge) badge.style.display = 'none';
    });
  }
}

// ══════════════════════════════════════════════════════════
// @ mention autocomplete
// ══════════════════════════════════════════════════════════
let mentionUserCache = null;  // loaded once per session

async function fetchMentionUsers() {
  if (mentionUserCache) return mentionUserCache;
  const snap = await getDocs(collection(firestore, 'users'));
  const realUsers = snap.docs.map(d => ({
    handle:   d.data().handle || '',
    name:     d.data().display_name || '',
    color:    d.data().team_color || '#555',
    initials: (d.data().team_abbrev || '?').slice(0, 3),
    avatar:   d.data().avatar_url || null,
  }));
  const aiUsers = AI_WRITERS.map(w => ({
    handle:   w.handle,
    name:     w.name,
    color:    w.color,
    initials: w.initials,
    avatar:   w.image || null,
  }));
  mentionUserCache = [...realUsers, ...aiUsers];
  return mentionUserCache;
}

export function initMentionAutocomplete(textarea) {
  // Create the dropdown and anchor it to the textarea's parent
  const dropdown = document.createElement('div');
  dropdown.className = 'rb-mention-dropdown';
  const wrap = textarea.parentNode;
  if (wrap && getComputedStyle(wrap).position === 'static') {
    wrap.style.position = 'relative';
  }
  (wrap || document.body).appendChild(dropdown);

  function getMentionQuery(value, cursorPos) {
    const before = value.slice(0, cursorPos);
    const match  = before.match(/@(\w*)$/);
    return match ? match[1] : null;
  }

  function closeDrop() { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }

  textarea.addEventListener('input', async () => {
    const q = getMentionQuery(textarea.value, textarea.selectionStart);
    if (q === null) { closeDrop(); return; }

    const users = await fetchMentionUsers();
    const ql = q.toLowerCase();
    const matches = users.filter(u =>
      u.handle.toLowerCase().replace('@', '').startsWith(ql) ||
      u.name.toLowerCase().startsWith(ql)
    ).slice(0, 6);

    if (!matches.length) { closeDrop(); return; }

    dropdown.innerHTML = matches.map(u => {
      const avatarHtml = u.avatar
        ? `<img src="${escHtml(u.avatar)}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none';">`
        : `<div style="width:28px;height:28px;border-radius:50%;background:${u.color};display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:#fff;font-family:'Oswald',sans-serif;">${u.initials}</div>`;
      return `<div class="rb-mention-item" data-handle="${escHtml(u.handle)}">
        ${avatarHtml}
        <span class="rb-mention-name">${escHtml(u.name)}</span>
        <span class="rb-mention-handle">${escHtml(u.handle)}</span>
      </div>`;
    }).join('');
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.rb-mention-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault(); // prevent blur before click
        const handle = item.dataset.handle;
        const cur    = textarea.selectionStart;
        const before = textarea.value.slice(0, cur);
        const after  = textarea.value.slice(cur);
        const newBefore = before.replace(/@(\w*)$/, handle + ' ');
        textarea.value = newBefore + after;
        textarea.selectionStart = textarea.selectionEnd = newBefore.length;
        closeDrop();
        textarea.dispatchEvent(new Event('input'));
        textarea.focus();
      });
    });
  });

  textarea.addEventListener('blur', () => setTimeout(closeDrop, 150));
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDrop();
  });
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

// Auto-init: if this module is loaded on the feed page and initFeed() was never
// called (e.g. stale cached HTML still has the old DOMContentLoaded wrapper),
// kick it off now. Modules are deferred so DOM is always ready at this point.
if (document.getElementById('rb-feed') && !feedInitialized) {
  initFeed();
}
