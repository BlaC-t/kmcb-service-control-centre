import assert from 'node:assert/strict'
import test from 'node:test'
import { hbuilderxCandidates, resolveHBuilderX } from '../src/hbuilderx.mjs'
import { createUniappH5Launch } from '../src/uniapp-h5.mjs'

test('finds the standard macOS HBuilderX uni-app compiler', () => {
  const result = resolveHBuilderX({
    platform: 'darwin',
    env: {},
    home: '/Users/alice',
  }, candidate => candidate.startsWith('/Applications/HBuilderX.app/Contents/HBuilderX/'))

  assert.equal(result.root, '/Applications/HBuilderX.app/Contents/HBuilderX')
  assert.equal(result.nodePath, '/Applications/HBuilderX.app/Contents/HBuilderX/plugins/node/node')
  assert.equal(result.modulesPath, '/Applications/HBuilderX.app/Contents/HBuilderX/plugins/uniapp-cli-vite/node_modules')
  assert.match(result.uniCliPath, /@dcloudio\/vite-plugin-uni\/bin\/uni\.js$/)
  assert.match(result.vitePath, /uniapp-cli-vite\/node_modules\/vite\/bin\/vite\.js$/)
})

test('uses HBUILDERX_HOME before portable Windows locations', () => {
  const options = {
    platform: 'win32',
    env: {
      HBUILDERX_HOME: 'D:\\Developer Tools\\HBuilderX',
      LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
    },
    home: 'C:\\Users\\Alice',
  }
  const candidates = hbuilderxCandidates(options)
  const result = resolveHBuilderX(options, candidate => candidate.startsWith('D:\\Developer Tools\\HBuilderX\\'))

  assert.equal(candidates[0], 'D:\\Developer Tools\\HBuilderX')
  assert.ok(candidates.includes('C:\\HBuilderX'))
  assert.ok(candidates.includes('C:\\Users\\Alice\\AppData\\Local\\Programs\\HBuilderX'))
  assert.equal(result.nodePath, 'D:\\Developer Tools\\HBuilderX\\plugins\\node\\node.exe')
  assert.equal(result.uniCliPath, 'D:\\Developer Tools\\HBuilderX\\plugins\\uniapp-cli-vite\\node_modules\\@dcloudio\\vite-plugin-uni\\bin\\uni.js')
})

test('launches the official HBuilderX uni CLI with compiler plugins on macOS', () => {
  const hbuilderx = resolveHBuilderX({ platform: 'darwin', env: {} }, () => true)
  const launch = createUniappH5Launch({
    projectRoot: '/Users/alice/Projects/kmcb-mobile',
    port: 3400,
    hbuilderx,
    env: { NODE_PATH: '/custom/modules' },
    platform: 'darwin',
  })

  assert.equal(launch.command, hbuilderx.nodePath)
  assert.deepEqual(launch.args, [
    hbuilderx.uniCliPath,
    '--platform', 'h5',
    '--config', hbuilderx.configPath,
    '--host', '127.0.0.1',
    '--port', '3400',
    '--strictPort',
  ])
  assert.equal(launch.options.env.UNI_HBUILDERX_PLUGINS, '/Applications/HBuilderX.app/Contents/HBuilderX/plugins')
  assert.equal(launch.options.env.NODE_PATH, `${hbuilderx.modulesPath}:/custom/modules`)
})

test('builds Windows uni CLI paths and environment with Windows separators', () => {
  const hbuilderx = resolveHBuilderX({
    platform: 'win32',
    env: { HBUILDERX_HOME: 'D:\\Tools\\HBuilderX' },
  }, () => true)
  const launch = createUniappH5Launch({
    projectRoot: 'C:\\Users\\Alice\\Projects\\kmcb-mobile',
    port: 3400,
    hbuilderx,
    env: { NODE_PATH: 'C:\\shared\\modules' },
    platform: 'win32',
  })

  assert.equal(launch.args[0], 'D:\\Tools\\HBuilderX\\plugins\\uniapp-cli-vite\\node_modules\\@dcloudio\\vite-plugin-uni\\bin\\uni.js')
  assert.equal(launch.options.env.UNI_HBUILDERX_PLUGINS, 'D:\\Tools\\HBuilderX\\plugins')
  assert.equal(launch.options.env.UNI_OUTPUT_DIR, 'C:\\Users\\Alice\\Projects\\kmcb-mobile\\unpackage\\dist\\dev\\h5')
  assert.equal(launch.options.env.NODE_PATH, `${hbuilderx.modulesPath};C:\\shared\\modules`)
})
