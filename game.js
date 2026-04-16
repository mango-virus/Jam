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
  pillarData.push({ x, z, r: w / 2, topY: h });
}

// ------------------------------------------------------------------
// Elevated step platforms
// ------------------------------------------------------------------

const CLIMB_SPEED   = 2.5;   // m/s upward when pressing into a climbable object
const MAX_CLIMBABLE = 2.2;   // max height above current Y that can be climbed

const elevatedPlatforms = []; // { x, z, hw, hd, topY }

const EP_DEFS = [
  { x:  7,  z: -5,  w: 5.0, d: 3.0, h: 0.8,  color: 0x3a1858 },
  { x: -6,  z: -8,  w: 4.0, d: 4.0, h: 1.2,  color: 0x1a2a50 },
  { x:  1,  z: 10,  w: 5.0, d: 2.5, h: 0.7,  color: 0x1e3830 },
  { x:-10,  z: 11,  w: 3.5, d: 4.0, h: 1.6,  color: 0x3a1818 },
  { x:  8,  z:-11,  w: 4.0, d: 4.0, h: 1.0,  color: 0x2a2050 },
  { x: -2,  z:  2,  w: 3.5, d: 3.5, h: 3.0,  color: 0x1a0840 },
];

for (const d of EP_DEFS) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(d.w, d.h, d.d),
    new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.8, metalness: 0.05 })
  );
  mesh.position.set(d.x, d.h / 2, d.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  elevatedPlatforms.push({ x: d.x, z: d.z, hw: d.w / 2, hd: d.d / 2, topY: d.h });
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

const tileMat = new THREE.MeshStandardMaterial({ color: 0x3d2060, roughness: 0.85, metalness: 0.1 });

for (let row = 0; row < TILE_ROWS; row++) {
  for (let col = 0; col < TILE_COLS; col++) {
    const tx = -PLATFORM_HALF + tileSize * (col + 0.5);
    const tz = -PLATFORM_HALF + tileSize * (row + 0.5);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(tileSize - 0.12, 4.05, tileSize - 0.12),
      tileMat.clone()
    );
    mesh.position.set(tx, -2, tz);
    mesh.receiveShadow = true;
    mesh.castShadow    = false;
    mesh.visible       = false; // hidden until game starts
    scene.add(mesh);
    tileObjects.push({ mesh, col, row, cx: tx, cz: tz, state: 'solid', timer: 0 });
  }
}

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

  // Shield (shown in left hand when equipped)
  const shieldEquip = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.42, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x2244cc, roughness: 0.5, metalness: 0.3 })
  );
  shieldEquip.position.set(0, -0.56, 0);
  shieldEquip.rotation.x = Math.PI / 2;
  shieldEquip.visible = false;
  const shieldEmblem = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.07),
    new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 }));
  shieldEmblem.position.set(0, 0, 0.05);
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

  // Boxing glove (shown in right hand when equipped)
  const gloveGroup = new THREE.Group();
  gloveGroup.position.set(0, -0.50, 0.06);
  gloveGroup.visible = false;
  // Main glove body — red sphere, wider than tall
  const gloveMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xcc2200, roughness: 0.55, metalness: 0.08 }));
  gloveMesh.scale.set(1.35, 1.05, 1.2);
  gloveGroup.add(gloveMesh);
  // Knuckle ridge — slightly lighter strip across the front
  const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xdd3300, roughness: 0.5 }));
  knuckle.position.set(0, 0.04, 0.12);
  gloveGroup.add(knuckle);
  // Wrist cuff — white wrap
  const gloveCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.10, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }));
  gloveCuff.position.y = 0.16;
  gloveGroup.add(gloveCuff);
  // Velcro strap — dark strip on cuff
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.11),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }));
  strap.position.set(0, 0.19, 0.04);
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

  normalBody.add(rightArm);

  // Legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1a0030, roughness: 0.6 });
  const legGeo = new THREE.BoxGeometry(0.17, 0.5, 0.17);
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.13, 0.15, 0);
  leftLeg.castShadow = true;
  normalBody.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.13, 0.15, 0);
  rightLeg.castShadow = true;
  normalBody.add(rightLeg);

  // Eyeballs
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const eyePupilMat = new THREE.MeshStandardMaterial({ color: 0x110022, roughness: 0.2 });
  const ewGeo = new THREE.SphereGeometry(0.06, 8, 8);
  const pupilGeo = new THREE.SphereGeometry(0.035, 8, 8);
  for (const ex of [-0.09, 0.09]) {
    const white = new THREE.Mesh(ewGeo, eyeWhiteMat);
    white.position.set(ex, 1.25, 0.175);
    normalBody.add(white);
    const pupil = new THREE.Mesh(pupilGeo, eyePupilMat);
    pupil.position.set(ex, 1.25, 0.21);
    normalBody.add(pupil);
  }

  // Hat — random style each spawn
  const hatStyle = Math.floor(Math.random() * 6);
  const hatColor  = [0x1a0030, 0x8b1a00, 0x0a3a0a, 0x1a1a1a, 0x7a3800, 0x001a3a][hatStyle];
  const hatAccent = [0xc64bff, 0xff4f4f, 0x4fff88, 0xffcc00, 0xff8c00, 0x4fddff][hatStyle];
  const hMat  = new THREE.MeshStandardMaterial({ color: hatColor, roughness: 0.5, metalness: 0.1 });
  const hAccM = new THREE.MeshStandardMaterial({ color: hatAccent, emissive: new THREE.Color(hatAccent).multiplyScalar(0.4), roughness: 0.3 });

  if (hatStyle === 0) {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 16), hMat);
    brim.position.y = 1.44; brim.castShadow = true; normalBody.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.20, 0.42, 16), hMat);
    crown.position.y = 1.69; crown.castShadow = true; normalBody.add(crown);
    const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.07, 16), hAccM);
    ribbon.position.y = 1.49; normalBody.add(ribbon);

  } else if (hatStyle === 1) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.10, 3), hMat);
    base.position.y = 1.46; base.castShadow = true; normalBody.add(base);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.30, 3), hMat);
    crown.position.y = 1.66; crown.castShadow = true; normalBody.add(crown);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.04), hAccM);
    skull.position.set(0, 1.72, 0.19); normalBody.add(skull);

  } else if (hatStyle === 2) {
    const beret = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.10, 16), hMat);
    beret.position.y = 1.47; beret.castShadow = true; normalBody.add(beret);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.20, 10, 6), hMat);
    puff.scale.y = 0.55; puff.position.y = 1.54; normalBody.add(puff);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), hAccM);
    button.position.y = 1.67; normalBody.add(button);

  } else if (hatStyle === 3) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 16, 1, true), hAccM);
    ring.position.y = 1.51; normalBody.add(ring);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.18, 6), hAccM);
      spike.position.set(Math.sin(a) * 0.20, 1.69, Math.cos(a) * 0.20);
      normalBody.add(spike);
    }
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), new THREE.MeshStandardMaterial({ color: 0xff2255, emissive: 0x880022, metalness: 1, roughness: 0 }));
    gem.position.y = 1.52; normalBody.add(gem);

  } else if (hatStyle === 4) {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 16), hMat);
    brim.position.y = 1.44; brim.castShadow = true; normalBody.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.28, 16), hMat);
    crown.position.y = 1.62; crown.castShadow = true; normalBody.add(crown);
    const dent = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 5), hMat);
    dent.scale.y = 0.5; dent.position.y = 1.74; normalBody.add(dent);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.06, 16), hAccM);
    band.position.y = 1.49; normalBody.add(band);

  } else {
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.20), hMat);
    peak.position.set(0, 1.44, 0.14); peak.castShadow = true; normalBody.add(peak);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.16, 16), hMat);
    body.position.y = 1.54; normalBody.add(body);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.04, 16), hAccM);
    top.position.y = 1.63; normalBody.add(top);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.03), hAccM);
    badge.position.set(0, 1.55, 0.24); normalBody.add(badge);
  }

  // Armor group — chest plate, shoulder pads, helmet visor, hidden by default
  const armorGroup = new THREE.Group();
  const armorMat = new THREE.MeshStandardMaterial({ color: 0xb8c8d8, metalness: 0.85, roughness: 0.18 });
  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.5, 0.12), armorMat);
  chestPlate.position.set(0, 0.68, 0.2);
  armorGroup.add(chestPlate);
  const lShoulder = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.22), armorMat);
  lShoulder.position.set(-0.38, 0.95, 0);
  armorGroup.add(lShoulder);
  const rShoulder = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.22), armorMat);
  rShoulder.position.set(0.38, 0.95, 0);
  armorGroup.add(rShoulder);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x4488ff, metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.75 }));
  visor.position.set(0, 1.19, 0.21);
  armorGroup.add(visor);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.18, 0.40), armorMat);
  helmet.position.set(0, 1.32, 0);
  armorGroup.add(helmet);
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

  return { group, normalBody, ghostBody, leftArm, rightArm, leftLeg, rightLeg, swordGroup, gloveGroup, batGroup, shieldEquip, shieldEmblem, armorGroup };
}

