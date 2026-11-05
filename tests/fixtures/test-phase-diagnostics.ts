import { availableParallelism, freemem, totalmem } from 'node:os';
import { performance, PerformanceObserver, type PerformanceEntry } from 'node:perf_hooks';

type Sample = {
  atMs: number;
  userUs: number;
  systemUs: number;
  readOperations: number;
  writeOperations: number;
};
type Span = { phase: string; begin: Sample; end: Sample | null };

function accumulatedTime(boundaries: readonly number[]) {
  const sorted = [...boundaries].sort((a, b) => a - b);
  const sums = [0];
  for (const value of sorted) sums.push(sums[sums.length - 1]! + value);
  return (atMs: number) => {
    let low = 0,
      high = sorted.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (sorted[middle]! <= atMs) low = middle + 1;
      else high = middle;
    }
    return low * atMs - sums[low]!;
  };
}

/** Process-wide measurements include background work; nested spans are inclusive. */
export function createTestPhaseDiagnostics(
  owner: string,
  options: {
    maxSpans?: number;
    maxGcEntries?: number;
    write?: (line: string) => void;
  } = {},
) {
  // Diagnostic storage limits, not workload expectations. Overflow is reported, never hidden.
  const maxSpans = options.maxSpans ?? 16_384;
  const maxGcEntries = options.maxGcEntries ?? 32_768;
  const spans: Span[] = [];
  const gc: { beginMs: number; endMs: number }[] = [];
  let errors = 0,
    droppedSpans = 0,
    droppedGcEntries = 0,
    finished = false;
  const sample = (): Sample | null => {
    try {
      const atMs = performance.now();
      const cpu = process.cpuUsage();
      const io = process.resourceUsage();
      const value = {
        atMs,
        userUs: cpu.user,
        systemUs: cpu.system,
        readOperations: io.fsRead,
        writeOperations: io.fsWrite,
      };
      if (!Object.values(value).every((counter) => Number.isFinite(counter) && counter >= 0)) {
        errors++;
        return null;
      }
      return value;
    } catch {
      errors++;
      return null;
    }
  };
  const resources = () => {
    try {
      return {
        availableParallelism: availableParallelism(),
        totalMemoryBytes: totalmem(),
        freeMemoryBytes: freemem(),
        rssBytes: process.memoryUsage.rss(),
        processLifetimeMaxRssKiB: process.resourceUsage().maxRSS,
      };
    } catch {
      errors++;
      return null;
    }
  };
  const resourceStart = resources();
  const recordGc = (entries: readonly PerformanceEntry[]) => {
    try {
      for (const entry of entries) {
        if (
          !Number.isFinite(entry.startTime) ||
          !Number.isFinite(entry.duration) ||
          entry.duration < 0
        ) {
          errors++;
          continue;
        }
        if (gc.length >= maxGcEntries) {
          droppedGcEntries++;
          continue;
        }
        gc.push({ beginMs: entry.startTime, endMs: entry.startTime + entry.duration });
      }
    } catch {
      errors++;
    }
  };
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      if (finished) return;
      try {
        recordGc(list.getEntries());
      } catch {
        errors++;
      }
    });
    observer.observe({ entryTypes: ['gc'] });
  } catch {
    errors++;
  }
  return {
    begin(phase: string): number | null {
      if (finished) return null;
      if (spans.length >= maxSpans) {
        droppedSpans++;
        return null;
      }
      const begin = sample();
      if (begin === null) return null;
      spans.push({ phase, begin, end: null });
      return spans.length - 1;
    },
    end(token: number | null): void {
      if (finished || token === null) return;
      const span = spans[token];
      if (span === undefined || span.end !== null) {
        errors++;
        return;
      }
      const end = sample();
      if (
        end !== null &&
        (Object.keys(end) as (keyof Sample)[]).some((key) => end[key] < span.begin[key])
      ) {
        errors++;
        return;
      }
      span.end = end;
    },
    /** Called only after original cleanup. Observer/write errors must not replace its exception. */
    finish(): void {
      if (finished) return;
      finished = true;
      try {
        try {
          if (observer !== null) recordGc(observer.takeRecords());
        } catch {
          errors++;
        } finally {
          try {
            observer?.disconnect();
          } catch {
            errors++;
          }
        }
        const resourceEnd = resources();
        // Prefix sums avoid a spans × GC-entries scan when emitting the bounded summary.
        const gcStarts = accumulatedTime(gc.map((entry) => entry.beginMs));
        const gcEnds = accumulatedTime(gc.map((entry) => entry.endMs));
        const gcThrough = (atMs: number) => gcStarts(atMs) - gcEnds(atMs);
        const groups = new Map<string, Span[]>();
        for (const span of spans) {
          const group = groups.get(span.phase) ?? [];
          group.push(span);
          groups.set(span.phase, group);
        }
        const phases = [...groups]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([phase, selected]) => {
            let completed = 0,
              wallMs = 0,
              maxWallMs = 0,
              userUs = 0,
              systemUs = 0,
              readOperations = 0,
              writeOperations = 0,
              gcOverlapMs = 0;
            for (const span of selected) {
              const end = span.end;
              if (end === null) continue;
              completed++;
              const wall = end.atMs - span.begin.atMs;
              wallMs += wall;
              maxWallMs = Math.max(maxWallMs, wall);
              userUs += end.userUs - span.begin.userUs;
              systemUs += end.systemUs - span.begin.systemUs;
              readOperations += end.readOperations - span.begin.readOperations;
              writeOperations += end.writeOperations - span.begin.writeOperations;
              gcOverlapMs += Math.max(0, gcThrough(end.atMs) - gcThrough(span.begin.atMs));
            }
            return {
              phase,
              started: selected.length,
              completed,
              wallMs,
              maxWallMs,
              userUs,
              systemUs,
              readOperations,
              writeOperations,
              gcOverlapMs,
            };
          });
        const incomplete = spans.filter((span) => span.end === null).length;
        (options.write ?? console.log)(
          'SYMBIOSIS_TEST_PHASES ' +
            JSON.stringify({
              schemaVersion: 1,
              owner,
              pid: process.pid,
              platform: process.platform,
              node: process.version,
              valid:
                errors === 0 && droppedSpans === 0 && droppedGcEntries === 0 && incomplete === 0,
              errors,
              droppedSpans,
              droppedGcEntries,
              incomplete,
              attribution: 'INCLUSIVE_PROCESS_SPANS_WITH_BACKGROUND_WORK',
              io: 'LOGICAL_PROCESS_OPERATIONS_NOT_BYTES_OR_DISK_WAIT',
              memory: 'START_END_SNAPSHOTS_NOT_RUN_PEAK_OR_SYSTEM_COMMIT',
              gc: 'OBSERVED_ENTRY_OVERLAP_NOT_CAUSAL_PAUSE_TIME',
              resourceStart,
              resourceEnd,
              phases,
            }),
        );
      } catch {
        // Diagnostics must preserve the original test/cleanup result, including a thrown error.
        try {
          process.stderr.write('SYMBIOSIS_TEST_PHASES_ERROR: summary unavailable\n');
        } catch {
          // A closed diagnostic stream also cannot replace the original result.
        }
      } finally {
        spans.length = 0;
        gc.length = 0;
        observer = null;
      }
    },
  };
}
