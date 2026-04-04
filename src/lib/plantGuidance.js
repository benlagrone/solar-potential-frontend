function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function unique(items) {
  return items.filter((item, index) => item && items.indexOf(item) === index);
}

function getSeasonAverage(analysis, seasonId) {
  return analysis?.seasonalSummaries?.find((season) => season.id === seasonId)?.averageSunHours ?? 0;
}

function parseHardinessZone(label) {
  const match = String(label || "")
    .trim()
    .toLowerCase()
    .match(/^(\d+)([ab])$/);

  if (!match) {
    return null;
  }

  const zoneNumber = Number(match[1]);
  return zoneNumber + (match[2] === "b" ? 0.5 : 0);
}

function getClimateBand(hardinessValue) {
  if (hardinessValue == null) {
    return "middle";
  }

  if (hardinessValue <= 5.5) {
    return "cold";
  }

  if (hardinessValue >= 8) {
    return "warm";
  }

  return "middle";
}

function getSunFit(crop, sunClassId) {
  if (crop.sun?.primary?.includes(sunClassId)) {
    return "primary";
  }

  if (crop.sun?.secondary?.includes(sunClassId)) {
    return "secondary";
  }

  return null;
}

function isPerennial(crop) {
  return crop.lifecycle === "perennial";
}

function getPerennialStatus(crop, hardinessValue) {
  if (!crop.perennialRange) {
    return {
      outdoor: false,
      container: false,
      nearMiss: false,
    };
  }

  if (hardinessValue == null) {
    return {
      outdoor: false,
      container: Boolean(crop.perennialRange.containerFriendlyBelowMin),
      nearMiss: false,
    };
  }

  const { min, max, containerFriendlyBelowMin } = crop.perennialRange;

  return {
    outdoor: hardinessValue >= min && hardinessValue <= max,
    container: Boolean(containerFriendlyBelowMin && hardinessValue < min),
    nearMiss: hardinessValue >= min - 0.5 && hardinessValue < min,
  };
}

const guidanceBySunClass = {
  "full-sun": {
    headline: "Best fit: fruiting crops and high-output summer beds.",
    cropMatches: [
      "Primary crops: tomatoes, peppers, eggplant, cucumbers, squash, beans, okra, and corn.",
      "Strong companion choices: basil, thyme, rosemary, oregano, cut flowers, and pollinator strips.",
    ],
    timingLead:
      "Use the brightest stretch for warm-season crops that need long direct-light windows to size up and ripen well.",
    primaryWarning:
      "Tender greens and cilantro can bolt or scorch here once the peak-summer light settles in.",
  },
  "part-sun": {
    headline: "Best fit: mixed beds that bridge greens, roots, herbs, and selective fruiting crops.",
    cropMatches: [
      "Reliable choices: lettuce, kale, chard, peas, carrots, beets, brassicas, parsley, and dill.",
      "Use the brightest pockets for compact tomatoes, peppers, basil, bush beans, or strawberries.",
    ],
    timingLead:
      "Treat this as a flexible transition zone that can carry cool-season crops and still support some summer production.",
    primaryWarning:
      "Large fruiting crops may ripen slower here than they would in a true full-sun bed.",
  },
  "part-shade": {
    headline: "Best fit: cool-season greens, herbs, nursery space, and gentler summer plantings.",
    cropMatches: [
      "Lean into lettuce, spinach, arugula, bok choy, kale, peas, parsley, cilantro, chives, and mint.",
      "Roots and berries can work if you accept slower finishing and lower total output.",
    ],
    timingLead:
      "This zone is usually more useful for spring and fall production than for heat-loving summer crops.",
    primaryWarning:
      "Tomatoes, peppers, squash, melons, and corn are poor bets unless on-site light looks much stronger than this model.",
  },
  shade: {
    headline: "Best fit: low-light herbs, baby greens, trial containers, or non-fruiting plantings.",
    cropMatches: [
      "Keep expectations small: baby greens, sorrel, mint, chives, lemon balm, and occasional nursery starts fit best.",
      "If you want production here, test temporary containers before building a permanent bed around this light level.",
    ],
    timingLead:
      "Use the brightest months for small harvest pushes and treat the dimmest stretch as maintenance rather than main production.",
    primaryWarning:
      "Expect slow growth and limited fruit set; this is not premium tomato, pepper, melon, or squash space.",
  },
};

