import { getPolygonPoints } from "./geometry.js";

const monthDefinitions = [
  { key: "01", label: "Jan", dayOfYear: 21 },
  { key: "02", label: "Feb", dayOfYear: 52 },
  { key: "03", label: "Mar", dayOfYear: 80 },
  { key: "04", label: "Apr", dayOfYear: 111 },
  { key: "05", label: "May", dayOfYear: 141 },
  { key: "06", label: "Jun", dayOfYear: 172 },
  { key: "07", label: "Jul", dayOfYear: 203 },
  { key: "08", label: "Aug", dayOfYear: 234 },
  { key: "09", label: "Sep", dayOfYear: 265 },
  { key: "10", label: "Oct", dayOfYear: 295 },
  { key: "11", label: "Nov", dayOfYear: 326 },
  { key: "12", label: "Dec", dayOfYear: 355 },
];

const seasonDefinitions = [
  { id: "spring", label: "Spring", months: ["03", "04", "05"] },
  { id: "summer", label: "Summer", months: ["06", "07", "08"] },
  { id: "fall", label: "Fall", months: ["09", "10", "11"] },
  { id: "winter", label: "Winter", months: ["12", "01", "02"] },
];

const sunClasses = [
  {
    id: "full-sun",
    label: "Full sun",
    minimumHours: 7,
    description: "Consistently bright through the main growing season.",
  },
  {
    id: "part-sun",
    label: "Part sun",
    minimumHours: 5,
    description: "Receives several solid sun hours with softer shoulder light.",
  },
  {
    id: "part-shade",
    label: "Part shade",
    minimumHours: 3,
    description: "Gets shorter or more filtered direct-sun windows.",
  },
  {
    id: "shade",
    label: "Shade",
    minimumHours: 0,
    description: "Shows limited direct-sun windows in this first-pass model.",
  },
];

export const shadeProfileOptions = [
  {
    id: "auto",
    label: "Auto / no extra shade",
    shortLabel: "Auto",
    summary: "Use only the mapped context and open-sky model.",
    penalties: { winter: 0, shoulder: 0, summer: 0 },
  },
  {
    id: "light-tree-filter",
    label: "Light tree filter",
    shortLabel: "Light filter",
    summary: "Tree cover softens the light a bit, but the zone still gets strong direct windows.",
    penalties: { winter: 0.1, shoulder: 0.4, summer: 0.8 },
  },
  {
    id: "half-day-tree-shade",
    label: "Half-day tree shade",
    shortLabel: "Half-day shade",
    summary: "Nearby trees cut out a meaningful part of the direct-sun window.",
    penalties: { winter: 0.25, shoulder: 0.9, summer: 1.6 },
  },
  {
    id: "dense-canopy",
    label: "Dense canopy / deep shade",
    shortLabel: "Dense canopy",
    summary: "Tree cover filters or blocks much of the direct sun across the season.",
    penalties: { winter: 0.45, shoulder: 1.6, summer: 2.6 },
  },
];

export const gardenAnalysisModelNote =
  "First-pass open-sky estimate based on latitude and zone placement on the lot. Trees, fences, nearby buildings, and parcel-certified boundaries are not modeled yet.";

const obstructionWeightByDirection = {
  north: { winter: 0.08, shoulder: 0.05, summer: 0.03 },
  northeast: { winter: 0.14, shoulder: 0.12, summer: 0.08 },
  east: { winter: 0.2, shoulder: 0.18, summer: 0.12 },
  southeast: { winter: 0.34, shoulder: 0.3, summer: 0.18 },
  south: { winter: 0.46, shoulder: 0.34, summer: 0.16 },
  southwest: { winter: 0.34, shoulder: 0.3, summer: 0.18 },
  west: { winter: 0.2, shoulder: 0.18, summer: 0.12 },
  northwest: { winter: 0.14, shoulder: 0.12, summer: 0.08 },
};

const canopyWeightByDirection = {
  north: { winter: 0.04, shoulder: 0.08, summer: 0.1 },
  northeast: { winter: 0.08, shoulder: 0.12, summer: 0.16 },
  east: { winter: 0.12, shoulder: 0.18, summer: 0.24 },
  southeast: { winter: 0.16, shoulder: 0.24, summer: 0.32 },
  south: { winter: 0.12, shoulder: 0.2, summer: 0.28 },
  southwest: { winter: 0.16, shoulder: 0.24, summer: 0.32 },
  west: { winter: 0.12, shoulder: 0.18, summer: 0.24 },
  northwest: { winter: 0.08, shoulder: 0.12, summer: 0.16 },
};

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = degreesToRadians(latitudeB - latitudeA);
  const longitudeDelta = degreesToRadians(longitudeB - longitudeA);
  const latitudeARadians = degreesToRadians(latitudeA);
  const latitudeBRadians = degreesToRadians(latitudeB);
  const haversineValue =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversineValue), Math.sqrt(1 - haversineValue))
  );
}

