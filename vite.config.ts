import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Мок-реализация `/sdk.js`: подгружает локальный мок SDK Яндекс Игр. */
const SDK_MOCK_SOURCE = "import('/src/platform/sdkMock.ts').then((module) => module.installMockSdk())\n"

/**
 * В dev- и preview-режиме отдаём `/sdk.js` моком SDK Яндекс Игр.
 *
 * Так локальная разработка идёт по тому же пути, что и на платформе: игра
 * динамически подключает `/sdk.js`, получает объект `YaGames` и работает с
 * настоящим контрактом SDK. В production-сборке плагина нет — там скрипт
 * приходит с сервера Яндекс Игр.
 *
 * Чтобы проверить игру с реальным SDK, запустите dev-сервер и прокси
 * `npx @yandex-games/sdk-dev-proxy -h http://localhost:5173 --dev-mode=true`
 * с переменной окружения `YANDEX_SDK_REAL=1`.
 */
function yandexSdkMock(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const path = req.url?.split('?')[0]
    if (path !== '/sdk.js') {
      next()
      return
    }

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(SDK_MOCK_SOURCE)
  }

  return {
    name: 'yandex-games-sdk-mock',
    apply: () => process.env.YANDEX_SDK_REAL !== '1',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), yandexSdkMock()],
  server: {
    // Слушаем все интерфейсы, чтобы dev-сервер был доступен
    // через preview-прокси песочницы.
    host: true,
    port: 5173,
    strictPort: true,
    // Разрешаем запросы с внешних хостов (домен preview-прокси).
    allowedHosts: true,
  },
})
