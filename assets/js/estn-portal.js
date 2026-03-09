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

// ── Render right-pillar headlines ──────────────────────────────────────────────
function renderHeadlines(txnData, customHeadlines) {
  const el = document.getElementById('portal-headlines');
  if (!el) return;

  const items = [];

  // Custom admin-defined headlines go first
  if (customHeadlines && customHeadlines.length) {
    customHeadlines.forEach(h => {
      const text = typeof h === 'string' ? h : (h.text || '');
      const rawDate = typeof h === 'string' ? '' : (h.date || '');
      let date = '';
      if (rawDate) {
        try {
          date = new Date(rawDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        } catch { date = ''; }
      }
      items.push({ text, date });
    });
  }

  // Auto-generate from transactions
  if (txnData && txnData.transactions) {
    txnData.transactions.slice(0, 8 - items.length).forEach(t => {
      let text = '';
      if (t.type === 'faab_pickup') {
        text = `${t.team} claims ${t.player}${t.details ? ` (${t.details})` : ''}`;
      } else if (t.type === 'drop') {
        text = `${t.team} releases ${t.player}`;
      } else if (t.type === 'trade') {
        text = `Trade: ${t.player} goes to ${t.team}`;
      } else {
        text = `${t.team}: ${t.player}`;
      }
      items.push({ text, date: t.date_display || t.date });
    });
  }

  if (!items.length) {
    el.innerHTML = '<p class="estn-pre-season-label">League activity will appear here once the season begins.</p>';
    return;
  }

  el.innerHTML = items.map(item => `
    <div class="estn-headline-item">
      <span class="estn-headline-bullet">&#x25CF;</span>
      <div class="estn-headline-text">
        ${esc(item.text)}
        ${item.date ? `<span class="estn-headline-date">${esc(item.date)}</span>` : ''}
      </div>
    </div>`).join('');
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
function renderPrograms(hiddenPrograms) {
  const hidden = new Set(hiddenPrograms || []);
  const el = document.getElementById('portal-programs');
  if (!el) return;

  const programs = [
    {
      id: 'rumblr',
      name: 'Rumblr',
      status: 'Now Live',
      statusCls: 'live',
      href: 'rumblr/',
      logo: 'assets/images/rumblr-logo.png'
    },
    {
      id: 'tribune',
      name: 'The Sandlot Tribune',
      status: 'Under Construction',
      statusCls: 'coming-soon',
      href: 'tribune/',
      logo: 'assets/images/logo.png'
    },
    {
      id: 'podcast',
      name: 'Babe Ruth Podcast',
      status: 'Coming 2026',
      statusCls: 'coming-soon',
      href: 'about/',
      logo: 'assets/images/baberuth-podcast-logo.png'
    }
  ];

  el.innerHTML = programs
    .filter(p => !hidden.has(p.id))
    .map(p => `
      <a href="${p.href}" class="estn-program-pill">
        <div class="estn-program-pill-icon">
          <img src="${p.logo}" alt="${esc(p.name)}" onerror="this.parentElement.textContent='${p.name[0]}'">
        </div>
        <div class="estn-program-pill-info">
          <span class="estn-program-pill-name">${esc(p.name)}</span>
          <span class="estn-program-pill-status ${p.statusCls}">${esc(p.status)}</span>
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
  renderPrograms(settings.hidden_programs);
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
    loadTicker()
  ]);
}

init();
