"use client";

import { useReducedMotion } from "motion/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { useMessages } from "@/lib/i18n";
import { buildDonut, type DonutSegment } from "./model";

export const donutChartMessages = {
  label: "Donut chart",
  total: "Total",
};

export type DonutChartMessages = typeof donutChartMessages;

export interface DonutChartProps {
  segments: readonly DonutSegment[];
  thickness?: number;
  gap?: number;
  activeId?: string | null;
  defaultActiveId?: string | null;
  onActiveChange?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  formatValue?: (value: number) => string;
  label?: string;
  labels?: Partial<DonutChartMessages>;
  className?: string;
  children?: ReactNode;
}

const defaultFormat = (value: number) => value.toLocaleString("en-US");

export function useDonutModel({
  segments,
  thickness = 22,
  gap = 3,
  activeId,
  defaultActiveId = null,
  onActiveChange,
  onSelect,
  selectedId = null,
  formatValue = defaultFormat,
  label,
  labels,
}: DonutChartProps) {
  const t = useMessages("donutChart", donutChartMessages, labels);
  const reduce = useReducedMotion() ?? false;
  const canHover = useHoverCapable();
  const radius = 100 - thickness / 2 - 8;
  const { placed, total } = buildDonut(segments, { radius, thickness, gap });

  const [internal, setInternal] = useState(defaultActiveId);
  const raw = activeId === undefined ? internal : activeId;
  const active = raw !== null && placed.some((segment) => segment.id === raw) ? raw : null;

  const latest = useRef({ controlled: activeId !== undefined, onActiveChange });
  useLayoutEffect(() => {
    latest.current = { controlled: activeId !== undefined, onActiveChange };
  });
  const setActive = useCallback(
    (id: string | null) => {
      if (!latest.current.controlled) setInternal(id);
      latest.current.onActiveChange?.(id);
    },
    [setInternal],
  );

  return {
    placed,
    total,
    radius,
    thickness,
    active,
    setActive,
    onSelect,
    selectedId,
    formatValue,
    label: label ?? t("label"),
    t,
    reduce,
    canHover,
  };
}

export type DonutModel = ReturnType<typeof useDonutModel>;
export const DonutContext = createContext<DonutModel | null>(null);

export function useDonutChart() {
  const model = useContext(DonutContext);
  if (!model) throw new Error("Donut chart parts must be rendered inside DonutChart.");
  return model;
}
