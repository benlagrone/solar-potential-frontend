import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Popup,
  Polyline,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { buildLeafletPositions, normalizeMapPoint } from "../lib/geometry.js";

const defaultCenter = [39.8283, -98.5795];
const gardenZonePalette = ["#1f6c5c", "#4a8f6a", "#b8843b", "#346b93"];
const parcelScaleBoundsThreshold = 0.0009;
const earthRadiusMeters = 6371000;
const defaultEnvelopeHalfWidthMeters = 24;
const defaultEnvelopeHalfHeightMeters = 24;
const yardScaleEnvelopeMaxWidthMeters = 90;
const yardScaleEnvelopeMaxHeightMeters = 75;
const nearestBuildingViewportMaxDistanceMeters = 65;
const nearestBuildingViewportPaddingMeters = 18;

const mapStyles = {
  streets: {
    label: "Street",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    focusZoom: 22,
    maxNativeZoom: 19,
    maxZoom: 22,
  },
  terrain: {
    label: "Terrain",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    focusZoom: 22,
    maxNativeZoom: 17,
    maxZoom: 22,
  },
};

function clampZoom(value, maxZoom) {
  return Math.min(value, maxZoom);
}

function getBoundsMaxSpan(bounds) {
  if (!bounds) {
    return Infinity;
  }

  return Math.max(
    Math.abs(bounds.north - bounds.south),
    Math.abs(bounds.east - bounds.west),
  );
}

function shouldUsePreviewBounds(preview) {
  return Boolean(preview?.bounds) && getBoundsMaxSpan(preview.bounds) <= parcelScaleBoundsThreshold;
}

function metersToLatitudeDelta(meters) {
  return (meters / earthRadiusMeters) * (180 / Math.PI);
}

function metersToLongitudeDelta(meters, latitude) {
  const cosine = Math.max(Math.cos((latitude * Math.PI) / 180), 0.2);
  return (meters / (earthRadiusMeters * cosine)) * (180 / Math.PI);
}

function buildBoundsArray(bounds) {
  if (!bounds) {
    return null;
  }

  return [
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ];
}

function buildSyntheticPreviewBounds(preview) {
  if (!preview?.latitude || !preview?.longitude) {
    return null;
  }

  const latitudeDelta = metersToLatitudeDelta(defaultEnvelopeHalfHeightMeters);
  const longitudeDelta = metersToLongitudeDelta(defaultEnvelopeHalfWidthMeters, preview.latitude);

  return [
    [preview.latitude - latitudeDelta, preview.longitude - longitudeDelta],
    [preview.latitude + latitudeDelta, preview.longitude + longitudeDelta],
  ];
}

function buildPositionsBounds(positionSets) {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;

  positionSets.forEach((positions) => {
    positions.forEach(([lat, lng]) => {
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
    });
  });

  if (![south, north, west, east].every(Number.isFinite)) {
    return null;
  }

  return [
    [south, west],
    [north, east],
  ];
}

function expandBoundsByMeters(bounds, paddingMeters) {
  if (!bounds) {
    return null;
  }

  const [[south, west], [north, east]] = bounds;
  const centerLatitude = (south + north) / 2;
  const latitudeDelta = metersToLatitudeDelta(paddingMeters);
  const longitudeDelta = metersToLongitudeDelta(paddingMeters, centerLatitude);

  return [
    [south - latitudeDelta, west - longitudeDelta],
    [north + latitudeDelta, east + longitudeDelta],
  ];
}

function isYardScaleContextEnvelope(propertyContext) {
  const envelope = propertyContext?.match_envelope;
  if (!envelope?.bounds) {
    return false;
  }

  if (
    typeof envelope.width_m === "number" &&
    typeof envelope.height_m === "number"
  ) {
    return (
      envelope.width_m <= yardScaleEnvelopeMaxWidthMeters &&
      envelope.height_m <= yardScaleEnvelopeMaxHeightMeters
    );
  }

  return getBoundsMaxSpan(envelope.bounds) <= parcelScaleBoundsThreshold;
}

