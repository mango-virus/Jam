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
const LOBBY_URL = 'https://callumhyoung.github.io/gamejam-lobby/';

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

// ------------------------------------------------------------------
// Arena layout — pillars + elevated platforms (rebuilt every round)
// ------------------------------------------------------------------

let _seed = 42;
function rand() { _seed = (_seed * 1664525 + 1013904223) & 0xffffffff; return (_seed >>> 0) / 0xffffffff; }

const pillarData        = []; // { x, z, r, topY }  – collision data
const pillarMeshes      = []; // THREE.Mesh refs for teardown
const pillarLights      = []; // THREE.PointLight refs for teardown

const CLIMB_SPEED   = 7.0;   // m/s upward when pressing into a climbable object
const MAX_CLIMBABLE = 10.0;  // max height above current Y that can be climbed

const elevatedPlatforms = []; // { x, z, hw, hd, topY } – collision data
const epMeshes          = []; // THREE.Mesh refs for teardown

function rebuildArena(seed) {
  // --- Tear down ---
  for (const m of pillarMeshes) scene.remove(m);
  for (const l of pillarLights) scene.remove(l);
  pillarMeshes.length = 0; pillarLights.length = 0; pillarData.length = 0;
  for (const m of epMeshes) scene.remove(m);
  epMeshes.length = 0; elevatedPlatforms.length = 0;

  _seed = (seed ^ 0xdeadbeef) >>> 0;

  // --- Helpers ---
  const occupied = []; // { x, z, r } footprints for spacing checks

  function fits(x, z, r) {
    if (Math.hypot(x, z) < 3.5) return false; // keep centre clear
    if (Math.abs(x) > PLATFORM_HALF - 4 || Math.abs(z) > PLATFORM_HALF - 4) return false;
    return !occupied.some(o => Math.hypot(x - o.x, z - o.z) < r + o.r + 1.0);
  }

  function rndPos(margin, footprint) {
    for (let i = 0; i < 100; i++) {
      const x = (rand() * 2 - 1) * (PLATFORM_HALF - margin);
      const z = (rand() * 2 - 1) * (PLATFORM_HALF - margin);
      if (fits(x, z, footprint)) return { x, z };
    }
    return null;
  }

  function mat(hue, lightness = 0.22, sat = 0.75) {
    const col = new THREE.Color().setHSL(hue, sat, lightness);
    const emissive = new THREE.Color().setHSL(hue, 1, 0.07);
    return new THREE.MeshStandardMaterial({ color: col, emissive, roughness: 0.45, metalness: 0.1 });
  }

  function addMesh(geo, material, x, y, z, rotY = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); pillarMeshes.push(m);
    return m;
  }

  function addGlow(x, y, z, hue, intensity = 1.0, distance = 7) {
    const l = new THREE.PointLight(new THREE.Color().setHSL(hue, 1, 0.6), intensity, distance);
    l.position.set(x, y, z);
    scene.add(l); pillarLights.push(l);
  }

  function addPillarCol(x, z, r, topY) { pillarData.push({ x, z, r, topY }); }
  // angle (optional) stores the Y-rotation of the shape so OBB tests
  // can work in the shape's local frame instead of an inflated AABB.
  // hw/hd are LOCAL half-extents (before rotation).
  function addEP(x, z, hw, hd, topY, angle = 0) {
    elevatedPlatforms.push({ x, z, hw, hd, topY, angle });
  }

  // ── Structure builders ────────────────────────────────────────────

  function spawnPillar(x, z) {
    const h = 3 + rand() * 7, w = 0.7 + rand() * 1.8;
    const hue = rand();
    const shape = Math.floor(rand() * 3);
    let geo;
    if      (shape === 0) geo = new THREE.BoxGeometry(w, h, w);
    else if (shape === 1) geo = new THREE.CylinderGeometry(w/2, w/2, h, 6);
    else                  geo = new THREE.CylinderGeometry(w/2, w*0.7, h, 8);
    addMesh(geo, mat(hue), x, h/2, z);
    addGlow(x, h + 0.5, z, hue);
    addPillarCol(x, z, w/2, h);
    occupied.push({ x, z, r: w/2 + 0.5 });
  }

function spawnArch(x, z) {
    const hue = rand();
    const legH = 3.5 + rand() * 3, legW = 0.9;
    const span = 5.0 + rand() * 3;
    const angle = rand() * Math.PI;
    const dx = Math.cos(angle) * span/2, dz = Math.sin(angle) * span/2;
    // Two legs
    addMesh(new THREE.BoxGeometry(legW, legH, legW), mat(hue), x + dx, legH/2, z + dz);
    addPillarCol(x + dx, z + dz, legW/2, legH);
    addMesh(new THREE.BoxGeometry(legW, legH, legW), mat(hue), x - dx, legH/2, z - dz);
    addPillarCol(x - dx, z - dz, legW/2, legH);
    // Keystone beam
    const beamLen = span + legW;
    const beamMesh = addMesh(new THREE.BoxGeometry(beamLen, legW * 0.8, legW * 0.8), mat(hue, 0.32), x, legH, z, angle);
    addGlow(x, legH + 1, z, hue, 0.7, 6);
    occupied.push({ x, z, r: span/2 + 1 });
  }

  function spawnStaircase(x, z) {
    const hue = rand();
    const angle = rand() * Math.PI * 2;
    const stepW = 3.2 + rand() * 1.5, stepD = 1.9;
    const steps = 3;
    for (let s = 0; s < steps; s++) {
      const sh = 0.8 + s * 1.0;
      const ox = Math.cos(angle) * stepD * (s - 1);
      const oz = Math.sin(angle) * stepD * (s - 1);
      addMesh(new THREE.BoxGeometry(stepW, sh, stepD), mat(hue, 0.2 + s * 0.05), x + ox, sh/2, z + oz);
      // each step is walkable
      const hw = stepW/2, hd = stepD/2;
      const rx = Math.cos(angle), rz = Math.sin(angle);
      addEP(x + ox, z + oz, hw, hd, sh);
    }
    addGlow(x, 2.5, z, hue, 0.6, 5);
    occupied.push({ x, z, r: stepD * steps * 0.6 });
  }

function spawnRuinCluster(x, z) {
    const hue = rand();
    const count = 2 + Math.floor(rand() * 3);
    const baseAngle = rand() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (i / count) * Math.PI * 2;
      const dist = 1.5 + rand() * 1.2;
      const rx = x + Math.cos(a) * dist, rz = z + Math.sin(a) * dist;
      const ph = 1.5 + rand() * 5.0, pw = 0.5 + rand() * 0.9;
      addMesh(new THREE.CylinderGeometry(pw/2, pw/2, ph, 7), mat(hue, 0.15 + rand() * 0.1), rx, ph/2, rz);
      addPillarCol(rx, rz, pw/2, ph);
    }
    addGlow(x, 2, z, hue, 0.5, 6);
    occupied.push({ x, z, r: 2.5 });
  }

  function spawnObelisk(x, z) {
    const hue = rand();
    const h = 6 + rand() * 6, w = 0.7 + rand() * 0.8;
    // Tapered shaft
    addMesh(new THREE.CylinderGeometry(w * 0.15, w * 0.5, h, 4), mat(hue, 0.28), x, h/2, z, rand() * Math.PI);
    // Pyramid tip
    addMesh(new THREE.ConeGeometry(w * 0.15, h * 0.18, 4), mat(hue, 0.5, 0.9), x, h + (h * 0.09), z, rand() * Math.PI);
    addGlow(x, h + 0.5, z, hue, 1.4, 9);
    addPillarCol(x, z, w * 0.4, h);
    occupied.push({ x, z, r: w * 0.5 + 0.5 });
  }

  function spawnCrystalCluster(x, z) {
    const hue = rand();
    const count = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.5;
      const dist = rand() * 1.8;
      const cx = x + Math.cos(a) * dist, cz = z + Math.sin(a) * dist;
      const ch = 1.5 + rand() * 3.5, cw = 0.3 + rand() * 0.55;
      const m = addMesh(new THREE.ConeGeometry(cw, ch, 5), mat(hue, 0.35, 0.9), cx, ch/2, cz);
      m.rotation.z = (rand() * 0.24 - 0.12); // subtle cosmetic lean only (max ~7°)
      m.rotation.y = rand() * Math.PI * 2;
      addPillarCol(cx, cz, cw, ch);
    }
    addGlow(x, 1.5, z, hue, 1.6, 7);
    occupied.push({ x, z, r: 2 });
  }

  function spawnMonument(x, z) {
    const hue = rand();
    const baseW = 5.0 + rand() * 3, baseH = 1.0 + rand() * 0.8;
    const towerH = 4 + rand() * 4, towerW = 1.0;
    // Wide base pedestal
    addMesh(new THREE.BoxGeometry(baseW, baseH, baseW), mat(hue, 0.18), x, baseH/2, z);
    addEP(x, z, baseW/2, baseW/2, baseH);
    // Tower on top
    addMesh(new THREE.BoxGeometry(towerW, towerH, towerW), mat(hue, 0.28), x, baseH + towerH/2, z);
    addPillarCol(x, z, towerW/2, baseH + towerH);
    // Cap
    addMesh(new THREE.ConeGeometry(towerW * 0.8, 1.0, 4), mat(hue, 0.5), x, baseH + towerH + 0.5, z, Math.PI/4);
    addGlow(x, baseH + towerH + 1.2, z, hue, 1.5, 10);
    occupied.push({ x, z, r: baseW/2 });
  }

// ── Place structures ─────────────────────────────────────────────
  const TYPES = ['pillar','pillar','arch','staircase','ruins','ruins','obelisk','crystal','monument','monument'];
  const count = 14 + Math.floor(rand() * 7); // 14–20 structures

  for (let i = 0; i < count; i++) {
    const type = TYPES[Math.floor(rand() * TYPES.length)];
    const margin = type === 'arch' || type === 'staircase' ? 7 : 5;
    const footprint = type === 'monument' || type === 'arch' ? 4 : type === 'staircase' ? 3.5 : 2;
    const pos = rndPos(margin, footprint);
    if (!pos) continue;
    const { x, z } = pos;
    if      (type === 'pillar')    spawnPillar(x, z);
    else if (type === 'arch')      spawnArch(x, z);
    else if (type === 'staircase') spawnStaircase(x, z);
    else if (type === 'ruins')     spawnRuinCluster(x, z);
    else if (type === 'obelisk')   spawnObelisk(x, z);
    else if (type === 'crystal')   spawnCrystalCluster(x, z);
    else if (type === 'monument')  spawnMonument(x, z);
  }

  // --- Randomise tile base colour ---
  const tileHue = rand();
  const tileCol = new THREE.Color().setHSL(tileHue, 0.72, 0.18);
  for (const t of tileObjects) {
    t.solidColor = tileCol.clone();
    t.mesh.material.color.copy(tileCol);
  }
}

// ------------------------------------------------------------------
// Tile system — platform slowly breaks apart during a match
// ------------------------------------------------------------------

const TILE_COLS        = 6;
const TILE_ROWS        = 6;
const TILE_TOTAL       = TILE_COLS * TILE_ROWS;
const TILE_GRACE_S     = 25;   // seconds before first tile drops
const TILE_INTERVAL    = 10;   // seconds between tile drop events
const TILE_WARN_S      = 3.5;  // warning flash duration
const TILE_SINK_S      = 1.8;  // sinking animation duration

const tileSize   = (PLATFORM_HALF * 2) / TILE_COLS;  // ~8 units
const tileObjects = []; // { mesh, col, row, state:'solid'|'warning'|'sinking'|'gone', timer }

for (let row = 0; row < TILE_ROWS; row++) {
  for (let col = 0; col < TILE_COLS; col++) {
    const tx = -PLATFORM_HALF + tileSize * (col + 0.5);
    const tz = -PLATFORM_HALF + tileSize * (row + 0.5);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(tileSize - 0.12, 4.05, tileSize - 0.12),
      new THREE.MeshStandardMaterial({ color: 0x3d2060, roughness: 0.85, metalness: 0.1 })
    );
    mesh.position.set(tx, -2, tz);
    mesh.receiveShadow = true;
    mesh.castShadow    = false;
    mesh.visible       = false; // hidden until game starts
    scene.add(mesh);
    // solidColor is set by rebuildArena each round
    tileObjects.push({ mesh, col, row, cx: tx, cz: tz, state: 'solid', timer: 0, solidColor: new THREE.Color(0x3d2060) });
  }
}

// Build initial arena layout for the lobby view (tileObjects now populated)
rebuildArena(42);

// Shuffles tile indices using seeded LCG
function shuffleTiles(seed) {
  let s = seed >>> 0;
  function lr() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; }
  const arr = Array.from({ length: TILE_TOTAL }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(lr() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Returns the tile object whose footprint contains (x, z), or null.
function getTileAt(x, z) {
  const half = tileSize / 2;
  for (const t of tileObjects) {
    if (x >= t.cx - half && x <= t.cx + half && z >= t.cz - half && z <= t.cz + half) return t;
  }
  return null;
}

function isTileGone(x, z) {
  const t = getTileAt(x, z);
  return t !== null && t.state === 'gone';
}

// Returns true once a tile is no longer safe to stand/place things on.
function isTileUnstable(x, z) {
  const t = getTileAt(x, z);
  return t !== null && (t.state === 'sinking' || t.state === 'gone');
}

// ------------------------------------------------------------------
// Lightning effect — spawned on a home-run hit
// ------------------------------------------------------------------

function spawnLightningEffect(x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y + 0.7, z);

  // Bright flash light
  const light = new THREE.PointLight(0xffffff, 18, 10);
  group.add(light);

  // Second coloured light for the electric glow
  const glow = new THREE.PointLight(0x88ffff, 8, 6);
  group.add(glow);

  // Generate 8 jagged bolt lines radiating outward
  const boltMat = new THREE.LineBasicMaterial({ color: 0xeeffff });
  const bolts = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const pts = [];
    let cx = 0, cy = 0;
    pts.push(new THREE.Vector3(0, 0, 0));
    for (let s = 1; s <= 5; s++) {
      cx += Math.cos(angle) * 0.28 + (Math.random() - 0.5) * 0.25;
      cy += (Math.random() - 0.5) * 0.35;
      pts.push(new THREE.Vector3(cx, cy, (Math.random() - 0.5) * 0.2));
    }
    const bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), boltMat);
    group.add(bolt);
    bolts.push(bolt);
  }

  scene.add(group);
  activeEffects.push({ group, light, glow, bolts, timer: 0.9, maxTimer: 0.9 });
}

// ------------------------------------------------------------------
// Character factory — shared by local player and every peer
// ------------------------------------------------------------------

