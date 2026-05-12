import { NOTES, noteToFrequency } from "../audio.js";
import { createTitleThemePlayer } from "./titleTheme.js";
import { lerp } from "../math.js";

const TONE_SETTINGS = {
  jump: [180, 340, 0.08, "sine", 0.08],
  double: [360, 720, 0.09, "triangle", 0.09],
  land: [105, 70, 0.11, "sine", 0.1],
  smash: [90, 40, 0.16, "sawtooth", 0.14],
  fruit: [660, 990, 0.08, "triangle", 0.07],
  heal: [420, 760, 0.2, "sine", 0.08],
  hurt: [160, 80, 0.18, "square", 0.1],
  gate: [330, 880, 0.45, "triangle", 0.09],
  life: [420, 980, 0.35, "triangle", 0.1],
  croc: [70, 45, 0.18, "sawtooth", 0.11],
  thump: [62, 30, 0.16, "sine", 0.08],
};

const LAYERED_TONES = {
  slideStart: [
    [210, 112, 0.13, "triangle", 0.055, 0],
    [460, 260, 0.07, "sine", 0.035, 0.012],
  ],
  crateSmash: [
    [128, 42, 0.15, "sawtooth", 0.085, 0],
    [520, 190, 0.09, "square", 0.032, 0.018],
    [72, 36, 0.2, "sine", 0.045, 0.006],
  ],
  monkeyDefeat: [
    [760, 520, 0.09, "square", 0.034, 0],
    [980, 1320, 0.11, "triangle", 0.04, 0.035],
    [390, 260, 0.12, "sine", 0.035, 0.012],
  ],
  bonusLife: [
    [420, 630, 0.12, "sine", 0.045, 0],
    [630, 945, 0.14, "triangle", 0.052, 0.075],
    [945, 1260, 0.17, "sine", 0.046, 0.16],
  ],
};

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
  }

  function scheduleToneLayer([startFrequency, endFrequency, duration, waveform, volume, delay = 0], atTime) {
    const startTime = atTime + delay;
    const stopTime = startTime + duration;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);
    osc.type = waveform;
    osc.frequency.setValueAtTime(Math.max(20, startFrequency), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), stopTime);
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + Math.min(0.012, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.001, stopTime);
    osc.start(startTime);
    osc.stop(stopTime + 0.03);
  }

  function playTone(type, atTime = null) {
    if (!ctx || !master || disposed) return;
    const now = atTime ?? ctx.currentTime;
    const layeredTone = LAYERED_TONES[type];
    if (layeredTone) {
      layeredTone.forEach((layer) => scheduleToneLayer(layer, now));
      return;
    }
    scheduleToneLayer(TONE_SETTINGS[type] || [250, 250, 0.1, "sine", 0.05], now);
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
        gain.gain.setValueAtTime(0.025, music.nextNoteTime);
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
