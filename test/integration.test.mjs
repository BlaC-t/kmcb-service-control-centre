import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('starts, restarts, logs, and stops a registered service through the HTTP API', { timeout: 30000 }, async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kmcb-service-control-'))
  const runtimeDir = path.join(tempRoot, 'runtime')
  const controlPort = await freePort()
  let servicePort = await freePort()
  while (servicePort === controlPort) servicePort = await freePort()
  const configPath = path.join(tempRoot, 'services.json')
  const fixturePath = path.join(toolRoot, 'test', 'fixture-service.mjs')
  fs.writeFileSync(configPath, JSON.stringify({
    host: '127.0.0.1',
    port: controlPort,
    workspaceRoot: tempRoot,
    pollIntervalMs: 200,
    stopTimeoutMs: 4000,
    services: [{
      id: 'fixture',
      name: 'Fixture Service',
      cwd: '.',
      port: servicePort,
      protocol: 'http',
      openUrl: `http://127.0.0.1:${servicePort}`,
      command: `exec "${process.execPath}" "${fixturePath}" ${servicePort}`,
    }],
  }))

  const control = spawn(process.execPath, [path.join(toolRoot, 'src', 'server.mjs')], {
    cwd: toolRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SERVICE_CONTROL_CONFIG: configPath,
      SERVICE_CONTROL_RUNTIME: runtimeDir,
    },
  })

  t.after(async () => {
    try {
      const token = fs.readFileSync(path.join(runtimeDir, 'control-token'), 'utf8').trim()
      await fetch(`http://127.0.0.1:${controlPort}/api/services/fixture/stop`, {
        method: 'POST',
        headers: { 'X-Service-Control-Token': token },
      })
    } catch {
      // The fixture may already be stopped.
    }
    control.kill('SIGTERM')
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${controlPort}/api/status`)).ok
    } catch {
      return false
    }
  })

  const token = fs.readFileSync(path.join(runtimeDir, 'control-token'), 'utf8').trim()
  let status = await statusFor(controlPort)
  assert.equal(status.state, 'stopped')

  const unauthorized = await fetch(`http://127.0.0.1:${controlPort}/api/services/fixture/start`, { method: 'POST' })
  assert.equal(unauthorized.status, 401)

  await mutate(controlPort, token, 'start')
  status = await waitForStatus(controlPort, 'running')
  const firstPid = status.pid
  const firstStartedAt = status.startedAt
  assert.equal(status.source, 'managed')
  assert.match(firstStartedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal((await statusFor(controlPort)).startedAt, firstStartedAt)

  await mutate(controlPort, token, 'restart')
  status = await waitForStatus(controlPort, 'running')
  assert.notEqual(status.pid, firstPid)
  assert.notEqual(status.startedAt, firstStartedAt)
  const secondStartedAt = status.startedAt

  const logs = await (await fetch(`http://127.0.0.1:${controlPort}/api/services/fixture/logs`)).json()
  assert.match(logs.logs, /starting fixture/)

  await mutate(controlPort, token, 'stop')
  status = await waitForStatus(controlPort, 'stopped')
  assert.equal(status.pid, null)
  assert.equal(status.startedAt, secondStartedAt)
})

async function mutate(controlPort, token, action) {
  const response = await fetch(`http://127.0.0.1:${controlPort}/api/services/fixture/${action}`, {
    method: 'POST',
    headers: { 'X-Service-Control-Token': token },
  })
  const payload = await response.json()
  assert.equal(response.ok, true, payload.error)
}

async function statusFor(controlPort) {
  const payload = await (await fetch(`http://127.0.0.1:${controlPort}/api/status`)).json()
  return payload.services[0]
}

async function waitForStatus(controlPort, expected) {
  let latest
  try {
    await waitFor(async () => {
      latest = await statusFor(controlPort)
      return latest.state === expected
    })
  } catch {
    throw new Error(`Timed out waiting for ${expected}. Latest status: ${JSON.stringify(latest)}`)
  }
  return latest
}

async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 120))
  }
  throw new Error('Timed out waiting for condition.')
}

async function freePort() {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}
