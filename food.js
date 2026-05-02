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
      // Translucent halo polygon defining the area
      if (Array.isArray(area.bounds) && area.bounds.length === 2) {
        const sw = area.bounds[0];
        const ne = area.bounds[1];
        const ring = [
          [sw[0], sw[1]],
          [sw[0], ne[1]],
          [ne[0], ne[1]],
          [ne[0], sw[1]],
        ];
        L.polygon(ring, {
          color: "#fbbf24",
          weight: 2,
          opacity: 0.9,
          fillColor: "#fbbf24",
          fillOpacity: 0.07,
          dashArray: "6 6",
          interactive: false,
        }).addTo(map);
      }

      // Pulsing area marker
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

    // Animate the bars in
    requestAnimationFrame(() => {
      body.querySelectorAll(".heat-bar-fill").forEach((el, i) => {
        setTimeout(() => el.classList.add("filled"), 80 + i * 40);
      });
    });

    // Wire row clicks → open the regular detail panel
    body.querySelectorAll(".heat-row").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.id;
        closeAreaModal();
        openDetail(id);
      });
    });
  }

  function closeAreaModal() {
    const modal = document.getElementById("area-modal");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
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
