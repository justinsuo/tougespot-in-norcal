// NorCal Touge Spots — main app
// Loads routes.json, fetches actual road geometry via OSRM, renders an interactive map.

(function () {
  "use strict";

  const VALHALLA_URL = "https://valhalla1.openstreetmap.de/route";
  const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
  const CACHE_KEY = "tougespot_route_cache_v1";
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

  const RATING_COLORS = {
    5.0: "#16a34a",
    4.5: "#84cc16",
    4.0: "#eab308",
    3.5: "#f97316",
    3.0: "#ef4444",
  };

  function colorForRating(r) {
    if (r >= 5) return RATING_COLORS[5.0];
    if (r >= 4.5) return RATING_COLORS[4.5];
    if (r >= 4) return RATING_COLORS[4.0];
    if (r >= 3.5) return RATING_COLORS[3.5];
    return RATING_COLORS[3.0];
  }

  function ratingClass(r) {
    if (r >= 5) return "r-5";
    if (r >= 4.5) return "r-45";
    if (r >= 4) return "r-4";
    if (r >= 3.5) return "r-35";
    return "r-3";
  }

  function metersToMiles(m) { return m * 0.000621371; }
  function secondsToMin(s) { return s / 60; }

  function fmtDistance(m) {
    const mi = metersToMiles(m);
    return mi >= 10 ? `${mi.toFixed(0)} mi` : `${mi.toFixed(1)} mi`;
  }
  function fmtDuration(s) {
    const min = secondsToMin(s);
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
  }

  function getCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (Date.now() - (parsed._ts || 0) > CACHE_TTL_MS) return {};
      return parsed;
    } catch { return {}; }
  }
  function setCache(cache) {
    cache._ts = Date.now();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
  }

  // Decode Valhalla polyline6 (precision 1e-6) into [lon, lat] pairs.
  function decodePolyline6(str) {
    const coords = [];
    let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      let result = 0, shift = 0, b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      result = 0; shift = 0;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      coords.push([lng / 1e6, lat / 1e6]);
    }
    return coords;
  }

  async function fetchValhalla(waypoints) {
    const body = {
      locations: waypoints.map(([lat, lon]) => ({ lat, lon })),
      costing: "auto",
      directions_options: { units: "miles" },
    };
    const res = await fetch(VALHALLA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Valhalla ${res.status}`);
    const json = await res.json();
    const trip = json.trip;
    if (!trip || !trip.legs || !trip.legs.length) throw new Error("no route");
    const coords = [];
    let duration = 0, lengthM = 0;
    for (const leg of trip.legs) {
      let pts = decodePolyline6(leg.shape);
      if (coords.length && pts.length) pts = pts.slice(1);
      coords.push(...pts);
      duration += leg.summary?.time || 0;
      lengthM += (leg.summary?.length || 0) * 1609.344;
    }
    return {
      geometry: { type: "LineString", coordinates: coords },
      distance: lengthM,
      duration,
    };
  }

  async function fetchOSRM(waypoints) {
    const coordStr = waypoints.map(([lat, lon]) => `${lon},${lat}`).join(";");
    const url = `${OSRM_BASE}/${coordStr}?overview=full&geometries=geojson&steps=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const json = await res.json();
    if (!json.routes || !json.routes.length) throw new Error("no route");
    const r = json.routes[0];
    return {
      geometry: r.geometry,
      distance: r.distance,
      duration: r.duration,
    };
  }

  async function fetchLiveRoute(waypoints, cacheKey) {
    const cache = getCache();
    if (cache[cacheKey]) return cache[cacheKey];
    let data;
    try {
      data = await fetchValhalla(waypoints);
    } catch (e) {
      console.warn("Valhalla failed, trying OSRM:", e);
      data = await fetchOSRM(waypoints);
    }
    cache[cacheKey] = data;
    setCache(cache);
    return data;
  }

  // ─── App state ──────────────────────────────────────────────
  let map;
  let routesData = null;
  let routeLayers = {}; // id -> { polyline, marker, route, geom }
  let activeId = null;
  let heatLayer = null;
  let heatVisible = false;
  let filters = { rating: 0, region: "all" };

  // ─── Map init ───────────────────────────────────────────────
  function initMap() {
    map = L.map("map", {
      center: [37.8, -122.2],
      zoom: 8,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a>',
      }
    ).addTo(map);

    // Origin marker (UC Berkeley)
    const origin = L.divIcon({
      className: "origin-pin",
      html: '<div style="background:#fff;color:#0b1015;border:2px solid #0b1015;border-radius:50%;width:18px;height:18px;display:grid;place-items:center;font-size:10px;font-weight:700;">B</div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    L.marker([37.8719, -122.2585], { icon: origin, zIndexOffset: 1000 })
      .bindPopup("<strong>UC Berkeley</strong>Origin point — drive times measured from here.")
      .addTo(map);
  }

  // ─── Route rendering ────────────────────────────────────────
  async function loadRoutes() {
    const res = await fetch("routes.json");
    if (!res.ok) throw new Error(`routes.json ${res.status}`);
    routesData = await res.json();

    const loading = document.getElementById("loading");
    let pendingTrace = [];

    for (const route of routesData.routes) {
      if (route.geometry && route.geometry.coordinates && route.geometry.coordinates.length) {
        // Precomputed geometry baked at build time — preferred path.
        route._geom = route.geometry;
        route._distance = route.length_m || 0;
        route._duration = route.duration_s || 0;
        route._fromBerkeley = route.from_origin_s || 0;
        renderRouteOnMap(route);
      } else {
        pendingTrace.push(route);
      }
    }

    // For any route missing precomputed geometry (e.g. just-added contributions),
    // fall back to live routing. We try Valhalla first, OSRM as backup.
    if (pendingTrace.length) {
      loading.textContent = `Tracing ${pendingTrace.length} new road${pendingTrace.length > 1 ? "s" : ""}…`;
      let done = 0;
      const concurrency = 2;
      const queue = [...pendingTrace];
      const workers = Array.from({ length: concurrency }, () => worker());
      async function worker() {
        while (queue.length) {
          const route = queue.shift();
          try {
            const cacheKey = `${route.id}_${JSON.stringify(route.waypoints)}`;
            const result = await fetchLiveRoute(route.waypoints, cacheKey);
            route._geom = result.geometry;
            route._distance = result.distance;
            route._duration = result.duration;
          } catch (err) {
            console.warn("Live routing failed for", route.id, err);
            route._geom = {
              type: "LineString",
              coordinates: route.waypoints.map(([lat, lon]) => [lon, lat]),
            };
          }
          renderRouteOnMap(route);

          // Drive time from Berkeley
          try {
            const origin = routesData.metadata.origin;
            const result = await fetchLiveRoute(
              [[origin.lat, origin.lon], route.waypoints[0]],
              `from_berkeley_${route.id}`
            );
            route._fromBerkeley = result.duration;
          } catch {
            const d = haversine(
              routesData.metadata.origin.lat,
              routesData.metadata.origin.lon,
              route.waypoints[0][0],
              route.waypoints[0][1]
            );
            route._fromBerkeley = (d / 1000) * 72;
          }

          done += 1;
          loading.textContent = `Tracing roads… ${done}/${pendingTrace.length}`;
        }
      }
      await Promise.all(workers);
    }

    renderRouteList();
    fitMapToVisibleRoutes();
    loading.classList.add("hidden");
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function renderRouteOnMap(route) {
    const color = colorForRating(route.rating);
    const coords = route._geom.coordinates.map(([lon, lat]) => [lat, lon]);

    const polyline = L.polyline(coords, {
      color,
      weight: 5,
      opacity: 0.85,
      lineJoin: "round",
      lineCap: "round",
    }).addTo(map);

    polyline.on("click", () => openDetail(route.id));
    polyline.on("mouseover", () => polyline.setStyle({ weight: 7, opacity: 1 }));
    polyline.on("mouseout", () => {
      if (activeId !== route.id)
        polyline.setStyle({ weight: 5, opacity: 0.85 });
    });

    // Marker at the midpoint of the route for label
    const midIdx = Math.floor(coords.length / 2);
    const midLatLon = coords[midIdx];
    const startLatLon = coords[0];

    const startIcon = L.divIcon({
      className: "route-pin",
      html: `<div style="background:${color};color:#0b1015;border:2px solid #0b1015;border-radius:50%;width:22px;height:22px;display:grid;place-items:center;font-size:10px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.5);">${route.rating.toString().replace(".0", "")}</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const marker = L.marker(startLatLon, { icon: startIcon }).addTo(map);

    const popupHtml = `
      <strong>${route.name}</strong>
      <div style="color:#8b96a3;font-size:11px;margin-bottom:6px;">${route.region} · ${route.rating}/5</div>
      <a href="#" data-route="${route.id}" class="popup-link">View details →</a>
    `;
    marker.bindPopup(popupHtml);
    marker.on("popupopen", (e) => {
      const link = e.popup.getElement().querySelector(".popup-link");
      if (link) {
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          openDetail(route.id);
          map.closePopup();
        });
      }
    });
    marker.on("click", () => marker.openPopup());

    routeLayers[route.id] = { polyline, marker, route };
  }

  function fitMapToVisibleRoutes() {
    const visible = visibleRoutes();
    if (!visible.length) return;
    const coords = [];
    visible.forEach((r) => {
      const layer = routeLayers[r.id];
      if (layer && layer.polyline) {
        coords.push(...layer.polyline.getLatLngs());
      }
    });
    if (coords.length) {
      const bounds = L.latLngBounds(coords);
      map.fitBounds(bounds, { padding: [60, 60] });
    }
  }

  // ─── Sidebar list ───────────────────────────────────────────
  function visibleRoutes() {
    if (!routesData) return [];
    return routesData.routes.filter(
      (r) =>
        r.rating >= filters.rating &&
        (filters.region === "all" || r.region === filters.region)
    );
  }

  function renderRouteList() {
    const container = document.getElementById("route-list");
    container.innerHTML = "";
    const sorted = visibleRoutes().sort((a, b) => b.rating - a.rating);
    if (!sorted.length) {
      container.innerHTML =
        '<p style="color:var(--text-dim);font-size:12px;padding:12px;text-align:center;">No routes match these filters.</p>';
      return;
    }
    for (const r of sorted) {
      const card = document.createElement("div");
      card.className = `route-card ${ratingClass(r.rating)}`;
      card.dataset.id = r.id;
      if (r.id === activeId) card.classList.add("active");

      const distStr = r._distance ? fmtDistance(r._distance) : "—";
      const fromB = r._fromBerkeley ? fmtDuration(r._fromBerkeley) : "—";

      card.innerHTML = `
        <div class="row">
          <h3 class="name">${r.name}</h3>
          <span class="rating">${r.rating}</span>
        </div>
        <div class="meta">
          <span>📍 ${r.region}</span>
          <span>↔ ${distStr}</span>
          <span>🚗 ${fromB} from Berkeley</span>
        </div>
      `;
      card.addEventListener("click", () => openDetail(r.id));
      container.appendChild(card);
    }
  }

  // ─── Detail panel ───────────────────────────────────────────
  function openDetail(id) {
    const route = routesData.routes.find((r) => r.id === id);
    if (!route) return;
    activeId = id;

    // Highlight on map
    Object.entries(routeLayers).forEach(([rid, layer]) => {
      if (rid === id) {
        layer.polyline.setStyle({ weight: 8, opacity: 1 });
        layer.polyline.bringToFront();
      } else {
        layer.polyline.setStyle({ weight: 4, opacity: 0.4 });
      }
    });

    // Pan to route
    const layer = routeLayers[id];
    if (layer && layer.polyline) {
      map.fitBounds(layer.polyline.getBounds(), { padding: [80, 80] });
    }

    // Update sidebar active
    document
      .querySelectorAll(".route-card")
      .forEach((c) => c.classList.toggle("active", c.dataset.id === id));

    // Render detail
    const body = document.getElementById("detail-body");
    const photoBlock = route.photo_url
      ? `<img class="detail-photo" src="${route.photo_url}" alt="${route.name}" onerror="this.style.display='none'" /><div class="photo-credit">${route.photo_credit || ""}</div>`
      : `<div class="detail-photo-placeholder"></div>`;

    body.innerHTML = `
      ${photoBlock}
      <div class="detail-content">
        <h2>${route.name}</h2>
        <div class="detail-rating-row">
          <span class="detail-rating" style="color:${colorForRating(route.rating)};">${route.rating}/5</span>
          <span>·</span>
          <span>${route.region}</span>
          <span>·</span>
          <span>${route.surface}</span>
        </div>
        <div class="detail-stats">
          <div>
            <div class="detail-stat-label">Length</div>
            <div class="detail-stat-val">${route._distance ? fmtDistance(route._distance) : "—"}</div>
          </div>
          <div>
            <div class="detail-stat-label">Drive time</div>
            <div class="detail-stat-val">${route._duration ? fmtDuration(route._duration) : "—"}</div>
          </div>
          <div>
            <div class="detail-stat-label">From Berkeley</div>
            <div class="detail-stat-val">${route._fromBerkeley ? fmtDuration(route._fromBerkeley) : "—"}</div>
          </div>
          <div>
            <div class="detail-stat-label">Round trip</div>
            <div class="detail-stat-val">${route._fromBerkeley && route._duration ? fmtDuration(2 * route._fromBerkeley + route._duration) : "—"}</div>
          </div>
        </div>
        <div class="detail-section">
          <h3>The road</h3>
          <p>${route.summary}</p>
        </div>
        <div class="detail-section">
          <h3>Best time</h3>
          <p>${route.best_time}</p>
        </div>
        <div class="detail-section">
          <h3>Watch out for</h3>
          <p>${route.watchouts}</p>
        </div>
        <div class="detail-actions">
          <a class="btn" href="${route.google_maps_url}" target="_blank" rel="noopener">Directions ↗</a>
          <button class="btn secondary" id="detail-close-btn">Close</button>
        </div>
      </div>
    `;

    document.getElementById("detail-panel").classList.add("open");
    document.getElementById("detail-panel").setAttribute("aria-hidden", "false");
    document
      .getElementById("detail-close-btn")
      .addEventListener("click", closeDetail);
  }

  function closeDetail() {
    activeId = null;
    document.getElementById("detail-panel").classList.remove("open");
    document.getElementById("detail-panel").setAttribute("aria-hidden", "true");
    Object.values(routeLayers).forEach((layer) => {
      layer.polyline.setStyle({ weight: 5, opacity: 0.85 });
    });
    document
      .querySelectorAll(".route-card")
      .forEach((c) => c.classList.remove("active"));
  }

  // ─── Filter wiring ──────────────────────────────────────────
  function wireFilters() {
    document.querySelectorAll("#rating-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document
          .querySelectorAll("#rating-chips .chip")
          .forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        filters.rating = parseFloat(chip.dataset.rating);
        applyFilters();
      });
    });
    document.querySelectorAll("#region-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document
          .querySelectorAll("#region-chips .chip")
          .forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        filters.region = chip.dataset.region;
        applyFilters();
      });
    });
  }

  function applyFilters() {
    const visibleIds = new Set(visibleRoutes().map((r) => r.id));
    Object.entries(routeLayers).forEach(([id, layer]) => {
      const shouldShow = visibleIds.has(id);
      if (shouldShow) {
        if (!map.hasLayer(layer.polyline)) layer.polyline.addTo(map);
        if (!map.hasLayer(layer.marker)) layer.marker.addTo(map);
      } else {
        if (map.hasLayer(layer.polyline)) map.removeLayer(layer.polyline);
        if (map.hasLayer(layer.marker)) map.removeLayer(layer.marker);
      }
    });
    renderRouteList();
    fitMapToVisibleRoutes();
  }

  // ─── Heatmap (personal runs) ────────────────────────────────
  async function loadHeatmap() {
    if (heatLayer) return heatLayer;
    try {
      const res = await fetch("gpx/runs.json");
      if (!res.ok) throw new Error("no runs.json");
      const json = await res.json();
      const points = (json.points || []).map((p) =>
        Array.isArray(p) ? [p[0], p[1], p[2] || 0.5] : [p.lat, p.lon, p.intensity || 0.5]
      );
      if (!points.length) throw new Error("empty");
      heatLayer = L.heatLayer(points, {
        radius: 18,
        blur: 22,
        maxZoom: 13,
        gradient: {
          0.2: "#1e3a8a",
          0.4: "#3b82f6",
          0.6: "#f97316",
          0.8: "#ef4444",
          1.0: "#fff7ed",
        },
      });
      return heatLayer;
    } catch (e) {
      console.warn("Heatmap data unavailable:", e);
      return null;
    }
  }

  async function toggleHeatmap() {
    const btn = document.getElementById("toggle-heatmap");
    if (heatVisible) {
      if (heatLayer) map.removeLayer(heatLayer);
      heatVisible = false;
      btn.classList.remove("active");
      return;
    }
    btn.textContent = "Loading…";
    const layer = await loadHeatmap();
    btn.textContent = "My runs heatmap";
    if (!layer) {
      alert(
        "No personal runs data yet. Drop GPX exports into the gpx/ folder, or commit gpx/runs.json with { points: [[lat,lon,intensity], ...] }."
      );
      return;
    }
    layer.addTo(map);
    heatVisible = true;
    btn.classList.add("active");
  }

  // ─── Sidebar toggle ─────────────────────────────────────────
  function wireSidebarToggle() {
    const btn = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");
    btn.addEventListener("click", () => {
      const collapsed = sidebar.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", String(!collapsed));
      setTimeout(() => map.invalidateSize(), 280);
    });
  }

  // ─── Detail close ───────────────────────────────────────────
  function wireDetailClose() {
    document
      .getElementById("detail-close")
      .addEventListener("click", closeDetail);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDetail();
    });
  }

  // ─── Boot ───────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async () => {
    initMap();
    wireFilters();
    wireSidebarToggle();
    wireDetailClose();
    document
      .getElementById("toggle-heatmap")
      .addEventListener("click", toggleHeatmap);

    try {
      await loadRoutes();
    } catch (e) {
      console.error("Failed to load routes:", e);
      document.getElementById("loading").textContent =
        "Failed to load routes. Check console.";
    }
  });
})();
