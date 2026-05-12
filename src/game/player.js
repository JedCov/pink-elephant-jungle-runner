import { CONFIG, MOVEMENT } from "./config.js";
import { clamp, lerp } from "./math.js";
import { trackAngle, trackCenter } from "./track.js";

export function createPlayerBody(overrides = {}) {
  return {
    localX: 0,
    x: trackCenter(CONFIG.startZ),
    y: CONFIG.playerSize / 2,
    z: CONFIG.startZ,
    speed: 0,
    yVelocity: 0,
    coyoteTimer: MOVEMENT.coyoteTime,
    jumpBufferTimer: 0,
    grounded: true,
    jumpHeld: false,
    doubleUsed: false,
    spaceHeldTimer: 0,
    spaceActionResolved: false,
    bufferedSlide: false,
    slideTimer: 0,
    hurtTimer: 0,
    smashTimer: 0,
    smashActionTimer: 0,
    spinTimer: 0,
    yaw: 0,
    health: 100,
    lives: 5,
    fruit: 0,
    fruitLifeCounter: 0,
    crates: 0,
    score: 0,
    multiplier: 1,
    multiplierCombo: 0,
    multiplierTimer: 0,
    state: "Ready",
    completed: false,
    lastPrompt: "",
    ...overrides,
  };
}

export function tickPlayerTimers(body, dt) {
  body.hurtTimer = Math.max(0, body.hurtTimer - dt);
  body.smashTimer = Math.max(0, body.smashTimer - dt);
  body.smashActionTimer = Math.max(0, body.smashActionTimer - dt);
  body.slideTimer = Math.max(0, body.slideTimer - dt);
  body.jumpBufferTimer = Math.max(0, body.jumpBufferTimer - dt);
  body.spinTimer = Math.max(0, body.spinTimer - dt);
  body.multiplierTimer = Math.max(0, body.multiplierTimer - dt);
  if (body.multiplierTimer <= 0 && body.multiplier > 1) {
    body.multiplier = 1;
    body.multiplierCombo = 0;
  }
  if (body.grounded) body.coyoteTimer = MOVEMENT.coyoteTime;
  else body.coyoteTimer = Math.max(0, body.coyoteTimer - dt);
  return body;
}

export function getPlayerInputIntent(body, keys, playing) {
  const wantsSlide = false;
  const wantsReverse = playing && keys.ArrowDown && body.grounded;
  const wantsForward = playing && keys.ArrowUp && !wantsReverse;
  return { wantsSlide, wantsReverse, wantsForward };
}

export function updatePlayerSpeed(body, dt, playing, intent) {
  if (playing && (body.hurtTimer === 0 || intent.wantsReverse)) {
    if (intent.wantsForward) {
      body.speed = Math.min(MOVEMENT.maxSpeed, body.speed + MOVEMENT.acceleration * dt);
    } else if (intent.wantsReverse) {
      body.speed = Math.max(-MOVEMENT.reverseMaxSpeed, body.speed - MOVEMENT.reverseAcceleration * dt);
    } else {
      body.speed *= Math.exp(-MOVEMENT.friction * dt);
      const idleStep = MOVEMENT.idleDeceleration * dt;
      body.speed = Math.abs(body.speed) <= idleStep ? 0 : body.speed - Math.sign(body.speed) * idleStep;
    }
    if (Math.abs(body.speed) < MOVEMENT.minSpeed) body.speed = 0;
  } else if (playing) {
    body.speed *= Math.exp(-MOVEMENT.friction * dt);
    if (Math.abs(body.speed) < MOVEMENT.minSpeed) body.speed = 0;
  } else {
    body.speed = 0;
  }
  return body.speed;
}

export function updatePlayerSteering(body, keys, dt, playing, z) {
  let nextLocalX = body.localX;
  if (playing && body.hurtTimer === 0) {
    const steer = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    nextLocalX = clamp(nextLocalX + steer * MOVEMENT.steerSpeed * dt, -CONFIG.corridorHalfWidth, CONFIG.corridorHalfWidth);
    body.yaw = lerp(body.yaw, steer * MOVEMENT.steeringYawLean + trackAngle(z), 1 - Math.exp(-MOVEMENT.turnDamping * dt));
  }
  return nextLocalX;
}

