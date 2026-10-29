# ADR 0065 — Граница транспорта локального приложения

- **Статус:** принято; issue #179
- **Дата:** 2026-10-30
- **Дополняет:** ADR 0018, 0027, 0028, 0030, 0032, 0063 и 0064

## Контекст

Перед сетевым срезом #171 реальный TCP reproducer показал: чужой Origin
получает HTTP 200 от `/device-identity`, передаёт этот locator в обычный
`session.reconnect` и проходит APP-001 → APP-002 → APP-004. Ошибок хоста нет,
проверка GM при этом работает. Обычный локальный player path не имел такой
же границы транспорта и открывал namespace библиотеки host-устройства.

ADR 0027/0028/0030 не приравнивают UUID устройства к доказательству полномочий.
ADR 0032/0063 привязывают локальные листы и библиотеку к своему устройству.
Техническое LAN-соединение #171 не должно давать доступ к этому namespace.
Артефакты, игровые правила и значения здесь не меняются.

## Решение

### Канал локального приложения

`/state` обслуживает локальные shell, character, post-save и GM contexts.
Перед **каждым** frame всех wire versions хост проверяет реальные TCP
local/remote addresses, живой bound listener и явный канонический HTTP Origin
по физическому предикату ADR 0064. Проверка выполняется до JSON decode,
private reads, replay, выделения context ID, KDF и любой mutation.

Client role/device ID, URL, Host и proxy headers не участвуют в доказательстве.
Проверки owner/context/revisions и отдельная GM authority остаются обязательны
после допуска транспорта, включая повторную проверку после async подготовки.

Неподтверждённый frame получает только безопасный `protocol.refusal`:
`UNRECOGNIZED`, path `$.localAppConnection`, value `null`, без projection или
отражения исходного input. Сокет закрывается с техническим кодом 1008.
WebSocket upgrade сам не выдаёт domain context и не читает private state.

### Read-only HTTP identity

`GET /device-identity` использует тот же реальный TCP/listener proof.
Переданный Origin проверяется строго; чужое, malformed или `null` значение
не заменяется локальным. При отказе ответ — HTTP 403, `LOCAL_APP_ONLY`,
`Cache-Control: no-store`, до чтения device store.

Обычный same-origin GET может не содержать Origin: алгоритм
[Fetch §3.2](https://fetch.spec.whatwg.org/#origin-header) добавляет его условно.
Только read-only HTTP путь допускает отсутствие этого заголовка при уже
доказанном host-local TCP peer. Ожидаемый Origin получается из настоящего
local endpoint/listener; request Host, Referer и forwarded headers не нужны.
HTTP-исключение не распространяется на WebSocket. Browser WebSocket Origin
также описан в [RFC 6455 §4.1](https://www.rfc-editor.org/rfc/rfc6455.html#section-4.1).

Публичные статика, поставленные media и `/health` сохраняют прежний контракт.
Для LAN campaign messages #171 добавляет отдельный закрытый handler с
собственными session/device proofs и безопасными projections.

### Проверочные соединения

Приватные integration fixtures используют настоящий listener на loopback и
реальный WebSocket с Origin этого listener. Helper переиспользует уже
слушающий host; при необходимости назначает тестовый порт через ОС.
Симулированный transport не считается доказательством локального пользователя.

Не добавляются trusted callbacks, test-only production flags или исключения
по отсутствующим TCP metadata. HTTP identity проверяется реальным fetch.
Отрицательный foreign-Origin сценарий использует отдельный настоящий сокет.

## Обоснование

Одного UUID недостаточно для доступа к локальным данным: его возвращал сам
endpoint, а сложность угадывания не устанавливает owner. Ранний общий gate
покрывает также старые wire versions, read/replay и будущие локальные команды.
Физический предикат уже проверен в ADR 0064; GM права продолжают подтверждаться
своим persisted context, а не одним Origin.

Исключение только для origin-less read-only HTTP сохраняет штатный browser
bootstrap. Отсутствие Origin у командного WebSocket остаётся отказом.
Переход integration fixtures на TCP усиливает проверку транспорта без
ослабления игровых assertions или подмены projections.

## Последствия и проверки

- Удалённое устройство не получает host-local identity, библиотеку, wizard,
  экспорт или GM projection через `/state`.
- Предикат считает процессы этого host-компьютера локальными, как ADR 0064;
  это граница устройства и Origin, а не новая схема логина пользователей ОС.
- Схема SQLite, artifacts/generated и зависимости не меняются.
- Точный TCP reproducer до исправления: HTTP 200 и APP-004; после исправления:
  HTTP 403, единственный protocol refusal, ни одной опубликованной формы.
- Обязательны отрицательные actual TCP/HTTP/WS случаи всех версий, отсутствие
  private reads/allocations/mutations и публичного input reflection, здоровый
  local browser path, полный verify/E2E и независимый прогон final SHA перед merge.
