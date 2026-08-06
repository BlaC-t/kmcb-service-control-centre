#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, TOOL_ROOT } from '../src/config.mjs'
import { defaultRuntimeDir } from '../src/runtime-paths.mjs'

const config = loadConfig()
const baseUrl = process.env.SERVICE_CONTROL_URL || `http://${config.host}:${config.port}`
const runtimeDir = path.resolve(
  process.env.SERVICE_CONTROL_RUNTIME ||
  defaultRuntimeDir()
)
const [command = 'status', id] = process.argv.slice(2)
const commands = new Set(['status', 'start', 'stop', 'restart', 'logs'])

if (!commands.has(command)) exitWithUsage(`Unknown command: ${command}`)
if (command !== 'status' && !id) exitWithUsage(`${command} requires a service id.`)

await ensureControlCenter()

if (command === 'status') {
  const payload = await request('/api/status')
  const services = id ? payload.services.filter(service => service.id === id) : payload.services
  if (id && !services.length) throw new Error(`Unknown service: ${id}`)
  for (const service of services) {
    console.log(`${service.id.padEnd(18)} ${service.state.padEnd(10)} :${String(service.port).padEnd(5)} ${service.source || '-'}${service.pid ? ` pid=${service.pid}` : ''}`)
  }
  process.exit(0)
}

if (command === 'logs') {
  const payload = await request(`/api/services/${id}/logs?lines=240`)
  console.log(payload.logs)
  process.exit(0)
}

const tokenPath = path.join(runtimeDir, 'control-token')
const token = fs.readFileSync(tokenPath, 'utf8').trim()
const payload = await request(`/api/services/${id}/${command}`, {
  method: 'POST',
  headers: { 'X-Service-Control-Token': token },
}, 30000)
console.log(`${payload.service.id}: ${payload.service.state} on port ${payload.service.port}`)

async function ensureControlCenter() {
  try {
    await request('/api/status', {}, 5000)
    return
  } catch {
    fs.mkdirSync(runtimeDir, { recursive: true })
    const logFd = fs.openSync(path.join(runtimeDir, 'control-center.log'), 'a')
    const child = spawn(process.execPath, [path.join(TOOL_ROOT, 'src', 'server.mjs')], {
      cwd: TOOL_ROOT,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: process.env,
    })
    child.unref()
    fs.closeSync(logFd)
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 200))
      try {
        await request('/api/status', {}, 5000)
        return
      } catch {
        // Continue waiting for the control center bootstrap.
      }
    }
    throw new Error(`Control center did not start. Check ${path.join(runtimeDir, 'control-center.log')}`)
  }
}

async function request(route, options = {}, timeoutMs = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}${route}`, { ...options, signal: controller.signal })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
    return payload
  } finally {
    clearTimeout(timer)
  }
}

function exitWithUsage(message) {
  console.error(message)
  console.error('Usage: svc.mjs status [service-id] | start|stop|restart|logs <service-id>')
  process.exit(2)
}
