// Sounds for the audio player (C5 V2). No VS Code imports, so the MCP server can use it too.
//
// The game keeps two kinds:
// - .wem files with readable paths, mostly voice lines. REDbridge's project.export turns one into an
//   Ogg Vorbis file in about 0.1 s, and the webview plays that.
// - Sound effects, 73,000 of them in 1,879 .opuspak files indexed by sfx_container.opusinfo. The
//   index gives each sound's pack, offset and length; a sound is a RIFF header and then a plain Ogg
//   Opus stream. The index also groups the sounds under Wwise event hashes, and an event's hash is
//   FNV-1 of its name, so REDbridge's sound.events (0.7.2) names them.
// The .opusinfo layout follows WolvenKit's OpusInfo (WolvenKit.Modkit, RED4/Tools/OpusInfo.cs).
//
// VS Code's webview cannot decode Opus (its media build refuses it in <audio>, decodeAudioData and
// WebCodecs alike, found in the owner's test), so Opus is decoded here and the page gets 16-bit WAV.
// The Ogg pages are read below; the packets go to opus-decoder (MIT, libopus in WebAssembly, BSD).
// ogg-opus-decoder would read the pages too, but it depends on codec-parser, which is LGPL.

import * as fs from "node:fs";
import * as path from "node:path";
import type { BridgeClient } from "./bridgeClient";
import { cachedExport, sourceFile, type CachedExport, type ExportSource } from "./exportCache";

/** A .wem as an .ogg in the cache, exported again only when the .wem is newer. */
export function wemOggFor(bridge: BridgeClient, cacheRoot: string, source: ExportSource): Promise<CachedExport> {
  return cachedExport(bridge, cacheRoot, source, ".ogg", {}, "Ogg");
}

/** The packets of an Ogg stream, joined across pages by their lacing values. */
export function oggPackets(ogg: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let parts: Uint8Array[] = [];
  let o = 0;
  while (o + 27 <= ogg.length) {
    if (ogg[o] !== 0x4f || ogg[o + 1] !== 0x67 || ogg[o + 2] !== 0x67 || ogg[o + 3] !== 0x53) throw new Error(`No Ogg page at byte ${o}`);
    const segments = ogg[o + 26];
    let p = o + 27 + segments;
    for (let s = 0; s < segments; s++) {
      const len = ogg[o + 27 + s];
      parts.push(ogg.subarray(p, p + len));
      p += len;
      if (len < 255) {
        packets.push(Buffer.concat(parts));
        parts = [];
      }
    }
    o = p;
  }
  return packets;
}

/** The granule position of an Ogg stream's last page: for Opus, the samples at 48 kHz, pre-skip included. */
function lastGranule(ogg: Uint8Array): bigint {
  const view = Buffer.from(ogg.buffer, ogg.byteOffset, ogg.byteLength);
  let granule = 0n;
  let o = 0;
  while (o + 27 <= view.length && view.toString("latin1", o, o + 4) === "OggS") {
    granule = view.readBigInt64LE(o + 6);
    const segments = view[o + 26];
    let size = 0;
    for (let s = 0; s < segments; s++) size += view[o + 27 + s];
    o += 27 + segments + size;
  }
  return granule;
}

