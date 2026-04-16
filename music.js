// Procedural background music — synthwave / cyberpunk style
// Exposes window.GameMusic = { start, stop, setVolume, toggle, muted }
(function () {
  const BPM       = 128;
  const STEP_S    = 60 / BPM / 4;   // 16th-note duration
  const STEPS     = 64;              // 4 bars
  const LOOKAHEAD = 0.12;            // seconds ahead to schedule
  const INTERVAL  = 50;             // scheduler poll ms

  let ctx           = null;
  let master        = null;
  let playing       = false;
  let muted         = false;
  let step          = 0;
  let nextTime      = 0;
  let timer         = null;
  let volumeLevel   = 0.38;

  // ── Scale / notes ──────────────────────────────────────────────
  // A natural minor: A B C D E F G
  const N = {
    A1:  55.00,
    A2: 110.00, B2: 123.47, C3: 130.81, D3: 146.83,
    E3: 164.81, F3: 174.61, G3: 196.00,
    A3: 220.00, B3: 246.94, C4: 261.63, D4: 293.66,
    E4: 329.63, F4: 349.23, G4: 392.00,
    A4: 440.00, C5: 523.25, E5: 659.25,
  };

  // ── Patterns (64 steps = 4 bars) ───────────────────────────────
  // Chord roots cycle: Am → F → C → G (each 16 steps)
  const bassLine = [
    // Bar 1 – Am
    N.A2, 0, 0, N.A2, 0, 0, N.C3, 0,   N.E3, 0, N.A2, 0,   0, 0, N.G3, 0,
    // Bar 2 – F
    N.F3, 0, 0, N.F3, 0, 0, N.A2, 0,   N.C3, 0, N.F3, 0,   0, 0, N.E3, 0,
    // Bar 3 – C
    N.C3, 0, 0, N.C3, 0, 0, N.E3, 0,   N.G3, 0, N.C3, 0,   0, 0, N.B2, 0,
    // Bar 4 – G
    N.G3, 0, 0, N.G3, 0, 0, N.B3, 0,   N.D4, 0, N.G3, 0,   0, 0, N.A3, 0,
  ];

  const arpLine = [
    // Bar 1 – Am arpeggio up then down
    0, N.A3, 0, N.C4, 0, N.E4, 0, N.A4,   0, N.E4, 0, N.C4,  0, N.A3, 0, N.G3,
    // Bar 2 – F arpeggio
    0, N.F3, 0, N.A3, 0, N.C4, 0, N.F4,   0, N.C4, 0, N.A3,  0, N.F3, 0, N.E3,
    // Bar 3 – C arpeggio
    0, N.C4, 0, N.E4, 0, N.G4, 0, N.C5,   0, N.G4, 0, N.E4,  0, N.C4, 0, N.B3,
    // Bar 4 – G arpeggio
    0, N.G3, 0, N.B3, 0, N.D4, 0, N.G4,   0, N.D4, 0, N.B3,  0, N.G3, 0, N.A3,
  ];

  // Chord pads fire once per bar on step 0 of each bar
  const padChords = [
    [N.A2, N.E3, N.A3, N.C4, N.E4], // Am
    [N.F3, N.A3, N.C4, N.F4],       // F
    [N.C3, N.G3, N.C4, N.E4],       // C
    [N.G3, N.B3, N.D4, N.G4],       // G
  ];

  // ── Audio helpers ───────────────────────────────────────────────
  function ensureCtx() {
    if (ctx) return;
    ctx    = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volumeLevel;
    master.connect(ctx.destination);
  }

  function noiseBuffer(dur) {
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function kick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(master);
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(0.01, t + 0.45);
    g.gain.setValueAtTime(1.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.start(t); o.stop(t + 0.45);
  }

  function snare(t) {
    // tonal body
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.value = 200;
    o.connect(og); og.connect(master);
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.start(t); o.stop(t + 0.12);
    // noise snap
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.18);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2800; f.Q.value = 0.8;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(master);
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.start(t); src.stop(t + 0.18);
  }

  function hihat(t, open) {
    const dur = open ? 0.22 : 0.045;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 9000;
    const g = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(master);
    g.gain.setValueAtTime(open ? 0.12 : 0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t); src.stop(t + dur);
  }

  function bass(freq, t) {
    const dur  = STEP_S * 1.9;
    const osc  = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc.type  = 'sawtooth'; osc.frequency.value  = freq;
    osc2.type = 'square';   osc2.frequency.value = freq;
    const lp  = ctx.createBiquadFilter();
    lp.type   = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 1.5;
    const g2  = ctx.createGain(); g2.gain.value = 0.25;
    const g   = ctx.createGain();
    osc.connect(lp); osc2.connect(g2); g2.connect(lp);
    lp.connect(g); g.connect(master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42, t + 0.01);
    g.gain.setValueAtTime(0.42, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t); osc.stop(t + dur);
    osc2.start(t); osc2.stop(t + dur);
  }

  function arp(freq, t) {
    const dur = STEP_S * 0.85;
    const osc = ctx.createOscillator();
    osc.type  = 'square'; osc.frequency.value = freq;
    const f   = ctx.createBiquadFilter();
    f.type    = 'bandpass'; f.frequency.value = freq * 1.8; f.Q.value = 2.5;
    const g   = ctx.createGain();
    osc.connect(f); f.connect(g); g.connect(master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t); osc.stop(t + dur);
  }

  function pad(freqs, t) {
    const dur = STEP_S * 15.5; // nearly a full bar
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      osc.type  = 'sine'; osc.frequency.value = freq;
      // add slight detune for warmth
      const osc2 = ctx.createOscillator();
      osc2.type  = 'sine'; osc2.frequency.value = freq * 1.004;
      const g = ctx.createGain();
      osc.connect(g); osc2.connect(g); g.connect(master);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.25);
      g.gain.setValueAtTime(0.045, t + dur - 0.3);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.start(t); osc.stop(t + dur);
      osc2.start(t); osc2.stop(t + dur);
    }
  }

  // ── Sequencer ──────────────────────────────────────────────────
  function scheduleStep(s, t) {
    const bar     = Math.floor(s / 16) % 4;
    const barStep = s % 16;
    const beat    = s % 8;

    // Drums
    if (beat === 0)                   kick(t);
    if (beat === 4)                   snare(t);
    if (s % 2 === 0)                  hihat(t, s % 4 === 2);

    // Pad — once per bar on step 0
    if (barStep === 0)                pad(padChords[bar], t);

    // Bass
    const bf = bassLine[s % STEPS];
    if (bf)                           bass(bf, t);

    // Arp
    const af = arpLine[s % STEPS];
    if (af)                           arp(af, t);
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextTime);
      nextTime += STEP_S;
      step = (step + 1) % STEPS;
    }
  }

  // ── Public API ─────────────────────────────────────────────────
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

  function setVolume(v) {
    volumeLevel = v;
    if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  }

  function toggle() {
    muted = !muted;
    setVolume(muted ? 0 : volumeLevel || 0.38);
    return muted;
  }

  window.GameMusic = { start, stop, setVolume, toggle, get muted() { return muted; } };
})();
