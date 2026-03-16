import { Pool } from "pg";
import { env } from "../config/env.js";

export const pool = new Pool({
  connectionString: env.DATABASE_URL
});

export const db = {
  query: (text: string, params?: unknown[]) => pool.query(text, params)
};
