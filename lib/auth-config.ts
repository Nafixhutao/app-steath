import type { BetterAuthOptions } from "better-auth";
import { organization, username } from "better-auth/plugins";

export const authConfig = {
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to false for development (no email service yet)
  },

  plugins: [username(), organization()],

  session: {
    cookieCache: {
      enabled: false,
    },
  },

  advanced: {
    database: {
      generateId: "uuid",
    },
  },

  // Log auth events in development
  logger: {
    level: process.env.NODE_ENV === "production" ? "error" : "debug",
  },
} satisfies Omit<BetterAuthOptions, "database">;
