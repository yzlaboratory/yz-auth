import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { loadEnvironmentFile } from './load-environment.js'

loadEnvironmentFile()
const config = loadConfig()
const { server } = await buildApp(config)

let shuttingDown = false

const shutdown = (): void => {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  const forceExitTimer = setTimeout(() => process.exit(1), 10_000)
  forceExitTimer.unref()

  void server.close().then(
    () => process.exit(0),
    (error: unknown) => {
      server.log.error(error)
      process.exit(1)
    },
  )
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, shutdown)
}

try {
  await server.listen({ host: config.host, port: config.port })
} catch (error) {
  server.log.error(error)
  await server.close()
  process.exit(1)
}
