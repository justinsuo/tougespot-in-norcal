// Take a screenshot of the running 3D page so we can verify visuals
import { WebSocket } from "ws";
import { writeFileSync } from "node:fs";

const tabs = await fetch("http://localhost:9222/json").then((r) => r.json());
const tab = tabs.find((t) => t.type === "page") || tabs[0];
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

const target = process.env.SHOT_URL || "http://localhost:8765/3d.html";
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: target });
await new Promise((r) => setTimeout(r, parseInt(process.env.SHOT_WAIT_MS || "15000", 10)));

const out = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
const path = process.env.SHOT_PATH || "screenshot.png";
writeFileSync(path, Buffer.from(out.data, "base64"));
console.log("wrote", path, Buffer.from(out.data, "base64").length, "bytes");
ws.close();