function buildNearestBuildingViewportBounds(preview, propertyContext) {
  if (!preview?.latitude || !preview?.longitude) {
    return null;
  }

  const nearbyBuildings = propertyContext?.building_context?.nearby_buildings || [];
  if (!nearbyBuildings.length) {
    return null;
  }

  const preferredBuildings = nearbyBuildings.filter((building) => {
    const kind = String(building.kind || "").toLowerCase();
    return !["garage", "shed", "carport", "service"].includes(kind);
  });
  const candidateBuildings = preferredBuildings.length ? preferredBuildings : nearbyBuildings;
  const closestBuilding = candidateBuildings.reduce((best, candidate) => {
    if (!best) {
      return candidate;
    }

    return (candidate.distance_m ?? Infinity) < (best.distance_m ?? Infinity) ? candidate : best;
  }, null);

  if (
    !closestBuilding ||
    (closestBuilding.distance_m ?? Infinity) > nearestBuildingViewportMaxDistanceMeters
  ) {
    return null;
  }

  const closestBuildingBounds = buildPositionsBounds([
    buildLeafletPositions(closestBuilding.geometry || []),
  ]);
  return expandBoundsByMeters(closestBuildingBounds, nearestBuildingViewportPaddingMeters);
}

function buildViewportBounds({ preview, propertyContext, roofSelection, gardenZones, mode }) {
  if (mode === "garden" && gardenZones.length) {
    const zoneBounds = buildPositionsBounds(
      gardenZones.map((zone) => buildLeafletPositions(zone.geometry || [])),
    );
    if (zoneBounds) {
      return zoneBounds;
    }
  }

  if (mode === "solar" && roofSelection?.geometry) {
    const roofBounds = buildPositionsBounds([
      buildLeafletPositions(roofSelection.geometry),
    ]);
    if (roofBounds) {
      return roofBounds;
    }
  }

  const nearestBuildingBounds =
    mode === "garden" || mode === "solar"
      ? buildNearestBuildingViewportBounds(preview, propertyContext)
      : null;
  if (nearestBuildingBounds) {
    return nearestBuildingBounds;
  }

  const contextEnvelopeBounds = isYardScaleContextEnvelope(propertyContext)
    ? buildBoundsArray(propertyContext?.match_envelope?.bounds)
    : null;
  if (contextEnvelopeBounds) {
    return contextEnvelopeBounds;
  }

  if (shouldUsePreviewBounds(preview)) {
    return buildBoundsArray(preview.bounds);
  }

  return buildSyntheticPreviewBounds(preview);
}

function getGardenZoneColor(zone, index) {
  const sunClassId = zone.analysis?.sunClass?.id;

  if (sunClassId === "full-sun") {
    return "#f2ab27";
  }

  if (sunClassId === "part-sun") {
    return "#1f6c5c";
  }

  if (sunClassId === "part-shade") {
    return "#346b93";
  }

  if (sunClassId === "shade") {
    return "#67758c";
  }

  return gardenZonePalette[index % gardenZonePalette.length];
}

function MapViewport({ preview, propertyContext, roofSelection, gardenZones, mode, focusZoom, maxZoom }) {
  const map = useMap();
  const viewportBounds = useMemo(
    () =>
      buildViewportBounds({
        preview,
        propertyContext,
        roofSelection,
        gardenZones,
        mode,
      }),
    [gardenZones, mode, preview, propertyContext, roofSelection],
  );

  useEffect(() => {
    if (!preview) {
      map.setView(defaultCenter, 4);
      return;
    }

    if (viewportBounds) {
      map.fitBounds(viewportBounds, {
        padding: [32, 32],
        maxZoom: clampZoom(focusZoom, maxZoom),
      });
      return;
    }

    map.setView([preview.latitude, preview.longitude], clampZoom(focusZoom, maxZoom));
  }, [focusZoom, map, maxZoom, preview, viewportBounds]);

  return null;
}

function MapZoomConstraints({ maxZoom }) {
  const map = useMap();

  useEffect(() => {
    map.setMinZoom(4);
    map.setMaxZoom(maxZoom);

    if (map.getZoom() > maxZoom) {
      map.setZoom(maxZoom);
    }
  }, [map, maxZoom]);

  return null;
}

function MapClickCapture({ enabled, onAddPoint }) {
  useMapEvents({
    click(event) {
      if (!enabled) {
        return;
      }

      onAddPoint(normalizeMapPoint(event.latlng));
    },
  });

  return null;
}

