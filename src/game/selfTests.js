import { aabb, clamp, lerp } from "./math.js";
import { branchHitsPlayer, obstacleBox, playerBox } from "./collision.js";
import { applyFruitLifeCounter } from "./fruitLife.js";
import { createKeys, setKeyState } from "./input.js";
import { TITLE_THEME, noteNameToFrequency } from "./audio/titleTheme.js";
import { trackAngle, trackCenter, worldPosition, worldX } from "./track.js";
import { CONFIG, MOVEMENT } from "./config.js";
import { LEVEL } from "./level.js";
import {
  createPlayerBody,
  getPlayerInputIntent,
  selectPlayerStateLabel,
  triggerJumpOrDoubleJump,
  updateJumpAndSlideInput,
  updatePlayerSpeed,
} from "./player.js";

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

  assert("level finish plane matches configured finish line", LEVEL.finish.z === CONFIG.finishLineZ && CONFIG.finishLineZ === CONFIG.gateZ);
  assert("level finish failsafe is beyond the gate", LEVEL.finish.failSafeZ < LEVEL.finish.z);

  const representativeBranch = LEVEL.branches.find((branch) => branch.z === -182);
  const representativeBranchPosition = worldPosition(representativeBranch.localX, representativeBranch.z);
  const representativeBranchBox = obstacleBox({
    x: representativeBranchPosition.x,
    y: representativeBranch.yOffset,
    z: representativeBranchPosition.z,
    w: representativeBranch.width,
    h: representativeBranch.height,
    d: representativeBranch.depth,
  });
  const standingBranchPlayerBox = playerBox(
    representativeBranchPosition.x,
    CONFIG.playerSize / 2,
    representativeBranchPosition.z,
    false,
  );
  const slidingBranchPlayerBox = playerBox(
    representativeBranchPosition.x,
    CONFIG.playerSize / 2,
    representativeBranchPosition.z,
    true,
  );

  assert(
    "standing player clips representative branch",
    aabb(standingBranchPlayerBox, representativeBranchBox) && branchHitsPlayer(standingBranchPlayerBox, representativeBranchBox),
  );
  assert(
    "sliding player box clears representative branch",
    !aabb(slidingBranchPlayerBox, representativeBranchBox) && !branchHitsPlayer(slidingBranchPlayerBox, representativeBranchBox),
  );
  assert(
    "branch challenge repeats at expected z sections",
    [-182, -427, -672].every((z) => LEVEL.branches.some((branch) => branch.z === z)),
  );

  assert("title theme contains all 32 bars", TITLE_THEME.sequence.length === TITLE_THEME.stepsPerBar * 32);
  assert("title theme hook starts at bar 21", TITLE_THEME.sequence[20 * TITLE_THEME.stepsPerBar].bar === 21);
  assert(
    "title theme keeps four polyphonic lanes",
    ["pulse1", "pulse2", "triangle", "noise"].every((voice) => voice in TITLE_THEME.sequence[0]),
  );
  assert("title theme note conversion tunes A4", Math.abs(noteNameToFrequency("A4") - 440) < 0.00001);

  const pineappleAt80 = applyFruitLifeCounter(80, 20);
  assert("golden pineapple awards a bonus life at 80 fruit", pineappleAt80.livesAwarded === 1 && pineappleAt80.counter === 0);

  const pineappleAbove80 = applyFruitLifeCounter(85, 20);
  assert("golden pineapple carries fruit progress after crossing 100", pineappleAbove80.livesAwarded === 1 && pineappleAbove80.counter === 5);

  const normalFruitAt99 = applyFruitLifeCounter(99, 1);
  assert("normal fruit bonus life threshold still resets at 100", normalFruitAt99.livesAwarded === 1 && normalFruitAt99.counter === 0);

  const jumpBody = createPlayerBody();
  const jumpEvent = triggerJumpOrDoubleJump(jumpBody, true);
  assert(
    "player helper starts a ground jump",
    jumpEvent === "ground" && !jumpBody.grounded && jumpBody.yVelocity === MOVEMENT.jumpVelocity && jumpBody.jumpBufferTimer === 0,
  );

  const doubleJumpBody = createPlayerBody({ grounded: false, coyoteTimer: 0, doubleUsed: false });
  const doubleJumpEvent = triggerJumpOrDoubleJump(doubleJumpBody, true);
  assert(
    "player helper starts a double jump while airborne",
    doubleJumpEvent === "double" && doubleJumpBody.doubleUsed && doubleJumpBody.yVelocity === MOVEMENT.doubleJumpVelocity,
  );

  const slideBody = createPlayerBody({ speed: 8 });
  const slideKeys = createKeys();
  slideKeys.Space = true;
  const slideEvents = updateJumpAndSlideInput(slideBody, slideKeys, MOVEMENT.slideHoldThreshold, true);
  assert(
    "player helper converts held action into slide",
    slideEvents.includes("slide") && slideBody.slideTimer === MOVEMENT.slideDuration && !slideBody.bufferedSlide,
  );

  const reverseBody = createPlayerBody();
  const reverseKeys = createKeys();
  reverseKeys.ArrowDown = true;
  const reverseIntent = getPlayerInputIntent(reverseBody, reverseKeys, true);
  updatePlayerSpeed(reverseBody, 0.5, true, reverseIntent);
  assert(
    "player helper accelerates reverse from rest",
    reverseIntent.wantsReverse && !reverseIntent.wantsSlide && reverseBody.speed < 0 && reverseBody.speed >= -MOVEMENT.reverseMaxSpeed,
  );

  assert(
    "player state labels prioritise action states",
    selectPlayerStateLabel(createPlayerBody({ spinTimer: 0.2, slideTimer: 0.7 }), 0) === "Spin Attack"
      && selectPlayerStateLabel(createPlayerBody({ slideTimer: 0.7 }), 0) === "Belly-Slide"
      && selectPlayerStateLabel(createPlayerBody({ grounded: false, doubleUsed: true }), 0) === "BIG Bounce",
  );

  assert(
    "player state labels include speed and end states",
    selectPlayerStateLabel(createPlayerBody({ speed: MOVEMENT.maxSpeed }), 1) === "Mighty Charge"
      && selectPlayerStateLabel(createPlayerBody({ completed: true, lives: 0 }), 0) === "Jungle Gate"
      && selectPlayerStateLabel(createPlayerBody({ lives: 0 }), 0) === "Herd Resting",
  );

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