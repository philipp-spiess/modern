import { useQuery } from "@tanstack/react-query";
import { FolderIcon, FolderPlusIcon, GlobeIcon, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { orpc } from "../lib/rpc";
import { openWorkspace } from "../lib/workspace";
import { dirname } from "../utils/path";

type SplashScreenProps = {
  onClose: () => void;
};

function SplashScreen({ onClose }: SplashScreenProps) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handleOpenProject = useCallback(async () => {
    await openWorkspace();
    onClose();
  }, [onClose]);

  const handleOpenRepo = useCallback(
    async (repoPath: string) => {
      await openWorkspace(repoPath);
      onClose();
    },
    [onClose],
  );

  const recentReposQuery = useQuery(
    orpc.workspace.recentRepos.queryOptions({
      queryKey: ["workspace", "recentRepos"],
      input: { limit: 5 },
    }),
  );

  const repos = recentReposQuery.data?.repos ?? [];

  return (
    <div
      data-tauri-drag-region
      className="fixed inset-0 z-50 bg-neutral-900/75 backdrop-blur-xl text-white"
      onClick={onClose}
    >
      <div
        data-tauri-drag-region
        className="mx-auto flex size-full max-w-[1320px] flex-col items-center justify-center px-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto flex items-center gap-4">
          <SplashLogo />
          <span className="text-5xl inline-block relative -top-[5px] tracking-tight font-light select-none">
            Modern
          </span>
        </div>

        <section className="mx-auto mt-14 grid w-full max-w-[620px] grid-cols-1 gap-4 sm:grid-cols-3">
          <SplashCard Icon={FolderIcon} label="Open project" onAction={handleOpenProject} />
          <SplashCard Icon={GlobeIcon} label="Clone from URL" />
          <SplashCard Icon={FolderPlusIcon} label="Quick start" />
        </section>

        {repos.length > 0 && (
          <section className="mx-auto mt-8 w-full max-w-[620px]">
            <h2 className="mb-2 text-xs text-white/40">Recent</h2>
            <div className="rounded-lg bg-neutral-900/75 shadow inset-shadow-sm inset-shadow-white/3 outline -outline-offset-1 outline-white/10 overflow-hidden">
              {repos.map((repo) => (
                <button
                  key={repo.path}
                  type="button"
                  onClick={() => void handleOpenRepo(repo.path)}
                  className="flex w-full items-center gap-3 px-3.5 py-2 text-left text-sm transition-colors hover:bg-white/[0.06] border-b border-white/5 last:border-b-0"
                >
                  <FolderIcon className="size-3.5 shrink-0 text-white/40" strokeWidth={1.75} />
                  <span className="font-medium text-white/80 shrink-0">{repo.name}</span>
                  <span className="truncate text-xs text-white/30">{shortenHome(dirname(repo.path))}</span>
                  <span className="ml-auto shrink-0 text-xs text-white/25">{formatAge(repo.updatedAt)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function shortenHome(dirPath: string): string {
  const match = dirPath.match(/^\/(?:Users|home)\/[^/]+\/(.*)/);
  return match ? `~/${match[1]}` : dirPath;
}

function formatAge(timestampMs: number): string {
  const elapsed = Math.max(0, Date.now() - timestampMs);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;

  if (elapsed < minute) return "just now";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`;
  if (elapsed < week) return `${Math.floor(elapsed / day)}d ago`;
  if (elapsed < month) return `${Math.floor(elapsed / week)}w ago`;
  return `${Math.floor(elapsed / month)}mo ago`;
}

function SplashLogo() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const size = 64;
    const inset = 6;
    const gridCells = 6;
    const gridSize = size - inset * 2;
    const step = gridSize / gridCells;
    const segments = 48;
    const startTime = performance.now();
    let animationFrameId = 0;

    const ensureResolution = () => {
      const dpr = window.devicePixelRatio || 1;
      const nextWidth = Math.round(size * dpr);
      const nextHeight = Math.round(size * dpr);

      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const smoothStep = (value: number) => value * value * (3 - 2 * value);

    const hash2 = (x: number, y: number) => {
      const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
      return value - Math.floor(value);
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

      for (let i = 0; i < 3; i += 1) {
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
      const amplitude = 2.75 * pulse;
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

    const drawWarpedLine = (fromX: number, fromY: number, toX: number, toY: number, phase: number, width: number) => {
      ctx.lineWidth = width;
      ctx.beginPath();

      for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        const x = fromX + (toX - fromX) * t;
        const y = fromY + (toY - fromY) * t;
        const warped = warpPoint(x, y, phase);

        if (i === 0) {
          ctx.moveTo(warped.x, warped.y);
        } else {
          ctx.lineTo(warped.x, warped.y);
        }
      }

      ctx.stroke();
    };

    const draw = (time: number) => {
      ensureResolution();

      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = "#ffffff";
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      ctx.globalAlpha = 1;

      const elapsed = time - startTime;
      const phase = elapsed * 0.00065;

      for (let i = 0; i <= gridCells; i += 1) {
        const x = inset + i * step;
        drawWarpedLine(x, inset, x, inset + gridSize, phase, 1);
      }

      for (let i = 0; i <= gridCells; i += 1) {
        const y = inset + i * step;
        drawWarpedLine(inset, y, inset + gridSize, y, phase, 1);
      }

      drawWarpedLine(inset, inset, inset + gridSize, inset, phase, 1);
      drawWarpedLine(inset, inset, inset, inset + gridSize, phase, 1);

      animationFrameId = window.requestAnimationFrame(draw);
    };

    animationFrameId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="size-16 shrink-0" aria-hidden />;
}

function SplashCard({ Icon, label, onAction }: { Icon: LucideIcon; label: string; onAction?: () => void }) {
  return (
    <button
      type="button"
      onClick={onAction}
      className="h-[112px] rounded-lg bg-neutral-900/75 shadow inset-shadow-sm inset-shadow-white/3 outline -outline-offset-1 outline-white/10 px-3.5 py-3.5 text-left transition-colors hover:bg-neutral-900/90"
    >
      <div className="flex h-full flex-col justify-between">
        <Icon className="size-[18px] text-white/95" strokeWidth={1.75} />
        <p className="text-[clamp(1rem,1.05vw,1.2rem)] leading-[1.08] text-white/92">{label}</p>
      </div>
    </button>
  );
}

export default SplashScreen;
