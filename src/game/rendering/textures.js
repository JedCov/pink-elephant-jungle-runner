import * as THREE from "three";

export function makeGroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#173d25";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(120,230,130,0.12)" : "rgba(18,65,34,0.24)";
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 4, 1 + Math.random() * 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 42);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makePathTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b87938";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,218,145,0.16)" : "rgba(72,42,22,0.12)";
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.15, 1.8);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeWaterRippleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, "#0f5f91");
  gradient.addColorStop(0.45, "#1a91c8");
  gradient.addColorStop(1, "#0b4d78");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);

  for (let y = -32; y < 560; y += 24) {
    const waveOffset = Math.sin(y * 0.035) * 32;
    ctx.beginPath();
    for (let x = -24; x <= 536; x += 16) {
      const py = y + Math.sin((x + y) * 0.045) * 7;
      if (x === -24) ctx.moveTo(x, py);
      else ctx.lineTo(x + waveOffset, py);
    }
    ctx.strokeStyle = "rgba(181,241,255,0.28)";
    ctx.lineWidth = 2 + ((y / 24) % 3);
    ctx.stroke();
  }

  for (let i = 0; i < 120; i++) {
    const x = (i * 73) % 512;
    const y = (i * 131) % 512;
    const radius = 10 + (i % 9) * 2.5;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, 2.5 + (i % 4), (i % 7) * 0.26, 0, Math.PI * 2);
    ctx.strokeStyle = i % 3 === 0 ? "rgba(255,255,255,0.24)" : "rgba(80,205,235,0.20)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.8, 2.8);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeFoamStreakTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 256);

  for (let i = 0; i < 54; i++) {
    const x = -32 + ((i * 47) % 320);
    const y = 10 + ((i * 29) % 236);
    const length = 28 + (i % 6) * 11;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + length * 0.35, y - 5 - (i % 4), x + length * 0.65, y + 6 + (i % 5), x + length, y + Math.sin(i) * 5);
    ctx.strokeStyle = i % 4 === 0 ? "rgba(255,255,255,0.72)" : "rgba(221,250,255,0.48)";
    ctx.lineWidth = 1.5 + (i % 3) * 0.7;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.55)" : "rgba(217,249,255,0.35)";
    ctx.beginPath();
    ctx.arc((i * 61) % 256, (i * 97) % 256, 0.7 + (i % 4) * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.2, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
