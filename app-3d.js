// NorCal Touge Spots — 3D Cesium build
// Uses Cesium World Terrain + Bing Aerial imagery via Cesium Ion's free tier.
// Renders routes as ground-clamped polylines, POIs as billboards, and the
// Tilden golf course as a stack of color-coded ground polygons.

(function () {
  "use strict";

  // ─── Cesium Ion token ────────────────────────────────────────
  // Cesium ships a default token that works for demo use (with a watermark
  // and modest rate limits). For production use replace with your own free
  // token from https://cesium.com/ion/tokens — sign up is free and gives
  // higher quotas + lets you turn off the demo banner.
  // Leaving Cesium.Ion.defaultAccessToken untouched falls back to the
  // bundled demo token.
  if (window.CESIUM_ION_TOKEN) {
    Cesium.Ion.defaultAccessToken = window.CESIUM_ION_TOKEN;
  }

  const RATING_COLORS = {
    5.0: Cesium.Color.fromCssColorString("#16a34a"),
    4.5: Cesium.Color.fromCssColorString("#84cc16"),
    4.0: Cesium.Color.fromCssColorString("#eab308"),
    3.5: Cesium.Color.fromCssColorString("#f97316"),
    3.0: Cesium.Color.fromCssColorString("#ef4444"),
  };
  const ROLL_RACING_COLOR = Cesium.Color.fromCssColorString("#a855f7");
  const DIG_RACING_COLOR = Cesium.Color.fromCssColorString("#ec4899");

  function isDragStrip(route) {
    return Array.isArray(route?.tags) && route.tags.includes("drag-strip");
  }
  function isRollRacing(route) {
    return Array.isArray(route?.tags) && route.tags.includes("roll-racing");
  }
  function isDigRacing(route) {
    return Array.isArray(route?.tags) && route.tags.includes("dig-racing");
  }
  function colorForRoute(route) {
    if (isRollRacing(route)) return ROLL_RACING_COLOR;
    if (isDigRacing(route)) return DIG_RACING_COLOR;
    if (isDragStrip(route)) return ROLL_RACING_COLOR;
    return colorForRating(route.rating);
  }
  function colorForRating(r) {
    if (r >= 5) return RATING_COLORS[5.0];
    if (r >= 4.5) return RATING_COLORS[4.5];
    if (r >= 4) return RATING_COLORS[4.0];
    if (r >= 3.5) return RATING_COLORS[3.5];
    return RATING_COLORS[3.0];
  }
  function colorForRatingHex(r) {
    if (r >= 5) return "#16a34a";
    if (r >= 4.5) return "#84cc16";
    if (r >= 4) return "#eab308";
    if (r >= 3.5) return "#f97316";
    return "#ef4444";
  }
  function dragStripLabel(route) {
    if (isRollRacing(route)) return "🏁 Roll Racing";
    if (isDigRacing(route)) return "🏁 Dig Racing";
    return "🏁 Drag strip";
  }
  function classForRoute(route) {
    if (isRollRacing(route)) return "r-roll";
    if (isDigRacing(route)) return "r-dig";
    if (isDragStrip(route)) return "r-roll";
    if (route.rating >= 5) return "r-5";
    if (route.rating >= 4.5) return "r-45";
    if (route.rating >= 4) return "r-4";
    if (route.rating >= 3.5) return "r-35";
    return "r-3";
  }

  function metersToMiles(m) { return m * 0.000621371; }
  function fmtDistance(m) {
    const mi = metersToMiles(m);
    return mi >= 10 ? `${mi.toFixed(0)} mi` : `${mi.toFixed(1)} mi`;
  }
  function fmtDuration(s) {
    const min = s / 60;
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ─── App state ───────────────────────────────────────────────
  let viewer;
  let routesData = null;
  /** id → { polyline: Entity, marker: Entity, poiEntities: Entity[], route } */
  const routeLayers = {};
  let activeId = null;
  const filters = { rating: 0, region: "all", type: "all" };

  // ─── Cesium init ─────────────────────────────────────────────
  async function initViewer() {
    // Terrain stack — with hard timeouts so a slow CDN can't block boot:
    //   1. Cesium World Terrain (Ion; best quality)
    //   2. Esri World Elevation 3D (free, no key)
    //   3. Flat ellipsoid (last resort)
    const withTimeout = (p, ms, label) => Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + " timed out after " + ms + "ms")), ms)),
    ]);
    let terrainProvider;
    let usingRealTerrain = false;
    let terrainSource = "flat";
    try {
      terrainProvider = await withTimeout(
        Cesium.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true }),
        4000,
        "Cesium World Terrain"
      );
      usingRealTerrain = true;
      terrainSource = "Cesium World Terrain";
    } catch (eIon) {
      console.warn("Cesium World Terrain unavailable, trying Esri…", eIon.message || eIon);
      try {
        terrainProvider = await withTimeout(
          Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
            "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"
          ),
          5000,
          "Esri World Elevation"
        );
        usingRealTerrain = true;
        terrainSource = "Esri World Elevation";
      } catch (eEsri) {
        console.warn("Esri terrain unavailable, using flat globe:", eEsri.message || eEsri);
        terrainProvider = new Cesium.EllipsoidTerrainProvider();
      }
    }

    // Multiple free imagery providers, all from Esri (no API key required).
    // We default to the gray canvas because:
    //   - way smaller payloads → loads faster on slow machines
    //   - the gray base makes our colored route polylines pop visually
    //   - it's the "simplified, roads-focused" look the project goals call for
    const BASEMAPS = {
      gray: {
        label: "B&W (light)",
        base: () => new Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 16,
          credit: "Esri Light Gray Canvas",
        }),
        // Reference layer = labels + bold road network drawn over the base
        ref: () => new Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 16,
        }),
      },
      dark: {
        label: "B&W (dark)",
        base: () => new Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 16,
          credit: "Esri Dark Gray Canvas",
        }),
        ref: () => new Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 16,
        }),
      },
      satellite: {
        label: "Satellite",
        base: () => new Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 19,
          credit: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        }),
      },
    };

    viewer = new Cesium.Viewer("map", {
      terrainProvider,
      baseLayerPicker: false, // we set our own imagery below
      animation: false,
      timeline: false,
      fullscreenButton: true,
      geocoder: false,
      homeButton: true,
      infoBox: true,
      navigationHelpButton: false, // we have our own help overlay
      sceneModePicker: true,
      selectionIndicator: true,
      shadows: false,
      shouldAnimate: false,
      contextOptions: { webgl: { preserveDrawingBuffer: false } },
    });

    // Default to satellite — gives the realistic terrain texture so the 3D
    // depth reads visually. Gray/dark are alternatives via the sidebar toggle.
    function applyBasemap(name) {
      const b = BASEMAPS[name] || BASEMAPS.satellite;
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(b.base());
      if (b.ref) viewer.imageryLayers.addImageryProvider(b.ref());
      window.__currentBasemap__ = name;
    }
    window.__applyBasemap__ = applyBasemap;
    window.__BASEMAPS__ = BASEMAPS;
    applyBasemap("satellite");

    // Expose viewer so devtools / scripts can drive the camera
    window.__viewer__ = viewer;

    // Tell the user (in the loading banner) which mode we're in
    const loading = document.getElementById("loading");
    if (loading && !usingRealTerrain) {
      loading.innerHTML =
        "Loading routes… <span style='color:#fbbf24;font-size:11px;'>(flat globe — add a free Cesium Ion token for real terrain)</span>";
    } else if (loading && usingRealTerrain) {
      loading.innerHTML = `Loading routes… <span style='color:#86efac;font-size:11px;'>(3D terrain via ${escapeHtml(terrainSource)})</span>`;
    }

    // Visual polish — punch up the contrast and atmosphere
    if (usingRealTerrain) {
      // Slight vertical exaggeration so the East Bay hills feel hilly rather
      // than gentle. 1.5 is enough to be readable without looking cartoonish.
      viewer.scene.verticalExaggeration = 1.5;
    }

    // We're using Esri imagery + Esri terrain, NOT Cesium Ion services, so
    // the Cesium ion branding/logo does not legally need to be displayed.
    // Hide the logo container while keeping the Esri credit text visible.
    const creditCont = viewer.cesiumWidget.creditContainer;
    creditCont.style.color = "#cbd5e1";
    // Apply CSS belt-and-braces in case the logo container is recreated later.
    const style = document.createElement("style");
    style.textContent = `
      .cesium-credit-logoContainer { display: none !important; }
      .cesium-credit-textContainer { font-size: 10px; color: rgba(229,231,235,0.7) !important; }
    `;
    document.head.appendChild(style);

    // Atmosphere / fog / lighting defaults — start subtle, the user can
    // toggle them on/off from the sidebar.
    viewer.scene.skyAtmosphere.show = true;  // gentle horizon haze
    viewer.scene.fog.enabled = true;
    // Enable lighting so buildings get directional shading (more 3D-feeling)
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    // Brighten ambient so shadowed building faces stay readable
    viewer.scene.light = new Cesium.SunLight();
    viewer.scene.globe.atmosphereLightIntensity = 5.0;

    // Default camera: tilted overhead view of the Bay Area
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-122.2, 37.6, 65000),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-55),
        roll: 0,
      },
      duration: 0,
    });

    // UC Berkeley origin marker
    viewer.entities.add({
      name: "UC Berkeley",
      position: Cesium.Cartesian3.fromDegrees(-122.2585, 37.8719),
      billboard: {
        image: makeOriginPin(),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 1,
      },
      description:
        "<strong>UC Berkeley</strong><br>Origin point — drive times measured from here.",
    });

    // Click handler for routes / POIs.
    //   - Click a route polyline or its start pin → open detail panel
    //   - Click a POI billboard or polygon → fly camera in close, show description
    //   - Click empty space → close detail
    viewer.screenSpaceEventHandler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      if (picked && picked.id) {
        const id = picked.id;
        if (id._routeId) {
          openDetail(id._routeId);
          return;
        }
        // Generic entity click — Cesium's selectionIndicator + InfoBox handle
        // the popup; here we add a fly-in for non-route POIs/polygons so the
        // user gets a guided zoom.
        if (id.position) {
          const pos = id.position.getValue ? id.position.getValue(viewer.clock.currentTime) : id.position;
          if (pos) {
            const carto = Cesium.Cartographic.fromCartesian(pos);
            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(
                Cesium.Math.toDegrees(carto.longitude),
                Cesium.Math.toDegrees(carto.latitude) - 0.003,
                900
              ),
              orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
              duration: 1.4,
            });
          }
        } else if (id.polygon) {
          // Polygon (golf feature, area POI) — fly to centroid
          viewer.flyTo(id, {
            duration: 1.4,
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 1500),
          });
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Hover handler — when the cursor enters a route polyline, beef it up;
    // when it leaves, restore. Also drives the live coords HUD readout.
    let hoverEntity = null;
    const coordsEl = document.getElementById("hud-coords");
    const ellipsoid = viewer.scene.globe.ellipsoid;
    viewer.screenSpaceEventHandler.setInputAction((move) => {
      // Coords HUD
      if (coordsEl) {
        const cartesian = viewer.camera.pickEllipsoid(move.endPosition, ellipsoid);
        if (cartesian) {
          const c = Cesium.Cartographic.fromCartesian(cartesian);
          coordsEl.textContent =
            `${Cesium.Math.toDegrees(c.latitude).toFixed(5)}, ${Cesium.Math.toDegrees(c.longitude).toFixed(5)}`;
        }
      }
      // Hover highlight on routes
      const picked = viewer.scene.pick(move.endPosition);
      const newHover = picked && picked.id && picked.id._routeId ? picked.id : null;
      if (newHover === hoverEntity) return;
      // Reset previous
      if (hoverEntity && hoverEntity.polyline) {
        const id = hoverEntity._routeId;
        const wasActive = id === activeId;
        hoverEntity.polyline.width = wasActive ? 9 : 5;
      }
      hoverEntity = newHover;
      if (hoverEntity && hoverEntity.polyline) {
        hoverEntity.polyline.width = 11;
        document.body.style.cursor = "pointer";
      } else {
        document.body.style.cursor = "";
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  // Origin pin as data-URL canvas — Cesium billboards take an image
  function makeOriginPin() {
    const canvas = document.createElement("canvas");
    canvas.width = 36;
    canvas.height = 36;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#0b1015";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(18, 18, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#0b1015";
    ctx.font = "bold 16px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("B", 18, 18);
    return canvas.toDataURL();
  }

  function makePoiPin(glyph, bg) {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = bg;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(20, 20, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = "18px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, 20, 20);
    return canvas.toDataURL();
  }

  // ─── Route loading ──────────────────────────────────────────
  async function loadRoutes() {
    const res = await fetch("routes.json");
    if (!res.ok) throw new Error(`routes.json ${res.status}`);
    routesData = await res.json();

    const loading = document.getElementById("loading");
    let pendingTrace = [];

    for (const route of routesData.routes) {
      if (route.geometry && route.geometry.coordinates && route.geometry.coordinates.length) {
        route._geom = route.geometry;
        route._distance = route.length_m || 0;
        route._duration = route.duration_s || 0;
        route._fromBerkeley = route.from_origin_s || 0;
        renderRouteOnMap(route);
      } else {
        pendingTrace.push(route);
      }
    }

    // Routes without precomputed geometry — straight-line fallback in 3D mode
    // (live OSRM/Valhalla tracing is preserved in the 2D build; in 3D we
    // prioritize quick boot since the heavy lifting is the terrain stream).
    for (const route of pendingTrace) {
      route._geom = {
        type: "LineString",
        coordinates: route.waypoints.map(([lat, lon]) => [lon, lat]),
      };
      route._distance = 0;
      route._duration = 0;
      route._fromBerkeley = (haversine(
        routesData.metadata.origin.lat,
        routesData.metadata.origin.lon,
        route.waypoints[0][0],
        route.waypoints[0][1]
      ) / 1000) * 72; // 72 sec/km rough estimate
      renderRouteOnMap(route);
    }

    // Standalone POIs (not tied to a route)
    if (Array.isArray(routesData.pois)) {
      for (const poi of routesData.pois) {
        renderPoi(poi, null);
      }
    }

    renderRouteList();
    flyToVisible();
    loading.classList.add("hidden");
  }

  function renderRouteOnMap(route) {
    const color = colorForRoute(route);
    const dragStrip = isDragStrip(route);

    // routes.json geometry is [lon, lat]
    const positions = Cesium.Cartesian3.fromDegreesArray(
      route._geom.coordinates.flat()
    );

    // PolylineGlowMaterial gives a soft halo around each route — really pops
    // on the gray basemap and reads cleanly on satellite too.
    const baseWidth = dragStrip ? 6 : 5;
    const glowMaterial = dragStrip
      ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 16 })
      : new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.22,
          taperPower: 1,
          color,
        });
    const polylineEntity = viewer.entities.add({
      name: route.name,
      polyline: {
        positions,
        width: baseWidth,
        clampToGround: true,
        material: glowMaterial,
        // depthFailMaterial keeps the line readable when it dips behind a
        // ridge in 3D oblique view
        depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
          color: color.withAlpha(0.55),
          dashLength: 12,
        }),
      },
    });
    polylineEntity._routeId = route.id;

    // Start-point billboard
    const start = route._geom.coordinates[0];
    const markerEntity = viewer.entities.add({
      name: route.name,
      position: Cesium.Cartesian3.fromDegrees(start[0], start[1]),
      billboard: {
        image: makeRoutePin(route),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 1,
      },
      description: routePopupHtml(route),
    });
    markerEntity._routeId = route.id;

    // POIs along this route
    const poiEntities = [];
    if (Array.isArray(route.pois)) {
      for (const poi of route.pois) {
        const ents = renderPoi(poi, route);
        if (Array.isArray(ents)) poiEntities.push(...ents);
        else if (ents) poiEntities.push(ents);
      }
    }

    routeLayers[route.id] = {
      polyline: polylineEntity,
      marker: markerEntity,
      poiEntities,
      route,
    };
  }

  function makeRoutePin(route) {
    const canvas = document.createElement("canvas");
    canvas.width = 44;
    canvas.height = 56;
    const ctx = canvas.getContext("2d");
    const bg = colorForRoute(route).toCssColorString();

    // Drop pin shape
    ctx.fillStyle = bg;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(22, 22, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Pointer
    ctx.beginPath();
    ctx.moveTo(14, 36);
    ctx.lineTo(22, 54);
    ctx.lineTo(30, 36);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (isDragStrip(route)) {
      ctx.fillText("🏁", 22, 22);
    } else {
      ctx.fillText(String(route.rating), 22, 22);
    }
    return canvas.toDataURL();
  }

  function routePopupHtml(route) {
    const distStr = route._distance ? fmtDistance(route._distance) : "—";
    const durStr = route._duration ? fmtDuration(route._duration) : "—";
    const fromB = route._fromBerkeley ? fmtDuration(route._fromBerkeley) : "—";
    const ratingChip = isDragStrip(route)
      ? `<span style="color:${colorForRoute(route).toCssColorString()};">${dragStripLabel(route)}</span>`
      : `<strong>${route.rating}/5</strong>`;
    return `
      <div style="font-family:system-ui;color:#e5e7eb;">
        <h3 style="margin:0 0 4px 0;">${escapeHtml(route.name)}</h3>
        <div style="font-size:12px;color:#9ca3af;margin-bottom:8px;">
          ${ratingChip} · ${escapeHtml(route.region)} · ${escapeHtml(route.surface || "paved")}
        </div>
        <div style="font-size:12px;line-height:1.5;">
          <div>↔ ${distStr} · ${durStr} drive</div>
          <div>🚗 ${fromB} from Berkeley</div>
        </div>
        <div style="margin-top:10px;font-size:12px;line-height:1.4;">${escapeHtml(route.summary || "")}</div>
      </div>
    `;
  }

  // ─── POIs ───────────────────────────────────────────────────
  function renderPoi(poi, route) {
    // Polygon-with-features POI (Tilden golf course)
    if (poi.features_url) {
      return renderAreaWithFeatures(poi, route);
    }

    // Simple polygon POI (perimeter only)
    if (Array.isArray(poi.polygon) && poi.polygon.length >= 3) {
      return renderSimplePolygonPoi(poi, route);
    }

    // Point POI (vista, crash, donut, etc.)
    const iconKind = poi.icon || "pin";
    const glyphMap = {
      crash: ["💥", "#ef4444"],
      vista: ["📷", "#0ea5e9"],
      donut: ["🍩", "#d946ef"],
      golf: ["🏌", "#16a34a"],
      pin: ["📍", "#64748b"],
    };
    const [glyph, bg] = glyphMap[iconKind] || glyphMap.pin;

    const ent = viewer.entities.add({
      name: poi.title || iconKind,
      position: Cesium.Cartesian3.fromDegrees(poi.lon, poi.lat),
      billboard: {
        image: makePoiPin(glyph, bg),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 0.9,
      },
      description: poiPopupHtml(poi, route),
    });
    return ent;
  }

  function renderSimplePolygonPoi(poi, route) {
    const positions = poi.polygon.flatMap(([lat, lon]) => [lon, lat]);
    const ent = viewer.entities.add({
      name: poi.title || "area",
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
        material: Cesium.Color.fromCssColorString("#16a34a").withAlpha(0.45),
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
      description: poiPopupHtml(poi, route),
    });
    return ent;
  }

  // Color palette for the golf-course features
  const GOLF_STYLES = {
    green:        { fill: "#22c55e", alpha: 0.95, outline: "#14532d" },
    fairway:      { fill: "#4ade80", alpha: 0.7,  outline: "#166534" },
    tee:          { fill: "#86efac", alpha: 0.85, outline: "#15803d" },
    bunker:       { fill: "#fde68a", alpha: 0.95, outline: "#a16207" },
    driving_range:{ fill: "#bef264", alpha: 0.5,  outline: "#65a30d" },
    clubhouse:    { fill: "#374151", alpha: 0.9,  outline: "#1f2937" },
    rough:        { fill: "#65a30d", alpha: 0.4,  outline: "#3f6212" },
    default:      { fill: "#16a34a", alpha: 0.4,  outline: "#16a34a" },
  };

  function renderAreaWithFeatures(poi, route) {
    const ents = [];

    // Loading-state perimeter while features stream in
    let placeholder = null;
    if (Array.isArray(poi.polygon) && poi.polygon.length >= 3) {
      const perimPositions = poi.polygon.flatMap(([lat, lon]) => [lon, lat]);
      placeholder = viewer.entities.add({
        name: poi.title,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(perimPositions),
          material: Cesium.Color.fromCssColorString("#16a34a").withAlpha(0.25),
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
      });
      ents.push(placeholder);
    }

    fetch(poi.features_url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (placeholder) {
          viewer.entities.remove(placeholder);
          const idx = ents.indexOf(placeholder);
          if (idx >= 0) ents.splice(idx, 1);
        }
        const features = data.features || [];
        for (const f of features) {
          if (!f.coords || f.coords.length < 2) continue;

          if (f.shape === "line") {
            // hole centerlines + cart paths
            const linePositions = Cesium.Cartesian3.fromDegreesArray(
              f.coords.flatMap(([lat, lon]) => [lon, lat])
            );
            if (f.kind === "hole") {
              const ent = viewer.entities.add({
                name: poi.title,
                polyline: {
                  positions: linePositions,
                  width: 2.5,
                  clampToGround: true,
                  material: new Cesium.PolylineDashMaterialProperty({
                    color: Cesium.Color.fromCssColorString("#facc15"),
                    dashLength: 14,
                  }),
                },
                description: golfFeatureDesc(poi, f),
              });
              // Add hole-number label at midpoint with high contrast (works on
              // both gray and satellite basemaps).
              const mid = f.coords[Math.floor(f.coords.length / 2)];
              if (mid && f.ref) {
                const lblEnt = viewer.entities.add({
                  position: Cesium.Cartesian3.fromDegrees(mid[1], mid[0]),
                  label: {
                    text: String(f.ref),
                    font: "bold 13px system-ui",
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 4,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    showBackground: true,
                    backgroundColor: Cesium.Color.fromCssColorString("#0b1015").withAlpha(0.75),
                    backgroundPadding: new Cesium.Cartesian2(6, 3),
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    pixelOffset: new Cesium.Cartesian2(0, -10),
                    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6000),
                  },
                });
                ents.push(lblEnt);
              }
              ents.push(ent);
            } else if (f.kind === "cartpath") {
              const ent = viewer.entities.add({
                polyline: {
                  positions: linePositions,
                  width: 1.5,
                  clampToGround: true,
                  material: new Cesium.PolylineDashMaterialProperty({
                    color: Cesium.Color.fromCssColorString("#a8a29e").withAlpha(0.7),
                    dashLength: 6,
                  }),
                },
              });
              ents.push(ent);
            }
            continue;
          }

          // polygon features
          const style = GOLF_STYLES[f.kind] || GOLF_STYLES.default;
          const positions = f.coords.flatMap(([lat, lon]) => [lon, lat]);
          const ent = viewer.entities.add({
            name: poi.title,
            polygon: {
              hierarchy: Cesium.Cartesian3.fromDegreesArray(positions),
              material: Cesium.Color.fromCssColorString(style.fill).withAlpha(style.alpha),
              classificationType: Cesium.ClassificationType.TERRAIN,
            },
            description: golfFeatureDesc(poi, f),
          });
          ents.push(ent);
        }
      })
      .catch((err) => {
        console.warn(`Failed to load features for "${poi.title}":`, err);
      });

    return ents;
  }

  function golfFeatureDesc(poi, f) {
    const head = escapeHtml(poi.title || "");
    const sub = f.ref
      ? `Hole ${escapeHtml(f.ref)}${f.par ? ` · par ${escapeHtml(f.par)}` : ""}`
      : f.name
      ? escapeHtml(f.name)
      : escapeHtml(f.kind.replace(/_/g, " "));
    return `
      <div style="font-family:system-ui;color:#e5e7eb;">
        <h3 style="margin:0 0 4px 0;">${head}</h3>
        <div style="font-size:12px;color:#9ca3af;">${sub}</div>
        ${poi.description ? `<div style="font-size:12px;line-height:1.5;margin-top:8px;">${escapeHtml(poi.description)}</div>` : ""}
      </div>
    `;
  }

  function poiPopupHtml(poi, route) {
    const warningBlock = poi.warning
      ? `<div style="background:#7f1d1d;color:#fff;padding:6px 8px;border-radius:6px;margin-bottom:8px;font-weight:600;">
           ${escapeHtml(poi.warning_label || "⚠ WARNING")}
           ${poi.warning_subtitle ? `<div style="font-weight:400;font-size:11px;margin-top:2px;">${escapeHtml(poi.warning_subtitle)}</div>` : ""}
         </div>`
      : "";
    const onRoute = route ? `<div style="font-size:11px;color:#9ca3af;margin-bottom:6px;">On <em>${escapeHtml(route.name)}</em></div>` : "";
    return `
      <div style="font-family:system-ui;color:#e5e7eb;">
        ${warningBlock}
        <h3 style="margin:0 0 4px 0;">${escapeHtml(poi.title || "")}</h3>
        ${onRoute}
        ${poi.description ? `<div style="font-size:12px;line-height:1.5;">${escapeHtml(poi.description)}</div>` : ""}
      </div>
    `;
  }

  // ─── Visibility / filtering ─────────────────────────────────
  function visibleRoutes() {
    if (!routesData) return [];
    return routesData.routes.filter((r) => {
      const ds = isDragStrip(r);
      const roll = isRollRacing(r);
      const dig = isDigRacing(r);
      if (filters.rating > 0 && !ds && r.rating < filters.rating) return false;
      if (filters.rating > 0 && ds) return false;
      if (filters.region !== "all" && r.region !== filters.region) return false;
      if (filters.type === "touge" && ds) return false;
      if (filters.type === "roll-racing" && !roll) return false;
      if (filters.type === "dig-racing" && !dig) return false;
      if (filters.type === "drag-strip" && !ds) return false;
      return true;
    });
  }

  function applyFilters() {
    const visibleIds = new Set(visibleRoutes().map((r) => r.id));
    Object.entries(routeLayers).forEach(([id, layer]) => {
      const show = visibleIds.has(id);
      layer.polyline.show = show;
      layer.marker.show = show;
      (layer.poiEntities || []).forEach((e) => { if (e) e.show = show; });
    });
    renderRouteList();
    flyToVisible();
  }

  function flyToVisible() {
    const visible = visibleRoutes();
    if (!visible.length) return;
    let lonMin = 180, lonMax = -180, latMin = 90, latMax = -90;
    for (const r of visible) {
      if (!r._geom) continue;
      for (const [lon, lat] of r._geom.coordinates) {
        if (lon < lonMin) lonMin = lon;
        if (lon > lonMax) lonMax = lon;
        if (lat < latMin) latMin = lat;
        if (lat > latMax) latMax = lat;
      }
    }
    if (lonMin > lonMax) return;
    const padding = 0.05;
    viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(
        lonMin - padding, latMin - padding,
        lonMax + padding, latMax + padding
      ),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-55),
        roll: 0,
      },
      duration: 1.5,
    });
  }

  // ─── Sidebar list ───────────────────────────────────────────
  function renderRouteList() {
    const container = document.getElementById("route-list");
    container.innerHTML = "";
    const sorted = visibleRoutes().sort((a, b) => {
      const aDs = isDragStrip(a), bDs = isDragStrip(b);
      if (aDs !== bDs) return aDs ? 1 : -1;
      return (b.rating || 0) - (a.rating || 0);
    });
    if (!sorted.length) {
      container.innerHTML =
        '<p style="color:var(--text-dim);font-size:12px;padding:12px;text-align:center;">No routes match these filters.</p>';
      return;
    }
    for (const r of sorted) {
      const card = document.createElement("div");
      card.className = `route-card ${classForRoute(r)}`;
      card.dataset.id = r.id;
      if (r.id === activeId) card.classList.add("active");

      const distStr = r._distance ? fmtDistance(r._distance) : "—";
      const fromB = r._fromBerkeley ? fmtDuration(r._fromBerkeley) : "—";
      const ds = isDragStrip(r);
      const ratingChip = ds
        ? `<span class="rating drag-rating">${dragStripLabel(r)}</span>`
        : `<span class="rating">${r.rating}</span>`;
      const diffBadge = r.difficulty
        ? `<span class="diff-badge diff-${r.difficulty}">${r.difficulty}</span>`
        : "";
      card.innerHTML = `
        <div class="row">
          <h3 class="name">${escapeHtml(r.name)}</h3>
          ${ratingChip}
        </div>
        <div class="meta">
          <span>📍 ${escapeHtml(r.region)}</span>
          <span>↔ ${distStr}</span>
          <span>🚗 ${fromB} from Berkeley</span>
          ${diffBadge}
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
        layer.polyline.polyline.width = 8;
      } else {
        layer.polyline.polyline.width = 3;
      }
    });

    // Fly camera to this route with a dramatic oblique angle. We compute the
    // route's bearing so the camera lines up looking down the road, which
    // shows off the 3D terrain better than a top-down view.
    const layer = routeLayers[id];
    if (layer) {
      const coords = route._geom.coordinates;
      let lonMin = 180, lonMax = -180, latMin = 90, latMax = -90;
      for (const [lon, lat] of coords) {
        if (lon < lonMin) lonMin = lon;
        if (lon > lonMax) lonMax = lon;
        if (lat < latMin) latMin = lat;
        if (lat > latMax) latMax = lat;
      }
      const cLon = (lonMin + lonMax) / 2;
      const cLat = (latMin + latMax) / 2;
      // Bearing from route start → end → orient camera tangent to it
      const start = coords[0];
      const end = coords[coords.length - 1];
      const dLon = end[0] - start[0];
      const dLat = end[1] - start[1];
      const heading = Math.atan2(dLon, dLat); // radians, north = 0
      // Estimate altitude from route bbox so the whole road fits in view
      const span = Math.max(lonMax - lonMin, latMax - latMin);
      const alt = Math.max(2500, span * 111000 * 1.5);
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(cLon, cLat - span * 0.6, alt),
        orientation: {
          heading,
          pitch: Cesium.Math.toRadians(-38), // shallower → more dramatic 3D
          roll: 0,
        },
        duration: 2.0,
      });
    }

    document
      .querySelectorAll(".route-card")
      .forEach((c) => c.classList.toggle("active", c.dataset.id === id));

    const body = document.getElementById("detail-body");
    const photoBlock = route.photo_url
      ? `<img class="detail-photo" src="${route.photo_url}" alt="${escapeHtml(route.name)}" onerror="this.style.display='none'" /><div class="photo-credit">${escapeHtml(route.photo_credit || "")}</div>`
      : `<div class="detail-photo-placeholder"></div>`;

    body.innerHTML = `
      ${photoBlock}
      <div class="detail-content">
        <h2>${escapeHtml(route.name)}</h2>
        <div class="detail-rating-row">
          ${isDragStrip(route)
            ? `<span class="detail-rating drag-rating" style="color:${colorForRoute(route).toCssColorString()};border-color:${colorForRoute(route).toCssColorString()};background:${colorForRoute(route).toCssColorString()}22;">${dragStripLabel(route)} location</span>`
            : `<span class="detail-rating" style="color:${colorForRatingHex(route.rating)};">${route.rating}/5</span>`}
          <span>·</span>
          <span>${escapeHtml(route.region)}</span>
          <span>·</span>
          <span>${escapeHtml(route.surface || "paved")}</span>
          ${route.difficulty ? `<span>·</span><span class="diff-badge diff-${route.difficulty}">${route.difficulty}</span>` : ""}
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
          <p>${escapeHtml(route.summary || "")}</p>
        </div>
        <div class="detail-section">
          <h3>Best time</h3>
          <p>${escapeHtml(route.best_time || "")}</p>
        </div>
        <div class="detail-section">
          <h3>Watch out for</h3>
          <p>${escapeHtml(route.watchouts || "")}</p>
        </div>
        <div class="detail-actions">
          <a class="btn" href="${route.google_maps_url}" target="_blank" rel="noopener">Directions ↗</a>
          <button class="btn secondary" id="detail-close-btn">Close</button>
        </div>
      </div>
    `;
    document.getElementById("detail-panel").classList.add("open");
    document.getElementById("detail-panel").setAttribute("aria-hidden", "false");
    document.getElementById("detail-close-btn").addEventListener("click", closeDetail);
  }

  function closeDetail() {
    activeId = null;
    document.getElementById("detail-panel").classList.remove("open");
    document.getElementById("detail-panel").setAttribute("aria-hidden", "true");
    Object.values(routeLayers).forEach((layer) => {
      layer.polyline.polyline.width = 5;
    });
    document.querySelectorAll(".route-card").forEach((c) => c.classList.remove("active"));
  }

  // ─── Filters ────────────────────────────────────────────────
  function wireFilters() {
    document.querySelectorAll("#rating-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll("#rating-chips .chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        filters.rating = parseFloat(chip.dataset.rating);
        applyFilters();
      });
    });
    document.querySelectorAll("#region-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll("#region-chips .chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        filters.region = chip.dataset.region;
        applyFilters();
      });
    });
    document.querySelectorAll("#type-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll("#type-chips .chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        filters.type = chip.dataset.type;
        applyFilters();
      });
    });
  }

  // ─── Sidebar collapse ───────────────────────────────────────
  function wireSidebarToggle() {
    const btn = document.getElementById("sidebar-toggle");
    const sidebar = document.getElementById("sidebar");
    btn.addEventListener("click", () => {
      const collapsed = sidebar.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", String(!collapsed));
      // Cesium auto-resizes via ResizeObserver; nothing else to do.
    });
  }

  function wireDetailClose() {
    document.getElementById("detail-close").addEventListener("click", closeDetail);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDetail();
    });
  }

  function wireHeatmapStub() {
    const btn = document.getElementById("toggle-heatmap");
    if (!btn) return;
    btn.addEventListener("click", () => {
      alert("My-runs heatmap is currently 2D-only. Coming soon to the 3D view.");
    });
    btn.title = "Heatmap is currently 2D-only";
    btn.style.opacity = "0.55";
  }

  function wireBasemapChips() {
    document.querySelectorAll("#basemap-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll("#basemap-chips .chip")
          .forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        const name = chip.dataset.basemap;
        if (typeof window.__applyBasemap__ === "function") {
          window.__applyBasemap__(name);
        }
      });
    });
  }

  function wirePoiToggle() {
    const btn = document.getElementById("toggle-pois");
    if (!btn) return;
    let visible = true;
    btn.addEventListener("click", () => {
      visible = !visible;
      btn.classList.toggle("active", visible);
      Object.values(routeLayers).forEach((layer) => {
        (layer.poiEntities || []).forEach((e) => {
          if (e) e.show = visible && (layer.polyline.show !== false);
        });
      });
    });
  }

  function wireResetView() {
    const btn = document.getElementById("reset-view");
    if (!btn) return;
    btn.addEventListener("click", () => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-122.2, 37.6, 65000),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-55),
          roll: 0,
        },
        duration: 1.5,
      });
    });
  }

  function wireKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      // ignore when user is typing in a form field
      if (e.target.matches("input, textarea, select")) return;
      if (e.key === "r" || e.key === "R") {
        document.getElementById("reset-view")?.click();
      } else if (e.key === "g" || e.key === "G") {
        const chips = [...document.querySelectorAll("#basemap-chips .chip")];
        const i = chips.findIndex((c) => c.classList.contains("active"));
        chips[(i + 1) % chips.length]?.click();
      } else if (e.key === "p" || e.key === "P") {
        document.getElementById("toggle-pois")?.click();
      } else if (e.key === "?" || e.key === "/") {
        document.getElementById("help-3d-btn")?.click();
      }
    });
  }

  function wireExaggerationSlider() {
    const slider = document.getElementById("exaggeration");
    const val = document.getElementById("exaggeration-val");
    if (!slider || !val) return;
    slider.addEventListener("input", () => {
      const v = parseFloat(slider.value);
      val.textContent = v.toFixed(1) + "×";
      if (viewer && viewer.scene) viewer.scene.verticalExaggeration = v;
    });
  }

  function wireAtmosphereToggle() {
    const btn = document.getElementById("toggle-atmosphere");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const on = !btn.classList.contains("active");
      btn.classList.toggle("active", on);
      if (viewer) viewer.scene.skyAtmosphere.show = on;
    });
  }

  function wireFogToggle() {
    const btn = document.getElementById("toggle-fog");
    if (!btn) return;
    // Fog defaults to on; reflect that in the chip
    btn.classList.add("active");
    btn.addEventListener("click", () => {
      const on = !btn.classList.contains("active");
      btn.classList.toggle("active", on);
      if (viewer) viewer.scene.fog.enabled = on;
    });
  }

  // ─── 3D Buildings (OSM extruded) ─────────────────────────────
  // Loads bay_buildings.json (pre-baked from OSM via Overpass) and renders
  // each building as an extruded polygon with the OSM-tagged height. Free
  // alternative to Cesium OSM Buildings (which would need a Cesium Ion token).
  let buildingsLayer = null;
  let buildingsLoaded = false;
  let buildingsLoading = false;

  async function loadBuildings() {
    if (buildingsLoaded || buildingsLoading) return;
    buildingsLoading = true;
    const btn = document.getElementById("toggle-buildings");
    if (btn) btn.textContent = "Loading buildings…";
    try {
      const res = await fetch("bay_buildings.json");
      if (!res.ok) throw new Error(`bay_buildings.json ${res.status}`);
      const data = await res.json();

      // Build one entity collection so we can show/hide all together
      buildingsLayer = new Cesium.CustomDataSource("buildings");
      viewer.dataSources.add(buildingsLayer);

      // Color buildings by height. Pale concrete tones with subtle warmth so
      // shorter buildings still pop. Outlined for crisp edges in 3D.
      const colorFor = (h) => {
        if (h >= 80) return Cesium.Color.fromCssColorString("#cbd5e1"); // skyscraper
        if (h >= 40) return Cesium.Color.fromCssColorString("#e2e8f0"); // tower
        if (h >= 20) return Cesium.Color.fromCssColorString("#f1f5f9"); // mid-rise
        if (h >= 10) return Cesium.Color.fromCssColorString("#f5f5f4"); // low-rise
        return Cesium.Color.fromCssColorString("#fafaf9"); // residential
      };
      const outlineColor = Cesium.Color.fromCssColorString("#475569").withAlpha(0.35);

      for (const f of data.features) {
        if (!f.c || f.c.length < 3) continue;
        const positions = Cesium.Cartesian3.fromDegreesArray(
          f.c.flatMap(([lat, lon]) => [lon, lat])
        );
        buildingsLayer.entities.add({
          polygon: {
            hierarchy: positions,
            material: colorFor(f.h),
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            extrudedHeight: f.h,
            extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            outline: true,
            outlineColor,
            outlineWidth: 1,
          },
        });
      }
      buildingsLoaded = true;
      if (btn) btn.textContent = `Buildings (${data.count.toLocaleString()})`;
    } catch (e) {
      console.warn("Buildings load failed:", e);
      if (btn) btn.textContent = "Buildings (failed)";
    } finally {
      buildingsLoading = false;
    }
  }

  function wireBuildingsToggle() {
    const btn = document.getElementById("toggle-buildings");
    if (!btn) return;
    let visible = false;
    btn.addEventListener("click", async () => {
      visible = !visible;
      btn.classList.toggle("active", visible);
      if (visible) {
        await loadBuildings();
        if (buildingsLayer) buildingsLayer.show = true;
      } else if (buildingsLayer) {
        buildingsLayer.show = false;
      }
    });
  }

  // ─── Trees / forest blobs ────────────────────────────────────
  // We don't have realistic individual trees, but we can visualise OSM's
  // forest / wood / scrub polygons as low-extrusion green slabs to give a
  // wooded feel. This is a "cheap trees" effect — turn it on with the toggle.
  let treesLayer = null;
  let treesLoaded = false;
  let treesLoading = false;

  async function loadTrees() {
    if (treesLoaded || treesLoading) return;
    treesLoading = true;
    const btn = document.getElementById("toggle-trees");
    if (btn) btn.textContent = "Loading forest…";
    try {
      const res = await fetch("bay_forest.json");
      if (!res.ok) throw new Error(`bay_forest.json ${res.status}`);
      const data = await res.json();
      treesLayer = new Cesium.CustomDataSource("trees");
      viewer.dataSources.add(treesLayer);
      for (const f of data.features) {
        if (!f.c || f.c.length < 3) continue;
        const positions = Cesium.Cartesian3.fromDegreesArray(
          f.c.flatMap(([lat, lon]) => [lon, lat])
        );
        treesLayer.entities.add({
          polygon: {
            hierarchy: positions,
            material: Cesium.Color.fromCssColorString("#15803d").withAlpha(0.55),
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            extrudedHeight: 8,
            extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
            outline: false,
          },
        });
      }
      treesLoaded = true;
      if (btn) btn.textContent = `Trees (${data.count.toLocaleString()})`;
    } catch (e) {
      console.warn("Trees load failed:", e);
      if (btn) btn.textContent = "Trees (n/a)";
    } finally {
      treesLoading = false;
    }
  }

  function wireTreesToggle() {
    const btn = document.getElementById("toggle-trees");
    if (!btn) return;
    let visible = false;
    btn.addEventListener("click", async () => {
      visible = !visible;
      btn.classList.toggle("active", visible);
      if (visible) {
        await loadTrees();
        if (treesLayer) treesLayer.show = true;
      } else if (treesLayer) {
        treesLayer.show = false;
      }
    });
  }

  function wireHelpOverlay() {
    const btn = document.getElementById("help-3d-btn");
    const overlay = document.getElementById("help-overlay");
    const close = document.getElementById("help-close");
    if (!btn || !overlay || !close) return;
    btn.addEventListener("click", () => overlay.classList.add("open"));
    close.addEventListener("click", () => overlay.classList.remove("open"));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("open");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay.classList.contains("open")) {
        overlay.classList.remove("open");
        e.stopPropagation();
      }
    });
  }

  // ─── Boot ───────────────────────────────────────────────────
  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      // DOM already parsed (e.g. when app-3d.js is appended after Cesium.js)
      fn();
    }
  }
  onReady(async () => {
    try {
      await initViewer();
    } catch (e) {
      console.error("Cesium failed to initialize:", e);
      document.getElementById("loading").textContent =
        "3D view failed to start. Check console.";
      return;
    }
    wireFilters();
    wireSidebarToggle();
    wireDetailClose();
    wireHeatmapStub();
    wireBasemapChips();
    wirePoiToggle();
    wireResetView();
    wireKeyboardShortcuts();
    wireExaggerationSlider();
    wireAtmosphereToggle();
    wireFogToggle();
    wireHelpOverlay();
    wireBuildingsToggle();
    wireTreesToggle();

    try {
      await loadRoutes();
    } catch (e) {
      console.error("Failed to load routes:", e);
      document.getElementById("loading").textContent =
        "Failed to load routes. Check console.";
    }
  });
})();
