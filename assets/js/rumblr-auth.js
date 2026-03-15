/**
 * rumblr-auth.js — Auth + Compose
 * Handles: sign-up, login, sign-out, post composer.
 */

import { firestore, auth, storage } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, addDoc, collection,
  serverTimestamp, increment, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  ref as storageRef, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { showToast, notifyFollowers, initMentionAutocomplete, setInitCompose } from './rumblr-app.js';

// ── Team data (color_1 from team_season_branding) ─────────
// image: path relative to /rumblr/ pages (GitHub Pages URL)
const TEAM_IMG_BASE = '../assets/images/rumblr/team%20profile%20images/2026/';
export const TEAM_DATA = {
  ARI: { name: 'Arizona Diamondbacks',    color: '#2CCCD3', abbrev: 'ARI', image: TEAM_IMG_BASE + 'ARI%202026.jpg' },
  ATL: { name: 'Atlanta Braves',          color: '#002855', abbrev: 'ATL', image: TEAM_IMG_BASE + 'ATL%202026.jpg' },
  BOS: { name: 'Boston Red Sox',          color: '#0C2340', abbrev: 'BOS', image: TEAM_IMG_BASE + 'BOS%202026.jpg' },
  CHC: { name: 'Chicago Cubs',            color: '#002F6C', abbrev: 'CHC', image: TEAM_IMG_BASE + 'CHC%202026.jpg' },
  CIN: { name: 'Cincinnati Reds',         color: '#BA0C2F', abbrev: 'CIN', image: TEAM_IMG_BASE + 'CIN%202026.jpg' },
  COL: { name: 'Colorado Rockies',        color: '#330072', abbrev: 'COL', image: TEAM_IMG_BASE + 'COL%202026.jpg' },
  HOU: { name: 'Houston Astros',          color: '#FF8200', abbrev: 'HOU', image: TEAM_IMG_BASE + 'HOU%202026.jpg' },
  LVA: { name: 'Las Vegas Athletics',     color: '#006341', abbrev: 'LVA', image: TEAM_IMG_BASE + 'LV%202026.jpg' },
  MIA: { name: 'Miami Marlins',           color: '#00A3E0', abbrev: 'MIA', image: TEAM_IMG_BASE + 'MIA%202026.jpg' },
  MIL: { name: 'Milwaukee Brewers',       color: '#13294B', abbrev: 'MIL', image: TEAM_IMG_BASE + 'MIL%202026.jpg' },
  NYY: { name: 'New York Yankees',        color: '#0C2340', abbrev: 'NYY', image: TEAM_IMG_BASE + 'NYY%202026.jpg' },
  PHI: { name: 'Philadelphia Phillies',   color: '#002D72', abbrev: 'PHI', image: TEAM_IMG_BASE + 'PHI%202026.jpg' },
  SAN: { name: 'San Diego Padres',        color: '#3E342F', abbrev: 'SAN', image: TEAM_IMG_BASE + 'SD%202026.jpg' },
  SEA: { name: 'Seattle Mariners',        color: '#0C2340', abbrev: 'SEA', image: TEAM_IMG_BASE + 'SEA%202026.jpg' },
  STL: { name: 'St. Louis Cardinals',     color: '#0C2340', abbrev: 'STL', image: TEAM_IMG_BASE + 'STL%202026.jpg' },
  LAD: { name: 'Los Angeles Dodgers',     color: '#002F6C', abbrev: 'LAD', image: TEAM_IMG_BASE + 'LAD%202026.jpg' },
  TOR: { name: 'Toronto Blue Jays',       color: '#041E42', abbrev: 'TOR', image: TEAM_IMG_BASE + 'TOR%202026.jpg' },
  WSH: { name: 'Washington Nationals',    color: '#BA0C2F', abbrev: 'WSH', image: TEAM_IMG_BASE + 'WSH%202026.jpg' },
};

const MAX_CHARS = 280;

// ── Avatar picker config ───────────────────────────────────
const AVATAR_BASE = '../assets/images/rumblr/team%20profile%20images/';

