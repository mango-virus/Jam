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
scene.background = new THREE.Color(0x6aa8d8);
scene.fog = new THREE.Fog(0x9ec8e8, 50, 200);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 600);

scene.add(new THREE.AmbientLight(0xfff4e0, 2));
scene.add(new THREE.HemisphereLight(0x87ceef, 0x4a8c3f, 1.2));
const sun = new THREE.DirectionalLight(0xfff4c0, 3);
sun.position.set(30, 80, 20);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 250;
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
scene.add(sun);

// Floating platform
const PLATFORM_HALF = 24;
const platform = new THREE.Mesh(
  new THREE.BoxGeometry(PLATFORM_HALF * 2, 4, PLATFORM_HALF * 2),
  new THREE.MeshStandardMaterial({ color: 0x3d2060, roughness: 0.85, metalness: 0.1 })
);
platform.position.y = -2;
platform.receiveShadow = true;
platform.castShadow = true;
scene.add(platform);
scene.add(new THREE.GridHelper(PLATFORM_HALF * 2, 24, 0x2a085a, 0x1e0545));

// Distant ground far below
const farGround = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000),
  new THREE.MeshStandardMaterial({ color: 0x2d5a1b, roughness: 1 })
);
farGround.rotation.x = -Math.PI / 2;
farGround.position.y = -220;
scene.add(farGround);

// Clouds
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
function addCloud(cx, cy, cz, scale) {
  const g = new THREE.Group();
  for (const [ox, oy, oz, r] of [
    [0, 0, 0, 4], [5, 1, 0, 3], [-4, 0.5, 1, 3.5],
    [2, -1, 3, 2.5], [-2, 1, -3, 2],
  ]) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(r * scale, 7, 5), cloudMat);
    c.position.set(ox * scale, oy * scale, oz * scale);
    g.add(c);
  }
  g.position.set(cx, cy, cz);
  scene.add(g);
}
addCloud(-60,  -8, -30, 1.4);
addCloud( 55, -15,  20, 1.1);
addCloud(-40, -30,  50, 1.6);
addCloud( 70,  -5, -60, 0.9);
addCloud(-20, -50,  80, 1.3);
addCloud( 80, -40, -10, 1.0);
addCloud(-70, -20,  10, 1.2);

// Decorative glowing pillars — trimmed to fit the platform
const PILLARS = [
  [4, 3],   [-7, 5],  [10, 2],   [-4, -7],
  [14, -3], [-11, 8], [6, -13],  [-2, 15],
  [16, 10], [-14, -5],[10, 17],  [-13, -14],
];
let _seed = 42;
function rand() { _seed = (_seed * 1664525 + 1013904223) & 0xffffffff; return (_seed >>> 0) / 0xffffffff; }

const pillarData = []; // { x, z, r } used for collision

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
  pillarData.push({ x, z, r: w / 2 }); // half-width as collision radius
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

  // Shield (shown in left hand when equipped)
  const shieldEquip = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.42, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x2244cc, roughness: 0.5, metalness: 0.3 })
  );
  shieldEquip.position.set(0, -0.28, 0.16);
  shieldEquip.visible = false;
  const shieldEmblem = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.07),
    new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 }));
  shieldEmblem.position.set(0, -0.28, 0.2);
  shieldEmblem.visible = false;
  leftArm.add(shieldEquip);
  leftArm.add(shieldEmblem);

  group.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.34, 0.92, 0);
  rightArm.rotation.z = -0.15;
  const rightArmMesh = new THREE.Mesh(armGeo, armMat);
  rightArmMesh.position.y = -0.275;
  rightArmMesh.castShadow = true;
  rightArm.add(rightArmMesh);

  // Sword (shown in right hand when equipped)
  const swordGroup = new THREE.Group();
  swordGroup.position.set(0, -0.55, 0.12);
  swordGroup.rotation.x = Math.PI / 2;
  swordGroup.visible = false;
  const sBlade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xd0d8e8, metalness: 0.9, roughness: 0.15 }));
  sBlade.position.y = 0.27;
  swordGroup.add(sBlade);
  const sGuard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 }));
  swordGroup.add(sGuard);
  const sHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.8 }));
  sHandle.position.y = -0.1;
  swordGroup.add(sHandle);
  rightArm.add(swordGroup);

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

  return { group, leftArm, rightArm, leftLeg, rightLeg, swordGroup, shieldEquip, shieldEmblem };
}

