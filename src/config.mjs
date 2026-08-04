import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_CONFIG_PATH = path.join(TOOL_ROOT, 'config', 'services.json')

export function loadConfig(configPath = process.env.SERVICE_CONTROL_CONFIG || DEFAULT_CONFIG_PATH) {
  const absoluteConfigPath = path.resolve(configPath)
  const raw = JSON.parse(fs.readFileSync(absoluteConfigPath, 'utf8'))
  const config = validateConfig(raw)
  return { ...config, configPath: absoluteConfigPath }
}

export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Service configuration must be an object.')

  const host = String(raw.host || '127.0.0.1')
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('The control center must bind only to 127.0.0.1 or localhost.')
  }

  const port = toPort(raw.port, 'control center')
  const workspaceRoot = realpathExisting(path.resolve(String(raw.workspaceRoot || '')))
  const seenIds = new Set()
  const seenPorts = new Set([port])
  const services = Array.isArray(raw.services) ? raw.services : []

  if (!services.length) throw new Error('At least one service must be registered.')

  const normalized = services.map((service, index) => {
    const label = `services[${index}]`
    const id = String(service.id || '')
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`${label}.id is invalid.`)
    if (seenIds.has(id)) throw new Error(`Duplicate service id: ${id}`)
    seenIds.add(id)

    const servicePort = toPort(service.port, id)
    if (seenPorts.has(servicePort)) throw new Error(`Duplicate or reserved port: ${servicePort}`)
    seenPorts.add(servicePort)

    const cwd = realpathExisting(path.resolve(workspaceRoot, String(service.cwd || '')))
    if (!isWithin(cwd, workspaceRoot)) throw new Error(`${id} cwd must stay inside workspaceRoot.`)

    const protocol = String(service.protocol || 'http')
    if (!['http', 'https', 'tcp'].includes(protocol)) throw new Error(`${id} has an unsupported protocol.`)

    const command = String(service.command || '').trim()
    if (!command) throw new Error(`${id} command is required.`)

    const cwdLabel = path.relative(workspaceRoot, cwd) || '.'

    return {
      id,
      name: String(service.name || id),
      description: String(service.description || ''),
      projectName: String(service.projectName || cwdLabel.split(path.sep)[0] || id),
      group: String(service.group || 'other'),
      cwd,
      cwdLabel,
      port: servicePort,
      protocol,
      openUrl: String(service.openUrl || `${protocol === 'tcp' ? 'http' : protocol}://127.0.0.1:${servicePort}`),
      command,
      env: normalizeEnv(service.env),
    }
  })

  return {
    title: String(raw.title || 'Local Service Control'),
    host,
    port,
    workspaceRoot,
    pollIntervalMs: positiveInteger(raw.pollIntervalMs, 2000),
    startupTimeoutMs: positiveInteger(raw.startupTimeoutMs, 60000),
    stopTimeoutMs: positiveInteger(raw.stopTimeoutMs, 12000),
    services: normalized,
  }
}

function normalizeEnv(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]))
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function toPort(value, label) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port for ${label}: ${value}`)
  }
  return port
}

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function realpathExisting(value) {
  try {
    return fs.realpathSync.native(value)
  } catch {
    return value
  }
}
