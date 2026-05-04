// Navigate headless Chrome to http://localhost:8765/ and capture console
// + page errors + a few state probes from the running app. Used as a self-
// check while iterating on the 3D Cesium build.
//
// Usage: node scripts/check_3d.mjs
// Prereq: headless Chrome must already be running with --remote-debugging-port=9222

import { WebSocket } from "ws";

const CDP_URL = "http://localhost:9222/json";
const TARGET_URL = process.env.PROBE_URL || "http://localhost:8765/";
const WAIT_MS = parseInt(process.env.PROBE_WAIT_MS || "10000", 10);

const tabs = await fetch(CDP_URL).then((r) => r.json());
// Reuse the existing about:blank tab so we don't accumulate
const tab = tabs.find((t) => t.type === "page") || tabs[0];
if (!tab) {
  console.error("No CDP target found");
  process.exit(1);
}
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let nextId = 1;
const inflight = new Map();
const consoleMsgs = [];
const exceptions = [];
const requestFails = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    inflight.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id && inflight.has(msg.id)) {
    const { resolve, reject } = inflight.get(msg.id);
    inflight.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? a.subtype ?? "[object]").join(" ");
    consoleMsgs.push({ type: msg.params.type, text: args });
  } else if (msg.method === "Runtime.exceptionThrown") {
    const e = msg.params.exceptionDetails;
    exceptions.push({
      text: e.text,
      url: e.url,
      line: e.lineNumber,
      col: e.columnNumber,
      desc: e.exception?.description,
    });
  } else if (msg.method === "Network.loadingFailed") {
    requestFails.push({
      url: msg.params.requestId, // we'll join with Network.requestWillBeSent below
      reason: msg.params.errorText,
      type: msg.params.type,
    });
  }
});

await new Promise((r) => ws.once("open", r));

// Enable domains
await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");

// Navigate
await send("Page.navigate", { url: TARGET_URL });
await new Promise((r) => setTimeout(r, WAIT_MS));

// Probe app state
const probe = await send("Runtime.evaluate", {
  expression: `(() => {
    const out = {
      hasViewer: typeof Cesium !== 'undefined',
      cesiumVersion: typeof Cesium !== 'undefined' ? Cesium.VERSION : null,
      mapEl: !!document.getElementById('map'),
      routeCardCount: document.querySelectorAll('.route-card').length,
      loadingHidden: document.getElementById('loading')?.classList.contains('hidden'),
      loadingText: document.getElementById('loading')?.textContent,
      sidebarTitle: document.querySelector('.sidebar-header h1')?.textContent,
    };
    // Try to discover any Cesium entities the app added
    try {
      // The IIFE keeps viewer private; reach in via the canvas's parent
      const widget = document.querySelector('.cesium-viewer');
      out.hasCesiumWidget = !!widget;
      const canvases = document.querySelectorAll('.cesium-widget canvas');
      out.cesiumCanvasCount = canvases.length;
    } catch (e) {
      out.cesiumProbeError = String(e);
    }
    return out;
  })()`,
  returnByValue: true,
});

console.log("=== Probe ===");
console.log(JSON.stringify(probe.result.value, null, 2));

console.log("\n=== Console (" + consoleMsgs.length + ") ===");
for (const m of consoleMsgs.slice(0, 60)) {
  console.log(`[${m.type}] ${m.text}`);
}
if (consoleMsgs.length > 60) console.log(`... +${consoleMsgs.length - 60} more`);

console.log("\n=== Exceptions (" + exceptions.length + ") ===");
for (const e of exceptions) {
  console.log(`! ${e.text} ${e.url}:${e.line}:${e.col}`);
  if (e.desc) console.log("  " + e.desc.split("\n").slice(0, 5).join("\n  "));
}

console.log("\n=== Network failures (" + requestFails.length + ") ===");
for (const f of requestFails.slice(0, 20)) console.log(JSON.stringify(f));

ws.close();
process.exit(exceptions.length === 0 && consoleMsgs.filter(m => m.type === "error").length === 0 ? 0 : 1);
