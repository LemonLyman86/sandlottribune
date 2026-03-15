/**
 * rumblr-interactions.js — Likes, Replies, Reposts, Share
 * Called per-post after renderPost() to wire up engagement buttons.
 */

import { firestore, auth } from './firebase-config.js';
import {
  doc, setDoc, deleteDoc, getDoc,
  updateDoc, increment, serverTimestamp, addDoc, collection
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast, linkifyContent, escHtml, setInitInteractions } from './rumblr-app.js';

// ══════════════════════════════════════════════════════════
// Wire up all engagement buttons on a post element
// ══════════════════════════════════════════════════════════
export function initInteractions(postEl, postId, postData, currentUser) {
  const likeBtn   = postEl.querySelector('.rb-like-btn');
  const repostBtn = postEl.querySelector('.rb-repost-btn');
  const replyBtn  = postEl.querySelector('.rb-reply-btn');
  const shareBtn  = postEl.querySelector('.rb-share-btn');
  const moreBtn   = postEl.querySelector('.rb-post-more-btn');
  const moreMenu  = postEl.querySelector('.rb-post-more-menu');
  const editBtn   = postEl.querySelector('.rb-post-edit-btn');
  const deleteBtn = postEl.querySelector('.rb-post-delete-btn');

  // Load initial like/repost state if user is logged in
  if (currentUser) {
    checkLiked(currentUser.uid, postId, likeBtn);
    checkReposted(currentUser.uid, postId, repostBtn);
  }

  if (likeBtn)   likeBtn.addEventListener('click',   () => handleLike(postId, likeBtn, currentUser));
  if (repostBtn) repostBtn.addEventListener('click', () => handleRepost(postId, postData, repostBtn, currentUser));
  if (replyBtn)  replyBtn.addEventListener('click',  () => handleReply(postId, currentUser));
  if (shareBtn)  shareBtn.addEventListener('click',  () => handleShare(postId));

  // More menu (edit / delete) — only present on own posts
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = moreMenu.style.display !== 'none';
      // Close any other open menus
      document.querySelectorAll('.rb-post-more-menu').forEach(m => { m.style.display = 'none'; });
      moreMenu.style.display = isOpen ? 'none' : 'block';
    });
    // Close when clicking anywhere outside
    document.addEventListener('click', () => { moreMenu.style.display = 'none'; });
  }

  if (editBtn)   editBtn.addEventListener('click',   e => { e.stopPropagation(); handleEdit(postEl, postId, postData, moreMenu); });
  if (deleteBtn) deleteBtn.addEventListener('click', e => { e.stopPropagation(); handleDelete(postEl, postId, postData); });
}

// Register initInteractions with rumblr-app (breaks the circular import cycle)
setInitInteractions(initInteractions);

// ══════════════════════════════════════════════════════════
// Likes
// ══════════════════════════════════════════════════════════
async function checkLiked(uid, postId, btn) {
  if (!btn) return;
  try {
    const snap = await getDoc(doc(firestore, 'likes', `${uid}_${postId}`));
    if (snap.exists()) {
      btn.classList.add('liked');
      btn.querySelector('.rb-heart').textContent = '❤️';
    }
  } catch (_) {}
}

async function handleLike(postId, btn, user) {
  if (!user) { promptLogin(); return; }

  const likeRef = doc(firestore, 'likes', `${user.uid}_${postId}`);
  const postRef  = doc(firestore, 'posts', postId);
  const isLiked  = btn.classList.contains('liked');
  const countEl  = btn.querySelector('.rb-like-count');

  try {
    if (isLiked) {
      await deleteDoc(likeRef);
      await updateDoc(postRef, { like_count: increment(-1) });
      btn.classList.remove('liked');
      btn.querySelector('.rb-heart').textContent = '🤍';
      if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent) - 1);
    } else {
      await setDoc(likeRef, { user_uid: user.uid, post_id: postId, timestamp: serverTimestamp() });
      await updateDoc(postRef, { like_count: increment(1) });
      btn.classList.add('liked');
      btn.querySelector('.rb-heart').textContent = '❤️';
      if (countEl) countEl.textContent = parseInt(countEl.textContent) + 1;
    }
  } catch (err) {
    console.error('Like error:', err);
    showToast('Could not update like. Try again.');
  }
}

// ══════════════════════════════════════════════════════════
// Reposts
// ══════════════════════════════════════════════════════════
async function checkReposted(uid, postId, btn) {
  if (!btn) return;
  try {
    const snap = await getDoc(doc(firestore, 'reposts', `${uid}_${postId}`));
    if (snap.exists()) btn.classList.add('reposted');
  } catch (_) {}
}

async function handleRepost(postId, postData, btn, user) {
  if (!user) { promptLogin(); return; }
  if (btn.classList.contains('reposted')) {
    showToast('You already reposted this.');
    return;
  }

  if (!confirm('Repost this Rumbl\'ing to your feed?')) return;

  const repostRef = doc(firestore, 'reposts', `${user.uid}_${postId}`);
  const postRef   = doc(firestore, 'posts', postId);
  const countEl   = btn.querySelector('.rb-repost-count');

  try {
    // Mark repost
    await setDoc(repostRef, { user_uid: user.uid, post_id: postId, timestamp: serverTimestamp() });
    await updateDoc(postRef, { repost_count: increment(1) });

    // Write repost as a new post document
    const userSnap = await getDoc(doc(firestore, 'users', user.uid));
    const userData  = userSnap.exists() ? userSnap.data() : {};
    await addDoc(collection(firestore, 'posts'), {
      content:             postData.content,
      author_type:         'user',
      author_name:         userData.display_name  || 'Unknown',
      author_handle:       userData.handle        || '@unknown',
      author_uid:          user.uid,
      author_team_id:      userData.team_id       || null,
      author_verified:     userData.verified      || false,
      author_avatar_color: userData.team_color    || '#555',
      author_initials:     userData.team_abbrev   || '??',
      hashtags:            postData.hashtags       || [],
      timestamp:           serverTimestamp(),
      like_count:          0,
      reply_count:         0,
      repost_count:        0,
      parent_post_id:      null,
      is_ai_generated:     false,
      repost_of:           postId,
      original_author:     postData.author_name,
    });

    btn.classList.add('reposted');
    if (countEl) countEl.textContent = parseInt(countEl.textContent) + 1;
    showToast('Reposted!');
  } catch (err) {
    console.error('Repost error:', err);
    showToast('Could not repost. Try again.');
  }
}