function makeCharacter(hexColor) {
  const group = new THREE.Group();
  const color = new THREE.Color(hexColor);

  // ------------------------------------------------------------------
  // Normal body — everything visible when alive; hidden in ghost mode
  // ------------------------------------------------------------------
  const normalBody = new THREE.Group();
  normalBody.position.y = 0.10; // raise body so feet are flush with the ground surface
  group.add(normalBody);

  // Torso — shortened so legs don't clip through the bottom
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.55, 0.3),
    new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.25), roughness: 0.4 })
  );
  torso.position.y = 0.675;
  torso.castShadow = true;
  normalBody.add(torso);

  // Head
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.35, 0.35),
    new THREE.MeshStandardMaterial({ color: 0xffcca0, roughness: 0.7 })
  );
  head.position.y = 1.22;
  head.castShadow = true;
  normalBody.add(head);

  // Arms — pivot group sits at the shoulder so the arm hangs down from it
  const armMat = new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.25), roughness: 0.4 });
  const armGeo = new THREE.BoxGeometry(0.15, 0.55, 0.15);

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.34, 0.92, 0);
  leftArm.rotation.z = 0.15;
  const leftArmMesh = new THREE.Mesh(armGeo, armMat);
  leftArmMesh.position.y = -0.275;
  leftArmMesh.castShadow = true;
  leftArm.add(leftArmMesh);

  // Shield (shown in left hand when equipped) — heater / knight's shield shape
  const shieldEquip = new THREE.Group();
  shieldEquip.position.set(0, -0.56, 0);
  shieldEquip.rotation.x = Math.PI / 2;
  shieldEquip.visible = false;
  const shMat  = new THREE.MeshStandardMaterial({ color: 0xa8b8c8, metalness: 0.75, roughness: 0.22 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x6a7a88, metalness: 0.85, roughness: 0.18 });
  // Heater shape: stack of boxes that get narrower from top → point
  //  row y=0.14  wide top band
  const sR1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.055), shMat);
  sR1.position.y = 0.17; shieldEquip.add(sR1);
  //  row y=0.00  slightly narrower
  const sR2 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.055), shMat);
  sR2.position.y = 0.04; shieldEquip.add(sR2);
  //  row y=-0.13  narrower still
  const sR3 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.055), shMat);
  sR3.position.y = -0.09; shieldEquip.add(sR3);
  //  row y=-0.24  tapering
  const sR4 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.055), shMat);
  sR4.position.y = -0.21; shieldEquip.add(sR4);
  //  pointed bottom tip
  const sR5 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.050), shMat);
  sR5.position.y = -0.31; shieldEquip.add(sR5);
  // Rim border (slightly larger, darker layer behind)
  const rimR1 = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.15, 0.030), rimMat);
  rimR1.position.set(0, 0.17, -0.04); shieldEquip.add(rimR1);
  const rimR2 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.030), rimMat);
  rimR2.position.set(0, 0.04, -0.04); shieldEquip.add(rimR2);
  const rimR3 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.030), rimMat);
  rimR3.position.set(0, -0.09, -0.04); shieldEquip.add(rimR3);
  const rimR4 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.030), rimMat);
  rimR4.position.set(0, -0.21, -0.04); shieldEquip.add(rimR4);
  const rimR5 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.026), rimMat);
  rimR5.position.set(0, -0.31, -0.04); shieldEquip.add(rimR5);
  // Gold cross emblem
  const crossMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.85, roughness: 0.18 });
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.07), crossMat);
  crossH.position.set(0, 0.04, 0.04); shieldEquip.add(crossH);
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.28, 0.07), crossMat);
  crossV.position.set(0, 0.00, 0.04); shieldEquip.add(crossV);
  // shieldEmblem kept as invisible placeholder (code elsewhere toggles it)
  const shieldEmblem = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.001),
    new THREE.MeshStandardMaterial());
  shieldEmblem.visible = false;
  shieldEquip.add(shieldEmblem);
  leftArm.add(shieldEquip);
  normalBody.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.34, 0.92, 0);
  rightArm.rotation.z = -0.15;
  const rightArmMesh = new THREE.Mesh(armGeo, armMat);
  rightArmMesh.position.y = -0.275;
  rightArmMesh.castShadow = true;
  rightArm.add(rightArmMesh);

  // Sword (shown in right hand when equipped) — knight's longsword
  const swordGroup = new THREE.Group();
  swordGroup.position.set(0, -0.55, 0.12);
  swordGroup.rotation.x = Math.PI / 2;
  swordGroup.visible = false;
  const sBladeMat   = new THREE.MeshStandardMaterial({ color: 0xd4dcea, metalness: 0.92, roughness: 0.10 });
  const sFullerMat  = new THREE.MeshStandardMaterial({ color: 0x9aaabf, metalness: 0.88, roughness: 0.14 });
  const sGoldMat    = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.88, roughness: 0.14 });
  const sLeatherMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.85 });
  const sWrapMat    = new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.90 });
  // Blade — wide and flat
  const sBlade = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.52, 0.034), sBladeMat);
  sBlade.position.y = 0.295;
  swordGroup.add(sBlade);
  // Blade tip — 4-sided pyramid, flattened to match blade profile
  const sTip = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.05, 0.15, 4), sBladeMat);
  sTip.position.y = 0.630; // flush with top of blade (0.555) + half tip height (0.075)
  sTip.scale.z = 0.34;     // flatten Z to match blade thickness (0.034 / 0.10)
  swordGroup.add(sTip);
  // Fuller — central channel running the length of the blade
  const sFuller = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.40, 0.038), sFullerMat);
  sFuller.position.y = 0.30;
  swordGroup.add(sFuller);
  // Ricasso — unsharpened base of blade, slightly thicker
  const sRicasso = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.048), sBladeMat);
  sRicasso.position.y = 0.045;
  swordGroup.add(sRicasso);
  // Crossguard — long ornate bar
  const sGuard = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.052, 0.072), sGoldMat);
  swordGroup.add(sGuard);
  // Guard-tip knobs
  for (const sx of [-0.185, 0.185]) {
    const sKnob = new THREE.Mesh(new THREE.SphereGeometry(0.038, 7, 6), sGoldMat);
    sKnob.position.set(sx, 0, 0);
    swordGroup.add(sKnob);
  }
  // Grip — leather core
  const sGrip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.17, 0.042), sLeatherMat);
  sGrip.position.y = -0.10;
  swordGroup.add(sGrip);
  // Grip wrap bands
  for (let wi = 0; wi < 3; wi++) {
    const sWrap = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.024, 0.054), sWrapMat);
    sWrap.position.y = -0.042 + wi * -0.058;
    swordGroup.add(sWrap);
  }
  // Pommel — round gold ball
  const sPommel = new THREE.Mesh(new THREE.SphereGeometry(0.056, 8, 7), sGoldMat);
  sPommel.position.y = -0.205;
  swordGroup.add(sPommel);
  rightArm.add(swordGroup);

  // Boxing glove (shown in right hand when equipped)
  // Centred on the arm (no z-offset) so the arm mesh can never clip through.
  // Sphere half-extents (0.21, 0.19, 0.195) fully contain the 0.15×0.15 arm cross-section
  // all the way up to the wrist where the cuff takes over.
  const gloveGroup = new THREE.Group();
  gloveGroup.position.set(0, -0.44, 0);
  gloveGroup.visible = false;
  // Main glove body
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0xcc2200, roughness: 0.55, metalness: 0.08 });
  const gloveMesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), gloveMat);
  gloveMesh.scale.set(1.4, 1.25, 1.3);   // half-extents ≈ 0.21 × 0.1875 × 0.195
  gloveGroup.add(gloveMesh);
  // Knuckle ridge across the front face
  const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 0.07),
    new THREE.MeshStandardMaterial({ color: 0xdd3300, roughness: 0.5 }));
  knuckle.position.set(0, 0.02, 0.19);
  gloveGroup.add(knuckle);
  // Thumb stub on the side
  const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), gloveMat);
  thumb.scale.set(0.7, 1.05, 0.8);
  thumb.position.set(0.20, 0.05, 0.05);
  gloveGroup.add(thumb);
  // Wrist cuff — radius 0.12 exceeds arm corner diagonal (0.106) so corners never poke through
  const gloveCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }));
  gloveCuff.position.y = 0.25;   // overlaps sphere top, covers wrist up to y ≈ −0.13 arm-local
  gloveGroup.add(gloveCuff);
  // Velcro strap on the cuff
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.035, 0.125),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }));
  strap.position.set(0, 0.285, 0.04);
  gloveGroup.add(strap);
  rightArm.add(gloveGroup);

  // Home run bat (shown in right hand when equipped)
  const batGroup = new THREE.Group();
  batGroup.position.set(0, -0.52, 0.10);
  batGroup.rotation.x = Math.PI / 2;
  batGroup.visible = false;
  const batWoodMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.75, metalness: 0.0 });
  const batTapeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  // Knob at bottom of handle
  const batKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.040, 0.038, 0.04, 10), batWoodMat);
  batKnob.position.y = -0.22;
  batGroup.add(batKnob);
  // Handle (thin grip)
  const batHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.030, 0.28, 10), batWoodMat);
  batHandle.position.y = -0.06;
  batGroup.add(batHandle);
  // Grip tape wrap
  const batTape = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.16, 10), batTapeMat);
  batTape.position.y = -0.10;
  batGroup.add(batTape);
  // Taper from handle to barrel
  const batTaper = new THREE.Mesh(new THREE.CylinderGeometry(0.060, 0.030, 0.12, 10), batWoodMat);
  batTaper.position.y = 0.14;
  batGroup.add(batTaper);
  // Barrel (wide hitting end)
  const batBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.060, 0.22, 12), batWoodMat);
  batBarrel.position.y = 0.31;
  batGroup.add(batBarrel);
  // End cap
  const batCap = new THREE.Mesh(new THREE.SphereGeometry(0.078, 10, 6), batWoodMat);
  batCap.scale.y = 0.55;
  batCap.position.y = 0.42;
  batGroup.add(batCap);
  rightArm.add(batGroup);

  // Banana (shown in right hand when equipped)
  // rotation.x = PI/2 turns the whole group so the banana lies horizontally
  // (pointing forward like the sword/bat). Pieces are centred around y=0 so
  // the character grips the middle of the banana.
  const bananaGroup = new THREE.Group();
  // z=0.26 keeps the bottom tip (cy=-0.22 → z=0.04) just clear of the body.
  // cy=0 is the true arc midpoint so the palm grips the centre of the banana.
  bananaGroup.position.set(0, -0.54, 0.26);
  bananaGroup.rotation.x = Math.PI / 2;
  bananaGroup.visible = false;
  const banMat  = new THREE.MeshStandardMaterial({ color: 0xffe135, roughness: 0.65 });
  const bTipMat = new THREE.MeshStandardMaterial({ color: 0x7a5200, roughness: 0.8 });
  // cx is positive (bows outward, away from body since right arm is at +X).
  // rot.z is negated vs the old version — arc tilts the other way to match.
  // cy is symmetric around 0 so the grip is dead-centre.
  [
    { cx:  0.010, cy: -0.220, rot: -0.52, h: 0.044, w: 0.040, mat: bTipMat },
    { cx:  0.044, cy: -0.120, rot: -0.28, h: 0.140, w: 0.066, mat: banMat  },
    { cx:  0.058, cy:  0.000, rot:  0.00, h: 0.120, w: 0.072, mat: banMat  },
    { cx:  0.036, cy:  0.110, rot:  0.28, h: 0.110, w: 0.064, mat: banMat  },
    { cx:  0.006, cy:  0.193, rot:  0.52, h: 0.080, w: 0.050, mat: banMat  },
    { cx: -0.038, cy:  0.232, rot:  0.72, h: 0.038, w: 0.036, mat: bTipMat },
  ].forEach(({ cx, cy, rot, h, w, mat }) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    m.position.set(cx, cy, 0);
    m.rotation.z = rot;
    bananaGroup.add(m);
  });
  rightArm.add(bananaGroup);

  normalBody.add(rightArm);

  // ── Legs — random trouser colour ────────────────────────────
  const legCols = [0x1a0030,0x0a1a32,0x201008,0x002010,0x1a1a1a,0x2a0a00,0x001820,0x1e1428,0x181818,0x0f1f0f];
  const legMat = new THREE.MeshStandardMaterial({ color: legCols[Math.floor(Math.random()*legCols.length)], roughness: 0.65 });
  const legGeo = new THREE.BoxGeometry(0.17, 0.5, 0.17);
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.13, 0.15, 0);
  leftLeg.castShadow = true;
  normalBody.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.13, 0.15, 0);
  rightLeg.castShadow = true;
  normalBody.add(rightLeg);

  // ── Outfit decoration ────────────────────────────────────────
  const outfitStyle = Math.floor(Math.random() * 8);
  const oHue = Math.random();
  const oMat = (h,s=0.7,l=0.22) => new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(h,s,l), roughness: 0.55 });
  if (outfitStyle === 0) {
    // Horizontal stripes
    const sMat = oMat(oHue, 0.85, 0.52);
    for (let s = 0; s < 3; s++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.055, 0.32), sMat);
      stripe.position.set(0, 0.50 + s * 0.165, 0.001); normalBody.add(stripe);
    }
  } else if (outfitStyle === 1) {
    // Jacket + lapels
    const jBody = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.56, 0.32), oMat(oHue, 0.5, 0.14));
    jBody.position.set(0, 0.675, 0.001); normalBody.add(jBody);
    const lapMat = oMat(oHue, 0.4, 0.70);
    for (const lx of [-0.1, 0.1]) {
      const lap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.02), lapMat);
      lap.position.set(lx, 0.76, 0.165); normalBody.add(lap);
    }
  } else if (outfitStyle === 2) {
    // Cape behind
    const cape = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.70, 0.06), oMat(oHue, 0.8, 0.20));
    cape.position.set(0, 0.65, -0.18); normalBody.add(cape);
  } else if (outfitStyle === 3) {
    // Vest front
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.52, 0.07), oMat(oHue, 0.7, 0.20));
    vest.position.set(0, 0.675, 0.165); normalBody.add(vest);
  } else if (outfitStyle === 4) {
    // Turtleneck scarf
    const scarf = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.16, 12), oMat(oHue, 0.75, 0.32));
    scarf.position.set(0, 0.965, 0); normalBody.add(scarf);
  } else if (outfitStyle === 5) {
    // Hoodie pockets + waistband
    const hm = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.6), roughness: 0.75 });
    for (const px of [-0.15, 0.15]) {
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.11, 0.04), hm);
      pocket.position.set(px, 0.52, 0.17); normalBody.add(pocket);
    }
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.32), hm);
    band.position.set(0, 0.445, 0); normalBody.add(band);
  } else if (outfitStyle === 6) {
    // Bow tie
    const btMat = oMat(oHue, 0.9, 0.45);
    for (const bx of [-0.08, 0.08]) {
      const bt = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.04), btMat);
      bt.position.set(bx, 0.97, 0.165); normalBody.add(bt);
    }
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.045), btMat);
    knot.position.set(0, 0.97, 0.165); normalBody.add(knot);
  }
  // outfitStyle 7 = plain

  // ── Face ─────────────────────────────────────────────────────
  const faceStyle  = Math.floor(Math.random() * 5);
  const pupilCols  = [0x110022,0x1a0800,0x001a10,0x001828,0x1a0010,0x200000];
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const eyePupilMat = new THREE.MeshStandardMaterial({ color: pupilCols[Math.floor(Math.random()*pupilCols.length)], roughness: 0.2 });
  for (const ex of [-0.09, 0.09]) {
    if (faceStyle === 3) {
      // Happy crescents — flat discs
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.01, 10), eyePupilMat);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(ex, 1.262, 0.179); normalBody.add(disc);
    } else {
      const scaleY = faceStyle === 1 ? 0.5 : faceStyle === 2 ? 1.45 : 1.0; // squint / wide / normal
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 8), eyeWhiteMat);
      white.scale.y = scaleY;
      white.position.set(ex, 1.255, 0.175); normalBody.add(white);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.034, 8, 8), eyePupilMat);
      pupil.position.set(ex, 1.255, 0.212); normalBody.add(pupil);
      if (faceStyle === 4) {
        // Star / sparkle pupils
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.026),
          new THREE.MeshStandardMaterial({ color: 0xffdd00, emissive: new THREE.Color(0xffaa00), emissiveIntensity: 0.7, roughness: 0.2 }));
        star.position.set(ex, 1.255, 0.215); normalBody.add(star);
      }
    }
  }
  // Eyebrows (70% chance, angry tilt for faceStyle 0)
  if (faceStyle !== 3 && Math.random() > 0.3) {
    const browMat = new THREE.MeshStandardMaterial({ color: 0x0d0008, roughness: 0.9 });
    const angry = faceStyle === 0 && Math.random() > 0.5;
    for (const ex of [-0.09, 0.09]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.024, 0.02), browMat);
      brow.rotation.z = angry ? (ex < 0 ? -0.45 : 0.45) : 0;
      brow.position.set(ex, 1.306, 0.178); normalBody.add(brow);
    }
  }
  // Mouth (60% chance)
  if (Math.random() > 0.4) {
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.07 + Math.random() * 0.07, 0.022, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x550018, roughness: 0.8 }));
    mouth.position.set(0, 1.197, 0.178); normalBody.add(mouth);
  }
  // Freckles (20% chance)
  if (Math.random() < 0.2) {
    const frMat = new THREE.MeshStandardMaterial({ color: 0xc06830, roughness: 0.95 });
    for (let f = 0; f < 4; f++) {
      const fr = new THREE.Mesh(new THREE.SphereGeometry(0.011, 5, 4), frMat);
      fr.position.set((f < 2 ? -1 : 1) * (0.07 + Math.random() * 0.04), 1.215 + Math.random() * 0.03, 0.179);
      normalBody.add(fr);
    }
  }

  // ── Hair ─────────────────────────────────────────────────────
  const hairStyle = Math.floor(Math.random() * 9); // 8 = bald
  const hairHue   = Math.random();
  const wildHair  = Math.random() > 0.85;
  const hairMat   = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hairHue, wildHair ? 0.95 : 0.5 + Math.random() * 0.3, wildHair ? 0.45 + Math.random() * 0.3 : 0.12 + Math.random() * 0.18),
    roughness: 0.9
  });
  if (hairStyle === 0) {
    // Spiky
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.22, 5), hairMat);
      sp.position.set(Math.sin(a) * 0.12, 1.53, Math.cos(a) * 0.12); normalBody.add(sp);
    }
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.24, 5), hairMat);
    tuft.position.y = 1.57; normalBody.add(tuft);
  } else if (hairStyle === 1) {
    // Side swept
    const swept = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.10, 0.34), hairMat);
    swept.position.set(0.07, 1.47, 0.02); swept.rotation.z = -0.28; normalBody.add(swept);
  } else if (hairStyle === 2) {
    // Mohawk
    const hawk = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.26, 0.32), hairMat);
    hawk.position.set(0, 1.535, 0); normalBody.add(hawk);
  } else if (hairStyle === 3) {
    // Afro
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const curl = new THREE.Mesh(new THREE.SphereGeometry(0.10, 7, 5), hairMat);
      curl.position.set(Math.sin(a) * 0.17, 1.48 + Math.abs(Math.sin(a * 1.3)) * 0.04, Math.cos(a) * 0.17);
      normalBody.add(curl);
    }
    const topAfro = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 5), hairMat);
    topAfro.position.y = 1.57; normalBody.add(topAfro);
  } else if (hairStyle === 4) {
    // Long straight
    const cap4 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.36), hairMat);
    cap4.position.y = 1.47; normalBody.add(cap4);
    for (const hx of [-0.16, 0.16]) {
      const strand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.42, 0.07), hairMat);
      strand.position.set(hx, 1.27, -0.02); normalBody.add(strand);
    }
  } else if (hairStyle === 5) {
    // Pigtails
    const cap5 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.34), hairMat);
    cap5.position.y = 1.47; normalBody.add(cap5);
    for (const hx of [-0.21, 0.21]) {
      const pt = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.028, 0.24, 8), hairMat);
      pt.position.set(hx, 1.22, 0.01); normalBody.add(pt);
    }
  } else if (hairStyle === 6) {
    // Flat top
    const flat = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.13, 0.33), hairMat);
    flat.position.y = 1.505; normalBody.add(flat);
  } else if (hairStyle === 7) {
    // Bob cut
    for (const hx of [-0.175, 0.175]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.28, 0.32), hairMat);
      side.position.set(hx, 1.28, -0.01); normalBody.add(side);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.28, 0.08), hairMat);
    back.position.set(0, 1.28, -0.17); normalBody.add(back);
    const cap7 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, 0.34), hairMat);
    cap7.position.y = 1.47; normalBody.add(cap7);
  }
  // hairStyle 8 = bald

  // ── Hat (10 styles; style 9 = no hat so hair shows) ──────────
  const hatStyle  = Math.floor(Math.random() * 10);
  const hColArr   = [0x1a0030,0x8b1a00,0x0a3a0a,0x1a1a1a,0x7a3800,0x001a3a,0x2a2a00,0x3a001a,0x00253a,0x1a2000];
  const hAccArr   = [0xc64bff,0xff4f4f,0x4fff88,0xffcc00,0xff8c00,0x4fddff,0xffff44,0xff44cc,0x44ffee,0xaaff44];
  const hIdx      = Math.floor(Math.random() * hColArr.length);
  const hMat      = new THREE.MeshStandardMaterial({ color: hColArr[hIdx], roughness: 0.5, metalness: 0.1 });
  const hAccM     = new THREE.MeshStandardMaterial({ color: hAccArr[hIdx], emissive: new THREE.Color(hAccArr[hIdx]).multiplyScalar(0.4), roughness: 0.3 });

  if (hatStyle === 0) {
    // Top hat
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 16), hMat);
    brim.position.y = 1.44; brim.castShadow = true; normalBody.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.20, 0.42, 16), hMat);
    crown.position.y = 1.69; crown.castShadow = true; normalBody.add(crown);
    const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.07, 16), hAccM);
    ribbon.position.y = 1.49; normalBody.add(ribbon);

  } else if (hatStyle === 1) {
    // Pointed witch hat
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.10, 3), hMat);
    base.position.y = 1.46; base.castShadow = true; normalBody.add(base);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.22, 0.46, 3), hMat);
    crown.position.y = 1.69; crown.castShadow = true; normalBody.add(crown);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.04), hAccM);
    skull.position.set(0, 1.52, 0.31); normalBody.add(skull);

  } else if (hatStyle === 2) {
    // Beret
    const beret = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.10, 16), hMat);
    beret.position.y = 1.47; beret.castShadow = true; normalBody.add(beret);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.20, 10, 6), hMat);
    puff.scale.y = 0.55; puff.position.y = 1.54; normalBody.add(puff);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), hAccM);
    button.position.y = 1.67; normalBody.add(button);

  } else if (hatStyle === 3) {
    // Crown
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 16, 1, true), hAccM);
    ring.position.y = 1.51; normalBody.add(ring);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 6), hAccM);
      spike.position.set(Math.sin(a) * 0.20, 1.69, Math.cos(a) * 0.20); normalBody.add(spike);
    }
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.05),
      new THREE.MeshStandardMaterial({ color: 0xff2255, emissive: 0x880022, metalness: 1, roughness: 0 }));
    gem.position.y = 1.52; normalBody.add(gem);

  } else if (hatStyle === 4) {
    // Fedora
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 16), hMat);
    brim.position.y = 1.44; brim.castShadow = true; normalBody.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.28, 16), hMat);
    crown.position.y = 1.62; crown.castShadow = true; normalBody.add(crown);
    const dent = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 5), hMat);
    dent.scale.y = 0.5; dent.position.y = 1.74; normalBody.add(dent);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.06, 16), hAccM);
    band.position.y = 1.49; normalBody.add(band);

  } else if (hatStyle === 5) {
    // Baseball cap
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.20), hMat);
    peak.position.set(0, 1.44, 0.14); peak.castShadow = true; normalBody.add(peak);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.16, 16), hMat);
    body.position.y = 1.54; normalBody.add(body);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.04, 16), hAccM);
    top.position.y = 1.63; normalBody.add(top);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.03), hAccM);
    badge.position.set(0, 1.55, 0.24); normalBody.add(badge);

  } else if (hatStyle === 6) {
    // Bucket hat
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.05, 16), hMat);
    brim.position.y = 1.44; normalBody.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.30, 0.22, 16), hMat);
    crown.position.y = 1.58; normalBody.add(crown);
    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16), hMat);
    topCap.position.y = 1.70; normalBody.add(topCap);

  } else if (hatStyle === 7) {
    // Pirate tricorn
    const triBase = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.05, 3), hMat);
    triBase.position.y = 1.44; normalBody.add(triBase);
    const triCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.26, 0.20, 3), hMat);
    triCrown.position.y = 1.585; normalBody.add(triCrown);
    const triDeco = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.03), hAccM);
    triDeco.position.set(0, 1.52, 0.30); normalBody.add(triDeco);

  } else if (hatStyle === 8) {
    // Beanie / slouch with pom-pom
    const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 8), hMat);
    beanie.scale.y = 0.85; beanie.position.y = 1.52; normalBody.add(beanie);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.08, 14), hAccM);
    band.position.y = 1.44; normalBody.add(band);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), hAccM);
    pom.position.y = 1.73; normalBody.add(pom);
  }
  // hatStyle 9 = no hat (hair only)

  // Armor group — chest plate (front + back) only, no helmet
  const armorGroup = new THREE.Group();
  const armorMat = new THREE.MeshStandardMaterial({ color: 0xb8c8d8, metalness: 0.85, roughness: 0.18 });
  // Front chest plate
  const chestFront = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.52, 0.10), armorMat);
  chestFront.position.set(0, 0.68, 0.20);
  armorGroup.add(chestFront);
  // Back plate
  const chestBack = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.52, 0.10), armorMat);
  chestBack.position.set(0, 0.68, -0.20);
  armorGroup.add(chestBack);
  // Small ridge / trim strip across the front
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.04, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.9, roughness: 0.12 }));
  trim.position.set(0, 0.90, 0.20);
  armorGroup.add(trim);
  armorGroup.visible = false;
  normalBody.add(armorGroup);

  // Per-character glow (alive)
  const charGlow = new THREE.PointLight(color, 1.5, 3);
  charGlow.position.y = 0.8;
  normalBody.add(charGlow);

  // ------------------------------------------------------------------
  // Ghost body — shown instead of normalBody when dead
  // ------------------------------------------------------------------
  const ghostBody = new THREE.Group();
  ghostBody.visible = false;
  group.add(ghostBody);

  const ghostMat = new THREE.MeshStandardMaterial({
    color: 0xd8eeff,
    emissive: new THREE.Color(0x66aaff).multiplyScalar(0.35),
    roughness: 0.25,
    transparent: true,
    opacity: 0.92,
  });

  // Large rounded head blob
  const gHead = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 10), ghostMat);
  gHead.scale.set(1, 1.18, 1);
  gHead.position.y = 1.08;
  ghostBody.add(gHead);

  // Body cylinder — connects head to wispy bottom
  const gTorso = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.30, 0.52, 14), ghostMat);
  gTorso.position.y = 0.64;
  ghostBody.add(gTorso);

  // Wispy tail strands — inverted cones (wide at top, tip hangs down)
  const tailDefs = [
    { x: -0.13, z:  0.06, rx: -0.18, rz:  0.15 },
    { x:  0.04, z: -0.16, rx:  0.14, rz: -0.10 },
    { x:  0.14, z:  0.13, rx:  0.08, rz:  0.20 },
  ];
  for (const td of tailDefs) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.46, 8), ghostMat);
    tail.rotation.x = Math.PI + td.rx; // flip so tip points down, then tilt
    tail.rotation.z = td.rz;
    tail.position.set(td.x, 0.30, td.z);
    ghostBody.add(tail);
  }

  // Hollow glowing eyes
  const ghostEyeMat = new THREE.MeshStandardMaterial({
    color: 0x001122,
    emissive: new THREE.Color(0x00ddff),
    emissiveIntensity: 1.2,
    roughness: 0.1,
  });
  for (const ex of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.074, 10, 8), ghostEyeMat);
    eye.position.set(ex, 1.16, 0.35);
    ghostBody.add(eye);
    // Small inner pupil — pure black void
    const void_ = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 }));
    void_.position.set(ex, 1.16, 0.415);
    ghostBody.add(void_);
  }

  // Ghost point light — soft cyan glow
  const ghostGlow = new THREE.PointLight(0x88ddff, 2.8, 6);
  ghostGlow.position.y = 0.9;
  ghostBody.add(ghostGlow);

  // Rocket boots — parented to each leg so they swing with foot movement.
  // Leg geometry: height 0.5, centred at y=0.15 in normalBody → leg local y=0.
  // Leg bottom in leg-local space = -0.25.
  // Boot group at leg-local y=-0.20: sole (h=0.10) bottom = -0.25 in leg space
  //   → normalBody y = 0.15 + (-0.25) = -0.10 = world y 0 (floor). No clip.
  const bootsMat    = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.35, metalness: 0.75 });
  const thrusterMat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: new THREE.Color(0xff3300), emissiveIntensity: 0.8, roughness: 0.3 });

  function makeOneBoot() {
    const boot = new THREE.Group();
    // Centred on the leg (leg already carries its own x offset)
    boot.position.set(0, -0.20, 0);
    boot.visible = false;

    // Sole
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.10, 0.30), bootsMat);
    boot.add(sole);

    // Ankle cuff — wraps the lower leg above the sole
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.22), bootsMat);
    cuff.position.y = 0.12;
    boot.add(cuff);

    // Heel thruster — horizontal cylinder, nozzle faces backward (-z)
    const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.16, 8), thrusterMat);
    thruster.rotation.x = Math.PI / 2;
    thruster.position.set(0, 0.06, -0.20);
    boot.add(thruster);

    // Side fins
    const finGeo = new THREE.BoxGeometry(0.04, 0.14, 0.10);
    const finL = new THREE.Mesh(finGeo, bootsMat);
    finL.position.set( 0.13, 0.07, -0.08);
    boot.add(finL);
    const finR = new THREE.Mesh(finGeo, bootsMat);
    finR.position.set(-0.13, 0.07, -0.08);
    boot.add(finR);

    return boot;
  }

  const leftBootMesh  = makeOneBoot();
  const rightBootMesh = makeOneBoot();
  leftLeg.add(leftBootMesh);   // inherits leftLeg's swing rotation
  rightLeg.add(rightBootMesh); // inherits rightLeg's swing rotation

  // Proxy object — same .visible API as before, controls both boots at once
  const bootsGroup = {
    get visible() { return leftBootMesh.visible; },
    set visible(v) { leftBootMesh.visible = v; rightBootMesh.visible = v; }
  };

  return { group, normalBody, ghostBody, leftArm, rightArm, leftLeg, rightLeg, swordGroup, gloveGroup, batGroup, bananaGroup, shieldEquip, shieldEmblem, armorGroup, bootsGroup };
}