// year → { nameMap?, ext?, extMap? }
// nameMap: abbrev overrides for filename (e.g. LVA → LV)
// ext: single extension for all teams
// extMap: per-team extension (use 'default' as fallback)
const AVATAR_YEARS = {
  '2026': { ext: 'jpg',  nameMap: { LVA: 'LV', SAN: 'SD' } },
  '2025': { nameMap: { SAN: 'SDP' }, extMap: { ARI: 'jpg', CIN: 'jpg', LVA: 'jpg', default: 'JPG' } },
  '2024': { ext: 'png',  nameMap: { SAN: 'SDP' } },
};

function getAvatarUrl(year, abbrev) {
  const opts = AVATAR_YEARS[year];
  if (!opts) return null;
  const name = opts.nameMap?.[abbrev] || abbrev;
  const ext  = opts.ext || (opts.extMap && (opts.extMap[abbrev] || opts.extMap.default)) || 'jpg';
  return `${AVATAR_BASE}${year}/${encodeURIComponent(name + ' ' + year)}.${ext}`;
}

// ══════════════════════════════════════════════════════════
// Compose bar (on feed page and own profile page)
// ══════════════════════════════════════════════════════════

// ── Static OG page generator ─────────────────────────────────────────────────
// Creates rumblr/p/{postId}.html in the GitHub repo with post-specific OG tags,
// enabling Discord/social link previews. Requires Firestore doc config/github
// = { pat: "<github-pat>", owner: "LemonLyman86", repo: "sandlottribune" }
async function createOgPage(postId, postData) {
  try {
    const ghSnap = await getDoc(doc(firestore, 'config', 'github'));
    if (!ghSnap.exists()) return;
    const { pat, owner, repo } = ghSnap.data();
    if (!pat || !owner || !repo) return;

    const base     = `https://${owner}.github.io/${repo}`;
    const ogImage  = postData.image_url || postData.author_image
                  || `${base}/assets/images/rumblr-logo.png`;
    const ogTitle  = `${postData.author_name} on Rumblr`;
    const filePath = `rumblr/p/${postId}.html`;
    const pageUrl  = `${base}/${filePath}`;
    const esc = s => String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const html = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <meta property="og:type"        content="article">',
      '  <meta property="og:site_name"   content="Rumblr — TSDL">',
      `  <meta property="og:title"       content="${esc(ogTitle)}">`,
      `  <meta property="og:description" content="${esc(postData.content || '')}">`,
      `  <meta property="og:image"       content="${esc(ogImage)}">`,
      `  <meta property="og:url"         content="${esc(pageUrl)}">`,
      '  <meta name="twitter:card"       content="summary_large_image">',
      `  <title>${esc(ogTitle)}</title>`,
      `  <meta http-equiv="refresh" content="0; url=../post.html?id=${postId}">`,
      '</head>',
      '<body>',
      `  <script>window.location.replace('../post.html?id=${postId}');<\/script>`,
      `  <p><a href="../post.html?id=${postId}">View this Ruml’ing →</a></p>`,
      '</body>',
      '</html>'
    ].join('
');

    const bytes = new TextEncoder().encode(html);
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    const encoded = btoa(bin);

    const apiBase  = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const checkRes = await fetch(apiBase, { headers: { Authorization: `token ${pat}` } });
    const body = { message: `rumblr: og page for post ${postId}`, content: encoded };
    if (checkRes.ok) { const ex = await checkRes.json(); body.sha = ex.sha; }

    await fetch(apiBase, {
      method: 'PUT',
      headers: { Authorization: `token ${pat}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch(e) {
    console.warn('[Rumblr] OG page skipped:', e.message);
  }
}

export function initCompose(user, userDoc, onPosted) {
  const textarea   = document.getElementById('rb-compose-input');
  const counter    = document.getElementById('rb-char-counter');
  const postBtn    = document.getElementById('rb-compose-post-btn');
  const avatarEl   = document.getElementById('rb-compose-avatar');

  if (!textarea) return;

  // Set avatar: profile picture > team logo image > team color + initials
  if (avatarEl && userDoc) {
    const imgSrc = userDoc.avatar_url
      || TEAM_DATA[userDoc.team_abbrev]?.image
      || null;
    if (imgSrc) {
      avatarEl.innerHTML = `<img src="${imgSrc}" alt="Avatar"
        style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
        onerror="this.outerHTML='<span style=&quot;color:#fff&quot;>${userDoc.team_abbrev || '?'}</span>';">`;
      avatarEl.style.background = userDoc.team_color || '#555';
    } else {
      avatarEl.style.background = userDoc.team_color || '#555';
      avatarEl.textContent = userDoc.team_abbrev || '?';
    }
  }

  // @ mention autocomplete
  initMentionAutocomplete(textarea);

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

  // ── Image attachment ─────────────────────────────────────
  // imageRef is a shared object so submitPost() can read the blob
  const imageRef = { blob: null };

  const imgBtn     = document.getElementById('rb-compose-img-btn');
  const imgInput   = document.getElementById('rb-img-input');
  const imgPreview = document.getElementById('rb-compose-image-preview');
  const imgThumb   = document.getElementById('rb-compose-img-thumb');
  const imgRemove  = document.getElementById('rb-compose-img-remove');
  const cropModal  = document.getElementById('rb-crop-modal');
  const cropImgEl  = document.getElementById('rb-crop-image');
  let   cropperInst = null;

  // Open file picker
  imgBtn?.addEventListener('click', () => imgInput?.click());

  // File chosen → load into crop modal
  imgInput?.addEventListener('change', () => {
    const file = imgInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      if (!cropImgEl || !cropModal) return;
      cropImgEl.src = e.target.result;
      cropModal.classList.remove('hidden');
      cropperInst?.destroy();
      // Cropper is loaded as a global script (CDN) — window.Cropper
      cropperInst = new window.Cropper(cropImgEl, {
        aspectRatio: 16 / 9,
        viewMode:    1,
        autoCropArea: 1,
      });
    };
    reader.readAsDataURL(file);
    imgInput.value = ''; // allow re-selecting same file
  });

  // Cancel crop (both the ✕ and Cancel button)
  ['rb-crop-cancel', 'rb-crop-cancel-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      cropperInst?.destroy();
      cropperInst = null;
      if (cropModal) cropModal.classList.add('hidden');
    });
  });

  // Confirm crop → generate JPEG blob → show thumbnail
  document.getElementById('rb-crop-confirm')?.addEventListener('click', () => {
    if (!cropperInst) return;
    cropperInst.getCroppedCanvas({ width: 1200, height: 675 }).toBlob(blob => {
      imageRef.blob = blob;
      const objectUrl = URL.createObjectURL(blob);
      if (imgThumb)   imgThumb.src = objectUrl;
      if (imgPreview) imgPreview.style.display = 'flex';
      cropperInst.destroy();
      cropperInst = null;
      if (cropModal) cropModal.classList.add('hidden');
    }, 'image/jpeg', 0.85);
  });

  // Remove attached image
  imgRemove?.addEventListener('click', () => {
    imageRef.blob = null;
    if (imgThumb)   imgThumb.src = '';
    if (imgPreview) imgPreview.style.display = 'none';
  });

  // Post submit
  if (postBtn) {
    postBtn.addEventListener('click', () => submitPost(textarea, user, userDoc, onPosted, imageRef, imgPreview, imgThumb));
  }

  // Enter + Ctrl/Cmd submit
  textarea.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      submitPost(textarea, user, userDoc, onPosted, imageRef, imgPreview, imgThumb);
    }
  });
}

async function submitPost(textarea, user, userDoc, onPosted, imageRef, imgPreview, imgThumb) {
  if (!user || !userDoc) return;
  const content = textarea.value.trim();
  if (!content || content.length > MAX_CHARS) return;

  const hashtags = [...content.matchAll(/#(\w+)/g)].map(m => '#' + m[1]);
  const mentions = [...content.matchAll(/@(\w+)/g)].map(m => '@' + m[1]);

  // Disable post button while submitting
  const postBtn = document.getElementById('rb-compose-post-btn');
  if (postBtn) postBtn.disabled = true;

  try {
    // Upload image if one was attached
    let image_url = null;
    if (imageRef?.blob) {
      const imgPath = `rumblr/posts/${user.uid}/${Date.now()}.jpg`;
      const imgRef  = storageRef(storage, imgPath);
      const snap    = await uploadBytes(imgRef, imageRef.blob, { contentType: 'image/jpeg' });
      image_url     = await getDownloadURL(snap.ref);
      // Clear pending image state
      imageRef.blob = null;
      if (imgPreview) imgPreview.style.display = 'none';
      if (imgThumb)   imgThumb.src = '';
    }

    const postData = {
      content,
      author_type:         'user',
      author_name:         userDoc.display_name,
      author_handle:       userDoc.handle,
      author_uid:          user.uid,
      author_team_id:      userDoc.team_id,
      author_verified:     userDoc.verified || false,
      author_image:        userDoc.avatar_url || null,
      author_avatar_color: userDoc.team_color,
      author_initials:     userDoc.team_abbrev,
      hashtags,
      mentions,
      timestamp:           serverTimestamp(),
      like_count:          0,
      reply_count:         0,
      repost_count:        0,
      parent_post_id:      null,
      is_ai_generated:     false,
      image_url,
    };

    const postRef = await addDoc(collection(firestore, 'posts'), postData);

    // Generate OG card image in background (fire-and-forget)
    generateOgCard(postRef.id, content, userDoc, image_url);
    // Generate static OG redirect page for Discord/social sharing
    createOgPage(postRef.id, postData).catch(() => {});

    // Increment user post count
    await updateDoc(doc(firestore, 'users', user.uid), { post_count: increment(1) });

    // Notify followers who have opted in for new posts
    notifyFollowers(userDoc.handle, userDoc.display_name, postRef.id, content, 'new_post');

    textarea.value = '';
    const counter = document.getElementById('rb-char-counter');
    if (counter) { counter.textContent = MAX_CHARS; counter.className = 'rb-char-counter'; }
    if (postBtn) postBtn.disabled = true;

    showToast('Rumbl\'ing posted!');
    if (onPosted) onPosted();
  } catch (err) {
    console.error('Post error:', err);
    showToast('Could not post. Try again.');
    if (postBtn) postBtn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════
// OG card image generator
// Draws a 1200×630 post card, uploads to rumblr/og/{postId}.jpg,
// then updates the post doc with og_image_url (fire-and-forget).
// ══════════════════════════════════════════════════════════
async function generateOgCard(postId, content, userDoc, attachedImageUrl) {
  try {
    if (document.fonts?.ready) await document.fonts.ready;

    const W = 1200, H = 630;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // ── Background ────────────────────────────────────────
    ctx.fillStyle = '#0D1117';
    ctx.fillRect(0, 0, W, H);

    // Subtle vignette gradient
    const vg = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.8);
    vg.addColorStop(0, 'rgba(22,27,34,0)');
    vg.addColorStop(1, 'rgba(4,9,15,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // ── Red top bar ───────────────────────────────────────
    ctx.fillStyle = '#C8102E';
    ctx.fillRect(0, 0, W, 10);

    // ── Rumblr brand top-right ────────────────────────────
    ctx.fillStyle = '#C8102E';
    ctx.font = 'bold 30px Oswald, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('Rumblr', W - 54, 34);

    // ── Author avatar circle ──────────────────────────────
    const ax = 78, ay = 128, ar = 44;
    ctx.beginPath();
    ctx.arc(ax, ay, ar, 0, Math.PI * 2);
    ctx.fillStyle = userDoc?.team_color || '#555555';
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Oswald, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((userDoc?.team_abbrev || '?').slice(0, 3), ax, ay);

    // ── Author name + handle ──────────────────────────────
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px Oswald, sans-serif';
    ctx.fillText(userDoc?.display_name || 'Author', 144, 94);

    ctx.fillStyle = '#718096';
    ctx.font = '24px Oswald, sans-serif';
    ctx.fillText(userDoc?.handle || '', 144, 134);

    // ── Post content (text-wrapped) ───────────────────────
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '34px Marcellus, Georgia, serif';
    ctx.textBaseline = 'top';

    const contentMaxWidth = attachedImageUrl ? 580 : 1040;
    const lines = wrapCanvasText(ctx, content, contentMaxWidth);
    const MAX_LINES = 8;
    lines.slice(0, MAX_LINES).forEach((line, i) => {
      ctx.fillText(line, 78, 198 + i * 50);
    });
    if (lines.length > MAX_LINES) {
      ctx.fillStyle = '#718096';
      ctx.fillText('…', 78, 198 + MAX_LINES * 50);
    }

    // ── Attached image thumbnail (right side) ─────────────
    if (attachedImageUrl) {
      await new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const tx = 640, ty = 86, tw = 506, th = 284;
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(tx, ty, tw, th, 12);
          ctx.clip();
          ctx.drawImage(img, tx, ty, tw, th);
          ctx.restore();
          resolve();
        };
        img.onerror = resolve; // skip if image fails to load
        img.src = attachedImageUrl;
      });
    }

    // ── Bottom bar ────────────────────────────────────────
    ctx.fillStyle = '#161B22';
    ctx.fillRect(0, H - 54, W, 54);
    ctx.fillStyle = '#C8102E';
    ctx.font = 'bold 22px Oswald, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Rumblr', 40, H - 27);
    ctx.fillStyle = '#4A5568';
    ctx.font = '20px Oswald, sans-serif';
    ctx.fillText('· The Sandlot Dynasty League', 116, H - 27);

    // ── Export + upload ───────────────────────────────────
    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    );
    const imgRef  = storageRef(storage, `rumblr/og/${postId}.jpg`);
    const upload  = await uploadBytes(imgRef, blob, { contentType: 'image/jpeg' });
    const ogUrl   = await getDownloadURL(upload.ref);

    await updateDoc(doc(firestore, 'posts', postId), { og_image_url: ogUrl });
  } catch (err) {
    console.warn('OG card generation failed:', err);
  }
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ══════════════════════════════════════════════════════════
// Sign-up page
// ══════════════════════════════════════════════════════════
export function initSignup() {
  let selectedTeam     = null;
  let isFanAccount     = false;
  let selectedAvatarUrl = null;   // null = use team color circle
  let activeAvatarYear  = '2026';
  let currentStep       = 1;

  // ── Step 1: Build team grid ──────────────────────────────
  const grid = document.getElementById('rb-team-grid');
  if (grid) {
    Object.entries(TEAM_DATA).sort((a, b) => a[1].name.localeCompare(b[1].name)).forEach(([id, t]) => {
      const card = document.createElement('div');
      card.className = 'rb-team-card';
      card.dataset.teamId = id;
      const logoHtml = t.image
        ? `<img class="rb-team-logo" src="${t.image}" alt="${t.abbrev}"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
           <div class="rb-team-circle" style="background:${t.color};display:none;">${t.abbrev}</div>`
        : `<div class="rb-team-circle" style="background:${t.color}">${t.abbrev}</div>`;
      card.innerHTML = `${logoHtml}<div class="rb-team-name">${t.name}</div>`;
      card.addEventListener('click', () => {
        grid.querySelectorAll('.rb-team-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedTeam = id;
        isFanAccount = false;
        const fanBtn = document.getElementById('rb-fan-btn');
        if (fanBtn) fanBtn.classList.remove('active');
        const btn = document.getElementById('rb-step1-next');
        if (btn) btn.disabled = false;
      });
      grid.appendChild(card);
    });
  }

  // ── Fan account option ───────────────────────────────────
  const fanBtn = document.getElementById('rb-fan-btn');
  if (fanBtn) {
    fanBtn.addEventListener('click', () => {
      grid?.querySelectorAll('.rb-team-card').forEach(c => c.classList.remove('selected'));
      selectedTeam = null;
      isFanAccount = true;
      fanBtn.classList.add('active');
      const nextBtn = document.getElementById('rb-step1-next');
      if (nextBtn) nextBtn.disabled = false;
    });
  }

  // ── Avatar picker: year tabs ─────────────────────────────
  document.querySelectorAll('.rb-avatar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.rb-avatar-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeAvatarYear = tab.dataset.year;
      buildAvatarGrid(activeAvatarYear);
    });
  });

  function buildAvatarGrid(year) {
    const gridEl = document.getElementById('rb-avatar-grid');
    if (!gridEl) return;
    gridEl.innerHTML = '';

    const teams = Object.entries(TEAM_DATA).sort((a, b) => a[1].name.localeCompare(b[1].name));

    teams.forEach(([abbrev, t]) => {
      const opt = document.createElement('div');
      opt.className = 'rb-avatar-option';
      opt.dataset.abbrev = abbrev;

      if (year === 'letters') {
        // Color circle with team abbreviation
        opt.innerHTML = `
          <div class="rb-team-circle" style="background:${t.color};width:44px;height:44px;
               display:flex;align-items:center;justify-content:center;border-radius:50%;
               font-family:'Oswald',sans-serif;font-weight:700;font-size:0.78rem;color:#fff;">${abbrev}</div>
          <span class="rb-option-label">${abbrev}</span>`;
        opt.addEventListener('click', () => {
          selectAvatar(null, `${t.name} (${abbrev})`, opt);
        });
      } else {
        const url = getAvatarUrl(year, abbrev);
        opt.innerHTML = `
          <img src="${url}" alt="${abbrev}"
               style="width:44px;height:44px;border-radius:50%;object-fit:cover;"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
          <div class="rb-team-circle" style="background:${t.color};width:44px;height:44px;display:none;
               align-items:center;justify-content:center;border-radius:50%;
               font-family:'Oswald',sans-serif;font-weight:700;font-size:0.78rem;color:#fff;">${abbrev}</div>
          <span class="rb-option-label">${abbrev}</span>`;
        opt.addEventListener('click', () => {
          selectAvatar(url, `${abbrev} ${year}`, opt);
        });
      }

      // Restore selected state after rebuild
      if (year !== 'letters' && selectedAvatarUrl === getAvatarUrl(year, abbrev)) {
        opt.classList.add('selected');
      }

      gridEl.appendChild(opt);
    });
  }

  function selectAvatar(url, label, optEl) {
    document.querySelectorAll('#rb-avatar-grid .rb-avatar-option').forEach(o => o.classList.remove('selected'));
    if (optEl) optEl.classList.add('selected');
    selectedAvatarUrl = url;

    // Show preview
    const previewWrap  = document.getElementById('rb-avatar-selected-preview');
    const previewEl    = document.getElementById('rb-avatar-preview-el');
    const previewLabel = document.getElementById('rb-avatar-preview-label');
    if (previewWrap && previewEl) {
      previewWrap.style.display = 'flex';
      if (url) {
        const t = selectedTeam ? TEAM_DATA[selectedTeam] : null;
        previewEl.innerHTML = `<img src="${url}" alt="${label}"
          style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--rb-border);"
          onerror="this.style.display='none';">`;
      } else {
        // Letters tab — show team color circle
        const t = selectedTeam ? TEAM_DATA[selectedTeam] : { color: '#555', abbrev: '?' };
        const abParts = label.match(/\((\w+)\)/);
        const ab = abParts ? abParts[1] : '?';
        const tData = TEAM_DATA[ab] || t;
        previewEl.innerHTML = `<div style="width:48px;height:48px;border-radius:50%;
          background:${tData.color};display:flex;align-items:center;justify-content:center;
          font-family:'Oswald',sans-serif;font-weight:700;font-size:0.85rem;color:#fff;">${ab}</div>`;
      }
      if (previewLabel) previewLabel.textContent = label;
    }
  }

  // ── Step 1 → Step 2 ──────────────────────────────────────
  const step1Next = document.getElementById('rb-step1-next');
  if (step1Next) {
    step1Next.addEventListener('click', () => {
      if (!selectedTeam && !isFanAccount) return;
      // Build avatar grid
      buildAvatarGrid('2026');
      if (isFanAccount) {
        // No pre-selection for fans — they pick any logo
        const handleInput = document.getElementById('rb-handle');
        if (handleInput && !handleInput.value) handleInput.value = '@';
      } else {
        const t = TEAM_DATA[selectedTeam];
        // Auto-fill handle suggestion
        const handleInput = document.getElementById('rb-handle');
        if (handleInput && !handleInput.value) handleInput.value = `@${t.abbrev}Official`;
        // Auto-select this team's 2026 image
        const autoUrl = getAvatarUrl('2026', selectedTeam);
        const autoOpt = document.querySelector(`#rb-avatar-grid .rb-avatar-option[data-abbrev="${selectedTeam}"]`);
        selectAvatar(autoUrl, `${selectedTeam} 2026`, autoOpt);
      }
      goToStep(2);
    });
  }

  // ── Step 2 → Step 3 (review) ─────────────────────────────
  const step2Next = document.getElementById('rb-step2-next');
  if (step2Next) {
    step2Next.addEventListener('click', () => {
      if (!validateStep2()) return;
      const t = isFanAccount ? null : TEAM_DATA[selectedTeam];
      setText('rb-review-name',   document.getElementById('rb-display-name')?.value || '');
      setText('rb-review-handle', document.getElementById('rb-handle')?.value || '');
      setText('rb-review-team',   t ? t.name : 'Fan Account');
      // Review avatar
      const rc = document.getElementById('rb-preview-circle');
      if (rc) {
        if (selectedAvatarUrl) {
          const fallbackColor = t ? t.color : '#555';
          const fallbackText  = t ? t.abbrev : '?';
          rc.innerHTML = `<img src="${selectedAvatarUrl}" alt="avatar"
            style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
            onerror="this.style.display='none';this.parentElement.style.background='${fallbackColor}';this.parentElement.textContent='${fallbackText}';">`;
          rc.style.background = 'transparent';
        } else {
          rc.style.background = t ? t.color : '#555';
          rc.textContent = t ? t.abbrev : '?';
        }
      }
      goToStep(3);
    });
  }

  // Back buttons
  document.getElementById('rb-step2-back')?.addEventListener('click', () => goToStep(1));
  document.getElementById('rb-step3-back')?.addEventListener('click', () => goToStep(2));

  // Final submit
  const submitBtn = document.getElementById('rb-signup-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', () => handleSignup(selectedTeam, isFanAccount, selectedAvatarUrl));
  }

  // Handle field — enforce @ prefix
  const handleInput = document.getElementById('rb-handle');
  if (handleInput) {
    handleInput.addEventListener('blur', () => {
      if (handleInput.value && !handleInput.value.startsWith('@')) {
        handleInput.value = '@' + handleInput.value;
      }
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

async function handleSignup(selectedTeam, isFanAccount, avatarUrl) {
  const name   = document.getElementById('rb-display-name')?.value.trim();
  const handle = document.getElementById('rb-handle')?.value.trim();
  const email  = document.getElementById('rb-email')?.value.trim();
  const pass   = document.getElementById('rb-password')?.value;
  const bio    = document.getElementById('rb-bio')?.value.trim() || '';
  const t      = isFanAccount ? null : TEAM_DATA[selectedTeam];
  const errEl  = document.getElementById('rb-signup-error');
  const btn    = document.getElementById('rb-signup-submit');

  if (btn) btn.disabled = true;
  if (errEl) errEl.textContent = '';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await sendEmailVerification(cred.user);
    const userDoc = {
      email,
      display_name:  name,
      handle,
      account_type:  isFanAccount ? 'fan' : 'team',
      team_id:       t ? selectedTeam : null,
      team_name:     t ? t.name : null,
      team_color:    t ? t.color : '#555555',
      team_abbrev:   t ? t.abbrev : null,
      verified:      false,
      joined_at:     serverTimestamp(),
      post_count:    0,
      bio,
    };
    if (avatarUrl) userDoc.avatar_url = avatarUrl;
    await setDoc(doc(firestore, 'users', cred.user.uid), userDoc);
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

// Register initCompose with rumblr-app (breaks the circular import cycle)
setInitCompose(initCompose);

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
