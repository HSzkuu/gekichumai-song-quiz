/* ============================================================
   MaiAudio — full-track streaming + random-window clipping
   ------------------------------------------------------------
   Uses the LXNS game-resource CDN (Range + CORS). Every play
   seeks to a new random window inside the full track, so the
   excerpt is different each time. Also provides a tiny WebAudio
   SFX kit and a spectrum analyser for the visualizer.
   ============================================================ */
(function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  class MaiAudio {
    constructor() {
      this.audio = new Audio();
      this.audio.preload = 'metadata';
      this.audio.crossOrigin = 'anonymous';
      this.audio.playsInline = true;
      this.audio.setAttribute('playsinline', '');

      this.ctx = null;
      this.analyser = null;
      this.mediaSource = null;
      this.masterGain = null;
      this.sfxGain = null;
      this.spectrumData = null;
      this.sfxEnabled = true;
      this.volume = 0.92;

      this.state = {
        song: null,
        duration: 0,
        start: 0,
        end: 0,
        clipSec: 30,
        playing: false,
        token: 0,
        lastStart: -999,
        callbacks: null,
        blocked: false,
        ended: false,
        prepared: false,
        preparedToken: 0,
      };

      this._raf = 0;
      this._lastTick = 0;
      this._fade = 0; // 0..1 target fade direction handled in tick
      this._fadeFrom = this.volume;
      this._fadeStartedAt = 0;
      this._fadeDuration = 0;
      this._ending = false;

      this.audio.addEventListener('ended', () => this._handleClipEnd());
    }

    /* -------------------------- WebAudio setup -------------------------- */
    ensureContext() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1;
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.16;
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.82;
        this.spectrumData = new Uint8Array(this.analyser.frequencyBinCount);
        this.sfxGain.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);
      } catch (err) {
        console.warn('[MaiAudio] AudioContext unavailable:', err);
        this.ctx = null;
      }
      return this.ctx;
    }

    async unlock() {
      this.ensureContext();
      if (!this.ctx) return false;
      try {
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        // A silent buffer is a reliable way to unlock WebAudio on iOS.
        const buffer = this.ctx.createBuffer(1, 1, 22050);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);
        source.start(0);
        return this.ctx.state === 'running';
      } catch (err) {
        console.warn('[MaiAudio] unlock failed:', err);
        return false;
      }
    }

    _connectMediaElement() {
      if (!this.ctx || this.mediaSource) return;
      try {
        this.mediaSource = this.ctx.createMediaElementSource(this.audio);
        this.mediaSource.connect(this.analyser);
        this.analyser.connect(this.masterGain);
      } catch (err) {
        console.warn('[MaiAudio] media element source unavailable:', err);
        this.mediaSource = null;
        this.analyser = null;
      }
    }

    /* --------------------------- source helpers --------------------------- */
    static trackUrl(song) {
      const base = (window.MAI_DATA && window.MAI_DATA.audioBase) || 'https://assets2.lxns.net/maimai/music/';
      return `${base}${song.id}.mp3`;
    }

    _pickStart(duration, clipSec, previousStart) {
      if (!Number.isFinite(duration) || duration <= 1) return 0;
      const safeClip = Math.min(clipSec, Math.max(3, duration - 2));
      const lo = Math.min(Math.max(3, duration * 0.06), Math.max(0, duration - safeClip - 2));
      const hi = Math.max(lo, Math.min(duration - safeClip - 1.2, duration * 0.85));
      let start = lo + Math.random() * Math.max(0.1, hi - lo);
      if (Number.isFinite(previousStart) && previousStart > -100) {
        const minGap = Math.min(12, Math.max(4, safeClip * 0.4));
        for (let i = 0; i < 8; i += 1) {
          if (Math.abs(start - previousStart) >= minGap) break;
          start = lo + Math.random() * Math.max(0.1, hi - lo);
        }
        if (Math.abs(start - previousStart) < 2 && hi - lo > 4) {
          start = previousStart > (lo + hi) / 2 ? lo + 1 : hi - 1;
        }
      }
      return clamp(start, 0, Math.max(0, duration - safeClip - 0.4));
    }

    _clearPending() {
      this.state.callbacks = null;
    }

    /* ----------------------------- playback ----------------------------- */
    /**
     * Play a fresh random window of `song`.
     * @param {object} song
     * @param {number} clipSec
     * @param {{onStart?:Function,onProgress?:Function,onEnd?:Function,onError?:Function}} callbacks
     */
    play(song, clipSec, callbacks = {}) {
      this._ending = false;
      this.stop(0.03);
      const token = ++this.state.token;
      this.ensureContext();
      this._connectMediaElement();

      this.state.song = song;
      this.state.clipSec = Math.max(3, Number(clipSec) || 30);
      this.state.callbacks = callbacks;
      this.state.blocked = false;
      this.state.ended = false;
      this.state.playing = false;

      const url = MaiAudio.trackUrl(song);
      const isNewSource = this.audio.src !== url;
      if (isNewSource) {
        this.audio.src = url;
        this.audio.load();
      } else {
        this.audio.pause();
        this.audio.currentTime = 0;
      }

      const fail = (code, message) => {
        if (token !== this.state.token) return;
        this.state.playing = false;
        this.audio.pause();
        callbacks.onError && callbacks.onError({ code, message });
      };

      this._waitForMetadata(token)
        .then((duration) => {
          if (token !== this.state.token) return;
          this.state.duration = duration;
          let start = this._pickStart(duration, this.state.clipSec, this.state.lastStart);
          this.state.lastStart = start;
          this.state.start = start;
          this.state.end = Math.min(duration, start + this.state.clipSec);
          this._seekAndPlay(token, start);
        })
        .catch((err) => {
          if (token !== this.state.token) return;
          if (err && err.code === 'abort') return;
          fail('load', '音频加载失败，请检查网络后重试。');
        });
    }

    /** Replay with a *different* random window inside the same song. */
    replay(callbacks) {
      const { song, duration, clipSec } = this.state;
      if (!song || !duration) return Promise.reject(new Error('no track loaded'));
      if (callbacks) this.state.callbacks = callbacks;
      const token = ++this.state.token;
      this._ending = false;
      this.state.ended = false;
      this.state.playing = false;
      const oldStart = this.state.start;
      const start = this._pickStart(duration, clipSec, oldStart);
      this.state.lastStart = start;
      this.state.start = start;
      this.state.end = Math.min(duration, start + clipSec);
      return this._seekAndPlay(token, start, true);
    }

    _waitForMetadata(token) {
      return new Promise((resolve, reject) => {
        const audio = this.audio;
        let timer = 0;
        let settled = false;

        const cleanup = () => {
          clearTimeout(timer);
          audio.removeEventListener('loadedmetadata', onMeta);
          audio.removeEventListener('error', onError);
          audio.removeEventListener('abort', onAbort);
        };
        const done = (fn, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          fn(value);
        };
        const onMeta = () => {
          if (token !== this.state.token) return done(reject, { code: 'abort' });
          if (Number.isFinite(audio.duration) && audio.duration > 1) done(resolve, audio.duration);
          else done(reject, new Error('invalid duration'));
        };
        const onError = () => done(reject, new Error('media error'));
        const onAbort = () => done(reject, { code: 'abort' });

        if (audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 1) {
          return resolve(audio.duration);
        }

        audio.addEventListener('loadedmetadata', onMeta);
        audio.addEventListener('error', onError, { once: true });
        audio.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => done(reject, new Error('timeout')), 18000);
      });
    }

    async _seekAndPlay(token, start, isReplay = false) {
      if (token !== this.state.token) return;
      const audio = this.audio;
      const callbacks = this.state.callbacks || {};

      try {
        audio.pause();
        audio.volume = 0;
        this.state.playing = false;
        if (Math.abs(audio.currentTime - start) > 0.25) audio.currentTime = start;
      } catch (err) {
        // Seek can fail while the stream is still opening — retry once soon.
        await new Promise((r) => setTimeout(r, 260));
        try { audio.currentTime = start; } catch (_) { /* ignore */ }
      }

      const playAttempt = async () => {
        try {
          await audio.play();
          if (token !== this.state.token) { audio.pause(); return false; }
          this.state.playing = true;
          this.state.blocked = false;
          this._fadeIn();
          this._startTicker();
          callbacks.onStart && callbacks.onStart({
            replay: isReplay,
            duration: this.state.duration,
            start: this.state.start,
            end: this.state.end,
            clipSec: this.state.clipSec,
          });
          return true;
        } catch (err) {
          if (token !== this.state.token) return false;
          if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
            this.state.blocked = true;
            this.state.callbacks = callbacks;
            callbacks.onError && callbacks.onError({ code: 'blocked', message: '需要一次点击才能播放。' });
            return false;
          }
          callbacks.onError && callbacks.onError({ code: 'play', message: '播放失败，请重试。' });
          return false;
        }
      };

      // Wait briefly for the seek to land; otherwise play anyway.
      let seeked = false;
      const onSeeked = () => { seeked = true; };
      audio.addEventListener('seeked', onSeeked, { once: true });
      await Promise.race([
        new Promise((r) => setTimeout(r, 650)),
        new Promise((r) => {
          const check = () => { if (seeked) r(); else setTimeout(check, 40); };
          check();
        }),
      ]);
      audio.removeEventListener('seeked', onSeeked);
      if (!seeked) {
        try { audio.currentTime = start; } catch (_) { /* ignore */ }
      }
      await playAttempt();
    }

    /** Resume after an autoplay-blocked attempt (call from a user gesture). */
    retry() {
      if (!this.state.blocked) return Promise.resolve(false);
      return this.unlock().then(() => {
        const token = this.state.token;
        this.state.blocked = false;
        return this._seekAndPlay(token, this.state.start, true);
      });
    }

    _fadeIn() {
      const now = performance.now();
      this._fadeFrom = 0;
      this._fadeStartedAt = now;
      this._fadeDuration = 260;
      this.audio.volume = 0;
    }

    _fadeOut(ms = 220) {
      const now = performance.now();
      this._fadeFrom = this.audio.volume;
      this._fadeStartedAt = now;
      this._fadeDuration = Math.max(40, ms);
    }

    _startTicker() {
      if (this._raf) return;
      const tick = () => {
        this._raf = 0;
        const state = this.state;
        if (!state.playing && !this._ending) return;
        const now = performance.now();

        // volume fades
        if (this._fadeDuration > 0) {
          const p = clamp((now - this._fadeStartedAt) / this._fadeDuration, 0, 1);
          const target = this._ending ? 0 : this.volume;
          this.audio.volume = clamp(this._fadeFrom + (target - this._fadeFrom) * p, 0, 1);
          if (p >= 1) this._fadeDuration = 0;
        } else if (!this.state.playing && !this._ending) {
          return;
        }

        const t = this.audio.currentTime;
        const remaining = state.end - t;

        if (state.playing) {
          // Fade out over the last 420ms of the chosen excerpt.
          if (remaining <= 0.42 && remaining > 0) {
            const p = clamp(remaining / 0.42, 0, 1);
            this.audio.volume = clamp(p * this.volume, 0, 1);
          }
          if (this.state.callbacks && this.state.callbacks.onProgress) {
            this.state.callbacks.onProgress({
              currentTime: t,
              start: state.start,
              end: state.end,
              clipSec: state.clipSec,
              duration: state.duration,
            });
          }
        }

        if (state.playing && (t >= state.end - 0.02 || remaining < -0.35)) {
          this._handleClipEnd();
          return;
        }
        if (!this._ending) this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }

    _handleClipEnd() {
      if (this.state.ended) return;
      if (!this.state.playing && !this._ending) return;
      this.state.ended = true;
      this.state.playing = false;
      this._ending = true;
      this._fadeOut(260);
      setTimeout(() => {
        this.audio.pause();
        this._ending = false;
        this._fadeDuration = 0;
        const cb = this.state.callbacks;
        cb && cb.onEnd && cb.onEnd();
      }, 270);
    }

    /**
     * 联机模式：提前加载完整曲目并定位到服务端指定比例，不播放。
     * 返回 Promise<{duration,start,end}>；客户端准备好后通知服务器。
     */
    prepare(song, clipSec, startPct = 0.35) {
      this._ending = false;
      this.stop(0.02);
      const token = ++this.state.token;
      this.ensureContext();
      this._connectMediaElement();
      this.state.song = song;
      this.state.clipSec = Math.max(3, Number(clipSec) || 30);
      this.state.callbacks = null;
      this.state.playing = false;
      this.state.ended = false;
      this.state.blocked = false;

      const url = MaiAudio.trackUrl(song);
      if (this.audio.src !== url) {
        this.audio.src = url;
        this.audio.load();
      } else {
        this.audio.pause();
      }

      return this._waitForMetadata(token).then((duration) => {
        if (token !== this.state.token) return Promise.reject(new Error('aborted'));
        const clip = Math.min(this.state.clipSec, Math.max(3, duration - 2));
        const minStart = Math.max(0, duration * 0.04);
        const maxStart = Math.max(minStart, duration - clip - 0.4);
        const start = clamp(duration * clamp(startPct, 0, 0.95), minStart, maxStart);
        this.state.duration = duration;
        this.state.start = start;
        this.state.end = Math.min(duration, start + clip);
        this.audio.pause();
        this.audio.volume = 0;
        try { this.audio.currentTime = start; } catch (_) { /* ignore */ }
        return new Promise((resolve) => {
          let settled = false;
          let timer = 0;
          const cleanup = () => {
            clearTimeout(timer);
            this.audio.removeEventListener('canplay', onReady);
            this.audio.removeEventListener('loadeddata', onReady);
          };
          const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            this.state.prepared = true;
            this.state.preparedToken = token;
            resolve({ duration, start, end: this.state.end, clipSec: this.state.clipSec });
          };
          const onReady = () => {
            if (token !== this.state.token) { cleanup(); return; }
            finish();
          };
          if (this.audio.readyState >= 3) { finish(); return; }
          this.audio.addEventListener('canplay', onReady);
          this.audio.addEventListener('loadeddata', onReady);
          timer = setTimeout(() => {
            if (token !== this.state.token) { cleanup(); return; }
            finish();
          }, 2800);
        });
      });
    }

    /** 联机模式：在 startInMs 后播放已经 prepare 好的片段。 */
    startPrepared(startInMs = 0, callbacks = {}, offsetSec = 0) {
      if (!this.state.prepared || !this.state.song) {
        return Promise.reject(new Error('not prepared'));
      }
      const token = this.state.token;
      this.state.callbacks = callbacks;
      this.state.ended = false;
      this._ending = false;
      const delay = Math.max(0, Number(startInMs) || 0);
      const doPlay = () => {
        if (token !== this.state.token) return;
        if (offsetSec > 0) {
          try {
            this.audio.currentTime = Math.min(this.state.end - 0.05, this.state.start + offsetSec);
          } catch (_) { /* ignore */ }
        }
        this.audio.volume = 0;
        this.audio.play().then(() => {
          if (token !== this.state.token) { this.audio.pause(); return; }
          this.state.playing = true;
          this.state.blocked = false;
          this._fadeIn();
          this._startTicker();
          callbacks.onStart && callbacks.onStart({
            duration: this.state.duration,
            start: this.state.start,
            end: this.state.end,
            clipSec: this.state.clipSec,
          });
        }).catch((err) => {
          if (token !== this.state.token) return;
          callbacks.onError && callbacks.onError({
            code: err && err.name === 'NotAllowedError' ? 'blocked' : 'play',
            message: err && err.name === 'NotAllowedError' ? '浏览器阻止了自动播放。' : '播放失败。',
          });
        });
      };
      if (delay > 0) setTimeout(doPlay, delay);
      else doPlay();
      return Promise.resolve(true);
    }

    stop(fadeMs = 140) {
      this.state.token += 1;
      this.state.playing = false;
      this.state.prepared = false;
      this._ending = false;
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
      if (fadeMs > 0 && !this.audio.paused) {
        const from = this.audio.volume;
        const start = performance.now();
        const fade = () => {
          const p = clamp((performance.now() - start) / fadeMs, 0, 1);
          this.audio.volume = from * (1 - p);
          if (p < 1) requestAnimationFrame(fade);
          else {
            this.audio.pause();
            this.audio.volume = this.volume;
          }
        };
        fade();
      } else {
        this.audio.pause();
        this.audio.volume = this.volume;
      }
    }

    hardStop() {
      this.state.token += 1;
      this.state.playing = false;
      this._ending = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.state.song = null;
      this.state.duration = 0;
      this.state.callbacks = null;
    }

    /* ----------------------------- visuals ----------------------------- */
    spectrum() {
      if (!this.analyser || !this.spectrumData) return null;
      this.analyser.getByteFrequencyData(this.spectrumData);
      return this.spectrumData;
    }

    get currentTime() { return this.audio.currentTime; }
    get isPlaying() { return this.state.playing; }
    get isBlocked() { return this.state.blocked; }
    get clipInfo() {
      return {
        song: this.state.song,
        duration: this.state.duration,
        start: this.state.start,
        end: this.state.end,
        clipSec: this.state.clipSec,
      };
    }

    /* ------------------------------- SFX ------------------------------- */
    setSfxEnabled(enabled) {
      this.sfxEnabled = Boolean(enabled);
      if (this.sfxGain) this.sfxGain.gain.value = enabled ? 0.16 : 0;
    }

    _tone({ freq, type = 'sine', start = 0, dur = 0.16, gain = 0.5, slideTo = null, filterFreq = null }) {
      if (!this.ctx || !this.sfxEnabled) return;
      const t0 = this.ctx.currentTime + start;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      let node = osc;
      if (filterFreq) {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = filterFreq;
        node.connect(f);
        node = f;
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      node.connect(g);
      g.connect(this.sfxGain || this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    sfx(name) {
      if (!this.ctx || !this.sfxEnabled) return;
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      switch (name) {
        case 'click':
          this._tone({ freq: 1320, type: 'triangle', dur: 0.07, gain: 0.22 });
          break;
        case 'start':
          this._tone({ freq: 523.25, type: 'triangle', dur: 0.16, gain: 0.32 });
          this._tone({ freq: 783.99, type: 'triangle', start: 0.1, dur: 0.16, gain: 0.3 });
          this._tone({ freq: 1046.5, type: 'triangle', start: 0.2, dur: 0.24, gain: 0.28 });
          break;
        case 'perfect':
          this._tone({ freq: 1046.5, type: 'sine', dur: 0.18, gain: 0.5 });
          this._tone({ freq: 1318.5, type: 'sine', start: 0.07, dur: 0.18, gain: 0.42 });
          this._tone({ freq: 1568, type: 'sine', start: 0.14, dur: 0.3, gain: 0.36 });
          this._tone({ freq: 2093, type: 'triangle', start: 0.14, dur: 0.2, gain: 0.12 });
          break;
        case 'great':
          this._tone({ freq: 880, type: 'sine', dur: 0.2, gain: 0.42 });
          this._tone({ freq: 1174.7, type: 'sine', start: 0.08, dur: 0.24, gain: 0.34 });
          break;
        case 'miss':
          this._tone({ freq: 196, type: 'sawtooth', dur: 0.26, gain: 0.2, slideTo: 92, filterFreq: 900 });
          this._tone({ freq: 138, type: 'square', start: 0.02, dur: 0.24, gain: 0.08, slideTo: 70, filterFreq: 600 });
          break;
        case 'lives':
          this._tone({ freq: 440, type: 'square', dur: 0.1, gain: 0.08 });
          this._tone({ freq: 330, type: 'square', start: 0.1, dur: 0.16, gain: 0.08 });
          break;
        case 'win':
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
            this._tone({ freq: f, type: 'triangle', start: i * 0.11, dur: 0.42, gain: 0.28 });
          });
          break;
        default:
          break;
      }
    }
  }

  window.MaiAudio = MaiAudio;
  window.MAI_AUDIO = new MaiAudio();
})();