// ------------------------------------------------------------------
// Local player
// ------------------------------------------------------------------

const { group: playerGroup, normalBody: playerNormalBody, ghostBody: playerGhostBody,
        leftArm, rightArm, leftLeg, rightLeg,
        swordGroup: playerSword, gloveGroup: playerGlove, batGroup: playerBat,
        bananaGroup: playerBanana,
        shieldEquip: playerShield, shieldEmblem: playerShieldEmblem,
        armorGroup: playerArmorGroup, bootsGroup: playerBoots } = makeCharacter('#' + incoming.color);
scene.add(playerGroup);


// ------------------------------------------------------------------
// Item system
// ------------------------------------------------------------------

const MAX_ITEMS       = 6;
const ITEM_INTERVAL   = 5000; // ms between item spawn attempts
const ITEM_LIFETIME   = 20;    // seconds before an uncollected item despawns
const ITEM_PICKUP_R   = 1.4;   // metres to pick up item
const SWORD_KNOCKBACK       = 38;
const GLOVE_KNOCKBACK       = 70;
const BAT_HOME_RUN_KNOCKBACK = 260;
const BAT_NORMAL_KNOCKBACK  = 8;

let itemTimer  = Date.now() + 5000; // first item after 5s
const groundItems = []; // { group, type, x, z, id, expires }
let isHost = false;         // true for the player who started the match (item authority)
let sendItemEvent = null;   // P2P action for item sync
let _nextItemId = 0;
function nextItemId() { return ++_nextItemId; }
let hasSword       = false;
let swordDurability  = 0;
let hasShield      = false;
let shieldDurability = 0;
let hasGlove       = false;
let gloveDurability  = 0;
let hasBat         = false;
let batDurability    = 0;
let hasBoots      = false;
let bootsDurability = 0;
let hasDoubleJumped      = false; // consumed when double jump used
let isBlocking           = false;
let hasBanana            = false;
let bananaDurability     = 0;
let bananaImmunityTimer  = 0;   // >0 = placer is immune to their own peel
let isSlipping           = false;
let slipTimer            = 0;

// Active banana peels in the arena: { group, x, z, id }
const bananaPeels = [];
let _nextPeelId   = 0;
function nextPeelId() { return ++_nextPeelId; }
let sendPeel = null; // P2P action for peel sync

const SWORD_DURABILITY   = 10;
const SHIELD_DURABILITY  = 7;
const GLOVE_DURABILITY   = 2;
const BAT_DURABILITY     = 1;
const BOOTS_DURABILITY   = 6;
const BANANA_DURABILITY  = 1;
const BANANA_SLIDE_FORCE = 42;  // horizontal slide speed; at PUNCH_DECAY=2.5 this ≈ 2 tile-lengths
const BANANA_IMMUNITY    = 2.0; // seconds placer is immune after dropping peel
const PEEL_PICKUP_R      = 1.1; // metres — collision radius for slipping on peel

// Active lightning effects { group, light, bolts, timer, maxTimer }
const activeEffects = [];
const durabilityEl = document.getElementById('durability');

// Safe random position on the platform (away from edges, pillars, other items, unstable tiles).
// Returns null if no valid spot found.
function randomItemPos() {
  const margin = 3;
  for (let tries = 0; tries < 40; tries++) {
    const x = (Math.random() * 2 - 1) * (PLATFORM_HALF - margin);
    const z = (Math.random() * 2 - 1) * (PLATFORM_HALF - margin);
    const tooClose = pillarData.some(p => Math.hypot(x - p.x, z - p.z) < 2.5);
    const overlap  = groundItems.some(it => Math.hypot(x - it.x, z - it.z) < 2.0);
    const badTile  = isTileUnstable(x, z) || isTileGone(x, z);
    if (!tooClose && !overlap && !badTile) return { x, z };
  }
  return null;
}

function makeGroundItem(type, x, z, id = nextItemId()) {
  const g = new THREE.Group();
  if (type === 'sword') {
    // Knight's longsword — matches the equipped model geometry/materials
    const gBladeMat   = new THREE.MeshStandardMaterial({ color: 0xd4dcea, metalness: 0.92, roughness: 0.10 });
    const gFullerMat  = new THREE.MeshStandardMaterial({ color: 0x9aaabf, metalness: 0.88, roughness: 0.14 });
    const gGoldMat    = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.88, roughness: 0.14 });
    const gLeatherMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.85 });
    const gWrapMat    = new THREE.MeshStandardMaterial({ color: 0x3a2010, roughness: 0.90 });
    // Assemble sword upright along Y (guard at y=0.10, blade above, handle/pommel below)
    // Blade
    const gBlade = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.52, 0.034), gBladeMat);
    gBlade.position.y = 0.425;
    g.add(gBlade);
    // Blade tip — 4-sided pyramid, flattened to match blade profile
    const gTip = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.05, 0.15, 4), gBladeMat);
    gTip.position.y = 0.760; // flush with blade top (0.685) + half tip height (0.075)
    gTip.scale.z = 0.34;
    g.add(gTip);
    // Fuller
    const gFuller = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.40, 0.038), gFullerMat);
    gFuller.position.y = 0.43;
    g.add(gFuller);
    // Ricasso
    const gRicasso = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.048), gBladeMat);
    gRicasso.position.y = 0.175;
    g.add(gRicasso);
    // Crossguard
    const gGuard = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.052, 0.072), gGoldMat);
    gGuard.position.y = 0.13;
    g.add(gGuard);
    // Guard-tip knobs
    for (const gx of [-0.185, 0.185]) {
      const gKnob = new THREE.Mesh(new THREE.SphereGeometry(0.038, 7, 6), gGoldMat);
      gKnob.position.set(gx, 0.13, 0);
      g.add(gKnob);
    }
    // Grip
    const gGrip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.17, 0.042), gLeatherMat);
    gGrip.position.y = 0.025;
    g.add(gGrip);
    // Wrap bands
    for (let wi = 0; wi < 3; wi++) {
      const gWrap = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.024, 0.054), gWrapMat);
      gWrap.position.y = 0.088 + wi * -0.058;
      g.add(gWrap);
    }
    // Pommel
    const gPommel = new THREE.Mesh(new THREE.SphereGeometry(0.056, 8, 7), gGoldMat);
    gPommel.position.y = -0.075;
    g.add(gPommel);
  } else if (type === 'shield') {
    // Heater / knight's shield — silver with gold cross, sitting upright on ground
    const gShMat  = new THREE.MeshStandardMaterial({ color: 0xa8b8c8, metalness: 0.75, roughness: 0.22 });
    const gRimMat = new THREE.MeshStandardMaterial({ color: 0x6a7a88, metalness: 0.85, roughness: 0.18 });
    const gCrsMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.85, roughness: 0.18 });
    // Base offset so bottom tip sits just above y=0
    const sy = 0.46; // centre of shield sits at this height
    const gR1 = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.20, 0.075), gShMat);
    gR1.position.y = sy + 0.24; g.add(gR1);
    const gR2 = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.17, 0.075), gShMat);
    gR2.position.y = sy + 0.06; g.add(gR2);
    const gR3 = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.17, 0.075), gShMat);
    gR3.position.y = sy - 0.12; g.add(gR3);
    const gR4 = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.14, 0.075), gShMat);
    gR4.position.y = sy - 0.29; g.add(gR4);
    const gR5 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.066), gShMat);
    gR5.position.y = sy - 0.43; g.add(gR5);
    // Rim
    const gRim1 = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.21, 0.038), gRimMat);
    gRim1.position.set(0, sy + 0.24, -0.056); g.add(gRim1);
    const gRim2 = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.18, 0.038), gRimMat);
    gRim2.position.set(0, sy + 0.06, -0.056); g.add(gRim2);
    const gRim3 = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.18, 0.038), gRimMat);
    gRim3.position.set(0, sy - 0.12, -0.056); g.add(gRim3);
    const gRim4 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.15, 0.038), gRimMat);
    gRim4.position.set(0, sy - 0.29, -0.056); g.add(gRim4);
    const gRim5 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.033), gRimMat);
    gRim5.position.set(0, sy - 0.43, -0.056); g.add(gRim5);
    // Gold cross
    const gCH = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.062, 0.09), gCrsMat);
    gCH.position.set(0, sy + 0.06, 0.055); g.add(gCH);
    const gCV = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.38, 0.09), gCrsMat);
    gCV.position.set(0, sy - 0.01, 0.055); g.add(gCV);
  } else if (type === 'bat') {
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.75 });
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    // Build all pieces in a sub-group along the Y axis so they connect seamlessly,
    // then tilt the whole sub-group as one unit.
    const batMesh = new THREE.Group();
    // Knob at very bottom (y=0 → 0.06)
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.06, 8), woodMat);
    knob.position.y = 0.03;
    batMesh.add(knob);
    // Handle (y=0.06 → 0.38)
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.32, 8), woodMat);
    handle.position.y = 0.22;
    batMesh.add(handle);
    // Grip tape (y=0.06 → 0.22)
    const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.042, 0.16, 8), tapeMat);
    tape.position.y = 0.14;
    batMesh.add(tape);
    // Taper (y=0.38 → 0.52)
    const taper = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.03, 0.14, 8), woodMat);
    taper.position.y = 0.45;
    batMesh.add(taper);
    // Barrel (y=0.52 → 0.78)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.26, 10), woodMat);
    barrel.position.y = 0.65;
    batMesh.add(barrel);
    // End cap
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.05, 10), woodMat);
    cap.position.y = 0.805;
    batMesh.add(cap);
    // Tilt the whole assembled bat as one piece
    batMesh.rotation.z = 0.38;
    batMesh.position.y = 0.05;
    g.add(batMesh);
  } else if (type === 'boots') {
    // Matches the equipped character boots (makeOneBoot) exactly
    const bMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.35, metalness: 0.75 });
    const tMat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: new THREE.Color(0xff3300), emissiveIntensity: 0.8, roughness: 0.3 });
    for (const side of [-1, 1]) {
      const boot = new THREE.Group();
      // Lift so boot sole bottom sits at y=0
      boot.position.set(side * 0.19, 0.05, 0);
      // Sole
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.10, 0.30), bMat);
      boot.add(sole);
      // Ankle cuff
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.22), bMat);
      cuff.position.y = 0.12;
      boot.add(cuff);
      // Heel thruster — horizontal cylinder, nozzle faces backward
      const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.16, 8), tMat);
      thruster.rotation.x = Math.PI / 2;
      thruster.position.set(0, 0.06, -0.20);
      boot.add(thruster);
      // Side fins
      const finGeo = new THREE.BoxGeometry(0.04, 0.14, 0.10);
      const finL = new THREE.Mesh(finGeo, bMat);
      finL.position.set( 0.13, 0.07, -0.08);
      boot.add(finL);
      const finR = new THREE.Mesh(finGeo, bMat);
      finR.position.set(-0.13, 0.07, -0.08);
      boot.add(finR);
      g.add(boot);
    }
    // Faint orange glow
    const glow = new THREE.PointLight(0xff6600, 0.7, 2.5);
    glow.position.y = 0.1;
    g.add(glow);
  } else if (type === 'banana') {
    const banMat2 = new THREE.MeshStandardMaterial({ color: 0xffe135, roughness: 0.65 });
    const tipMat2 = new THREE.MeshStandardMaterial({ color: 0x7a5200, roughness: 0.8 });
    // Same arc as the held version, scaled ~1.3× and offset so stem sits above ground
    const bMeshG = new THREE.Group();
    bMeshG.position.set(0.06, 0.32, 0); // centre of arc sits ~0.32 above ground
    [
      { cx: -0.013, cy: -0.273, rot:  0.52, h: 0.057, w: 0.052, mat: tipMat2 },
      { cx: -0.057, cy: -0.149, rot:  0.28, h: 0.182, w: 0.086, mat: banMat2 },
      { cx: -0.075, cy:  0.016, rot:  0.00, h: 0.156, w: 0.094, mat: banMat2 },
      { cx: -0.047, cy:  0.163, rot: -0.28, h: 0.143, w: 0.083, mat: banMat2 },
      { cx:  0.008, cy:  0.267, rot: -0.52, h: 0.104, w: 0.065, mat: banMat2 },
      { cx:  0.049, cy:  0.322, rot: -0.72, h: 0.049, w: 0.047, mat: tipMat2 },
    ].forEach(({ cx, cy, rot, h, w, mat }) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
      m.position.set(cx, cy, 0);
      m.rotation.z = rot;
      bMeshG.add(m);
    });
    g.add(bMeshG);
    const bGlow = new THREE.PointLight(0xffee00, 0.5, 2.0);
    bGlow.position.y = 0.35; g.add(bGlow);
  } else { // glove — matches the equipped version geometry
    const gGloveMat = new THREE.MeshStandardMaterial({ color: 0xcc2200, roughness: 0.55, metalness: 0.08 });
    // Main glove body (sphere, scaled wider than tall)
    const gBody = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), gGloveMat);
    gBody.scale.set(1.4, 1.25, 1.3);
    gBody.position.y = 0.26;
    g.add(gBody);
    // Knuckle ridge
    const gKnuckle = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.072, 0.085),
      new THREE.MeshStandardMaterial({ color: 0xdd3300, roughness: 0.5 }));
    gKnuckle.position.set(0, 0.275, 0.22);
    g.add(gKnuckle);
    // Thumb stub
    const gThumb = new THREE.Mesh(new THREE.SphereGeometry(0.096, 8, 6), gGloveMat);
    gThumb.scale.set(0.7, 1.05, 0.8);
    gThumb.position.set(0.24, 0.29, 0.06);
    g.add(gThumb);
    // White wrist cuff
    const gCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.13, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }));
    gCuff.position.y = 0.48;
    g.add(gCuff);
    // Velcro strap
    const gStrap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.042, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }));
    gStrap.position.set(0, 0.525, 0.05);
    g.add(gStrap);
    const glow = new THREE.PointLight(0xff4400, 0.6, 2.5);
    glow.position.y = 0.3;
    g.add(glow);
  }
  g.position.set(x, 0.1, z);
  scene.add(g);
  return { group: g, type, x, z, id, expires: performance.now() / 1000 + ITEM_LIFETIME };
}