// ------------------------------------------------------------------
// Local player
// ------------------------------------------------------------------

const { group: playerGroup, leftArm, rightArm, leftLeg, rightLeg, swordGroup: playerSword, shieldEquip: playerShield, shieldEmblem: playerShieldEmblem } = makeCharacter('#' + incoming.color);
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
exitPortal.group.position.set(20, 0, 0);
exitPortal.group.rotation.y = Math.PI / 2;
scene.add(exitPortal.group);

let returnPortal = null;
if (incoming.ref) {
  returnPortal = makePortal(0x4ff0ff);
  returnPortal.group.position.set(-20, 0, 0);
  returnPortal.group.rotation.y = Math.PI / 2;
  scene.add(returnPortal.group);
}

// Lobby portal — always present, leads to The Lobby hub
const LOBBY_URL = 'https://callumhyoung.github.io/gamejam-lobby/';
const lobbyPortal = makePortal(0xffb300);
lobbyPortal.group.position.set(0, 0, -20);
scene.add(lobbyPortal.group);

// ------------------------------------------------------------------
// Chest + item system
// ------------------------------------------------------------------

const MAX_CHESTS       = 2;
const CHEST_INTERVAL   = 18000; // ms between spawn attempts
const CHEST_OPEN_DELAY = 1.6;   // seconds before chest disappears after opening
const ITEM_PICKUP_R    = 1.4;   // metres to pick up item
const CHEST_INTERACT_R = 1.8;
const SWORD_KNOCKBACK  = 38;

let chestTimer = Date.now() + 5000; // first chest after 5s
const activeChests = []; // { group, lidPivot, x, z, opened, openTimer }
const groundItems  = []; // { group, type, x, z }
let equippedItem       = null; // 'sword' | 'shield' | null
let equippedDurability = 0;
let isBlocking         = false;

const SWORD_DURABILITY = 10;
const SHIELD_DURABILITY = 7;
const durabilityEl = document.getElementById('durability');

// Safe random positions on platform (away from edges and pillars)
function randomChestPos() {
  const margin = 3;
  for (let tries = 0; tries < 30; tries++) {
    const x = (Math.random() * 2 - 1) * (PLATFORM_HALF - margin);
    const z = (Math.random() * 2 - 1) * (PLATFORM_HALF - margin);
    // avoid pillars
    const tooClose = pillarData.some(p => Math.hypot(x - p.x, z - p.z) < 2.5);
    // avoid existing chests
    const overlap  = activeChests.some(c => Math.hypot(x - c.x, z - c.z) < 3);
    if (!tooClose && !overlap) return { x, z };
  }
  return { x: 0, z: 8 }; // fallback
}

function makeChest(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const woodMat   = new THREE.MeshStandardMaterial({ color: 0x7a4010, roughness: 0.85 });
  const metalMat  = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.8, roughness: 0.3 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.45, 0.52), woodMat);
  base.position.y = 0.225;
  base.castShadow = true;
  group.add(base);

  // Metal bands
  for (const bz of [-0.22, 0.22]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.06, 0.04), metalMat);
    band.position.set(0, 0.225, bz);
    group.add(band);
  }

  // Lid pivot at top-back of base
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.45, -0.24);
  group.add(lidPivot);

  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.52), woodMat);
  lid.position.set(0, 0.11, 0.24);
  lid.castShadow = true;
  lidPivot.add(lid);

  // Clasp
  const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), metalMat);
  clasp.position.set(0, 0.45, 0.27);
  group.add(clasp);

  // Glow
  const glow = new THREE.PointLight(0xffd700, 0.6, 5);
  glow.position.set(0, 1, 0);
  group.add(glow);

  scene.add(group);
  return { group, lidPivot, glow, x, z, opened: false, openTimer: 0 };
}

