/**
 * Reading xlsx registries — see ADR 0014.
 *
 * Sheets are addressed **by name**, never by index: the first sheet of a
 * registry is usually a summary, and reading by index returns wrong data
 * silently (on the Q&A registry that is 24 rows instead of 444). Every lookup
 * here fails closed and names what it could not find.
 */
import { readFileSync } from 'node:fs';
import * as XLSX from '@e965/xlsx';
import { fail } from './fail.js';
import type { JsonObject } from './json.js';

export type CellValue = string | number | boolean | null;
export type Row = readonly CellValue[];

export interface Sheet {
  readonly name: string;
  readonly rows: readonly Row[];
}

export class Workbook {
  readonly #book: XLSX.WorkBook;
  readonly #label: string;

  private constructor(book: XLSX.WorkBook, label: string) {
    this.#book = book;
    this.#label = label;
  }

  static open(path: string, label: string): Workbook {
    return new Workbook(XLSX.read(readFileSync(path), { type: 'buffer' }), label);
  }

  get sheetNames(): readonly string[] {
    return this.#book.SheetNames;
  }

  /** Raw rows of a named sheet. Blank rows are dropped, cell order preserved. */
  sheet(name: string): Sheet {
    const raw = this.#book.Sheets[name];
    if (raw === undefined) {
      fail(
        this.#label,
        `sheet ${JSON.stringify(name)} not found; available: ${this.#book.SheetNames.join(', ')}`,
      );
    }
    const rows = XLSX.utils.sheet_to_json<CellValue[]>(raw, {
      header: 1,
      blankrows: false,
      defval: null,
      raw: true,
    });
    return { name, rows };
  }

  /**
   * A named sheet read as records keyed by its header row.
   *
   * `headerRow` is explicit because registries are not uniform: some put the
   * header on row 0, others after two rows of title and note. Guessing it would
   * be exactly the kind of silent misread this module exists to prevent.
   */
  table(name: string, headerRow: number, expectedColumns: readonly string[]): Table {
    const { rows } = this.sheet(name);
    const header = rows[headerRow];
    if (header === undefined) {
      fail(this.#label, `sheet ${JSON.stringify(name)} has no row ${String(headerRow)}`);
    }
    const columns = header.map((c) => (c === null ? '' : String(c).trim()));
    for (const wanted of expectedColumns) {
      if (!columns.includes(wanted)) {
        fail(
          `${this.#label}/${name}`,
          `column ${JSON.stringify(wanted)} not found; header is: ${columns.filter((c) => c !== '').join(' | ')}`,
        );
      }
    }
    return new Table(`${this.#label}/${name}`, columns, rows.slice(headerRow + 1));
  }
}

export class Table {
  readonly label: string;
  readonly columns: readonly string[];
  readonly rows: readonly Row[];

  constructor(label: string, columns: readonly string[], rows: readonly Row[]) {
    this.label = label;
    this.columns = columns;
    this.rows = rows;
  }

  get length(): number {
    return this.rows.length;
  }

  #indexOf(column: string): number {
    const index = this.columns.indexOf(column);
    if (index < 0) {
      fail(this.label, `column ${JSON.stringify(column)} not found`);
    }
    return index;
  }

  /** Cell as trimmed text, or `''` when empty. */
  text(row: number, column: string): string {
    const value = this.rows[row]?.[this.#indexOf(column)];
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value.trim() : String(value);
  }

  /** Cell as text, failing when empty — for columns that carry identity. */
  requiredText(row: number, column: string): string {
    const value = this.text(row, column);
    if (value === '') {
      fail(this.label, `row ${String(row)}: column ${JSON.stringify(column)} is empty`);
    }
    return value;
  }

  /** Cell with its original type preserved — numbers stay numbers. */
  value(row: number, column: string): CellValue {
    const raw = this.rows[row]?.[this.#indexOf(column)];
    if (raw === undefined || raw === null) return null;
    return typeof raw === 'string' ? raw.trim() : raw;
  }

  /** Rows whose given column is non-empty, as indices. */
  populated(column: string): number[] {
    const indices: number[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      if (this.text(i, column) !== '') indices.push(i);
    }
    return indices;
  }

  /**
   * Rows as records keyed by column name, skipping rows whose `keyColumn` is
   * empty — registries carry trailing blank rows that are layout, not data.
   *
   * Empty cells are omitted rather than emitted as `null`: across 739 rule cards
   * of 35 mostly-prose columns that is the difference between a lean spec and
   * megabytes of padding, and a consumer treats absent and empty alike.
   */
  records(keyColumn: string): JsonObject[] {
    const named = this.columns.map((name, index) => ({ name, index })).filter((c) => c.name !== '');

    const duplicates = named.map((c) => c.name).filter((name, i, all) => all.indexOf(name) !== i);
    if (duplicates.length > 0) {
      fail(this.label, `duplicate column name(s): ${[...new Set(duplicates)].join(', ')}`);
    }

    const out: JsonObject[] = [];
    for (const row of this.populated(keyColumn)) {
      const record: JsonObject = {};
      for (const column of named) {
        const value = this.value(row, column.name);
        if (value === null || value === '') continue;
        record[column.name] = value;
      }
      out.push(record);
    }
    return out;
  }
}
