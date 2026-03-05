/**
 * rumblr-auth.js — Auth + Compose
 * Handles: sign-up, login, sign-out, post composer.
 */

import { firestore, auth } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, setDoc, addDoc, collection,
  serverTimestamp, increment, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast } from './rumblr-app.js';

// ── Team data (color_1 from team_season_branding) ─────────
export const TEAM_DATA = {
  ARI: { name: 'Arizona Diamondbacks',    color: '#2CCCD3', abbrev: 'ARI' },
  ATL: { name: 'Atlanta Braves',          color: '#002855', abbrev: 'ATL' },
  BOS: { name: 'Boston Red Sox',          color: '#0C2340', abbrev: 'BOS' },
  CHC: { name: 'Chicago Cubs',            color: '#002F6C', abbrev: 'CHC' },
  CIN: { name: 'Cincinnati Reds',         color: '#BA0C2F', abbrev: 'CIN' },
  COL: { name: 'Colorado Rockies',        color: '#330072', abbrev: 'COL' },
  HOU: { name: 'Houston Astros',          color: '#FF8200', abbrev: 'HOU' },
  LVA: { name: 'Las Vegas Athletics',     color: '#006341', abbrev: 'LVA' },
  MIA: { name: 'Miami Marlins',           color: '#00A3E0', abbrev: 'MIA' },
  MIL: { name: 'Milwaukee Brewers',       color: '#13294B', abbrev: 'MIL' },
  NYY: { name: 'New York Yankees',        color: '#0C2340', abbrev: 'NYY' },
  PHI: { name: 'Philadelphia Phillies',   color: '#002D72', abbrev: 'PHI' },
  SAN: { name: 'San Diego Padres',        color: '#3E342F', abbrev: 'SAN' },
  SEA: { name: 'Seattle Mariners',        color: '#0C2340', abbrev: 'SEA' },
  STL: { name: 'St. Louis Cardinals',     color: '#0C2340', abbrev: 'STL' },
  TEX: { name: 'Texas Rangers',           color: '#6CACE4', abbrev: 'TEX' },
  TOR: { name: 'Toronto Blue Jays',       color: '#041E42', abbrev: 'TOR' },
  WSH: { name: 'Washington Nationals',    color: '#BA0C2F', abbrev: 'WSH' },
};

const MAX_CHARS = 280;

// ══════════════════════════════════════════════════════════
// Compose bar (on feed page)
// ══════════════════════════════════════════════════════════
export function initCompose(user, userDoc, onPosted) {
  const textarea   = document.getElementById('rb-compose-input');
  const counter    = document.getElementById('rb-char-counter');
  const postBtn    = document.getElementById('rb-compose-post-btn');
  const avatarEl   = document.getElementById('rb-compose-avatar');

  if (!textarea) return;

  // Set avatar
  if (avatarEl && userDoc) {
    avatarEl.style.background = userDoc.team_color || '#555';
    avatarEl.textContent = userDoc.team_abbrev || '?';
  }

  // Char counter
  textarea.addEventListener('input', () => {
    const remaining = MAX_CHARS - textarea.value.length;
    if (counter) {
      counter.textContent = remaining;
      counter.className = 'rb-char-counter'
        + (remaining < 20  ? ' warning' : '')
        + (remaining < 0   ? ' danger'  : '');
    }
    if (postBtn) postBtn.disabled = textarea.value.trim().length === 0 || remaining < 0;
  });

  // Post submit
  if (postBtn) {
    postBtn.addEventListener('click', () => submitPost(textarea, user, userDoc, onPosted));
  }

  // Enter + Ctrl/Cmd submit
  textarea.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      submitPost(textarea, user, userDoc, onPosted);
    }
  });
}