// Creates a banana peel Three.js group at (x, z) and adds it to the scene.
function makeBananaPeel(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0.03, z);
  const peelMat = new THREE.MeshStandardMaterial({ color: 0xd4b800, roughness: 0.8, side: THREE.DoubleSide });
  // 4 flaps radiating out
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.30), peelMat);
    flap.position.set(Math.sin(angle) * 0.16, 0, Math.cos(angle) * 0.16);
    flap.rotation.y = angle;
    g.add(flap);
  }
  // Center nub
  const center = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.035, 8), peelMat);
  g.add(center);
  g.rotation.y = Math.random() * Math.PI * 2; // random orientation each time
  scene.add(g);
  return g;
}

// Place a peel at the player's position and broadcast to peers.
function placePeel() {
  const x = playerGroup.position.x;
  const z = playerGroup.position.z;
  const id = nextPeelId();
  const group = makeBananaPeel(x, z);
  bananaPeels.push({ group, x, z, id });
  bananaImmunityTimer = BANANA_IMMUNITY;
  window.SFX?.bananaPlace();
  sendPeel?.({ act: 'place', id, x, z });
  // Consume banana
  hasBanana = false; bananaDurability = 0;
  playerBanana.visible = false;
  window.SFX?.itemBreak();
  updateDurabilityHUD();
}

// Remove a peel by id from the scene and array.
function removePeelById(id) {
  const idx = bananaPeels.findIndex(p => p.id === id);
  if (idx !== -1) {
    scene.remove(bananaPeels[idx].group);
    bananaPeels.splice(idx, 1);
  }
}

function pipBar(cur, max) {
  const ratio = cur / max;
  const color = ratio > 0.5 ? '#7fff7f' : ratio > 0.25 ? '#ffcc00' : '#ff4444';
  const pips  = '█'.repeat(cur) + '░'.repeat(max - cur);
  return `<span style="color:${color};letter-spacing:1px">${pips}</span>`;
}

function updateDurabilityHUD() {
  if (!durabilityEl) return;
  const parts = [];
  if (hasSword)  parts.push(`⚔ ${pipBar(swordDurability,  SWORD_DURABILITY)}`);
  if (hasGlove)  parts.push(`🥊 ${pipBar(gloveDurability,  GLOVE_DURABILITY)}`);
  if (hasBat)    parts.push(`🏏 ${pipBar(batDurability,    BAT_DURABILITY)}`);
  if (hasBoots)   parts.push(`🚀 ${pipBar(bootsDurability,  BOOTS_DURABILITY)}`);
  if (hasShield)  parts.push(`🛡 ${pipBar(shieldDurability, SHIELD_DURABILITY)}`);
  if (hasBanana)  parts.push(`🍌 ${pipBar(bananaDurability, BANANA_DURABILITY)}`);
  durabilityEl.innerHTML = parts.join('&nbsp;&nbsp;');
}

function equipItem(type) {
  if (type === 'sword') {
    hasSword = true; swordDurability = SWORD_DURABILITY;
    playerSword.visible = true;
  } else if (type === 'glove') {
    hasGlove = true; gloveDurability = GLOVE_DURABILITY;
    playerGlove.visible = true;
  } else if (type === 'bat') {
    hasBat = true; batDurability = BAT_DURABILITY;
    playerBat.visible = true;
  } else if (type === 'boots') {
    hasBoots = true; bootsDurability = BOOTS_DURABILITY;
    hasDoubleJumped = false;
    playerBoots.visible = true;
  } else if (type === 'banana') {
    hasBanana = true; bananaDurability = BANANA_DURABILITY;
    playerBanana.visible = true;
  } else {
    hasShield = true; shieldDurability = SHIELD_DURABILITY;
    playerShield.visible = true;
  }
  window.SFX?.pickup();
  updateDurabilityHUD();
}

function breakSword() {
  hasSword = false; swordDurability = 0;
  playerSword.visible = false;
  window.SFX?.itemBreak();
  updateDurabilityHUD();
}

function breakGlove() {
  hasGlove = false; gloveDurability = 0;
  playerGlove.visible = false;
  window.SFX?.itemBreak();
  updateDurabilityHUD();
}

function breakBat() {
  hasBat = false; batDurability = 0;
  playerBat.visible = false;
  window.SFX?.itemBreak();
  updateDurabilityHUD();
}

function breakBoots() {
  hasBoots = false; bootsDurability = 0;
  playerBoots.visible = false;
  hasDoubleJumped = false;
  window.SFX?.itemBreak();
  updateDurabilityHUD();
}

function breakShield() {
  hasShield = false; shieldDurability = 0;
  playerShield.visible = false;
  window.SFX?.shieldBreak();
  updateDurabilityHUD();
}

function breakBanana() {
  hasBanana = false; bananaDurability = 0;
  playerBanana.visible = false;
  window.SFX?.itemBreak();
  updateDurabilityHUD();
}

function dropItem() {
  const px = playerGroup.position.x, pz = playerGroup.position.z;
  const dropAngle = playerGroup.rotation.y + Math.PI;
  function spawnDrop(type, dist) {
    const it = makeGroundItem(type, px + Math.sin(dropAngle) * dist, pz + Math.cos(dropAngle) * dist);
    groundItems.push(it);
    sendItemEvent?.({ act: 'drop', id: it.id, type: it.type, x: it.x, z: it.z });
  }
  if (hasSword)  { spawnDrop('sword',  1.2); hasSword  = false; swordDurability  = 0; playerSword.visible  = false; }
  if (hasGlove)  { spawnDrop('glove',  1.2); hasGlove  = false; gloveDurability  = 0; playerGlove.visible  = false; }
  if (hasBat)    { spawnDrop('bat',    1.2); hasBat    = false; batDurability    = 0; playerBat.visible    = false; }
  if (hasBoots)  { spawnDrop('boots',  0.8); hasBoots  = false; bootsDurability  = 0; playerBoots.visible  = false; hasDoubleJumped = false; }
  if (hasShield) { spawnDrop('shield', 0.6); hasShield = false; shieldDurability = 0; playerShield.visible = false; }
  if (hasBanana) { spawnDrop('banana', 1.0); hasBanana = false; bananaDurability = 0; playerBanana.visible = false; }
  updateDurabilityHUD();
}


// ------------------------------------------------------------------
// Multiplayer via Trystero (optional, non-blocking)
// To remove: delete this whole block and the #peers element in index.html
// ------------------------------------------------------------------

const peers = new Map();
const peerCountEl = document.getElementById('peers');
let sendState     = null;
let sendGameEvent = null;
let room          = null;
let isMoving      = false;

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
    sword:    hasSword,
    glove:    hasGlove,
    bat:      hasBat,
    boots:    hasBoots,
    shield:   hasShield,
    banana:   hasBanana,
    punching: punchTimer > 0,
    blocking: hasShield && isBlocking,
    lives:    localLives,
    isGhost,
    ready:    localReady,
    hasArmor,
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
  peers.set(id, { ...char, tx: data.x ?? 0, ty: data.y ?? 0, tz: data.z ?? 0, rotY: data.rotY ?? 0, moving: false, swing: 0, punchTimer: 0, blocking: false, username: data.username, redrawLabel, pSword: !!data.sword, pGlove: !!data.glove, pBat: !!data.bat, pBoots: !!data.boots, pShield: !!data.shield, pBanana: !!data.banana, pColor: data.color || 'ffffff', lives: data.lives ?? 3, isGhost: !!data.isGhost, hasArmor: !!data.hasArmor, ready: !!data.ready });
  updateMenuReadyList();
}

function applyPeerEquip(peer, sword, glove, bat, boots, shield, banana) {
  peer.pSword  = sword;
  peer.pGlove  = glove;
  peer.pBat    = bat;
  peer.pBoots  = boots;
  peer.pShield = shield;
  peer.pBanana = banana;
  if (peer.swordGroup)  peer.swordGroup.visible  = !!sword;
  if (peer.gloveGroup)  peer.gloveGroup.visible  = !!glove;
  if (peer.batGroup)    peer.batGroup.visible    = !!bat;
  if (peer.bootsGroup)  peer.bootsGroup.visible  = !!boots;
  if (peer.shieldEquip) peer.shieldEquip.visible = !!shield;
  if (peer.bananaGroup) peer.bananaGroup.visible = !!banana;
}

function applyPeerGhostMode(peer, ghost) {
  peer.isGhost = ghost;
  if (peer.normalBody) peer.normalBody.visible = !ghost;
  if (peer.ghostBody)  peer.ghostBody.visible  =  ghost;
}

function removePeer(id) {
  const peer = peers.get(id);
  if (peer) { scene.remove(peer.group); peers.delete(id); }
  updateMenuReadyList();
  updatePeerLivesHUD();
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
    onPunch(({ kx, kz, force, ghostPunch, homeRun }, fromPeerId) => {
      if (isGhost && !ghostPunch) return; // normal punches don't affect ghosts
      if (!isGhost && ghostPunch === true && isDead) return; // already dying
      if (isBlocking && hasShield && !ghostPunch) {
        shieldDurability--;
        window.SFX?.shieldBlock();
        if (shieldDurability <= 0) breakShield(); else updateDurabilityHUD();
        return;
      }
      lastHitBy = fromPeerId;
      lastHitByWasGhost = !!ghostPunch;
      const kb = force ?? KNOCKBACK_H;
      velX = kx * kb;
      velZ = kz * kb;
      if (homeRun) {
        velY = kb;
        window.SFX?.batHomeRun();
        // Show "Home Run!" death screen immediately — don't wait for the fall
        die({ homeRun: true });
      } else if (ghostPunch) {
        window.SFX?.ghostPunch();
        velY = Math.max(velY, GHOST_KNOCKBACK_UP);
      } else if (force === SWORD_KNOCKBACK) {
        window.SFX?.swordHit();
        velY = Math.max(velY, KNOCKBACK_UP);
      } else if (force === GLOVE_KNOCKBACK) {
        window.SFX?.gloveHit();
        velY = Math.max(velY, KNOCKBACK_UP);
      } else if (force === BAT_NORMAL_KNOCKBACK) {
        window.SFX?.batNormal();
        velY = Math.max(velY, KNOCKBACK_UP);
      } else {
        window.SFX?.punch();
        velY = Math.max(velY, KNOCKBACK_UP);
      }
      onGround = false;
      // Lightning effect on the receiver's end for home-run hits
      if (homeRun) spawnLightningEffect(playerGroup.position.x, playerGroup.position.y, playerGroup.position.z);
    });

    const [sGame, onGame] = room.makeAction('game');
    sendGameEvent = sGame;
    onGame((data, fromPeerId) => {
      if (data.type === 'start') {
        startGame(data.seed, false);
      } else if (data.type === 'ghost_kill') {
        // Someone's ghost knocked us off and wants us revived
        reviveAsGhost();
      } else if (data.type === 'ready') {
        const peer = peers.get(fromPeerId);
        if (peer) { peer.ready = !!data.ready; updateMenuReadyList(); }
      }
    });

    const [sPeel, onPeel] = room.makeAction('peel');
    sendPeel = sPeel;
    onPeel((data) => {
      if (data.act === 'place') {
        if (!bananaPeels.some(p => p.id === data.id)) {
          const group = makeBananaPeel(data.x, data.z);
          bananaPeels.push({ group, x: data.x, z: data.z, id: data.id });
        }
      } else if (data.act === 'slip' || data.act === 'remove') {
        removePeelById(data.id);
      }
    });

    const [sItem, onItem] = room.makeAction('item');
    sendItemEvent = sItem;
    onItem((data) => {
      if (data.act === 'spawn' || data.act === 'drop') {
        // Add item if we don't already have it (dedup in case of rebroadcast)
        if (!groundItems.some(it => it.id === data.id)) {
          groundItems.push(makeGroundItem(data.type, data.x, data.z, data.id));
        }
      } else if (data.act === 'pickup' || data.act === 'remove') {
        const idx = groundItems.findIndex(it => it.id === data.id);
        if (idx !== -1) {
          scene.remove(groundItems[idx].group);
          groundItems.splice(idx, 1);
        }
      }
    });

    room.onPeerJoin((peerId) => {
      broadcastSelf();
      refreshPeerCount();
      // Host sends all current ground items to the newly joined peer
      if (isHost && gameState === 'playing') {
        for (const it of groundItems) {
          sItem({ act: 'spawn', id: it.id, type: it.type, x: it.x, z: it.z }, peerId);
        }
      }
    });
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
        if (!!data.sword !== peer.pSword || !!data.glove !== peer.pGlove || !!data.bat !== peer.pBat || !!data.boots !== peer.pBoots || !!data.shield !== peer.pShield || !!data.banana !== peer.pBanana)
          applyPeerEquip(peer, !!data.sword, !!data.glove, !!data.bat, !!data.boots, !!data.shield, !!data.banana);
        if (data.punching && peer.punchTimer <= 0) peer.punchTimer = 0.35;
        peer.blocking = !!data.blocking;
        if (!!data.isGhost !== peer.isGhost) applyPeerGhostMode(peer, !!data.isGhost);
        peer.lives    = data.lives ?? peer.lives;
        peer.hasArmor = !!data.hasArmor;
        if (peer.armorGroup) peer.armorGroup.visible = !!data.hasArmor && !data.isGhost;
        if (data.ready !== undefined) peer.ready = !!data.ready;
        if (gameState === 'lobby') updateMenuReadyList();
        if (gameState === 'playing') updatePeerLivesHUD();
      }
      refreshPeerCount();
    });

    refreshPeerCount();
    broadcastSelf();
    updateMenuReadyList();
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

renderer.domElement.addEventListener('click', () => {
  if (gameState === 'playing') renderer.domElement.requestPointerLock();
});

// Mute button + volume slider
const btnMute      = document.getElementById('btn-mute');
const volumeSlider = document.getElementById('volume-slider');

if (btnMute) {
  btnMute.addEventListener('click', () => {
    const nowMuted = window.MenuMusic?.toggle();
    btnMute.textContent = nowMuted ? '🔇' : '🔊';
    if (volumeSlider) volumeSlider.style.opacity = nowMuted ? '0.35' : '1';
  });
}

const MUSIC_GAME_MULT = 0.30; // in-game music is 70% quieter than menu volume

if (volumeSlider) {
  volumeSlider.addEventListener('input', () => {
    const v = volumeSlider.value / 100;
    window.MenuMusic?.setVolume(v);
    if (btnMute) btnMute.textContent = v === 0 ? '🔇' : '🔊';
  });
}

document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === renderer.domElement;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = isLocked
    ? 'WASD · Shift sprint · Space jump · LMB punch/sword · RMB shield · E equip · Z drop'
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
  if (e.button === 0) {
    if (hasBanana && gameState === 'playing' && !isDead && !isGhost) {
      placePeel();
    } else {
      doPunch();
    }
  }
  if (e.button === 2) isBlocking = true;
});
document.addEventListener('mouseup', e => {
  if (e.button === 2) isBlocking = false;
});

