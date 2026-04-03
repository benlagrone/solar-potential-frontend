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

export const gardenAnalysisModelNote =
  "First-pass open-sky estimate based on latitude and zone placement on the lot. Trees, fences, nearby buildings, and exact parcel data are not modeled yet.";

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

function getConfidence(matchQuality, areaSquareFeet) {
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

  if (score >= 0.66) {
    return {
      label: "Moderate",
      description: "Useful for first-pass planning, but still missing obstruction and canopy data.",
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

function getObstructionRisk(totalPenaltyHours) {
  if (totalPenaltyHours >= 1.1) {
    return {
      id: "high",
      label: "High",
      description: "Nearby structures are strong enough to materially reduce the open-sky estimate.",
    };
  }

  if (totalPenaltyHours >= 0.45) {
    return {
      id: "moderate",
      label: "Moderate",
      description: "Nearby structures likely trim shoulder or winter light from this zone.",
    };
  }

  return {
    id: "low",
    label: "Low",
    description: "The first-pass obstruction layer does not show a strong structure-driven shade penalty here.",
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
  const zoneLatitude = zone.centroid?.lat;
  const zoneLongitude = zone.centroid?.lng;
  const terrainBias = getTerrainBias(propertyContext);

  if (zoneLatitude == null || zoneLongitude == null || !buildings.length) {
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
      terrainBias,
      buildingPenaltyByMonth: Object.fromEntries(
        Object.keys(openSkyMonthlySunHours).map((monthKey) => [monthKey, 0]),
      ),
    };
  }

  let totalPenaltyHours = 0;
  let strongestBuilding = null;
  const buildingPenaltyByMonth = {};
  const adjustedMonthlySunHours = Object.fromEntries(
    Object.entries(openSkyMonthlySunHours).map(([monthKey, baseHours]) => {
      const seasonWeight = getMonthSeasonWeight(monthKey);
      let monthPenalty = 0;

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

      const terrainAdjustment = terrainBias[seasonWeight] || 0;
      totalPenaltyHours = Math.max(totalPenaltyHours, monthPenalty);
      buildingPenaltyByMonth[monthKey] = round(monthPenalty, 2);

      return [
        monthKey,
        round(clamp(baseHours - monthPenalty + terrainAdjustment, 0.5, Math.max(baseHours + 0.25, 0.5))),
      ];
    }),
  );

  return {
    monthlySunHours: adjustedMonthlySunHours,
    openSkyMonthlySunHours,
    totalPenaltyHours: round(totalPenaltyHours, 2),
    strongestBuilding,
    terrainBias,
    buildingPenaltyByMonth,
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
  const obstructionRisk = getObstructionRisk(contextAdjustment.totalPenaltyHours);
  const contextModelNote = propertyContext
    ? "Adjusted from the open-sky model using nearby building footprints and terrain cues. Trees, fences, and parcel-certified boundaries are still not modeled."
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
      lotPositionLabel: getLotPositionLabel(southOffset),
      confidence: getConfidence(propertyPreview?.match_quality, zone.areaSquareFeet || 0),
      obstructionRisk,
      contextAdjustment: {
        strongestBuilding: contextAdjustment.strongestBuilding,
        terrainBias: contextAdjustment.terrainBias,
        maxMonthlyPenaltyHours: contextAdjustment.totalPenaltyHours,
        buildingPenaltyByMonth: contextAdjustment.buildingPenaltyByMonth,
        buildingCount: propertyContext?.building_context?.building_count || 0,
      },
      modelNote: contextModelNote,
    },
  };
}

export function analyzeGardenZones(gardenZones, propertyPreview, propertyContext = null) {
  return gardenZones.map((zone) => analyzeGardenZone(zone, propertyPreview, propertyContext));
}
