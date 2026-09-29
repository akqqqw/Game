#!/usr/bin/env bash
#
# Восстановление рабочего окружения после пересоздания песочницы.
#
# Песочница пересоздаётся между сессиями: пропадают `node_modules`, локальная
# история git откатывается на первый коммит, а запущенный dev-сервер умирает.
# Единственная персистентность — ветка в origin, поэтому восстановление такое:
#
#   1. подтянуть ветку из origin;
#   2. сверить рабочую копию с origin (рабочие файлы песочница сохраняет);
#   3. выровнять локальную ветку на origin БЕЗ потери рабочей копии;
#   4. поставить зависимости;
#   5. при желании запустить dev-сервер.
#
# Использование:
#   scripts/restore-env.sh          # восстановить окружение
#   scripts/restore-env.sh --dev    # восстановить и запустить dev-сервер
#
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="arena/01a0e97c-game"

echo "==> Подтягиваю ветку $BRANCH из origin"
git fetch -q origin "$BRANCH"
echo "    origin: $(git log --oneline FETCH_HEAD -1)"

echo "==> Сверяю рабочую копию с origin"
bad=0
while IFS= read -r file; do
  if [ ! -f "$file" ]; then
    echo "    НЕТ ФАЙЛА: $file"
    bad=1
    continue
  fi
  if ! git show "FETCH_HEAD:$file" | diff -q - "$file" >/dev/null 2>&1; then
    echo "    ОТЛИЧАЕТСЯ: $file"
    bad=1
  fi
done < <(git ls-tree -r --name-only FETCH_HEAD)

if [ "$bad" -eq 0 ]; then
  echo "    все файлы совпадают с origin"
fi

# Есть ли незакоммиченные правки: их терять нельзя, поэтому ветку не трогаем.
dirty="$(git status --porcelain | wc -l | tr -d ' ')"
if [ "$dirty" != "0" ]; then
  echo "==> В рабочей копии есть незакоммиченные изменения ($dirty) — выравниваю историю без сброса файлов"
  git reset -q FETCH_HEAD
else
  echo "==> Рабочая копия чистая — переключаю ветку на origin"
  git checkout -f -B "$BRANCH" FETCH_HEAD >/dev/null
fi
echo "    ветка: $(git log --oneline -1)"

echo "==> Ставлю зависимости"
npm install --no-audit --no-fund >/dev/null
if ! git diff --quiet package-lock.json; then
  echo "    package-lock.json изменился — откатываю (сборка менять его не должна)"
  git checkout -- package-lock.json
fi
echo "    зависимости на месте"

if [ "${1:-}" = "--dev" ]; then
  echo "==> Запускаю dev-сервер (0.0.0.0:5173)"
  exec npm run dev
fi

echo "==> Готово. Запуск сервера: npm run dev"
