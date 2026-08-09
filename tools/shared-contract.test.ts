import { readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  ATLAS_ROLES,
  COMMAND_KIND_ROUTE,
  COMMAND_LIFECYCLE_STATES,
  GUARD_STATES,
  MASTER_PREDICATE_REQUIRED_FIELDS,
  MASTER_PREDICATE_RESPONSE_COMMAND_ID,
  MASTER_PREDICATE_STATES,
} from '../src/shared/wire-protocol.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHARED_ROOT = resolve(REPO_ROOT, 'src', 'shared');
const SPEC_ROOT = resolve(REPO_ROOT, 'generated', 'spec', 'atlas');

const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(SPEC_ROOT, name), 'utf8')) as unknown;

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const asArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
};

const asStrings = (value: unknown, label: string): string[] => {
  const values = asArray(value, label);
  if (!values.every((item) => typeof item === 'string')) {
    throw new Error(`${label} must contain only strings`);
  }
  return values;
};

const productionFiles = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [path]
      : [];
  });

interface ModuleUse {
  readonly file: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

const moduleUses = (file: string): ModuleUse[] => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const uses: ModuleUse[] = [];
  const add = (node: ts.Expression | undefined, typeOnly: boolean): void => {
    if (node !== undefined && ts.isStringLiteral(node)) {
      uses.push({ file, specifier: node.text, typeOnly });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node))
      add(node.moduleSpecifier, node.importClause?.isTypeOnly ?? false);
    else if (ts.isExportDeclaration(node)) add(node.moduleSpecifier, node.isTypeOnly);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0], false);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
};

describe('shared layer contract', () => {
  it('depends only on itself and generated atlas types', () => {
    const files = productionFiles(SHARED_ROOT);
    expect(files.length).toBeGreaterThan(2);
    const uses = files.flatMap(moduleUses);
    expect(uses.length).toBeGreaterThan(2);

    const offenders = uses.flatMap(({ file, specifier, typeOnly }) => {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        const outside = relative(SHARED_ROOT, target);
        return outside.startsWith('..') || isAbsolute(outside)
          ? [`${relative(REPO_ROOT, file)} -> ${specifier}`]
          : [];
      }
      return specifier === '@generated/types/atlas.js' && typeOnly
        ? []
        : [`${relative(REPO_ROOT, file)} -> ${specifier}${typeOnly ? ' (type)' : ''}`];
    });
    expect(offenders).toEqual([]);
  });

  it('keeps protocol literals synchronized with Atlas v1.2', () => {
    const meta = asRecord(readJson('meta.json'), 'atlas meta');
    const roles = asArray(meta['roles'], 'atlas roles').map((item, index) => {
      const id = asRecord(item, `atlas role ${String(index)}`)['id'];
      if (typeof id !== 'string')
        throw new Error(`atlas role ${String(index)} id must be a string`);
      return id;
    });
    expect([...ATLAS_ROLES].sort()).toEqual(roles.sort());
    expect([...GUARD_STATES].sort()).toEqual(asStrings(meta['guardStates'], 'guard states').sort());

    const lifecycle = asArray(readJson('lifecycles.json'), 'lifecycles')
      .map((item, index) => asRecord(item, `lifecycle ${String(index)}`))
      .find((item) => item['entity'] === 'command');
    if (lifecycle === undefined) throw new Error('command lifecycle not found');
    expect(COMMAND_LIFECYCLE_STATES).toEqual(asStrings(lifecycle['states'], 'command states'));

    const forms = asRecord(readJson('forms-by-id.json'), 'forms by id');
    const masterPredicate = asRecord(forms['GM-029'], 'GM-029');
    expect(MASTER_PREDICATE_REQUIRED_FIELDS).toEqual(
      asStrings(masterPredicate['requiredFields'], 'GM-029 required fields'),
    );
    expect(
      asStrings(
        asRecord(masterPredicate['references'], 'GM-029 references')['workflowCommandIds'],
        'GM-029 workflow commands',
      ),
    ).toEqual([MASTER_PREDICATE_RESPONSE_COMMAND_ID]);
    const predicateStates = Object.keys(asRecord(masterPredicate['states'], 'GM-029 states'))
      .filter((state) => /^[A-Z_]+$/.test(state))
      .sort();
    expect(predicateStates).toEqual([...MASTER_PREDICATE_STATES].sort());
    expect(masterPredicate['purpose']).toMatch(/disconnect.+без резерва/);
  });

  it('derives exactly six command kinds and the same 106 UI commands as atlas QA', () => {
    const transitions = readJson('transitions.json');
    const transitionKinds = new Set(
      asArray(transitions, 'transitions')
        .map((item, index) => asRecord(item, `transition ${String(index)}`)['kind'])
        .filter((kind): kind is string => typeof kind === 'string' && kind.endsWith('-command')),
    );
    expect([...transitionKinds].sort()).toEqual(Object.keys(COMMAND_KIND_ROUTE).sort());

    const transitionCommandIds = new Set(
      (JSON.stringify(transitions).match(/UI-CMD-[A-Z0-9-]+/g) ?? []).sort(),
    );
    const qaCommandIds = new Set(
      asArray(readJson('qa-scenarios.json'), 'QA scenarios')
        .map((item, index) => asRecord(item, `QA scenario ${String(index)}`)['qaId'])
        .filter(
          (id): id is string => typeof id === 'string' && id.startsWith('QA-WORKFLOW-UI-CMD-'),
        )
        .map((id) => id.slice('QA-WORKFLOW-'.length)),
    );
    expect(transitionCommandIds.size).toBe(106);
    expect([...qaCommandIds].sort()).toEqual([...transitionCommandIds].sort());
  });
});