function makeGroundItem(type, x, z) {
  const g = new THREE.Group();
  if (type === 'sword') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xd0d8e8, metalness: 0.9, roughness: 0.15 }));
    blade.position.y = 0.35;
    g.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 }));
    guard.position.y = 0.1;
    g.add(guard);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.8 }));
    handle.position.y = -0.05;
    g.add(handle);
  } else { // shield
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x2244cc, roughness: 0.5, metalness: 0.3 }));
    face.position.y = 0.28;
    g.add(face);
    const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8 }));
    emblem.position.y = 0.28;
    g.add(emblem);
  }
  g.position.set(x, 0.1, z);
  scene.add(g);
  return { group: g, type, x, z };
}

function updateDurabilityHUD() {
  if (!durabilityEl) return;
  if (!equippedItem) { durabilityEl.textContent = ''; return; }
  const max   = equippedItem === 'sword' ? SWORD_DURABILITY : SHIELD_DURABILITY;
  const ratio = equippedDurability / max;
  const color = ratio > 0.5 ? '#7fff7f' : ratio > 0.25 ? '#ffcc00' : '#ff4444';
  const icon  = equippedItem === 'sword' ? '⚔' : '🛡';
  const pips  = '█'.repeat(equippedDurability) + '░'.repeat(max - equippedDurability);
  durabilityEl.innerHTML = `${icon} <span style="color:${color};letter-spacing:1px">${pips}</span>`;
}

function equipItem(type) {
  equippedItem = type;
  equippedDurability = type === 'sword' ? SWORD_DURABILITY : SHIELD_DURABILITY;
  playerSword.visible = (type === 'sword');
  playerShield.visible = (type === 'shield');
  playerShieldEmblem.visible = (type === 'shield');
  updateDurabilityHUD();
}

function breakItem() {
  equippedItem = null;
  equippedDurability = 0;
  playerSword.visible = false;
  playerShield.visible = false;
  playerShieldEmblem.visible = false;
  updateDurabilityHUD();
}

function dropItem() {
  if (!equippedItem) return;
  const px = playerGroup.position.x, pz = playerGroup.position.z;
  groundItems.push(makeGroundItem(equippedItem, px + Math.sin(playerGroup.rotation.y + Math.PI) * 1.2, pz + Math.cos(playerGroup.rotation.y + Math.PI) * 1.2));
  equippedItem = null;
  equippedDurability = 0;
  playerSword.visible = false;
  playerShield.visible = false;
  playerShieldEmblem.visible = false;
  updateDurabilityHUD();
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
exitLabel.position.set(20, 5, 0);
scene.add(exitLabel);
if (returnPortal) {
  const rl = makeLabel('← back', '#4ff0ff');
  rl.position.set(-20, 5, 0);
  scene.add(rl);
}

const lobbyLabel = makeLabel('⬡ The Lobby', '#ffb300');
lobbyLabel.position.set(0, 5, -20);
scene.add(lobbyLabel);

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
    y:        playerGroup.position.y,
    z:        playerGroup.position.z,
    rotY:     playerGroup.rotation.y,
    color:    incoming.color,
    username: incoming.username,
    moving:   isMoving,
    equipped: equippedItem,
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
  peers.set(id, { ...char, tx: data.x ?? 0, ty: data.y ?? 0, tz: data.z ?? 0, rotY: data.rotY ?? 0, moving: false, swing: 0, username: data.username, redrawLabel, equipped: data.equipped ?? null });
}

