import assert from 'node:assert/strict'
import test from 'node:test'
import { hbuilderxCandidates, resolveHBuilderX } from '../src/hbuilderx.mjs'

test('finds the standard macOS HBuilderX uni-app compiler', () => {
  const result = resolveHBuilderX({
    platform: 'darwin',
    env: {},
    home: '/Users/alice',
  }, candidate => candidate.startsWith('/Applications/HBuilderX.app/Contents/HBuilderX/'))

  assert.equal(result.root, '/Applications/HBuilderX.app/Contents/HBuilderX')
  assert.equal(result.nodePath, '/Applications/HBuilderX.app/Contents/HBuilderX/plugins/node/node')
  assert.equal(result.modulesPath, '/Applications/HBuilderX.app/Contents/HBuilderX/plugins/uniapp-cli-vite/node_modules')
  assert.match(result.vitePath, /uniapp-cli-vite\/node_modules\/vite\/bin\/vite\.js$/)
})

test('uses HBUILDERX_HOME before portable Windows locations', () => {
  const candidates = hbuilderxCandidates({
    platform: 'win32',
    env: {
      HBUILDERX_HOME: 'D:\\Developer Tools\\HBuilderX',
      LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
    },
    home: 'C:\\Users\\Alice',
  })

  assert.equal(candidates[0], 'D:\\Developer Tools\\HBuilderX')
  assert.ok(candidates.includes('C:\\HBuilderX'))
  assert.ok(candidates.includes('C:\\Users\\Alice\\AppData\\Local\\Programs\\HBuilderX'))
})