export default function PropertyMap({
  preview,
  mode,
  isLocating,
  roofSelection,
  propertyContext,
  gardenZones,
  selectedGardenZoneId,
  drawingTarget,
  drawingPoints,
  onMapPointAdd,
  onUseBrowserLocation,
  onStartRoofDrawing,
  onStartGardenDrawing,
  onFinishDrawing,
  onCancelDrawing,
  onClearRoof,
  onSelectGardenZone,
  onRemoveSelectedGardenZone,
  onClearGardenZones,
}) {
  const [styleId, setStyleId] = useState(mode === "space-weather" ? "terrain" : "streets");
  const [showContextEnvelope, setShowContextEnvelope] = useState(mode === "garden");
  const [showBuildingContext, setShowBuildingContext] = useState(mode === "garden");
  const activeStyle = mapStyles[styleId];
  const isDrawing = Boolean(drawingTarget);
  const isSolarMode = mode === "solar";
  const isSpaceWeatherMode = mode === "space-weather";
  const isGardenMode = mode === "garden";

  useEffect(() => {
    setStyleId(mode === "space-weather" ? "terrain" : "streets");
    setShowContextEnvelope(mode === "garden");
    setShowBuildingContext(mode === "garden");
  }, [mode]);

  const showPreviewBounds = useMemo(() => shouldUsePreviewBounds(preview), [preview]);

  const previewBounds = useMemo(() => {
    if (!showPreviewBounds) {
      return null;
    }

    return [
      [preview.bounds.south, preview.bounds.west],
      [preview.bounds.north, preview.bounds.east],
    ];
  }, [preview, showPreviewBounds]);

  const draftPositions = useMemo(() => buildLeafletPositions(drawingPoints), [drawingPoints]);
  const roofPositions = useMemo(
    () => buildLeafletPositions(roofSelection?.geometry || []),
    [roofSelection],
  );
  const propertyContextBounds = useMemo(() => {
    const bounds = propertyContext?.match_envelope?.bounds;
    if (!bounds) {
      return null;
    }

    return [
      [bounds.south, bounds.west],
      [bounds.north, bounds.east],
    ];
  }, [propertyContext]);

  const selectedGardenZone =
    gardenZones.find((zone) => zone.id === selectedGardenZoneId) || gardenZones[0] || null;

  return (
    <section className="panel map-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Property map</p>
          <h2>{preview ? "Property map" : "Find a property"}</h2>
        </div>
        <p className="panel-copy">
          {preview
            ? isSpaceWeatherMode
              ? "Center the current property and review live alert context."
              : "Draw directly on the live map."
            : "Search an address or use browser location to unlock drawing."}
        </p>
      </div>

      <div className="map-toolbar">
        <div className="map-style-switch" role="tablist" aria-label="Map style">
          {Object.entries(mapStyles).map(([id, style]) => (
            <button
              key={id}
              type="button"
              className={`map-style-button ${styleId === id ? "map-style-button-active" : ""}`}
              onClick={() => setStyleId(id)}
            >
              {style.label}
            </button>
          ))}
        </div>

        <div className="map-toolbar-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onUseBrowserLocation}
            disabled={isLocating}
          >
            {isLocating ? "Finding location..." : "Use my location"}
          </button>

          <div className="map-status" aria-label="Map context">
            <span className="map-status-label">Current focus</span>
            <strong>
              {isSolarMode ? "Solar Buddy" : isSpaceWeatherMode ? "Space Weather" : "Garden Buddy"}
            </strong>
          </div>
        </div>
      </div>

      <div className="map-action-row">
        {isSolarMode ? (
          <>
            {!isDrawing ? (
              <button
                type="button"
                className="primary-button"
                onClick={onStartRoofDrawing}
                disabled={!preview}
              >
                Draw roof area
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="primary-button"
                  onClick={onFinishDrawing}
                  disabled={drawingPoints.length < 3}
                >
                  Finish roof area
                </button>
                <button type="button" className="secondary-button" onClick={onCancelDrawing}>
                  Cancel
                </button>
              </>
            )}

            {roofSelection ? (
              <button type="button" className="ghost-button" onClick={onClearRoof}>
                Clear roof
              </button>
            ) : null}
          </>
        ) : isGardenMode ? (
          <>
            {!isDrawing ? (
              <button
                type="button"
                className="primary-button"
                onClick={onStartGardenDrawing}
                disabled={!preview}
              >
                Draw garden zone
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="primary-button"
                  onClick={onFinishDrawing}
                  disabled={drawingPoints.length < 3}
                >
                  Finish zone
                </button>
                <button type="button" className="secondary-button" onClick={onCancelDrawing}>
                  Cancel
                </button>
              </>
            )}

            {selectedGardenZone ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => onRemoveSelectedGardenZone(selectedGardenZone.id)}
              >
                Remove selected zone
              </button>
            ) : null}

            {gardenZones.length ? (
              <button type="button" className="ghost-button" onClick={onClearGardenZones}>
                Clear all zones
              </button>
            ) : null}
          </>
        ) : null}

        <span className="map-drawing-hint">
          {isDrawing
            ? `Click at least three points on the map to outline the ${
                drawingTarget === "roof" ? "roof plane" : "garden zone"
              }.`
            : isSolarMode
              ? "Locate the property, then draw the usable roof plane."
              : isSpaceWeatherMode
                ? "Locate the property, then review live space weather and surface sunlight."
                : "Locate the property, then draw real yard zones."}
        </span>
      </div>

      {isGardenMode && propertyContext ? (
        <div className="map-context-row">
          <button
            type="button"
            className={`map-style-button ${showContextEnvelope ? "map-style-button-active" : ""}`}
            onClick={() => setShowContextEnvelope((current) => !current)}
          >
            {showContextEnvelope ? "Hide envelope" : "Show envelope"}
          </button>
          <button
            type="button"
            className={`map-style-button ${showBuildingContext ? "map-style-button-active" : ""}`}
            onClick={() => setShowBuildingContext((current) => !current)}
          >
            {showBuildingContext ? "Hide buildings" : "Show buildings"}
          </button>
          <span className="map-context-copy">
            {propertyContext.building_context?.building_count || 0} nearby buildings ·{" "}
            {propertyContext.terrain_context?.terrain_class || "terrain"} terrain
          </span>
        </div>
      ) : null}

      <div className="map-frame">
        <MapContainer
          center={defaultCenter}
          zoom={4}
          minZoom={4}
          maxZoom={activeStyle.maxZoom}
          scrollWheelZoom
          className="property-map"
        >
          <TileLayer
            key={styleId}
            attribution={activeStyle.attribution}
            maxNativeZoom={activeStyle.maxNativeZoom}
            maxZoom={activeStyle.maxZoom}
            url={activeStyle.url}
          />
          <MapZoomConstraints maxZoom={activeStyle.maxZoom} />
          <MapViewport
            preview={preview}
            propertyContext={propertyContext}
            roofSelection={roofSelection}
            gardenZones={gardenZones}
            mode={mode}
            focusZoom={activeStyle.focusZoom}
            maxZoom={activeStyle.maxZoom}
          />
          <MapClickCapture enabled={Boolean(preview && drawingTarget)} onAddPoint={onMapPointAdd} />

          {previewBounds ? (
            <Rectangle bounds={previewBounds} pathOptions={{ color: "#1f6c5c", weight: 2 }} />
          ) : null}

          {showContextEnvelope && propertyContextBounds ? (
            <Rectangle
              bounds={propertyContextBounds}
              pathOptions={{
                color: "#67758c",
                weight: 2,
                dashArray: "8 6",
                fillOpacity: 0,
              }}
            />
          ) : null}

          {showBuildingContext
            ? (propertyContext?.building_context?.nearby_buildings || []).map((building) => (
                <Polygon
                  key={building.id}
                  positions={buildLeafletPositions(building.geometry || [])}
                  pathOptions={{
                    color: "#344253",
                    fillColor: "#344253",
                    fillOpacity: 0.16,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <strong>{building.name || "Nearby building"}</strong>
                    <br />
                    {building.kind || "building"} · {building.height_m} m tall
                    <br />
                    {building.distance_m} m away on the {building.direction_bucket} side
                  </Popup>
                </Polygon>
              ))
            : null}

          {isSolarMode && roofSelection ? (
            <Polygon
              positions={roofPositions}
              pathOptions={{ color: "#f2ab27", fillColor: "#f2ab27", fillOpacity: 0.18, weight: 3 }}
            >
              <Tooltip permanent direction="center">
                Roof area
              </Tooltip>
            </Polygon>
          ) : null}

          {isGardenMode
            ? gardenZones.map((zone, index) => (
            <Polygon
              key={zone.id}
              positions={buildLeafletPositions(zone.geometry || [])}
              pathOptions={{
                color: getGardenZoneColor(zone, index),
                fillColor: getGardenZoneColor(zone, index),
                fillOpacity: zone.id === selectedGardenZoneId ? 0.25 : 0.14,
                weight: zone.id === selectedGardenZoneId ? 3 : 2,
              }}
              eventHandlers={{
                click() {
                  onSelectGardenZone(zone.id);
                },
              }}
            >
              <Tooltip permanent direction="center">
                {zone.name}
              </Tooltip>
              <Popup>
                <strong>{zone.name}</strong>
                <br />
                {zone.areaSquareFeet} sq ft
                {zone.analysis ? (
                  <>
                    <br />
                    {zone.analysis.sunClass.label} •{" "}
                    {zone.analysis.growingSeasonAverageSunHours.toFixed(1)} hrs/day Apr-Sep
                    <br />
                    Obstruction risk: {zone.analysis.obstructionRisk?.label || "Pending"}
                  </>
                ) : null}
              </Popup>
            </Polygon>
              ))
            : null}

          {drawingPoints.length >= 3 ? (
            <Polygon
              positions={draftPositions}
              pathOptions={{
                color: drawingTarget === "roof" ? "#f2ab27" : "#1f6c5c",
                fillColor: drawingTarget === "roof" ? "#f2ab27" : "#1f6c5c",
                fillOpacity: 0.12,
                dashArray: "6 6",
                weight: 2,
              }}
            />
          ) : null}

          {drawingPoints.length >= 2 ? (
            <Polyline
              positions={draftPositions}
              pathOptions={{
                color: drawingTarget === "roof" ? "#f2ab27" : "#1f6c5c",
                dashArray: "6 6",
                weight: 2,
              }}
            />
          ) : null}

          {drawingPoints.map((point, index) => (
            <CircleMarker
              key={`${point.lat}-${point.lng}-${index}`}
              center={[point.lat, point.lng]}
              radius={5}
              pathOptions={{
                color: "#142033",
                fillColor: drawingTarget === "roof" ? "#f2ab27" : "#1f6c5c",
                fillOpacity: 1,
              }}
            />
          ))}

          {preview ? (
            <CircleMarker
              center={[preview.latitude, preview.longitude]}
              radius={9}
              pathOptions={{ color: "#152033", fillColor: "#f5a623", fillOpacity: 0.92 }}
            >
              <Popup>
                <strong>{preview.formatted_address}</strong>
                <br />
                {preview.latitude}, {preview.longitude}
              </Popup>
            </CircleMarker>
          ) : null}
        </MapContainer>
      </div>

      <div className="map-note-row">
        <span className="map-note">
          Street view uses OpenStreetMap. Terrain uses OpenTopoMap for topographic context.
        </span>
        {styleId === "terrain" ? (
          <span className="map-note">
            Terrain can zoom to parcel scale now, but it overzooms past native tile detail so it
            will look softer than Street.
          </span>
        ) : null}
        {isGardenMode && propertyContext ? (
          <span className="map-note">
            Context overlays use nearby OpenStreetMap building footprints and terrain samples. They
            are planning cues, not certified parcel or canopy data.
          </span>
        ) : null}
        {showPreviewBounds ? (
          <span className="map-note">
            The outline shown is the geocoder match envelope, not a parcel boundary.
          </span>
        ) : null}
        {preview?.match_quality && preview.match_quality !== "high" ? (
          <span className="map-note">
            This geocoder match is {preview.match_quality}, so the marker may land near the
            property instead of exactly on it.
          </span>
        ) : null}
      </div>
    </section>
  );
}
