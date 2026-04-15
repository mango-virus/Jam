// 3D walking space — Portal Protocol preserved.
// Replace everything between the dashed lines with your own game logic.
// Keep the Portal.* calls at the top and in the portal-collision section.

import * as THREE from 'https://esm.sh/three@0.175.0';

// ------------------------------------------------------------------
// Portal protocol setup
// ------------------------------------------------------------------

// Portal is a global set by portal.js (loaded as a plain <script> tag)
const incoming = Portal.readPortalParams();
document.getElementById('username').textContent = incoming.username;

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

// Lighting
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

// Ground
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
// Deterministic pseudo-random so the layout is stable on reload
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
// Player character
// ------------------------------------------------------------------

const playerGroup = new THREE.Group();
const playerColor = new THREE.Color('#' + incoming.color);

// Torso
const torso = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.8, 0.3),
  new THREE.MeshStandardMaterial({ color: playerColor, emissive: playerColor.clone().multiplyScalar(0.25), roughness: 0.4 })
);
torso.position.y = 0.6;
torso.castShadow = true;
playerGroup.add(torso);

// Head
const headMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.35, 0.35, 0.35),
  new THREE.MeshStandardMaterial({ color: 0xffcca0, roughness: 0.7 })
);
headMesh.position.y = 1.22;
headMesh.castShadow = true;
playerGroup.add(headMesh);

// Arms
const armMat = new THREE.MeshStandardMaterial({ color: playerColor, emissive: playerColor.clone().multiplyScalar(0.25), roughness: 0.4 });
const armGeo = new THREE.BoxGeometry(0.15, 0.55, 0.15);
const leftArm = new THREE.Mesh(armGeo, armMat);
leftArm.position.set(-0.34, 0.62, 0);
leftArm.rotation.z = 0.2;
leftArm.castShadow = true;
playerGroup.add(leftArm);
const rightArm = new THREE.Mesh(armGeo, armMat);
rightArm.position.set(0.34, 0.62, 0);
rightArm.rotation.z = -0.2;
rightArm.castShadow = true;
playerGroup.add(rightArm);

// Legs
const legMat = new THREE.MeshStandardMaterial({ color: 0x1a0030, roughness: 0.6 });
const legGeo = new THREE.BoxGeometry(0.17, 0.5, 0.17);
const leftLeg = new THREE.Mesh(legGeo, legMat);
leftLeg.position.set(-0.13, 0.15, 0);
leftLeg.castShadow = true;
playerGroup.add(leftLeg);
const rightLeg = new THREE.Mesh(legGeo, legMat);
rightLeg.position.set(0.13, 0.15, 0);
rightLeg.castShadow = true;
playerGroup.add(rightLeg);

// Eyeballs (on the front face of the head, z = +0.175 + a little)
const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const eyePupilMat = new THREE.MeshStandardMaterial({ color: 0x110022, roughness: 0.2 });
const eyeWhiteGeo = new THREE.SphereGeometry(0.06, 8, 8);
const pupilGeo    = new THREE.SphereGeometry(0.035, 8, 8);
const leftEyeWhite = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
leftEyeWhite.position.set(-0.09, 1.25, 0.175);
playerGroup.add(leftEyeWhite);
const leftPupil = new THREE.Mesh(pupilGeo, eyePupilMat);
leftPupil.position.set(-0.09, 1.25, 0.21);
playerGroup.add(leftPupil);
const rightEyeWhite = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat);
rightEyeWhite.position.set(0.09, 1.25, 0.175);
playerGroup.add(rightEyeWhite);
const rightPupil = new THREE.Mesh(pupilGeo, eyePupilMat);
rightPupil.position.set(0.09, 1.25, 0.21);
playerGroup.add(rightPupil);

