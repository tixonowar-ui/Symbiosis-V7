# Чеклист ручной настройки GitHub

Это может сделать только владелец репозитория через веб-интерфейс. Агенты
доступа к настройкам не имеют.

Порядок важен: без пункта 1 всё остальное необязательно к исполнению.

---

## 1. Защита ветки `main`

`Settings → Branches → Add branch protection rule`, шаблон `main`.

- [ ] **Require a pull request before merging**
  - [ ] Required approvals: **1**
  - [ ] Dismiss stale pull request approvals when new commits are pushed
  - [ ] Require review from Code Owners
- [ ] **Require status checks to pass before merging**
  - [ ] Require branches to be up to date before merging
  - [ ] Обязательные чеки (появятся в списке после первого прогона CI):
    - `verify`
    - `markers`
    - `size`
- [ ] **Require linear history**
- [ ] **Do not allow bypassing the above settings** — включить, иначе правило
      не действует на администратора, то есть на вас
- [ ] Allow force pushes — **выключено**
- [ ] Allow deletions — **выключено**

## 2. Стратегия merge

`Settings → General → Pull Requests`.

- [ ] Allow squash merging — **включить**
- [ ] Allow merge commits — **выключить**
- [ ] Allow rebase merging — **выключить**
- [ ] Default commit message: **Pull request title and description**
- [ ] Automatically delete head branches — **включить**

Причина: одна задача — один коммит в `main`. История читается как список
изменений, а не как переплетение веток.

## 3. CODEOWNERS

- [ ] В [.github/CODEOWNERS](../../.github/CODEOWNERS) заменить `@Saltbound`
      на реальный GitHub-логин владельца
- [ ] Проверить, что GitHub не подсвечивает файл как невалидный
      (вкладка PR → Reviewers должна автоматически подставлять владельца)

## 4. Доступ второго агента

- [ ] Установить GitHub-приложение Codex / ChatGPT на репозиторий
- [ ] Выдать права: **Contents (read/write)**, **Pull requests (read/write)**,
      **Issues (read/write)**. Права на **Settings** и **Administration** —
      **не выдавать**
- [ ] Убедиться, что агент **не** входит в список тех, кто может обходить
      защиту ветки

## 5. Перенос очереди задач

- [ ] Создать issue из файлов в [docs/backlog/](../backlog/) — по одному на файл
- [ ] Первой в работу отдать `0001` — она намеренно маленькая, нужна чтобы
      обкатать процесс, а не закрыть объём
- [ ] Проставить метки: `task`, веха (`M1`…`M9`)

## 6. Секреты

На сегодня **не требуются**. CI ничего никуда не публикует, зависимости берутся
из публичного npm.

Понадобятся, когда появится:

- подпись portable-сборки (веха M9)
- публикация релизов

## 7. Проверка, что всё встало

- [ ] Открыть тестовый PR из ветки в `main` — CI должен запуститься
- [ ] Убедиться, что прямой push в `main` отклоняется:

```bash
git push origin main
```

- [ ] Убедиться, что PR нельзя смержить с красным CI
- [ ] Убедиться, что кнопка merge предлагает только **Squash and merge**

---

## Что уже сделано и настройки не требует

|                      |                                                                            |
| -------------------- | -------------------------------------------------------------------------- |
| CI                   | [.github/workflows/ci.yml](../../.github/workflows/ci.yml)                 |
| Guard по объёму PR   | [.github/workflows/pr-size.yml](../../.github/workflows/pr-size.yml)       |
| Шаблон PR            | [.github/pull_request_template.md](../../.github/pull_request_template.md) |
| Шаблоны issue        | [.github/ISSUE_TEMPLATE/](../../.github/ISSUE_TEMPLATE/)                   |
| CODEOWNERS           | [.github/CODEOWNERS](../../.github/CODEOWNERS) — нужен только логин        |
| Контракт для агентов | [AGENTS.md](../../AGENTS.md)                                               |
