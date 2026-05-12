import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { Icon } from "./components/Icon.jsx";
import { CONFIG } from "./game/config.js";
import { branchHitsPlayer, obstacleBox, playerBox as makePlayerBox } from "./game/collision.js";
import { createKeys, isAllowedKey, setKeyState } from "./game/input.js";
import { LEVEL } from "./game/level.js";
import { aabb, clamp, lerp } from "./game/math.js";
import { NOTES, noteToFrequency } from "./game/audio.js";
import { createTitleThemePlayer } from "./game/audio/titleTheme.js";
import { makeMaterial } from "./game/rendering/materials.js";
import { makeGroundTexture, makePathTexture } from "./game/rendering/textures.js";
import { runSelfTests } from "./game/selfTests.js";
import { trackAngle, trackCenter, worldPosition, worldX } from "./game/track.js";

const nl = String.fromCharCode(10);

function formatElapsed(elapsedMs) {
  const elapsed = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function createTrackRibbonGeometry(innerLocalX, outerLocalX, startZ = 14, endZ = -824, step = 3.2) {
  const vertices = [];
  const uvs = [];
  const indices = [];
  const rows = Math.floor((startZ - endZ) / step) + 1;

  for (let i = 0; i <= rows; i++) {
    const z = Math.max(endZ, startZ - i * step);
    const angle = trackAngle(z);
    const normalX = Math.cos(angle);
    const centerX = trackCenter(z);
    vertices.push(centerX + innerLocalX * normalX, 0, z, centerX + outerLocalX * normalX, 0, z);
    uvs.push(0, i * 0.18, 1, i * 0.18);
    if (i < rows) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeLowPolyTree(trunkMat, leafMats, rng = Math.random, scale = 1) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.38 * scale, 3.3 * scale + rng() * 0.9, 7), trunkMat);
  trunk.position.y = 1.55 * scale;
  trunk.castShadow = true;

  const lowerLeaves = new THREE.Mesh(
    new THREE.ConeGeometry((1.25 + rng() * 0.65) * scale, (2.4 + rng() * 0.5) * scale, 7),
    leafMats[Math.floor(rng() * leafMats.length)],
  );
  lowerLeaves.position.y = 3.55 * scale;
  lowerLeaves.castShadow = true;

  const upperLeaves = new THREE.Mesh(
    new THREE.ConeGeometry((0.85 + rng() * 0.35) * scale, 1.85 * scale, 7),
    leafMats[Math.floor(rng() * leafMats.length)],
  );
  upperLeaves.position.y = 4.85 * scale;
  upperLeaves.castShadow = true;

  tree.add(trunk, lowerLeaves, upperLeaves);
  tree.rotation.y = rng() * Math.PI;
  return tree;
}

function makeLowPolyBush(leafMats, rng = Math.random, scale = 1) {
  const bush = new THREE.Group();
  const clumpCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < clumpCount; i++) {
    const clump = new THREE.Mesh(
      new THREE.DodecahedronGeometry((0.55 + rng() * 0.45) * scale, 0),
      leafMats[Math.floor(rng() * leafMats.length)],
    );
    clump.position.set((rng() - 0.5) * 1.2 * scale, 0.45 * scale + rng() * 0.28 * scale, (rng() - 0.5) * 1.2 * scale);
    clump.scale.y = 0.72 + rng() * 0.38;
    clump.castShadow = true;
    bush.add(clump);
  }
  return bush;
}

