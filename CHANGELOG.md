# Изменения

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).
Проект не версионируется публично — записи группируются по вехам.

Каждый PR добавляет запись в раздел «Не выпущено».

## Не выпущено

### Исправлено

- **`npm ci` требовал Visual Studio Build Tools и Python.** У `better-sqlite3`
  есть `binding.gyp`, и npm по умолчанию собирает такие пакеты через
  `node-gyp rebuild`, игнорируя готовый бинарник в тарболе. Сборка запрещена
  поимённо через `allowScripts` в `package.json`
- `engines` в `package.json` ничего не обеспечивал: npm игнорирует поле без
  `engine-strict=true`. Флаг добавлен в `.npmrc`
- ADR 0002 утверждал, что достаточно `engines.npm >= 11`. Утверждение было
  неверным и исправлено
- CI проверяет, что `better-sqlite3` не собирался из исходников. Раннер несёт
  цепочку сборки, поэтому зелёная сборка скрывала проблему
- CI останавливается на зависимости с install-скриптом, по которой нет решения
  в `allowScripts`. Глобальный `ignore-scripts` пропускал бы такой скрипт молча

### Добавлено

- [ADR 0017](docs/adr/0017-qna-question-code-alias.md) — Q&A-реестр v1.2
  помечает строку №367 кодом `Q-MON-083`, который уже занят несвязанным
  вопросом; Executable Rules v1.7 адресует то же решение как `Q-MON-089`.
  Строка адресуется кодом из старшего реестра, поправка живёт в индексе,
  строки переносятся дословно
- `AGENTS.md` — контракт для агента, открывшего репозиторий впервые
- CI на Windows: суммы, типы, линтер, формат, импорт, воспроизводимость
  вывода, тесты, кросс-реестровая валидация
- Guard по объёму PR и проверка маркеров незавершённого кода
- `npm run validate` — кросс-реестровая валидация `generated/spec`:
  формат ID, дубликаты, разрешимость ссылок, осиротевшие записи
- `docs/status/module-map.md` — честное состояние модулей
- `docs/process/review.md`, `docs/process/setup-checklist.md`
- `docs/backlog/` — семь подготовленных задач
- Шаблоны PR и issue, `CODEOWNERS`
- ADR 0015 — гарантии конвейера импорта
- ADR 0016 — что из `generated/` хранится в git
- `generated/spec/atlas/forms-by-id.json` — индекс 376 форм атласа по ID
- `npm run traceability` — детерминированный генератор матрицы по ID из
  `generated/spec`, ссылкам в `src/` и прикладных тестах

### Изменено

- `npm run verify` дополнительно прогоняет `validate`
- `npm run verify` проверяет, что `docs/TRACEABILITY.md` не устарел и не содержит
  неизвестных source-ID
- `npm run validate` сверяет ключи индекса форм с каталогом `forms.json`

## M1 — Конвейер импорта

Веха не закрыта: `generated/seed` перенесён на M2.

### Добавлено

- `tools/import` — `artifacts/` → `generated/`, семь модулей
- Гейт контрольных сумм перед чтением артефактов
- Детерминизм: одинаковый вход даёт побайтово одинаковый выход
- Атлас v1.2: 376 форм, 1672 перехода, 66 journeys, 91 requirement,
  2440 QA-сценариев
- Executable Rules v1.7: 739 карточек, 699 активных, 40 tombstone
- Character / Skills / Symbionts v1.2: 1144 payload-сущности,
  9 секций XP-контракта
- Items v1.6: 64 типа предметов, 64 иконки в `generated/media`
- Effects and Diseases v1.2: 67 типов эффектов, 66 моделируемых
- Canonical Bestiary v1.4: 16 видов, 17 статблоков, 16 артов
- Default Sentient Enemy v1.2 и Runtime Pack: 44 замороженных шаблона,
  44 арта, сверка реестра с пакетом по SHA-256
- `generated/types` — типы, выведенные из артефактов: `FormId` (376),
  `RuleId` (739), `EffectTypeId` (67), `ItemTypeId` (64) и другие
- Стражи ADR в импорте: 0004, 0007, 0011 сверяются с источником
- ADR 0004–0014 — решения аудита перенесены в ADR

### Исправлено

- `.gitattributes`: без него свежий клон на Windows получал CRLF, из-за чего
  менялся SHA-256 текстовых артефактов и `checksums:verify` падал после клона

## M0 — Каркас

### Добавлено

- Структура репозитория, Node 24 LTS, TypeScript strict
- ESLint, Prettier, vitest, Playwright
- `artifacts/` разложены и покрыты `CHECKSUMS.sha256`
- `tools/checksums` — генерация и проверка манифеста
- ADR 0001–0003, корневой `CLAUDE.md` и по слоям
