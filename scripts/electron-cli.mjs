import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function desktopEnv() {
  const env = { ...process.env, BROWSER: 'none' }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function scrub(chunk) {
  return chunk
    .toString()
    .replace(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?[^\s)]*/g, 'окно Electron')
}

export function runElectronVite(command) {
  let electronBinary = ''
  try {
    electronBinary = require('electron')
  } catch {
    console.error('Пакет electron не установлен. Запустите npm install.')
    process.exit(1)
  }
  if (typeof electronBinary !== 'string' || electronBinary.length === 0) {
    console.error('Бинарник Electron не найден. Запустите npm install.')
    process.exit(1)
  }

  const cli = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
  if (!existsSync(cli)) {
    console.error('electron-vite не установлен. Запустите npm install.')
    process.exit(1)
  }
  const child = spawn(process.execPath, [cli, command], {
    cwd: root,
    env: desktopEnv(),
    stdio: ['inherit', 'pipe', 'pipe']
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(scrub(chunk))
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(scrub(chunk))
  })

  process.on('SIGINT', () => child.kill('SIGINT'))
  process.on('SIGTERM', () => child.kill('SIGTERM'))

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}
