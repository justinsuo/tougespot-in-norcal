# NorCal Touge Spots

> A curated, interactive map of Northern California's best driving roads — touge-style scenic and technical routes hand-picked from UC Berkeley.

**Live site:** [justinsuo.github.io/tougespot-in-norcal](https://justinsuo.github.io/tougespot-in-norcal)

![map screenshot](docs/screenshot.png)

## What's on the map

Nine routes across the Bay Area, with the actual road geometry traced via OSRM (not just point markers):

| Route | Region | Rating |
|---|---|---|
| Mount Hamilton via Quimby | South Bay | 4.5 |
| Silverado Trail | North Bay | 4.5 |
| Redwood Road | East Bay | 4.0 |
| Skyline Boulevard (CA-35) | Peninsula | 4.0 |
| Panoramic Highway | North Bay | 4.0 |
| Napa–Lake Berryessa Loop | North Bay | 4.0 |
| Mines Road | East Bay | 4.0 |
| Highway 9 (Boulder Creek) | South Bay | 3.5 |
| Palomares Road | East Bay | 3.5 |

Each route shows length, drive time, drive time from UC Berkeley, the kind of road, when to go, and what to watch out for.

## Features

- **Real road polylines** — routes are traced along actual pavement using the OSRM routing API, with a 7-day localStorage cache so repeat visits are instant.
- **Filters** — minimum rating, region, and a personal-runs heatmap toggle.
- **Detail panel** — per-route photo, length, drive time, round-trip time from Berkeley, when to go, and what to look out for.
- **Heatmap of personal runs** — drop your own GPX exports into [`gpx/`](gpx/) and the app overlays them as a Strava-style heatmap.
- **Mobile-friendly** — sidebar collapses into a bottom drawer on small screens.
- **Static site** — pure HTML/CSS/JS, hosted on GitHub Pages, no backend needed.

## Suggesting a new road

Two ways:

1. **Open an issue** with the [new-route template](https://github.com/justinsuo/tougespot-in-norcal/issues/new?template=new-route.yml) — fastest if you don't want to mess with JSON.
2. **Open a pull request** that adds an entry to [`routes.json`](routes.json) — see [CONTRIBUTING.md](CONTRIBUTING.md).

Routes are scored on a 1–5 scale across pavement quality, technicality, scenery, traffic, and "would you bring a friend." See [CONTRIBUTING.md](CONTRIBUTING.md) for the rubric.

## Running locally

```bash
git clone https://github.com/justinsuo/tougespot-in-norcal.git
cd tougespot-in-norcal
python3 -m http.server 8765
open http://localhost:8765
```

That's it — no build step, no dependencies.

## Stack

- [Leaflet](https://leafletjs.com) for the map
- [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat) for the heatmap layer
- [OSRM](https://project-osrm.org) public demo server for road geometry
- [CARTO Dark](https://carto.com/help/building-maps/basemap-list/) basemap tiles
- [GitHub Pages](https://pages.github.com) for hosting

## License

Routes data and content: CC BY 4.0. Code: MIT.
