import { defineConfig } from 'vitest/config'

/**
 * Тесты платформенного слоя и игровой логики.
 * Окружение — jsdom: проверяем поведение без реального браузера и без SDK
 * (реклама, пауза, сохранения, обработка недоступного IndexedDB).
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
