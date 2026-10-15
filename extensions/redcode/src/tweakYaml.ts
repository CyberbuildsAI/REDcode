// TweakDB values as text, for the record page, the hover and New Tweak from This Record, which writes
// a TweakXL YAML file that clones a record ($base) or changes it. No VS Code imports.
// See docs/design/view.md, V3, and the TweakXL wiki (https://github.com/psiberx/cp2077-tweak-xl/wiki).

import type { TweakLocKey, TweakRecordFull, TweakValue } from "./types";

/** The short name of a record type: gamedataClothing_Record is Clothing. */
export function shortType(type: string): string {
  return type.replace(/^gamedata/, "").replace(/_Record$/, "");
}

export function isLocKey(v: unknown): v is TweakLocKey {
  return !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as TweakLocKey).key === "string" && "text" in (v as object);
}

const plain = /^[A-Za-z0-9_.#\\/:$-]+$/;

/** A value in YAML flow style: plain where safe, else a double-quoted string, flow lists and maps. */
export function yamlValue(v: TweakValue | undefined): string {
  if (v === null || v === undefined) return '""';
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") {
    return v !== "" && plain.test(v) && !/^(true|false|null|yes|no|on|off|~)$/i.test(v) && !/^[-\d.]/.test(v) ? v : JSON.stringify(v);
  }
  if (isLocKey(v)) return v.key;
  if (Array.isArray(v)) return `[${v.map((x) => yamlValue(x)).join(", ")}]`;
  // A struct, in WolvenKit's JSON: a flow map without its $type.
  const entries = Object.entries(v).filter(([k]) => k !== "$type");
  return `{ ${entries.map(([k, x]) => `${k}: ${yamlValue(x as TweakValue)}`).join(", ")} }`;
}

/** The text after a value in a comment: a LocKey's text. */
function note(v: TweakValue | undefined): string {
  return isLocKey(v) && v.text ? `  # "${v.text.replace(/\s+/g, " ").slice(0, 80)}"` : "";
}

export type TweakMode = "clone" | "change";

/**
 * A TweakXL YAML file for a record. "clone" makes a new record at newPath with the record as its
 * $base; "change" edits the record itself. Every flat is listed, commented out, with its current
 * value, so the modder uncomments the ones to change.
 */
export function tweakYaml(record: TweakRecordFull, mode: TweakMode, newPath?: string): string {
  const path = record.path ?? record.id;
  const lines = [
    `# ${mode === "clone" ? `A new record cloned from ${path}` : `Changes to ${path}`} (${shortType(record.type)}), written by REDcode.`,
    "# Uncomment the flats to change. TweakXL loads this file from r6/tweaks when the game starts.",
    "",
  ];
  if (mode === "clone") {
    lines.push(`${newPath ?? `${path}_Copy`}:`, `  $base: ${path}`);
  } else {
    lines.push(`${path}:`);
  }
  for (const f of record.flats) {
    lines.push(`  # ${f.name}: ${yamlValue(f.value)}${note(f.value)}`);
  }
  return lines.join("\n") + "\n";
}

/** A one-line summary of a value for the hover and lists: LocKeys with their text, long lists shortened. */
export function shortValue(v: TweakValue | undefined, max = 80): string {
  if (isLocKey(v)) return v.text ? `${v.key} "${v.text}"` : v.key;
  if (Array.isArray(v)) {
    const items = v.map((x) => shortValue(x, 40));
    const text = `[${items.slice(0, 4).join(", ")}${items.length > 4 ? `, … ${items.length - 4} more` : ""}]`;
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }
  const text = yamlValue(v);
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** The flats worth showing first in a hover: names and looks, then whatever is set. */
const MainFlats = ["displayName", "localizedDescription", "entityName", "appearanceName", "quality", "itemType", "equipArea", "baseRecord", "statModifiers"];

export function mainFlats(record: TweakRecordFull, count = 8): TweakRecordFull["flats"] {
  const set = (f: TweakRecordFull["flats"][number]) => f.value !== null && f.value !== "" && !(Array.isArray(f.value) && f.value.length === 0) && f.value !== "None" && !(isLocKey(f.value) && f.value.key === "LocKey#0");
  const first = MainFlats.map((n) => record.flats.find((f) => f.name === n)).filter((f): f is NonNullable<typeof f> => !!f && set(f));
  const rest = record.flats.filter((f) => !MainFlats.includes(f.name) && set(f));
  return [...first, ...rest].slice(0, count);
}
