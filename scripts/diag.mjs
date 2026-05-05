import { WebSocket } from "ws";
const tabs = await fetch("http://localhost:9222/json").then((r) => r.json());
const tab = tabs.find((t) => t.type === "page") || tabs[0];
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 1;
const inflight = new Map();
function send(m, p = {}) {
  return new Promise((res, rej) => {
    const i = id++;
    inflight.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
}
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id && inflight.has(m.id)) {
    const { res, rej } = inflight.get(m.id);
    inflight.delete(m.id);
    if (m.error) rej(new Error(JSON.stringify(m.error)));
    else res(m.result);
  }
});
await new Promise((r) => ws.once("open", r));
await send("Runtime.enable");
const r = await send("Runtime.evaluate", {
  expression: `(() => ({
    readyState: document.readyState,
    cesiumLoaded: typeof Cesium !== 'undefined',
    cesiumVer: typeof Cesium !== 'undefined' ? Cesium.VERSION : null,
    viewerExposed: typeof window.__viewer__ !== 'undefined',
    appliedBasemap: window.__currentBasemap__,
    mapDivChildren: document.getElementById('map')?.children.length,
    scripts: [...document.querySelectorAll('script')].map(s => ({src: s.src || '(inline)', readyState: s.readyState})),
    loadingText: document.getElementById('loading')?.textContent,
    cesiumViewer: !!document.querySelector('.cesium-viewer'),
    helpBtn: !!document.getElementById('help-3d-btn'),
    exagSlider: !!document.getElementById('exaggeration'),
  }))()`,
  returnByValue: true,
});
console.log(JSON.stringify(r.result.value, null, 2));
ws.close();
