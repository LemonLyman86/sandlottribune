/**
 * rumblr-interactions.js — Likes, Replies, Reposts, Share
 * Called per-post after renderPost() to wire up engagement buttons.
 */

import { firestore, auth } from './firebase-config.js';
import {
  doc, setDoc, deleteDoc, getDoc,
  updateDoc, increment, serverTimestamp, addDoc, collection
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast } from './rumblr-app.js';

// ══════════════════════════════════════════════════════════
// Wire up all engagement buttons on a post element
// ══════════════════════════════════════════════════════════
export function initInteractions(postEl, postId, postData, currentUser) {
  const likeBtn   = postEl.querySelector('.rb-like-btn');
  const repostBtn = postEl.querySelector('.rb-repost-btn');
  const replyBtn  = postEl.querySelector('.rb-reply-btn');
  const shareBtn  = postEl.querySelector('.rb-share-btn');

  // Load initial like/repost state if user is logged in
  if (currentUser) {
    checkLiked(currentUser.uid, postId, likeBtn);
    checkReposted(currentUser.uid, postId, repostBtn);
  }

  if (likeBtn)   likeBtn.addEventListener('click',   () => handleLike(postId, likeBtn, currentUser));
  if (repostBtn) repostBtn.addEventListener('click', () => handleRepost(postId, postData, repostBtn, currentUser));
  if (replyBtn)  replyBtn.addEventListener('click',  () => handleReply(postId, currentUser));
  if (shareBtn)  shareBtn.addEventListener('click',  () => handleShare(postId));
}

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
  const url = new URL(`post.html?id=${postId}`, window.location.href).href;
  navigator.clipboard.writeText(url)
    .then(() => showToast('Link copied!'))
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
