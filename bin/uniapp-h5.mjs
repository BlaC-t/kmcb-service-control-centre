#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { resolveHBuilderX } from '../src/hbuilderx.mjs'
import { createUniappH5Launch, readH5Port } from '../src/uniapp-h5.mjs'

const projectRoot = process.cwd()
const port = readH5Port(process.argv.slice(2))
const hbuilderx = resolveHBuilderX()
const launch = createUniappH5Launch({ projectRoot, port, hbuilderx })
const child = spawn(launch.command, launch.args, launch.options)

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
