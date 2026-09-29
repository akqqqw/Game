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
  /**
   * Относительные пути к ресурсам.
   *
   * Архив публикации Яндекс Игры раздаёт статикой, и игра может открываться не
   * с корня домена. Абсолютные пути вида `/assets/...` в таком окружении
   * ломаются, а на S3-хосты Яндекса ссылаться вообще нельзя (п. 1.7).
   */
  base: './',
  plugins: [react(), yandexSdkMock()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    /**
     * Исходники не должны попадать в архив публикации, а source map — это
     * исходники в открытом виде (плюс лишний вес).
     */
    sourcemap: false,
    /**
     * Цель — браузеры мобильных устройств, включая WebView постарше:
     * игра проверяется на окружениях, близких к пользовательским.
     */
    target: 'es2019',
    /**
     * Мелкие ресурсы не инлайним в data URI: архив отдаётся целиком, а файлы
     * в assets/ кешируются браузером и видны в отчётах о размере.
     */
    assetsInlineLimit: 0,
    // Бандл с Phaser весит больше 500 КБ по умолчанию — это ожидаемо.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    // Слушаем все интерфейсы, чтобы dev-сервер был доступен
    // через preview-прокси песочницы.
    host: true,
    port: 5173,
    strictPort: true,
    // Разрешаем запросы с внешних хостов (домен preview-прокси).
    allowedHosts: true,
  },
  preview: {
    // Preview нужен, чтобы проверять именно собранную игру, а не dev-сборку.
    host: true,
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
})
