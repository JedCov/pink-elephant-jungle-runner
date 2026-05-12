import { CONFIG } from "./config.js";

export function playerBox(nx, ny, nz, sliding = false) {
  const hw = (CONFIG.playerSize * CONFIG.hitboxScale) / 2;
  const hh = sliding ? CONFIG.playerSize * 0.25 : (CONFIG.playerSize * CONFIG.hitboxScale) / 2;
  const hd = (CONFIG.playerSize * CONFIG.hitboxScale) / 2;
  return { minX: nx - hw, maxX: nx + hw, minY: ny - hh, maxY: ny + hh, minZ: nz - hd, maxZ: nz + hd };
}

export function obstacleBox(obs) {
  return {
    minX: obs.x - obs.w / 2, maxX: obs.x + obs.w / 2,
    minY: obs.y - obs.h / 2, maxY: obs.y + obs.h / 2,
    minZ: obs.z - obs.d / 2, maxZ: obs.z + obs.d / 2,
  };
}

export function branchHitsPlayer(playerAabb, branchAabb) {
  return playerAabb.maxY >= branchAabb.minY;
}
