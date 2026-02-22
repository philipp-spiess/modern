/**
 * Generates SVG frames of the Modern logo (warped grid).
 * Run: bun scripts/logo-svg-frames.ts
 * Output: scripts/logo-frames/*.svg
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Constants (same as canvas version) ──────────────────────────────
const size = 256; // bigger for crisp export
const inset = 56; // inner padding between grid and icon edge
const gridCells = 6;
const gridSize = size - inset * 2;
const step = gridSize / gridCells;
const segments = 64;

// ── Math helpers (ported 1:1) ───────────────────────────────────────
const smoothStep = (v: number) => v * v * (3 - 2 * v);

const hash2 = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return v - Math.floor(v);
};

const valueNoise = (x: number, y: number) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;

  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);

  const u = smoothStep(tx);
  const v = smoothStep(ty);

  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
};

const fbm = (x: number, y: number) => {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < 3; i++) {
    total += valueNoise(x * frequency, y * frequency) * amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return total / 0.875;
};

const warpPoint = (x: number, y: number, phase: number) => {
  const nx = (x - inset) / gridSize;
  const ny = (y - inset) / gridSize;
  const flow = phase * 0.9;
  const pulse = 0.88 + 0.26 * Math.sin(phase * 1.35);
  const amplitude = (2.75 * pulse * size) / 64; // scale amplitude to size
  const centerX = nx - 0.5;
  const centerY = ny - 0.5;
  const radial = Math.min(1, Math.hypot(centerX, centerY) / 0.72);
  const interiorBoost = 1 - smoothStep(radial);

  const noiseX = fbm(nx * 2.25 + flow, ny * 2.25 - flow * 0.7) * 2 - 1;
  const noiseY = fbm(nx * 2.25 - flow * 0.55 + 13.7, ny * 2.25 + flow + 7.9) * 2 - 1;
  const swirlWeight = 0.22 + 0.86 * interiorBoost;
  const swirl = Math.sin((nx + ny + phase * 0.24) * Math.PI * 2) * swirlWeight;

  const dx = amplitude * (noiseX + swirl);
  const dy = amplitude * (noiseY - swirl * 1.05);

  return { x: x + dx, y: y + dy };
};

// ── SVG path for one warped line ────────────────────────────────────
function warpedLinePath(fromX: number, fromY: number, toX: number, toY: number, phase: number): string {
  const parts: string[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;
    const w = warpPoint(x, y, phase);
    parts.push(`${i === 0 ? "M" : "L"}${w.x.toFixed(2)},${w.y.toFixed(2)}`);
  }
  return parts.join(" ");
}

// ── Build grid paths for a given phase ───────────────────────────────
function buildGridPaths(phase: number): string[] {
  const paths: string[] = [];

  for (let i = 0; i <= gridCells; i++) {
    const x = inset + i * step;
    paths.push(warpedLinePath(x, inset, x, inset + gridSize, phase));
  }

  for (let i = 0; i <= gridCells; i++) {
    const y = inset + i * step;
    paths.push(warpedLinePath(inset, y, inset + gridSize, y, phase));
  }

  return paths;
}

// ── Rounded icon SVG (with padding + rounded rect + clip) ───────────
function renderIcon(phase: number): string {
  const paths = buildGridPaths(phase);
  const pathElements = paths
    .map(
      (d) =>
        `  <path d="${d}" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("\n");

  const pad = size * 0.08;
  const rr = size * 0.18;
  const rx = pad;
  const ry = pad;
  const rw = size - pad * 2;
  const rh = size - pad * 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#171717"/>
      <stop offset="100%" stop-color="#D4D4D4"/>
    </linearGradient>
    <clipPath id="icon-clip">
      <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${rr}"/>
    </clipPath>
  </defs>
  <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${rr}" fill="#171717"/>
  <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${rr}" fill="url(#bg)" opacity="0.05"/>
  <g clip-path="url(#icon-clip)">
${pathElements}
  </g>
</svg>`;
}

// ── Full-bleed source SVG (no padding, no rounded rect) ─────────────
function renderSource(phase: number): string {
  const paths = buildGridPaths(phase);
  const pathElements = paths
    .map(
      (d) =>
        `  <path d="${d}" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#171717"/>
      <stop offset="100%" stop-color="#D4D4D4"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="#171717"/>
  <rect width="${size}" height="${size}" fill="url(#bg)" opacity="0.05"/>
${pathElements}
</svg>`;
}

// ── Write SVGs + render all PNGs ────────────────────────────────────
import { execSync } from "node:child_process";

const outDir = join(import.meta.dirname, "logo-frames");
const iconsDir = join(import.meta.dirname, "..", "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

const phase = (6 / 8) * Math.PI * 2;

// Write SVGs
const iconSvg = join(outDir, "icon.svg");
const sourceSvg = join(outDir, "source.svg");
writeFileSync(iconSvg, renderIcon(phase));
writeFileSync(sourceSvg, renderSource(phase));
console.log(`✓ ${iconSvg}`);
console.log(`✓ ${sourceSvg}`);

// Rounded-rect icon sizes (RGBA with transparency)
const iconSizes: [string, number][] = [
  ["icon.png", 512],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["32x32.png", 32],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
];

// Full-bleed source (no rounded rect)
const sourceSizes: [string, number][] = [["modern-source.png", 1024]];

for (const [name, px] of iconSizes) {
  const out = join(iconsDir, name);
  execSync(`rsvg-convert -w ${px} -h ${px} "${iconSvg}" -o "${out}"`);
  console.log(`✓ ${out} (${px}×${px})`);
}

for (const [name, px] of sourceSizes) {
  const out = join(iconsDir, name);
  execSync(`rsvg-convert -w ${px} -h ${px} "${sourceSvg}" -o "${out}"`);
  console.log(`✓ ${out} (${px}×${px})`);
}

// Generate .icns (macOS) and .ico (Windows) from icon.png
const icon512 = join(iconsDir, "icon.png");
const icns = join(iconsDir, "icon.icns");
const ico = join(iconsDir, "icon.ico");

execSync(`magick "${icon512}" -define icon:auto-resize=256,128,64,48,32,16 "${ico}"`);
console.log(`✓ ${ico}`);

// macOS .icns via iconutil
const iconsetDir = join(outDir, "icon.iconset");
mkdirSync(iconsetDir, { recursive: true });
const icnsSizes = [16, 32, 64, 128, 256, 512];
for (const px of icnsSizes) {
  execSync(`rsvg-convert -w ${px} -h ${px} "${iconSvg}" -o "${iconsetDir}/icon_${px}x${px}.png"`);
  execSync(`rsvg-convert -w ${px * 2} -h ${px * 2} "${iconSvg}" -o "${iconsetDir}/icon_${px}x${px}@2x.png"`);
}
execSync(`iconutil -c icns -o "${icns}" "${iconsetDir}"`);
console.log(`✓ ${icns}`);

console.log("\nDone — all icons regenerated!");
