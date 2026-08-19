import { describe, expect, it } from 'vitest';
import {
  ATLAS_MARKDOWN_FILE,
  validateAtlasMarkdownIdentityTextMirrors,
  validateAtlasFormQaMirrors,
  validateChr001IdentityTextMirrors,
  validateDetailedFormIndexKeys,
  validateRendererFormCatalogue,
  validateRendererFormGraph,
} from './atlas.js';

const FORM_ID = /^[A-Z]{2,3}-\d{3}$/;

const ENTRY_GUARD =
  'Новый immutable UUID; обязательны имя, возраст, пол и положительная massKg 0,1; описание/арт необязательны.';
const CONTINUE_GUARD =
  'UI-CMD-CHAR-WIZARD-CHECKPOINT stage=IDENTITY; name/age/sex present; massKg>0 at step 0.1; immutable draft UUID committed';
const IDENTITY_INCOMPLETE = 'Continue is absent until name/age/sex/positive 0.1kg mass validate.';
const RETIRED_ENTRY_GUARD =
  'Новый immutable UUID; обязательны имя, возраст и положительная massKg 0,1; описание/арт необязательны.';

const markdownIdentityFixture = (): string =>
  [
    ...Array.from({ length: 4 }, () => ENTRY_GUARD),
    ...Array.from({ length: 3 }, () => CONTINUE_GUARD),
    IDENTITY_INCOMPLETE,
  ].join('\n');

type MutableRecord = Record<string, unknown>;

const formQaFixture = (): { form: MutableRecord; qa: MutableRecord } => {
  const purpose = 'Synthetic purpose.';
  const requiredFields = ['first(field with a, delimiter)', 'second'];
  return {
    form: {
      id: 'APP-001',
      purpose,
      requiredFields,
      qaScenarioIds: ['QA-FORM-APP-001'],
      acceptanceCriteria: [`Назначение реализовано буквально: ${purpose}`],
    },
    qa: {
      qaId: 'QA-FORM-APP-001',
      scope: 'APP-001',
      scenario:
        `Проверить буквальное назначение APP-001: ${purpose} ` +
        `Поля: ${requiredFields.join(', ')}. CTA: Synthetic.`,
    },
  };
};

interface MirrorTarget {
  readonly row: MutableRecord;
  readonly field: string;
  readonly file: string;
  readonly id: string;
  readonly group: 'entry' | 'continue' | 'state';
}

interface IdentityMirrorFixture {
  readonly forms: Readonly<Record<string, MutableRecord>>;
  readonly journeys: MutableRecord[];
  readonly transitions: MutableRecord[];
  readonly mirrors: Readonly<Record<string, MirrorTarget>>;
}

