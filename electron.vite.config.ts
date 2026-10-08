import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Connect, Plugin } from 'vite'

function isElectronDocument(request: Connect.IncomingMessage): boolean {
  const userAgent = request.headers['user-agent']
  const header = Array.isArray(userAgent) ? userAgent.join(' ') : (userAgent ?? '')
  return /Electron/i.test(header)
}

function desktopWindowOnly(): Plugin {
  return {
    name: 'filtr-desktop-window-only',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '/').split('?')[0] ?? '/'
        const isDocument = pathname === '/' || pathname === '/index.html'
        if (!isDocument || isElectronDocument(request)) {
          next()
          return
        }

        response.statusCode = 403
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>FILTR</title>
  </head>
  <body style="margin:0;background:#09090b;color:#f5f5f5;font-family:sans-serif;display:grid;place-items:center;min-height:100vh">
    <p style="max-width:28rem;line-height:1.6;text-align:center">
      FILTR открывается отдельным окном Electron. Запустите npm run dev и работайте в этом окне:
      браузер не получает preload и не может читать локальные папки.
    </p>
  </body>
</html>`)
      })
    }
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [desktopWindowOnly(), react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 45873,
      strictPort: true,
      open: false
    }
  }
})
