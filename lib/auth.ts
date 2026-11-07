import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { authConfig } from "./auth-config";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const auth = betterAuth({
  ...authConfig,
  database: pool,
});
