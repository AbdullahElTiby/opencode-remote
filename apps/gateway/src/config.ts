import path from "node:path"
import { config as loadDotEnv } from "dotenv"
import { z } from "zod"

loadDotEnv()

const envSchema = z.object({
  GATEWAY_HOST: z.string().default("0.0.0.0"),
  GATEWAY_PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8787"),
  OPENCODE_BASE_URL: z.string().url().default("http://127.0.0.1:4096"),
  OPENCODE_PASSWORD: z.string().optional(),
  OPENCODE_BIN: z.string().default("opencode"),
  JWT_SECRET: z.string().min(16).default("change-me-now-change-me-now"),
  PAIR_CODE_TTL_MS: z.coerce.number().int().positive().default(300000),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
  STATE_FILE: z.string().default("./data/gateway-state.json"),
})

export type AppConfig = z.infer<typeof envSchema> & {
  stateFile: string
}

export function getConfig(): AppConfig {
  const parsed = envSchema.parse(process.env)
  return {
    ...parsed,
    stateFile: path.resolve(process.cwd(), parsed.STATE_FILE),
  }
}