const identityMirrorFixture = (): IdentityMirrorFixture => {
  const entryAction = { actionKey: 'APP-004::CTA::001', guard: ENTRY_GUARD };
  const entryOut = {
    to: 'CHR-001',
    trigger: 'J-CHAR-CREATE::DRAFT_IDENTITY::open',
    kind: 'subflow',
    guard: ENTRY_GUARD,
  };
  const entryIn = {
    from: 'APP-004',
    trigger: 'J-CHAR-CREATE::DRAFT_IDENTITY::open',
    kind: 'subflow',
    guard: ENTRY_GUARD,
  };
  const entryTransition = { from: 'APP-004', ...entryOut };
  const identityStep = { state: 'DRAFT_IDENTITY', guards: ENTRY_GUARD };

  const continueAction = { actionKey: 'CHR-001::CTA::001', guard: CONTINUE_GUARD };
  const continueOut = {
    to: 'CHR-010',
    trigger: 'Сохранить идентичность и продолжить',
    kind: 'workflow-command',
    guard: CONTINUE_GUARD,
  };
  const continueIn = {
    from: 'CHR-001',
    trigger: continueOut.trigger,
    kind: continueOut.kind,
    guard: CONTINUE_GUARD,
  };
  const continueTransition = { from: 'CHR-001', ...continueOut };
  const states = { IDENTITY_INCOMPLETE };

  const app004 = {
    id: 'APP-004',
    actions: { ctaAvailabilityByAction: [entryAction] },
    transitionsOut: [entryOut],
  };
  const chr001 = {
    id: 'CHR-001',
    actions: { ctaAvailabilityByAction: [continueAction] },
    transitionsIn: [entryIn],
    transitionsOut: [continueOut],
    states,
  };
  const chr010 = { id: 'CHR-010', transitionsIn: [continueIn] };

  const target = (
    row: MutableRecord,
    field: string,
    file: string,
    id: string,
    group: MirrorTarget['group'],
  ): MirrorTarget => ({ row, field, file, id, group });

  return {
    forms: {
      'APP-004': app004,
      'CHR-001': chr001,
      'CHR-010': chr010,
    },
    journeys: [{ id: 'J-CHAR-CREATE', steps: [identityStep] }],
    transitions: [entryTransition, continueTransition],
    mirrors: {
      'journey entry': target(
        identityStep,
        'guards',
        'atlas/journeys.json',
        'J-CHAR-CREATE/DRAFT_IDENTITY',
        'entry',
      ),
      'APP-004 action': target(
        entryAction,
        'guard',
        'atlas/forms-by-id.json',
        'APP-004::CTA::001',
        'entry',
      ),
      'APP-004 outgoing': target(
        entryOut,
        'guard',
        'atlas/forms-by-id.json',
        'APP-004→CHR-001',
        'entry',
      ),
      'CHR-001 incoming': target(
        entryIn,
        'guard',
        'atlas/forms-by-id.json',
        'APP-004→CHR-001',
        'entry',
      ),
      'entry transition': target(
        entryTransition,
        'guard',
        'atlas/transitions.json',
        'APP-004→CHR-001',
        'entry',
      ),
      'CHR-001 action': target(
        continueAction,
        'guard',
        'atlas/forms-by-id.json',
        'CHR-001::CTA::001',
        'continue',
      ),
      'CHR-001 outgoing': target(
        continueOut,
        'guard',
        'atlas/forms-by-id.json',
        'CHR-001→CHR-010',
        'continue',
      ),
      'CHR-010 incoming': target(
        continueIn,
        'guard',
        'atlas/forms-by-id.json',
        'CHR-001→CHR-010',
        'continue',
      ),
      'Continue transition': target(
        continueTransition,
        'guard',
        'atlas/transitions.json',
        'CHR-001→CHR-010',
        'continue',
      ),
      IDENTITY_INCOMPLETE: target(
        states,
        'IDENTITY_INCOMPLETE',
        'atlas/forms-by-id.json',
        'CHR-001.IDENTITY_INCOMPLETE',
        'state',
      ),
    },
  };
};

describe('renderer form catalogue validation', () => {
  it('rejects a key that does not equal its embedded form id', () => {
    const result = validateRendererFormCatalogue({ 'APP-001': { id: 'APP-002' } }, FORM_ID, 1);

    expect(result.problems).toContainEqual({
      file: 'atlas/renderer/forms-by-id.json',
      id: 'APP-001',
      message: 'key does not match embedded id "APP-002"',
    });
  });

  it('rejects a catalogue whose cardinality differs from meta counts.forms', () => {
    const result = validateRendererFormCatalogue({ 'APP-001': { id: 'APP-001' } }, FORM_ID, 2);

    expect(result.problems).toContainEqual({
      file: 'atlas/renderer/forms-by-id.json',
      id: '-',
      message: 'expected 2 form entries from atlas/meta.json counts.forms, got 1',
    });
  });
});

describe('detailed form index validation', () => {
  it('rejects a key missing from the detailed index', () => {
    const problems = validateDetailedFormIndexKeys(
      { 'APP-001': {} },
      new Set(['APP-001', 'APP-002']),
    );

    expect(problems).toContainEqual({
      file: 'atlas/forms-by-id.json',
      id: 'APP-002',
      message: 'key is missing for id declared in atlas/renderer/forms-by-id.json',
    });
  });

  it('rejects a detailed-index key absent from the renderer catalogue', () => {
    const problems = validateDetailedFormIndexKeys(
      { 'APP-001': {}, 'APP-002': {} },
      new Set(['APP-001']),
    );

    expect(problems).toContainEqual({
      file: 'atlas/forms-by-id.json',
      id: 'APP-002',
      message: 'key is not declared in atlas/renderer/forms-by-id.json',
    });
  });
});