export default function App() {
  const mountRef = useRef(null);
  const keyRef = useRef(createKeys());
  const startedRef = useRef(false);
  const completeRef = useRef(false);
  const gameOverRef = useRef(false);
  const debugRef = useRef(false);
  const audioRef = useRef(null);
  const titleThemeRef = useRef(null);
  const musicRef = useRef({ enabled: false, nextNoteTime: 0, noteIndex: 0, beatSeconds: 0.2 });
  const stampedeRef = useRef({ nextStepTime: 0 });
  const gameStartTimeRef = useRef(null);
  const finalStatsRef = useRef({ fruit: 0, crates: 0, score: 0, elapsedMs: 0 });

  const [started, setStarted] = useState(false);
  const [complete, setComplete] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [debug, setDebug] = useState(false);
  const [testSummary, setTestSummary] = useState("Self-tests pending");
  const [finalStats, setFinalStats] = useState({ fruit: 0, crates: 0, score: 0, elapsedMs: 0 });

  const ui = {
    health: useRef(null),
    lives: useRef(null),
    charge: useRef(null),
    chargeText: useRef(null),
    stateBadge: useRef(null),
    speedo: useRef(null),
    timerDisplay: useRef(null),
    sectionBadge: useRef(null),
    prompt: useRef(null),
    distance: useRef(null),
    fruit: useRef(null),
    fruitLife: useRef(null),
    fruitTally: useRef(null),
    cratesTally: useRef(null),
    multiplierBadge: useRef(null),
    momentumLabel: useRef(null),
    scoreTally: useRef(null),
    debug: useRef(null),
  };

  function startAudio() {
    if (audioRef.current) return audioRef.current;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    const ctx = new AudioContext();
    audioRef.current = ctx;
    if (ctx.state === "suspended") ctx.resume();
    musicRef.current.enabled = true;
    musicRef.current.nextNoteTime = ctx.currentTime + 0.08;
    return ctx;
  }


  function startTitleTheme() {
    const ctx = startAudio();
    if (!ctx || startedRef.current || completeRef.current || gameOverRef.current) return;
    if (!titleThemeRef.current) titleThemeRef.current = createTitleThemePlayer(ctx);
    titleThemeRef.current.start();
  }

  function stopTitleTheme(fadeSeconds = 0.22) {
    titleThemeRef.current?.stop(fadeSeconds);
  }

  function playTone(type, atTime = null) {
    const ctx = audioRef.current;
    if (!ctx) return;
    const now = atTime ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const settings = {
      jump:   [180, 340, 0.08, "sine",     0.08],
      double: [360, 720, 0.09, "triangle", 0.09],
      land:   [105,  70, 0.11, "sine",     0.10],
      smash:  [ 90,  40, 0.16, "sawtooth", 0.14],
      fruit:  [660, 990, 0.08, "triangle", 0.07],
      heal:   [420, 760, 0.20, "sine",     0.08],
      hurt:   [160,  80, 0.18, "square",   0.10],
      gate:   [330, 880, 0.45, "triangle", 0.09],
      life:   [420, 980, 0.35, "triangle", 0.10],
      croc:   [ 70,  45, 0.18, "sawtooth", 0.11],
      thump:  [ 62,  30, 0.16, "sine",     0.08],
    }[type] || [250, 250, 0.1, "sine", 0.05];
    osc.type = settings[3];
    osc.frequency.setValueAtTime(settings[0], now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, settings[1]), now + settings[2]);
    gain.gain.setValueAtTime(settings[4], now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + settings[2]);
    osc.start(now);
    osc.stop(now + settings[2] + 0.03);
  }

  useEffect(() => {
    function beginTitleThemeFromGesture() {
      startTitleTheme();
    }

    window.addEventListener("pointerdown", beginTitleThemeFromGesture);
    window.addEventListener("keydown", beginTitleThemeFromGesture);
    return () => {
      window.removeEventListener("pointerdown", beginTitleThemeFromGesture);
      window.removeEventListener("keydown", beginTitleThemeFromGesture);
      titleThemeRef.current?.dispose();
      titleThemeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const results = runSelfTests();
    const passCount = results.filter((r) => r.pass).length;
    setTestSummary(`${passCount}/${results.length} self-tests passed`);
    if (passCount !== results.length) console.warn("Pink Elephant self-tests failed", results);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    let disposed = false;
    let frame = 0;
    let last = performance.now();
    let lastFpsTime = performance.now();
    let frames = 0;
    let fps = 60;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#102412");
    scene.fog = new THREE.Fog("#1f3a1b", 24, 132);

    const camera = new THREE.PerspectiveCamera(CONFIG.cameraFov, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 360);
    camera.position.set(0, 8, 16);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight("#d9f5cf", 0.58));
    const sun = new THREE.DirectionalLight("#ffd38a", 1.85);
    sun.position.set(-8, 24, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -34;
    sun.shadow.camera.right = 34;
    sun.shadow.camera.top = 34;
    sun.shadow.camera.bottom = -34;
    scene.add(sun);

    const jungleTexture = makeGroundTexture();
    const pathTexture = makePathTexture();
    const jungle = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.floorWidth, 1.2, CONFIG.floorLength), new THREE.MeshStandardMaterial({ map: jungleTexture, roughness: 0.98 }));
    jungle.position.set(0, -0.62, -CONFIG.floorLength / 2 + 20);
    jungle.receiveShadow = true;
    scene.add(jungle);

    const pathGroup = new THREE.Group();
    scene.add(pathGroup);
    const pathMat = new THREE.MeshStandardMaterial({ map: pathTexture, roughness: 0.95 });
    const shoulderMat = makeMaterial("#6f4a27", { roughness: 1 });
    const bankMat = makeMaterial("#174026", { roughness: 1 });
    const lipMat = makeMaterial("#d5a25b", { roughness: 0.92 });
    const safeHalfWidth = CONFIG.corridorHalfWidth + 0.62;
    const pathSurface = new THREE.Mesh(createTrackRibbonGeometry(-safeHalfWidth, safeHalfWidth, 14, -824, 3.2), pathMat);
    pathSurface.position.y = 0.055;
    pathSurface.receiveShadow = true;
    pathGroup.add(pathSurface);

    [
      [-safeHalfWidth - 0.86, -safeHalfWidth, shoulderMat, 0.045],
      [safeHalfWidth, safeHalfWidth + 0.86, shoulderMat, 0.045],
      [-safeHalfWidth - 1.22, -safeHalfWidth - 0.86, bankMat, 0.16],
      [safeHalfWidth + 0.86, safeHalfWidth + 1.22, bankMat, 0.16],
      [-safeHalfWidth - 0.12, -safeHalfWidth + 0.08, lipMat, 0.105],
      [safeHalfWidth - 0.08, safeHalfWidth + 0.12, lipMat, 0.105],
    ].forEach(([inner, outer, material, y]) => {
      const ribbon = new THREE.Mesh(createTrackRibbonGeometry(inner, outer, 14, -824, 3.2), material);
      ribbon.position.y = y;
      ribbon.receiveShadow = true;
      pathGroup.add(ribbon);
    });

    const colliders = [], pickups = [], crocs = [], particles = [], pops = [];
    const enemies = [], collectibleMeshes = [];
    const particlePool = [];
    const popPools = new Map();
    const pooledParticleGeometry = new THREE.SphereGeometry(1, 8, 8);
    const pickupPopPresets = [
      ["SUGAR CANE!", "#a7ffbf", 3],
      ["BONUS ELEPHANT!", "#b7ffb7", 2],
      ["TRUNK-SMASH!", "#ffe08a", 2],
      ["BIG Bounce!", "#ffc3ed", 2],
      ["SPIN ATTACK!", "#ffcf66", 2],
      ["JUNGLE GATE!", "#fff1a6", 2],
      ["SNAP!", "#9aff99", 2],
      ["OOPS!", "#ff8794", 2],
      ["HERD LIFE LOST", "#ff9aa9", 1],
      ["HERD NEEDS REST", "#ff9aa9", 1],
    ];

    for (let i = 0; i < 96; i++) {
      const mesh = new THREE.Mesh(
        pooledParticleGeometry,
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }),
      );
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      particlePool.push({ mesh, active: false, life: 0, startLife: 1, vx: 0, vy: 0, vz: 0 });
    }

    const riverMat = new THREE.MeshStandardMaterial({ color: "#237cb4", roughness: 0.35, metalness: 0.08, transparent: true, opacity: 0.82, emissive: "#0a3352", emissiveIntensity: 0.25 });
    LEVEL.rivers.forEach((river) => {
      const cx = trackCenter(river.z);
      const water = new THREE.Mesh(new THREE.BoxGeometry(river.width, 0.12, river.depth), riverMat);
      water.position.set(cx, 0.08, river.z);
      water.rotation.y = trackAngle(river.z);
      water.receiveShadow = true;
      scene.add(water);
      river.crocs.forEach((croc) => {
        const group = new THREE.Group();
        const crocMat = makeMaterial("#315b2c");
        const mouthMat = makeMaterial("#f8f1cc");
        const crocBody = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 1.15), crocMat);
        const snout = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.28, 0.85), crocMat);
        const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.12), mouthMat);
        snout.position.set(0, 0.02, -0.78);
        teeth.position.set(0, 0.25, -1.28);
        group.add(crocBody, snout, teeth);
        const startZ = river.z + Math.sin(croc.phase) * 5;
        const startPos = worldPosition(croc.localX, startZ);
        group.position.set(startPos.x, 0.48, startPos.z);
        scene.add(group);
        crocs.push({ type: "croc", mesh: group, riverZ: river.z, baseLocalX: croc.localX, phase: croc.phase, x: group.position.x, y: 0.48, z: group.position.z, w: 2.4, h: 0.7, d: 1.35, active: true });
      });
    });

    const treeGroup = new THREE.Group();
    scene.add(treeGroup);
    const trunkMat = makeMaterial("#5d371d");
    const leafMats = [makeMaterial("#1e8d47"), makeMaterial("#2fa55a"), makeMaterial("#176b3c"), makeMaterial("#0f5b33")];
    for (let z = 16; z > -824; z -= 8) {
      [-1, 1].forEach((side) => {
        const jitterZ = z + Math.random() * 5 - 2.5;
        const nearTree = makeLowPolyTree(trunkMat, leafMats, Math.random, 0.95 + Math.random() * 0.35);
        nearTree.position.set(worldX(side * (7.1 + Math.random() * 3.1), jitterZ), 0, jitterZ);
        treeGroup.add(nearTree);

        const backTree = makeLowPolyTree(trunkMat, leafMats, Math.random, 0.82 + Math.random() * 0.5);
        backTree.position.set(worldX(side * (12.2 + Math.random() * 6.4), jitterZ - 2 + Math.random() * 4), 0, jitterZ - 2 + Math.random() * 4);
        treeGroup.add(backTree);

        const bush = makeLowPolyBush(leafMats, Math.random, 0.9 + Math.random() * 0.55);
        bush.position.set(worldX(side * (6.45 + Math.random() * 2.0), jitterZ + 1.4), 0.02, jitterZ + 1.4);
        treeGroup.add(bush);

        if (Math.abs(z % 24) < 0.1) {
          const foregroundTree = makeLowPolyTree(trunkMat, leafMats, Math.random, 1.55 + Math.random() * 0.35);
          foregroundTree.position.set(worldX(side * (8.8 + Math.random() * 2.5), jitterZ), 0, jitterZ);
          treeGroup.add(foregroundTree);
        }

        if (Math.abs(z % 32) < 0.1) {
          const canopy = new THREE.Mesh(
            new THREE.DodecahedronGeometry(2.0 + Math.random() * 1.2, 0),
            leafMats[Math.floor(Math.random() * leafMats.length)],
          );
          canopy.position.set(worldX(side * (5.9 + Math.random() * 2.8), jitterZ), 7.0 + Math.random() * 1.8, jitterZ);
          canopy.scale.set(1.25, 0.62, 0.9);
          canopy.rotation.y = Math.random() * Math.PI;
          canopy.castShadow = true;
          treeGroup.add(canopy);
        }
      });
    }

    const fruitMat = new THREE.MeshStandardMaterial({ color: "#ffd34a", roughness: 0.34, metalness: 0.15, emissive: "#3d2500", emissiveIntensity: 0.25 });
    LEVEL.fruits.forEach((pos) => {
      const posOnPath = worldPosition(pos.localX, pos.z);
      const fruit = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), fruitMat);
      fruit.position.set(posOnPath.x, pos.y || 1.05, posOnPath.z);
      fruit.castShadow = true;
      scene.add(fruit);
      pickups.push({ type: "fruit", mesh: fruit, active: true, x: posOnPath.x, y: pos.y || 1.05, z: posOnPath.z, radius: 0.78 });
    });

    const caneGeometry = new THREE.CylinderGeometry(0.22, 0.22, 1.4, 8);
    const caneMat = new THREE.MeshStandardMaterial({ color: "#52e879", roughness: 0.45, emissive: "#154d24", emissiveIntensity: 0.7 });
    LEVEL.health.forEach((pos) => {
      const posOnPath = worldPosition(pos.localX, pos.z);
      const group = new THREE.Group();
      group.position.set(posOnPath.x, 1.25, posOnPath.z);
      const cane = new THREE.Mesh(caneGeometry, caneMat);
      cane.rotation.z = 0.35;
      const glow = new THREE.PointLight("#54ff83", 1.6, 7);
      group.add(cane, glow);
      scene.add(group);
      pickups.push({ type: "health", mesh: group, active: true, x: posOnPath.x, y: 1.25, z: posOnPath.z, radius: 0.95 });
    });

    LEVEL.logs.forEach((log) => {
      const posOnPath = worldPosition(log.localX, log.z);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(log.width, log.height, log.depth), makeMaterial("#6a3f22"));
      mesh.position.set(posOnPath.x, log.height / 2, posOnPath.z);
      mesh.rotation.y = trackAngle(log.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
      colliders.push({ type: "log", active: true, mesh, x: posOnPath.x, y: log.height / 2, z: posOnPath.z, w: log.width, h: log.height, d: log.depth });
    });

    LEVEL.crates.forEach((crate) => {
      const posOnPath = worldPosition(crate.localX, crate.z);
      const group = new THREE.Group();
      group.position.set(posOnPath.x, crate.height / 2, posOnPath.z);
      const box = new THREE.Mesh(new THREE.BoxGeometry(crate.width, crate.height, crate.depth), makeMaterial("#93612e"));
      const bandH = new THREE.Mesh(new THREE.BoxGeometry(crate.width + 0.08, 0.18, crate.depth + 0.08), makeMaterial("#e2b156"));
      const bandV = new THREE.Mesh(new THREE.BoxGeometry(0.2, crate.height + 0.08, crate.depth + 0.08), makeMaterial("#e2b156"));
      box.castShadow = true; box.receiveShadow = true;
      group.add(box, bandH, bandV);
      scene.add(group);
      colliders.push({ type: "crate", active: true, mesh: group, x: posOnPath.x, y: crate.height / 2, z: posOnPath.z, w: crate.width, h: crate.height, d: crate.depth });
    });

    LEVEL.branches.forEach((branch) => {
      const posOnPath = worldPosition(branch.localX, branch.z);
      const group = new THREE.Group();
      group.position.set(posOnPath.x, branch.yOffset, posOnPath.z);
      group.rotation.y = trackAngle(branch.z);
      const limb = new THREE.Mesh(new THREE.BoxGeometry(branch.width, branch.height, branch.depth), makeMaterial("#452817"));
      const leaves = new THREE.Mesh(new THREE.BoxGeometry(branch.width + 0.4, 1.35, 1.8), makeMaterial("#17713d"));
      leaves.position.y = 0.98;
      limb.castShadow = true; leaves.castShadow = true;
      group.add(limb, leaves);
      scene.add(group);
      colliders.push({ type: "branch", active: true, mesh: group, x: posOnPath.x, y: branch.yOffset, z: posOnPath.z, w: branch.width, h: branch.height, d: branch.depth });
    });

    const gate = new THREE.Group();

    // Patrol monkey enemies — dark cube body with glowing red eye
    const monkeyBodyMat = makeMaterial("#2a1f0e", { roughness: 0.55, metalness: 0.1 });
    const monkeyEyeMat = new THREE.MeshStandardMaterial({ color: "#ff2200", emissive: "#ff2200", emissiveIntensity: 2.5 });
    LEVEL.enemies.forEach((en) => {
      const group = new THREE.Group();
      const posOnPath = worldPosition(en.baseLocalX, en.z);
      group.position.set(posOnPath.x, 0.9, posOnPath.z);
      const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), monkeyBodyMat);
      bodyBox.castShadow = true;
      const eyeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), monkeyEyeMat);
      eyeGlow.position.set(0, 0.42, -0.62);
      const eyeLight = new THREE.PointLight("#ff2200", 1.4, 5);
      eyeLight.position.copy(eyeGlow.position);
      // Spike crown
      for (let s = 0; s < 4; s++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 5), monkeyBodyMat);
        spike.position.set(Math.cos(s * Math.PI / 2) * 0.45, 0.88, Math.sin(s * Math.PI / 2) * 0.45);
        spike.rotation.z = Math.cos(s * Math.PI / 2) * 0.5;
        spike.rotation.x = Math.sin(s * Math.PI / 2) * 0.5;
        group.add(spike);
      }
      group.add(bodyBox, eyeGlow, eyeLight);
      scene.add(group);
      enemies.push({ mesh: group, active: true, baseLocalX: en.baseLocalX, z: posOnPath.z, x: posOnPath.x, patrolRange: en.patrolRange, patrolSpeed: en.patrolSpeed, w: 1.5, h: 1.5, d: 1.5 });
    });

    // Golden pineapple collectibles — torus knot shape, orange glow
    const pineappleMat = new THREE.MeshStandardMaterial({ color: "#f5a623", emissive: "#f5a623", emissiveIntensity: 1.2, metalness: 0.8, roughness: 0.12 });
    LEVEL.collectibles.forEach((col) => {
      const posOnPath = worldPosition(col.localX, col.z);
      const group = new THREE.Group();
      group.position.set(posOnPath.x, col.y, posOnPath.z);
      const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.38, 0.12, 80, 14), pineappleMat);
      knot.castShadow = true;
      const glow = new THREE.PointLight("#f5a623", 2.2, 7);
      group.add(knot, glow);
      scene.add(group);
      collectibleMeshes.push({ mesh: group, knot, active: true, x: posOnPath.x, y: col.y, z: posOnPath.z, radius: 0.9 });
    });

    gate.position.set(trackCenter(LEVEL.gate.z), 0, LEVEL.gate.z);
    gate.rotation.y = trackAngle(LEVEL.gate.z);
    const gateMat = makeMaterial("#d9b863", { roughness: 0.55, emissive: "#4d2f05", emissiveIntensity: 0.2 });
    const pillarL = new THREE.Mesh(new THREE.BoxGeometry(1, 6, 1.2), gateMat);
    pillarL.position.set(-3.6, 3, 0);
    const pillarR = pillarL.clone(); pillarR.position.x = 3.6;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(8.4, 1.35, 1.4), gateMat);
    lintel.position.set(0, 6.4, 0);
    const gateGlow = new THREE.PointLight("#ffbf4a", 2.8, 28);
    gateGlow.position.set(0, 4, 2);
    gate.add(pillarL, pillarR, lintel, gateGlow);
    scene.add(gate);
    colliders.push({ type: "gate", active: true, mesh: gate, x: trackCenter(LEVEL.gate.z), y: 3, z: LEVEL.gate.z, w: CONFIG.corridorHalfWidth * 2 + 6, h: 6, d: CONFIG.finishTriggerDepth });

    const player = new THREE.Group();
    scene.add(player);
    const pink = makeMaterial("#ff4fb3", { roughness: 0.58, emissive: "#3d0522", emissiveIntensity: 0.08 });
    const innerEar = makeMaterial("#ffb8e7", { roughness: 0.75 });
    const dark = new THREE.MeshBasicMaterial({ color: "#111111" });

    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(2.25, 2.05, 2.85), pink);
    bodyMesh.position.y = 1.02; bodyMesh.castShadow = true;
    player.add(bodyMesh);

    const head = new THREE.Group();
    head.position.set(0, 1.88, -1.65);
    player.add(head);
    const headBox = new THREE.Mesh(new THREE.BoxGeometry(1.44, 1.44, 1.44), pink);
    headBox.castShadow = true;
    head.add(headBox);

    const earGeo = new THREE.BoxGeometry(1.55, 1.95, 0.22);
    const earL = new THREE.Mesh(earGeo, pink);
    const earR = new THREE.Mesh(earGeo, pink);
    earL.position.set(-1.18, 0, 0.18); earR.position.set(1.18, 0, 0.18);
    earL.rotation.y = -0.34; earR.rotation.y = 0.34;
    const inL = new THREE.Mesh(new THREE.BoxGeometry(1.08, 1.45, 0.24), innerEar);
    const inR = inL.clone();
    inL.position.copy(earL.position); inR.position.copy(earR.position);
    inL.rotation.y = earL.rotation.y; inR.rotation.y = earR.rotation.y;
    head.add(earL, earR, inL, inR);

    const trunk = new THREE.Group();
    trunk.position.set(0, -0.18, -0.85);
    const trunkMesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.75, 0.5), pink);
    trunkMesh.position.y = -0.75; trunkMesh.castShadow = true;
    trunk.add(trunkMesh);
    head.add(trunk);

    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.18), dark);
    eyeL.position.set(-0.38, 0.23, -0.76);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.38;
    head.add(eyeL, eyeR);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.68, 32), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.38, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    scene.add(shadow);

    const body = {
      localX: 0, x: trackCenter(CONFIG.startZ), y: CONFIG.playerSize / 2, z: CONFIG.startZ,
      speed: 0, yVelocity: 0, coyoteTimer: CONFIG.coyoteTime, jumpBufferTimer: 0,
      grounded: true, jumpHeld: false, doubleUsed: false,
      spaceHeldTimer: 0, spaceActionResolved: false, bufferedSlide: false,
      slideTimer: 0, hurtTimer: 0, smashTimer: 0, smashActionTimer: 0,
      spinTimer: 0,
      yaw: 0, health: 100, lives: 5, fruit: 0, fruitLifeCounter: 0, crates: 0,
      score: 0, multiplier: 1, multiplierCombo: 0, multiplierTimer: 0,
      state: "Ready", completed: false, lastPrompt: "",
    };

    function activateParticle(x, y, z, colour, scale = 0.28, life = 1, velocity = {}) {
      let particle = particlePool.find((entry) => !entry.active);
      if (!particle) particle = particles.shift();
      if (!particle) return;
      particle.active = true;
      particle.life = life;
      particle.startLife = life;
      particle.vx = velocity.vx ?? (Math.random() - 0.5) * 2.5;
      particle.vy = velocity.vy ?? Math.random() * 2.2 + 0.6;
      particle.vz = velocity.vz ?? (Math.random() - 0.5) * 2.5;
      particle.mesh.position.set(x, y, z);
      particle.mesh.scale.setScalar(scale);
      particle.mesh.material.color.set(colour);
      particle.mesh.material.opacity = 0.62;
      particle.mesh.visible = true;
      particles.push(particle);
    }

    function burst(x, y, z, colour, count = 8, scale = 0.28) {
      for (let i = 0; i < count; i++) activateParticle(x, y, z, colour, scale, 0.8 + Math.random() * 0.4);
    }

    function createPopTexture(text, colour) {
      const canvas = document.createElement("canvas");
      canvas.width = 360; canvas.height = 96;
      const ctx = canvas.getContext("2d");
      ctx.font = "900 32px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 7;
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(text, 180, 56);
      ctx.fillStyle = colour;
      ctx.fillText(text, 180, 56);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    function prewarmPopText(text, colour = "#fff3b0", count = 2) {
      const key = `${text}|${colour}`;
      if (popPools.has(key)) return popPools.get(key);
      const tex = createPopTexture(text, colour);
      const pool = [];
      for (let i = 0; i < count; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
        sprite.visible = false;
        sprite.scale.set(5.5, 1.5, 1);
        scene.add(sprite);
        pool.push({ sprite, active: false, life: 0, tex });
      }
      popPools.set(key, pool);
      return pool;
    }

    function popText(text, x, y, z, colour = "#fff3b0") {
      const pool = prewarmPopText(text, colour, 2);
      let pop = pool.find((entry) => !entry.active);
      if (!pop) pop = pool[0];
      if (pop.active) {
        const activeIndex = pops.indexOf(pop);
        if (activeIndex >= 0) pops.splice(activeIndex, 1);
      }
      pop.active = true;
      pop.life = 1;
      pop.sprite.position.set(x, y, z);
      pop.sprite.material.opacity = 1;
      pop.sprite.visible = true;
      pops.push(pop);
    }

    pickupPopPresets.forEach(([text, colour, count]) => prewarmPopText(text, colour, count));

    function playerBox(nx, ny, nz) {
      return makePlayerBox(nx, ny, nz, body.slideTimer > 0);
    }

    function zOverlapDepth(a, b) {
      return Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
    }

    function sweptObstaclePlayerBox(obsBox, currentBox, nextBox, nextLocalX, nextY, nextZ) {
      const forward = body.speed > 0 && currentBox.minZ > obsBox.maxZ && nextBox.minZ <= obsBox.maxZ;
      const backward = body.speed < 0 && currentBox.maxZ < obsBox.minZ && nextBox.maxZ >= obsBox.minZ;
      if (!forward && !backward) return null;

      const halfDepth = (nextBox.maxZ - nextBox.minZ) / 2;
      const contactZ = forward ? obsBox.maxZ + halfDepth : obsBox.minZ - halfDepth;
      const travelZ = nextZ - body.z;
      const t = Math.abs(travelZ) > 0.00001 ? clamp((contactZ - body.z) / travelZ, 0, 1) : 1;
      const contactLocalX = lerp(body.localX, nextLocalX, t);
      const contactY = lerp(body.y, nextY, t);
      const contactX = worldX(contactLocalX, contactZ);
      const contactBox = playerBox(contactX, contactY, contactZ);

      return aabb(contactBox, obsBox) ? contactBox : null;
    }

    function isRetreatingFromObstacle(currentBox, nextBox, obstacleBox) {
      if (!aabb(currentBox, obstacleBox)) return false;
      return zOverlapDepth(nextBox, obstacleBox) < zOverlapDepth(currentBox, obstacleBox) - 0.001;
    }

    function loseLife() {
      body.lives = Math.max(0, body.lives - 1);
      body.health = 100;
      body.hurtTimer = 0.75;
      body.speed = 0;
      body.localX = 0;
      body.x = trackCenter(body.z);
      popText(body.lives > 0 ? "HERD LIFE LOST" : "HERD NEEDS REST", body.x, body.y + 3.4, body.z, "#ff9aa9");
      playTone("hurt");
      if (body.lives <= 0 && !gameOverRef.current) {
        gameOverRef.current = true;
        setGameOver(true);
      }
    }

    function hurt(croc = false) {
      if (body.hurtTimer > 0 || body.completed || body.lives <= 0) return;
      body.health = Math.max(0, body.health - (croc ? 34 : 22));
      body.hurtTimer = 0.45;
      body.speed = Math.max(0, body.speed * 0.15);
      burst(body.x, body.y + 1.1, body.z, croc ? "#53a653" : "#ff3f58", 8, 0.25);
      popText(croc ? "SNAP!" : "OOPS!", body.x, body.y + 3.2, body.z, croc ? "#9aff99" : "#ff8794");
      playTone(croc ? "croc" : "hurt");
      if (body.health <= 0) loseLife();
    }

    function completeLevel(popZ = body.z) {
      if (completeRef.current) return;
      const elapsedMs = gameStartTimeRef.current ? performance.now() - gameStartTimeRef.current : 0;
      const stats = { fruit: body.fruit, crates: body.crates, score: body.score, elapsedMs };
      body.completed = true;
      completeRef.current = true;
      finalStatsRef.current = stats;
      body.speed = 0;
      popText("JUNGLE GATE!", body.x, body.y + 3, popZ - 2, "#fff1a6");
      playTone("gate");
      setFinalStats(stats);
      setComplete(true);
    }

    function breakCrate(obs) {
      obs.active = false;
      obs.mesh.visible = false;
      body.crates += 1;
      body.smashTimer = 0.18;
      burst(obs.x, obs.y, obs.z, "#99652f", 13, 0.25);
      burst(obs.x, obs.y + 0.8, obs.z, "#ffd34a", 5, 0.22);
      popText("TRUNK-SMASH!", obs.x, obs.y + 2.2, obs.z, "#ffe08a");
      playTone("smash");
    }

    function collectScore(basePoints) {
      const scored = basePoints * body.multiplier;
      body.score += scored;
      body.multiplierCombo += 1;
      body.multiplierTimer = 3.0;
      body.multiplier = Math.min(5, 1 + Math.floor(body.multiplierCombo / 5));
      return scored;
    }

    function resize() {
      if (!mount || disposed) return;
      renderer.setSize(mount.clientWidth, Math.max(1, mount.clientHeight));
      camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
      camera.updateProjectionMatrix();
    }

    function keyDown(e) {
      if (!isAllowedKey(e.code)) return;
      e.preventDefault();
      if (e.code === "Backquote" && !keyRef.current.__pressed.Backquote) {
        debugRef.current = !debugRef.current;
        setDebug(debugRef.current);
      }
      setKeyState(keyRef.current, e.code, true);
    }

    function keyUp(e) {
      if (!isAllowedKey(e.code)) return;
      e.preventDefault();
      setKeyState(keyRef.current, e.code, false);
    }

    function blur() { keyRef.current = createKeys(); }

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", resize);

    function updateCrocs(now) {
      const t = now * 0.001;
      crocs.forEach((croc) => {
        const zMove = Math.sin(t * 1.8 + croc.phase) * 6;
        const xMove = Math.sin(t * 1.2 + croc.phase) * 1.2;
        croc.z = croc.riverZ + zMove;
        croc.x = worldX(croc.baseLocalX + xMove, croc.z);
        croc.mesh.position.set(croc.x, 0.48 + Math.sin(t * 4 + croc.phase) * 0.08, croc.z);
        croc.mesh.rotation.y = trackAngle(croc.z) + Math.sin(t + croc.phase) * 0.35;
      });
    }

    function updateMusicAndStampede(charge) {
      const ctx = audioRef.current;
      if (!ctx || !musicRef.current.enabled || !startedRef.current || completeRef.current || gameOverRef.current) return;
      musicRef.current.beatSeconds = lerp(0.26, 0.15, charge);
      while (musicRef.current.nextNoteTime < ctx.currentTime + 0.1) {
        const note = NOTES[musicRef.current.noteIndex % NOTES.length];
        playTone("thump", musicRef.current.nextNoteTime);
        if (musicRef.current.noteIndex % 2 === 0) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(noteToFrequency(note), musicRef.current.nextNoteTime);
          gain.gain.setValueAtTime(0.025, musicRef.current.nextNoteTime);
          gain.gain.exponentialRampToValueAtTime(0.001, musicRef.current.nextNoteTime + 0.12);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(musicRef.current.nextNoteTime);
          osc.stop(musicRef.current.nextNoteTime + 0.14);
        }
        musicRef.current.noteIndex += 1;
        musicRef.current.nextNoteTime += musicRef.current.beatSeconds;
      }
      if (charge > 0.58 && body.grounded && body.speed > 6) {
        const intensity = clamp((charge - 0.58) / 0.42, 0, 1);
        const interval = lerp(0.34, 0.13, intensity);
        if (ctx.currentTime >= stampedeRef.current.nextStepTime) {
          stampedeRef.current.nextStepTime = ctx.currentTime + interval;
          playTone("thump");
          if (intensity > 0.5) burst(body.x, 0.18, body.z + 0.8, "#d6c399", 2, 0.22);
        }
      }
    }

    function updatePhysics(dt) {
      const k = keyRef.current;
      const playing = startedRef.current && !completeRef.current && !gameOverRef.current && body.lives > 0;
      const charge = clamp(body.speed / CONFIG.maxSpeed, 0, 1);
      const wasGrounded = body.grounded;

      body.hurtTimer = Math.max(0, body.hurtTimer - dt);
      body.smashTimer = Math.max(0, body.smashTimer - dt);
      body.smashActionTimer = Math.max(0, body.smashActionTimer - dt);
      body.slideTimer = Math.max(0, body.slideTimer - dt);
      body.jumpBufferTimer = Math.max(0, body.jumpBufferTimer - dt);
      body.spinTimer = Math.max(0, body.spinTimer - dt);
      body.multiplierTimer = Math.max(0, body.multiplierTimer - dt);
      if (body.multiplierTimer <= 0 && body.multiplier > 1) {
        body.multiplier = 1;
        body.multiplierCombo = 0;
      }
      if (body.grounded) body.coyoteTimer = CONFIG.coyoteTime;
      else body.coyoteTimer = Math.max(0, body.coyoteTimer - dt);

      const wantsSlide = playing && k.ArrowDown && body.grounded && body.slideTimer <= 0 && body.speed > 2 && body.hurtTimer === 0;
      const wantsReverse = playing && k.ArrowDown && body.grounded && !wantsSlide;
      const wantsForward = playing && k.ArrowUp && !wantsReverse;
      if (playing && (body.hurtTimer === 0 || wantsReverse)) {
        if (wantsForward) {
          body.speed = Math.min(CONFIG.maxSpeed, body.speed + CONFIG.acceleration * dt);
        } else if (wantsReverse) {
          body.speed = Math.max(-CONFIG.reverseMaxSpeed, body.speed - CONFIG.reverseAcceleration * dt);
        } else {
          body.speed *= Math.exp(-CONFIG.friction * dt);
          const idleStep = CONFIG.idleDeceleration * dt;
          body.speed = Math.abs(body.speed) <= idleStep ? 0 : body.speed - Math.sign(body.speed) * idleStep;
        }
        if (Math.abs(body.speed) < CONFIG.minSpeed) body.speed = 0;
      } else if (playing) {
        body.speed *= Math.exp(-CONFIG.friction * dt);
        if (Math.abs(body.speed) < CONFIG.minSpeed) body.speed = 0;
      } else {
        body.speed = 0;
      }

      let nextLocalX = body.localX;
      let ny = body.y;
      let nz = body.z - body.speed * dt;

      if (playing && body.hurtTimer === 0) {
        const steer = (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0);
        nextLocalX = clamp(nextLocalX + steer * CONFIG.steerSpeed * dt, -CONFIG.corridorHalfWidth, CONFIG.corridorHalfWidth);
        body.yaw = lerp(body.yaw, steer * -0.22 + trackAngle(nz), 1 - Math.exp(-CONFIG.turnDamping * dt));
      }

      let nx = worldX(nextLocalX, nz);
      const spaceDown = k.Space;
      const spaceJustReleased = !spaceDown && body.jumpHeld;

      function startSlide() {
        if (!playing || body.slideTimer > 0 || body.speed <= 2) return;
        body.slideTimer = CONFIG.slideDuration;
        body.bufferedSlide = false;
        burst(body.x, 0.2, body.z, "#d6c399", 6, 0.2);
      }

      function doGroundJump() {
        body.yVelocity = CONFIG.jumpVelocity;
        body.grounded = false;
        body.coyoteTimer = 0;
        body.jumpBufferTimer = 0;
        body.doubleUsed = false;
        burst(body.x, 0.2, body.z, "#d6c399", 5, 0.2);
        playTone("jump");
      }

      function doDoubleJump() {
        body.yVelocity = CONFIG.doubleJumpVelocity;
        body.doubleUsed = true;
        body.jumpBufferTimer = 0;
        burst(body.x, body.y + 0.6, body.z, "#ff89d2", 8, 0.2);
        popText("BIG Bounce!", body.x, body.y + 2.8, body.z, "#ffc3ed");
        playTone("double");
      }

      function triggerJumpOrDoubleJump() {
        if (!playing || body.slideTimer > 0) return;
        if (body.grounded || body.coyoteTimer > 0) doGroundJump();
        else if (!body.doubleUsed) doDoubleJump();
        else body.jumpBufferTimer = CONFIG.jumpBufferTime;
      }

      if (k.KeyZ && body.smashActionTimer <= 0 && playing) {
        body.smashActionTimer = 0.18;
        body.smashTimer = Math.max(body.smashTimer, 0.1);
        trunk.rotation.x = -0.85;
      }

      // Spin attack — E key, 0.55s duration, defeats patrol monkeys
      if (k.KeyE && body.spinTimer <= 0 && playing) {
        body.spinTimer = 0.55;
        burst(body.x, body.y + 0.8, body.z, "#ff89d2", 12, 0.22);
        burst(body.x, body.y + 0.8, body.z, "#ffd34a", 6, 0.18);
        popText("SPIN ATTACK!", body.x, body.y + 2.8, body.z, "#ffcf66");
        playTone("double");
      }

      if (spaceDown && !body.jumpHeld) {
        body.spaceHeldTimer = 0;
        body.spaceActionResolved = false;
        body.bufferedSlide = false;
      }
      if (spaceDown && !body.spaceActionResolved && playing) {
        body.spaceHeldTimer += dt;
        if (body.spaceHeldTimer >= CONFIG.slideHoldThreshold) {
          body.spaceActionResolved = true;
          if (body.grounded) startSlide();
          else body.bufferedSlide = true;
        }
      }
      if (spaceJustReleased && !body.spaceActionResolved) {
        triggerJumpOrDoubleJump();
        body.spaceActionResolved = true;
      }

      body.jumpHeld = spaceDown;
      if (playing && body.bufferedSlide && body.grounded) startSlide();
      if (wantsSlide) startSlide();

      if (!body.grounded) {
        const gravityMultiplier = body.yVelocity < 0 ? CONFIG.fallGravityMultiplier : 1;
        body.yVelocity += CONFIG.gravity * gravityMultiplier * dt;
        ny += body.yVelocity * dt;
        const groundY = CONFIG.playerSize / 2;
        if (ny <= groundY) {
          ny = groundY;
          body.yVelocity = 0;
          body.grounded = true;
          body.coyoteTimer = CONFIG.coyoteTime;
          body.doubleUsed = false;
          burst(nx, 0.18, nz, "#d6c399", 8, 0.22);
          playTone("land");
          if (body.jumpBufferTimer > 0 && body.slideTimer <= 0) {
            body.x = nx; body.z = nz;
            doGroundJump();
            ny = body.y;
          }
        }
      }

      const pBox = playerBox(nx, ny, nz);
      const currentBox = playerBox(body.x, body.y, body.z);
      const isReversing = playing && body.speed < 0 && nz > body.z;
      let blocked = false;

      if (body.smashActionTimer > 0) {
        const smashBox = { minX: nx - CONFIG.smashRange, maxX: nx + CONFIG.smashRange, minY: 0, maxY: ny + 2.4, minZ: nz - CONFIG.smashRange * 1.4, maxZ: nz + CONFIG.smashRange * 0.35 };
        for (const obs of colliders) {
          if (!obs.active || obs.type !== "crate") continue;
          const crateBox = { minX: obs.x - obs.w / 2, maxX: obs.x + obs.w / 2, minY: obs.y - obs.h / 2, maxY: obs.y + obs.h / 2, minZ: obs.z - obs.d / 2, maxZ: obs.z + obs.d / 2 };
          if (aabb(smashBox, crateBox)) breakCrate(obs);
        }
      }

      const activeObstacles = colliders.concat(crocs);
      for (const obs of activeObstacles) {
        if (!obs.active) continue;
        const oBox = obstacleBox(obs);
        let collisionBox = aabb(pBox, oBox) ? pBox : null;
        if (!collisionBox && (obs.type === "log" || obs.type === "branch" || obs.type === "crate" || obs.type === "croc")) {
          collisionBox = sweptObstaclePlayerBox(oBox, currentBox, pBox, nextLocalX, ny, nz);
        }
        if (!collisionBox) continue;
        const canRetreat = isReversing && isRetreatingFromObstacle(currentBox, collisionBox, oBox);
        if (obs.type === "log") {
          if (collisionBox.minY < oBox.maxY - 0.18 && !canRetreat) { hurt(false); blocked = true; }
        } else if (obs.type === "branch") {
          if (branchHitsPlayer(collisionBox, oBox) && !canRetreat) { hurt(false); blocked = true; }
        } else if (obs.type === "croc") {
          if (!canRetreat) { hurt(true); blocked = true; }
        } else if (obs.type === "crate") {
          if (charge >= CONFIG.smashChargeThreshold || body.smashActionTimer > 0) breakCrate(obs);
          else if (!canRetreat) { hurt(false); blocked = true; }
        } else if (obs.type === "gate") {
          completeLevel(obs.z);
          blocked = false;
        }
      }

      for (const item of pickups) {
        if (!item.active) continue;
        const box = { minX: item.x - item.radius, maxX: item.x + item.radius, minY: item.y - item.radius, maxY: item.y + item.radius, minZ: item.z - item.radius, maxZ: item.z + item.radius };
        if (aabb(pBox, box)) {
          item.active = false;
          item.mesh.visible = false;
          if (item.type === "fruit") {
            body.fruit += 1;
            body.fruitLifeCounter += 1;
            const pts = collectScore(5);
            burst(item.x, item.y, item.z, "#ffd34a", 4, 0.2);
            playTone("fruit");
            if (body.fruitLifeCounter >= 100) {
              body.lives += 1;
              body.fruitLifeCounter = 0;
              popText("BONUS ELEPHANT!", body.x, body.y + 3.4, body.z, "#b7ffb7");
              playTone("life");
            }
          } else {
            body.health = Math.min(100, body.health + 25);
            burst(item.x, item.y, item.z, "#4ade80", 10, 0.22);
            popText("SUGAR CANE!", item.x, item.y + 1.4, item.z, "#a7ffbf");
            playTone("heal");
          }
        }
      }

      // Patrol monkey collision — spin attack defeats, otherwise hurts
      for (const en of enemies) {
        if (!en.active) continue;
        const enBox = { minX: en.x - en.w / 2, maxX: en.x + en.w / 2, minY: 0, maxY: en.h, minZ: en.z - en.d / 2, maxZ: en.z + en.d / 2 };
        if (!aabb(pBox, enBox)) continue;
        if (body.spinTimer > 0) {
          en.active = false;
          en.mesh.visible = false;
          const pts = collectScore(20);
          body.multiplierTimer = 3.0;
          burst(en.x, en.mesh.position.y + 0.7, en.z, "#ff2200", 14, 0.22);
          burst(en.x, en.mesh.position.y + 0.7, en.z, "#ffd34a", 6, 0.18);
          popText(`MONKEY DOWN! +${pts}`, en.x, en.mesh.position.y + 2.8, en.z, "#ffcf66");
          playTone("smash");
        } else {
          hurt(false);
        }
      }

      const crossedFinishPlane = body.z > LEVEL.finish.z && nz <= LEVEL.finish.z;
      if (playing && !completeRef.current && (crossedFinishPlane || nz <= LEVEL.finish.failSafeZ)) {
        nz = LEVEL.finish.z;
        nx = worldX(nextLocalX, nz);
        completeLevel(nz);
        blocked = false;
      }

      // Golden pineapple collectibles — always collectible
      for (const col of collectibleMeshes) {
        if (!col.active) continue;
        const colBox = { minX: col.x - col.radius, maxX: col.x + col.radius, minY: col.y - col.radius, maxY: col.y + col.radius, minZ: col.z - col.radius, maxZ: col.z + col.radius };
        if (aabb(pBox, colBox)) {
          col.active = false;
          col.mesh.visible = false;
          const pts = collectScore(50);
          body.fruitLifeCounter = Math.min(99, body.fruitLifeCounter + 20);
          burst(col.x, col.y, col.z, "#f5a623", 16, 0.28);
          burst(col.x, col.y + 1, col.z, "#fff8e7", 8, 0.18);
          popText(`GOLDEN PINEAPPLE! +${pts}`, col.x, col.y + 2.4, col.z, "#f5a623");
          playTone("gate");
        }
      }

      if (!blocked) {
        body.localX = nextLocalX; body.x = nx; body.y = ny; body.z = nz;
      }
      if (wasGrounded && !body.grounded && body.yVelocity <= 0) body.coyoteTimer = CONFIG.coyoteTime;

      if (body.completed) body.state = "Jungle Gate";
      else if (body.lives <= 0) body.state = "Herd Resting";
      else if (body.hurtTimer > 0) body.state = "Jungle Bump";
      else if (body.spinTimer > 0) body.state = "Spin Attack";
      else if (body.smashTimer > 0) body.state = "Trunk-Smash";
      else if (body.slideTimer > 0) body.state = "Belly-Slide";
      else if (!body.grounded) body.state = body.doubleUsed ? "BIG Bounce" : "Leap";
      else if (charge > 0.82) body.state = "Mighty Charge";
      else if (body.speed > 0.5) body.state = "Charging";
      else body.state = "Ready";

      updateMusicAndStampede(charge);
    }

    function updateMeshes(dt, now) {
      const t = now * 0.001;
      updateCrocs(now);
      const charge = clamp(body.speed / CONFIG.maxSpeed, 0, 1);
      const sliding = body.slideTimer > 0;
      const hurtState = body.hurtTimer > 0;
      player.position.set(body.x, body.y, body.z);
      player.rotation.y = body.yaw;

      let sx = 1, sy = 1, sz = 1;
      if (sliding) { sx = 1.14; sy = 0.48; sz = 1.45; }
      else if (hurtState) { sx = 1.18; sy = 0.82; sz = 1.05; }
      else if (body.smashTimer > 0) { sx = 1.18; sy = 0.9; sz = 1.32; }
      else if (!body.grounded) { sx = 0.94; sy = 1.08 + Math.max(0, body.yVelocity) * 0.012; sz = 0.95; }
      else if (body.speed > 0.1) {
        const bounce = Math.sin(t * (7 + body.speed * 0.75)) * 0.055;
        sy = 1 + bounce; sx = 1 - bounce * 0.38; sz = 1 - bounce * 0.28;
      }

      bodyMesh.scale.set(sx, sy, sz);
      head.scale.set(sx, sy, sz);
      trunk.rotation.x = body.smashActionTimer > 0 ? -0.85 : sliding ? 0.75 : !body.grounded ? (body.yVelocity > 0 ? -0.38 : 0.34) : Math.sin(t * 10 + body.speed * 0.3) * 0.18 + charge * 0.16;
      trunk.rotation.y = body.spinTimer > 0 ? t * 18 : 0;
      earL.rotation.y = -0.34 + Math.sin(t * 8 + body.speed * 0.35) * (0.1 + charge * 0.15);
      earR.rotation.y = 0.34 - Math.sin(t * 8 + body.speed * 0.35) * (0.1 + charge * 0.15);
      inL.rotation.y = earL.rotation.y; inR.rotation.y = earR.rotation.y;
      pink.color.set(hurtState && Math.floor(t * 14) % 2 === 0 ? "#ffffff" : "#ff4fb3");

      shadow.position.set(body.x, 0.025, body.z);
      const air = clamp((body.y - CONFIG.playerSize / 2) / 5, 0, 1);
      const sh = lerp(sliding ? 1.35 : 1, 0.5, air);
      shadow.scale.set(sh, sh, sh);
      shadow.material.opacity = lerp(0.4, 0.16, air);

      pickups.forEach((item, index) => {
        if (!item.active) return;
        item.mesh.rotation.y += dt * 2.2;
        item.mesh.position.y = item.y + Math.sin(t * 3 + index) * 0.16;
      });
      gate.rotation.y = trackAngle(LEVEL.gate.z) + Math.sin(t * 0.7) * 0.02;

      // Patrol monkey animation
      enemies.forEach((en) => {
        if (!en.active) return;
        const patrolOffset = Math.sin(t * en.patrolSpeed + en.z * 0.1) * en.patrolRange;
        en.x = worldX(en.baseLocalX + patrolOffset, en.z);
        en.mesh.position.x = en.x;
        en.mesh.position.y = 0.9 + Math.sin(t * en.patrolSpeed * 2) * 0.18;
        en.mesh.rotation.y = t * en.patrolSpeed;
        en.mesh.rotation.z = -Math.cos(t * en.patrolSpeed) * 0.22;
      });

      // Golden pineapple animation
      collectibleMeshes.forEach((col) => {
        if (!col.active) return;
        col.knot.rotation.y += dt * 1.8;
        col.knot.rotation.x += dt * 0.9;
        col.mesh.position.y = col.y + Math.sin(t * 3.5 + col.z) * 0.22;
      });

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt * 1.7;
        p.vy += CONFIG.gravity * 0.12 * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.mesh.scale.multiplyScalar(1 + dt * 1.5);
        p.mesh.material.opacity = Math.max(0, p.life / p.startLife) * 0.62;
        if (p.life <= 0) {
          p.active = false;
          p.mesh.visible = false;
          particles.splice(i, 1);
        }
      }

      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.life -= dt * 1.3;
        p.sprite.position.y += dt * 1.8;
        p.sprite.material.opacity = Math.max(0, p.life);
        if (p.life <= 0) {
          p.active = false;
          p.sprite.visible = false;
          pops.splice(i, 1);
        }
      }
    }

    function updateCamera() {
      const charge = clamp(body.speed / CONFIG.maxSpeed, 0, 1);
      camera.fov = lerp(camera.fov, lerp(CONFIG.cameraFov, CONFIG.highChargeFov, charge), 0.04);
      camera.updateProjectionMatrix();
      if (!startedRef.current) {
        const t = performance.now() * 0.00035;
        camera.position.set(trackCenter(-28) + Math.sin(t) * 14, 8.5, 15 + Math.cos(t) * 4);
        camera.lookAt(trackCenter(-28), 1.5, -28);
        return;
      }
      const shake = body.hurtTimer > 0 ? (Math.random() - 0.5) * 0.42 : 0;
      const chargeShake = charge > 0.82 ? (Math.random() - 0.5) * 0.07 : 0;
      const lookZ = body.z - 26 - charge * 8;
      const lookAhead = worldPosition(body.localX * 0.35, lookZ);
      const cameraX = lerp(body.x, lookAhead.x, 0.42);
      const desired = new THREE.Vector3(cameraX + shake + chargeShake, body.y + CONFIG.cameraHeight + shake, body.z + CONFIG.cameraDistance + charge * 2);
      camera.position.lerp(desired, CONFIG.cameraLerp);
      camera.lookAt(lookAhead.x, body.y + 1.4, lookAhead.z);
    }

    function sectionLabel() {
      const d = Math.abs(Math.min(0, body.z));
      if (d < 245) return "Learning Trail";
      if (d < 490) return "Practice Grove";
      if (d < 735) return "Stampede Hollow";
      return "Jungle Gate";
    }

    function promptText() {
      const d = Math.abs(Math.min(0, body.z));
      const loop = Math.floor(d / 245);
      const local = d % 245;
      if (!startedRef.current) return "Press Begin the Trail to wake the bright jungle.";
      if (completeRef.current) return "The Jungle Gate is open. Brilliant trumpet work!";
      if (gameOverRef.current) return "The herd needs a breather. Refresh to try the trail again.";
      if (loop === 0) {
        if (local < 14) return "Hold ↑ to build Elephant Charge.";
        if (local < 58) return "Follow the golden fruit and feel the big pink rhythm.";
        if (local < 102) return "Use ← → to sway through the jungle trail.";
        if (local < 134) return "Tap Space to leap the log. Watch the shadow, not the ears.";
        if (local < 168) return "Tap Space again in the air for a BIG Bounce.";
        if (local < 194) return "Hold Space or press ↓ to Belly-Slide under vines.";
        if (local < 218) return "Charge hard, press Z for Trunk-Smash, or E for a Spin Attack on monkeys.";
        if (local < 238) return "Crocodile creek ahead. Stop, read the jaws, then charge.";
        return "Sugar cane restores energy after a jungle bump.";
      }
      if (local < 58) return `${sectionLabel()}: build a braver Elephant Charge.`;
      if (local < 102) return "Sway through the fruit trail. Big feet, gentle steering.";
      if (local < 134) return "Leap the log. Keep the shadow clear.";
      if (local < 168) return "Reach the high fruit with a BIG Bounce.";
      if (local < 194) return "Belly-Slide low. Let the vines skim overhead.";
      if (local < 218) return "Trunk-Smash the crate. Charge makes the jungle listen.";
      if (local < 238) return "Crocodile creek again. Stop, read, then stampede.";
      return loop < 3 ? "Sugar cane ahead. Gather your elephant energy." : "Final stretch. Trumpet proudly towards the Jungle Gate!";
    }

    function drawSpeedometer(charge) {
      const canvas = ui.speedo.current;
      if (!canvas) return;
      const size = canvas.width;
      const cx = size / 2, cy = size / 2;
      const r = size * 0.38;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, size, size);
      const startAngle = Math.PI * 0.75;
      const endAngle = Math.PI * 2.25;
      const fillEnd = startAngle + (endAngle - startAngle) * charge;

      ctx.beginPath();
      ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,200,100,0.18)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, endAngle);
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, fillEnd);
      ctx.strokeStyle = charge > 0.82 ? "#ff89d2" : "#ffd34a";
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.stroke();

      for (let i = 0; i <= 8; i++) {
        const angle = startAngle + (endAngle - startAngle) * (i / 8);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * (r - 14), cy + Math.sin(angle) * (r - 14));
        ctx.lineTo(cx + Math.cos(angle) * (r - 4), cy + Math.sin(angle) * (r - 4));
        ctx.strokeStyle = i % 2 === 0 ? "rgba(255,200,100,0.55)" : "rgba(255,255,255,0.22)";
        ctx.lineWidth = i % 2 === 0 ? 2 : 1;
        ctx.stroke();
      }

      const needleAngle = startAngle + (endAngle - startAngle) * charge;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(needleAngle) * (r - 16), cy + Math.sin(needleAngle) * (r - 16));
      ctx.strokeStyle = charge > 0.82 ? "#ff89d2" : "#fff8e7";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd34a";
      ctx.fill();

      ctx.font = `bold ${Math.round(size * 0.16)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = charge > 0.82 ? "#ff89d2" : "#fff8e7";
      ctx.fillText(`${Math.round(charge * 100)}`, cx, cy + r * 0.26);

      ctx.font = `bold ${Math.round(size * 0.075)}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,220,140,0.7)";
      ctx.fillText("CHARGE", cx, cy + r * 0.5);
    }

    function updateDom() {
      const charge = clamp(body.speed / CONFIG.maxSpeed, 0, 1);

      if (ui.health.current) {
        ui.health.current.style.width = `${body.health}%`;
        const hue = Math.round((body.health / 100) * 120);
        ui.health.current.style.background = `linear-gradient(90deg, hsl(${hue},90%,52%), hsl(${Math.max(0, hue - 20)},95%,42%))`;
      }
      if (ui.lives.current) ui.lives.current.textContent = "🐘".repeat(Math.max(0, body.lives));
      if (ui.charge.current) {
        ui.charge.current.style.width = `${charge * 100}%`;
        ui.charge.current.style.filter = charge > 0.82 ? "drop-shadow(0 0 8px #ff89d2)" : "none";
      }
      if (ui.chargeText.current) ui.chargeText.current.textContent = `${Math.round(charge * 100)}%`;

      const stateColours = {
        "Mighty Charge": "#ff4fb3", Charging: "#ffd34a", Leap: "#7dd8ff",
        "BIG Bounce": "#c4b5fd", "Belly-Slide": "#6ee7b7", "Trunk-Smash": "#fb923c",
        "Spin Attack": "#ffcf66", "Jungle Bump": "#f87171", "Herd Resting": "#94a3b8",
        "Jungle Gate": "#ffd34a", Ready: "rgba(255,255,255,0.45)",
      };
      if (ui.stateBadge.current) {
        ui.stateBadge.current.textContent = body.state;
        ui.stateBadge.current.style.color = stateColours[body.state] || "#fff";
        ui.stateBadge.current.style.borderColor = `${stateColours[body.state] || "#fff"}55`;
      }

      // Multiplier badge
      if (ui.multiplierBadge.current) {
        const show = body.multiplier > 1;
        ui.multiplierBadge.current.textContent = `${body.multiplier}x COMBO`;
        ui.multiplierBadge.current.style.opacity = show ? "1" : "0";
        ui.multiplierBadge.current.style.transform = show ? "scale(1)" : "scale(0.85)";
        ui.multiplierBadge.current.style.color = body.multiplier >= 4 ? "#ff4fb3" : body.multiplier >= 3 ? "#fb923c" : "#ffd34a";
      }

      // Momentum status label (below charge bar)
      if (ui.momentumLabel.current) {
        ui.momentumLabel.current.textContent = charge > 0.85
          ? "STAMPEDE — HOLD YOUR GROUND"
          : charge > 0.5
          ? "BUILDING MOMENTUM"
          : charge > 0.1
          ? "WARMING UP"
          : "READY TO CHARGE";
        ui.momentumLabel.current.style.color = charge > 0.85 ? "#ff89d2" : charge > 0.5 ? "#ffd34a" : "rgba(255,255,255,0.4)";
      }

      // Score tally
      if (ui.scoreTally.current) ui.scoreTally.current.textContent = completeRef.current ? finalStatsRef.current.score : body.score;

      drawSpeedometer(charge);

      if (ui.timerDisplay.current && gameStartTimeRef.current && startedRef.current && !gameOverRef.current) {
        const elapsedMs = completeRef.current ? finalStatsRef.current.elapsedMs : performance.now() - gameStartTimeRef.current;
        const elapsed = Math.floor(elapsedMs / 1000);
        const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
        const ss = String(elapsed % 60).padStart(2, "0");
        ui.timerDisplay.current.textContent = `${mm}:${ss}`;
      }

      if (ui.sectionBadge.current) ui.sectionBadge.current.textContent = sectionLabel();
      if (ui.distance.current) ui.distance.current.textContent = `${Math.abs(Math.min(0, body.z)).toFixed(0)}`;
      if (ui.fruit.current) ui.fruit.current.textContent = `${body.fruitLifeCounter}/100`;
      if (ui.fruitLife.current) ui.fruitLife.current.style.width = `${body.fruitLifeCounter}%`;
      if (ui.fruitTally.current) ui.fruitTally.current.textContent = completeRef.current ? finalStatsRef.current.fruit : body.fruit;
      if (ui.cratesTally.current) ui.cratesTally.current.textContent = completeRef.current ? finalStatsRef.current.crates : body.crates;

      const prompt = promptText();
      if (ui.prompt.current && prompt !== body.lastPrompt) {
        body.lastPrompt = prompt;
        ui.prompt.current.textContent = prompt;
      }

      if (ui.debug.current) {
        ui.debug.current.textContent = [
          `FPS ${fps}`,
          `Section ${sectionLabel()}`,
          `X ${body.x.toFixed(2)}  Y ${body.y.toFixed(2)}  Z ${body.z.toFixed(2)}`,
          `Speed ${body.speed.toFixed(2)}  Charge ${(charge * 100).toFixed(0)}%`,
          `Grounded ${body.grounded}  Slide ${body.slideTimer > 0}`,
          `Lives ${body.lives}  Health ${body.health}`,
          `Fruit ${body.fruitLifeCounter}/100`,
          testSummary,
        ].join(nl);
      }
    }

    function animate(now) {
      if (disposed) return;
      const dt = Math.min((now - last) / 1000, 0.033);
      last = now;
      frames++;
      if (now - lastFpsTime > 500) {
        fps = Math.round((frames * 1000) / (now - lastFpsTime));
        frames = 0;
        lastFpsTime = now;
      }
      updatePhysics(dt);
      updateMeshes(dt, now);
      updateCamera();
      updateDom();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    }

    resize();
    frame = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", resize);
      scene.traverse((object) => {
        if (!object.isMesh && !object.isSprite) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        object.geometry?.dispose?.();
        materials.forEach((material) => {
          if (!material) return;
          Object.values(material).forEach((value) => {
            if (value && typeof value.dispose === "function" && value.isTexture) value.dispose();
          });
          material.dispose?.();
        });
      });
      renderer.dispose();
      renderer.forceContextLoss();
      jungleTexture.dispose();
      pathTexture.dispose();
      pooledParticleGeometry.dispose();
      popPools.forEach((pool) => pool[0]?.tex.dispose());
      caneGeometry.dispose();
      caneMat.dispose();
      if (mount && renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
  }, [testSummary]);

  const startDemo = () => {
    stopTitleTheme(0.18);
    startAudio();
    keyRef.current = createKeys();
    startedRef.current = true;
    completeRef.current = false;
    gameOverRef.current = false;
    gameStartTimeRef.current = performance.now();
    finalStatsRef.current = { fruit: 0, crates: 0, score: 0, elapsedMs: 0 };
    setFinalStats(finalStatsRef.current);
    setStarted(true);
    setComplete(false);
    setGameOver(false);
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#132516] text-white" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div ref={mountRef} className="absolute inset-0" />

      {/* TOP STRIP — tally, section, timer */}
      {started && !complete && !gameOver && (
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-2"
          style={{ background: "linear-gradient(to bottom, rgba(10,18,10,0.72) 0%, transparent 100%)" }}>
          <div className="flex items-center gap-3 text-xs font-black tracking-widest text-amber-100/80">
            <span>🍋 <span ref={ui.fruitTally}>0</span></span>
            <span className="text-amber-100/30">·</span>
            <span>📦 <span ref={ui.cratesTally}>0</span></span>
            <span className="text-amber-100/30">·</span>
            <span>⭐ <span ref={ui.scoreTally}>0</span></span>
          </div>
          <div ref={ui.sectionBadge} className="rounded-full px-4 py-1 text-xs font-black uppercase tracking-[0.28em] text-emerald-200"
            style={{ background: "rgba(20,50,25,0.70)", border: "1px solid rgba(100,220,130,0.22)" }}>
            Learning Trail
          </div>
          <div className="flex items-center gap-2 rounded-full px-3 py-1 text-sm font-black text-amber-100"
            style={{ background: "rgba(20,15,8,0.72)", border: "1px solid rgba(255,200,80,0.22)" }}>
            <Icon label="⏱" />
            <span style={{ fontSize: "10px", letterSpacing: "0.2em", color: "rgba(255,200,100,0.6)" }}>TIME</span>
            <span ref={ui.timerDisplay} style={{ fontVariantNumeric: "tabular-nums" }}>00:00</span>
          </div>
        </div>
      )}

      {/* LEFT PANEL — stamina, lives, charge, state */}
      {started && !complete && !gameOver && (
        <div className="pointer-events-none absolute left-3 top-12 z-10 w-52"
          style={{ background: "rgba(10,18,10,0.72)", border: "1px solid rgba(246,210,138,0.22)", borderRadius: "1.25rem", padding: "0.85rem 1rem" }}>
          <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.22em] text-pink-200/70">
            <Icon label="⚡" size={12} /> Energy
          </div>
          <div className="h-3 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div ref={ui.health} className="h-full w-full rounded-full transition-all duration-150" />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.22em] text-pink-200/70">
              <Icon label="💗" size={12} /> Herd
            </span>
            <span ref={ui.lives} className="text-sm leading-none">🐘🐘🐘🐘🐘</span>
          </div>
          <div className="my-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }} />
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.22em] text-pink-200/70">
              <Icon label="⬆" size={12} /> Charge
            </span>
            <span ref={ui.chargeText} className="text-[10px] font-black text-fuchsia-200">0%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div ref={ui.charge} className="h-full w-0 rounded-full transition-all duration-75"
              style={{ background: "linear-gradient(90deg, #ec4899, #d946ef)" }} />
          </div>
          <div className="mt-3 flex justify-center">
            <span ref={ui.stateBadge} className="rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest transition-all duration-150"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.35)" }}>
              Ready
            </span>
          </div>
          {/* Multiplier badge */}
          <div ref={ui.multiplierBadge}
            className="mt-2 text-center text-[12px] font-black tracking-widest transition-all duration-200"
            style={{ opacity: 0, transform: "scale(0.85)", color: "#ffd34a" }}>
            1x COMBO
          </div>
          {/* Momentum label */}
          <div className="mt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "0.5rem" }}>
            <div ref={ui.momentumLabel}
              className="text-center text-[9px] font-black uppercase tracking-[0.22em] transition-colors duration-300"
              style={{ color: "rgba(255,255,255,0.4)" }}>
              READY TO CHARGE
            </div>
          </div>
        </div>
      )}

      {/* RIGHT PANEL — depth, next life */}
      {started && !complete && !gameOver && (
        <div className="pointer-events-none absolute right-3 top-12 z-10 w-48"
          style={{ background: "rgba(10,18,10,0.72)", border: "1px solid rgba(246,210,138,0.22)", borderRadius: "1.25rem", padding: "0.85rem 1rem" }}>
          <div className="mb-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200/70">
            <Icon label="🧭" size={12} /> Trail Depth
          </div>
          <div className="text-2xl font-black leading-none text-amber-100">
            <span ref={ui.distance}>0</span><span className="ml-1 text-sm text-amber-100/50">m</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-amber-100/40">
            <Icon label="🎯" size={12} /> Gate at 760 m
          </div>
          <div className="mt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "0.75rem" }}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-yellow-100/70">Next Life</span>
              <span ref={ui.fruit} className="text-[10px] font-black text-yellow-100">0/100</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div ref={ui.fruitLife} className="h-full w-0 rounded-full transition-all duration-150"
                style={{ background: "linear-gradient(90deg, #facc15, #84cc16)" }} />
            </div>
            <div className="mt-2 text-[9px] tracking-wider text-yellow-100/40">🍋 100 fruit = bonus elephant</div>
          </div>
        </div>
      )}

      {/* BOTTOM CENTRE — prompt + speedometer */}
      {started && !complete && !gameOver && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 flex flex-col items-center gap-2"
          style={{ transform: "translateX(-50%)" }}>
          <div ref={ui.prompt}
            className="overflow-hidden text-ellipsis whitespace-nowrap rounded-full px-5 py-2 text-center text-sm font-black tracking-wide text-amber-50"
            style={{ background: "rgba(10,18,10,0.80)", border: "1px solid rgba(246,210,138,0.28)", maxWidth: "min(520px, 92vw)" }}>
            Hold ↑ to build Elephant Charge.
          </div>
          <canvas ref={ui.speedo} width={120} height={120} style={{ display: "block" }} />
        </div>
      )}

      {/* START SCREEN */}
      {!started && !complete && !gameOver && (
        <section className="absolute inset-0 z-30 flex items-center justify-center px-6"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(15,28,12,0.45) 50%, rgba(0,0,0,0.8) 100%)", backdropFilter: "blur(2px)" }}>
          <div className="w-full max-w-xl rounded-[2rem] p-8 text-center"
            style={{ background: "rgba(12,20,10,0.78)", border: "1px solid rgba(246,210,138,0.25)", boxShadow: "0 0 55px rgba(255,180,80,0.15)" }}>
            <div className="mb-2 text-xs font-black uppercase tracking-[0.38em] text-emerald-200/75">Three-Loop Jungle Trial</div>
            <div className="title-elephant-badge mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
              aria-label="Pink elephant mascot" role="img">
              <span className="title-elephant-mascot" aria-hidden="true">
                <span className="title-elephant-sunburst" />
                <span className="title-elephant-shadow" />
                <span className="title-elephant-tail" />
                <span className="title-elephant-ear" />
                <span className="title-elephant-body" />
                <span className="title-elephant-head" />
                <span className="title-elephant-trunk" />
                <span className="title-elephant-tusk" />
                <span className="title-elephant-leg title-elephant-leg-back" />
                <span className="title-elephant-leg title-elephant-leg-front" />
                <span className="title-elephant-crown" />
              </span>
            </div>
            <h1 className="display-title text-5xl font-black leading-tight text-pink-300 drop-shadow" style={{ letterSpacing: "0.01em" }}>Pink Elephant</h1>
            <h2 className="display-title mt-1 text-3xl font-black text-amber-100" style={{ letterSpacing: "0.05em" }}>Jungle Dash</h2>
            <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-amber-50/75">
              Stomp through a guided jungle corridor. Gather golden fruit, leap logs, BIG Bounce, Belly-Slide under vines, Trunk-Smash crates, and stampede past crocodiles to reach the Jungle Gate.
            </p>
            <button onClick={startDemo}
              className="mt-7 rounded-full px-10 py-4 text-base font-black text-slate-950 transition hover:scale-105 active:scale-95"
              style={{ background: "#f472b6", boxShadow: "0 0 30px rgba(244,114,182,0.45)" }}>
              Begin the Trail
            </button>
            <div className="mt-6 grid grid-cols-2 gap-2 text-left text-xs text-amber-50/70">
              {[["↑ / W", "Build Charge"], ["← / A   → / D", "Sway the Trail"], ["Tap Space / Shift", "Leap"], ["Hold Space / Shift / ↓ / S", "Belly-Slide"], ["Z", "Trunk-Smash"], ["E", "Spin Attack"]].map(([key, label]) => (
                <div key={key} className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="w-20 shrink-0 font-black text-amber-200">{key}</span><span>{label}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 text-[11px] tracking-wide text-emerald-100/50">{testSummary}</div>
          </div>
        </section>
      )}

      {/* COMPLETE SCREEN */}
      {complete && (
        <section className="absolute inset-0 z-20 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.52)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-[2rem] p-10 text-center"
            style={{ background: "rgba(12,20,10,0.88)", border: "1px solid rgba(255,200,80,0.35)", boxShadow: "0 0 65px rgba(255,190,80,0.22)" }}>
            <div className="mb-4 text-6xl">🏆</div>
            <h2 className="display-title text-4xl font-black text-amber-200">Jungle Gate Reached!</h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-amber-50/70">
              The herd made it through. The jungle is yours.
            </p>
            <div className="mt-5 flex justify-center gap-6 text-sm font-black text-amber-100">
              <span>🍋 <span ref={ui.fruitTally}>{finalStats.fruit}</span></span>
              <span>📦 <span ref={ui.cratesTally}>{finalStats.crates}</span></span>
              <span>⭐ <span ref={ui.scoreTally}>{finalStats.score}</span></span>
              <span>⏱ <span ref={ui.timerDisplay}>{formatElapsed(finalStats.elapsedMs)}</span></span>
            </div>
            <button onClick={() => window.location.reload()}
              className="mt-8 rounded-full bg-amber-200 px-8 py-3 font-black text-slate-950 transition hover:scale-105 active:scale-95">
              Restart Trail
            </button>
          </div>
        </section>
      )}

      {/* GAME OVER SCREEN */}
      {gameOver && (
        <section className="absolute inset-0 z-20 flex items-center justify-center px-6"
          style={{ background: "rgba(42,5,10,0.72)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-[2rem] p-10 text-center"
            style={{ background: "rgba(24,10,12,0.9)", border: "1px solid rgba(255,120,140,0.35)", boxShadow: "0 0 65px rgba(255,80,120,0.18)" }}>
            <div className="mb-4 text-6xl">⚠️</div>
            <h2 className="display-title text-4xl font-black text-red-100">The Herd Needs Rest</h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-red-50/70">
              Too many jungle bumps. Restart and build Charge more carefully.
            </p>
            <button onClick={() => window.location.reload()}
              className="mt-8 rounded-full bg-white px-8 py-3 font-black text-slate-950 transition hover:scale-105 active:scale-95">
              Try Again
            </button>
          </div>
        </section>
      )}

      {/* DEBUG PANEL */}
      {debug && (
        <pre ref={ui.debug} className="pointer-events-none absolute bottom-4 right-4 z-10 min-w-56 rounded-2xl p-4 text-xs leading-relaxed text-lime-200"
          style={{ background: "rgba(0,0,0,0.75)", border: "1px solid rgba(100,220,80,0.18)" }} />
      )}
    </main>
  );
}
