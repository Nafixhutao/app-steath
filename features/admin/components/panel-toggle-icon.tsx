// The sidebar's panel glyph, ported verbatim from stealth-forge's
// `features/navigation/sidebar-shared` so the AdminTopBar carries the exact
// same mark without importing the whole customer sidebar.

export function PanelToggleIcon({
  className = "size-4",
}: {
  className?: string;
}) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2"
        y="3"
        width="12"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <rect
        x="4.2"
        y="5.2"
        width="3.2"
        height="5.6"
        rx="0.9"
        fill="currentColor"
      />
    </svg>
  );
}
