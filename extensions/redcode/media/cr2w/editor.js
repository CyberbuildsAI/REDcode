// The CR2W editor page. Talks only to the extension (see cr2wEditor.ts), which forwards to the bridge.
// State: nodes fetched so far, the selected path, the types described so far, and the view mode:
// "tree" (tree and property grid) or "table" (localization rows).
"use strict";
(() => {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  // ---- extension messaging ------------------------------------------------------------------
  let nextId = 1;
  const pending = new Map();
  const inflight = new Set();
  function request(type, params = {}) {
    const p = new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      vscode.postMessage({ type, id, ...params });
    });
    inflight.add(p);
    p.finally(() => inflight.delete(p)).catch(() => undefined);
    return p;
  }

  /** Before a save: commit the input being edited (blur fires its change) and let in-flight patches land. */
  async function flush(id) {
    const active = document.activeElement;
    if (active && active !== document.body && (active.tagName === "INPUT" || active.tagName === "SELECT") && active.id !== "search" && active.id !== "filter" && active.id !== "partsFilter") {
      active.blur();
    }
    await Promise.allSettled([...inflight]);
    vscode.postMessage({ type: "flushed", id });
  }

  // The Properties view runs this same page with everything but the grid hidden. It follows the
  // editor's selection and edits through the same document; the editor hears about its edits as "changed".
  const sidebar = document.body.dataset.mode === "sidebar";

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m.type === "reply") {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (!p) return;
      m.ok ? p.resolve(m.value) : p.reject(new Error(m.error));
    } else if (m.type === "document") {
      onDocument(m);
    } else if (m.type === "reload") {
      reloadAll(m.reason);
    } else if (m.type === "materialsChanged") {
      meshView?.refreshMaterials?.();
    } else if (m.type === "changed") {
      // Another page edited the document: refetch and redraw, keeping the selection and expansion.
      reloadAll("an edit elsewhere");
    } else if (m.type === "select") {
      if (sidebar) { selected = m.path ?? ""; $("selected").textContent = selected || "(root)"; void renderGrid(); }
      else { expandTo(m.path ?? ""); void select(m.path ?? "", true, true); }
    } else if (m.type === "attach") {
      nodes.clear();
      vscode.postMessage({ type: "ready" });
    } else if (m.type === "none") {
      info = null;
      $("propsLabel").textContent = "Properties";
      $("grid").replaceChildren(el("div", "dim", "Open a game file in the CR2W editor to see its properties here."));
    } else if (m.type === "showRow") {
      // The host asks for a table row (LocKeys: Add to Project Onscreens); before the table is up, it waits for it.
      if (sidebar) return;
      pendingRow = m.index;
      if (table && mode === "table") void showPendingRow();
    } else if (m.type === "flush") {
      void flush(m.id);
    } else if (m.type === "error") {
      $("file").textContent = "Could not open the file";
      status(m.error, "error");
      $("grid").replaceChildren(el("div", "error", m.error));
    }
  });

  const getNode = (path, offset = 0, limit = 200) => request("getNode", { path, offset, limit });
  const getNodes = (paths) => request("getNodes", { paths });
  const describeType = (name) => request("describeType", { name });
  const createInstance = (name) => request("createInstance", { name });
  const patch = (ops, label) => request("patch", { ops, label });
  const search = (query, path = "", limit = 200) => request("search", { query, path, limit });

  // ---- state -------------------------------------------------------------------------------
  const nodes = new Map();      // path -> NodeInfo (arrays: children of the pages loaded so far)
  const types = new Map();      // red type name -> TypeDescription
  let info = null;
  let selected = "";
  const expanded = new Set([""]);
  let mode = "tree";
  let table = null;             // { path, type, entryType, keys } when the file is a localization table
  let atlas = null;             // { slots, slot, parts, image } when the file is an inkTextureAtlas (see the atlas section)
  // "table" and "atlas" replace the tree; "texture" is the tree with the image above the grid.
  const isSpecial = () => mode === "table" || mode === "atlas" || mode === "mesh";
  // The file's own view, which the header button switches to and from the tree: table, atlas or mesh (3D).
  let home = null;
  const HomeLabels = { table: "Table", atlas: "Atlas", mesh: "3D" };

  const status = (text, kind = "") => { const s = $("status"); s.textContent = text; s.className = kind; };
  const join = (a, b) => (a ? `${a}.${b}` : b);
  const isCompiled = (path) => /(^|\.)compiledData(\.|$)/.test(path);
  const typeOf = async (name) => { if (!types.has(name)) types.set(name, await describeType(name)); return types.get(name); };

  async function fetchNode(path, append = false) {
    const have = nodes.get(path);
    const offset = append && have && have.total !== null ? have.children.length : 0;
    const n = await getNode(path, offset);
    if (append && have && have.children) {
      have.children.push(...n.children);
      have.value = n.value;
      return have;
    }
    nodes.set(path, n);
    return n;
  }

  // ---- document ----------------------------------------------------------------------------
  async function onDocument(m) {
    info = m.info;
    $("file").textContent = m.file;
    $("type").textContent = m.info.type;
    $("size").textContent = `${m.info.bytes.toLocaleString()} B` + (m.info.embeddedFiles ? `, ${m.info.embeddedFiles} embedded` : "") + (m.game ? "  ·  game copy, read-only" : "");
    document.title = m.file;
    if (sidebar) {
      // The grid only, on whatever the editor has selected. Table and atlas files show their selected node too.
      mode = "tree";
      table = null;
      atlas = null;
      selected = m.selected ?? "";
      $("selected").textContent = selected || "(root)";
      await reloadAll("open");
      return;
    }
    table = await detectTable().catch(() => null);
    atlas = table ? null : await detectAtlas().catch((e) => { status(e.message, "error"); return null; });
    if (table || atlas) {
      mode = home = table ? "table" : "atlas";
      $("view").hidden = false;
    } else if (info.type === "CMesh" && window.REDcodeMesh) {
      // A mesh opens on the 3D view; the tree is one click away.
      mode = home = "mesh";
      $("view").hidden = false;
    } else if (info.type === "CBitmapTexture") {
      // A texture: the image above the grid, and the setup fields selected, since they are what gets edited.
      mode = "texture";
      selected = "setup";
      expanded.add("setup");
    }
    await reloadAll("open");
  }

  /** A JsonResource whose root.Data is a localization entries class gets the table view. */
  async function detectTable() {
    if (info.type !== "JsonResource") return null;
    const data = await getNode("root.Data");
    if (!/^localizationPersistence\w*Entries$/.test(data.type)) return null;
    const entries = await getNode("root.Data.entries", 0, 1);
    const desc = await typeOf(entries.type);
    const entryType = desc.elementType;
    const entryDesc = entryType ? await typeOf(entryType) : null;
    const fields = (entryDesc?.properties ?? []).map((p) => p.name);
    const keys = fields.filter((f) => f !== "femaleVariant" && f !== "maleVariant");
    return { path: "root.Data.entries", type: data.type, entryType, keys, fields };
  }

  async function reloadAll(reason) {
    nodes.clear();
    if (reason === "save" || reason === "revert") {
      textureEl = null;
      meshShown = false; // export again, so the 3D view shows the saved file
    }
    try {
      await fetchNode("");
      renderTree();
      await render(true);
      status(reason === "open" ? "" : `Reloaded after ${reason}`);
    } catch (e) {
      status(e.message, "error");
    }
  }

  /** Draws the main pane for the current mode. */
  async function render(force = false) {
    document.body.classList.toggle("table-mode", mode === "table");
    document.body.classList.toggle("atlas-mode", mode === "atlas");
    document.body.classList.toggle("mesh-mode", mode === "mesh");
    $("view").textContent = isSpecial() ? "Tree" : HomeLabels[home] ?? "Tree";
    if (mode !== "mesh") disposeMesh();
    if (mode === "table") {
      if (pendingRow !== null) await showPendingRow();
      else await renderTable();
    } else if (mode === "atlas") {
      await renderAtlas();
    } else if (mode === "mesh") {
      await renderMesh();
    } else {
      await select(selected, force);
    }
  }

  /** Redraws the main pane of the current mode after an edit. */
  async function rerender() {
    if (mode === "table") await renderTable();
    else if (mode === "atlas") await renderAtlas();
    else if (mode === "mesh") return; // the 3D view shows the saved file; it reloads after a save
    else await renderGrid();
  }

  // ---- mesh view (CMesh) ----------------------------------------------------------------------
  // The extension exports the saved file to a .glb in its cache (REDbridge's project.export) and sends
  // the bytes; the bundled viewer (media/mesh/viewer.js) draws them. Unsaved edits show after a save.
  let meshView = null;
  let meshShown = false;

  function disposeMesh() {
    meshView?.dispose();
    meshView = null;
    meshShown = false;
  }

  /** Mounts the 3D view once; an undo or an edit keeps it (and its camera), a save or revert builds it again. */
  async function renderMesh() {
    if (meshShown) return;
    const grid = $("grid");
    disposeMesh();
    $("propsLabel").textContent = `${info.type}  ·  3D`;
    grid.replaceChildren(el("div", "note", "Exporting the mesh…"));
    try {
      const payload = await request("meshPayload");
      const source = payload.json ? { json: payload.json } : { data: base64ToBuffer(payload.data) };
      meshView = await window.REDcodeMesh.mount(grid, source, payload.dirty ? "Shows the saved file; save to see your edits" : "", {
        appearances: payload.appearances,
        materials: payload.materialProvider ? (appearance, materials) => request("renderMaterials", { appearance, materials }) : undefined,
      });
      meshShown = true;
      status(payload.cached ? "" : `Exported to ${payload.path}`);
    } catch (e) {
      grid.replaceChildren(el("div", "error", `Could not show the mesh: ${e.message}`));
    }
  }

  function base64ToBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // ---- tree --------------------------------------------------------------------------------
  function renderTree() {
    const root = $("treeRoot");
    root.replaceChildren();
    const n = nodes.get("");
    if (!n) return;
    for (const c of n.children ?? []) root.appendChild(treeRow("", c));
  }

  function treeRow(parentPath, child) {
    const path = join(parentPath, child.name);
    const li = el("li");
    li.dataset.path = path;
    const row = el("div", "row" + (path === selected ? " selected" : "") + (isCompiled(path) ? " compiled" : ""));
    const canExpand = child.kind !== "value" && child.kind !== "null";
    const toggle = el("span", "toggle", canExpand ? (expanded.has(path) ? "▾" : "▸") : "");
    const name = el("span", "name", child.name);
    const preview = el("span", "preview", child.preview);
    row.append(toggle, name, preview);
    row.title = `${path}\n${child.type}`;
    row.addEventListener("click", (e) => { e.stopPropagation(); void select(path); });
    toggle.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!canExpand) return;
      if (expanded.has(path)) { expanded.delete(path); } else { expanded.add(path); }
      li.replaceWith(treeRow(parentPath, child));
    });
    li.appendChild(row);
    if (canExpand && expanded.has(path)) {
      li.appendChild(childList(path));
    }
    return li;
  }

  function childList(path) {
    const ul = el("ul", "tree");
    const n = nodes.get(path);
    if (!n) {
      ul.appendChild(el("li", "loading", "loading"));
      fetchNode(path).then(() => { const li = ul.parentElement; if (li) li.replaceChild(childList(path), ul); }).catch((e) => status(e.message, "error"));
      return ul;
    }
    for (const c of n.children ?? []) ul.appendChild(treeRow(path, c));
    if (n.total !== null && n.children.length < n.total) {
      const more = el("li", "more", `${(n.total - n.children.length).toLocaleString()} more`);
      more.addEventListener("click", async (e) => { e.stopPropagation(); await fetchNode(path, true); const li = ul.parentElement; if (li) li.replaceChild(childList(path), ul); });
      ul.appendChild(more);
    }
    return ul;
  }

  /** Re-renders the subtree containing a path after an edit, keeping expansion. */
  async function refreshTreeFrom(path) {
    const parent = path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : "";
    nodes.delete(parent);
    await fetchNode(parent);
    if (parent === "") { renderTree(); return; }
    const li = document.querySelector(`li[data-path="${CSS.escape(parent)}"]`);
    if (!li) { renderTree(); return; }
    const grand = parent.includes(".") ? parent.slice(0, parent.lastIndexOf(".")) : "";
    const gn = nodes.get(grand);
    const child = gn?.children?.find((c) => join(grand, c.name) === parent);
    if (child) li.replaceWith(treeRow(grand, child)); else renderTree();
  }

  function expandTo(path) {
    const parts = path.split(".");
    let p = "";
    for (const part of parts) { p = join(p, part); expanded.add(p); }
    renderTree();
  }

  // ---- selection and the property grid -------------------------------------------------------
  /** Selects a path and shows it in the grid. silent: the selection came from another page, so do not echo it back. */
  async function select(path, force = false, silent = false) {
    if (path === selected && !force) return;
    selected = path;
    for (const r of document.querySelectorAll("#tree .row.selected")) r.classList.remove("selected");
    const li = document.querySelector(`li[data-path="${CSS.escape(path)}"]`);
    li?.querySelector(":scope > .row")?.classList.add("selected");
    $("selected").textContent = path || "(root)";
    if (!silent) vscode.postMessage({ type: "selected", path });
    await renderGrid();
  }

  // Renders are built off-screen and swapped in at the end. A render that was overtaken by a newer one
  // (an edit landing while a save reloads, for example) throws its rows away instead of appending them.
  let renderSeq = 0;
  async function renderGrid() {
    const seq = ++renderSeq;
    const grid = $("grid");
    const rows = [];
    let n;
    try { n = await fetchNode(selected); } catch (e) { if (seq === renderSeq) grid.replaceChildren(el("div", "error", e.message)); return; }
    if (seq !== renderSeq) return;
    const readOnly = isCompiled(selected) || !!info?.readOnly;
    if (info?.readOnly && selected === "") {
      rows.push(el("div", "banner", "This is the game's copy and is read-only. Add the file to the project to edit it."));
    } else if (isCompiled(selected)) {
      rows.push(el("div", "banner", "compiledData mirrors components: after parsing they are the same objects, and WolvenKit rebuilds this block from components on save. It is read-only here; edit the component under components."));
    }
    try {
    switch (n.kind) {
      case "class": {
        const desc = await typeOf(n.type).catch(() => null);
        for (const c of n.children) rows.push(await propertyRow(selected, c, desc?.properties?.find((p) => p.name === c.name), readOnly));
        break;
      }
      case "array": {
        const desc = await typeOf(n.type).catch(() => null);
        rows.push(arrayToolbar(selected, n, desc, readOnly));
        for (const c of n.children) rows.push(await arrayRow(selected, c, n, readOnly));
        if (n.total !== null && n.children.length < n.total) {
          const more = el("button", "more", `Load ${Math.min(200, n.total - n.children.length)} more of ${n.total.toLocaleString()}`);
          more.addEventListener("click", async () => { await fetchNode(selected, true); await renderGrid(); });
          rows.push(more);
        }
        break;
      }
      case "handle":
      case "buffer":
      case "package":
        for (const c of n.children) rows.push(await propertyRow(selected, c, null, readOnly));
        if (n.kind === "handle" && n.children.length === 0 && !readOnly) rows.push(await handleCreateRow(selected, n));
        break;
      default: {
        const row = el("div", "prow");
        row.append(el("span", "pname", "value"), el("span", "ptype", n.type));
        row.appendChild(await leafEditor(selected, n.type, n.value, readOnly));
        rows.push(row);
      }
    }
    } catch (e) {
      // A child fetch failed (the bridge went away, for instance): say so instead of an empty grid.
      rows.push(el("div", "error", e.message));
      status(e.message, "error");
    }
    if (seq !== renderSeq) return;
    if (mode === "texture") rows.unshift(textureStage());
    $("propsLabel").textContent = selected ? `${selected}  ·  ${n.type}` : `${n.type}`;
    grid.replaceChildren(...rows);
  }

  // ---- texture view (CBitmapTexture) --------------------------------------------------------------
  // The image sits above whatever the grid shows. It is built once and reused across renders, and
  // thrown away after a save so the file's new pixels show.
  let textureEl = null;
  let textureFit = true;
  let texturePixel = false;

  function textureStage() {
    if (textureEl) return textureEl;
    const wrap = el("div", "texwrap");
    const bar = el("div", "toolbar");
    const stage = el("div", "stage" + (textureFit ? " fit" : "") + (texturePixel ? " pixel" : ""));
    const dims = el("span", "dim");
    const fit = el("button", textureFit ? "on" : "", "Fit");
    const one = el("button", textureFit ? "" : "on", "1:1");
    const pixel = el("button", texturePixel ? "on" : "", "Pixels");
    fit.addEventListener("click", () => { textureFit = true; stage.classList.add("fit"); fit.classList.add("on"); one.classList.remove("on"); });
    one.addEventListener("click", () => { textureFit = false; stage.classList.remove("fit"); one.classList.add("on"); fit.classList.remove("on"); });
    pixel.addEventListener("click", () => { texturePixel = !texturePixel; stage.classList.toggle("pixel", texturePixel); pixel.classList.toggle("on", texturePixel); });
    bar.append(fit, one, pixel, dims);
    stage.appendChild(el("div", "note", "Converting the texture…"));
    wrap.append(bar, stage);
    textureEl = wrap;
    request("documentTexture").then((r) => {
      const img = el("img");
      img.alt = $("file").textContent;
      let retried = false;
      img.addEventListener("load", () => { dims.textContent = `${img.naturalWidth} × ${img.naturalHeight}`; });
      img.addEventListener("error", async () => {
        if (!retried && r.png) { retried = true; try { img.src = await request("textureData", { png: r.png }); return; } catch (e) { stage.replaceChildren(el("div", "note", e.message)); return; } }
        stage.replaceChildren(el("div", "note", `The page could not load ${r.png}`));
      });
      img.src = r.src;
      stage.replaceChildren(img);
    }).catch((e) => stage.replaceChildren(el("div", "note", `Could not convert the texture: ${e.message}`)));
    return wrap;
  }

  async function propertyRow(parentPath, c, pdesc, readOnly) {
    const path = join(parentPath, c.name);
    const row = el("div", "prow");
    row.append(el("span", "pname", c.name), el("span", "ptype", c.type));
    const cell = el("span", "pvalue");
    row.appendChild(cell);
    const open = () => { const b = el("button", "link", "open"); b.addEventListener("click", () => { expandTo(path); void select(path); }); return b; };
    switch (c.kind) {
      case "value":
        cell.appendChild(await leafEditor(path, c.type, c.value, readOnly, pdesc));
        break;
      case "null":
        cell.appendChild(el("span", "dim", "null"));
        break;
      case "class": {
        if (c.value && typeof c.value === "object") {
          // A small struct: its fields inline, each edited at its own path.
          const n = await fetchNode(path);
          const sub = el("div", "struct");
          for (const x of n.children) {
            const srow = el("div", "srow");
            srow.append(el("span", "sname", x.name));
            srow.appendChild(await leafEditor(join(path, x.name), x.type, x.value, readOnly));
            sub.appendChild(srow);
          }
          cell.appendChild(sub);
        } else {
          cell.append(el("span", "dim", c.preview), open());
        }
        break;
      }
      case "array": {
        cell.append(el("span", "dim", `${(c.count ?? 0).toLocaleString()} items`), open());
        if (!readOnly) cell.appendChild(await addButton(path, c.type));
        break;
      }
      case "handle":
        cell.append(el("span", "dim", c.preview), c.preview === "null" ? el("span") : open());
        break;
      default:
        cell.append(el("span", "dim", c.preview), open());
    }
    return row;
  }

  async function arrayRow(arrayPath, c, n, readOnly) {
    const path = join(arrayPath, c.name);
    const index = Number(c.name);
    const row = el("div", "prow");
    row.append(el("span", "pname", `[${c.name}]`), el("span", "ptype", c.type));
    const cell = el("span", "pvalue");
    row.appendChild(cell);
    if (c.kind === "value") {
      cell.appendChild(await leafEditor(path, c.type, c.value, readOnly));
    } else {
      const b = el("button", "link", "open");
      b.addEventListener("click", () => { expandTo(path); void select(path); });
      cell.append(el("span", "dim", c.preview), b);
    }
    if (!readOnly) {
      const tools = el("span", "tools");
      const up = el("button", "icon", "↑"); up.title = "Move up"; up.disabled = index === 0;
      const down = el("button", "icon", "↓"); down.title = "Move down"; down.disabled = n.total !== null && index >= n.total - 1;
      const del = el("button", "icon", "✕"); del.title = "Remove";
      up.addEventListener("click", () => apply([{ op: "move", from: path, path: join(arrayPath, String(index - 1)) }], `Move ${c.name} up`, arrayPath));
      down.addEventListener("click", () => apply([{ op: "move", from: path, path: join(arrayPath, String(index + 1)) }], `Move ${c.name} down`, arrayPath));
      del.addEventListener("click", () => apply([{ op: "remove", path }], `Remove ${arrayPath}[${c.name}]`, arrayPath));
      tools.append(up, down, del);
      row.appendChild(tools);
    }
    return row;
  }

  function arrayToolbar(path, n, desc, readOnly) {
    const bar = el("div", "toolbar");
    bar.appendChild(el("span", "dim", `${(n.total ?? n.children.length).toLocaleString()} items of ${desc?.elementType ?? n.type}`));
    if (!readOnly) addButton(path, n.type).then((b) => bar.appendChild(b));
    return bar;
  }

  async function addButton(arrayPath, arrayType) {
    const b = el("button", "link", "+ add");
    b.title = "Append a default item";
    b.addEventListener("click", async () => {
      try {
        const desc = await typeOf(arrayType);
        const elementType = desc.elementType;
        if (!elementType) throw new Error(`Cannot tell the element type of ${arrayType}`);
        if (elementType.startsWith("handle:")) {
          const inner = elementType.slice("handle:".length);
          const chosen = window.prompt(`Class for the new ${inner} (a concrete type, for example entMeshComponent):`, inner);
          if (!chosen) return;
          const value = await createInstance(chosen);
          await apply([{ op: "add", path: `${arrayPath}.-`, value: { Data: value } }], `Add ${chosen} to ${arrayPath}`, arrayPath);
          return;
        }
        const value = await createInstance(elementType);
        await apply([{ op: "add", path: `${arrayPath}.-`, value }], `Add ${elementType} to ${arrayPath}`, arrayPath);
      } catch (e) {
        status(e.message, "error");
      }
    });
    return b;
  }

  async function handleCreateRow(path, n) {
    const row = el("div", "prow");
    row.append(el("span", "pname", "Data"), el("span", "ptype", n.type));
    const cell = el("span", "pvalue");
    const b = el("button", "link", "create");
    b.addEventListener("click", async () => {
      const desc = await typeOf(n.type).catch(() => null);
      const chosen = window.prompt("Class for the new object:", desc?.elementType ?? "");
      if (!chosen) return;
      try {
        const value = await createInstance(chosen);
        await apply([{ op: "replace", path: `${path}.Data`, value }], `Create ${chosen}`, path);
      } catch (e) { status(e.message, "error"); }
    });
    cell.append(el("span", "dim", "null"), b);
    row.appendChild(cell);
    return row;
  }

  // ---- leaf editors --------------------------------------------------------------------------
  const IntTypes = new Set(["Int8", "Int16", "Int32", "Int64", "Uint8", "Uint16", "Uint32", "Uint64"]);

  /** An input for a leaf. Values with a $value field (CName, ResourcePath, TweakDBID, ...) edit that field and keep the rest. */
  async function leafEditor(path, type, value, readOnly, pdesc, onCommitted) {
    const wrap = el("span", "leaf");
    const isWrapped = value !== null && typeof value === "object" && "$value" in value;
    const shown = isWrapped ? value.$value : value;
    const desc = pdesc ?? (await typeOf(type).catch(() => null));
    const commit = async (newShown) => {
      const newValue = isWrapped ? { ...value, $value: newShown } : newShown;
      await apply([{ op: "replace", path, value: newValue }], `Set ${path}`, path, onCommitted);
    };
    let input;
    if (desc?.kind === "enum" && desc.enumValues) {
      input = el("select");
      for (const v of desc.enumValues) { const o = el("option", "", v); o.value = v; input.appendChild(o); }
      input.value = String(shown);
      input.addEventListener("change", () => commit(input.value));
    } else if (type === "Bool") {
      input = el("input");
      input.type = "checkbox";
      input.checked = shown === 1 || shown === true;
      input.addEventListener("change", () => commit(input.checked ? 1 : 0));
    } else if (type === "Float" || type === "Double" || IntTypes.has(type)) {
      input = el("input");
      input.type = "text";
      input.inputMode = "decimal";
      input.className = "num";
      input.value = String(shown);
      const done = () => {
        const parsed = Number(input.value);
        if (Number.isNaN(parsed)) { input.classList.add("bad"); return; }
        input.classList.remove("bad");
        const v = type === "Float" ? Math.fround(parsed) : IntTypes.has(type) ? Math.trunc(parsed) : parsed;
        if (v === shown) { input.value = String(shown); return; }
        void commit(v);
      };
      input.addEventListener("change", done);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(); } if (e.key === "Escape") { input.value = String(shown); } });
    } else {
      input = el("input");
      input.type = "text";
      input.value = shown === null || shown === undefined ? "" : typeof shown === "object" ? JSON.stringify(shown) : String(shown);
      const done = () => {
        let v = input.value;
        if (typeof shown === "object" && shown !== null) { try { v = JSON.parse(v); } catch { input.classList.add("bad"); return; } }
        if (v === shown) return;
        void commit(v);
      };
      input.addEventListener("change", done);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(); } });
    }
    input.disabled = !!readOnly;
    wrap.appendChild(input);
    if (isWrapped && value.$storage === "uint64") wrap.appendChild(el("span", "dim", "hash"));
    // A LocKey (a string, or a LocalizationString's value): its text beside it, from the LocKeys index.
    const locKey = typeof shown === "string" ? shown : shown && typeof shown === "object" && typeof shown.value === "string" ? shown.value : "";
    if (/^LocKey#[\w\-.]+$/.test(locKey)) {
      request("locText", { query: locKey }).then((text) => {
        if (!text) return;
        input.title = text;
        wrap.appendChild(el("span", "dim lockey", text.length > 80 ? `${text.slice(0, 77)}…` : text));
      }).catch(() => {});
    }
    return wrap;
  }

  // ---- applying edits ------------------------------------------------------------------------
  async function apply(ops, label, refreshPath, after) {
    try {
      status("…");
      await patch(ops, label);
      status(label);
      nodes.delete(refreshPath);
      if (after) {
        await after();
      } else if (isSpecial()) {
        await rerender();
      } else {
        await renderGrid();
        await refreshTreeFrom(refreshPath || ops[0].path);
      }
    } catch (e) {
      status(e.message, "error");
      await rerender();
    }
  }

  // ---- search ---------------------------------------------------------------------------------
  async function runSearch(query) {
    const grid = $("grid");
    if (!query) { await renderGrid(); return; }
    status("searching…");
    try {
      const r = await search(query, "", 500);
      status(`${r.total.toLocaleString()} match${r.total === 1 ? "" : "es"}${r.truncated ? `, first ${r.hits.length} shown` : ""}`);
      const list = el("div", "results");
      $("propsLabel").textContent = `Search: ${query}`;
      if (r.hits.length === 0) list.appendChild(el("div", "dim", "No matches."));
      for (const h of r.hits) {
        const row = el("div", "result" + (isCompiled(h.path) ? " compiled" : ""));
        row.title = h.path;
        row.append(el("span", "rpath", h.path), el("span", "rtype", h.type), el("span", "rpreview", h.preview));
        row.addEventListener("click", () => { if (isSpecial()) { mode = "tree"; void render(); } expandTo(h.path); void select(h.path, true); });
        list.appendChild(row);
      }
      grid.replaceChildren(list);
    } catch (e) {
      status(e.message, "error");
    }
  }

  // ---- table view (localization files) ---------------------------------------------------------
  let filterQuery = "";
  let filterTimer;
  let tablePage = 0;
  const PageSize = 200;
  let pendingRow = null;

  /** Goes to the row the host asked for: its page, unfiltered, with the row focused. */
  async function showPendingRow() {
    const index = pendingRow;
    pendingRow = null;
    if (index === null || index === undefined) return;
    filterQuery = "";
    tablePage = Math.floor(index / PageSize);
    await renderTable(index);
  }

  /** Renders the current page. With focusIndex, the page then scrolls to that row and focuses its first field. */
  async function renderTable(focusIndex) {
    const seq = ++renderSeq;
    const grid = $("grid");
    const t = table;
    const parts = [];
    const bar = el("div", "toolbar");
    const filter = el("input");
    filter.id = "filter";
    filter.type = "search";
    filter.placeholder = "filter rows (key or text)";
    filter.value = filterQuery;
    filter.addEventListener("input", () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => { filterQuery = filter.value.trim(); tablePage = 0; void renderTable(); }, 300); });
    const add = el("button", "link", "+ add row");
    add.addEventListener("click", async () => {
      try {
        const value = await createInstance(t.entryType);
        await apply([{ op: "add", path: `${t.path}.-`, value }], "Add row", t.path, async () => {
          // The new row is the last one. Ask for the count after the add, since a filter leaves the cached node stale.
          const total = (await getNode(t.path, 0, 1)).total ?? 1;
          filterQuery = "";
          tablePage = Math.floor((total - 1) / PageSize);
          await renderTable(total - 1);
        });
      } catch (e) { status(e.message, "error"); }
    });
    bar.append(filter);
    if (!info?.readOnly) bar.appendChild(add);
    parts.push(bar);

    let rows = [];
    let total = 0;
    let indices = null;
    try {
      if (filterQuery) {
        const r = await search(filterQuery, t.path, 2000);
        indices = [...new Set(r.hits.map((h) => h.path.slice(t.path.length + 1).split(".")[0]))];
        total = indices.length;
        const pageIdx = indices.slice(tablePage * PageSize, (tablePage + 1) * PageSize);
        const got = pageIdx.length ? await getNodes(pageIdx.map((i) => `${t.path}.${i}`)) : [];
        rows = got.map((n, k) => ({ index: Number(pageIdx[k]), value: n.value }));
        status(`${total.toLocaleString()} row${total === 1 ? "" : "s"} match${r.truncated ? " (first 2000 matches searched)" : ""}`);
      } else {
        const n = await getNode(t.path, tablePage * PageSize, PageSize);
        nodes.set(t.path, n);
        total = n.total ?? 0;
        rows = n.children.map((c) => ({ index: Number(c.name), value: c.value }));
      }
    } catch (e) {
      if (seq === renderSeq) grid.replaceChildren(el("div", "error", e.message));
      return;
    }
    if (seq !== renderSeq) return;

    const tbl = el("table", "rows");
    const head = el("tr");
    head.appendChild(el("th", "", "#"));
    for (const k of t.keys) head.appendChild(el("th", "", k));
    head.appendChild(el("th", "", "femaleVariant"));
    head.appendChild(el("th", "", "maleVariant"));
    head.appendChild(el("th", ""));
    tbl.appendChild(head);
    const entryDesc = await typeOf(t.entryType).catch(() => null);
    let focusRow = null;
    for (const r of rows) {
      const tr = el("tr");
      if (r.index === focusIndex) { tr.classList.add("focus"); focusRow = tr; }
      tr.appendChild(el("td", "idx", String(r.index)));
      const rowPath = `${t.path}.${r.index}`;
      for (const f of [...t.keys, "femaleVariant", "maleVariant"]) {
        const td = el("td", f === "femaleVariant" || f === "maleVariant" ? "text" : "key");
        const pdesc = entryDesc?.properties?.find((p) => p.name === f);
        td.appendChild(await leafEditor(`${rowPath}.${f}`, pdesc?.type ?? "String", r.value?.[f] ?? "", !!info?.readOnly, pdesc, async () => { nodes.delete(t.path); }));
        tr.appendChild(td);
      }
      const tools = el("td", "tools");
      const del = el("button", "icon", "✕");
      del.title = "Delete row";
      del.addEventListener("click", () => apply([{ op: "remove", path: rowPath }], `Delete row ${r.index}`, t.path));
      if (!info?.readOnly) tools.appendChild(del);
      tr.appendChild(tools);
      tbl.appendChild(tr);
    }
    parts.push(tbl);

    const pager = el("div", "pager");
    const pages = Math.max(1, Math.ceil(total / PageSize));
    const prev = el("button", "", "‹ prev"); prev.disabled = tablePage === 0;
    const next = el("button", "", "next ›"); next.disabled = tablePage >= pages - 1;
    prev.addEventListener("click", () => { tablePage--; void renderTable(); });
    next.addEventListener("click", () => { tablePage++; void renderTable(); });
    pager.append(prev, el("span", "dim", `rows ${(tablePage * PageSize + 1).toLocaleString()} to ${Math.min(total, (tablePage + 1) * PageSize).toLocaleString()} of ${total.toLocaleString()}`), next);
    parts.push(pager);

    if (seq !== renderSeq) return;
    $("propsLabel").textContent = `${t.type}  ·  ${t.entryType}`;
    grid.replaceChildren(...parts);
    if (focusRow) {
      focusRow.scrollIntoView({ block: "center" });
      focusRow.querySelector("input, select")?.focus();
    } else if (filterQuery && document.activeElement !== filter) {
      filter.focus(); filter.setSelectionRange(filter.value.length, filter.value.length);
    }
  }

  // ---- the splitter between the tree and the properties -----------------------------------------
  // Drag sets --tree on #body in pixels; the width is kept in the webview state so a reload keeps it.
  const splitter = $("splitter");
  const body = $("body");
  const savedTree = vscode.getState()?.treeWidth;
  if (typeof savedTree === "number") body.style.setProperty("--tree", `${savedTree}px`);
  splitter.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("active");
    document.body.classList.add("resizing");
    const left = body.getBoundingClientRect().left;
    let width = $("tree").getBoundingClientRect().width;
    const move = (ev) => {
      width = Math.min(Math.max(160, ev.clientX - left), body.clientWidth * 0.7);
      body.style.setProperty("--tree", `${Math.round(width)}px`);
    };
    const up = () => {
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", up);
      splitter.removeEventListener("pointercancel", up);
      splitter.classList.remove("active");
      document.body.classList.remove("resizing");
      vscode.setState({ ...(vscode.getState() ?? {}), treeWidth: Math.round(width) });
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up);
    splitter.addEventListener("pointercancel", up);
  });
  splitter.addEventListener("dblclick", () => {
    body.style.removeProperty("--tree");
    const s = vscode.getState() ?? {}; delete s.treeWidth; vscode.setState(s);
  });

  // ---- atlas view (inkTextureAtlas) --------------------------------------------------------------
  // Game atlases keep clippingRectInPixels at zero; only clippingRectInUVCoords counts in the game. So
  // the rectangles are drawn from UV times the texture size, and an edit here writes both rectangles.
  const SVG = "http://www.w3.org/2000/svg";
  const RectKeys = ["left", "top", "right", "bottom"];
  const UvKeys = ["Left", "Top", "Right", "Bottom"];
  const images = new Map();     // depot path -> { src, png, w, h, error }, converted once per document
  let partsFilter = "";
  let atlasFit = true;
  let atlasPixel = false;
  let atlasLabels = null;       // null: on while the slot has few parts

  /** An inkTextureAtlas gets the atlas view, starting on the first slot that has parts. */
  async function detectAtlas() {
    if (info.type !== "inkTextureAtlas") return null;
    const slots = await readSlots();
    if (slots.length === 0) return null;
    const first = slots.findIndex((s) => s.count > 0);
    return { slots, slot: first < 0 ? 0 : first, parts: [] };
  }

  /** The slots with their texture and part count, plus the root's own texture and parts when an older file uses them. */
  async function readSlots() {
    const out = [];
    const list = await getNode("slots", 0, 10).catch(() => null);
    for (const c of list?.children ?? []) {
      const p = join("slots", c.name);
      out.push(slotInfo(p, await getNode(p), `slot ${c.name}`));
    }
    const root = await getNode("");
    const rootParts = root.children?.find((c) => c.name === "parts");
    if (rootParts && (rootParts.count ?? 0) > 0) out.push(slotInfo("", root, "root"));
    return out;
  }

  function slotInfo(path, node, name) {
    const depot = node.children?.find((c) => c.name === "texture")?.value?.DepotPath?.$value;
    return {
      path, name,
      texture: depot && depot !== "0" ? depot : "",
      count: node.children?.find((c) => c.name === "parts")?.count ?? 0,
      partsPath: join(path, "parts"),
    };
  }

  /** Every part of the slot with its values, fetched 200 at a time. */
  async function loadParts(slot) {
    const first = await getNode(slot.partsPath, 0, 1);
    const total = first.total ?? 0;
    slot.count = total;
    const paths = Array.from({ length: total }, (_, i) => `${slot.partsPath}.${i}`);
    const parts = [];
    for (let i = 0; i < paths.length; i += 200) {
      const got = await getNodes(paths.slice(i, i + 200));
      got.forEach((n, k) => parts.push(partOf(paths[i + k], i + k, n)));
    }
    return parts;
  }

  function partOf(path, index, n) {
    const get = (name) => n.children?.find((c) => c.name === name)?.value;
    const raw = { partName: get("partName"), px: get("clippingRectInPixels") ?? {}, uv: get("clippingRectInUVCoords") ?? {} };
    return { path, index, name: raw.partName?.$value ?? "", raw };
  }

  /** The rectangle in texture pixels: from UV when the texture size is known and UV is set, else as stored in pixels. */
  function pixelRect(part, size) {
    const { px, uv } = part.raw;
    if (size && UvKeys.some((k) => (uv[k] ?? 0) !== 0)) {
      return { left: Math.round((uv.Left ?? 0) * size.w), top: Math.round((uv.Top ?? 0) * size.h), right: Math.round((uv.Right ?? 0) * size.w), bottom: Math.round((uv.Bottom ?? 0) * size.h) };
    }
    return { left: px.left ?? 0, top: px.top ?? 0, right: px.right ?? 0, bottom: px.bottom ?? 0 };
  }

  const uvOf = (rect, size) => size ? { Left: Math.fround(rect.left / size.w), Top: Math.fround(rect.top / size.h), Right: Math.fround(rect.right / size.w), Bottom: Math.fround(rect.bottom / size.h) } : null;
  const sizeOf = (slot) => { const i = images.get(slot.texture); return i && i.w ? { w: i.w, h: i.h } : null; };
  const showLabels = () => atlasLabels ?? atlas.parts.length <= 60;

  /** Asks the extension for the texture's PNG once; later renders reuse the answer. */
  async function imageFor(depot) {
    if (!depot) return null;
    if (images.has(depot)) return images.get(depot);
    const entry = { src: "", png: "", w: 0, h: 0, error: "" };
    images.set(depot, entry);
    try {
      const r = await request("texture", { depot });
      entry.src = r.src;
      entry.png = r.png;
    } catch (e) {
      entry.error = e.message;
    }
    return entry;
  }

  async function renderAtlas() {
    const seq = ++renderSeq;
    const a = atlas;
    const grid = $("grid");
    const slot = a.slots[a.slot];
    let image;
    try {
      [a.parts, image] = await Promise.all([loadParts(slot), imageFor(slot.texture)]);
    } catch (e) {
      if (seq === renderSeq) grid.replaceChildren(el("div", "error", e.message));
      return;
    }
    if (seq !== renderSeq) return;
    if (!a.parts.some((p) => p.path === selected)) selected = a.parts[0]?.path ?? "";
    $("selected").textContent = selected || "(root)";
    renderPartsList();

    // The stage: the texture with the overlay, or a note when there is nothing to draw.
    const stage = el("div", "stage" + (atlasFit ? " fit" : "") + (atlasPixel ? " pixel" : ""));
    const svg = document.createElementNS(SVG, "svg");
    const dims = el("span", "dim");
    if (!slot.texture) {
      stage.appendChild(el("div", "note", "This slot has no texture. Its parts are listed on the left and edited below; the tree has everything else."));
    } else if (image.error) {
      stage.appendChild(el("div", "note", `Could not show ${slot.texture}: ${image.error}`));
    } else {
      const img = el("img");
      img.alt = slot.texture;
      let retried = false;
      img.addEventListener("load", () => {
        image.w = img.naturalWidth;
        image.h = img.naturalHeight;
        dims.textContent = `${image.w} × ${image.h}`;
        drawOverlay(svg, img, image);
        if (seq === renderSeq) { fillPartsList(); void renderPartForm(); }
      });
      img.addEventListener("error", async () => {
        if (!retried && image.png) {
          // The resource URI was refused: ask for the bytes and keep the data URI for later renders.
          retried = true;
          try { image.src = await request("textureData", { png: image.png }); img.src = image.src; return; } catch (e) { image.error = e.message; }
        } else {
          image.error = `the page could not load ${image.png}`;
        }
        stage.replaceChildren(el("div", "note", `Could not show ${slot.texture}: ${image.error}`));
      });
      img.src = image.src;
      stage.append(img, svg);
    }

    const bar = el("div", "toolbar");
    const pick = el("select");
    a.slots.forEach((s, i) => {
      const o = el("option", "", `${s.name}: ${s.texture ? s.texture.split("\\").pop() : "no texture"}, ${s.count} part${s.count === 1 ? "" : "s"}`);
      o.value = String(i);
      pick.appendChild(o);
    });
    pick.value = String(a.slot);
    pick.title = slot.texture || "This slot has no texture";
    pick.addEventListener("change", () => { a.slot = Number(pick.value); selected = ""; partsFilter = ""; void renderAtlas(); });
    const fit = el("button", atlasFit ? "on" : "", "Fit");
    const one = el("button", atlasFit ? "" : "on", "1:1");
    const pixel = el("button", atlasPixel ? "on" : "", "Pixels");
    const labels = el("button", showLabels() ? "on" : "", "Labels");
    fit.title = "Scale the texture to the pane"; one.title = "One texture pixel per screen pixel"; pixel.title = "Nearest-neighbour scaling"; labels.title = "Part names on the texture";
    fit.addEventListener("click", () => { atlasFit = true; stage.classList.add("fit"); fit.classList.add("on"); one.classList.remove("on"); });
    one.addEventListener("click", () => { atlasFit = false; stage.classList.remove("fit"); one.classList.add("on"); fit.classList.remove("on"); });
    pixel.addEventListener("click", () => { atlasPixel = !atlasPixel; stage.classList.toggle("pixel", atlasPixel); pixel.classList.toggle("on", atlasPixel); });
    labels.addEventListener("click", () => { atlasLabels = !showLabels(); svg.classList.toggle("labels", atlasLabels); labels.classList.toggle("on", atlasLabels); });
    bar.append(pick, fit, one, pixel, labels, dims);

    const form = el("div");
    form.id = "partForm";
    if (seq !== renderSeq) return;
    $("propsLabel").textContent = `inkTextureAtlas  ·  ${slot.name}`;
    grid.replaceChildren(bar, stage, form);
    await renderPartForm();
  }

  /** The part rectangles over the image, in texture pixels through the viewBox; labels keep a screen size. */
  function drawOverlay(svg, img, image) {
    svg.setAttribute("viewBox", `0 0 ${image.w} ${image.h}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.classList.toggle("labels", showLabels());
    svg.replaceChildren();
    const size = { w: image.w, h: image.h };
    for (const p of atlas.parts) {
      const r = pixelRect(p, size);
      const g = document.createElementNS(SVG, "g");
      g.dataset.path = p.path;
      if (p.path === selected) g.classList.add("selected");
      const rect = document.createElementNS(SVG, "rect");
      rect.setAttribute("x", r.left); rect.setAttribute("y", r.top);
      rect.setAttribute("width", Math.max(0, r.right - r.left)); rect.setAttribute("height", Math.max(0, r.bottom - r.top));
      const title = document.createElementNS(SVG, "title");
      title.textContent = `${p.name}\n${r.left}, ${r.top} to ${r.right}, ${r.bottom}  (${r.right - r.left} × ${r.bottom - r.top})`;
      const text = document.createElementNS(SVG, "text");
      text.dataset.x = r.left; text.dataset.y = r.top;
      text.textContent = p.name;
      g.append(title, rect, text);
      g.addEventListener("click", () => void selectPart(p.path));
      svg.appendChild(g);
    }
    const fitText = () => {
      const scale = img.clientWidth / image.w || 1;
      for (const t of svg.querySelectorAll("text")) {
        t.setAttribute("font-size", (11 / scale).toFixed(3));
        t.setAttribute("x", (Number(t.dataset.x) + 3 / scale).toFixed(2));
        t.setAttribute("y", (Number(t.dataset.y) + 13 / scale).toFixed(2));
      }
    };
    fitText();
    new ResizeObserver(fitText).observe(img);
  }

  function renderPartsList() {
    const bar = $("partsBar");
    bar.replaceChildren();
    const filter = el("input");
    filter.id = "partsFilter";
    filter.type = "search";
    filter.placeholder = "filter parts";
    filter.value = partsFilter;
    filter.addEventListener("input", () => { partsFilter = filter.value.trim().toLowerCase(); fillPartsList(); });
    const add = el("button", "link", "+ add part");
    add.title = "Add a part to this slot";
    add.addEventListener("click", addPart);
    bar.append(filter);
    if (!info?.readOnly) bar.appendChild(add);
    fillPartsList();
  }

  function fillPartsList() {
    const a = atlas;
    const size = sizeOf(a.slots[a.slot]);
    const list = $("partsList");
    list.replaceChildren();
    let shown = 0;
    for (const p of a.parts) {
      if (partsFilter && !p.name.toLowerCase().includes(partsFilter)) continue;
      shown++;
      const r = pixelRect(p, size);
      const row = el("div", "part" + (p.path === selected ? " selected" : ""));
      row.dataset.path = p.path;
      row.title = `${p.path}\n${r.left}, ${r.top} to ${r.right}, ${r.bottom}`;
      row.append(el("span", "name", p.name || "(unnamed)"), el("span", "size", `${r.right - r.left}×${r.bottom - r.top}`));
      row.addEventListener("click", () => void selectPart(p.path));
      list.appendChild(row);
    }
    if (shown === 0) list.appendChild(el("div", "part dim", a.parts.length ? "No part matches." : "No parts in this slot."));
  }

  /** Selects a part in the list and on the image, and shows its form, without touching the rest of the page. */
  async function selectPart(path) {
    selected = path;
    $("selected").textContent = path;
    vscode.postMessage({ type: "selected", path });
    for (const x of document.querySelectorAll("#partsList .part.selected, .stage svg g.selected")) x.classList.remove("selected");
    const row = document.querySelector(`#partsList .part[data-path="${CSS.escape(path)}"]`);
    row?.classList.add("selected");
    row?.scrollIntoView({ block: "nearest" });
    document.querySelector(`.stage svg g[data-path="${CSS.escape(path)}"]`)?.classList.add("selected");
    await renderPartForm();
  }

  /** The selected part's form: name, the rectangle in pixels with the UV it maps to, delete, open in tree. */
  async function renderPartForm() {
    const form = $("partForm");
    if (!form) return;
    const a = atlas;
    const slot = a.slots[a.slot];
    const part = a.parts.find((p) => p.path === selected);
    if (!part) {
      form.replaceChildren(el("div", "dim", a.parts.length ? "Click a rectangle, or a part on the left, to edit it." : "No parts in this slot. Use + add part on the left."));
      return;
    }
    const size = sizeOf(slot);
    const image = images.get(slot.texture);
    if (slot.texture && image && !image.error && !size) {
      form.replaceChildren(el("div", "dim", "Loading the texture…"));
      return;
    }
    const rows = [];
    const head = el("div", "toolbar");
    const openTree = el("button", "link", "open in tree");
    openTree.addEventListener("click", () => { mode = "tree"; expandTo(part.path); void render(true); });
    const del = el("button", "link", "delete part");
    del.addEventListener("click", () => apply([{ op: "remove", path: part.path }], `Delete part ${part.name}`, slot.partsPath, async () => { selected = ""; await renderAtlas(); }));
    head.append(el("span", "dim", part.path), openTree);
    if (!info?.readOnly) head.appendChild(del);
    rows.push(head);

    const nameRow = el("div", "prow");
    nameRow.append(el("span", "pname", "partName"), el("span", "ptype", "CName"));
    const nameCell = el("span", "pvalue");
    const nameValue = part.raw.partName ?? { $type: "CName", $storage: "string", $value: part.name };
    nameCell.appendChild(await leafEditor(`${part.path}.partName`, "CName", nameValue, !!info?.readOnly, null, async () => { await renderAtlas(); }));
    nameRow.appendChild(nameCell);
    rows.push(nameRow);

    const r = pixelRect(part, size);
    const f = el("div", "rectform");
    f.append(el("span", "h", ""), ...RectKeys.map((k) => el("span", "h", k)));
    f.append(el("span", "k", "pixels"));
    const inputs = {};
    for (const k of RectKeys) {
      const i = el("input");
      i.type = "text";
      i.inputMode = "numeric";
      i.value = String(r[k]);
      i.disabled = !!info?.readOnly;
      inputs[k] = i;
      f.appendChild(i);
    }
    f.append(el("span", "k", "uv"));
    const uvCells = UvKeys.map(() => el("span", "uv"));
    f.append(...uvCells);
    const showUv = (rect) => { const uv = uvOf(rect, size) ?? part.raw.uv; UvKeys.forEach((k, i) => { uvCells[i].textContent = Number(uv[k] ?? 0).toFixed(6); }); };
    const read = () => { const t = {}; for (const k of RectKeys) t[k] = Number(inputs[k].value); return t; };
    showUv(r);
    const commit = async () => {
      const next = read();
      let bad = false;
      for (const k of RectKeys) { const ok = Number.isInteger(next[k]); inputs[k].classList.toggle("bad", !ok); bad = bad || !ok; }
      if (bad || RectKeys.every((k) => next[k] === r[k])) return;
      const ops = [{ op: "replace", path: `${part.path}.clippingRectInPixels`, value: { $type: "Rect", ...next } }];
      const uv = uvOf(next, size);
      if (uv) ops.push({ op: "replace", path: `${part.path}.clippingRectInUVCoords`, value: { $type: "RectF", ...uv } });
      await apply(ops, `Set ${part.name} rectangle`, slot.partsPath, async () => { await renderAtlas(); });
    };
    for (const i of Object.values(inputs)) {
      i.addEventListener("change", commit);
      i.addEventListener("input", () => showUv(read()));
      i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void commit(); } });
    }
    rows.push(f);
    rows.push(el("div", "dim", `${r.right - r.left} × ${r.bottom - r.top} px` + (size ? "" : ". The texture size is not known, so only the pixel rectangle is written; the game reads the UV one.")));
    form.replaceChildren(...rows);
  }

  /** Appends a 64 by 64 part at the origin to the slot and selects it. */
  async function addPart() {
    const a = atlas;
    const slot = a.slots[a.slot];
    try {
      const value = await createInstance("inkTextureAtlasMapper");
      const rect = { left: 0, top: 0, right: 64, bottom: 64 };
      value.partName = { $type: "CName", $storage: "string", $value: "new_part" };
      value.clippingRectInPixels = { $type: "Rect", ...rect };
      const uv = uvOf(rect, sizeOf(slot));
      if (uv) value.clippingRectInUVCoords = { $type: "RectF", ...uv };
      const next = `${slot.partsPath}.${a.parts.length}`;
      await apply([{ op: "add", path: `${slot.partsPath}.-`, value }], "Add part", slot.partsPath, async () => {
        selected = next;
        partsFilter = "";
        await renderAtlas();
        document.querySelector("#partForm .leaf input")?.select();
      });
    } catch (e) {
      status(e.message, "error");
    }
  }

  // ---- wiring ----------------------------------------------------------------------------------
  $("json").addEventListener("click", () => vscode.postMessage({ type: "openAsJson" }));
  $("view").addEventListener("click", () => {
    mode = isSpecial() ? "tree" : home ?? "tree";
    if (mode === "tree" && selected) expandTo(selected);
    void render(true);
  });
  const searchBox = $("search");
  searchBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void runSearch(searchBox.value.trim()); }
    if (e.key === "Escape") { searchBox.value = ""; void rerender(); }
  });
  vscode.postMessage({ type: "ready" });
})();
