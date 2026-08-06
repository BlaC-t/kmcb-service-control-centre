#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { resolveHBuilderX } from '../src/hbuilderx.mjs'

const projectRoot = process.cwd()
const port = readPort(process.argv.slice(2))
const hbuilderx = resolveHBuilderX()
const outputDir = path.join(projectRoot, 'unpackage', 'dist', 'dev', 'h5')
const nodePath = process.env.NODE_PATH
  ? `${hbuilderx.modulesPath}${path.delimiter}${process.env.NODE_PATH}`
  : hbuilderx.modulesPath

const child = spawn(hbuilderx.nodePath, [
  hbuilderx.vitePath,
  '--config', hbuilderx.configPath,
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort',
], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    NODE_PATH: nodePath,
    HX_APP_ROOT: hbuilderx.root,
    UNI_PLATFORM: 'h5',
    UNI_INPUT_DIR: projectRoot,
    UNI_OUTPUT_DIR: outputDir,
    VITE_ROOT_DIR: projectRoot,
  },
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', error => {
  console.error(`[uniapp-h5] ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal && process.platform !== 'win32') {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

function readPort(args) {
  const index = args.indexOf('--port')
  const value = Number(index >= 0 ? args[index + 1] : 3400)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid H5 port: ${index >= 0 ? args[index + 1] : value}`)
  }
  return value
}