/** An Ogg Opus stream as a 16-bit PCM WAV at 48 kHz, which any webview decodes. */
export async function opusToWav(ogg: Uint8Array): Promise<Buffer> {
  const packets = oggPackets(ogg);
  const head = Buffer.from(packets[0] ?? []);
  if (head.subarray(0, 8).toString("latin1") !== "OpusHead") throw new Error("Not an Ogg Opus stream: no OpusHead");
  // OpusHead: version, channels, pre-skip, input rate, gain, mapping family, then the mapping table.
  const channels = head[9];
  const preSkip = head.readUInt16LE(10);
  const family = head[18];
  // An ES module: loaded on first use, and bundled by esbuild. One decoder per stream, since the
  // channel layout and pre-skip are set when it is made.
  const { OpusDecoder } = await import("opus-decoder");
  const decoder = new OpusDecoder({
    channels,
    preSkip,
    ...(family > 0 ? { streamCount: head[19], coupledStreamCount: head[20], channelMappingTable: [...head.subarray(21, 21 + channels)] } : {}),
  });
  await decoder.ready;
  let decoded;
  try {
    // packets[1] is OpusTags; the audio follows.
    decoded = decoder.decodeFrames(packets.slice(2));
  } finally {
    decoder.free();
  }
  const { channelData, samplesDecoded: decodedCount, sampleRate, errors } = decoded;
  if (decodedCount === 0) throw new Error(`The Opus stream did not decode${errors?.length ? `: ${errors[0].message}` : ""}`);
  // The last page's granule position, less the pre-skip, is the stream's length; the last packet
  // can decode past it.
  const end = Number(lastGranule(ogg)) - preSkip;
  const samplesDecoded = end > 0 && end < decodedCount ? end : decodedCount;
  const data = samplesDecoded * channels * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write("RIFF", 0, "latin1");
  wav.writeUInt32LE(36 + data, 4);
  wav.write("WAVEfmt ", 8, "latin1");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "latin1");
  wav.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < samplesDecoded; i++) {
    for (let c = 0; c < channels; c++, o += 2) {
      const s = Math.max(-1, Math.min(1, channelData[c][i]));
      wav.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), o);
    }
  }
  return wav;
}

export interface AudioFormat {
  /** Vorbis, Opus, PCM, or the container when the codec is not known. */
  codec: string;
  mime: string;
  channels?: number;
  /** The rate the file was made at; an Opus stream always decodes at 48 kHz. */
  sampleRate?: number;
}

