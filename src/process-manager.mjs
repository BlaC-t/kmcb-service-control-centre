import { EventEmitter } from 'node:events'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const controlRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export class ProcessManager extends EventEmitter {
  constructor(config, runtimeDir, options = {}) {
    super()
    this.config = config
    this.runtimeDir = runtimeDir
    this.platform = options.platform || process.platform
    this.findListeners = options.findListeners || (port => findListenerDetails(port, this.platform))
    this.windowsProcessTree = options.windowsProcessTree || windowsProcessTreePids
    this.windowsInspection = options.windowsInspection || inspectWindowsProcesses
    this.terminateWindowsTree = options.terminateWindowsTree || terminateWindowsProcessTree
    this.spawnProcess = options.spawnProcess || spawn
    this.logsDir = path.join(runtimeDir, 'logs')
    this.statePath = path.join(runtimeDir, 'state.json')
    this.locks = new Map()
    fs.mkdirSync(this.logsDir, { recursive: true })
    this.state = readJson(this.statePath, { services: {} })
  }

  async statuses() {
    const inspection = this.platform === 'win32'
      ? await this.windowsInspection(this.config.services.map(service => service.port))
      : null
    const services = await Promise.all(this.config.services.map(service => this.status(service.id, inspection)))
    for (const service of services) service.busy = this.locks.has(service.id)
    return {
      generatedAt: new Date().toISOString(),
      summary: summarize(services),
      services,
    }
  }

  async status(id, inspection = null) {
    const service = this.getService(id)
    const listeners = inspection?.listenersByPort?.get(service.port) || await this.findListeners(service.port)
    const managed = this.state.services[id]
    const managedAlive = managed ? isPidAlive(managed.pid) : false
    let managedOwned = managedAlive
    let matching
    let conflicts

    if (this.platform === 'win32') {
      const managedPids = managedAlive
        ? inspection?.processes
          ? windowsManagedProcessIds(inspection.processes, managed)
          : await this.windowsProcessTree(managed.pid, managed.command, managed.startedAt)
        : new Set()
      managedOwned = managedPids.size > 0
      matching = listeners.filter(listener => managedPids.has(listener.pid))
      conflicts = listeners.filter(listener => !managedPids.has(listener.pid))
    } else {
      matching = listeners.filter(listener => sameOrChildPath(listener.cwd, service.cwd))
      conflicts = listeners.filter(listener => !sameOrChildPath(listener.cwd, service.cwd))
    }

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

    if (managedAlive && managedOwned) {
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

    if (managed && (!managedAlive || !managedOwned)) {
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
    const secretEnv = loadServiceSecretEnv(this.runtimeDir, service.id, this.platform)

    const launch = commandLaunchSpec(service.command, this.platform)
    const childEnv = buildServiceEnvironment({
      baseEnv: process.env,
      serviceEnv: service.env,
      secretEnv,
      id,
      port: service.port,
      platform: this.platform,
    })
    const child = this.spawnProcess(launch.file, launch.args, {
      cwd: service.cwd,
      detached: true,
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
      stdio: ['ignore', logFd, logFd],
      env: childEnv,
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
    let windowsManagedPids = new Set()
    if (this.platform === 'win32' && managed && isPidAlive(managed.pid)) {
      windowsManagedPids = await this.windowsProcessTree(managed.pid, managed.command, managed.startedAt)
      if (!windowsManagedPids.size) {
        throw new Error(`Refusing to stop PID ${managed.pid}: managed process identity mismatch.`)
      }
      await this.terminateWindowsTree(managed.pid)
    } else if (managed && isPidAlive(managed.pid)) {
      safeKill(-managed.pid, 'SIGTERM')
    } else if (current.pid) {
      const actualCwd = await processCwd(current.pid)
      if (!sameOrChildPath(actualCwd, service.cwd)) {
        throw new Error(`Refusing to stop PID ${current.pid}: working directory mismatch.`)
      }
      safeKill(current.pid, 'SIGTERM')
    }

    const stopped = await waitFor(async () => {
      const listeners = await this.findListeners(service.port)
      if (this.platform === 'win32') {
        return !listeners.some(listener => windowsManagedPids.has(listener.pid))
      }
      return !listeners.some(listener => sameOrChildPath(listener.cwd, service.cwd))
    }, this.config.stopTimeoutMs)

    if (!stopped) {
      if (this.platform === 'win32' && managed && isPidAlive(managed.pid)) {
        await this.terminateWindowsTree(managed.pid)
      } else if (managed && isPidAlive(managed.pid)) safeKill(-managed.pid, 'SIGKILL')
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

export function loadServiceSecretEnv(runtimeDir, serviceId, platform = process.platform) {
  const envPath = path.join(runtimeDir, 'service-env', `${serviceId}.env`)
  if (!fs.existsSync(envPath)) return {}

  const mode = fs.statSync(envPath).mode & 0o777
  if (platform !== 'win32' && (mode & 0o077) !== 0) {
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

export async function findListenerDetails(port, platform = process.platform) {
  if (platform === 'win32') return findWindowsListenerDetails(port)

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

export async function processCwd(pid, platform = process.platform) {
  if (platform === 'win32') return null

  try {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    const line = stdout.split(/\r?\n/).find(item => item.startsWith('n'))
    return line ? line.slice(1) : null
  } catch {
    return null
  }
}

export function commandLaunchSpec(command, platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return {
      file: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${command}"`],
      windowsVerbatimArguments: true,
    }
  }

  return { file: '/bin/zsh', args: ['-lc', command] }
}

export function buildServiceEnvironment({
  baseEnv = process.env,
  serviceEnv = {},
  secretEnv = {},
  id,
  port,
  platform = process.platform,
}) {
  const sources = [baseEnv, serviceEnv, secretEnv]
  const result = {}

  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (platform === 'win32') {
        const existingKey = Object.keys(result).find(item => item.toLowerCase() === key.toLowerCase())
        if (existingKey) delete result[existingKey]
      }
      result[key] = value
    }
  }

  result.SERVICE_CONTROL_ID = id
  result.SERVICE_CONTROL_PORT = String(port)
  result.SERVICE_CONTROL_ROOT = controlRoot

  if (platform === 'win32') {
    const javaHomeKey = Object.keys(result).find(key => key.toLowerCase() === 'java_home')
    if (javaHomeKey) {
      const pathKey = Object.keys(result).find(key => key.toLowerCase() === 'path')
      const javaBin = path.win32.join(String(result[javaHomeKey]), 'bin')
      const currentPath = pathKey ? String(result[pathKey] || '') : ''
      if (pathKey) delete result[pathKey]
      result.Path = currentPath ? `${javaBin};${currentPath}` : javaBin
    }
  }

  return result
}

export function parseWindowsNetstat(stdout, port) {
  const pids = new Set()
  for (const sourceLine of String(stdout || '').split(/\r?\n/)) {
    const columns = sourceLine.trim().split(/\s+/)
    if (columns.length < 5 || columns[0].toUpperCase() !== 'TCP') continue
    if (columns.at(-2).toUpperCase() !== 'LISTENING') continue
    const localPort = Number(columns[1].match(/:(\d+)$/)?.[1])
    const pid = Number(columns.at(-1))
    if (localPort === Number(port) && Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids]
}

export function descendantProcessIds(processes, rootPid) {
  const result = new Set([Number(rootPid)])
  let changed = true
  while (changed) {
    changed = false
    for (const processInfo of processes) {
      const pid = Number(processInfo.processId ?? processInfo.ProcessId)
      const parentPid = Number(processInfo.parentProcessId ?? processInfo.ParentProcessId)
      if (Number.isInteger(pid) && result.has(parentPid) && !result.has(pid)) {
        result.add(pid)
        changed = true
      }
    }
  }
  return result
}

export function windowsManagedProcessIds(processes, managed) {
  const rootPid = Number(managed?.pid)
  const expectedCommand = String(managed?.command || '').trim()
  const expectedStartedAt = Date.parse(managed?.startedAt)
  if (!Number.isInteger(rootPid) || !expectedCommand || !Number.isFinite(expectedStartedAt)) return new Set()

  const root = processes.find(processInfo => Number(processInfo.processId ?? processInfo.ProcessId) === rootPid)
  const commandLine = String(root?.commandLine ?? root?.CommandLine ?? '')
  if (!commandLine || !commandLine.toLowerCase().includes(expectedCommand.toLowerCase())) return new Set()
  const actualStartedAt = windowsCreationTimeMs(root?.creationDate ?? root?.CreationDate)
  if (!Number.isFinite(actualStartedAt) || Math.abs(actualStartedAt - expectedStartedAt) > 15000) return new Set()
  return descendantProcessIds(processes, rootPid)
}

export function windowsCreationTimeMs(value) {
  const source = String(value || '')
  const dotNetMatch = source.match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/)
  if (dotNetMatch) return Number(dotNetMatch[1])
  return Date.parse(source)
}

export async function windowsProcessTreePids(rootPid, expectedCommand, expectedStartedAt) {
  try {
    const processes = await listWindowsProcesses()
    return windowsManagedProcessIds(processes, {
      pid: rootPid,
      command: expectedCommand,
      startedAt: expectedStartedAt,
    })
  } catch {
    return new Set()
  }
}

export async function inspectWindowsProcesses(ports) {
  const requestedPorts = new Set(ports.map(Number))
  const script = [
    '$connections = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess)',
    '$processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate)',
    '[pscustomobject]@{ connections = $connections; processes = $processes } | ConvertTo-Json -Compress -Depth 3',
  ].join('; ')

  try {
    const parsed = await runWindowsPowerShellJson(script)
    const processes = arrayValue(parsed?.processes ?? parsed?.Processes)
    const listenersByPort = new Map([...requestedPorts].map(port => [port, []]))
    for (const connection of arrayValue(parsed?.connections ?? parsed?.Connections)) {
      const port = Number(connection.localPort ?? connection.LocalPort)
      const pid = Number(connection.owningProcess ?? connection.OwningProcess)
      if (!requestedPorts.has(port) || !Number.isInteger(pid) || pid <= 0) continue
      const listeners = listenersByPort.get(port)
      if (!listeners.some(listener => listener.pid === pid)) {
        listeners.push({ pid, cwd: null, command: null })
      }
    }
    return { listenersByPort, processes }
  } catch {
    return inspectWindowsProcessesWithNetstat(requestedPorts)
  }
}

export async function terminateWindowsProcessTree(pid) {
  if (!isPidAlive(pid)) return
  try {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'])
  } catch (error) {
    if (isPidAlive(pid)) throw error
  }
}

async function findWindowsListenerDetails(port) {
  const inspection = await inspectWindowsProcesses([port])
  return inspection.listenersByPort.get(Number(port)) || []
}

async function listWindowsProcesses() {
  const script = [
    'Get-CimInstance Win32_Process',
    'Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate',
    'ConvertTo-Json -Compress',
  ].join(' | ')
  return arrayValue(await runWindowsPowerShellJson(script))
}

async function runWindowsPowerShellJson(script) {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ], { maxBuffer: 4 * 1024 * 1024 })
  return stdout.trim() ? JSON.parse(stdout.trim()) : null
}

async function inspectWindowsProcessesWithNetstat(requestedPorts) {
  let stdout
  try {
    const result = await execFileAsync('netstat.exe', ['-ano', '-p', 'tcp'], { maxBuffer: 4 * 1024 * 1024 })
    stdout = result.stdout
  } catch (error) {
    if (error.code === 1) {
      return {
        listenersByPort: new Map([...requestedPorts].map(port => [port, []])),
        processes: null,
      }
    }
    throw error
  }

  const listenersByPort = new Map()
  for (const port of requestedPorts) {
    listenersByPort.set(port, parseWindowsNetstat(stdout, port).map(pid => ({
      pid,
      cwd: null,
      command: null,
    })))
  }
  return { listenersByPort, processes: null }
}

function arrayValue(value) {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
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
  } catch (error) {
    if (error.code === 'EPERM') return true
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
