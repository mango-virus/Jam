// 3D walking space — Portal Protocol + P2P multiplayer via Trystero.

import * as THREE from 'https://esm.sh/three@0.175.0';

// ------------------------------------------------------------------
// Portal protocol setup
// ------------------------------------------------------------------

const incoming = Portal.readPortalParams();
const usernameEl = document.getElementById('username');
usernameEl.textContent = incoming.username;

// Rename: commit on Enter or blur, revert on Escape
usernameEl.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.preventDefault(); usernameEl.blur(); }
  if (e.key === 'Escape') { usernameEl.textContent = incoming.username; usernameEl.blur(); }
  e.stopPropagation(); // prevent WASD etc. firing while typing
});
usernameEl.addEventListener('blur', () => {
  const name = usernameEl.textContent.trim().slice(0, 32) || incoming.username;
  usernameEl.textContent = name;
  incoming.username = name;
  broadcastSelf();
});
// Also stop keyup from leaking into movement keys
usernameEl.addEventListener('keyup', e => e.stopPropagation());
const nextTarget = await Portal.pickPortalTarget();

// ------------------------------------------------------------------
// Renderer
// ------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ------------------------------------------------------------------
// Scene
// ------------------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0514);
scene.fog = new THREE.Fog(0x0a0514, 28, 90);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);

scene.add(new THREE.AmbientLight(0x220a44, 5));
scene.add(new THREE.HemisphereLight(0x6633cc, 0x0a0514, 1.5));
const sun = new THREE.DirectionalLight(0xc680ff, 2.5);
sun.position.set(20, 40, 15);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 150;
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x0d0620, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(200, 80, 0x2a085a, 0x130428));

// Decorative glowing pillars
const PILLARS = [
  [5, 4],   [-8, 6],  [12, 2],  [-5, -8],
  [17, -4], [-13, 9], [7, -15], [-3, 17],
  [20, 12], [-18, -6],[11, 20], [-15, -17],
  [8, -22], [-22, 11],[24, -8], [-6, 24],
];
let _seed = 42;
function rand() { _seed = (_seed * 1664525 + 1013904223) & 0xffffffff; return (_seed >>> 0) / 0xffffffff; }

for (const [x, z] of PILLARS) {
  const h = 1.5 + rand() * 4;
  const w = 0.4 + rand() * 1.2;
  const hue = 0.72 + rand() * 0.15;
  const col = new THREE.Color().setHSL(hue, 0.8, 0.25);
  const emissive = new THREE.Color().setHSL(hue, 1, 0.1);
  const pillar = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, w),
    new THREE.MeshStandardMaterial({ color: col, emissive, roughness: 0.4 })
  );
  pillar.position.set(x, h / 2, z);
  pillar.castShadow = true;
  scene.add(pillar);
  const glow = new THREE.PointLight(new THREE.Color().setHSL(hue, 1, 0.6), 0.8, 6);
  glow.position.set(x, h + 0.5, z);
  scene.add(glow);
}

// ------------------------------------------------------------------
// Character factory — shared by local player and every peer
// ------------------------------------------------------------------

function makeCharacter(hexColor) {
  const group = new THREE.Group();
  const color = new THREE.Color(hexColor);

  // Torso — shortened so legs don't clip through the bottom
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.55, 0.3),
    new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.25), roughness: 0.4 })
  );
  torso.position.y = 0.675; // bottom at 0.40, top at 0.95
  torso.castShadow = true;
  group.add(torso);

  // Head
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.35, 0.35),
    new THREE.MeshStandardMaterial({ color: 0xffcca0, roughness: 0.7 })
  );
  head.position.y = 1.22;
  head.castShadow = true;
  group.add(head);

  // Arms — pivot group sits at the shoulder so the arm hangs down from it
  const armMat = new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.25), roughness: 0.4 });
  const armGeo = new THREE.BoxGeometry(0.15, 0.55, 0.15);

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.34, 0.92, 0);
  leftArm.rotation.z = 0.15;
  const leftArmMesh = new THREE.Mesh(armGeo, armMat);
  leftArmMesh.position.y = -0.275; // hang down from shoulder pivot
  leftArmMesh.castShadow = true;
  leftArm.add(leftArmMesh);
  group.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.34, 0.92, 0);
  rightArm.rotation.z = -0.15;
  const rightArmMesh = new THREE.Mesh(armGeo, armMat);
  rightArmMesh.position.y = -0.275;
  rightArmMesh.castShadow = true;
  rightArm.add(rightArmMesh);
  group.add(rightArm);

  // Legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1a0030, roughness: 0.6 });
  const legGeo = new THREE.BoxGeometry(0.17, 0.5, 0.17);
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.13, 0.15, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.13, 0.15, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  // Eyeballs
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const eyePupilMat = new THREE.MeshStandardMaterial({ color: 0x110022, roughness: 0.2 });
  const ewGeo = new THREE.SphereGeometry(0.06, 8, 8);
  const pupilGeo = new THREE.SphereGeometry(0.035, 8, 8);
  for (const ex of [-0.09, 0.09]) {
    const white = new THREE.Mesh(ewGeo, eyeWhiteMat);
    white.position.set(ex, 1.25, 0.175);
    group.add(white);
    const pupil = new THREE.Mesh(pupilGeo, eyePupilMat);
    pupil.position.set(ex, 1.25, 0.21);
    group.add(pupil);
  }

  // Hat
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x1a0030, roughness: 0.5, metalness: 0.1 });
  const hatBandMat = new THREE.MeshStandardMaterial({ color: 0xc64bff, emissive: 0x4a0088, roughness: 0.3 });
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 16), hatMat);
  hatBrim.position.y = 1.44;
  hatBrim.castShadow = true;
  group.add(hatBrim);
  const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.20, 0.42, 16), hatMat);
  hatCrown.position.y = 1.69;
  hatCrown.castShadow = true;
  group.add(hatCrown);
  const hatRibbon = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.07, 16), hatBandMat);
  hatRibbon.position.y = 1.49;
  group.add(hatRibbon);

  // Per-character glow
  const charGlow = new THREE.PointLight(color, 1.5, 3);
  charGlow.position.y = 0.8;
  group.add(charGlow);

  return { group, leftArm, rightArm, leftLeg, rightLeg };
}