function getBearingDegrees(latitudeA, longitudeA, latitudeB, longitudeB) {
  const latitudeARadians = degreesToRadians(latitudeA);
  const latitudeBRadians = degreesToRadians(latitudeB);
  const longitudeDeltaRadians = degreesToRadians(longitudeB - longitudeA);
  const xValue = Math.sin(longitudeDeltaRadians) * Math.cos(latitudeBRadians);
  const yValue =
    Math.cos(latitudeARadians) * Math.sin(latitudeBRadians) -
    Math.sin(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      Math.cos(longitudeDeltaRadians);

  return (Math.atan2(xValue, yValue) * 180) / Math.PI + 360;
}

function getDirectionBucket(bearingDegrees) {
  const directions = [
    "north",
    "northeast",
    "east",
    "southeast",
    "south",
    "southwest",
    "west",
    "northwest",
  ];

  return directions[Math.floor(((bearingDegrees % 360) + 22.5) / 45) % directions.length];
}

function getMonthSeasonWeight(monthKey) {
  if (["12", "01", "02"].includes(monthKey)) {
    return "winter";
  }

  if (["06", "07", "08"].includes(monthKey)) {
    return "summer";
  }

  return "shoulder";
}

function getSolarDeclination(dayOfYear) {
  return 23.44 * Math.sin(degreesToRadians((360 / 365) * (284 + dayOfYear)));
}

function getDayLengthHours(latitude, dayOfYear) {
  const latitudeRadians = degreesToRadians(clamp(latitude, -66, 66));
  const declinationRadians = degreesToRadians(getSolarDeclination(dayOfYear));
  const solarDiscCorrectionRadians = degreesToRadians(-0.833);

  const numerator =
    Math.sin(solarDiscCorrectionRadians) -
    Math.sin(latitudeRadians) * Math.sin(declinationRadians);
  const denominator = Math.cos(latitudeRadians) * Math.cos(declinationRadians);
  const hourAngleCosine = denominator ? numerator / denominator : 0;

  if (hourAngleCosine >= 1) {
    return 0;
  }

  if (hourAngleCosine <= -1) {
    return 24;
  }

  return (24 / Math.PI) * Math.acos(hourAngleCosine);
}

function getNoonAltitude(latitude, declination) {
  return clamp(90 - Math.abs(latitude - declination), 4, 90);
}

function getSeasonalSouthWeight(monthKey) {
  if (["12", "01", "02"].includes(monthKey)) {
    return 0.12;
  }

  if (["06", "07", "08"].includes(monthKey)) {
    return 0.06;
  }

  return 0.09;
}

function getSunClass(averageSunHours) {
  return (
    sunClasses.find((sunClass) => averageSunHours >= sunClass.minimumHours) ||
    sunClasses[sunClasses.length - 1]
  );
}

function getShadeProfileDefinition(profileId) {
  return (
    shadeProfileOptions.find((profile) => profile.id === profileId) ||
    shadeProfileOptions[0]
  );
}

function getMidpoint(pointA, pointB) {
  return {
    lat: round((pointA.lat + pointB.lat) / 2, 6),
    lng: round((pointA.lng + pointB.lng) / 2, 6),
  };
}

function buildZoneSamplePoints(zone) {
  const polygonPoints = getPolygonPoints(zone.geometry);
  const samples = [];

  polygonPoints.forEach((point, index) => {
    samples.push(point);
    const nextPoint = polygonPoints[(index + 1) % polygonPoints.length];
    if (nextPoint) {
      samples.push(getMidpoint(point, nextPoint));
    }
  });

  if (zone.centroid) {
    samples.push(zone.centroid);
  }

  const uniqueSamples = [];
  samples.forEach((point) => {
    if (!point) {
      return;
    }

    const exists = uniqueSamples.some(
      (candidate) => candidate.lat === point.lat && candidate.lng === point.lng,
    );
    if (!exists) {
      uniqueSamples.push(point);
    }
  });

  return uniqueSamples;
}

function isPointInPolygon(point, polygonPoints) {
  if (!point || polygonPoints.length < 3) {
    return false;
  }

  let inside = false;

  for (let index = 0, previousIndex = polygonPoints.length - 1; index < polygonPoints.length; previousIndex = index, index += 1) {
    const current = polygonPoints[index];
    const previous = polygonPoints[previousIndex];
    const intersects =
      current.lat > point.lat !== previous.lat > point.lat &&
      point.lng <
        ((previous.lng - current.lng) * (point.lat - current.lat)) /
          ((previous.lat - current.lat) || Number.EPSILON) +
          current.lng;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function getCanopyDensityMultiplier(feature) {
  const kind = String(feature?.kind || "").toLowerCase();

  if (kind.includes("forest") || kind.includes("wood")) {
    return 1.35;
  }

  if (kind.includes("tree_row")) {
    return 1.2;
  }

  if (kind.includes("orchard")) {
    return 1.12;
  }

  if (kind.includes("scrub") || kind.includes("vineyard")) {
    return 0.82;
  }

  return 1;
}

function getSunFacingCanopyWeight(directionBucket) {
  return (
    {
      south: 1,
      southeast: 0.92,
      southwest: 0.92,
      east: 0.74,
      west: 0.74,
      northeast: 0.42,
      northwest: 0.42,
      north: 0.18,
    }[directionBucket] || 0.35
  );
}

function buildMappedCanopyRead(zone, canopyFeatures) {
  const zoneCentroid = zone.centroid;
  const zonePolygonPoints = getPolygonPoints(zone.geometry);
  const zoneSamples = buildZoneSamplePoints(zone);

  if (!zoneCentroid || !zoneSamples.length || !canopyFeatures.length) {
    return {
      suggestedShadeProfile: getShadeProfileDefinition("auto"),
      strongestFeature: null,
      overheadCoverageRatio: 0,
      penaltyByMonth: {
        winter: 0,
        shoulder: 0,
        summer: 0,
      },
      summary: "Mapped canopy does not currently show a strong zone-specific shade read here.",
    };
  }

  let strongestFeature = null;
  let strongestPenalty = 0;
  let overheadCoverageRatio = 0;
  const penaltyByMonth = {
    winter: 0,
    shoulder: 0,
    summer: 0,
  };

  canopyFeatures.forEach((feature) => {
    const centroid = feature.centroid;
    if (!centroid) {
      return;
    }

    const distanceMeters = haversineMeters(
      zoneCentroid.lat,
      zoneCentroid.lng,
      centroid.lat,
      centroid.lng,
    );
    if (distanceMeters > 28) {
      return;
    }

    const canopyGeometryPoints = getPolygonPoints(feature.geometry);
    const densityMultiplier = getCanopyDensityMultiplier(feature);
    let zoneCoverageRatio = 0;
    let overheadScore = 0;

    if (canopyGeometryPoints.length >= 3) {
      const coveredSamples = zoneSamples.filter((samplePoint) =>
        isPointInPolygon(samplePoint, canopyGeometryPoints),
      ).length;
      zoneCoverageRatio = coveredSamples / zoneSamples.length;
      if (zoneCoverageRatio > 0) {
        overheadScore = clamp((0.24 + zoneCoverageRatio * 1.04) * densityMultiplier, 0, 1.5);
      }
    } else {
      const canopyInsideZone = zonePolygonPoints.length
        ? isPointInPolygon(centroid, zonePolygonPoints)
        : false;

      if (canopyInsideZone) {
        zoneCoverageRatio = 0.32;
        overheadScore = 0.72 * densityMultiplier;
      } else if (distanceMeters <= 4.5) {
        overheadScore = clamp(((4.5 - distanceMeters) / 4.5) * 0.58 * densityMultiplier, 0, 0.58);
      }
    }

    const bearingDegrees =
      feature.bearing_degrees ??
      getBearingDegrees(zoneCentroid.lat, zoneCentroid.lng, centroid.lat, centroid.lng);
    const directionBucket = feature.direction_bucket || getDirectionBucket(bearingDegrees);
    const sunFacingWeight = getSunFacingCanopyWeight(directionBucket);
    const edgeScore = clamp(((18 - distanceMeters) / 18) * 0.46 * sunFacingWeight * densityMultiplier, 0, 0.46);

    const winterPenalty = overheadScore * 0.22 + edgeScore * 0.22;
    const shoulderPenalty = overheadScore * 0.48 + edgeScore * 0.34;
    const summerPenalty = overheadScore * 0.86 + edgeScore * 0.42;
    const featurePeakPenalty = summerPenalty + shoulderPenalty * 0.45;

    overheadCoverageRatio = Math.max(overheadCoverageRatio, zoneCoverageRatio);
    penaltyByMonth.winter += winterPenalty;
    penaltyByMonth.shoulder += shoulderPenalty;
    penaltyByMonth.summer += summerPenalty;

    if (!strongestFeature || featurePeakPenalty > strongestPenalty) {
      strongestPenalty = featurePeakPenalty;
      strongestFeature = {
        ...feature,
        distance_m: round(distanceMeters, 1),
        direction_bucket: directionBucket,
        zoneCoverageRatio: round(zoneCoverageRatio, 2),
        peakPenalty: round(featurePeakPenalty, 2),
      };
    }
  });

  const normalizedPenaltyByMonth = {
    winter: round(clamp(penaltyByMonth.winter, 0, 0.9), 2),
    shoulder: round(clamp(penaltyByMonth.shoulder, 0, 1.5), 2),
    summer: round(clamp(penaltyByMonth.summer, 0, 2.3), 2),
  };
  const maxPenalty = Math.max(
    normalizedPenaltyByMonth.winter,
    normalizedPenaltyByMonth.shoulder,
    normalizedPenaltyByMonth.summer,
  );
  const suggestedShadeProfileId =
    maxPenalty >= 1.7 || overheadCoverageRatio >= 0.46
      ? "dense-canopy"
      : maxPenalty >= 0.95 || overheadCoverageRatio >= 0.2
        ? "half-day-tree-shade"
        : maxPenalty >= 0.38
          ? "light-tree-filter"
          : "auto";
  const suggestedShadeProfile = getShadeProfileDefinition(suggestedShadeProfileId);
  const strongestFeatureSummary = strongestFeature
    ? `${strongestFeature.name || "Mapped canopy"} is the strongest nearby cue on the ${strongestFeature.direction_bucket} side, about ${round(
        strongestFeature.distance_m || 0,
        0,
      )} m away.`
    : "No single canopy feature stands out as a strong mapped shade cue.";

  return {
    suggestedShadeProfile,
    strongestFeature,
    overheadCoverageRatio: round(overheadCoverageRatio, 2),
    penaltyByMonth: normalizedPenaltyByMonth,
    summary:
      suggestedShadeProfile.id === "auto"
        ? `Mapped canopy still reads fairly open here. ${strongestFeatureSummary}`
        : `Mapped canopy reads closer to ${suggestedShadeProfile.label.toLowerCase()} for this zone. ${strongestFeatureSummary}`,
  };
}

function getPreviewSpans(propertyPreview) {
  const latitudeSpan = propertyPreview?.bounds
    ? Math.max(Math.abs(propertyPreview.bounds.north - propertyPreview.bounds.south), 0.0006)
    : 0.0012;
  const longitudeSpan = propertyPreview?.bounds
    ? Math.max(Math.abs(propertyPreview.bounds.east - propertyPreview.bounds.west), 0.0008)
    : 0.0016;

  return {
    latitudeSpan,
    longitudeSpan,
  };
}

function getSouthOffset(zone, propertyPreview) {
  if (!zone.centroid || !propertyPreview) {
    return 0;
  }

  const { latitudeSpan } = getPreviewSpans(propertyPreview);
  const centerLatitude = propertyPreview.latitude ?? zone.centroid.lat;

  return clamp((centerLatitude - zone.centroid.lat) / (latitudeSpan / 2), -1, 1);
}

function getLotPositionLabel(southOffset) {
  if (southOffset >= 0.35) {
    return "South side of the property";
  }

  if (southOffset <= -0.35) {
    return "North side of the property";
  }

  return "Near the middle of the property";
}

function getConfidence(matchQuality, areaSquareFeet, parcelPlacement = null, shadeProfile = null) {
  let score = 0.28;

  if (matchQuality === "high") {
    score += 0.28;
  } else if (matchQuality === "medium") {
    score += 0.18;
  } else if (matchQuality === "low") {
    score += 0.1;
  }

  if (areaSquareFeet >= 180) {
    score += 0.18;
  } else if (areaSquareFeet >= 80) {
    score += 0.12;
  } else if (areaSquareFeet >= 30) {
    score += 0.06;
  }

  if (parcelPlacement?.id === "core") {
    score += 0.08;
  } else if (parcelPlacement?.id === "outside-core") {
    score -= 0.08;
  } else if (parcelPlacement?.id === "outside-envelope") {
    score -= 0.14;
  }

  if (shadeProfile?.id && shadeProfile.id !== "auto") {
    score += 0.06;
  }

  score = clamp(score, 0.22, 0.9);

  if (score >= 0.66) {
    return {
      label: "Moderate",
      description: "Useful for first-pass planning, but still missing parcel-certified boundaries and tree-perfect shade geometry.",
    };
  }

  if (score >= 0.48) {
    return {
      label: "Early",
      description: "Directional only. Verify against on-site light before treating it as a layout decision.",
    };
  }

  return {
    label: "Low",
    description: "Treat this as a rough placeholder until parcel and shade data improve.",
  };
}

function getObstructionRisk(totalPenaltyHours, shadeProfile = null) {
  const usesObservedShade = shadeProfile?.id && shadeProfile.id !== "auto";

  if (totalPenaltyHours >= 1.1) {
    return {
      id: "high",
      label: "High",
      description: usesObservedShade
        ? "Observed tree cover is strong enough to materially reduce the direct-sun window here."
        : "Nearby structures are strong enough to materially reduce the open-sky estimate.",
    };
  }

  if (totalPenaltyHours >= 0.45) {
    return {
      id: "moderate",
      label: "Moderate",
      description: usesObservedShade
        ? "Observed tree cover likely trims part of the direct-sun window from this zone."
        : "Nearby structures likely trim shoulder or winter light from this zone.",
    };
  }

  return {
    id: "low",
    label: "Low",
    description: usesObservedShade
      ? "The selected shade hint still leaves a fairly open direct-sun window here."
      : "The first-pass obstruction layer does not show a strong structure-driven shade penalty here.",
  };
}

function getTerrainBias(propertyContext) {
  const dominantAspect = propertyContext?.terrain_context?.dominant_aspect || "flat";

  if (dominantAspect === "north-facing") {
    return {
      id: "north-facing",
      label: "North-facing terrain bias",
      winter: -0.22,
      shoulder: -0.14,
      summer: -0.06,
    };
  }

  if (dominantAspect === "south-facing") {
    return {
      id: "south-facing",
      label: "South-facing terrain bias",
      winter: 0.14,
      shoulder: 0.08,
      summer: 0.04,
    };
  }

  if (dominantAspect === "east-facing") {
    return {
      id: "east-facing",
      label: "East-facing terrain bias",
      winter: 0.02,
      shoulder: 0.03,
      summer: 0.02,
    };
  }

  if (dominantAspect === "west-facing") {
    return {
      id: "west-facing",
      label: "West-facing terrain bias",
      winter: 0.02,
      shoulder: 0.03,
      summer: 0.02,
    };
  }

  return {
    id: "neutral",
    label: "Neutral terrain bias",
    winter: 0,
    shoulder: 0,
    summer: 0,
  };
}

function isPointInBounds(point, bounds) {
  if (!point || !bounds) {
    return false;
  }

  return (
    point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    point.lng >= bounds.west &&
    point.lng <= bounds.east
  );
}

function getMetersToBoundsEdge(point, bounds) {
  if (!point || !bounds || !isPointInBounds(point, bounds)) {
    return 0;
  }

  return Math.min(
    haversineMeters(point.lat, point.lng, bounds.north, point.lng),
    haversineMeters(point.lat, point.lng, bounds.south, point.lng),
    haversineMeters(point.lat, point.lng, point.lat, bounds.west),
    haversineMeters(point.lat, point.lng, point.lat, bounds.east),
  );
}

function buildParcelPlacement(zone, propertyContext) {
  const parcelContext = propertyContext?.parcel_context;
  const planningCoreBounds = parcelContext?.planning_core_bounds;
  const envelopeBounds = parcelContext?.bounds || propertyContext?.match_envelope?.bounds;

  if (!parcelContext || !planningCoreBounds) {
    return null;
  }

  const polygonPoints = getPolygonPoints(zone.geometry);
  const samplePoints = [...polygonPoints, zone.centroid].filter(Boolean);
  if (!samplePoints.length) {
    return null;
  }

  const coreCoverageRatio = clamp(
    samplePoints.filter((point) => isPointInBounds(point, planningCoreBounds)).length /
      samplePoints.length,
    0,
    1,
  );
  const envelopeCoverageRatio = clamp(
    samplePoints.filter((point) => isPointInBounds(point, envelopeBounds)).length / samplePoints.length,
    0,
    1,
  );
  const centroidClearanceM = zone.centroid
    ? round(getMetersToBoundsEdge(zone.centroid, planningCoreBounds), 1)
    : 0;
  const edgeBufferM = Number(parcelContext.edge_buffer_m || 0);
  const openSide = parcelContext.open_side || null;
  const terrainLimit = parcelContext.terrain_limit || "low";
  const estimatedPlantableShare = Number(parcelContext.estimated_plantable_share || 0);

  let id = "edge-watch";
  let label = "Edge watch";
  let description =
    "Part of this zone pushes toward the saved planning-envelope edge, so treat placement as provisional.";

  if (envelopeCoverageRatio < 0.65) {
    id = "outside-envelope";
    label = "Outside planning envelope";
    description =
      "This zone extends beyond most of the saved planning envelope, so Garden Buddy treats it as low-confidence siting.";
  } else if (coreCoverageRatio >= 0.82) {
    id = "core";
    label = "Inside planning core";
    description =
      "This zone stays mostly inside the inset planning core, so it is a stronger candidate for repeat planning.";
  } else if (coreCoverageRatio < 0.45) {
    id = "outside-core";
    label = "Outside planning core";
    description =
      "Most of this zone sits outside the inset planning core, so use it as a sketch until parcel placement is tightened.";
  }

  const openSidePhrase = openSide ? `The most open side currently reads ${openSide}.` : "";
  const terrainPhrase =
    terrainLimit === "high"
      ? "Terrain still looks constraining here."
      : terrainLimit === "moderate"
        ? "Terrain adds some siting constraint."
        : "Terrain does not add much siting pressure.";

  return {
    id,
    label,
    description,
    coreCoverageRatio: round(coreCoverageRatio, 2),
    envelopeCoverageRatio: round(envelopeCoverageRatio, 2),
    centroidClearanceM,
    edgeBufferM: round(edgeBufferM, 1),
    openSide,
    terrainLimit,
    estimatedPlantableShare: round(estimatedPlantableShare, 2),
    summary: `${description} ${openSidePhrase} ${terrainPhrase}`.trim(),
  };
}

function averageValues(monthlyValues, monthKeys) {
  const values = monthKeys.map((monthKey) => monthlyValues[monthKey] ?? 0);

  return values.length
    ? round(values.reduce((total, value) => total + value, 0) / values.length)
    : 0;
}

function getBestMonth(monthlySunHours) {
  return monthDefinitions.reduce((bestMonth, month) => {
    const value = monthlySunHours[month.key] ?? 0;

    if (!bestMonth || value > bestMonth.hoursPerDay) {
      return {
        ...month,
        hoursPerDay: value,
      };
    }

    return bestMonth;
  }, null);
}

function getLowestMonth(monthlySunHours) {
  return monthDefinitions.reduce((lowestMonth, month) => {
    const value = monthlySunHours[month.key] ?? 0;

    if (!lowestMonth || value < lowestMonth.hoursPerDay) {
      return {
        ...month,
        hoursPerDay: value,
      };
    }

    return lowestMonth;
  }, null);
}

function buildContextAdjustedSunHours(zone, propertyContext, openSkyMonthlySunHours) {
  const buildings = propertyContext?.building_context?.nearby_buildings || [];
  const canopyFeatures = propertyContext?.canopy_context?.nearby_canopy || [];
  const zoneLatitude = zone.centroid?.lat;
  const zoneLongitude = zone.centroid?.lng;
  const terrainBias = getTerrainBias(propertyContext);
  const observedShadeProfile = getShadeProfileDefinition(zone?.observedShadeProfile);
  const mappedCanopyRead = buildMappedCanopyRead(zone, canopyFeatures);

  if (
    zoneLatitude == null ||
    zoneLongitude == null ||
    (!buildings.length && !canopyFeatures.length && observedShadeProfile.id === "auto")
  ) {
    const adjustedWithoutBuildings = Object.fromEntries(
      Object.entries(openSkyMonthlySunHours).map(([monthKey, hours]) => {
        const seasonWeight = getMonthSeasonWeight(monthKey);
        return [monthKey, round(clamp(hours + terrainBias[seasonWeight], 0.5, hours + 0.3))];
      }),
    );

    return {
      monthlySunHours: adjustedWithoutBuildings,
      openSkyMonthlySunHours,
      totalPenaltyHours: 0,
      strongestBuilding: null,
      strongestCanopy: null,
      terrainBias,
      buildingPenaltyByMonth: Object.fromEntries(
        Object.keys(openSkyMonthlySunHours).map((monthKey) => [monthKey, 0]),
      ),
      canopyPenaltyByMonth: Object.fromEntries(
        Object.keys(openSkyMonthlySunHours).map((monthKey) => [monthKey, 0]),
      ),
      canopyFootprintPenaltyByMonth: Object.fromEntries(
        Object.keys(openSkyMonthlySunHours).map((monthKey) => [monthKey, 0]),
      ),
      observedShadeProfile,
      observedShadePenaltyByMonth: Object.fromEntries(
        Object.keys(openSkyMonthlySunHours).map((monthKey) => [monthKey, 0]),
      ),
      mappedCanopyRead,
    };
  }

  let totalPenaltyHours = 0;
  let strongestBuilding = null;
  let strongestCanopy = null;
  const buildingPenaltyByMonth = {};
  const canopyPenaltyByMonth = {};
  const canopyFootprintPenaltyByMonth = {};
  const observedShadePenaltyByMonth = {};
  const adjustedMonthlySunHours = Object.fromEntries(
    Object.entries(openSkyMonthlySunHours).map(([monthKey, baseHours]) => {
      const seasonWeight = getMonthSeasonWeight(monthKey);
      let monthPenalty = 0;
      let monthCanopyPenalty = 0;

      buildings.forEach((building) => {
        const centroid = building.centroid;
        if (!centroid) {
          return;
        }

        const distanceMeters = haversineMeters(
          zoneLatitude,
          zoneLongitude,
          centroid.lat,
          centroid.lng,
        );
        if (distanceMeters > 95) {
          return;
        }

        const buildingHeight = Number(building.height_m || 0);
        const normalizedPressure = clamp(buildingHeight / Math.max(distanceMeters, 6), 0, 2.4);
        const bearingDegrees = getBearingDegrees(
          zoneLatitude,
          zoneLongitude,
          centroid.lat,
          centroid.lng,
        );
        const directionBucket =
          building.direction_bucket || getDirectionBucket(bearingDegrees);
        const directionalWeight =
          obstructionWeightByDirection[directionBucket]?.[seasonWeight] || 0.08;
        const buildingPenalty = normalizedPressure * directionalWeight;
        monthPenalty += buildingPenalty;

        if (!strongestBuilding || buildingPenalty > strongestBuilding.penalty) {
          strongestBuilding = {
            ...building,
            penalty: buildingPenalty,
            direction_bucket: directionBucket,
            distance_m: round(distanceMeters, 1),
          };
        }
      });

      canopyFeatures.forEach((feature) => {
        const centroid = feature.centroid;
        if (!centroid) {
          return;
        }

        const distanceMeters = haversineMeters(
          zoneLatitude,
          zoneLongitude,
          centroid.lat,
          centroid.lng,
        );
        if (distanceMeters > 70) {
          return;
        }

        const canopyHeight = Number(feature.height_m || 0);
        const normalizedPressure = clamp((canopyHeight / Math.max(distanceMeters, 4)) * 0.7, 0, 1.8);
        const bearingDegrees = getBearingDegrees(
          zoneLatitude,
          zoneLongitude,
          centroid.lat,
          centroid.lng,
        );
        const directionBucket =
          feature.direction_bucket || getDirectionBucket(bearingDegrees);
        const directionalWeight =
          canopyWeightByDirection[directionBucket]?.[seasonWeight] || 0.1;
        const canopyPenalty = normalizedPressure * directionalWeight;
        monthCanopyPenalty += canopyPenalty;

        if (!strongestCanopy || canopyPenalty > strongestCanopy.penalty) {
          strongestCanopy = {
            ...feature,
            penalty: canopyPenalty,
            direction_bucket: directionBucket,
            distance_m: round(distanceMeters, 1),
          };
        }
      });

      const terrainAdjustment = terrainBias[seasonWeight] || 0;
      const canopyFootprintPenalty = mappedCanopyRead.penaltyByMonth?.[seasonWeight] || 0;
      const observedShadePenalty = observedShadeProfile.penalties?.[seasonWeight] || 0;
      totalPenaltyHours = Math.max(
        totalPenaltyHours,
        monthPenalty + monthCanopyPenalty + canopyFootprintPenalty + observedShadePenalty,
      );
      buildingPenaltyByMonth[monthKey] = round(monthPenalty, 2);
      canopyPenaltyByMonth[monthKey] = round(monthCanopyPenalty, 2);
      canopyFootprintPenaltyByMonth[monthKey] = round(canopyFootprintPenalty, 2);
      observedShadePenaltyByMonth[monthKey] = round(observedShadePenalty, 2);

      return [
        monthKey,
        round(
          clamp(
            baseHours -
              monthPenalty -
              monthCanopyPenalty -
              canopyFootprintPenalty -
              observedShadePenalty +
              terrainAdjustment,
            0.5,
            Math.max(baseHours + 0.25, 0.5),
          ),
        ),
      ];
    }),
  );

  return {
    monthlySunHours: adjustedMonthlySunHours,
    openSkyMonthlySunHours,
    totalPenaltyHours: round(totalPenaltyHours, 2),
    strongestBuilding,
    strongestCanopy,
    terrainBias,
    buildingPenaltyByMonth,
    canopyPenaltyByMonth,
    canopyFootprintPenaltyByMonth,
    observedShadeProfile,
    observedShadePenaltyByMonth,
    mappedCanopyRead,
  };
}

function buildMonthlySunHours(zone, propertyPreview) {
  const latitude = clamp(zone.centroid?.lat ?? propertyPreview?.latitude ?? 39.5, -60, 60);
  const southOffset = getSouthOffset(zone, propertyPreview);

  return Object.fromEntries(
    monthDefinitions.map(({ key, dayOfYear }) => {
      const declination = getSolarDeclination(dayOfYear);
      const dayLengthHours = getDayLengthHours(latitude, dayOfYear);
      const noonAltitude = getNoonAltitude(latitude, declination);
      const baseSunWindowFactor = clamp(
        0.18 + Math.sin(degreesToRadians(noonAltitude)) * 0.5,
        0.2,
        0.72,
      );
      const lotPositionFactor = clamp(
        0.92 + southOffset * getSeasonalSouthWeight(key),
        0.74,
        1.04,
      );
      const estimatedSunHours = clamp(
        dayLengthHours * baseSunWindowFactor * lotPositionFactor,
        1,
        Math.max(1.5, dayLengthHours - 0.5),
      );

      return [key, round(estimatedSunHours)];
    }),
  );
}

function buildSeasonalSummaries(monthlySunHours) {
  return seasonDefinitions.map((season) => {
    const averageSunHours = averageValues(monthlySunHours, season.months);

    return {
      id: season.id,
      label: season.label,
      averageSunHours,
      sunClass: getSunClass(averageSunHours),
    };
  });
}

function analyzeGardenZone(zone, propertyPreview, propertyContext) {
  const openSkyMonthlySunHours = buildMonthlySunHours(zone, propertyPreview);
  const contextAdjustment = buildContextAdjustedSunHours(
    zone,
    propertyContext,
    openSkyMonthlySunHours,
  );
  const parcelPlacement = buildParcelPlacement(zone, propertyContext);
  const monthlySunHours = contextAdjustment.monthlySunHours;
  const growingSeasonAverageSunHours = averageValues(monthlySunHours, [
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
  ]);
  const annualAverageSunHours = averageValues(
    monthlySunHours,
    monthDefinitions.map((month) => month.key),
  );
  const openSkyGrowingSeasonAverageSunHours = averageValues(openSkyMonthlySunHours, [
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
  ]);
  const bestMonth = getBestMonth(monthlySunHours);
  const lowestMonth = getLowestMonth(monthlySunHours);
  const southOffset = getSouthOffset(zone, propertyPreview);
  const obstructionRisk = getObstructionRisk(
    contextAdjustment.totalPenaltyHours,
    contextAdjustment.observedShadeProfile,
  );
  const mappedCanopyRead = contextAdjustment.mappedCanopyRead;
  const contextModelNote = propertyContext
    ? contextAdjustment.observedShadeProfile?.id &&
      contextAdjustment.observedShadeProfile.id !== "auto"
      ? "Adjusted from the open-sky model using nearby building footprints, mapped canopy cues, terrain bias, the siting core, and a user-selected shade hint from satellite or on-site review. Parcel-certified boundaries and tree-perfect shade geometry are still not modeled."
      : "Adjusted from the open-sky model using nearby building footprints, mapped canopy cues, terrain bias, and the siting core derived from the saved property envelope. Parcel-certified boundaries and tree-perfect shade geometry are still not modeled."
    : contextAdjustment.observedShadeProfile?.id &&
      contextAdjustment.observedShadeProfile.id !== "auto"
      ? "Adjusted from the open-sky model using a user-selected shade hint from satellite or on-site review. Parcel-certified boundaries and tree-perfect shade geometry are still not modeled."
    : gardenAnalysisModelNote;

  return {
    ...zone,
    analysis: {
      sunClass: getSunClass(growingSeasonAverageSunHours),
      openSkyMonthlySunHours,
      monthlySunHours,
      seasonalSummaries: buildSeasonalSummaries(monthlySunHours),
      annualAverageSunHours,
      growingSeasonAverageSunHours,
      openSkyGrowingSeasonAverageSunHours,
      bestMonth,
      lowestMonth,
      observedShadeProfile: contextAdjustment.observedShadeProfile,
      mappedCanopyRead,
      lotPositionLabel: getLotPositionLabel(southOffset),
      confidence: getConfidence(
        propertyPreview?.match_quality,
        zone.areaSquareFeet || 0,
        parcelPlacement,
        contextAdjustment.observedShadeProfile,
      ),
      obstructionRisk,
      parcelPlacement,
      contextAdjustment: {
        strongestBuilding: contextAdjustment.strongestBuilding,
        strongestCanopy: contextAdjustment.strongestCanopy,
        terrainBias: contextAdjustment.terrainBias,
        maxMonthlyPenaltyHours: contextAdjustment.totalPenaltyHours,
        buildingPenaltyByMonth: contextAdjustment.buildingPenaltyByMonth,
        canopyPenaltyByMonth: contextAdjustment.canopyPenaltyByMonth,
        canopyFootprintPenaltyByMonth: contextAdjustment.canopyFootprintPenaltyByMonth,
        observedShadePenaltyByMonth: contextAdjustment.observedShadePenaltyByMonth,
        buildingCount: propertyContext?.building_context?.building_count || 0,
        canopyCount: propertyContext?.canopy_context?.canopy_count || 0,
        mappedCanopyRead,
      },
      modelNote: contextModelNote,
    },
  };
}

export function analyzeGardenZones(gardenZones, propertyPreview, propertyContext = null) {
  return gardenZones.map((zone) => analyzeGardenZone(zone, propertyPreview, propertyContext));
}
