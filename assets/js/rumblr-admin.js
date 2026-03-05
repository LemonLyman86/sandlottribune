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
  getDocs, doc, updateDoc, deleteDoc, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── Set this to your Firebase Auth UID ───────────────────
const ADMIN_UID = 'wIVL4PEkOvTuBFagFAmLS1mnLEf2';
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

    await loadPendingUsers();
    await loadAllUsers();
    await loadRecentPosts();
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
    where('verified', '==', false),
    orderBy('joined_at', 'asc')
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
    const row = document.createElement('div');
    row.className = 'rb-admin-user-row';
    row.innerHTML = `
      <div class="rb-post-avatar" style="background:${u.team_color||'#555'};width:36px;height:36px;font-size:0.72rem;">
        ${u.team_abbrev||'?'}
      </div>
      <div class="rb-admin-user-info">
        <div class="rb-admin-user-name">${escHtml(u.display_name)}
          ${u.verified ? '<span class="rb-verified" title="Verified">⚾</span>' : ''}
        </div>
        <div class="rb-admin-user-detail">${escHtml(u.handle)} &nbsp;·&nbsp; ${escHtml(u.team_name)}</div>
      </div>
      <span style="font-family:'Oswald',sans-serif;font-size:0.8rem;color:var(--rb-subtle);">
        ${u.post_count||0} posts
      </span>
      ${!u.verified ? `<button class="rb-admin-btn-approve" data-uid="${d.id}">Verify</button>` : ''}
    `;
    const verifyBtn = row.querySelector('.rb-admin-btn-approve');
    if (verifyBtn) verifyBtn.addEventListener('click', () => approveUser(d.id, verifyBtn.parentElement));
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
    limit(50)
  ));

  if (snap.empty) {
    container.innerHTML = '<p style="color:var(--rb-subtle);font-size:0.88rem;">No posts yet.</p>';
    return;
  }

  container.innerHTML = '';
  snap.forEach(d => {
    const p = d.data();
    const row = document.createElement('div');
    row.style.cssText = 'padding:12px 0;border-bottom:1px solid var(--rb-border);';
    row.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">
        <div class="rb-post-avatar" style="background:${p.author_avatar_color||'#555'};
             width:28px;height:28px;font-size:0.65rem;flex-shrink:0">
          ${p.author_initials||'?'}
        </div>
        <span style="font-family:'Oswald',sans-serif;font-size:0.88rem;font-weight:600;">
          ${escHtml(p.author_name)}
        </span>
        <span style="font-family:'Oswald',sans-serif;font-size:0.8rem;color:var(--rb-muted);">
          ${escHtml(p.author_handle)}
        </span>
        <span style="margin-left:auto;font-family:'Oswald',sans-serif;font-size:0.78rem;color:var(--rb-subtle);">
          ${p.timestamp?.toDate ? p.timestamp.toDate().toLocaleString() : ''}
        </span>
      </div>
      <div style="font-size:0.88rem;color:var(--rb-muted);margin-left:36px;margin-bottom:8px;">
        ${escHtml(p.content)}
      </div>
      <div style="margin-left:36px;">
        <button class="rb-admin-btn-reject" data-postid="${d.id}" style="font-size:0.75rem;padding:3px 10px;">
          🗑 Delete
        </button>
      </div>
    `;
    row.querySelector('.rb-admin-btn-reject').addEventListener('click', async () => {
      if (!confirm('Delete this post permanently?')) return;
      await deleteDoc(doc(firestore, 'posts', d.id));
      row.remove();
      showToast('Post deleted.');
    });
    container.appendChild(row);
  });
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
