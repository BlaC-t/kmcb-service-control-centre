import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeCommand, validateConfig } from '../src/config.mjs'

const registry = JSON.parse(fs.readFileSync(new URL('../config/services.json', import.meta.url), 'utf8'))

const base = {
  host: '127.0.0.1',
  port: 17600,
  workspaceRoot: os.tmpdir(),
  services: [
    {
      id: 'fixture',
      name: 'Fixture',
      cwd: 'fixture',
      port: 17601,
      protocol: 'http',
      command: 'node server.mjs',
    },
  ],
}

test('normalizes a valid localhost-only registry', () => {
  const config = validateConfig(base)
  assert.equal(config.services[0].cwd, pathJoinReal(os.tmpdir(), 'fixture'))
  assert.equal(config.services[0].projectName, 'fixture')
  assert.equal(config.services[0].port, 17601)
})

test('rejects a non-local bind host', () => {
  assert.throws(() => validateConfig({ ...base, host: '0.0.0.0' }), /must bind only/)
})

test('rejects duplicate ports', () => {
  const duplicate = {
    ...base,
    services: [...base.services, { ...base.services[0], id: 'other' }],
  }
  assert.throws(() => validateConfig(duplicate), /Duplicate or reserved port/)
})

test('rejects working directories outside the workspace root', () => {
  const invalid = {
    ...base,
    services: [{ ...base.services[0], cwd: '../outside' }],
  }
  assert.throws(() => validateConfig(invalid), /stay inside workspaceRoot/)
})

test('starts the BMS API with the dev Spring profile', () => {
  const mainApi = registry.services.find(service => service.id === 'main-api')
  assert.ok(mainApi)
  assert.match(mainApi.command, /--spring\.profiles\.active=dev(?:\s|$)/)
})

test('registers the standalone Trace frontend on its fixed port', () => {
  const traceWeb = registry.services.find(service => service.id === 'trace-web')

  assert.deepEqual(
    {
      projectName: traceWeb?.projectName,
      cwd: traceWeb?.cwd,
      port: traceWeb?.port,
      protocol: traceWeb?.protocol,
    },
    {
      projectName: 'kmcb-trace-web',
      cwd: 'kmcb-trace-web',
      port: 3300,
      protocol: 'http',
    },
  )
})

test('registers the mobile uni-app H5 frontend on its fixed port', () => {
  const mobileWeb = registry.services.find(service => service.id === 'mobile-web')

  assert.deepEqual(
    {
      projectName: mobileWeb?.projectName,
      cwd: mobileWeb?.cwd,
      port: mobileWeb?.port,
      openUrl: mobileWeb?.openUrl,
    },
    {
      projectName: 'kmcb-mobile',
      cwd: 'kmcb-mobile',
      port: 3400,
      openUrl: 'http://127.0.0.1:3400/webapp/',
    },
  )
  assert.match(mobileWeb?.command || '', /uniapp-h5\.mjs/)
  assert.match(mobileWeb?.commandWindows || '', /uniapp-h5\.mjs/)
})

test('starts CRM services with the project Java 17 runtime', () => {
  const config = validateConfig(registry, { platform: 'darwin' })
  for (const id of ['crm-api', 'crm-gateway']) {
    const service = config.services.find(candidate => candidate.id === id)
    assert.ok(service, `${id} must be registered`)
    assert.equal(service.env.JAVA_HOME, '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home')
  }
})

test('selects Windows commands without inheriting the macOS Java path', () => {
  const config = validateConfig(registry, { platform: 'win32' })
  const adminWeb = config.services.find(service => service.id === 'admin-web')
  const mainApi = config.services.find(service => service.id === 'main-api')
  const crmApi = config.services.find(service => service.id === 'crm-api')

  assert.equal(adminWeb?.command, 'npm run dev')
  assert.doesNotMatch(mainApi?.command || '', /\bexec\b/)
  assert.equal(crmApi?.env.JAVA_HOME, undefined)
})

test('normalizes POSIX exec commands for Windows when no override is present', () => {
  assert.equal(normalizeCommand('exec npm run dev', 'win32'), 'npm run dev')
  assert.equal(
    normalizeCommand('mvn package && exec java -jar app.jar', 'win32'),
    'mvn package && java -jar app.jar',
  )
  assert.equal(normalizeCommand('exec npm run dev', 'darwin'), 'exec npm run dev')
})

test('distinguishes the CRM main application from its customer gateway', () => {
  const crmApi = registry.services.find(service => service.id === 'crm-api')
  const crmGateway = registry.services.find(service => service.id === 'crm-gateway')

  assert.deepEqual(
    {
      projectName: crmApi?.projectName,
      name: crmApi?.name,
      port: crmApi?.port,
    },
    {
      projectName: 'kj-crm-api',
      name: 'StartApp',
      port: 7110,
    },
  )
  assert.match(crmApi?.description || '', /CRM 主业务后端.*StartApp/)

  assert.deepEqual(
    {
      projectName: crmGateway?.projectName,
      name: crmGateway?.name,
      port: crmGateway?.port,
    },
    {
      projectName: 'kj-crm-gateway-api',
      name: 'StartAppGateWay',
      port: 7111,
    },
  )
  assert.match(crmGateway?.description || '', /客户门户网关.*StartAppGateWay/)
})

function pathJoinReal(parent, child) {
  return path.join(fs.realpathSync.native(parent), child)
}
