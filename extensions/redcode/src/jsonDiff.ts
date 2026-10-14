// Compares the JSON a user saved with the JSON read back from the file the bridge wrote.
// No VS Code imports: this is plain data work and is tested without the editor.

export interface JsonDifference {
  /** Dotted path from the root, for example Data.RootChunk.components.0.sourceRadius */
  path: string;
  /** The value in the JSON the user saved; undefined when the file has a value the saved JSON lacks. */
  saved: unknown;
  /** The value read back from the written file; undefined when the file lost it. */
  file: unknown;
}

export interface JsonComparison {
  /** Values that differ and are not explained by the format: the user's edit did not take. */
  lost: JsonDifference[];
  /**
   * Values under a compiledData block. WolvenKit rebuilds compiledData from the editable
   * components on every write (entities and appearances), so these differ whenever the user
   * changed a component, and an edit made inside compiledData itself never survives.
   */
  regenerated: JsonDifference[];
}

/** Relative tolerance for numbers: the files hold 32-bit floats, which keep about 7 significant digits. */
const FloatTolerance = 1e-6;

function leaves(value: unknown, path: string, out: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => leaves(v, `${path}.${i}`, out));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      leaves(v, path ? `${path}.${k}` : k, out);
    }
  } else {
    out.set(path, value);
  }
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= FloatTolerance * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return a === b;
}

/** Compares two WolvenKit JSON documents. The Header block is ignored: it carries export metadata only. */
export function compareJson(saved: unknown, file: unknown): JsonComparison {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  leaves(saved, "", a);
  leaves(file, "", b);
  const result: JsonComparison = { lost: [], regenerated: [] };
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    if (path === "Header" || path.startsWith("Header.")) {
      continue;
    }
    const sv = a.get(path);
    const fv = b.get(path);
    if (same(sv, fv)) {
      continue;
    }
    const difference = { path, saved: sv, file: fv };
    (/(^|\.)compiledData(\.|$)/.test(path) ? result.regenerated : result.lost).push(difference);
  }
  return result;
}

/** One line per difference, for the log. */
export function formatDifference(d: JsonDifference): string {
  const show = (v: unknown) => (v === undefined ? "(missing)" : JSON.stringify(v));
  return `${d.path}: saved ${show(d.saved)}, file has ${show(d.file)}`;
}