function applyPeerEquip(peer, equipped) {
  peer.equipped = equipped;
  if (peer.swordGroup)   peer.swordGroup.visible   = (equipped === 'sword');
  if (peer.shieldEquip)  peer.shieldEquip.visible   = (equipped === 'shield');
  if (peer.shieldEmblem) peer.shieldEmblem.visible  = (equipped === 'shield');
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
    const [sPunch, onPunch] = room.makeAction('punch');
    sendPunch = sPunch;
    onPunch(({ kx, kz, force }) => {
      if (isBlocking && equippedItem === 'shield') {
        equippedDurability--;
        if (equippedDurability <= 0) breakItem(); else updateDurabilityHUD();
        return;
      }
      const kb = force ?? KNOCKBACK_H;
      velX = kx * kb;
      velZ = kz * kb;
      velY = Math.max(velY, KNOCKBACK_UP);
      onGround = false;
    });

    room.onPeerJoin(() => { broadcastSelf(); refreshPeerCount(); });
    room.onPeerLeave(id => { removePeer(id); refreshPeerCount(); });

    getState((data, peerId) => {
      if (!peers.has(peerId)) {
        addPeer(peerId, data);
      } else {
        const peer = peers.get(peerId);
        peer.tx     = data.x;
        peer.ty     = data.y ?? 0;
        peer.tz     = data.z;
        peer.rotY   = data.rotY;
        peer.moving = data.moving;
        if (data.username !== peer.username) {
          peer.username = data.username;
          peer.redrawLabel(data.username || '?');
        }
        if (data.equipped !== peer.equipped) applyPeerEquip(peer, data.equipped ?? null);
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
    ? 'WASD · Shift sprint · Space jump · LMB punch/sword · RMB shield · E open/equip · Z drop'
    : 'Click to capture mouse';
});

document.addEventListener('mousemove', e => {
  if (!isLocked) return;
  yaw   -= e.movementX * 0.0025;
  pitch += e.movementY * 0.0025;
  pitch  = Math.max(-0.6, Math.min(0.8, pitch));
});

document.addEventListener('mousedown', e => {
  if (!isLocked) return;
  if (e.button === 0) doPunch();
  if (e.button === 2) isBlocking = true;
});
document.addEventListener('mouseup', e => {
  if (e.button === 2) isBlocking = false;
});

document.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ') e.preventDefault();

  // E — open chest / equip item
  if (e.key === 'e' || e.key === 'E') {
    const px = playerGroup.position.x, pz = playerGroup.position.z;
    // Try to open a chest first
    let interacted = false;
    for (let i = activeChests.length - 1; i >= 0; i--) {
      const ch = activeChests[i];
      if (!ch.opened && Math.hypot(px - ch.x, pz - ch.z) < CHEST_INTERACT_R) {
        ch.opened = true;
        ch.openTimer = CHEST_OPEN_DELAY;
        // drop an item at chest position
        const type = Math.random() < 0.5 ? 'sword' : 'shield';
        groundItems.push(makeGroundItem(type, ch.x + (Math.random() - 0.5) * 0.5, ch.z + (Math.random() - 0.5) * 0.5));
        interacted = true;
        break;
      }
    }
    // Otherwise pick up a nearby ground item
    if (!interacted) {
      for (let i = groundItems.length - 1; i >= 0; i--) {
        const it = groundItems[i];
        if (Math.hypot(px - it.x, pz - it.z) < ITEM_PICKUP_R) {
          if (equippedItem) dropItem(); // drop current first
          scene.remove(it.group);
          groundItems.splice(i, 1);
          equipItem(it.type);
          break;
        }
      }
    }
  }

  // Z — drop equipped item
  if (e.key === 'z' || e.key === 'Z') dropItem();
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

const SPEED              = incoming.speed || 5;
const SPRINT_MULT        = 2.2;
const JUMP_FORCE         = 8;
const GRAVITY            = 20;
const FALL_DAMAGE_VEL    = 14;
const FALL_DEATH_Y       = -100;
const KNOCKBACK_H        = 22;   // horizontal knockback speed
const KNOCKBACK_UP       = 5;    // upward kick on punch
const PUNCH_RANGE        = 3.0;  // metres
const PUNCH_DECAY        = 2.5;  // exponential decay rate for knockback

let velY      = 0;
let velX      = 0;   // horizontal knockback
let velZ      = 0;
let onGround  = true;
let isDead    = false;
let deathTimer  = 0;
let punchTimer  = 0; // >0 while punch animation playing
let sendPunch   = null;

const deathEl = document.getElementById('death-msg');

function onPlatform(x, z) {
  return Math.abs(x) < PLATFORM_HALF && Math.abs(z) < PLATFORM_HALF;
}

// Returns the push vector needed to move point (px,pz) outside circle (cx,cz,r), or null.
function circleOverlap(px, pz, cx, cz, r) {
  const dx = px - cx, dz = pz - cz;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist >= r || dist < 0.0001) return null;
  const push = (r - dist) / dist;
  return { nx: dx * push, nz: dz * push };
}

function die() {
  if (isDead) return;
  isDead = true;
  deathTimer = 2.0;
  velY = 0;
  if (deathEl) deathEl.style.display = 'flex';
}

function respawn() {
  isDead = false;
  playerGroup.position.set(0, 1, 0);
  velY = 0; velX = 0; velZ = 0;
  onGround = false;
  if (deathEl) deathEl.style.display = 'none';
}

function doPunch() {
  if (punchTimer > 0 || isDead) return;
  punchTimer = 0.35;

  const px = playerGroup.position.x;
  const py = playerGroup.position.y;
  const pz = playerGroup.position.z;
  let nearest = null, nearestDist = PUNCH_RANGE;

  for (const [id, peer] of peers) {
    const dx = peer.group.position.x - px;
    const dy = peer.group.position.y - py;
    const dz = peer.group.position.z - pz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < nearestDist) { nearest = { id, dx, dy, dz, dist }; nearestDist = dist; }
  }

  if (nearest && sendPunch) {
    const { id, dx, dz, dist } = nearest;
    const force = equippedItem === 'sword' ? SWORD_KNOCKBACK : KNOCKBACK_H;
    sendPunch({ kx: dx / dist, kz: dz / dist, force }, id);
    // Sword loses 1 durability per hit
    if (equippedItem === 'sword') {
      equippedDurability--;
      if (equippedDurability <= 0) breakItem(); else updateDurabilityHUD();
    }
  }
}
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

  // Death timer
  if (isDead) {
    deathTimer -= dt;
    if (deathTimer <= 0) respawn();
  }

  isMoving = _dir.lengthSq() > 0 && !isDead;
  const isSprinting = keys['shift'];
  const speed = SPEED * (isSprinting ? SPRINT_MULT : 1);

  if (isMoving) {
    _dir.normalize().applyEuler(_euler);
    playerGroup.position.x += _dir.x * speed * dt;
    playerGroup.position.z += _dir.z * speed * dt;
    playerGroup.rotation.y  = Math.atan2(_dir.x, _dir.z);
  }

  // Knockback — exponential decay
  const decay = Math.exp(-PUNCH_DECAY * dt);
  velX *= decay;
  velZ *= decay;
  playerGroup.position.x += velX * dt;
  playerGroup.position.z += velZ * dt;

  // --- Collision resolution ---
  const PLAYER_R = 0.32;

  // vs pillars (solid — player pushed fully out)
  for (const p of pillarData) {
    const ov = circleOverlap(playerGroup.position.x, playerGroup.position.z, p.x, p.z, p.r + PLAYER_R);
    if (ov) {
      playerGroup.position.x += ov.nx;
      playerGroup.position.z += ov.nz;
    }
  }

  // vs peer characters (player blocked 70%, peer nudged 30%)
  for (const peer of peers.values()) {
    const ov = circleOverlap(
      playerGroup.position.x, playerGroup.position.z,
      peer.group.position.x, peer.group.position.z,
      PLAYER_R * 2
    );
    if (ov) {
      playerGroup.position.x += ov.nx * 0.7;
      playerGroup.position.z += ov.nz * 0.7;
      // Nudge peer visually; interpolation pulls them back to real pos within ms
      peer.group.position.x -= ov.nx * 0.3;
      peer.group.position.z -= ov.nz * 0.3;
    }
  }

  // Jump
  if (keys[' '] && onGround && !isDead) {
    velY = JUMP_FORCE;
    onGround = false;
  }

  // Gravity
  if (!onGround) velY -= GRAVITY * dt;
  playerGroup.position.y += velY * dt;

  // Walked off edge — drop
  if (onGround && !onPlatform(playerGroup.position.x, playerGroup.position.z)) {
    onGround = false;
  }

  // Landing
  if (!onGround && playerGroup.position.y <= 0 && onPlatform(playerGroup.position.x, playerGroup.position.z)) {
    if (-velY > FALL_DAMAGE_VEL) {
      die();
    }
    playerGroup.position.y = 0;
    velY = 0;
    onGround = true;
  }

  // Fell too far
  if (playerGroup.position.y < FALL_DEATH_Y) die();

  // Local limb swing — faster when sprinting
  const swingSpeed = isSprinting ? 13 : 8;
  const swing = isMoving ? Math.sin(time * swingSpeed) * 0.5 : 0;
  leftLeg.rotation.x  =  swing;
  rightLeg.rotation.x = -swing;

  // Shield raise animation — smoothly lifts arm into guard position
  const shieldBlocking = equippedItem === 'shield' && isBlocking;
  const targetLeftX = shieldBlocking ? -1.5 : -swing * 0.6;
  const targetLeftZ = shieldBlocking ?  0.05 :  0.15;
  leftArm.rotation.x += (targetLeftX - leftArm.rotation.x) * Math.min(1, dt * 14);
  leftArm.rotation.z += (targetLeftZ - leftArm.rotation.z) * Math.min(1, dt * 14);

  // Punch animation overrides right arm
  if (punchTimer > 0) {
    punchTimer = Math.max(0, punchTimer - dt);
    rightArm.rotation.x = -Math.sin((1 - punchTimer / 0.35) * Math.PI) * 1.6;
  } else {
    rightArm.rotation.x = swing * 0.6;
  }

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

  // --- Chest spawning + open animation ---
  if (!isDead && Date.now() >= chestTimer && activeChests.length < MAX_CHESTS) {
    chestTimer = Date.now() + CHEST_INTERVAL;
    const { x, z } = randomChestPos();
    activeChests.push(makeChest(x, z));
  }

  for (let i = activeChests.length - 1; i >= 0; i--) {
    const ch = activeChests[i];
    if (ch.opened) {
      // Animate lid opening
      const targetRot = -Math.PI * 0.75;
      ch.lidPivot.rotation.x += (targetRot - ch.lidPivot.rotation.x) * Math.min(1, dt * 8);
      ch.glow.intensity = Math.max(0, ch.glow.intensity - dt * 2);
      ch.openTimer -= dt;
      if (ch.openTimer <= 0) {
        scene.remove(ch.group);
        activeChests.splice(i, 1);
      }
    } else {
      // Gentle idle bob
      ch.group.position.y = Math.sin(time * 1.8 + ch.x) * 0.04;
    }
  }

  // --- Ground item bobbing ---
  for (const it of groundItems) {
    it.group.position.y = 0.1 + Math.sin(time * 2.5 + it.x) * 0.08;
    it.group.rotation.y += dt * 1.2;
  }

  // --- Animate portals ---
  const pulse = 0.7 + 0.3 * Math.sin(time * 3);
  exitPortal.light.intensity = 2.5 + 1.5 * pulse;
  exitPortal.plane.material.opacity = 0.45 + 0.3 * pulse;
  if (returnPortal) {
    returnPortal.light.intensity = 2.5 + 1.5 * pulse;
    returnPortal.plane.material.opacity = 0.45 + 0.3 * pulse;
  }
  lobbyPortal.light.intensity = 2.5 + 1.5 * pulse;
  lobbyPortal.plane.material.opacity = 0.45 + 0.3 * pulse;

  // --- Peer interpolation & limb animation ---
  for (const peer of peers.values()) {
    peer.group.position.x += (peer.tx - peer.group.position.x) * Math.min(1, dt * 12);
    peer.group.position.y += (peer.ty - peer.group.position.y) * Math.min(1, dt * 20);
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
    if (Math.hypot(px - lobbyPortal.group.position.x, pz - lobbyPortal.group.position.z) < 2) {
      redirecting = true;
      Portal.sendPlayerThroughPortal(LOBBY_URL, {
        username: incoming.username,
        color:    incoming.color,
        speed:    SPEED,
      });
    }
  }

  renderer.render(scene, camera);
}

loop(performance.now());
