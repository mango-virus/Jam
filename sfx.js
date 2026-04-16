// Procedural sound effects for Arena Battler
// Exposes window.SFX = { punch, swordHit, gloveHit, batNormal, batHomeRun,
//                        shieldBlock, shieldBreak, pickup, itemBreak,
//                        die, respawn, ghostPunch }
(function () {
  let ctx = null;
  let master = null;

  function ensureCtx() {
    if (ctx) return;
    ctx    = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  // ── Noise buffer helper ──────────────────────────────────────────
  function noise(dur) {
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ── Generic envelope helper ──────────────────────────────────────
  function env(gainNode, t, attack, hold, decay, peak) {
    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(peak, t + attack);
    gainNode.gain.setValueAtTime(peak, t + attack + hold);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + attack + hold + decay);
  }

  // ── PUNCH — quick thud + air swoosh ─────────────────────────────
  function punch() {
    ensureCtx(); resume();
    const t = ctx.currentTime;
    // Body thud
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    o.connect(g); g.connect(master);
    env(g, t, 0.002, 0.01, 0.1, 0.7);
    o.start(t); o.stop(t + 0.15);
    // Air swoosh
    const src = ctx.createBufferSource();
    src.buffer = noise(0.1);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 1.5;
    const g2 = ctx.createGain();
    src.connect(f); f.connect(g2); g2.connect(master);
    env(g2, t, 0.005, 0.02, 0.07, 0.25);
    src.start(t); src.stop(t + 0.1);
  }

  // ── SWORD HIT — metallic clang + high shimmer ────────────────────
  function swordHit() {
    ensureCtx(); resume();
    const t = ctx.currentTime;
    // Clang — two detuned metal tones
    for (const freq of [820, 1240, 1850]) {
      const o  = ctx.createOscillator();
      const g  = ctx.createGain();
      o.type   = 'sawtooth'; o.frequency.value = freq;
      const lp = ctx.createBiquadFilter();
      lp.type  = 'bandpass'; lp.frequency.value = freq * 1.3; lp.Q.value = 4;
      o.connect(lp); lp.connect(g); g.connect(master);
      env(g, t, 0.001, 0.005, 0.28, 0.22);
      o.start(t); o.stop(t + 0.35);
    }
    // Sharp attack click
    const src = ctx.createBufferSource();
    src.buffer = noise(0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6000;
    const g3 = ctx.createGain();
    src.connect(hp); hp.connect(g3); g3.connect(master);
    env(g3, t, 0.001, 0.002, 0.025, 0.5);
    src.start(t); src.stop(t + 0.03);
  }

  // ── GLOVE HIT — heavy deep thud + bassy boom ────────────────────
  function gloveHit() {
    ensureCtx(); resume();
    const t = ctx.currentTime;
    // Sub punch
    const o  = ctx.createOscillator();
    const g  = ctx.createGain();
    o.type   = 'sine'; o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    o.connect(g); g.connect(master);
    env(g, t, 0.002, 0.02, 0.22, 1.1);
    o.start(t); o.stop(t + 0.28);
    // Impact crunch
    const src = ctx.createBufferSource();
    src.buffer = noise(0.08);
    const f  = ctx.createBiquadFilter();
    f.type   = 'lowpass'; f.frequency.value = 900;
    const g2 = ctx.createGain();
    src.connect(f); f.connect(g2); g2.connect(master);
    env(g2, t, 0.002, 0.01, 0.07, 0.55);
    src.start(t); src.stop(t + 0.1);
    // Body shockwave tone
    const o2 = ctx.createOscillator();
    const g3 = ctx.createGain();
    o2.type  = 'square'; o2.frequency.setValueAtTime(200, t);
    o2.frequency.exponentialRampToValueAtTime(80, t + 0.12);
    o2.connect(g3); g3.connect(master);
    env(g3, t, 0.002, 0.005, 0.12, 0.35);
    o2.start(t); o2.stop(t + 0.15);
  }

  // ── BAT NORMAL HIT — lightweight tap ────────────────────────────
  function batNormal() {
    ensureCtx(); resume();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type  = 'triangle'; o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(280, t + 0.06);
    o.connect(g); g.connect(master);
    env(g, t, 0.001, 0.005, 0.07, 0.45);
    o.start(t); o.stop(t + 0.09);
    // Tap click
    const src = ctx.createBufferSource();
    src.buffer = noise(0.03);
    const f  = ctx.createBiquadFilter();
    f.type   = 'bandpass'; f.frequency.value = 3500; f.Q.value = 2;
    const g2 = ctx.createGain();
    src.connect(f); f.connect(g2); g2.connect(master);
    env(g2, t, 0.001, 0.002, 0.025, 0.3);
    src.start(t); src.stop(t + 0.03);
  }

  // ── BAT HOME RUN — massive crack + rising scream ─────────────────
  function batHomeRun() {
    ensureCtx(); resume();
    const t = ctx.currentTime;
    // Massive crack
    const src = ctx.createBufferSource();
    src.buffer = noise(0.12);
    const f  = ctx.createBiquadFilter();
    f.type   = 'lowpass'; f.frequency.value = 5000;
    const g  = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(master);
    env(g, t, 0.001, 0.008, 0.11, 1.2);
    src.start(t); src.stop(t + 0.14);
    // Sub boom
    const o  = ctx.createOscillator();
    const g2 = ctx.createGain();
    o.type   = 'sine'; o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.35);
    o.connect(g2); g2.connect(master);
    env(g2, t, 0.002, 0.01, 0.33, 1.4);
    o.start(t); o.stop(t + 0.4);
    // Rising scream whistle (the ball flying)
    const o2 = ctx.createOscillator();
    const g3 = ctx.createGain();
    o2.type  = 'sine'; o2.frequency.setValueAtTime(800, t + 0.05);
    o2.frequency.exponentialRampToValueAtTime(3200, t + 0.7);
    o2.connect(g3); g3.connect(master);
    g3.gain.setValueAtTime(0, t + 0.05);
    g3.gain.linearRampToValueAtTime(0.3, t + 0.12);
    g3.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o2.start(t + 0.05); o2.stop(t + 0.75);
    // Electric zap (lightning)
    const src2 = ctx.createBufferSource();
    src2.buffer = noise(0.15);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 4000;
    const g4 = ctx.createGain();
    src2.connect(hp); hp.connect(g4); g4.connect(master);
    env(g4, t, 0.001, 0.01, 0.13, 0.6);
    src2.start(t); src2.stop(t + 0.16);
  }

  // ── SHIELD BLOCK — heavy metallic deflect ───────────────────────
  function shieldBlock() {
    ensureCtx(); resume();
    const t = ctx.currentTime;
    for (const freq of [600, 900, 1400]) {
      const o  = ctx.createOscillator();
      const g  = ctx.createGain();
      o.type   = 'square'; o.frequency.value = freq;
      const bp = ctx.createBiquadFilter();
      bp.type  = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 6;
      o.connect(bp); bp.connect(g); g.connect(master);
      env(g, t, 0.001, 0.005, 0.2, 0.18);
      o.start(t); o.stop(t + 0.25);
    }
    // Thud beneath
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type  = 'sine'; o2.frequency.setValueAtTime(160, t);
    o2.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    o2.connect(g2); g2.connect(master);
    env(g2, t, 0.001, 0.01, 0.1, 0.5);
    o2.start(t); o2.stop(t + 0.15);
  }

  // ── SHIELD BREAK — shattering crash ─────────────────────────────
  function shieldBreak() {
    ensureCtx(); resume();
    const t = ctx.currentTime;
    // Multiple descending tones
    for (let i = 0; i < 5; i++) {
      const delay = i * 0.04;
      const o  = ctx.createOscillator();
      const g  = ctx.createGain();
      o.type   = 'sawtooth';
      o.frequency.setValueAtTime(1000 - i * 120, t + delay);
      o.frequency.exponentialRampToValueAtTime(200 - i * 20, t + delay + 0.3);
      o.connect(g); g.connect(master);
      env(g, t + delay, 0.001, 0.01, 0.28, 0.2);
      o.start(t + delay); o.stop(t + delay + 0.35);
    }
    // Noise burst
    const src = ctx.createBufferSource();
    src.buffer = noise(0.25);
    const g2 = ctx.createGain();
    src.connect(g2); g2.connect(master);
    env(g2, t, 0.001, 0.01, 0.22, 0.4);
    src.start(t); src.stop(t + 0.28);
  }

  // ── ITEM BREAK — generic snap + fade ────────────────────────────
  function itemBreak() {
    ensureCtx(); resume();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise(0.18);
    const f  = ctx.createBiquadFilter();
    f.type   = 'bandpass'; f.frequency.value = 2200; f.Q.value = 1.2;
    const g  = ctx.createGain();
    src.connect(f); f.connect(g); g.connect(master);
    env(g, t, 0.001, 0.01, 0.16, 0.55);
    src.start(t); src.stop(t + 0.2);
    const o = ctx.createOscillator();
    const g2 = ctx.createGain();
    o.type  = 'square'; o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.15);
    o.connect(g2); g2.connect(master);
    env(g2, t, 0.001, 0.005, 0.14, 0.3);
    o.start(t); o.stop(t + 0.18);
  }

  // ── PICKUP — bright upward chime ────────────────────────────────
  function pickup() {
    ensureCtx(); resume();
    const t     = ctx.currentTime;
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const delay = i * 0.055;
      const o  = ctx.createOscillator();
      const g  = ctx.createGain();
      o.type   = 'sine'; o.frequency.value = freq;
      o.connect(g); g.connect(master);
      env(g, t + delay, 0.005, 0.04, 0.14, 0.28);
      o.start(t + delay); o.stop(t + delay + 0.22);
    });
  }

  // ── DIE — descending whoosh ──────────────────────────────────────
  function die() {
    ensureCtx(); resume();
    const t = ctx.currentTime;
    const o  = ctx.createOscillator();
    const g  = ctx.createGain();
    o.type   = 'sawtooth'; o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.7);
    const lp = ctx.createBiquadFilter();
    lp.type  = 'lowpass'; lp.frequency.value = 1200;
    o.connect(lp); lp.connect(g); g.connect(master);
    env(g, t, 0.01, 0.05, 0.6, 0.5);
    o.start(t); o.stop(t + 0.75);
    // Rumble
    const src = ctx.createBufferSource();
    src.buffer = noise(0.5);
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass'; lp2.frequency.value = 400;
    const g2 = ctx.createGain();
    src.connect(lp2); lp2.connect(g2); g2.connect(master);
    env(g2, t, 0.01, 0.1, 0.35, 0.3);
    src.start(t); src.stop(t + 0.55);
  }

  // ── RESPAWN — bright ascending sparkle ──────────────────────────
  function respawn() {
    ensureCtx(); resume();
    const t     = ctx.currentTime;
    const notes = [330, 440, 554, 659, 880];
    notes.forEach((freq, i) => {
      const delay = i * 0.07;
      const o  = ctx.createOscillator();
      const g  = ctx.createGain();
      o.type   = 'sine'; o.frequency.value = freq;
      o.connect(g); g.connect(master);
      env(g, t + delay, 0.005, 0.05, 0.18, 0.22);
      o.start(t + delay); o.stop(t + delay + 0.28);
    });
  }

  // ── GHOST PUNCH — eerie whoosh ───────────────────────────────────
  function ghostPunch() {
    ensureCtx(); resume();
    const t = ctx.currentTime;
    const o  = ctx.createOscillator();
    const g  = ctx.createGain();
    o.type   = 'sine'; o.frequency.setValueAtTime(300, t);
    o.frequency.linearRampToValueAtTime(180, t + 0.22);
    const wv = ctx.createOscillator();
    wv.type  = 'sine'; wv.frequency.value = 6; // vibrato LFO
    const wg = ctx.createGain(); wg.gain.value = 30;
    wv.connect(wg); wg.connect(o.frequency);
    o.connect(g); g.connect(master);
    env(g, t, 0.01, 0.05, 0.2, 0.4);
    wv.start(t); wv.stop(t + 0.32);
    o.start(t); o.stop(t + 0.32);
    // Airy noise
    const src = ctx.createBufferSource();
    src.buffer = noise(0.25);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 0.8;
    const g2 = ctx.createGain();
    src.connect(bp); bp.connect(g2); g2.connect(master);
    env(g2, t, 0.01, 0.04, 0.2, 0.2);
    src.start(t); src.stop(t + 0.28);
  }

  window.SFX = { punch, swordHit, gloveHit, batNormal, batHomeRun, shieldBlock, shieldBreak, itemBreak, pickup, die, respawn, ghostPunch };
})();
