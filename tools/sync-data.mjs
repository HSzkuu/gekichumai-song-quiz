#!/usr/bin/env node
/**
 * 从 LXNS 公共 API 同步舞萌 DX 曲库，生成 assets/js/data.js
 *
 *   node tools/sync-data.mjs
 *
 * 曲目音频、曲绘使用 LXNS 的游戏资源 CDN（支持 Range / CORS）：
 *   https://assets2.lxns.net/maimai/music/{id}.mp3
 *   https://assets2.lxns.net/maimai/jacket/{id}.png
 *
 * 宴会場（utage）谱面没有独立音源，仍会写入数据但标记 playable:false，
 * 避免听歌题出现“同一段音频、不同曲名”的情况。
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const API = 'https://maimai.lxns.net/api/v0/maimai';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/js/data.js');

const GENRES = {
  maimai: { key: 'mai', name: '舞萌原创', short: '原创', color: '#ff4f9a' },
  niconicoボーカロイド: { key: 'vocaloid', name: 'niconico & VOCALOID', short: 'VOCALOID', color: '#2ec4f1' },
  東方Project: { key: 'touhou', name: '东方Project', short: '东方', color: '#a06bff' },
  ゲームバラエティ: { key: 'game', name: '其他游戏', short: '其他游戏', color: '#2ec980' },
  オンゲキCHUNITHM: { key: 'gekichu', name: '音击 / 中二节奏', short: '音击&中二', color: '#ff9f2e' },
  POPSアニメ: { key: 'pops', name: '流行 & 动漫', short: '流行&动漫', color: '#4f7cff' },
  宴会場: { key: 'utage', name: '宴会場', short: '宴会場', color: '#ffcf3f' },
};

const CHART_NAMES = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'Re:MASTER'];

/** 把 15007 / 20105 / 25502 这类小版本归并成展示用的大版本。 */
function versionLabel(v, versions) {
  const exact = versions.find((x) => x.version === v);
  if (exact) return exact.title;
  if (v >= 25500) return '舞萌DX 2026';
  if (v >= 25000) return '舞萌DX 2025';
  if (v >= 24000) return '舞萌DX 2024';
  if (v >= 23000) return '舞萌DX 2023';
  if (v >= 22000) return '舞萌DX 2022';
  if (v >= 21000) return '舞萌DX 2021';
  if (v >= 20000) return '舞萌DX';
  // 旧框体：取不大于它的最近一档
  let best = { version: 10000, title: 'maimai' };
  for (const item of versions) {
    if (item.version <= v && item.version > best.version) best = item;
  }
  return best.title;
}

function cleanAliases(list, title) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const alias = String(raw).trim().replace(/\s+/g, ' ');
    if (!alias || alias.length > 18) continue;
    const lower = alias.toLowerCase();
    if (lower === title.toLowerCase() || seen.has(lower)) continue;
    seen.add(lower);
    out.push(alias);
    if (out.length >= 4) break;
  }
  return out;
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${url}`);
  return res.json();
}

function buildChart(song) {
  const dx = song.difficulties?.dx ?? [];
  const std = song.difficulties?.standard ?? [];
  const utage = song.difficulties?.utage ?? [];

  if (utage.length) {
    const chart = utage[0];
    return {
      type: 'UTAGE',
      chart: 'UTAGE',
      level: chart.level,
      ds: null,
      designer: chart.note_designer || '',
      playable: false,
    };
  }

  // 只取 MASTER 谱面做题库；不取 Re:MASTER。
  const masterDx = dx.find((c) => c.difficulty === 3);
  const masterStd = std.find((c) => c.difficulty === 3);
  const selected = masterDx || masterStd;
  if (!selected) return null;
  const useDX = Boolean(masterDx);
  return {
    type: useDX ? 'DX' : 'STD',
    chart: 'MASTER',
    level: selected.level,
    ds: typeof selected.level_value === 'number' && selected.level_value > 0 ? selected.level_value : null,
    designer: selected.note_designer || '',
    playable: true,
  };
}

function main() {
  Promise.all([
    getJSON(`${API}/song/list`),
    getJSON(`${API}/alias/list`).catch((err) => {
      console.warn('[warn] alias list unavailable:', err.message);
      return { aliases: [] };
    }),
  ]).then(([songPayload, aliasPayload]) => {
    const versions = songPayload.versions || [];
    const aliasMap = new Map((aliasPayload.aliases || []).map((x) => [x.song_id, x.aliases]));
    const categories = new Map();
    const songs = [];

    for (const song of songPayload.songs) {
      const genre = GENRES[song.genre] ?? { key: 'other', name: song.genre, short: song.genre, color: '#999999' };
      const chart = buildChart(song);
      if (!chart) continue;

      categories.set(genre.key, genre);
      // 标题只由引号/空白组成的曲目在四选一里会显示成空白选项，不纳入听歌题。
      const visibleTitle = String(song.title || '').replace(/["'“”「」『』\s]/g, '').length > 0;
      const playable = chart.playable && song.id < 100000 && visibleTitle;
      songs.push({
        id: song.id,
        title: song.title,
        artist: song.artist || '',
        genre: genre.key,
        bpm: song.bpm || 0,
        version: versionLabel(song.version, versions),
        level: chart.level || '',
        ds: chart.ds,
        chart: chart.chart,
        type: chart.type,
        designer: chart.designer,
        aliases: cleanAliases(aliasMap.get(song.id), song.title),
        playable,
      });
    }

    const playableSongs = songs.filter((s) => s.playable);
    if (!playableSongs.length) throw new Error('no playable songs returned');

    const categoryList = [...categories.values()]
      .map((cat) => ({
        ...cat,
        total: songs.filter((s) => s.genre === cat.key).length,
        count: playableSongs.filter((s) => s.genre === cat.key).length,
      }))
      .filter((cat) => cat.count > 0)
      .sort((a, b) => b.count - a.count);

    const payload = {
      source: 'LXNS Public API',
      generatedAt: new Date().toISOString(),
      audioBase: 'https://assets2.lxns.net/maimai/music/',
      jacketBase: 'https://assets2.lxns.net/maimai/jacket/',
      total: songs.length,
      playable: playableSongs.length,
      categories: categoryList,
      songs,
    };

    const banner = `/* 舞萌听歌大作战 — 曲库数据\n * 由 tools/sync-data.mjs 从 ${payload.source} 生成于 ${payload.generatedAt}\n * 可玩曲目 ${payload.playable} / 收录 ${payload.total}；宴会場无独立音源，不参与听歌题。\n */\n`;
    const js = `${banner}window.MAI_DATA = ${JSON.stringify(payload, null, 0)};\n`;

    writeFile(OUT, js, 'utf8').then(() => {
      const size = (Buffer.byteLength(js) / 1024).toFixed(1);
      console.log(`[ok] ${OUT}`);
      console.log(`     songs: ${payload.total} total / ${payload.playable} playable`);
      console.log(`     categories: ${categoryList.map((c) => `${c.name}=${c.count}`).join(', ')}`);
      console.log(`     data.js: ${size} KiB`);
    });
  }).catch((err) => {
    console.error('[fail]', err);
    process.exitCode = 1;
  });
}

main();
