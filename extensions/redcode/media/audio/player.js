// The audio player page (C5 V2). One sound with a waveform, play, loop and its length; for an
// .opusinfo, the game's sound effects as a list of events to filter, each click playing one.
// The host sends the bytes as base64. The page decodes them once, draws the waveform from the
// samples and plays the same samples through Web Audio. VS Code's webview decodes no Opus at all
// (<audio>, decodeAudioData and WebCodecs all refused it in the owner's test), so the host sends
// Opus as WAV; the format line still describes the original.
(() => {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let ctx = null;
  let buffer = null; // the decoded sound
  let peaks = null;
  let duration = 0;
  let current = null; // { title, index?, hash?, autoplay? }

  // Playback state: a source node runs from startedAt (context time) at offset seconds into the sound.
  let source = null;
  let playing = false;
  let looping = false;
  let offset = 0;
  let startedAt = 0;
  let timer = 0;

  // ---- host messages ------------------------------------------------------------------------
  let nextId = 1;
  const pending = new Map();
  const request = (msg) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      vscode.postMessage({ ...msg, id });
    });

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "reply") {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) m.error ? p.reject(new Error(m.error)) : p.resolve(m);
      return;
    }
    if (m.type === "error") return showError(m.error);
    if (m.type === "audio") {
      $("title").textContent = m.title;
      $("meta").textContent = m.subtitle || "";
      load(m, { title: m.title });
      return;
    }
    if (m.type === "sounds") return showSounds(m);
  });

  function showError(text) {
    $("waveNote").textContent = text;
    $("waveNote").hidden = false;
  }

  // ---- decoding ---------------------------------------------------------------------------------
  function bytesOf(base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function decode(bytes) {
    ctx ??= new AudioContext();
    return ctx.decodeAudioData(bytes.buffer.slice(0));
  }

  async function load(m, what) {
    const bytes = bytesOf(m.data);
    stop();
    current = what;
    buffer = null;
    peaks = null;
    duration = 0;
    offset = 0;
    $("waveNote").hidden = true;
    $("save").disabled = false;
    const f = m.format || {};
    const info = [f.codec, f.channels ? (f.channels === 1 ? "mono" : f.channels === 2 ? "stereo" : `${f.channels} channels`) : "", f.sampleRate ? `${(f.sampleRate / 1000).toLocaleString()} kHz` : "", `${(m.size ?? bytes.length).toLocaleString()} bytes`].filter(Boolean).join("  ·  ");
    $("info").textContent = info;
    draw();
    try {
      const decoded = await decode(bytes);
      if (current !== what) return;
      buffer = decoded;
      duration = buffer.duration;
      peaks = peaksOf(buffer, 2048);
      $("info").title = m.via ? `Played as WAV, ${m.via}` : "Decoded by the webview";
    } catch (e) {
      if (current === what) showError(`This ${f.codec || "file"} could not be decoded here: ${e.message || e}`);
      return;
    }
    draw();
    if (what.autoplay) play();
  }

  /** Min and max of the mixed channels in n buckets. */
  function peaksOf(buffer, n) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const len = buffer.length;
    const out = new Float32Array(n * 2);
    for (let b = 0; b < n; b++) {
      const from = Math.floor((b * len) / n);
      const to = Math.max(from + 1, Math.floor(((b + 1) * len) / n));
      let lo = 0;
      let hi = 0;
      for (let i = from; i < to; i++) {
        let v = 0;
        for (const ch of channels) v += ch[i];
        v /= channels.length;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      out[b * 2] = lo;
      out[b * 2 + 1] = hi;
    }
    return out;
  }

  // ---- playing ----------------------------------------------------------------------------------
  /** Seconds into the sound. */
  function position() {
    if (!playing || !ctx) return offset;
    const t = ctx.currentTime - startedAt;
    return looping && duration > 0 ? t % duration : Math.min(duration, t);
  }

  function play() {
    if (!buffer || playing) return;
    // The context can start suspended; say so if it stays that way, rather than playing silence.
    void ctx.resume();
    setTimeout(() => playing && ctx.state !== "running" && showError("Audio has not started: click Play again, or click in the player first."), 1000);
    if (offset >= duration) offset = 0;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = looping;
    node.connect(ctx.destination);
    node.onended = () => {
      if (source !== node) return; // stopped for a pause, a seek or another sound
      source = null;
      playing = false;
      offset = 0;
      update();
    };
    node.start(0, offset);
    source = node;
    startedAt = ctx.currentTime - offset;
    playing = true;
    $("waveNote").hidden = true;
    update();
  }

  /** Stops the source and keeps the position. */
  function stop() {
    if (!source) return;
    offset = position();
    const node = source;
    source = null;
    playing = false;
    try {
      node.stop();
    } catch {}
    update();
  }

  function toggle() {
    playing ? stop() : play();
  }

  function seekTo(t) {
    const wasPlaying = playing;
    stop();
    offset = Math.max(0, Math.min(duration, t));
    if (wasPlaying) play();
    else draw();
  }

  function update() {
    $("play").textContent = playing ? "❚❚ Pause" : "▶ Play";
    clearInterval(timer);
    timer = playing ? setInterval(draw, 50) : 0;
    draw();
  }

  const css = (name, fallback) => getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;

  function draw() {
    const canvas = $("wave");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const mid = h / 2;
    g.fillStyle = css("--line", "#262c3d");
    g.fillRect(0, Math.floor(mid), w, 1);
    const t = position();
    const played = duration > 0 ? (t / duration) * w : 0;
    if (peaks) {
      const n = peaks.length / 2;
      const cyan = css("--cyan", "#19f3ff");
      const accent = css("--accent", "#fcee0a");
      for (let x = 0; x < w; x++) {
        const b0 = Math.floor((x / w) * n);
        const b1 = Math.max(b0 + 1, Math.floor(((x + 1) / w) * n));
        let lo = 0;
        let hi = 0;
        for (let b = b0; b < b1; b++) {
          lo = Math.min(lo, peaks[b * 2]);
          hi = Math.max(hi, peaks[b * 2 + 1]);
        }
        g.fillStyle = x < played ? accent : cyan;
        const top = mid - hi * (mid - 4);
        g.fillRect(x, top, 1, Math.max(1, mid - lo * (mid - 4) - top));
      }
    }
    if (duration > 0) {
      g.fillStyle = css("--vscode-foreground", "#fff");
      g.fillRect(Math.min(w - 1, played), 0, 1, h);
    }
    $("time").textContent = `${clock(t)} / ${clock(duration)}`;
  }

  const clock = (s) => {
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return `${m}:${r.toFixed(1).padStart(4, "0")}`;
  };

  $("play").addEventListener("click", toggle);
  $("loop").addEventListener("click", () => {
    looping = !looping;
    $("loop").classList.toggle("on", looping);
    // A running source picks the change up from where it is.
    if (playing) {
      stop();
      play();
    }
  });
  $("save").addEventListener("click", () => vscode.postMessage({ type: "save", index: current?.index }));
  $("copy").addEventListener("click", () => current?.hash !== undefined && vscode.postMessage({ type: "copy", text: String(current.hash) }));

  // Click or drag on the waveform to seek.
  const seek = (e) => {
    if (!duration) return;
    const r = $("wave").getBoundingClientRect();
    seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
  };
  let dragging = false;
  $("wave").addEventListener("pointerdown", (e) => {
    dragging = true;
    $("wave").setPointerCapture(e.pointerId);
    seek(e);
  });
  $("wave").addEventListener("pointermove", (e) => dragging && seek(e));
  $("wave").addEventListener("pointerup", () => (dragging = false));
  new ResizeObserver(() => draw()).observe($("wave"));

  // ---- the sound effect list -------------------------------------------------------------------
  const PageSize = 300;
  let rows = [];
  let hashes = [];
  let matches = [];
  let shown = 0;
  let selected = -1; // index into matches

  function showSounds(m) {
    document.body.classList.add("sounds-mode");
    $("sounds").hidden = false;
    $("title").textContent = m.title;
    $("meta").textContent = m.subtitle || "";
    $("save").disabled = true;
    $("copy").hidden = false;
    $("copy").disabled = true;
    if (m.note) {
      $("note").textContent = m.note;
      $("note").hidden = false;
    }
    hashes = m.hashes;
    rows = m.rows.map((r) => ({ ...r, hay: [r.n || "", ...(r.t || []), String(r.h), ...r.s.map((i) => String(hashes[i]))].join(" ").toLowerCase() }));
    $("waveNote").textContent = "Pick a sound below.";
    $("waveNote").hidden = false;
    filter();
  }

  function filter() {
    const words = $("filter").value.toLowerCase().split(/\s+/).filter(Boolean);
    matches = words.length ? rows.filter((r) => words.every((w) => r.hay.includes(w))) : rows;
    selected = -1;
    shown = 0;
    $("list").textContent = "";
    $("count").textContent = `${matches.length.toLocaleString()} of ${rows.length.toLocaleString()} events`;
    more();
  }

  function more() {
    $("more")?.remove();
    const list = $("list");
    const end = Math.min(matches.length, shown + PageSize);
    for (let k = shown; k < end; k++) list.appendChild(rowOf(matches[k], k));
    shown = end;
    if (shown < matches.length) {
      const b = document.createElement("button");
      b.id = "more";
      b.className = "more";
      b.textContent = `Show ${Math.min(PageSize, matches.length - shown).toLocaleString()} more (${(matches.length - shown).toLocaleString()} left)`;
      b.addEventListener("click", more);
      list.appendChild(b);
    }
  }

  function rowOf(r, k) {
    const row = document.createElement("div");
    row.className = "srow";
    row.dataset.k = k;
    const name = document.createElement("span");
    name.className = r.n ? "ename" : "ename unnamed";
    name.textContent = r.n || `event ${r.h}`;
    name.title = `Event hash ${r.h}`;
    const tags = document.createElement("span");
    tags.className = "tags";
    tags.textContent = (r.t || []).join(", ");
    const chips = document.createElement("span");
    chips.className = "chips";
    r.s.slice(0, 16).forEach((i, n) => {
      const c = document.createElement("button");
      c.className = "chip";
      c.textContent = String(n + 1);
      c.title = `Sound ${hashes[i]}`;
      c.dataset.i = i;
      c.addEventListener("click", (e) => {
        e.stopPropagation();
        pick(k, i);
      });
      chips.appendChild(c);
    });
    if (r.s.length > 16) {
      const rest = document.createElement("span");
      rest.className = "dim";
      rest.textContent = `+${r.s.length - 16}`;
      chips.appendChild(rest);
    }
    row.append(name, tags, chips);
    row.addEventListener("click", () => pick(k, r.s[0]));
    return row;
  }

  async function pick(k, i) {
    const r = matches[k];
    if (!r || i === undefined) return;
    selected = k;
    for (const el of document.querySelectorAll(".srow.selected, .chip.on")) el.classList.remove("selected", "on");
    const row = $("list").querySelector(`.srow[data-k="${k}"]`);
    row?.classList.add("selected");
    row?.querySelector(`.chip[data-i="${i}"]`)?.classList.add("on");
    row?.scrollIntoView({ block: "nearest" });
    const what = { title: r.n || `event ${r.h}`, index: i, hash: hashes[i], autoplay: true };
    current = what;
    $("waveNote").textContent = "Loading…";
    $("waveNote").hidden = false;
    try {
      const m = await request({ type: "sound", index: i });
      if (current !== what) return;
      $("playing").textContent = `${what.title}  ·  sound ${hashes[i]}${r.s.length > 1 ? `  ·  ${r.s.indexOf(i) + 1} of ${r.s.length}` : ""}`;
      $("copy").disabled = false;
      await load(m, what);
    } catch (e) {
      if (current === what) showError(e.message || String(e));
    }
  }

  $("filter").addEventListener("input", () => {
    clearTimeout(filter.timer);
    filter.timer = setTimeout(() => {
      filter.timer = 0;
      filter();
    }, 120);
  });

  document.addEventListener("keydown", (e) => {
    const typing = e.target instanceof HTMLInputElement;
    if (e.key === " " && !typing) {
      e.preventDefault();
      toggle();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && rows.length) {
      e.preventDefault();
      const k = Math.max(0, Math.min(matches.length - 1, selected + (e.key === "ArrowDown" ? 1 : -1)));
      if (k >= shown) more();
      pick(k, matches[k]?.s[0]);
    } else if (e.key === "Enter" && typing) {
      // Enter can come before the typing delay has run the filter.
      if (filter.timer) {
        clearTimeout(filter.timer);
        filter.timer = 0;
        filter();
      }
      if (matches.length) pick(Math.max(0, selected), matches[Math.max(0, selected)].s[0]);
    }
  });

  vscode.postMessage({ type: "ready" });
})();
