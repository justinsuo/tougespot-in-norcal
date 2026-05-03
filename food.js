// NorCal Chinese Food Map — restaurant markers with filters and detail panel.

(function () {
  "use strict";

  let map;
  let foodData = null;
  let restaurantMarkers = {};
  let filters = { cuisine: "all", region: "all", rating: 0, price: "all" };
  let activeId = null;

  // Region grouping — restaurants are tagged by city in the JSON; we group some
  // cities together for the regional filter chips.
  const REGION_OF = {
    "San Francisco": "San Francisco",
    "Oakland": "Oakland",
    "Berkeley": "Berkeley",
    "Albany": "Berkeley",
    "Emeryville": "Berkeley",
    "Daly City": "Peninsula",
    "Millbrae": "Peninsula",
    "San Mateo": "Peninsula",
    "Burlingame": "Peninsula",
    "South San Francisco": "Peninsula",
    "Mountain View": "South Bay",
    "Cupertino": "South Bay",
    "San Jose": "South Bay",
    "Sunnyvale": "South Bay",
    "Santa Clara": "South Bay",
    "Los Altos": "South Bay",
    "Fremont": "South Bay",
    "Newark": "South Bay",
    "Sacramento": "Sacramento",
    "Richmond": "Berkeley",
  };
  const regionFor = (r) => REGION_OF[r.city] || r.city;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ─── Map init ───────────────────────────────────────────────
  function initMap() {
    map = L.map("map", {
      center: [37.8, -122.2],
      zoom: 9,
      zoomControl: true,
    });
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a>',
      }
    ).addTo(map);

    // Berkeley origin marker
    const origin = L.divIcon({
      className: "origin-pin",
      html: '<div style="background:#fff;color:#0b1015;border:2px solid #0b1015;border-radius:50%;width:18px;height:18px;display:grid;place-items:center;font-size:10px;font-weight:700;">B</div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    L.marker([37.8719, -122.2585], { icon: origin, zIndexOffset: 1000 })
      .bindPopup("<strong>UC Berkeley</strong>Origin point")
      .addTo(map);
  }

  // ─── Load + render ──────────────────────────────────────────
  async function loadFood() {
    const res = await fetch("food.json");
    if (!res.ok) throw new Error(`food.json ${res.status}`);
    foodData = await res.json();

    populateCuisineChips();

    for (const r of foodData.restaurants) {
      // Restaurants attached to a featured area (Milpitas Square) are hidden
      // from the main map — they appear inside the area's modal only.
      if (r.at_area) continue;
      renderMarker(r);
    }
    renderFeaturedAreas();
    renderList();
    fitMapToVisible();
    document.getElementById("loading").classList.add("hidden");
  }

  // ─── Featured-area easter egg (Milpitas Square) ─────────────
  function renderFeaturedAreas() {
    const areas = foodData.featured_areas || {};
    for (const [id, area] of Object.entries(areas)) {
      // Single pulsing dot — no polygon halo on the main map. The full
      // Milpitas Square experience (mini-map + restaurants) lives behind
      // the click. This is the easter egg.
      const html = `
        <div class="area-pin">
          <div class="area-pin-pulse"></div>
          <div class="area-pin-pulse area-pin-pulse-2"></div>
          <div class="area-pin-core">${area.icon || "✨"}</div>
          <div class="area-pin-label">${escapeHtml(area.name)}</div>
        </div>
      `;
      const icon = L.divIcon({
        className: "area-icon",
        html,
        iconSize: [48, 48],
        iconAnchor: [24, 24],
      });
      const marker = L.marker([area.lat, area.lon], { icon, zIndexOffset: 2000 }).addTo(map);
      marker.on("click", () => openAreaModal(id));
    }
  }

  let areaPinByRestoId = {};

  // ─── Custom SVG diagram of Milpitas Square ──────────────────
  // Based on the actual plaza footprint at N Milpitas Blvd & Yosemite Dr.
  // Ranch 99 is the large anchor on the north side; restaurants ring the
  // central parking lot from west, south, and east.
  function buildPlazaDiagramSvg() {
    return `
      <svg viewBox="0 0 720 360" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="ranchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="8" height="8" fill="#3a1a14"/>
            <circle cx="4" cy="4" r="0.4" fill="#7f1d1d" opacity="0.6"/>
          </pattern>
          <linearGradient id="bldgGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#1f2a37"/>
            <stop offset="1" stop-color="#172033"/>
          </linearGradient>
          <linearGradient id="anchorGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#dc2626" stop-opacity="0.0"/>
            <stop offset="1" stop-color="#dc2626" stop-opacity="0.15"/>
          </linearGradient>
        </defs>

        <!-- Asphalt background -->
        <rect width="720" height="360" fill="#0e1620"/>

        <!-- North street: N Milpitas Blvd -->
        <rect x="0" y="0" width="720" height="34" fill="#1f2937"/>
        <line x1="0" y1="17" x2="720" y2="17" stroke="#fbbf24" stroke-width="1.2" stroke-dasharray="14 14" opacity="0.55"/>
        <text x="360" y="22" fill="#cbd5e1" text-anchor="middle" font-size="11" font-weight="700" letter-spacing="2.5">N MILPITAS BLVD</text>

        <!-- South street: Yosemite Dr -->
        <rect x="0" y="326" width="720" height="34" fill="#1f2937"/>
        <line x1="0" y1="343" x2="720" y2="343" stroke="#fbbf24" stroke-width="1.2" stroke-dasharray="14 14" opacity="0.55"/>
        <text x="360" y="348" fill="#cbd5e1" text-anchor="middle" font-size="10" font-weight="700" letter-spacing="2.2">YOSEMITE DR</text>

        <!-- Right edge: Calaveras Blvd direction -->
        <rect x="688" y="0" width="32" height="360" fill="#1f2937"/>
        <text x="704" y="180" fill="#cbd5e1" text-anchor="middle" font-size="10" font-weight="700" letter-spacing="2"
              transform="rotate(90 704 180)">→ TO CALAVERAS BLVD</text>

        <!-- Left edge -->
        <rect x="0" y="0" width="32" height="360" fill="#1f2937"/>

        <!-- Plaza outline (gold dashed) -->
        <rect x="40" y="42" width="640" height="280" fill="rgba(251, 191, 36, 0.04)"
              stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="8 6" rx="4"/>

        <!-- Anchor: 99 RANCH MARKET (north side, large) -->
        <g class="bldg-anchor">
          <rect x="60" y="56" width="600" height="98" fill="url(#ranchPattern)" stroke="#dc2626" stroke-width="2" rx="3"/>
          <rect x="60" y="56" width="600" height="98" fill="url(#anchorGlow)" rx="3"/>
          <text x="360" y="92" fill="#fef2f2" text-anchor="middle" font-size="22" font-weight="800" letter-spacing="3">99 RANCH MARKET</text>
          <text x="360" y="114" fill="#fca5a5" text-anchor="middle" font-size="10.5" letter-spacing="2">PLAZA ANCHOR · ASIAN GROCERY</text>
          <text x="360" y="138" fill="#fbbf24" text-anchor="middle" font-size="11" letter-spacing="3">★ ★ ★ ★ ★</text>
          <!-- Entrance markers -->
          <rect x="340" y="148" width="40" height="6" fill="#fbbf24" opacity="0.7"/>
          <text x="360" y="148" fill="#fbbf24" text-anchor="middle" font-size="7" letter-spacing="1.5" dy="-2">ENTRANCE</text>
        </g>

        <!-- Parking lot (center, large) -->
        <g class="parking">
          <rect x="60" y="166" width="600" height="58" fill="#0b1018" stroke="#1f2937" stroke-width="1" opacity="0.7"/>
          <!-- Parking row dividers -->
          <line x1="60" y1="195" x2="660" y2="195" stroke="#334155" stroke-width="0.4" stroke-dasharray="4 4" opacity="0.4"/>
          <!-- Parking spot ticks -->
          <g stroke="#334155" stroke-width="0.7" opacity="0.55">
            ${Array.from({length: 30}, (_, i) => {
              const x = 70 + i * 20;
              return `<line x1="${x}" y1="166" x2="${x}" y2="195"/><line x1="${x}" y1="195" x2="${x}" y2="224"/>`;
            }).join("")}
          </g>
          <text x="360" y="200" fill="#475569" text-anchor="middle" font-size="9" letter-spacing="6" font-weight="700" opacity="0.65">P A R K I N G   L O T</text>
        </g>

        <!-- WEST WING — bakery, congee, noodles -->
        <g class="bldg-west">
          <rect x="60" y="232" width="200" height="86" fill="url(#bldgGrad)" stroke="#475569" stroke-width="1.5" rx="3"/>
          <!-- Storefront slots -->
          <line x1="60"  y1="276" x2="260" y2="276" stroke="#475569" stroke-width="0.8" opacity="0.55"/>
          <line x1="115" y1="232" x2="115" y2="276" stroke="#475569" stroke-width="0.6" opacity="0.4"/>
          <line x1="170" y1="232" x2="170" y2="276" stroke="#475569" stroke-width="0.6" opacity="0.4"/>
          <line x1="215" y1="232" x2="215" y2="276" stroke="#475569" stroke-width="0.6" opacity="0.4"/>
          <text x="160" y="252" fill="#94a3b8" text-anchor="middle" font-size="9" font-weight="700" letter-spacing="1.3">WEST WING</text>
          <text x="160" y="266" fill="#64748b" text-anchor="middle" font-size="8" letter-spacing="0.8">noodles · congee · bakery</text>
        </g>

        <!-- SOUTH ARCADE — bakery, boba, dessert -->
        <g class="bldg-south">
          <rect x="270" y="232" width="240" height="86" fill="url(#bldgGrad)" stroke="#475569" stroke-width="1.5" rx="3"/>
          <line x1="270" y1="276" x2="510" y2="276" stroke="#475569" stroke-width="0.8" opacity="0.55"/>
          <line x1="320" y1="232" x2="320" y2="276" stroke="#475569" stroke-width="0.6" opacity="0.4"/>
          <line x1="370" y1="232" x2="370" y2="276" stroke="#475569" stroke-width="0.6" opacity="0.4"/>
          <line x1="420" y1="232" x2="420" y2="276" stroke="#475569" stroke-width="0.6" opacity="0.4"/>
          <line x1="465" y1="232" x2="465" y2="276" stroke="#475569" stroke-width="0.6" opacity="0.4"/>
          <text x="390" y="252" fill="#94a3b8" text-anchor="middle" font-size="9" font-weight="700" letter-spacing="1.3">SOUTH ARCADE</text>
          <text x="390" y="266" fill="#64748b" text-anchor="middle" font-size="8" letter-spacing="0.8">85°C · boba · dessert</text>
        </g>

        <!-- EAST WING — hot pot, tea, cafe -->
        <g class="bldg-east">
          <rect x="520" y="232" width="140" height="86" fill="url(#bldgGrad)" stroke="#475569" stroke-width="1.5" rx="3"/>
          <line x1="520" y1="276" x2="660" y2="276" stroke="#475569" stroke-width="0.8" opacity="0.55"/>
          <line x1="568" y1="232" x2="568" y2="276" stroke="#475569" stroke-width="0.6" opacity="0.4"/>
          <line x1="615" y1="232" x2="615" y2="276" stroke="#475569" stroke-width="0.6" opacity="0.4"/>
          <text x="590" y="252" fill="#94a3b8" text-anchor="middle" font-size="9" font-weight="700" letter-spacing="1.3">EAST WING</text>
          <text x="590" y="266" fill="#64748b" text-anchor="middle" font-size="8" letter-spacing="0.8">hot pot · tea · cafe</text>
        </g>

        <!-- North-arrow compass + author note -->
        <g class="overlays" font-family="-apple-system, BlinkMacSystemFont, sans-serif">
          <g transform="translate(50, 52)">
            <path d="M 0 0 L 6 -10 L 12 0 L 6 -3 Z" fill="#fbbf24"/>
            <text x="6" y="14" fill="#fbbf24" text-anchor="middle" font-size="9" font-weight="800" letter-spacing="0.8">N</text>
          </g>
          <text x="676" y="354" fill="#94a3b8" text-anchor="end" font-size="9" font-style="italic" opacity="0.75">Milpitas Square · Justin's favorite</text>
        </g>
      </svg>
    `;
  }

  function openAreaModal(areaId) {
    const area = foodData.featured_areas[areaId];
    if (!area) return;
    const restos = foodData.restaurants
      .filter((r) => r.at_area === areaId)
      .slice()
      .sort((a, b) => b.rating - a.rating);

    const heatRows = restos
      .map((r, i) => {
        const c = colorFor(r);
        const e = emojiFor(r);
        const widthPct = Math.min(100, (r.rating / 5) * 100);
        return `
          <button class="heat-row" data-id="${r.id}" style="--c:${c}; --w:${widthPct}%;">
            <div class="heat-rank">#${i + 1}</div>
            <div class="heat-emoji">${e}</div>
            <div class="heat-meat">
              <div class="heat-name">${escapeHtml(r.name)}</div>
              <div class="heat-sub">
                <span style="color:${c};">${escapeHtml(r.cuisine)}</span>
                <span class="heat-dot">·</span>
                <span>${r.price}</span>
                <span class="heat-dot">·</span>
                <span class="heat-sig">⭐ ${escapeHtml(r.signature_dish || "")}</span>
              </div>
              <div class="heat-bar"><div class="heat-bar-fill"></div></div>
            </div>
            <div class="heat-rating">${r.rating}</div>
          </button>
        `;
      })
      .join("");

    const body = document.getElementById("area-modal-body");
    const pinsHtml = restos
      .map((r) => {
        const pos = r.diagram_pos || { x: 50, y: 50 };
        const c = colorFor(r);
        const e = emojiFor(r);
        const size = Math.round(28 + ((r.rating - 3.0) / 2.0) * 18);
        const intensity = ((r.rating - 3.0) / 2.0).toFixed(2);
        return `
          <button class="ms-pin" data-id="${r.id}"
                  style="left:${pos.x}%; top:${pos.y}%; --c:${c}; --size:${size}px; --intensity:${intensity};"
                  aria-label="${escapeHtml(r.name)}">
            <span class="ms-pin-pulse"></span>
            <span class="ms-pin-core">${e}</span>
            <span class="ms-pin-rating">${r.rating}</span>
            <span class="ms-pin-label">${escapeHtml(r.name)}</span>
          </button>
        `;
      })
      .join("");

    body.innerHTML = `
      <div class="area-hero">
        <div class="area-hero-glow"></div>
        <div class="area-hero-icon">${area.icon || "✨"}</div>
        <div class="area-hero-text">
          <div class="area-hero-eyebrow">EASTER EGG · CLICK A RESTAURANT</div>
          <h2 class="area-hero-name">${escapeHtml(area.name)}</h2>
          <p class="area-hero-sub">${escapeHtml(area.subtitle || "")}</p>
        </div>
      </div>
      <div class="ms-diagram" aria-label="Diagram of ${escapeHtml(area.name)}">
        ${buildPlazaDiagramSvg()}
        <div class="ms-pin-layer">${pinsHtml}</div>
      </div>
      <div class="area-content">
        ${area.description ? `<p class="area-description">${escapeHtml(area.description)}</p>` : ""}
        ${area.the_move ? `<div class="area-move"><span class="area-move-label">The move</span><p>${escapeHtml(area.the_move)}</p></div>` : ""}
        <div class="area-heatmap-header">
          <span>The Heatmap</span>
          <span class="area-heatmap-count">${restos.length} spots, ranked</span>
        </div>
        <div class="area-heatmap">${heatRows}</div>
        <div class="area-footer">${area.tagline ? escapeHtml(area.tagline) : ""}</div>
      </div>
    `;

    const modal = document.getElementById("area-modal");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");

    // Index diagram pins so we can highlight from heatmap row hover
    areaPinByRestoId = {};
    body.querySelectorAll(".ms-pin").forEach((pin) => {
      areaPinByRestoId[pin.dataset.id] = pin;
      pin.addEventListener("click", () => {
        const id = pin.dataset.id;
        closeAreaModal();
        openDetail(id);
      });
    });

    // Animate the bars in
    requestAnimationFrame(() => {
      body.querySelectorAll(".heat-bar-fill").forEach((el, i) => {
        setTimeout(() => el.classList.add("filled"), 80 + i * 40);
      });
    });

    // Wire row clicks → open the regular detail panel; hover → highlight pin
    body.querySelectorAll(".heat-row").forEach((row) => {
      const id = row.dataset.id;
      row.addEventListener("click", () => {
        closeAreaModal();
        openDetail(id);
      });
      row.addEventListener("mouseenter", () => highlightDiagramPin(id, true));
      row.addEventListener("mouseleave", () => highlightDiagramPin(id, false));
    });
  }

  function highlightDiagramPin(id, on) {
    const el = areaPinByRestoId[id];
    if (el) el.classList.toggle("highlighted", on);
  }

  function closeAreaModal() {
    const modal = document.getElementById("area-modal");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    areaPinByRestoId = {};
  }

  function populateCuisineChips() {
    const container = document.getElementById("cuisine-chips");
    const cuisines = Object.keys(foodData.cuisines);
    cuisines.sort();
    for (const c of cuisines) {
      const btn = document.createElement("button");
      btn.className = "chip";
      btn.dataset.cuisine = c;
      btn.style.borderColor = foodData.cuisines[c];
      btn.textContent = c;
      container.appendChild(btn);
    }
    // wire after creation
    document.querySelectorAll("#cuisine-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document
          .querySelectorAll("#cuisine-chips .chip")
          .forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        filters.cuisine = chip.dataset.cuisine;
        applyFilters();
      });
    });
  }

  function colorFor(r) {
    return foodData.cuisines[r.cuisine] || "#94a3b8";
  }

  function emojiFor(r) {
    return (foodData.cuisine_emoji && foodData.cuisine_emoji[r.cuisine]) || "🥢";
  }

  function renderMarker(r) {
    const color = colorFor(r);
    const emoji = emojiFor(r);
    const html = `
      <div class="resto-pin" style="--c:${color};" title="${escapeHtml(r.cuisine)}">
        <div class="resto-glyph">${emoji}</div>
      </div>
    `;
    const icon = L.divIcon({
      className: "resto-icon",
      html,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    const marker = L.marker([r.lat, r.lon], { icon, zIndexOffset: 200 }).addTo(map);

    const popupHtml = `
      <strong>${escapeHtml(r.name)}</strong>
      <div style="color:#8b96a3;font-size:11px;margin-bottom:4px;">
        ${escapeHtml(r.cuisine)} · ${escapeHtml(r.neighborhood)}, ${escapeHtml(r.city)}
      </div>
      <div style="font-size:11px;margin-bottom:6px;color:${color};font-weight:700;">
        ${r.price} · ${r.rating}/5
      </div>
      <a href="#" data-id="${r.id}" class="popup-link">View details →</a>
    `;
    marker.bindPopup(popupHtml, { maxWidth: 260 });
    marker.on("popupopen", (e) => {
      const link = e.popup.getElement().querySelector(".popup-link");
      if (link) {
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          openDetail(r.id);
          map.closePopup();
        });
      }
    });
    marker.on("click", () => marker.openPopup());

    restaurantMarkers[r.id] = { marker, restaurant: r };
  }

  function visibleRestaurants() {
    if (!foodData) return [];
    return foodData.restaurants.filter((r) => {
      // Featured-area restaurants are easter-egg only — never in the sidebar list.
      if (r.at_area) return false;
      if (filters.cuisine !== "all" && r.cuisine !== filters.cuisine) return false;
      if (filters.region !== "all" && regionFor(r) !== filters.region) return false;
      if (filters.rating > 0 && r.rating < filters.rating) return false;
      if (filters.price !== "all" && r.price !== filters.price) return false;
      return true;
    });
  }

  function renderList() {
    const container = document.getElementById("restaurant-list");
    container.innerHTML = "";
    const sorted = visibleRestaurants().slice().sort((a, b) => b.rating - a.rating);
    if (!sorted.length) {
      container.innerHTML =
        '<p style="color:var(--text-dim);font-size:12px;padding:12px;text-align:center;">No restaurants match these filters.</p>';
      return;
    }
    for (const r of sorted) {
      const card = document.createElement("div");
      card.className = `route-card resto-card`;
      card.dataset.id = r.id;
      card.style.borderLeftColor = colorFor(r);
      if (r.id === activeId) card.classList.add("active");

      const sig = r.signature_dish ? `<div class="resto-sig">⭐ ${escapeHtml(r.signature_dish)}</div>` : "";
      const tagPills = (r.tags || [])
        .slice(0, 2)
        .map((t) => `<span class="resto-tag">${escapeHtml(t)}</span>`)
        .join("");

      card.innerHTML = `
        <div class="resto-card-thumb" style="background:linear-gradient(135deg,${colorFor(r)},${colorFor(r)}88);">
          <span class="resto-card-emoji">${emojiFor(r)}</span>
        </div>
        <div class="resto-card-body">
          <div class="row">
            <h3 class="name">${escapeHtml(r.name)}</h3>
            <span class="rating" style="color:${colorFor(r)};">${r.rating}</span>
          </div>
          <div class="meta">
            <span style="color:${colorFor(r)};font-weight:700;">${escapeHtml(r.cuisine)}</span>
            <span>📍 ${escapeHtml(r.neighborhood)}</span>
            <span>${r.price}</span>
          </div>
          ${sig}
          ${tagPills ? `<div class="resto-tag-row">${tagPills}</div>` : ""}
        </div>
      `;
      card.addEventListener("click", () => openDetail(r.id));
      container.appendChild(card);
    }
  }

  function openDetail(id) {
    const r = foodData.restaurants.find((x) => x.id === id);
    if (!r) return;
    activeId = id;

    // Pan to it
    const layer = restaurantMarkers[id];
    if (layer) {
      map.setView([r.lat, r.lon], 15, { animate: true });
      layer.marker.openPopup();
    }

    document
      .querySelectorAll(".route-card")
      .forEach((c) => c.classList.toggle("active", c.dataset.id === id));

    const color = colorFor(r);
    const emoji = emojiFor(r);
    const body = document.getElementById("detail-body");

    const dishes = (r.dishes || [])
      .map((d) => `<li><span class="dish-bullet" style="background:${color};"></span>${escapeHtml(d)}</li>`)
      .join("");
    const tips = (r.tips || [])
      .map((t) => `<li>💡 ${escapeHtml(t)}</li>`)
      .join("");
    const tags = (r.tags || [])
      .map((t) => `<span class="resto-tag" style="border-color:${color}55;color:${color};background:${color}15;">${escapeHtml(t)}</span>`)
      .join("");
    const sig = r.signature_dish
      ? `<div class="signature-callout" style="--c:${color};">
           <div class="signature-label">⭐ ORDER THIS</div>
           <div class="signature-name">${escapeHtml(r.signature_dish)}</div>
         </div>`
      : "";

    body.innerHTML = `
      <div class="resto-hero" style="background: radial-gradient(ellipse at center, ${color}66 0%, ${color}22 50%, transparent 90%), linear-gradient(135deg, ${color} 0%, ${color}aa 100%);">
        <div class="resto-hero-emoji">${emoji}</div>
        <div class="resto-hero-cuisine" style="color:#fff;background:rgba(0,0,0,0.35);">${escapeHtml(r.cuisine)}</div>
      </div>
      <div class="detail-content">
        <h2>${escapeHtml(r.name)}</h2>
        <div class="detail-rating-row">
          <span class="detail-rating" style="color:${color};">${r.rating}/5</span>
          <span>·</span>
          <span>${r.price}</span>
          <span>·</span>
          <span>${escapeHtml(r.neighborhood)}, ${escapeHtml(r.city)}</span>
        </div>
        ${tags ? `<div class="resto-tag-row resto-tag-row-detail">${tags}</div>` : ""}
        ${sig}
        <div class="detail-section">
          <h3>The story</h3>
          <p>${escapeHtml(r.known_for)}</p>
          <p style="margin-top:6px;">${escapeHtml(r.vibe)}</p>
        </div>
        ${dishes ? `
        <div class="detail-section">
          <h3>What to order</h3>
          <ul class="dish-list">${dishes}</ul>
        </div>` : ""}
        ${tips ? `
        <div class="detail-section">
          <h3>Insider tips</h3>
          <ul class="tip-list">${tips}</ul>
        </div>` : ""}
        <div class="detail-actions">
          <a class="btn" href="https://www.google.com/maps/search/${encodeURIComponent(r.name + ' ' + r.city)}" target="_blank" rel="noopener">Open in Maps ↗</a>
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
    document
      .querySelectorAll(".route-card")
      .forEach((c) => c.classList.remove("active"));
  }

  function applyFilters() {
    const visibleIds = new Set(visibleRestaurants().map((r) => r.id));
    Object.entries(restaurantMarkers).forEach(([id, layer]) => {
      const show = visibleIds.has(id);
      if (show) {
        if (!map.hasLayer(layer.marker)) layer.marker.addTo(map);
      } else {
        if (map.hasLayer(layer.marker)) map.removeLayer(layer.marker);
      }
    });
    renderList();
    fitMapToVisible();
  }

  function fitMapToVisible() {
    const visible = visibleRestaurants();
    if (!visible.length) return;
    const bounds = L.latLngBounds(visible.map((r) => [r.lat, r.lon]));
    map.fitBounds(bounds, { padding: [60, 60] });
  }

  function wireFilters() {
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
    document.querySelectorAll("#price-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document
          .querySelectorAll("#price-chips .chip")
          .forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        filters.price = chip.dataset.price;
        applyFilters();
      });
    });
  }

  function wireSidebarToggle() {
    const btn = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");
    btn.addEventListener("click", () => {
      const collapsed = sidebar.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", String(!collapsed));
      setTimeout(() => map.invalidateSize(), 280);
    });
  }

  function wireDetailClose() {
    document
      .getElementById("detail-close")
      .addEventListener("click", closeDetail);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeDetail();
        closeAreaModal();
      }
    });
    const areaClose = document.getElementById("area-modal-close");
    if (areaClose) areaClose.addEventListener("click", closeAreaModal);
    const areaBackdrop = document.querySelector("#area-modal .area-modal-backdrop");
    if (areaBackdrop) areaBackdrop.addEventListener("click", closeAreaModal);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initMap();
    wireFilters();
    wireSidebarToggle();
    wireDetailClose();
    try {
      await loadFood();
    } catch (e) {
      console.error("Failed to load food:", e);
      document.getElementById("loading").textContent =
        "Failed to load food.json. Check console.";
    }
  });
})();
