import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { loadConfig, TOOL_ROOT } from './config.mjs'
import { ProcessManager } from './process-manager.mjs'
import { defaultRuntimeDir } from './runtime-paths.mjs'

const config = loadConfig()
const runtimeDir = path.resolve(
  process.env.SERVICE_CONTROL_RUNTIME ||
  defaultRuntimeDir()
)
const publicDir = path.join(TOOL_ROOT, 'public')
const tokenPath = path.join(runtimeDir, 'control-token')
fs.mkdirSync(runtimeDir, { recursive: true })
const token = readOrCreateToken(tokenPath)
const manager = new ProcessManager(config, runtimeDir)
const clients = new Set()

const server = http.createServer(async (request, response) => {
  try {
    setSecurityHeaders(response)
    const url = new URL(request.url || '/', `http://${config.host}:${config.port}`)

    if (request.method === 'GET' && url.pathname === '/api/status') {
      return json(response, 200, await manager.statuses())
    }

    if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      })
      response.write(': connected\n\n')
      clients.add(response)
      request.on('close', () => clients.delete(response))
      return
    }

    const logDownloadMatch = url.pathname.match(/^\/api\/services\/([a-z0-9-]+)\/logs\/download$/)
    if (request.method === 'GET' && logDownloadMatch) {
      return downloadLog(response, manager, logDownloadMatch[1])
    }

    const logsMatch = url.pathname.match(/^\/api\/services\/([a-z0-9-]+)\/logs$/)
    if (request.method === 'GET' && logsMatch) {
      const id = logsMatch[1]
      if (url.searchParams.get('stream') === '1') {
        const cursorValue = url.searchParams.get('cursor')
        const identity = url.searchParams.get('identity')
        return json(response, 200, {
          id,
          ...manager.logChunk(id, cursorValue == null ? null : Number(cursorValue), { identity }),
        })
      }
      return json(response, 200, { id, logs: manager.logs(id, Number(url.searchParams.get('lines') || 200)) })
    }

    const backendHostsMatch = url.pathname.match(/^\/api\/services\/([a-z0-9-]+)\/backend-hosts$/)
    if (request.method === 'POST' && backendHostsMatch) {
      authorizeMutation(request, token, config)
      const body = await readJsonBody(request)
      const backendTarget = manager.addBackendHost(backendHostsMatch[1], body.host)
      await broadcastStatus()
      return json(response, 200, { ok: true, backendTarget })
    }

    const backendTargetMatch = url.pathname.match(/^\/api\/services\/([a-z0-9-]+)\/backend-target$/)
    if (request.method === 'POST' && backendTargetMatch) {
      authorizeMutation(request, token, config)
      const body = await readJsonBody(request)
      const result = await manager.applyBackendHost(backendTargetMatch[1], body.host)
      await broadcastStatus()
      return json(response, 200, { ok: true, ...result })
    }

    const actionMatch = url.pathname.match(/^\/api\/services\/([a-z0-9-]+)\/(start|stop|restart)$/)
    if (request.method === 'POST' && actionMatch) {
      authorizeMutation(request, token, config)
      const [, id, action] = actionMatch
      const result = await manager.action(id, action)
      await broadcastStatus()
      return json(response, 200, { ok: true, service: result })
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      return serveStatic(url.pathname, response, publicDir, token, request.method === 'HEAD')
    }
    return json(response, 404, { error: 'Not found' })
  } catch (error) {
    const status = error.statusCode || 400
    return json(response, status, { error: error.message || 'Request failed' })
  }
})

const pollTimer = setInterval(broadcastStatus, config.pollIntervalMs)
pollTimer.unref()
manager.on('activity', activity => broadcast('activity', activity))

server.listen(config.port, config.host, () => {
  console.log(`[service-control] ${config.title}`)
  console.log(`[service-control] http://${config.host}:${config.port}`)
  console.log(`[service-control] ${config.services.length} services registered`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(pollTimer)
    for (const client of clients) client.end()
    server.close(() => process.exit(0))
  })
}

