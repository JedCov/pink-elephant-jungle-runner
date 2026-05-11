import { CONFIG } from "./config.js";
import { lerp } from "./math.js";

function addFruitLine(fruits, startZ, endZ, count, localXFn, yFn) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const z = lerp(startZ, endZ, t);
    fruits.push({ localX: localXFn(t, z), z, y: yFn ? yFn(t, z) : 1.05 });
  }
}

export function buildLevel() {
  const fruits = [], health = [], logs = [], crates = [], branches = [], rivers = [], enemies = [], collectibles = [];
  const loops = [0, 245, 490];
  loops.forEach((offset, index) => {
    const o = -offset;
    const wide = index === 0 ? 0 : 0.25;
    addFruitLine(fruits, o - 16, o - 54, 7 + index, () => 0);
    addFruitLine(fruits, o - 66, o - 96, 7 + index, (t) => Math.sin(t * Math.PI * 2) * (2.5 + wide));
    addFruitLine(fruits, o - 108, o - 130, 5 + index, () => (index % 2 === 0 ? 0 : 0.5), (t) => 1.05 + Math.sin(t * Math.PI) * 1.5);
    addFruitLine(fruits, o - 140, o - 162, 6 + index, () => (index % 2 === 0 ? 0.8 : -0.8), (t) => 1.05 + Math.sin(t * Math.PI) * 2.35);
    addFruitLine(fruits, o - 174, o - 190, 5 + index, () => 0, () => 0.88);
    addFruitLine(fruits, o - 204, o - 214, 4 + index, (t) => -1 + t * 2, () => 1.05);
    logs.push({ localX: index % 2 === 0 ? 0 : -0.6, z: o - 120, width: 10.5 - index * 0.45, height: 1.15, depth: 1.25 });
    branches.push({ localX: index % 2 === 0 ? 0 : 0.8, z: o - 182, width: 12.25 - index * 0.3, height: 0.75, depth: 1.35, yOffset: 2.8 });
    crates.push({ localX: index % 2 === 0 ? 0 : 1.2, z: o - 206, width: 2.15, height: 2.15, depth: 2.15 });
    if (index > 0) crates.push({ localX: index % 2 === 0 ? -2.65 : 2.65, z: o - 216, width: 2.15, height: 2.15, depth: 2.15 });
    rivers.push({
      z: o - 228, width: 15.5, depth: 12.5 + index * 1.5,
      crocs: index < 2
        ? [{ localX: -2.4, phase: index * 0.55 }, { localX: 2.5, phase: 2.4 + index * 0.4 }]
        : [{ localX: -3.1, phase: 0.3 + index }, { localX: 0, phase: 1.6 + index }, { localX: 3.1, phase: 2.8 + index }],
    });
    health.push({ localX: index % 2 === 0 ? 0 : -1.8, z: o - 240 });

    // Patrol monkeys — one per loop, difficulty scales with loop index
    enemies.push({ localX: index % 2 === 0 ? 0 : 1.5, z: o - 44, patrolRange: 2.5 + index * 0.5, patrolSpeed: 1.8 + index * 0.4, baseLocalX: index % 2 === 0 ? 0 : 1.5 });
    enemies.push({ localX: index % 2 === 0 ? -2 : 2, z: o - 160, patrolRange: 3.0 + index * 0.5, patrolSpeed: 2.2 + index * 0.5, baseLocalX: index % 2 === 0 ? -2 : 2 });

    // Golden pineapple collectibles — high-value, placed off the beaten path
    collectibles.push({ localX: index % 2 === 0 ? -3.8 : 3.8, z: o - 72, y: 1.6 });
    collectibles.push({ localX: index % 2 === 0 ? 3.5 : -3.5, z: o - 195, y: 3.2 });
  });
  addFruitLine(fruits, -700, -760, 9, (t) => Math.sin(t * Math.PI * 2) * 2.8, (t) => 1.05 + Math.sin(t * Math.PI) * 0.9);
  return { fruits, health, logs, crates, branches, rivers, enemies, collectibles, gate: { z: CONFIG.gateZ } };
}

export const LEVEL = buildLevel();
