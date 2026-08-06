import os from 'node:os'
import path from 'node:path'

export function defaultAppRoot({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local')
    return path.win32.join(localAppData, 'KMCBServiceControl')
  }

  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', 'KMCBServiceControl')
  }

  const dataRoot = env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share')
  return path.posix.join(dataRoot, 'KMCBServiceControl')
}

export function defaultRuntimeDir(options = {}) {
  const platform = options.platform || process.platform
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  return pathApi.join(defaultAppRoot(options), 'runtime')
}
