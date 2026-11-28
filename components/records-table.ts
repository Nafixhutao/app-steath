/**
 * Styling for the DNS, Environment, and Volume tables. The declarations are
 * ancestor-scoped utilities rather than a CSS class so the table cannot drift
 * from the utility layer; the 720px block turns rows into labelled cards.
 */
export const recordsTableClass = [
  "w-full text-left tabular-nums m-0 text-[13px] border-collapse",
  "[&_th]:py-[10px] [&_th]:px-[14px] [&_th]:border-b [&_th]:border-b-[#1f1f22] [&_th]:bg-[#111113] [&_th]:text-[#71717a] [&_th]:text-[12px] [&_th]:font-medium [&_th]:whitespace-nowrap",
  "[&_td]:py-[10px] [&_td]:px-[14px] [&_td]:border-b [&_td]:border-b-[#1f1f22] [&_td]:text-[#d4d4d8] [&_td]:text-[13px] [&_td]:align-middle [&_tbody_tr]:[transition:background_0.12s_ease] [&_tbody_tr:hover]:bg-[#131316] [&_tbody_tr:last-child>td]:border-b-0",
  "[&_code]:py-[2px] [&_code]:px-[6px] [&_code]:rounded-[var(--radius-control-sm)] [&_code]:bg-[#27272a] [&_code]:text-[#d4d4d8] [&_code]:text-[12px] [@media(max-width:760px)]:[&_td]:whitespace-nowrap",
  "[@media(max-width:720px)]:block [@media(max-width:720px)]:w-auto [@media(max-width:720px)]:[&_thead]:hidden [@media(max-width:720px)]:[&_tbody]:grid [@media(max-width:720px)]:[&_tbody]:gap-[10px] [@media(max-width:720px)]:[&_tbody_tr]:grid [@media(max-width:720px)]:[&_tbody_tr]:grid-cols-[repeat(2,minmax(0,1fr))] [@media(max-width:720px)]:[&_tbody_tr]:gap-[12px_16px] [@media(max-width:720px)]:[&_tbody_tr]:p-[14px] [@media(max-width:720px)]:[&_tbody_tr]:border [@media(max-width:720px)]:[&_tbody_tr]:border-[#27272a] [@media(max-width:720px)]:[&_tbody_tr]:rounded-card [@media(max-width:720px)]:[&_tbody_tr]:bg-[#0c0c0d] [@media(max-width:720px)]:[&_tbody_tr:hover]:bg-[#0c0c0d]",
  "[@media(max-width:720px)]:[&_td]:min-w-0 [@media(max-width:720px)]:[&_td]:p-0 [@media(max-width:720px)]:[&_td]:border-0 [@media(max-width:720px)]:[&_td]:text-[13px] [@media(max-width:720px)]:[&_td]:[overflow-wrap:anywhere] [@media(max-width:720px)]:[&_td::before]:block [@media(max-width:720px)]:[&_td::before]:mb-[4px] [@media(max-width:720px)]:[&_td::before]:text-[#71717a] [@media(max-width:720px)]:[&_td::before]:text-[11px] [@media(max-width:720px)]:[&_td::before]:font-medium [@media(max-width:720px)]:[&_td::before]:content-[attr(data-label)] [@media(max-width:720px)]:[&_code]:whitespace-normal [@media(max-width:720px)]:[&_code]:[overflow-wrap:anywhere]",
].join(" ");
