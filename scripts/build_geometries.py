#!/usr/bin/env python3
"""
Precompute road geometries for each route in routes.json.

Calls Valhalla (https://valhalla1.openstreetmap.de) to trace the actual
road network between waypoints, then bakes the polyline + length + drive
time into routes.json under each route's `geometry`, `length_m`, `duration_s`
fields.

Also computes drive time from the origin point (UC Berkeley) to each
route's start, baked as `from_origin_s`.

Run before committing route changes:

    python3 scripts/build_geometries.py

Idempotent — overwrites the precomputed fields on each run.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

VALHALLA_URL = "https://valhalla1.openstreetmap.de/route"
ROUTES_PATH = os.path.join(os.path.dirname(__file__), "..", "routes.json")


def decode_polyline6(encoded: str):
    """Decode Valhalla's polyline6 (precision 1e-6) into a list of [lon, lat]."""
    coords = []
    index = 0
    lat = 0
    lng = 0
    while index < len(encoded):
        for shift_target in (0, 1):
            result = 0
            shift = 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if (result & 1) else (result >> 1)
            if shift_target == 0:
                lat += delta
            else:
                lng += delta
        coords.append([lng / 1e6, lat / 1e6])  # GeoJSON order
    return coords


def call_valhalla(waypoints):
    body = json.dumps(
        {
            "locations": [{"lat": lat, "lon": lon} for lat, lon in waypoints],
            "costing": "auto",
            "directions_options": {"units": "miles"},
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        VALHALLA_URL,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def trace(waypoints):
    """Return (geojson_linestring, length_meters, duration_seconds)."""
    data = call_valhalla(waypoints)
    trip = data["trip"]
    coords = []
    duration = 0.0
    length_m = 0.0
    for leg in trip["legs"]:
        leg_coords = decode_polyline6(leg["shape"])
        if coords and leg_coords:
            leg_coords = leg_coords[1:]  # avoid dup vertex
        coords.extend(leg_coords)
        duration += leg.get("summary", {}).get("time", 0)
        length_m += leg.get("summary", {}).get("length", 0) * 1609.344  # mi → m
    return (
        {"type": "LineString", "coordinates": coords},
        length_m,
        duration,
    )


def main():
    with open(ROUTES_PATH) as f:
        data = json.load(f)

    origin = data["metadata"]["origin"]
    origin_pt = (origin["lat"], origin["lon"])

    for i, route in enumerate(data["routes"]):
        print(f"[{i+1}/{len(data['routes'])}] {route['name']}…", flush=True)
        try:
            wpts = [tuple(p) for p in route["waypoints"]]
            geom, length_m, dur_s = trace(wpts)
            route["geometry"] = geom
            route["length_m"] = round(length_m)
            route["duration_s"] = round(dur_s)
            print(
                f"   ✓ {len(geom['coordinates'])} pts, "
                f"{length_m/1609.344:.1f} mi, {dur_s/60:.0f} min",
                flush=True,
            )
        except Exception as e:
            print(f"   ✗ trace failed: {e}", flush=True)
            continue

        time.sleep(0.5)  # be nice to the public Valhalla

        try:
            from_geom, from_length, from_dur = trace([origin_pt, wpts[0]])
            route["from_origin_s"] = round(from_dur)
            print(f"   ✓ from Berkeley: {from_dur/60:.0f} min", flush=True)
        except Exception as e:
            print(f"   ! from-origin trace failed: {e}", flush=True)

        time.sleep(0.5)

    with open(ROUTES_PATH, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"\nWrote {ROUTES_PATH}")


if __name__ == "__main__":
    main()
