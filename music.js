// Procedural background music — 4 distinct tracks, randomised per match
// Exposes window.GameMusic = { start, stop, playTrack, setVolume, toggle, muted }
(function () {
  const LOOKAHEAD = 0.12;
  const INTERVAL  = 50;

  let ctx         = null;
  let master      = null;
  let playing     = false;
  let muted       = false;
  let step        = 0;
  let nextTime    = 0;
  let timer       = null;
  let volumeLevel = 0.036;
  let activeTrack = 0;

  // ── Shared audio helpers ────────────────────────────────────────
  function ensureCtx() {
    if (ctx) return;
    ctx    = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volumeLevel;
    master.connect(ctx.destination);
  }

  function noiseBuf(dur) {
    const len = Math.ceil(ctx.sampleRate * dur);
    const b   = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function osc(type, freq, t, dur, gainPeak, gainDecay) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    o.connect(g); g.connect(master);
    g.gain.setValueAtTime(gainPeak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + gainDecay);
    o.start(t); o.stop(t + dur);
  }

  function kick(t, freq = 160, decay = 0.45) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(master);
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(0.01, t + decay);
    g.gain.setValueAtTime(1.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    o.start(t); o.stop(t + decay);
  }

  function snare(t, toneFreq = 200, noiseGain = 0.45) {
    osc('sine', toneFreq, t, 0.12, 0.5, 0.12);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(0.18);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2800; f.Q.value = 0.8;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(master);
    g.gain.setValueAtTime(noiseGain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.start(t); src.stop(t + 0.18);
  }

  function hihat(t, open, gain = 0.1) {
    const dur = open ? 0.22 : 0.045;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(dur);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 9000;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(master);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t); src.stop(t + dur);
  }

  function clap(t) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(0.08);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.5;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(master);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    src.start(t); src.stop(t + 0.09);
  }

  function bassNote(freq, t, stepS, waveMix = 1.0) {
    const dur = stepS * 1.9;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'square';   o2.frequency.value = freq;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 1.5;
    const gm = ctx.createGain(); gm.gain.value = 0.25 * waveMix;
    const g  = ctx.createGain();
    o1.connect(lp); o2.connect(gm); gm.connect(lp); lp.connect(g); g.connect(master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42, t + 0.01);
    g.gain.setValueAtTime(0.42, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o1.start(t); o1.stop(t + dur); o2.start(t); o2.stop(t + dur);
  }

  function arpNote(freq, t, stepS, waveType = 'square', gainPeak = 0.16) {
    const dur = stepS * 0.85;
    const o = ctx.createOscillator(); o.type = waveType; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq * 1.8; f.Q.value = 2.5;
    const g = ctx.createGain();
    o.connect(f); f.connect(g); g.connect(master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gainPeak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur);
  }

  function padChord(freqs, t, stepS, gainLevel = 0.045) {
    const dur = stepS * 16 * 15.5 / 16; // nearly a full bar
    for (const freq of freqs) {
      for (const det of [1, 1.004]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * det;
        const g = ctx.createGain();
        o.connect(g); g.connect(master);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gainLevel, t + 0.25);
        g.gain.setValueAtTime(gainLevel, t + dur - 0.3);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.start(t); o.stop(t + dur);
      }
    }
  }

  // ── Note lookup ─────────────────────────────────────────────────
  const N = {
    // Octave 2
    A2:110.00, Bb2:116.54, B2:123.47, C3:130.81, Db3:138.59, D3:146.83,
    Eb3:155.56, E3:164.81, F3:174.61, Gb3:185.00, G3:196.00, Ab3:207.65,
    // Octave 3
    A3:220.00, Bb3:233.08, B3:246.94, C4:261.63, Db4:277.18, D4:293.66,
    Eb4:311.13, E4:329.63, F4:349.23, Gb4:369.99, G4:392.00, Ab4:415.30,
    // Octave 4
    A4:440.00, Bb4:466.16, B4:493.88, C5:523.25, D5:587.33, E5:659.25,
    F5:698.46, G5:783.99,
  };

  // ════════════════════════════════════════════════════════════════
  // TRACK DEFINITIONS
  // Each track: { bpm, bassLine[64], arpLine[64], padChords[4],
  //               drums(step, t, stepS), arpWave, bassWaveMix, padGain }
  // ════════════════════════════════════════════════════════════════

  // ── Track 0 — Synthwave (Am–F–C–G) ──────────────────────────────
  const track0 = {
    bpm: 128,
    bassLine: [
      N.A2,0,0,N.A2,0,0,N.C3,0,  N.E3,0,N.A2,0,  0,0,N.G3,0,
      N.F3,0,0,N.F3,0,0,N.A2,0,  N.C3,0,N.F3,0,  0,0,N.E3,0,
      N.C3,0,0,N.C3,0,0,N.E3,0,  N.G3,0,N.C3,0,  0,0,N.B2,0,
      N.G3,0,0,N.G3,0,0,N.B3,0,  N.D4,0,N.G3,0,  0,0,N.A3,0,
    ],
    arpLine: [
      0,N.A3,0,N.C4,0,N.E4,0,N.A4,  0,N.E4,0,N.C4,  0,N.A3,0,N.G3,
      0,N.F3,0,N.A3,0,N.C4,0,N.F4,  0,N.C4,0,N.A3,  0,N.F3,0,N.E3,
      0,N.C4,0,N.E4,0,N.G4,0,N.C5,  0,N.G4,0,N.E4,  0,N.C4,0,N.B3,
      0,N.G3,0,N.B3,0,N.D4,0,N.G4,  0,N.D4,0,N.B3,  0,N.G3,0,N.A3,
    ],
    padChords: [
      [N.A2,N.E3,N.A3,N.C4,N.E4],
      [N.F3,N.A3,N.C4,N.F4],
      [N.C3,N.G3,N.C4,N.E4],
      [N.G3,N.B3,N.D4,N.G4],
    ],
    arpWave: 'square',
    padGain: 0.045,
    drums(s, t) {
      const beat = s % 8;
      if (beat === 0)       kick(t);
      if (beat === 4)       snare(t);
      if (s % 2 === 0)      hihat(t, s % 4 === 2);
    },
  };

  // ── Track 1 — Dark Battle (Dm–Bb–F–C, 140 BPM) ──────────────────
  const track1 = {
    bpm: 140,
    bassLine: [
      N.D3,0,0,N.D3,0,N.D3,0,0,  N.A2,0,N.D3,0,  N.C3,0,0,N.C3,
      N.Bb2,0,0,N.Bb2,0,N.Bb2,0,0,  N.F3,0,N.Bb2,0,  N.A2,0,0,N.A2,
      N.F3,0,0,N.F3,0,N.F3,0,0,  N.C3,0,N.F3,0,  N.E3,0,0,N.E3,
      N.C3,0,0,N.C3,0,N.C3,0,0,  N.G3,0,N.C3,0,  N.Bb2,0,0,N.D3,
    ],
    arpLine: [
      N.D4,0,N.A3,0,N.F3,0,N.D3,0,  N.A3,0,N.F4,0,  N.E4,0,N.C4,0,
      N.Bb3,0,N.F3,0,N.D3,0,N.Bb2,0,  N.D4,0,N.F4,0,  N.A3,0,N.Bb3,0,
      N.F4,0,N.C4,0,N.A3,0,N.F3,0,  N.C4,0,N.A4,0,  N.G4,0,N.E4,0,
      N.C4,0,N.G3,0,N.E3,0,N.C3,0,  N.G3,0,N.E4,0,  N.D4,0,N.F4,0,
    ],
    padChords: [
      [N.D3,N.A3,N.D4,N.F4],
      [N.Bb2,N.F3,N.Bb3,N.D4],
      [N.F3,N.C4,N.F4,N.A4],
      [N.C3,N.G3,N.C4,N.E4],
    ],
    arpWave: 'sawtooth',
    padGain: 0.038,
    drums(s, t) {
      const beat = s % 8;
      // four-on-the-floor kick
      if (s % 4 === 0)      kick(t, 150, 0.4);
      if (beat === 4)       { snare(t, 220, 0.55); clap(t); }
      // driving 16th hi-hats
      hihat(t, false, 0.07);
      if (beat === 2 || beat === 6) hihat(t, true, 0.08);
    },
  };

  // ── Track 2 — Cyber Pop (Em–C–G–D, 138 BPM) ─────────────────────
  const track2 = {
    bpm: 138,
    bassLine: [
      N.E3,0,0,N.E3,0,0,N.B2,0,  N.G3,0,N.E3,0,  0,N.D3,0,N.B2,
      N.C3,0,0,N.C3,0,0,N.G3,0,  N.E3,0,N.C3,0,  0,N.B2,0,N.G3,
      N.G3,0,0,N.G3,0,0,N.D3,0,  N.B2,0,N.G3,0,  0,N.A2,0,N.B2,
      N.D3,0,0,N.D3,0,0,N.A2,0,  N.Gb3,0,N.D3,0,  0,N.E3,0,N.Gb3,
    ],
    arpLine: [
      0,N.E4,0,N.G4,0,N.B4,0,N.E5,  0,N.B3,0,N.G4,  0,N.E4,0,N.D4,
      0,N.C4,0,N.E4,0,N.G4,0,N.C5,  0,N.G3,0,N.E4,  0,N.C4,0,N.B3,
      0,N.G4,0,N.B4,0,N.D5,0,N.G5,  0,N.D4,0,N.B3,  0,N.G4,0,N.A4,
      0,N.D4,0,N.Gb4,0,N.A4,0,N.D5,  0,N.A3,0,N.Gb4, 0,N.D4,0,N.E4,
    ],
    padChords: [
      [N.E3,N.B3,N.E4,N.G4,N.B4],
      [N.C3,N.G3,N.C4,N.E4],
      [N.G3,N.D4,N.G4,N.B4],
      [N.D3,N.A3,N.D4,N.Gb4],
    ],
    arpWave: 'triangle',
    padGain: 0.05,
    drums(s, t) {
      const beat = s % 8;
      if (beat === 0)         kick(t, 170, 0.35);
      if (beat === 4)         kick(t, 170, 0.35);
      if (beat === 2 || beat === 6) snare(t, 180, 0.4);
      if (s % 2 === 0)        hihat(t, false, 0.08);
      if (beat === 3 || beat === 7) hihat(t, true, 0.1);
    },
  };

  // ── Track 3 — Tense Arena (Bm–G–D–A, 148 BPM) ───────────────────
  const track3 = {
    bpm: 148,
    bassLine: [
      N.B2,0,N.B2,0,0,N.B2,0,N.A2,  N.G3,0,N.B2,0,  N.A2,0,N.G3,0,
      N.G3,0,N.G3,0,0,N.G3,0,N.G3,  N.D3,0,N.G3,0,  N.B2,0,N.D3,0,
      N.D3,0,N.D3,0,0,N.D3,0,N.C3,  N.B2,0,N.D3,0,  N.A2,0,N.B2,0,
      N.A2,0,N.A2,0,0,N.A2,0,N.A2,  N.E3,0,N.A2,0,  N.Gb3,0,N.B2,0,
    ],
    arpLine: [
      N.B3,0,N.D4,0,N.Gb4,0,N.B4,0,  0,N.Gb4,0,N.D4,  N.B3,0,N.A3,0,
      N.G3,0,N.B3,0,N.D4,0,N.G4,0,  0,N.D4,0,N.B3,  N.G3,0,N.Gb3,0,
      N.D4,0,N.Gb4,0,N.A4,0,N.D5,0,  0,N.A4,0,N.Gb4,  N.D4,0,N.E4,0,
      N.A3,0,N.Db4,0,N.E4,0,N.A4,0,  0,N.E4,0,N.Db4,  N.A3,0,N.B3,0,
    ],
    padChords: [
      [N.B2,N.Gb3,N.B3,N.D4],
      [N.G3,N.D4,N.G4,N.B4],
      [N.D3,N.A3,N.D4,N.Gb4],
      [N.A2,N.E3,N.A3,N.Db4],
    ],
    arpWave: 'sawtooth',
    padGain: 0.032,
    drums(s, t) {
      const beat = s % 8;
      if (beat === 0)         kick(t, 140, 0.5);
      if (beat === 2)         kick(t, 120, 0.3);
      if (beat === 4)         { snare(t, 240, 0.6); clap(t); }
      // double-time hats
      hihat(t, false, 0.065);
      if (beat === 1 || beat === 3 || beat === 5 || beat === 7) hihat(t, true, 0.075);
    },
  };

  // ── Track 4 — Lo-Fi Atmosphere (Cm–Ab–Eb–Bb, 105 BPM) ───────────
  const track4 = {
    bpm: 105,
    bassLine: [
      N.C3,0,0,0,0,N.C3,0,0,  N.Eb3,0,0,N.G3,  0,0,N.Bb2,0,
      N.Ab3,0,0,0,0,N.Ab3,0,0,  N.C3,0,0,N.Eb3,  0,0,N.G3,0,
      N.Eb3,0,0,0,0,N.Eb3,0,0,  N.G3,0,0,N.Bb3,  0,0,N.C4,0,
      N.Bb2,0,0,0,0,N.Bb2,0,0,  N.D3,0,0,N.F3,  0,0,N.Ab3,0,
    ],
    arpLine: [
      0,0,N.C4,0,0,N.Eb4,0,0,  N.G4,0,0,N.Eb4,  0,N.C4,0,0,
      0,0,N.Ab3,0,0,N.C4,0,0,  N.Eb4,0,0,N.C4,  0,N.Ab3,0,0,
      0,0,N.Eb4,0,0,N.G4,0,0,  N.Bb4,0,0,N.G4,  0,N.Eb4,0,0,
      0,0,N.Bb3,0,0,N.D4,0,0,  N.F4,0,0,N.D4,  0,N.Bb3,0,0,
    ],
    padChords: [
      [N.C3,N.G3,N.C4,N.Eb4,N.G4],
      [N.Ab3,N.Eb4,N.Ab4,N.C5],
      [N.Eb3,N.Bb3,N.Eb4,N.G4],
      [N.Bb2,N.F3,N.Bb3,N.D4],
    ],
    arpWave: 'sine',
    padGain: 0.055,
    drums(s, t) {
      const beat = s % 8;
      if (beat === 0)       kick(t, 130, 0.5);
      if (beat === 6)       kick(t, 110, 0.35);
      if (beat === 4)       snare(t, 160, 0.35);
      if (s % 4 === 0)      hihat(t, false, 0.06);
      if (beat === 2)       hihat(t, true, 0.07);
    },
  };

  const TRACKS = [track0, track1, track2, track3, track4];

  // ── Sequencer ───────────────────────────────────────────────────
  function getStepS() { return 60 / TRACKS[activeTrack].bpm / 4; }

  function scheduleStep(s, t) {
    const tr      = TRACKS[activeTrack];
    const stepS   = getStepS();
    const barStep = s % 16;

    tr.drums(s, t);
    if (barStep === 0) padChord(tr.padChords[Math.floor(s / 16) % 4], t, stepS, tr.padGain);
    const bf = tr.bassLine[s % 64]; if (bf) bassNote(bf, t, stepS);
    const af = tr.arpLine[s % 64];  if (af) arpNote(af, t, stepS, tr.arpWave);
  }

  function scheduler() {
    const stepS = getStepS();
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextTime);
      nextTime += stepS;
      step = (step + 1) % 64;
    }
  }

  // ── Public API ──────────────────────────────────────────────────
  function start() {
    ensureCtx();
    if (ctx.state === 'suspended') ctx.resume();
    if (playing) return;
    playing  = true;
    step     = 0;
    nextTime = ctx.currentTime + 0.05;
    timer    = setInterval(scheduler, INTERVAL);
  }

  function stop() {
    if (!playing) return;
    playing = false;
    clearInterval(timer);
  }

  // Switch track — fades out, swaps, fades back in
  function playTrack(idx) {
    ensureCtx();
    activeTrack = ((idx % TRACKS.length) + TRACKS.length) % TRACKS.length;
    const wasPlaying = playing;
    stop();
    step = 0;
    if (wasPlaying) start();
  }

  function setVolume(v) {
    volumeLevel = v;
    if (!muted && master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  }

  function toggle() {
    muted = !muted;
    if (master) master.gain.setTargetAtTime(muted ? 0 : volumeLevel, ctx.currentTime, 0.05);
    return muted;
  }

  window.GameMusic = {
    start, stop, playTrack,
    setVolume, toggle,
    get trackCount() { return TRACKS.length; },
    get muted() { return muted; },
  };
})();

