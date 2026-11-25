/**
 * Static shell for the auth pages while the server resolves the session.
 * Signed-in visitors are redirected to the dashboard before the form renders,
 * so this fallback is only a brief loading surface, not a second login screen.
 */
export function AuthPageFallback() {
  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-[#121014] text-sm text-zinc-400"
      aria-busy="true"
    >
      Loading...
    </main>
  );
}