function buildTimingMoves(zone) {
  const { analysis } = zone;
  const preset = guidanceBySunClass[analysis.sunClass.id] || guidanceBySunClass.shade;
  const springSun = getSeasonAverage(analysis, "spring");
  const summerSun = getSeasonAverage(analysis, "summer");
  const fallSun = getSeasonAverage(analysis, "fall");
  const bestMonth = analysis.bestMonth?.label || "the brightest month";
  const lowestMonth = analysis.lowestMonth?.label || "the dimmest month";
  const moves = [preset.timingLead];

  if (analysis.sunClass.id === "full-sun") {
    if (springSun >= 5) {
      moves.push(
        "Use the spring shoulder for quick greens or roots, then hand the bed over to warm-season crops after your local frost window.",
      );
    }
    if (fallSun >= 4.5) {
      moves.push(
        "Plan a second round of carrots, brassicas, lettuce, or cilantro after the summer crop clears.",
      );
    }
  } else if (analysis.sunClass.id === "part-sun") {
    if (summerSun >= 6) {
      moves.push(
        "Reserve the brightest summer window for compact fruiting crops and use the shoulders for leafy or root crops.",
      );
    } else {
      moves.push(
        "Bias the season toward greens, herbs, roots, and brassicas instead of long-ripening fruiting crops.",
      );
    }
    if (fallSun >= 4.3) {
      moves.push("Late-summer replanting for fall greens should still stay workable in this zone.");
    }
  } else if (analysis.sunClass.id === "part-shade") {
    moves.push(
      "Treat spring and fall as the prime windows for salad crops, brassicas, peas, herbs, and repeated cut-and-come-again harvests.",
    );
    if (summerSun >= 4) {
      moves.push(
        "Summer is better used for greens that appreciate some protection from hard afternoon light than for fruiting crops.",
      );
    } else {
      moves.push(`The bed peaks around ${bestMonth}, so outside that stretch expect slower turnover.`);
    }
  } else {
    moves.push(`Lean on ${bestMonth} for the small harvest push and treat ${lowestMonth} as reset time.`);
    moves.push(
      "Use this zone for small repeated sowings or portable containers instead of one heavy, permanent planting plan.",
    );
  }

  if (analysis.lowestMonth?.hoursPerDay <= 2.5) {
    moves.push(
      "Low-light months will need protection, containers, or a cover-crop mindset if you expect winter use.",
    );
  }

  return unique(moves).slice(0, 3);
}

function buildLayoutMoves(zone) {
  const { analysis } = zone;
  const moves = [
    "Keep trellises, corn, or any tall crop on the north edge so the rest of the bed does not lose direct light.",
  ];

  if (analysis.lotPositionLabel === "South side of the property") {
    moves.push(
      "South-side exposure will dry faster during peak light, so plan mulch, watering, and heat buffering earlier here.",
    );
  } else if (analysis.lotPositionLabel === "North side of the property") {
    moves.push(
      "Protect the brightest pocket and avoid adding new fences, arches, or shrubs that would steal an already shorter sun window.",
    );
  } else {
    moves.push(
      "Use the center for the highest-light crop in this zone and leave the edges for herbs, flowers, or succession greens.",
    );
  }

  if (zone.areaSquareFeet >= 120) {
    moves.push(
      "Split the zone into at least two rotations so one section can be replanted while the other stays productive.",
    );
  } else if (zone.areaSquareFeet >= 45) {
    moves.push(
      "Reserve the brightest half for the most light-hungry planting and use the shoulder edge for companions or herbs.",
    );
  } else {
    moves.push(
      "Keep the planting mix tight; small zones work better with one main crop family plus a supporting herb or flower.",
    );
  }

  return unique(moves).slice(0, 3);
}

