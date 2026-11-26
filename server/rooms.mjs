/**
 * 舞萌听歌大作战 · 联机房间（WebSocket）
 * ------------------------------------------------------------
 * 房间状态保存在内存里；重启服务会清空房间。
 * 竞答规则由服务端计算（题目、正确项、得分），客户端只负责播放和展示。
 *
 * 之后迁移 Cloudflare：用 Durable Object 承载一个房间，WebSocket 协议不变；
 * 房间状态可以存 DO storage，曲库可以放 D1 / R2。
 */
import { WebSocketServer, WebSocket } from 'ws';

const MAX_PLAYERS = 8;
const MAX_ROOMS = 100;
const READY_WAIT_MS = 4000;
const START_DELAY_MS = 700;
const REVEAL_MS = 3400;
const ANSWER_GRACE_MS = 300;
const DISCONNECT_GRACE_MS = 300000;
const BET_PHASE_MS = 8000;
const BET_ODDS = 1.5;
const MAX_MESSAGES_PER_SEC = 30;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function answerWindow(clip) {
  if (clip <= 5) return 15;
  if (clip <= 15) return 22;
  return 37;
}

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function sanitizeCn(value) {
  const clean = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return clean || '舞萌玩家';
}

function sanitizeClientId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(id) ? id : null;
}

function publicSong(song) {
  if (!song) return null;
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    genre: song.genre,
    bpm: song.bpm,
    level: song.level,
    ds: song.ds,
    chart: song.chart,
    type: song.type,
    version: song.version,
    aliases: Array.isArray(song.aliases) ? song.aliases.slice(0, 4) : [],
  };
}