describe('Atlas form and QA literal mirrors', () => {
  it('accepts the exact form-to-QA mapping and forward-rendered field list', () => {
    const fixture = formQaFixture();

    expect(validateAtlasFormQaMirrors([fixture.form], [fixture.qa])).toEqual([]);
  });

  it('rejects requiredFields drift without splitting comma-containing field text', () => {
    const fixture = formQaFixture();
    fixture.form['requiredFields'] = [
      ...((fixture.form['requiredFields'] as string[]) ?? []),
      'new-field',
    ];

    expect(validateAtlasFormQaMirrors([fixture.form], [fixture.qa])).toContainEqual({
      file: 'atlas/qa-scenarios.json',
      id: 'QA-FORM-APP-001',
      message:
        'scenario does not contain requiredFields joined with ", " from atlas/forms-by-id.json',
    });
  });

  it('rejects purpose drift in both QA and the literal acceptance criterion', () => {
    const fixture = formQaFixture();
    fixture.form['purpose'] = 'Changed purpose.';
    const problems = validateAtlasFormQaMirrors([fixture.form], [fixture.qa]);

    expect(problems).toContainEqual({
      file: 'atlas/forms-by-id.json',
      id: 'APP-001',
      message: 'acceptanceCriteria contains the literal purpose criterion 0 times, expected 1',
    });
    expect(problems).toContainEqual({
      file: 'atlas/qa-scenarios.json',
      id: 'QA-FORM-APP-001',
      message: 'scenario does not contain literal purpose from atlas/forms-by-id.json',
    });
  });

  it('rejects a QA row whose form link and scope have drifted', () => {
    const fixture = formQaFixture();
    fixture.form['qaScenarioIds'] = [];
    fixture.qa['scope'] = 'APP-002';
    const problems = validateAtlasFormQaMirrors([fixture.form], [fixture.qa]);

    expect(problems).toContainEqual({
      file: 'atlas/forms-by-id.json',
      id: 'APP-001',
      message: 'qaScenarioIds contains "QA-FORM-APP-001" 0 times, expected 1',
    });
    expect(problems).toContainEqual({
      file: 'atlas/qa-scenarios.json',
      id: 'QA-FORM-APP-001',
      message: 'scope "APP-002" does not match form id "APP-001"',
    });
  });

  it('rejects duplicate and orphan QA-FORM rows', () => {
    const fixture = formQaFixture();
    const orphan = { ...fixture.qa, qaId: 'QA-FORM-APP-002', scope: 'APP-002' };
    const problems = validateAtlasFormQaMirrors(
      [fixture.form],
      [fixture.qa, { ...fixture.qa }, orphan],
    );

    expect(problems).toContainEqual({
      file: 'atlas/qa-scenarios.json',
      id: 'QA-FORM-APP-001',
      message: 'expected exactly one QA row, got 2',
    });
    expect(problems).toContainEqual({
      file: 'atlas/qa-scenarios.json',
      id: 'QA-FORM-APP-002',
      message: 'QA-FORM row has no matching form',
    });
  });

  it('rejects malformed form mirror fields without coercion', () => {
    const fixture = formQaFixture();
    fixture.form['requiredFields'] = ['valid', 1];

    expect(validateAtlasFormQaMirrors([fixture.form], [fixture.qa])).toContainEqual({
      file: 'atlas/forms-by-id.json',
      id: 'APP-001',
      message: 'requiredFields is not an array of text values',
    });
  });
});

