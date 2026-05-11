import { aabb, clamp, lerp } from "./math.js";
import { createKeys, setKeyState } from "./input.js";
import { TITLE_THEME, noteNameToFrequency } from "./audio/titleTheme.js";
import { trackAngle, trackCenter, worldPosition, worldX } from "./track.js";

export function runSelfTests() {
  const results = [];
  const assert = (name, condition) => results.push({ name, pass: Boolean(condition) });

  assert("clamp caps high values", clamp(12, 0, 10) === 10);
  assert("clamp caps low values", clamp(-2, 0, 10) === 0);
  assert("lerp halfway", lerp(0, 10, 0.5) === 5);

  assert(
    "aabb detects overlap",
    aabb(
      { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 2 },
      { minX: 1, maxX: 3, minY: 1, maxY: 3, minZ: 1, maxZ: 3 },
    ),
  );

  assert(
    "aabb detects separation",
    !aabb(
      { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 },
      { minX: 2, maxX: 3, minY: 2, maxY: 3, minZ: 2, maxZ: 3 },
    ),
  );

  assert(
    "worldX honours local offset",
    Math.abs(worldX(2, -50) - trackCenter(-50) - 2 * Math.cos(trackAngle(-50))) < 0.00001,
  );

  assert(
    "worldPosition uses shared path projection",
    worldPosition(0, -120).x === trackCenter(-120) && worldPosition(0, -120).z === -120,
  );

  const samples = Array.from({ length: 77 }, (_, i) => trackCenter(-i * 10));
  const minCenter = Math.min(...samples);
  const maxCenter = Math.max(...samples);
  const maxReadableAngle = Math.max(...samples.map((_, i) => Math.abs(trackAngle(-i * 10))));

  assert("track has visible left-right bends", maxCenter - minCenter > 12);
  assert("track bends stay readable", maxReadableAngle < 0.35);

  assert("title theme contains all 32 bars", TITLE_THEME.sequence.length === TITLE_THEME.stepsPerBar * 32);
  assert("title theme hook starts at bar 21", TITLE_THEME.sequence[20 * TITLE_THEME.stepsPerBar].bar === 21);
  assert(
    "title theme keeps four polyphonic lanes",
    ["pulse1", "pulse2", "triangle", "noise"].every((voice) => voice in TITLE_THEME.sequence[0]),
  );
  assert("title theme note conversion tunes A4", Math.abs(noteNameToFrequency("A4") - 440) < 0.00001);

  const keys = createKeys();

  setKeyState(keys, "KeyW", true);
  assert("W mirrors ArrowUp", keys.ArrowUp);

  setKeyState(keys, "KeyA", true);
  assert("A mirrors ArrowLeft", keys.ArrowLeft);

  setKeyState(keys, "KeyS", true);
  assert("S mirrors ArrowDown", keys.ArrowDown);

  setKeyState(keys, "KeyD", true);
  assert("D mirrors ArrowRight", keys.ArrowRight);

  setKeyState(keys, "ShiftLeft", true);
  assert("Shift mirrors Space", keys.Space);

  setKeyState(keys, "ShiftLeft", false);
  assert("Shift release clears Space when spacebar is not held", !keys.Space);

  setKeyState(keys, "Space", true);
  setKeyState(keys, "ShiftRight", true);
  setKeyState(keys, "ShiftRight", false);
  assert("Space remains held after releasing Shift", keys.Space);

  return results;
}