function getConfidenceCue(confidence) {
  if (confidence?.label === "Moderate") {
    return "Good enough for first-pass crop planning, but still confirm with a few on-site light checks before permanent beds or hardscape.";
  }

  if (confidence?.label === "Early") {
    return "Treat this as directional and verify one clear morning plus one clear afternoon on site before committing permanent crops.";
  }

  return "Do not make permanent placement decisions from this alone; use it to shortlist zones and then ground-truth them on site.";
}

function buildWatchOuts(zone) {
  const { analysis } = zone;
  const preset = guidanceBySunClass[analysis.sunClass.id] || guidanceBySunClass.shade;
  const seasonalDrop = Math.max(
    (analysis.bestMonth?.hoursPerDay ?? 0) - (analysis.lowestMonth?.hoursPerDay ?? 0),
    0,
  );
  const watchOuts = [preset.primaryWarning];

  if (seasonalDrop >= 2.5) {
    watchOuts.push(
      `Modeled light drops about ${round(seasonalDrop)} hrs/day from ${analysis.bestMonth.label} to ${analysis.lowestMonth.label}, so a single year-round crop mix will be uneven.`,
    );
  }

  watchOuts.push(getConfidenceCue(analysis.confidence));

  return unique(watchOuts).slice(0, 3);
}

function buildZoneSummary(hardinessLabel, climateBand, sunClassId) {
  if (!hardinessLabel) {
    return "Plant-type recommendations can start now, but exact perennial confidence improves once the property climate call returns a hardiness band.";
  }

  if (climateBand === "cold") {
    return `Estimated hardiness ${hardinessLabel} favors hardy perennials and strong spring or fall succession. Long-season heat lovers need the brightest, warmest bed you have.`;
  }

  if (climateBand === "warm") {
    return `Estimated hardiness ${hardinessLabel} stretches your fall window and opens the door to more outdoor perennial herbs. Keep cool-season crops in gentler light once summer heat arrives.`;
  }

  if (sunClassId === "full-sun") {
    return `Estimated hardiness ${hardinessLabel} gives you room for both shoulder-season crops and a full summer fruiting mix if the bed really keeps this sun level.`;
  }

  return `Estimated hardiness ${hardinessLabel} supports both cool-season succession and several long-season summer crops, but this zone's light class still decides which side of that mix should dominate.`;
}

function buildSeasonSummary(seasonId, climateBand, sunClassId) {
  if (seasonId === "spring") {
    if (climateBand === "cold") {
      return "Use spring to get cool-season crops moving early and reserve your hottest microclimate for transplants that need a longer runway.";
    }

    return "Spring is the handoff season: start cool-season crops early, then give the brightest beds to summer crops once frost risk eases.";
  }

  if (seasonId === "summer") {
    if (sunClassId === "part-shade" || sunClassId === "shade") {
      return "Summer is less about heat lovers here and more about keeping leafy crops productive under gentler light.";
    }

    return "Summer belongs to the most light-hungry crops, with herbs and greens shifted into the softer edges of the zone.";
  }

  if (climateBand === "warm") {
    return "Fall stays open longer in mild zones, so replant quickly and use the longer shoulder for greens, brassicas, roots, and herbs.";
  }

  return "Fall is your reset window for cool-season crops, especially once the hottest beds clear out.";
}

