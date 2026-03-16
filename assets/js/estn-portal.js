/**
 * estn-portal.js — ESTN Portal Homepage Logic
 * Loads static JSON data (standings, matchups, transactions),
 * reads Firestore settings overrides, and renders all dynamic sections.
 */

import { firestore } from './firebase-config.js';
import {
  collection, query, orderBy, limit, getDocs, doc, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Route article URLs through Between The Chalk reader ───────────────────────
// Converts a direct article URL (e.g. "season-previews/foo.html" or
// "between-the-chalk/bar.html") to a BTC deep-link (?article=...).
// Already-correct BTC deep-links are returned unchanged.
function toBtcUrl(url) {
  if (!url) return url;
  // Already a BTC deep-link
  if (url.includes('between-the-chalk/') && url.includes('?article=')) return url;
  // between-the-chalk article — pass just filename
  const btcMatch = url.match(/between-the-chalk\/([^/?#]+\.html)/);
  if (btcMatch) return `between-the-chalk/?article=${btcMatch[1]}`;
  // season-previews article — pass relative path from BTC dir
  const spMatch = url.match(/(season-previews\/[^?#]+\.html)/);
  if (spMatch) return `between-the-chalk/?article=../${spMatch[1]}`;
  // Fallback: send as-is
  return url;
}

// ── Ad pool ────────────────────────────────────────────────────────────────────
const PARODY_ADS = [
  { id: 'gif',             file: 'gif.jpg'             },
  { id: 'lost-it',        file: 'lost-it.jpg'         },
  { id: 'krispy-kremated', file: 'krispy_kremated.jpg' },
  { id: 'spotty-wifi',    file: 'spotty_wifi.jpg'     },
  { id: 'stay-inn',       file: 'stay_inn.jpg'        },
  { id: 'oops',           file: 'oops.jpg'            },
  { id: 'wwf',            file: 'wwf.jpg'             },
  { id: 'starwars-coffee',file: 'starwars_coffee.jpg' },
  { id: 'olympics',       file: 'olympics.jpg'        },
  { id: 'adobo',          file: 'adobo.jpg'           },
  { id: 'blink',          file: 'blink.jpg'           },
];

const PROGRAM_ADS = [
  {
    id: 'rumblr-ad',
    logo: 'assets/images/rumblr-logo.png',
    eyebrow: '&#x25CF;&nbsp; Now Live on ESTN',
    headline: 'The Dynasty League Finally Has Its Own Social Feed.',
    sub: 'Follow the writers. Post your takes. 18 teams. One feed. All the TSDL.',
    cta: 'Join Rumblr',
    href: 'rumblr/',
    bg: 'linear-gradient(135deg,#0D1117 0%,#161B22 60%,#1a0a0a 100%)',
    borderColor: '#2D3748'
  },
  {
    id: 'tribune-ad',
    logo: 'assets/images/logo.png',
    eyebrow: 'The Sandlot Tribune',
    headline: 'Season Previews, Power Rankings, Trade Analysis &amp; More.',
    sub: 'Long-form dynasty coverage from the writers you trust.',
    cta: 'Read Now',
    href: 'tribune/',
    bg: 'linear-gradient(135deg,#1a1005 0%,#120c00 100%)',
    borderColor: '#2D3748'
  },
  {
    id: 'podcast-ad',
    logo: 'assets/images/baberuth-podcast-logo.png',
    eyebrow: 'Coming Soon &mdash; ESTN Audio',
    headline: 'The Babe Ruth Podcast.',
    sub: 'Deep dynasty analysis, trade breakdowns, and hot takes. Coming 2026.',
    cta: 'Get Notified',
    href: 'about/',
    bg: 'linear-gradient(135deg,#0a0a15 0%,#10102a 100%)',
    borderColor: '#2D3748'
  }
];

// ── Utilities ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function timeAgo(date) {
  if (!date) return '';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)    return `${diff}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

// ── Fetch static JSON ──────────────────────────────────────────────────────────
async function fetchJSON(path) {
  try {
    const res = await fetch(path + '?v=' + Date.now());
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Load Firestore settings ────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const snap = await getDoc(doc(firestore, 'settings', 'estn'));
    return snap.exists() ? snap.data() : {};
  } catch {
    return {};
  }
}

// ── Render standings (left pillar) ─────────────────────────────────────────────
function renderStandings(data) {
  const el = document.getElementById('portal-standings');
  if (!el) return;

  if (!data || data.season_status === 'pre_season' || !data.teams || !data.teams.length) {
    el.innerHTML = '<p class="estn-pre-season-label">Season begins soon &mdash; check back after Opening Day!</p>';
    const hdrEl = document.getElementById('portal-standings-header');
    if (hdrEl) hdrEl.textContent = '2026 Standings';
    return;
  }

  const hdrEl = document.getElementById('portal-standings-header');
  if (hdrEl) hdrEl.textContent = `${data.season} Standings — ${data.period_label}`;

  const top = data.teams.slice(0, 10);
  el.innerHTML = `
    <table class="estn-standings-table">
      <thead>
        <tr>
          <th colspan="2">Team</th>
          <th>W</th><th>L</th>
        </tr>
      </thead>
      <tbody>
        ${top.map(t => {
          const chg = t.rank_change || 0;
          const chgHtml = chg > 0
            ? `<span class="estn-standings-change-up">&#x25B2;${chg}</span>`
            : chg < 0
            ? `<span class="estn-standings-change-down">&#x25BC;${Math.abs(chg)}</span>`
            : `<span class="estn-standings-change-flat">&mdash;</span>`;
          return `
            <tr>
              <td class="estn-standings-rank">${t.rank}</td>
              <td class="estn-standings-abbrev">${esc(t.abbrev)} ${chgHtml}</td>
              <td class="estn-standings-record">${t.wins}</td>
              <td class="estn-standings-record">${t.losses}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// ── Render right-pillar standings ──────────────────────────────────────────────
function renderFullStandings(data) {
  const el = document.getElementById('portal-full-standings');
  if (!el) return;

  if (!data || data.season_status === 'pre_season' || !data.teams || !data.teams.length) {
    el.innerHTML = '<p class="estn-pre-season-label">Season standings will appear here after Opening Day.</p>';
    return;
  }

  el.innerHTML = `
    <table class="estn-standings-table">
      <thead>
        <tr><th colspan="2">Team</th><th>W</th><th>L</th><th>PF</th></tr>
      </thead>
      <tbody>
        ${data.teams.map(t => `
          <tr>
            <td class="estn-standings-rank">${t.rank}</td>
            <td class="estn-standings-abbrev">${esc(t.abbrev)}</td>
            <td class="estn-standings-record">${t.wins}</td>
            <td class="estn-standings-record">${t.losses}</td>
            <td class="estn-standings-record" style="font-size:0.7rem;color:#718096;">${t.points_for > 0 ? t.points_for : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ── Render scoreboard ──────────────────────────────────────────────────────────
function renderScoreboard(data) {
  const el = document.getElementById('portal-scoreboard');
  if (!el) return;

  const labelEl = document.getElementById('portal-scoreboard-label');

  if (!data || data.season_status === 'pre_season' || !data.matchups || !data.matchups.length) {
    if (labelEl) labelEl.textContent = '2026 Season — Opening Day Coming Soon';
    el.innerHTML = `
      <div class="estn-scoreboard-pre-season">
        <div class="ps-icon">⚾</div>
        <div class="ps-title">The 2026 Season Starts Soon</div>
        <div class="ps-sub">Matchup scoreboards will appear here once the season begins. Check back after Opening Day!</div>
      </div>`;
    return;
  }

  if (labelEl) {
    const liveTag = data.is_live ? ' <span style="color:#C8102E;font-size:0.68rem;font-weight:700;letter-spacing:0.1em;vertical-align:middle;">● LIVE</span>' : '';
    labelEl.innerHTML = `${data.season} &mdash; ${esc(data.period_label)}${liveTag}`;
  }

  // Format date range for card footers (e.g. "Mar 25 – Apr 5")
  function fmtDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso + 'T12:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return iso; }
  }
  const periodDates = (data.period_start && data.period_end)
    ? `${fmtDate(data.period_start)} \u2013 ${fmtDate(data.period_end)}`
    : '';

  el.innerHTML = `
    <div class="estn-scoreboard-grid">
      ${data.matchups.map(m => {
        const t1win = m.winner === 'team1';
        const t2win = m.winner === 'team2';
        const hasFinal = m.status === 'final';
        const isLive = data.is_live && m.status === 'in_progress';
        const t1cls = hasFinal ? (t1win ? 'winner' : 'loser') : '';
        const t2cls = hasFinal ? (t2win ? 'winner' : 'loser') : '';
        const barCls = hasFinal ? 'final' : isLive ? 'live' : 'preview';
        const footerLabel = hasFinal ? 'Final'
          : isLive ? '<span style="color:#C8102E;font-weight:700;">&#x25CF; LIVE</span>'
          : (periodDates || 'Upcoming');
        return `
          <div class="estn-matchup-card">
            <div class="estn-matchup-status-bar ${barCls}"></div>
            <div class="estn-matchup-row">
              <div class="estn-matchup-team ${t1cls}">
                ${t1win ? '&#x25B6;&nbsp;' : ''}<span class="estn-matchup-abbrev">${esc(m.team1_abbrev)}</span>
              </div>
              <div class="estn-matchup-score ${t1cls}">${m.team1_score > 0 ? m.team1_score : '—'}</div>
            </div>
            <div class="estn-matchup-row">
              <div class="estn-matchup-team ${t2cls}">
                ${t2win ? '&#x25B6;&nbsp;' : ''}<span class="estn-matchup-abbrev">${esc(m.team2_abbrev)}</span>
              </div>
              <div class="estn-matchup-score ${t2cls}">${m.team2_score > 0 ? m.team2_score : '—'}</div>
            </div>
            <div class="estn-matchup-card-footer">${footerLabel}</div>
          </div>`;
      }).join('')}
    </div>`;
}

// ── Render transactions ────────────────────────────────────────────────────────
function renderTransactions(data) {
  const el = document.getElementById('portal-transactions');
  if (!el) return;
  if (!data || !data.transactions || !data.transactions.length) {
    el.innerHTML = '<p class="estn-pre-season-label">No transactions yet this season.</p>';
    return;
  }

  const dotClass = { faab_pickup: 'claimed', drop: 'released', trade: 'traded' };
  const labelClass = { faab_pickup: 'claimed', drop: 'released', trade: 'traded' };

  el.innerHTML = data.transactions.slice(0, 15).map(t => {
    const dc = dotClass[t.type] || 'default';
    const lc = labelClass[t.type] || '';
    return `
      <div class="estn-txn-item">
        <div class="estn-txn-type-dot ${dc}"></div>
        <div class="estn-txn-text">
          <span class="estn-txn-player">${esc(t.player)}</span>
          <span style="color:#718096;"> &mdash; </span>
          <span class="estn-txn-team">${esc(t.team_abbrev)}</span>
          ${t.details ? `<span class="estn-txn-detail"> &middot; ${esc(t.details)}</span>` : ''}
        </div>
        <span class="estn-txn-type-label ${lc}">${esc(t.type_label)}</span>
        <div class="estn-txn-date">${esc(t.date_display || t.date)}</div>
      </div>`;
  }).join('');
}

// ── Render right-pillar Tribune Headlines ──────────────────────────────────────
function renderHeadlines(txnData, customHeadlines) {
  const el = document.getElementById('portal-headlines');
  if (!el) return;

  // Only show admin-defined headlines — no transaction auto-fill
  if (!customHeadlines || !customHeadlines.length) {
    el.innerHTML = '<p class="estn-pre-season-label">No headlines at this time.</p>';
    return;
  }

  el.innerHTML = customHeadlines.map(h => {
    const text    = typeof h === 'string' ? h : (h.text || '');
    const rawDate = typeof h === 'string' ? '' : (h.date || '');
    const url     = typeof h === 'string' ? null : (h.url || null);

    let date = '';
    if (rawDate) {
      try {
        date = new Date(rawDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      } catch { date = ''; }
    }

    // Link to specific Tribune edition if a slug is provided, otherwise to Tribune root
    const href = url
      ? `tribune/?edition=${encodeURIComponent(url)}`
      : 'tribune/';

    return `
      <a class="estn-headline-item" href="${href}" style="text-decoration:none;display:flex;gap:10px;align-items:flex-start;">
        <span class="estn-headline-bullet">&#x25CF;</span>
        <div class="estn-headline-text">
          ${esc(text)}
          ${date ? `<span class="estn-headline-date">${esc(date)}</span>` : ''}
        </div>
      </a>`;
  }).join('');
}

// ── Render Rumblr preview ──────────────────────────────────────────────────────
const userAvatarCache = {};
async function fetchUserAvatar(uid) {
  if (uid in userAvatarCache) return userAvatarCache[uid];
  try {
    const snap = await getDoc(doc(firestore, 'users', uid));
    const url = snap.exists() ? (snap.data().avatar_url || null) : null;
    userAvatarCache[uid] = url;
    return url;
  } catch { return null; }
}

const WRITER_IMAGES = {
  '@JeffPassan':    'assets/images/rumblr/jeff_passan.png',
  '@Ken_Rosenthal': 'assets/images/rumblr/ken_rosenthal.png',
  '@BNightengale':  'assets/images/rumblr/bob_nightengale.png',
  '@JonHeyman':     'assets/images/rumblr/jon_heyman.png',
  '@Buster_ESPN':   'assets/images/rumblr/buster_olney.png',
  '@TKurkjian':     'assets/images/rumblr/tim_kurkjian.png',
  '@Keithlaw':      'assets/images/rumblr/keith_law.png',
  '@jaysonst':      'assets/images/rumblr/jason_stark.png',
  '@joelsherman1':  'assets/images/rumblr/joel_sherman.png',
  '@pgammo':        'assets/images/rumblr/peter_gammons.png',
};

async function renderRumblrPreview() {
  const el = document.getElementById('portal-rumblr-feed');
  if (!el) return;
  try {
    const snap = await getDocs(query(
      collection(firestore, 'posts'),
      orderBy('timestamp', 'desc'),
      limit(4)
    ));
    if (snap.empty) {
      el.innerHTML = `<div style="padding:20px;color:#718096;font-family:'Oswald',sans-serif;font-size:0.85rem;text-align:center;">No Rumbl'ings yet. <a href="rumblr/" style="color:#C8102E;">Be the first &rarr;</a></div>`;
      return;
    }
    const html = snap.docs.map(d => {
      const p = d.data();
      const t = p.timestamp?.toDate ? p.timestamp.toDate() : new Date();
      // Image: check WRITER_IMAGES by handle, then stored author_image (strip ../ for root context)
      const rawImg = WRITER_IMAGES[p.author_handle]
        || (p.author_image ? p.author_image.replace(/^(\.\.\/)+/, '') : null);
      const imgSrc = rawImg || null;
      const avatarColor = esc(p.author_avatar_color || '#555');
      const avatarText  = esc(p.author_initials || '??');
      const initialsStyle = `width:34px;height:34px;border-radius:50%;background:${avatarColor};display:flex;align-items:center;justify-content:center;font-family:Oswald,sans-serif;font-size:0.7rem;color:#fff;flex-shrink:0;`;
      // Always render both; on img error hide img + reveal initials fallback
      // data-uid lets the async avatar fetch below update this element
      const uidAttr = p.author_uid ? ` data-uid="${esc(p.author_uid)}"` : '';
      const avatarHtml = `<div style="flex-shrink:0;position:relative;"${uidAttr}>
        ${imgSrc ? `<img src="${esc(imgSrc)}" alt="${esc(p.author_name)}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;display:block;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">` : ''}
        <div style="${initialsStyle};${imgSrc ? 'display:none;' : ''}">${avatarText}</div>
      </div>`;
      const content = esc(p.content || '').replace(/#(\w+)/g, '<span style="color:#C8102E;">#$1</span>');
      return `
        <a href="rumblr/post.html?id=${esc(d.id)}" style="display:flex;gap:10px;padding:11px 14px;border-bottom:1px solid #2D3748;text-decoration:none;transition:background 0.12s;" onmouseover="this.style.background='#1a2030'" onmouseout="this.style.background='transparent'">
          ${avatarHtml}
          <div style="flex:1;min-width:0;">
            <div style="display:flex;gap:6px;align-items:baseline;margin-bottom:3px;">
              <span style="font-family:'Oswald',sans-serif;font-size:0.84rem;font-weight:600;color:#fff;">${esc(p.author_name)}</span>
              ${p.author_verified ? '<span style="font-size:0.74rem;">⚾</span>' : ''}
              <span style="font-family:'Oswald',sans-serif;font-size:0.76rem;color:#A0AEC0;">${esc(p.author_handle)}</span>
              <span style="font-family:'Oswald',sans-serif;font-size:0.72rem;color:#718096;margin-left:auto;">${timeAgo(t)}</span>
            </div>
            <div style="font-family:'Marcellus',serif;font-size:0.84rem;color:#E2E8F0;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${content}</div>
          </div>
        </a>`;
    }).join('');
    el.innerHTML = html + `<div style="text-align:center;padding:10px;border-top:1px solid #2D3748;"><a href="rumblr/" style="font-family:'Oswald',sans-serif;font-size:0.78rem;color:#C8102E;text-decoration:none;letter-spacing:0.06em;text-transform:uppercase;">View All Rumbl'ings &rarr;</a></div>`;

    // Async: for user posts without a resolved image, fetch avatar from their Firestore profile
    snap.docs.forEach(d => {
      const p = d.data();
      if (!p.author_uid) return;
      if (WRITER_IMAGES[p.author_handle] || p.author_image) return; // already has image
      fetchUserAvatar(p.author_uid).then(url => {
        if (!url) return;
        const wrap = el.querySelector(`[data-uid="${p.author_uid}"]`);
        if (!wrap) return;
        const normalUrl = url.replace(/^(\.\.\/)+/, '');
        const img = wrap.querySelector('img');
        const fallback = wrap.querySelector('div');
        if (img) {
          img.src = normalUrl;
          img.style.display = 'block';
          if (fallback) fallback.style.display = 'none';
        } else if (fallback) {
          const color = p.author_avatar_color || '#555';
          const initText = p.author_initials || '??';
          const iStyle = `width:34px;height:34px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-family:Oswald,sans-serif;font-size:0.7rem;color:#fff;flex-shrink:0;`;
          wrap.innerHTML = `<img src="${normalUrl}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;display:block;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div style="${iStyle};display:none;">${initText}</div>`;
        }
      });
    });
  } catch (err) {
    console.error('Rumblr preview error:', err);
    el.innerHTML = `<div style="padding:16px;color:#718096;font-size:0.82rem;text-align:center;"><a href="rumblr/" style="color:#C8102E;">Visit Rumblr &rarr;</a></div>`;
  }
}

// ── Ticker cycling (fade in/out per item) ──────────────────────────────────────
function startTickerCycle(items, textEl) {
  if (!textEl || items.length <= 1) return;
  textEl.style.transition = 'opacity 0.4s ease';
  let idx = 0;
  setInterval(() => {
    textEl.style.opacity = '0';
    setTimeout(() => {
      idx = (idx + 1) % items.length;
      textEl.textContent = items[idx];
      textEl.style.opacity = '1';
    }, 400);
  }, 5000);
}

// ── Render ticker ──────────────────────────────────────────────────────────────
async function loadTicker() {
  const tickerBar = document.querySelector('.estn-ticker');
  const tickerEl  = document.getElementById('estn-ticker-text');
  try {
    const tickerSnap = await getDoc(doc(firestore, 'settings', 'ticker'));
    if (tickerSnap.exists()) {
      const td = tickerSnap.data();

      // Hide ticker only if globally disabled
      if (td.enabled === false) {
        if (tickerBar) tickerBar.style.display = 'none';
        return;
      }
      if (tickerEl && td.items && td.items.length) {
        tickerEl.textContent = td.items[0];
        startTickerCycle(td.items, tickerEl);
      }
    }
  } catch { /* use default */ }
}

// ── Render ads ─────────────────────────────────────────────────────────────────
function buildParodyAdHtml(ad, compact) {
  return `
    <div class="estn-ad-unit${compact ? ' estn-pillar-ad' : ''}">
      <div class="ad-label">Advertisement</div>
      <img src="assets/images/site%20ads/${esc(ad.file)}" alt="" style="width:100%;display:block;border-radius:4px;" loading="lazy">
    </div>`;
}

function buildProgramAdHtml(ad) {
  return `
    <div class="estn-ad-unit">
      <div class="ad-label">Advertisement</div>
      <div class="estn-program-ad" style="background:${ad.bg};border:1px solid ${ad.borderColor};">
        <div style="position:absolute;top:0;left:0;width:3px;height:100%;background:#C8102E;"></div>
        <img class="estn-program-ad-logo" src="${ad.logo}" alt="" onerror="this.style.display='none'">
        <div class="estn-program-ad-copy">
          <div class="estn-program-ad-eyebrow">${ad.eyebrow}</div>
          <div class="estn-program-ad-headline">${ad.headline}</div>
          <div class="estn-program-ad-sub">${ad.sub}</div>
        </div>
        <a class="estn-program-ad-cta" href="${ad.href}">${ad.cta} &rarr;</a>
      </div>
    </div>`;
}

function renderAds(disabledAds, adSlots) {
  const disabled = new Set(disabledAds || []);
  const slots    = adSlots || {};

  const availableParody   = shuffle(PARODY_ADS.filter(a => !disabled.has(a.id)));
  const availableProgram  = shuffle(PROGRAM_ADS.filter(a => !disabled.has(a.id)));

  const pinnedParody  = id => PARODY_ADS.find(a => a.id === id);
  const pinnedProgram = id => PROGRAM_ADS.find(a => a.id === id);

  // Center column: program ad
  const centerAd1El = document.getElementById('portal-center-ad-program');
  if (centerAd1El) {
    const ad = (slots.center_program && pinnedProgram(slots.center_program)) || availableProgram[0];
    if (ad) centerAd1El.innerHTML = buildProgramAdHtml(ad);
  }

  // Center column: parody ad (top)
  const centerAd2El = document.getElementById('portal-center-ad-parody1');
  if (centerAd2El) {
    const ad = (slots.center_parody1 && pinnedParody(slots.center_parody1)) || availableParody[0];
    if (ad) centerAd2El.innerHTML = buildParodyAdHtml(ad, false);
  }

  // Center column: parody ad (bottom)
  const centerAd3El = document.getElementById('portal-center-ad-parody2');
  if (centerAd3El) {
    const ad = (slots.center_parody2 && pinnedParody(slots.center_parody2)) || availableParody[1];
    if (ad) centerAd3El.innerHTML = buildParodyAdHtml(ad, false);
  }

  // Left pillar: compact parody ad
  const rightAdEl = document.getElementById('portal-pillar-ad');
  if (rightAdEl) {
    const ad = (slots.pillar && pinnedParody(slots.pillar)) || availableParody[2];
    if (ad) rightAdEl.innerHTML = buildParodyAdHtml(ad, true);
  }
}

// ── Render programs (left pillar) ──────────────────────────────────────────────
// Accepts full settings object. Uses settings.programs array from Firestore if present;
// falls back to hardcoded defaults (preserving hidden_programs for migration).
const DEFAULT_PROGRAMS = [
  {
    id: 'rumblr',
    name: 'Rumblr',
    subtitle: '',
    status: 'Now Live',
    statusCls: 'live',
    href: 'rumblr/',
    logo: 'assets/images/rumblr-logo.png',
    enabled: true,
  },
  {
    id: 'tribune',
    name: 'The Sandlot Tribune',
    subtitle: '',
    status: 'Now Live',
    statusCls: 'live',
    href: 'tribune/',
    logo: 'assets/images/logo.png',
    enabled: true,
  },
  {
    id: 'podcast',
    name: 'Babe Ruth Podcast',
    subtitle: '',
    status: 'Coming in 2026',
    statusCls: 'coming-soon',
    href: 'about/',
    logo: 'assets/images/baberuth-podcast-logo.png',
    enabled: true,
  },
];

function renderPrograms(settings) {
  const el = document.getElementById('portal-programs');
  if (!el) return;

  // Use Firestore programs array if available, otherwise fall back to hardcoded defaults
  let programs;
  if (settings && Array.isArray(settings.programs) && settings.programs.length > 0) {
    programs = settings.programs;
  } else {
    // Fallback: use defaults, applying legacy hidden_programs if present
    const hidden = new Set((settings && settings.hidden_programs) || []);
    programs = DEFAULT_PROGRAMS.map(p => ({ ...p, enabled: !hidden.has(p.id) }));
  }

  el.innerHTML = programs
    .filter(p => p.enabled !== false)
    .map(p => `
      <a href="${esc(p.href)}" class="estn-program-pill">
        <div class="estn-program-pill-icon">
          <img src="${esc(p.logo)}" alt="${esc(p.name)}" onerror="this.parentElement.textContent='${esc(p.name[0])}'">
        </div>
        <div class="estn-program-pill-info">
          <span class="estn-program-pill-name">${esc(p.name)}</span>
          ${p.subtitle ? `<span class="estn-program-pill-sub">${esc(p.subtitle)}</span>` : ''}
          <span class="estn-program-pill-status ${esc(p.statusCls)}">${esc(p.status)}</span>
        </div>
      </a>`).join('');
}

// ── Render quick links (left pillar) ───────────────────────────────────────────
const DEFAULT_QUICK_LINKS = [
  { label: 'League Records',       url: 'league-records/' },
  { label: 'Season Deadlines',     url: 'season-deadlines/' },
  { label: 'Between The Chalk',    url: 'between-the-chalk/' },
  { label: 'Season Previews',      url: 'season-previews/' },
];

function renderQuickLinks(links) {
  const el = document.getElementById('portal-quick-links');
  if (!el) return;
  const items = (links && links.length) ? links : DEFAULT_QUICK_LINKS;
  el.innerHTML = items.map(l => `
    <li>
      <a href="${esc(l.url)}">
        <div class="estn-network-link-icon gold">&#x2192;</div>
        ${esc(l.label)}
      </a>
    </li>`).join('');
}

// ── Apply featured article override ───────────────────────────────────────────
function applyFeaturedOverride(settings) {
  if (!settings || !settings.featured_article || !settings.featured_article.pinned) return;
  const fa = settings.featured_article;

  const titleEl = document.getElementById('featured-title');
  const metaEl  = document.getElementById('featured-meta');
  const linkEl  = document.getElementById('featured-link');
  const imgEl   = document.getElementById('featured-img');
  const excerptEl = document.getElementById('featured-excerpt');

  if (titleEl && fa.title)   titleEl.textContent = fa.title;
  if (metaEl && fa.byline)   metaEl.textContent  = fa.byline;
  if (linkEl && fa.url)      linkEl.href         = toBtcUrl(fa.url);
  if (excerptEl && fa.excerpt) excerptEl.textContent = fa.excerpt;
  if (imgEl && fa.image_url) {
    imgEl.src = fa.image_url;
    imgEl.style.display = 'block';
    const placeholder = document.getElementById('featured-img-placeholder');
    if (placeholder) placeholder.style.display = 'none';
  }

  // Sub-story
  if (fa.sub_story_title || fa.sub_story_url) {
    const subEl = document.getElementById('featured-sub-story');
    if (subEl) {
      const subTitle = subEl.querySelector('.estn-sub-story-title');
      if (subTitle && fa.sub_story_title) subTitle.textContent = fa.sub_story_title;
      if (fa.sub_story_url) subEl.href = toBtcUrl(fa.sub_story_url);
      if (fa.sub_story_img) {
        const subImg = subEl.querySelector('.estn-sub-story-img');
        if (subImg) subImg.src = fa.sub_story_img;
      }
    }
  }
}

// ── MiLB Draft Board ───────────────────────────────────────────────────────────

const DRAFT_CONFIG = {
  rounds: 10,
  total_picks: 83,
  teams: [
    { abbrev:'MIA', name:'Miami Marlins',          retained:5, color:'#00A3E0' },
    { abbrev:'CHC', name:'Chicago Cubs',            retained:1, color:'#C8102E' },
    { abbrev:'NYY', name:'New York Yankees',        retained:9, color:'#A0AEC0' },
    { abbrev:'COL', name:'Colorado Rockies',        retained:6, color:'#7B2FBE' },
    { abbrev:'CIN', name:'Cincinnati Reds',         retained:6, color:'#BA0C2F' },
    { abbrev:'BOS', name:'Boston Red Sox',          retained:8, color:'#C8102E' },
    { abbrev:'WSH', name:'Washington Nationals',    retained:7, color:'#BA0C2F' },
    { abbrev:'PHI', name:'Philadelphia Phillies',   retained:8, color:'#E03040' },
    { abbrev:'MIL', name:'Milwaukee Brewers',       retained:6, color:'#FFC72C' },
    { abbrev:'LAD', name:'Los Angeles Dodgers',     retained:5, color:'#005A9E' },
    { abbrev:'ATL', name:'Atlanta Braves',          retained:3, color:'#CE1141' },
    { abbrev:'HOU', name:'Houston Astros',          retained:5, color:'#FF8200' },
    { abbrev:'TOR', name:'Toronto Blue Jays',       retained:5, color:'#6CACE4' },
    { abbrev:'SDP', name:'San Diego Padres',        retained:6, color:'#FFC72C' },
    { abbrev:'SEA', name:'Seattle Mariners',        retained:4, color:'#00685E' },
    { abbrev:'LVA', name:'Las Vegas Athletics',     retained:7, color:'#FFB81C' },
    { abbrev:'STL', name:'St. Louis Cardinals',     retained:4, color:'#C41E3A' },
    { abbrev:'ARI', name:'Arizona Diamondbacks',    retained:2, color:'#2CCCD3' },
  ]
};

function draftIsRetained(team, round) {
  // Retained players fill from Round 10 downward
  return round > (DRAFT_CONFIG.rounds - team.retained);
}

// Returns { onClockTeam, onClockRound, lastPickTeam, lastPickRound, lastPickData }
function getDraftStatus(picks) {
  let onClockTeam = null, onClockRound = null;
  let lastPickTeam = null, lastPickRound = null, lastPickData = null, lastTs = 0;

  // Find last pick by timestamp (falls back to sequential order if no ts)
  let lastFilledKey = null;
  for (const [key, pick] of Object.entries(picks)) {
    if (!pick || !pick.player) continue;
    if (pick.ts && pick.ts > lastTs) {
      lastTs = pick.ts;
      lastFilledKey = key;
    }
  }
  // If no timestamps, fall back to last filled pick in draft order
  if (!lastFilledKey) {
    for (let r = 1; r <= DRAFT_CONFIG.rounds; r++) {
      for (const t of DRAFT_CONFIG.teams) {
        if (draftIsRetained(t, r)) continue;
        const k = `${t.abbrev}_${r}`;
        if (picks[k] && picks[k].player) lastFilledKey = k;
      }
    }
  }
  if (lastFilledKey) {
    const idx = lastFilledKey.lastIndexOf('_');
    lastPickTeam  = lastFilledKey.slice(0, idx);
    lastPickRound = parseInt(lastFilledKey.slice(idx + 1));
    lastPickData  = picks[lastFilledKey];
  }

  // Find on-clock: first empty non-retained slot in sequential order
  outer:
  for (let r = 1; r <= DRAFT_CONFIG.rounds; r++) {
    for (const t of DRAFT_CONFIG.teams) {
      if (draftIsRetained(t, r)) continue;
      if (!picks[`${t.abbrev}_${r}`] || !picks[`${t.abbrev}_${r}`].player) {
        onClockTeam = t.abbrev; onClockRound = r; break outer;
      }
    }
  }

  return { onClockTeam, onClockRound, lastPickTeam, lastPickRound, lastPickData };
}

function draftCellHtml(team, round, picks, status) {
  if (draftIsRetained(team, round)) {
    return `<div title="Slot used by retained 2025 MiLB player" style="background:#0d0d12;color:#2D3748;font-size:0.67rem;font-style:italic;font-family:'Marcellus',serif;padding:7px 6px;border-radius:3px;text-align:center;border:1px solid #1A2030;">Retained</div>`;
  }
  const key  = `${team.abbrev}_${round}`;
  const pick = picks[key];
  const isOnClock  = status && status.onClockTeam === team.abbrev && status.onClockRound === round;
  const isLastPick = status && status.lastPickTeam === team.abbrev && status.lastPickRound === round;

  if (isOnClock) {
    return `<div style="border:2px solid #34D399;border-radius:3px;padding:6px 7px;background:rgba(52,211,153,0.07);text-align:center;">
      <div style="font-family:'Oswald',sans-serif;font-size:0.6rem;font-weight:700;color:#34D399;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:3px;">&#x25B6; On the Clock</div>
      <div style="font-family:'Oswald',sans-serif;font-size:0.82rem;font-weight:700;color:#34D399;">${esc(team.abbrev)}</div>
    </div>`;
  }
  if (pick && pick.player) {
    const border = isLastPick ? '2px solid #FBBF24' : '1px solid #2D3748';
    const bg     = isLastPick ? 'rgba(251,191,36,0.06)' : '#1A2030';
    return `<div style="background:${bg};border:${border};border-radius:3px;padding:6px 7px;${isLastPick?'position:relative;':''}">
      ${isLastPick ? '<div style="position:absolute;top:3px;right:4px;font-size:0.55rem;font-family:Oswald,sans-serif;color:#FBBF24;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Last Pick</div>' : ''}
      <div style="font-family:'Oswald',sans-serif;font-size:0.8rem;font-weight:600;color:#E2E8F0;line-height:1.3;padding-right:${isLastPick?'36px':'0'};">${esc(pick.player)}</div>
      <div style="font-size:0.65rem;color:#718096;margin-top:2px;">${esc(pick.pos || '')}${pick.pos && pick.org ? ' &middot; ' : ''}${esc(pick.org || '')}</div>
    </div>`;
  }
  return `<div style="border:1px dashed #2D3748;border-radius:3px;padding:7px 6px;text-align:center;color:#4A5568;font-family:'Oswald',sans-serif;font-size:0.9rem;">—</div>`;
}

function draftStatusBarHtml(picks) {
  const { onClockTeam, onClockRound, lastPickTeam, lastPickRound, lastPickData } = getDraftStatus(picks);
  const parts = [];
  if (lastPickTeam && lastPickData) {
    const team = DRAFT_CONFIG.teams.find(t => t.abbrev === lastPickTeam);
    parts.push(`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="font-family:'Oswald',sans-serif;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;color:#FBBF24;text-transform:uppercase;">&#x2713; Last Pick</span>
      <span style="font-family:'Oswald',sans-serif;font-size:0.78rem;color:#E2E8F0;font-weight:600;">${esc(lastPickData.player)}</span>
      <span style="font-size:0.68rem;color:#718096;">${esc(lastPickData.pos||'')}${lastPickData.pos&&lastPickData.org?' · ':''}${esc(lastPickData.org||'')}</span>
      <span style="font-family:'Oswald',sans-serif;font-size:0.68rem;color:#718096;">&mdash; <span style="color:${team?team.color:'#A0AEC0'};font-weight:600;">${esc(lastPickTeam)}</span> Rd ${lastPickRound}</span>
    </div>`);
  }
  if (onClockTeam) {
    const team = DRAFT_CONFIG.teams.find(t => t.abbrev === onClockTeam);
    parts.push(`<div style="display:flex;align-items:center;gap:8px;">
      <span style="font-family:'Oswald',sans-serif;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;color:#34D399;text-transform:uppercase;">&#x25B6; On the Clock</span>
      <span style="font-family:'Oswald',sans-serif;font-size:0.78rem;font-weight:700;color:${team?team.color:'#34D399'};">${esc(onClockTeam)}</span>
      <span style="font-family:'Marcellus',serif;font-size:0.72rem;color:#A0AEC0;">${esc(team?team.name:'')}</span>
      <span style="font-size:0.68rem;color:#718096;">&mdash; Round ${onClockRound}</span>
    </div>`);
  } else if (Object.keys(picks).length > 0) {
    parts.push(`<div style="font-family:'Oswald',sans-serif;font-size:0.72rem;color:#34D399;font-weight:700;">&#x2713; Draft Complete!</div>`);
  }
  if (!parts.length) return '';
  return `<div style="background:#161B22;border:1px solid #2D3748;border-bottom:none;border-radius:6px 6px 0 0;padding:8px 14px;display:flex;gap:20px;flex-wrap:wrap;align-items:center;">${parts.join('<div style="width:1px;background:#2D3748;align-self:stretch;"></div>')}</div>`;
}

function renderDraftByRound(picks) {
  const teams = DRAFT_CONFIG.teams;
  const rounds = DRAFT_CONFIG.rounds;
  const pickCount = Object.keys(picks).length;
  const status = getDraftStatus(picks);

  const headerCells = teams.map(t => {
    const avail = rounds - t.retained;
    const isOnClock = status.onClockTeam === t.abbrev;
    return `<th style="padding:8px 5px;text-align:center;border-top:3px solid ${t.color};border-bottom:1px solid #2D3748;border-right:1px solid #1A2030;min-width:112px;background:${isOnClock?'rgba(52,211,153,0.05)':'#161B22'};position:sticky;top:0;z-index:1;">
      <div style="font-family:'Oswald',sans-serif;font-size:0.82rem;font-weight:700;color:${isOnClock?'#34D399':'#E2E8F0'};">${esc(t.abbrev)}</div>
      <div style="font-size:0.6rem;color:#718096;margin-top:1px;">${avail} pick${avail!==1?'s':''}</div>
    </th>`;
  }).join('');

  const rows = [];
  for (let r = 1; r <= rounds; r++) {
    const cells = teams.map(t => `<td style="padding:5px;border-right:1px solid #1A2030;border-bottom:1px solid #1A2030;vertical-align:top;">${draftCellHtml(t, r, picks, status)}</td>`).join('');
    rows.push(`<tr>
      <td style="position:sticky;left:0;background:#161B22;z-index:2;padding:6px 12px;border-right:2px solid #2D3748;border-bottom:1px solid #1A2030;font-family:'Oswald',sans-serif;font-size:0.75rem;font-weight:700;color:#718096;text-align:center;white-space:nowrap;">Rd ${r}</td>
      ${cells}
    </tr>`);
  }

  return `${draftStatusBarHtml(picks)}
  <div style="background:#161B22;border:1px solid #2D3748;${Object.keys(picks).length?'border-top:none;':''}border-radius:${Object.keys(picks).length?'0 0':'6px 6px'} 6px 6px;overflow:hidden;">
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;min-width:100%;">
        <thead><tr>
          <th style="position:sticky;left:0;z-index:3;background:#161B22;padding:8px 12px;border-right:2px solid #2D3748;border-bottom:1px solid #2D3748;font-family:'Oswald',sans-serif;font-size:0.7rem;color:#4A5568;text-transform:uppercase;letter-spacing:0.08em;">Round</th>
          ${headerCells}
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
    <div style="padding:8px 14px;text-align:right;font-family:'Oswald',sans-serif;font-size:0.7rem;color:#718096;border-top:1px solid #1A2030;">
      <span style="color:${pickCount===DRAFT_CONFIG.total_picks?'#34D399':'#A0AEC0'};font-weight:600;">${pickCount}</span> / ${DRAFT_CONFIG.total_picks} picks made
    </div>
  </div>`;
}

function renderDraftByTeam(picks) {
  const rounds = DRAFT_CONFIG.rounds;
  const pickCount = Object.keys(picks).length;
  const status = getDraftStatus(picks);

  const cards = DRAFT_CONFIG.teams.map(t => {
    const avail = rounds - t.retained;
    const isOnClock  = status.onClockTeam  === t.abbrev;
    const isLastPick = status.lastPickTeam === t.abbrev;
    const cardBorder = isOnClock ? '2px solid #34D399' : '1px solid #2D3748';
    const cardBg     = isOnClock ? 'rgba(52,211,153,0.04)' : '#161B22';
    const pickRows = [];
    for (let r = 1; r <= avail; r++) {
      const key  = `${t.abbrev}_${r}`;
      const pick = picks[key];
      const rowIsLast = isLastPick && status.lastPickRound === r;
      pickRows.push(`<div style="display:flex;gap:8px;align-items:baseline;padding:5px 0;border-bottom:1px solid rgba(45,55,72,0.4);${rowIsLast?'background:rgba(251,191,36,0.04);':''}">
        <span style="font-family:'Oswald',sans-serif;font-size:0.65rem;color:#4A5568;min-width:22px;flex-shrink:0;">Rd ${r}</span>
        ${pick && pick.player
          ? `<div style="min-width:0;flex:1;"><div style="font-family:'Oswald',sans-serif;font-size:0.78rem;color:#E2E8F0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(pick.player)}</div><div style="font-size:0.62rem;color:#718096;">${esc(pick.pos||'')}${pick.pos&&pick.org?' · ':''}${esc(pick.org||'')}</div></div>${rowIsLast?'<span style="font-family:Oswald,sans-serif;font-size:0.55rem;color:#FBBF24;font-weight:700;text-transform:uppercase;flex-shrink:0;">Last</span>':''}`
          : `<span style="font-family:'Oswald',sans-serif;font-size:0.78rem;color:#374151;">—</span>`
        }
      </div>`);
    }
    if (t.retained > 0) {
      const retStart = avail + 1;
      pickRows.push(`<div style="padding:5px 0;font-size:0.65rem;color:#2D3748;font-style:italic;font-family:'Marcellus',serif;">Rd ${retStart}–${rounds}: ${t.retained} retained keeper${t.retained!==1?'s':''}</div>`);
    }
    return `<div style="background:${cardBg};border:${cardBorder};border-top:3px solid ${isOnClock?'#34D399':t.color};border-radius:6px;overflow:hidden;">
      <div style="padding:8px 12px;border-bottom:1px solid #2D3748;display:flex;align-items:center;gap:8px;">
        <span style="font-family:'Oswald',sans-serif;font-size:0.88rem;font-weight:700;color:${isOnClock?'#34D399':'#E2E8F0'};">${esc(t.abbrev)}</span>
        ${isOnClock ? '<span style="font-family:Oswald,sans-serif;font-size:0.6rem;font-weight:700;color:#34D399;letter-spacing:0.08em;text-transform:uppercase;background:rgba(52,211,153,0.1);padding:2px 7px;border-radius:10px;">On the Clock</span>' : ''}
        <span style="font-family:'Marcellus',serif;font-size:0.68rem;color:#718096;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.name)}</span>
        <span style="font-family:'Oswald',sans-serif;font-size:0.65rem;color:#4A5568;white-space:nowrap;">${avail} pick${avail!==1?'s':''}</span>
      </div>
      <div style="padding:6px 12px 8px;">${pickRows.join('')}</div>
    </div>`;
  }).join('');

  return `${draftStatusBarHtml(picks)}
  <div style="margin-top:${Object.keys(picks).length?'0':'8px'};">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;${Object.keys(picks).length?'margin-top:0;':''}">
      ${cards}
    </div>
    <div style="margin-top:10px;text-align:right;font-family:'Oswald',sans-serif;font-size:0.7rem;color:#718096;">
      <span style="color:${pickCount===DRAFT_CONFIG.total_picks?'#34D399':'#A0AEC0'};font-weight:600;">${pickCount}</span> / ${DRAFT_CONFIG.total_picks} picks made
    </div>
  </div>`;
}

async function loadDraftBoard() {
  const boardEl = document.getElementById('milb-draft-board');
  const contentEl = document.getElementById('draft-board-content');
  const countEl = document.getElementById('draft-pick-count');
  if (!boardEl || !contentEl) return;

  let picks = {};
  try {
    const snap = await getDoc(doc(firestore, 'settings', 'milb_draft_2026'));
    if (!snap.exists() || snap.data().active !== true) return;
    picks = snap.data().picks || {};
  } catch { return; }

  boardEl.style.display = 'block';
  let currentView = 'round';

  function renderView() {
    contentEl.innerHTML = currentView === 'round'
      ? renderDraftByRound(picks)
      : renderDraftByTeam(picks);
    const count = Object.keys(picks).length;
    if (countEl) countEl.textContent = `(${count}/${DRAFT_CONFIG.total_picks} picks)`;
  }

  renderView();

  const btnRound = document.getElementById('draft-btn-round');
  const btnTeam  = document.getElementById('draft-btn-team');
  const activeStyle   = 'background:#C8102E;color:#fff;';
  const inactiveStyle = 'background:#161B22;color:#718096;';

  if (btnRound) btnRound.addEventListener('click', () => {
    currentView = 'round';
    btnRound.style.cssText += activeStyle;
    if (btnTeam) btnTeam.style.cssText += inactiveStyle;
    renderView();
  });
  if (btnTeam) btnTeam.addEventListener('click', () => {
    currentView = 'team';
    btnTeam.style.cssText += activeStyle;
    if (btnRound) btnRound.style.cssText += inactiveStyle;
    renderView();
  });
}

// ── Main init ──────────────────────────────────────────────────────────────────
async function init() {
  // Load all data in parallel
  const [standingsData, matchupsData, txnData, settings] = await Promise.all([
    fetchJSON('data/standings.json'),
    fetchJSON('data/matchups.json'),
    fetchJSON('data/transactions.json'),
    loadSettings()
  ]);

  // Apply Firestore overrides
  applyFeaturedOverride(settings);
  renderPrograms(settings);
  renderQuickLinks(settings.quick_links);
  renderAds(settings.disabled_ads, settings.ad_slots);
  renderHeadlines(txnData, settings.custom_headlines);

  // Render data sections
  renderStandings(standingsData);
  renderFullStandings(standingsData);
  renderScoreboard(matchupsData);
  renderTransactions(txnData);

  // Firebase-dependent sections
  await Promise.all([
    renderRumblrPreview(),
    loadTicker(),
    loadDraftBoard()
  ]);
}

init();