async function broadcastStatus() {
  if (!clients.size) return
  try {
    broadcast('status', await manager.statuses())
  } catch (error) {
    broadcast('error', { message: error.message, at: new Date().toISOString() })
  }
}

function broadcast(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const client of clients) client.write(message)
}

function authorizeMutation(request, expectedToken, currentConfig) {
  const supplied = String(request.headers['x-service-control-token'] || '')
  if (supplied.length !== expectedToken.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expectedToken))) {
    const error = new Error('Unauthorized control request.')
    error.statusCode = 401
    throw error
  }

  const origin = request.headers.origin
  if (origin) {
    const allowed = new Set([
      `http://${currentConfig.host}:${currentConfig.port}`,
      `http://localhost:${currentConfig.port}`,
      `http://127.0.0.1:${currentConfig.port}`,
    ])
    if (!allowed.has(origin)) {
      const error = new Error('Cross-origin control request denied.')
      error.statusCode = 403
      throw error
    }
  }
}

function serveStatic(pathname, response, root, controlToken, headOnly = false) {
  const files = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/log-view.js': ['log-view.js', 'text/javascript; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  }
  const entry = files[pathname]
  if (!entry) return json(response, 404, { error: 'Not found' })
  let content = fs.readFileSync(path.join(root, entry[0]))
  if (entry[0] === 'index.html') {
    content = Buffer.from(content.toString('utf8').replace('__CONTROL_TOKEN__', controlToken), 'utf8')
  }
  response.writeHead(200, {
    'Content-Type': entry[1],
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
  })
  response.end(headOnly ? undefined : content)
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function downloadLog(response, manager, id) {
  manager.getService(id)
  const logPath = manager.logPath(id)
  const snapshots = [`${logPath}.1`, logPath].flatMap(filePath => {
    try {
      const fd = fs.openSync(filePath, 'r')
      return [{ filePath, fd, size: fs.fstatSync(fd).size, closed: false }]
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  })
  if (!snapshots.length) return json(response, 404, { error: 'No managed log is available for this service.' })
  const includeMarkers = snapshots.length > 1
  for (const snapshot of snapshots) {
    snapshot.marker = includeMarkers
      ? Buffer.from(`[control] ===== ${path.basename(snapshot.filePath)} =====\n`, 'utf8')
      : Buffer.alloc(0)
  }
  const size = snapshots.reduce((total, snapshot) => total + snapshot.marker.length + snapshot.size, 0)
  response.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': size,
    'Content-Disposition': `attachment; filename="${id}-retained.log"`,
    'Cache-Control': 'no-store',
  })
  const source = Readable.from(retainedLogChunks(snapshots))
  source.on('error', error => response.destroy(error))
  response.on('close', () => source.destroy())
  source.pipe(response)
}

async function* retainedLogChunks(snapshots) {
  try {
    for (const snapshot of snapshots) {
      if (snapshot.marker.length) yield snapshot.marker
      if (snapshot.size > 0) {
        const stream = fs.createReadStream(snapshot.filePath, {
          fd: snapshot.fd,
          autoClose: false,
          start: 0,
          end: snapshot.size - 1,
        })
        for await (const chunk of stream) yield chunk
      }
      closeSnapshot(snapshot)
    }
  } finally {
    for (const snapshot of snapshots) closeSnapshot(snapshot)
  }
}

function closeSnapshot(snapshot) {
  if (snapshot.closed) return
  snapshot.closed = true
  try {
    fs.closeSync(snapshot.fd)
  } catch {
    // The descriptor may already be closed after a stream error.
  }
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16 * 1024) {
      const error = new Error('Request body is too large.')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Request body must be valid JSON.')
    error.statusCode = 400
    throw error
  }
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'")
}

function readOrCreateToken(filePath) {
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8').trim()
  const value = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(filePath, value, { mode: 0o600 })
  return value
}
