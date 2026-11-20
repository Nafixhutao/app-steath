import { useEffect, useRef } from "react";
import gsap from "gsap";

export interface GsapEntranceStep {
  /** Target selector(s) scoped to the container */
  targets: string | string[];
  /** Translation distance in pixels (default: 14) */
  y?: number;
  /** Animation duration in seconds (default: 0.4) */
  duration?: number;
  /** Stagger delay between items in seconds (default: 0.06) */
  stagger?: number;
  /** Initial delay before animation starts in seconds (default: 0) */
  delay?: number;
  /** GSAP easing formula (default: "power2.out") */
  ease?: string;
}

/**
 * Hook to apply accessible, scoped GSAP entrance animations using gsap.matchMedia().
 * Automatically respects prefers-reduced-motion: reduce and reverts on unmount.
 */
export function useGsapEntrance<T extends HTMLElement = HTMLDivElement>(
  steps: GsapEntranceStep | GsapEntranceStep[],
  deps: React.DependencyList = [],
) {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const mm = gsap.matchMedia();

    mm.add(
      {
        reduceMotion: "(prefers-reduced-motion: reduce)",
      },
      (context) => {
        const { reduceMotion } = context.conditions as { reduceMotion: boolean };
        if (reduceMotion) return;

        const stepList = Array.isArray(steps) ? steps : [steps];

        for (const step of stepList) {
          gsap.from(step.targets, {
            y: step.y ?? 14,
            autoAlpha: 0,
            duration: step.duration ?? 0.4,
            stagger: step.stagger ?? 0.06,
            delay: step.delay ?? 0,
            ease: step.ease ?? "power2.out",
            clearProps: "all",
          });
        }
      },
      containerRef,
    );

    return () => {
      mm.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return containerRef;
}