export function startPlayerSlide(body) {
  if (body.slideTimer > 0 || body.speed <= MOVEMENT.slideStartMinSpeed) return false;
  body.slideTimer = MOVEMENT.slideDuration;
  body.bufferedSlide = false;
  return true;
}

export function startGroundJump(body) {
  body.yVelocity = MOVEMENT.jumpVelocity;
  body.grounded = false;
  body.coyoteTimer = 0;
  body.jumpBufferTimer = 0;
  body.doubleUsed = false;
  return "ground";
}

export function startDoubleJump(body) {
  body.yVelocity = MOVEMENT.doubleJumpVelocity;
  body.doubleUsed = true;
  body.jumpBufferTimer = 0;
  return "double";
}

export function triggerJumpOrDoubleJump(body, playing) {
  if (!playing || body.slideTimer > 0) return null;
  if (body.grounded || body.coyoteTimer > 0) return startGroundJump(body);
  if (!body.doubleUsed) return startDoubleJump(body);
  body.jumpBufferTimer = MOVEMENT.jumpBufferTime;
  return "buffered";
}

export function updateJumpAndSlideInput(body, keys, dt, playing) {
  const events = [];
  const spaceDown = keys.Space;
  const spaceJustReleased = !spaceDown && body.jumpHeld;

  if (spaceDown && !body.jumpHeld) {
    body.spaceHeldTimer = 0;
    body.spaceActionResolved = false;
    body.bufferedSlide = false;
  }
  if (spaceDown && !body.spaceActionResolved && playing) {
    body.spaceHeldTimer += dt;
    if (body.spaceHeldTimer >= MOVEMENT.slideHoldThreshold) {
      body.spaceActionResolved = true;
      if (body.grounded) {
        if (startPlayerSlide(body)) events.push("slide");
      } else {
        body.bufferedSlide = true;
        events.push("slide-buffered");
      }
    }
  }
  if (spaceJustReleased && !body.spaceActionResolved) {
    events.push(triggerJumpOrDoubleJump(body, playing));
    body.spaceActionResolved = true;
  }

  body.jumpHeld = spaceDown;
  if (playing && body.bufferedSlide && body.grounded) {
    if (startPlayerSlide(body)) events.push("slide");
  }
  return events.filter(Boolean);
}

export function updatePlayerAir(body, y, dt) {
  if (body.grounded) return { y, landed: false, bufferedJump: false };

  const gravityMultiplier = body.yVelocity < 0 ? MOVEMENT.fallGravityMultiplier : 1;
  body.yVelocity += MOVEMENT.gravity * gravityMultiplier * dt;
  let nextY = y + body.yVelocity * dt;
  const groundY = CONFIG.playerSize / 2;
  let landed = false;
  let bufferedJump = false;

  if (nextY <= groundY) {
    nextY = groundY;
    body.yVelocity = 0;
    body.grounded = true;
    body.coyoteTimer = MOVEMENT.coyoteTime;
    body.doubleUsed = false;
    landed = true;
    if (body.jumpBufferTimer > 0 && body.slideTimer <= 0) {
      startGroundJump(body);
      nextY = body.y;
      bufferedJump = true;
    }
  }

  return { y: nextY, landed, bufferedJump };
}

export function triggerPlayerSmash(body, playing) {
  if (!playing || body.smashActionTimer > 0) return false;
  body.smashActionTimer = MOVEMENT.smashActionDuration;
  body.smashTimer = Math.max(body.smashTimer, MOVEMENT.smashFeedbackDuration);
  return true;
}

export function triggerPlayerSpin(body, playing) {
  if (!playing || body.spinTimer > 0) return false;
  body.spinTimer = MOVEMENT.spinDuration;
  return true;
}

export function selectPlayerStateLabel(body, charge) {
  if (body.completed) return "Jungle Gate";
  if (body.lives <= 0) return "Herd Resting";
  if (body.hurtTimer > 0) return "Jungle Bump";
  if (body.spinTimer > 0) return "Spin Attack";
  if (body.smashTimer > 0) return "Trunk-Smash";
  if (body.slideTimer > 0) return "Belly-Slide";
  if (!body.grounded) return body.doubleUsed ? "BIG Bounce" : "Leap";
  if (charge > MOVEMENT.mightyChargeThreshold) return "Mighty Charge";
  if (body.speed > MOVEMENT.movingStateMinSpeed) return "Charging";
  return "Ready";
}
