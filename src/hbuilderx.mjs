import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function hbuilderxCandidates({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const candidates = []
  if (env.HBUILDERX_HOME) candidates.push(String(env.HBUILDERX_HOME))

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/HBuilderX.app/Contents/HBuilderX',
      path.posix.join(home, 'Applications', 'HBuilderX.app', 'Contents', 'HBuilderX'),
    )
  } else if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local')
    candidates.push(
      'C:\\HBuilderX',
      path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'HBuilderX'),
      path.win32.join(localAppData, 'Programs', 'HBuilderX'),
    )
  }

  return [...new Set(candidates.map(candidate => normalizeHBuilderXRoot(candidate, platform)))]
}

export function resolveHBuilderX(options = {}, exists = fs.existsSync) {
  const platform = options.platform || process.platform
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const nodeName = platform === 'win32' ? 'node.exe' : 'node'

  for (const root of hbuilderxCandidates(options)) {
    const result = {
      root,
      nodePath: pathApi.join(root, 'plugins', 'node', nodeName),
      modulesPath: pathApi.join(root, 'plugins', 'uniapp-cli-vite', 'node_modules'),
      uniCliPath: pathApi.join(root, 'plugins', 'uniapp-cli-vite', 'node_modules', '@dcloudio', 'vite-plugin-uni', 'bin', 'uni.js'),
      vitePath: pathApi.join(root, 'plugins', 'uniapp-cli-vite', 'node_modules', 'vite', 'bin', 'vite.js'),
      configPath: pathApi.join(root, 'plugins', 'uniapp-cli-vite', 'vite.config.js'),
    }
    if (exists(result.nodePath) && exists(result.modulesPath) && exists(result.uniCliPath) && exists(result.configPath)) return result
  }

  throw new Error('HBuilderX uni-app compiler was not found. Install HBuilderX or set HBUILDERX_HOME to its application root.')
}

function normalizeHBuilderXRoot(candidate, platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const normalized = pathApi.normalize(String(candidate))
  if (platform === 'darwin' && normalized.endsWith('.app')) {
    return pathApi.join(normalized, 'Contents', 'HBuilderX')
  }
  return normalized
}
