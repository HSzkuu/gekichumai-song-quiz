/* ============================================================
   舞萌听歌大作战 · app
   Vanilla JS single-page game. No frameworks, no build step.
   ============================================================ */
(function () {
  'use strict';

  const DATA = window.MAI_DATA;
  if (!DATA || !Array.isArray(DATA.songs)) {
    document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">曲库数据加载失败：请确认 assets/js/data.js 存在。</div>';
    return;
  }

  const SONGS = DATA.songs.filter((s) => s.playable);
  const ALL_SONGS = DATA.songs.slice();
  const CATS = DATA.categories.filter((c) => c.count > 0);
  const SONG_BY_ID = new Map(SONGS.map((s) => [s.id, s]));
  const CAT_BY_KEY = new Map(CATS.map((c) => [c.key, c]));
  const VERSION_ORDER = [
    'maimai', 'maimai PLUS', 'GreeN', 'GreeN PLUS', 'ORANGE', 'ORANGE PLUS',
    'PiNK', 'PiNK PLUS', 'MURASAKi', 'MURASAKi PLUS', 'MiLK', 'MiLK PLUS',
    'FiNALE', '舞萌DX', '舞萌DX 2021', '舞萌DX 2022', '舞萌DX 2023',
    '舞萌DX 2024', '舞萌DX 2025', '舞萌DX 2026',
  ];
  const versionRank = (v) => {
    const i = VERSION_ORDER.indexOf(v);
    return i === -1 ? 999 : i;
  };
  const SONG_VERSIONS = [...new Set(SONGS.map((s) => s.version))].filter(Boolean)
    .sort((a, b) => versionRank(a) - versionRank(b) || String(a).localeCompare(String(b), 'zh-CN'));
  const LEVEL_ORDER = ['10+', '11', '11+', '12', '12+', '13', '13+', '14', '14+', '15'];
  const levelRank = (v) => {
    const i = LEVEL_ORDER.indexOf(v);
    if (i !== -1) return i;
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : 999;
  };
  const SONG_LEVELS = [...new Set(SONGS.map((s) => s.level))].filter(Boolean)
    .sort((a, b) => levelRank(a) - levelRank(b));
  const audio = window.MAI_AUDIO;

  const MODE = {
    challenge: { label: '常规挑战', short: '常规', tag: '经典', desc: '固定题数 · 越快分越高' },
    royale: { label: '大逃杀', short: '大逃杀', tag: '生存', desc: '答错扣命 · 存活到底' },
    genre: { label: '猜分类', short: '猜分类', tag: '知识', desc: '听歌判断所属分类' },
    tourney: { label: '本命淘汰赛', short: '本命', tag: '对决', desc: '两两对决 · 选出本命' },
  };

  const RANKS = {
    SSS: { label: 'SUPER STAR', color: ['#fff3b0', '#ffd23f', '#ff6fae', '#7c8dff'], desc: '全曲库也拦不住你，耳朵就是谱面。' },
    SS: { label: 'EXCELLENT', color: ['#ffffff', '#ffd6ea', '#b79bff'], desc: '几乎是条件反射级别的曲库熟悉度。' },
    S: { label: 'GREAT', color: ['#ffffff', '#c7f1ff', '#61d7ff'], desc: '稳得很。再来一局，冲一次 SSS？' },
    A: { label: 'GOOD', color: ['#f2fff8', '#9cf2c8', '#34cf91'], desc: '有几首藏得很深，复盘一下再战。' },
    B: { label: 'FAIR', color: ['#ffffff', '#ffd7ae', '#ff9e45'], desc: '熟悉的旋律还需要多听几次。' },
    C: { label: 'KEEP GOING', color: ['#ffffff', '#e2d0ee', '#a68bb5'], desc: '今天的运气不在线，下一局会更好。' },
    D: { label: 'TRY AGAIN', color: ['#ffffff', '#d9c6e6', '#8e749f'], desc: '至少你听到了几首好歌，再来一次吧。' },
  };

  const LS_KEY = 'mai-song-quiz:v1';
  const LS_RECORDS = 'mai-song-quiz:records:v1';
  const LS_CLIENT = 'mai-song-quiz:client-id';
  const API_ENDPOINT = new URL(
    (window.MAI_CONFIG && window.MAI_CONFIG.leaderboardApi) || 'api/leaderboard',
    document.baseURI
  ).toString();
  const CIRC_TIMER = 2 * Math.PI * 116;
  const CIRC_CLIP = 2 * Math.PI * 104;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    cn: '舞萌玩家',
    theme: 'light',
    sfx: true,
    mode: 'challenge',
    count: 10,
    clip: 30,
    lives: 1,
    size: 8,
    cats: new Set(CATS.map((c) => c.key)),
    versions: new Set(SONG_VERSIONS),
    levels: new Set(SONG_LEVELS),
    view: 'lobby',
    records: [],
    boardFilter: { mode: 'all', clip: 'all', scope: 'all' },
    clientId: '',
    deviceTag: '',
    boardSource: 'local',
    sourceChosen: false,
    globalAvailable: false,
    globalLoading: false,
    globalError: '',
    globalRecords: [],
    globalTop: [],
    globalTotal: 0,
    globalNewId: null,
    globalReq: 0,
    probing: false,
    game: null,
    result: null,
    tournament: null,
    newRecordId: null,
    shareBlob: null,
    shareName: '',
    openModal: null,
    lastFocus: null,
    clearTimer: 0,
    reviewAudio: null,
    reviewBtn: null,
    reviewTimer: 0,
    multi: {
      ws: null,
      wsToken: 0,
      status: 'idle',
      you: null,
      room: null,
      rooms: [],
      pane: 'lobby',
      phase: 'idle',
      settings: { count: 10, clip: 30, isPublic: true, mode: 'royale', lives: 1 },
      settingsInit: false,
      pendingCode: null,
      mpAudio: null,
      preparePromise: null,
      prepared: false,
      readySent: false,
      q: null,
      startAt: 0,
      deadline: 0,
      answerMs: 0,
      timerRaf: 0,
      startTimer: 0,
      answered: false,
      audioStarted: false,
      audioCallbacks: null,
      finalShown: false,
      lastReveal: null,
      eqBars: [],
      blockedRetry: false,
      localEliminated: false,
      betTarget: null,
      betPlaced: null,
      betEnabled: false,
      betChips: 1000,
      betOutcome: null,
      betPhase: null,
      betCountdownTimer: 0,
      betDeadline: 0,
      betChosen: false,
      reconnecting: false,
      reconnectAttempts: 0,
      reconnectTimer: 0,
      rejoinNotice: false,
      leaving: false,
    },
  };

  /* ============================== utilities ============================== */
  const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad2 = (n) => String(n).padStart(2, '0');

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeXml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const uniqueBy = (arr, fn) => {
    const seen = new Set();
    return arr.filter((item) => {
      const key = fn(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const normalTitle = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  function catOf(song) { return CAT_BY_KEY.get(song && song.genre) || { key: 'other', name: '其他', short: '其他', color: '#9b8aa2' }; }
  function coverUrl(song) { return `${DATA.jacketBase}${song.id}.png`; }
  function audioUrl(song) { return `${DATA.audioBase}${song.id}.mp3`; }
  function fmtDate(iso, withTime = false) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const base = `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
    return withTime ? `${base} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : base;
  }
  function fmtShortDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
  }
  function fmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${pad2(s)}`;
  }
  function fmtSec(sec) {
    if (!Number.isFinite(sec)) return '--';
    return sec.toFixed(1);
  }
  function avatarChar(cn) {
    const chars = Array.from(String(cn || '舞').trim());
    return chars[0] || '舞';
  }
  function makeAvatarGradient() {
    return 'linear-gradient(140deg, #ff8ab9, #b78cff 55%, #57d9ff)';
  }

  function coverFallback(song) {
    const cat = catOf(song);
    const title = escapeXml(String(song.title || '').slice(0, 16));
    const artist = escapeXml(String(song.artist || '').slice(0, 22));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${cat.color}"/>
          <stop offset="0.67" stop-color="#3a1a4a"/>
          <stop offset="1" stop-color="#160d22"/>
        </linearGradient>
      </defs>
      <rect width="400" height="400" fill="url(#bg)"/>
      <circle cx="322" cy="82" r="118" fill="none" stroke="rgba(255,255,255,.24)" stroke-width="2"/>
      <circle cx="322" cy="82" r="72" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.5" stroke-dasharray="5 9"/>
      <circle cx="74" cy="330" r="96" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="1.5"/>
      <circle cx="74" cy="330" r="54" fill="rgba(255,255,255,.06)"/>
      <text x="38" y="188" fill="#fff" font-family="sans-serif" font-size="34" font-weight="700">${title}</text>
      <text x="38" y="224" fill="rgba(255,255,255,.6)" font-family="sans-serif" font-size="15">${artist}</text>
      <text x="38" y="360" fill="rgba(255,255,255,.5)" font-family="sans-serif" font-size="11" letter-spacing="3">MAIMAI DX</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function setCover(img, song) {
    if (!img) return;
    img.onerror = () => {
      img.onerror = null;
      img.src = coverFallback(song);
    };
    img.src = coverUrl(song);
  }

  /** 猜题阶段完全不加载、不展示曲绘，避免封面直接泄题。 */
  function concealCover(img) {
    if (!img) return;
    img.onerror = null;
    img.classList.add('is-hidden');
    img.classList.remove('is-revealed');
    img.removeAttribute('src');
  }

  function catStyle(song) {
    return `--cat:${catOf(song).color}`;
  }

  /* ============================== persistence ============================== */
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const val = JSON.parse(raw);
      return val == null ? fallback : val;
    } catch (_) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
  }

  function ensureClientId() {
    try {
      let id = localStorage.getItem(LS_CLIENT);
      if (!id || !/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
        id = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
          .replace(/[^A-Za-z0-9_-]/g, '');
        while (id.length < 8) id += Math.random().toString(36).slice(2);
        localStorage.setItem(LS_CLIENT, id);
      }
      state.clientId = id;
    } catch (_) {
      state.clientId = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  function deviceTag() {
    if (state.deviceTag) return state.deviceTag;
    const id = String(state.clientId || 'guest');
    let h = 2166136261;
    for (let i = 0; i < id.length; i += 1) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let n = h >>> 0;
    let out = '';
    for (let i = 0; i < 4; i += 1) {
      out += alphabet[n % alphabet.length];
      n = Math.floor(n / alphabet.length);
    }
    state.deviceTag = out;
    return out;
  }

  function displayName() {
    const base = String(state.cn || '舞萌玩家').trim().slice(0, 11) || '舞萌玩家';
    return `${base} #${deviceTag()}`;
  }

  function tagFirst(cn) {
    const raw = String(cn || '');
    const m = raw.match(/^(.*?)\s+#([A-Z0-9]{4})$/);
    if (!m) return raw;
    const base = m[1].trim() || '玩家';
    return `#${m[2]} ${base}`;
  }

  function splitNameTag(cn) {
    const raw = String(cn || '');
    const m = raw.match(/^(.*?)\s+#([A-Z0-9]{4})$/);
    if (!m) return { base: raw || '玩家', tag: '' };
    return { base: m[1].trim() || '玩家', tag: m[2] };
  }

  async function apiJson(url, options = {}, timeout = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { cache: 'no-store', ...options, signal: ctrl.signal });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { /* non-json error page */ }
      if (!res.ok) {
        const err = new Error((data && data.error) || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('排行榜请求超时');
      if (err instanceof TypeError) throw new Error('无法连接全服榜单服务');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function boardApiUrl(limit = 50) {
    const url = new URL(API_ENDPOINT);
    url.searchParams.set('mode', state.boardFilter.mode);
    url.searchParams.set('clip', state.boardFilter.clip);
    url.searchParams.set('scope', state.boardFilter.scope);
    url.searchParams.set('limit', String(limit));
    return url.toString();
  }

  function loadPrefs() {
    const prefs = readJSON(LS_KEY, {});
    if (prefs && typeof prefs === 'object') {
      if (typeof prefs.cn === 'string' && prefs.cn.trim()) state.cn = prefs.cn.trim().slice(0, 11);
      if (prefs.theme === 'dark' || prefs.theme === 'light') state.theme = prefs.theme;
      if (typeof prefs.sfx === 'boolean') state.sfx = prefs.sfx;
      if (prefs.settings && typeof prefs.settings === 'object') {
        const s = prefs.settings;
        if (MODE[s.mode]) state.mode = s.mode;
        if ([10, 20, 35, 50].includes(Number(s.count))) state.count = Number(s.count);
        if ([5, 15, 30].includes(Number(s.clip))) state.clip = Number(s.clip);
        if ([1, 3].includes(Number(s.lives))) state.lives = Number(s.lives);
        if ([8, 16].includes(Number(s.size))) state.size = Number(s.size);
        if (Array.isArray(s.versions)) {
          const valid = s.versions.filter((v) => SONG_VERSIONS.includes(v));
          state.versions = new Set(valid.length ? valid : SONG_VERSIONS);
        } else if (s.versionFilter && s.versionFilter !== 'all' && SONG_VERSIONS.includes(s.versionFilter)) {
          state.versions = new Set([s.versionFilter]);
        }
        if (Array.isArray(s.levels)) {
          const valid = s.levels.filter((v) => SONG_LEVELS.includes(v));
          state.levels = new Set(valid.length ? valid : SONG_LEVELS);
        } else if (s.levelFilter && s.levelFilter !== 'all' && SONG_LEVELS.includes(s.levelFilter)) {
          state.levels = new Set([s.levelFilter]);
        }
        if (Array.isArray(s.cats)) {
          const valid = s.cats.filter((k) => CAT_BY_KEY.has(k));
          state.cats = new Set(valid.length ? valid : CATS.map((c) => c.key));
        }
      }
    }
    loadRecords();
  }

  function savePrefs() {
    writeJSON(LS_KEY, {
      cn: state.cn, theme: state.theme, sfx: state.sfx,
      settings: {
        mode: state.mode, count: state.count, clip: state.clip, lives: state.lives, size: state.size,
        cats: [...state.cats], versions: [...state.versions], levels: [...state.levels],
      },
    });
  }

  function loadRecords() {
    const list = readJSON(LS_RECORDS, []);
    state.records = Array.isArray(list) ? list.filter((r) => r && typeof r.score === 'number' && MODE[r.mode] && r.cn) : [];
  }
  function saveRecords() { writeJSON(LS_RECORDS, state.records.slice(0, 200)); }

  /* ============================== theme / header ============================== */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'dark' ? '#100a1a' : '#fdf4f9');
    const use = $('#themeBtn use');
    if (use) use.setAttribute('href', state.theme === 'dark' ? '#i-sun' : '#i-moon');
    $('#themeBtn').setAttribute('title', state.theme === 'dark' ? '切换到浅色' : '切换到深色');
  }
  function applySound() {
    audio.setSfxEnabled(state.sfx);
    if (state.multi && state.multi.mpAudio) state.multi.mpAudio.setSfxEnabled(state.sfx);
    const btn = $('#soundBtn');
    const use = $('use', btn);
    if (use) use.setAttribute('href', state.sfx ? '#i-sound' : '#i-mute');
    btn.classList.toggle('is-muted', !state.sfx);
    btn.setAttribute('title', state.sfx ? '关闭音效' : '开启音效');
  }
  function applyCN() {
    const char = avatarChar(state.cn);
    const shown = displayName();
    $('#headerAvatar').textContent = char;
    $('#headerCn').textContent = shown;
    $('#profileAvatar').textContent = char;
    $('#profileAvatar').style.background = makeAvatarGradient();
    $('#profilePreviewName').textContent = shown;
    $('#cnInput').value = state.cn;
    const tag = $('#profileTagHint b');
    if (tag) tag.textContent = `#${deviceTag()}`;
  }

  /* ============================== views & toasts ============================== */
  const VIEWS = {
    lobby: () => $('#viewLobby'),
    game: () => $('#viewGame'),
    result: () => $('#viewResult'),
    tourney: () => $('#viewTourney'),
    multi: () => $('#viewMulti'),
  };

  function setView(name) {
    Object.entries(VIEWS).forEach(([key, get]) => {
      const el = get();
      if (el) el.hidden = key !== name;
    });
    state.view = name;
    document.body.classList.toggle('is-playing', name === 'game');
    if (name !== 'multi') document.body.classList.remove('is-multi-game');
    if (name !== 'result' && name !== 'game') stopReview();
    if (name === 'lobby') {
      renderBoard();
      renderMiniBoard();
      renderHeroStats();
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function toast(message, type = '') {
    const stack = $('#toastStack');
    if (!stack) return;
    while (stack.children.length >= 3) stack.removeChild(stack.firstElementChild);
    const el = document.createElement('div');
    el.className = `toast ${type}`.trim();
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', type === 'err' ? '#i-close' : type === 'ok' ? '#i-check' : '#i-note');
    icon.appendChild(use);
    el.appendChild(icon);
    const span = document.createElement('span');
    span.textContent = message;
    el.appendChild(span);
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 260);
    }, 2800);
  }

  /* ============================== modals ============================== */
  function openModal(id) {
    const layer = document.getElementById(id);
    if (!layer) return;
    if (state.openModal && state.openModal !== layer) closeModal(state.openModal.id, true);
    state.lastFocus = document.activeElement;
    layer.hidden = false;
    state.openModal = layer;
    document.body.classList.add('modal-open');
    const focusable = layer.querySelector('input, button:not(.modal-close), [href]');
    setTimeout(() => { if (focusable) focusable.focus({ preventScroll: true }); }, 60);
  }
  function closeModal(id, keepBody) {
    const layer = document.getElementById(id);
    if (!layer) return;
    layer.hidden = true;
    if (state.openModal === layer) state.openModal = null;
    if (!keepBody) document.body.classList.remove('modal-open');
    if (!keepBody && state.lastFocus && typeof state.lastFocus.focus === 'function') {
      state.lastFocus.focus({ preventScroll: true });
    }
  }
  function closeAllModals() {
    $$('.modal-layer').forEach((m) => { m.hidden = true; });
    state.openModal = null;
    document.body.classList.remove('modal-open');
  }

  function openProfile() {
    applyCN();
    $('#profileRecordCount').textContent = fmtInt(state.records.length);
    openModal('profileModal');
  }
  function saveCN() {
    const raw = $('#cnInput').value.trim();
    state.cn = (raw || '舞萌玩家').slice(0, 11);
    applyCN();
    savePrefs();
    closeModal('profileModal');
    toast('CN 已更新', 'ok');
  }

  function armClearButton(btn, action) {
    if (!btn) return;
    if (btn.dataset.armed === '1') {
      clearTimeout(state.clearTimer);
      btn.dataset.armed = '0';
      btn.textContent = btn.dataset.original || '清空记录';
      action();
      return;
    }
    btn.dataset.original = btn.textContent;
    btn.dataset.armed = '1';
    btn.textContent = '再点一次确认';
    clearTimeout(state.clearTimer);
    state.clearTimer = setTimeout(() => {
      btn.dataset.armed = '0';
      btn.textContent = btn.dataset.original || '清空记录';
    }, 3200);
  }

  function clearRecords() {
    state.records = [];
    state.newRecordId = null;
    saveRecords();
    renderBoard();
    renderMiniBoard();
    renderHeroStats();
    $('#profileRecordCount').textContent = '0';
    toast('本地记录已清空', 'ok');
  }

  /* ============================== lobby rendering ============================== */
  function initLobby() {
    $('#heroSongs').textContent = fmtInt(DATA.playable);
    $('#heroCats').textContent = String(CATS.length);
    $('#dataStamp').textContent = `曲库数据 ${fmtDate(DATA.generatedAt)} · ${DATA.source}`;
    applyCN();
    renderModes();
    renderFilterChips();
    renderGenreGrid();
    renderPills();
    renderHeroCovers();
    updatePoolUI();
    updateFilterUI();
    updateModeUI();
    renderMiniBoard();
    renderBoard();
    renderHeroStats();
    initEq();
  }

  function renderHeroCovers() {
    const ids = [363, 1001];
    $$('[data-hero-cover]').forEach((img) => {
      const song = SONG_BY_ID.get(ids[Number(img.dataset.heroCover)] || 0);
      if (song) setCover(img, song);
    });
  }

  function renderModes() {
    $$('#modeGrid .mode-card').forEach((btn) => {
      const active = btn.dataset.mode === state.mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function renderGenreGrid() {
    const grid = $('#genreGrid');
    if (!grid) return;
    grid.innerHTML = '';
    CATS.forEach((cat) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'genre-chip';
      btn.dataset.cat = cat.key;
      btn.style.setProperty('--cat', cat.color);
      if (state.cats.has(cat.key)) btn.classList.add('is-on');
      btn.setAttribute('aria-pressed', String(state.cats.has(cat.key)));
      const dot = document.createElement('span');
      dot.className = 'g-dot';
      const copy = document.createElement('span');
      copy.className = 'g-copy';
      const strong = document.createElement('strong');
      strong.textContent = cat.name;
      const small = document.createElement('small');
      small.textContent = cat.key === 'mai' ? 'ORIGINAL' : cat.key === 'vocaloid' ? 'NICONICO / VOCALOID' : cat.key === 'touhou' ? 'TOUHOU PROJECT' : cat.key === 'gekichu' ? 'ONGEKI / CHUNITHM' : cat.key === 'game' ? 'GAME VARIETY' : 'POPS / ANIME';
      copy.append(strong, small);
      const count = document.createElement('span');
      count.className = 'g-count';
      count.textContent = fmtInt(cat.count);
      const check = document.createElement('span');
      check.className = 'g-check';
      check.innerHTML = '<svg><use href="#i-check"></use></svg>';
      btn.append(dot, copy, count, check);
      btn.addEventListener('click', () => toggleCat(cat.key));
      grid.appendChild(btn);
    });
  }

  function toggleCat(key) {
    if (state.cats.has(key)) state.cats.delete(key);
    else state.cats.add(key);
    const btn = $(`.genre-chip[data-cat="${key}"]`);
    if (btn) {
      btn.classList.toggle('is-on', state.cats.has(key));
      btn.setAttribute('aria-pressed', String(state.cats.has(key)));
    }
    savePrefs();
    updatePoolUI();
    updateModeUI();
  }

  function setAllCats(all) {
    state.cats = new Set(all ? CATS.map((c) => c.key) : []);
    $$('#genreGrid .genre-chip').forEach((btn) => {
      const on = state.cats.has(btn.dataset.cat);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    savePrefs();
    updatePoolUI();
    updateModeUI();
  }

  function invertCats() {
    state.cats = new Set(CATS.filter((c) => !state.cats.has(c.key)).map((c) => c.key));
    $$('#genreGrid .genre-chip').forEach((btn) => {
      const on = state.cats.has(btn.dataset.cat);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    savePrefs();
    updatePoolUI();
    updateModeUI();
  }

  function renderPills() {
    $$('#countPills button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.count) === state.count));
    $$('#clipPills button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.clip) === state.clip));
    $$('#livesPills button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.lives) === state.lives));
    $$('#sizePills button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.size) === state.size));
  }

  function selectedCats() { return CATS.filter((c) => state.cats.has(c.key)); }
  function selectedSongs() {
    return SONGS.filter((s) => state.cats.has(s.genre)
      && state.versions.has(s.version)
      && state.levels.has(s.level));
  }
  function isFullLibraryPool() {
    return state.cats.size === CATS.length
      && state.versions.size === SONG_VERSIONS.length
      && state.levels.size === SONG_LEVELS.length;
  }
  function poolScope() { return isFullLibraryPool() ? 'full' : 'custom'; }
  function roundsFor(size) { return Math.round(Math.log2(size)); }

  function renderFilterChips() {
    const vWrap = $('#versionChips');
    if (vWrap) {
      vWrap.innerHTML = '';
      const base = SONGS.filter((s) => state.levels.has(s.level));
      SONG_VERSIONS.forEach((v) => {
        const n = base.filter((s) => s.version === v).length;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-chip';
        btn.dataset.version = v;
        if (state.versions.has(v)) btn.classList.add('is-on');
        if (!n) btn.classList.add('is-empty');
        btn.setAttribute('aria-pressed', String(state.versions.has(v)));
        const label = document.createElement('span');
        label.textContent = v;
        const count = document.createElement('small');
        count.textContent = fmtInt(n);
        btn.append(label, count);
        btn.addEventListener('click', () => toggleVersion(v));
        vWrap.appendChild(btn);
      });
    }
    const lWrap = $('#levelChips');
    if (lWrap) {
      lWrap.innerHTML = '';
      const base = SONGS.filter((s) => state.versions.has(s.version));
      SONG_LEVELS.forEach((lv) => {
        const n = base.filter((s) => s.level === lv).length;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-chip';
        btn.dataset.level = lv;
        if (state.levels.has(lv)) btn.classList.add('is-on');
        if (!n) btn.classList.add('is-empty');
        btn.setAttribute('aria-pressed', String(state.levels.has(lv)));
        const label = document.createElement('span');
        label.textContent = lv;
        const count = document.createElement('small');
        count.textContent = fmtInt(n);
        btn.append(label, count);
        btn.addEventListener('click', () => toggleLevel(lv));
        lWrap.appendChild(btn);
      });
    }
    const vSummary = $('#versionFilterSummary');
    if (vSummary) {
      vSummary.textContent = state.versions.size === SONG_VERSIONS.length
        ? `全部 ${SONG_VERSIONS.length} 个版本`
        : `已选 ${state.versions.size} / ${SONG_VERSIONS.length}`;
    }
    const lSummary = $('#levelFilterSummary');
    if (lSummary) {
      lSummary.textContent = state.levels.size === SONG_LEVELS.length
        ? `全部 ${SONG_LEVELS.length} 个等级`
        : `已选 ${state.levels.size} / ${SONG_LEVELS.length}`;
    }
  }

  function toggleVersion(v) {
    if (state.versions.has(v)) state.versions.delete(v);
    else state.versions.add(v);
    savePrefs();
    updateFilterUI();
    updateModeUI();
  }

  function toggleLevel(lv) {
    if (state.levels.has(lv)) state.levels.delete(lv);
    else state.levels.add(lv);
    savePrefs();
    updateFilterUI();
    updateModeUI();
  }

  function setAllVersions(all) {
    state.versions = all ? new Set(SONG_VERSIONS) : new Set();
    savePrefs();
    updateFilterUI();
    updateModeUI();
  }

  function invertVersions() {
    state.versions = new Set(SONG_VERSIONS.filter((v) => !state.versions.has(v)));
    savePrefs();
    updateFilterUI();
    updateModeUI();
  }

  function setAllLevels(all) {
    state.levels = all ? new Set(SONG_LEVELS) : new Set();
    savePrefs();
    updateFilterUI();
    updateModeUI();
  }

  function invertLevels() {
    state.levels = new Set(SONG_LEVELS.filter((lv) => !state.levels.has(lv)));
    savePrefs();
    updateFilterUI();
    updateModeUI();
  }

  function updateGenreCounts() {
    const base = SONGS.filter((s) => state.versions.has(s.version) && state.levels.has(s.level));
    CATS.forEach((cat) => {
      const chip = $(`.genre-chip[data-cat="${cat.key}"]`);
      if (!chip) return;
      const n = base.filter((s) => s.genre === cat.key).length;
      const count = chip.querySelector('.g-count');
      if (count) count.textContent = fmtInt(n);
      chip.classList.toggle('is-empty', n === 0);
    });
  }

  function updateFilterUI() {
    renderFilterChips();
    const full = isFullLibraryPool();
    const scope = $('#libraryScope');
    if (scope) {
      scope.textContent = full ? '全曲库' : '自定义曲库';
      scope.classList.toggle('is-custom', !full);
    }
    updateGenreCounts();
    updatePoolUI();
  }

  function resetLibraryFilters() {
    state.versions = new Set(SONG_VERSIONS);
    state.levels = new Set(SONG_LEVELS);
    savePrefs();
    updateFilterUI();
    updateModeUI();
  }

  function validateStart() {
    const cats = selectedCats();
    const pool = selectedSongs();
    if (!cats.length) return '至少选择一个分类';
    if (state.mode === 'genre' && cats.length < 4) return '猜分类至少需要选择 4 个分类';
    if (state.mode === 'tourney' && pool.length < state.size) return `本命淘汰赛至少需要 ${state.size} 首曲目，当前曲库只有 ${pool.length} 首`;
    if (pool.length < 4) return '曲库至少需要 4 首曲目';
    return '';
  }

  function updatePoolUI() {
    const pool = selectedSongs();
    const cats = selectedCats();
    $('#poolCount').textContent = fmtInt(pool.length);
    const count = Math.min(state.count, pool.length);
    const err = validateStart();

    let hint = `已选择 ${cats.length} 个分类，共 ${fmtInt(pool.length)} 首可玩曲目。随机抽取题目与干扰项。`;
    if (state.mode === 'genre') hint = `已选择 ${cats.length} 个分类；猜分类需要至少 4 个分类，选项会从已选分类中抽取。`;
    if (state.mode === 'tourney') hint = `已选择 ${fmtInt(pool.length)} 首；本命淘汰赛会随机抽取 ${state.size} 首进行 ${roundsFor(state.size)} 轮对决。`;
    if (state.mode === 'royale') hint = `已选择 ${fmtInt(pool.length)} 首；大逃杀会持续抽歌，直到曲库抽完或生命耗尽。${state.lives === 1 ? '1 命记录会计入排行榜。' : '3 命为练习局。'}`;
    const filterBits = [];
    if (state.versions.size !== SONG_VERSIONS.length) {
      const list = [...state.versions];
      filterBits.push(list.length <= 3 ? `版本 ${list.join(' / ')}` : `版本已选 ${list.length}/${SONG_VERSIONS.length}`);
    }
    if (state.levels.size !== SONG_LEVELS.length) {
      const list = [...state.levels];
      filterBits.push(list.length <= 3 ? `MASTER ${list.join(' / ')}` : `MASTER 已选 ${list.length}/${SONG_LEVELS.length}`);
    }
    if (filterBits.length && !err) hint += ` 筛选：${filterBits.join(' · ')}。`;
    if (err) hint = err;
    $('#poolHint').textContent = hint;

    const btn = $('#startBtn');
    const disabled = Boolean(err);
    btn.disabled = disabled;
    btn.setAttribute('aria-disabled', String(disabled));
    const label = btn.querySelector('span');
    const meta = $('#startMeta');
    if (state.mode === 'tourney') {
      if (label) label.textContent = '开始淘汰赛';
      meta.textContent = `${state.size} 首 · ${roundsFor(state.size)} 轮`;
    } else if (state.mode === 'royale') {
      if (label) label.textContent = state.lives === 1 ? '开始大逃杀' : '开始练习';
      meta.textContent = `抽完为止 · ${state.clip} 秒${state.lives === 1 ? '' : ' · 练习'}`;
    } else {
      if (label) label.textContent = '开始挑战';
      meta.textContent = `${count || 0} 首 · ${state.clip} 秒`;
    }
  }

  function updateModeUI() {
    const mode = state.mode;
    renderModes();
    $('#countRow').hidden = mode === 'tourney' || mode === 'royale';
    $('#clipRow').hidden = mode === 'tourney';
    $('#livesRow').hidden = mode !== 'royale';
    $('#sizeRow').hidden = mode !== 'tourney';
    const tip = $('#modeTip');
    const rounds = roundsFor(state.size);
    const copy = {
      challenge: `常规挑战：共 ${Math.min(state.count, selectedSongs().length)} 题，每题 4 个选项，答得越快加分越多。`,
      royale: `大逃杀：${state.lives} 条命，从曲库里不断抽歌，答错扣命，直到曲库抽完或生命耗尽。${state.lives === 1 ? '1 命为标准排位。' : '3 命为练习局，不计入排行榜。'}`,
      genre: `猜分类：听片段，从已选分类中选出它所属的分类。至少选择 4 个分类。`,
      tourney: `本命淘汰赛：随机 ${state.size} 首曲目，进行 ${rounds} 轮两两对决，选出你的本命。每首试听 12 秒，试听不设倒计时，不计入榜单。`,
    };
    tip.textContent = copy[mode];
    renderPills();
    updatePoolUI();
  }

  function renderHeroStats() {
    const best = state.records.reduce((max, r) => Math.max(max, Number(r.score) || 0), 0);
    $('#heroBest').textContent = best > 0 ? fmtInt(best) : '—';
  }

  function updateBoardStatus() {
    const el = $('#boardStatus');
    if (!el) return;
    let key = 'offline';
    let label = '仅本机';
    if (state.probing) { key = 'syncing'; label = '连接中'; }
    else if (state.globalAvailable && state.boardSource === 'global') {
      if (state.globalLoading) { key = 'syncing'; label = '同步中'; }
      else if (state.globalError) { key = 'error'; label = '同步失败'; }
      else { key = 'ok'; label = '全服同步'; }
    } else if (state.globalAvailable) { key = 'ok'; label = '全服已连接'; }
    el.dataset.state = key;
    const span = el.querySelector('span');
    if (span) span.textContent = label;
  }

  function updateBoardSourceUI() {
    $$('#boardSourceTabs button').forEach((btn) => {
      const active = btn.dataset.source === state.boardSource;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    const hint = $('#boardSourceHint');
    if (hint) {
      if (state.boardSource === 'global') {
        hint.textContent = state.globalAvailable
          ? `每位玩家仅展示最佳成绩 · ${fmtInt(state.globalTotal)} 位玩家`
          : '正在连接全服总榜…';
      } else {
        hint.textContent = '仅保存在本机浏览器';
      }
    }
    const note = $('#boardNote');
    if (note) {
      note.textContent = state.boardSource === 'global'
        ? '全服总榜记录每位玩家的最佳成绩；本机也会保留一份记录。'
        : '成绩仅保存在当前设备，清除浏览器数据后无法恢复。';
    }
    updateBoardStatus();
  }

  function boardMessage(message, retry = false) {
    const body = $('#boardBody');
    if (!body) return;
    body.innerHTML = '';
    const tr = document.createElement('tr');
    tr.className = 'board-empty';
    const td = document.createElement('td');
    td.colSpan = 8;
    td.textContent = message;
    if (retry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'text-btn board-retry';
      btn.textContent = '重试';
      btn.addEventListener('click', () => {
        if (state.globalAvailable) loadGlobalBoard();
        else probeGlobal({ select: true });
      });
      td.appendChild(document.createTextNode(' '));
      td.appendChild(btn);
    }
    tr.appendChild(td);
    body.appendChild(tr);
  }

  function boardRows(list, source) {
    const body = $('#boardBody');
    if (!body) return;
    body.innerHTML = '';
    list.slice(0, 50).forEach((rec, i) => {
      const tr = document.createElement('tr');
      const isNew = source === 'global'
        ? state.globalNewId && String(rec.id) === String(state.globalNewId)
        : rec.id === state.newRecordId;
      if (isNew) tr.classList.add('is-new-record');
      const rankNo = source === 'global' && rec.rank ? Number(rec.rank) : i + 1;
      const tdRank = document.createElement('td');
      tdRank.className = 'col-rank';
      const rank = document.createElement('span');
      rank.className = 'board-rank';
      rank.textContent = String(rankNo);
      tdRank.appendChild(rank);
      const tdCn = document.createElement('td');
      const cnWrap = document.createElement('span');
      cnWrap.className = 'board-cn';
      const av = document.createElement('span');
      av.className = 'board-avatar';
      av.textContent = avatarChar(rec.cn);
      const name = document.createElement('span');
      name.textContent = rec.cn || '—';
      cnWrap.append(av, name);
      tdCn.appendChild(cnWrap);
      const tdMode = document.createElement('td');
      const tag = document.createElement('span');
      tag.className = 'board-mode-tag';
      tag.textContent = rec.mode === 'royale'
        ? `${MODE[rec.mode]?.short || rec.mode} · ${rec.combo ?? rec.maxCombo ?? 0} 连`
        : `${MODE[rec.mode]?.short || rec.mode} · ${rec.count || '?'} 题`;
      tdMode.appendChild(tag);
      const tdScore = document.createElement('td');
      const score = document.createElement('span');
      score.className = 'board-score';
      score.textContent = fmtInt(rec.score);
      tdScore.appendChild(score);
      const tdAcc = document.createElement('td');
      tdAcc.textContent = `${Number(rec.accuracy || 0).toFixed(1)}%`;
      const tdAvg = document.createElement('td');
      tdAvg.textContent = `${Number(rec.avgTime || 0).toFixed(1)}s`;
      const tdCombo = document.createElement('td');
      tdCombo.textContent = String(rec.combo ?? rec.maxCombo ?? 0);
      const tdDate = document.createElement('td');
      tdDate.className = 'board-date';
      tdDate.textContent = fmtShortDate(rec.date);
      tr.append(tdRank, tdCn, tdMode, tdScore, tdAcc, tdAvg, tdCombo, tdDate);
      body.appendChild(tr);
    });
  }

  function renderMiniBoard() {
    const list = $('#miniBoard');
    if (!list) return;
    const useGlobal = state.globalAvailable;
    const top = (useGlobal ? state.globalTop : sortRecords(state.records)).slice(0, 3);
    const eyebrow = $('#miniEyebrow');
    if (eyebrow) eyebrow.textContent = useGlobal ? 'GLOBAL TOP' : 'LOCAL BEST';
    list.innerHTML = '';
    if (!top.length) {
      const li = document.createElement('li');
      li.className = 'mini-empty';
      li.textContent = state.globalAvailable
        ? '全服榜还没有记录，抢下第一位吧。'
        : '还没有本地记录，来打一局吧。';
      list.appendChild(li);
      return;
    }
    top.forEach((rec, i) => {
      const li = document.createElement('li');
      const rank = document.createElement('span');
      rank.className = 'mini-rank';
      rank.textContent = String(rec.rank || i + 1);
      const cn = document.createElement('span');
      cn.className = 'mini-cn';
      cn.textContent = rec.cn || '—';
      const score = document.createElement('span');
      score.className = 'mini-score';
      score.textContent = fmtInt(rec.score);
      li.append(rank, cn, score);
      list.appendChild(li);
    });
  }

  function sortRecords(list, mode = 'all') {
    const royale = mode === 'royale';
    return list.slice().sort((a, b) => {
      if (royale && (b.combo || 0) !== (a.combo || 0)) return (b.combo || 0) - (a.combo || 0);
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      if ((b.accuracy || 0) !== (a.accuracy || 0)) return (b.accuracy || 0) - (a.accuracy || 0);
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }

  function renderBoard() {
    const body = $('#boardBody');
    if (!body) return;

    if (state.boardSource === 'global') {
      if (!state.globalAvailable) {
        if (state.probing || state.globalLoading) {
          boardMessage('正在连接全服总榜…');
        } else {
          boardMessage(state.globalError || '全服榜单未连接。请用 node server.mjs 启动服务后再试，或先查看本机记录。', true);
        }
      } else if (state.globalLoading && !state.globalRecords.length) {
        boardMessage('正在同步全服总榜…');
      } else if (!state.globalRecords.length) {
        boardMessage('全服榜还没有记录，来抢下第一个名次吧。');
      } else {
        boardRows(state.globalRecords, 'global');
      }
      updateBoardSourceUI();
      return;
    }

    const { mode, clip, scope } = state.boardFilter;
    let list = state.records.slice();
    if (mode !== 'all') list = list.filter((r) => r.mode === mode);
    if (clip !== 'all') list = list.filter((r) => Number(r.clip) === Number(clip));
    if (scope !== 'all') list = list.filter((r) => (r.scope === 'custom' ? 'custom' : 'full') === scope);
    list = sortRecords(list, mode === 'royale' ? 'royale' : 'all');

    if (!list.length) {
      boardMessage(state.records.length
        ? '当前筛选条件下没有记录，换一个模式或试听时长试试。'
        : '本机还没有记录。完成一局单人挑战后，成绩会保存在这里。');
      updateBoardSourceUI();
      return;
    }
    boardRows(list, 'local');
    updateBoardSourceUI();
  }

  async function loadGlobalBoard({ silent = false } = {}) {
    if (!state.globalAvailable) return;
    const req = ++state.globalReq;
    state.globalLoading = true;
    state.globalError = '';
    updateBoardStatus();
    if (!silent && state.boardSource === 'global') boardMessage('正在同步全服总榜…');
    try {
      const data = await apiJson(boardApiUrl(50));
      if (req !== state.globalReq) return;
      state.globalRecords = Array.isArray(data.records) ? data.records : [];
      state.globalTotal = Number(data.total) || 0;
      state.globalLoading = false;
      if (state.boardSource === 'global') renderBoard();
      else updateBoardSourceUI();
    } catch (err) {
      if (req !== state.globalReq) return;
      state.globalLoading = false;
      state.globalError = err.message || '加载失败';
      state.globalAvailable = false;
      state.boardSource = 'local';
      updateBoardSourceUI();
      renderBoard();
      toast('全服榜单加载失败，已切换本机记录', 'err');
    }
  }

  async function loadGlobalTop() {
    if (!state.globalAvailable) return;
    try {
      const url = new URL(API_ENDPOINT);
      url.searchParams.set('mode', 'all');
      url.searchParams.set('clip', 'all');
      url.searchParams.set('limit', '3');
      const data = await apiJson(url.toString());
      state.globalTop = Array.isArray(data.records) ? data.records.slice(0, 3) : [];
      state.globalTotal = Number(data.total) || state.globalTotal;
      renderMiniBoard();
      updateBoardSourceUI();
    } catch (_) { /* keep previous top */ }
  }

  async function probeGlobal({ select = false } = {}) {
    if (state.probing) {
      if (select) {
        state.sourceChosen = true;
        state.boardSource = 'global';
        updateBoardSourceUI();
        renderBoard();
      }
      return;
    }
    state.probing = true;
    state.globalError = '';
    if (state.boardSource === 'global') renderBoard();
    updateBoardStatus();
    try {
      const data = await apiJson(boardApiUrl(50));
      state.globalAvailable = true;
      state.globalLoading = false;
      state.globalRecords = Array.isArray(data.records) ? data.records : [];
      state.globalTotal = Number(data.total) || 0;
      state.globalTop = state.globalRecords.slice(0, 3);
      if (select || !state.sourceChosen) state.boardSource = 'global';
      if (select) toast('已连接全服总榜', 'ok');
    } catch (err) {
      state.globalAvailable = false;
      state.globalError = err.message || '连接失败';
      if (state.boardSource === 'global' || select) state.boardSource = 'local';
      if (select) toast('无法连接全服总榜，已使用本机记录', 'err');
    } finally {
      state.probing = false;
      updateBoardSourceUI();
      renderBoard();
      renderMiniBoard();
    }
  }

  function selectBoardSource(source) {
    state.sourceChosen = true;
    if (source === 'global') {
      state.boardSource = 'global';
      updateBoardSourceUI();
      if (!state.globalAvailable) {
        renderBoard();
        probeGlobal({ select: true });
        return;
      }
      renderBoard();
      loadGlobalBoard();
      return;
    }
    state.boardSource = 'local';
    updateBoardSourceUI();
    renderBoard();
  }

  function refreshBoard() {
    if (state.boardSource === 'global' && state.globalAvailable) loadGlobalBoard();
    else renderBoard();
  }

  /* ============================== EQ ============================== */
  const eqBars = [];
  function initEq() {
    const eq = $('#eq');
    if (!eq) return;
    eq.innerHTML = '';
    eqBars.length = 0;
    for (let i = 0; i < 32; i += 1) {
      const bar = document.createElement('i');
      bar.style.height = '8%';
      bar.style.animationDelay = `${(i * 37) % 600}ms`;
      eq.appendChild(bar);
      eqBars.push(bar);
    }
  }
  let eqFallbackSeed = 0;
  function updateEq(active) {
    const eq = $('#eq');
    if (!eq || !eqBars.length) return;
    eq.classList.toggle('is-playing', Boolean(active));
    if (!active) {
      eqBars.forEach((b) => { b.style.height = '8%'; });
      return;
    }
    const spec = audio.spectrum();
    eqFallbackSeed += 0.35;
    eqBars.forEach((bar, i) => {
      let v;
      if (spec) {
        const idx = Math.min(spec.length - 1, Math.floor((i / eqBars.length) * spec.length * 0.72));
        v = Math.pow(spec[idx] / 255, 1.15);
      } else {
        v = 0.18 + Math.abs(Math.sin(eqFallbackSeed + i * 0.7)) * 0.55;
      }
      bar.style.height = `${Math.round(6 + v * 92)}%`;
    });
  }

  /* ============================== game building ============================== */
  function pickDistractors(song, pool, n) {
    const used = new Set([normalTitle(song.title)]);
    const ok = (s) => s.id !== song.id && !used.has(normalTitle(s.title));
    const same = shuffle(pool.filter((s) => s.genre === song.genre && ok(s)));
    const others = shuffle(pool.filter((s) => s.genre !== song.genre && ok(s)));
    const out = [];
    const take = (s) => { if (s && !used.has(normalTitle(s.title))) { used.add(normalTitle(s.title)); out.push(s); } };
    // Prefer two same-category decoys, then fill from anywhere in the pool.
    same.slice(0, 2).forEach(take);
    const rest = shuffle([...same.slice(2), ...others]);
    for (const s of rest) {
      if (out.length >= n) break;
      take(s);
    }
    if (out.length < n) {
      const global = shuffle(SONGS.filter((s) => s.id !== song.id && !used.has(normalTitle(s.title))));
      for (const s of global) {
        if (out.length >= n) break;
        take(s);
      }
    }
    return out.slice(0, n);
  }

  function buildQuestions(songs, mode, pool) {
    return songs.map((song) => {
      if (mode === 'genre') {
        const cats = selectedCats().length >= 4 ? selectedCats() : CATS;
        const correctCat = catOf(song);
        const others = shuffle(cats.filter((c) => c.key !== correctCat.key)).slice(0, 3);
        const options = shuffle([correctCat, ...others]).map((cat) => ({ kind: 'cat', cat, label: cat.name }));
        return {
          song,
          options,
          correctIndex: options.findIndex((o) => o.cat.key === correctCat.key),
        };
      }
      const distractors = pickDistractors(song, pool, 3);
      const options = shuffle([
        { kind: 'song', song, label: song.title },
        ...distractors.map((s) => ({ kind: 'song', song: s, label: s.title })),
      ]);
      return {
        song,
        options,
        correctIndex: options.findIndex((o) => o.kind === 'song' && o.song.id === song.id),
      };
    });
  }

  function answerWindow(clip) {
    if (clip <= 5) return 15;
    if (clip <= 15) return 22;
    return 37;
  }

  function launchGame({ songs, mode, practice = false, scope = 'custom' }) {
    const pool = selectedSongs();
    const finalSongs = songs.slice(0, Math.max(1, songs.length));
    if (!finalSongs.length) { toast('没有可用的曲目', 'err'); return; }
    const questions = buildQuestions(finalSongs, mode, pool);
    if (questions.some((q) => q.correctIndex < 0)) { toast('选项生成失败，请重试', 'err'); return; }

    closeAllModals();
    audio.stop(60);
    audio.unlock();

    const g = {
      mode,
      practice,
      scope,
      clip: state.clip,
      questions,
      index: -1,
      current: null,
      score: 0,
      combo: 0,
      maxCombo: 0,
      correct: 0,
      answered: 0,
      reviews: [],
      times: [],
      lives: mode === 'royale' ? state.lives : 0,
      maxLives: mode === 'royale' ? state.lives : 0,
      poolSize: pool.length,
      phase: 'idle',
      startedAt: 0,
      deadline: 0,
      windowSec: answerWindow(state.clip),
      raf: 0,
      advanceTimer: 0,
      clipStart: 0,
      clipEnd: 0,
      replayCount: 0,
      dotsEl: $('#gameDots'),
      loadingTimer: 0,
    };

    state.game = g;
    state.result = null;
    $('#gameModeLabel').textContent = practice ? (mode === 'royale' ? '大逃杀练习' : '错题重练') : MODE[mode].label;
    $('#qTotal').textContent = mode === 'royale' ? '∞' : String(questions.length);
    $('#livesBox').hidden = mode !== 'royale';
    $('#gameDots').hidden = mode === 'royale';
    $('#gameDots').innerHTML = '';
    if (mode !== 'royale') questions.forEach(() => $('#gameDots').appendChild(document.createElement('i')));
    setView('game');
    audio.sfx('start');
    updateHUD(g);
    nextQuestion();
  }

  function startFromLobby() {
    const err = validateStart();
    if (err) { toast(err, 'err'); return; }
    const pool = selectedSongs();
    const scope = poolScope();
    if (state.mode === 'tourney') {
      startTournament();
      return;
    }
    if (state.mode === 'royale') {
      launchGame({ songs: shuffle(pool), mode: 'royale', practice: state.lives === 3, scope });
      return;
    }
    const count = Math.min(state.count, pool.length);
    const chosen = shuffle(pool).slice(0, count);
    launchGame({ songs: chosen, mode: state.mode, scope });
  }

  function updateHUD(g) {
    $('#gameScore').textContent = fmtInt(g.score);
    $('#comboVal').textContent = String(g.combo);
    $('#qIndex').textContent = String(Math.min(g.index + 1, g.questions.length));
    $('#qTotal').textContent = g.mode === 'royale' ? '∞' : String(g.questions.length);
    if (g.mode === 'royale') {
      const lost = g.maxLives - g.lives;
      $('#livesVal').textContent = `${'♥'.repeat(Math.max(0, g.lives))}${'♡'.repeat(Math.max(0, lost))}`;
    }
    const dots = g.dotsEl.children;
    for (let i = 0; i < dots.length; i += 1) {
      const d = dots[i];
      d.className = '';
      if (i < g.reviews.length) d.classList.add(g.reviews[i].correct ? 'is-done' : 'is-miss');
      else if (i === g.index) d.classList.add('is-now');
    }
  }

  function resetQuestionUI(g) {
    clearTimeout(g.advanceTimer);
    g.advanceTimer = 0;
    $('#revealStrip').hidden = true;
    $('#revealStrip').classList.remove('is-visible');
    $('#revealStrip').style.display = '';
    $('#options').innerHTML = '';
    $('#discShade').style.opacity = '';
    $('#gameDisc').classList.remove('is-revealed', 'is-playing');
    concealCover($('#gameCover'));
    $('#orbit').classList.remove('is-active');
    $('#stageLoading').classList.remove('is-hidden', 'is-error');
    $('#stageLoading').innerHTML = '<span class="loader-ring"></span><strong>正在切一段给你听…</strong><small>首次播放需要缓冲几秒</small>';
    $('#ringProgress').style.strokeDashoffset = '0';
    $('#ringProgress').style.strokeDashoffset = '0';
    $('#ringClip').style.strokeDashoffset = String(CIRC_CLIP);
    $('#timerRing').classList.remove('is-low');
    $('#answerTitle').textContent = '听出是哪首歌了吗？';
    $('#answerSub').textContent = '四选一，越快答对分数越高。';
    $('#timerLabel').innerHTML = '<i class="dot-live"></i>正在切片段';
    $('#timerSec').textContent = `${g.windowSec.toFixed(1)}s`;
    $('#timeVal').textContent = g.windowSec.toFixed(1);
    $('#clipRange').textContent = '随机裁切中…';
    $('#replayBtn').disabled = true;
    $('#listenState').textContent = '正在加载…';
    $('#judgementLive').textContent = '';
    updateEq(false);
  }

  function nextQuestion() {
    const g = state.game;
    if (!g || state.view !== 'game') return;
    clearTimeout(g.advanceTimer);
    g.advanceTimer = 0;
    g.index += 1;
    if (g.index >= g.questions.length) { finishGame('complete'); return; }
    const q = g.questions[g.index];
    g.current = q;
    g.phase = 'loading';
    g.clipStart = 0;
    g.clipEnd = 0;

    resetQuestionUI(g);
    renderOptions(q, true);
    updateHUD(g);
    if (state.view === 'game') window.scrollTo({ top: 0, behavior: 'auto' });

    // 猜题阶段不展示曲绘；曲绘在公布答案时才会被加载。
    concealCover($('#gameCover'));
    $('#gameDisc').classList.remove('is-revealed', 'is-playing');

    const cat = catOf(q.song);
    $('#teaseRow').hidden = true;
    $('#genreBadge').textContent = 'MAIMAI DX';
    $('#genreBadge').style.setProperty('--cat', '#ff4f9a');
    $('#bpmBadge').textContent = `${q.song.bpm || '—'} BPM`;
    if (g.mode === 'genre') {
      $('#answerTitle').textContent = '它属于哪个分类？';
      $('#answerSub').textContent = '四选一，判断曲目所属分类。';
    }

    beginAudio(g, q, false);
  }

  function beginAudio(g, q, isReplay) {
    g.phase = 'loading';
    if (!isReplay) {
      $('#stageLoading').classList.remove('is-hidden', 'is-error');
      $('#replayBtn').disabled = true;
      $('#options').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    }
    const callbacks = {
      onStart(info) {
        if (state.game !== g || g.current !== q) return;
        if (!isReplay) {
          g.phase = 'answering';
          g.clipStart = info.start;
          g.clipEnd = info.end;
          g.startedAt = performance.now();
          g.deadline = g.startedAt + g.windowSec * 1000;
          hideLoading();
          $('#options').querySelectorAll('button').forEach((b) => { b.disabled = false; });
          startTimer(g);
        } else {
          g.clipStart = info.start;
          g.clipEnd = info.end;
          g.phase = 'answering';
        }
        $('#replayBtn').disabled = false;
        $('#clipRange').textContent = `@ ${fmtTime(info.start)} / ${fmtTime(info.duration)}`;
        $('#timerLabel').innerHTML = '<i class="dot-live"></i>正在试听';
        $('#gameDisc').classList.add('is-playing');
        $('#orbit').classList.add('is-active');
        $('#listenState').textContent = `试听中 · 剩余 ${g.clip}s`;
        if (isReplay) {
          $('#ringClip').style.strokeDashoffset = String(CIRC_CLIP);
          updateEq(true);
        }
      },
      onProgress(info) {
        if (state.game !== g || g.current !== q || g.phase !== 'answering') return;
        const played = clamp((info.currentTime - info.start) / Math.max(0.1, info.clipSec), 0, 1);
        $('#ringClip').style.strokeDashoffset = String(CIRC_CLIP * (1 - played));
        const remainClip = Math.max(0, Math.ceil(info.end - info.currentTime));
        $('#listenState').textContent = `试听中 · 剩余 ${remainClip}s`;
        updateEq(true);
      },
      onEnd() {
        if (state.game !== g || g.current !== q) return;
        $('#gameDisc').classList.remove('is-playing');
        $('#orbit').classList.remove('is-active');
        $('#timerLabel').innerHTML = '片段结束 · 继续作答';
        $('#listenState').textContent = '片段已播完';
        $('#ringClip').style.strokeDashoffset = '0';
        updateEq(false);
      },
      onError(err) {
        if (state.game !== g || g.current !== q) return;
        if (err && err.code === 'blocked') {
          showAudioError(g, q, '需要点击才能播放', '浏览器阻止了自动播放。', false);
        } else {
          showAudioError(g, q, '音频加载失败', '网络或资源暂时不可用。', true);
        }
      },
    };
    audio.play(q.song, g.clip, callbacks);
  }

  function hideLoading() {
    $('#stageLoading').classList.add('is-hidden');
    $('#stageLoading').classList.remove('is-error');
  }

  function showAudioError(g, q, title, sub, retryable) {
    const overlay = $('#stageLoading');
    overlay.classList.remove('is-hidden');
    overlay.classList.add('is-error');
    overlay.innerHTML = '';
    const ring = document.createElement('span');
    ring.className = 'loader-ring';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const small = document.createElement('small');
    small.textContent = sub;
    const actions = document.createElement('div');
    actions.className = 'load-actions';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary btn-sm retry-play';
    retry.textContent = audio.isBlocked ? '点击播放' : '重试';
    retry.addEventListener('click', () => {
      actions.remove();
      strong.textContent = '正在重新连接…';
      small.textContent = '马上就好';
      if (audio.isBlocked) {
        audio.retry().then((ok) => { if (!ok && state.game === g) showAudioError(g, q, '需要点击才能播放', '请在页面内点击播放按钮。', true); });
      } else {
        beginAudio(g, q, false);
      }
    });
    actions.appendChild(retry);
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn btn-ghost btn-sm';
    skip.textContent = '跳过本题';
    skip.addEventListener('click', () => {
      hideLoading();
      answer(-1, { forced: true, timeout: true });
    });
    actions.appendChild(skip);
    overlay.append(ring, strong, small, actions);
  }

  function startTimer(g) {
    cancelAnimationFrame(g.raf);
    const tick = () => {
      if (state.game !== g || g.phase !== 'answering') return;
      const now = performance.now();
      const remainMs = Math.max(0, g.deadline - now);
      const remain = remainMs / 1000;
      const ratio = clamp(remain / g.windowSec, 0, 1);
      $('#ringProgress').style.strokeDashoffset = String(CIRC_TIMER * (1 - ratio));
      $('#timerSec').textContent = `${remain.toFixed(1)}s`;
      $('#timeVal').textContent = remain.toFixed(1);
      $('#timerRing').classList.toggle('is-low', remain < Math.min(6, g.windowSec * 0.24));
      updateEq(audio.isPlaying);
      if (remain <= 0) {
        answer(-1, { timeout: true });
        return;
      }
      g.raf = requestAnimationFrame(tick);
    };
    g.raf = requestAnimationFrame(tick);
  }

  function renderOptions(q, disabled) {
    const wrap = $('#options');
    wrap.innerHTML = '';
    q.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-btn';
      btn.disabled = disabled;
      if (opt.kind === 'cat') {
        btn.style.setProperty('--cat', opt.cat.color);
        btn.classList.add('is-cat');
      }
      const num = document.createElement('span');
      num.className = 'option-num';
      num.textContent = String(i + 1);
      const title = document.createElement('span');
      title.className = 'option-title';
      title.textContent = opt.label;
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      arrow.setAttribute('class', 'option-arrow');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-arrow');
      arrow.appendChild(use);
      if (opt.kind === 'cat') {
        const dot = document.createElement('span');
        dot.className = 'option-cat-dot';
        dot.style.background = opt.cat.color;
        title.prepend(dot);
      }
      btn.append(num, title, arrow);
      btn.addEventListener('click', () => answer(i));
      wrap.appendChild(btn);
    });
  }

  /* ============================== answering ============================== */
  function answer(index, { timeout = false, forced = false } = {}) {
    const g = state.game;
    if (!g || state.view !== 'game') return;
    if (g.phase !== 'answering') {
      if (!forced) return;
    }
    if (g.answered >= g.questions.length) return;

    const q = g.current;
    if (!q) return;
    g.phase = 'revealed';
    cancelAnimationFrame(g.raf);
    const isTimeout = timeout || index < 0;
    const elapsed = g.startedAt ? clamp((performance.now() - g.startedAt) / 1000, 0, g.windowSec) : g.windowSec;

    audio.stop(160);
    updateEq(false);
    const correct = !isTimeout && index === q.correctIndex;
    const chosen = !isTimeout && q.options[index] ? q.options[index] : null;

    if (correct) {
      g.combo += 1;
      g.maxCombo = Math.max(g.maxCombo, g.combo);
      g.correct += 1;
      const ratio = clamp(1 - elapsed / g.windowSec, 0, 1);
      const speed = Math.round(500 * ratio);
      const comboBonus = Math.min(200, Math.max(0, g.combo - 1) * 20);
      var points = 500 + speed + comboBonus;
      g.score += points;
    } else {
      g.combo = 0;
      var points = 0;
      if (g.mode === 'royale') {
        g.lives = Math.max(0, g.lives - 1);
        if (g.lives === 0) audio.sfx('lives');
      }
    }
    g.answered += 1;
    g.times.push(elapsed);
    const review = {
      song: q.song,
      options: q.options,
      correctIndex: q.correctIndex,
      chosenIndex: isTimeout ? -1 : index,
      chosenLabel: chosen ? chosen.label : '',
      correct,
      timeout: isTimeout,
      elapsed,
      points,
    };
    g.reviews.push(review);

    // UI — options
    const buttons = $$('#options .option-btn');
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correctIndex) btn.classList.add('is-correct');
      else if (i === index) btn.classList.add('is-wrong');
      else btn.classList.add('is-dim');
      if (i === index) btn.classList.add('is-selected');
    });

    // UI — disc（到这一步才加载曲绘）
    const revealCoverEl = $('#gameCover');
    setCover(revealCoverEl, q.song);
    revealCoverEl.classList.remove('is-hidden');
    revealCoverEl.classList.add('is-revealed');
    $('#gameDisc').classList.add('is-revealed');
    $('#gameDisc').classList.remove('is-playing');
    $('#orbit').classList.remove('is-active');
    $('#timerLabel').textContent = correct ? '作答正确' : isTimeout ? '时间到' : '作答错误';

    const cat = catOf(q.song);
    $('#teaseRow').hidden = false;
    $('#genreBadge').textContent = cat.name;
    $('#genreBadge').style.setProperty('--cat', cat.color);
    $('#bpmBadge').textContent = `${q.song.bpm || '—'} BPM`;
    $('#answerTitle').textContent = correct ? '答对了！' : '正确答案是…';
    $('#answerSub').textContent = correct ? '连对越多，下一题奖励越高。' : '记住这段旋律，下次别再放过它。';
    $('#listenState').textContent = '已作答';

    // judgement
    const judge = correct ? (elapsed / g.windowSec <= 0.55 ? 'perfect' : 'great') : 'miss';
    audio.sfx(judge === 'perfect' ? 'perfect' : judge === 'great' ? 'great' : 'miss');
    showJudgement(judge, correct ? (judge === 'perfect' ? 'PERFECT' : 'GREAT') : 'MISS', correct ? `+${fmtInt(points)}` : isTimeout ? 'TIME UP' : 'NO COMBO');
    updateHUD(g);

    // reveal strip
    const strip = $('#revealStrip');
    strip.hidden = false;
    $('#revealCover').onerror = () => { $('#revealCover').onerror = null; $('#revealCover').src = coverFallback(q.song); };
    $('#revealCover').src = coverUrl(q.song);
    const tag = $('#revealTag');
    tag.className = 'reveal-tag';
    if (correct) tag.textContent = 'PERFECT';
    else if (isTimeout) { tag.classList.add('is-timeout'); tag.textContent = 'TIME UP'; }
    else { tag.classList.add('is-wrong'); tag.textContent = 'MISS'; }
    $('#revealTitle').textContent = q.song.title;
    $('#revealArtist').textContent = q.song.artist;
    const meta = $('#revealMeta');
    meta.innerHTML = '';
    const metaBits = [
      ['分类', cat.name],
      ['BPM', q.song.bpm || '—'],
      [q.song.type + ' ' + q.song.chart, `${q.song.level}${q.song.ds ? ` · ${q.song.ds}` : ''}`],
      ['收录', q.song.version],
      ['用时', `${elapsed.toFixed(1)}s`],
    ];
    metaBits.forEach(([k, v]) => {
      const span = document.createElement('span');
      span.textContent = k + ' ';
      const b = document.createElement('b');
      b.textContent = v;
      span.appendChild(b);
      meta.appendChild(span);
    });
    const aliases = Array.isArray(q.song.aliases) ? q.song.aliases.slice(0, 4) : [];
    $('#revealAliases').textContent = aliases.length ? `别称：${aliases.join(' / ')}` : '';
    $('#revealScore').textContent = points > 0 ? `+${fmtInt(points)}` : '0';
    $('#revealScore').classList.toggle('is-zero', points <= 0);
    const last = g.index >= g.questions.length - 1;
    const dead = g.mode === 'royale' && g.lives <= 0;
    $('#nextBtn').innerHTML = `${last || dead ? '查看结算' : '下一题'} <svg><use href="#i-arrow"></use></svg>`;
    $('#nextBtn').onclick = () => advanceQuestion();

    // update dots
    updateHUD(g);
    setTimeout(() => { if (state.game === g) strip.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 80);

    const delay = correct ? 2400 : 3200;
    clearTimeout(g.advanceTimer);
    g.advanceTimer = setTimeout(() => {
      if (state.game === g && g.phase === 'revealed') advanceQuestion();
    }, delay);
  }

  function showJudgement(kind, text, sub) {
    const stage = $('.stage');
    if (!stage) return;
    stage.querySelectorAll('.judge-pop').forEach((n) => n.remove());
    const pop = document.createElement('div');
    pop.className = `judge-pop ${kind}`;
    pop.textContent = text;
    const small = document.createElement('small');
    small.textContent = sub;
    pop.appendChild(small);
    stage.appendChild(pop);
    setTimeout(() => pop.remove(), 1100);
  }

  function advanceQuestion() {
    const g = state.game;
    if (!g || g.phase !== 'revealed') return;
    clearTimeout(g.advanceTimer);
    g.advanceTimer = 0;
    const dead = g.mode === 'royale' && g.lives <= 0;
    if (dead) { finishGame('lives'); return; }
    if (g.index >= g.questions.length - 1) { finishGame('complete'); return; }
    nextQuestion();
  }

  function replayCurrent() {
    const g = state.game;
    if (!g || state.view !== 'game' || g.phase !== 'answering') return;
    g.replayCount += 1;
    $('#listenState').textContent = '换一段重听…';
    $('#ringClip').style.strokeDashoffset = String(CIRC_CLIP);
    audio.replay({
      onStart(info) {
        if (state.game !== g) return;
        g.clipStart = info.start;
        g.clipEnd = info.end;
        $('#clipRange').textContent = `@ ${fmtTime(info.start)} / ${fmtTime(info.duration)}`;
        $('#timerLabel').innerHTML = '<i class="dot-live"></i>正在试听（新片段）';
        $('#gameDisc').classList.add('is-playing');
        $('#orbit').classList.add('is-active');
        $('#listenState').textContent = `新片段 · 剩余 ${g.clip}s`;
        updateEq(true);
      },
      onProgress(info) {
        if (state.game !== g || g.phase !== 'answering') return;
        const played = clamp((info.currentTime - info.start) / Math.max(0.1, info.clipSec), 0, 1);
        $('#ringClip').style.strokeDashoffset = String(CIRC_CLIP * (1 - played));
        $('#listenState').textContent = `新片段 · 剩余 ${Math.max(0, Math.ceil(info.end - info.currentTime))}s`;
        updateEq(true);
      },
      onEnd() {
        if (state.game !== g) return;
        $('#gameDisc').classList.remove('is-playing');
        $('#orbit').classList.remove('is-active');
        $('#timerLabel').innerHTML = '片段结束 · 继续作答';
        $('#listenState').textContent = '片段已播完';
        updateEq(false);
      },
      onError() {
        toast('这一段没加载出来，请重试', 'err');
      },
    }).catch(() => toast('换片段失败，请重试', 'err'));
  }

  /* ============================== results ============================== */
  function computeRank(accuracy) {
    if (accuracy >= 99.999) return 'SSS';
    if (accuracy >= 95) return 'SS';
    if (accuracy >= 85) return 'S';
    if (accuracy >= 70) return 'A';
    if (accuracy >= 50) return 'B';
    if (accuracy >= 30) return 'C';
    return 'D';
  }

  function finishGame(reason) {
    const g = state.game;
    if (!g || g.phase === 'done') return;
    g.phase = 'done';
    cancelAnimationFrame(g.raf);
    clearTimeout(g.advanceTimer);
    audio.stop(220);
    updateEq(false);
    document.body.classList.remove('is-playing');

    const answered = Math.max(1, g.answered);
    const accuracyRaw = (g.correct / answered) * 100;
    const accuracy = Math.round(accuracyRaw * 10) / 10;
    const avgTime = g.times.length ? g.times.reduce((a, b) => a + b, 0) / g.times.length : 0;
    const rank = computeRank(accuracy);
    const mode = g.mode;
    const wrong = g.reviews.filter((r) => !r.correct).length;
    const recordCount = mode === 'royale' ? g.answered : g.questions.length;

    let newRecord = false;
    if (!g.practice && reason !== 'exit' && answered > 0) {
      const comparable = state.records.filter((r) => r.mode === mode && Number(r.clip) === Number(g.clip) && (r.scope === 'custom' ? 'custom' : 'full') === (g.scope || 'custom'));
      const prevBest = mode === 'royale'
        ? comparable.reduce((max, r) => Math.max(max, Number(r.combo) || 0), 0)
        : comparable.reduce((max, r) => Math.max(max, Number(r.score) || 0), 0);
      newRecord = mode === 'royale' ? g.maxCombo > prevBest : g.score > prevBest && g.score > 0;
      const record = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        cn: displayName(),
        mode,
        scope: g.scope || 'custom',
        clip: g.clip,
        count: recordCount,
        score: g.score,
        accuracy,
        avgTime: Math.round(avgTime * 10) / 10,
        combo: g.maxCombo,
        correct: g.correct,
        answered: g.answered,
        poolSize: g.poolSize,
        date: new Date().toISOString(),
      };
      state.records.unshift(record);
      state.records = state.records.slice(0, 200);
      state.newRecordId = newRecord ? record.id : null;
      saveRecords();
    }

    let title = '挑战完成';
    let desc = RANKS[rank].desc;
    if (g.practice) {
      title = mode === 'royale' ? '大逃杀练习结束' : '错题重练完成';
      desc = mode === 'royale' ? `练习局：共答对 ${g.correct} 首。正式排位请用 1 命。` : '这些旋律现在应该更熟一点了。';
    } else if (reason === 'lives') { title = '大逃杀结束'; desc = `在第 ${g.index + 1} 题倒下，共答对 ${g.correct} 首。`; }
    else if (mode === 'royale' && reason === 'complete') { title = '大逃杀通关'; desc = `曲库抽完了，你在 ${g.questions.length} 首里活了下来。`; }
    else if (mode === 'genre') { title = '分类挑战完成'; desc = RANKS[rank].desc; }

    const covers = [];
    for (const r of g.reviews) {
      if (!covers.find((s) => s.id === r.song.id)) covers.push(r.song);
      if (covers.length >= 3) break;
    }

    state.result = {
      mode,
      scope: g.scope || 'custom',
      practice: g.practice,
      reason,
      score: g.score,
      accuracy,
      avgTime,
      maxCombo: g.maxCombo,
      correct: g.correct,
      answered: g.answered,
      total: g.questions.length,
      recordCount,
      wrong,
      clip: g.clip,
      poolSize: g.poolSize,
      rank,
      reviews: g.reviews.slice(),
      covers,
      newRecord,
      date: new Date().toISOString(),
      cn: displayName(),
      title,
      desc,
    };
    audio.sfx(rank === 'SSS' || rank === 'SS' || rank === 'S' ? 'win' : 'click');
    renderResult(state.result);
    setView('result');
    state.game = null;
    renderBoard();
    renderMiniBoard();
    renderHeroStats();
    if (!state.result.practice && state.result.answered > 0) submitScore(state.result);
  }

  function renderResultExtra(res) {
    const extra = $('#resultExtra');
    if (!extra) return;
    extra.innerHTML = '';
    const rows = [
      ['本次模式', res.practice ? (res.mode === 'royale' ? '大逃杀练习（不计榜）' : '错题重练（不计榜）') : MODE[res.mode].label],
      ['答题节奏', `${res.avgTime.toFixed(1)} 秒 / 题`],
      ['答错题数', `${res.wrong} 题`],
      ['曲库范围', `${res.scope === 'full' ? '全曲库' : '其他曲库'} · ${fmtInt(res.poolSize)} 首`],
    ];
    if (res.mode === 'royale') rows.push(['大逃杀', res.reason === 'lives' ? '生命耗尽' : '成功存活']);
    if (res.practice) {
      rows.push(['榜单', '练习局不参与排行']);
    } else {
      let text = '待上传';
      if (res.globalStatus === 'pending') text = '上传中…';
      else if (res.globalStatus === 'ok') text = res.globalRank ? `第 ${res.globalRank} 名 · 全服榜` : '已上传全服榜';
      else if (res.globalStatus === 'fail') text = '上传失败 · 已存本机';
      else if (res.globalStatus === 'offline') text = '未连接 · 已存本机';
      rows.push(['全服排名', text]);
    }
    rows.forEach(([k, v]) => {
      const span = document.createElement('span');
      span.textContent = `${k}：`;
      const b = document.createElement('b');
      b.textContent = v;
      span.appendChild(b);
      extra.appendChild(span);
    });
  }

  async function submitScore(res) {
    if (!res || res.practice || res.submitting) return;
    if (!state.globalAvailable) {
      res.globalStatus = 'offline';
      renderResultExtra(res);
      return;
    }
    ensureClientId();
    res.submitting = true;
    res.globalStatus = 'pending';
    renderResultExtra(res);
    try {
      const payload = {
        clientId: state.clientId,
        cn: displayName(),
        mode: res.mode,
        scope: res.scope || 'custom',
        clip: res.clip,
        count: res.mode === 'royale' ? res.answered : res.total,
        answered: res.answered,
        correct: res.correct,
        score: res.score,
        accuracy: res.accuracy,
        avgTime: res.avgTime,
        maxCombo: res.maxCombo,
        poolSize: res.poolSize,
      };
      const data = await apiJson(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      res.globalStatus = 'ok';
      res.globalRank = data && data.rank ? Number(data.rank) : null;
      res.globalId = data && data.id ? data.id : null;
      state.globalAvailable = true;
      state.globalNewId = res.globalId != null ? String(res.globalId) : null;
      renderResultExtra(res);
      toast(`成绩已上传全服榜${res.globalRank ? ` · 第 ${res.globalRank} 名` : ''}`, 'ok');
      if (state.boardSource === 'global') loadGlobalBoard({ silent: true });
      loadGlobalTop();
    } catch (err) {
      res.globalStatus = 'fail';
      res.globalError = err.message || '上传失败';
      res.submitting = false;
      renderResultExtra(res);
      if (err.status === 429) toast(err.message, 'err');
      else if (state.globalAvailable) toast('成绩已保存本机，全服榜暂不可用', 'err');
    }
  }

  function renderResult(res) {
    const rankInfo = RANKS[res.rank] || RANKS.D;
    const letter = $('#rankLetter');
    letter.textContent = res.rank;
    letter.className = `rank-letter rank-${res.rank.toLowerCase()}`;
    $('#rankLabel').textContent = rankInfo.label;
    $('#finalScore').textContent = fmtInt(res.score);
    $('#scorecardMode').textContent = res.practice ? '错题重练' : MODE[res.mode].label;
    $('#scoreSubline').textContent = res.mode === 'royale'
      ? `答题 ${res.answered} 首 · 最高 ${res.maxCombo} 连 · ${res.clip} 秒`
      : `${res.answered} 题 · ${res.clip} 秒 · ${fmtInt(res.poolSize)} 首曲库`;
    $('#statAcc').textContent = `${res.accuracy.toFixed(1)}%`;
    $('#statAvg').textContent = `${res.avgTime.toFixed(1)}s`;
    $('#statCombo').textContent = String(res.maxCombo);
    $('#statCorrect').textContent = `${res.correct} / ${res.answered}`;
    $('#resultCn').textContent = res.cn;
    $('#resultDate').textContent = fmtDate(res.date, true);
    $('#resultTitle').textContent = res.title;
    $('#resultDesc').textContent = res.desc;
    $('#newRecord').hidden = !res.newRecord;

    const covers = $('#scorecardCovers');
    covers.innerHTML = '';
    res.covers.slice(0, 3).forEach((song) => {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => { img.onerror = null; img.src = coverFallback(song); };
      img.src = coverUrl(song);
      covers.appendChild(img);
    });

    renderResultExtra(res);
    renderReview(res);
  }

  function renderReview(res) {
    const wrap = $('#reviewList');
    wrap.innerHTML = '';
    res.reviews.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'review-row';
      const idx = document.createElement('span');
      idx.className = 'review-idx';
      idx.textContent = String(i + 1).padStart(2, '0');

      const cover = document.createElement('div');
      cover.className = 'review-cover';
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => { img.onerror = null; img.src = coverFallback(r.song); };
      img.src = coverUrl(r.song);
      cover.appendChild(img);

      const info = document.createElement('div');
      info.className = 'review-info';
      const title = document.createElement('strong');
      title.textContent = r.song.title;
      const small = document.createElement('small');
      if (r.correct) small.textContent = r.song.artist;
      else if (r.timeout) small.textContent = `未作答 · ${r.song.artist}`;
      else small.textContent = `你选了「${r.chosenLabel}」`;
      info.append(title, small);

      const tag = document.createElement('span');
      tag.className = `review-tag ${r.correct ? 'ok' : r.timeout ? 'timeout' : 'bad'}`;
      tag.textContent = r.correct ? '正确' : r.timeout ? '超时' : '答错';

      const time = document.createElement('span');
      time.className = 'review-time';
      time.textContent = r.timeout ? '—' : `${r.elapsed.toFixed(1)}s`;

      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'review-play';
      play.setAttribute('aria-label', `试听 ${r.song.title}`);
      play.innerHTML = '<svg><use href="#i-play"></use></svg>';
      play.addEventListener('click', () => playReview(r.song, play));

      row.append(idx, cover, info, tag, time, play);
      wrap.appendChild(row);
    });
    $('#retryWrongBtn').hidden = res.practice || res.wrong === 0;
  }

  /* ============================== review audio ============================== */
  function getReviewAudio() {
    if (!state.reviewAudio) {
      const a = new Audio();
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      a.volume = 0.9;
      a.addEventListener('error', () => { stopReview(); toast('试听加载失败', 'err'); });
      state.reviewAudio = a;
    }
    return state.reviewAudio;
  }

  function stopReview() {
    if (state.reviewTimer) { clearTimeout(state.reviewTimer); state.reviewTimer = 0; }
    const a = state.reviewAudio;
    if (a) {
      a.onloadedmetadata = null;
      a.pause();
      try { a.currentTime = 0; } catch (_) { /* ignore */ }
    }
    if (state.reviewBtn) {
      state.reviewBtn.classList.remove('is-playing');
      state.reviewBtn.innerHTML = '<svg><use href="#i-play"></use></svg>';
      state.reviewBtn = null;
    }
  }

  function playReview(song, btn) {
    if (state.reviewBtn === btn && state.reviewAudio && !state.reviewAudio.paused) {
      stopReview();
      return;
    }
    stopReview();
    const a = getReviewAudio();
    state.reviewBtn = btn;
    btn.classList.add('is-playing');
    btn.innerHTML = '<svg><use href="#i-pause"></use></svg>';
    a.onloadedmetadata = () => {
      const duration = Number.isFinite(a.duration) ? a.duration : 60;
      const clip = Math.min(15, Math.max(5, duration - 3));
      const start = Math.random() * Math.max(0.1, duration - clip - 2);
      try { a.currentTime = start; } catch (_) { /* ignore */ }
      a.play().catch(() => {
        stopReview();
        toast('试听被浏览器拦截，请再点一次', 'err');
      });
    };
    a.src = audioUrl(song);
    a.load();
    state.reviewTimer = setTimeout(stopReview, 16000);
  }

  /* ============================== tournament ============================== */
  function startTournament() {
    const err = validateStart();
    if (err) { toast(err, 'err'); return; }
    const pool = selectedSongs();
    if (pool.length < state.size) { toast(`至少需要 ${state.size} 首曲目`, 'err'); return; }
    const picks = shuffle(pool).slice(0, state.size);
    const pairs = [];
    for (let i = 0; i < picks.length; i += 2) pairs.push([picks[i], picks[i + 1]]);
    state.tournament = {
      size: state.size,
      picks,
      rounds: [{ pairs, winners: [] }],
      round: 0,
      match: 0,
      champion: null,
      locked: false,
      playingSide: null,
      playingId: null,
      practice: false,
    };
    closeAllModals();
    audio.stop(80);
    audio.unlock();
    $('#duelWrap').hidden = false;
    $('#championWrap').hidden = true;
    $('.tour-hint').hidden = false;
    $('#tourSub').textContent = `${state.size} 首 · ${roundsFor(state.size)} 轮 · 两两对决`;
    setView('tourney');
    renderBracket();
    startDuel();
    audio.sfx('start');
  }

  function roundName(r, size) {
    const remaining = size / Math.pow(2, r);
    if (remaining <= 2) return '决赛';
    return `${remaining} 强`;
  }

  function renderBracket() {
    const t = state.tournament;
    const wrap = $('#tourBracket');
    if (!t || !wrap) return;
    wrap.innerHTML = '';
    for (let r = 0; r < roundsFor(t.size); r += 1) {
      const col = document.createElement('div');
      col.className = 'bracket-col';
      if (r === t.round) col.classList.add('is-current');
      const label = document.createElement('span');
      label.textContent = roundName(r, t.size);
      col.appendChild(label);
      const roundData = t.rounds[r];
      const count = t.size / Math.pow(2, r + 1);
      for (let m = 0; m < count; m += 1) {
        const pair = document.createElement('div');
        pair.className = 'bracket-pair';
        for (let k = 0; k < 2; k += 1) {
          const b = document.createElement('b');
          const song = roundData && roundData.pairs[m] ? roundData.pairs[m][k] : null;
          const winner = roundData && roundData.winners[m];
          if (song) {
            b.textContent = song.title.length > 7 ? `${song.title.slice(0, 7)}…` : song.title;
            b.title = song.title;
            if (winner && winner.id === song.id) b.classList.add('won');
            if (r === t.round && m === t.match) b.classList.add('live');
          } else {
            b.textContent = '—';
          }
          pair.appendChild(b);
        }
        col.appendChild(pair);
      }
      wrap.appendChild(col);
    }
    const finalCol = document.createElement('div');
    finalCol.className = 'bracket-col';
    const flabel = document.createElement('span');
    flabel.textContent = '本命';
    finalCol.appendChild(flabel);
    const fpair = document.createElement('div');
    fpair.className = 'bracket-pair';
    const fb = document.createElement('b');
    fb.textContent = t.champion ? (t.champion.title.length > 7 ? `${t.champion.title.slice(0, 7)}…` : t.champion.title) : '—';
    if (t.champion) fb.classList.add('won');
    fpair.appendChild(fb);
    finalCol.appendChild(fpair);
    wrap.appendChild(finalCol);

    const totalRounds = roundsFor(t.size);
    const dots = $('#roundDots');
    dots.innerHTML = '';
    for (let i = 0; i < totalRounds; i += 1) {
      const dot = document.createElement('i');
      if (i < t.round) dot.classList.add('done');
      else if (i === t.round) dot.classList.add('now');
      dots.appendChild(dot);
    }
    if (t.champion) {
      $('#tourRoundLabel').textContent = '本命已决出';
      dots.querySelectorAll('i').forEach((d) => { d.className = 'done'; });
    } else {
      const matches = t.rounds[t.round].pairs.length;
      $('#tourRoundLabel').textContent = `${roundName(t.round, t.size)} · 第 ${t.match + 1} / ${matches} 场`;
    }
  }

  function startDuel() {
    const t = state.tournament;
    if (!t || t.champion) return;
    const pair = t.rounds[t.round].pairs[t.match];
    if (!pair) return;
    t.locked = false;
    t.playingSide = null;
    t.playingId = null;
    $('#duelWrap').hidden = false;
    $('#championWrap').hidden = true;
    setDuelSide('a', pair[0]);
    setDuelSide('b', pair[1]);
    ['a', 'b'].forEach((side) => {
      const card = $(`.duel-card[data-side="${side}"]`);
      card.classList.remove('is-winner', 'is-loser', 'is-playing');
      const pickBtn = side === 'a' ? $('#duelPickA') : $('#duelPickB');
      const playBtn = side === 'a' ? $('#duelPlayA') : $('#duelPlayB');
      pickBtn.disabled = false;
      playBtn.disabled = false;
      playBtn.innerHTML = '<svg><use href="#i-play"></use></svg><span>试听 <b>' + side.toUpperCase() + '</b></span>';
    });
    renderBracket();
  }

  function setDuelSide(side, song) {
    const cat = catOf(song);
    const cover = side === 'a' ? $('#duelCoverA') : $('#duelCoverB');
    const title = side === 'a' ? $('#duelTitleA') : $('#duelTitleB');
    const artist = side === 'a' ? $('#duelArtistA') : $('#duelArtistB');
    const chart = side === 'a' ? $('#duelChartA') : $('#duelChartB');
    const genre = side === 'a' ? $('#duelGenreA') : $('#duelGenreB');
    setCover(cover, song);
    title.textContent = song.title;
    artist.textContent = song.artist;
    chart.textContent = `${song.type} ${song.chart} ${song.level}${song.ds ? ` · ${song.ds}` : ''}`;
    genre.textContent = cat.short;
    genre.style.setProperty('--cat', cat.color);
  }

  function playDuel(side) {
    const t = state.tournament;
    if (!t || t.locked) return;
    const pair = t.rounds[t.round].pairs[t.match];
    const song = pair[side === 'a' ? 0 : 1];
    if (!song) return;
    if (t.playingSide === side) {
      audio.stop(100);
      t.playingSide = null;
      t.playingId = null;
      updateDuelPlayState();
      return;
    }
    audio.stop(80);
    t.playingSide = side;
    t.playingId = song.id;
    updateDuelPlayState();
    audio.play(song, 12, {
      onStart: () => updateDuelPlayState(),
      onEnd: () => {
        if (!t || t.playingId !== song.id) return;
        t.playingSide = null;
        t.playingId = null;
        updateDuelPlayState();
      },
      onError: () => {
        t.playingSide = null;
        t.playingId = null;
        updateDuelPlayState();
        toast('试听加载失败，可直接选择', 'err');
      },
    });
  }

  function updateDuelPlayState() {
    const t = state.tournament;
    if (!t) return;
    [['a', 'duelPlayA'], ['b', 'duelPlayB']].forEach(([side, id]) => {
      const btn = document.getElementById(id);
      const card = $(`.duel-card[data-side="${side}"]`);
      const playing = t.playingSide === side;
      card.classList.toggle('is-playing', playing);
      btn.classList.toggle('is-playing', playing);
      btn.innerHTML = playing
        ? '<svg><use href="#i-pause"></use></svg><span>停止</span>'
        : `<svg><use href="#i-play"></use></svg><span>试听 ${side.toUpperCase()}</span>`;
    });
  }

  function pickDuel(side) {
    const t = state.tournament;
    if (!t || t.locked || t.champion) return;
    const round = t.rounds[t.round];
    const pair = round.pairs[t.match];
    const winner = pair[side === 'a' ? 0 : 1];
    if (!winner) return;
    t.locked = true;
    audio.stop(150);
    t.playingSide = null;
    t.playingId = null;
    updateDuelPlayState();
    const winCard = $(`.duel-card[data-side="${side}"]`);
    const loseCard = $(`.duel-card[data-side="${side === 'a' ? 'b' : 'a'}"]`);
    winCard.classList.add('is-winner');
    loseCard.classList.add('is-loser');
    $('#duelPickA').disabled = true;
    $('#duelPickB').disabled = true;
    $('#duelPlayA').disabled = true;
    $('#duelPlayB').disabled = true;
    audio.sfx('great');
    setTimeout(() => {
      if (state.tournament !== t) return;
      round.winners[t.match] = winner;
      t.match += 1;
      if (t.match >= round.pairs.length) {
        if (round.winners.length === 1) { showChampion(round.winners[0]); return; }
        const nextPairs = [];
        for (let i = 0; i < round.winners.length; i += 2) nextPairs.push([round.winners[i], round.winners[i + 1]]);
        t.rounds.push({ pairs: nextPairs, winners: [] });
        t.round += 1;
        t.match = 0;
      }
      renderBracket();
      startDuel();
    }, 720);
  }

  function showChampion(song) {
    const t = state.tournament;
    if (!t) return;
    t.champion = song;
    $('#duelWrap').hidden = true;
    $('.tour-hint').hidden = true;
    $('#championWrap').hidden = false;
    const cat = catOf(song);
    setCover($('#championCover'), song);
    $('#championTitle').textContent = song.title;
    $('#championArtist').textContent = song.artist;
    $('#championTag').textContent = `${cat.name} · ${song.type} ${song.chart} ${song.level}`;
    $('.champion-note').textContent = `从 ${t.size} 首曲目里一路过关斩将，你的本命是它。`;
    renderBracket();
    audio.sfx('win');
    showConfetti();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showConfetti() {
    const wrap = $('#championWrap');
    if (!wrap) return;
    wrap.querySelectorAll('.confetti-piece').forEach((n) => n.remove());
    const colors = ['#ff4f9a', '#ffd23f', '#35cdf5', '#a57bff', '#54e0a8'];
    for (let i = 0; i < 40; i += 1) {
      const piece = document.createElement('i');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 0.8}s`;
      piece.style.animationDuration = `${1.8 + Math.random() * 1.8}s`;
      piece.style.transform = `rotate(${Math.random() * 180}deg)`;
      wrap.appendChild(piece);
    }
    setTimeout(() => wrap.querySelectorAll('.confetti-piece').forEach((n) => n.remove()), 4200);
  }

  function exitTournament() {
    audio.stop(120);
    state.tournament = null;
    setView('lobby');
    toast('已退出本命淘汰赛');
  }

  /* ============================== share cards ============================== */
  function loadImageForCanvas(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let settled = false;
      const done = (val) => { if (!settled) { settled = true; resolve(val); } };
      img.onload = () => done(img);
      img.onerror = () => done(null);
      setTimeout(() => done(null), 7000);
      img.src = url;
    });
  }

  async function ensureFonts() {
    if (!document.fonts) return;
    try {
      await Promise.race([
        Promise.all([document.fonts.load('700 100px Torus'), document.fonts.load('700 40px MaiCN')]),
        new Promise((r) => setTimeout(r, 1600)),
      ]);
    } catch (_) { /* ignore */ }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function ellipsize(ctx, text, maxWidth) {
    let t = String(text || '');
    if (ctx.measureText(t).width <= maxWidth) return t;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
    return `${t}…`;
  }

  function drawCoverCard(ctx, img, x, y, size, rotation = 0, song = null) {
    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);
    ctx.rotate(rotation);
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 18;
    roundRect(ctx, -size / 2, -size / 2, size, size, 26);
    ctx.fillStyle = '#2a1833';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.save();
    roundRect(ctx, -size / 2, -size / 2, size, size, 26);
    ctx.clip();
    if (img) {
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    } else if (song) {
      const cat = catOf(song);
      const g = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
      g.addColorStop(0, cat.color);
      g.addColorStop(1, '#1a0e24');
      ctx.fillStyle = g;
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.font = `700 ${Math.round(size * 0.085)}px MaiCN, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(ellipsize(ctx, song.title, size * 0.8), -size * 0.38, size * 0.1);
    }
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    roundRect(ctx, -size / 2, -size / 2, size, size, 26);
    ctx.stroke();
    ctx.restore();
  }

  async function buildShareCard(kind, data) {
    const canvas = $('#shareCanvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    await ensureFonts();

    // background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#251031');
    bg.addColorStop(0.55, '#140b1f');
    bg.addColorStop(1, '#1d0b28');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow1 = ctx.createRadialGradient(90, 80, 0, 90, 80, 620);
    glow1.addColorStop(0, 'rgba(255,79,154,.4)');
    glow1.addColorStop(1, 'rgba(255,79,154,0)');
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, W, H);
    const glow2 = ctx.createRadialGradient(W - 80, 500, 0, W - 80, 500, 560);
    glow2.addColorStop(0, 'rgba(53,205,245,.22)');
    glow2.addColorStop(1, 'rgba(53,205,245,0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);

    // dot grid
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#fff';
    for (let y = 40; y < H; y += 42) {
      for (let x = 40; x < W; x += 42) {
        ctx.beginPath();
        ctx.arc(x, y, 1.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // rings
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W - 80, 120, 300, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([5, 14]);
    ctx.beginPath();
    ctx.arc(W - 80, 120, 380, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // ghost type
    ctx.save();
    ctx.translate(W - 62, H - 200);
    ctx.rotate(-Math.PI / 2);
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#fff';
    ctx.font = '700 130px Torus, sans-serif';
    ctx.fillText('MAIMAI SONG QUIZ', 0, 0);
    ctx.restore();

    // header
    ctx.save();
    ctx.strokeStyle = '#ff4f9a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(86, 92, 29, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.6)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.arc(86, 92, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = '700 38px MaiCN, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('舞萌听歌大作战', 132, 106);
    ctx.fillStyle = 'rgba(255,255,255,.48)';
    ctx.font = '700 15px Torus, sans-serif';
    ctx.letterSpacing = '4px';
    ctx.fillText('MAIMAI SONG QUIZ', 134, 132);
    ctx.letterSpacing = '0px';

    // date top right
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = '700 17px Torus, sans-serif';
    ctx.fillText(fmtDate(data.date), W - 64, 100);
    ctx.fillStyle = 'rgba(255,255,255,.32)';
    ctx.font = '700 13px Torus, sans-serif';
    ctx.fillText('DX / SONG QUIZ', W - 64, 128);

    if (kind === 'honmei') {
      const img = await loadImageForCanvas(coverUrl(data.song));
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd76a';
      ctx.font = '700 16px Torus, sans-serif';
      ctx.letterSpacing = '8px';
      ctx.fillText('YOUR HONMEI', W / 2, 200);
      ctx.letterSpacing = '0px';
      drawCoverCard(ctx, img, W / 2 - 210, 288, 420, -2, data.song);
      ctx.fillStyle = '#fff';
      ctx.font = '700 58px MaiCN, sans-serif';
      ctx.fillText(ellipsize(ctx, data.song.title, 900), W / 2, 802);
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.font = '400 26px MaiCN, sans-serif';
      ctx.fillText(ellipsize(ctx, data.song.artist, 860), W / 2, 850);
      const cat = catOf(data.song);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      roundRect(ctx, W / 2 - 245, 896, 490, 58, 16);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.font = '700 19px MaiCN, sans-serif';
      ctx.fillText(`${cat.name} · ${data.song.type} ${data.song.chart} ${data.song.level}`, W / 2, 933);
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.font = '400 19px MaiCN, sans-serif';
      ctx.fillText('从随机曲目中一路选择，选出我的本命。', W / 2, 1010);
      // stats
      const stats = [
        ['曲目数量', `${data.size} 首`],
        ['对决轮数', `${roundsFor(data.size)} 轮`],
        ['收录版本', data.song.version || 'maimai DX'],
      ];
      const bw = 280;
      const startX = (W - (bw * 3 + 40)) / 2;
      stats.forEach(([k, v], i) => {
        const x = startX + i * (bw + 20);
        ctx.fillStyle = 'rgba(255,255,255,.06)';
        roundRect(ctx, x, 1080, bw, 120, 20);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.42)';
        ctx.font = '700 14px MaiCN, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(k, x + bw / 2, 1120);
        ctx.fillStyle = '#fff';
        ctx.font = '700 25px MaiCN, sans-serif';
        ctx.fillText(ellipsize(ctx, v, bw - 30), x + bw / 2, 1164);
      });
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      ctx.font = '700 22px MaiCN, sans-serif';
      ctx.fillText(data.cn, W / 2, 1268);
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.font = '400 14px MaiCN, sans-serif';
      ctx.fillText('非官方粉丝作品 · LXNS PUBLIC ASSETS', W / 2, 1304);
      return canvas;
    }

    // ---------- result card ----------
    const rankInfo = RANKS[data.rank] || RANKS.D;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.font = '700 15px Torus, sans-serif';
    ctx.letterSpacing = '6px';
    ctx.fillText('FINAL RESULT', 72, 218);
    ctx.letterSpacing = '0px';

    const rankGrad = ctx.createLinearGradient(64, 240, 420, 540);
    rankInfo.color.forEach((color, i) => rankGrad.addColorStop(i / Math.max(1, rankInfo.color.length - 1), color));
    ctx.fillStyle = rankGrad;
    ctx.font = '700 250px Torus, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(data.rank, 58, 470);
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = '700 17px Torus, sans-serif';
    ctx.letterSpacing = '5px';
    ctx.fillText(rankInfo.label, 76, 508);
    ctx.letterSpacing = '0px';

    ctx.fillStyle = 'rgba(255,255,255,.38)';
    ctx.font = '700 15px Torus, sans-serif';
    ctx.letterSpacing = '4px';
    ctx.fillText('TOTAL SCORE', 76, 590);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = '#fff';
    ctx.font = '700 106px Torus, sans-serif';
    ctx.fillText(fmtInt(data.score), 70, 692);
    ctx.fillStyle = 'rgba(255,255,255,.52)';
    ctx.font = '400 19px MaiCN, sans-serif';
    ctx.fillText(`${MODE[data.mode]?.label || data.mode} · ${data.answered} 题 · ${data.clip} 秒`, 78, 734);

    // covers
    const imgs = await Promise.all(data.covers.slice(0, 3).map((s) => loadImageForCanvas(coverUrl(s))));
    const positions = [
      { x: 600, y: 208, size: 300, rot: -8 },
      { x: 730, y: 250, size: 270, rot: 3 },
      { x: 660, y: 390, size: 230, rot: 10 },
    ];
    data.covers.slice(0, 3).forEach((song, i) => {
      const p = positions[i] || positions[0];
      drawCoverCard(ctx, imgs[i], p.x, p.y, p.size, p.rot * Math.PI / 180, song);
    });

    // stats boxes
    const stats = [
      ['准确率', `${data.accuracy.toFixed(1)}%`],
      ['平均用时', `${data.avgTime.toFixed(1)}s`],
      ['最高连对', String(data.maxCombo)],
      ['正确题数', `${data.correct} / ${data.answered}`],
    ];
    const bw = 220;
    const gap = 20;
    const startX = (W - (bw * 4 + gap * 3)) / 2;
    stats.forEach(([k, v], i) => {
      const x = startX + i * (bw + gap);
      ctx.fillStyle = 'rgba(255,255,255,.065)';
      roundRect(ctx, x, 836, bw, 146, 22);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.07)';
      ctx.lineWidth = 1;
      roundRect(ctx, x, 836, bw, 146, 22);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.font = '700 15px MaiCN, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(k, x + bw / 2, 880);
      ctx.fillStyle = '#fff';
      ctx.font = '700 35px Torus, sans-serif';
      ctx.fillText(v, x + bw / 2, 938);
    });

    // quote + footer
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.42)';
    ctx.font = '400 18px MaiCN, sans-serif';
    ctx.fillText(ellipsize(ctx, data.desc, 900), 76, 1044);
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '700 22px MaiCN, sans-serif';
    ctx.fillText(data.cn, 76, 1268);
    ctx.fillStyle = 'rgba(255,255,255,.32)';
    ctx.font = '400 14px MaiCN, sans-serif';
    ctx.fillText('非官方粉丝作品 · LXNS PUBLIC ASSETS', 76, 1304);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.font = '700 15px Torus, sans-serif';
    ctx.fillText('MAIMAI SONG QUIZ', W - 64, 1304);
    return canvas;
  }

  async function openShareCard(kind) {
    let data;
    if (kind === 'honmei') {
      const t = state.tournament;
      if (!t || !t.champion) return;
      data = { song: t.champion, size: t.size, cn: displayName(), date: new Date().toISOString() };
    } else {
      if (!state.result) return;
      data = state.result;
    }
    $('#shareTitle').textContent = kind === 'honmei' ? '本命卡已生成' : '结算卡已生成';
    $('#sharePreview').removeAttribute('src');
    $('#sharePreview').style.opacity = '0.4';
    openModal('shareModal');
    try {
      const canvas = await buildShareCard(kind, data);
      await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          state.shareBlob = blob;
          state.shareName = kind === 'honmei'
            ? `maimai-honmei-${Date.now()}.png`
            : `maimai-quiz-${data.rank}-${fmtDate(data.date).replace(/\./g, '')}-${data.score}.png`;
          const url = URL.createObjectURL(blob);
          const img = $('#sharePreview');
          img.onload = () => URL.revokeObjectURL(url);
          img.src = url;
          img.style.opacity = '1';
          resolve();
        }, 'image/png');
      });
      $('#sharePreview').style.opacity = '1';
    } catch (err) {
      console.error(err);
      closeModal('shareModal');
      toast('结算卡生成失败，请重试', 'err');
    }
  }

  function downloadShareCard() {
    if (!state.shareBlob) { toast('还没有生成结算卡', 'err'); return; }
    const a = document.createElement('a');
    const url = URL.createObjectURL(state.shareBlob);
    a.href = url;
    a.download = state.shareName || 'maimai-song-quiz.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('已保存结算卡', 'ok');
  }

  /* ============================== events & init ============================== */

  /* ============================== multiplayer client ============================== */
  const MP_PHASE_LABEL = {
    waiting: '等待中',
    starting: '准备中',
    question: '答题中',
    playing: '答题中',
    reveal: '公布答案',
    finished: '已结束',
  };

  function mpEndpoint() {
    const configured = window.MAI_CONFIG && window.MAI_CONFIG.multiplayerWs;
    if (configured) return configured;
    if (!/^https?:$/.test(location.protocol)) return '';
    const url = new URL('/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  function mpAudioInstance() {
    const m = state.multi;
    if (!m.mpAudio) {
      m.mpAudio = new window.MaiAudio();
      m.mpAudio.setSfxEnabled(state.sfx);
    }
    return m.mpAudio;
  }

  function sendMulti(type, extra = {}) {
    const ws = state.multi.ws;
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(JSON.stringify({ type, ...extra }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function updateConnUI() {
    const m = state.multi;
    const el = $('#connStatus');
    if (el) {
      const map = {
        online: ['ok', '联机已连接'],
        connecting: ['connecting', '连接中…'],
        offline: ['offline', '未连接'],
        reconnecting: ['connecting', '重连中…'],
        idle: ['connecting', '连接中…'],
      };
      const [stateKey, label] = map[m.status] || map.idle;
      el.dataset.state = stateKey;
      const span = el.querySelector('span');
      if (span) span.textContent = label;
    }
    const offline = $('#multiOffline');
    if (offline) offline.hidden = m.status !== 'offline';
    if (m.pane === 'lobby') renderRoomList(m.rooms);
  }

  function scheduleMultiReconnect() {
    const m = state.multi;
    if (m.leaving || !m.room) return;
    if (m.reconnectTimer) return;
    const delay = Math.min(10000, 800 * (2 ** Math.min(m.reconnectAttempts, 4)));
    m.reconnectAttempts += 1;
    m.reconnectTimer = setTimeout(() => {
      m.reconnectTimer = 0;
      if (!m.room || m.leaving) return;
      if (m.ws && m.ws.readyState <= 1) return;
      m.status = 'reconnecting';
      updateConnUI();
      connectMulti(true);
    }, delay);
  }

  function connectMulti(force = false) {
    const m = state.multi;
    if (m.reconnectTimer) { clearTimeout(m.reconnectTimer); m.reconnectTimer = 0; }
    if (m.ws && !force && (m.ws.readyState === 0 || m.ws.readyState === 1)) return;
    if (m.ws) {
      try { m.ws.onclose = null; m.ws.close(); } catch (_) { /* ignore */ }
      m.ws = null;
    }
    const endpoint = mpEndpoint();
    if (!endpoint) {
      m.status = 'offline';
      updateConnUI();
      return;
    }
    m.status = 'connecting';
    updateConnUI();
    let ws;
    try {
      ws = new WebSocket(endpoint);
    } catch (_) {
      m.status = 'offline';
      updateConnUI();
      return;
    }
    m.ws = ws;
    const token = ++m.wsToken;
    ws.onopen = () => {
      if (m.ws !== ws || m.wsToken !== token) return;
      m.status = 'online';
      updateConnUI();
      ensureClientId();
      sendMulti('identify', { clientId: state.clientId, cn: displayName() });
      attemptPendingJoin();
    };
    ws.onmessage = (ev) => {
      if (m.ws !== ws || m.wsToken !== token) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      handleMultiMessage(msg);
    };
    ws.onclose = (ev) => {
      if (m.ws !== ws || m.wsToken !== token) return;
      m.ws = null;
      if (ev && ev.code === 4001) {
        m.reconnecting = false;
        m.reconnectAttempts = 0;
        if (m.reconnectTimer) { clearTimeout(m.reconnectTimer); m.reconnectTimer = 0; }
        m.status = 'offline';
        updateConnUI();
        toast('该房间已在其他页面打开', 'err');
        clearMultiRoom();
        setMultiPane('lobby');
        return;
      }
      if (m.room && !m.leaving) {
        m.reconnecting = true;
        m.status = 'reconnecting';
        stopMpTimer();
        stopMpAudio();
        $$('#mgOptions button').forEach((b) => { b.disabled = true; });
        if (m.phase === 'question' || m.phase === 'playing') {
          showMgLoading('连接中断', '正在尝试重连…');
        }
        updateConnUI();
        toast('连接中断，正在重连…', 'err');
        scheduleMultiReconnect();
        return;
      }
      m.reconnecting = false;
      m.status = 'offline';
      updateConnUI();
      if (m.room || m.q) {
        clearMultiRoom();
        setMultiPane('lobby');
      } else {
        renderRoomList(m.rooms);
      }
    };
    ws.onerror = () => { /* close will follow */ };
  }

  function handleMultiMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    const m = state.multi;
    switch (msg.type) {
      case 'hello':
      case 'pong':
        return;
      case 'identified':
        m.status = 'online';
        updateConnUI();
        attemptPendingJoin();
        if (m.room && m.reconnecting) sendMulti('room:join', { code: m.room.code });
        return;
      case 'room:list':
        renderRoomList(Array.isArray(msg.rooms) ? msg.rooms : []);
        return;
      case 'room:joined':
        {
          const rejoined = Boolean(msg.rejoin) || m.reconnecting;
          m.you = msg.you;
          m.status = 'online';
          m.reconnecting = false;
          m.reconnectAttempts = 0;
          if (m.reconnectTimer) { clearTimeout(m.reconnectTimer); m.reconnectTimer = 0; }
          m.rejoinNotice = rejoined;
          updateConnUI();
          if (rejoined) toast('已重连 · 回到房间', 'ok');
          audio.sfx('start');
        }
        return;
      case 'room:state':
        handleRoomState(msg);
        return;
      case 'game:bet-phase':
        handleMultiBetPhase(msg);
        return;
      case 'game:resync':
        handleMultiResync(msg);
        return;
      case 'game:question':
        handleMultiQuestion(msg);
        return;
      case 'game:start':
        handleMultiStart(msg);
        return;
      case 'bet:ok':
        if (state.multi.betPhase?.qid === msg.qid) {
          state.multi.betPlaced = { ...msg, pending: false };
          state.multi.betChips = Number(msg.chips) || state.multi.betChips;
          renderMpBetStage();
          renderMpHpStrip(state.multi.room?.players || []);
        }
        return;
      case 'game:answered':
        return;
      case 'game:reveal':
        handleMultiReveal(msg);
        return;
      case 'game:over':
        handleMultiOver(msg);
        return;
      case 'room:kicked':
        handleMultiKicked(msg);
        return;
      case 'room:left':
        clearMultiRoom();
        if (state.view === 'multi') {
          setMultiPane('lobby');
          sendMulti('room:list');
        }
        return;
      case 'error':
        toast(msg.message || '联机操作失败', 'err');
        if (m.reconnecting) {
          m.reconnecting = false;
          m.reconnectAttempts = 0;
          if (m.reconnectTimer) { clearTimeout(m.reconnectTimer); m.reconnectTimer = 0; }
          clearMultiRoom();
          setMultiPane('lobby');
          clearRoomUrl();
          if (m.status === 'online') sendMulti('room:list');
        } else if (!m.room && !m.pendingCode) {
          clearRoomUrl();
        }
        return;
      default:
        return;
    }
  }

  function openMulti() {
    const m = state.multi;
    if (!m.settingsInit) {
      m.settings.count = [10, 20, 35, 50].includes(state.count) ? state.count : 10;
      m.settings.clip = [5, 15, 30].includes(state.clip) ? state.clip : 30;
      m.settings.isPublic = true;
      m.settings.mode = 'royale';
      m.settings.lives = 1;
      m.settingsInit = true;
    }
    audio.stop(80);
    mpAudioInstance().unlock();
    setView('multi');
    syncMpSettingsUI();
    updateConnUI();
    connectMulti();
    if (m.room) {
      if (m.room.phase === 'waiting') setMultiPane('room');
      else setMultiPane('game');
      renderRoom(m.room);
      renderMpScoreboard(m.room.players, m.lastReveal);
    } else {
      setMultiPane('lobby');
    }
    if (m.status === 'online' && !m.room) sendMulti('room:list');
    attemptPendingJoin();
  }

  function attemptPendingJoin() {
    const m = state.multi;
    if (!m.pendingCode || m.status !== 'online' || m.room) return;
    const code = m.pendingCode;
    m.pendingCode = null;
    joinMultiRoom(code);
  }

  function setMultiPane(pane) {
    state.multi.pane = pane;
    const lobby = $('#multiLobbyPane');
    const room = $('#multiRoomPane');
    const game = $('#multiGamePane');
    if (lobby) lobby.hidden = pane !== 'lobby';
    if (room) room.hidden = pane !== 'room';
    if (game) game.hidden = pane !== 'game';
    document.body.classList.toggle('is-multi-game', pane === 'game');
    if (pane === 'game') window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function clearMultiRoom() {
    const m = state.multi;
    if (m.reconnectTimer) { clearTimeout(m.reconnectTimer); m.reconnectTimer = 0; }
    m.reconnecting = false;
    m.reconnectAttempts = 0;
    m.rejoinNotice = false;
    m.betPhase = null;
    m.betPlaced = null;
    m.betOutcome = null;
    m.betDeadline = 0;
    hideBetStage();
    const linkInput = $('#roomLinkInput');
    if (linkInput) linkInput.value = '';
    clearRoomUrl();
    stopMpAudio();
    stopMpTimer();
    if (m.startTimer) { clearTimeout(m.startTimer); m.startTimer = 0; }
    m.room = null;
    m.you = null;
    m.q = null;
    m.phase = 'idle';
    m.prepared = false;
    m.readySent = false;
    m.preparePromise = null;
    m.answered = false;
    m.audioStarted = false;
    m.startAt = 0;
    m.deadline = 0;
    m.answerMs = 0;
    m.lastReveal = null;
    m.finalShown = false;
    const final = $('#mgFinal');
    if (final) final.hidden = true;
    const reveal = $('#mgReveal');
    if (reveal) reveal.hidden = true;
    const judge = $('#mgJudge');
    if (judge) { judge.hidden = true; judge.textContent = ''; }
    resetMpGameUI();
  }

  function multiBackToSolo() {
    const m = state.multi;
    if (m.room) {
      m.leaving = true;
      sendMulti('room:leave');
      clearMultiRoom();
      setMultiPane('lobby');
      m.leaving = false;
    }
    if (m.mpAudio) m.mpAudio.stop(120);
    setView('lobby');
  }

  function leaveMultiRoom() {
    const m = state.multi;
    m.leaving = true;
    if (m.room) sendMulti('room:leave');
    clearMultiRoom();
    setMultiPane('lobby');
    if (m.status === 'online') sendMulti('room:list');
    m.leaving = false;
  }

  function handleMultiKicked(msg) {
    const m = state.multi;
    const by = msg && msg.by ? `（${msg.by}）` : '';
    clearMultiRoom();
    setMultiPane('lobby');
    if (m.status === 'online') sendMulti('room:list');
    toast(`你已被房主移出房间${by}`, 'err');
    audio.sfx('miss');
  }

  function roomLibPool(settings) {
    const cats = new Set(Array.isArray(settings?.cats) ? settings.cats : CATS.map((c) => c.key));
    const versions = new Set(Array.isArray(settings?.versions) ? settings.versions : SONG_VERSIONS);
    const levels = new Set(Array.isArray(settings?.levels) ? settings.levels : SONG_LEVELS);
    if (settings?.version && settings.version !== 'all') versions.add(settings.version);
    if (settings?.level && settings.level !== 'all') levels.add(settings.level);
    return SONGS.filter((s) => cats.has(s.genre) && versions.has(s.version) && levels.has(s.level));
  }

  function openRoomLibrary() {
    const m = state.multi;
    const room = m.room;
    if (!room || room.hostId !== m.you || room.phase !== 'waiting') return;
    m.roomLib = {
      cats: new Set(Array.isArray(room.settings.cats) ? room.settings.cats : CATS.map((c) => c.key)),
      versions: new Set(Array.isArray(room.settings.versions) ? room.settings.versions : SONG_VERSIONS),
      levels: new Set(Array.isArray(room.settings.levels) ? room.settings.levels : SONG_LEVELS),
    };
    renderRoomLibrary();
    openModal('roomLibraryModal');
  }

  function setAllRoomLibVersions(all) {
    if (!state.multi.roomLib) return;
    state.multi.roomLib.versions = all ? new Set(SONG_VERSIONS) : new Set();
    renderRoomLibrary();
  }

  function invertRoomLibVersions() {
    if (!state.multi.roomLib) return;
    state.multi.roomLib.versions = new Set(SONG_VERSIONS.filter((v) => !state.multi.roomLib.versions.has(v)));
    renderRoomLibrary();
  }

  function setAllRoomLibLevels(all) {
    if (!state.multi.roomLib) return;
    state.multi.roomLib.levels = all ? new Set(SONG_LEVELS) : new Set();
    renderRoomLibrary();
  }

  function invertRoomLibLevels() {
    if (!state.multi.roomLib) return;
    state.multi.roomLib.levels = new Set(SONG_LEVELS.filter((lv) => !state.multi.roomLib.levels.has(lv)));
    renderRoomLibrary();
  }

  function renderRoomLibrary() {
    const m = state.multi;
    const draft = m.roomLib;
    if (!draft) return;

    const catsWrap = $('#roomLibCats');
    if (catsWrap) {
      catsWrap.innerHTML = '';
      const base = SONGS.filter((s) => draft.versions.has(s.version) && draft.levels.has(s.level));
      CATS.forEach((cat) => {
        const n = base.filter((s) => s.genre === cat.key).length;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'room-lib-cat';
        btn.style.setProperty('--cat', cat.color);
        if (draft.cats.has(cat.key)) btn.classList.add('is-on');
        if (!n) btn.classList.add('is-empty');
        const dot = document.createElement('i');
        const name = document.createElement('span');
        name.textContent = cat.name;
        const count = document.createElement('small');
        count.textContent = `${fmtInt(n)} 首`;
        btn.append(dot, name, count);
        btn.addEventListener('click', () => {
          if (draft.cats.has(cat.key)) draft.cats.delete(cat.key);
          else draft.cats.add(cat.key);
          renderRoomLibrary();
        });
        catsWrap.appendChild(btn);
      });
    }

    const versionWrap = $('#roomLibVersionChips');
    if (versionWrap) {
      versionWrap.innerHTML = '';
      const base = SONGS.filter((s) => draft.levels.has(s.level) && draft.cats.has(s.genre));
      SONG_VERSIONS.forEach((v) => {
        const n = base.filter((s) => s.version === v).length;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-chip';
        if (draft.versions.has(v)) btn.classList.add('is-on');
        if (!n) btn.classList.add('is-empty');
        btn.setAttribute('aria-pressed', String(draft.versions.has(v)));
        const label = document.createElement('span');
        label.textContent = v;
        const count = document.createElement('small');
        count.textContent = fmtInt(n);
        btn.append(label, count);
        btn.addEventListener('click', () => {
          if (draft.versions.has(v)) draft.versions.delete(v);
          else draft.versions.add(v);
          renderRoomLibrary();
        });
        versionWrap.appendChild(btn);
      });
    }

    const levelWrap = $('#roomLibLevelChips');
    if (levelWrap) {
      levelWrap.innerHTML = '';
      const base = SONGS.filter((s) => draft.versions.has(s.version) && draft.cats.has(s.genre));
      SONG_LEVELS.forEach((lv) => {
        const n = base.filter((s) => s.level === lv).length;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-chip';
        if (draft.levels.has(lv)) btn.classList.add('is-on');
        if (!n) btn.classList.add('is-empty');
        btn.setAttribute('aria-pressed', String(draft.levels.has(lv)));
        const label = document.createElement('span');
        label.textContent = lv;
        const count = document.createElement('small');
        count.textContent = fmtInt(n);
        btn.append(label, count);
        btn.addEventListener('click', () => {
          if (draft.levels.has(lv)) draft.levels.delete(lv);
          else draft.levels.add(lv);
          renderRoomLibrary();
        });
        levelWrap.appendChild(btn);
      });
    }

    const vSummary = $('#roomLibVersionSummary');
    if (vSummary) {
      vSummary.textContent = draft.versions.size === SONG_VERSIONS.length
        ? `全部 ${SONG_VERSIONS.length} 个版本`
        : `已选 ${draft.versions.size} / ${SONG_VERSIONS.length}`;
    }
    const lSummary = $('#roomLibLevelSummary');
    if (lSummary) {
      lSummary.textContent = draft.levels.size === SONG_LEVELS.length
        ? `全部 ${SONG_LEVELS.length} 个等级`
        : `已选 ${draft.levels.size} / ${SONG_LEVELS.length}`;
    }

    const pool = roomLibPool({ cats: [...draft.cats], versions: [...draft.versions], levels: [...draft.levels] });
    const poolEl = $('#roomLibPool');
    if (poolEl) {
      poolEl.textContent = pool.length >= 4
        ? `当前房间曲库：${fmtInt(pool.length)} 首可用 · ${draft.cats.size} 个分类 · ${draft.versions.size} 个版本 · ${draft.levels.size} 个等级`
        : `当前房间曲库只有 ${pool.length} 首，至少需要 4 首`;
      poolEl.classList.toggle('is-bad', pool.length < 4);
    }
    const save = $('#roomLibSave');
    if (save) save.disabled = pool.length < 4 || draft.cats.size === 0 || draft.versions.size === 0 || draft.levels.size === 0;
  }

  function saveRoomLibrary() {
    const m = state.multi;
    const draft = m.roomLib;
    if (!draft) return;
    const pool = roomLibPool({ cats: [...draft.cats], versions: [...draft.versions], levels: [...draft.levels] });
    if (pool.length < 4) { toast('曲库至少需要 4 首', 'err'); return; }
    const ok = sendMulti('room:settings', {
      settings: {
        cats: [...draft.cats],
        versions: [...draft.versions],
        levels: [...draft.levels],
      },
    });
    if (!ok) { toast('保存失败，请检查联机连接', 'err'); return; }
    closeModal('roomLibraryModal');
    audio.sfx('click');
    toast('房间曲库已更新', 'ok');
  }

  function updateMpPoolHint() {
    const hint = $('#mpPoolHint');
    if (!hint) return;
    const pool = selectedSongs();
    const cats = selectedCats();
    const bits = [];
    if (state.versions.size !== SONG_VERSIONS.length) bits.push(`版本 ${state.versions.size}/${SONG_VERSIONS.length}`);
    if (state.levels.size !== SONG_LEVELS.length) bits.push(`MASTER ${state.levels.size}/${SONG_LEVELS.length}`);
    hint.textContent = `曲库：${cats.length} 个分类${bits.length ? ` · ${bits.join(' / ')}` : ''} · ${fmtInt(pool.length)} 首${pool.length < 4 ? '（至少需要 4 首，请先在单人曲库中多选一些分类）' : ''}`;
    hint.style.color = pool.length < 4 ? 'var(--red)' : '';
  }

  function syncMpSettingsUI() {
    const m = state.multi;
    $$('#mpCountPills button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.mpCount) === m.settings.count));
    $$('#mpClipPills button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.mpClip) === m.settings.clip));
    $$('#mpVisibilityPills button').forEach((b) => b.classList.toggle('is-active', (b.dataset.mpPublic === '1') === m.settings.isPublic));
    $$('#mpModePills button').forEach((b) => b.classList.toggle('is-active', b.dataset.mpMode === m.settings.mode));
    $$('#mpLivesPills button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.mpLives) === m.settings.lives));
    const livesSetting = $('#mpLivesSetting');
    if (livesSetting) livesSetting.hidden = m.settings.mode !== 'royale';
    const countSetting = $('#mpCountSetting');
    if (countSetting) countSetting.hidden = m.settings.mode === 'royale';
    updateMpPoolHint();
  }

  function createMultiRoom() {
    const m = state.multi;
    if (m.status !== 'online') {
      toast('联机服务未连接，正在重试…', 'err');
      connectMulti(true);
      return;
    }
    if (selectedSongs().length < 4) { toast('曲库至少需要 4 首曲目', 'err'); return; }
    mpAudioInstance().unlock();
    const ok = sendMulti('room:create', {
      settings: {
        mode: m.settings.mode,
        lives: m.settings.lives,
        count: m.settings.count,
        clip: m.settings.clip,
        isPublic: m.settings.isPublic,
        cats: [...state.cats],
        versions: [...state.versions],
        levels: [...state.levels],
      },
    });
    if (!ok) toast('创建失败，请检查联机连接', 'err');
  }

  function joinMultiRoom(code) {
    const m = state.multi;
    const clean = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(clean)) { toast('请输入 4 位房间码', 'err'); return; }
    if (m.status !== 'online') {
      m.pendingCode = clean;
      toast('正在连接联机服务…');
      connectMulti(true);
      return;
    }
    mpAudioInstance().unlock();
    m.pendingCode = null;
    const ok = sendMulti('room:join', { code: clean });
    if (!ok) toast('加入失败，请检查联机连接', 'err');
  }

  function renderRoomList(rooms) {
    const m = state.multi;
    m.rooms = Array.isArray(rooms) ? rooms : [];
    const wrap = $('#roomList');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (m.status === 'connecting' || m.status === 'idle') {
      const div = document.createElement('div');
      div.className = 'room-empty';
      div.textContent = '正在连接联机服务…';
      wrap.appendChild(div);
      return;
    }
    if (m.status === 'offline') {
      const div = document.createElement('div');
      div.className = 'room-empty';
      div.textContent = '联机服务未连接。启动 node server.mjs 后点击「重新连接」。';
      wrap.appendChild(div);
      return;
    }
    if (!m.rooms.length) {
      const div = document.createElement('div');
      div.className = 'room-empty';
      div.textContent = '还没有公开房间。创建一个，把房间码发给朋友吧。';
      wrap.appendChild(div);
      return;
    }
    m.rooms.forEach((room) => {
      const row = document.createElement('div');
      row.className = 'room-item';
      const code = document.createElement('span');
      code.className = 'room-code-mini';
      code.textContent = room.code;
      const info = document.createElement('div');
      info.className = 'room-item-info';
      const host = document.createElement('strong');
      host.textContent = `${room.host || '—'} 的房间`;
      const meta = document.createElement('small');
      const modeText = room.mode === 'royale'
        ? `大逃杀 · ${room.lives || 1} 命 · 抽完为止`
        : room.mode === 'bet'
          ? `押注豪赌 · ${room.count} 题`
          : `常规积分 · ${room.count} 首`;
      meta.textContent = `${modeText} · ${room.poolSize || '—'} 首 · ${room.clip} 秒 · ${room.players}/${room.max} 人`;
      info.append(host, meta);
      const status = document.createElement('div');
      status.className = 'room-item-status';
      const phase = document.createElement('span');
      phase.textContent = MP_PHASE_LABEL[room.phase] || room.phase;
      if (room.phase === 'waiting') phase.classList.add('is-live');
      const join = document.createElement('button');
      join.type = 'button';
      join.className = 'btn btn-primary room-join-btn';
      join.textContent = room.phase === 'waiting' ? '加入' : '游戏中';
      join.disabled = room.phase !== 'waiting';
      if (room.phase === 'waiting') {
        join.addEventListener('click', () => joinMultiRoom(room.code));
      }
      status.append(phase, join);
      row.append(code, info, status);
      wrap.appendChild(row);
    });
  }

  function handleRoomState(msg) {
    const m = state.multi;
    const room = msg.room;
    if (!room) return;
    m.room = room;
    if (msg.you) m.you = msg.you;
    if (m.reconnecting) {
      m.reconnecting = false;
      m.reconnectAttempts = 0;
      if (m.reconnectTimer) { clearTimeout(m.reconnectTimer); m.reconnectTimer = 0; }
      m.rejoinNotice = true;
      updateConnUI();
    }
    const prev = m.phase;
    m.phase = room.phase;
    m.rejoinNotice = false;

    if (room.phase === 'waiting') {
      hideBetStage();
      m.betPhase = null;
      if (prev !== 'waiting') resetMpGameUI();
      m.finalShown = false;
      const final = $('#mgFinal');
      if (final) final.hidden = true;
      setMultiPane('room');
      renderRoom(room);
      renderMpScoreboard(room.players);
      updateMpTopFromRoom(room);
      return;
    }

    if (room.phase === 'starting') {
      hideBetStage();
      m.betPhase = null;
      if (prev !== 'starting') {
        resetMpGameUI();
        setMultiPane('game');
        showMgLoading('准备开局…', '第一位题目马上就来');
      } else {
        setMultiPane('game');
      }
      const final = $('#mgFinal');
      if (final) final.hidden = true;
      renderMpScoreboard(room.players);
      updateMpTopFromRoom(room);
      return;
    }

    if (room.phase === 'betting') {
      setMultiPane('game');
      const final = $('#mgFinal');
      if (final) final.hidden = true;
      renderMpScoreboard(room.players);
      updateMpTopFromRoom(room);
      if (m.betPhase) renderMpBetStage();
      return;
    }
    if (room.phase === 'finished') {
      hideBetStage();
      m.betPhase = null;
    }
    setMultiPane('game');
    const final = $('#mgFinal');
    if (final && !m.finalShown) final.hidden = true;
    renderMpScoreboard(room.players, m.lastReveal);
    updateMpTopFromRoom(room);
    if (room.phase === 'finished' && !m.finalShown) renderMgFinalFromRoom(room);
  }

  function renderRoom(room) {
    const m = state.multi;
    m.room = room;
    const codeEl = $('#roomCodeText');
    if (codeEl) codeEl.textContent = room.code || '----';
    const link = buildRoomLink(room.code);
    const linkInput = $('#roomLinkInput');
    if (linkInput) linkInput.value = link;
    syncRoomUrl(room.code);
    const settingsEl = $('#roomSettingsText');
    if (settingsEl) {
      const modeText = room.settings.mode === 'royale'
        ? `大逃杀 · ${room.settings.lives} 命 · 抽完为止`
        : room.settings.mode === 'bet'
          ? `押注豪赌 · ${room.settings.count} 题`
          : `常规积分 · ${room.settings.count} 首`;
      const pool = room.settings.poolSize ?? roomLibPool(room.settings).length;
      const libBits = [];
      if (Array.isArray(room.settings.versions) && room.settings.versions.length < SONG_VERSIONS.length) {
        libBits.push(`版本 ${room.settings.versions.length}/${SONG_VERSIONS.length}`);
      }
      if (Array.isArray(room.settings.levels) && room.settings.levels.length < SONG_LEVELS.length) {
        libBits.push(`MASTER ${room.settings.levels.length}/${SONG_LEVELS.length}`);
      }
      settingsEl.textContent = `${modeText} · ${pool} 首${libBits.length ? ` · ${libBits.join(' / ')}` : ''} · ${room.settings.clip} 秒 · ${room.settings.isPublic ? '公开' : '仅房间码'}`;
    }
    const phaseEl = $('#roomPhaseText');
    if (phaseEl) phaseEl.textContent = MP_PHASE_LABEL[room.phase] || room.phase;
    renderRoomPlayers(room);
    updateRoomControls(room);
  }

  function renderRoomPlayers(room) {
    const wrap = $('#roomPlayers');
    if (!wrap) return;
    wrap.innerHTML = '';
    const players = Array.isArray(room.players) ? room.players.slice(0, 8) : [];
    players.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'room-player';
      if (p.isHost) card.classList.add('is-host');
      if (p.id === state.multi.you) card.classList.add('is-you');
      if (p.connected === false) card.classList.add('is-offline');
      const av = document.createElement('span');
      av.className = 'avatar';
      av.textContent = avatarChar(p.cn);
      av.style.background = makeAvatarGradient();
      const info = document.createElement('div');
      info.className = 'room-player-info';
      const name = document.createElement('strong');
      name.textContent = p.cn;
      if (p.isHost) {
        const hostTag = document.createElement('span');
        hostTag.className = 'host-tag';
        hostTag.textContent = '房主';
        name.appendChild(hostTag);
      }
      const sub = document.createElement('small');
      const lifeText = room.settings.mode === 'royale'
        ? ` · ${p.eliminated ? '已淘汰' : `♥${p.lives ?? room.settings.lives}`}`
        : room.settings.mode === 'bet'
          ? ` · ${p.eliminated ? '已淘汰' : `${fmtInt(p.chips ?? 0)} 筹码`}`
          : '';
      sub.textContent = p.connected === false
        ? '掉线 · 重连中'
        : `${p.id === state.multi.you ? '你 · 已入房' : '玩家'}${lifeText}`;
      info.append(name, sub);
      const pill = document.createElement('span');
      pill.className = 'ready-pill';
      if (p.connected === false) {
        pill.textContent = '重连中';
        pill.classList.add('is-offline');
      } else if (p.isHost) {
        pill.textContent = '房主';
      } else if (p.ready) {
        pill.textContent = '已准备';
        pill.classList.add('is-ready');
      } else {
        pill.textContent = '未准备';
      }
      const side = document.createElement('div');
      side.className = 'room-player-side';
      side.appendChild(pill);
      if (room.hostId === state.multi.you && p.id !== state.multi.you) {
        const kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'room-kick-btn';
        kick.textContent = '踢出';
        kick.title = `将 ${p.cn} 移出房间`;
        kick.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!window.confirm(`确定将 ${p.cn} 移出房间？`)) return;
          if (!sendMulti('room:kick', { playerId: p.id })) toast('操作失败，请检查联机连接', 'err');
        });
        side.appendChild(kick);
      }
      card.append(av, info, side);
      wrap.appendChild(card);
    });
    for (let i = players.length; i < 8; i += 1) {
      const slot = document.createElement('div');
      slot.className = 'room-empty-slot';
      slot.textContent = '空位';
      wrap.appendChild(slot);
    }
  }

  function updateRoomControls(room) {
    const m = state.multi;
    const me = (room.players || []).find((p) => p.id === m.you);
    const isHost = room.hostId === m.you;
    const readyBtn = $('#readyToggleBtn');
    const startBtn = $('#startRoomBtn');
    const hint = $('#roomHint');
    const edit = $('#roomEdit');
    const waiting = room.phase === 'waiting';

    if (readyBtn) {
      readyBtn.hidden = isHost;
      readyBtn.disabled = !waiting;
      readyBtn.textContent = me && me.ready ? '取消准备' : '准备';
    }
    const roomPoolSize = room.settings.poolSize ?? roomLibPool(room.settings).length;
    const poolOk = roomPoolSize >= 4;
    const libBtn = $('#roomLibraryBtn');
    if (libBtn) libBtn.hidden = !(isHost && waiting);
    const visBtn = $('#roomVisibilityBtn');
    if (visBtn) {
      visBtn.hidden = !isHost;
      visBtn.textContent = room.settings.isPublic ? '设为私人' : '设为公开';
    }
    if (startBtn) {
      startBtn.hidden = !isHost;
      const others = (room.players || []).filter((p) => p.id !== room.hostId);
      const notReady = others.filter((p) => !p.ready);
      const canStart = waiting && room.players.length >= 2 && others.length > 0 && notReady.length === 0 && poolOk;
      startBtn.disabled = !canStart;
      startBtn.textContent = '开始游戏';
      if (hint) {
        if (!waiting) hint.textContent = '游戏进行中';
        else if (!poolOk) hint.textContent = `房间曲库只有 ${roomPoolSize} 首，请修改曲库`;
        else if (room.players.length < 2) hint.textContent = '至少需要 2 名玩家';
        else if (notReady.length) hint.textContent = `等待 ${notReady.length} 名玩家准备`;
        else hint.textContent = room.settings.mode === 'royale'
          ? '所有人已准备，可以开始 · 最后存活者获胜'
          : room.settings.mode === 'bet'
            ? '所有人已准备，可以开始 · 筹码最多者获胜'
            : '所有人已准备，可以开始';
      }
    } else if (hint) {
      if (!waiting) hint.textContent = '游戏进行中';
      else if (!me) hint.textContent = '连接中…';
      else if (me.ready) hint.textContent = '已准备，等待房主开始';
      else hint.textContent = '准备好了就点击准备';
    }
    if (edit) {
      edit.hidden = !(isHost && waiting);
      $$('#roomModePills button').forEach((b) => b.classList.toggle('is-active', b.dataset.roomMode === room.settings.mode));
      $$('#roomLivesPills button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.roomLives) === room.settings.lives));
      $$('#roomCountPills button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.roomCount) === room.settings.count));
      $$('#roomClipPills button').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.roomClip) === room.settings.clip));
      const livesRow = $('#roomLivesRow');
      if (livesRow) livesRow.hidden = room.settings.mode !== 'royale';
      const countRow = $('#roomCountRow');
      if (countRow) countRow.hidden = room.settings.mode === 'royale';
    }
  }

  function buildRoomLink(code) {
    try {
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('room', String(code || '').toUpperCase());
      return url.toString();
    } catch (_) {
      return String(code || '');
    }
  }

  function syncRoomUrl(code) {
    try {
      const url = new URL(location.href);
      if (url.searchParams.get('room') === code) return;
      url.searchParams.set('room', String(code || '').toUpperCase());
      history.replaceState(null, '', url);
    } catch (_) { /* ignore */ }
  }

  function clearRoomUrl() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has('room')) return;
      url.searchParams.delete('room');
      history.replaceState(null, '', url);
    } catch (_) { /* ignore */ }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  async function copyRoomLink() {
    const room = state.multi.room;
    if (!room) return;
    const link = buildRoomLink(room.code);
    const ok = await copyText(link);
    if (ok) {
      toast('房间链接已复制，发给朋友即可加入', 'ok');
    } else {
      const input = $('#roomLinkInput');
      if (input) { input.focus(); input.select(); }
      toast('复制失败，已选中链接，请手动复制', 'err');
    }
  }

  async function copyRoomInvite() {
    const room = state.multi.room;
    if (!room) return;
    const link = buildRoomLink(room.code);
    const ok = await copyText(`来舞萌听歌大作战，房间码 ${room.code}\n${link}`);
    if (ok) {
      toast(`已复制邀请 · 房间码 ${room.code}`, 'ok');
    } else {
      const input = $('#roomLinkInput');
      if (input) { input.focus(); input.select(); }
      toast(`房间码：${room.code} · 链接已选中，请手动复制`, 'info');
    }
  }

  function showMgLoading(title, sub) {
    const overlay = $('#mgLoading');
    if (!overlay) return;
    overlay.classList.remove('is-hidden', 'is-error');
    const strong = overlay.querySelector('strong');
    const small = overlay.querySelector('small');
    if (strong) strong.textContent = title;
    if (small) small.textContent = sub;
  }

  function hideMgLoading() {
    const overlay = $('#mgLoading');
    if (overlay) overlay.classList.add('is-hidden');
  }

  function updateMpEq(active) {
    const m = state.multi;
    if (!m.eqBars.length) return;
    const eq = $('#mgEq');
    if (eq) eq.classList.toggle('is-playing', Boolean(active));
    if (!active) {
      m.eqBars.forEach((b) => { b.style.height = '8%'; });
      return;
    }
    const spec = m.mpAudio ? m.mpAudio.spectrum() : null;
    m.eqBars.forEach((bar, i) => {
      let v;
      if (spec) {
        const idx = Math.min(spec.length - 1, Math.floor((i / m.eqBars.length) * spec.length * 0.72));
        v = Math.pow(spec[idx] / 255, 1.15);
      } else {
        v = 0.16 + Math.abs(Math.sin(performance.now() / 230 + i * 0.7)) * 0.52;
      }
      bar.style.height = `${Math.round(6 + v * 92)}%`;
    });
  }

  function initMpEq() {
    const eq = $('#mgEq');
    if (!eq) return;
    const m = state.multi;
    if (m.eqBars.length) return;
    eq.innerHTML = '';
    for (let i = 0; i < 28; i += 1) {
      const bar = document.createElement('i');
      bar.style.height = '8%';
      eq.appendChild(bar);
      m.eqBars.push(bar);
    }
  }

  function stopMpAudio() {
    const m = state.multi;
    m.audioStarted = false;
    if (m.mpAudio) {
      try { m.mpAudio.stop(120); } catch (_) { /* ignore */ }
    }
    updateMpEq(false);
  }

  function stopMpTimer() {
    const m = state.multi;
    if (m.timerRaf) cancelAnimationFrame(m.timerRaf);
    m.timerRaf = 0;
  }

  function resetMpGameUI() {
    const m = state.multi;
    stopMpAudio();
    stopMpTimer();
    if (m.startTimer) { clearTimeout(m.startTimer); m.startTimer = 0; }
    m.q = null;
    m.prepared = false;
    m.readySent = false;
    m.preparePromise = null;
    m.answered = false;
    m.audioStarted = false;
    m.startAt = 0;
    m.deadline = 0;
    m.answerMs = 0;
    m.lastReveal = null;
    const final = $('#mgFinal');
    if (final) final.hidden = true;
    const reveal = $('#mgReveal');
    if (reveal) reveal.hidden = true;
    const judge = $('#mgJudge');
    if (judge) { judge.hidden = true; judge.textContent = ''; }
    const options = $('#mgOptions');
    if (options) options.innerHTML = '';
    const cover = $('#mgCover');
    if (cover) concealCover(cover);
    const disc = $('#mgDisc');
    if (disc) disc.classList.remove('is-revealed', 'is-playing');
    const orbit = $('#mgOrbit');
    if (orbit) orbit.classList.remove('is-active');
    const loading = $('#mgLoading');
    if (loading) loading.classList.add('is-hidden');
    const ring = $('#mgRingProgress');
    if (ring) ring.style.strokeDashoffset = '0';
    const clipRing = $('#mgRingClip');
    if (clipRing) clipRing.style.strokeDashoffset = String(CIRC_CLIP);
    const timerRing = $('#mgTimerRing');
    if (timerRing) timerRing.classList.remove('is-low');
    const time = $('#mgTime');
    if (time) time.textContent = '--';
    const sec = $('#mgTimerSec');
    if (sec) sec.textContent = '--';
    const label = $('#mgTimerLabel');
    if (label) label.innerHTML = '<i class="dot-live"></i>等待开始';
    const title = $('#mgAnswerTitle');
    if (title) title.textContent = '准备听音…';
    const subEl = $('#mgAnswerSub');
    if (subEl) subEl.textContent = '所有玩家将同时开始。';
    updateMpEq(false);
  }

  function buildMgOptions(labels) {
    const wrap = $('#mgOptions');
    if (!wrap) return;
    wrap.innerHTML = '';
    labels.forEach((label, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-btn';
      btn.disabled = true;
      const num = document.createElement('span');
      num.className = 'option-num';
      num.textContent = String(i + 1);
      const title = document.createElement('span');
      title.className = 'option-title';
      title.textContent = label;
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      arrow.setAttribute('class', 'option-arrow');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-arrow');
      arrow.appendChild(use);
      btn.append(num, title, arrow);
      btn.addEventListener('click', () => mpAnswer(i));
      wrap.appendChild(btn);
    });
  }

  function handleMultiQuestion(msg) {
    if (state.view !== 'multi') return;
    const m = state.multi;
    if (!msg || !msg.song) return;
    m.q = msg;
    m.phase = 'question';
    m.prepared = false;
    m.readySent = false;
    m.preparePromise = null;
    m.answered = false;
    m.audioStarted = false;
    m.startAt = 0;
    m.deadline = 0;
    m.answerMs = msg.windowSec * 1000;
    m.lastReveal = null;
    m.finalShown = false;
    m.betTarget = null;
    m.betPlaced = null;
    m.betOutcome = null;
    m.betEnabled = false;
    m.betPhase = null;
    hideBetStage();
    const meBet = (m.room?.players || []).find((p) => p.id === m.you);
    m.betChips = Number(meBet?.chips ?? 1000);
    initMpEq();
    setMultiPane('game');
    const final = $('#mgFinal');
    if (final) final.hidden = true;
    const reveal = $('#mgReveal');
    if (reveal) reveal.hidden = true;
    const judge = $('#mgJudge');
    if (judge) { judge.hidden = true; judge.textContent = ''; }
    if (m.startTimer) { clearTimeout(m.startTimer); m.startTimer = 0; }

    const code = m.room?.code || '----';
    const mpMode = m.room?.settings?.mode || 'royale';
    const totalLabel = mpMode === 'royale' ? '∞' : String(msg.total || '?');
    $('#mgRoomCode').textContent = code;
    $('#mgIndex').textContent = String(msg.index || 1);
    $('#mgTotal').textContent = totalLabel;
    $('#mgHudIndex').textContent = String(msg.index || 1);
    $('#mgHudTotal').textContent = totalLabel;
    updateMpTopFromRoom(m.room);
    $('#mgClipInfo').textContent = `${msg.clipSec} 秒 · 全房同段`;
    $('#mgTime').textContent = '—';
    $('#mgTimerSec').textContent = '—';
    $('#mgTimerLabel').innerHTML = '<i class="dot-live"></i>准备中';
    $('#mgAnswerTitle').textContent = '准备听音…';
    $('#mgAnswerSub').textContent = '音频同步中，全房准备后开始。';
    $('#mgRingProgress').style.strokeDashoffset = '0';
    $('#mgRingClip').style.strokeDashoffset = String(CIRC_CLIP);
    $('#mgTimerRing').classList.remove('is-low');

    $('#mgTeaseRow').hidden = true;
    $('#mgGenre').textContent = 'MAIMAI DX';
    $('#mgGenre').style.setProperty('--cat', '#ff4f9a');
    $('#mgBpm').textContent = `${msg.song.bpm || '—'} BPM`;

    const cover = $('#mgCover');
    concealCover(cover);
    const disc = $('#mgDisc');
    disc.classList.remove('is-revealed', 'is-playing');
    const shade = $('#mgDiscShade');
    if (shade) shade.style.opacity = '';
    const orbit = $('#mgOrbit');
    if (orbit) orbit.classList.remove('is-active');
    updateMpEq(false);
    buildMgOptions(Array.isArray(msg.options) ? msg.options : []);
    showMgLoading('正在同步音频…', '所有玩家准备后开始');
    if (m.localEliminated) {
      $('#mgAnswerTitle').textContent = '你已淘汰 · 观战';
      $('#mgAnswerSub').textContent = '等待其他玩家决出最后生存者。';
      $('#mgLoading').querySelector('strong').textContent = '观战模式';
      $('#mgLoading').querySelector('small').textContent = '你仍可以收听本题音频';
    }

    const qid = msg.qid;
    const sendReady = () => {
      if (m.q?.qid !== qid || m.readySent) return;
      m.readySent = true;
      sendMulti('game:ready', { qid });
    };
    const mp = mpAudioInstance();
    mp.unlock();
    m.preparePromise = mp.prepare(msg.song, msg.clipSec, msg.startPct)
      .then(() => {
        if (m.q?.qid !== qid) return;
        m.prepared = true;
        sendReady();
        const overlay = $('#mgLoading');
        const small = overlay && overlay.querySelector('small');
        if (small && !overlay.classList.contains('is-hidden')) small.textContent = '音频已就绪，等待其他玩家…';
      })
      .catch(() => {
        if (m.q?.qid !== qid) return;
        sendReady();
        const overlay = $('#mgLoading');
        const small = overlay && overlay.querySelector('small');
        if (small) small.textContent = '音频加载较慢，仍然可以作答';
      });
    setTimeout(sendReady, 3800);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function handleMultiResync(msg) {
    if (state.view !== 'multi') return;
    const m = state.multi;
    if (!msg || !msg.song) return;
    const qid = msg.qid;
    const remaining = Math.max(0, Number(msg.remainingMs) || 0);
    const startIn = Math.max(0, Number(msg.startInMs) || 0);
    const elapsed = Math.max(0, Number(msg.elapsedMs) || 0);
    const offset = Math.max(0, Math.min(Number(msg.clipSec) || 0, elapsed / 1000));
    m.q = msg;
    m.phase = 'playing';
    m.prepared = false;
    m.readySent = true;
    m.preparePromise = null;
    m.answered = false;
    m.audioStarted = false;
    m.audioCallbacks = null;
    m.startAt = performance.now();
    m.deadline = performance.now() + remaining;
    m.answerMs = remaining;
    m.lastReveal = null;
    m.finalShown = false;
    m.betTarget = null;
    m.betPlaced = null;
    m.betOutcome = null;
    m.betEnabled = false;
    m.betPhase = null;
    hideBetStage();
    const me = (m.room?.players || []).find((p) => p.id === m.you);
    m.betChips = Number(me?.chips ?? m.betChips ?? 1000);
    m.localEliminated = Boolean(me && me.eliminated);

    initMpEq();
    setMultiPane('game');
    const final = $('#mgFinal');
    if (final) final.hidden = true;
    const reveal = $('#mgReveal');
    if (reveal) reveal.hidden = true;
    const judge = $('#mgJudge');
    if (judge) { judge.hidden = true; judge.textContent = ''; }
    if (m.startTimer) { clearTimeout(m.startTimer); m.startTimer = 0; }
    const mpMode = m.room?.settings?.mode || 'royale';
    const totalLabel = mpMode === 'royale' ? '∞' : String(msg.total || '?');
    $('#mgRoomCode').textContent = m.room?.code || '----';
    $('#mgIndex').textContent = String(msg.index || 1);
    $('#mgTotal').textContent = totalLabel;
    $('#mgHudIndex').textContent = String(msg.index || 1);
    $('#mgHudTotal').textContent = totalLabel;
    updateMpTopFromRoom(m.room);
    $('#mgClipInfo').textContent = `${msg.clipSec} 秒 · 全房同段`;
    $('#mgTime').textContent = (remaining / 1000).toFixed(1);
    $('#mgTimerSec').textContent = `${(remaining / 1000).toFixed(1)}s`;
    $('#mgTimerLabel').innerHTML = '<i class="dot-live"></i>重连同步';
    $('#mgRingProgress').style.strokeDashoffset = '0';
    $('#mgRingClip').style.strokeDashoffset = String(CIRC_CLIP);
    $('#mgTimerRing').classList.remove('is-low');
    $('#mgTeaseRow').hidden = true;
    $('#mgGenre').textContent = 'MAIMAI DX';
    $('#mgGenre').style.setProperty('--cat', '#ff4f9a');
    $('#mgBpm').textContent = `${msg.song.bpm || '—'} BPM`;
    concealCover($('#mgCover'));
    const disc = $('#mgDisc');
    disc.classList.remove('is-revealed', 'is-playing');
    const shade = $('#mgDiscShade');
    if (shade) shade.style.opacity = '';
    const orbit = $('#mgOrbit');
    if (orbit) orbit.classList.remove('is-active');
    updateMpEq(false);
    buildMgOptions(Array.isArray(msg.options) ? msg.options : []);
    showMgLoading('正在同步当前题…', `重连中 · 剩余 ${Math.ceil(remaining / 1000)} 秒`);
    $('#mgAnswerTitle').textContent = '重连 · 同步当前题';
    $('#mgAnswerSub').textContent = `剩余 ${Math.ceil(remaining / 1000)} 秒，跟着一起猜。`;
    if (m.localEliminated) {
      m.answered = true;
      $$('#mgOptions button').forEach((b) => { b.disabled = true; b.classList.add('is-dim'); });
      $('#mgAnswerTitle').textContent = '你已淘汰 · 观战';
      $('#mgAnswerSub').textContent = '本题仍在进行，等待其他玩家作答。';
    }

    const callbacks = {
      onStart: () => {
        if (m.q?.qid !== qid) return;
        m.audioStarted = true;
        $('#mgDisc').classList.add('is-playing');
        $('#mgOrbit').classList.add('is-active');
        $('#mgTimerLabel').innerHTML = '<i class="dot-live"></i>同步试听';
        updateMpEq(true);
      },
      onProgress: (info) => {
        if (m.q?.qid !== qid) return;
        const played = Math.max(0, Math.min(1, (info.currentTime - info.start) / Math.max(0.1, info.clipSec)));
        $('#mgRingClip').style.strokeDashoffset = String(CIRC_CLIP * (1 - played));
        updateMpEq(true);
      },
      onEnd: () => {
        if (m.q?.qid !== qid) return;
        $('#mgDisc').classList.remove('is-playing');
        $('#mgOrbit').classList.remove('is-active');
        if (!m.answered) $('#mgTimerLabel').innerHTML = '片段结束 · 继续作答';
        updateMpEq(false);
      },
      onError: () => {
        if (m.q?.qid !== qid) return;
        toast('音频同步失败，仍可继续作答', 'err');
        updateMpEq(false);
      },
    };
    m.audioCallbacks = callbacks;

    const startTimerNow = () => {
      if (m.q?.qid !== qid) return;
      startMpTimer(Math.max(1000, remaining));
      $('#mgTimerLabel').innerHTML = '<i class="dot-live"></i>同步试听';
      if (remaining <= 1000) {
        m.answered = true;
        $$('#mgOptions button').forEach((b) => { b.disabled = true; b.classList.add('is-dim'); });
        $('#mgAnswerTitle').textContent = '时间到';
      }
    };

    const mp = mpAudioInstance();
    mp.unlock();
    m.preparePromise = mp.prepare(msg.song, msg.clipSec, msg.startPct)
      .then(() => {
        if (m.q?.qid !== qid) return;
        m.prepared = true;
        hideMgLoading();
        if (!m.localEliminated) {
          $$('#mgOptions button').forEach((b) => { b.disabled = false; });
          $('#mgAnswerTitle').textContent = '重连 · 继续作答';
          $('#mgAnswerSub').textContent = `剩余 ${Math.ceil(remaining / 1000)} 秒，跟着一起猜。`;
        }
        mp.startPrepared(startIn, callbacks, offset).catch(() => {
          if (m.q?.qid === qid) toast('音频同步失败，仍可继续作答', 'err');
        });
        startTimerNow();
      })
      .catch(() => {
        if (m.q?.qid !== qid) return;
        m.prepared = true;
        hideMgLoading();
        if (!m.localEliminated) {
          $$('#mgOptions button').forEach((b) => { b.disabled = false; });
          $('#mgAnswerTitle').textContent = '重连 · 继续作答';
        }
        startTimerNow();
      });
    if (m.room?.settings?.mode === 'bet' && !m.localEliminated) {
      m.betEnabled = true;
      renderMpBetPanel();
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function handleMultiStart(msg) {
    const m = state.multi;
    if (!m.q || m.q.qid !== msg.qid) return;
    m.phase = 'playing';
    const startIn = Math.max(0, Number(msg.startInMs) || 0);
    const answerMs = Math.max(1000, Number(msg.answerMs) || m.q.windowSec * 1000);
    m.answerMs = answerMs;
    m.startAt = performance.now() + startIn;
    m.deadline = m.startAt + answerMs;
    m.answered = false;
    $('#mgTime').textContent = (answerMs / 1000).toFixed(1);
    $('#mgTimerSec').textContent = `${(answerMs / 1000).toFixed(1)}s`;
    $('#mgTimerLabel').innerHTML = '<i class="dot-live"></i>准备开始';

    const callbacks = {
      onStart: () => {
        if (m.q?.qid !== msg.qid) return;
        m.audioStarted = true;
        $('#mgDisc').classList.add('is-playing');
        $('#mgOrbit').classList.add('is-active');
        $('#mgTimerLabel').innerHTML = '<i class="dot-live"></i>同步试听';
        updateMpEq(true);
        if (!m.timerRaf && m.phase === 'playing') startMpTimer(answerMs);
      },
      onProgress: (info) => {
        if (m.q?.qid !== msg.qid) return;
        const played = Math.max(0, Math.min(1, (info.currentTime - info.start) / Math.max(0.1, info.clipSec)));
        $('#mgRingClip').style.strokeDashoffset = String(CIRC_CLIP * (1 - played));
        updateMpEq(true);
      },
      onEnd: () => {
        if (m.q?.qid !== msg.qid) return;
        $('#mgDisc').classList.remove('is-playing');
        $('#mgOrbit').classList.remove('is-active');
        if (!m.answered) $('#mgTimerLabel').innerHTML = '片段结束 · 继续作答';
        updateMpEq(false);
      },
      onError: (err) => {
        if (m.q?.qid !== msg.qid) return;
        if (err && err.code === 'blocked') {
          toast('点击任意处开启声音', 'err');
          if (!m.blockedRetry) {
            m.blockedRetry = true;
            const retry = () => {
              document.removeEventListener('pointerdown', retry, true);
              m.blockedRetry = false;
              if (!m.audioStarted && m.q?.qid === msg.qid) {
                mpAudioInstance().startPrepared(0, callbacks).catch(() => { /* ignore */ });
              }
            };
            document.addEventListener('pointerdown', retry, true);
          }
        } else {
          toast('音频播放失败，仍可作答', 'err');
        }
        if (!m.timerRaf && m.phase === 'playing') startMpTimer(answerMs);
      },
    };
    m.audioCallbacks = callbacks;

    if (m.startTimer) clearTimeout(m.startTimer);
    m.startTimer = setTimeout(() => {
      m.startTimer = 0;
      if (!m.q || m.q.qid !== msg.qid) return;
      hideMgLoading();
      const meNow = (m.room?.players || []).find((p) => p.id === m.you);
      const eliminated = m.localEliminated || Boolean(meNow && meNow.eliminated);
      m.localEliminated = eliminated;
      if (m.room?.settings?.mode === 'bet') {
        m.betEnabled = true;
        if (meNow && typeof meNow.chips === 'number') m.betChips = meNow.chips;
        renderMpBetPanel();
      }
      if (eliminated) {
        m.answered = true;
        $('#mgOptions').querySelectorAll('button').forEach((b) => { b.disabled = true; b.classList.add('is-dim'); });
        $('#mgAnswerTitle').textContent = '你已淘汰 · 观战';
        $('#mgAnswerSub').textContent = '本题仍在进行，等待其他玩家作答。';
      } else {
        $('#mgOptions').querySelectorAll('button').forEach((b) => { b.disabled = false; });
        $('#mgAnswerTitle').textContent = '听出是哪首歌了吗？';
        $('#mgAnswerSub').textContent = '全房同题 · 越快答对分越高';
      }
      $('#mgTimerLabel').innerHTML = '<i class="dot-live"></i>同步试听';
    }, startIn);

    const launchAudio = () => {
      if (!m.q || m.q.qid !== msg.qid) return;
      const delay = Math.max(0, m.startAt - performance.now());
      mpAudioInstance().startPrepared(delay, callbacks).catch(() => {
        if (m.q?.qid === msg.qid) toast('音频未就绪，可继续作答', 'err');
      });
    };
    Promise.resolve(m.preparePromise).catch(() => {}).then(launchAudio);
  }

  function startMpTimer(answerMs) {
    const m = state.multi;
    stopMpTimer();
    const total = Math.max(1, answerMs / 1000);
    const tick = () => {
      if (!m.q || m.answered && m.phase === 'reveal') return;
      const remain = Math.max(0, (m.deadline - performance.now()) / 1000);
      const ratio = clamp(remain / total, 0, 1);
      $('#mgRingProgress').style.strokeDashoffset = String(CIRC_TIMER * (1 - ratio));
      $('#mgTime').textContent = remain.toFixed(1);
      $('#mgTimerSec').textContent = `${remain.toFixed(1)}s`;
      $('#mgTimerRing').classList.toggle('is-low', remain < Math.min(6, total * 0.24));
      updateMpEq(Boolean(m.mpAudio && m.mpAudio.isPlaying));
      if (remain <= 0) {
        if (!m.answered) {
          m.answered = true;
          $('#mgOptions').querySelectorAll('button').forEach((b) => { b.disabled = true; b.classList.add('is-dim'); });
          $('#mgAnswerTitle').textContent = '时间到';
          $('#mgAnswerSub').textContent = '正在等待其他玩家…';
          $('#mgTimerLabel').textContent = '时间到';
        }
        updateMpEq(false);
        return;
      }
      m.timerRaf = requestAnimationFrame(tick);
    };
    m.timerRaf = requestAnimationFrame(tick);
  }

  function mpAnswer(index) {
    const m = state.multi;
    if (!m.q || m.answered || m.localEliminated) return;
    if (m.phase !== 'playing' && m.phase !== 'question') return;
    if (performance.now() < m.startAt - 60) return;
    if (performance.now() > m.deadline + 60) return;
    const ok = sendMulti('game:answer', { qid: m.q.qid, choice: index });
    if (!ok) { toast('提交失败，请检查连接', 'err'); return; }
    m.answered = true;
    const buttons = $('#mgOptions').querySelectorAll('button');
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === index) b.classList.add('is-selected');
      else b.classList.add('is-dim');
    });
    $('#mgAnswerTitle').textContent = '已提交';
    $('#mgAnswerSub').textContent = '等待其他玩家，公布答案…';
    $('#mgTimerLabel').textContent = '已提交';
    audio.sfx('click');
  }

  function showMgJudge(kind, text) {
    const el = $('#mgJudge');
    if (!el) return;
    el.hidden = false;
    el.className = `mg-judge ${kind === 'miss' ? 'is-miss' : kind === 'great' ? 'is-great' : ''}`.trim();
    el.textContent = text;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    setTimeout(() => { el.hidden = true; }, 1150);
  }

  function showBetStage() {
    const stage = $('#mgBetStage');
    if (stage) stage.hidden = false;
    const mgStage = $('#multiGamePane .mg-stage');
    if (mgStage) mgStage.hidden = true;
    const opts = $('#mgOptions');
    if (opts) opts.hidden = true;
    const reveal = $('#mgReveal');
    if (reveal) reveal.hidden = true;
    const judge = $('#mgJudge');
    if (judge) judge.hidden = true;
    hideMgLoading();
    const panel = $('#mgBetPanel');
    if (panel) panel.hidden = true;
  }

  function hideBetStage() {
    const stage = $('#mgBetStage');
    if (stage) stage.hidden = true;
    const m = state.multi;
    if (m.betCountdownTimer) {
      cancelAnimationFrame(m.betCountdownTimer);
      m.betCountdownTimer = 0;
    }
    const mgStage = $('#multiGamePane .mg-stage');
    if (mgStage) mgStage.hidden = false;
    const opts = $('#mgOptions');
    if (opts) opts.hidden = false;
  }

  function renderMpBetStage() {
    const m = state.multi;
    const msg = m.betPhase;
    const stage = $('#mgBetStage');
    if (!stage) return;
    if (!msg || m.phase !== 'betting') {
      stage.hidden = true;
      return;
    }
    stage.hidden = false;
    const me = (m.room?.players || []).find((p) => p.id === m.you);
    const chips = Math.max(0, Number(me?.chips ?? m.betChips ?? 0));
    m.betChips = chips;
    $('#mgBetStageChips').textContent = fmtInt(chips);
    $('#mgBetClueText').textContent = msg.clue?.value || '—';
    $('#mgBetClueTag').textContent = msg.clue?.type || '线索';
    $('#mgBetOdds').textContent = Number(msg.odds || 1.5).toFixed(1);
    [20, 50, 100].forEach((pct) => {
      const el = $(`#mgBet${pct}Amount`);
      if (el) el.textContent = fmtInt(Math.floor(chips * pct / 100));
    });
    const eliminated = Boolean(me?.eliminated) || Boolean(m.localEliminated);
    const placed = Boolean(me?.hasBet) || Boolean(m.betPlaced);
    const auto = Boolean(me?.betAuto) || Boolean(m.betPlaced?.auto);
    const locked = performance.now() >= m.betDeadline;
    $$('#mgBetChoices button').forEach((b) => { b.disabled = eliminated || placed || chips <= 0 || locked; });
    const hint = $('.mg-bet-hint');
    if (hint) {
      hint.textContent = eliminated
        ? '筹码耗尽 · 已淘汰，观战中'
        : placed
          ? (auto ? '已自动押注 20%，等待猜歌阶段' : '已押注，等待猜歌阶段')
          : '选择本题押注比例，确认后不可更改';
    }
  }

  function placeSelfBet(pct) {
    const m = state.multi;
    const phase = m.betPhase;
    if (!phase || m.phase !== 'betting') return;
    const me = (m.room?.players || []).find((p) => p.id === m.you);
    if (me?.hasBet || m.betPlaced) return;
    if ((m.betChips || 0) <= 0) { toast('没有筹码了', 'err'); return; }
    m.betPlaced = { pending: true, pct, amount: Math.max(1, Math.floor((m.betChips || 0) * pct / 100)) };
    renderMpBetStage();
    const qid = phase.qid;
    const ok = sendMulti('game:bet', { qid, pct });
    if (!ok) {
      m.betPlaced = null;
      renderMpBetStage();
      toast('押注失败，请检查联机连接', 'err');
      return;
    }
    setTimeout(() => {
      if (m.betPlaced?.pending && m.betPhase?.qid === qid) {
        m.betPlaced = null;
        renderMpBetStage();
      }
    }, 1800);
  }

  function handleMultiBetPhase(msg) {
    if (state.view !== 'multi') return;
    const m = state.multi;
    if (!msg || !msg.qid) return;
    const remaining = Math.max(0, Number(msg.remainingMs) || 0);
    m.betPhase = msg;
    m.phase = 'betting';
    m.q = { qid: msg.qid, index: msg.index, total: msg.total };
    m.answered = false;
    m.audioStarted = false;
    m.prepared = false;
    m.readySent = false;
    m.lastReveal = null;
    m.finalShown = false;
    m.betPlaced = null;
    m.betOutcome = null;
    m.betChosen = false;
    const me = (m.room?.players || []).find((p) => p.id === m.you);
    m.betChips = Number(me?.chips ?? m.betChips ?? 1000);
    m.localEliminated = Boolean(me && me.eliminated);
    m.betDeadline = performance.now() + remaining;
    if (m.betCountdownTimer) { cancelAnimationFrame(m.betCountdownTimer); m.betCountdownTimer = 0; }
    initMpEq();
    setMultiPane('game');
    const final = $('#mgFinal');
    if (final) final.hidden = true;
    const reveal = $('#mgReveal');
    if (reveal) reveal.hidden = true;
    const judge = $('#mgJudge');
    if (judge) { judge.hidden = true; judge.textContent = ''; }
    if (m.startTimer) { clearTimeout(m.startTimer); m.startTimer = 0; }
    $('#mgRoomCode').textContent = m.room?.code || '----';
    $('#mgIndex').textContent = String(msg.index || 1);
    $('#mgTotal').textContent = String(msg.total || '?');
    $('#mgHudIndex').textContent = String(msg.index || 1);
    $('#mgHudTotal').textContent = String(msg.total || '?');
    updateMpTopFromRoom(m.room);
    renderMpScoreboard(m.room?.players || []);
    showBetStage();
    $('#mgBetStageChips').textContent = fmtInt(m.betChips);
    $('#mgBetClueText').textContent = msg.clue?.value || '—';
    $('#mgBetClueTag').textContent = msg.clue?.type || '线索';
    $('#mgBetOdds').textContent = Number(msg.odds || 1.5).toFixed(1);
    $('#mgBetCountdown').textContent = `${(remaining / 1000).toFixed(1)}s`;
    renderMpBetStage();
    const qid = msg.qid;
    const tick = () => {
      if (m.phase !== 'betting' || m.betPhase?.qid !== qid) return;
      const remain = Math.max(0, (m.betDeadline - performance.now()) / 1000);
      const el = $('#mgBetCountdown');
      if (el) el.textContent = remain > 0 ? `${remain.toFixed(1)}s` : '已锁定';
      if (remain <= 0) {
        $$('#mgBetChoices button').forEach((b) => { b.disabled = true; });
        return;
      }
      m.betCountdownTimer = requestAnimationFrame(tick);
    };
    m.betCountdownTimer = requestAnimationFrame(tick);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function renderMpBetPanel() {
    const panel = $('#mgBetPanel');
    if (panel) panel.hidden = true;
    return;
    if (!panel) return;
    const m = state.multi;
    const mode = m.room?.settings?.mode;
    if (mode !== 'bet' || !m.q || m.phase === 'finished') {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    panel.classList.toggle('is-reveal', m.phase === 'reveal');
    const me = (m.room?.players || []).find((p) => p.id === m.you);
    const chips = Number(m.betChips ?? me?.chips ?? 0);
    const targetId = m.betPlaced?.targetId || m.betTarget;
    const target = (m.room?.players || []).find((p) => p.id === targetId);
    const pctLabel = m.betPlaced?.pending ? '提交中…' : m.betPlaced ? `已押 ${fmtInt(m.betPlaced.amount)}` : (m.betOutcome ? '本题已结算' : '未押注');
    $('#mgBetChips').textContent = `◆ ${fmtInt(chips)}`;
    $('#mgBetTarget').textContent = target ? `押 ${target.cn}` : '点上方方格选择押注对象';
    $('#mgBetAmount').textContent = pctLabel;
    const disabled = !m.betEnabled || Boolean(m.betPlaced) || Boolean(m.betOutcome) || !target || chips <= 0;
    $$('#mgBetActions button').forEach((b) => { b.disabled = disabled; });
    const note = $('#mgBetNote');
    if (note) {
      if (m.betOutcome) {
        note.textContent = `押注 ${m.betOutcome.targetCn} ${m.betOutcome.won ? '命中' : '未中'} · ${m.betOutcome.won ? '+' : '-'}${fmtInt(m.betOutcome.amount)} 筹码 · 当前 ${fmtInt(chips)}`;
        note.style.color = m.betOutcome.won ? '#8ef0ba' : '#ff9bb1';
      } else if (m.betPlaced) {
        note.textContent = `已押 ${fmtInt(m.betPlaced.amount || Math.floor(chips * (m.betPlaced.pct || 0) / 100))} 筹码 → ${target ? target.cn : '—'} · 等待本题结算`;
        note.style.color = '';
      } else if (target) {
        note.textContent = m.betEnabled ? `押 ${target.cn} 本题答对 · 1:1 赔率；押错扣筹码` : '音频开始后即可押注';
        note.style.color = '';
      } else {
        note.textContent = '点上方玩家方格选择押注对象';
        note.style.color = '';
      }
    }
  }

  function selectBetTarget(playerId) {
    const m = state.multi;
    if (m.room?.settings?.mode !== 'bet' || !m.q || m.betPlaced || m.betOutcome) return;
    if (m.phase !== 'question' && m.phase !== 'playing') return;
    if (!(m.room?.players || []).some((p) => p.id === playerId && p.connected !== false)) return;
    m.betTarget = playerId;
    audio.sfx('click');
    renderMpHpStrip(m.room.players);
    renderMpBetPanel();
  }

  function placeBet(pct) {
    const m = state.multi;
    if (m.room?.settings?.mode !== 'bet' || !m.q || !m.betEnabled) return;
    if (m.betPlaced || m.betOutcome) return;
    if (!m.betTarget) { toast('先点上方玩家方格选择押注对象', 'err'); return; }
    if ((m.betChips || 0) <= 0) { toast('没有筹码了', 'err'); return; }
    const target = (m.room?.players || []).find((p) => p.id === m.betTarget);
    if (!target) return;
    const qid = m.q.qid;
    m.betPlaced = { pending: true, targetId: target.id, targetCn: target.cn, pct };
    renderMpBetPanel();
    const ok = sendMulti('game:bet', { qid, targetId: target.id, pct });
    if (!ok) {
      m.betPlaced = null;
      renderMpBetPanel();
      toast('押注失败，请检查联机连接', 'err');
      return;
    }
    setTimeout(() => {
      if (m.betPlaced?.pending && m.q?.qid === qid) {
        m.betPlaced = null;
        renderMpBetPanel();
      }
    }, 1800);
  }

  function renderMpHpStrip(players, results) {
    const strip = $('#mgHpStrip');
    if (!strip) return;
    const m = state.multi;
    const mode = m.room?.settings?.mode;
    if (mode !== 'royale' && mode !== 'bet') {
      strip.hidden = true;
      strip.innerHTML = '';
      return;
    }
    const betMode = mode === 'bet';
    const list = Array.isArray(players) ? players.slice(0, 8) : [];
    const resultMap = new Map((results || []).map((r) => [r.id, r]));
    const maxLives = Math.max(1, Number(m.room?.settings?.lives) || 1);
    strip.hidden = false;
    strip.innerHTML = '';
    list.forEach((p) => {
      const merged = { ...p, ...(resultMap.get(p.id) || {}) };
      const tile = document.createElement('div');
      tile.className = 'mg-hp-tile';
      if (p.id === m.you) tile.classList.add('is-you');
      if (merged.eliminated) tile.classList.add('is-out');
      if (merged.connected === false) tile.classList.add('is-offline');
      if (betMode) tile.classList.add('is-bet');
      const av = document.createElement('span');
      av.className = 'mg-hp-avatar';
      av.textContent = avatarChar(p.cn);
      av.style.background = makeAvatarGradient();
      const top = document.createElement('span');
      top.className = 'mg-hp-top';
      const nameInfo = splitNameTag(p.cn);
      const name = document.createElement('strong');
      name.className = 'mg-hp-name';
      name.textContent = nameInfo.base;
      top.append(av, name);
      const pips = document.createElement('span');
      pips.className = 'mg-hp-pips';
      const lives = Math.max(0, Number(merged.lives) || 0);
      for (let i = 0; i < maxLives; i += 1) {
        const pip = document.createElement('i');
        pip.className = i < lives ? 'is-on' : 'is-off';
        pips.appendChild(pip);
      }
      if (merged.eliminated) {
        const out = document.createElement('em');
        out.className = 'mg-hp-out';
        out.textContent = 'OUT';
        pips.appendChild(out);
      }
      const bottom = document.createElement('span');
      bottom.className = 'mg-hp-bottom';
      const score = document.createElement('span');
      score.className = 'mg-hp-score';
      if (merged.eliminated) {
        score.textContent = 'OUT';
        score.classList.add('is-out');
      } else if (merged.connected === false) {
        score.textContent = '重连';
        score.classList.add('is-reconnect');
      } else if (betMode) {
        score.textContent = fmtInt(merged.chips ?? 1000);
      } else {
        score.textContent = fmtInt(merged.score || 0);
      }
      if (betMode) {
        if (!merged.eliminated && (m.room?.phase === 'betting' || merged.hasBet)) {
          const st = document.createElement('em');
          st.className = 'mg-bet-status';
          st.textContent = merged.hasBet ? (merged.betAuto ? '自动20%' : '已押') : '下注中';
          bottom.append(score, st);
        } else {
          bottom.append(score);
        }
      } else {
        bottom.append(pips, score);
      }
      if (nameInfo.tag) {
        const idLine = document.createElement('em');
        idLine.className = 'mg-hp-id';
        idLine.textContent = `#${nameInfo.tag}`;
        tile.append(top, idLine, bottom);
      } else {
        tile.append(top, bottom);
      }
      strip.appendChild(tile);
    });
  }

  function renderMpScoreboard(players, results) {
    const m = state.multi;
    const wrap = $('#mgScoreboard');
    if (!wrap) return;
    const mode = m.room?.settings?.mode || 'royale';
    const maxLives = m.room?.settings?.lives || 1;
    const betMode = mode === 'bet';
    const list = Array.isArray(players) ? players.slice() : [];
    const resultMap = new Map((results || []).map((r) => [r.id, r]));
    list.sort((a, b) => betMode
      ? (b.chips || 0) - (a.chips || 0) || (b.score || 0) - (a.score || 0)
      : (b.score || 0) - (a.score || 0) || (b.combo || 0) - (a.combo || 0));
    wrap.innerHTML = '';
    list.forEach((p, i) => {
      const li = document.createElement('li');
      const merged = { ...p, ...(resultMap.get(p.id) || {}) };
      if (p.id === m.you) li.classList.add('is-you');
      if (merged.eliminated) li.classList.add('is-eliminated');
      if (merged.connected === false) li.classList.add('is-offline');
      if (resultMap.has(p.id)) {
        if (merged.correct) li.classList.add('is-correct');
        else li.classList.add('is-wrong');
      }
      const rank = document.createElement('span');
      rank.className = 'mg-rank';
      rank.textContent = String(i + 1);
      const name = document.createElement('span');
      name.className = 'mg-player-name';
      name.textContent = p.cn;
      const score = document.createElement('span');
      score.className = 'mg-side-score';
      score.textContent = merged.connected === false ? '重连'
        : betMode ? fmtInt(merged.chips || 0) : fmtInt(merged.score || 0);
      li.append(rank, name, score);
      wrap.appendChild(li);
    });
    const me = list.find((p) => p.id === m.you);
    if (me) {
      $('#mgScore').textContent = fmtInt(me.score || 0);
      $('#mgCombo').textContent = String(me.combo || 0);
      const lives = Math.max(0, me.lives || 0);
      if (mode === 'royale') {
        $('#mgLives').textContent = me.eliminated ? 'OUT' : `${'♥'.repeat(lives)}${'♡'.repeat(Math.max(0, maxLives - lives))}`;
      }
    }
    const livesBox = $('#mgLivesBox');
    if (livesBox) livesBox.hidden = mode !== 'royale';
    if (betMode) {
      const me = list.find((p) => p.id === m.you);
      m.betChips = Number(me?.chips || 0);
    }
    const sideNote = $('#mgSideNote');
    if (sideNote) {
      sideNote.textContent = betMode
        ? '押注任意玩家本题答对 · 最终筹码最多者获胜'
        : '答得越快，速度分越高。房主可在结束后重开。';
    }
    $('#mgPlayersCount').textContent = `${list.length} / 8`;
    renderMpHpStrip(state.multi.room?.players || list, results);
    renderMpBetPanel();
  }

  function handleMultiReveal(msg) {
    const m = state.multi;
    if (!m.q || m.q.qid !== msg.qid) return;
    m.phase = 'reveal';
    hideBetStage();
    m.betPhase = null;
    stopMpTimer();
    stopMpAudio();
    if (m.startTimer) { clearTimeout(m.startTimer); m.startTimer = 0; }
    hideMgLoading();
    $('#mgDisc').classList.remove('is-playing');
    $('#mgOrbit').classList.remove('is-active');
    $('#mgTimerRing').classList.remove('is-low');
    $('#mgTime').textContent = '0.0';
    $('#mgTimerSec').textContent = '—';
    $('#mgTimerLabel').textContent = '本题结束';
    m.lastReveal = msg.players;

    const mine = (msg.players || []).find((p) => p.id === m.you) || { choice: -1, correct: false, points: 0, elapsed: null, score: 0, combo: 0, lives: 0, eliminated: false };
    m.localEliminated = Boolean(mine.eliminated);
    if (msg.mode === 'bet' || m.room?.settings?.mode === 'bet') {
      m.betEnabled = false;
      m.betChips = Number(mine.chips ?? m.betChips ?? 0);
      m.betOutcome = mine.bet || null;
      m.betPlaced = null;
      if (mine.bet) {
        const b = mine.bet;
        const delta = b.won ? (b.returned || 0) + (b.share || 0) : -(b.amount || 0);
        toast(`押注${b.won ? '命中' : '未中'} ${delta >= 0 ? '+' : ''}${fmtInt(delta)} 筹码`, b.won ? 'ok' : 'info');
      }
    }
    const maxLives = msg.lives || m.room?.settings?.lives || 1;
    if (msg.mode === 'royale' || m.room?.settings?.mode === 'royale') {
      $('#mgLivesBox').hidden = false;
      $('#mgLives').textContent = mine.eliminated
        ? 'OUT'
        : `${'♥'.repeat(Math.max(0, mine.lives || 0))}${'♡'.repeat(Math.max(0, maxLives - (mine.lives || 0)))}`;
    }
    const buttons = $('#mgOptions').querySelectorAll('button');
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === msg.correctIndex) btn.classList.add('is-correct');
      else if (i === mine.choice) btn.classList.add('is-wrong');
      else btn.classList.add('is-dim');
      if (i === mine.choice) btn.classList.add('is-selected');
    });

    const song = msg.song || m.q.song;
    const cat = catOf(song);
    $('#mgTeaseRow').hidden = false;
    $('#mgGenre').textContent = cat.name;
    $('#mgGenre').style.setProperty('--cat', cat.color);
    $('#mgBpm').textContent = `${song.bpm || '—'} BPM`;
    setCover($('#mgCover'), song);
    $('#mgCover').classList.remove('is-hidden');
    $('#mgCover').classList.add('is-revealed');
    $('#mgDisc').classList.add('is-revealed');
    updateMpEq(false);
    const skipped = Boolean(mine.skipped);
    const verdict = skipped
      ? 'SKIP'
      : mine.correct
        ? ((mine.elapsed != null && mine.elapsed / m.q.windowSec <= 0.55) ? 'PERFECT' : 'GREAT')
        : (mine.choice < 0 ? 'TIME UP' : 'MISS');
    showMgJudge(mine.correct ? 'perfect' : 'miss', skipped ? 'SKIP' : (mine.correct ? verdict : 'MISS'));
    audio.sfx(mine.correct ? 'perfect' : 'miss');

    const tag = $('#mgRevealTag');
    tag.className = 'reveal-tag';
    tag.textContent = verdict;
    if (skipped || !mine.correct) tag.classList.add(mine.choice < 0 || skipped ? 'is-timeout' : 'is-wrong');
    $('#mgRevealCover').onerror = () => { $('#mgRevealCover').onerror = null; $('#mgRevealCover').src = coverFallback(song); };
    $('#mgRevealCover').src = coverUrl(song);
    $('#mgRevealTitle').textContent = song.title;
    $('#mgRevealArtist').textContent = song.artist;
    const meta = $('#mgRevealMeta');
    meta.innerHTML = '';
    const bits = [
      ['分类', cat.name],
      ['BPM', song.bpm || '—'],
      [song.type + ' ' + song.chart, `${song.level}${song.ds ? ` · ${song.ds}` : ''}`],
      ['全房', `${msg.players?.length || 0} 人`],
    ];
    bits.forEach(([k, v]) => {
      const span = document.createElement('span');
      span.textContent = k + ' ';
      const b = document.createElement('b');
      b.textContent = v;
      span.appendChild(b);
      meta.appendChild(span);
    });
    const aliases = Array.isArray(song.aliases) ? song.aliases.slice(0, 3) : [];
    const aliasEl = $('#mgRevealAliases');
    if (aliasEl) aliasEl.textContent = aliases.length ? `别称：${aliases.join(' / ')}` : '';
    $('#mgRevealScore').textContent = mine.points > 0 ? `+${fmtInt(mine.points)}` : '0';
    $('#mgRevealScore').classList.toggle('is-zero', !mine.points);
    const nextIn = Math.max(0, Number(msg.nextInMs) || 0);
    const isLast = msg.index >= msg.total;
    $('#mgNextHint').textContent = isLast ? '正在结算…' : `${Math.ceil(nextIn / 1000)} 秒后下一题`;
    $('#mgReveal').hidden = false;
    $('#mgAnswerTitle').textContent = skipped
      ? '本题已跳过'
      : mine.eliminated
        ? '你被淘汰了'
        : mine.correct ? '答对了！' : '正确答案是…';
    $('#mgAnswerSub').textContent = skipped
      ? '断线重连期间错过本题，不扣命、不算错。'
      : mine.eliminated
        ? '观战中 · 等待最后生存者决出。'
        : mine.correct ? '保持这个节奏。' : '记住这段旋律，下一题还有机会。';
    renderMpScoreboard(msg.players, msg.players);
    $('#mgScore').textContent = fmtInt(mine.score || 0);
    $('#mgCombo').textContent = String(mine.combo || 0);
    setTimeout(() => {
      const strip = $('#mgReveal');
      if (strip && !strip.hidden) strip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }

  function handleMultiOver(msg) {
    const m = state.multi;
    m.phase = 'finished';
    hideBetStage();
    m.betPhase = null;
    stopMpTimer();
    stopMpAudio();
    if (m.startTimer) { clearTimeout(m.startTimer); m.startTimer = 0; }
    hideMgLoading();
    $('#mgOptions').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    renderMgFinal({
      players: Array.isArray(msg.players) ? msg.players : [],
      total: msg.total || m.room?.total || 0,
      clip: msg.clip || m.room?.settings?.clip || m.q?.clipSec || 30,
      mode: msg.mode || m.room?.settings?.mode || 'challenge',
      lives: msg.lives || m.room?.settings?.lives || 1,
      played: msg.played || m.room?.total || msg.total || 0,
    });
  }

  function normalizeFinalPlayer(p, i) {
    const answered = Number(p.answered) || 0;
    const correct = Number(p.correct) || 0;
    const rawAccuracy = Number(p.accuracy);
    const rawAvg = Number(p.avgTime);
    return {
      id: p.id,
      cn: p.cn || '—',
      rank: Number(p.rank) || i + 1,
      score: Number(p.score) || 0,
      correct,
      answered,
      accuracy: Number.isFinite(rawAccuracy) ? rawAccuracy : (answered ? Math.round((correct / answered) * 1000) / 10 : 0),
      avgTime: Number.isFinite(rawAvg) ? rawAvg : 0,
      maxCombo: Number(p.maxCombo) || 0,
      history: Array.isArray(p.history) ? p.history.map(Boolean) : [],
      connected: p.connected !== false,
      lives: Number(p.lives) || 0,
      eliminated: Boolean(p.eliminated),
      eliminatedAt: p.eliminatedAt == null ? null : Number(p.eliminatedAt),
      chips: Number(p.chips) || 0,
    };
  }

  function renderMgFinal(payload) {
    const m = state.multi;
    const list = $('#mgFinalList');
    if (!list) return;
    const rawPlayers = Array.isArray(payload.players) ? payload.players : [];
    const players = rawPlayers.map(normalizeFinalPlayer).sort((a, b) => a.rank - b.rank || b.score - a.score);
    const me = players.find((p) => p.id === m.you) || players[0] || null;
    const mode = payload.mode || m.room?.settings?.mode || 'challenge';
    const maxLives = payload.lives || m.room?.settings?.lives || 1;
    const played = payload.played || payload.total || 0;
    const betMode = mode === 'bet';
    const finalTitle = $('#mgFinalTitle');
    if (finalTitle) finalTitle.textContent = mode === 'royale' ? '大逃杀结束' : betMode ? '押注豪赌结束' : '本局结束';

    /* hero: 自己的成绩 */
    const hero = $('#mgFinalHero');
    if (hero) {
      hero.innerHTML = '';
      if (me) {
        const head = document.createElement('div');
        head.className = 'mf-hero-head';
        const kicker = document.createElement('span');
        kicker.textContent = 'YOUR RESULT';
        const modeLabel = document.createElement('b');
        modeLabel.textContent = mode === 'royale'
          ? `联机大逃杀 · ${maxLives} 命 · ${played} 题`
          : betMode
            ? `联机押注豪赌 · ${played} 题 · 起始 1,000`
            : `联机常规 · ${played} 题`;
        head.append(kicker, modeLabel);
        if (mode === 'royale' || betMode) {
          const survival = document.createElement('span');
          survival.className = 'mf-survival';
          survival.textContent = me.eliminated
            ? (betMode ? `筹码耗尽 · 第 ${me.eliminatedAt || '?'} 题出局` : `淘汰于第 ${me.eliminatedAt || '?'} 题`)
            : (betMode ? (me.rank === 1 ? '最后赢家' : `最终第 ${me.rank || '?'} 名`) : '最后生存');
          head.appendChild(survival);
        }

        const main = document.createElement('div');
        main.className = 'mf-hero-main';
        const correct = document.createElement('div');
        correct.className = 'mf-correct';
        const num = document.createElement('strong');
        num.textContent = betMode ? fmtInt(me.chips) : String(me.correct);
        const unit = document.createElement('span');
        unit.textContent = betMode ? '最终筹码' : '首答对';
        correct.append(num, unit);

        const stats = document.createElement('div');
        stats.className = 'mf-hero-stats';
        (betMode ? [
          ['答对', `${me.correct} 首`],
          ['准确率', `${Math.round(me.accuracy)}%`],
          ['最高连对', `${me.maxCombo} 连`],
        ] : [
          ['准确率', `${Math.round(me.accuracy)}%`],
          ['平均用时', `${me.avgTime.toFixed(2)}s`],
          ['最高连对', `${me.maxCombo} 连`],
        ]).forEach(([k, v]) => {
          const cell = document.createElement('div');
          const label = document.createElement('span');
          label.textContent = k;
          const value = document.createElement('b');
          value.textContent = v;
          cell.append(label, value);
          stats.appendChild(cell);
        });
        main.append(correct, stats);

        const dots = document.createElement('div');
        dots.className = 'mf-dots';
        const history = me.history.length
          ? me.history
          : [...Array(me.correct).fill(true), ...Array(Math.max(0, me.answered - me.correct)).fill(false)];
        history.forEach((ok) => {
          const dot = document.createElement('i');
          dot.className = ok ? 'ok' : 'bad';
          dots.appendChild(dot);
        });
        if (!history.length) dots.hidden = true;
        hero.append(head, main, dots);
      }
    }

    /* badges */
    const badges = $('#mgFinalBadges');
    if (badges) {
      badges.innerHTML = '';
      const answeredPlayers = players.filter((p) => p.answered > 0);
      if (answeredPlayers.length) {
        const fastest = answeredPlayers.filter((p) => p.avgTime > 0).sort((a, b) => a.avgTime - b.avgTime)[0];
        const streak = answeredPlayers.slice().sort((a, b) => b.maxCombo - a.maxCombo)[0];
        const accurate = answeredPlayers.slice().sort((a, b) => b.accuracy - a.accuracy)[0];
        const chipLeader = players.slice().sort((a, b) => b.chips - a.chips)[0];
        const badgesList = [];
        if (betMode && chipLeader) badgesList.push({ icon: '#i-trophy', label: '筹码王', name: chipLeader.cn, value: `${fmtInt(chipLeader.chips)}` });
        if (fastest) badgesList.push({ icon: '#i-spark', label: '最快手', name: fastest.cn, value: `${fastest.avgTime.toFixed(2)}s` });
        if (streak && streak.maxCombo > 0) badgesList.push({ icon: '#i-target', label: '连击王', name: streak.cn, value: `${streak.maxCombo} 连` });
        if (accurate) badgesList.push({ icon: '#i-target', label: '神准', name: accurate.cn, value: `${Math.round(accurate.accuracy)}%` });
        const chips = badgesList;
        chips.forEach((chip) => {
          const el = document.createElement('span');
          el.className = 'mf-badge';
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
          use.setAttribute('href', chip.icon);
          svg.appendChild(use);
          el.appendChild(svg);
          el.appendChild(document.createTextNode(`${chip.label} `));
          const name = document.createElement('b');
          name.textContent = chip.name;
          el.appendChild(name);
          el.appendChild(document.createTextNode(` ${chip.value}`));
          badges.appendChild(el);
        });
      }
    }

    /* ranking list */
    list.innerHTML = '';
    players.forEach((p) => {
      const li = document.createElement('li');
      if (p.id === m.you) li.classList.add('is-you');
      const rank = document.createElement('span');
      rank.className = 'mf-rank';
      rank.textContent = `#${p.rank}`;
      const info = document.createElement('div');
      info.className = 'mf-player';
      const name = document.createElement('div');
      name.className = 'mf-name';
      if (p.rank === 1) {
        const crown = document.createElement('span');
        crown.className = 'mf-crown';
        crown.textContent = '♛';
        name.appendChild(crown);
      }
      const nameText = document.createElement('span');
      nameText.textContent = p.cn;
      name.appendChild(nameText);
      if (p.id === m.you) {
        const you = document.createElement('em');
        you.textContent = '（你）';
        name.appendChild(you);
      }
      if (!p.connected) {
        const offline = document.createElement('span');
        offline.className = 'mf-offline';
        offline.textContent = '连接中断';
        name.appendChild(offline);
      }
      const stats = document.createElement('div');
      stats.className = 'mf-stats';
      const survivalText = mode === 'royale'
        ? (p.eliminated ? `淘汰于第 ${p.eliminatedAt || '?'} 题` : '最后生存')
        : betMode
          ? (p.eliminated ? `筹码耗尽 · 第 ${p.eliminatedAt || '?'} 题出局` : (p.rank === 1 ? '最后赢家' : `最终第 ${p.rank || '?'} 名`))
          : '';
      stats.textContent = `${survivalText ? `${survivalText} · ` : ''}答对 ${p.correct} 首 · 准确率 ${Math.round(p.accuracy)}% · 平均 ${p.avgTime.toFixed(2)}s`;
      info.append(name, stats);
      const score = document.createElement('span');
      score.className = 'mf-score';
      score.textContent = fmtInt(betMode ? p.chips : p.score);
      const small = document.createElement('small');
      small.textContent = betMode ? ' 筹码' : ' 分';
      score.appendChild(small);
      li.append(rank, info, score);
      list.appendChild(li);
    });

    const isHost = m.room && m.room.hostId === m.you;
    $('#mgFinalSub').textContent = mode === 'royale'
      ? `${players.length} 名玩家 · ${maxLives} 命 · ${played} 题${isHost ? '' : ' · 等待房主重开'}`
      : betMode
        ? `${players.length} 名玩家 · ${played} 题 · 起始 1,000 筹码${isHost ? '' : ' · 等待房主重开'}`
        : `${played} 题 · ${payload.clip || 30} 秒 · ${players.length} 名玩家${isHost ? '' : ' · 等待房主重开'}`;
    $('#mgResetBtn').hidden = !isHost;
    $('#mgResetBtn').disabled = false;
    $('#mgResetBtn').textContent = '再来一局';
    $('#mgFinal').hidden = false;
    m.finalShown = true;
  }

  function renderMgFinalFromRoom(room) {
    const players = (room.players || []).slice().sort((a, b) => room.settings.mode === 'bet'
      ? (b.chips || 0) - (a.chips || 0) || (b.score || 0) - (a.score || 0)
      : (b.score || 0) - (a.score || 0) || (b.correct || 0) - (a.correct || 0) || (b.maxCombo || 0) - (a.maxCombo || 0));
    renderMgFinal({
      players: players.map((p, i) => ({ ...p, rank: i + 1 })),
      total: room.total,
      clip: room.settings.clip,
      mode: room.settings.mode,
      lives: room.settings.lives,
      played: room.index || room.total,
    });
  }

  function updateMpTopFromRoom(room) {
    const m = state.multi;
    const mode = room.settings.mode || 'royale';
    $('#mgRoomCode').textContent = room.code || '----';
    $('#mgPlayersCount').textContent = `${(room.players || []).length} / 8`;
    const me = (room.players || []).find((p) => p.id === m.you);
    m.localEliminated = Boolean(me && me.eliminated);
    const livesBox = $('#mgLivesBox');
    if (livesBox) livesBox.hidden = mode !== 'royale';
    if (me) {
      $('#mgScore').textContent = fmtInt(me.score || 0);
      $('#mgCombo').textContent = String(me.combo || 0);
      if (mode === 'royale') {
        const maxLives = room.settings.lives || 1;
        const lives = Math.max(0, me.lives || 0);
        $('#mgLives').textContent = me.eliminated ? 'OUT' : `${'♥'.repeat(lives)}${'♡'.repeat(Math.max(0, maxLives - lives))}`;
      }
      if (mode === 'bet') m.betChips = Number(me.chips || 0);
    }
    const sideNote = $('#mgSideNote');
    if (sideNote) {
      sideNote.textContent = mode === 'bet'
        ? '押注任意玩家本题答对 · 最终筹码最多者获胜'
        : '答得越快，速度分越高。房主可在结束后重开。';
    }
    if (!m.q) {
      const totalLabel = mode === 'royale' ? '∞' : String(room.total || room.settings.count);
      $('#mgIndex').textContent = String(room.index || 0);
      $('#mgTotal').textContent = totalLabel;
      $('#mgHudIndex').textContent = String(room.index || 0);
      $('#mgHudTotal').textContent = totalLabel;
    }
    renderMpHpStrip(room.players || []);
    renderMpBetPanel();
  }

  function bindEvents() {
    $('#themeBtn').addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      savePrefs();
      audio.sfx('click');
    });
    $('#soundBtn').addEventListener('click', () => {
      state.sfx = !state.sfx;
      applySound();
      savePrefs();
      if (state.sfx) audio.sfx('click');
      toast(state.sfx ? '音效已开启' : '音效已关闭');
    });
    $('#cnChip').addEventListener('click', openProfile);
    $('#helpBtn').addEventListener('click', () => openModal('helpModal'));
    $('#brandHome').addEventListener('click', (e) => {
      e.preventDefault();
      if (state.view === 'game' || state.view === 'tourney') {
        openModal('exitModal');
      } else if (state.view === 'multi') {
        multiBackToSolo();
      } else {
        setView('lobby');
      }
    });

    $$('#modeGrid .mode-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.mode = btn.dataset.mode;
        savePrefs();
        updateModeUI();
        renderModes();
      });
    });
    $$('#countPills button').forEach((btn) => btn.addEventListener('click', () => {
      state.count = Number(btn.dataset.count);
      savePrefs();
      renderPills();
      updateModeUI();
    }));
    $$('#clipPills button').forEach((btn) => btn.addEventListener('click', () => {
      state.clip = Number(btn.dataset.clip);
      savePrefs();
      renderPills();
      updateModeUI();
    }));
    $$('#livesPills button').forEach((btn) => btn.addEventListener('click', () => {
      state.lives = Number(btn.dataset.lives);
      savePrefs();
      renderPills();
      updateModeUI();
    }));
    $$('#sizePills button').forEach((btn) => btn.addEventListener('click', () => {
      state.size = Number(btn.dataset.size);
      savePrefs();
      renderPills();
      updateModeUI();
    }));

    $('#selectAllBtn').addEventListener('click', () => { setAllCats(true); audio.sfx('click'); });
    $('#invertAllBtn').addEventListener('click', () => { invertCats(); audio.sfx('click'); });
    $('#versionAllBtn').addEventListener('click', () => { setAllVersions(true); audio.sfx('click'); });
    $('#versionInvertBtn').addEventListener('click', () => { invertVersions(); audio.sfx('click'); });
    $('#levelAllBtn').addEventListener('click', () => { setAllLevels(true); audio.sfx('click'); });
    $('#levelInvertBtn').addEventListener('click', () => { invertLevels(); audio.sfx('click'); });
    $('#resetFiltersBtn').addEventListener('click', () => { resetLibraryFilters(); audio.sfx('click'); });
    $('#startBtn').addEventListener('click', startFromLobby);
    $('#quickStartBtn').addEventListener('click', startFromLobby);

    $$('#boardModeTabs button').forEach((btn) => btn.addEventListener('click', () => {
      state.boardFilter.mode = btn.dataset.bmode;
      $$('#boardModeTabs button').forEach((b) => b.classList.toggle('is-active', b === btn));
      refreshBoard();
    }));
    $$('#boardClipTabs button').forEach((btn) => btn.addEventListener('click', () => {
      state.boardFilter.clip = btn.dataset.bclip;
      $$('#boardClipTabs button').forEach((b) => b.classList.toggle('is-active', b === btn));
      refreshBoard();
    }));
    $$('#boardScopeTabs button').forEach((btn) => btn.addEventListener('click', () => {
      state.boardFilter.scope = btn.dataset.bscope;
      $$('#boardScopeTabs button').forEach((b) => b.classList.toggle('is-active', b === btn));
      refreshBoard();
    }));
    $$('#boardSourceTabs button').forEach((btn) => btn.addEventListener('click', () => {
      if (btn.dataset.source === 'global') state.sourceChosen = true;
      selectBoardSource(btn.dataset.source);
    }));
    const miniLink = $('#miniBoardLink');
    if (miniLink) miniLink.addEventListener('click', () => {
      if (state.globalAvailable) selectBoardSource('global');
    });

    // multiplayer navigation & controls
    $$('[data-lobby-nav]').forEach((btn) => btn.addEventListener('click', () => {
      const nav = btn.dataset.lobbyNav;
      if (nav === 'multi') openMulti();
      else if (nav === 'board') {
        const el = $('#board');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        setView('lobby');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }));
    $('#multiBackBtn').addEventListener('click', multiBackToSolo);
    $('#multiReconnectBtn').addEventListener('click', () => connectMulti(true));
    $$('#mpCountPills button').forEach((btn) => btn.addEventListener('click', () => {
      state.multi.settings.count = Number(btn.dataset.mpCount);
      syncMpSettingsUI();
    }));
    $$('#mpClipPills button').forEach((btn) => btn.addEventListener('click', () => {
      state.multi.settings.clip = Number(btn.dataset.mpClip);
      syncMpSettingsUI();
    }));
    $$('#mpVisibilityPills button').forEach((btn) => btn.addEventListener('click', () => {
      state.multi.settings.isPublic = btn.dataset.mpPublic === '1';
      syncMpSettingsUI();
    }));
    $$('#mpModePills button').forEach((btn) => btn.addEventListener('click', () => {
      state.multi.settings.mode = btn.dataset.mpMode;
      syncMpSettingsUI();
    }));
    $$('#mpLivesPills button').forEach((btn) => btn.addEventListener('click', () => {
      state.multi.settings.lives = Number(btn.dataset.mpLives);
      syncMpSettingsUI();
    }));
    $('#createRoomBtn').addEventListener('click', createMultiRoom);
    $$('#mgBetActions button').forEach((btn) => btn.addEventListener('click', () => placeBet(Number(btn.dataset.betPct))));
    $$('#mgBetChoices button').forEach((btn) => btn.addEventListener('click', () => placeSelfBet(Number(btn.dataset.betSelf))));
    $('#roomVisibilityBtn').addEventListener('click', () => {
      const room = state.multi.room;
      if (!room || room.hostId !== state.multi.you) return;
      const next = !room.settings.isPublic;
      if (sendMulti('room:visibility', { isPublic: next })) {
        toast(next ? '房间已设为公开' : '房间已设为私人', 'ok');
        audio.sfx('click');
      }
    });
    $('#roomLibraryBtn').addEventListener('click', openRoomLibrary);
    $('#roomLibSave').addEventListener('click', saveRoomLibrary);
    $('#roomLibVersionAll').addEventListener('click', () => { setAllRoomLibVersions(true); audio.sfx('click'); });
    $('#roomLibVersionInvert').addEventListener('click', () => { invertRoomLibVersions(); audio.sfx('click'); });
    $('#roomLibLevelAll').addEventListener('click', () => { setAllRoomLibLevels(true); audio.sfx('click'); });
    $('#roomLibLevelInvert').addEventListener('click', () => { invertRoomLibLevels(); audio.sfx('click'); });
    $('#refreshRoomsBtn').addEventListener('click', () => {
      if (state.multi.status !== 'online') connectMulti(true);
      else sendMulti('room:list');
    });
    $('#joinCodeBtn').addEventListener('click', () => joinMultiRoom($('#joinCodeInput').value));
    $('#joinCodeInput').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });
    $('#joinCodeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinMultiRoom(e.target.value);
    });
    $('#copyRoomBtn').addEventListener('click', copyRoomInvite);
    $('#copyRoomLinkBtn').addEventListener('click', copyRoomLink);
    const resumeMulti = () => {
      if (document.hidden) return;
      const m = state.multi;
      if (!m.room || m.leaving) return;
      if (!m.ws || m.ws.readyState > 1) {
        if (m.reconnectTimer) { clearTimeout(m.reconnectTimer); m.reconnectTimer = 0; }
        m.reconnecting = true;
        m.reconnectAttempts = 0;
        m.status = 'reconnecting';
        updateConnUI();
        connectMulti(true);
      }
    };
    document.addEventListener('visibilitychange', resumeMulti);
    window.addEventListener('online', resumeMulti);
    $('#roomLinkInput').addEventListener('click', (e) => e.target.select());
    $('#leaveRoomBtn').addEventListener('click', leaveMultiRoom);
    $('#readyToggleBtn').addEventListener('click', () => {
      const room = state.multi.room;
      if (!room) return;
      const me = (room.players || []).find((p) => p.id === state.multi.you);
      sendMulti('room:ready', { ready: !(me && me.ready) });
    });
    $('#startRoomBtn').addEventListener('click', () => sendMulti('room:start'));
    $$('#roomCountPills button').forEach((btn) => btn.addEventListener('click', () => {
      const room = state.multi.room;
      if (!room || room.hostId !== state.multi.you) return;
      sendMulti('room:settings', { settings: { count: Number(btn.dataset.roomCount) } });
    }));
    $$('#roomModePills button').forEach((btn) => btn.addEventListener('click', () => {
      const room = state.multi.room;
      if (!room || room.hostId !== state.multi.you) return;
      sendMulti('room:settings', { settings: { mode: btn.dataset.roomMode } });
    }));
    $$('#roomLivesPills button').forEach((btn) => btn.addEventListener('click', () => {
      const room = state.multi.room;
      if (!room || room.hostId !== state.multi.you) return;
      sendMulti('room:settings', { settings: { lives: Number(btn.dataset.roomLives) } });
    }));
    $$('#roomClipPills button').forEach((btn) => btn.addEventListener('click', () => {
      const room = state.multi.room;
      if (!room || room.hostId !== state.multi.you) return;
      sendMulti('room:settings', { settings: { clip: Number(btn.dataset.roomClip) } });
    }));
    $('#mgQuitBtn').addEventListener('click', leaveMultiRoom);
    $('#mgLeaveBtn').addEventListener('click', leaveMultiRoom);
    $('#mgResetBtn').addEventListener('click', () => {
      const room = state.multi.room;
      if (!room || room.hostId !== state.multi.you) return;
      sendMulti('room:reset');
    });
    $('#clearBoardBtn').addEventListener('click', (e) => armClearButton(e.currentTarget, clearRecords));

    // profile
    $('#saveCnBtn').addEventListener('click', saveCN);
    $('#cnInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCN(); });
    $('#cnInput').addEventListener('input', () => {
      $('#profilePreviewName').textContent = $('#cnInput').value.trim() || '舞萌玩家';
      $('#profileAvatar').textContent = avatarChar($('#cnInput').value.trim() || '舞');
    });
    $('#profileClearBtn').addEventListener('click', (e) => armClearButton(e.currentTarget, clearRecords));

    // modals
    $$('[data-close]').forEach((el) => el.addEventListener('click', () => closeModal(el.dataset.close)));
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button, .mode-card, .genre-chip, .tabs button');
      if (!btn) return;
      if (e.target.closest('.game-card') || e.target.closest('.duel-wrap')) return;
      if (state.sfx) audio.sfx('click');
    });

    // game
    $('#quitBtn').addEventListener('click', () => openModal('exitModal'));
    $('#confirmExitBtn').addEventListener('click', () => {
      closeModal('exitModal');
      exitCurrent();
    });
    $('#replayBtn').addEventListener('click', replayCurrent);
    $('#nextBtn').addEventListener('click', advanceQuestion);

    // result
    $('#saveCardBtn').addEventListener('click', () => openShareCard('result'));
    $('#againBtn').addEventListener('click', () => {
      if (!state.result) return;
      const { mode, clip } = state.result;
      audio.stop(80);
      state.mode = mode;
      state.clip = clip;
      savePrefs();
      startFromLobby();
    });
    $('#backLobbyBtn').addEventListener('click', () => { audio.stop(120); setView('lobby'); });
    $('#retryWrongBtn').addEventListener('click', () => {
      const res = state.result;
      if (!res) return;
      const wrong = uniqueBy(res.reviews.filter((r) => !r.correct).map((r) => r.song), (s) => s.id);
      if (!wrong.length) return;
      state.clip = res.clip;
      launchGame({ songs: wrong, mode: 'challenge', practice: true });
    });

    // tournament
    $('#tourExitBtn').addEventListener('click', () => openModal('exitModal'));
    $('#duelPlayA').addEventListener('click', () => playDuel('a'));
    $('#duelPlayB').addEventListener('click', () => playDuel('b'));
    $('#duelPickA').addEventListener('click', () => pickDuel('a'));
    $('#duelPickB').addEventListener('click', () => pickDuel('b'));
    $('#honmeiShareBtn').addEventListener('click', () => openShareCard('honmei'));
    $('#tourAgainBtn').addEventListener('click', () => startTournament());
    $('#tourBackBtn').addEventListener('click', () => { audio.stop(100); setView('lobby'); });

    // share modal
    $('#downloadCardBtn').addEventListener('click', downloadShareCard);

    // global keyboard
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
      if (e.key === 'Escape') {
        if (state.openModal) { closeModal(state.openModal.id); return; }
        if (state.view === 'game') { openModal('exitModal'); return; }
        if (state.view === 'tourney') { openModal('exitModal'); return; }
        return;
      }
      if (typing || state.openModal) return;
      if (state.view === 'game' && state.game && state.game.phase === 'answering') {
        if (/^[1-4]$/.test(e.key)) {
          e.preventDefault();
          answer(Number(e.key) - 1);
        } else if (e.key.toLowerCase() === 'r') {
          e.preventDefault();
          replayCurrent();
        }
      }
    });

    // Eagerly unlock WebAudio on the first pointer interaction.
    document.addEventListener('pointerdown', () => { audio.unlock(); }, { once: true, capture: true });
    window.addEventListener('beforeunload', () => { try { audio.stop(0); } catch (_) { /* ignore */ } });
  }

  function exitCurrent() {
    if (state.view === 'game') {
      const g = state.game;
      if (g) {
        g.phase = 'done';
        cancelAnimationFrame(g.raf);
        clearTimeout(g.advanceTimer);
      }
      audio.stop(180);
      updateEq(false);
      state.game = null;
      setView('lobby');
      toast('已结束本局');
      return;
    }
    if (state.view === 'tourney') {
      exitTournament();
      return;
    }
    setView('lobby');
  }

  function init() {
    ensureClientId();
    loadPrefs();
    applyTheme();
    applySound();
    initLobby();
    bindEvents();
    setView('lobby');
    probeGlobal();
    try {
      const roomParam = new URL(location.href).searchParams.get('room');
      if (roomParam && /^[A-Za-z0-9]{4}$/.test(roomParam)) {
        state.multi.pendingCode = roomParam.toUpperCase();
        setTimeout(() => openMulti(), 400);
      }
    } catch (_) { /* ignore */ }
    if (location.hash === '#board') {
      setTimeout(() => { const el = $('#board'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 350);
    }
  }

  init();
})();
