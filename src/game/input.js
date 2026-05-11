const ALLOWED_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyZ", "KeyE", "KeyD", "ShiftLeft", "ShiftRight"];

export function createKeys() {
  return { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, Space: false, KeyZ: false, KeyE: false, KeyD: false, ShiftLeft: false, ShiftRight: false, __dHeld: false };
}

export function isAllowedKey(code) {
  return ALLOWED_KEYS.includes(code);
}