document.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ') {
    e.preventDefault();
    // Only act on the initial keypress — ignore browser auto-repeat so the
    // double-jump can't immediately consume itself right after the first jump.
    if (!e.repeat && !isDead && !isGhost) {
      if (onGround) {
        velY = JUMP_FORCE;
        onGround = false;
        hasDoubleJumped = false;
      } else if (hasBoots && !hasDoubleJumped && !hasFallenOff) {
        // Second jump — only this one costs a charge
        velY = JUMP_FORCE * 2.0;
        hasDoubleJumped = true;
        window.SFX?.rocketBoost();
        bootsDurability--;
        if (bootsDurability <= 0) breakBoots(); else updateDurabilityHUD();
      }
    }
  }

  // E — pick up nearby item
  if (e.key === 'e' || e.key === 'E') {
    const px = playerGroup.position.x, pz = playerGroup.position.z;
    for (let i = groundItems.length - 1; i >= 0; i--) {
      const it = groundItems[i];
      if (Math.hypot(px - it.x, pz - it.z) < ITEM_PICKUP_R) {
        // Helper: drop current item and broadcast it
        const dropAngle = playerGroup.rotation.y + Math.PI;
        function swapDrop(type, dist) {
          const dropped = makeGroundItem(type, px + Math.sin(dropAngle) * dist, pz + Math.cos(dropAngle) * dist);
          groundItems.push(dropped);
          sendItemEvent?.({ act: 'drop', id: dropped.id, type: dropped.type, x: dropped.x, z: dropped.z });
        }
        const isWeapon = it.type === 'sword' || it.type === 'glove' || it.type === 'bat' || it.type === 'banana';
        if (it.type === 'boots' && hasBoots) {
          swapDrop('boots', 0.8);
          hasBoots = false; bootsDurability = 0; playerBoots.visible = false; hasDoubleJumped = false;
        }
        if (isWeapon && hasSword)  { swapDrop('sword',  1.2); hasSword  = false; swordDurability  = 0; playerSword.visible  = false; }
        if (isWeapon && hasGlove)  { swapDrop('glove',  1.2); hasGlove  = false; gloveDurability  = 0; playerGlove.visible  = false; }
        if (isWeapon && hasBat)    { swapDrop('bat',    1.2); hasBat    = false; batDurability    = 0; playerBat.visible    = false; }
        if (isWeapon && hasBanana) { swapDrop('banana', 1.0); hasBanana = false; bananaDurability = 0; playerBanana.visible = false; }
        if (it.type === 'shield' && hasShield) {
          swapDrop('shield', 0.6);
          hasShield = false; shieldDurability = 0; playerShield.visible = false;
        }
        // Remove the picked-up item and tell all peers
        const pickedId = it.id;
        scene.remove(it.group);
        groundItems.splice(i, 1);
        sendItemEvent?.({ act: 'pickup', id: pickedId });
        equipItem(it.type);
        break;
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

let velY        = 0;
let velX        = 0;   // horizontal knockback
let velZ        = 0;
let onGround    = true;
let hasFallenOff  = false; // true once player drops below platform surface — no landing allowed
let isDead        = false;
let deathTimer    = 0;
let homeRunDeath  = false; // true when death was caused by a home-run bat hit
let punchTimer  = 0; // >0 while punch animation playing
let sendPunch   = null;

// --- Game mode state ---
let gameState          = 'lobby';   // 'lobby' | 'playing' | 'gameover'
let localLives         = 3;
let isGhost            = false;
let ghostPunchCooldown = 0;
let lastHitBy          = null;      // peer id who last punched us
let lastHitByWasGhost  = false;
let hasArmor           = localStorage.getItem('arenaHasArmor') === '1';
let localReady         = false;
let tileOrder          = [];        // shuffled tile indices
let tileDropIndex      = 0;         // next tile to warn
let nextTileTime       = 0;         // game-time when next tile event fires
let gameOverTimer      = 0;

// --- Random event system (fully deterministic — driven by game seed, no P2P needed) ---
let _gameSeed        = 0;           // shared game seed, same on every client
let _rainPeelBase    = 0x40000000;  // deterministic peel-ID pool for rain events
let eventState       = 'idle';      // 'idle' | 'announcing' | 'running'
let eventType        = null;
let eventTimer       = 0;
let nextEventTime    = 0;           // set deterministically in startGame
let rainSchedule     = [];          // [{t, x, z, peelId}] pre-generated at event start
let rainScheduleIdx  = 0;
let rainEventElapsed = 0;
const EVENT_ANNOUNCE_S      = 5;
const RAIN_BANANAS_DURATION = 25;
const fallingBananas        = [];   // { group, x, z, velY, peelId, rotVX, rotVZ }
let eventCount              = 0;    // increments each time an event ends (for cycling)
const EVENT_TYPES           = ['loot_goblin', 'clouds_alive', 'rain_bananas'];

// --- Cloud event constants ---
const CLOUD_ORBIT_R      = 32;   // radius of cloud orbit around arena
const CLOUD_ORBIT_SPEED  = 0.4;  // radians/s
const CLOUD_HEIGHT       = 10;   // height above platform
const CLOUD_CIRCLE_TIME  = 5.0;  // base seconds of circling before each gust
const CLOUD_PREPARE_TIME = 2.2;  // ominous pause before blowing
const CLOUD_BLOW_TIME    = 3.5;  // seconds of active wind
const CLOUD_GUSTS        = 3;    // total gusts before dissipation
const CLOUD_DISSIPATE_S  = 2.5;  // fade-out duration
const WIND_WIDTH         = 14;   // full width of wind corridor (units)
const WIND_ACCEL         = 55;   // acceleration applied while in corridor (units/s²)
const WIND_MAX_SPEED     = 13;   // wind velocity cap — sprint (11 u/s) can fight this

// --- Goblin event constants ---
const GOBLIN_SPEED     = 9.0;  // units/s (below player sprint so you can barely chase it)
const GOBLIN_FLEE_MULT = 1.8;  // speed multiplier when fleeing
const GOBLIN_NUM_DROPS = 10;   // items dropped before goblin flees
const GOBLIN_MAX_TIME  = 32;   // safety: force flee if dropping phase runs too long

// --- Cloud event state ---
let cloudGroup          = null;       // THREE.Group | null
let cloudAngle          = 0;          // current orbit angle (radians)
let cloudSubState       = 'circling'; // 'circling' | 'preparing' | 'blowing' | 'dissipating'
let cloudGustCount      = 0;          // how many gusts have fired (0–CLOUD_GUSTS)
let cloudCircleTimer    = 0;
let cloudPrepareTimer   = 0;
let cloudBlowTimer      = 0;
let cloudDissipateTimer = 0;
let cloudSchedule       = [];         // pre-generated circle durations for the 3 gusts
const windStreaks        = [];         // { mesh, mat, velX, velZ, lifetime, maxLifetime }
let cloudSmileParts     = [];         // mouth meshes shown while idle / circling
let cloudBlowParts      = [];         // mouth meshes shown while blowing
let windVelX            = 0;          // wind-push velocity, separate from punch knockback
let windVelZ            = 0;

// --- Goblin event state ---
let goblinGroup       = null;
let goblinLegL        = null;  // animated limb refs
let goblinLegR        = null;
let goblinArmL        = null;
let goblinArmR        = null;
let goblinX           = 0;
let goblinZ           = 0;
let goblinVelY        = 0;
let goblinAngle       = 0;
let goblinBobPhase    = 0;
let goblinSubState    = 'dropping'; // 'dropping' | 'fleeing'
let goblinDropIdx     = 0;
let goblinSchedule    = null;       // { startX, startZ, drops:[{x,z,type}] }
let goblinFleeTargetX = 0;
let goblinFleeTargetZ = 0;
let goblinJumpTargetX = 0;
let goblinJumpTargetZ = 0;
let goblinY           = 0;   // world Y, managed separately from group.position.y
let goblinEventElapsed = 0;

const GHOST_KNOCKBACK_H  = 55;
const GHOST_KNOCKBACK_UP = 16;
const GHOST_PUNCH_CD     = 7.0;  // seconds
const GHOST_SPEED        = 7;
const SPAWN_X = -2, SPAWN_Y = 3.2, SPAWN_Z = 2;

const livesHudEl = document.getElementById('lives-hud');
const menuEl     = document.getElementById('menu');
const gameOverEl = document.getElementById('game-over');
const readyListEl = document.getElementById('ready-list');
const btnReady   = document.getElementById('btn-ready');
const btnStart   = document.getElementById('btn-start');

const deathEl      = document.getElementById('death-msg');
const deathMsgSpan = deathEl?.querySelector('span');
const deathMsgSub  = deathEl?.querySelector('small');
const eventAnnouncementEl = document.getElementById('event-announcement');

function onPlatform(x, z) {
  return Math.abs(x) < PLATFORM_HALF && Math.abs(z) < PLATFORM_HALF;
}

// Returns true if world point (x,z) is inside elevated platform ep.
// Uses OBB test when ep.angle != 0 so rotated shapes (low wall, toppled
// column) don't have oversized hit-areas in the empty space around them.
function epContains(ep, x, z) {
  const dx = x - ep.x, dz = z - ep.z;
  if (ep.angle === 0) {
    return Math.abs(dx) <= ep.hw && Math.abs(dz) <= ep.hd;
  }
  const ca = Math.cos(ep.angle), sa = Math.sin(ep.angle);
  const lx =  dx * ca + dz * sa;
  const lz = -dx * sa + dz * ca;
  return Math.abs(lx) <= ep.hw && Math.abs(lz) <= ep.hd;
}

// Returns the highest surface Y under (x, z), or null if nothing below.
function getSurfaceBelow(x, z) {
  let best = null;
  // Main platform (only if tile hasn't fallen)
  if (onPlatform(x, z) && !isTileUnstable(x, z)) best = 0;
  // Elevated platforms — OBB test
  for (const ep of elevatedPlatforms) {
    if (epContains(ep, x, z)) {
      if (best === null || ep.topY > best) best = ep.topY;
    }
  }
  // Pillar tops (within the pillar's circle)
  const PLAYER_R = 0.32;
  for (const p of pillarData) {
    if (Math.hypot(x - p.x, z - p.z) < p.r + PLAYER_R * 0.4) {
      if (best === null || p.topY > best) best = p.topY;
    }
  }
  return best;
}

// Returns the push vector needed to move point (px,pz) outside circle (cx,cz,r), or null.
function circleOverlap(px, pz, cx, cz, r) {
  const dx = px - cx, dz = pz - cz;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist >= r || dist < 0.0001) return null;
  const push = (r - dist) / dist;
  return { nx: dx * push, nz: dz * push };
}

function updateLivesHUD() {
  if (!livesHudEl) return;
  if (gameState !== 'playing') { livesHudEl.textContent = ''; return; }
  if (isGhost) {
    livesHudEl.innerHTML = '<span style="color:#44aaff;text-shadow:0 0 8px #44aaff">👻 GHOST</span>';
    return;
  }
  const hearts = '❤️'.repeat(localLives) + '🖤'.repeat(Math.max(0, 3 - localLives + (hasArmor ? 1 : 0)));
  livesHudEl.textContent = hearts;
}

const peerLivesHudEl = document.getElementById('peer-lives-hud');
function updatePeerLivesHUD() {
  if (!peerLivesHudEl) return;
  if (gameState !== 'playing') { peerLivesHudEl.innerHTML = ''; return; }
  let html = '';
  for (const peer of peers.values()) {
    const name   = peer.username || '?';
    const color  = '#' + (peer.pColor || 'ffffff');
    const maxLives = peer.hasArmor ? 4 : 3;
    const heartsHtml = peer.isGhost
      ? '<span style="color:#44aaff;text-shadow:0 0 6px #44aaff">👻 ghost</span>'
      : '❤️'.repeat(Math.max(0, peer.lives ?? 3)) + '🖤'.repeat(Math.max(0, maxLives - (peer.lives ?? 3)));
    html += `<div class="peer-lives-row">
      <span class="peer-lives-name" style="color:${color}">${name}</span>
      <span class="peer-lives-hearts">${heartsHtml}</span>
    </div>`;
  }
  peerLivesHudEl.innerHTML = html;
}

function enterGhostMode() {
  isGhost = true;
  isDead  = false;
  hasFallenOff = false; // ghosts fly freely
  // Drop items
  hasSword  = false; swordDurability  = 0; playerSword.visible  = false;
  hasGlove  = false; gloveDurability  = 0; playerGlove.visible  = false;
  hasBat    = false; batDurability    = 0; playerBat.visible    = false;
  hasShield = false; shieldDurability = 0; playerShield.visible = false;
  hasBoots  = false; bootsDurability  = 0; playerBoots.visible  = false; hasDoubleJumped = false;
  hasBanana = false; bananaDurability = 0; playerBanana.visible = false;
  isSlipping = false; slipTimer = 0;
  updateDurabilityHUD();
  // Remove armor
  hasArmor = false;
  localStorage.removeItem('arenaHasArmor');
  playerArmorGroup.visible = false;
  // Swap to ghost appearance
  playerNormalBody.visible = false;
  playerGhostBody.visible  = true;
  ghostPunchCooldown = 0;
  velY = 0; velX = 0; velZ = 0; windVelX = 0; windVelZ = 0;
  if (deathEl) deathEl.style.display = 'none';
  updateLivesHUD();
}

function exitGhostMode() {
  isGhost = false;
  playerNormalBody.visible = true;
  playerGhostBody.visible  = false;
  updateLivesHUD();
}

// Called when a ghost killed us — respawn with 1 life
function reviveAsGhost() {
  if (!isGhost) return; // only ghosts can be revived this way
  exitGhostMode();
  localLives = 1;
  playerGroup.position.set(SPAWN_X, SPAWN_Y, SPAWN_Z);
  velY = 0; velX = 0; velZ = 0; windVelX = 0; windVelZ = 0;
  onGround = false;
  isDead = false;
  if (deathEl) deathEl.style.display = 'none';
  updateLivesHUD();
}

function die(opts = {}) {
  if (isDead || isGhost) return;
  isDead = true;
  homeRunDeath = !!opts.homeRun;
  deathTimer = homeRunDeath ? 4.0 : 2.0;
  window.SFX?.die();
  if (!homeRunDeath) {
    velY = 0; velX = 0; velZ = 0; windVelX = 0; windVelZ = 0;
    hasFallenOff = true; // prevent physics re-landing
  }
  if (gameState === 'playing') {
    // Notify ghost who killed us so they can revive
    if (lastHitByWasGhost && lastHitBy) {
      sendGameEvent?.({ type: 'ghost_kill' }, lastHitBy);
      lastHitBy = null; lastHitByWasGhost = false;
    }
    localLives--;
    // Armor gave +1 life (started at 4 instead of 3).
    // The moment lives drop back to 3 the armor life has been spent — strip it.
    if (hasArmor && localLives === 3) {
      hasArmor = false;
      localStorage.removeItem('arenaHasArmor');
      playerArmorGroup.visible = false;
      broadcastSelf();
    }
    updateLivesHUD();
  }
  if (deathEl) {
    if (deathMsgSpan) deathMsgSpan.textContent = homeRunDeath ? '⚾ HOME RUN!' : 'YOU FELL';
    if (deathMsgSub)  deathMsgSub.textContent  = 'respawning…';
    deathEl.style.display = 'flex';
  }
}

function randomSafeTile() {
  const solid = tileObjects.filter(t => t.state === 'solid');
  if (solid.length === 0) return { x: SPAWN_X, z: SPAWN_Z };
  const t = solid[Math.floor(Math.random() * solid.length)];
  return { x: t.cx, z: t.cz };
}

function respawn() {
  isDead = false;
  hasFallenOff = false;
  homeRunDeath = false;
  window.SFX?.respawn();
  if (gameState === 'playing' && localLives <= 0) {
    enterGhostMode();
    playerGroup.position.set(SPAWN_X, SPAWN_Y + 3, SPAWN_Z);
    return;
  }
  if (gameState === 'playing') {
    const sp = randomSafeTile();
    playerGroup.position.set(sp.x, SPAWN_Y, sp.z);
  } else {
    playerGroup.position.set(0, 1, 0);
  }
  velY = 0; velX = 0; velZ = 0; windVelX = 0; windVelZ = 0;
  onGround = false;
  if (deathEl) deathEl.style.display = 'none';
}

function checkWinCondition() {
  if (gameState !== 'playing') return;
  // Count alive (non-ghost) players including self
  let aliveCount = isGhost ? 0 : 1;
  let aliveNames = isGhost ? [] : [incoming.username];
  for (const peer of peers.values()) {
    if (!peer.isGhost) { aliveCount++; aliveNames.push(peer.username || '?'); }
  }
  if (peers.size === 0) return; // need at least 2 players to trigger win
  // Everyone became a ghost simultaneously (draw) → return to lobby with no winner
  if (aliveCount === 0) {
    returnToLobby();
    return;
  }
  if (aliveCount === 1) {
    const winner = aliveNames[0];
    winGame(winner, winner === incoming.username);
  }
}

function winGame(winnerName, isLocal) {
  gameState = 'gameover';
  gameOverTimer = 5;
  if (isLocal) {
    localStorage.setItem('arenaHasArmor', '1');
  }
  // Show overlay with live countdown
  if (gameOverEl) {
    document.getElementById('game-over-winner').textContent = `🏆 ${winnerName} wins!`;
    const subEl = document.getElementById('game-over-sub');
    subEl.textContent = 'Returning to lobby in 5…';
    gameOverEl.classList.add('active');
    let count = 4;
    const iv = setInterval(() => {
      if (gameState !== 'gameover') { clearInterval(iv); return; }
      subEl.textContent = count > 0 ? `Returning to lobby in ${count}…` : 'Returning to lobby…';
      count--;
      if (count < 0) clearInterval(iv);
    }, 1000);
  }
  updateLivesHUD();
}

function returnToLobby() {
  window.GameMusic?.stop();
  window.MenuMusic?.start();
  window.MenuMusic?.unduck();
  gameState  = 'lobby';
  localLives = 3 + (hasArmor ? 1 : 0);
  isGhost    = false;
  localReady = false;
  isDead     = false;
  // Restore player appearance
  exitGhostMode();
  hasArmor = localStorage.getItem('arenaHasArmor') === '1';
  playerArmorGroup.visible = hasArmor;
  // Reset tiles and restore platform
  for (const t of tileObjects) { t.state = 'solid'; t.timer = 0; t.mesh.visible = false; t.mesh.position.y = -2; t.mesh.material.color.copy(t.solidColor); }
  tileDropIndex = 0;
  gameTime = 0;
  platform.visible = true;
  // Clear all ground items and banana peels
  for (const it of groundItems) scene.remove(it.group);
  groundItems.length = 0;
  itemTimer = Date.now() + 5000;
  for (const p of bananaPeels) scene.remove(p.group);
  bananaPeels.length = 0;
  hasBanana = false; bananaDurability = 0;
  if (playerBanana) playerBanana.visible = false;
  isSlipping = false; slipTimer = 0; bananaImmunityTimer = 0;
  // Clean up random events
  eventState = 'idle'; eventType = null; eventTimer = 0;
  eventCount = 0;
  for (const fb of fallingBananas) scene.remove(fb.group);
  fallingBananas.length = 0;
  despawnCloud();
  despawnGoblin();
  clearWindStreaks();
  hideEventAnnouncement();
  // Move player to lobby
  playerGroup.position.set(0, 1, 0);
  velY = 0; velX = 0; velZ = 0; windVelX = 0; windVelZ = 0;
  onGround = false;
  if (deathEl) deathEl.style.display = 'none';
  if (gameOverEl) gameOverEl.classList.remove('active');
  // Show menu and refresh name field
  if (menuEl) menuEl.classList.add('active');
  const _nameInput = document.getElementById('menu-name-input');
  if (_nameInput) _nameInput.value = incoming.username;
  document.exitPointerLock();
  updateLivesHUD();
  updatePeerLivesHUD();
  // Reset all peers' ready flags from the previous match
  for (const peer of peers.values()) peer.ready = false;
  updateMenuReadyList();
  // Announce our own reset state to all peers immediately
  broadcastSelf();
}

function startGame(seed, broadcast) {
  gameState  = 'playing';
  isHost     = !!broadcast; // the player who starts the game owns item spawning
  localLives = 3 + (hasArmor ? 1 : 0);
  isGhost             = false;
  isDead              = false;
  homeRunDeath        = false;
  isSlipping          = false;
  slipTimer           = 0;
  bananaImmunityTimer = 0;
  hasBanana = false; bananaDurability = 0; playerBanana.visible = false;
  for (const p of bananaPeels) scene.remove(p.group);
  bananaPeels.length = 0;
  ghostPunchCooldown = 0;
  lastHitBy  = null;
  // Reset random events — deterministic so every client fires at the same time
  _gameSeed = seed;
  _rainPeelBase = 0x40000000;
  eventState = 'idle'; eventType = null; eventTimer = 0;
  { // deterministic first-event time derived from seed
    let s = (seed ^ 0xf00dbeef) >>> 0;
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    nextEventTime = 40 + ((s >>> 0) / 0x100000000) * 25; // 40–65 s
  }
  rainSchedule = []; rainScheduleIdx = 0; rainEventElapsed = 0;
  for (const fb of fallingBananas) scene.remove(fb.group);
  fallingBananas.length = 0;
  eventCount = 0;
  despawnCloud();
  despawnGoblin();
  clearWindStreaks();
  hideEventAnnouncement();
  window.GameMusic?.stop();
  window.MenuMusic?.duck(MUSIC_GAME_MULT);
  // Clear any leftover items and reset spawn timer
  for (const it of groundItems) scene.remove(it.group);
  groundItems.length = 0;
  itemTimer = Date.now() + 5000;
  // Randomise arena layout (pillars, elevated platforms, tile colour) for this round
  rebuildArena(seed);
  // Tile setup
  gameTime       = 0;
  tileOrder      = shuffleTiles(seed);
  tileDropIndex  = 0;
  nextTileTime   = TILE_GRACE_S;
  // Show tiles using this round's solid colour
  for (const t of tileObjects) { t.state = 'solid'; t.timer = 0; t.mesh.visible = true; t.mesh.position.y = -2; t.mesh.material.color.copy(t.solidColor); }
  // Hide main platform mesh so tiles take over visually
  platform.visible = false;
  // Spawn player on center pillar
  playerGroup.position.set(SPAWN_X, SPAWN_Y, SPAWN_Z);
  velY = 0; velX = 0; velZ = 0; windVelX = 0; windVelZ = 0;
  onGround = false;
  playerArmorGroup.visible = hasArmor;
  if (menuEl) menuEl.classList.remove('active');
  if (deathEl) deathEl.style.display = 'none';
  if (broadcast) {
    sendGameEvent?.({ type: 'start', seed });
  }
  updateLivesHUD();
  updatePeerLivesHUD();
  // Capture pointer
  renderer.domElement.requestPointerLock();
  // game time for tile tracking is handled via gameTime variable in loop
}

function doPunch() {
  // Ghost punch
  if (isGhost) {
    if (ghostPunchCooldown > 0) return;
    ghostPunchCooldown = GHOST_PUNCH_CD;
    const px = playerGroup.position.x, py = playerGroup.position.y, pz = playerGroup.position.z;
    let nearest = null, nearestDist = PUNCH_RANGE * 1.5;
    for (const [id, peer] of peers) {
      if (peer.isGhost) continue; // ghosts can only punch alive
      const dx = peer.group.position.x - px, dy = peer.group.position.y - py, dz = peer.group.position.z - pz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < nearestDist) { nearest = { id, dx, dy, dz, dist }; nearestDist = dist; }
    }
    if (nearest && sendPunch) {
      const { id, dx, dz, dist } = nearest;
      sendPunch({ kx: dx / dist, kz: dz / dist, force: GHOST_KNOCKBACK_H, ghostPunch: true }, id);
    }
    return;
  }

  if (punchTimer > 0 || isDead) return;
  punchTimer = 0.35;
  broadcastSelf();

  const px = playerGroup.position.x;
  const py = playerGroup.position.y;
  const pz = playerGroup.position.z;
  let nearest = null, nearestDist = PUNCH_RANGE;

  for (const [id, peer] of peers) {
    if (peer.isGhost) continue; // can't punch ghosts normally
    const dx = peer.group.position.x - px;
    const dy = peer.group.position.y - py;
    const dz = peer.group.position.z - pz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < nearestDist) { nearest = { id, dx, dy, dz, dist }; nearestDist = dist; }
  }

  if (nearest && sendPunch) {
    const { id, dx, dz, dist } = nearest;
    let force = hasSword ? SWORD_KNOCKBACK : hasGlove ? GLOVE_KNOCKBACK : KNOCKBACK_H;
    let homeRun = false;
    if (hasBat) {
      homeRun = Math.random() < 0.25;
      force = homeRun ? BAT_HOME_RUN_KNOCKBACK : BAT_NORMAL_KNOCKBACK;
    }
    sendPunch({ kx: dx / dist, kz: dz / dist, force, homeRun }, id);
    // Play attacker-side HIT sound
    if (homeRun)           window.SFX?.batHomeRun();
    else if (hasBat)       window.SFX?.batNormal();
    else if (hasSword)     window.SFX?.swordHit();
    else if (hasGlove)     window.SFX?.gloveHit();
    else                   window.SFX?.punch();
    // Spawn lightning at the target's position when attacker scores a home run
    if (homeRun) {
      const peer = peers.get(id);
      if (peer) spawnLightningEffect(peer.group.position.x, peer.group.position.y, peer.group.position.z);
    }
    if (hasSword) {
      swordDurability--;
      if (swordDurability <= 0) breakSword(); else updateDurabilityHUD();
    } else if (hasGlove) {
      gloveDurability--;
      if (gloveDurability <= 0) breakGlove(); else updateDurabilityHUD();
    } else if (hasBat) {
      batDurability--;
      if (batDurability <= 0) breakBat(); else updateDurabilityHUD();
    }
  } else {
    // Missed — play weapon swing / whoosh sound
    if (hasSword)      window.SFX?.swordSwing();
    else if (hasGlove) window.SFX?.gloveSwing();
    else if (hasBat)   window.SFX?.batSwing();
    else               window.SFX?.punch(); // bare fist whoosh
  }
}
// ------------------------------------------------------------------
// Random event system
// ------------------------------------------------------------------

