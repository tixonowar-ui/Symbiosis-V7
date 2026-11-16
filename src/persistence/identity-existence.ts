import type Database from 'better-sqlite3';

// One measured history scenario prepared 44 network point-query texts 87,648 times.
// A bounded weak cache reuses SQL compilation without retaining native DB owners or rows.
const MAX_IDENTITY_QUERIES = 64;
const caches = new WeakMap<
  Database.Database,
  {
    prepareIdentity: unknown;
    statements: Map<string, WeakRef<Database.Statement>>;
  }
>();

/** Internal table/column names come from the existing closed identity lists. */
export function hasStoredIdentity(
  database: Database.Database,
  table: string,
  column: string,
  id: string,
): boolean {
  const sql = `SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`;
  const prepareIdentity: unknown = Reflect.get(database, 'prepare');
  let cache = caches.get(database);
  if (cache === undefined || cache.prepareIdentity !== prepareIdentity) {
    cache = { prepareIdentity, statements: new Map() };
    caches.set(database, cache);
  }
  let statement = cache.statements.get(sql)?.deref();
  if (statement === undefined || !database.open) {
    statement = database.prepare(sql);
    if (cache.statements.size >= MAX_IDENTITY_QUERIES && !cache.statements.has(sql)) {
      const oldest = cache.statements.keys().next().value;
      if (oldest !== undefined) cache.statements.delete(oldest);
    }
    cache.statements.set(sql, new WeakRef(statement));
  }
  // No scalar escapes: changing defaultSafeIntegers cannot change row presence.
  // Every call executes SQLite again, including after a write or transaction rollback.
  return statement.get(id) !== undefined;
}
