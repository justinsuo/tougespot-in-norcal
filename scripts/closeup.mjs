import { WebSocket } from "ws";
import { writeFileSync } from "node:fs";

const lon = parseFloat(process.env.LON || "-122.243");
const lat = parseFloat(process.env.LAT || "37.889");
const alt = parseFloat(process.env.ALT || "600");
const heading = parseFloat(process.env.HEADING || "45");
const pitch = parseFloat(process.env.PITCH || "-40");
const out = process.env.OUT || "C:/Users/clip0/AppData/Local/Temp/tilden_tmp/closeup.png";

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
ws.on("message", (r) => {
  const m = JSON.parse(r);
  if (m.id && inflight.has(m.id)) {
    const { res, rej } = inflight.get(m.id);
    inflight.delete(m.id);
    if (m.error) rej(new Error(JSON.stringify(m.error)));
    else res(m.result);
  }
});
await new Promise((r) => ws.once("open", r));
await send("Runtime.enable");
await send("Runtime.evaluate", {
  expression: `(async () => {
    const v = window.__viewer__;
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(${lon}, ${lat}, ${alt}),
      orientation: { heading: Cesium.Math.toRadians(${heading}), pitch: Cesium.Math.toRadians(${pitch}), roll: 0 },
      duration: 0,
    });
    await new Promise(r => setTimeout(r, 5000));
    return { ok: true };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
await new Promise((r) => setTimeout(r, 2500));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("wrote", out);
ws.close();