const EVENT_INFO = {
  loot_goblin: {
    name: "💰 A Loot Goblin Has Appeared!",
    sub:  "Catch it before it gets away — it's dropping loot everywhere!",
  },
  rain_bananas: {
    name: "🍌 It's Raining Bananas!",
    sub:  'Watch out — banana peels are falling from the sky!',
  },
  clouds_alive: {
    name: '☁️ The Clouds are alive...',
    sub:  'Something is watching. Something is breathing.',
  },
};

function showEventAnnouncement(type) {
  if (!eventAnnouncementEl) return;
  const info = EVENT_INFO[type] || { name: type, sub: '' };
  eventAnnouncementEl.innerHTML =
    `<div class="event-name">${info.name}</div>` +
    `<div class="event-sub">${info.sub}</div>`;
  eventAnnouncementEl.classList.add('visible');
}

function hideEventAnnouncement() {
  if (!eventAnnouncementEl) return;
  eventAnnouncementEl.classList.remove('visible');
}

// Called independently on every client at the same deterministic game-time.
function triggerEvent(type) {
  eventState = 'announcing';
  eventType  = type;
  eventTimer = EVENT_ANNOUNCE_S;
  showEventAnnouncement(type);
}

function beginEvent() {
  eventState = 'running';
  hideEventAnnouncement();
  if (eventType === 'loot_goblin') {
    eventTimer         = 90; // safety fallback
    goblinSchedule     = generateGoblinSchedule();
    goblinDropIdx      = 0;
    goblinSubState     = 'dropping';
    goblinVelY         = 0;
    goblinY            = 0;
    goblinEventElapsed = 0;
    goblinX            = goblinSchedule.startX;
    goblinZ            = goblinSchedule.startZ;
    goblinAngle        = 0;
    goblinBobPhase     = 0;
    spawnGoblin();
  } else if (eventType === 'rain_bananas') {
    eventTimer       = RAIN_BANANAS_DURATION;
    rainEventElapsed = 0;
    rainScheduleIdx  = 0;
    rainSchedule     = generateRainSchedule();
  } else if (eventType === 'clouds_alive') {
    eventTimer = 120; // safety fallback — cloud self-terminates via sub-state machine
    cloudSchedule  = generateCloudSchedule();
    cloudGustCount = 0;
    // Deterministic start angle
    { let s = (_gameSeed ^ (0xc10d0000 + eventCount)) >>> 0;
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      cloudAngle = ((s >>> 0) / 0x100000000) * Math.PI * 2; }
    cloudSubState    = 'circling';
    cloudCircleTimer = cloudSchedule[0];
    spawnCloud();
  }
}

function endEvent() {
  if (eventState !== 'running') return; // guard against double-call
  eventState = 'idle';
  eventType  = null;
  eventCount++;
  // Cloud cleanup
  despawnCloud();
  clearWindStreaks();
  // Deterministic gap until next event — same result on every client
  const t = Math.round(gameTime);
  let s = (_gameSeed ^ (t * 0x9e3779b9 + eventCount)) >>> 0;
  s = (Math.imul(s, 1664525) + 1013904223) | 0;
  nextEventTime = gameTime + 30 + ((s >>> 0) / 0x100000000) * 30; // 30–60 s
  hideEventAnnouncement();
}

// Pre-generates every banana drop for this rain event using the shared game seed.
// All clients call this independently and get the exact same schedule.
function generateRainSchedule() {
  let s = (_gameSeed ^ 0xbadcafe0) >>> 0;
  function r() { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 0x100000000; }
  const schedule = [];
  const margin   = 3;
  let peelId     = _rainPeelBase;

  // Big opening burst — 10 bananas in the first 0.3 s
  for (let b = 0; b < 10; b++) {
    schedule.push({
      t:     r() * 0.25,
      x:     (r() * 2 - 1) * (PLATFORM_HALF - margin),
      z:     (r() * 2 - 1) * (PLATFORM_HALF - margin),
      peelId: peelId++,
    });
  }
  // Sustained heavy rain — 4–5 bananas every 1.5 s
  for (let t = 1.5; t < RAIN_BANANAS_DURATION; t += 1.5) {
    const count = 4 + Math.floor(r() * 2); // 4 or 5
    for (let b = 0; b < count; b++) {
      schedule.push({
        t:     t + r() * 1.2,
        x:     (r() * 2 - 1) * (PLATFORM_HALF - margin),
        z:     (r() * 2 - 1) * (PLATFORM_HALF - margin),
        peelId: peelId++,
      });
    }
  }
  schedule.sort((a, b) => a.t - b.t);
  _rainPeelBase = peelId; // advance pool so the next event gets fresh IDs
  return schedule;
}

// Creates a falling banana visual at (x, z).
// peelId: if not null, a banana peel with this exact ID is placed when the banana lands.
// Using deterministic IDs means all clients place matching peels without any P2P sync.
function spawnFallingBananaVisual(x, z, peelId) {
  const g = new THREE.Group();
  g.position.set(x, 22, z);
  g.rotation.set(
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2
  );
  const banMat2 = new THREE.MeshStandardMaterial({ color: 0xffe135, roughness: 0.65 });
  const tipMat2 = new THREE.MeshStandardMaterial({ color: 0x7a5200, roughness: 0.8 });
  const bMeshG = new THREE.Group();
  [
    { cx: -0.013, cy: -0.273, rot:  0.52, h: 0.057, w: 0.052, mat: tipMat2 },
    { cx: -0.057, cy: -0.149, rot:  0.28, h: 0.182, w: 0.086, mat: banMat2 },
    { cx: -0.075, cy:  0.016, rot:  0.00, h: 0.156, w: 0.094, mat: banMat2 },
    { cx: -0.047, cy:  0.163, rot: -0.28, h: 0.143, w: 0.083, mat: banMat2 },
    { cx:  0.008, cy:  0.267, rot: -0.52, h: 0.104, w: 0.065, mat: banMat2 },
    { cx:  0.049, cy:  0.322, rot: -0.72, h: 0.049, w: 0.047, mat: tipMat2 },
  ].forEach(({ cx, cy, rot, h, w, mat }) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    m.position.set(cx, cy, 0);
    m.rotation.z = rot;
    bMeshG.add(m);
  });
  bMeshG.scale.setScalar(2.2);
  g.add(bMeshG);
  scene.add(g);
  fallingBananas.push({
    group: g, x, z, velY: 0, peelId,
    rotVX: (Math.random() - 0.5) * 5,
    rotVZ: (Math.random() - 0.5) * 5,
  });
}

// ------------------------------------------------------------------
// Cloud event helpers
// ------------------------------------------------------------------

// Returns 3 circle-duration values derived from the shared game seed.
function generateCloudSchedule() {
  let s = (_gameSeed ^ (0xc10d0000 + eventCount + 1)) >>> 0;
  function r() { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 0x100000000; }
  return [
    CLOUD_CIRCLE_TIME + r() * 3.5,
    CLOUD_CIRCLE_TIME + r() * 3.5,
    CLOUD_CIRCLE_TIME + r() * 3.5,
  ];
}

// Build and add the cloud mesh to the scene.
function spawnCloud() {
  cloudGroup = new THREE.Group();
  cloudSmileParts.length = 0;
  cloudBlowParts.length  = 0;

  // Body — overlapping puff spheres (bright friendly white)
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xeef0ff, roughness: 0.9, metalness: 0 });
  const puffs = [
    { x:  0.0,  y:  0.0,  z:  0.0,  r: 3.0 },
    { x: -2.4,  y: -0.3,  z:  0.3,  r: 2.2 },
    { x:  2.4,  y: -0.3,  z:  0.3,  r: 2.0 },
    { x: -4.1,  y: -0.8,  z:  0.5,  r: 1.5 },
    { x:  4.1,  y: -0.8,  z:  0.5,  r: 1.4 },
    { x: -1.1,  y:  1.6,  z:  0.2,  r: 1.9 },
    { x:  1.1,  y:  1.7,  z:  0.2,  r: 1.7 },
    { x:  0.0,  y: -1.9,  z:  0.3,  r: 2.3 },
    { x:  0.0,  y:  0.5,  z:  0.8,  r: 2.0 },
  ];
  for (const p of puffs) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(p.r, 10, 7), cloudMat);
    m.position.set(p.x, p.y, p.z);
    cloudGroup.add(m);
  }

  // Friendly eyes — white sclera + sky-blue iris + sparkle highlight
  const irisMat = new THREE.MeshStandardMaterial({
    color: 0x44aaff, emissive: 0x2266aa, emissiveIntensity: 0.6,
  });
  const scleraMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pupilMat  = new THREE.MeshStandardMaterial({ color: 0x112233 });
  const sparkMat  = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1,
  });
  for (const ex of [-1.05, 1.05]) {
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.44, 9, 7), scleraMat);
    sclera.position.set(ex, 0.5, -2.55);
    cloudGroup.add(sclera);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.30, 8, 6), irisMat);
    iris.position.set(ex, 0.5, -2.85);
    cloudGroup.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), pupilMat);
    pupil.position.set(ex, 0.5, -3.02);
    cloudGroup.add(pupil);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 5, 4), sparkMat);
    spark.position.set(ex + 0.13, 0.62, -3.08);
    cloudGroup.add(spark);
  }

  // --- Smile mouth (visible while circling / preparing / dissipating) ---
  const smileMat = new THREE.MeshStandardMaterial({ color: 0x4477aa });
  const smileRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.16, 7, 16, Math.PI),
    smileMat
  );
  smileRing.position.set(0, -0.62, -2.62);
  smileRing.rotation.z = Math.PI; // arc curves downward = smile
  cloudGroup.add(smileRing);
  cloudSmileParts.push(smileRing);

  // Small rosy cheek circles
  const cheekMat = new THREE.MeshStandardMaterial({
    color: 0xffaacc, transparent: true, opacity: 0.55,
  });
  for (const cx of [-1.55, 1.55]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.35, 7, 5), cheekMat);
    cheek.position.set(cx, 0.08, -2.62);
    cloudGroup.add(cheek);
    cloudSmileParts.push(cheek);
  }

  // --- Blowing mouth (hidden until wind phase) — rounded "O" pursed lips ---
  const blowMat = new THREE.MeshStandardMaterial({ color: 0x3366aa });
  const blowRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.52, 0.20, 8, 14),
    blowMat
  );
  blowRing.position.set(0, -0.68, -2.64);
  blowRing.visible = false;
  cloudGroup.add(blowRing);
  cloudBlowParts.push(blowRing);

  // Inner dark hole of the O mouth
  const blowHole = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 12),
    new THREE.MeshStandardMaterial({ color: 0x112233 })
  );
  blowHole.position.set(0, -0.68, -2.84);
  blowHole.visible = false;
  cloudGroup.add(blowHole);
  cloudBlowParts.push(blowHole);

  // Position and orient cloud, then add to scene
  cloudGroup.position.set(
    CLOUD_ORBIT_R * Math.cos(cloudAngle),
    CLOUD_HEIGHT,
    CLOUD_ORBIT_R * Math.sin(cloudAngle)
  );
  // Face inward: local -Z should point toward arena center
  cloudGroup.rotation.y = Math.atan2(Math.cos(cloudAngle), Math.sin(cloudAngle));
  scene.add(cloudGroup);
}

function despawnCloud() {
  if (!cloudGroup) return;
  scene.remove(cloudGroup);
  cloudGroup = null;
  cloudSmileParts.length = 0;
  cloudBlowParts.length  = 0;
}

// Spawn a single wind-streak particle in the wind corridor.
function spawnWindStreak() {
  if (!cloudGroup) return;
  const wdx = -Math.cos(cloudAngle);
  const wdz = -Math.sin(cloudAngle);
  const perpX = -wdz, perpZ = wdx; // perpendicular to wind direction
  const cx = cloudGroup.position.x;
  const cz = cloudGroup.position.z;

  const along  = 2 + Math.random() * 22;
  const perp   = (Math.random() * 2 - 1) * WIND_WIDTH * 0.44;
  const height = CLOUD_HEIGHT - 3.5 + Math.random() * 5;

  const mat  = new THREE.MeshBasicMaterial({ color: 0xe8eeff, transparent: true, opacity: 0.0 });
  const len  = 1.4 + Math.random() * 1.0;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), mat);
  mesh.position.set(
    cx + wdx * along + perpX * perp,
    height,
    cz + wdz * along + perpZ * perp
  );
  // Orient streak long axis along wind direction
  mesh.rotation.y = Math.atan2(wdx, wdz);
  scene.add(mesh);

  const life = 0.7 + Math.random() * 0.55;
  windStreaks.push({ mesh, mat, velX: wdx * 16, velZ: wdz * 16, lifetime: life, maxLifetime: life });
}