// ------------------------------------------------------------------
// Local player
// ------------------------------------------------------------------

const { group: playerGroup, normalBody: playerNormalBody, ghostBody: playerGhostBody,
        leftArm, rightArm, leftLeg, rightLeg,
        swordGroup: playerSword, gloveGroup: playerGlove, batGroup: playerBat,
        shieldEquip: playerShield, shieldEmblem: playerShieldEmblem,
        armorGroup: playerArmorGroup } = makeCharacter('#' + incoming.color);
scene.add(playerGroup);


// ------------------------------------------------------------------
// Item system
// ------------------------------------------------------------------

const MAX_ITEMS       = 5;
const ITEM_INTERVAL   = 10000; // ms between item spawn attempts
const ITEM_PICKUP_R   = 1.4;   // metres to pick up item
const SWORD_KNOCKBACK       = 38;
const GLOVE_KNOCKBACK       = 70;
const BAT_HOME_RUN_KNOCKBACK = 260;
const BAT_NORMAL_KNOCKBACK  = 8;

let itemTimer  = Date.now() + 5000; // first item after 5s
const groundItems = []; // { group, type, x, z }
let hasSword       = false;
let swordDurability  = 0;
let hasShield      = false;
let shieldDurability = 0;
let hasGlove       = false;
let gloveDurability  = 0;
let hasBat         = false;
let batDurability    = 0;
let isBlocking     = false;

