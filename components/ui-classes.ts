/**
 * Utility strings shared by more than one component. A class used by a
 * single file stays in that file; these are the console and auth primitives
 * that would otherwise drift apart, so a colour or focus ring changes once.
 */

export const dangerButtonClass = [
  "cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-danger)]",
  "focus-visible:outline-offset-[2px] disabled:opacity-[0.5] disabled:cursor-not-allowed",
  "inline-flex items-center justify-center gap-[8px] min-h-[38px] py-[8px] px-[16px]",
  "rounded-card border-0 bg-[#e11d48]",
  "[background-image:linear-gradient(180deg,var(--color-danger)_0%,#e11d48_100%)]",
  "[box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.25),0_1px_3px_rgba(0,0,0,0.3),0_0_0_1px_#be123c]",
  "text-ink text-[13.5px]! font-medium! whitespace-nowrap",
  "[transition:background-color_150ms_ease,box-shadow_150ms_ease,transform_100ms_ease]",
  "[&:hover:not(:disabled)]:[background-image:linear-gradient(180deg,#fb7185_0%,var(--color-danger)_100%)]",
  "[&:hover:not(:disabled)]:text-ink [&:active:not(:disabled)]:translate-y-[1]",
  "disabled:transform-none disabled:[box-shadow:none]",
].join(" ");

export const secondaryButtonClass = [
  "supabase-btn-secondary font-medium focus-visible:outline-2 focus-visible:outline-[#818cf8]",
  "focus-visible:outline-offset-[2px] inline-flex items-center justify-center min-h-[38px]",
  "rounded-card border border-[#2a2834] bg-[#181720] [box-shadow:0_1px_2px_rgba(0,0,0,0.2)]",
  "whitespace-nowrap no-underline",
  "[transition:background-color_150ms_ease,border-color_150ms_ease,box-shadow_150ms_ease,color_120ms_ease,transform_100ms_ease]",
  "[&:hover:not(:disabled)]:border-[#3b3749] [&:hover:not(:disabled)]:bg-[#201e2a]",
  "[&:active:not(:disabled)]:translate-y-[1px] disabled:opacity-[0.5] disabled:transform-none",
].join(" ");

export const dangerSecondaryButtonClass = `${secondaryButtonClass} text-rose-400 hover:text-rose-300`;

export const compactSecondaryButtonClass = `${secondaryButtonClass} text-xs h-7 px-2.5`;

export const spacedSecondaryButtonClass = `${secondaryButtonClass} mt-3`;

export const credentialActionClass = [
  "[@media(max-width:400px)]:flex-auto focus-visible:outline-2 focus-visible:outline-[#818cf8]",
  "focus-visible:outline-offset-[2px] bg-[#1f1e26] text-[12.5px] font-medium",
  "[&:hover:not(:disabled)]:bg-[#272532] disabled:opacity-[0.55] disabled:cursor-not-allowed",
  "inline-flex items-center justify-center gap-[6px] min-h-[44px] py-[8px] px-[14px]",
  "rounded-control border border-[#2e2c39] text-[#d4d4d8] cursor-pointer",
  "[transition:background-color_120ms,color_120ms,border-color_120ms]",
  "[&:hover:not(:disabled)]:border-[#3a3846] [&:hover:not(:disabled)]:text-ink",
].join(" ");

export const credentialToggleClass = [
  "bg-[#1f1e26] [&:hover:not(:disabled)]:bg-[#272532] focus-visible:outline-2",
  "focus-visible:outline-[#818cf8] focus-visible:outline-offset-[2px] flex-none inline-flex",
  "items-center justify-center min-w-[44px] min-h-[44px] p-0 rounded-control border",
  "border-[#2e2c39] text-[#8e8c99] cursor-pointer",
  "[transition:background-color_120ms,color_120ms,border-color_120ms]",
  "[&:hover:not(:disabled)]:border-[#3a3846] [&:hover:not(:disabled)]:text-ink",
  "disabled:opacity-[0.55] disabled:cursor-not-allowed",
].join(" ");

export const createProjectButtonClass = [
  "text-[13px] font-semibold focus-visible:outline-2",
  "focus-visible:outline-[var(--color-violet)] focus-visible:outline-offset-[2px] h-[36px] py-0",
  "px-[14px] border border-[#078153] rounded-control bg-[var(--color-accent-strong)]",
  "text-[#fff] cursor-pointer hover:bg-[#087f55]",
  "[transition:background_160ms_ease,border-color_160ms_ease,color_160ms_ease,transform_120ms_ease,box-shadow_160ms_ease,filter_160ms_ease]",
  "active:translate-y-[1px] active:scale-[0.99]",
].join(" ");

