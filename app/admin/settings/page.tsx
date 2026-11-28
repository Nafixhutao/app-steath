import { CloudflareSettingsPage } from "./cloudflare-settings-page";

/**
 * Settings is composed entirely in `app/admin/**` so the Forge source stays
 * byte-identical (ADR-0008). The page keeps every section of the upstream
 * Settings screen, adds the Email providers section, and presents them with
 * Cloudflare-style tabs and palette.
 */
export default function AdminSettingsPage() {
  return <CloudflareSettingsPage />;
}
