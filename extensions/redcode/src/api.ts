// REDcode's API for other extensions, returned from activate() (REDcode request #4, for EDGEwave).
// Another extension finds it without importing REDcode's code:
//
//   const ext = vscode.extensions.getExtension<REDcodeApi>("edgemodders.redcode-cyberpunk");
//   const api = ext?.isActive ? ext.exports : await ext?.activate();
//   if (api?.apiVersion === 1) { ... }
//
// List "edgemodders.redcode-cyberpunk" in extensionDependencies to have it activated first. The
// interfaces below are the contract; copy them, as REDcode copies EDGEdeck's in src/edgedeck.ts. New
// members may be added within version 1; a change that breaks callers raises apiVersion.
// See docs/api.md.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { audioFormat, gameSoundIndex, opusSound, opusToWav, wemOggFor, GameSoundIndex } from "./audio";
import type { BridgeClient } from "./bridgeClient";
import type { MeshImport } from "./types";
import { sourceFile } from "./exportCache";
import { gamePathOfUri } from "./gameFs";
import { ProjectFolders, type ProjectInfo } from "./project";

/**
 * A sound, as REDcode's player and sound list know it and as EDGEwave's edgewave.openSound takes it:
 * one of a game file by path, a sound effect by hash, or a file by URI.
 */
export interface SoundRef {
  /** A game file, such as a voice line: base\localization\en-us\vo\....wem. */
  path?: string;
  /** A sound effect in the game's sfx_container.opusinfo, by its hash. */
  soundHash?: number;
  /** The event the sound effect belongs to, when known. */
  eventHash?: number;
  /** A file on disk or a redcode-game: URI, as a URI string. */
  uri?: string;
}

/** A sound as audio a webview can decode: WAV for anything that was Opus, Ogg Vorbis for a .wem. */
export interface SoundAudio {
  data: Uint8Array;
  /** audio/wav, audio/ogg, audio/mpeg or audio/flac. */
  mime: string;
  /** Of the data: PCM, Vorbis, MP3, FLAC. */
  codec: string;
  channels?: number;
  sampleRate?: number;
  /** A file name for the data, such as 832549876.wav or a voice line's name with .ogg. */
  name: string;
}

/** A sound event of the game's sound effect index, with the hashes of its sounds (its variations). */
export interface SoundEventInfo {
  hash: number;
  /** From WolvenKit's event list (game 1.6, through REDbridge 0.7.2's sound.events); null when unknown. */
  name: string | null;
  tags: string[];
  sounds: number[];
}

/** The open WolvenKit project. */
export interface ProjectRef {
  name: string;
  modName: string;
  /** The .cpmodproj file. */
  file: string;
  dir: string;
  archive: string;
  raw: string;
  resources: string;
  packed: string;
}

export interface REDcodeApi {
  readonly apiVersion: 1;
  /** REDcode's version, such as 0.9.0. */
  readonly version: string;
  /** The running REDbridge client, or undefined when it is not running. Its methods mirror REDbridge's JSON-RPC methods. */
  bridge(): BridgeClient | undefined;
  /** The game folder REDcode reads (redcode.gamePath), or undefined when it is not the game. */
  gamePath(): string | undefined;
  /** The open project, or undefined. */
  project(): ProjectRef | undefined;
  readonly onDidChangeProject: vscode.Event<ProjectRef | undefined>;
  /** The game's sound effect events with their sounds. Loaded once per bridge process. */
  soundIndex(): Promise<{ count: number; events: SoundEventInfo[] }>;
  /** A sound's audio. Throws when the sound is not found or the bridge is not running. */
  sound(ref: SoundRef): Promise<SoundAudio>;
  /**
   * Imports a file under the project's source/raw back into source/archive, as Import from Raw does.
   * A GLB with no .mesh at its path needs options.template, a game path or .mesh to start from; a mesh
   * import also returns what the mesh ended up with. A <hash>.wav replaces that game sound effect.
   */
  importFile(file: string, options?: { template?: string }): Promise<{ ok: boolean; written: string[]; mesh?: MeshImport | null }>;
  /** Packs the open project, as REDcode: Pack does. */
  pack(): Promise<{ packedDir: string; archive?: string; archiveFiles: number }>;
  /**
   * Packs and gets the project into the game as fast as it allows (REDcode: Pack and Try): with Red Hot
   * Tools into the hot folder, which the running game reloads ("hot"); otherwise installed, through
   * EDGEdeck when it is there, for the next game start ("installed"). undefined when the pack failed, or
   * when it would break the mod (a missing REDmod custom sound) and the user cancelled.
   */
  packAndTry(): Promise<"hot" | "installed" | undefined>;
  /** Opens a project .glb, .gltf or .mesh in Blender; each save there is imported back (REDcode: Edit in Blender). */
  editInBlender(file: string): Promise<void>;
}