const SWORD_DURABILITY  = 10;
const SHIELD_DURABILITY = 7;
const GLOVE_DURABILITY  = 4;
const BAT_DURABILITY    = 1;

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
  } else if (type === 'shield') {
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x2244cc, roughness: 0.5, metalness: 0.3 }));
    face.position.y = 0.28;
    g.add(face);
    const emblem = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8 }));
    emblem.position.y = 0.28;
    g.add(emblem);
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
  } else { // glove
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xcc2200, roughness: 0.55, metalness: 0.08 }));
    body.scale.set(1.35, 1.05, 1.2);
    body.position.y = 0.24;
    g.add(body);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.11, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }));
    cuff.position.y = 0.42;
    g.add(cuff);
    const glow = new THREE.PointLight(0xff4400, 0.6, 2.5);
    glow.position.y = 0.3;
    g.add(glow);
  }
  g.position.set(x, 0.1, z);
  scene.add(g);
  return { group: g, type, x, z };
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
  if (hasShield) parts.push(`🛡 ${pipBar(shieldDurability, SHIELD_DURABILITY)}`);
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
  } else {
    hasShield = true; shieldDurability = SHIELD_DURABILITY;
    playerShield.visible = true;
  }
  updateDurabilityHUD();
}

function breakSword() {
  hasSword = false; swordDurability = 0;
  playerSword.visible = false;
  updateDurabilityHUD();
}

function breakGlove() {
  hasGlove = false; gloveDurability = 0;
  playerGlove.visible = false;
  updateDurabilityHUD();
}

function breakBat() {
  hasBat = false; batDurability = 0;
  playerBat.visible = false;
  updateDurabilityHUD();
}

function breakShield() {
  hasShield = false; shieldDurability = 0;
  playerShield.visible = false;
  updateDurabilityHUD();
}

function dropItem() {
  const px = playerGroup.position.x, pz = playerGroup.position.z;
  const dropAngle = playerGroup.rotation.y + Math.PI;
  if (hasSword) {
    groundItems.push(makeGroundItem('sword', px + Math.sin(dropAngle) * 1.2, pz + Math.cos(dropAngle) * 1.2));
    hasSword = false; swordDurability = 0; playerSword.visible = false;
  }
  if (hasGlove) {
    groundItems.push(makeGroundItem('glove', px + Math.sin(dropAngle) * 1.2, pz + Math.cos(dropAngle) * 1.2));
    hasGlove = false; gloveDurability = 0; playerGlove.visible = false;
  }
  if (hasBat) {
    groundItems.push(makeGroundItem('bat', px + Math.sin(dropAngle) * 1.2, pz + Math.cos(dropAngle) * 1.2));
    hasBat = false; batDurability = 0; playerBat.visible = false;
  }
  if (hasShield) {
    groundItems.push(makeGroundItem('shield', px + Math.sin(dropAngle) * 0.6, pz + Math.cos(dropAngle) * 0.6));
    hasShield = false; shieldDurability = 0; playerShield.visible = false;
  }
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
    shield:   hasShield,
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
  peers.set(id, { ...char, tx: data.x ?? 0, ty: data.y ?? 0, tz: data.z ?? 0, rotY: data.rotY ?? 0, moving: false, swing: 0, punchTimer: 0, blocking: false, username: data.username, redrawLabel, pSword: !!data.sword, pGlove: !!data.glove, pBat: !!data.bat, pShield: !!data.shield, pColor: data.color || 'ffffff', lives: data.lives ?? 3, isGhost: !!data.isGhost, hasArmor: !!data.hasArmor, ready: !!data.ready });
  updateMenuReadyList();
}

