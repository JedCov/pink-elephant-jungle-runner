import { NOTES, noteToFrequency } from "../audio.js";
import { createTitleThemePlayer } from "./titleTheme.js";
import { lerp } from "../math.js";

export const AUDIO_CATEGORY_VOLUMES = {
  music: 0.55,
  pickups: 0.78,
  impacts: 0.68,
  ui: 0.72,
};

const TONE_SETTINGS = {
  jump: [180, 340, 0.08, "sine", 0.08, "ui"],
  double: [360, 720, 0.09, "triangle", 0.09, "ui"],
  land: [105, 70, 0.11, "sine", 0.1, "impacts"],
  smash: [90, 40, 0.16, "sawtooth", 0.14, "impacts"],
  fruit: [660, 990, 0.08, "triangle", 0.07, "pickups"],
  heal: [420, 760, 0.2, "sine", 0.08, "pickups"],
  hurt: [160, 80, 0.18, "square", 0.1, "impacts"],
  gate: [330, 880, 0.45, "triangle", 0.09, "ui"],
  life: [420, 980, 0.35, "triangle", 0.1, "pickups"],
  croc: [70, 45, 0.18, "sawtooth", 0.11, "impacts"],
  thump: [62, 30, 0.16, "sine", 0.08, "impacts"],
};

const REPEAT_RULES = {
  fruit: { skipSeconds: 0.018, softenSeconds: 0.085, minVolumeScale: 0.42 },
  thump: { skipSeconds: 0.045, softenSeconds: 0.14, minVolumeScale: 0.52 },
  hurt: { skipSeconds: 0.18, softenSeconds: 0.5, minVolumeScale: 0.62 },
  croc: { skipSeconds: 0.18, softenSeconds: 0.5, minVolumeScale: 0.62 },
};

export function resolveTonePlayback(type, atTime, lastPlayedTimes) {
  const rule = REPEAT_RULES[type];
  if (!rule) return { shouldPlay: true, volumeScale: 1 };
  const lastPlayed = lastPlayedTimes.get(type);
  if (typeof lastPlayed !== "number") return { shouldPlay: true, volumeScale: 1 };
  const secondsFromNearestScheduledPlay = Math.abs(atTime - lastPlayed);
  if (secondsFromNearestScheduledPlay < rule.skipSeconds) return { shouldPlay: false, volumeScale: 0 };
  if (secondsFromNearestScheduledPlay < rule.softenSeconds) {
    const progress = (secondsFromNearestScheduledPlay - rule.skipSeconds) / (rule.softenSeconds - rule.skipSeconds);
    const volumeScale = lerp(rule.minVolumeScale, 1, Math.max(0, Math.min(1, progress)));
    return { shouldPlay: true, volumeScale };
  }
  return { shouldPlay: true, volumeScale: 1 };
}

function getAudioContextConstructor() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

export function createAudioManager() {
  let ctx = null;
  let master = null;
  let titleTheme = null;
  let disposed = false;
  const music = { enabled: false, nextNoteTime: 0, noteIndex: 0, beatSeconds: 0.2 };
  const lastPlayedTimes = new Map();

  function ensureContext() {
    if (disposed) disposed = false;
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    }

    const AudioContext = getAudioContextConstructor();
    if (!AudioContext) return null;

    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.setValueAtTime(0.78, ctx.currentTime);
    master.connect(ctx.destination);
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }

  function startAudio() {
    const audioContext = ensureContext();
    if (!audioContext) return null;
    music.enabled = true;
    music.nextNoteTime = audioContext.currentTime + 0.08;
    return audioContext;
  }

  function startTitleTheme(canStart = true) {
    const audioContext = startAudio();
    if (!audioContext || !canStart || !master) return;
    if (!titleTheme) titleTheme = createTitleThemePlayer(audioContext, master);
    titleTheme.start();
  }

  function stopTitleTheme(fadeSeconds = 0.22) {
    titleTheme?.stop(fadeSeconds);
  }

  function resetGameplayMusic() {
    music.nextNoteTime = ctx ? ctx.currentTime + 0.08 : 0;
    music.noteIndex = 0;
    music.beatSeconds = 0.2;
    lastPlayedTimes.clear();
  }

  function playTone(type, atTime = null) {
    if (!ctx || !master || disposed) return { played: false, reason: "unavailable" };
    const now = atTime ?? ctx.currentTime;
    const repeatDecision = resolveTonePlayback(type, now, lastPlayedTimes);
    if (!repeatDecision.shouldPlay) return { played: false, reason: "repeat-window" };

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);
    const settings = TONE_SETTINGS[type] || [250, 250, 0.1, "sine", 0.05, "ui"];
    const categoryVolume = AUDIO_CATEGORY_VOLUMES[settings[5]] ?? 1;
    const level = settings[4] * categoryVolume * repeatDecision.volumeScale;
    osc.type = settings[3];
    osc.frequency.setValueAtTime(settings[0], now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, settings[1]), now + settings[2]);
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + settings[2]);
    osc.start(now);
    osc.stop(now + settings[2] + 0.03);
    lastPlayedTimes.set(type, now);
    return { played: true, volumeScale: repeatDecision.volumeScale };
  }

  function updateGameplayMusic({ charge, isPlaying }) {
    if (!ctx || !master || !music.enabled || !isPlaying || disposed) return;
    music.beatSeconds = lerp(0.26, 0.15, charge);
    while (music.nextNoteTime < ctx.currentTime + 0.1) {
      const note = NOTES[music.noteIndex % NOTES.length];
      playTone("thump", music.nextNoteTime);
      if (music.noteIndex % 2 === 0) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(noteToFrequency(note), music.nextNoteTime);
        gain.gain.setValueAtTime(0.025 * AUDIO_CATEGORY_VOLUMES.music, music.nextNoteTime);
        gain.gain.exponentialRampToValueAtTime(0.001, music.nextNoteTime + 0.12);
        osc.connect(gain);
        gain.connect(master);
        osc.start(music.nextNoteTime);
        osc.stop(music.nextNoteTime + 0.14);
      }
      music.noteIndex += 1;
      music.nextNoteTime += music.beatSeconds;
    }
  }

  function getCurrentTime() {
    return ctx?.currentTime ?? 0;
  }

  function dispose({ closeContext = true } = {}) {
    disposed = true;
    music.enabled = false;
    titleTheme?.dispose();
    titleTheme = null;
    lastPlayedTimes.clear();
    try {
      master?.disconnect();
    } catch {
      // Already disconnected.
    }
    master = null;
    const audioContext = ctx;
    ctx = null;
    if (!audioContext || audioContext.state === "closed") return;
    if (closeContext && typeof audioContext.close === "function") {
      void audioContext.close().catch(() => undefined);
      return;
    }
    if (typeof audioContext.suspend === "function") void audioContext.suspend().catch(() => undefined);
  }

  return {
    startAudio,
    startTitleTheme,
    stopTitleTheme,
    playTone,
    resetGameplayMusic,
    updateGameplayMusic,
    getCurrentTime,
    dispose,
  };
}
