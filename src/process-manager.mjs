import { EventEmitter } from 'node:events'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export class ProcessManager extends EventEmitter {
  constructor(config, runtimeDir) {
    super()
    this.config = config
    this.runtimeDir = runtimeDir
    this.logsDir = path.join(runtimeDir, 'logs')
    this.statePath = path.join(runtimeDir, 'state.json')
    this.locks = new Map()
    fs.mkdirSync(this.logsDir, { recursive: true })
    this.state = readJson(this.statePath, { services: {} })
  }

  async statuses() {
    const services = await Promise.all(this.config.services.map(service => this.status(service.id)))
    for (const service of services) service.busy = this.locks.has(service.id)
    return {
      generatedAt: new Date().toISOString(),
      summary: summarize(services),
      services,
    }
  }

  async status(id) {
    const service = this.getService(id)
    const listeners = await findListenerDetails(service.port)
    const matching = listeners.filter(listener => sameOrChildPath(listener.cwd, service.cwd))
    const conflicts = listeners.filter(listener => !sameOrChildPath(listener.cwd, service.cwd))
    const managed = this.state.services[id]
    const managedAlive = managed ? isPidAlive(managed.pid) : false

    if (conflicts.length && !matching.length) {
      return serviceStatus(service, {
        state: 'conflict',
        pid: conflicts[0].pid,
        source: 'external',
        processCwd: conflicts[0].cwd,
        command: conflicts[0].command,
        message: `端口 ${service.port} 被其他项目占用`,
      })
    }

    if (matching.length) {
      const listener = matching[0]
      const health = service.protocol === 'tcp'
        ? { ok: true, latencyMs: null, statusCode: null }
        : await checkHttp(service)
      return serviceStatus(service, {
        state: health.ok ? 'running' : 'unhealthy',
        pid: listener.pid,
        source: managedAlive ? 'managed' : 'external',
        processCwd: listener.cwd,
        command: listener.command,
        health,
        message: health.ok ? '服务可用' : '端口已监听，但 HTTP 健康检查失败',
      })
    }

    if (managedAlive) {
      const startedAt = Date.parse(managed.startedAt)
      const startupTimedOut = Number.isFinite(startedAt)
        && Date.now() - startedAt >= this.config.startupTimeoutMs
      return serviceStatus(service, {
        state: startupTimedOut ? 'unhealthy' : 'starting',
        pid: managed.pid,
        source: 'managed',
        processCwd: service.cwd,
        command: service.command,
        message: startupTimedOut
          ? `启动超过 ${Math.ceil(this.config.startupTimeoutMs / 1000)} 秒仍未监听端口，请查看日志`
          : '进程已启动，等待端口监听',
      })
    }

    if (managed && !managedAlive) {
      delete this.state.services[id]
      this.persistState()
    }

    return serviceStatus(service, {
      state: 'stopped',
      pid: null,
      source: null,
      processCwd: null,
      command: null,
      message: fs.existsSync(service.cwd) ? '服务未运行' : '项目目录不存在',
      controllable: fs.existsSync(service.cwd),
    })
  }

  async action(id, action) {
    if (!['start', 'stop', 'restart'].includes(action)) throw new Error(`Unsupported action: ${action}`)
    if (this.locks.has(id)) throw new Error(`${id} already has an action in progress.`)

    const work = this.runAction(id, action)
    this.locks.set(id, work)
    this.emit('activity', { id, action, phase: 'started', at: new Date().toISOString() })
    try {
      const result = await work
      this.emit('activity', { id, action, phase: 'completed', at: new Date().toISOString() })
      return result
    } catch (error) {
      this.emit('activity', { id, action, phase: 'failed', message: error.message, at: new Date().toISOString() })
      throw error
    } finally {
      this.locks.delete(id)
    }
  }

  async runAction(id, action) {
    if (action === 'start') return this.start(id)
    if (action === 'stop') return this.stop(id)
    await this.stop(id)
    return this.start(id)
  }

  async start(id) {
    const service = this.getService(id)
    const current = await this.status(id)
    if (current.state === 'running' || current.state === 'unhealthy' || current.state === 'starting') return current
    if (current.state === 'conflict') throw new Error(current.message)
    if (!fs.existsSync(service.cwd)) throw new Error(`Project directory does not exist: ${service.cwd}`)

    const logPath = this.logPath(id)
    rotateLog(logPath)
    const logFd = fs.openSync(logPath, 'a')
    fs.appendFileSync(logPath, `\n[control] ${new Date().toISOString()} starting ${id}\n$ ${service.command}\n`)
    const secretEnv = loadServiceSecretEnv(this.runtimeDir, service.id)

    const child = spawn('/bin/zsh', ['-lc', service.command], {
      cwd: service.cwd,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        ...service.env,
        ...secretEnv,
        SERVICE_CONTROL_ID: id,
        SERVICE_CONTROL_PORT: String(service.port),
      },
    })
    child.unref()
    fs.closeSync(logFd)

    this.state.services[id] = {
      pid: child.pid,
      startedAt: new Date().toISOString(),
      command: service.command,
    }
    this.persistState()
    await delay(350)
    return this.status(id)
  }

  async stop(id) {
    const service = this.getService(id)
    const current = await this.status(id)
    if (current.state === 'stopped') return current
    if (current.state === 'conflict') throw new Error(current.message)

    const managed = this.state.services[id]
    if (managed && isPidAlive(managed.pid)) {
      safeKill(-managed.pid, 'SIGTERM')
    } else if (current.pid) {
      const actualCwd = await processCwd(current.pid)
      if (!sameOrChildPath(actualCwd, service.cwd)) {
        throw new Error(`Refusing to stop PID ${current.pid}: working directory mismatch.`)
      }
      safeKill(current.pid, 'SIGTERM')
    }

    const stopped = await waitFor(async () => {
      const listeners = await findListenerDetails(service.port)
      return !listeners.some(listener => sameOrChildPath(listener.cwd, service.cwd))
    }, this.config.stopTimeoutMs)

    if (!stopped) {
      if (managed && isPidAlive(managed.pid)) safeKill(-managed.pid, 'SIGKILL')
      else if (current.pid) safeKill(current.pid, 'SIGKILL')
      await delay(250)
    }

    delete this.state.services[id]
    this.persistState()
    fs.appendFileSync(this.logPath(id), `[control] ${new Date().toISOString()} stopped ${id}\n`)
    return this.status(id)
  }

  logs(id, lines = 200) {
    this.getService(id)
    const logPath = this.logPath(id)
    if (!fs.existsSync(logPath)) return ''
    const stats = fs.statSync(logPath)
    const start = Math.max(0, stats.size - 256 * 1024)
    const fd = fs.openSync(logPath, 'r')
    const buffer = Buffer.alloc(stats.size - start)
    fs.readSync(fd, buffer, 0, buffer.length, start)
    fs.closeSync(fd)
    return buffer.toString('utf8').split(/\r?\n/).slice(-Math.max(1, Math.min(lines, 1000))).join('\n')
  }

  getService(id) {
    const service = this.config.services.find(item => item.id === id)
    if (!service) throw new Error(`Unknown service: ${id}`)
    return service
  }

  logPath(id) {
    return path.join(this.logsDir, `${id}.log`)
  }

  persistState() {
    const tempPath = `${this.statePath}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    fs.renameSync(tempPath, this.statePath)
  }
}

export function loadServiceSecretEnv(runtimeDir, serviceId) {
  const envPath = path.join(runtimeDir, 'service-env', `${serviceId}.env`)
  if (!fs.existsSync(envPath)) return {}

  const mode = fs.statSync(envPath).mode & 0o777
  if ((mode & 0o077) !== 0) {
    throw new Error(`Secret environment file must use mode 600: ${envPath}`)
  }

  const values = {}
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const [index, sourceLine] of lines.entries()) {
    const line = sourceLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) {
      throw new Error(`Invalid secret environment entry at ${envPath}:${index + 1}`)
    }
    values[match[1]] = unquoteEnvValue(match[2].trim())
  }
  return values
}

function unquoteEnvValue(value) {
  if (value.length >= 2) {
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
      return value.slice(1, -1)
    }
  }
  return value
}

export async function findListenerDetails(port) {
  let stdout
  try {
    const result = await execFileAsync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'])
    stdout = result.stdout
  } catch (error) {
    if (error.code === 1) return []
    throw error
  }

  const pids = [...new Set(stdout.split(/\r?\n/).filter(line => line.startsWith('p')).map(line => Number(line.slice(1))).filter(Boolean))]
  return Promise.all(pids.map(async pid => ({
    pid,
    cwd: await processCwd(pid),
    command: await processCommand(pid),
  })))
}

export async function processCwd(pid) {
  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    const line = stdout.split(/\r?\n/).find(item => item.startsWith('n'))
    return line ? line.slice(1) : null
  } catch {
    return null
  }
}

async function processCommand(pid) {
  try {
    const { stdout } = await execFileAsync('/bin/ps', ['-p', String(pid), '-o', 'command='], { maxBuffer: 1024 * 1024 })
    return stdout.trim().slice(0, 800)
  } catch {
    return null
  }
}

function checkHttp(service) {
  const client = service.protocol === 'https' ? https : http
  const url = new URL(service.openUrl)
  const startedAt = Date.now()
  return new Promise(resolve => {
    const request = client.request(url, {
      method: 'HEAD',
      timeout: 1500,
      rejectUnauthorized: false,
    }, response => {
      response.resume()
      resolve({ ok: true, latencyMs: Date.now() - startedAt, statusCode: response.statusCode || null })
    })
    request.on('timeout', () => request.destroy(new Error('timeout')))
    request.on('error', () => resolve({ ok: false, latencyMs: Date.now() - startedAt, statusCode: null }))
    request.end()
  })
}

function serviceStatus(service, details) {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    projectName: service.projectName,
    group: service.group,
    port: service.port,
    protocol: service.protocol,
    openUrl: service.openUrl,
    cwd: service.cwd,
    cwdLabel: service.cwdLabel,
    controllable: details.controllable !== false && details.state !== 'conflict',
    busy: false,
    health: details.health || null,
    ...details,
  }
}

function summarize(services) {
  const summary = { total: services.length, running: 0, stopped: 0, unhealthy: 0, conflict: 0, starting: 0 }
  for (const service of services) summary[service.state] = (summary[service.state] || 0) + 1
  return summary
}

function sameOrChildPath(candidate, expected) {
  if (!candidate) return false
  const relative = path.relative(expected, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isPidAlive(pid) {
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

function safeKill(pid, signal) {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await delay(200)
  }
  return false
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function rotateLog(logPath) {
  if (!fs.existsSync(logPath) || fs.statSync(logPath).size < 5 * 1024 * 1024) return
  const backup = `${logPath}.1`
  if (fs.existsSync(backup)) fs.unlinkSync(backup)
  fs.renameSync(logPath, backup)
}