function updateWindStreaks(dt) {
  // Continuously spawn new streaks while blowing
  if (cloudSubState === 'blowing' && windStreaks.length < 28) {
    for (let i = 0; i < 4; i++) spawnWindStreak();
  }
  for (let i = windStreaks.length - 1; i >= 0; i--) {
    const ws = windStreaks[i];
    ws.lifetime -= dt;
    ws.mesh.position.x += ws.velX * dt;
    ws.mesh.position.z += ws.velZ * dt;
    // Fade in for first 20% of life, then fade out
    const prog = ws.lifetime / ws.maxLifetime;
    ws.mat.opacity = prog > 0.8 ? (1 - prog) * 3.5 * 0.72 : prog * 0.72;
    if (ws.lifetime <= 0) {
      scene.remove(ws.mesh);
      windStreaks.splice(i, 1);
    }
  }
}

function clearWindStreaks() {
  for (const ws of windStreaks) scene.remove(ws.mesh);
  windStreaks.length = 0;
}

// Per-frame update for the cloud event sub-state machine.
function updateCloudEvent(dt) {
  if (!cloudGroup) return;

  if (cloudSubState === 'circling') {
    cloudAngle += CLOUD_ORBIT_SPEED * dt;
    cloudGroup.position.x = CLOUD_ORBIT_R * Math.cos(cloudAngle);
    cloudGroup.position.z = CLOUD_ORBIT_R * Math.sin(cloudAngle);
    cloudGroup.rotation.y = Math.atan2(Math.cos(cloudAngle), Math.sin(cloudAngle));
    cloudCircleTimer -= dt;
    if (cloudCircleTimer <= 0) {
      cloudSubState    = 'preparing';
      cloudPrepareTimer = CLOUD_PREPARE_TIME;
    }

  } else if (cloudSubState === 'preparing') {
    // Cloud sits still — builds up for the gust
    cloudPrepareTimer -= dt;
    if (cloudPrepareTimer <= 0) {
      // Swap to blowing mouth
      for (const m of cloudSmileParts) m.visible = false;
      for (const m of cloudBlowParts)  m.visible = true;
      cloudSubState  = 'blowing';
      cloudBlowTimer = CLOUD_BLOW_TIME;
      window.SFX?.windGust();
    }

  } else if (cloudSubState === 'blowing') {
    cloudBlowTimer -= dt;
    updateWindStreaks(dt);

    // Apply wind force to local player if in the corridor.
    // Uses a separate windVelX/Z capped at WIND_MAX_SPEED so player movement remains meaningful.
    if (!isDead && !isGhost) {
      const wdx = -Math.cos(cloudAngle);
      const wdz = -Math.sin(cloudAngle);
      const cx  = cloudGroup.position.x;
      const cz  = cloudGroup.position.z;
      const px  = playerGroup.position.x;
      const pz  = playerGroup.position.z;
      const dx  = px - cx;
      const dz  = pz - cz;
      const along = dx * wdx + dz * wdz;
      const perp  = dx * (-wdz) + dz * wdx;
      if (along > -4 && Math.abs(perp) < WIND_WIDTH * 0.5) {
        windVelX += wdx * WIND_ACCEL * dt;
        windVelZ += wdz * WIND_ACCEL * dt;
        // Cap so sprint (11 u/s) can meaningfully fight the wind
        const spd = Math.hypot(windVelX, windVelZ);
        if (spd > WIND_MAX_SPEED) {
          windVelX = windVelX / spd * WIND_MAX_SPEED;
          windVelZ = windVelZ / spd * WIND_MAX_SPEED;
        }
      }
    }

    if (cloudBlowTimer <= 0) {
      clearWindStreaks();
      // Swap back to smile
      for (const m of cloudBlowParts)  m.visible = false;
      for (const m of cloudSmileParts) m.visible = true;
      cloudGustCount++;
      if (cloudGustCount < CLOUD_GUSTS) {
        cloudSubState    = 'circling';
        cloudCircleTimer = cloudSchedule[cloudGustCount];
      } else {
        cloudSubState       = 'dissipating';
        cloudDissipateTimer = CLOUD_DISSIPATE_S;
      }
    }

  } else if (cloudSubState === 'dissipating') {
    cloudDissipateTimer -= dt;
    const prog = Math.max(0, cloudDissipateTimer / CLOUD_DISSIPATE_S);
    cloudGroup.scale.setScalar(prog);
    if (cloudDissipateTimer <= 0) {
      endEvent(); // self-terminate the event
    }
  }
}

// ------------------------------------------------------------------
// Goblin event helpers
// ------------------------------------------------------------------

function generateGoblinSchedule() {
  let s = (_gameSeed ^ (0x90b11000 + eventCount * 13)) >>> 0;
  function r() { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 0x100000000; }
  const margin = 4;
  const half   = PLATFORM_HALF - margin;
  const TYPES  = ['sword', 'glove', 'bat', 'shield', 'boots', 'banana'];
  const startX = (r() * 2 - 1) * half * 0.4;
  const startZ = (r() * 2 - 1) * half * 0.4;
  const drops  = [];
  for (let i = 0; i < GOBLIN_NUM_DROPS; i++) {
    drops.push({
      x:    (r() * 2 - 1) * half,
      z:    (r() * 2 - 1) * half,
      type: TYPES[Math.floor(r() * TYPES.length)],
    });
  }
  return { startX, startZ, drops };
}

function spawnGoblin() {
  goblinGroup = new THREE.Group();

  const skinMat  = new THREE.MeshStandardMaterial({ color: 0x44bb22, roughness: 0.8 });
  const darkMat  = new THREE.MeshStandardMaterial({ color: 0x228811, roughness: 0.8 });
  const bagMat   = new THREE.MeshStandardMaterial({ color: 0x7a4a1e, roughness: 0.9 });
  const eyeWhMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const eyePuMat = new THREE.MeshStandardMaterial({
    color: 0x111122, emissive: 0x000033, emissiveIntensity: 0.5,
  });
  const grinMat  = new THREE.MeshStandardMaterial({ color: 0x1a0a00 });

  // Body (slightly hunched — taller in front)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.28), skinMat);
  body.position.y = 0.52;
  body.rotation.x = 0.18; // lean forward
  goblinGroup.add(body);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 9, 7), skinMat);
  head.position.y = 0.96;
  goblinGroup.add(head);

  // Pointy ears
  for (const ex of [-0.24, 0.24]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 5), skinMat);
    ear.position.set(ex, 1.01, 0.02);
    ear.rotation.z = ex > 0 ? 0.55 : -0.55;
    goblinGroup.add(ear);
  }

  // Eyes (wide, mischievous — beady)
  for (const ex of [-0.10, 0.10]) {
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.058, 6, 5), eyeWhMat);
    sclera.position.set(ex, 0.98, -0.20);
    goblinGroup.add(sclera);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.034, 5, 4), eyePuMat);
    pupil.position.set(ex, 0.98, -0.23);
    goblinGroup.add(pupil);
  }

  // Big bulbous nose
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), skinMat);
  nose.position.set(0, 0.90, -0.22);
  goblinGroup.add(nose);

  // Wide toothy grin
  const grinBar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.038, 0.06), grinMat);
  grinBar.position.set(0, 0.80, -0.21);
  goblinGroup.add(grinBar);
  // Two little white teeth
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xeeeedd });
  for (const tx of [-0.04, 0.04]) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.055, 0.04), toothMat);
    tooth.position.set(tx, 0.775, -0.22);
    goblinGroup.add(tooth);
  }

  // Treasure bag on back
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.24, 7, 6), bagMat);
  bag.position.set(0.05, 0.58, 0.24);
  bag.scale.set(1, 1.15, 0.85);
  goblinGroup.add(bag);
  const bagKnot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 5, 4),
    new THREE.MeshStandardMaterial({ color: 0xd4a044, metalness: 0.5, roughness: 0.5 }));
  bagKnot.position.set(0.05, 0.78, 0.22);
  goblinGroup.add(bagKnot);
  // Gold coins spilling out hint
  for (let i = 0; i < 3; i++) {
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.018, 7),
      new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.2 }));
    coin.position.set(0.05 + (i - 1) * 0.06, 0.62 + i * 0.025, 0.34 - i * 0.02);
    coin.rotation.x = 0.8 + i * 0.3;
    goblinGroup.add(coin);
  }

  // Arms (will be animated)
  goblinArmL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.27, 0.09), darkMat);
  goblinArmL.position.set(-0.24, 0.54, 0.02);
  goblinArmL.rotation.z =  0.3;
  goblinGroup.add(goblinArmL);
  goblinArmR = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.27, 0.09), darkMat);
  goblinArmR.position.set( 0.24, 0.54, 0.02);
  goblinArmR.rotation.z = -0.3;
  goblinGroup.add(goblinArmR);

  // Legs (will be animated)
  goblinLegL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.30, 0.11), skinMat);
  goblinLegL.position.set(-0.10, 0.20, 0);
  goblinGroup.add(goblinLegL);
  goblinLegR = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.30, 0.11), skinMat);
  goblinLegR.position.set( 0.10, 0.20, 0);
  goblinGroup.add(goblinLegR);

  goblinGroup.position.set(goblinX, 0, goblinZ);
  scene.add(goblinGroup);
}

function despawnGoblin() {
  if (!goblinGroup) return;
  scene.remove(goblinGroup);
  goblinGroup = null;
  goblinLegL  = null; goblinLegR = null;
  goblinArmL  = null; goblinArmR = null;
}

// Returns the solid tile whose centre is closest to (fromX, fromZ), or null.
function findNearestSolidTile(fromX, fromZ) {
  let best = null, bestDist = Infinity;
  for (const t of tileObjects) {
    if (t.state === 'solid') {
      const d = Math.hypot(t.cx - fromX, t.cz - fromZ);
      if (d < bestDist) { bestDist = d; best = t; }
    }
  }
  return best;
}

function updateGoblinEvent(dt) {
  if (!goblinGroup) return;
  goblinEventElapsed += dt;

  if (goblinSubState === 'jumping') {
    // Arc physics — horizontal move toward jump target, vertical governed by gravity
    goblinVelY -= GRAVITY * dt;
    goblinY    += goblinVelY * dt;
    const jdx = goblinJumpTargetX - goblinX, jdz = goblinJumpTargetZ - goblinZ;
    const jdist = Math.hypot(jdx, jdz);
    if (jdist > 0.25) {
      // Speed ensures we always arrive (at least GOBLIN_SPEED, more if we're close)
      const spd = Math.max(GOBLIN_SPEED * 1.5, jdist / 0.35);
      goblinX += (jdx / jdist) * spd * dt;
      goblinZ += (jdz / jdist) * spd * dt;
      goblinAngle = Math.atan2(jdx / jdist, jdz / jdist);
    }
    // Land when descending back to ground level
    if (goblinVelY < 0 && goblinY <= 0) {
      goblinY        = 0;
      goblinVelY     = 0;
      goblinX        = goblinJumpTargetX;
      goblinZ        = goblinJumpTargetZ;
      goblinSubState = 'dropping';
    }

  } else if (goblinSubState === 'dropping') {
    if (goblinEventElapsed > GOBLIN_MAX_TIME || goblinDropIdx >= goblinSchedule.drops.length) {
      // All drops done (or timed out) — flee
      goblinSubState = 'fleeing';
      goblinVelY     = 7;
      goblinY        = 0;
      _startGoblinFlee();
    } else {
      // ── Tile safety: if the tile we're standing on is sinking/gone, jump to safety ──
      const curTile = getTileAt(goblinX, goblinZ);
      if (!curTile || curTile.state === 'sinking' || curTile.state === 'gone') {
        const safe = findNearestSolidTile(goblinX, goblinZ);
        if (safe) {
          goblinJumpTargetX = safe.cx;
          goblinJumpTargetZ = safe.cz;
          goblinSubState    = 'jumping';
          goblinVelY        = 5.5;
        } else {
          // No tiles left at all — flee immediately
          goblinSubState = 'fleeing';
          goblinVelY = 7; goblinY = 0;
          _startGoblinFlee();
        }
      } else {
        // ── Find an effective target tile, redirecting if the original is gone ──
        const drop = goblinSchedule.drops[goblinDropIdx];
        let targetX = drop.x, targetZ = drop.z;
        const tgt = getTileAt(targetX, targetZ);
        if (!tgt || tgt.state !== 'solid') {
          // Redirect: closest solid tile to the intended drop spot
          const redir = findNearestSolidTile(targetX, targetZ);
          if (redir) { targetX = redir.cx; targetZ = redir.cz; }
          else       { goblinDropIdx++; } // no tiles left, skip this drop
        }

        const dx = targetX - goblinX, dz = targetZ - goblinZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.55) {
          // Arrived — drop item at goblin's current position
          const itemId = 0x70000000 + eventCount * 200 + goblinDropIdx;
          if (!groundItems.some(it => it.id === itemId)) {
            const it = makeGroundItem(drop.type, goblinX, goblinZ, itemId);
            groundItems.push(it);
            sendItemEvent?.({ act: 'spawn', id: it.id, type: it.type, x: it.x, z: it.z });
            window.SFX?.goblinDrop();
          }
          goblinDropIdx++;
        } else {
          // ── Look-ahead gap check: if the next step lands on a sinking/gone tile, jump ──
          const nx = dx / dist, nz = dz / dist;
          const stepX = goblinX + nx * 1.8, stepZ = goblinZ + nz * 1.8;
          const stepTile = getTileAt(stepX, stepZ);
          if (stepTile && (stepTile.state === 'sinking' || stepTile.state === 'gone')) {
            // Gap ahead — jump directly to target tile
            goblinJumpTargetX = targetX;
            goblinJumpTargetZ = targetZ;
            goblinSubState    = 'jumping';
            goblinVelY        = 5.0;
          } else {
            goblinX += nx * GOBLIN_SPEED * dt;
            goblinZ += nz * GOBLIN_SPEED * dt;
            goblinAngle = Math.atan2(nx, nz);
          }
        }
      }
    }

  } else if (goblinSubState === 'fleeing') {
    const dx = goblinFleeTargetX - goblinX, dz = goblinFleeTargetZ - goblinZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0.2) {
      const nx = dx / dist, nz = dz / dist;
      goblinX += nx * GOBLIN_SPEED * GOBLIN_FLEE_MULT * dt;
      goblinZ += nz * GOBLIN_SPEED * GOBLIN_FLEE_MULT * dt;
      goblinAngle = Math.atan2(nx, nz);
    }
    goblinVelY -= GRAVITY * dt;
    goblinY    += goblinVelY * dt;
    // Fade out as goblin falls — fully invisible by y = -5
    const fade = Math.max(0, Math.min(1, 1 + goblinY * 0.22));
    goblinGroup.traverse(child => {
      if (child.isMesh && child.material) child.material.opacity = fade;
    });
    if (goblinY < -5) {
      endEvent();
      return;
    }
  }

  // Animate limbs
  goblinBobPhase += GOBLIN_SPEED * dt * 2.5;
  const swing = Math.sin(goblinBobPhase) * 0.55;
  if (goblinLegL) goblinLegL.rotation.x =  swing;
  if (goblinLegR) goblinLegR.rotation.x = -swing;
  if (goblinArmL) goblinArmL.rotation.x = -swing * 0.65;
  if (goblinArmR) goblinArmR.rotation.x =  swing * 0.65;

  // Y position: bob when running on ground, arc when jumping, gravity when fleeing
  if (goblinSubState === 'dropping') goblinY = Math.abs(Math.sin(goblinBobPhase)) * 0.18;
  goblinGroup.position.set(goblinX, goblinY, goblinZ);
  // +Math.PI so the face (local -Z) always points in the direction of travel
  goblinGroup.rotation.y = goblinAngle + Math.PI;
}

function _startGoblinFlee() {
  // Run toward nearest edge — pick the axis where goblin is closer to edge
  const toRight = PLATFORM_HALF - goblinX;
  const toLeft  = PLATFORM_HALF + goblinX;
  const toFront = PLATFORM_HALF - goblinZ;
  const toBack  = PLATFORM_HALF + goblinZ;
  const minDist = Math.min(toRight, toLeft, toFront, toBack);
  if (minDist === toRight)      { goblinFleeTargetX = PLATFORM_HALF + 12; goblinFleeTargetZ = goblinZ; }
  else if (minDist === toLeft)  { goblinFleeTargetX = -(PLATFORM_HALF + 12); goblinFleeTargetZ = goblinZ; }
  else if (minDist === toFront) { goblinFleeTargetX = goblinX; goblinFleeTargetZ = PLATFORM_HALF + 12; }
  else                          { goblinFleeTargetX = goblinX; goblinFleeTargetZ = -(PLATFORM_HALF + 12); }
  // Enable transparency on all goblin materials so opacity can be animated during fall
  goblinGroup.traverse(child => {
    if (child.isMesh && child.material) {
      child.material = child.material.clone();
      child.material.transparent = true;
      child.material.opacity = 1.0;
    }
  });
}

const CAM_DIST   = 5;
const CAM_HEIGHT = 2.5;

const _dir    = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _euler  = new THREE.Euler(0, 0, 0, 'YXZ');