export function attachRealtime(server, catalog, { log = console.log } = {}) {
  const { songs, categories, catKeys } = catalog;
  const versions = new Set(songs.map((s) => s.version).filter(Boolean));
  const levels = new Set(songs.map((s) => s.level).filter(Boolean));
  const allCats = categories.map((c) => c.key);
  const rooms = new Map();
  const sockets = new Set();
  let playerSeq = 0;

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  /* ------------------------------ wire helpers ------------------------------ */
  function wsSend(ws, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(payload)); } catch { /* ignore */ }
  }

  function sendError(ws, message) {
    wsSend(ws, { type: 'error', message: String(message || '操作失败') });
  }

  function broadcastRoom(room, payload, exceptId = null) {
    for (const p of room.players.values()) {
      if (p.id === exceptId) continue;
      wsSend(p.ws, payload);
    }
  }

  function roomSummary(room) {
    const host = room.players.get(room.hostId);
    return {
      code: room.code,
      host: host ? host.cn : '—',
      players: room.players.size,
      max: MAX_PLAYERS,
      count: room.settings.count,
      clip: room.settings.clip,
      mode: room.settings.mode,
      lives: room.settings.lives,
      versions: room.settings.versions,
      levels: room.settings.levels,
      poolSize: roomPool(room).length,
      phase: room.phase,
      isPublic: room.settings.isPublic,
      createdAt: room.createdAt,
    };
  }

  function publicRooms() {
    return [...rooms.values()]
      .filter((r) => r.settings.isPublic && r.players.size > 0)
      .map(roomSummary)
      .sort((a, b) => {
        const rank = { waiting: 0, starting: 1, question: 2, playing: 2, reveal: 2, finished: 3 };
        const d = (rank[a.phase] ?? 9) - (rank[b.phase] ?? 9);
        return d !== 0 ? d : b.createdAt - a.createdAt;
      })
      .slice(0, 40);
  }

  function broadcastRoomList() {
    const message = { type: 'room:list', rooms: publicRooms() };
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN && ws.meta?.clientId) wsSend(ws, message);
    }
  }

  function roomView(room) {
    const players = [...room.players.values()].map((p) => ({
      id: p.id,
      cn: p.cn,
      ready: p.ready,
      connected: p.connected,
      isHost: p.id === room.hostId,
      score: p.score,
      combo: p.combo,
      maxCombo: p.maxCombo,
      correct: p.correct,
      answered: p.answered,
      accuracy: p.answered ? Math.round((p.correct / p.answered) * 1000) / 10 : 0,
      avgTime: p.answered ? Math.round(((p.totalTime || 0) / p.answered) * 10) / 10 : 0,
      history: (p.history || []).map((h) => Boolean(h.correct)),
      lives: p.lives || 0,
      eliminated: Boolean(p.eliminated),
      eliminatedAt: p.eliminatedAt || null,
      chips: p.chips || 0,
      hasBet: Boolean(p.bet),
      betPct: p.bet ? p.bet.pct : null,
      betAmount: p.bet ? p.bet.amount : 0,
      betAuto: Boolean(p.bet && p.bet.auto),
    }));
    let index = 0;
    if (room.phase === 'finished') index = room.questions.length;
    else if (room.current) index = room.current.q.index + 1;
    return {
      code: room.code,
      hostId: room.hostId,
      phase: room.phase,
      settings: {
        count: room.settings.count,
        clip: room.settings.clip,
        isPublic: room.settings.isPublic,
        cats: room.settings.cats,
        mode: room.settings.mode,
        lives: room.settings.lives,
        versions: room.settings.versions,
        levels: room.settings.levels,
        poolSize: roomPool(room).length,
      },
      players,
      index,
      total: room.questions.length || room.settings.count,
      createdAt: room.createdAt,
    };
  }

  function broadcastRoomState(room) {
    for (const p of room.players.values()) {
      wsSend(p.ws, { type: 'room:state', room: roomView(room), you: p.id });
    }
  }

  function sendCurrentQuestion(ws, room) {
    const current = room.current;
    if (!current || current.finished) return;
    if (room.phase === 'betting') {
      wsSend(ws, betPhasePayload(room, room.betDeadline - Date.now()));
      return;
    }
    const q = current.q;
    const base = {
      qid: current.qid,
      index: room.index + 1,
      total: room.questions.length,
      options: q.options,
      song: publicSong(q.song),
      clipSec: q.clipSec,
      windowSec: q.windowSec,
      startPct: q.startPct,
    };
    if (room.phase === 'question' && !current.started) {
      wsSend(ws, { type: 'game:question', ...base, readyMs: READY_WAIT_MS });
      return;
    }
    if (room.phase === 'playing' && current.started) {
      const now = Date.now();
      wsSend(ws, {
        type: 'game:resync',
        ...base,
        startInMs: Math.max(0, current.startAt - now),
        elapsedMs: Math.max(0, now - current.startAt),
        remainingMs: Math.max(0, current.deadline - now),
      });
    }
  }

  /* ------------------------------ room lifecycle ------------------------------ */
  function generateCode() {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      let code = '';
      for (let i = 0; i < 4; i += 1) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
    return null;
  }

  function validateSettings(input, previous) {
    const next = { ...(previous || {}) };
    if (input && typeof input === 'object') {
      if (['royale', 'challenge', 'bet'].includes(input.mode)) next.mode = input.mode;
      if ([1, 3].includes(Number(input.lives))) next.lives = Number(input.lives);
      if ([10, 20, 35, 50].includes(Number(input.count))) next.count = Number(input.count);
      if ([5, 15, 30].includes(Number(input.clip))) next.clip = Number(input.clip);
      if (typeof input.isPublic === 'boolean') next.isPublic = input.isPublic;
      if (Array.isArray(input.versions)) {
        next.versions = [...new Set(input.versions.filter((v) => versions.has(v)))];
      }
      if (Array.isArray(input.levels)) {
        next.levels = [...new Set(input.levels.filter((lv) => levels.has(lv)))];
      }
      if (Array.isArray(input.cats)) {
        const cats = [...new Set(input.cats.filter((k) => catKeys.has(k)))];
        if (cats.length) next.cats = cats;
      }
    }
    if (!['royale', 'challenge', 'bet'].includes(next.mode)) next.mode = 'royale';
    if (![1, 3].includes(next.lives)) next.lives = 1;
    if (![10, 20, 35, 50].includes(next.count)) next.count = 10;
    if (![5, 15, 30].includes(next.clip)) next.clip = 30;
    if (typeof next.isPublic !== 'boolean') next.isPublic = true;
    if (!Array.isArray(next.cats) || !next.cats.length) next.cats = allCats.slice();
    if (!Array.isArray(next.versions) || !next.versions.length) next.versions = [...versions];
    if (!Array.isArray(next.levels) || !next.levels.length) next.levels = [...levels];
    return next;
  }

  function roomPool(room) {
    const catSet = new Set(room.settings.cats);
    const versionSet = new Set(Array.isArray(room.settings.versions) && room.settings.versions.length
      ? room.settings.versions : versions);
    const levelSet = new Set(Array.isArray(room.settings.levels) && room.settings.levels.length
      ? room.settings.levels : levels);
    return songs.filter((s) => catSet.has(s.genre) && versionSet.has(s.version) && levelSet.has(s.level));
  }

  function buildQuestions(room) {
    const pool = roomPool(room);
    if (pool.length < 4) throw new Error('曲库不足，至少需要 4 首曲目');
    const total = room.settings.mode === 'royale' ? pool.length : Math.min(room.settings.count, pool.length);
    room.settings.count = total;
    const chosen = shuffle(pool).slice(0, total);
    return chosen.map((song, index) => {
      const used = new Set([norm(song.title)]);
      const same = shuffle(pool.filter((s) => s.genre === song.genre && s.id !== song.id && !used.has(norm(s.title))));
      const others = shuffle(pool.filter((s) => s.genre !== song.genre && s.id !== song.id && !used.has(norm(s.title))));
      const picks = [];
      const candidates = [...same.slice(0, 2), ...shuffle([...same.slice(2), ...others])];
      for (const s of candidates) {
        if (picks.length >= 3) break;
        const key = norm(s.title);
        if (used.has(key)) continue;
        used.add(key);
        picks.push(s);
      }
      if (picks.length < 3) {
        for (const s of shuffle(pool)) {
          if (picks.length >= 3) break;
          const key = norm(s.title);
          if (s.id === song.id || used.has(key)) continue;
          used.add(key);
          picks.push(s);
        }
      }
      const options = shuffle([song, ...picks]);
      return {
        id: `${room.code}-${index}-${Date.now().toString(36)}`,
        index,
        song,
        options: options.map((s) => s.title),
        correctIndex: options.findIndex((s) => s.id === song.id),
        clipSec: room.settings.clip,
        windowSec: answerWindow(room.settings.clip),
        startPct: 0.18 + Math.random() * 0.44,
      };
    });
  }

  function cleanupRoom(room) {
    if (room.startTimer) clearTimeout(room.startTimer);
    if (room.readyTimer) clearTimeout(room.readyTimer);
    if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
    if (room.earlyTimer) clearTimeout(room.earlyTimer);
    if (room.revealTimer) clearTimeout(room.revealTimer);
    if (room.betTimer) clearTimeout(room.betTimer);
    room.startTimer = null;
    room.betTimer = null;
    room.readyTimer = null;
    room.deadlineTimer = null;
    room.earlyTimer = null;
    room.revealTimer = null;
  }

  function deleteRoom(room) {
    cleanupRoom(room);
    for (const p of room.players.values()) {
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
      p.disconnectTimer = null;
    }
    rooms.delete(room.code);
  }

  function removePlayer(room, playerId, ws = null) {
    const player = room.players.get(playerId);
    if (!player) return;
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    room.players.delete(playerId);
    if (ws) wsSend(ws, { type: 'room:left' });
    if (!room.players.size) {
      deleteRoom(room);
      broadcastRoomList();
      return;
    }
    if (room.hostId === playerId) {
      const next = [...room.players.values()].find((p) => p.connected) || room.players.values().next().value;
      room.hostId = next.id;
    }
    broadcastRoomState(room);
    broadcastRoomList();
    maybeBeginQuestion(room);
    maybeFinishQuestion(room);
  }

  function handleLeave(ws, preserve = false) {
    const roomCode = ws.meta?.roomCode;
    const playerId = ws.meta?.playerId;
    if (!roomCode || !playerId) return;
    const room = rooms.get(roomCode);
    ws.meta.roomCode = null;
    ws.meta.playerId = null;
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player) return;
    if (preserve) {
      if (player.ws !== ws) return;
      player.ws = null;
      player.connected = false;
      player.disconnectedAt = Date.now();
      if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
      player.disconnectTimer = setTimeout(() => removePlayer(room, player.id), DISCONNECT_GRACE_MS);
      broadcastRoomState(room);
      broadcastRoomList();
      maybeBeginQuestion(room);
      maybeFinishQuestion(room);
      return;
    }
    removePlayer(room, player.id, ws);
  }

  function kickPlayer(room, target, by) {
    if (target.disconnectTimer) {
      clearTimeout(target.disconnectTimer);
      target.disconnectTimer = null;
    }
    const targetWs = target.ws;
    if (targetWs) {
      if (targetWs.meta) {
        targetWs.meta.roomCode = null;
        targetWs.meta.playerId = null;
      }
      wsSend(targetWs, { type: 'room:kicked', by: by.cn, room: room.code });
    }
    target.ws = null;
    room.players.delete(target.id);
    broadcastRoomState(room);
    broadcastRoomList();
    maybeBeginQuestion(room);
    maybeFinishQuestion(room);
    log(`[room] ${room.code} kick ${target.cn} by ${by.cn}`);
  }

  function startGame(room) {
    if (!room.players.size) return;
    const questions = buildQuestions(room);
    room.phase = 'starting';
    room.index = -1;
    room.current = null;
    room.questions = questions;
    for (const p of room.players.values()) {
      p.score = 0;
      p.combo = 0;
      p.maxCombo = 0;
      p.correct = 0;
      p.answered = 0;
      p.ready = false;
      p.history = [];
      p.totalTime = 0;
      p.lives = room.settings.mode === 'royale' ? room.settings.lives : 0;
      p.eliminated = false;
      p.eliminatedAt = null;
      p.chips = 1000;
      p.bet = null;
    }
    broadcastRoomState(room);
    broadcastRoomList();
    if (room.startTimer) clearTimeout(room.startTimer);
    room.startTimer = setTimeout(() => {
      room.startTimer = null;
      if (!rooms.has(room.code) || room.phase !== 'starting') return;
      room.index = -1;
      startQuestion(room);
    }, 600);
    log(`[room] ${room.code} start · ${room.settings.mode}/${room.settings.lives}命 · ${room.settings.count} songs · ${room.settings.clip}s · ${room.players.size}p`);
  }

  function startQuestion(room) {
    if (!rooms.has(room.code) || !room.players.size) return;
    if (room.settings.mode === 'bet') {
      for (const p of room.players.values()) p.bet = null;
    }
    if (room.settings.mode === 'royale' || room.settings.mode === 'bet') {
      const alive = [...room.players.values()].filter((p) => !p.eliminated);
      if (alive.length <= 1) { finishGame(room); return; }
    }
    room.index += 1;
    if (room.index >= room.questions.length) { finishGame(room); return; }
    const q = room.questions[room.index];
    room.current = {
      q,
      qid: q.id,
      ready: new Set(),
      answers: new Map(),
      started: false,
      finished: false,
      startAt: 0,
      deadline: 0,
    };
    if (room.settings.mode === 'bet') {
      startBetPhase(room);
      return;
    }
    startGuess(room);
  }

  function makeBetClue(song) {
    const cat = categories.find((c) => c.key === song.genre);
    const choices = [
      { type: '分类', value: cat ? cat.name : (song.genre || '未知分类') },
      { type: '版本', value: song.version || '未知版本' },
    ];
    if (Number(song.bpm) > 0) choices.push({ type: 'BPM', value: String(song.bpm) });
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function betPhasePayload(room, remainingMs) {
    const current = room.current;
    const q = current.q;
    return {
      type: 'game:bet-phase',
      qid: current.qid,
      index: room.index + 1,
      total: room.questions.length,
      remainingMs: Math.max(0, Number(remainingMs) || 0),
      betMs: BET_PHASE_MS,
      odds: BET_ODDS,
      clue: makeBetClue(q.song),
    };
  }

  function placeBetFor(player, pct, qid) {
    if (!player || player.eliminated) return false;
    if (player.bet && player.bet.qid === qid) return false;
    const chips = Math.max(0, Number(player.chips) || 0);
    if (chips <= 0) return false;
    const amount = Math.max(1, Math.floor(chips * pct / 100));
    player.chips = chips - amount;
    player.bet = { qid, pct, amount, auto: false };
    return true;
  }

  function autoPlaceBets(room) {
    const current = room.current;
    if (!current) return;
    for (const p of room.players.values()) {
      if (p.bet && p.bet.qid === current.qid) continue;
      if (placeBetFor(p, 20, current.qid)) p.bet.auto = true;
    }
    broadcastRoomState(room);
  }

  function startBetPhase(room) {
    if (!room.current) return;
    room.phase = 'betting';
    room.betDeadline = Date.now() + BET_PHASE_MS;
    broadcastRoom(room, betPhasePayload(room, BET_PHASE_MS));
    broadcastRoomState(room);
    if (room.betTimer) clearTimeout(room.betTimer);
    room.betTimer = setTimeout(() => {
      room.betTimer = null;
      if (!rooms.has(room.code) || !room.current) return;
      autoPlaceBets(room);
      startGuess(room);
    }, BET_PHASE_MS);
  }

  function startGuess(room) {
    const current = room.current;
    if (!current || current.finished) return;
    room.phase = 'question';
    const q = current.q;
    broadcastRoom(room, {
      type: 'game:question',
      qid: q.id,
      index: room.index + 1,
      total: room.questions.length,
      options: q.options,
      song: publicSong(q.song),
      clipSec: q.clipSec,
      windowSec: q.windowSec,
      startPct: q.startPct,
      readyMs: READY_WAIT_MS,
    });
    broadcastRoomState(room);
    if (room.readyTimer) clearTimeout(room.readyTimer);
    room.readyTimer = setTimeout(() => {
      room.readyTimer = null;
      if (room.current && !room.current.started) beginQuestion(room);
    }, READY_WAIT_MS);
  }

  function beginQuestion(room) {
    const current = room.current;
    if (!current || current.started || current.finished) return;
    if (room.readyTimer) { clearTimeout(room.readyTimer); room.readyTimer = null; }
    current.started = true;
    room.phase = 'playing';
    current.startAt = Date.now() + START_DELAY_MS;
    current.deadline = current.startAt + current.q.windowSec * 1000;
    broadcastRoom(room, {
      type: 'game:start',
      qid: current.qid,
      startInMs: START_DELAY_MS,
      answerMs: current.q.windowSec * 1000,
    });
    broadcastRoomState(room);
    if (room.deadlineTimer) clearTimeout(room.deadlineTimer);
    const wait = START_DELAY_MS + current.q.windowSec * 1000 + ANSWER_GRACE_MS;
    room.deadlineTimer = setTimeout(() => {
      room.deadlineTimer = null;
      finishQuestion(room);
    }, wait);
  }

  function maybeBeginQuestion(room) {
    const current = room.current;
    if (!current || current.started || current.finished || room.phase !== 'question') return;
    const connected = [...room.players.values()].filter((p) => !p.eliminated);
    if (!connected.length) return;
    if (connected.every((p) => current.ready.has(p.id))) beginQuestion(room);
  }

  function maybeFinishQuestion(room) {
    const current = room.current;
    if (!current || !current.started || current.finished || room.phase !== 'playing') return;
    const connected = [...room.players.values()].filter((p) => !p.eliminated);
    if (!connected.length) return;
    if (!connected.every((p) => current.answers.has(p.id))) return;
    if (room.earlyTimer) return;
    room.earlyTimer = setTimeout(() => {
      room.earlyTimer = null;
      finishQuestion(room);
    }, 600);
  }

  function finishQuestion(room) {
    const current = room.current;
    if (!current || current.finished) return;
    current.finished = true;
    room.phase = 'reveal';
    if (room.deadlineTimer) { clearTimeout(room.deadlineTimer); room.deadlineTimer = null; }
    if (room.readyTimer) { clearTimeout(room.readyTimer); room.readyTimer = null; }
    if (room.earlyTimer) { clearTimeout(room.earlyTimer); room.earlyTimer = null; }

    const q = current.q;
    const royale = room.settings.mode === 'royale';
    const results = [];
    for (const p of room.players.values()) {
      if (p.eliminated) {
        results.push({
          id: p.id, cn: p.cn, choice: -1, correct: false, points: 0,
          elapsed: null, score: p.score, combo: p.combo, connected: true,
          lives: p.lives || 0, eliminated: true,
          chips: p.chips || 0,
        });
        continue;
      }
      const ans = current.answers.get(p.id) || null;
      const elapsedRaw = ans ? clamp((ans.at - current.startAt) / 1000, 0, q.windowSec) : q.windowSec;
      const elapsed = Math.round(elapsedRaw * 10) / 10;
      const correct = Boolean(ans && ans.choice === q.correctIndex);
      let points = 0;
      p.answered += 1;
      if (correct) {
        p.correct += 1;
        const ratio = clamp(1 - elapsedRaw / q.windowSec, 0, 1);
        const speed = Math.round(500 * ratio);
        const comboBonus = Math.min(200, p.combo * 20);
        points = 500 + speed + comboBonus;
        p.combo += 1;
        p.maxCombo = Math.max(p.maxCombo, p.combo);
      } else {
        p.combo = 0;
        if (royale) {
          p.lives = Math.max(0, (p.lives || 0) - 1);
          if (p.lives === 0) {
            p.eliminated = true;
            p.eliminatedAt = room.index + 1;
          }
        }
      }
      p.score += points;
      p.totalTime = (p.totalTime || 0) + elapsedRaw;
      p.history = p.history || [];
      p.history.push({ correct, elapsed: elapsedRaw });
      results.push({
        id: p.id,
        cn: p.cn,
        choice: ans ? ans.choice : -1,
        correct,
        points,
        elapsed,
        score: p.score,
        combo: p.combo,
        connected: Boolean(p.connected),
        lives: p.lives || 0,
        eliminated: Boolean(p.eliminated),
      });
    }
    if (room.settings.mode === 'bet') {
      const resultById = new Map(results.map((r) => [r.id, r]));
      const bettors = [...room.players.values()].filter((p) => p.bet && p.bet.qid === current.qid);
      const winners = bettors.filter((p) => Boolean(resultById.get(p.id)?.correct));
      const losersPool = bettors
        .filter((p) => !resultById.get(p.id)?.correct)
        .reduce((sum, p) => sum + p.bet.amount, 0);
      const winnerStake = winners.reduce((sum, p) => sum + p.bet.amount, 0);
      for (const p of room.players.values()) {
        const r = resultById.get(p.id);
        if (!r) continue;
        const b = p.bet && p.bet.qid === current.qid ? p.bet : null;
        if (b) {
          const won = Boolean(r.correct);
          let returned = 0;
          let share = 0;
          if (won) {
            returned = Math.floor(b.amount * BET_ODDS);
            share = winnerStake > 0 ? Math.floor(losersPool * b.amount / winnerStake) : 0;
            p.chips = (p.chips || 0) + returned + share;
          }
          r.bet = {
            amount: b.amount,
            pct: b.pct,
            auto: Boolean(b.auto),
            won,
            returned,
            share,
          };
        } else {
          r.bet = null;
        }
        r.chips = p.chips || 0;
        p.bet = null;
        if (room.settings.mode === 'bet' && (p.chips || 0) <= 0 && !p.eliminated) {
          p.eliminated = true;
          p.eliminatedAt = room.index + 1;
        }
        r.eliminated = Boolean(p.eliminated);
      }
    }
    const alive = [...room.players.values()].filter((p) => !p.eliminated);
    const finalRoyale = royale && (alive.length <= 1 || room.index + 1 >= room.questions.length);

    broadcastRoom(room, {
      type: 'game:reveal',
      qid: current.qid,
      index: room.index + 1,
      total: room.questions.length,
      correctIndex: q.correctIndex,
      options: q.options,
      song: publicSong(q.song),
      players: results,
      nextInMs: REVEAL_MS,
      mode: room.settings.mode,
      lives: room.settings.lives,
    });
    broadcastRoomState(room);

    if (room.revealTimer) clearTimeout(room.revealTimer);
    room.revealTimer = setTimeout(() => {
      room.revealTimer = null;
      if (!rooms.has(room.code)) return;
      room.current = null;
      if (finalRoyale || room.index + 1 >= room.questions.length) finishGame(room);
      else startQuestion(room);
    }, REVEAL_MS);
  }

  function finishGame(room) {
    if (!rooms.has(room.code)) return;
    cleanupRoom(room);
    room.phase = 'finished';
    room.current = null;
    const royale = room.settings.mode === 'royale';
    const betMode = room.settings.mode === 'bet';
    const sorted = [...room.players.values()].sort((a, b) => {
      if (betMode) {
        return (b.chips || 0) - (a.chips || 0) || b.score - a.score || b.correct - a.correct;
      }
      if (royale) {
        const aAlive = a.connected && !a.eliminated;
        const bAlive = b.connected && !b.eliminated;
        if (aAlive !== bAlive) return aAlive ? -1 : 1;
        if (!aAlive) {
          const byTime = (b.eliminatedAt || 0) - (a.eliminatedAt || 0);
          if (byTime) return byTime;
        }
      }
      return b.score - a.score || b.correct - a.correct || b.maxCombo - a.maxCombo;
    });
    const players = sorted.map((p, i) => ({
      id: p.id,
      cn: p.cn,
      rank: i + 1,
      score: p.score,
      correct: p.correct,
      answered: p.answered,
      accuracy: p.answered ? Math.round((p.correct / p.answered) * 1000) / 10 : 0,
      avgTime: p.answered ? Math.round(((p.totalTime || 0) / p.answered) * 10) / 10 : 0,
      maxCombo: p.maxCombo,
      history: (p.history || []).map((h) => Boolean(h.correct)),
      connected: p.connected,
      lives: p.lives || 0,
      eliminated: Boolean(p.eliminated),
      eliminatedAt: p.eliminatedAt || null,
      chips: p.chips || 0,
      hasBet: Boolean(p.bet),
      betPct: p.bet ? p.bet.pct : null,
      betAmount: p.bet ? p.bet.amount : 0,
      betAuto: Boolean(p.bet && p.bet.auto),
    }));
    broadcastRoom(room, {
      type: 'game:over',
      players,
      total: room.questions.length,
      clip: room.settings.clip,
      mode: room.settings.mode,
      lives: room.settings.lives,
      played: room.index + 1,
    });
    broadcastRoomState(room);
    broadcastRoomList();
    log(`[room] ${room.code} finished · ${players.map((p) => `${p.cn}:${p.score}`).join(' / ')}`);
  }

  function resetRoom(room) {
    cleanupRoom(room);
    room.phase = 'waiting';
    room.current = null;
    room.questions = [];
    room.index = -1;
    for (const p of room.players.values()) {
      p.score = 0;
      p.combo = 0;
      p.maxCombo = 0;
      p.correct = 0;
      p.answered = 0;
      p.ready = false;
      p.history = [];
      p.totalTime = 0;
      p.lives = room.settings.mode === 'royale' ? room.settings.lives : 0;
      p.eliminated = false;
      p.eliminatedAt = null;
      p.chips = 1000;
      p.bet = null;
    }
    broadcastRoomState(room);
    broadcastRoomList();
  }

  function joinRoom(ws, room) {
    const clientId = ws.meta.clientId;
    const existing = [...room.players.values()].find((p) => p.clientId === clientId);
    if (existing) {
      if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = null;
      }
      if (existing.ws && existing.ws !== ws) {
        try {
          existing.ws.meta.roomCode = null;
          existing.ws.meta.playerId = null;
          existing.ws.close(4001, 'replaced');
        } catch (_) { /* ignore */ }
      }
      existing.ws = ws;
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.cn = ws.meta.cn || existing.cn;
      ws.meta.roomCode = room.code;
      ws.meta.playerId = existing.id;
      wsSend(ws, { type: 'room:joined', code: room.code, you: existing.id, rejoin: true });
      broadcastRoomState(room);
      sendCurrentQuestion(ws, room);
      broadcastRoomList();
      maybeBeginQuestion(room);
      maybeFinishQuestion(room);
      log(`[room] ${room.code} rejoin ${existing.cn} (${room.players.size}/${MAX_PLAYERS})`);
      return;
    }
    if (room.phase !== 'waiting') throw new Error('房间已经开始游戏');
    if (room.players.size >= MAX_PLAYERS) throw new Error('房间已满');
    const player = {
      id: `p${++playerSeq}`,
      clientId,
      cn: ws.meta.cn,
      ws,
      ready: false,
      connected: true,
      score: 0,
      combo: 0,
      maxCombo: 0,
      correct: 0,
      answered: 0,
      history: [],
      totalTime: 0,
      lives: room.settings.mode === 'royale' ? room.settings.lives : 0,
      eliminated: false,
      eliminatedAt: null,
      chips: 1000,
      bet: null,
      joinedAt: Date.now(),
    };
    room.players.set(player.id, player);
    ws.meta.roomCode = room.code;
    ws.meta.playerId = player.id;
    wsSend(ws, { type: 'room:joined', code: room.code, you: player.id });
    broadcastRoomState(room);
    broadcastRoomList();
    log(`[room] ${room.code} join ${player.cn} (${room.players.size}/${MAX_PLAYERS})`);
  }

  function requireRoom(ws) {
    const room = rooms.get(ws.meta.roomCode);
    if (!room) throw new Error('你不在房间中');
    const player = room.players.get(ws.meta.playerId);
    if (!player) throw new Error('你不在房间中');
    return { room, player };
  }

  function requireHost(room, player) {
    if (room.hostId !== player.id) throw new Error('只有房主可以操作');
  }

  /* ------------------------------ message handlers ------------------------------ */
  function handleMessage(ws, raw) {
    const now = Date.now();
    if (!ws.rate || now - ws.rate.at > 1000) ws.rate = { at: now, n: 0 };
    ws.rate.n += 1;
    if (ws.rate.n > MAX_MESSAGES_PER_SEC) return;

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { sendError(ws, '消息格式错误'); return; }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'identify': {
        const clientId = sanitizeClientId(msg.clientId);
        if (!clientId) { sendError(ws, 'clientId 无效'); return; }
        const cn = sanitizeCn(msg.cn);
        ws.meta.clientId = clientId;
        ws.meta.cn = cn;
        if (ws.meta.roomCode) {
          const room = rooms.get(ws.meta.roomCode);
          const player = room?.players.get(ws.meta.playerId);
          if (player) { player.cn = cn; broadcastRoomState(room); }
        }
        wsSend(ws, { type: 'identified', clientId, cn, serverTime: Date.now() });
        wsSend(ws, { type: 'room:list', rooms: publicRooms() });
        return;
      }
      case 'ping':
        wsSend(ws, { type: 'pong', t: msg.t, serverTime: Date.now() });
        return;
      case 'room:list':
        wsSend(ws, { type: 'room:list', rooms: publicRooms() });
        return;
      case 'room:create': {
        if (!ws.meta.clientId) throw new Error('请先连接');
        if (ws.meta.roomCode) throw new Error('请先离开当前房间');
        if (rooms.size >= MAX_ROOMS) throw new Error('房间数量已满，请稍后');
        const code = generateCode();
        if (!code) throw new Error('无法分配房间码');
        const settings = validateSettings(msg.settings || {}, null);
        const room = {
          code,
          hostId: null,
          players: new Map(),
          settings,
          phase: 'waiting',
          questions: [],
          index: -1,
          current: null,
          createdAt: Date.now(),
          startTimer: null,
          readyTimer: null,
          deadlineTimer: null,
          earlyTimer: null,
          revealTimer: null,
          betTimer: null,
          betDeadline: 0,
        };
        const player = {
          id: `p${++playerSeq}`,
          clientId: ws.meta.clientId,
          cn: ws.meta.cn || '舞萌玩家',
          ws,
          ready: false,
          connected: true,
          score: 0,
          combo: 0,
          maxCombo: 0,
          correct: 0,
          answered: 0,
          history: [],
          totalTime: 0,
          lives: room.settings.mode === 'royale' ? room.settings.lives : 0,
          eliminated: false,
          eliminatedAt: null,
          chips: 1000,
          bet: null,
          joinedAt: Date.now(),
        };
        room.hostId = player.id;
        room.players.set(player.id, player);
        rooms.set(code, room);
        ws.meta.roomCode = code;
        ws.meta.playerId = player.id;
        wsSend(ws, { type: 'room:joined', code, you: player.id });
        broadcastRoomState(room);
        broadcastRoomList();
        log(`[room] ${code} created by ${player.cn} · ${settings.count} songs · ${settings.clip}s`);
        return;
      }
      case 'room:join': {
        if (!ws.meta.clientId) throw new Error('请先连接');
        if (ws.meta.roomCode) throw new Error('请先离开当前房间');
        const code = String(msg.code || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) throw new Error('房间不存在');
        joinRoom(ws, room);
        return;
      }
      case 'room:leave':
        handleLeave(ws, false);
        return;
      case 'room:ready': {
        const { room, player } = requireRoom(ws);
        if (room.phase !== 'waiting') throw new Error('游戏已开始');
        player.ready = Boolean(msg.ready);
        broadcastRoomState(room);
        return;
      }
      case 'room:settings': {
        const { room, player } = requireRoom(ws);
        requireHost(room, player);
        if (room.phase !== 'waiting') throw new Error('房间已开始');
        room.settings = validateSettings(msg.settings || {}, room.settings);
        broadcastRoomState(room);
        broadcastRoomList();
        return;
      }
      case 'room:visibility': {
        const { room, player } = requireRoom(ws);
        requireHost(room, player);
        room.settings.isPublic = Boolean(msg.isPublic);
        broadcastRoomState(room);
        broadcastRoomList();
        return;
      }
      case 'room:kick': {
        const { room, player } = requireRoom(ws);
        requireHost(room, player);
        const target = room.players.get(String(msg.playerId || ''));
        if (!target) throw new Error('玩家已不在房间');
        if (target.id === player.id) throw new Error('不能移出自己');
        kickPlayer(room, target, player);
        return;
      }
      case 'room:start': {
        const { room, player } = requireRoom(ws);
        requireHost(room, player);
        if (room.phase !== 'waiting') throw new Error('房间已开始');
        const connected = [...room.players.values()].filter((p) => p.connected);
        if (connected.length < 2) throw new Error('至少需要 2 名玩家');
        const waiting = connected.filter((p) => p.id !== room.hostId && !p.ready);
        if (waiting.length) throw new Error('还有玩家没有准备');
        startGame(room);
        return;
      }
      case 'game:ready': {
        const { room, player } = requireRoom(ws);
        if (player.eliminated) return;
        const current = room.current;
        if (!current || room.phase !== 'question' || current.qid !== msg.qid || current.started) return;
        current.ready.add(player.id);
        player.ready = true;
        broadcastRoomState(room);
        maybeBeginQuestion(room);
        return;
      }
      case 'game:answer': {
        const { room, player } = requireRoom(ws);
        if (player.eliminated) throw new Error('你已淘汰，只能观战');
        const current = room.current;
        if (!current || room.phase !== 'playing' || current.qid !== msg.qid) throw new Error('本题已结束');
        if (!current.started) throw new Error('还没开始');
        if (Date.now() < current.startAt - 50) throw new Error('还没开始');
        if (Date.now() > current.deadline + ANSWER_GRACE_MS) throw new Error('答题时间已结束');
        const choice = Number(msg.choice);
        if (!Number.isInteger(choice) || choice < 0 || choice > 3) throw new Error('选项无效');
        if (current.answers.has(player.id)) return;
        current.answers.set(player.id, { choice, at: Date.now() });
        wsSend(ws, { type: 'game:answered', qid: current.qid, choice });
        maybeFinishQuestion(room);
        return;
      }
      case 'game:bet': {
        const { room, player } = requireRoom(ws);
        if (room.settings.mode !== 'bet') throw new Error('当前不是押注模式');
        if (room.phase !== 'betting') throw new Error('现在不是下注阶段');
        const current = room.current;
        if (!current || current.finished || current.qid !== msg.qid) throw new Error('本题已结束');
        const pct = [20, 50, 100].includes(Number(msg.pct)) ? Number(msg.pct) : 0;
        if (!pct) throw new Error('押注比例无效');
        if (player.bet && player.bet.qid === current.qid) throw new Error('本题已押注');
        if ((player.chips || 0) <= 0) throw new Error('筹码不足');
        if (!placeBetFor(player, pct, current.qid)) throw new Error('押注失败');
        broadcastRoomState(room);
        wsSend(ws, {
          type: 'bet:ok',
          qid: current.qid,
          amount: player.bet.amount,
          pct: player.bet.pct,
          chips: player.chips,
          auto: false,
        });
        return;
      }
      case 'room:reset': {
        const { room, player } = requireRoom(ws);
        requireHost(room, player);
        if (room.phase !== 'finished') throw new Error('当前不能重开');
        resetRoom(room);
        return;
      }
      default:
        sendError(ws, '未知操作');
    }
  }

  /* ------------------------------ connection ------------------------------ */
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.meta = { clientId: null, cn: null, roomCode: null, playerId: null };
    sockets.add(ws);
    wsSend(ws, { type: 'hello', serverTime: Date.now() });
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      try { handleMessage(ws, raw); }
      catch (err) { sendError(ws, err.message || '操作失败'); }
    });
    ws.on('close', () => {
      try { handleLeave(ws, true); } catch { /* ignore */ }
      sockets.delete(ws);
    });
    ws.on('error', () => { /* handled by close */ });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  log(`[ws] multiplayer ready · ${songs.length} songs · max ${MAX_PLAYERS} players / room`);
  return wss;
}
