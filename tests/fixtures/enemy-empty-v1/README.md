# Настоящий пустой V1 до #257

SQLite получена существующими host/store API неизменённого #256:
`11fde3e35fe27de8ca718de57e5c6682c7e2cf86`, дерево
`0f01cd9a17a47a6643eae5a386df70de40086cad`, совпадающее с поставленным
`main` `85f91cac1a8b257c907aa066765bc010922da819`.

Внутри: schema_migration 21 (user_version=0), сохранённый пустой SENTIENT V1,
его исходные COMMIT request/result/history и вторая незавершённая старая
попытка на ENM-009. Это реальные старые записи, не JSON, построенный новым
decoder, и не вставленные вручную SQL-строки. Producer и его SHA записаны в
metadata; внешнее evidence хранит полный producer, row dump и первичную
проверку physical reopen/exact replay.

Fixture обходит только password KDF через доверенный unit verifier. Она не
доказывает сетевую авторизацию или production UI. Новый регрессионный тест
проверяет неизменные исходные bytes, owning disk opener, старую форму без
compositionAcquisitions, исходную квитанцию, все SQL-строки и отсутствие
записи при read/replay.
