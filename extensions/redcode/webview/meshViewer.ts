// The 3D mesh viewer, bundled into media/mesh/viewer.js and loaded by the CR2W editor's mesh mode and
// by the .glb/.gltf viewer. It shows the glTF WolvenKit's exporter writes: one node per submesh and
// LOD, named submesh_03_LOD_1 (LOD 1 is the most detailed), each mesh's material name in its extras.
// See docs/design/view.md, V1.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface MeshSource {
  /** The bytes of a .glb. */
  data?: ArrayBuffer;
  /** A .gltf as JSON text, its buffers and images inline as data URIs. */
  json?: string;
}

interface Part {
  object: THREE.Mesh;
  submesh: number;
  lod: number;
  material: string;
  triangles: number;
  vertices: number;
}

export interface MeshView {
  dispose(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A colour per material name, stable across opens, so submeshes that share a material look alike. */
function colourFor(name: string): THREE.Color {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.35, 0.6);
}

function cssColour(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  try {
    return new THREE.Color(v || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

/** Builds the viewer into container: the canvas, a toolbar and a side list of submeshes. */
export async function mount(container: HTMLElement, source: MeshSource, title = ""): Promise<MeshView> {
  container.replaceChildren();
  container.classList.add("meshview");
  const bar = el("div", "toolbar");
  const stage = el("div", "meshstage");
  const side = el("div", "meshside");
  const note = el("div", "note", "Loading the mesh…");
  stage.appendChild(note);
  const body = el("div", "meshbody");
  body.append(stage, side);
  container.append(bar, body);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  const scene = new THREE.Scene();
  scene.background = cssColour("--vscode-editor-background", "#0d1017");
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  scene.add(sun);

  const loader = new GLTFLoader();
  let gltf;
  try {
    const input = source.data ?? source.json;
    if (input === undefined) throw new Error("no mesh data");
    gltf = await loader.parseAsync(input, "");
  } catch (e) {
    note.textContent = `Could not read the mesh: ${e instanceof Error ? e.message : String(e)}`;
    return { dispose: () => renderer.dispose() };
  }
  note.remove();
  stage.appendChild(renderer.domElement);

  // Cyberpunk is Z-up; glTF and three.js are Y-up. WolvenKit's exporter writes Y-up already.
  const root = gltf.scene;
  scene.add(root);
  const parts: Part[] = [];
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = /submesh_(\d+)_LOD_(\d+)/i.exec(mesh.name || mesh.parent?.name || "");
    const extras = (mesh.userData ?? {}) as { materialNames?: string[] };
    const material = extras.materialNames?.[0] ?? (Array.isArray(mesh.material) ? "default" : mesh.material.name || "default");
    if (!materials.has(material)) materials.set(material, new THREE.MeshStandardMaterial({ color: colourFor(material), roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide }));
    mesh.material = materials.get(material)!;
    const geometry = mesh.geometry;
    const vertices = geometry.attributes.position?.count ?? 0;
    const triangles = geometry.index ? geometry.index.count / 3 : vertices / 3;
    parts.push({ object: mesh, submesh: m ? Number(m[1]) : parts.length, lod: m ? Number(m[2]) : 1, material, triangles, vertices });
  });

  const lods = [...new Set(parts.map((p) => p.lod))].sort((a, b) => a - b);
  let lod = lods[0] ?? 1;
  const hidden = new Set<number>();
  const bounds = new THREE.Box3Helper(new THREE.Box3(), 0xfcee0a);
  bounds.visible = false;
  scene.add(bounds);
  const grid = new THREE.GridHelper(1, 10, 0x2a3346, 0x1a2030);
  scene.add(grid);
  const stats = el("span", "dim");

  const visible = () => parts.filter((p) => p.lod === lod && !hidden.has(p.submesh));
  const apply = () => {
    for (const p of parts) p.object.visible = p.lod === lod && !hidden.has(p.submesh);
    const shown = visible();
    const box = new THREE.Box3();
    for (const p of shown) box.expandByObject(p.object);
    bounds.box.copy(box);
    const size = box.getSize(new THREE.Vector3());
    const tris = shown.reduce((n, p) => n + p.triangles, 0);
    const verts = shown.reduce((n, p) => n + p.vertices, 0);
    stats.textContent = `${shown.length} submesh${shown.length === 1 ? "" : "es"} · ${Math.round(tris).toLocaleString()} triangles · ${verts.toLocaleString()} vertices · ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`;
  };

  const frame = () => {
    const box = new THREE.Box3();
    for (const p of visible()) box.expandByObject(p.object);
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
    const distance = radius / Math.sin((camera.fov * Math.PI) / 360);
    camera.near = Math.max(0.001, distance / 1000);
    camera.far = distance * 100;
    camera.position.copy(centre).add(new THREE.Vector3(1, 0.6, 1).normalize().multiplyScalar(distance));
    camera.updateProjectionMatrix();
    controls.target.copy(centre);
    sun.position.copy(camera.position);
    const floor = Math.pow(10, Math.ceil(Math.log10(radius * 4)));
    grid.scale.setScalar(floor);
    grid.position.set(centre.x, box.min.y, centre.z);
    controls.update();
  };

  // Toolbar: LOD, wireframe, bounds, grid, frame.
  if (title) bar.appendChild(el("span", "name", title));
  if (lods.length > 1) {
    const pick = el("select");
    for (const l of lods) {
      const o = el("option", "", `LOD ${l}${l === lods[0] ? " (most detail)" : ""}`);
      o.value = String(l);
      pick.appendChild(o);
    }
    pick.addEventListener("change", () => { lod = Number(pick.value); renderSide(); apply(); });
    bar.appendChild(pick);
  }
  const toggle = (label: string, initial: boolean, onChange: (on: boolean) => void, tip: string) => {
    const b = el("button", initial ? "on" : "", label);
    b.title = tip;
    let on = initial;
    b.addEventListener("click", () => { on = !on; b.classList.toggle("on", on); onChange(on); });
    bar.appendChild(b);
  };
  toggle("Wireframe", false, (on) => { for (const m of materials.values()) m.wireframe = on; }, "Show the triangles");
  toggle("Bounds", false, (on) => { bounds.visible = on; }, "The box around what is shown");
  toggle("Grid", true, (on) => { grid.visible = on; }, "A ground grid, one metre per line at this scale");
  const fit = el("button", "", "Frame");
  fit.title = "Fit the view to what is shown";
  fit.addEventListener("click", frame);
  bar.append(fit, stats);

  // Side list: the submeshes of the current LOD, with their material and counts.
  const renderSide = () => {
    side.replaceChildren(el("div", "label", "Submeshes"));
    for (const p of parts.filter((x) => x.lod === lod).sort((a, b) => a.submesh - b.submesh)) {
      const row = el("label", "part");
      const box = el("input");
      box.type = "checkbox";
      box.checked = !hidden.has(p.submesh);
      box.addEventListener("change", () => { if (box.checked) hidden.delete(p.submesh); else hidden.add(p.submesh); apply(); });
      const swatch = el("span", "swatch");
      swatch.style.background = `#${colourFor(p.material).getHexString()}`;
      row.append(box, swatch, el("span", "name", `${p.submesh}  ${p.material}`), el("span", "size", `${Math.round(p.triangles).toLocaleString()} tris`));
      row.title = `${p.object.name}\n${p.material}`;
      side.appendChild(row);
    }
  };

  renderSide();
  apply();
  const resize = () => {
    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();
  frame();
  let running = true;
  const tick = () => {
    if (!running) return;
    controls.update();
    sun.position.copy(camera.position);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();
  return {
    dispose: () => {
      running = false;
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      for (const m of materials.values()) m.dispose();
    },
  };
}

// Exposed for the plain scripts that host the viewer (the CR2W editor page and the glTF viewer page).
(window as unknown as { REDcodeMesh: { mount: typeof mount } }).REDcodeMesh = { mount };