function buildCropDetail(crop, seasonProfile, seasonId, context, sunFit, perennialStatus) {
  const details = [seasonProfile.action];

  if (sunFit === "secondary") {
    details.push("Needs the brightest pocket of this zone to stay worth the footprint.");
  }

  if (crop.heatProfile === "cool-season" && seasonId === "summer") {
    if (context.sunClassId === "part-sun" || context.sunClassId === "part-shade") {
      details.push("Gentler summer light gives it a better chance of staying useful.");
    } else {
      details.push("Watch for bolting or bitterness as heat builds.");
    }
  }

  if ((crop.heatProfile === "warm-season" || crop.heatProfile === "hot-season") && seasonId === "summer") {
    details.push("This is the part of the year when the crop can actually pay off.");
  }

  if (isPerennial(crop)) {
    if (perennialStatus.outdoor && context.hardinessLabel) {
      details.push(`Should overwinter outdoors in estimated zone ${context.hardinessLabel}.`);
    } else if (perennialStatus.nearMiss && context.hardinessLabel) {
      details.push(`Near the edge for zone ${context.hardinessLabel}; protection and drainage will matter.`);
    } else if (perennialStatus.container) {
      details.push("Better treated as a container or protected plant in this climate.");
    } else if (!context.hardinessLabel) {
      details.push("Confirm the hardiness band before treating it as a permanent bed crop.");
    }
  }

  return unique(details).join(" ");
}

function normalizeCropCatalog(catalogPayload) {
  return Array.isArray(catalogPayload?.crops) ? catalogPayload.crops : [];
}

function scoreCropForSeason(crop, seasonId, context) {
  const seasonProfile = crop.seasonalFit?.[seasonId];

  if (!seasonProfile) {
    return null;
  }

  if (seasonProfile.zoneBands && !seasonProfile.zoneBands.includes(context.climateBand)) {
    return null;
  }

  const sunFit = getSunFit(crop, context.sunClassId);

  if (!sunFit) {
    return null;
  }

  const perennialStatus = getPerennialStatus(crop, context.hardinessValue);
  let score = seasonProfile.rating * 10 + (sunFit === "primary" ? 4 : 1);

  if (crop.heatProfile === "long-season" && context.climateBand === "cold") {
    score -= 2;
  }

  if (crop.heatProfile === "hot-season" && context.climateBand === "warm" && seasonId === "summer") {
    score += 3;
  }

  if (crop.heatProfile === "warm-season" && context.sunClassId === "full-sun" && seasonId === "summer") {
    score += 2;
  }

  if (crop.heatProfile === "cool-season" && seasonId === "summer") {
    score += context.sunClassId === "part-sun" || context.sunClassId === "part-shade" ? 2 : -2;

    if (context.climateBand === "warm") {
      score -= 2;
    }
  }

  if (isPerennial(crop)) {
    if (perennialStatus.outdoor) {
      score += seasonId === "spring" || seasonId === "fall" ? 4 : 2;
    } else if (perennialStatus.nearMiss) {
      score += 1;
    } else if (perennialStatus.container) {
      score -= 1;
    } else if (context.hardinessValue != null) {
      score -= 5;
    }
  }

  if (score < 12) {
    return null;
  }

  return {
    id: crop.id,
    name: crop.name,
    detail: buildCropDetail(crop, seasonProfile, seasonId, context, sunFit, perennialStatus),
    score,
  };
}

function buildSeasonPlan(seasonId, label, context, cropCatalog) {
  const crops = cropCatalog
    .map((crop) => scoreCropForSeason(crop, seasonId, context))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 5)
    .map(({ id, name, detail }) => ({
      id,
      name,
      detail,
    }));

  if (!crops.length) {
    return null;
  }

  return {
    id: seasonId,
    label,
    summary: buildSeasonSummary(seasonId, context.climateBand, context.sunClassId),
    crops,
  };
}

