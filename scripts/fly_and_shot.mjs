// Navigate to 3D page, wait for boot, fly camera to a target, then screenshot.
import { WebSocket } from "ws";
import { writeFileSync } from "node:fs";

const TARGETS = {
  tilden:   { lon: -122.243, lat: 37.890, alt: 1500, pitch: -50, heading: 30 },
  bay:      { lon: -122.2,   lat: 37.6,   alt: 65000, pitch: -55, heading: 0 },
  hamilton: { lon: -121.6429, lat: 37.34, alt: 5000, pitch: -55, heading: 0 },
  wildcat:  { lon: -122.232, lat: 37.898, alt: 2200, pitch: -45, heading: 90 },
  oakland:  { lon: -122.18,  lat: 37.83,  alt: 8000, pitch: -50, heading: 0 },
};
const which = process.env.SHOT_TARGET || "tilden";
const t = TARGETS[which];

const tabs = await fetch("http://localhost:9222/json").then((r) => r.json());
const tab = tabs.find((x) => x.type === "page") || tabs[0];
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 1;
const inflight = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const i = id++;
    inflight.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id && inflight.has(m.id)) {
    const { resolve, reject } = inflight.get(m.id);
    inflight.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else resolve(m.result);
  }
});
await new Promise((r) => ws.once("open", r));

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
});

const url = process.env.SHOT_URL || "http://localhost:8765/3d.html?v=" + Date.now();
await send("Page.navigate", { url });
await new Promise((r) => setTimeout(r, 14000));

// Fly camera using the exposed viewer
const flyResult = await send("Runtime.evaluate", {
  expression: `(async () => {
    const v = window.__viewer__;
    if (!v) return { error: 'viewer not exposed' };
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(${t.lon}, ${t.lat}, ${t.alt}),
      orientation: {
        heading: Cesium.Math.toRadians(${t.heading}),
        pitch: Cesium.Math.toRadians(${t.pitch}),
        roll: 0,
      },
      duration: 0,
    });
    // Wait for terrain tiles to load before shooting
    await new Promise(r => setTimeout(r, 4000));
    return { ok: true, target: '${which}' };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log("fly:", JSON.stringify(flyResult.result.value));

// Wait a bit more for tiles to settle
await new Promise((r) => setTimeout(r, 3000));

const out = await send("Page.captureScreenshot", { format: "png" });
const path = process.env.SHOT_PATH || `shot-${which}.png`;
writeFileSync(path, Buffer.from(out.data, "base64"));
console.log("wrote", path);
ws.close();
