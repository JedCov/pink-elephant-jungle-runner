// @ts-check

/** @typedef {import("./types.js").ColliderBox} ColliderBox */

/**
 * Clamp a value between a minimum and maximum.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Linearly interpolate between two numbers.
 *
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Test whether two axis-aligned bounding boxes overlap.
 *
 * @param {ColliderBox} a
 * @param {ColliderBox} b
 * @returns {boolean}
 */
export function aabb(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}
