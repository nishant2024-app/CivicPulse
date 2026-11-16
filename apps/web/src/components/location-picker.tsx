"use client";

import { LocateFixed, MapPinOff } from "lucide-react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
// Shown before a pin is placed: roughly the middle of India, zoomed out.
const DEFAULT_VIEW = { center: [78.96, 22.59] as [number, number], zoom: 3.6 };

/**
 * Optional map pin. The written location is what people act on; coordinates help
 * staff find the spot and feed the hotspot map. If the map cannot load (offline,
 * blocked tiles), reporting still works without it.
 */
export function LocationPicker({
  value,
  onChange,
}: {
  value: Coordinates | null;
  onChange: (value: Coordinates | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled || !container.current) return;
      const map = new maplibre.Map({
        container: container.current,
        style: STYLE_URL,
        ...DEFAULT_VIEW,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      map.on("click", (event) =>
        onChangeRef.current({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }),
      );
      // Only a failure of the base style makes the map unusable.
      map.on("error", () => {
        if (!map.isStyleLoaded()) setFailed(true);
      });
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    void import("maplibre-gl").then((maplibre) => {
      if (!value) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }
      const position: [number, number] = [value.longitude, value.latitude];
      const marker = markerRef.current ?? new maplibre.Marker({ color: "#1f4fd8" });
      marker.setLngLat(position).addTo(map);
      markerRef.current = marker;
      if (map.getZoom() < 13) map.flyTo({ center: position, zoom: 16 });
    });
  }, [value]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeoError("This device does not share its location.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onChange({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      },
      () => {
        setLocating(false);
        setGeoError("Could not get your location. Tap the map instead.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div>
      <div className="relative border border-line-strong">
        <div
          ref={container}
          className="h-64 w-full bg-canvas"
          aria-label="Map: tap to mark the spot"
        />
        {failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas px-6 text-center">
            <MapPinOff className="size-5 text-muted" aria-hidden />
            <p className="text-sm text-muted">
              The map could not load. You can still submit — the written location is enough.
            </p>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={useMyLocation} loading={locating}>
          <LocateFixed aria-hidden /> Use my location
        </Button>
        {value ? (
          <>
            <span className="font-mono text-xs text-ink-soft">
              {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}
            </span>
            <button
              type="button"
              className="text-sm text-brand-600 hover:underline"
              onClick={() => onChange(null)}
            >
              Remove pin
            </button>
          </>
        ) : (
          <span className="text-sm text-muted">or tap the map to drop a pin</span>
        )}
      </div>
      {geoError ? <p className="mt-1.5 text-sm text-danger-700">{geoError}</p> : null}
    </div>
  );
}
