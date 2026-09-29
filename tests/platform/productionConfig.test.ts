import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Проверки production-сборки и подготовки архива публикации.
 *
 * Часть проверок читает исходники и конфигурацию, часть — готовый `dist`
 * (если он собран). Так требования платформы не теряются при будущих правках:
 * относительные пути, отсутствие исходников и секретов, лимиты размера.
 */

const root = process.cwd()
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8')
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8')
const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const distDir = resolve(root, 'dist')
const distBuilt = existsSync(join(distDir, 'index.html'))

/** Все исходники клиентской части — их проверяем на секреты. */
function sourceFiles(directory: string): string[] {
  const result: string[] = []
  for (const name of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, name.name)
    if (name.isDirectory()) {
      result.push(...sourceFiles(fullPath))
      continue
    }
    if (/\.(ts|tsx|css|html)$/.test(name.name)) result.push(fullPath)
  }
  return result
}

/** Шаблоны того, что в клиентском коде оказаться не должно. */
const secretPatterns: { name: string; pattern: RegExp }[] = [
  { name: 'api key', pattern: /\bapi[_-]?key\b\s*[:=]/i },
  { name: 'client secret', pattern: /\bclient[_-]?secret\b\s*[:=]/i },
  { name: 'password', pattern: /\b(password|passwd|pwd)\b\s*[:=]\s*['"`]/i },
  { name: 'bearer token', pattern: /bearer\s+[a-z0-9._-]{20,}/i },
  { name: 'openai key', pattern: /sk-[a-z0-9]{20,}/i },
  { name: 'google key', pattern: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'длинный hex-секрет', pattern: /\b[0-9a-f]{40,}\b/ },
]

describe('настройки сборки', () => {
  it('пути к ресурсам относительные — игра работает из любой точки хостинга (п. 1.7)', () => {
    expect(viteConfig).toMatch(/base:\s*'\.\/'/)
  })

  it('source map отключены: исходники не уходят в архив', () => {
    expect(viteConfig).toMatch(/sourcemap:\s*false/)
  })

  it('цель сборки — браузеры мобильных устройств', () => {
    expect(viteConfig).toMatch(/target:\s*'es2019'/)
  })

  it('dev- и preview-серверы доступны через прокси-хост превью', () => {
    expect(viteConfig.match(/allowedHosts:\s*true/g)?.length).toBeGreaterThanOrEqual(2)
    expect(viteConfig).toMatch(/host:\s*true/)
  })
})

describe('страница игры', () => {
  it('в исходной странице нет ресурсов со сторонних хостов', () => {
    // Абсолютные пути в исходнике — норма: Vite переписывает их в относительные
    // при сборке (проверяется ниже на готовом dist).
    expect(indexHtml).toContain('src="/src/main.tsx"')
    expect(indexHtml).toContain('viewport-fit=cover')
  })

  it('не тянет ресурсы со сторонних хостов (п. 1.7)', () => {
    const external = indexHtml.match(/https?:\/\/[^"' ]+/g) ?? []
    expect(external).toEqual([])
  })
})

describe('архив публикации', () => {
  it('собирается командой из package.json', () => {
    expect(packageJson.scripts['release:yandex']).toContain('package-yandex.mjs')
    expect(packageJson.scripts['release:yandex']).toContain('npm run build')
    expect(existsSync(resolve(root, 'scripts/package-yandex.mjs'))).toBe(true)
  })

  it('собранный архив и dist не попадают в git', () => {
    expect(gitignore).toMatch(/^dist$/m)
    expect(gitignore).toMatch(/^release$/m)
  })

  it('скрипт упаковки проверяет лимит размера и наличие index.html в корне', () => {
    const script = readFileSync(resolve(root, 'scripts/package-yandex.mjs'), 'utf8')
    expect(script).toContain('100 * 1024 * 1024')
    expect(script).toContain("includes('index.html')")
    // Запреты на исходники и служебные файлы внутри архива.
    expect(script).toMatch(/source map/)
    expect(script).toMatch(/node_modules/)
  })
})

describe('секреты в клиентском коде', () => {
  it('в исходниках нет ключей, токенов и паролей', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(resolve(root, 'src'))) {
      const content = readFileSync(file, 'utf8')
      for (const { name, pattern } of secretPatterns) {
        if (pattern.test(content)) offenders.push(`${file.replace(root, '.')} — ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it.skipIf(!distBuilt)('в собранной игре тоже нет секретов', () => {
    const offenders: string[] = []
    for (const name of readdirSync(join(distDir, 'assets'))) {
      if (!/\.(js|css)$/.test(name)) continue
      const content = readFileSync(join(distDir, 'assets', name), 'utf8')
      for (const { name: label, pattern } of secretPatterns) {
        if (pattern.test(content)) offenders.push(`${name} — ${label}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe.skipIf(!distBuilt)('готовый dist', () => {
  const distIndex = readFileSync(join(distDir, 'index.html'), 'utf8')

  it('ссылается на ресурсы относительными путями', () => {
    expect(distIndex).not.toMatch(/(src|href)="\//)
    expect(distIndex).toContain('./assets/')
  })

  it('все ресурсы из index.html и CSS лежат на месте', () => {
    const cssFiles = readdirSync(join(distDir, 'assets')).filter((name) => name.endsWith('.css'))
    const referenced = [
      ...[...distIndex.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((match) => match[1]),
      ...cssFiles.flatMap((name) =>
        [...readFileSync(join(distDir, 'assets', name), 'utf8').matchAll(/url\(\.\/([^)]+)\)/g)]
          .map((match) => `assets/${match[1].replace(/^\.\//, '')}`),
      ),
    ]

    expect(referenced.length).toBeGreaterThan(0)
    const missing = referenced.filter((asset) => !existsSync(join(distDir, asset)))
    expect(missing).toEqual([])
  })

  it('не содержит исходников, карт сборки и служебных файлов', () => {
    const files = readdirSync(join(distDir, 'assets'))
    expect(files.filter((name) => name.endsWith('.map'))).toEqual([])
    expect(files.filter((name) => /\.(ts|tsx|scss|less)$/.test(name))).toEqual([])
    expect(existsSync(join(distDir, 'package.json'))).toBe(false)
    expect(existsSync(join(distDir, 'node_modules'))).toBe(false)
  })

  it('кегли подключены относительными путями, без внешних хостов', () => {
    const css = readdirSync(join(distDir, 'assets'))
      .filter((name) => name.endsWith('.css'))
      .map((name) => readFileSync(join(distDir, 'assets', name), 'utf8'))
      .join('\n')

    expect(css).not.toMatch(/url\(\//)
    expect(css).not.toContain('fonts.googleapis.com')
    expect(css).not.toContain('gstatic')
  })

  it('укладывается в лимит платформы по размеру', () => {
    const files = readdirSync(join(distDir, 'assets'))
    const bytes = files.reduce(
      (sum, name) => sum + readFileSync(join(distDir, 'assets', name)).length,
      readFileSync(join(distDir, 'index.html')).length,
    )
    expect(bytes).toBeLessThan(100 * 1024 * 1024)
  })
})
