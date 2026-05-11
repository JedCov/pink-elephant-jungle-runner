export function trackCenter(z) {
  const p = Math.max(0, Math.abs(z));
  return Math.sin(p / 82) * 3 + Math.sin(p / 215) * 4.2 + Math.sin(p / 37) * 0.85;
}

export function trackAngle(z) {
  return Math.atan2(trackCenter(z - 4) - trackCenter(z + 4), 8);
}

export function worldX(localX, z) {
  return trackCenter(z) + localX;
}