// ══════════════════════════════════════════════════════════
// Replies — navigate to post page with reply modal open
// ══════════════════════════════════════════════════════════
function handleReply(postId, user) {
  if (!user) { promptLogin(); return; }
  window.location.href = `post.html?id=${postId}&reply=1`;
}

// ══════════════════════════════════════════════════════════
// Share — copy link
// ══════════════════════════════════════════════════════════
function handleShare(postId) {
  // Use static OG redirect page for correct Discord/social previews.
  // The page is auto-generated by _createOgPage() when a post is viewed or created.
  const url = new URL(`p/${postId}.html`, window.location.href).href;
  navigator.clipboard.writeText(url)
    .then(() => showToast('Link copied! (Discord preview may take ~60s to activate)'))
    .catch(() => {
      // Fallback
      const inp = document.createElement('input');
      inp.value = url;
      document.body.appendChild(inp);
      inp.select();
      document.execCommand('copy');
      inp.remove();
      showToast('Link copied!');
    });
}

// ══════════════════════════════════════════════════════════
// Edit post (inline)
// ══════════════════════════════════════════════════════════
async function handleEdit(postEl, postId, postData, moreMenu) {
  if (moreMenu) moreMenu.style.display = 'none';
  const contentEl = postEl.querySelector('.rb-post-content');
  if (!contentEl) return;
  const originalHtml = contentEl.innerHTML;
  const originalText = postData.content || '';
  const MAX = 300;

  contentEl.innerHTML = `
    <textarea class="rb-edit-textarea" maxlength="${MAX}">${originalText.replace(/</g,'&lt;')}</textarea>
    <div class="rb-edit-actions">
      <span class="rb-edit-counter">${MAX - originalText.length}</span>
      <button class="rb-btn rb-btn-ghost rb-btn-sm rb-edit-cancel-btn">Cancel</button>
      <button class="rb-btn rb-btn-primary rb-btn-sm rb-edit-save-btn">Save</button>
    </div>
  `;

  const textarea  = contentEl.querySelector('.rb-edit-textarea');
  const counter   = contentEl.querySelector('.rb-edit-counter');
  const saveBtn   = contentEl.querySelector('.rb-edit-save-btn');
  const cancelBtn = contentEl.querySelector('.rb-edit-cancel-btn');

  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

  textarea.addEventListener('input', () => {
    const rem = MAX - textarea.value.length;
    counter.textContent = rem;
    counter.style.color = rem < 0 ? 'var(--rb-red)' : '';
    saveBtn.disabled = !textarea.value.trim() || rem < 0;
  });

  cancelBtn.addEventListener('click', e => { e.stopPropagation(); contentEl.innerHTML = originalHtml; });

  saveBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const newContent = textarea.value.trim();
    if (!newContent) return;
    saveBtn.disabled = true;
    try {
      const hashtags = [...newContent.matchAll(/#(\w+)/g)].map(m => '#' + m[1]);
      await updateDoc(doc(firestore, 'posts', postId), {
        content: newContent,
        hashtags,
        edited: true,
        edit_timestamp: serverTimestamp(),
      });
      postData.content = newContent;
      contentEl.innerHTML = linkifyContent(newContent);
      // Update the time span to show "(edited)" badge
      const timeEl = postEl.querySelector('.rb-post-time');
      if (timeEl && !timeEl.querySelector('.rb-edited-badge')) {
        timeEl.insertAdjacentHTML('beforeend', '<span class="rb-edited-badge">(edited)</span>');
      }
      showToast('Rumbl\'ing updated!');
    } catch (err) {
      console.error('Edit error:', err);
      showToast('Could not save edit. Try again.');
      contentEl.innerHTML = originalHtml;
    }
  });
}

// ══════════════════════════════════════════════════════════
// Delete post
// ══════════════════════════════════════════════════════════
async function handleDelete(postEl, postId, postData) {
  if (!confirm('Delete this Rumbl\'ing? This cannot be undone.')) return;
  try {
    await deleteDoc(doc(firestore, 'posts', postId));
    // If it was a reply, decrement the parent's reply_count
    if (postData.parent_post_id) {
      await updateDoc(doc(firestore, 'posts', postData.parent_post_id), {
        reply_count: increment(-1),
      });
    }
    // Animate out and remove
    postEl.style.transition = 'opacity 0.3s';
    postEl.style.opacity = '0';
    setTimeout(() => postEl.remove(), 300);
    showToast('Rumbl\'ing deleted.');
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Could not delete. Try again.');
  }
}

// ══════════════════════════════════════════════════════════
// Login prompt modal
// ══════════════════════════════════════════════════════════
function promptLogin() {
  const overlay = document.getElementById('rb-login-modal');
  if (overlay) {
    overlay.classList.remove('hidden');
  } else {
    // Fallback redirect
    window.location.href = 'login.html';
  }
}
