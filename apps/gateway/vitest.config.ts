import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@opencode-remote/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
})