function buildPerennialPlan(context, cropCatalog) {
  const candidates = cropCatalog
    .filter((crop) => isPerennial(crop) && getSunFit(crop, context.sunClassId))
    .map((crop) => {
      const perennialStatus = getPerennialStatus(crop, context.hardinessValue);

      if (context.hardinessValue != null && !perennialStatus.outdoor && !perennialStatus.container) {
        return null;
      }

      let score = getSunFit(crop, context.sunClassId) === "primary" ? 10 : 7;

      if (perennialStatus.outdoor) {
        score += 6;
      } else if (perennialStatus.container) {
        score += 2;
      }

      return {
        id: crop.id,
        name: crop.name,
        score,
        detail: buildCropDetail(
          crop,
          crop.seasonalFit.spring || crop.seasonalFit.fall || { action: "Good perennial fit." },
          "spring",
          context,
          getSunFit(crop, context.sunClassId),
          perennialStatus,
        ),
        container: perennialStatus.container,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  const outdoor = candidates.filter((candidate) => !candidate.container).slice(0, 5);
  const container = candidates.filter((candidate) => candidate.container).slice(0, 2);

  if (!outdoor.length && !container.length) {
    return null;
  }

  let summary = "These are the perennial crops most likely to justify permanent bed space in this zone.";

  if (context.hardinessLabel && context.climateBand === "warm") {
    summary = `Estimated hardiness ${context.hardinessLabel} keeps more perennial herbs and fruit crops viable outdoors.`;
  } else if (context.hardinessLabel && context.climateBand === "cold") {
    summary = `Estimated hardiness ${context.hardinessLabel} narrows the permanent-bed list to the hardiest crops.`;
  } else if (!context.hardinessLabel) {
    summary = "Perennial picks stay provisional until the hardiness band finishes loading.";
  }

  return {
    label: "Perennial fit",
    summary,
    outdoor: outdoor.map(({ id, name, detail }) => ({ id, name, detail })),
    container: container.map(({ id, name, detail }) => ({ id, name, detail })),
  };
}

function buildSeasonalPlans(zone, climate, catalogPayload) {
  const hardinessLabel = climate?.hardiness_zone?.label || null;
  const hardinessValue = parseHardinessZone(hardinessLabel);
  const climateBand = getClimateBand(hardinessValue);
  const sunClassId = zone.analysis?.sunClass?.id || "part-sun";
  const cropCatalog = normalizeCropCatalog(catalogPayload);
  const context = {
    climateBand,
    hardinessLabel,
    hardinessValue,
    sunClassId,
  };

  if (!cropCatalog.length) {
    return {
      zoneSummary: buildZoneSummary(hardinessLabel, climateBand, sunClassId),
      seasonModelNote:
        "The persisted crop catalog has not loaded yet, so this view is limited to light and climate guidance.",
      seasons: [],
      perennials: null,
    };
  }

  return {
    zoneSummary: buildZoneSummary(hardinessLabel, climateBand, sunClassId),
    seasonModelNote:
      catalogPayload?.model_note ||
      "This crop catalog is zone-aware and season-aware, but exact sowing and transplant dates still need local frost and soil-temperature calibration.",
    seasons: [
      buildSeasonPlan("spring", "Spring start", context, cropCatalog),
      buildSeasonPlan("summer", "Summer bed", context, cropCatalog),
      buildSeasonPlan("fall", "Fall reset", context, cropCatalog),
    ].filter(Boolean),
    perennials: buildPerennialPlan(context, cropCatalog),
  };
}

export function buildPlantingGuidance(zone, climate = null, catalogPayload = null) {
  if (!zone?.analysis?.sunClass?.id) {
    return null;
  }

  const preset = guidanceBySunClass[zone.analysis.sunClass.id] || guidanceBySunClass.shade;
  const seasonalPlans = buildSeasonalPlans(zone, climate, catalogPayload);

  return {
    headline: preset.headline,
    summary: `${zone.name} reads as ${zone.analysis.sunClass.label.toLowerCase()} with the modeled light peaking in ${
      zone.analysis.bestMonth.label
    } at about ${round(zone.analysis.bestMonth.hoursPerDay)} hrs/day. Match crops to that window instead of expecting every zone to handle the same planting mix.`,
    cropMatches: preset.cropMatches,
    timingMoves: buildTimingMoves(zone),
    layoutMoves: buildLayoutMoves(zone),
    watchOuts: buildWatchOuts(zone),
    zoneSummary: seasonalPlans.zoneSummary,
    seasonModelNote: seasonalPlans.seasonModelNote,
    seasonPlans: seasonalPlans.seasons,
    perennialPlan: seasonalPlans.perennials,
    catalogVersion: catalogPayload?.version || null,
  };
}
