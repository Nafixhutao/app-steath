import { apiData } from "@/lib/platform/api";
import { storedOAuthProviders } from "@/lib/platform/oauth-providers";

/**
 * Public answer to "can I sign in with Google/GitHub here?". The sign-in page
 * renders a provider button only when the instance actually has credentials
 * for it; unconfigured providers stay disabled with their honest "Coming
 * soon" label instead of a button that errors mid-flow.
 */
export async function GET() {
  const [stored] = await Promise.all([storedOAuthProviders()]);
  const envGithub = Boolean(
    process.env.GITHUB_CLIENT_ID ?? process.env.BETTER_AUTH_GITHUB_CLIENT_ID,
  );
  const envGoogle = Boolean(
    process.env.GOOGLE_CLIENT_ID ?? process.env.BETTER_AUTH_GOOGLE_CLIENT_ID,
  );

  return apiData(
    {
      providers: {
        github: Boolean(stored.github) || envGithub,
        google: Boolean(stored.google) || envGoogle,
      },
    },
    200,
  );
}