function applyPeerEquip(peer, sword, glove, bat, shield) {
  peer.pSword  = sword;
  peer.pGlove  = glove;
  peer.pBat    = bat;
  peer.pShield = shield;
  if (peer.swordGroup)  peer.swordGroup.visible = !!sword;
  if (peer.gloveGroup)  peer.gloveGroup.visible = !!glove;
  if (peer.batGroup)    peer.batGroup.visible   = !!bat;
  if (peer.shieldEquip) peer.shieldEquip.visible = !!shield;
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
        if (shieldDurability <= 0) breakShield(); else updateDurabilityHUD();
        return;
      }
      lastHitBy = fromPeerId;
      lastHitByWasGhost = !!ghostPunch;
      const kb = force ?? KNOCKBACK_H;
      velX = kx * kb;
      velZ = kz * kb;
      if (homeRun) {
        // 45° launch: vertical speed matches horizontal magnitude
        velY = kb;
      } else {
        velY = Math.max(velY, ghostPunch ? GHOST_KNOCKBACK_UP : KNOCKBACK_UP);
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
        if (!!data.sword !== peer.pSword || !!data.glove !== peer.pGlove || !!data.bat !== peer.pBat || !!data.shield !== peer.pShield)
          applyPeerEquip(peer, !!data.sword, !!data.glove, !!data.bat, !!data.shield);
        if (data.punching && peer.punchTimer <= 0) peer.punchTimer = 0.35;
        peer.blocking = !!data.blocking;
        if (!!data.isGhost !== peer.isGhost) applyPeerGhostMode(peer, !!data.isGhost);
        peer.lives    = data.lives ?? peer.lives;
        peer.hasArmor = !!data.hasArmor;
        if (peer.armorGroup) peer.armorGroup.visible = !!data.hasArmor && !data.isGhost;
        if (data.ready !== undefined) { peer.ready = !!data.ready; updateMenuReadyList(); }
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

renderer.domElement.addEventListener('click', () => {
  if (gameState === 'playing') renderer.domElement.requestPointerLock();
});

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
  if (e.button === 0) doPunch();
  if (e.button === 2) isBlocking = true;
});
document.addEventListener('mouseup', e => {
  if (e.button === 2) isBlocking = false;
});

