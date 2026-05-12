import { CONFIG } from "./config.js";
import { lerp } from "./math.js";

export const LEVEL_SECTIONS = Object.freeze({
  FRUIT_GUIDE: "fruit guide",
  SWAY_TRAIL: "sway trail",
  JUMP_LOG: "jump log",
  HIGH_FRUIT: "high fruit",
  SLIDE_BRANCH: "slide branch",
  SMASH_CRATE: "smash crate",
  RIVER_CROC: "river/croc",
  HEALTH_RECOVERY: "health recovery",
  MONKEY: "monkey",
  PINEAPPLE: "pineapple",
});

function sectionDifficulty(loopIndex) {
  return loopIndex === 0 ? "intro" : loopIndex === 1 ? "building" : "advanced";
}

function sectionMetadata(section, difficulty, tutorialPrompt) {
  return {
    section,
    difficulty,
    ...(tutorialPrompt ? { tutorialPrompt } : {}),
  };
}

function addFruitLine(fruits, startZ, endZ, count, localXFn, yFn, metadata = {}) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const z = lerp(startZ, endZ, t);
    fruits.push({ localX: localXFn(t, z), z, y: yFn ? yFn(t, z) : 1.05, ...metadata });
  }
}

export function buildLevel() {
  const fruits = [], health = [], logs = [], crates = [], branches = [], rivers = [], enemies = [], collectibles = [];
  const loops = [0, 245, 490];
  loops.forEach((offset, index) => {
    const o = -offset;
    const wide = index === 0 ? 0 : 0.25;
    const difficulty = sectionDifficulty(index);

    // Fruit guide — straight tutorial line that anchors the generated loop.
    addFruitLine(
      fruits,
      o - 16,
      o - 54,
      7 + index,
      () => 0,
      undefined,
      sectionMetadata(
        LEVEL_SECTIONS.FRUIT_GUIDE,
        difficulty,
        index === 0 ? "Follow the fruit down the center path." : undefined,
      ),
    );

    // Sway trail — side-to-side fruit wave that teaches lateral movement.
    addFruitLine(
      fruits,
      o - 66,
      o - 96,
      7 + index,
      (t) => Math.sin(t * Math.PI * 2) * (2.5 + wide),
      undefined,
      sectionMetadata(LEVEL_SECTIONS.SWAY_TRAIL, difficulty),
    );

    // Jump log — fruit arc previews the log jump landing lane.
    addFruitLine(
      fruits,
      o - 108,
      o - 130,
      5 + index,
      () => (index % 2 === 0 ? 0 : 0.5),
      (t) => 1.05 + Math.sin(t * Math.PI) * 1.5,
      sectionMetadata(
        LEVEL_SECTIONS.JUMP_LOG,
        difficulty,
        index === 0 ? "Tap jump to clear the log." : undefined,
      ),
    );

    // High fruit — bigger arc rewards a higher or double jump without moving the generated path.
    addFruitLine(
      fruits,
      o - 140,
      o - 162,
      6 + index,
      () => (index % 2 === 0 ? 0.8 : -0.8),
      (t) => 1.05 + Math.sin(t * Math.PI) * 2.35,
      sectionMetadata(LEVEL_SECTIONS.HIGH_FRUIT, difficulty),
    );

    // Slide branch — low fruit line telegraphs ducking before the branch.
    addFruitLine(
      fruits,
      o - 174,
      o - 190,
      5 + index,
      () => 0,
      () => 0.88,
      sectionMetadata(
        LEVEL_SECTIONS.SLIDE_BRANCH,
        difficulty,
        index === 0 ? "Hold slide to belly under the branch." : undefined,
      ),
    );

    // Smash crate — short center sweep leads into the crate smash target.
    addFruitLine(
      fruits,
      o - 204,
      o - 214,
      4 + index,
      (t) => -1 + t * 2,
      () => 1.05,
      sectionMetadata(LEVEL_SECTIONS.SMASH_CRATE, difficulty),
    );

    logs.push({ localX: index % 2 === 0 ? 0 : -0.6, z: o - 120, width: 10.5 - index * 0.45, height: 1.15, depth: 1.25, section: LEVEL_SECTIONS.JUMP_LOG, difficulty });

    // Low enough for a standing elephant to clip, high enough for a belly-slide to clear.
    branches.push({ localX: index % 2 === 0 ? 0 : 0.8, z: o - 182, width: 12.25 - index * 0.3, height: 0.75, depth: 1.35, yOffset: 1.95, section: LEVEL_SECTIONS.SLIDE_BRANCH, difficulty });

    crates.push({ localX: index % 2 === 0 ? 0 : 1.2, z: o - 206, width: 2.15, height: 2.15, depth: 2.15, section: LEVEL_SECTIONS.SMASH_CRATE, difficulty });
    if (index > 0) crates.push({ localX: index % 2 === 0 ? -2.65 : 2.65, z: o - 216, width: 2.15, height: 2.15, depth: 2.15, section: LEVEL_SECTIONS.SMASH_CRATE, difficulty });

    // River/croc — water gap plus crocodile phases for the loop's hazard tempo.
    rivers.push({
      z: o - 228, width: 15.5, depth: 12.5 + index * 1.5,
      ...sectionMetadata(
        LEVEL_SECTIONS.RIVER_CROC,
        difficulty,
        index === 0 ? "Time your path through the crocodiles." : undefined,
      ),
      crocs: index < 2
        ? [{ localX: -2.4, phase: index * 0.55 }, { localX: 2.5, phase: 2.4 + index * 0.4 }]
        : [{ localX: -3.1, phase: 0.3 + index }, { localX: 0, phase: 1.6 + index }, { localX: 3.1, phase: 2.8 + index }],
    });

    // Health recovery — post-river pickup gives breathing room after hazard damage.
    health.push({ localX: index % 2 === 0 ? 0 : -1.8, z: o - 240, section: LEVEL_SECTIONS.HEALTH_RECOVERY });

    // Monkey — patrol monkeys, one pair per loop, difficulty scales with loop index.
    enemies.push({ localX: index % 2 === 0 ? 0 : 1.5, z: o - 44, patrolRange: 2.5 + index * 0.5, patrolSpeed: 1.8 + index * 0.4, baseLocalX: index % 2 === 0 ? 0 : 1.5, section: LEVEL_SECTIONS.MONKEY, difficulty });
    enemies.push({ localX: index % 2 === 0 ? -2 : 2, z: o - 160, patrolRange: 3.0 + index * 0.5, patrolSpeed: 2.2 + index * 0.5, baseLocalX: index % 2 === 0 ? -2 : 2, section: LEVEL_SECTIONS.MONKEY, difficulty });

    // Pineapple — high-value collectibles, placed off the beaten path.
    collectibles.push({ localX: index % 2 === 0 ? -3.8 : 3.8, z: o - 72, y: 1.6, section: LEVEL_SECTIONS.PINEAPPLE, difficulty });
    collectibles.push({ localX: index % 2 === 0 ? 3.5 : -3.5, z: o - 195, y: 3.2, section: LEVEL_SECTIONS.PINEAPPLE, difficulty });
  });
  // Fruit guide finale — final generated trail into the gate approach.
  addFruitLine(
    fruits,
    -700,
    -760,
    9,
    (t) => Math.sin(t * Math.PI * 2) * 2.8,
    (t) => 1.05 + Math.sin(t * Math.PI) * 0.9,
    sectionMetadata(LEVEL_SECTIONS.FRUIT_GUIDE, "finale"),
  );
  return {
    fruits,
    health,
    logs,
    crates,
    branches,
    rivers,
    enemies,
    collectibles,
    gate: { z: CONFIG.gateZ },
    finish: { z: CONFIG.finishLineZ, failSafeZ: CONFIG.endOfCourseZ },
  };
}

export const LEVEL = buildLevel();