async function submitPost(textarea, user, userDoc, onPosted) {
  if (!user || !userDoc) return;
  const content = textarea.value.trim();
  if (!content || content.length > MAX_CHARS) return;

  const hashtags = [...content.matchAll(/#(\w+)/g)].map(m => '#' + m[1]);

  try {
    await addDoc(collection(firestore, 'posts'), {
      content,
      author_type:         'user',
      author_name:         userDoc.display_name,
      author_handle:       userDoc.handle,
      author_uid:          user.uid,
      author_team_id:      userDoc.team_id,
      author_verified:     userDoc.verified || false,
      author_avatar_color: userDoc.team_color,
      author_initials:     userDoc.team_abbrev,
      hashtags,
      timestamp:           serverTimestamp(),
      like_count:          0,
      reply_count:         0,
      repost_count:        0,
      parent_post_id:      null,
      is_ai_generated:     false,
    });

    // Increment user post count
    await updateDoc(doc(firestore, 'users', user.uid), { post_count: increment(1) });

    textarea.value = '';
    const counter = document.getElementById('rb-char-counter');
    if (counter) { counter.textContent = MAX_CHARS; counter.className = 'rb-char-counter'; }
    const postBtn = document.getElementById('rb-compose-post-btn');
    if (postBtn) postBtn.disabled = true;

    showToast('Rumbl\'ing posted!');
    if (onPosted) onPosted();
  } catch (err) {
    console.error('Post error:', err);
    showToast('Could not post. Try again.');
  }
}

// ══════════════════════════════════════════════════════════
// Sign-up page
// ══════════════════════════════════════════════════════════
export function initSignup() {
  let selectedTeam = null;
  let currentStep  = 1;

  // Build team grid
  const grid = document.getElementById('rb-team-grid');
  if (grid) {
    Object.entries(TEAM_DATA).sort((a, b) => a[1].name.localeCompare(b[1].name)).forEach(([id, t]) => {
      const card = document.createElement('div');
      card.className = 'rb-team-card';
      card.dataset.teamId = id;
      card.innerHTML = `
        <div class="rb-team-circle" style="background:${t.color}">${t.abbrev}</div>
        <div class="rb-team-name">${t.name}</div>
      `;
      card.addEventListener('click', () => {
        grid.querySelectorAll('.rb-team-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedTeam = id;
        const btn = document.getElementById('rb-step1-next');
        if (btn) btn.disabled = false;
      });
      grid.appendChild(card);
    });
  }

  // Step 1 → Step 2
  const step1Next = document.getElementById('rb-step1-next');
  if (step1Next) {
    step1Next.addEventListener('click', () => {
      if (!selectedTeam) return;
      // Auto-fill handle suggestion
      const handleInput = document.getElementById('rb-handle');
      if (handleInput && !handleInput.value) {
        handleInput.value = `@${TEAM_DATA[selectedTeam].abbrev}Official`;
      }
      // Show avatar preview
      const prevCircle = document.getElementById('rb-preview-circle');
      if (prevCircle) {
        prevCircle.style.background = TEAM_DATA[selectedTeam].color;
        prevCircle.textContent = TEAM_DATA[selectedTeam].abbrev;
      }
      goToStep(2);
    });
  }

  // Step 2 → Step 3 (review)
  const step2Next = document.getElementById('rb-step2-next');
  if (step2Next) {
    step2Next.addEventListener('click', () => {
      if (!validateStep2()) return;
      // Populate review
      const t = TEAM_DATA[selectedTeam];
      setText('rb-review-name',   document.getElementById('rb-display-name')?.value || '');
      setText('rb-review-handle', document.getElementById('rb-handle')?.value || '');
      setText('rb-review-team',   t.name);
      const rc = document.getElementById('rb-review-circle');
      if (rc) { rc.style.background = t.color; rc.textContent = t.abbrev; }
      goToStep(3);
    });
  }

  // Back buttons
  document.getElementById('rb-step2-back')?.addEventListener('click', () => goToStep(1));
  document.getElementById('rb-step3-back')?.addEventListener('click', () => goToStep(2));

  // Final submit
  const submitBtn = document.getElementById('rb-signup-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => handleSignup(selectedTeam));
  }

  // Handle suggestion — enforce @ prefix
  const handleInput = document.getElementById('rb-handle');
  if (handleInput) {
    handleInput.addEventListener('blur', () => {
      if (!handleInput.value.startsWith('@')) handleInput.value = '@' + handleInput.value;
    });
  }

  function goToStep(step) {
    currentStep = step;
    document.querySelectorAll('.rb-signup-step').forEach((el, i) => {
      el.style.display = i + 1 === step ? 'block' : 'none';
    });
    document.querySelectorAll('.rb-step-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i + 1 === step);
      dot.classList.toggle('done',   i + 1 < step);
    });
  }

  function validateStep2() {
    const name   = document.getElementById('rb-display-name')?.value.trim();
    const handle = document.getElementById('rb-handle')?.value.trim();
    const email  = document.getElementById('rb-email')?.value.trim();
    const pass   = document.getElementById('rb-password')?.value;
    let ok = true;
    if (!name)   { setError('rb-name-error',   'Display name is required.'); ok = false; }
    if (!handle) { setError('rb-handle-error', 'Handle is required.'); ok = false; }
    if (!email || !/\S+@\S+\.\S+/.test(email)) { setError('rb-email-error', 'Valid email required.'); ok = false; }
    if (!pass || pass.length < 8) { setError('rb-pass-error', 'Password must be 8+ characters.'); ok = false; }
    return ok;
  }
}

async function handleSignup(selectedTeam) {
  const name   = document.getElementById('rb-display-name')?.value.trim();
  const handle = document.getElementById('rb-handle')?.value.trim();
  const email  = document.getElementById('rb-email')?.value.trim();
  const pass   = document.getElementById('rb-password')?.value;
  const bio    = document.getElementById('rb-bio')?.value.trim() || '';
  const t      = TEAM_DATA[selectedTeam];
  const errEl  = document.getElementById('rb-signup-error');
  const btn    = document.getElementById('rb-signup-submit');

  if (btn) btn.disabled = true;
  if (errEl) errEl.textContent = '';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await sendEmailVerification(cred.user);
    await setDoc(doc(firestore, 'users', cred.user.uid), {
      email,
      display_name:  name,
      handle,
      team_id:       selectedTeam,
      team_name:     t.name,
      team_color:    t.color,
      team_abbrev:   t.abbrev,
      verified:      false,
      joined_at:     serverTimestamp(),
      post_count:    0,
      bio,
    });
    window.location.href = './?welcome=1';
  } catch (err) {
    console.error('Signup error:', err);
    const msg = err.code === 'auth/email-already-in-use'
      ? 'That email is already registered.'
      : err.code === 'auth/weak-password'
      ? 'Password is too weak.'
      : 'Sign-up failed. Try again.';
    if (errEl) errEl.textContent = msg;
    if (btn) btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════
// Login page
// ══════════════════════════════════════════════════════════
export function initLogin() {
  const form   = document.getElementById('rb-login-form');
  const errEl  = document.getElementById('rb-login-error');
  const resetL = document.getElementById('rb-forgot-link');

  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('rb-login-email')?.value.trim();
      const pass  = document.getElementById('rb-login-pass')?.value;
      if (errEl) errEl.textContent = '';
      try {
        await signInWithEmailAndPassword(auth, email, pass);
        const redirect = new URLSearchParams(location.search).get('redirect') || './';
        window.location.href = redirect;
      } catch (err) {
        if (errEl) errEl.textContent = 'Invalid email or password.';
      }
    });
  }

  if (resetL) {
    resetL.addEventListener('click', async e => {
      e.preventDefault();
      const email = document.getElementById('rb-login-email')?.value.trim();
      if (!email) { if (errEl) errEl.textContent = 'Enter your email first.'; return; }
      try {
        await sendPasswordResetEmail(auth, email);
        showToast('Password reset email sent!');
      } catch (_) {
        showToast('Could not send reset email.');
      }
    });
  }
}

// ══════════════════════════════════════════════════════════
// Sign-out
// ══════════════════════════════════════════════════════════
export function initSignOut() {
  const btn = document.getElementById('rb-signout-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      await signOut(auth);
      window.location.href = './';
    });
  }
}

// ══════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
