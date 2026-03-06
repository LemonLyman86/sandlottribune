/**
 * estn-auth.js — ESTN Sitewide Authentication
 *
 * Uses the same Firebase Auth + Firestore as Rumblr.
 * Injects a login button or user chip into #estn-auth-widget in the nav.
 * Sign-in modal lets users log in with their Rumblr credentials.
 * On article pages, auto-fills comment name from their Firestore user profile.
 *
 * Usage: <script type="module" src="[path]/assets/js/estn-auth.js"></script>
 * Ensure nav has: <div id="estn-auth-widget"></div>
 */

import { firestore, auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Module state ──────────────────────────────────────────
let _currentUser = null;
let _userDoc     = null;

// ── Helpers ───────────────────────────────────────────────

function getWidget() {
  return document.getElementById('estn-auth-widget');
}

// Determine path prefix to /assets/ relative to current page
function assetsBase() {
  const path = window.location.pathname;
  const depth = (path.match(/\//g) || []).length - 1;
  return depth <= 1 ? 'assets/' : '../assets/';
}

function rumblrBase() {
  const path = window.location.pathname;
  const depth = (path.match(/\//g) || []).length - 1;
  return depth <= 1 ? 'rumblr/' : '../rumblr/';
}

// ── Inject Modal ──────────────────────────────────────────

function injectModal() {
  if (document.getElementById('estn-auth-modal-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id        = 'estn-auth-modal-overlay';
  overlay.className = 'estn-auth-modal-overlay';
  overlay.innerHTML = `
    <div class="estn-auth-modal" role="dialog" aria-modal="true" aria-labelledby="estn-auth-modal-title">
      <button class="estn-auth-close" id="estn-auth-close" aria-label="Close">&times;</button>
      <div class="estn-auth-modal-title" id="estn-auth-modal-title">Sign In to ESTN</div>
      <div class="estn-auth-modal-sub">Use your Rumblr account credentials</div>
      <div class="estn-auth-field">
        <label class="estn-auth-label" for="estn-auth-email">Email</label>
        <input class="estn-auth-input" type="email" id="estn-auth-email" autocomplete="email" placeholder="you@example.com">
      </div>
      <div class="estn-auth-field">
        <label class="estn-auth-label" for="estn-auth-password">Password</label>
        <input class="estn-auth-input" type="password" id="estn-auth-password" autocomplete="current-password" placeholder="••••••••">
      </div>
      <div class="estn-auth-error" id="estn-auth-error"></div>
      <button class="estn-auth-submit" id="estn-auth-submit">Sign In</button>
      <div class="estn-auth-footer">
        Don't have an account? <a href="${rumblrBase()}signup.html">Sign up on Rumblr &rarr;</a>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });

  document.getElementById('estn-auth-close').addEventListener('click', closeModal);

  // Form submit
  document.getElementById('estn-auth-submit').addEventListener('click', handleSignIn);
  document.getElementById('estn-auth-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSignIn();
  });
}

function openModal() {
  injectModal();
  const overlay = document.getElementById('estn-auth-modal-overlay');
  overlay.classList.add('open');
  setTimeout(() => {
    const el = document.getElementById('estn-auth-email');
    if (el) el.focus();
  }, 50);
}

function closeModal() {
  const overlay = document.getElementById('estn-auth-modal-overlay');
  if (overlay) overlay.classList.remove('open');
}

async function handleSignIn() {
  const email    = (document.getElementById('estn-auth-email')?.value || '').trim();
  const password = (document.getElementById('estn-auth-password')?.value || '');
  const errEl    = document.getElementById('estn-auth-error');
  const btn      = document.getElementById('estn-auth-submit');

  if (!email || !password) {
    if (errEl) errEl.textContent = 'Please enter your email and password.';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Signing in…';
  if (errEl) errEl.textContent = '';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    closeModal();
    showToast('Welcome back!');
  } catch (err) {
    const msg = err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found'
      ? 'Invalid email or password.'
      : err.code === 'auth/too-many-requests'
      ? 'Too many attempts. Try again later.'
      : 'Sign in failed. Check your credentials.';
    if (errEl) errEl.textContent = msg;
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sign In';
  }
}

// ── Toast ─────────────────────────────────────────────────

function showToast(msg) {
  let toast = document.getElementById('estn-global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id    = 'estn-global-toast';
    toast.style.cssText = [
      'position:fixed;bottom:24px;right:24px;z-index:2000',
      'background:#161B22;border:1px solid #2D3748;border-left:3px solid #C8102E',
      'color:#E2E8F0;font-family:\'Oswald\',sans-serif;font-size:0.82rem',
      'letter-spacing:0.06em;padding:12px 18px;border-radius:4px',
      'opacity:0;transform:translateY(8px);transition:opacity 0.25s,transform 0.25s',
      'pointer-events:none'
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity   = '1';
  toast.style.transform = 'translateY(0)';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateY(8px)';
  }, 3000);
}

// ── Render widget ─────────────────────────────────────────

function renderLoggedOut() {
  const widget = getWidget();
  if (!widget) return;
  widget.innerHTML = '';

  const btn  = document.createElement('button');
  btn.className   = 'estn-signin-btn';
  btn.textContent = 'Sign In';
  btn.addEventListener('click', openModal);
  widget.appendChild(btn);
}

function renderLoggedIn(user, userDoc) {
  const widget = getWidget();
  if (!widget) return;
  widget.innerHTML = '';

  const chip = document.createElement('a');
  chip.className = 'estn-user-chip';
  chip.href = `${rumblrBase()}profile.html?uid=${user.uid}`;
  chip.title = 'View Rumblr profile';

  const teamColor = userDoc?.teamColor || '#4A5568';
  const displayName = userDoc?.displayName || user.email?.split('@')[0] || 'User';
  const photoURL    = userDoc?.photoURL;

  if (photoURL) {
    const img = document.createElement('img');
    img.className = 'estn-user-avatar';
    img.src = photoURL;
    img.alt = displayName;
    img.onerror = () => { img.style.display = 'none'; dot.style.display = 'flex'; };
    chip.appendChild(img);
  } else {
    const dot = document.createElement('span');
    dot.className = 'estn-user-dot';
    dot.style.background = teamColor;
    chip.appendChild(dot);
  }

  const name = document.createElement('span');
  name.className   = 'estn-user-name';
  name.textContent = displayName;
  chip.appendChild(name);

  widget.appendChild(chip);

  // Sign out button (small)
  const out = document.createElement('button');
  out.style.cssText = 'background:none;border:none;color:#4A5568;font-size:0.68rem;cursor:pointer;font-family:\'Oswald\',sans-serif;letter-spacing:0.06em;padding:4px 6px;';
  out.textContent = 'Sign Out';
  out.title       = 'Sign out of ESTN';
  out.addEventListener('click', () => {
    signOut(auth).catch(console.error);
  });
  widget.appendChild(out);
}

// ── Article page: auto-fill comment form ──────────────────

function tryAutofillComments(user, userDoc) {
  if (!user || !userDoc) return;

  const displayName = userDoc?.displayName || user.email?.split('@')[0] || 'User';

  // Target: name input in comment form (article pages)
  const nameInput = document.querySelector('.comment-form input[type="text"][placeholder*="name" i], input#comment-name, input[name="name"]');
  const emailInput = document.querySelector('.comment-form input[type="email"], input[name="email"]');

  if (nameInput && !nameInput.value) {
    nameInput.value = displayName;
    nameInput.style.background = 'rgba(200,16,46,0.04)';
    nameInput.style.borderColor = '#BA2B2B';
    // Optionally hide since we have the user
    const field = nameInput.closest('.estn-admin-field, .comment-form-fields > *');
    if (field) field.style.opacity = '0.5';
  }

  if (emailInput && !emailInput.value && user.email) {
    emailInput.value = user.email;
  }
}

// ── Auth state listener ───────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  _currentUser = user;

  if (user) {
    // Load Firestore user doc
    try {
      const snap = await getDoc(doc(firestore, 'users', user.uid));
      _userDoc   = snap.exists() ? snap.data() : {};
    } catch {
      _userDoc = {};
    }
    renderLoggedIn(user, _userDoc);
    tryAutofillComments(user, _userDoc);
  } else {
    _userDoc = null;
    renderLoggedOut();
  }
});

// ── Exports (for other scripts to check auth state) ───────
export function getCurrentUser()    { return _currentUser; }
export function getCurrentUserDoc() { return _userDoc; }
export { openModal as openSignInModal, showToast };
