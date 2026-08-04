import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateConfig } from '../src/config.mjs'
import { loadServiceSecretEnv, ProcessManager } from '../src/process-manager.mjs'

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('loads a service-specific mode-600 secret environment file', t => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmcb-service-env-'))
  const envDir = path.join(runtimeDir, 'service-env')
  const envPath = path.join(envDir, 'crm-gateway.env')
  fs.mkdirSync(envDir, { recursive: true })
  fs.writeFileSync(envPath, [
    '# local secrets',
    'SMTP_HOST=smtp.example.com',
    'export SMTP_PASSWORD="not-logged"',
    '',
  ].join('\n'), { mode: 0o600 })
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }))

  assert.deepEqual(loadServiceSecretEnv(runtimeDir, 'crm-gateway'), {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PASSWORD: 'not-logged',
  })
  assert.deepEqual(loadServiceSecretEnv(runtimeDir, 'missing'), {})
})

test('rejects a service secret environment file readable by other users', t => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmcb-service-env-mode-'))
  const envDir = path.join(runtimeDir, 'service-env')
  const envPath = path.join(envDir, 'crm-gateway.env')
  fs.mkdirSync(envDir, { recursive: true })
  fs.writeFileSync(envPath, 'SMTP_PASSWORD=unsafe\n', { mode: 0o644 })
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }))

  assert.throws(
    () => loadServiceSecretEnv(runtimeDir, 'crm-gateway'),
    /must use mode 600/,
  )
})

test('marks a managed process unhealthy after its startup timeout', async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kmcb-service-startup-timeout-'))
  const runtimeDir = path.join(tempRoot, 'runtime')
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

  const controlPort = await freePort()
  let servicePort = await freePort()
  while (servicePort === controlPort) servicePort = await freePort()
  const config = validateConfig({
    host: '127.0.0.1',
    port: controlPort,
    workspaceRoot: tempRoot,
    startupTimeoutMs: 1,
    services: [{
      id: 'timed-out',
      cwd: '.',
      port: servicePort,
      protocol: 'http',
      command: 'node server.mjs',
    }],
  })
  const manager = new ProcessManager(config, runtimeDir)
  manager.state.services['timed-out'] = {
    pid: process.pid,
    startedAt: new Date(Date.now() - 1000).toISOString(),
    command: 'node server.mjs',
  }

  const status = await manager.status('timed-out')
  assert.equal(status.state, 'unhealthy')
  assert.match(status.message, /启动超过 1 秒/)
})

test('marks a port owned by another project as conflict and refuses to stop it', { timeout: 15000 }, async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kmcb-service-conflict-'))
  const expectedCwd = path.join(tempRoot, 'expected')
  const conflictingCwd = path.join(tempRoot, 'conflicting')
  const runtimeDir = path.join(tempRoot, 'runtime')
  fs.mkdirSync(expectedCwd)
  fs.mkdirSync(conflictingCwd)
  const port = await freePort()
  const fixturePath = path.join(toolRoot, 'test', 'fixture-service.mjs')
  const conflicting = spawn(process.execPath, [fixturePath, String(port)], {
    cwd: conflictingCwd,
    stdio: 'ignore',
  })

  t.after(() => {
    conflicting.kill('SIGTERM')
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  await waitForPort(port)
  let controlPort = await freePort()
  while (controlPort === port) controlPort = await freePort()
  const config = validateConfig({
    host: '127.0.0.1',
    port: controlPort,
    workspaceRoot: tempRoot,
    services: [{
      id: 'expected',
      cwd: 'expected',
      port,
      protocol: 'http',
      command: 'node server.mjs',
    }],
  })
  const manager = new ProcessManager(config, runtimeDir)
  const status = await manager.status('expected')
  assert.equal(status.state, 'conflict')
  assert.equal(status.controllable, false)
  await assert.rejects(() => manager.action('expected', 'stop'), /其他项目占用/)
  assert.equal(conflicting.exitCode, null)
})

async function waitForPort(port) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`)
      if (response.ok) return
    } catch {
      // Keep waiting.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Fixture did not start.')
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
