import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { validateConfig } from '../src/config.mjs'

const registry = JSON.parse(fs.readFileSync(new URL('../config/services.json', import.meta.url), 'utf8'))

const base = {
  host: '127.0.0.1',
  port: 17600,
  workspaceRoot: '/tmp',
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
  assert.equal(config.services[0].cwd, pathJoinReal('/tmp', 'fixture'))
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

test('starts CRM services with the project Java 17 runtime', () => {
  for (const id of ['crm-api', 'crm-gateway']) {
    const service = registry.services.find(candidate => candidate.id === id)
    assert.ok(service, `${id} must be registered`)
    assert.equal(service.env?.JAVA_HOME, '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home')
  }
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
  return `${fs.realpathSync.native(parent)}/${child}`
}
