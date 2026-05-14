import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { Icon } from "./components/Icon.jsx";
import { CAMERA_FEEDBACK, CONFIG, HUD_TIMING, MOVEMENT, PARTICLES, PICKUPS, SCORING } from "./game/config.js";
import {
  canRetreatFromObstacle,
  enemyBox,
  handleBranchCollision,
  handleCrateCollision,
  handleCrocCollision,
  handleGateCollision,
  handleLogCollision,
  obstacleBox,
  playerBox,
  radiusBox,
  smashBox,
  sweptObstaclePlayerBox,
} from "./game/collisionHelpers.js";
import { createKeys, isAllowedKey, setKeyState } from "./game/input.js";
import { LEVEL } from "./game/level.js";
import { promptForZ } from "./game/prompts.js";
import { aabb, clamp, createSeededRandom, lerp } from "./game/math.js";
import { DEFAULT_AUDIO_STATE, createAudioManager, normalizeAudioState } from "./game/audio/audioManager.js";
import { makeMaterial } from "./game/rendering/materials.js";
import { createPostProcessing } from "./game/rendering/postprocessing.js";
import { makeFoamStreakTexture, makeGroundTexture, makePathTexture, makeWaterRippleTexture } from "./game/rendering/textures.js";
import {
  createPlayerBody,
  selectPlayerStateLabel,
  triggerPlayerSmash,
  triggerPlayerSpin,
} from "./game/player.js";
import {
  getPlayerInputIntent,
  tickPlayerTimers,
  updateJumpAndSlideInput,
  updatePlayerAir,
  updatePlayerSpeed,
  updatePlayerSteering,
} from "./game/movement.js";
import { applyFruitLifeCounter } from "./game/fruitLife.js";
import {
  LEADERBOARD_LIMIT,
  isLeaderboardAvailable,
  leaderboardResultQualifies,
  loadLeaderboard as loadSharedLeaderboard,
  normalizeInitials,
  submitLeaderboardEntry,
  validateInitials,
} from "./game/leaderboard.js";
import { runSelfTests } from "./game/selfTests.js";
import { trackAngle, trackCenter, worldPosition, worldX } from "./game/track.js";

const nl = String.fromCharCode(10);
const JUNGLE_LAYOUT_SEED = 0x5eed2026;

const AUDIO_PREFS_KEY = "pink-elephant-audio-state";

function readStoredAudioState() {
  if (typeof window === "undefined") return { ...DEFAULT_AUDIO_STATE };
  try {
    const stored = window.localStorage.getItem(AUDIO_PREFS_KEY);
    return stored ? normalizeAudioState(JSON.parse(stored)) : { ...DEFAULT_AUDIO_STATE };
  } catch {
    return { ...DEFAULT_AUDIO_STATE };
  }
}

function writeStoredAudioState(state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(normalizeAudioState(state)));
  } catch {
    // Storage may be unavailable in private browsing or embedded previews.
  }
}

function AudioControls({ audioState, onToggle, compact = false }) {
  const allMuted = audioState.muted;
  const musicMuted = audioState.muted || audioState.musicMuted;
  const sfxMuted = audioState.muted || audioState.sfxMuted;
  const buttonBase = compact
    ? "pointer-events-auto rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest transition hover:scale-105 active:scale-95"
    : "rounded-full px-4 py-2 text-xs font-black uppercase tracking-widest transition hover:scale-105 active:scale-95";
  const wrapClass = compact ? "pointer-events-auto flex items-center gap-1" : "mt-5 flex flex-wrap items-center justify-center gap-2";
  const stopGestureStart = (event) => {
    event.stopPropagation();
  };

  return (
    <div className={wrapClass} onPointerDown={stopGestureStart} onKeyDown={stopGestureStart}>
      <button
        type="button"
        onClick={() => onToggle("muted")}
        className={buttonBase}
        aria-pressed={allMuted}
        aria-label={allMuted ? "Unmute all audio" : "Mute all audio"}
        title="Mute or unmute all audio"
        style={{ background: allMuted ? "rgba(248,113,113,0.92)" : "rgba(134,239,172,0.92)", color: "#082f1a" }}
      >
        {allMuted ? "🔇 Muted" : "🔊 Sound"}
      </button>
      <button
        type="button"
        onClick={() => onToggle("musicMuted")}
        className={buttonBase}
        aria-pressed={musicMuted}
        aria-label={musicMuted ? "Unmute music" : "Mute music"}
        title="Toggle title and gameplay music"
        style={{ background: musicMuted ? "rgba(255,255,255,0.14)" : "rgba(251,191,36,0.9)", color: musicMuted ? "rgba(255,255,255,0.75)" : "#422006", border: "1px solid rgba(255,255,255,0.16)" }}
      >
        Music {musicMuted ? "Off" : "On"}
      </button>
      <button
        type="button"
        onClick={() => onToggle("sfxMuted")}
        className={buttonBase}
        aria-pressed={sfxMuted}
        aria-label={sfxMuted ? "Unmute sound effects" : "Mute sound effects"}
        title="Toggle jumps, pickups, impacts, and UI sounds"
        style={{ background: sfxMuted ? "rgba(255,255,255,0.14)" : "rgba(244,114,182,0.9)", color: sfxMuted ? "rgba(255,255,255,0.75)" : "#4a044e", border: "1px solid rgba(255,255,255,0.16)" }}
      >
        SFX {sfxMuted ? "Off" : "On"}
      </button>
    </div>
  );
}

