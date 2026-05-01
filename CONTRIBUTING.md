# Contributing

Thanks for wanting to add a road. Two paths:

## Option A — Open an issue (easiest)

[Open the new-route issue](https://github.com/justinsuo/tougespot-in-norcal/issues/new?template=new-route.yml) and fill out the form. We'll add it.

## Option B — Open a pull request

1. Fork the repo, create a branch.
2. Add an entry to `routes.json` under `routes`.
3. The schema:

   ```json
   {
     "id": "kebab-case-id",
     "name": "Human-readable name",
     "rating": 4.0,
     "region": "East Bay | Peninsula | South Bay | North Bay",
     "surface": "paved | gravel | mixed",
     "summary": "One paragraph: the vibe of the road, what makes it special.",
     "best_time": "When to go, why.",
     "watchouts": "Hazards: cyclists, fog, enforcement, surface, etc.",
     "waypoints": [
       [lat, lon],
       [lat, lon]
     ],
     "google_maps_url": "https://www.google.com/maps/dir/...",
     "photo_url": "optional, prefer Wikimedia Commons or your own",
     "photo_credit": "optional"
   }
   ```

4. **Waypoints**: 2–4 points along the road in driving order. The app fetches the actual road geometry between them via OSRM, so you don't need to trace every corner — just give a start, a midpoint or two, and an end.
5. Run locally to verify (`python3 -m http.server 8765`) then open a PR.

## Rating rubric

We rate roads on a 1–5 scale. Five dimensions, each scored 0–1, summed to 5:

| Dimension | What it means |
|---|---|
| **Pavement** | Surface quality. Smooth = 1; potholed/gravelly = 0. |
| **Technicality** | Apex variety, elevation, transitions. Mountain-pass complexity = 1; straight country road = 0. |
| **Scenery** | Views, redwoods, ocean, ridge lines. Postcard = 1; suburban = 0. |
| **Traffic / Risk** | Inverse of cars, cyclists, enforcement, blind apexes. Empty + safe = 1. |
| **Bring a friend** | Would you take a passenger here for the experience? Yes enthusiastically = 1. |

Round to the nearest 0.5.

## What gets accepted

- Public, paved or well-maintained roads in Northern California (roughly Monterey ↔ Mendocino, west of the Sierra).
- Roads where the appeal is the *driving*, not just the destination.
- Not: parking lots, autocross venues, closed/private roads, anything where pace would be reckless on a normal day.

## Reporting an issue

Conditions change — washouts, construction, new no-camping signs. If a route's "watchouts" needs updating, [open an issue](https://github.com/justinsuo/tougespot-in-norcal/issues/new) or PR.
