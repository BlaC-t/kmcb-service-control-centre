import path from 'node:path'

export function createUniappH5Launch({
  projectRoot,
  port,
  hbuilderx,
  env = process.env,
  platform = process.platform,
}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const delimiter = platform === 'win32' ? ';' : ':'
  const outputDir = pathApi.join(projectRoot, 'unpackage', 'dist', 'dev', 'h5')
  const pluginsPath = pathApi.join(hbuilderx.root, 'plugins')
  const modulePath = env.NODE_PATH
    ? `${hbuilderx.modulesPath}${delimiter}${env.NODE_PATH}`
    : hbuilderx.modulesPath

  return {
    command: hbuilderx.nodePath,
    args: [
      hbuilderx.uniCliPath,
      '--platform', 'h5',
      '--config', hbuilderx.configPath,
      '--host', '127.0.0.1',
      '--port', String(port),
      '--strictPort',
    ],
    options: {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...env,
        NODE_ENV: 'development',
        NODE_PATH: modulePath,
        HX_APP_ROOT: hbuilderx.root,
        UNI_HBUILDERX_PLUGINS: pluginsPath,
        UNI_PLATFORM: 'h5',
        UNI_INPUT_DIR: projectRoot,
        UNI_OUTPUT_DIR: outputDir,
        VITE_ROOT_DIR: projectRoot,
      },
    },
  }
}

export function readH5Port(args) {
  const index = args.indexOf('--port')
  const value = Number(index >= 0 ? args[index + 1] : 3400)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid H5 port: ${index >= 0 ? args[index + 1] : value}`)
  }
  return value
}
