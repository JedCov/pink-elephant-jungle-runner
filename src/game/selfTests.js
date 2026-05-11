import { aabb, clamp, lerp } from "./math.js";
import { trackCenter, worldX } from "./track.js";

export function runSelfTests() {
  const results = [];
  const assert = (name, condition) => results.push({ name, pass: Boolean(condition) });
  assert("clamp caps high values", clamp(12, 0, 10) === 10);
  assert("clamp caps low values", clamp(-2, 0, 10) === 0);
  assert("lerp halfway", lerp(0, 10, 0.5) === 5);
  assert("aabb detects overlap", aabb({ minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 2 }, { minX: 1, maxX: 3, minY: 1, maxY: 3, minZ: 1, maxZ: 3 }));
  assert("aabb detects separation", !aabb({ minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }, { minX: 2, maxX: 3, minY: 2, maxY: 3, minZ: 2, maxZ: 3 }));
  assert("worldX honours local offset", Math.abs(worldX(2, -50) - trackCenter(-50) - 2) < 0.00001);
  return results;
}
