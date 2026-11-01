import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { loadEnvironmentFile } from './load-environment.js'

loadEnvironmentFile()
const config = loadConfig()
const { server } = await buildApp(config)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0))
  })
}

try {
  await server.listen({ host: config.host, port: config.port })
} catch (error) {
  server.log.error(error)
  await server.close()
  process.exit(1)
}
