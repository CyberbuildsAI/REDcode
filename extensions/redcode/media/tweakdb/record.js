// The TweakDB record page (C5 V3): a record's flats as a table. Record links open the record, resource
// paths open the game file, LocKeys show their text. The host keeps the history.
(() => {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let record = null;

  window.addEventListener("message", (e) => {
    const m = e.data;
    $("back").disabled = !m.canBack;
    $("forward").disabled = !m.canForward;
    if (m.type === "loading") {
      $("path").textContent = m.path;
      $("type").textContent = "";
      $("id").textContent = "";
      $("flats").innerHTML = '<div class="note">Loading…</div>';
      return;
    }
    if (m.type === "error") {
      record = null;
      $("path").textContent = m.path;
      $("flats").innerHTML = "";
      const note = document.createElement("div");
      note.className = "note";
      note.textContent = m.error;
      $("flats").appendChild(note);
      return;
    }
    if (m.type === "record") {
      record = m.record;
      $("path").textContent = record.path ?? record.id;
      $("type").textContent = `${m.shortType}  ·  ${record.type}`;
      $("id").textContent = record.id;
      render();
    }
  });

  const isLocKey = (v) => v && typeof v === "object" && !Array.isArray(v) && typeof v.key === "string" && "text" in v;

  /** A record path or a 0x id: the shape a TweakDBID value has. */
  const looksLikeRecord = (s) => typeof s === "string" && (/^0x[0-9A-F]{16}$/i.test(s) || /^[A-Za-z_][\w]*(\.[\w$]+)+$/.test(s));

  function text(v) {
    if (v === null || v === undefined) return "";
    if (isLocKey(v)) return `${v.key} ${v.text ?? ""}`;
    if (Array.isArray(v)) return v.map(text).join(" ");
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  function link(label, onClick, cls = "link") {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  /** A value by its RED type: links for records and resources, LocKey text, lists, structs as JSON. */
  function valueNode(type, v) {
    const span = document.createElement("span");
    span.className = "value";
    const inner = type.replace(/^array:/, "");
    const one = (x) => {
      if (x === null || x === undefined || x === "") return Object.assign(document.createElement("span"), { className: "dim", textContent: "none" });
      if (inner === "TweakDBID" && looksLikeRecord(x)) return link(x, () => vscode.postMessage({ type: "open", path: x }));
      if (inner.startsWith("raRef") || inner.startsWith("rRef")) return link(x, () => vscode.postMessage({ type: "resource", path: x }), "link resource");
      if (isLocKey(x)) {
        const s = document.createElement("span");
        s.append(Object.assign(document.createElement("span"), { className: "mono dim", textContent: x.key + " " }));
        if (x.text) s.append(Object.assign(document.createElement("span"), { className: "loc", textContent: x.text }));
        return s;
      }
      if (typeof x === "object") return Object.assign(document.createElement("span"), { className: "mono", textContent: JSON.stringify(x, (k, val) => (k === "$type" ? undefined : val)) });
      return Object.assign(document.createElement("span"), { className: typeof x === "string" ? "" : "mono", textContent: String(x) });
    };
    if (Array.isArray(v)) {
      if (v.length === 0) span.append(Object.assign(document.createElement("span"), { className: "dim", textContent: "empty" }));
      v.forEach((x, i) => {
        if (i) span.append(document.createTextNode(", "));
        span.append(one(x));
      });
    } else {
      span.append(one(v));
    }
    return span;
  }

  function render() {
    const host = $("flats");
    host.innerHTML = "";
    if (!record) return;
    const words = $("filter").value.toLowerCase().split(/\s+/).filter(Boolean);
    const flats = record.flats.filter((f) => words.every((w) => `${f.name} ${f.type} ${text(f.value)}`.toLowerCase().includes(w)));
    $("count").textContent = words.length ? `${flats.length} of ${record.flats.length} flats` : `${record.flats.length} flats`;
    const table = document.createElement("table");
    table.className = "rows flats";
    table.innerHTML = "<thead><tr><th>Flat</th><th>Type</th><th>Value</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const f of flats) {
      const tr = document.createElement("tr");
      const name = Object.assign(document.createElement("td"), { className: "key" });
      name.append(link(f.name, () => vscode.postMessage({ type: "copy", text: `${record.path ?? record.id}.${f.name}` }), "plain"));
      name.title = "Copy the flat's path";
      const type = Object.assign(document.createElement("td"), { className: "idx", textContent: f.type });
      const value = document.createElement("td");
      value.append(valueNode(f.type, f.value));
      tr.append(name, type, value);
      body.appendChild(tr);
    }
    table.appendChild(body);
    host.appendChild(table);
  }

  $("filter").addEventListener("input", render);
  $("back").addEventListener("click", () => vscode.postMessage({ type: "back" }));
  $("forward").addEventListener("click", () => vscode.postMessage({ type: "forward" }));
  $("copy").addEventListener("click", () => record && vscode.postMessage({ type: "copy", text: record.path ?? record.id }));
  $("newTweak").addEventListener("click", () => vscode.postMessage({ type: "newTweak" }));
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key === "ArrowLeft" && !$("back").disabled) vscode.postMessage({ type: "back" });
    if (e.altKey && e.key === "ArrowRight" && !$("forward").disabled) vscode.postMessage({ type: "forward" });
  });

  vscode.postMessage({ type: "ready" });
})();
