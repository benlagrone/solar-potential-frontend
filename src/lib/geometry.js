const EARTH_RADIUS_METERS = 6371000;
const SQ_METERS_TO_SQ_FEET = 10.7639;

function roundCoordinate(value) {
  return Number(value.toFixed(6));
}

export function normalizeMapPoint(latlng) {
  return {
    lat: roundCoordinate(latlng.lat),
    lng: roundCoordinate(latlng.lng),
  };
}

export function buildPolygonGeometry(points) {
  if (points.length < 3) {
    return null;
  }

  const ring = [...points, points[0]].map((point) => [point.lng, point.lat]);

  return {
    type: "Polygon",
    coordinates: [ring],
  };
}

export function getPolygonPoints(geometry) {
  const ring = geometry?.type === "Polygon" ? geometry.coordinates?.[0] : null;

  if (!Array.isArray(ring) || ring.length < 4) {
    return [];
  }

  const points = ring.map(([lng, lat]) => normalizeMapPoint({ lat, lng }));
  const [firstPoint, ...rest] = points;
  const lastPoint = points[points.length - 1];

  if (lastPoint && firstPoint.lat === lastPoint.lat && firstPoint.lng === lastPoint.lng) {
    return rest.slice(0, -1).length ? [firstPoint, ...rest.slice(0, -1)] : [firstPoint];
  }

  return points;
}

export function buildLeafletPositions(pointsOrGeometry) {
  const points = Array.isArray(pointsOrGeometry)
    ? pointsOrGeometry
    : getPolygonPoints(pointsOrGeometry);

  return points.map((point) => [point.lat, point.lng]);
}

export function polygonCentroid(points) {
  if (!points.length) {
    return null;
  }

  const totals = points.reduce(
    (accumulator, point) => ({
      lat: accumulator.lat + point.lat,
      lng: accumulator.lng + point.lng,
    }),
    { lat: 0, lng: 0 },
  );

  return {
    lat: totals.lat / points.length,
    lng: totals.lng / points.length,
  };
}

function projectPoint(point, originLatitudeRadians) {
  const latitudeRadians = (point.lat * Math.PI) / 180;
  const longitudeRadians = (point.lng * Math.PI) / 180;

  return {
    x: EARTH_RADIUS_METERS * longitudeRadians * Math.cos(originLatitudeRadians),
    y: EARTH_RADIUS_METERS * latitudeRadians,
  };
}

export function polygonAreaSquareMeters(points) {
  if (points.length < 3) {
    return 0;
  }

  const centroid = polygonCentroid(points);
  const originLatitudeRadians = ((centroid?.lat || 0) * Math.PI) / 180;
  const projectedPoints = points.map((point) => projectPoint(point, originLatitudeRadians));

  let area = 0;

  for (let index = 0; index < projectedPoints.length; index += 1) {
    const current = projectedPoints[index];
    const next = projectedPoints[(index + 1) % projectedPoints.length];
    area += current.x * next.y - next.x * current.y;
  }

  return Math.abs(area) / 2;
}

export function squareMetersToSquareFeet(value) {
  return value * SQ_METERS_TO_SQ_FEET;
}

export function buildRoofModel(points) {
  const geometry = buildPolygonGeometry(points);
  const areaSquareMeters = polygonAreaSquareMeters(points);
  const areaSquareFeet = Math.round(squareMetersToSquareFeet(areaSquareMeters));
  const recommendedKw = areaSquareFeet
    ? Number(Math.max(Math.min(areaSquareFeet / 95, 18), 1.5).toFixed(1))
    : 0;

  return {
    geometry,
    centroid: polygonCentroid(points),
    areaSquareMeters: Number(areaSquareMeters.toFixed(1)),
    areaSquareFeet,
    recommendedKw,
  };
}

export function buildGardenZone(points, index) {
  const geometry = buildPolygonGeometry(points);
  const areaSquareMeters = polygonAreaSquareMeters(points);
  const areaSquareFeet = Math.round(squareMetersToSquareFeet(areaSquareMeters));

  return {
    id: `garden-zone-${Date.now()}-${index}`,
    name: `Garden zone ${index + 1}`,
    geometry,
    centroid: polygonCentroid(points),
    areaSquareMeters: Number(areaSquareMeters.toFixed(1)),
    areaSquareFeet,
  };
}
