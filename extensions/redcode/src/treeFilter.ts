// The filter both trees share (Game Assets and Project): a pattern typed into the Filter input, matched
// against each file's path. No VS Code imports.
//
//   osprey            "osprey" anywhere in the path
//   osprey mesh       both words, in any order
//   *.mesh            a wildcard pattern: * any run of characters, ? one character, over the whole path
//   ep1\weapons\*.xbm a path with wildcards; / and \ are the same
//
// Case does not matter.

export interface TreeFilter {
  pattern: string;
  test(path: string): boolean;
  /** The longest plain fragment, for a substring search the bridge can do before test() narrows it. */
  seed: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\//g, "\\");

export function compileFilter(pattern: string): TreeFilter | undefined {
  const words = pattern.trim().split(/\s+/).filter(Boolean).map(norm);
  if (words.length === 0) return undefined;
  const tests = words.map((w) => {
    if (!/[*?]/.test(w)) return (p: string) => p.includes(w);
    // A wildcard word matches anywhere unless it is anchored by the path itself: "*.mesh" ends with .mesh.
    const body = w.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    const re = new RegExp(`${w.startsWith("*") ? "" : "(^|\\\\)"}${body}${w.endsWith("*") ? "" : "$"}`);
    return (p: string) => re.test(p);
  });
  const fragments = words.flatMap((w) => w.split(/[*?]+/)).filter((f) => f.length > 0);
  const seed = fragments.sort((a, b) => b.length - a.length)[0] ?? "";
  return { pattern: pattern.trim(), seed, test: (p: string) => { const n = norm(p); return tests.every((t) => t(n)); } };
}