// Hat — wide brim + tall crown (top hat)
const hatMat = new THREE.MeshStandardMaterial({ color: 0x1a0030, roughness: 0.5, metalness: 0.1 });
const hatBand = new THREE.MeshStandardMaterial({ color: 0xc64bff, emissive: 0x4a0088, roughness: 0.3 });
const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 16), hatMat);
hatBrim.position.y = 1.44;
hatBrim.castShadow = true;
playerGroup.add(hatBrim);
const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.20, 0.42, 16), hatMat);
hatCrown.position.y = 1.69;
hatCrown.castShadow = true;
playerGroup.add(hatCrown);
const hatRibbon = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.07, 16), hatBand);
hatRibbon.position.y = 1.49;
playerGroup.add(hatRibbon);

// Per-player glow
const playerGlow = new THREE.PointLight(playerColor, 1.5, 3);
playerGlow.position.y = 0.8;
playerGroup.add(playerGlow);

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

// Canvas-texture sprite labels above portals
function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 80;
  const cx = c.getContext('2d');
  cx.clearRect(0, 0, 512, 80);
  cx.fillStyle = color;
  cx.font = 'bold 28px ui-sans-serif, system-ui, sans-serif';
  cx.textAlign = 'center';
  cx.fillText(text, 256, 54);
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
// Input & pointer lock
// ------------------------------------------------------------------

const keys = {};
let yaw = 0;         // camera orbit angle around player (horizontal)
let pitch = 0.2;     // camera tilt angle (vertical)
let isLocked = false;
let redirecting = false;

renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());

document.addEventListener('pointerlockchange', () => {
  isLocked = document.pointerLockElement === renderer.domElement;
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = isLocked
    ? 'WASD to move  ·  mouse to look  ·  walk into a portal to travel'
    : 'Click to capture mouse';
});

document.addEventListener('mousemove', e => {
  if (!isLocked) return;
  yaw   -= e.movementX * 0.0025;
  pitch += e.movementY * 0.0025;
  pitch  = Math.max(-0.6, Math.min(0.8, pitch)); // clamp: don't flip upside-down
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

const SPEED  = incoming.speed || 5;
const BOUNDS = 38;
const CAM_DIST   = 5;
const CAM_HEIGHT = 2.5;

const _dir    = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _euler  = new THREE.Euler(0, 0, 0, 'YXZ');

let prev = performance.now();
let time = 0;

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

  if (_dir.lengthSq() > 0) {
    _dir.normalize().applyEuler(_euler);
    playerGroup.position.x += _dir.x * SPEED * dt;
    playerGroup.position.z += _dir.z * SPEED * dt;
    // Face movement direction
    playerGroup.rotation.y = Math.atan2(_dir.x, _dir.z);
  }

  // Limb swing animation
  const moving = _dir.lengthSq() > 0;
  const swing  = moving ? Math.sin(time * 8) * 0.5 : 0;
  leftLeg.rotation.x   =  swing;
  rightLeg.rotation.x  = -swing;
  leftArm.rotation.x   = -swing * 0.6;
  rightArm.rotation.x  =  swing * 0.6;

  playerGroup.position.x = Math.max(-BOUNDS, Math.min(BOUNDS, playerGroup.position.x));
  playerGroup.position.z = Math.max(-BOUNDS, Math.min(BOUNDS, playerGroup.position.z));

  // --- Third-person camera (yaw + pitch) ---
  const camBack = Math.cos(pitch) * CAM_DIST;
  const camUp   = Math.sin(pitch) * CAM_DIST;
  _offset.set(0, 0, camBack).applyEuler(_euler);
  camera.position.set(
    playerGroup.position.x + _offset.x,
    playerGroup.position.y + CAM_HEIGHT + camUp,
    playerGroup.position.z + _offset.z
  );
  // lookAt target shifts opposite to pitch so the player stays centred on screen
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
          color: incoming.color,
          speed: SPEED,
        });
      }
    }
    if (returnPortal && incoming.ref) {
      if (Math.hypot(px - returnPortal.group.position.x, pz - returnPortal.group.position.z) < 2) {
        redirecting = true;
        Portal.sendPlayerThroughPortal(incoming.ref, {
          username: incoming.username,
          color: incoming.color,
          speed: SPEED,
        });
      }
    }
  }

  renderer.render(scene, camera);
}

loop(performance.now());
