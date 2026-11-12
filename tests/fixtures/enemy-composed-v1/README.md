# Настоящий старый COMPOSED SENTIENT V1 / открытый план #257

Producer выполнен на неизменённом `c6820e9b258f7a743403ddba0ed55dcd23691036`.
Его дерево `ab05f2fc5e408ac7cf47dc36acc665a7e423d852` совпадает с деревом
поставленного main `44c5dd88a1796f2e85b1c3bec155f2996bfc409d`. Использованы реальные прежние
host/store/NAV/PATCH/COMMIT: FREE OWL2+TICK1 с подтверждённым R6=1, полный лист
и V1; затем новая открытая PURE/SOLDIER попытка с actual initial plan на ENM-008.
Старый runtime не импортировал код #258. UUID, время, квитанции и baseline —
фактические исходные данные producer; они не нормализуются новым потребителем.

Канонический fixture — только `schema21-composed-v1.sqlite.gz`: это gzip
исходных `db.serialize()` bytes ДО первого owning physical open.
`inflatedPreOpenSha256` в metadata относится именно к распакованному gzip,
не к отдельному физическому файлу после open/replay. Physical post-replay файл
сохраняется только во внешнем evidence: header/journal-mode bytes у него могут
отличаться, поэтому этот файл не подменяет канонический fixture.

Старый producer проверил raw rows до owning open, два настоящих disk reopen,
полное чтение current attempt/V1 и original COMMIT receipt replay; строки и
serialized bytes через replay не менялись, foreign keys чисты. Технический
owner verifier fixture обходит password KDF; это не production network proof.

Producer SHA, source hashes, scope и original request/result сохранены в metadata.
Полный producer, log/result и исходные rows находятся во внешнем task evidence
`evidence-258/historical257`. Этот исторический успех сам по себе не доказывает
новую миграцию: consumer regression отдельно проверяет schema21→22, сохранность
старых rows/JSON/hash/receipts и exact replay после миграции.
