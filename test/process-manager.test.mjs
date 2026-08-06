import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateConfig } from '../src/config.mjs'
import {
  buildServiceEnvironment,
  commandLaunchSpec,
  descendantProcessIds,
  loadServiceSecretEnv,
  parseWindowsNetstat,
  ProcessManager,
  windowsCreationTimeMs,
  windowsManagedProcessIds,
} from '../src/process-manager.mjs'

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('loads a service-specific mode-600 secret environment file', { skip: process.platform === 'win32' }, t => {
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

  assert.deepEqual(loadServiceSecretEnv(runtimeDir, 'crm-gateway', 'darwin'), {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PASSWORD: 'not-logged',
  })
  assert.deepEqual(loadServiceSecretEnv(runtimeDir, 'missing', 'darwin'), {})
})

test('rejects a service secret environment file readable by other users', { skip: process.platform === 'win32' }, t => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmcb-service-env-mode-'))
  const envDir = path.join(runtimeDir, 'service-env')
  const envPath = path.join(envDir, 'crm-gateway.env')
  fs.mkdirSync(envDir, { recursive: true })
  fs.writeFileSync(envPath, 'SMTP_PASSWORD=unsafe\n', { mode: 0o644 })
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }))

  assert.throws(
    () => loadServiceSecretEnv(runtimeDir, 'crm-gateway', 'darwin'),
    /must use mode 600/,
  )
})

test('loads a Windows secret environment file without POSIX mode checks', t => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmcb-service-env-windows-'))
  const envDir = path.join(runtimeDir, 'service-env')
  const envPath = path.join(envDir, 'fixture.env')
  fs.mkdirSync(envDir, { recursive: true })
  fs.writeFileSync(envPath, 'API_TOKEN=local-only\n', { mode: 0o644 })
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }))

  assert.deepEqual(loadServiceSecretEnv(runtimeDir, 'fixture', 'win32'), {
    API_TOKEN: 'local-only',
  })
})

test('parses Windows listeners and process descendants', () => {
  const netstat = [
    '  TCP    0.0.0.0:5211         0.0.0.0:0              LISTENING       4100',
    '  TCP    [::]:5211            [::]:0                 LISTENING       4100',
    '  TCP    127.0.0.1:5212       0.0.0.0:0              LISTENING       4200',
  ].join('\r\n')
  assert.deepEqual(parseWindowsNetstat(netstat, 5211), [4100])

  assert.deepEqual(
    [...descendantProcessIds([
      { ProcessId: 200, ParentProcessId: 100 },
      { ProcessId: 300, ParentProcessId: 200 },
      { ProcessId: 999, ParentProcessId: 1 },
    ], 100)],
    [100, 200, 300],
  )
})

test('rejects a reused Windows PID when the root command fingerprint differs', () => {
  const startedAt = '2026-08-06T02:00:00.000Z'
  const processes = [
    {
      ProcessId: 100,
      ParentProcessId: 1,
      CommandLine: 'cmd.exe /c npm run unrelated',
      CreationDate: startedAt,
    },
    { ProcessId: 200, ParentProcessId: 100, CommandLine: 'node unrelated.js' },
  ]
  assert.deepEqual(
    [...windowsManagedProcessIds(processes, { pid: 100, command: 'npm run dev', startedAt })],
    [],
  )
  assert.deepEqual(
    [...windowsManagedProcessIds(processes, { pid: 100, command: 'npm run unrelated', startedAt })],
    [100, 200],
  )
  assert.deepEqual(
    [...windowsManagedProcessIds(processes, {
      pid: 100,
      command: 'npm run unrelated',
      startedAt: '2026-08-06T03:00:00.000Z',
    })],
    [],
  )
  assert.equal(windowsCreationTimeMs('/Date(1785981600000+0000)/'), 1785981600000)
})

test('uses cmd.exe for Windows service commands', () => {
  assert.deepEqual(
    commandLaunchSpec('npm run dev', 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }),
    {
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npm run dev'],
    },
  )
})

test('prepends envWindows JAVA_HOME to the Windows child PATH', () => {
  const env = buildServiceEnvironment({
    baseEnv: { Path: 'C:\\Windows\\System32' },
    serviceEnv: {
      JAVA_HOME: 'C:\\Java\\jdk-17',
      PATH: 'C:\\Tools',
    },
    id: 'java-service',
    port: 8080,
    platform: 'win32',
  })
  assert.equal(env.Path, 'C:\\Java\\jdk-17\\bin;C:\\Tools')
  assert.equal('PATH' in env, false)
  assert.equal(env.SERVICE_CONTROL_ID, 'java-service')
  assert.equal(env.SERVICE_CONTROL_PORT, '8080')
})

test('controls only a listener inside its managed Windows process tree', async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kmcb-service-windows-tree-'))
  const runtimeDir = path.join(tempRoot, 'runtime')
  const controlPort = await freePort()
  let servicePort = await freePort()
  while (servicePort === controlPort) servicePort = await freePort()
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

  const config = validateConfig({
    host: '127.0.0.1',
    port: controlPort,
    workspaceRoot: tempRoot,
    services: [{
      id: 'windows-fixture',
      cwd: '.',
      port: servicePort,
      protocol: 'tcp',
      command: 'node server.mjs',
    }],
  }, { platform: 'win32' })
  let terminated = false
  const listenerPid = 4242
  const manager = new ProcessManager(config, runtimeDir, {
    platform: 'win32',
    findListeners: async () => terminated ? [] : [{ pid: listenerPid, cwd: null, command: null }],
    windowsProcessTree: async rootPid => new Set([rootPid, listenerPid]),
    terminateWindowsTree: async () => { terminated = true },
  })
  manager.state.services['windows-fixture'] = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    command: 'node server.mjs',
  }

  const running = await manager.status('windows-fixture')
  assert.equal(running.state, 'running')
  assert.equal(running.source, 'managed')

  const stopped = await manager.stop('windows-fixture')
  assert.equal(terminated, true)
  assert.equal(stopped.state, 'stopped')
})

test('treats an unmanaged Windows listener as a conflict', async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kmcb-service-windows-conflict-'))
  const runtimeDir = path.join(tempRoot, 'runtime')
  const controlPort = await freePort()
  let servicePort = await freePort()
  while (servicePort === controlPort) servicePort = await freePort()
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

  const config = validateConfig({
    host: '127.0.0.1',
    port: controlPort,
    workspaceRoot: tempRoot,
    services: [{
      id: 'external-windows-fixture',
      cwd: '.',
      port: servicePort,
      protocol: 'tcp',
      command: 'node server.mjs',
    }],
  }, { platform: 'win32' })
  const manager = new ProcessManager(config, runtimeDir, {
    platform: 'win32',
    findListeners: async () => [{ pid: 9911, cwd: null, command: null }],
  })

  const status = await manager.status('external-windows-fixture')
  assert.equal(status.state, 'conflict')
  assert.equal(status.controllable, false)
  await assert.rejects(() => manager.stop('external-windows-fixture'), /其他项目占用/)
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
  const manager = new ProcessManager(config, runtimeDir, { platform: 'darwin' })
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
