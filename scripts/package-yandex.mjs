#!/usr/bin/env node
/**
 * Сборка архива для публикации на Яндекс Играх.
 *
 * Требования платформы, которые проверяет этот скрипт:
 *  - `index.html` лежит в корне архива (п. 1.22);
 *  - архив не содержит исходников, кэшей и лишних зависимостей;
 *  - размер в распакованном виде не превышает 100 МБ (п. 1.21).
 *
 * ZIP собирается собственными силами на встроенном `node:zlib`: так в архиве
 * гарантированно не оказывается ничего лишнего, а сборка не требует ни
 * системного `zip`, ни новых зависимостей в проекте.
 *
 * Запуск: npm run release:yandex (сборка + упаковка) или
 *         node scripts/package-yandex.mjs (упаковка готового dist)
 */

import { deflateRawSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const sep = process.platform === 'win32' ? '\\' : '/'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const outputFile = join(root, 'release', 'evolution-isles.zip')

/** Предел платформы: 100 МБ в распакованном виде (п. 1.21). */
const SIZE_LIMIT_BYTES = 100 * 1024 * 1024

/** Что ни при каких условиях не должно попасть в архив публикации. */
const forbidden = [
  { test: (name) => name.endsWith('.map'), reason: 'source map (это исходники)' },
  { test: (name) => /\.(ts|tsx|mts|cts)$/.test(name), reason: 'исходный код TypeScript' },
  { test: (name) => /\.(scss|sass|less)$/.test(name), reason: 'исходные стили' },
  { test: (name) => name.includes('node_modules/'), reason: 'зависимости разработки' },
  { test: (name) => name.includes('.git/'), reason: 'служебные файлы git' },
  { test: (name) => /(^|\/)(package\.json|package-lock\.json|tsconfig.*\.json|eslint\.config\..*)$/.test(name), reason: 'файлы сборки' },
]

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

/** Собирает файлы dist рекурсивно, отсортированные по пути. */
function collectFiles(directory, base = directory) {
  const entries = []
  for (const name of readdirSync(directory).sort()) {
    const fullPath = join(directory, name)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      entries.push(...collectFiles(fullPath, base))
      continue
    }
    // В архиве пути всегда через «/» — независимо от системы сборки.
    entries.push({
      path: relative(base, fullPath).split(sep).join('/'),
      size: stats.size,
      data: readFileSync(fullPath),
    })
  }
  return entries
}

// --- CRC32 ------------------------------------------------------------------

const crcTable = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  crcTable[index] = value >>> 0
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// --- Сборка ZIP -------------------------------------------------------------

/** Метка времени DOS: 1980-01-01 00:00 — архив получается воспроизводимым. */
const DOS_DATE = 0x0021
const DOS_TIME = 0

function buildZip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const file of files) {
    const nameBytes = Buffer.from(file.path, 'utf8')
    const compressed = deflateRawSync(file.data, { level: 9 })
    // Если сжатие не помогает — кладём как есть.
    const useDeflate = compressed.length < file.data.length
    const payload = useDeflate ? compressed : file.data
    const method = useDeflate ? 8 : 0
    const crc = crc32(file.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // имена файлов в UTF-8
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)

    localParts.push(local, nameBytes, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)

    centralParts.push(central, nameBytes)
    offset += local.length + nameBytes.length + payload.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, end])
}

/** Читает оглавление готового архива — проверка, что файл валиден. */
function listZipEntries(buffer) {
  let endOffset = -1
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      endOffset = index
      break
    }
  }
  if (endOffset < 0) fail('не найден конец архива — файл повреждён')

  const total = buffer.readUInt16LE(endOffset + 10)
  let pointer = buffer.readUInt32LE(endOffset + 16)
  const names = []

  for (let index = 0; index < total; index += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) fail('повреждено оглавление архива')
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    names.push(buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8'))
    pointer += 46 + nameLength + extraLength + commentLength
  }

  return names
}

// --- Основной сценарий ------------------------------------------------------

if (!existsSync(join(distDir, 'index.html'))) {
  fail('нет dist/index.html — сначала выполните npm run build')
}

const files = collectFiles(distDir)

for (const file of files) {
  for (const rule of forbidden) {
    if (rule.test(file.path)) fail(`в архив попал ${rule.reason}: ${file.path}`)
  }
}

const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
if (totalBytes > SIZE_LIMIT_BYTES) {
  fail(`размер игры ${(totalBytes / 1024 / 1024).toFixed(1)} МБ превышает лимит платформы 100 МБ`)
}

const archive = buildZip(files)
mkdirSync(dirname(outputFile), { recursive: true })
writeFileSync(outputFile, archive)

const verified = listZipEntries(archive)
if (!verified.includes('index.html')) fail('в архиве нет index.html в корне (п. 1.22)')
if (verified.length !== files.length) fail('число файлов в архиве не совпало с dist')

console.log('\nАрхив для публикации готов')
console.log(`  файл:            ${relative(root, outputFile)}`)
console.log(`  файлов:          ${files.length}`)
console.log(`  в распаковке:    ${(totalBytes / 1024 / 1024).toFixed(2)} МБ (лимит 100 МБ)`)
console.log(`  архив:           ${(archive.length / 1024).toFixed(0)} КБ`)
console.log('  содержимое:')
for (const name of verified) {
  const file = files.find((item) => item.path === name)
  console.log(`    ${name} — ${(file.size / 1024).toFixed(1)} КБ`)
}
console.log('')
