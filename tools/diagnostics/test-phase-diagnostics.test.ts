import { afterEach, describe, expect, it, vi } from 'vitest';
import { performance, PerformanceObserver, type PerformanceEntry } from 'node:perf_hooks';
import { createTestPhaseDiagnostics } from '../../tests/fixtures/test-phase-diagnostics.js';

afterEach(() => vi.restoreAllMocks());

function fixture(options: { maxSpans?: number; maxGcEntries?: number } = {}) {
  const lines: string[] = [];
  const diagnostics = createTestPhaseDiagnostics('diagnostic-contract-test', {
    ...options,
    write: (line) => lines.push(line),
  });
  return {
    diagnostics,
    lines,
    report(): unknown {
      expect(lines).toHaveLength(1);
      return JSON.parse(lines[0]!.slice('SYMBIOSIS_TEST_PHASES '.length));
    },
  };
}

function gcEntry(startTime: number, duration: number): PerformanceEntry {
  return { name: 'gc', entryType: 'gc', startTime, duration, toJSON: () => ({}) };
}

describe('bounded test-phase diagnostics', () => {
  it('retains nested inclusive spans without representing them as independent CPU work', () => {
    const f = fixture();
    const prepare = f.diagnostics.begin('prepare');
    const open = f.diagnostics.begin('open');
    f.diagnostics.end(open);
    f.diagnostics.end(prepare);
    f.diagnostics.finish();
    f.diagnostics.finish();
    expect(f.report()).toMatchObject({
      valid: true,
      attribution: 'INCLUSIVE_PROCESS_SPANS_WITH_BACKGROUND_WORK',
      phases: [
        { phase: 'open', started: 1, completed: 1 },
        { phase: 'prepare', started: 1, completed: 1 },
      ],
    });
  });

  it('reports dropped and unfinished spans instead of manufacturing complete evidence', () => {
    const f = fixture({ maxSpans: 1 });
    f.diagnostics.begin('interrupted-prepare');
    expect(f.diagnostics.begin('overflow')).toBeNull();
    f.diagnostics.finish();
    expect(f.report()).toMatchObject({
      valid: false,
      droppedSpans: 1,
      incomplete: 1,
      phases: [{ phase: 'interrupted-prepare', started: 1, completed: 0 }],
    });
  });

  it('clips observed GC intervals to each nested span without claiming exclusive attribution', () => {
    const f = fixture();
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(40);
    const outer = f.diagnostics.begin('outer');
    const inner = f.diagnostics.begin('inner');
    f.diagnostics.end(inner);
    f.diagnostics.end(outer);
    vi.spyOn(PerformanceObserver.prototype, 'takeRecords').mockReturnValueOnce([
      gcEntry(15, 10),
      gcEntry(28, 20),
    ]);
    f.diagnostics.finish();
    expect(f.report()).toMatchObject({
      valid: true,
      phases: [
        { phase: 'inner', wallMs: 10, gcOverlapMs: 7 },
        { phase: 'outer', wallMs: 30, gcOverlapMs: 22 },
      ],
    });
  });

  it('reports GC overflow as incomplete diagnostics', () => {
    const f = fixture({ maxGcEntries: 1 });
    vi.spyOn(PerformanceObserver.prototype, 'takeRecords').mockReturnValueOnce([
      gcEntry(1, 1),
      gcEntry(2, 1),
    ]);
    f.diagnostics.finish();
    expect(f.report()).toMatchObject({ valid: false, droppedGcEntries: 1 });
  });

  it('keeps a metric failure distinct from successful original work', () => {
    const f = fixture();
    vi.spyOn(process, 'cpuUsage').mockImplementationOnce(() => {
      throw new Error('unavailable diagnostic counter');
    });
    expect(f.diagnostics.begin('operation')).toBeNull();
    f.diagnostics.finish();
    expect(f.report()).toMatchObject({ valid: false, errors: 1, phases: [] });
  });

  it('does not turn a decreasing counter into a negative phase cost', () => {
    const f = fixture();
    vi.spyOn(process, 'cpuUsage')
      .mockReturnValueOnce({ user: 100, system: 100 })
      .mockReturnValueOnce({ user: 99, system: 100 });
    const operation = f.diagnostics.begin('operation');
    f.diagnostics.end(operation);
    f.diagnostics.finish();
    expect(f.report()).toMatchObject({ valid: false, errors: 1, incomplete: 1 });
  });

  it('never replaces an original cleanup exception when summary output also fails', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const original = new Error('original cleanup failure');
    const diagnostics = createTestPhaseDiagnostics('write-failure', {
      write: () => {
        throw new Error('summary unavailable');
      },
    });
    expect(() => {
      const cleanup = diagnostics.begin('cleanup');
      try {
        throw original;
      } finally {
        diagnostics.end(cleanup);
        diagnostics.finish();
      }
    }).toThrow(original);
    expect(stderr).toHaveBeenCalledWith('SYMBIOSIS_TEST_PHASES_ERROR: summary unavailable\n');
  });

  it('retains an observer drain failure as invalid diagnostics without failing original work', () => {
    const f = fixture();
    vi.spyOn(PerformanceObserver.prototype, 'takeRecords').mockImplementationOnce(() => {
      throw new Error('observer drain failed');
    });
    f.diagnostics.finish();
    expect(f.report()).toMatchObject({ valid: false, errors: 1 });
  });
});
