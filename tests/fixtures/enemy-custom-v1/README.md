# Исторический CUSTOM_MONSTER V1

Канонический fixture получен неизменённым owning host/store из поставленного main `4bfe9ed4c7ad9a021b3b39cc7daa3ba0180c8ebd`, дерево `b1920a574092fa6d18852d36b6d0a4fbd8541da6` (#258, B16, схема22), до источников #288. Это реальный MANUAL/NONE V1 с исходным COMMIT request/receipt и второй открытой попыткой ENM013.

Gzip SHA-256: `50678d9abf89b1a3c04199d53b9066ae0dfc937b52a3c53f0dc158933d9f17d2`. Распакованные исходные сериализованные байты: `61f6e340d3236059f8dd3488e91e1f97c0aaf6eab2fb8874d85a25dea8d9fe19`. Именно gzip служит входом consumer-теста. Отдельный физический файл после owning reopen/replay остался во внешних доказательствах; его SQLite-заголовок отличается, строки всех80таблиц совпадают. Он не подменяет канонический fixture.

Producer выполнил два физических reopen, исходный exact replay, сравнение всех строк до первого owning open и после него, FK/integrity. Метаданные сохраняют исходные scope, request/receipt и hash V1. Парольный KDF обойдён в unit fixture; LAN/WS, Adviser и RNG этим fixture не доказываются. Consumer под B17 проверяется отдельно. Артефакты исходного producer и полные source bindings сохранены во внешнем evidence-288/historical258.
