# Personal runs / heatmap data

The `runs.json` file in this folder backs the **My runs heatmap** toggle in the app.

## Format

```json
{
  "points": [
    [37.8240, -122.2089, 0.8],
    [37.8077, -122.1860, 0.5]
  ]
}
```

Each point is `[latitude, longitude, intensity]` where intensity is a number from 0 to 1 (0 = barely visible, 1 = brightest).

## Replacing the seed data with your own runs

The committed `runs.json` is **synthetic seed data** generated along the curated routes — it just demonstrates the layer. To make it real:

1. Export your driving GPX files from Strava, Wandrer, or your dash-cam GPS app.
2. Convert them to the simple JSON format above. A one-liner:

   ```bash
   python3 - <<'PY'
   import json, glob, gpxpy
   pts = []
   for path in glob.glob("*.gpx"):
       with open(path) as f:
           gpx = gpxpy.parse(f)
       for tr in gpx.tracks:
           for seg in tr.segments:
               for p in seg.points:
                   pts.append([round(p.latitude,5), round(p.longitude,5), 0.7])
   json.dump({"points": pts}, open("runs.json","w"))
   print(len(pts), "points written")
   PY
   ```

3. Commit `runs.json`. The heatmap toggle will pick it up on next load.

The JSON is small enough that GitHub Pages serves it instantly even at tens of thousands of points. The heatmap renders client-side, so no server is needed.