document.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ') e.preventDefault();

  // E — pick up nearby item
  if (e.key === 'e' || e.key === 'E') {
    const px = playerGroup.position.x, pz = playerGroup.position.z;
    for (let i = groundItems.length - 1; i >= 0; i--) {
      const it = groundItems[i];
      if (Math.hypot(px - it.x, pz - it.z) < ITEM_PICKUP_R) {
        // Drop same-slot item first if already held
        const dropAngle = playerGroup.rotation.y + Math.PI;
        // Sword, glove, and bat all share the right-hand weapon slot — swap out whatever is held
        const isWeapon = it.type === 'sword' || it.type === 'glove' || it.type === 'bat';
        if (isWeapon && hasSword) {
          groundItems.push(makeGroundItem('sword', px + Math.sin(dropAngle) * 1.2, pz + Math.cos(dropAngle) * 1.2));
          hasSword = false; swordDurability = 0; playerSword.visible = false;
        }
        if (isWeapon && hasGlove) {
          groundItems.push(makeGroundItem('glove', px + Math.sin(dropAngle) * 1.2, pz + Math.cos(dropAngle) * 1.2));
          hasGlove = false; gloveDurability = 0; playerGlove.visible = false;
        }
        if (isWeapon && hasBat) {
          groundItems.push(makeGroundItem('bat', px + Math.sin(dropAngle) * 1.2, pz + Math.cos(dropAngle) * 1.2));
          hasBat = false; batDurability = 0; playerBat.visible = false;
        }
        if (it.type === 'shield' && hasShield) {
          groundItems.push(makeGroundItem('shield', px + Math.sin(dropAngle) * 0.6, pz + Math.cos(dropAngle) * 0.6));
          hasShield = false; shieldDurability = 0; playerShield.visible = false;
        }
        scene.remove(it.group);
        groundItems.splice(i, 1);
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
let hasFallenOff = false; // true once player drops below platform surface — no landing allowed
let isDead      = false;
let deathTimer  = 0;
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

const deathEl = document.getElementById('death-msg');

function onPlatform(x, z) {
  return Math.abs(x) < PLATFORM_HALF && Math.abs(z) < PLATFORM_HALF;
}

// Returns the highest surface Y under (x, z), or null if nothing below.
function getSurfaceBelow(x, z) {
  let best = null;
  // Main platform (only if tile hasn't fallen)
  if (onPlatform(x, z) && !isTileGone(x, z)) best = 0;
  // Elevated platforms (AABB)
  for (const ep of elevatedPlatforms) {
    if (x >= ep.x - ep.hw && x <= ep.x + ep.hw && z >= ep.z - ep.hd && z <= ep.z + ep.hd) {
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

function enterGhostMode() {
  isGhost = true;
  isDead  = false;
  hasFallenOff = false; // ghosts fly freely
  // Drop items
  hasSword = false; swordDurability = 0; playerSword.visible = false;
  hasGlove = false; gloveDurability = 0; playerGlove.visible = false;
  hasBat   = false; batDurability   = 0; playerBat.visible   = false;
  hasShield = false; shieldDurability = 0; playerShield.visible = false;
  updateDurabilityHUD();
  // Remove armor
  hasArmor = false;
  localStorage.removeItem('arenaHasArmor');
  playerArmorGroup.visible = false;
  // Swap to ghost appearance
  playerNormalBody.visible = false;
  playerGhostBody.visible  = true;
  ghostPunchCooldown = 0;
  velY = 0; velX = 0; velZ = 0;
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
  velY = 0; velX = 0; velZ = 0;
  onGround = false;
  isDead = false;
  if (deathEl) deathEl.style.display = 'none';
  updateLivesHUD();
}

function die() {
  if (isDead || isGhost) return;
  isDead = true;
  deathTimer = 2.0;
  velY = 0;
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
  if (deathEl) deathEl.style.display = 'flex';
}

function respawn() {
  isDead = false;
  hasFallenOff = false;
  if (gameState === 'playing' && localLives <= 0) {
    enterGhostMode();
    playerGroup.position.set(SPAWN_X, SPAWN_Y + 3, SPAWN_Z);
    return;
  }
  if (gameState === 'playing') {
    playerGroup.position.set(SPAWN_X, SPAWN_Y, SPAWN_Z);
  } else {
    playerGroup.position.set(0, 1, 0);
  }
  velY = 0; velX = 0; velZ = 0;
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
  for (const t of tileObjects) { t.state = 'solid'; t.timer = 0; t.mesh.visible = false; t.mesh.position.y = -2; t.mesh.material.color.set(0x3d2060); }
  tileDropIndex = 0;
  gameTime = 0;
  platform.visible = true;
  // Clear all ground items
  for (const it of groundItems) scene.remove(it.group);
  groundItems.length = 0;
  itemTimer = Date.now() + 5000;
  // Move player to lobby
  playerGroup.position.set(0, 1, 0);
  velY = 0; velX = 0; velZ = 0;
  onGround = false;
  if (deathEl) deathEl.style.display = 'none';
  if (gameOverEl) gameOverEl.classList.remove('active');
  // Show menu and refresh name field
  if (menuEl) menuEl.classList.add('active');
  const _nameInput = document.getElementById('menu-name-input');
  if (_nameInput) _nameInput.value = incoming.username;
  document.exitPointerLock();
  updateLivesHUD();
  updateMenuReadyList();
}

function startGame(seed, broadcast) {
  gameState  = 'playing';
  localLives = 3 + (hasArmor ? 1 : 0);
  isGhost    = false;
  isDead     = false;
  ghostPunchCooldown = 0;
  lastHitBy  = null;
  // Clear any leftover items and reset spawn timer
  for (const it of groundItems) scene.remove(it.group);
  groundItems.length = 0;
  itemTimer = Date.now() + 5000;
  // Tile setup
  gameTime       = 0;
  tileOrder      = shuffleTiles(seed);
  tileDropIndex  = 0;
  nextTileTime   = TILE_GRACE_S;
  // Show tiles
  for (const t of tileObjects) { t.state = 'solid'; t.timer = 0; t.mesh.visible = true; t.mesh.position.y = -2; t.mesh.material.color.set(0x3d2060); }
  // Hide main platform mesh so tiles take over visually
  platform.visible = false;
  // Spawn player on center pillar
  playerGroup.position.set(SPAWN_X, SPAWN_Y, SPAWN_Z);
  velY = 0; velX = 0; velZ = 0;
  onGround = false;
  playerArmorGroup.visible = hasArmor;
  if (menuEl) menuEl.classList.remove('active');
  if (deathEl) deathEl.style.display = 'none';
  if (broadcast) {
    sendGameEvent?.({ type: 'start', seed });
  }
  updateLivesHUD();
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
  }
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
        // Flash the tile
        const flash = Math.sin(t.timer * 14) > 0;
        t.mesh.material.color.set(flash ? 0xff4400 : 0x3d2060);
        if (t.timer <= 0) { t.state = 'sinking'; t.timer = TILE_SINK_S; t.mesh.material.color.set(0x220800); }
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
    isMoving = _dir.lengthSq() > 0 && !isDead;
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
  }

  // --- Collision resolution (skip for ghosts) ---
  if (!isGhost) {
  const PLAYER_R = 0.32;

  // vs pillars — climb if top is within reach, otherwise push out
  for (const p of pillarData) {
    const ov = circleOverlap(playerGroup.position.x, playerGroup.position.z, p.x, p.z, p.r + PLAYER_R);
    if (ov) {
      const heightDiff = p.topY - playerGroup.position.y;
      if (heightDiff > 0 && heightDiff <= MAX_CLIMBABLE) {
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

  // vs elevated platforms — climb if top within reach, otherwise push out
  for (const ep of elevatedPlatforms) {
    const px = playerGroup.position.x, pz = playerGroup.position.z, py = playerGroup.position.y;
    if (py >= ep.topY) continue; // above the platform — no side collision
    // Closest point on AABB to player XZ
    const cx = Math.max(ep.x - ep.hw, Math.min(ep.x + ep.hw, px));
    const cz = Math.max(ep.z - ep.hd, Math.min(ep.z + ep.hd, pz));
    const dx = px - cx, dz = pz - cz;
    const dist2 = dx * dx + dz * dz;
    if (dist2 >= PLAYER_R * PLAYER_R) continue;
    const dist = Math.sqrt(dist2);
    const heightDiff = ep.topY - py;
    if (heightDiff > 0 && heightDiff <= MAX_CLIMBABLE) {
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
        // Player center inside box — push on shortest axis
        const overX = ep.hw + PLAYER_R - Math.abs(px - ep.x);
        const overZ = ep.hd + PLAYER_R - Math.abs(pz - ep.z);
        if (overX < overZ) playerGroup.position.x += Math.sign(px - ep.x) * overX;
        else               playerGroup.position.z += Math.sign(pz - ep.z) * overZ;
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

  // Jump
  if (keys[' '] && onGround && !isDead) {
    velY = JUMP_FORCE;
    onGround = false;
  }

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
      if (-velY > FALL_DAMAGE_VEL) {
        die();
      } else {
        playerGroup.position.y = surf;
        velY = 0;
        onGround = true;
      }
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

  // --- Item spawning ---
  if (gameState === 'playing' && Date.now() >= itemTimer && groundItems.length < MAX_ITEMS) {
    itemTimer = Date.now() + ITEM_INTERVAL;
    const pos = randomItemPos();
    if (pos) {
      const r = Math.random();
    const type = r < 0.25 ? 'sword' : r < 0.50 ? 'shield' : r < 0.75 ? 'glove' : 'bat';
      groundItems.push(makeGroundItem(type, pos.x, pos.z));
    }
  }

  // --- Ground item bobbing + tile removal ---
  for (let i = groundItems.length - 1; i >= 0; i--) {
    const it = groundItems[i];
    if (isTileUnstable(it.x, it.z)) {
      scene.remove(it.group);
      groundItems.splice(i, 1);
      continue;
    }
    it.group.position.y = 0.1 + Math.sin(time * 2.5 + it.x) * 0.08;
    it.group.rotation.y += dt * 1.2;
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