/** What a sound file holds, from its first bytes: Ogg Vorbis, Ogg Opus or WAV. */
export function audioFormat(bytes: Buffer): AudioFormat {
  const magic = bytes.subarray(0, 4).toString("latin1");
  if (magic === "OggS") {
    const vorbis = bytes.indexOf("\x01vorbis", 0, "latin1");
    if (vorbis >= 0 && vorbis < 512) {
      return { codec: "Vorbis", mime: "audio/ogg", channels: bytes[vorbis + 11], sampleRate: bytes.readUInt32LE(vorbis + 12) };
    }
    const opus = bytes.indexOf("OpusHead", 0, "latin1");
    if (opus >= 0 && opus < 512) {
      return { codec: "Opus", mime: "audio/ogg", channels: bytes[opus + 9], sampleRate: bytes.readUInt32LE(opus + 12) || 48000 };
    }
    return { codec: "Ogg", mime: "audio/ogg" };
  }
  if (magic === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WAVE") {
    const fmt = bytes.indexOf("fmt ", 12, "latin1");
    if (fmt >= 0) {
      const tag = bytes.readUInt16LE(fmt + 8);
      return { codec: tag === 1 ? "PCM" : tag === 3 ? "PCM float" : `WAV format ${tag}`, mime: "audio/wav", channels: bytes.readUInt16LE(fmt + 10), sampleRate: bytes.readUInt32LE(fmt + 12) };
    }
    return { codec: "WAV", mime: "audio/wav" };
  }
  if (magic === "fLaC") return { codec: "FLAC", mime: "audio/flac" };
  if (magic.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { codec: "MP3", mime: "audio/mpeg" };
  return { codec: "unknown", mime: "application/octet-stream" };
}

// ---- the sound effect index -----------------------------------------------------------------

export interface OpusIndex {
  count: number;
  hashes: Uint32Array;
  packs: Uint16Array;
  offsets: Uint32Array;
  /** Bytes of RIFF header before the Ogg stream. */
  riff: Uint16Array;
  /** The sound's length in the pack, RIFF header included. */
  lengths: Uint32Array;
  /** The size of the sound as 16-bit WAV, which gives its length: bytes / (48000 * 2 * channels). */
  wavBytes: Uint32Array;
  /** Event hash to the indices (not hashes) of its sounds. */
  groups: { hash: number; sounds: number[] }[];
}

/** Reads an .opusinfo: a 12-byte header ("SND "), a count, then one array per field, then the groups. */
export function parseOpusInfo(buf: Buffer): OpusIndex {
  if (buf.subarray(0, 4).toString("latin1") !== "SND ") throw new Error("Not an .opusinfo file: it does not start with SND");
  let o = 12;
  const count = buf.readUInt32LE(o);
  o += 8; // the count, and a size the reader does not need
  const u32 = () => {
    const a = new Uint32Array(count);
    for (let i = 0; i < count; i++, o += 4) a[i] = buf.readUInt32LE(o);
    return a;
  };
  const u16 = () => {
    const a = new Uint16Array(count);
    for (let i = 0; i < count; i++, o += 2) a[i] = buf.readUInt16LE(o);
    return a;
  };
  const hashes = u32();
  const packs = u16();
  const offsets = u32();
  const riff = u16();
  const lengths = u32();
  const wavBytes = u32();
  const byHash = new Map<number, number>();
  hashes.forEach((h, i) => byHash.set(h, i));
  const groups: OpusIndex["groups"] = [];
  while (o + 8 <= buf.length) {
    const hash = buf.readUInt32LE(o);
    const n = buf.readUInt32LE(o + 4);
    o += 8;
    const sounds: number[] = [];
    for (let i = 0; i < n && o + 4 <= buf.length; i++, o += 4) {
      const at = byHash.get(buf.readUInt32LE(o));
      if (at !== undefined) sounds.push(at);
    }
    groups.push({ hash, sounds });
  }
  return { count, hashes, packs, offsets, riff, lengths, wavBytes, groups };
}

/** The pack files of an index sit beside it: sfx_container.opusinfo has sfx_container_0.opuspak and on. */
export function packName(indexName: string, pack: number): string {
  return `${indexName.replace(/\.opusinfo$/i, "")}_${pack}.opuspak`;
}

/**
 * The Ogg Opus bytes of sound i. A project's .opusinfo reads its packs from beside it when they are
 * there; otherwise, and for the game's own index, the pack comes out of the archives into the cache.
 */
export async function opusSound(bridge: BridgeClient, cacheRoot: string, source: ExportSource, index: OpusIndex, i: number): Promise<Buffer> {
  const pack = index.packs[i];
  let file: string | undefined;
  if (source.file) {
    const beside = path.join(path.dirname(source.file), packName(path.basename(source.file), pack));
    if (fs.existsSync(beside)) file = beside;
  }
  if (!file) {
    const gamePath = source.gamePath ?? gamePathOfIndex(source.file!);
    file = (await sourceFile(bridge, cacheRoot, { gamePath: packName(gamePath, pack) })).file;
  }
  const fd = fs.openSync(file, "r");
  try {
    const start = index.offsets[i] + index.riff[i];
    const length = index.lengths[i] - index.riff[i];
    const out = Buffer.alloc(length);
    fs.readSync(fd, out, 0, length, start);
    if (out.subarray(0, 4).toString("latin1") !== "OggS") throw new Error(`Sound ${index.hashes[i]} in ${path.basename(file)} is not an Ogg stream`);
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

/** The game path of an .opusinfo on disk: its path under source/archive, or the game's own index. */
function gamePathOfIndex(file: string): string {
  const marker = `${path.sep}source${path.sep}archive${path.sep}`;
  const at = file.toLowerCase().indexOf(marker);
  return at >= 0 ? file.slice(at + marker.length) : `base\\sound\\soundbanks\\${path.basename(file)}`;
}

/** Wwise's id for a name, as REDbridge's sound.events computes it: 32-bit FNV-1 of the lower-case name. */
export function wwiseHash(name: string): number {
  let h = 0x811c9dc5;
  for (const c of Buffer.from(name.toLowerCase(), "latin1")) {
    h = Math.imul(h, 0x01000193) >>> 0;
    h = (h ^ c) >>> 0;
  }
  return h;
}

/** The game's sound effect index. */
export const GameSoundIndex = "base\\sound\\soundbanks\\sfx_container.opusinfo";