// ------------------------------------------------------------------
// Local player
// ------------------------------------------------------------------

const { group: playerGroup, leftArm, rightArm, leftLeg, rightLeg } = makeCharacter('#' + incoming.color);
scene.add(playerGroup);

// ------------------------------------------------------------------
// Portals
// ------------------------------------------------------------------

function makePortal(color) {
  const group = new THREE.Group();
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 3.5),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
  );
  plane.position.y = 1.75;
  group.add(plane);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2.1, 3.6, 0.05)),
    new THREE.LineBasicMaterial({ color })
  );
  edges.position.y = 1.75;
  group.add(edges);
  const light = new THREE.PointLight(color, 3, 10);
  light.position.y = 1.75;
  group.add(light);
  return { group, plane, light };
}

const exitPortal = makePortal(0xc64bff);
exitPortal.group.position.set(36, 0, 0);
exitPortal.group.rotation.y = Math.PI / 2;
scene.add(exitPortal.group);

let returnPortal = null;
if (incoming.ref) {
  returnPortal = makePortal(0x4ff0ff);
  returnPortal.group.position.set(-36, 0, 0);
  returnPortal.group.rotation.y = Math.PI / 2;
  scene.add(returnPortal.group);
}

// Canvas-texture sprite labels (portals + peer names)
function makeLabel(text, color, width = 512, height = 80, fontSize = 28) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const cx = c.getContext('2d');
  cx.clearRect(0, 0, width, height);
  cx.fillStyle = color;
  cx.font = `bold ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  cx.textAlign = 'center';
  cx.fillText(text, width / 2, height * 0.7);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })
  );
  sprite.scale.set(5, 0.8, 1);
  return sprite;
}

const exitLabel = makeLabel(nextTarget ? `→ ${nextTarget.title}` : '→ exit', '#c64bff');
exitLabel.position.set(36, 5, 0);
scene.add(exitLabel);
if (returnPortal) {
  const rl = makeLabel('← back', '#4ff0ff');
  rl.position.set(-36, 5, 0);
  scene.add(rl);
}

// ------------------------------------------------------------------
// Multiplayer via Trystero (optional, non-blocking)
// To remove: delete this whole block and the #peers element in index.html
// ------------------------------------------------------------------

const peers = new Map();
const peerCountEl = document.getElementById('peers');
let sendState = null;
let room = null;
let isMoving = false;

function setPeerStatus(text, isError = false) {
  if (!peerCountEl) return;
  peerCountEl.textContent = text;
  peerCountEl.style.color = isError ? '#ff6b6b' : '';
}

function refreshPeerCount() {
  setPeerStatus(`${peers.size + 1} online`);
}

function broadcastSelf() {
  if (!sendState) return;
  sendState({
    x:        playerGroup.position.x,
    z:        playerGroup.position.z,
    rotY:     playerGroup.rotation.y,
    color:    incoming.color,
    username: incoming.username,
    moving:   isMoving,
  });
}

// Mutable label — returns sprite + a redraw function so text can be updated live
function makeMutableLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 48;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(2.5, 0.45, 1);
  sprite.position.y = 2.2;
  function redraw(t) {
    ctx.clearRect(0, 0, 256, 48);
    ctx.fillStyle = color;
    ctx.font = 'bold 20px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t, 128, 34);
    tex.needsUpdate = true;
  }
  redraw(text);
  return { sprite, redraw };
}

function addPeer(id, data) {
  if (peers.has(id)) return;
  const char = makeCharacter('#' + (data.color || 'c64bff'));
  const { sprite: nameLabel, redraw: redrawLabel } = makeMutableLabel(data.username || '?', '#' + (data.color || 'ffffff'));
  char.group.add(nameLabel);
  char.group.position.set(data.x ?? 0, 0, data.z ?? 0);
  char.group.rotation.y = data.rotY ?? 0;
  scene.add(char.group);
  peers.set(id, { ...char, tx: data.x ?? 0, tz: data.z ?? 0, rotY: data.rotY ?? 0, moving: false, swing: 0, username: data.username, redrawLabel });
}

function removePeer(id) {
  const peer = peers.get(id);
  if (peer) { scene.remove(peer.group); peers.delete(id); }
}

async function loadTrystero() {
  const urls = [
    'https://esm.run/trystero@0.23',
    'https://cdn.jsdelivr.net/npm/trystero@0.23/+esm',
    'https://esm.sh/trystero@0.23',
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const mod = await import(url);
      if (mod && typeof mod.joinRoom === 'function') {
        console.log('[jam] trystero loaded from', url);
        return mod;
      }
      lastErr = new Error(`no joinRoom export from ${url}`);
    } catch (err) {
      console.warn('[jam] cdn failed:', url, err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

async function setupMultiplayer() {
  try {
    setPeerStatus('connecting…');
    const { joinRoom } = await loadTrystero();
    room = joinRoom({ appId: 'ordinary-game-jam-3d-space' }, 'main-room');
    const [send, getState] = room.makeAction('state');
    sendState = send;

    room.onPeerJoin(() => { broadcastSelf(); refreshPeerCount(); });
    room.onPeerLeave(id => { removePeer(id); refreshPeerCount(); });

    getState((data, peerId) => {
      if (!peers.has(peerId)) {
        addPeer(peerId, data);
      } else {
        const peer = peers.get(peerId);
        peer.tx     = data.x;
        peer.tz     = data.z;
        peer.rotY   = data.rotY;
        peer.moving = data.moving;
        if (data.username !== peer.username) {
          peer.username = data.username;
          peer.redrawLabel(data.username || '?');
        }
      }
      refreshPeerCount();
    });

    refreshPeerCount();
    broadcastSelf();
    console.log('[jam] multiplayer ready');
  } catch (err) {
    console.error('[jam] multiplayer failed:', err);
    setPeerStatus('multiplayer offline', true);
  }
}

setPeerStatus('connecting…');
setupMultiplayer();
addEventListener('beforeunload', () => { try { room?.leave(); } catch {} });

// ------------------------------------------------------------------
// Input & pointer lock
// ------------------------------------------------------------------

const keys = {};
let yaw = 0;
let pitch = 0.2;
let isLocked = false;
let redirecting = false;

renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());

document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === renderer.domElement;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = isLocked
    ? 'WASD to move  ·  Shift to sprint  ·  Space to jump  ·  walk into a portal to travel'
    : 'Click to capture mouse';
});

document.addEventListener('mousemove', e => {
  if (!isLocked) return;
  yaw   -= e.movementX * 0.0025;
  pitch += e.movementY * 0.0025;
  pitch  = Math.max(-0.6, Math.min(0.8, pitch));
});

document.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ') e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------
// Game loop
// ------------------------------------------------------------------

const SPEED        = incoming.speed || 5;
const SPRINT_MULT  = 2.2;
const JUMP_FORCE   = 8;
const GRAVITY      = 20;
const BOUNDS       = 38;

let velY = 0;      // vertical velocity for jump/gravity
let onGround = true;
const CAM_DIST   = 5;
const CAM_HEIGHT = 2.5;

const _dir    = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _euler  = new THREE.Euler(0, 0, 0, 'YXZ');

let prev = performance.now();
let time = 0;
let lastBroadcast = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;
  time += dt;

  // --- Movement ---
  _euler.set(0, yaw, 0);
  _dir.set(0, 0, 0);
  if (keys['w'] || keys['arrowup'])    _dir.z -= 1;
  if (keys['s'] || keys['arrowdown'])  _dir.z += 1;
  if (keys['a'] || keys['arrowleft'])  _dir.x -= 1;
  if (keys['d'] || keys['arrowright']) _dir.x += 1;

  isMoving = _dir.lengthSq() > 0;
  const isSprinting = keys['shift'];
  const speed = SPEED * (isSprinting ? SPRINT_MULT : 1);

  if (isMoving) {
    _dir.normalize().applyEuler(_euler);
    playerGroup.position.x += _dir.x * speed * dt;
    playerGroup.position.z += _dir.z * speed * dt;
    playerGroup.rotation.y  = Math.atan2(_dir.x, _dir.z);
  }

  // Jump
  if (keys[' '] && onGround) {
    velY = JUMP_FORCE;
    onGround = false;
  }
  velY -= GRAVITY * dt;
  playerGroup.position.y += velY * dt;
  if (playerGroup.position.y <= 0) {
    playerGroup.position.y = 0;
    velY = 0;
    onGround = true;
  }

  // Local limb swing — faster when sprinting
  const swingSpeed = isSprinting ? 13 : 8;
  const swing = isMoving ? Math.sin(time * swingSpeed) * 0.5 : 0;
  leftLeg.rotation.x  =  swing;
  rightLeg.rotation.x = -swing;
  leftArm.rotation.x  = -swing * 0.6;
  rightArm.rotation.x =  swing * 0.6;

  playerGroup.position.x = Math.max(-BOUNDS, Math.min(BOUNDS, playerGroup.position.x));
  playerGroup.position.z = Math.max(-BOUNDS, Math.min(BOUNDS, playerGroup.position.z));

  // --- Third-person camera ---
  const camBack = Math.cos(pitch) * CAM_DIST;
  const camUp   = Math.sin(pitch) * CAM_DIST;
  _offset.set(0, 0, camBack).applyEuler(_euler);
  camera.position.set(
    playerGroup.position.x + _offset.x,
    playerGroup.position.y + CAM_HEIGHT + camUp,
    playerGroup.position.z + _offset.z
  );
  const lookY = playerGroup.position.y + 1 - Math.sin(pitch) * CAM_DIST * 0.5;
  camera.lookAt(playerGroup.position.x, lookY, playerGroup.position.z);

  // --- Animate portals ---
  const pulse = 0.7 + 0.3 * Math.sin(time * 3);
  exitPortal.light.intensity = 2.5 + 1.5 * pulse;
  exitPortal.plane.material.opacity = 0.45 + 0.3 * pulse;
  if (returnPortal) {
    returnPortal.light.intensity = 2.5 + 1.5 * pulse;
    returnPortal.plane.material.opacity = 0.45 + 0.3 * pulse;
  }

  // --- Peer interpolation & limb animation ---
  for (const peer of peers.values()) {
    peer.group.position.x += (peer.tx - peer.group.position.x) * Math.min(1, dt * 12);
    peer.group.position.z += (peer.tz - peer.group.position.z) * Math.min(1, dt * 12);
    // Shortest-path yaw interpolation
    let dRot = peer.rotY - peer.group.rotation.y;
    if (dRot >  Math.PI) dRot -= Math.PI * 2;
    if (dRot < -Math.PI) dRot += Math.PI * 2;
    peer.group.rotation.y += dRot * Math.min(1, dt * 10);
    // Limb swing
    peer.swing += peer.moving ? dt * 8 : -peer.swing * Math.min(1, dt * 10);
    const ps = Math.sin(peer.swing) * (peer.moving ? 0.5 : 0);
    peer.leftLeg.rotation.x  =  ps;
    peer.rightLeg.rotation.x = -ps;
    peer.leftArm.rotation.x  = -ps * 0.6;
    peer.rightArm.rotation.x =  ps * 0.6;
  }

  // --- Broadcast self at ~15 Hz ---
  if (now - lastBroadcast > 66) {
    lastBroadcast = now;
    broadcastSelf();
  }

  // ------------------------------------------------------------------
  // Portal collision — keep these calls
  // ------------------------------------------------------------------
  if (!redirecting) {
    const px = playerGroup.position.x;
    const pz = playerGroup.position.z;
    if (Math.hypot(px - exitPortal.group.position.x, pz - exitPortal.group.position.z) < 2) {
      if (nextTarget?.url) {
        redirecting = true;
        Portal.sendPlayerThroughPortal(nextTarget.url, {
          username: incoming.username,
          color:    incoming.color,
          speed:    SPEED,
        });
      }
    }
    if (returnPortal && incoming.ref) {
      if (Math.hypot(px - returnPortal.group.position.x, pz - returnPortal.group.position.z) < 2) {
        redirecting = true;
        Portal.sendPlayerThroughPortal(incoming.ref, {
          username: incoming.username,
          color:    incoming.color,
          speed:    SPEED,
        });
      }
    }
  }

  renderer.render(scene, camera);
}

loop(performance.now());
