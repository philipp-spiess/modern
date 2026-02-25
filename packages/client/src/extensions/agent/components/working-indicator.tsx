import { memo, useEffect, useRef } from "react";

/**
 * Miniature animated grid — a smaller (3×3) version of the splash-screen logo,
 * used as a working/loading indicator.
 */
export const WorkingIndicator = memo(function WorkingIndicator() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 14;
    const inset = 1.5;
    const gridCells = 3;
    const gridSize = size - inset * 2;
    const step = gridSize / gridCells;
    const segments = 16;
    const startTime = performance.now();
    let frame = 0;

    const ensureResolution = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(size * dpr);
      const h = Math.round(size * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

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
      return a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v;
    };

    const fbm = (x: number, y: number) => {
      let total = 0;
      let amp = 0.5;
      let freq = 1;
      for (let i = 0; i < 3; i++) {
        total += valueNoise(x * freq, y * freq) * amp;
        freq *= 2;
        amp *= 0.5;
      }
      return total / 0.875;
    };

    const warpPoint = (x: number, y: number, phase: number) => {
      const nx = (x - inset) / gridSize;
      const ny = (y - inset) / gridSize;
      const flow = phase * 0.8;
      const pulse = 0.92 + 0.14 * Math.sin(phase * 1.2);
      const amplitude = 1.3 * pulse;
      const cx = nx - 0.5;
      const cy = ny - 0.5;
      const radial = Math.min(1, Math.hypot(cx, cy) / 0.72);
      const interiorBoost = 1 - smoothStep(radial);

      const noiseX = fbm(nx * 2.25 + flow, ny * 2.25 - flow * 0.7) * 2 - 1;
      const noiseY = fbm(nx * 2.25 - flow * 0.55 + 13.7, ny * 2.25 + flow + 7.9) * 2 - 1;
      const swirlWeight = 0.12 + 0.46 * interiorBoost;
      const swirl = Math.sin((nx + ny + phase * 0.24) * Math.PI * 2) * swirlWeight;

      return {
        x: x + amplitude * (noiseX + swirl),
        y: y + amplitude * (noiseY - swirl * 1.05),
      };
    };

    const drawWarpedLine = (fromX: number, fromY: number, toX: number, toY: number, phase: number, width: number) => {
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const warped = warpPoint(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, phase);
        if (i === 0) ctx.moveTo(warped.x, warped.y);
        else ctx.lineTo(warped.x, warped.y);
      }
      ctx.stroke();
    };

    const draw = (time: number) => {
      ensureResolution();
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";

      const phase = (time - startTime) * 0.0011;

      for (let i = 0; i <= gridCells; i++) {
        const x = inset + i * step;
        drawWarpedLine(x, inset, x, inset + gridSize, phase, 0.75);
      }
      for (let i = 0; i <= gridCells; i++) {
        const y = inset + i * step;
        drawWarpedLine(inset, y, inset + gridSize, y, phase, 0.75);
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-white/30">
      <canvas ref={canvasRef} className="size-3.5 shrink-0" aria-hidden />
      <span>Working…</span>
    </div>
  );
});