describe('ADR 0037 CHR-001 identity text mirrors', () => {
  it('accepts all five entry, four Continue and one incomplete-state mirrors', () => {
    const fixture = identityMirrorFixture();

    expect(
      validateChr001IdentityTextMirrors(
        Object.values(fixture.forms),
        fixture.journeys,
        fixture.transitions,
      ),
    ).toEqual([]);
  });

  it('rejects drift independently at every registered mirror', () => {
    const mirrorNames = Object.keys(identityMirrorFixture().mirrors);

    for (const name of mirrorNames) {
      const fixture = identityMirrorFixture();
      const target = fixture.mirrors[name]!;
      target.row[target.field] = 'synchronized-looking but non-canonical prose';
      const problems = validateChr001IdentityTextMirrors(
        Object.values(fixture.forms),
        fixture.journeys,
        fixture.transitions,
      );

      expect(
        problems.some(
          (problem) =>
            problem.file === target.file &&
            problem.id === target.id &&
            problem.message.includes('differs from ADR 0037'),
        ),
        name,
      ).toBe(true);
    }
  });

  it('rejects synchronized drift of every copy in a guard cluster', () => {
    const fixture = identityMirrorFixture();
    for (const target of Object.values(fixture.mirrors)) {
      if (target.group === 'entry') target.row[target.field] = 'same wrong entry prose';
    }

    const problems = validateChr001IdentityTextMirrors(
      Object.values(fixture.forms),
      fixture.journeys,
      fixture.transitions,
    );
    expect(
      problems.filter((problem) => problem.message.includes('entry guard literal')),
    ).toHaveLength(5);
  });

  it('rejects duplicate semantic selectors instead of choosing one', () => {
    const fixture = identityMirrorFixture();
    const app004 = fixture.forms['APP-004']!;
    const actions = app004['actions'] as MutableRecord;
    const rows = actions['ctaAvailabilityByAction'] as MutableRecord[];
    rows.push({ ...rows[0] });

    expect(
      validateChr001IdentityTextMirrors(
        Object.values(fixture.forms),
        fixture.journeys,
        fixture.transitions,
      ),
    ).toContainEqual({
      file: 'atlas/forms-by-id.json',
      id: 'APP-004::CTA::001',
      message: 'expected exactly one action with actionKey "APP-004::CTA::001", got 2',
    });
  });
});

describe('ADR 0039 Atlas Markdown identity text mirrors', () => {
  it('accepts the four entry, three Continue and one incomplete-state renderings', () => {
    expect(validateAtlasMarkdownIdentityTextMirrors(markdownIdentityFixture())).toEqual([]);
  });

  it('rejects one retired rendering without hiding the lost current copy', () => {
    const markdown = markdownIdentityFixture().replace(ENTRY_GUARD, RETIRED_ENTRY_GUARD);

    expect(validateAtlasMarkdownIdentityTextMirrors(markdown)).toEqual([
      {
        file: ATLAS_MARKDOWN_FILE,
        id: 'entry',
        message: 'retired ADR 0037 literal count is 1, expected 0',
      },
      {
        file: ATLAS_MARKDOWN_FILE,
        id: 'entry',
        message: 'current ADR 0037 literal count is 3, expected 4 by ADR 0039',
      },
    ]);
  });

  it('rejects synchronized replacement of every copy with non-canonical prose', () => {
    const markdown = markdownIdentityFixture().replaceAll(
      CONTINUE_GUARD,
      'same wrong Continue prose',
    );

    expect(validateAtlasMarkdownIdentityTextMirrors(markdown)).toEqual([
      {
        file: ATLAS_MARKDOWN_FILE,
        id: 'continue',
        message: 'current ADR 0037 literal count is 0, expected 3 by ADR 0039',
      },
    ]);
  });
});

describe('renderer form graph validation', () => {
  it('rejects a transition endpoint absent from the renderer catalogue', () => {
    const problems = validateRendererFormGraph(new Set(['APP-001']), [
      { from: 'APP-001', to: 'APP-002' },
    ]);

    expect(problems).toContainEqual({
      file: 'atlas/transitions.json',
      id: 'row 0',
      message: 'to "APP-002" is not in the renderer form catalogue',
    });
  });

  it('preserves orphan reporting for an indexed form outside the graph', () => {
    const problems = validateRendererFormGraph(new Set(['APP-001', 'APP-002', 'APP-003']), [
      { from: 'APP-001', to: 'APP-002' },
    ]);

    expect(problems).toContainEqual({
      file: 'atlas/renderer/forms-by-id.json',
      id: 'APP-003',
      message: 'form is defined but never referenced',
    });
  });
});