function formatElapsed(elapsedMs) {
  const elapsed = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function SelfTestStatus({ summaryRef }) {
  const [summary, setSummary] = useState(() => summaryRef.current);

  useEffect(() => {
    const results = runSelfTests();
    const passCount = results.filter((r) => r.pass).length;
    const nextSummary = `${passCount}/${results.length} self-tests passed`;
    summaryRef.current = nextSummary;
    setSummary(nextSummary);
    if (passCount !== results.length) console.warn("Pink Elephant self-tests failed", results);
  }, [summaryRef]);

  return <div className="mt-4 text-[11px] tracking-wide text-emerald-100/50">{summary}</div>;
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

function makeLowPolyTree(trunkMat, leafMats, geometries, rng = Math.random, scale = 1, castShadow = true) {
  const tree = new THREE.Group();
  const trunkHeight = 3.3 * scale + rng() * 0.9;
  const trunk = new THREE.Mesh(geometries.trunk, trunkMat);
  trunk.position.y = 1.55 * scale;
  trunk.scale.set(scale, trunkHeight, scale);
  trunk.castShadow = castShadow;

  const lowerRadius = (1.25 + rng() * 0.65) * scale;
  const lowerHeight = (2.4 + rng() * 0.5) * scale;
  const lowerLeaves = new THREE.Mesh(geometries.leaves, leafMats[Math.floor(rng() * leafMats.length)]);
  lowerLeaves.position.y = 3.55 * scale;
  lowerLeaves.scale.set(lowerRadius, lowerHeight, lowerRadius);
  lowerLeaves.castShadow = castShadow;

  const upperRadius = (0.85 + rng() * 0.35) * scale;
  const upperLeaves = new THREE.Mesh(geometries.leaves, leafMats[Math.floor(rng() * leafMats.length)]);
  upperLeaves.position.y = 4.85 * scale;
  upperLeaves.scale.set(upperRadius, 1.85 * scale, upperRadius);
  upperLeaves.castShadow = castShadow;

  tree.add(trunk, lowerLeaves, upperLeaves);
  tree.rotation.y = rng() * Math.PI;
  return tree;
}

function makeLowPolyBush(leafMats, geometries, rng = Math.random, scale = 1, castShadow = true) {
  const bush = new THREE.Group();
  const clumpCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < clumpCount; i++) {
    const radius = (0.55 + rng() * 0.45) * scale;
    const clump = new THREE.Mesh(geometries.bushClump, leafMats[Math.floor(rng() * leafMats.length)]);
    clump.position.set((rng() - 0.5) * 1.2 * scale, 0.45 * scale + rng() * 0.28 * scale, (rng() - 0.5) * 1.2 * scale);
    clump.scale.set(radius, radius * (0.72 + rng() * 0.38), radius);
    clump.castShadow = castShadow;
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
  const pausedRef = useRef(false);
  const pauseStartedAtRef = useRef(null);
  const audioManagerRef = useRef(null);
  if (!audioManagerRef.current) audioManagerRef.current = createAudioManager();
  const resetGameRef = useRef(null);
  const stampedeRef = useRef({ nextStepTime: 0 });
  const gameStartTimeRef = useRef(null);

  const [started, setStarted] = useState(false);
  const [complete, setComplete] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [debug, setDebug] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sceneError, setSceneError] = useState(null);
  const testSummaryRef = useRef("Self-tests pending");
  const [finalResults, setFinalResults] = useState(null);
  const [initials, setInitials] = useState("");
  const [initialsError, setInitialsError] = useState("");
  const [leaderboardSubmitted, setLeaderboardSubmitted] = useState(false);
  const [leaderboardStatus, setLeaderboardStatus] = useState({
    entries: [],
    loading: true,
    submitting: false,
    source: isLeaderboardAvailable() ? "remote" : "local",
    error: null,
  });
  const [audioState, setAudioState] = useState(readStoredAudioState);

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


  function setPausedState(nextPaused) {
    const shouldPause = Boolean(nextPaused) && startedRef.current && !completeRef.current && !gameOverRef.current;
    if (pausedRef.current === shouldPause) {
      if (shouldPause) keyRef.current = createKeys();
      return;
    }

    pausedRef.current = shouldPause;
    keyRef.current = createKeys();
    if (shouldPause) {
      pauseStartedAtRef.current = performance.now();
      audioManagerRef.current?.updateGameplayMusic({ charge: 0, isPlaying: false });
    } else {
      if (pauseStartedAtRef.current !== null && gameStartTimeRef.current) {
        gameStartTimeRef.current += performance.now() - pauseStartedAtRef.current;
      }
      pauseStartedAtRef.current = null;
    }
    setPaused(shouldPause);
  }

  function resumeGame() {
    setPausedState(false);
  }

  function restartGame() {
    resetGameRef.current?.({ start: true });
  }

  function startAudio() {
    return audioManagerRef.current?.startAudio() ?? null;
  }

  function applyAudioState(nextState) {
    const normalized = normalizeAudioState(nextState);
    audioManagerRef.current?.setAudioState(normalized);
    writeStoredAudioState(normalized);
    return normalized;
  }

  function toggleAudioState(key) {
    setAudioState((current) => {
      const next = normalizeAudioState({ ...current, [key]: !current[key] });
      applyAudioState(next);
      if (!next.muted && !next.musicMuted && !startedRef.current && !completeRef.current && !gameOverRef.current) {
        audioManagerRef.current?.startTitleTheme(true);
      }
      return next;
    });
  }

  function startTitleTheme() {
    audioManagerRef.current?.startTitleTheme(!startedRef.current && !completeRef.current && !gameOverRef.current);
  }

  function stopTitleTheme(fadeSeconds = 0.22) {
    audioManagerRef.current?.stopTitleTheme(fadeSeconds);
  }

  function playTone(type, atTime = null) {
    audioManagerRef.current?.playTone(type, atTime);
  }

  useEffect(() => {
    audioManagerRef.current?.setAudioState(audioState);
    writeStoredAudioState(audioState);
  }, [audioState]);

  useEffect(() => {
    function beginTitleThemeFromGesture() {
      startTitleTheme();
    }

    window.addEventListener("pointerdown", beginTitleThemeFromGesture);
    window.addEventListener("keydown", beginTitleThemeFromGesture);
    return () => {
      window.removeEventListener("pointerdown", beginTitleThemeFromGesture);
      window.removeEventListener("keydown", beginTitleThemeFromGesture);
      audioManagerRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshLeaderboard() {
      setLeaderboardStatus((status) => ({ ...status, loading: true, error: null }));
      const result = await loadSharedLeaderboard();
      if (cancelled) return;
      setLeaderboardStatus({
        entries: result.entries,
        loading: false,
        submitting: false,
        source: result.source,
        error: result.error,
      });
    }
    refreshLeaderboard();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!finalResults) {
      setLeaderboardSubmitted(false);
      setInitialsError("");
    }
  }, [finalResults]);

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

    const camera = new THREE.PerspectiveCamera(CAMERA_FEEDBACK.cameraFov, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 360);
    camera.position.set(0, 8, 16);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (error) {
      const message = error?.message || "WebGL is unavailable in this browser.";
      console.error("Pink Elephant WebGL renderer failed to start", error);
      setSceneError(message);
      return undefined;
    }
    setSceneError(null);
    const rendererPixelRatio = () => Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.setPixelRatio(rendererPixelRatio());
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    let postProcessing = null;
    try {
      postProcessing = createPostProcessing(renderer, scene, camera, {
        width: mount.clientWidth,
        height: Math.max(1, mount.clientHeight),
        pixelRatio: rendererPixelRatio(),
      });
    } catch (error) {
      console.warn("Pink Elephant post-processing failed; falling back to direct rendering", error);
    }

    const renderFrame = () => {
      if (postProcessing) {
        postProcessing.render();
        return;
      }
      renderer.render(scene, camera);
    };

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
    const activeObstacles = [];
    const obstacleTelegraphs = [];
    const enemies = [], collectibleMeshes = [];
    const particlePool = [];
    const popPools = new Map();
    const pooledParticleGeometry = new THREE.SphereGeometry(1, 8, 8);
    const sharedGeometries = {
      treeTrunk: new THREE.CylinderGeometry(0.22, 0.38, 1, 7),
      treeLeaves: new THREE.ConeGeometry(1, 1, 7),
      bushClump: new THREE.DodecahedronGeometry(1, 0),
      canopy: new THREE.DodecahedronGeometry(1, 0),
      fruit: new THREE.OctahedronGeometry(0.38, 0),
      unitBox: new THREE.BoxGeometry(1, 1, 1),
      cane: new THREE.CylinderGeometry(0.22, 0.22, 1.4, 8),
      monkeyBody: new THREE.SphereGeometry(0.72, 14, 10),
      monkeyHead: new THREE.SphereGeometry(0.52, 14, 10),
      monkeyEar: new THREE.SphereGeometry(0.24, 10, 8),
      monkeyMuzzle: new THREE.SphereGeometry(0.24, 10, 8),
      monkeyEye: new THREE.SphereGeometry(0.11, 10, 8),
      monkeyTailSegment: new THREE.CylinderGeometry(0.065, 0.075, 0.44, 8),
      monkeySpike: new THREE.ConeGeometry(0.14, 0.45, 5),
      pineapple: new THREE.TorusKnotGeometry(0.38, 0.12, 80, 14),
      cueLeaf: new THREE.DodecahedronGeometry(1, 0),
      cueRipple: new THREE.TorusGeometry(1, 0.035, 5, 14),
      cueGlint: new THREE.OctahedronGeometry(0.18, 0),
      edgeStone: new THREE.DodecahedronGeometry(0.42, 0),
      edgeFlower: new THREE.SphereGeometry(0.16, 8, 6),
      edgeStem: new THREE.CylinderGeometry(0.035, 0.045, 0.5, 5),
      edgeTorchPost: new THREE.CylinderGeometry(0.055, 0.075, 1.0, 6),
      edgeTorchFlame: new THREE.ConeGeometry(0.18, 0.42, 7),
      telegraphArrow: new THREE.ConeGeometry(0.38, 0.82, 3),
    };
    const sharedTreeGeometries = {
      trunk: sharedGeometries.treeTrunk,
      leaves: sharedGeometries.treeLeaves,
      bushClump: sharedGeometries.bushClump,
    };
    const MAX_PICKUP_POINT_LIGHTS = 4;
    let pickupPointLights = 0;
    const createLimitedPickupLight = (color, intensity, distance) => {
      if (pickupPointLights >= MAX_PICKUP_POINT_LIGHTS) return null;
      pickupPointLights += 1;
      return new THREE.PointLight(color, intensity, distance);
    };
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
      ["RECOVERING!", "#b7ffb7", 1],
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

    const waterRippleTexture = makeWaterRippleTexture();
    const foamStreakTexture = makeFoamStreakTexture();
    const riverMat = new THREE.MeshStandardMaterial({
      color: "#5fc9ff",
      map: waterRippleTexture,
      roughness: 0.28,
      metalness: 0.04,
      transparent: true,
      opacity: 0.88,
      emissive: "#0b4d78",
      emissiveIntensity: 0.34,
    });
    const foamMat = new THREE.MeshBasicMaterial({
      color: "#f3fdff",
      map: foamStreakTexture,
      transparent: true,
      opacity: 0.54,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const waterfallMat = new THREE.MeshBasicMaterial({
      color: "#8ee8ff",
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const waterfallMistMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    LEVEL.rivers.forEach((river, riverIndex) => {
      const cx = trackCenter(river.z);
      const riverGroup = new THREE.Group();
      riverGroup.position.set(cx, 0, river.z);
      riverGroup.rotation.y = trackAngle(river.z);
      scene.add(riverGroup);

      const water = new THREE.Mesh(new THREE.BoxGeometry(river.width, 0.12, river.depth), riverMat);
      water.position.y = 0.08;
      water.receiveShadow = true;
      riverGroup.add(water);

      [-1, 1].forEach((edgeSide) => {
        const edgeFoam = new THREE.Mesh(new THREE.PlaneGeometry(river.width * 0.96, 0.46), foamMat);
        edgeFoam.rotation.x = -Math.PI / 2;
        edgeFoam.position.set(0, 0.165, edgeSide * (river.depth / 2 - 0.2));
        edgeFoam.renderOrder = 2;
        riverGroup.add(edgeFoam);
      });

      river.crocs.forEach((croc) => {
        const wake = new THREE.Mesh(new THREE.PlaneGeometry(0.72, river.depth * 0.82), foamMat);
        wake.rotation.x = -Math.PI / 2;
        wake.position.set(croc.localX, 0.18, 0);
        wake.renderOrder = 2;
        riverGroup.add(wake);
      });

      if (riverIndex % 2 === 0) {
        const side = riverIndex % 4 === 0 ? -1 : 1;
        const falls = new THREE.Mesh(new THREE.PlaneGeometry(river.depth * 0.72, 1.65), waterfallMat);
        falls.rotation.y = Math.PI / 2;
        falls.position.set(side * (river.width / 2 + 0.18), 0.62, -river.depth * 0.04);
        riverGroup.add(falls);

        const mist = new THREE.Mesh(new THREE.PlaneGeometry(river.depth * 0.58, 0.34), waterfallMistMat);
        mist.rotation.x = -Math.PI / 2;
        mist.position.set(side * (river.width / 2 + 0.22), 0.13, -river.depth * 0.04);
        riverGroup.add(mist);

        for (let step = 0; step < 3; step += 1) {
          const drop = new THREE.Mesh(new THREE.PlaneGeometry(river.depth * (0.42 - step * 0.06), 0.2), waterfallMistMat);
          drop.rotation.x = -Math.PI / 2;
          drop.position.set(side * (river.width / 2 + 0.34 + step * 0.28), 0.12 + step * 0.16, -river.depth * 0.05);
          riverGroup.add(drop);
        }
      }

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
    const jungleRng = createSeededRandom(JUNGLE_LAYOUT_SEED);

    const edgePropGroup = new THREE.Group();
    scene.add(edgePropGroup);
    const edgeStoneMat = makeMaterial("#8f8a71", { roughness: 0.96 });
    const edgeFlowerMats = [
      makeMaterial("#ffd84d", { roughness: 0.72, emissive: "#3a2600", emissiveIntensity: 0.16 }),
      makeMaterial("#ff7fb2", { roughness: 0.76, emissive: "#3a061a", emissiveIntensity: 0.12 }),
      makeMaterial("#b9f4ff", { roughness: 0.7, emissive: "#062d36", emissiveIntensity: 0.14 }),
    ];
    const edgeStemMat = makeMaterial("#2b7c39", { roughness: 0.92 });
    const edgeTorchPostMat = makeMaterial("#4a2b16", { roughness: 0.86 });
    const edgeTorchFlameMat = new THREE.MeshStandardMaterial({ color: "#ffcf58", roughness: 0.35, emissive: "#ff8c1a", emissiveIntensity: 1.45 });
    const edgeLipHighlightMat = makeMaterial("#ffc66d", { roughness: 0.82, emissive: "#4f2500", emissiveIntensity: 0.18 });

    function trackCurvatureCue(z) {
      return Math.abs(trackAngle(z - 18) - trackAngle(z + 18));
    }

    function nearestRiverApproachDistance(z) {
      return LEVEL.rivers.reduce((nearest, river) => {
        const approachDistance = z - river.z;
        if (approachDistance < 8 || approachDistance > 74) return nearest;
        return Math.min(nearest, approachDistance);
      }, Infinity);
    }

    function makeEdgeFlower(rng) {
      const flower = new THREE.Group();
      const stem = new THREE.Mesh(sharedGeometries.edgeStem, edgeStemMat);
      stem.position.y = 0.32;
      stem.rotation.z = (rng() - 0.5) * 0.28;
      const bloom = new THREE.Mesh(sharedGeometries.edgeFlower, edgeFlowerMats[Math.floor(rng() * edgeFlowerMats.length)]);
      bloom.position.y = 0.62;
      bloom.scale.set(1.25, 0.75, 1.25);
      bloom.castShadow = true;
      flower.add(stem, bloom);
      return flower;
    }

    function makeEdgeTorch() {
      const torch = new THREE.Group();
      const post = new THREE.Mesh(sharedGeometries.edgeTorchPost, edgeTorchPostMat);
      post.position.y = 0.56;
      post.castShadow = true;
      const flame = new THREE.Mesh(sharedGeometries.edgeTorchFlame, edgeTorchFlameMat);
      flame.position.y = 1.28;
      flame.castShadow = true;
      torch.add(post, flame);
      return torch;
    }

    function addEdgeGuidanceProps() {
      const propRng = createSeededRandom(JUNGLE_LAYOUT_SEED ^ 0x0b3d5);
      let lastHighlightZ = Infinity;
      for (let z = 10; z > -792; z -= 10) {
        const curvature = trackCurvatureCue(z);
        const riverApproach = nearestRiverApproachDistance(z);
        const bendCue = curvature > 0.11;
        const riverCue = riverApproach !== Infinity;
        const highlightCue = bendCue || riverCue;
        const spacingSkip = !highlightCue && Math.floor(Math.abs(z) / 10) % 2 === 1;
        if (spacingSkip) continue;

        [-1, 1].forEach((side) => {
          if (!highlightCue && propRng() < 0.28) return;
          const localEdgeX = side * (safeHalfWidth + 0.58 + propRng() * 0.46 + (highlightCue ? 0.1 : 0.42));
          const propZ = z + (propRng() - 0.5) * 3.2;
          const pos = worldPosition(localEdgeX, propZ);
          const roll = trackAngle(propZ);
          let prop;

          if (riverCue && riverApproach < 46 && Math.floor(Math.abs(z) / 10 + side) % 3 === 0) {
            prop = makeEdgeTorch();
            prop.scale.setScalar(0.9 + propRng() * 0.18);
          } else if (bendCue && propRng() < 0.5) {
            prop = new THREE.Mesh(sharedGeometries.edgeStone, edgeStoneMat);
            const stoneScale = 0.7 + propRng() * 0.62;
            prop.scale.set(stoneScale * (1.1 + propRng() * 0.35), stoneScale * 0.34, stoneScale * 0.78);
            prop.castShadow = true;
            prop.receiveShadow = true;
          } else {
            prop = makeEdgeFlower(propRng);
            prop.scale.setScalar(0.72 + propRng() * 0.42);
          }

          prop.position.set(pos.x, 0.12, pos.z);
          prop.rotation.y = roll + side * 0.32 + (propRng() - 0.5) * 0.42;
          edgePropGroup.add(prop);
        });

        if (highlightCue && Math.abs(z - lastHighlightZ) > 20) {
          const length = riverCue ? 9.5 : 7.2;
          [-1, 1].forEach((side) => {
            const lipSegment = new THREE.Mesh(
              createTrackRibbonGeometry(
                side < 0 ? -safeHalfWidth - 0.2 : safeHalfWidth - 0.02,
                side < 0 ? -safeHalfWidth + 0.02 : safeHalfWidth + 0.2,
                z + length * 0.5,
                z - length * 0.5,
                2.4,
              ),
              edgeLipHighlightMat,
            );
            lipSegment.position.y = 0.142;
            lipSegment.receiveShadow = true;
            edgePropGroup.add(lipSegment);
          });
          lastHighlightZ = z;
        }
      }
    }

    addEdgeGuidanceProps();

    for (let z = 16; z > -824; z -= 8) {
      [-1, 1].forEach((side) => {
        const jitterZ = z + jungleRng() * 5 - 2.5;
        const nearTree = makeLowPolyTree(trunkMat, leafMats, sharedTreeGeometries, jungleRng, 0.95 + jungleRng() * 0.35);
        nearTree.position.set(worldX(side * (7.1 + jungleRng() * 3.1), jitterZ), 0, jitterZ);
        treeGroup.add(nearTree);

        const backTreeZ = jitterZ - 2 + jungleRng() * 4;
        const backTree = makeLowPolyTree(trunkMat, leafMats, sharedTreeGeometries, jungleRng, 0.82 + jungleRng() * 0.5, false);
        backTree.position.set(worldX(side * (12.2 + jungleRng() * 6.4), backTreeZ), 0, backTreeZ);
        treeGroup.add(backTree);

        const bush = makeLowPolyBush(leafMats, sharedTreeGeometries, jungleRng, 0.9 + jungleRng() * 0.55);
        bush.position.set(worldX(side * (6.45 + jungleRng() * 2.0), jitterZ + 1.4), 0.02, jitterZ + 1.4);
        treeGroup.add(bush);

        if (Math.abs(z % 24) < 0.1) {
          const foregroundTree = makeLowPolyTree(trunkMat, leafMats, sharedTreeGeometries, jungleRng, 1.55 + jungleRng() * 0.35);
          foregroundTree.position.set(worldX(side * (8.8 + jungleRng() * 2.5), jitterZ), 0, jitterZ);
          treeGroup.add(foregroundTree);
        }

        if (Math.abs(z % 32) < 0.1) {
          const canopyRadius = 2.0 + jungleRng() * 1.2;
          const canopy = new THREE.Mesh(sharedGeometries.canopy, leafMats[Math.floor(jungleRng() * leafMats.length)]);
          canopy.position.set(worldX(side * (5.9 + jungleRng() * 2.8), jitterZ), 7.0 + jungleRng() * 1.8, jitterZ);
          canopy.scale.set(canopyRadius * 1.25, canopyRadius * 0.62, canopyRadius * 0.9);
          canopy.rotation.y = jungleRng() * Math.PI;
          canopy.castShadow = true;
          treeGroup.add(canopy);
        }
      });
    }

    const fruitMat = new THREE.MeshStandardMaterial({ color: "#ffd34a", roughness: 0.34, metalness: 0.15, emissive: "#ffd34a", emissiveIntensity: 0.62 });
    LEVEL.fruits.forEach((pos) => {
      const posOnPath = worldPosition(pos.localX, pos.z);
      const fruit = new THREE.Mesh(sharedGeometries.fruit, fruitMat);
      fruit.position.set(posOnPath.x, pos.y || 1.05, posOnPath.z);
      fruit.castShadow = true;
      scene.add(fruit);
      pickups.push({ type: "fruit", mesh: fruit, active: true, x: posOnPath.x, y: pos.y || 1.05, z: posOnPath.z, radius: PICKUPS.fruitRadius });
    });

    const caneMat = new THREE.MeshStandardMaterial({ color: "#52e879", roughness: 0.45, emissive: "#154d24", emissiveIntensity: 0.7 });
    LEVEL.health.forEach((pos) => {
      const posOnPath = worldPosition(pos.localX, pos.z);
      const group = new THREE.Group();
      group.position.set(posOnPath.x, 1.25, posOnPath.z);
      const cane = new THREE.Mesh(sharedGeometries.cane, caneMat);
      cane.rotation.z = 0.35;
      const glow = createLimitedPickupLight("#54ff83", 1.6, 7);
      group.add(cane);
      if (glow) group.add(glow);
      scene.add(group);
      pickups.push({ type: "health", mesh: group, active: true, x: posOnPath.x, y: 1.25, z: posOnPath.z, radius: PICKUPS.healthRadius });
    });

    const logMat = makeMaterial("#6a3f22");
    const crateMat = makeMaterial("#93612e");
    const crateBandMat = makeMaterial("#e2b156");
    const branchLimbMat = makeMaterial("#452817");
    const branchLeafMat = makeMaterial("#17713d");
    const cueLeafShadowMat = makeMaterial("#0b1b11", { transparent: true, opacity: 0.46, roughness: 1 });
    const cueMudMat = makeMaterial("#3f2616", { roughness: 1 });
    const cueCratePlankMat = makeMaterial("#b77a3d", { roughness: 0.9 });
    const cueRippleMat = makeMaterial("#9de7ff", { transparent: true, opacity: 0.68, roughness: 0.45, emissive: "#124d66", emissiveIntensity: 0.2 });
    const cueEyeMat = new THREE.MeshStandardMaterial({ color: "#ff2a1c", emissive: "#ff1200", emissiveIntensity: 2.8 });
    const telegraphRingMat = new THREE.MeshBasicMaterial({ color: "#ffe08a", transparent: true, opacity: 0.22, depthWrite: false });
    const telegraphArrowMat = new THREE.MeshBasicMaterial({ color: "#ffd34a", transparent: true, opacity: 0.34, depthWrite: false });
    const telegraphDangerMat = new THREE.MeshBasicMaterial({ color: "#ff7a45", transparent: true, opacity: 0.26, depthWrite: false });
    const CUE_PREVIEW_DISTANCE = 5.8;
    const TELEGRAPH_VISIBLE_DISTANCE = 54;

    function registerObstacleTelegraph({ localX = 0, z, type, distance = 8, width = 2.2 }) {
      const cueZ = z + distance;
      const pos = worldPosition(localX, cueZ);
      const group = new THREE.Group();
      group.position.set(pos.x, 0, pos.z);
      group.rotation.y = trackAngle(cueZ);
      group.visible = false;

      const ringMat = telegraphRingMat.clone();
      const ring = new THREE.Mesh(sharedGeometries.cueRipple, ringMat);
      ring.position.y = 0.18;
      ring.rotation.x = Math.PI / 2;
      ring.scale.set(Math.max(1.15, width * 0.78), 0.62, 1);
      group.add(ring);

      const arrowMat = (type === "crate" ? telegraphArrowMat : telegraphDangerMat).clone();
      [-0.72, 0, 0.72].forEach((xOffset, index) => {
        const arrow = new THREE.Mesh(sharedGeometries.telegraphArrow, arrowMat);
        arrow.position.set(xOffset * Math.min(1.2, width / 2.4), 0.2 + index * 0.008, -0.38 + index * 0.36);
        arrow.rotation.set(Math.PI / 2, 0, Math.PI);
        arrow.scale.set(1, type === "branch" ? 0.72 : 0.9, 1);
        group.add(arrow);
      });

      scene.add(group);
      obstacleTelegraphs.push({ group, targetZ: z, type, materials: [ringMat, arrowMat], baseOpacity: type === "crate" ? 0.38 : 0.3 });
      return group;
    }

    function createCueGroup(localX, z, distance = CUE_PREVIEW_DISTANCE) {
      const cueZ = z + distance;
      const pos = worldPosition(localX, cueZ);
      const group = new THREE.Group();
      group.position.set(pos.x, 0, pos.z);
      group.rotation.y = trackAngle(cueZ);
      scene.add(group);
      return group;
    }

    function addLeafShadowCue(branch) {
      const cue = createCueGroup(branch.localX, branch.z, 4.6);
      [-0.78, -0.24, 0.34, 0.86].forEach((xOffset, index) => {
        const leaf = new THREE.Mesh(sharedGeometries.cueLeaf, cueLeafShadowMat);
        leaf.position.set(xOffset, 0.13 + index * 0.002, (index - 1.5) * 0.34);
        leaf.scale.set(0.54 + index * 0.08, 0.025, 0.28 + (index % 2) * 0.08);
        leaf.rotation.y = 0.45 + index * 0.8;
        leaf.receiveShadow = true;
        cue.add(leaf);
      });
    }

    function addMudSkidCue(log) {
      const cue = createCueGroup(log.localX, log.z, 5.2);
      [-0.48, 0.48].forEach((xOffset, index) => {
        const skid = new THREE.Mesh(sharedGeometries.unitBox, cueMudMat);
        skid.position.set(xOffset, 0.125, index === 0 ? 0.18 : -0.18);
        skid.scale.set(0.22, 0.035, 1.72);
        skid.rotation.y = index === 0 ? 0.12 : -0.12;
        skid.receiveShadow = true;
        cue.add(skid);
      });
      const smear = new THREE.Mesh(sharedGeometries.unitBox, cueMudMat);
      smear.position.set(0, 0.12, -0.08);
      smear.scale.set(1.45, 0.026, 0.42);
      smear.rotation.y = -0.08;
      smear.receiveShadow = true;
      cue.add(smear);
    }

    function addCratePlankCue(crate) {
      const cue = createCueGroup(crate.localX, crate.z, 4.9);
      [-0.58, 0, 0.58].forEach((xOffset, index) => {
        const plank = new THREE.Mesh(sharedGeometries.unitBox, cueCratePlankMat);
        plank.position.set(xOffset, 0.18 + index * 0.015, (index - 1) * 0.28);
        plank.scale.set(0.82, 0.08, 0.22);
        plank.rotation.y = [-0.55, 0.18, 0.62][index];
        plank.castShadow = true;
        plank.receiveShadow = true;
        cue.add(plank);
      });
    }

    function addRippleCue(river) {
      const cue = createCueGroup(0, river.z, 6.4);
      [1.15, 1.85, 2.55].forEach((radius, index) => {
        const ripple = new THREE.Mesh(sharedGeometries.cueRipple, cueRippleMat);
        ripple.position.set(0, 0.15 + index * 0.003, (index - 1) * 0.24);
        ripple.scale.set(radius * 1.7, radius * 0.48, 1);
        ripple.rotation.x = Math.PI / 2;
        ripple.receiveShadow = true;
        cue.add(ripple);
      });
    }

    function addMonkeyEyeCue(enemy) {
      const cue = createCueGroup(enemy.baseLocalX, enemy.z, 5.4);
      [-0.24, 0.24].forEach((xOffset) => {
        const glint = new THREE.Mesh(sharedGeometries.cueGlint, cueEyeMat);
        glint.position.set(xOffset, 0.72, 0);
        glint.scale.set(1.0, 0.55, 0.55);
        cue.add(glint);
      });
      const glow = new THREE.PointLight("#ff1600", 0.75, 4);
      glow.position.set(0, 0.72, 0.1);
      cue.add(glow);
    }

    LEVEL.rivers.forEach((river) => {
      addRippleCue(river);
      registerObstacleTelegraph({ localX: 0, z: river.z, type: "river", distance: 11, width: river.width });
    });

    LEVEL.logs.forEach((log) => {
      addMudSkidCue(log);
      registerObstacleTelegraph({ localX: log.localX, z: log.z, type: "log", distance: 8.8, width: log.width });
      const posOnPath = worldPosition(log.localX, log.z);
      const mesh = new THREE.Mesh(sharedGeometries.unitBox, logMat);
      mesh.position.set(posOnPath.x, log.height / 2, posOnPath.z);
      mesh.scale.set(log.width, log.height, log.depth);
      mesh.rotation.y = trackAngle(log.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
      colliders.push({ type: "log", active: true, mesh, x: posOnPath.x, y: log.height / 2, z: posOnPath.z, w: log.width, h: log.height, d: log.depth });
    });

    LEVEL.crates.forEach((crate) => {
      addCratePlankCue(crate);
      registerObstacleTelegraph({ localX: crate.localX, z: crate.z, type: "crate", distance: 8.4, width: crate.width });
      const posOnPath = worldPosition(crate.localX, crate.z);
      const group = new THREE.Group();
      group.position.set(posOnPath.x, crate.height / 2, posOnPath.z);
      const box = new THREE.Mesh(sharedGeometries.unitBox, crateMat);
      box.scale.set(crate.width, crate.height, crate.depth);
      const bandH = new THREE.Mesh(sharedGeometries.unitBox, crateBandMat);
      bandH.scale.set(crate.width + 0.08, 0.18, crate.depth + 0.08);
      const bandV = new THREE.Mesh(sharedGeometries.unitBox, crateBandMat);
      bandV.scale.set(0.2, crate.height + 0.08, crate.depth + 0.08);
      box.castShadow = true; box.receiveShadow = true;
      group.add(box, bandH, bandV);
      scene.add(group);
      colliders.push({ type: "crate", active: true, mesh: group, x: posOnPath.x, y: crate.height / 2, z: posOnPath.z, w: crate.width, h: crate.height, d: crate.depth });
    });

    LEVEL.branches.forEach((branch) => {
      addLeafShadowCue(branch);
      registerObstacleTelegraph({ localX: branch.localX, z: branch.z, type: "branch", distance: 7.8, width: branch.width });
      const posOnPath = worldPosition(branch.localX, branch.z);
      const group = new THREE.Group();
      group.position.set(posOnPath.x, branch.yOffset, posOnPath.z);
      group.rotation.y = trackAngle(branch.z);
      const limb = new THREE.Mesh(sharedGeometries.unitBox, branchLimbMat);
      limb.scale.set(branch.width, branch.height, branch.depth);
      const leaves = new THREE.Mesh(sharedGeometries.unitBox, branchLeafMat);
      leaves.scale.set(branch.width + 0.4, 1.35, 1.8);
      leaves.position.y = 0.98;
      limb.castShadow = true; leaves.castShadow = true;
      group.add(limb, leaves);
      scene.add(group);
      colliders.push({ type: "branch", active: true, mesh: group, x: posOnPath.x, y: branch.yOffset, z: posOnPath.z, w: branch.width, h: branch.height, d: branch.depth });
    });

    const gate = new THREE.Group();

    // Patrol monkey enemies — rounded jungle monkeys with dangerous red eyes
    const monkeyBodyMat = makeMaterial("#2a1f0e", { roughness: 0.62, metalness: 0.05 });
    const monkeyFaceMat = makeMaterial("#8a5a2a", { roughness: 0.72 });
    const monkeyEarMat = makeMaterial("#c77a3d", { roughness: 0.7 });
    const monkeyBananaMat = makeMaterial("#ffd84d", { roughness: 0.48, emissive: "#5a3900", emissiveIntensity: 0.28 });
    const monkeyLeafMat = makeMaterial("#4ade80", { roughness: 0.64, emissive: "#0f3d1f", emissiveIntensity: 0.16 });
    const monkeyEyeMat = new THREE.MeshStandardMaterial({ color: "#ff2200", emissive: "#ff2200", emissiveIntensity: 2.5 });

    function addMonkeyTail(group) {
      [
        [-0.58, 0.08, 0.42, 0.2, 0.15],
        [-0.78, 0.32, 0.44, -0.34, -0.08],
        [-0.67, 0.58, 0.42, -0.95, -0.22],
        [-0.39, 0.66, 0.35, -1.4, -0.18],
      ].forEach(([x, y, length, rotZ, rotX]) => {
        const segment = new THREE.Mesh(sharedGeometries.monkeyTailSegment, monkeyBodyMat);
        segment.position.set(x, y, 0.5);
        segment.scale.set(1, length / 0.44, 1);
        segment.rotation.set(rotX, 0.12, rotZ);
        segment.castShadow = true;
        group.add(segment);
      });

      const leaf = new THREE.Mesh(sharedGeometries.cueLeaf, monkeyLeafMat);
      leaf.position.set(-0.22, 0.72, 0.53);
      leaf.scale.set(0.2, 0.08, 0.32);
      leaf.rotation.set(0.45, 0.15, -0.85);
      leaf.castShadow = true;
      group.add(leaf);
    }

    function addBananaBadge(group) {
      [-0.16, 0.16].forEach((xOffset, index) => {
        const bananaArc = new THREE.Mesh(sharedGeometries.unitBox, monkeyBananaMat);
        bananaArc.position.set(xOffset, 0.18 + index * 0.03, -0.68);
        bananaArc.scale.set(0.1, 0.32, 0.06);
        bananaArc.rotation.z = xOffset < 0 ? -0.55 : 0.55;
        bananaArc.rotation.x = 0.08;
        bananaArc.castShadow = true;
        group.add(bananaArc);
      });
    }

    function addMonkeyArms(group) {
      [-1, 1].forEach((side) => {
        const arm = new THREE.Mesh(sharedGeometries.monkeyTailSegment, monkeyBodyMat);
        arm.position.set(side * 0.72, 0.24, -0.06);
        arm.scale.set(1.28, 1.7, 1.28);
        arm.rotation.set(0.28, 0, side * 0.72);
        arm.castShadow = true;
        const fist = new THREE.Mesh(sharedGeometries.monkeyEar, monkeyFaceMat);
        fist.position.set(side * 1.02, -0.08, -0.16);
        fist.scale.set(0.9, 0.72, 0.82);
        fist.castShadow = true;
        group.add(arm, fist);
      });
    }

    LEVEL.enemies.forEach((en) => {
      addMonkeyEyeCue(en);
      const group = new THREE.Group();
      const posOnPath = worldPosition(en.baseLocalX, en.z);
      group.position.set(posOnPath.x, 0.9, posOnPath.z);

      const body = new THREE.Mesh(sharedGeometries.monkeyBody, monkeyBodyMat);
      body.position.set(0, -0.08, 0.03);
      body.scale.set(0.98, 1.08, 0.9);
      body.castShadow = true;
      body.receiveShadow = true;

      const head = new THREE.Mesh(sharedGeometries.monkeyHead, monkeyBodyMat);
      head.position.set(0, 0.72, -0.18);
      head.scale.set(1.05, 0.95, 0.95);
      head.castShadow = true;

      const muzzle = new THREE.Mesh(sharedGeometries.monkeyMuzzle, monkeyFaceMat);
      muzzle.position.set(0, 0.6, -0.62);
      muzzle.scale.set(1.45, 0.78, 0.72);
      muzzle.castShadow = true;

      [-0.46, 0.46].forEach((xOffset) => {
        const ear = new THREE.Mesh(sharedGeometries.monkeyEar, monkeyEarMat);
        ear.position.set(xOffset, 0.76, -0.16);
        ear.scale.set(0.82, 1.1, 0.68);
        ear.castShadow = true;
        group.add(ear);
      });

      [-0.18, 0.18].forEach((xOffset) => {
        const eyeGlow = new THREE.Mesh(sharedGeometries.monkeyEye, monkeyEyeMat);
        eyeGlow.position.set(xOffset, 0.83, -0.63);
        group.add(eyeGlow);
      });

      const eyeLight = new THREE.PointLight("#ff2200", 1.25, 5);
      eyeLight.position.set(0, 0.82, -0.7);

      // Small brow spikes keep the patrol enemies visibly threatening.
      for (let s = 0; s < 3; s++) {
        const spike = new THREE.Mesh(sharedGeometries.monkeySpike, monkeyBodyMat);
        spike.position.set((s - 1) * 0.24, 1.18, -0.2);
        spike.rotation.z = (s - 1) * 0.22;
        spike.castShadow = true;
        group.add(spike);
      }

      addMonkeyTail(group);
      addMonkeyArms(group);
      addBananaBadge(group);
      group.add(body, head, muzzle, eyeLight);
      scene.add(group);
      enemies.push({ mesh: group, active: true, baseLocalX: en.baseLocalX, z: posOnPath.z, x: posOnPath.x, patrolRange: en.patrolRange, patrolSpeed: en.patrolSpeed, w: 1.5, h: 1.5, d: 1.5 });
    });

    // Golden pineapple collectibles — torus knot shape, orange glow
    const pineappleMat = new THREE.MeshStandardMaterial({ color: "#f5a623", emissive: "#f5a623", emissiveIntensity: 1.2, metalness: 0.8, roughness: 0.12 });
    LEVEL.collectibles.forEach((col) => {
      const posOnPath = worldPosition(col.localX, col.z);
      const group = new THREE.Group();
      group.position.set(posOnPath.x, col.y, posOnPath.z);
      const knot = new THREE.Mesh(sharedGeometries.pineapple, pineappleMat);
      knot.castShadow = true;
      const glow = createLimitedPickupLight("#f5a623", 2.2, 7);
      group.add(knot);
      if (glow) group.add(glow);
      scene.add(group);
      collectibleMeshes.push({ mesh: group, knot, active: true, x: posOnPath.x, y: col.y, z: posOnPath.z, radius: PICKUPS.pineappleRadius });
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
    const gateGlowCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 16, 10),
      new THREE.MeshBasicMaterial({ color: "#ffbf4a", transparent: true, opacity: 0.72, depthWrite: false }),
    );
    gateGlowCore.position.copy(gateGlow.position);
    gate.add(pillarL, pillarR, lintel, gateGlow, gateGlowCore);
    scene.add(gate);
    colliders.push({ type: "gate", active: true, mesh: gate, x: trackCenter(LEVEL.gate.z), y: 3, z: LEVEL.gate.z, w: CONFIG.corridorHalfWidth * 2 + 6, h: 6, d: CONFIG.finishTriggerDepth });

    const player = new THREE.Group();
    scene.add(player);
    const pink = makeMaterial("#ff69c2", { roughness: 0.54, emissive: "#4a0628", emissiveIntensity: 0.09 });
    const bellyPink = makeMaterial("#d94a9a", { roughness: 0.76, emissive: "#250316", emissiveIntensity: 0.045 });
    const legPink = makeMaterial("#c83f8e", { roughness: 0.78, emissive: "#220313", emissiveIntensity: 0.04 });
    const innerEar = makeMaterial("#ff9fdb", { roughness: 0.78 });
    const innerEarGlow = makeMaterial("#ffd1f0", { roughness: 0.68, emissive: "#2f061d", emissiveIntensity: 0.035 });
    const dark = new THREE.MeshBasicMaterial({ color: "#111111" });

    const bodyGeo = new THREE.DodecahedronGeometry(1, 1);
    bodyGeo.scale(1.12, 1.04, 1.42);
    const bodyMesh = new THREE.Mesh(bodyGeo, pink);
    bodyMesh.position.y = 1.08; bodyMesh.castShadow = true;
    const bellyGeo = new THREE.SphereGeometry(0.74, 10, 8);
    bellyGeo.scale(1.18, 0.62, 0.76);
    const belly = new THREE.Mesh(bellyGeo, bellyPink);
    belly.position.set(0, -0.2, -0.6);
    belly.castShadow = true;
    bodyMesh.add(belly);
    player.add(bodyMesh);

    [-1, 1].forEach((side) => {
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 8), pink);
      shoulder.position.set(side * 1.05, 1.12, -0.92);
      shoulder.scale.set(0.74, 1.02, 0.82);
      shoulder.castShadow = true;
      const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.78, 12, 8), bellyPink);
      haunch.position.set(side * 1.02, 1.02, 1.05);
      haunch.scale.set(0.82, 0.95, 0.9);
      haunch.castShadow = true;
      player.add(shoulder, haunch);
    });

    const legGeo = new THREE.CapsuleGeometry(0.24, 0.52, 3, 8);
    const legAnchors = [
      [-0.86, 0.38, -0.86, 0],
      [0.86, 0.38, -0.86, Math.PI],
      [-0.86, 0.38, 1.04, Math.PI],
      [0.86, 0.38, 1.04, 0],
    ];
    const legs = legAnchors.map(([x, y, z, phase]) => {
      const leg = new THREE.Mesh(legGeo, legPink);
      leg.position.set(x, y, z);
      leg.castShadow = true;
      player.add(leg);
      return { mesh: leg, baseX: x, baseY: y, baseZ: z, phase };
    });

    const tail = new THREE.Group();
    tail.position.set(0, 1.28, 1.54);
    const tailMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.56, 3, 7), pink);
    tailMesh.position.z = 0.32;
    tailMesh.rotation.x = Math.PI / 2;
    tailMesh.castShadow = true;
    const tailTip = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), innerEarGlow);
    tailTip.position.z = 0.72;
    tailTip.castShadow = true;
    tail.add(tailMesh, tailTip);
    player.add(tail);

    const head = new THREE.Group();
    head.position.set(0, 1.88, -1.65);
    player.add(head);
    const headGeo = new THREE.SphereGeometry(0.82, 12, 9);
    headGeo.scale(0.95, 0.9, 0.9);
    const headMesh = new THREE.Mesh(headGeo, pink);
    headMesh.castShadow = true;
    head.add(headMesh);

    const earGeo = new THREE.SphereGeometry(0.72, 12, 8);
    earGeo.scale(0.92, 1.16, 0.16);
    const innerEarGeo = new THREE.SphereGeometry(0.52, 10, 7);
    innerEarGeo.scale(0.84, 1.08, 0.11);
    const innerEarGlowGeo = new THREE.SphereGeometry(0.34, 8, 6);
    innerEarGlowGeo.scale(0.76, 0.98, 0.08);
    const earL = new THREE.Mesh(earGeo, pink);
    const earR = new THREE.Mesh(earGeo, pink);
    earL.position.set(-1.08, -0.02, 0.12); earR.position.set(1.08, -0.02, 0.12);
    earL.rotation.y = -0.34; earR.rotation.y = 0.34;
    earL.castShadow = true; earR.castShadow = true;
    const inL = new THREE.Group();
    const inR = new THREE.Group();
    const innerL = new THREE.Mesh(innerEarGeo, innerEar);
    const innerR = innerL.clone();
    innerL.position.z = -0.035; innerR.position.z = -0.035;
    const innerGlowL = new THREE.Mesh(innerEarGlowGeo, innerEarGlow);
    const innerGlowR = innerGlowL.clone();
    innerGlowL.position.set(0, 0.1, -0.06); innerGlowR.position.copy(innerGlowL.position);
    inL.add(innerL, innerGlowL); inR.add(innerR, innerGlowR);
    inL.position.copy(earL.position); inR.position.copy(earR.position);
    inL.rotation.y = earL.rotation.y; inR.rotation.y = earR.rotation.y;
    head.add(earL, earR, inL, inR);

    const trunk = new THREE.Group();
    trunk.position.set(0, -0.12, -0.74);
    const trunkSegments = [
      { y: -0.24, z: -0.08, length: 0.5, top: 0.3, bottom: 0.27, rx: -0.1 },
      { y: -0.68, z: -0.18, length: 0.52, top: 0.27, bottom: 0.23, rx: -0.24 },
      { y: -1.08, z: -0.35, length: 0.48, top: 0.23, bottom: 0.19, rx: -0.38 },
      { y: -1.4, z: -0.58, length: 0.42, top: 0.19, bottom: 0.16, rx: -0.58 },
    ];
    trunkSegments.forEach(({ y, z, length, top, bottom, rx }, index) => {
      const segment = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, length, 8, 1), index < 2 ? pink : bellyPink);
      segment.position.set(0, y, z);
      segment.rotation.x = rx;
      segment.castShadow = true;
      trunk.add(segment);
    });
    const trunkHighlight = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), innerEarGlow);
    trunkHighlight.position.set(0, -1.6, -0.7);
    trunkHighlight.scale.set(1.25, 0.7, 0.82);
    trunkHighlight.castShadow = true;
    trunk.add(trunkHighlight);
    head.add(trunk);

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), dark);
    eyeL.position.set(-0.38, 0.23, -0.76);
    eyeL.scale.set(0.82, 1.08, 0.7);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.38;
    head.add(eyeL, eyeR);

    const tuskGeo = new THREE.CylinderGeometry(0.055, 0.11, 0.78, 5);
    const tuskL = new THREE.Mesh(tuskGeo, innerEar);
    const tuskR = tuskL.clone();
    tuskL.position.set(-0.34, -0.42, -0.82);
    tuskR.position.set(0.34, -0.42, -0.82);
    tuskL.rotation.x = tuskR.rotation.x = Math.PI / 2;
    tuskL.rotation.z = 0.18; tuskR.rotation.z = -0.18;
    tuskL.castShadow = true; tuskR.castShadow = true;
    head.add(tuskL, tuskR);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.68, 32), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.38, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    scene.add(shadow);

    const body = createPlayerBody();

    function snapshotResults(overrides = {}) {
      const elapsedMs = gameStartTimeRef.current ? performance.now() - gameStartTimeRef.current : 0;
      const z = overrides.z ?? body.z;
      return {
        fruit: body.fruit,
        fruitLifeCounter: body.fruitLifeCounter,
        crates: body.crates,
        score: body.score,
        lives: body.lives,
        elapsedMs,
        distance: Math.abs(Math.min(0, z)),
      };
    }

    function resetTransientEffects() {
      particles.splice(0).forEach((particle) => {
        particle.active = false;
        particle.life = 0;
        particle.mesh.visible = false;
      });
      particlePool.forEach((particle) => {
        particle.active = false;
        particle.life = 0;
        particle.mesh.visible = false;
      });
      pops.splice(0).forEach((pop) => {
        pop.active = false;
        pop.life = 0;
        pop.sprite.visible = false;
        pop.sprite.material.opacity = 0;
      });
      popPools.forEach((pool) => {
        pool.forEach((pop) => {
          pop.active = false;
          pop.life = 0;
          pop.sprite.visible = false;
          pop.sprite.material.opacity = 0;
        });
      });
    }

    function resetSceneEntities() {
      pickups.forEach((item) => {
        item.active = true;
        item.mesh.visible = true;
      });
      collectibleMeshes.forEach((item) => {
        item.active = true;
        item.mesh.visible = true;
      });
      enemies.forEach((enemy) => {
        enemy.active = true;
        enemy.mesh.visible = true;
      });
      colliders.forEach((obs) => {
        obs.active = true;
        obs.mesh.visible = true;
      });
      obstacleTelegraphs.forEach((telegraph) => {
        telegraph.group.visible = false;
        telegraph.materials.forEach((material) => { material.opacity = 0; });
      });
      crocs.forEach((croc) => {
        croc.active = true;
        croc.mesh.visible = true;
      });
    }

    function resetGame({ start = false } = {}) {
      Object.assign(body, createPlayerBody());
      keyRef.current = createKeys();
      resetTransientEffects();
      resetSceneEntities();
      hudRefresh.values.clear();
      hudRefresh.lastSpeedometerCharge = null;
      hudRefresh.nextLowAt = 0;
      audioManagerRef.current?.resetGameplayMusic();
      stampedeRef.current.nextStepTime = 0;
      resetCameraShake();
      startedRef.current = start;
      completeRef.current = false;
      gameOverRef.current = false;
      pausedRef.current = false;
      pauseStartedAtRef.current = null;
      gameStartTimeRef.current = start ? performance.now() : null;
      setFinalResults(null);
      setInitials("");
      setStarted(start);
      setComplete(false);
      setGameOver(false);
      setPaused(false);
    }

    resetGameRef.current = resetGame;

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

    function burst(x, y, z, colour, count = PARTICLES.defaultBurstCount, scale = 0.28) {
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


    function loseLife() {
      body.lives = Math.max(0, body.lives - 1);
      body.health = 100;
      body.hurtTimer = 1.35;
      body.speed = 0;
      body.localX = 0;
      body.x = trackCenter(body.z);
      body.yVelocity = 0;
      body.grounded = true;
      body.slideTimer = 0;
      popText(body.lives > 0 ? "HERD LIFE LOST" : "HERD NEEDS REST", body.x, body.y + 3.4, body.z, "#ff9aa9");
      if (body.lives > 0) {
        burst(body.x, body.y + 1.1, body.z, "#b7ffb7", 12, 0.2);
        popText("RECOVERING!", body.x, body.y + 4.6, body.z, "#b7ffb7");
      }
      playTone("hurt");
      if (body.lives <= 0 && !gameOverRef.current) {
        gameOverRef.current = true;
        const results = snapshotResults();
        setFinalResults(results);
        setPausedState(false);
        setInitials("");
        setGameOver(true);
      }
    }

    function hurt(croc = false) {
      if (body.hurtTimer > 0 || body.completed || body.lives <= 0) return;
      body.health = Math.max(0, body.health - (croc ? 34 : 22));
      body.hurtTimer = 0.45;
      body.speed = Math.max(0, body.speed * 0.15);
      burst(body.x, body.y + 1.1, body.z, croc ? "#53a653" : "#ff3f58", PARTICLES.defaultBurstCount, PARTICLES.hurtBurstScale);
      popText(croc ? "SNAP!" : "OOPS!", body.x, body.y + 3.2, body.z, croc ? "#9aff99" : "#ff8794");
      playTone(croc ? "croc" : "hurt");
      if (body.health <= 0) loseLife();
    }

    function completeLevel(popZ = body.z) {
      if (completeRef.current) return;
      const results = snapshotResults({ z: popZ });
      body.completed = true;
      completeRef.current = true;
      setPausedState(false);
      body.speed = 0;
      popText("JUNGLE GATE!", body.x, body.y + 3, popZ - 2, "#fff1a6");
      playTone("gate");
      setFinalResults(results);
      setInitials("");
      setComplete(true);
    }

    function breakCrate(obs) {
      obs.active = false;
      obs.mesh.visible = false;
      body.crates += 1;
      body.smashTimer = MOVEMENT.smashActionDuration;
      const pts = collectScore(SCORING.cratePoints, SCORING.crateComboWindowSeconds);
      const nextMultiplierPreview = Math.min(SCORING.maxMultiplier, body.multiplier);
      burst(obs.x, obs.y, obs.z, "#99652f", PARTICLES.crateWoodCount, PARTICLES.hurtBurstScale);
      burst(obs.x, obs.y + 0.8, obs.z, "#ffd34a", PARTICLES.crateSparkleCount, 0.22);
      popText(`CRATE BONUS +${pts}`, obs.x, obs.y + 2.2, obs.z, "#ffe08a");
      if (nextMultiplierPreview > 1) popText(`${nextMultiplierPreview}x STREAK`, obs.x, obs.y + 3.35, obs.z, "#ffcf66");
      playTone("crateSmash");
    }

    function collectScore(basePoints, comboWindowSeconds = SCORING.comboWindowSeconds) {
      const scored = basePoints * body.multiplier;
      body.score += scored;
      body.multiplierCombo += 1;
      body.multiplierTimer = Math.max(body.multiplierTimer, comboWindowSeconds);
      body.multiplier = Math.min(SCORING.maxMultiplier, 1 + Math.floor(body.multiplierCombo / SCORING.comboPerMultiplier));
      return scored;
    }

    function addFruitLife(amount) {
      const { counter, livesAwarded } = applyFruitLifeCounter(body.fruitLifeCounter, amount);
      body.fruitLifeCounter = counter;
      if (livesAwarded <= 0) return;
      body.lives += livesAwarded;
      for (let i = 0; i < livesAwarded; i++) {
        popText("BONUS ELEPHANT!", body.x, body.y + 3.4, body.z, "#b7ffb7");
        playTone("bonusLife");
      }
    }

    function resize() {
      if (!mount || disposed) return;
      const nextPixelRatio = rendererPixelRatio();
      renderer.setPixelRatio(nextPixelRatio);
      renderer.setSize(mount.clientWidth, Math.max(1, mount.clientHeight));
      postProcessing?.resize(mount.clientWidth, Math.max(1, mount.clientHeight), nextPixelRatio);
      camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
      camera.updateProjectionMatrix();
    }

    function keyDown(e) {
      if (!isAllowedKey(e.code)) return;
      e.preventDefault();
      const wasPressed = Boolean(keyRef.current.__pressed[e.code]);
      if (e.code === "Backquote" && !wasPressed) {
        debugRef.current = !debugRef.current;
        setDebug(debugRef.current);
      }
      if (e.code === "KeyM") {
        if (!e.repeat && !wasPressed) toggleAudioState("muted");
        return;
      }
      if (e.code === "Escape" || e.code === "KeyP") {
        if (!e.repeat && !wasPressed) {
          if (startedRef.current && !completeRef.current && !gameOverRef.current) setPausedState(!pausedRef.current);
          else keyRef.current = createKeys();
        }
        return;
      }
      if (!pausedRef.current) setKeyState(keyRef.current, e.code, true);
    }

    function keyUp(e) {
      if (!isAllowedKey(e.code)) return;
      e.preventDefault();
      setKeyState(keyRef.current, e.code, false);
    }

    function blur() {
      keyRef.current = createKeys();
      if (startedRef.current && !completeRef.current && !gameOverRef.current) setPausedState(true);
    }

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
      const isPlaying = startedRef.current && !completeRef.current && !gameOverRef.current && !pausedRef.current;
      audioManagerRef.current?.updateGameplayMusic({ charge, isPlaying });
      if (!isPlaying) return;
      const audioTime = audioManagerRef.current?.getCurrentTime() ?? 0;
      if (!audioTime) return;
      if (charge > 0.58 && body.grounded && body.speed > 6) {
        const intensity = clamp((charge - 0.58) / 0.42, 0, 1);
        const interval = lerp(0.34, 0.13, intensity);
        if (audioTime >= stampedeRef.current.nextStepTime) {
          stampedeRef.current.nextStepTime = audioTime + interval;
          playTone("thump");
          if (intensity > 0.5) burst(body.x, 0.18, body.z + 0.8, "#d6c399", 2, 0.22);
        }
      }
    }

    const playerAabb = {};
    const currentAabb = {};
    const obstacleAabb = {};
    const contactAabb = {};
    const smashAabb = {};
    const radiusAabb = {};
    const enemyAabb = {};

    function updatePhysics(dt) {
      const k = keyRef.current;
      const playing = startedRef.current && !completeRef.current && !gameOverRef.current && !pausedRef.current && body.lives > 0;
      const charge = clamp(body.speed / MOVEMENT.maxSpeed, 0, 1);
      const wasGrounded = body.grounded;

      tickPlayerTimers(body, dt);

      const intent = getPlayerInputIntent(body, k, playing);
      updatePlayerSpeed(body, dt, playing, intent);

      let ny = body.y;
      let nz = body.z - body.speed * dt;
      let nextLocalX = updatePlayerSteering(body, k, dt, playing, nz);
      let nx = worldX(nextLocalX, nz);

      function playJumpEvent(event) {
        if (event === "ground") {
          burst(body.x, 0.2, body.z, "#d6c399", 5, 0.2);
          playTone("jump");
        } else if (event === "double") {
          burst(body.x, body.y + 0.6, body.z, "#ff89d2", 8, 0.2);
          popText("BIG Bounce!", body.x, body.y + 2.8, body.z, "#ffc3ed");
          playTone("double");
        }
      }

      function playSlideEvent() {
        burst(body.x, 0.2, body.z, "#d6c399", 6, 0.2);
        playTone("slideStart");
      }

      if (k.KeyZ && triggerPlayerSmash(body, playing)) {
        trunk.rotation.x = -0.85;
      }

      // Spin attack — E key, 0.55s duration, defeats patrol monkeys
      if (k.KeyE && triggerPlayerSpin(body, playing)) {
        burst(body.x, body.y + 0.8, body.z, "#ff89d2", 12, 0.22);
        burst(body.x, body.y + 0.8, body.z, "#ffd34a", 6, 0.18);
        popText("SPIN ATTACK!", body.x, body.y + 2.8, body.z, "#ffcf66");
        playTone("double");
      }

      for (const event of updateJumpAndSlideInput(body, k, dt, playing)) {
        if (event === "slide") playSlideEvent();
        else playJumpEvent(event);
      }
      const airUpdate = updatePlayerAir(body, ny, dt);
      ny = airUpdate.y;
      if (airUpdate.landed) {
        burst(nx, 0.18, nz, "#d6c399", 8, 0.22);
        playTone("land");
      }
      if (airUpdate.bufferedJump) {
        body.x = nx; body.z = nz;
        playJumpEvent("ground");
        ny = body.y;
      }

      const pBox = playerBox(nx, ny, nz, body.slideTimer > 0, playerAabb);
      const currentBox = playerBox(body.x, body.y, body.z, body.slideTimer > 0, currentAabb);
      const isReversing = playing && body.speed < 0 && nz > body.z;
      let blocked = false;

      if (body.smashActionTimer > 0) {
        smashBox(nx, ny, nz, smashAabb);
        for (const obs of colliders) {
          if (!obs.active || obs.type !== "crate") continue;
          if (aabb(smashAabb, obstacleBox(obs, obstacleAabb))) breakCrate(obs);
        }
      }

      activeObstacles.length = 0;
      for (let i = 0; i < colliders.length; i += 1) activeObstacles.push(colliders[i]);
      for (let i = 0; i < crocs.length; i += 1) activeObstacles.push(crocs[i]);
      for (const obs of activeObstacles) {
        if (!obs.active) continue;
        const oBox = obstacleBox(obs, obstacleAabb);
        let collisionBox = aabb(pBox, oBox) ? pBox : null;
        if (!collisionBox && (obs.type === "log" || obs.type === "branch" || obs.type === "crate" || obs.type === "croc")) {
          collisionBox = sweptObstaclePlayerBox({
            obstacleAabb: oBox,
            currentBox,
            nextBox: pBox,
            body,
            nextLocalX,
            nextY: ny,
            nextZ: nz,
            contactBox: contactAabb,
          });
        }
        if (!collisionBox) continue;
        const canRetreat = canRetreatFromObstacle(currentBox, collisionBox, oBox, isReversing);
        if (obs.type === "log") {
          const result = handleLogCollision({ collisionBox, obstacleAabb: oBox, canRetreat });
          if (result.hurt) hurt(false);
          blocked ||= result.blocked;
        } else if (obs.type === "branch") {
          const result = handleBranchCollision({ collisionBox, obstacleAabb: oBox, canRetreat });
          if (result.hurt) hurt(false);
          blocked ||= result.blocked;
        } else if (obs.type === "croc") {
          const result = handleCrocCollision({ canRetreat });
          if (result.hurt) hurt(true);
          blocked ||= result.blocked;
        } else if (obs.type === "crate") {
          const result = handleCrateCollision({ charge, smashActionActive: body.smashActionTimer > 0, canRetreat });
          if (result.breakCrate) breakCrate(obs);
          else if (result.hurt) hurt(false);
          blocked ||= result.blocked;
        }
      }

      for (const item of pickups) {
        if (!item.active) continue;
        if (aabb(pBox, radiusBox(item, radiusAabb))) {
          item.active = false;
          item.mesh.visible = false;
          if (item.type === "fruit") {
            body.fruit += 1;
            addFruitLife(PICKUPS.fruitLifeAmount);
            const pts = collectScore(SCORING.fruitPoints);
            burst(item.x, item.y, item.z, "#ffd34a", PARTICLES.fruitCollectCount, 0.2);
            playTone("fruit");
          } else {
            body.health = Math.min(100, body.health + PICKUPS.healthRestore);
            burst(item.x, item.y, item.z, "#4ade80", PARTICLES.healBurstCount, 0.22);
            popText("SUGAR CANE!", item.x, item.y + 1.4, item.z, "#a7ffbf");
            playTone("heal");
          }
        }
      }

      // Patrol monkey collision — spin attack defeats, otherwise hurts
      for (const en of enemies) {
        if (!en.active) continue;
        if (!aabb(pBox, enemyBox(en, enemyAabb))) continue;
        if (body.spinTimer > 0) {
          en.active = false;
          en.mesh.visible = false;
          const pts = collectScore(SCORING.monkeyPoints);
          burst(en.x, en.mesh.position.y + 0.7, en.z, "#ff2200", PARTICLES.monkeyBurstCount, 0.22);
          burst(en.x, en.mesh.position.y + 0.7, en.z, "#ffd34a", PARTICLES.monkeySparkleCount, 0.18);
          popText(`MONKEY DOWN! +${pts}`, en.x, en.mesh.position.y + 2.8, en.z, "#ffcf66");
          playTone("monkeyDefeat");
        } else {
          hurt(false);
        }
      }

      if (handleGateCollision({ playing, complete: completeRef.current, currentZ: body.z, nextZ: nz, finishZ: LEVEL.finish.z, failSafeZ: LEVEL.finish.failSafeZ })) {
        nz = LEVEL.finish.z;
        nx = worldX(nextLocalX, nz);
        body.localX = nextLocalX;
        body.x = nx;
        body.y = ny;
        body.z = nz;
        completeLevel(nz);
        blocked = false;
      }

      // Golden pineapple collectibles — always collectible
      for (const col of collectibleMeshes) {
        if (!col.active) continue;
        if (aabb(pBox, radiusBox(col, radiusAabb))) {
          col.active = false;
          col.mesh.visible = false;
          body.fruit += SCORING.pineappleFruitLifeAmount;
          const pts = collectScore(SCORING.pineapplePoints);
          addFruitLife(SCORING.pineappleFruitLifeAmount);
          burst(col.x, col.y, col.z, "#f5a623", PARTICLES.pineappleBurstCount, 0.28);
          burst(col.x, col.y + 1, col.z, "#fff8e7", PARTICLES.pineappleSparkleCount, 0.18);
          popText(`GOLDEN PINEAPPLE! +${pts}`, col.x, col.y + 2.4, col.z, "#f5a623");
          playTone("gate");
        }
      }

      if (!blocked) {
        body.localX = nextLocalX; body.x = nx; body.y = ny; body.z = nz;
      }
      if (wasGrounded && !body.grounded && body.yVelocity <= 0) body.coyoteTimer = MOVEMENT.coyoteTime;

      body.state = selectPlayerStateLabel(body, charge);

      updateMusicAndStampede(charge);
    }

    function updateMeshes(dt, now) {
      const t = now * 0.001;
      waterRippleTexture.offset.set((t * 0.045) % 1, (t * 0.16) % 1);
      foamStreakTexture.offset.set((t * -0.08) % 1, (t * 0.24) % 1);
      updateCrocs(now);
      const charge = clamp(body.speed / MOVEMENT.maxSpeed, 0, 1);
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
      const legStride = body.grounded && Math.abs(body.speed) > 0.1 && !sliding ? Math.min(1, Math.abs(body.speed) / MOVEMENT.maxSpeed + 0.25) : 0;
      const legCycle = t * (6.5 + Math.abs(body.speed) * 0.72);
      legs.forEach((leg) => {
        const step = Math.sin(legCycle + leg.phase) * legStride;
        const lift = Math.max(0, step) * 0.12;
        leg.mesh.position.set(leg.baseX, leg.baseY + lift - (1 - sy) * 0.12, leg.baseZ + step * 0.12);
        leg.mesh.scale.set(1 - Math.abs(step) * 0.05, 1 + lift * 0.22, 1 + Math.abs(step) * 0.08);
      });
      tail.rotation.x = -0.28 + Math.sin(t * 7 + body.speed * 0.25) * (0.08 + charge * 0.06);
      tail.rotation.y = Math.sin(t * 5.6 + body.speed * 0.2) * (0.12 + charge * 0.08);
      trunk.rotation.x = body.smashActionTimer > 0 ? -0.85 : sliding ? 0.75 : !body.grounded ? (body.yVelocity > 0 ? -0.38 : 0.34) : Math.sin(t * 10 + body.speed * 0.3) * 0.18 + charge * 0.16;
      trunk.rotation.y = body.spinTimer > 0 ? t * 18 : 0;
      earL.rotation.y = -0.34 + Math.sin(t * 8 + body.speed * 0.35) * (0.1 + charge * 0.15);
      earR.rotation.y = 0.34 - Math.sin(t * 8 + body.speed * 0.35) * (0.1 + charge * 0.15);
      inL.rotation.y = earL.rotation.y; inR.rotation.y = earR.rotation.y;
      pink.color.set(hurtState && Math.floor(t * 14) % 2 === 0 ? "#ffffff" : "#ff69c2");

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

      obstacleTelegraphs.forEach((telegraph, index) => {
        const distanceAhead = body.z - telegraph.targetZ;
        const visible = startedRef.current && !completeRef.current && !gameOverRef.current && distanceAhead > 0 && distanceAhead < TELEGRAPH_VISIBLE_DISTANCE;
        telegraph.group.visible = visible;
        if (!visible) return;
        const proximity = 1 - clamp(distanceAhead / TELEGRAPH_VISIBLE_DISTANCE, 0, 1);
        const pulse = 0.72 + Math.sin(t * 7.5 + index * 0.9) * 0.18;
        const opacity = telegraph.baseOpacity * (0.35 + proximity * 0.65) * pulse;
        telegraph.group.position.y = Math.sin(t * 5.5 + index) * 0.035;
        telegraph.materials.forEach((material, materialIndex) => {
          material.opacity = Math.min(materialIndex === 0 ? 0.28 : 0.46, opacity * (materialIndex === 0 ? 0.7 : 1));
        });
      });

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
        p.life -= dt * PARTICLES.decayRate;
        p.vy += MOVEMENT.gravity * PARTICLES.gravityScale * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.mesh.scale.multiplyScalar(1 + dt * PARTICLES.growthRate);
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

    const cameraDesired = new THREE.Vector3();
    const cameraShake = {
      hurt: 0,
      charge: 0,
      phaseX: 0.4,
      phaseY: 1.8,
      lastHurtTimer: 0,
    };

    function resetCameraShake() {
      cameraShake.hurt = 0;
      cameraShake.charge = 0;
      cameraShake.lastHurtTimer = 0;
    }

    function updateCamera(dt) {
      const charge = clamp(body.speed / MOVEMENT.maxSpeed, 0, 1);
      const targetFov = lerp(CAMERA_FEEDBACK.cameraFov, CAMERA_FEEDBACK.highChargeFov, charge);
      if (Math.abs(camera.fov - targetFov) > CAMERA_FEEDBACK.fovSnapEpsilon) {
        camera.fov = lerp(camera.fov, targetFov, CAMERA_FEEDBACK.fovLerp);
        camera.updateProjectionMatrix();
      }
      if (!startedRef.current) {
        const t = performance.now() * 0.00035;
        camera.position.set(trackCenter(-28) + Math.sin(t) * 14, 8.5, 15 + Math.cos(t) * 4);
        camera.lookAt(trackCenter(-28), 1.5, -28);
        return;
      }
      const hurtJustStarted = body.hurtTimer > cameraShake.lastHurtTimer + dt * 0.5;
      if (hurtJustStarted) cameraShake.hurt = CAMERA_FEEDBACK.hurtShake;
      else if (body.hurtTimer > 0) cameraShake.hurt = Math.max(cameraShake.hurt, CAMERA_FEEDBACK.hurtShake * 0.45);
      cameraShake.lastHurtTimer = body.hurtTimer;

      const chargeIntensity = charge > MOVEMENT.mightyChargeThreshold
        ? clamp((charge - MOVEMENT.mightyChargeThreshold) / (1 - MOVEMENT.mightyChargeThreshold), 0, 1)
        : 0;
      cameraShake.charge = lerp(cameraShake.charge, chargeIntensity, 1 - Math.exp(-dt * 6));
      cameraShake.hurt *= Math.exp(-dt * 5.5);
      cameraShake.phaseX += dt * lerp(7.5, 11.5, cameraShake.charge);
      cameraShake.phaseY += dt * lerp(9.5, 13.0, cameraShake.charge);

      const hurtOffsetX = Math.sin(cameraShake.phaseX * 2.15) * cameraShake.hurt;
      const hurtOffsetY = Math.cos(cameraShake.phaseY * 1.85) * cameraShake.hurt * 0.7;
      const chargeAmplitude = CAMERA_FEEDBACK.chargeShake * cameraShake.charge;
      const chargeOffsetX = Math.sin(cameraShake.phaseX) * chargeAmplitude;
      const chargeOffsetY = Math.sin(cameraShake.phaseY) * chargeAmplitude * 0.45;
      const lookZ = body.z - CAMERA_FEEDBACK.lookAheadBase - charge * CAMERA_FEEDBACK.lookAheadChargeBoost;
      const lookAhead = worldPosition(body.localX * CAMERA_FEEDBACK.lookAheadLocalScale, lookZ);
      const cameraX = lerp(body.x, lookAhead.x, CAMERA_FEEDBACK.lookAheadLerp);
      cameraDesired.set(
        cameraX + hurtOffsetX + chargeOffsetX,
        body.y + CAMERA_FEEDBACK.cameraHeight + hurtOffsetY + chargeOffsetY,
        body.z + CAMERA_FEEDBACK.cameraDistance + charge * CAMERA_FEEDBACK.chargeDistanceBoost,
      );
      camera.position.lerp(cameraDesired, CAMERA_FEEDBACK.cameraLerp);
      camera.lookAt(lookAhead.x, body.y + CAMERA_FEEDBACK.lookAtHeightOffset, lookAhead.z);
    }

    function sectionLabel() {
      const d = Math.abs(Math.min(0, body.z));
      if (d < 245) return "Learning Trail";
      if (d < 490) return "Practice Grove";
      if (d < 735) return "Stampede Hollow";
      return "Jungle Gate";
    }

    function promptText() {
      if (!startedRef.current) return "Press Begin the Trail to wake the bright jungle.";
      if (completeRef.current) return "The Jungle Gate is open. Brilliant trumpet work!";
      if (gameOverRef.current) return "The herd needs a breather. Try the trail again from here.";
      return promptForZ(body.z);
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
      ctx.strokeStyle = charge > MOVEMENT.mightyChargeThreshold ? "#ff89d2" : "#ffd34a";
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
      ctx.strokeStyle = charge > MOVEMENT.mightyChargeThreshold ? "#ff89d2" : "#fff8e7";
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
      ctx.fillStyle = charge > MOVEMENT.mightyChargeThreshold ? "#ff89d2" : "#fff8e7";
      ctx.fillText(`${Math.round(charge * 100)}`, cx, cy + r * 0.26);

      ctx.font = `bold ${Math.round(size * 0.075)}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,220,140,0.7)";
      ctx.fillText("CHARGE", cx, cy + r * 0.5);
    }

    const hudRefresh = {
      lowIntervalMs: 1000 / HUD_TIMING.lowFrequencyRefreshFps,
      nextLowAt: 0,
      lastSpeedometerCharge: null,
      values: new Map(),
    };

    function setTextIfChanged(ref, key, value) {
      const node = ref.current;
      if (!node) return;
      const text = String(value);
      if (hudRefresh.values.get(key) === text) return;
      hudRefresh.values.set(key, text);
      node.textContent = text;
    }

    function setStyleIfChanged(ref, key, property, value) {
      const node = ref.current;
      if (!node) return;
      if (hudRefresh.values.get(key) === value) return;
      hudRefresh.values.set(key, value);
      node.style[property] = value;
    }

    function updateHighFrequencyHud(charge) {
      const healthWidth = `${body.health}%`;
      setStyleIfChanged(ui.health, "healthWidth", "width", healthWidth);
      const hue = Math.round((body.health / 100) * 120);
      const healthBackground = `linear-gradient(90deg, hsl(${hue},90%,52%), hsl(${Math.max(0, hue - 20)},95%,42%))`;
      setStyleIfChanged(ui.health, "healthBackground", "background", healthBackground);

      // Keep the visual charge bar on the animation-frame path so acceleration feels immediate.
      const chargeWidth = `${(charge * 100).toFixed(1)}%`;
      setStyleIfChanged(ui.charge, "chargeWidth", "width", chargeWidth);
      const chargeFilter = charge > MOVEMENT.mightyChargeThreshold ? "drop-shadow(0 0 8px #ff89d2)" : "none";
      setStyleIfChanged(ui.charge, "chargeFilter", "filter", chargeFilter);

      const fruitLifeWidth = `${body.fruitLifeCounter}%`;
      setStyleIfChanged(ui.fruitLife, "fruitLifeWidth", "width", fruitLifeWidth);
    }

    function updateLowFrequencyHud(now, charge) {
      const stateColours = {
        "Mighty Charge": "#ff4fb3", Charging: "#ffd34a", Leap: "#7dd8ff",
        "BIG Bounce": "#c4b5fd", "Belly-Slide": "#6ee7b7", "Trunk-Smash": "#fb923c",
        "Spin Attack": "#ffcf66", "Jungle Bump": "#f87171", "Herd Resting": "#94a3b8",
        "Jungle Gate": "#ffd34a", Ready: "rgba(255,255,255,0.45)",
      };

      setTextIfChanged(ui.lives, "lives", "🐘".repeat(Math.max(0, body.lives)));
      setTextIfChanged(ui.chargeText, "chargeText", `${Math.round(charge * 100)}%`);

      const stateColour = stateColours[body.state] || "#fff";
      setTextIfChanged(ui.stateBadge, "stateBadge", body.state);
      setStyleIfChanged(ui.stateBadge, "stateBadgeColor", "color", stateColour);
      setStyleIfChanged(ui.stateBadge, "stateBadgeBorder", "borderColor", `${stateColour}55`);

      const showMultiplier = body.multiplier > 1;
      setTextIfChanged(ui.multiplierBadge, "multiplierBadge", `${body.multiplier}x COMBO`);
      setStyleIfChanged(ui.multiplierBadge, "multiplierOpacity", "opacity", showMultiplier ? "1" : "0");
      setStyleIfChanged(ui.multiplierBadge, "multiplierTransform", "transform", showMultiplier ? "scale(1)" : "scale(0.85)");
      setStyleIfChanged(
        ui.multiplierBadge,
        "multiplierColor",
        "color",
        body.multiplier >= 4 ? "#ff4fb3" : body.multiplier >= 3 ? "#fb923c" : "#ffd34a",
      );

      const momentumText = charge > 0.85
        ? "STAMPEDE — HOLD YOUR GROUND"
        : charge > 0.5
        ? "BUILDING MOMENTUM"
        : charge > 0.1
        ? "WARMING UP"
        : "READY TO CHARGE";
      setTextIfChanged(ui.momentumLabel, "momentumLabel", momentumText);
      setStyleIfChanged(ui.momentumLabel, "momentumColor", "color", charge > 0.85 ? "#ff89d2" : charge > 0.5 ? "#ffd34a" : "rgba(255,255,255,0.4)");

      setTextIfChanged(ui.scoreTally, "scoreTally", body.score);

      const roundedCharge = Math.round(charge * 100);
      const wasSpeedometerGlowing = hudRefresh.lastSpeedometerCharge !== null && hudRefresh.lastSpeedometerCharge > MOVEMENT.mightyChargeThreshold;
      const isSpeedometerGlowing = charge > MOVEMENT.mightyChargeThreshold;
      const crossedChargeGlow = wasSpeedometerGlowing !== isSpeedometerGlowing;
      if (hudRefresh.lastSpeedometerCharge === null || Math.abs(charge - hudRefresh.lastSpeedometerCharge) >= HUD_TIMING.speedometerRedrawDelta || crossedChargeGlow) {
        drawSpeedometer(charge);
        hudRefresh.lastSpeedometerCharge = charge;
      }

      if (gameStartTimeRef.current && startedRef.current && !gameOverRef.current) {
        setTextIfChanged(ui.timerDisplay, "timerDisplay", formatElapsed(now - gameStartTimeRef.current));
      }

      const section = sectionLabel();
      setTextIfChanged(ui.sectionBadge, "sectionBadge", section);
      setTextIfChanged(ui.distance, "distance", Math.abs(Math.min(0, body.z)).toFixed(0));
      setTextIfChanged(ui.fruit, "fruit", `${body.fruitLifeCounter}/100`);
      setTextIfChanged(ui.fruitTally, "fruitTally", body.fruit);
      setTextIfChanged(ui.cratesTally, "cratesTally", body.crates);

      const prompt = promptText();
      if (prompt !== body.lastPrompt) {
        body.lastPrompt = prompt;
        setTextIfChanged(ui.prompt, "prompt", prompt);
      }

      if (ui.debug.current) {
        setTextIfChanged(ui.debug, "debug", [
          `FPS ${fps}`,
          `Section ${section}`,
          `X ${body.x.toFixed(2)}  Y ${body.y.toFixed(2)}  Z ${body.z.toFixed(2)}`,
          `Speed ${body.speed.toFixed(2)}  Charge ${roundedCharge}%`,
          `Grounded ${body.grounded}  Slide ${body.slideTimer > 0}`,
          `Lives ${body.lives}  Health ${body.health}`,
          `Fruit ${body.fruitLifeCounter}/100`,
          testSummaryRef.current,
        ].join(nl));
      }
    }

    function updateDom(now) {
      const charge = clamp(body.speed / MOVEMENT.maxSpeed, 0, 1);
      updateHighFrequencyHud(charge);
      if (now >= hudRefresh.nextLowAt) {
        hudRefresh.nextLowAt = now + hudRefresh.lowIntervalMs;
        updateLowFrequencyHud(now, charge);
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
      if (pausedRef.current) {
        renderFrame();
        frame = requestAnimationFrame(animate);
        return;
      }
      updatePhysics(dt);
      updateMeshes(dt, now);
      updateCamera(dt);
      updateDom(now);
      renderFrame();
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
      resetGameRef.current = null;

      const seenGeometries = new Set();
      const seenMaterials = new Set();
      const seenTextures = new Set();

      const collectTexture = (value) => {
        if (!value) return;
        if (Array.isArray(value)) {
          value.forEach(collectTexture);
          return;
        }
        if (value.isTexture && typeof value.dispose === "function") {
          seenTextures.add(value);
          return;
        }
        if (value.value && value.value !== value) collectTexture(value.value);
      };

      const collectMaterial = (material) => {
        if (!material) return;
        if (Array.isArray(material)) {
          material.forEach(collectMaterial);
          return;
        }
        if (seenMaterials.has(material)) return;
        seenMaterials.add(material);
        Object.values(material).forEach(collectTexture);
        if (material.uniforms) Object.values(material.uniforms).forEach(collectTexture);
      };

      const collectObjectResources = (object) => {
        if (object.geometry && typeof object.geometry.dispose === "function") {
          seenGeometries.add(object.geometry);
        }
        collectMaterial(object.material);
      };

      collectTexture(scene.background);
      collectTexture(scene.environment);
      scene.traverse(collectObjectResources);

      seenGeometries.forEach((geometry) => geometry.dispose());
      seenMaterials.forEach((material) => material.dispose?.());
      seenTextures.forEach((texture) => texture.dispose());
      postProcessing?.dispose();
      renderer.renderLists?.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss();
      scene.clear();
      if (mount && renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      audioManagerRef.current?.dispose();
    };
  }, []);

  const handleInitialsChange = (event) => {
    setInitials(normalizeInitials(event.target.value));
    setInitialsError("");
  };

  const handleLeaderboardSubmit = async (event) => {
    event.preventDefault();
    if (!finalResults || leaderboardStatus.submitting || leaderboardSubmitted) return;
    if (!validateInitials(initials)) {
      setInitialsError("Use exactly 3 uppercase letters or numbers — no full names.");
      return;
    }

    setInitialsError("");
    setLeaderboardStatus((status) => ({ ...status, submitting: true, error: null }));
    try {
      const result = await submitLeaderboardEntry({
        initials,
        score: finalResults.score,
        elapsedMs: finalResults.elapsedMs,
        fruit: finalResults.fruit,
        crates: finalResults.crates,
        lives: finalResults.lives,
        createdAt: new Date().toISOString(),
      });
      setLeaderboardSubmitted(true);
      setLeaderboardStatus({
        entries: result.entries,
        loading: false,
        submitting: false,
        source: result.source,
        error: result.error,
      });
    } catch (error) {
      setInitialsError(error?.message || "Could not save that leaderboard entry.");
      setLeaderboardStatus((status) => ({ ...status, submitting: false }));
    }
  };

  const currentResultQualifies = Boolean(finalResults)
    && !leaderboardSubmitted
    && leaderboardResultQualifies(leaderboardStatus.entries, finalResults, LEADERBOARD_LIMIT);

  const renderLeaderboardPanel = (accent = "#fde68a") => (
    <div className="mt-6 rounded-2xl p-4 text-left"
      style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${accent}55` }}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-black uppercase tracking-[0.22em]" style={{ color: accent }}>Class Leaderboard</h3>
        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.5)" }}>
          {leaderboardStatus.loading ? "Loading" : leaderboardStatus.source === "remote" ? "Shared" : "This device"}
        </span>
      </div>
      {leaderboardStatus.error && (
        <p className="mb-2 rounded-xl px-3 py-2 text-xs font-bold"
          style={{ background: "rgba(251,191,36,0.12)", color: "#fde68a", border: "1px solid rgba(251,191,36,0.24)" }}>
          {leaderboardStatus.error}
        </p>
      )}
      {leaderboardStatus.loading ? (
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>Loading leaderboard…</p>
      ) : leaderboardStatus.entries.length ? (
        <ol className="leaderboard-list">
          {leaderboardStatus.entries.map((entry, index) => (
            <li key={`${entry.initials}-${entry.score}-${entry.elapsedMs}-${entry.createdAt}`} className="leaderboard-row">
              <span className="leaderboard-rank">{index + 1}</span>
              <span className="leaderboard-initials">{entry.initials}</span>
              <span className="leaderboard-score">{entry.score}</span>
              <span className="leaderboard-time">{formatElapsed(entry.elapsedMs)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>No scores yet. Be the first herd on the board!</p>
      )}
      {currentResultQualifies && (
        <form onSubmit={handleLeaderboardSubmit} className="mt-4 flex flex-wrap items-center gap-2">
          <label className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: "rgba(255,255,255,0.55)" }} htmlFor="leaderboard-initials">
            Top {LEADERBOARD_LIMIT} initials
          </label>
          <input
            id="leaderboard-initials"
            value={initials}
            onChange={handleInitialsChange}
            maxLength={3}
            inputMode="text"
            autoComplete="off"
            pattern="[A-Z0-9]{3}"
            placeholder="ABC"
            disabled={leaderboardStatus.submitting || leaderboardSubmitted}
            aria-describedby="leaderboard-help"
            className="leaderboard-input"
          />
          <button type="submit" disabled={leaderboardStatus.submitting || leaderboardSubmitted || !validateInitials(initials)}
            className="rounded-full px-4 py-2 text-xs font-black text-slate-950 transition hover:scale-105 active:scale-95"
            style={{ background: accent, opacity: leaderboardStatus.submitting || leaderboardSubmitted || !validateInitials(initials) ? 0.62 : 1 }}>
            {leaderboardStatus.submitting ? "Saving…" : leaderboardSubmitted ? "Saved" : "Save"}
          </button>
        </form>
      )}
      {finalResults && !currentResultQualifies && !leaderboardSubmitted && (
        <p className="mt-4 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.62)" }}>
          This run did not reach the current Top {LEADERBOARD_LIMIT}. Try again to climb the board!
        </p>
      )}
      <p id="leaderboard-help" className="mt-2 text-[11px]" style={{ color: initialsError ? "#fecaca" : "rgba(255,255,255,0.45)" }}>
        {initialsError || (currentResultQualifies ? "Use a 3-character classroom code only. No full names are stored." : "Ranked by highest score; faster time breaks ties.")}
      </p>
    </div>
  );
  const startDemo = () => {
    stopTitleTheme(0.18);
    startAudio();
    resetGameRef.current?.({ start: true });
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#132516] text-white" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div ref={mountRef} className="absolute inset-0" />

      {sceneError && (
        <section className="app-fallback-screen absolute inset-0 z-30 flex items-center justify-center px-6">
          <div className="app-fallback-card">
            <div className="app-fallback-icon" aria-hidden="true">🐘</div>
            <h1>Pink Elephant could not start the 3D jungle</h1>
            <p>Your browser blocked or could not create the WebGL renderer, so the game was showing an empty green screen.</p>
            <pre>{sceneError}</pre>
          </div>
        </section>
      )}

      {/* TOP STRIP — tally, section, timer */}
      {started && !complete && !gameOver && (
        <div className="hud-audio-dock pointer-events-auto absolute bottom-4 right-4 z-20">
          <AudioControls audioState={audioState} onToggle={toggleAudioState} compact />
        </div>
      )}
      {started && !complete && !gameOver && (
        <div className="hud-top-strip pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-2">
          <div className="hud-tally-cluster flex items-center gap-3 text-xs font-black tracking-widest text-amber-100/80">
            <span>🍋 <span ref={ui.fruitTally}>0</span></span>
            <span className="text-amber-100/30">·</span>
            <span title="Crates smashed">📦 <span ref={ui.cratesTally}>0</span></span>
            <span className="text-amber-100/30">·</span>
            <span className="hud-score-emphasis" title="Score from fruit, crates, pineapples, and monkeys">⭐ <span ref={ui.scoreTally}>0</span></span>
          </div>
          <div ref={ui.sectionBadge} className="hud-section-pill rounded-full px-4 py-1 text-xs font-black uppercase tracking-[0.28em] text-emerald-200">
            Learning Trail
          </div>
          <div className="hud-timer-pill flex items-center gap-2 rounded-full px-3 py-1 text-sm font-black text-amber-100">
            <Icon label="⏱" />
            <span style={{ fontSize: "10px", letterSpacing: "0.2em", color: "rgba(255,200,100,0.6)" }}>TIME</span>
            <span ref={ui.timerDisplay} style={{ fontVariantNumeric: "tabular-nums" }}>00:00</span>
          </div>
        </div>
      )}

      {/* LEFT PANEL — stamina, lives, charge, state */}
      {started && !complete && !gameOver && (
        <div className="hud-primary-panel pointer-events-none absolute left-3 top-12 z-20 w-52">
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
        <div className="hud-secondary-panel pointer-events-none absolute right-3 top-12 z-10 w-48">
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
        <div className="hud-prompt-layer pointer-events-none absolute bottom-5 left-1/2 z-20 flex flex-col items-center gap-2">
          <div ref={ui.prompt}
            className="hud-prompt overflow-hidden text-ellipsis whitespace-nowrap rounded-full px-5 py-2 text-center text-sm font-black tracking-wide text-amber-50">
            Hold ↑ to build Elephant Charge.
          </div>
          <canvas ref={ui.speedo} className="hud-speedometer" width={120} height={120} />
        </div>
      )}

      {/* START SCREEN */}
      {!started && !complete && !gameOver && !sceneError && (
        <section className="absolute inset-0 z-30 flex items-center justify-center px-6"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(15,28,12,0.45) 50%, rgba(0,0,0,0.8) 100%)", backdropFilter: "blur(2px)" }}>
          <div className="w-full max-w-3xl rounded-[2rem] p-8 text-center"
            style={{ background: "rgba(12,20,10,0.78)", border: "1px solid rgba(246,210,138,0.25)", boxShadow: "0 0 55px rgba(255,180,80,0.15)", maxHeight: "92vh", overflowY: "auto" }}>
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
              Charge, jump, slide, and smash through a low-poly jungle course. Look for small trail telegraphs before obstacles, then chase fruit, crates, and bonus score.
            </p>
            <AudioControls audioState={audioState} onToggle={toggleAudioState} />
            <button onClick={startDemo}
              className="mt-7 rounded-full px-10 py-4 text-base font-black text-slate-950 transition hover:scale-105 active:scale-95"
              style={{ background: "#f472b6", boxShadow: "0 0 30px rgba(244,114,182,0.45)" }}>
              Begin the Trail
            </button>
            <div className="title-primary-controls mt-6 text-left text-xs text-amber-50/70" aria-label="Primary controls">
              {[["↑ / W", "Build Charge"], ["← / A   → / D", "Steer"], ["Tap Space", "Jump"], ["Hold Space", "Slide"], ["Z / E", "Smash / Spin"], ["M", "Mute"]].map(([key, label]) => (
                <div key={key} className="title-primary-control flex items-center gap-2 rounded-xl px-3 py-2">
                  <span className="title-control-key shrink-0 font-black text-amber-200">{key}</span><span>{label}</span>
                </div>
              ))}
            </div>
            <div className="title-advanced-note mx-auto mt-3 rounded-full px-4 py-2 text-center text-[11px] font-bold tracking-wide text-emerald-100/50">
              Trail markings telegraph hazards early; smash crates for score streaks without covering the road.
            </div>
            <SelfTestStatus summaryRef={testSummaryRef} />
            {renderLeaderboardPanel("#f9a8d4")}
          </div>
        </section>
      )}

      {/* COMPLETE SCREEN */}
      {complete && (
        <section className="absolute inset-0 z-20 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.52)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-[2rem] p-10 text-center"
            style={{ background: "rgba(12,20,10,0.88)", border: "1px solid rgba(255,200,80,0.35)", boxShadow: "0 0 65px rgba(255,190,80,0.22)", maxHeight: "92vh", overflowY: "auto" }}>
            <div className="mb-4 text-6xl">🏆</div>
            <h2 className="display-title text-4xl font-black text-amber-200">Jungle Gate Reached!</h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-amber-50/70">
              The herd made it through. The jungle is yours.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-left text-sm font-black text-amber-100 sm:grid-cols-3">
              <span className="rounded-2xl bg-white/5 px-3 py-2">🍋 Fruit <span>{finalResults?.fruit ?? 0}</span></span>
              <span className="rounded-2xl bg-white/5 px-3 py-2">🍍 Bonus <span>{finalResults?.fruitLifeCounter ?? 0}</span>/100</span>
              <span className="rounded-2xl bg-white/5 px-3 py-2">📦 Crates <span>{finalResults?.crates ?? 0}</span></span>
              <span className="rounded-2xl bg-white/5 px-3 py-2">⭐ Score <span>{finalResults?.score ?? 0}</span></span>
              <span className="rounded-2xl bg-white/5 px-3 py-2">🐘 Lives <span>{finalResults?.lives ?? 0}</span></span>
              <span className="rounded-2xl bg-white/5 px-3 py-2">⏱ Time <span>{formatElapsed(finalResults?.elapsedMs ?? 0)}</span></span>
              <span className="rounded-2xl bg-white/5 px-3 py-2 sm:col-span-3">🌿 Distance <span>{Math.round(finalResults?.distance ?? 0)}</span>m</span>
            </div>
            {renderLeaderboardPanel("#fde68a")}
            <button onClick={startDemo}
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
            style={{ background: "rgba(24,10,12,0.9)", border: "1px solid rgba(255,120,140,0.35)", boxShadow: "0 0 65px rgba(255,80,120,0.18)", maxHeight: "92vh", overflowY: "auto" }}>
            <div className="mb-4 text-6xl">⚠️</div>
            <h2 className="display-title text-4xl font-black text-red-100">The Herd Needs Rest</h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-red-50/70">
              Too many jungle bumps. Restart and build Charge more carefully.
            </p>
            <div className="mt-5 flex justify-center gap-6 text-sm font-black text-red-50">
              <span>🍋 <span>{finalResults?.fruit ?? 0}</span></span>
              <span>📦 <span>{finalResults?.crates ?? 0}</span></span>
              <span>⭐ <span>{finalResults?.score ?? 0}</span></span>
              <span>🐘 <span>{finalResults?.lives ?? 0}</span></span>
              <span>⏱ <span>{formatElapsed(finalResults?.elapsedMs ?? 0)}</span></span>
            </div>
            {renderLeaderboardPanel("#fecaca")}
            <button onClick={startDemo}
              className="mt-8 rounded-full bg-white px-8 py-3 font-black text-slate-950 transition hover:scale-105 active:scale-95">
              Try Again
            </button>
          </div>
        </section>
      )}

      {/* PAUSE OVERLAY */}
      {paused && started && !complete && !gameOver && !sceneError && (
        <section className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center px-6"
          style={{ background: "rgba(7,12,8,0.42)", backdropFilter: "blur(3px)" }}
          aria-modal="true" role="dialog" aria-labelledby="pause-title">
          <div className="rounded-[1.5rem] p-6 text-center text-amber-50"
            style={{ background: "rgba(12,20,10,0.9)", border: "1px solid rgba(246,210,138,0.28)", boxShadow: "0 0 45px rgba(0,0,0,0.32)" }}>
            <div className="text-xs font-black uppercase tracking-[0.32em] text-emerald-200/70">Trail Paused</div>
            <h2 id="pause-title" className="display-title mt-1 text-3xl font-black text-pink-200">Take a Jungle Breather</h2>
            <p className="mt-2 text-sm text-amber-50/65">Press Esc or P to resume. Input was cleared so no move sticks after focus changes.</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={resumeGame}
                className="rounded-full bg-emerald-200 px-5 py-2 text-sm font-black text-emerald-950 transition hover:scale-105 active:scale-95">
                Resume
              </button>
              <button type="button" onClick={restartGame}
                className="rounded-full bg-amber-200 px-5 py-2 text-sm font-black text-slate-950 transition hover:scale-105 active:scale-95">
                Restart
              </button>
              <button type="button" onClick={() => toggleAudioState("muted")}
                className="rounded-full px-5 py-2 text-sm font-black transition hover:scale-105 active:scale-95"
                aria-pressed={audioState.muted}
                style={{ background: audioState.muted ? "rgba(248,113,113,0.92)" : "rgba(134,239,172,0.92)", color: "#082f1a" }}>
                {audioState.muted ? "Unmute" : "Mute"}
              </button>
            </div>
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