export interface ApiHost {
  version: string;
  getBridge(): BridgeClient | undefined;
  gamePath(): string | undefined;
  project(): ProjectInfo | undefined;
  onDidChangeProject: vscode.Event<ProjectInfo | undefined>;
  audioCache: string;
  importFile(file: string, options?: { template?: string }): Promise<{ ok: boolean; written: string[]; mesh?: MeshImport | null }>;
  pack(): Promise<{ packedDir: string; archive?: string; archiveFiles: number }>;
  packAndTry(): Promise<"hot" | "installed" | undefined>;
  editInBlender(file: string): Promise<void>;
}

export function projectRef(p: ProjectInfo | undefined): ProjectRef | undefined {
  if (!p) return undefined;
  return {
    name: p.name,
    modName: p.modName,
    file: p.file,
    dir: p.dir,
    archive: path.join(p.dir, ProjectFolders.archive),
    raw: path.join(p.dir, ProjectFolders.raw),
    resources: path.join(p.dir, ProjectFolders.resources),
    packed: path.join(p.dir, ProjectFolders.packed),
  };
}

export function createApi(host: ApiHost): REDcodeApi {
  const bridge = (): BridgeClient => {
    const b = host.getBridge();
    if (!b?.running) throw new Error("REDbridge is not running. Run REDcode: Restart REDbridge.");
    return b;
  };
  let events: { bridge: BridgeClient; list: Promise<{ count: number; events: SoundEventInfo[] }> } | undefined;

  /** Audio a webview decodes: Opus becomes WAV. */
  const playable = async (bytes: Buffer, name: string): Promise<SoundAudio> => {
    let data = bytes;
    let file = name;
    if (audioFormat(bytes).codec === "Opus") {
      data = await opusToWav(bytes);
      file = name.replace(/\.[^.]+$/, "") + ".wav";
    }
    const f = audioFormat(data);
    return { data, mime: f.mime, codec: f.codec, channels: f.channels, sampleRate: f.sampleRate, name: file };
  };

  /** A .wem as Ogg through the export cache, anything else as it is. */
  const fileAudio = async (source: { file?: string; gamePath?: string }): Promise<SoundAudio> => {
    const name = path.basename((source.file ?? source.gamePath ?? "").replace(/\\/g, "/"));
    if (name.toLowerCase().endsWith(".wem")) {
      const r = await wemOggFor(bridge(), host.audioCache, source);
      return playable(fs.readFileSync(r.file), name.replace(/\.wem$/i, ".ogg"));
    }
    const file = source.file ?? (await sourceFile(bridge(), host.audioCache, source)).file;
    return playable(fs.readFileSync(file), name);
  };

  return {
    apiVersion: 1,
    version: host.version,
    bridge: () => host.getBridge(),
    gamePath: host.gamePath,
    project: () => projectRef(host.project()),
    onDidChangeProject: (listener, thisArgs, disposables) => host.onDidChangeProject((p) => listener.call(thisArgs, projectRef(p)), undefined, disposables),

    soundIndex() {
      const b = bridge();
      if (events?.bridge !== b) {
        const list = (async () => {
          const index = await gameSoundIndex(b, host.audioCache);
          const names = await b.soundEvents().then(
            (r) => new Map(r.events.map((e) => [e.hash, e])),
            () => undefined,
          );
          const out = index.groups
            .filter((g) => g.sounds.length > 0)
            .map((g): SoundEventInfo => ({ hash: g.hash, name: names?.get(g.hash)?.name ?? null, tags: names?.get(g.hash)?.tags ?? [], sounds: g.sounds.map((i) => index.hashes[i]) }));
          return { count: index.count, events: out };
        })();
        list.catch(() => (events = undefined));
        events = { bridge: b, list };
      }
      return events.list;
    },

    async sound(ref) {
      if (ref.soundHash !== undefined) {
        const b = bridge();
        const index = await gameSoundIndex(b, host.audioCache);
        const i = index.hashes.indexOf(ref.soundHash >>> 0);
        if (i < 0) throw new Error(`No sound ${ref.soundHash} in the game's sound effect index`);
        return playable(await opusSound(b, host.audioCache, { gamePath: GameSoundIndex }, index, i), `${ref.soundHash}.opus`);
      }
      if (ref.path) return fileAudio({ gamePath: ref.path.replace(/\//g, "\\") });
      if (ref.uri) {
        const uri = vscode.Uri.parse(ref.uri);
        const gamePath = gamePathOfUri(uri);
        if (gamePath) return fileAudio({ gamePath });
        if (uri.scheme !== "file") throw new Error(`REDcode reads sounds from files and the game, not ${uri.scheme}: URIs`);
        return fileAudio({ file: uri.fsPath });
      }
      throw new Error("A sound reference needs path, soundHash or uri");
    },

    importFile: host.importFile,
    pack: host.pack,
    packAndTry: host.packAndTry,
    editInBlender: host.editInBlender,
  };
}
