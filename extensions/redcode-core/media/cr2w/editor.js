// The CR2W editor page. Talks only to the extension (see cr2wEditor.ts), which forwards to the bridge.
// State: nodes fetched so far, the selected path, and the types described so far.
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
    if (active && active !== document.body && $("grid").contains(active)) {
      active.blur();
    }
    await Promise.allSettled([...inflight]);
    vscode.postMessage({ type: "flushed", id });
  }
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
    } else if (m.type === "flush") {
      void flush(m.id);
    } else if (m.type === "error") {
      $("file").textContent = "Could not open the file";
      status(m.error, "error");
      $("grid").replaceChildren(el("div", "error", m.error));
    }
  });

  const getNode = (path, offset = 0, limit = 200) => request("getNode", { path, offset, limit });
  const describeType = (name) => request("describeType", { name });
  const createInstance = (name) => request("createInstance", { name });
  const patch = (ops, label) => request("patch", { ops, label });

  // ---- state -------------------------------------------------------------------------------
  const nodes = new Map();      // path -> NodeInfo (arrays: children of the pages loaded so far)
  const types = new Map();      // red type name -> TypeDescription
  let info = null;
  let selected = "";
  const expanded = new Set([""]);

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
    $("size").textContent = `${m.info.bytes.toLocaleString()} B` + (m.info.embeddedFiles ? `, ${m.info.embeddedFiles} embedded` : "");
    document.title = m.file;
    await reloadAll("open");
  }

  async function reloadAll(reason) {
    nodes.clear();
    try {
      await fetchNode("");
      renderTree();
      await select(selected, true);
      status(reason === "open" ? "" : `Reloaded after ${reason}`);
    } catch (e) {
      status(e.message, "error");
    }
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
      await refreshTreeRow(li, parentPath, child);
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
      const more = el("li", "more", `${n.total - n.children.length} more`);
      more.addEventListener("click", async (e) => { e.stopPropagation(); await fetchNode(path, true); const li = ul.parentElement; if (li) li.replaceChild(childList(path), ul); });
      ul.appendChild(more);
    }
    return ul;
  }

  async function refreshTreeRow(li, parentPath, child) {
    li.replaceWith(treeRow(parentPath, child));
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

  // ---- selection and the property grid -------------------------------------------------------
  async function select(path, force = false) {
    if (path === selected && !force) return;
    selected = path;
    for (const r of document.querySelectorAll("#tree .row.selected")) r.classList.remove("selected");
    const li = document.querySelector(`li[data-path="${CSS.escape(path)}"]`);
    li?.querySelector(":scope > .row")?.classList.add("selected");
    $("selected").textContent = path || "(root)";
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
    const readOnly = isCompiled(selected);
    if (readOnly) {
      rows.push(el("div", "banner", "compiledData is rebuilt from components when the file is saved. Edits here do not survive; edit the matching component under components."));
    }
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
    if (seq !== renderSeq) return;
    $("propsLabel").textContent = selected ? `${selected}  ·  ${n.type}` : `${n.type}`;
    grid.replaceChildren(...rows);
  }

  async function propertyRow(parentPath, c, pdesc, readOnly) {
    const path = join(parentPath, c.name);
    const row = el("div", "prow");
    row.append(el("span", "pname", c.name), el("span", "ptype", c.type));
    const cell = el("span", "pvalue");
    row.appendChild(cell);
    const open = () => { const b = el("button", "link", "open"); b.addEventListener("click", () => { expandTo(path); void select(path); }); return b; };
    switch (c.kind) {
      case "value": {
        const n = await fetchNode(path);
        cell.appendChild(await leafEditor(path, c.type, n.value, readOnly, pdesc));
        break;
      }
      case "null":
        cell.appendChild(el("span", "dim", "null"));
        break;
      case "class": {
        const n = await fetchNode(path);
        if (n.value && typeof n.value === "object" && n.children.every((x) => x.kind === "value" || x.kind === "null")) {
          const sub = el("div", "struct");
          for (const x of n.children) {
            const srow = el("div", "srow");
            srow.append(el("span", "sname", x.name));
            srow.appendChild(await leafEditor(join(path, x.name), x.type, n.value[x.name], readOnly));
            sub.appendChild(srow);
          }
          cell.appendChild(sub);
        } else {
          cell.append(el("span", "dim", c.preview), open());
        }
        break;
      }
      case "array": {
        cell.append(el("span", "dim", `${c.count ?? 0} items`), open());
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
      const item = await fetchNode(path);
      cell.appendChild(await leafEditor(path, c.type, item.value, readOnly));
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
        let elementType = desc.elementType;
        if (!elementType) throw new Error(`Cannot tell the element type of ${arrayType}`);
        if (elementType.startsWith("handle:")) {
          // A handle needs a concrete class. Ask for one, defaulting to the declared type.
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
      const inner = desc?.elementType ?? "";
      const chosen = window.prompt("Class for the new object:", inner);
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
  async function leafEditor(path, type, value, readOnly, pdesc) {
    const wrap = el("span", "leaf");
    const isWrapped = value !== null && typeof value === "object" && "$value" in value;
    const shown = isWrapped ? value.$value : value;
    const desc = pdesc ?? (await typeOf(type).catch(() => null));
    const commit = async (newShown) => {
      const newValue = isWrapped ? { ...value, $value: newShown } : newShown;
      await apply([{ op: "replace", path, value: newValue }], `Set ${path}`, path, true);
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
    return wrap;
  }

  // ---- applying edits ------------------------------------------------------------------------
  async function apply(ops, label, refreshPath) {
    try {
      status("…");
      await patch(ops, label);
      status(label);
      nodes.delete(refreshPath);
      await renderGrid();
      await refreshTreeFrom(refreshPath || ops[0].path);
    } catch (e) {
      status(e.message, "error");
      await renderGrid();
    }
  }

  function expandTo(path) {
    const parts = path.split(".");
    let p = "";
    for (const part of parts) { p = join(p, part); expanded.add(p); }
    renderTree();
  }

  $("json").addEventListener("click", () => vscode.postMessage({ type: "openAsJson" }));
  vscode.postMessage({ type: "ready" });
})();
