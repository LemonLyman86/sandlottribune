/**
 * rumblr-admin.js — Admin Dashboard Logic
 * Handles: pending verifications, account list, post moderation.
 *
 * Access: Protected by a hardcoded admin UID check. Set ADMIN_UID below
 * to your Firebase Auth UID (find it in Firebase Console → Authentication → Users).
 */

import { firestore, auth } from './firebase-config.js';
import {
  collection, query, where, orderBy, limit,
  getDocs, doc, updateDoc, deleteDoc, getDoc, addDoc, setDoc, serverTimestamp, increment
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { AI_WRITERS } from './rumblr-app.js';

// ── Set this to your Firebase Auth UID ───────────────────
const ADMIN_UID = 'xNRN4Ae3VTeYqXB4XvcsDMXVABZ2';
// ─────────────────────────────────────────────────────────

export function initAdmin() {
  const gateEl     = document.getElementById('rb-admin-gate');
  const dashEl     = document.getElementById('rb-admin-dash');
  const accessErr  = document.getElementById('rb-access-error');

  onAuthStateChanged(auth, async user => {
    if (!user) {
      window.location.href = 'login.html?redirect=admin.html';
      return;
    }
    if (user.uid !== ADMIN_UID) {
      if (gateEl) gateEl.style.display = 'block';
      if (accessErr) accessErr.style.display = 'block';
      return;
    }
    // Authorized
    if (gateEl) gateEl.style.display = 'none';
    if (dashEl) dashEl.style.display = 'block';

    // Show the admin's own UID for easy copy-paste
    const uidEl = document.getElementById('rb-my-uid');
    if (uidEl) uidEl.textContent = user.uid;

    try { await loadPendingUsers(); } catch (e) { console.error('loadPendingUsers:', e); }
    try { await loadAllUsers(); }    catch (e) { console.error('loadAllUsers:', e); }
    loadAIWriters();
    try { await loadRecentPosts(); } catch (e) { console.error('loadRecentPosts:', e); }
    initWriterPanels();
  });
}

// ══════════════════════════════════════════════════════════
// Pending verifications
// ══════════════════════════════════════════════════════════
async function loadPendingUsers() {
  const container = document.getElementById('rb-pending-list');
  const badge     = document.getElementById('rb-pending-badge');
  if (!container) return;

  const snap = await getDocs(query(
    collection(firestore, 'users'),
    where('verified', '==', false)
  ));

  if (badge) badge.textContent = snap.size;

  if (snap.empty) {
    container.innerHTML = '<p style="color:var(--rb-subtle);font-size:0.88rem;">No pending accounts.</p>';
    return;
  }

  container.innerHTML = '';
  snap.forEach(d => {
    const u = d.data();
    const row = document.createElement('div');
    row.className = 'rb-admin-user-row';
    row.innerHTML = `
      <div class="rb-post-avatar" style="background:${u.team_color||'#555'};width:36px;height:36px;font-size:0.72rem;">
        ${u.team_abbrev||'?'}
      </div>
      <div class="rb-admin-user-info">
        <div class="rb-admin-user-name">${escHtml(u.display_name)} &nbsp;<span style="font-weight:400;color:var(--rb-muted)">${escHtml(u.handle)}</span></div>
        <div class="rb-admin-user-detail">${escHtml(u.team_name)} &nbsp;·&nbsp; ${escHtml(u.email)}</div>
        <div class="rb-admin-user-detail" style="color:var(--rb-subtle);">
          Joined ${u.joined_at?.toDate ? u.joined_at.toDate().toLocaleDateString() : '—'}
        </div>
      </div>
      <button class="rb-admin-btn-approve" data-uid="${d.id}">✅ Approve</button>
      <button class="rb-admin-btn-reject"  data-uid="${d.id}">❌ Reject</button>
    `;
    row.querySelector('.rb-admin-btn-approve').addEventListener('click', () => approveUser(d.id, row));
    row.querySelector('.rb-admin-btn-reject').addEventListener('click',  () => rejectUser(d.id, u.email, row));
    container.appendChild(row);
  });
}

async function approveUser(uid, rowEl) {
  if (!confirm('Approve this account and grant the ⚾ verified badge?')) return;
  await updateDoc(doc(firestore, 'users', uid), { verified: true });
  rowEl.remove();
  showToast('Account approved!');
  // Refresh pending badge
  const badge = document.getElementById('rb-pending-badge');
  if (badge) badge.textContent = Math.max(0, parseInt(badge.textContent) - 1);
}

async function rejectUser(uid, email, rowEl) {
  if (!confirm(`Reject and delete account for ${email}? This cannot be undone.`)) return;
  await deleteDoc(doc(firestore, 'users', uid));
  // Note: Firebase Auth account remains — user won't have a profile doc.
  // For full deletion, use the Firebase Admin SDK in a Cloud Function.
  rowEl.remove();
  showToast('Account rejected and profile deleted.');
}

// ══════════════════════════════════════════════════════════
// All accounts
// ══════════════════════════════════════════════════════════
async function loadAllUsers() {
  const container = document.getElementById('rb-all-users-list');
  if (!container) return;

  const snap = await getDocs(query(
    collection(firestore, 'users'),
    orderBy('joined_at', 'desc'),
    limit(50)
  ));

  if (snap.empty) {
    container.innerHTML = '<p style="color:var(--rb-subtle);font-size:0.88rem;">No accounts yet.</p>';
    return;
  }

  container.innerHTML = '';
  snap.forEach(d => {
    const u = d.data();
    const displayName = u.display_name || u.email || '(unknown)';
    const row = document.createElement('div');
    row.className = 'rb-admin-user-row';
    row.innerHTML = `
      <div class="rb-post-avatar" style="background:${u.team_color||'#555'};width:36px;height:36px;font-size:0.72rem;">
        ${u.team_abbrev||'?'}
      </div>
      <div class="rb-admin-user-info">
        <div class="rb-admin-user-name">${escHtml(displayName)}
          ${u.verified ? '<span class="rb-verified" title="Verified">⚾</span>' : ''}
        </div>
        <div class="rb-admin-user-detail">${escHtml(u.handle||'')} &nbsp;·&nbsp; ${escHtml(u.team_name||u.account_type||'')}</div>
        <div class="rb-admin-user-detail" style="color:var(--rb-subtle);font-size:0.78rem;">${escHtml(u.email||'')}</div>
      </div>
      <span style="font-family:'Oswald',sans-serif;font-size:0.8rem;color:var(--rb-subtle);">
        ${u.post_count||0} posts
      </span>
      ${!u.verified ? `<button class="rb-admin-btn-approve" data-uid="${d.id}">Verify</button>` : ''}
      <button class="rb-admin-btn-reject rb-admin-btn-delete-user" data-uid="${d.id}" style="font-size:0.72rem;padding:3px 8px;" title="Delete account">&#128465;</button>
    `;
    const verifyBtn = row.querySelector('.rb-admin-btn-approve');
    if (verifyBtn) verifyBtn.addEventListener('click', () => approveUser(d.id, verifyBtn.parentElement));
    row.querySelector('.rb-admin-btn-delete-user').addEventListener('click', async () => {
      if (!confirm(`Delete account for ${u.email || displayName}? This removes their profile but NOT their Firebase Auth login.`)) return;
      await deleteDoc(doc(firestore, 'users', d.id));
      row.remove();
      showToast('Profile deleted.');
    });
    container.appendChild(row);
  });
}

// ══════════════════════════════════════════════════════════
// ESTN AI Writers (config-driven, not from Firestore)
// ══════════════════════════════════════════════════════════
function loadAIWriters() {
  const container = document.getElementById('rb-ai-writers-list');
  if (!container) return;

  container.innerHTML = '';
  AI_WRITERS.forEach(w => {
    const row = document.createElement('div');
    row.className = 'rb-admin-user-row';
    row.innerHTML = `
      <div class="rb-post-avatar rb-post-avatar-img" style="background:${w.color};width:36px;height:36px;flex-shrink:0;overflow:hidden;">
        <img src="${w.image}" alt="${escHtml(w.name)}"
             style="width:100%;height:100%;object-fit:cover;"
             onerror="this.style.display='none';">
      </div>
      <div class="rb-admin-user-info" style="flex:1;">
        <div class="rb-admin-user-name">
          ${escHtml(w.name)}
          <span class="rb-verified" title="Verified">⚾</span>
        </div>
        <div class="rb-admin-user-detail">${escHtml(w.handle)}</div>
        <div class="rb-admin-user-detail" style="color:var(--rb-subtle);font-size:0.78rem;">
          ${(w.stats?.followers||0).toLocaleString()} followers &nbsp;·&nbsp; ${(w.stats?.posts||0).toLocaleString()} posts
        </div>
      </div>
      <a href="profile.html?handle=${encodeURIComponent(w.handle)}" target="_blank"
         class="rb-btn rb-btn-ghost rb-btn-sm" style="font-size:0.72rem;">View Profile</a>
    `;
    container.appendChild(row);
  });
}

// ══════════════════════════════════════════════════════════
// Recent posts moderation
// ══════════════════════════════════════════════════════════
async function loadRecentPosts() {
  const container = document.getElementById('rb-recent-posts-list');
  if (!container) return;

  const snap = await getDocs(query(
    collection(firestore, 'posts'),
    orderBy('timestamp', 'desc'),
    limit(100)
  ));

  if (snap.empty) {
    container.innerHTML = '<p style="color:var(--rb-subtle);font-size:0.88rem;">No posts yet.</p>';
    return;
  }

  // Build post cache for client-side filtering
  const allPosts = [];
  snap.forEach(d => allPosts.push({ id: d.id, ...d.data() }));

  // Filter bar
  let activeFilter = 'all';
  const filterBar = document.createElement('div');
  filterBar.className = 'rb-admin-filter-bar';
  filterBar.innerHTML = `
    <button class="rb-admin-filter-btn active" data-filter="all">All (${allPosts.length})</button>
    <button class="rb-admin-filter-btn" data-filter="ai">AI Writers</button>
    <button class="rb-admin-filter-btn" data-filter="user">Users</button>
    <button class="rb-admin-filter-btn" data-filter="replies">Replies</button>
  `;
  container.before(filterBar);

  filterBar.querySelectorAll('.rb-admin-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterBar.querySelectorAll('.rb-admin-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      renderPosts();
    });
  });

  function renderPosts() {
    container.innerHTML = '';
    const filtered = allPosts.filter(p => {
      if (activeFilter === 'ai')      return p.author_type === 'ai' && !p.parent_post_id;
      if (activeFilter === 'user')    return p.author_type !== 'ai' && !p.parent_post_id;
      if (activeFilter === 'replies') return !!p.parent_post_id;
      return true;
    });

    if (!filtered.length) {
      container.innerHTML = '<p style="color:var(--rb-subtle);font-size:0.88rem;">No posts in this category.</p>';
      return;
    }

    filtered.forEach(p => {
      const isAI    = p.author_type === 'ai';
      const isReply = !!p.parent_post_id;
      const typeLabel = isReply ? 'reply' : isAI ? 'ai' : 'user';
      const typeColor = isReply ? '#6B6B6B' : isAI ? '#2E6B3E' : '#1E3A5F';

      const row = document.createElement('div');
      row.className = 'rb-admin-post-row';
      row.innerHTML = `
        <div class="rb-admin-post-header">
          <div class="rb-post-avatar" style="background:${p.author_avatar_color||'#555'};
               width:28px;height:28px;font-size:0.65rem;flex-shrink:0;">
            ${p.author_initials||'?'}
          </div>
          <span class="rb-admin-post-name">${escHtml(p.author_name)}</span>
          <span class="rb-admin-post-handle">${escHtml(p.author_handle)}</span>
          <span class="rb-admin-type-badge" style="background:${typeColor};">${typeLabel}</span>
          <span class="rb-admin-post-ts">${p.timestamp?.toDate ? p.timestamp.toDate().toLocaleString() : ''}</span>
        </div>
        ${isReply ? `<div class="rb-admin-reply-label">&#8618; Reply to post <code>${p.parent_post_id}</code></div>` : ''}
        <div class="rb-admin-post-content">${escHtml(p.content)}</div>
        <div class="rb-admin-post-actions">
          <button class="rb-admin-btn-edit">&#9998; Edit</button>
          <button class="rb-admin-btn-reject">&#128465; Delete</button>
          <span class="rb-admin-post-stats">
            &#9829; ${p.like_count||0} &nbsp;&nbsp; &#128172; ${p.reply_count||0} &nbsp;&nbsp; &#8635; ${p.repost_count||0}
          </span>
        </div>
        <div class="rb-admin-edit-area">
          <textarea class="rb-admin-edit-textarea" rows="3">${escHtml(p.content)}</textarea>
          <div class="rb-admin-edit-btns">
            <button class="rb-btn rb-btn-primary rb-admin-btn-save" style="font-size:0.78rem;padding:4px 14px;">Save</button>
            <button class="rb-btn rb-btn-ghost rb-admin-btn-cancel" style="font-size:0.78rem;padding:4px 14px;">Cancel</button>
          </div>
        </div>
      `;

      const contentDiv   = row.querySelector('.rb-admin-post-content');
      const editArea     = row.querySelector('.rb-admin-edit-area');
      const editTextarea = row.querySelector('.rb-admin-edit-textarea');
      const editBtn      = row.querySelector('.rb-admin-btn-edit');

      // Delete
      row.querySelector('.rb-admin-btn-reject').addEventListener('click', async () => {
        if (!confirm('Delete this post permanently?')) return;
        await deleteDoc(doc(firestore, 'posts', p.id));
        row.remove();
        const idx = allPosts.findIndex(x => x.id === p.id);
        if (idx !== -1) allPosts.splice(idx, 1);
        showToast('Post deleted.');
      });

      // Open edit
      editBtn.addEventListener('click', () => {
        editArea.style.display = 'block';
        editBtn.style.display = 'none';
        editTextarea.focus();
      });

      // Cancel edit
      row.querySelector('.rb-admin-btn-cancel').addEventListener('click', () => {
        editArea.style.display = 'none';
        editBtn.style.display = '';
        editTextarea.value = p.content;
      });

      // Save edit
      row.querySelector('.rb-admin-btn-save').addEventListener('click', async () => {
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

  renderPosts();
}

// ══════════════════════════════════════════════════════════
// Writer Reply + Writer Follow panels
// ══════════════════════════════════════════════════════════
function initWriterPanels() {
  // Populate writer dropdowns
  ['rb-reply-writer', 'rb-follow-writer'].forEach(selectId => {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    AI_WRITERS.forEach((w, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${w.name} (${w.handle})`;
      sel.appendChild(opt);
    });
  });

  // ── Writer Reply ─────────────────────────────────────────
  const replyContent = document.getElementById('rb-reply-content');
  const replyChar    = document.getElementById('rb-reply-char');
  if (replyContent && replyChar) {
    replyContent.addEventListener('input', () => {
      replyChar.textContent = 280 - replyContent.value.length;
    });
  }

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
      const writer = AI_WRITERS[parseInt(writerIdx)];
      const hashtags = [...content.matchAll(/#(\w+)/g)].map(m => '#' + m[1]);

      replyBtn.disabled = true;
      try {
        // Verify parent post exists
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
        // Increment parent post reply_count
        await updateDoc(doc(firestore, 'posts', postId), { reply_count: increment(1) });

        if (resultEl) {
          resultEl.style.display = 'block';
          resultEl.textContent = `Reply posted as ${writer.name}!`;
        }
        if (replyContent) replyContent.value = '';
        if (replyChar) replyChar.textContent = '280';
        showToast(`Reply posted as ${writer.name}`);
      } catch (err) {
        console.error('Writer reply error:', err);
        showToast('Error posting reply. Check console.');
      } finally {
        replyBtn.disabled = false;
      }
    });
  }

  // ── Writer Follow User ───────────────────────────────────
  const followBtn = document.getElementById('rb-follow-submit-btn');
  if (followBtn) {
    followBtn.addEventListener('click', async () => {
      const writerIdx   = document.getElementById('rb-follow-writer')?.value;
      const userHandle  = document.getElementById('rb-follow-handle')?.value.trim();
      const resultEl    = document.getElementById('rb-follow-result');

      if (writerIdx === '' || !userHandle) {
        showToast('Select a writer and enter a handle.');
        return;
      }
      const writer = AI_WRITERS[parseInt(writerIdx)];
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
          resultEl.textContent = `${writer.name} is now following ${handle}`;
        }
        if (document.getElementById('rb-follow-handle')) {
          document.getElementById('rb-follow-handle').value = '';
        }
        showToast(`${writer.name} now follows ${handle}`);
      } catch (err) {
        console.error('Writer follow error:', err);
        showToast('Error recording follow. Check console.');
      } finally {
        followBtn.disabled = false;
      }
    });
  }
}

// ── Helpers ───────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg) {
  const container = document.querySelector('.rb-toast-container')
    || (() => { const c = document.createElement('div'); c.className = 'rb-toast-container'; document.body.appendChild(c); return c; })();
  const toast = document.createElement('div');
  toast.className = 'rb-toast';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