// ---------------------------------------------------------------------------
// Menu music — plays menu-music.mp3 on loop during lobby / game-over screen
// at the original louder volume (0.38).
// ---------------------------------------------------------------------------
(function () {
  const VOLUME = 0.38;
  let ctx = null, gainNode = null, source = null, buffer = null;
  let muted = false, savedVolume = VOLUME;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      gainNode = ctx.createGain();
      gainNode.gain.value = VOLUME;
      gainNode.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  async function loadBuffer() {
    if (buffer) return;          // already loaded
    try {
      const res = await fetch('menu-music.mp3');
      const arr = await res.arrayBuffer();
      buffer = await ctx.decodeAudioData(arr);
    } catch (e) {
      console.warn('[MenuMusic] could not load menu-music.mp3', e);
    }
  }

  async function start() {
    if (source) return;          // already playing
    ensureCtx();
    await loadBuffer();
    if (!buffer) return;
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop   = true;
    source.connect(gainNode);
    source.start(0);
  }

  function stop() {
    if (!source) return;
    try { source.stop(); } catch (_) {}
    source = null;
  }

  // Start as soon as the browser allows audio (first user gesture of any kind).
  // Browsers require at least one interaction before AudioContext can run;
  // listening on the document catches clicks, keypresses, and touches so the
  // music begins the moment the player does anything at all on the page.
  function autoStart() {
    const events = ['pointerdown', 'keydown', 'touchstart'];
    function onGesture() {
      start();
      events.forEach(ev => document.removeEventListener(ev, onGesture));
    }
    events.forEach(ev => document.addEventListener(ev, onGesture, { once: true }));
  }
  autoStart();

  function setVolume(v) {
    savedVolume = v;
    if (gainNode && !muted) gainNode.gain.value = v;
  }

  function toggle() {
    muted = !muted;
    if (gainNode) gainNode.gain.value = muted ? 0 : savedVolume;
    return muted;
  }

  window.MenuMusic = { start, stop, toggle, setVolume, get muted() { return muted; } };
})();
