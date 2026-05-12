import { SCORING } from "./config.js";

export function applyFruitLifeCounter(currentCounter, amount, threshold = SCORING.fruitLifeThreshold) {
  const nextTotal = Math.max(0, currentCounter) + Math.max(0, amount);
  const livesAwarded = Math.floor(nextTotal / threshold);
  return {
    counter: nextTotal % threshold,
    livesAwarded,
  };
}
