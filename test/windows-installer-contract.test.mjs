import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const installScript = fs.readFileSync(new URL('../scripts/install-windows.ps1', import.meta.url), 'utf8')
const uninstallScript = fs.readFileSync(new URL('../scripts/uninstall-windows.ps1', import.meta.url), 'utf8')

test('installs the Windows runtime per user with a logon task and CLI wrapper', () => {
  assert.match(installScript, /\$env:LOCALAPPDATA/)
  assert.match(installScript, /New-ScheduledTaskTrigger -AtLogOn/)
  assert.match(installScript, /New-ScheduledTaskPrincipal.*-RunLevel Limited/)
  assert.match(installScript, /kmcb-svc\.cmd/)
  assert.match(installScript, /start-control-centre\.ps1/)
  assert.match(installScript, /Write-Utf8WithBom/)
  assert.match(installScript, /SetEnvironmentVariable\('Path'.*'User'\)/)
})

test('refuses to replace an unrelated Windows port owner', () => {
  assert.match(installScript, /Test-CommandLineOwnedByControlCentre/)
  assert.match(installScript, /NormalizedRoot/)
  assert.match(installScript, /Refusing installation: port/)
  assert.match(uninstallScript, /Test-CommandLineOwnedByControlCentre/)
})

test('can uninstall Windows while retaining runtime data', () => {
  assert.match(uninstallScript, /\[switch\]\$KeepRuntime/)
  assert.match(uninstallScript, /retained runtime data/)
  assert.match(uninstallScript, /SetEnvironmentVariable\('Path'.*'User'\)/)
})
