import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Reference card container, measured from the dark "Preview" card:
 *
 * - 24px outer radius on a `#1c1c1c` surface, no border and no shadow.
 * - 61px header with a 24px left inset and a 12px right inset.
 * - Content sits in an inset `#151515` panel: 5px side gutters, 6px bottom,
 *   14px radius and a 1px `#2b2b2b` border.
 *
 * Components are unstyled containers: any children can be placed in the
 * header, content or footer, and the call site owns spacing inside the panel.
 */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex w-full flex-col rounded-[24px] bg-[#1c1c1c] text-[#f2f2f2]", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-[61px] flex-wrap items-center gap-3 pb-[7px] pl-6 pr-3 pt-3",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      className={cn(
        "m-0 min-w-0 text-[18px] font-medium leading-6 tracking-[-0.01em] text-[#f5f5f5]",
        className,
      )}
      {...props}
    />
  );
}

/** Right-hand header slot: actions, readouts, or a link. */
export function CardActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("ml-auto flex shrink-0 flex-wrap items-center gap-2.5", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-[5px] mb-[6px] overflow-hidden rounded-[14px] border border-[#2b2b2b] bg-[#151515]",
        className,
      )}
      {...props}
    />
  );
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2 px-3 pb-3", className)} {...props} />;
}