export const serviceMetaClass = [
  "service-meta grid p-0 gap-[20px_24px] m-0 grid-cols-[repeat(3,minmax(0,1fr))]",
  "[@media(max-width:860px)]:grid-cols-[repeat(2,minmax(0,1fr))] [&>div]:block [&>div]:min-w-0",
  "[&_dt]:mt-0 [&_dt]:mb-[5px] [&_dt]:mx-0 [&_dt]:text-[#71717a] [&_dt]:text-[12px]",
  "[&_dt]:font-medium [&_dd]:m-0 [&_dd]:text-[#ededf2] [&_dd]:text-[13px]",
  "[&_dd]:[overflow-wrap:anywhere]",
].join(" ");

export const dashboardLinkButtonClass = [
  "dashboard-link-button text-[12px] focus-visible:outline-2",
  "focus-visible:outline-[var(--color-violet)] focus-visible:outline-offset-[2px] p-0 border-0",
  "text-violet [font:inherit] cursor-pointer hover:underline",
  "[transition:background_160ms_ease,border-color_160ms_ease,color_160ms_ease,transform_120ms_ease,box-shadow_160ms_ease,filter_160ms_ease]",
].join(" ");

export const dangerLinkButtonClass = `${dashboardLinkButtonClass} is-danger`;

export const passwordToggleClass = [
  "focus-visible:outline-2 focus-visible:outline-[#4693ff] focus-visible:outline-offset-[2px]",
  "absolute top-1/2 right-[6px] flex w-[32px] h-[32px] items-center justify-center",
  "-translate-y-1/2 border-0 rounded-control bg-transparent text-[#999999] cursor-pointer",
  "hover:text-[#eaeaea]",
].join(" ");

export const serviceDeleteButtonClass = [
  "inline-flex items-center justify-center w-[28px] h-[28px] rounded-control bg-transparent",
  "border border-transparent text-[#716f7c] cursor-pointer [transition:all_120ms]",
  "hover:border-[rgba(244,63,94,0.2)] hover:bg-[rgba(244,63,94,0.1)]",
  "hover:text-[var(--color-danger)]",
].join(" ");

export const adminRefreshButtonClass = [
  "inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--projects-border)]",
  "bg-[#141416] px-3 text-[12.5px] font-medium leading-none text-[var(--projects-text)]",
  "transition-colors hover:border-[var(--projects-border-hover)] hover:bg-white/[0.04]",
  "disabled:opacity-60",
].join(" ");

export const tableWrapClass = [
  "overflow-x-auto border border-[#27272a] rounded-card bg-[#0c0c0d]",
  "[@media(max-width:720px)]:border-0 [@media(max-width:720px)]:rounded-[0]",
  "[@media(max-width:720px)]:bg-transparent [@media(max-width:720px)]:overflow-visible",
].join(" ");

export const filterSelectClass = [
  "appearance-none bg-surface h-[34px] py-0 pr-[28px] pl-[10px] rounded-control border",
  "border-[#282631] text-[#c9c7d2] text-[13px] cursor-pointer",
  "focus:border-[var(--color-accent)] outline-none",
].join(" ");

export const modalCloseClass = [
  "flex items-center justify-center w-[28px] h-[28px] rounded-control bg-transparent border-0",
  "text-[#716f7c] cursor-pointer [transition:color_150ms,background-color_150ms]",
  "hover:text-ink-console",
].join(" ");

export const skipLinkClass = [
  "skip-link text-[var(--color-canvas)] fixed top-[16px] left-[16px] z-[10] py-[8px] px-[12px]",
  "rounded-control bg-[#eaeaea] focus-visible:outline-2 focus-visible:outline-[#4693ff]",
  "focus-visible:outline-offset-[2px]",
].join(" ");

export const redeployBannerClass = [
  "mx-0 px-[14px] border text-[13px] mt-0 mb-[16px] py-[10px] border-[rgba(245,158,11,0.3)]",
  "rounded-control bg-[rgba(245,158,11,0.08)] text-[#f5a623]",
].join(" ");

export const credentialRowClass = [
  "[&:not(:first-child)]:border-t [&:not(:first-child)]:border-[#232129]",
  "[@media(max-width:400px)]:py-[10px] [@media(max-width:400px)]:px-[12px] flex flex-col",
  "gap-[4px] py-[12px] px-[14px] min-w-0",
].join(" ");

export const successBadgeClass = [
  "bg-[rgba(62,207,142,0.12)] inline-flex items-center text-[10px] font-bold tracking-[0.06em]",
  "py-[2px] px-[7px] rounded-control-sm text-accent border border-[rgba(62,207,142,0.25)]",
  "uppercase leading-[1.2]",
].join(" ");

export const credentialValueClass = [
  "flex-auto [word-break:break-all]",
  "[font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-ink min-w-0",
  "text-[14px] leading-[1.5] [overflow-wrap:anywhere] min-h-[21px]",
].join(" ");
