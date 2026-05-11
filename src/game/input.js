const ALLOWED_KEYS = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyZ",
  "KeyE",
  "ShiftLeft",
  "ShiftRight",
  "Backquote",
];

function syncVirtualControls(keys) {
  const pressed = keys.__pressed;
  keys.ArrowUp = Boolean(pressed.ArrowUp || pressed.KeyW);
  keys.ArrowDown = Boolean(pressed.ArrowDown || pressed.KeyS);
  keys.ArrowLeft = Boolean(pressed.ArrowLeft || pressed.KeyA);
  keys.ArrowRight = Boolean(pressed.ArrowRight || pressed.KeyD);
  keys.Space = Boolean(pressed.Space || pressed.ShiftLeft || pressed.ShiftRight);
  keys.KeyZ = Boolean(pressed.KeyZ);
  keys.KeyE = Boolean(pressed.KeyE);
  keys.KeyW = Boolean(pressed.KeyW);
  keys.KeyA = Boolean(pressed.KeyA);
  keys.KeyS = Boolean(pressed.KeyS);
  keys.KeyD = Boolean(pressed.KeyD);
  keys.ShiftLeft = Boolean(pressed.ShiftLeft);
  keys.ShiftRight = Boolean(pressed.ShiftRight);
}

export function createKeys() {
  const keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    Space: false,
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    KeyZ: false,
    KeyE: false,
    ShiftLeft: false,
    ShiftRight: false,
    __pressed: Object.fromEntries(ALLOWED_KEYS.map((code) => [code, false])),
  };
  syncVirtualControls(keys);
  return keys;
}

export function setKeyState(keys, code, isPressed) {
  if (!isAllowedKey(code)) return keys;
  keys.__pressed[code] = isPressed;
  syncVirtualControls(keys);
  return keys;
}

export function isAllowedKey(code) {
  return ALLOWED_KEYS.includes(code);
}