let prev = performance.now();
let time = 0;
let gameTime = 0;  // elapsed seconds within the current match
let lastBroadcast = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - prev) / 1000, 0.05);
  prev = now;
  time += dt;

  // --- Game timers ---
  if (gameState === 'playing') {
    gameTime += dt;
    // Tile drop scheduling
    if (tileDropIndex < TILE_TOTAL && gameTime >= nextTileTime) {
      const idx = tileOrder[tileDropIndex];
      const tile = tileObjects[idx];
      if (tile && tile.state === 'solid') {
        tile.state = 'warning';
        tile.timer = TILE_WARN_S;
      }
      tileDropIndex++;
      nextTileTime = gameTime + TILE_INTERVAL;
    }
    // Tile state machine
    for (const t of tileObjects) {
      if (t.state === 'warning') {
        t.timer -= dt;
        // Flash the tile between warning orange and the round's solid colour
        const flash = Math.sin(t.timer * 14) > 0;
        if (flash) t.mesh.material.color.set(0xff4400);
        else t.mesh.material.color.copy(t.solidColor);
        if (t.timer <= 0) {
          t.state = 'sinking'; t.timer = TILE_SINK_S; t.mesh.material.color.set(0x220800);
          // Drop the player if they're standing on this tile
          if (onGround && getTileAt(playerGroup.position.x, playerGroup.position.z) === t) {
            onGround = false;
          }
        }
      } else if (t.state === 'sinking') {
        t.timer -= dt;
        t.mesh.position.y = -2 - (1 - t.timer / TILE_SINK_S) * 6;
        if (t.timer <= 0) { t.state = 'gone'; t.mesh.visible = false; }
      }
    }
    // Ghost punch cooldown
    if (isGhost && ghostPunchCooldown > 0) ghostPunchCooldown -= dt;
    // Win condition check (every ~0.5s)
    if (Math.floor(gameTime * 2) !== Math.floor((gameTime - dt) * 2)) checkWinCondition();

    // --- Random event system (deterministic — all clients run in sync via shared seed) ---
    if (eventState === 'idle' && gameTime >= nextEventTime) {
      triggerEvent(EVENT_TYPES[eventCount % EVENT_TYPES.length]);
    }
    if (eventState === 'announcing') {
      eventTimer -= dt;
      if (eventTimer <= 0) beginEvent();
    }
    if (eventState === 'running') {
      eventTimer -= dt;
      if (eventType === 'rain_bananas') {
        rainEventElapsed += dt;
        // Spawn every banana whose scheduled time has been reached
        while (rainScheduleIdx < rainSchedule.length &&
               rainSchedule[rainScheduleIdx].t <= rainEventElapsed) {
          const entry = rainSchedule[rainScheduleIdx++];
          spawnFallingBananaVisual(entry.x, entry.z, entry.peelId);
        }
      } else if (eventType === 'clouds_alive') {
        updateCloudEvent(dt);
      } else if (eventType === 'loot_goblin') {
        updateGoblinEvent(dt);
      }
      if (eventTimer <= 0 && eventState === 'running') endEvent();
    }
    // --- Falling banana physics & landing ---
    for (let i = fallingBananas.length - 1; i >= 0; i--) {
      const fb = fallingBananas[i];
      fb.velY -= GRAVITY * dt;
      fb.group.position.y += fb.velY * dt;
      fb.group.rotation.x += fb.rotVX * dt;
      fb.group.rotation.z += fb.rotVZ * dt;
      if (fb.group.position.y <= 0.1) {
        // Landed — place peel using its deterministic ID (same on every client)
        if (fb.peelId !== null && !isTileUnstable(fb.x, fb.z) && getTileAt(fb.x, fb.z)) {
          if (!bananaPeels.some(p => p.id === fb.peelId)) {
            const g = makeBananaPeel(fb.x, fb.z);
            bananaPeels.push({ group: g, x: fb.x, z: fb.z, id: fb.peelId });
            // Broadcast so peers with slight timing drift also see the peel land
            sendPeel?.({ act: 'place', id: fb.peelId, x: fb.x, z: fb.z });
            window.SFX?.bananaPlace();
          }
        }
        scene.remove(fb.group);
        fallingBananas.splice(i, 1);
      }
    }
  }

  // Game over countdown — runs in 'gameover' state (outside the 'playing' block)
  if (gameState === 'gameover' && gameOverTimer > 0) {
    gameOverTimer -= dt;
    if (gameOverTimer <= 0) returnToLobby();
  }

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

  // Banana immunity countdown
  if (bananaImmunityTimer > 0) bananaImmunityTimer -= dt;

  // Slip timer (controls how long steering is locked out)
  if (isSlipping) {
    slipTimer -= dt;
    if (slipTimer <= 0) isSlipping = false;
  }

  // Ghost flight mode
  if (isGhost) {
    isMoving = _dir.lengthSq() > 0;
    if (isMoving) {
      _dir.normalize().applyEuler(_euler);
      playerGroup.position.x += _dir.x * GHOST_SPEED * dt;
      playerGroup.position.z += _dir.z * GHOST_SPEED * dt;
      playerGroup.rotation.y = Math.atan2(_dir.x, _dir.z);
    }
    if (keys[' '])     playerGroup.position.y += GHOST_SPEED * dt;
    if (keys['shift']) playerGroup.position.y -= GHOST_SPEED * dt;
    // Gentle float bob on ghost body
    playerGhostBody.position.y = Math.sin(time * 2.4) * 0.08;
    // Ghost punch indicator
    const hint = document.getElementById('hint');
    if (hint && isLocked) {
      const cd = ghostPunchCooldown;
      hint.textContent = cd > 0 ? `👻 Ghost punch ready in ${cd.toFixed(1)}s` : '👻 LMB — Ghost Punch (big knockback)';
    }
  } else {
    isMoving = _dir.lengthSq() > 0 && !isDead && !isSlipping;
  }

  const isSprinting = keys['shift'] && !isGhost;
  const speed = SPEED * (isSprinting ? SPRINT_MULT : 1);

  if (isMoving && !isGhost) {
    _dir.normalize().applyEuler(_euler);
    playerGroup.position.x += _dir.x * speed * dt;
    playerGroup.position.z += _dir.z * speed * dt;
    playerGroup.rotation.y  = Math.atan2(_dir.x, _dir.z);
  }

  if (!isGhost) {
  // Knockback — exponential decay
  const decay = Math.exp(-PUNCH_DECAY * dt);
  velX *= decay;
  velZ *= decay;
  playerGroup.position.x += velX * dt;
  playerGroup.position.z += velZ * dt;
  // Wind push — same decay so it fades quickly once out of the corridor
  windVelX *= decay;
  windVelZ *= decay;
  playerGroup.position.x += windVelX * dt;
  playerGroup.position.z += windVelZ * dt;
  }

  // --- Collision resolution (skip for ghosts) ---
  if (!isGhost) {
  const PLAYER_R = 0.32;

  // vs pillars — climb if top is within reach, otherwise push out
  for (const p of pillarData) {
    const ov = circleOverlap(playerGroup.position.x, playerGroup.position.z, p.x, p.z, p.r + PLAYER_R);
    if (ov) {
      const heightDiff = p.topY - playerGroup.position.y;
      if (heightDiff > 0.5 && heightDiff <= MAX_CLIMBABLE) {
        // Climbing: boost upward + full push-out so sprinting can't clip through
        if (velY < CLIMB_SPEED) velY = CLIMB_SPEED;
        onGround = false;
        playerGroup.position.x += ov.nx;
        playerGroup.position.z += ov.nz;
      } else if (playerGroup.position.y < p.topY) {
        // Too tall or below — solid wall
        playerGroup.position.x += ov.nx;
        playerGroup.position.z += ov.nz;
      }
    }
  }

  // vs elevated platforms — climb if top within reach, otherwise push out.
  // Uses OBB closest-point so rotated shapes (low wall, toppled column)
  // only collide against their actual footprint, not an inflated AABB.
  for (const ep of elevatedPlatforms) {
    const px = playerGroup.position.x, pz = playerGroup.position.z, py = playerGroup.position.y;
    if (py >= ep.topY) continue; // above the platform — no side collision

    // Closest point on OBB to player XZ
    let cx, cz;
    if (ep.angle === 0) {
      // Fast path for axis-aligned boxes
      cx = Math.max(ep.x - ep.hw, Math.min(ep.x + ep.hw, px));
      cz = Math.max(ep.z - ep.hd, Math.min(ep.z + ep.hd, pz));
    } else {
      // Rotate player into box-local frame, clamp, rotate back
      const ca = Math.cos(ep.angle), sa = Math.sin(ep.angle);
      const localX = (px - ep.x) * ca + (pz - ep.z) * sa;
      const localZ = -(px - ep.x) * sa + (pz - ep.z) * ca;
      const clampX = Math.max(-ep.hw, Math.min(ep.hw, localX));
      const clampZ = Math.max(-ep.hd, Math.min(ep.hd, localZ));
      cx = ep.x + clampX * ca - clampZ * sa;
      cz = ep.z + clampX * sa + clampZ * ca;
    }

    const dx = px - cx, dz = pz - cz;
    const dist2 = dx * dx + dz * dz;
    if (dist2 >= PLAYER_R * PLAYER_R) continue;
    const dist = Math.sqrt(dist2);
    const heightDiff = ep.topY - py;
    if (heightDiff > 0.5 && heightDiff <= MAX_CLIMBABLE) {
      // Climbing: boost upward + full push-out so sprinting can't clip through
      if (velY < CLIMB_SPEED) velY = CLIMB_SPEED;
      onGround = false;
      if (dist > 0.001) {
        const s = (PLAYER_R - dist) / dist;
        playerGroup.position.x += dx * s;
        playerGroup.position.z += dz * s;
      }
    } else {
      // Solid — push out
      if (dist > 0.001) {
        const s = (PLAYER_R - dist) / dist;
        playerGroup.position.x += dx * s;
        playerGroup.position.z += dz * s;
      } else {
        // Player center inside box — push on shortest axis (local frame)
        const ca2 = Math.cos(ep.angle), sa2 = Math.sin(ep.angle);
        const lx2 = (px - ep.x) * ca2 + (pz - ep.z) * sa2;
        const lz2 = -(px - ep.x) * sa2 + (pz - ep.z) * ca2;
        const overX = ep.hw + PLAYER_R - Math.abs(lx2);
        const overZ = ep.hd + PLAYER_R - Math.abs(lz2);
        if (overX < overZ) {
          playerGroup.position.x += Math.sign(lx2) * overX * ca2;
          playerGroup.position.z += Math.sign(lx2) * overX * sa2;
        } else {
          playerGroup.position.x -= Math.sign(lz2) * overZ * sa2;
          playerGroup.position.z += Math.sign(lz2) * overZ * ca2;
        }
      }
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

  // Jump is handled in keydown listener (once per press)

  // Gravity
  if (!onGround) velY -= GRAVITY * dt;
  playerGroup.position.y += velY * dt;

  // Once below the platform surface, lock out any landing — player must fall to their death
  if (!hasFallenOff && playerGroup.position.y < -0.5) {
    hasFallenOff = true;
    onGround = false;
  }

  // Walked off current surface — check if surface is no longer underfoot
  if (onGround && !hasFallenOff) {
    const surf = getSurfaceBelow(playerGroup.position.x, playerGroup.position.z);
    if (surf === null || surf < playerGroup.position.y - 0.1) onGround = false;
  }

  // Landing — snap to highest surface when descending through it
  if (!onGround && !hasFallenOff && velY <= 0) {
    const surf = getSurfaceBelow(playerGroup.position.x, playerGroup.position.z);
    if (surf !== null && playerGroup.position.y <= surf + 0.05) {
      playerGroup.position.y = surf;
      velY = 0;
      onGround = true;
      hasDoubleJumped = false;
    }
  }

  // Fell too far
  if (playerGroup.position.y < FALL_DEATH_Y) die();

  } // end !isGhost physics block

  // Local limb swing — faster when sprinting
  const swingSpeed = isSprinting ? 13 : 8;
  const swing = isMoving ? Math.sin(time * swingSpeed) * 0.5 : 0;
  leftLeg.rotation.x  =  swing;
  rightLeg.rotation.x = -swing;

  // Shield raise animation — smoothly lifts arm into guard position
  const shieldBlocking = hasShield && isBlocking;
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

  // --- Camera ---
  if (gameState === 'playing') {
    // Third-person follow camera
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
  } else {
    // Cinematic orbit camera for lobby and game over screens
    const orbitRadius = 52;
    const orbitHeight = 28;
    const orbitSpeed  = 0.18; // radians per second
    const orbitAngle  = time * orbitSpeed;
    camera.position.set(
      Math.sin(orbitAngle) * orbitRadius,
      orbitHeight,
      Math.cos(orbitAngle) * orbitRadius
    );
    camera.lookAt(0, 2, 0);
  }

  // --- Item spawning (host only — result broadcast to all peers) ---
  if (gameState === 'playing' && isHost && Date.now() >= itemTimer && groundItems.length < MAX_ITEMS) {
    itemTimer = Date.now() + ITEM_INTERVAL;
    const pos = randomItemPos();
    if (pos) {
      const r = Math.random();
      const type = r < 0.18 ? 'sword' : r < 0.36 ? 'shield' : r < 0.52 ? 'glove' : r < 0.66 ? 'bat' : r < 0.83 ? 'boots' : 'banana';
      const it = makeGroundItem(type, pos.x, pos.z);
      groundItems.push(it);
      sendItemEvent?.({ act: 'spawn', id: it.id, type: it.type, x: it.x, z: it.z });
    }
  }

  // --- Ground item bobbing, expiry, and tile removal ---
  for (let i = groundItems.length - 1; i >= 0; i--) {
    const it = groundItems[i];
    let removed = false;
    if (isTileUnstable(it.x, it.z)) {
      scene.remove(it.group);
      groundItems.splice(i, 1);
      if (isHost) sendItemEvent?.({ act: 'remove', id: it.id });
      continue;
    }
    const timeLeft = it.expires - time;
    if (timeLeft <= 0) {
      scene.remove(it.group);
      groundItems.splice(i, 1);
      if (isHost) sendItemEvent?.({ act: 'remove', id: it.id });
      continue;
    }
    // Flicker in the last 3 seconds to warn players it's about to vanish
    it.group.visible = timeLeft < 3 ? Math.sin(time * 18) > 0 : true;
    const itemBaseY = it.type === 'sword' ? 0.22 : 0.1;
    it.group.position.y = itemBaseY + Math.sin(time * 2.5 + it.x) * 0.08;
    it.group.rotation.y += dt * 1.2;
  }


  // --- Banana peel tile-sinking removal ---
  for (let i = bananaPeels.length - 1; i >= 0; i--) {
    const peel = bananaPeels[i];
    if (isTileUnstable(peel.x, peel.z)) {
      scene.remove(peel.group);
      bananaPeels.splice(i, 1);
      sendPeel?.({ act: 'remove', id: peel.id });
    }
  }

  // --- Banana peel slip detection (local player only) ---
  if (gameState === 'playing' && !isDead && !isGhost && !isSlipping && bananaImmunityTimer <= 0) {
    const ppx = playerGroup.position.x, ppz = playerGroup.position.z;
    for (let i = bananaPeels.length - 1; i >= 0; i--) {
      const peel = bananaPeels[i];
      if (Math.hypot(ppx - peel.x, ppz - peel.z) < PEEL_PICKUP_R) {
        // Slip!
        isSlipping = true;
        slipTimer = 0.65;
        velX = Math.sin(playerGroup.rotation.y) * BANANA_SLIDE_FORCE;
        velZ = Math.cos(playerGroup.rotation.y) * BANANA_SLIDE_FORCE;
        window.SFX?.bananaSlip();
        sendPeel?.({ act: 'slip', id: peel.id });
        removePeelById(peel.id);
        break;
      }
    }
  }

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

    // Shield raise (left arm)
    const pTargetLX = peer.blocking ? -1.5 : -ps * 0.6;
    const pTargetLZ = peer.blocking ?  0.05 :  0.15;
    peer.leftArm.rotation.x += (pTargetLX - peer.leftArm.rotation.x) * Math.min(1, dt * 14);
    peer.leftArm.rotation.z += (pTargetLZ - peer.leftArm.rotation.z) * Math.min(1, dt * 14);

    // Punch animation (right arm)
    if (peer.punchTimer > 0) {
      peer.punchTimer = Math.max(0, peer.punchTimer - dt);
      peer.rightArm.rotation.x = -Math.sin((1 - peer.punchTimer / 0.35) * Math.PI) * 1.6;
    } else {
      peer.rightArm.rotation.x = ps * 0.6;
    }

    // Ghost body bob
    if (peer.isGhost && peer.ghostBody) {
      peer.ghostBody.position.y = Math.sin(time * 2.4 + peer.tx * 0.5) * 0.08;
    }
  }

  // --- Lightning effects ---
  for (let i = activeEffects.length - 1; i >= 0; i--) {
    const ef = activeEffects[i];
    ef.timer -= dt;
    const t = Math.max(0, ef.timer / ef.maxTimer); // 1→0
    ef.light.intensity = 18 * t * t;
    ef.glow.intensity  =  8 * t;
    // Flicker bolts rapidly
    for (const bolt of ef.bolts) bolt.visible = t > 0.4 ? (Math.random() > 0.25) : (Math.random() > 0.6);
    if (ef.timer <= 0) { scene.remove(ef.group); activeEffects.splice(i, 1); }
  }

  // --- Broadcast self at ~15 Hz ---
  if (now - lastBroadcast > 66) {
    lastBroadcast = now;
    broadcastSelf();
  }


  renderer.render(scene, camera);
}

// ------------------------------------------------------------------
// Menu setup
// ------------------------------------------------------------------

function updateMenuReadyList() {
  if (!readyListEl) return;
  readyListEl.innerHTML = '';
  // Local player
  const localEntry = document.createElement('div');
  localEntry.className = 'ready-entry';
  localEntry.innerHTML = `<span class="ready-dot ${localReady ? 'is-ready' : ''}"></span><span style="color:#${incoming.color}">${incoming.username}</span>`;
  readyListEl.appendChild(localEntry);
  // Peers
  for (const peer of peers.values()) {
    const e = document.createElement('div');
    e.className = 'ready-entry';
    e.innerHTML = `<span class="ready-dot ${peer.ready ? 'is-ready' : ''}"></span><span style="color:#${peer.pColor || 'ffffff'}">${peer.username || '?'}</span>`;
    readyListEl.appendChild(e);
  }
  // Enable start button if local player is ready
  if (btnStart) btnStart.disabled = !localReady;
}

if (btnReady) {
  btnReady.addEventListener('click', () => {
    window.MenuMusic?.start(); // ensure menu music starts on first interaction
    localReady = !localReady;
    btnReady.textContent = localReady ? 'Cancel Ready' : 'Ready Up';
    btnReady.classList.toggle('is-ready', localReady);
    sendGameEvent?.({ type: 'ready', ready: localReady });
    updateMenuReadyList();
  });
}

if (btnStart) {
  btnStart.addEventListener('click', () => {
    if (!localReady) return;
    const seed = Date.now() & 0xffffffff;
    startGame(seed, true);
  });
}

// Name input in lobby menu — stays in sync with HUD username
const menuNameInput = document.getElementById('menu-name-input');
if (menuNameInput) {
  menuNameInput.value = incoming.username;
  menuNameInput.addEventListener('input', () => {
    const trimmed = menuNameInput.value.trim().slice(0, 32);
    if (!trimmed) return; // don't commit blank
    incoming.username = trimmed;
    usernameEl.textContent = trimmed;
    broadcastSelf();
    updateMenuReadyList();
  });
  // Block WASD / space from firing while typing
  menuNameInput.addEventListener('keydown', e => e.stopPropagation());
  menuNameInput.addEventListener('keyup',   e => e.stopPropagation());
}

// Keep menu input fresh if the HUD name is changed during a match
usernameEl.addEventListener('blur', () => {
  if (menuNameInput) menuNameInput.value = incoming.username;
}, true);

// Lobby button
document.getElementById('btn-lobby')?.addEventListener('click', () => {
  Portal.sendPlayerThroughPortal(LOBBY_URL, {
    username: incoming.username,
    color:    incoming.color,
    speed:    SPEED,
  });
});

// Show lobby menu on load
if (menuEl) menuEl.classList.add('active');
hasArmor = localStorage.getItem('arenaHasArmor') === '1';
playerArmorGroup.visible = false; // hidden in lobby

loop(performance.now());
