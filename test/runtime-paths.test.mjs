import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultAppRoot, defaultRuntimeDir } from '../src/runtime-paths.mjs'

test('uses LocalAppData for the Windows runtime', () => {
  const options = {
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local' },
    home: 'C:\\Users\\Alice',
  }
  assert.equal(
    defaultAppRoot(options),
    'C:\\Users\\Alice\\AppData\\Local\\KMCBServiceControl',
  )
  assert.equal(
    defaultRuntimeDir(options),
    'C:\\Users\\Alice\\AppData\\Local\\KMCBServiceControl\\runtime',
  )
})

test('keeps the existing macOS Application Support runtime', () => {
  const options = {
    platform: 'darwin',
    env: {},
    home: '/Users/alice',
  }
  assert.equal(
    defaultRuntimeDir(options),
    '/Users/alice/Library/Application Support/KMCBServiceControl/runtime',
  )
})
