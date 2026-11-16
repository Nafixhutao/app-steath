"use client";

import { Clock } from "lucide-react";
import {
  HOST_TIME_RANGES,
  TIME_RANGES,
  type HostTimeRange,
  type TimeRange,
} from "../types/telemetry";
import { AdminSelect } from "./admin-select";

/** Time range dropdown shared by telemetry pages. */
export function TimeRangeSelect({
  value,
  onChange,
  className,
}: {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
  className?: string;
}) {
  return (
    <AdminSelect
      className={className}
      label="Time range"
      icon={<Clock size={13} strokeWidth={1.8} aria-hidden="true" />}
      value={value}
      options={TIME_RANGES}
      onChange={onChange}
    />
  );
}

/** The narrower selector for in-process host metrics retained for one hour. */
export function HostTimeRangeSelect({
  value,
  onChange,
  className,
}: {
  value: HostTimeRange;
  onChange: (value: HostTimeRange) => void;
  className?: string;
}) {
  return (
    <AdminSelect
      className={className}
      label="Time range"
      icon={<Clock size={13} strokeWidth={1.8} aria-hidden="true" />}
      value={value}
      options={HOST_TIME_RANGES}
      onChange={onChange}
    />
  );
}
