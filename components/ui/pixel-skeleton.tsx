"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const DEFAULT_GRADIENT = [
  "var(--skeleton-gradient-start)",
  "var(--skeleton-gradient-end)",
] as const;

export type PixelSkeletonProps = {
  className?: string;
  circular?: boolean;
  squareSize?: number;
  gridGap?: number;
  color?: string;
  gradient?: readonly [string, string] | null;
  maxOpacity?: number;
  sweepDuration?: number;
  sweepWidth?: number;
  sweepNoise?: number;
};

/**
 * Canvas-based pixel-sweep skeleton, ported from the redesigned admin console.
 * The animation runs entirely inside requestAnimationFrame — no React state, so
 * there is no re-render per frame. It pauses while off-screen and re-resolves
 * its paint when the theme changes.
 */
export function PixelSkeleton({
  className,
  circular = false,
  squareSize = 4,
  gridGap = 2,
  color = "var(--text-color-cui-secondary)",
  gradient = DEFAULT_GRADIENT,
  maxOpacity = 0.16,
  sweepDuration = 1.5,
  sweepWidth = 0.4,
  sweepNoise = 0.1,
}: PixelSkeletonProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cellSize = squareSize + gridGap;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    // Canvas fillStyle cannot resolve CSS variables — resolve the pixel paint
    // from computed styles whenever the theme changes.
    const resolveValue = (value: string, fallback: string) => {
      if (!value.startsWith("var(")) return value;
      const name = value.slice(4, -1).trim();
      return (
        getComputedStyle(wrapper).getPropertyValue(name).trim() || fallback
      );
    };
    const resolveFill = (): string | CanvasGradient => {
      if (!gradient) return resolveValue(color, "#eeeaf0");
      const paint = ctx.createLinearGradient(0, 0, canvas.width, 0);
      paint.addColorStop(0, resolveValue(gradient[0], "#c77dff"));
      paint.addColorStop(1, resolveValue(gradient[1], "#9b5de5"));
      return paint;
    };
    let fill = resolveFill();

    let columns = 1;
    let rows = 1;
    let noise = new Float32Array(0);
    let raf = 0;
    let startTime = 0;

    const resize = () => {
      const { width, height } = wrapper.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      fill = resolveFill();
      columns = Math.max(1, Math.ceil(width / cellSize));
      rows = Math.max(1, Math.ceil(height / cellSize));
      noise = new Float32Array(columns * rows);
      for (let i = 0; i < noise.length; i++) {
        noise[i] = (Math.random() - 0.5) * 2 * sweepNoise;
      }
    };

    const draw = (time: number) => {
      if (!startTime) startTime = time;
      const progress = ((time - startTime) / 1000 / sweepDuration) % 1;
      const sweepPosition = progress * (1 + sweepWidth * 2) - sweepWidth;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = fill;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const index = row * columns + col;
          const normalizedX = columns > 1 ? col / (columns - 1) : 0.5;
          const distance = Math.abs(normalizedX + noise[index] - sweepPosition);
          let strength = Math.max(0, 1 - distance / sweepWidth);
          strength = strength * strength * (3 - 2 * strength);
          const opacity = strength * maxOpacity;
          if (opacity < 0.01) continue;
          ctx.globalAlpha = opacity;
          ctx.fillRect(
            col * cellSize * dpr,
            row * cellSize * dpr,
            squareSize * dpr,
            squareSize * dpr,
          );
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (time: number) => {
      raf = requestAnimationFrame(loop);
      draw(time);
    };

    const start = () => {
      if (!raf) {
        startTime = 0;
        raf = requestAnimationFrame(loop);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrapper);

    const themeObserver = new MutationObserver(() => {
      fill = resolveFill();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) start();
      else stop();
    });
    intersectionObserver.observe(wrapper);
    start();

    return () => {
      stop();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      intersectionObserver.disconnect();
    };
  }, [
    squareSize,
    gridGap,
    color,
    gradient,
    maxOpacity,
    sweepDuration,
    sweepWidth,
    sweepNoise,
  ]);

  return (
    <div
      ref={wrapperRef}
      aria-hidden="true"
      style={{ backgroundColor: "var(--skeleton-background)" }}
      className={cn(
        "relative overflow-hidden",
        circular ? "rounded-full" : "rounded-[2px]",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
      />
    </div>
  );
}
