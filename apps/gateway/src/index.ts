import { getConfig } from "./config.js"
import { buildApp } from "./app.js"

const config = getConfig()
const app = await buildApp(config)

try {
  await app.listen({
    host: config.GATEWAY_HOST,
    port: config.GATEWAY_PORT,
  })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
