import { apiBaseUrl, demoMode } from "./config.js";

const demoPropertyRecords = new Map();
const MONTH_DAY_COUNTS = {
  "01": 31,
  "02": 28,
  "03": 31,
  "04": 30,
  "05": 31,
  "06": 30,
  "07": 31,
  "08": 31,
  "09": 30,
  "10": 31,
  "11": 30,
  "12": 31,
};
const ROOF_COVERAGE_FACTOR = 0.565;

function getDeviceType() {
  const userAgent = navigator.userAgent.toLowerCase();

  if (/tablet|ipad/.test(userAgent)) {
    return "tablet";
  }

  if (/mobi|android/.test(userAgent)) {
    return "mobile";
  }

  return "desktop";
}

function getBrowserData() {
  return {
    userAgent: navigator.userAgent,
    screenResolution: `${window.screen.width}x${window.screen.height}`,
    languagePreference: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrerUrl: document.referrer,
    deviceType: getDeviceType(),
  };
}

async function request(path, payload) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail || "Request failed");
  }

  return data;
}

function buildAddressLabel(address) {
  return `${address.street}, ${address.city}, ${address.state} ${address.zip}, ${address.country}`;
}

function normalizeAddressPart(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildAddressLookupKey(address) {
  return ["street", "city", "state", "zip", "country"]
    .map((field) => normalizeAddressPart(address?.[field]))
    .join("|");
}

function getDemoRadiation(address) {
  const seed = `${address.street}|${address.city}|${address.state}|${address.zip}`
    .split("")
    .reduce((total, character) => total + character.charCodeAt(0), 0);

  return 4.2 + (seed % 16) / 10;
}

function buildMonthlyProfile(baseRadiation) {
  const multipliers = {
    "01": 0.67,
    "02": 0.76,
    "03": 0.91,
    "04": 1.02,
    "05": 1.12,
    "06": 1.18,
    "07": 1.19,
    "08": 1.11,
    "09": 0.98,
    "10": 0.86,
    "11": 0.71,
    "12": 0.63,
  };

  return Object.fromEntries(
    Object.entries(multipliers).map(([month, factor]) => [
      month,
      Number((baseRadiation * factor).toFixed(2)),
    ]),
  );
}

function createClientGuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `property-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function rememberDemoPropertyRecord(record) {
  if (!record?.guid) {
    return record;
  }

  demoPropertyRecords.delete(record.guid);
  demoPropertyRecords.set(record.guid, record);
  return record;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function buildEstimatedHardinessLabel(averageAnnualExtremeMinF) {
  const bandIndex = Math.floor((Number(averageAnnualExtremeMinF || 0) + 60) / 5);
  const clampedIndex = clamp(bandIndex, 0, 25);
  const zoneNumber = Math.floor(clampedIndex / 2) + 1;
  const subzone = clampedIndex % 2 === 0 ? "a" : "b";
  const lowerBound = -60 + clampedIndex * 5;
  const upperBound = lowerBound + 5;

  return {
    label: `${zoneNumber}${subzone}`,
    range_f:
      clampedIndex === 0 && averageAnnualExtremeMinF < -60
        ? "Below -60°F"
        : clampedIndex === 25 && averageAnnualExtremeMinF >= 65
          ? "65°F and warmer"
          : `${lowerBound} to ${upperBound}°F`,
  };
}

function normalizePanelEfficiency(panelEfficiency) {
  return clamp(Number(panelEfficiency || 0.2), 0.15, 0.27);
}

function calculateRoofBackedSystemSize(roofSelection, panelEfficiency) {
  if (!roofSelection) {
    return null;
  }

  if (roofSelection.areaSquareMeters) {
    const systemSizeKw =
      roofSelection.areaSquareMeters *
      normalizePanelEfficiency(panelEfficiency) *
      ROOF_COVERAGE_FACTOR;

    return Number(clamp(systemSizeKw, 1.5, 18).toFixed(2));
  }

  if (roofSelection.recommendedKw == null) {
    return null;
  }

  return Number(Number(roofSelection.recommendedKw).toFixed(2));
}

function resolveTemperatureFactor(avgAllSkyRadiation) {
  if (avgAllSkyRadiation >= 5.75) {
    return 0.9;
  }

  if (avgAllSkyRadiation >= 4.75) {
    return 0.92;
  }

  if (avgAllSkyRadiation >= 3.75) {
    return 0.94;
  }

  return 0.96;
}

function buildDemoProductionModel({
  systemSizeKw,
  monthlyAllSky,
  avgAllSkyRadiation,
  panelEfficiency,
  electricityRate,
  roofSelection,
}) {
  const normalizedPanelEfficiency = normalizePanelEfficiency(panelEfficiency);
  const lossFactors = {
    inverter: 0.96,
    electrical: 0.98,
    soiling: 0.97,
    availability: 0.99,
    temperature: resolveTemperatureFactor(avgAllSkyRadiation),
    layout: roofSelection ? 0.96 : 0.9,
  };
  const performanceRatio = Number(
    Object.values(lossFactors)
      .reduce((total, factor) => total * factor, 1)
      .toFixed(3),
  );
  const monthlyProduction = Object.fromEntries(
    Object.entries(monthlyAllSky).map(([month, radiation]) => {
      const monthlyOutput =
        Number(radiation || 0) * systemSizeKw * performanceRatio * (MONTH_DAY_COUNTS[month] || 30);
      return [month, Number(monthlyOutput.toFixed(1))];
    }),
  );
  const monthlySavings = Object.fromEntries(
    Object.entries(monthlyProduction).map(([month, production]) => [
      month,
      Number((production * electricityRate).toFixed(2)),
    ]),
  );
  const annualProduction = Number(
    Object.values(monthlyProduction)
      .reduce((total, value) => total + value, 0)
      .toFixed(2),
  );
  const dailyProduction = Number((annualProduction / 365).toFixed(2));
  const specificYield = systemSizeKw ? Number((annualProduction / systemSizeKw).toFixed(2)) : 0;
  const capacityFactor = systemSizeKw
    ? Number((annualProduction / (systemSizeKw * 24 * 365)).toFixed(4))
    : 0;
  const [peakMonth, peakValue] =
    Object.entries(monthlyProduction).sort((left, right) => right[1] - left[1])[0] || [];
  const [lowestMonth, lowestValue] =
    Object.entries(monthlyProduction).sort((left, right) => left[1] - right[1])[0] || [];

  return {
    id: "roof-backed-monthly-v1",
    label: "Roof-backed monthly model",
    description:
      "Uses month-by-month solar resource data, roof-backed DC sizing, and explicit system-loss assumptions instead of a single annualized screening multiplier.",
    roof_coverage_factor: ROOF_COVERAGE_FACTOR,
    effective_panel_efficiency: normalizedPanelEfficiency,
    performance_ratio: performanceRatio,
    loss_factors: lossFactors,
    monthly_production: monthlyProduction,
    monthly_savings: monthlySavings,
    annual_production: annualProduction,
    daily_production: dailyProduction,
    specific_yield: specificYield,
    capacity_factor: capacityFactor,
    peak_month: {
      month: peakMonth || null,
      value: peakValue ?? 0,
    },
    lowest_month: {
      month: lowestMonth || null,
      value: lowestValue ?? 0,
    },
  };
}

function buildDemoSolarAssumptions({
  systemSizeKw,
  sizingSource,
  roofSelection,
  panel_efficiency,
  electricity_rate,
  installation_cost_per_watt,
  productionModel,
}) {
  const normalizedPanelEfficiency = normalizePanelEfficiency(panel_efficiency);

  return [
    sizingSource === "roof-geometry" && roofSelection
      ? `System size uses the saved roof selection: ${systemSizeKw.toFixed(1)} kW from ${Math.round(
          roofSelection.areaSquareFeet,
        ).toLocaleString()} sq ft, ${(normalizedPanelEfficiency * 100).toFixed(0)}% panel efficiency, and a ${(
          ROOF_COVERAGE_FACTOR * 100
        ).toFixed(0)}% roof coverage allowance.`
      : `System size uses a manual input of ${systemSizeKw.toFixed(1)} kW.`,
    `Monthly production uses month-by-month solar irradiance with an estimated ${(
      (productionModel?.performance_ratio || 0) * 100
    ).toFixed(0)}% performance ratio.`,
    `Panel efficiency is assumed at ${(normalizedPanelEfficiency * 100).toFixed(0)}%.`,
    `Electricity rate is assumed at $${electricity_rate.toFixed(2)}/kWh.`,
    `Installed cost is assumed at $${installation_cost_per_watt.toFixed(2)}/W.`,
    "Solar resource data source is demo with high quality.",
    "Shading, azimuth, roof pitch, utility tariff detail, and roof obstructions are not modeled yet.",
    "This is a stronger planning model, but it is still not an installer quote or permit-ready design.",
  ];
}

function buildDemoSolarConfidence({ matchQuality, sizingSource, roofSelection, productionModel }) {
  let score = 38;
  const factors = [];

  if (sizingSource === "roof-geometry" && roofSelection) {
    score += 22;
    factors.push("System size is derived from the saved roof geometry and panel efficiency.");
  } else {
    score += 6;
    factors.push("System size is using a manual fallback instead of saved roof geometry.");
  }

  if (productionModel) {
    score += 8;
    factors.push("Production uses month-by-month solar resource data and explicit system-loss assumptions.");
  }

  if (matchQuality === "high") {
    score += 18;
    factors.push("Address match quality is strong for the current property.");
  } else if (matchQuality === "medium") {
    score += 10;
    factors.push("Address match quality is approximate, so parcel precision is lower.");
  } else {
    factors.push("Address match quality is loose, so location precision is limited.");
  }

  score += 18;
  factors.push("Solar resource data quality is high.");
  factors.push("Solar data came from the demo estimate path.");

  if ((roofSelection?.areaSquareFeet || 0) < 350) {
    score -= 4;
    factors.push("The selected roof area is small, so the estimate is more sensitive to drawing changes.");
  }

  score = Math.max(20, Math.min(95, score));

  if (score >= 80) {
    return {
      id: "high",
      label: "High",
      score,
      description:
        "Useful planning estimate with roof-backed sizing, monthly production modeling, and solid source inputs.",
      factors,
    };
  }

  if (score >= 60) {
    return {
      id: "medium",
      label: "Medium",
      score,
      description:
        "Useful planning estimate, but one or more source or property inputs are still approximate.",
      factors,
    };
  }

  return {
    id: "low",
    label: "Low",
    score,
    description: "Treat this as a rough screening estimate until the inputs are improved.",
    factors,
  };
}

function buildDemoEstimate(formValues) {
  const {
    guid,
    address,
    roofSelection,
    system_size,
    panel_efficiency,
    electricity_rate,
    installation_cost_per_watt,
  } = formValues;

  const effectiveRoofSelection =
    roofSelection || (guid ? demoPropertyRecords.get(guid)?.roof_selection : null);
  const matchQuality =
    (guid ? demoPropertyRecords.get(guid)?.property_preview?.match_quality : null) || "high";
  const sizingSource = effectiveRoofSelection ? "roof-geometry" : "manual";
  const systemSizeKw = Number(
    (calculateRoofBackedSystemSize(effectiveRoofSelection, panel_efficiency) ??
      system_size ??
      0).toFixed(2),
  );

  if (!systemSizeKw) {
    throw new Error("Draw a roof area first.");
  }

  const avgAllSkyRadiation = Number(getDemoRadiation(address).toFixed(2));
  const avgClearSkyRadiation = Number((avgAllSkyRadiation + 1.15).toFixed(2));
  const monthlyAllSky = buildMonthlyProfile(avgAllSkyRadiation);
  const monthlyClearSky = buildMonthlyProfile(avgClearSkyRadiation);
  const productionModel = buildDemoProductionModel({
    systemSizeKw,
    monthlyAllSky,
    avgAllSkyRadiation,
    panelEfficiency: panel_efficiency,
    electricityRate: electricity_rate,
    roofSelection: effectiveRoofSelection,
  });
  const dailyProduction = productionModel.daily_production;
  const annualProduction = productionModel.annual_production;
  const annualSavings = Number((annualProduction * electricity_rate).toFixed(2));
  const systemCost = Number((systemSizeKw * 1000 * installation_cost_per_watt).toFixed(2));
  const paybackPeriod = annualSavings ? Number((systemCost / annualSavings).toFixed(2)) : null;
  const totalSavings = Number(
    Array.from({ length: 25 }, (_, year) => annualSavings * 1.02 ** year)
      .reduce((total, value) => total + value, 0)
      .toFixed(2),
  );
  const assumptions = buildDemoSolarAssumptions({
    systemSizeKw,
    sizingSource,
    roofSelection: effectiveRoofSelection,
    panel_efficiency,
    electricity_rate,
    installation_cost_per_watt,
    productionModel,
  });
  const confidence = buildDemoSolarConfidence({
    matchQuality,
    sizingSource,
    roofSelection: effectiveRoofSelection,
    productionModel,
  });

  return {
    address: buildAddressLabel(address),
    latitude: 30.2672,
    longitude: -97.7431,
    avg_all_sky_radiation: avgAllSkyRadiation,
    avg_clear_sky_radiation: avgClearSkyRadiation,
    all_sky_data_quality: 94,
    clear_sky_data_quality: 97,
    monthly_all_sky: monthlyAllSky,
    monthly_clear_sky: monthlyClearSky,
    best_all_sky: Math.max(...Object.values(monthlyAllSky)),
    worst_all_sky: Math.min(...Object.values(monthlyAllSky)),
    best_clear_sky: Math.max(...Object.values(monthlyClearSky)),
    worst_clear_sky: Math.min(...Object.values(monthlyClearSky)),
    monthly_production: productionModel.monthly_production,
    monthly_savings: productionModel.monthly_savings,
    unit: "kWh/m²/day",
    period: "demo annual profile",
    match_quality: matchQuality,
    system_size_kw: systemSizeKw,
    sizing_source: sizingSource,
    roof_area_square_feet: effectiveRoofSelection?.areaSquareFeet ?? null,
    roof_area_square_meters: effectiveRoofSelection?.areaSquareMeters ?? null,
    assumptions,
    confidence,
    production_model: productionModel,
    daily_production: dailyProduction,
    annual_production: annualProduction,
    annual_savings: annualSavings,
    system_cost: systemCost,
    payback_period: paybackPeriod,
    total_savings_25_years: totalSavings,
    specific_yield: productionModel.specific_yield,
    capacity_factor: productionModel.capacity_factor,
    peak_month: productionModel.peak_month,
    lowest_month: productionModel.lowest_month,
    time_zone: "America/Chicago",
    data_source: "demo",
    data_quality: "demo",
  };
}

function upsertDemoPropertyRecord({
  guid,
  address,
  propertyPreview,
  propertyContext,
  propertyClimate,
  roofSelection,
  gardenZones,
}) {
  const nextGuid = guid || createClientGuid();
  const existingRecord = demoPropertyRecords.get(nextGuid);
  const record = {
    guid: nextGuid,
    address: { ...address },
    property_preview: propertyPreview ?? existingRecord?.property_preview ?? null,
    property_context:
      propertyContext !== undefined ? propertyContext : existingRecord?.property_context ?? null,
    property_climate:
      propertyClimate !== undefined ? propertyClimate : existingRecord?.property_climate ?? null,
    roof_selection:
      roofSelection !== undefined ? roofSelection : existingRecord?.roof_selection ?? null,
    garden_zones: gardenZones ?? existingRecord?.garden_zones ?? [],
    saved_solar_reports: existingRecord?.saved_solar_reports ?? [],
    stored_at: new Date().toISOString(),
  };

  return rememberDemoPropertyRecord(record);
}

function createDemoSolarReportName(address) {
  const street = address?.street || "Property";
  const timestamp = new Date().toLocaleString();
  return `${street} solar report · ${timestamp}`;
}

function buildDemoHomeownerQuote(address, report, existingQuote = null) {
  const timestamp = new Date().toISOString();
  const street = address?.street || "Property";
  const quoteId = existingQuote?.id || createClientGuid();
  const annualSavings = Math.round(report.annual_savings || 0);
  const annualProduction = Math.round(report.annual_production || 0);

  return {
    id: quoteId,
    headline: existingQuote?.headline || `${street} homeowner quote`,
    created_at: existingQuote?.created_at || timestamp,
    updated_at: timestamp,
    status: "share-ready",
    share_path: `/quote/${quoteId}`,
    summary: `${Number(report.system_size_kw || 0).toFixed(1)} kW, ${annualProduction.toLocaleString()} kWh/year, ${annualSavings.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}/year savings.`,
    confidence_label: report.confidence?.label || "Planning",
    disclaimer:
      "This is a shareable planning quote based on the saved roof geometry and current model assumptions. Final pricing, layout, and installer scope still require site review.",
  };
}

function saveDemoSolarReport({
  guid,
  panel_efficiency,
  electricity_rate,
  installation_cost_per_watt,
  roofSelection,
  reportName,
}) {
  const record = guid ? demoPropertyRecords.get(guid) : null;

  if (!record) {
    throw new Error("Property record not found");
  }

  const estimate = buildDemoEstimate({
    guid,
    address: record.address,
    roofSelection: roofSelection ?? record.roof_selection,
    system_size: roofSelection?.recommendedKw ?? record.roof_selection?.recommendedKw ?? null,
    panel_efficiency,
    electricity_rate,
    installation_cost_per_watt,
  });
  const report = {
    id: createClientGuid(),
    name: reportName || createDemoSolarReportName(record.address),
    created_at: new Date().toISOString(),
    address: estimate.address,
    system_size_kw: estimate.system_size_kw,
    annual_production: estimate.annual_production,
    annual_savings: estimate.annual_savings,
    system_cost: estimate.system_cost,
    payback_period: estimate.payback_period,
    confidence: estimate.confidence,
    data_source: estimate.data_source,
    data_quality: estimate.data_quality,
    roof_area_square_feet: estimate.roof_area_square_feet,
    roof_area_square_meters: estimate.roof_area_square_meters,
    production_model: estimate.production_model,
    monthly_production: estimate.monthly_production,
    monthly_savings: estimate.monthly_savings,
    specific_yield: estimate.specific_yield,
    capacity_factor: estimate.capacity_factor,
    assumptions: estimate.assumptions,
    summary: `${Math.round(estimate.annual_production).toLocaleString()} kWh/year, ${Math.round(
      estimate.annual_savings,
    ).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}/year savings, ${estimate.confidence.label} confidence.`,
  };
  const reports = [report, ...(record.saved_solar_reports || [])].slice(0, 8);

  rememberDemoPropertyRecord({
    ...record,
    saved_solar_reports: reports,
    stored_at: new Date().toISOString(),
  });

  return { report, reports, estimate };
}

function createDemoSolarQuote({ guid, reportId }) {
  const record = guid ? demoPropertyRecords.get(guid) : null;

  if (!record) {
    throw new Error("Property record not found");
  }

  const reports = record.saved_solar_reports || [];
  const targetReport = reports.find((report) => report.id === reportId);

  if (!targetReport) {
    throw new Error("Saved solar report not found");
  }

  const quote = buildDemoHomeownerQuote(record.address, targetReport, targetReport.homeowner_quote);
  const nextReports = reports.map((report) =>
    report.id === reportId
      ? {
          ...report,
          homeowner_quote: quote,
        }
      : report,
  );
  const updatedReport = nextReports.find((report) => report.id === reportId) || null;

  rememberDemoPropertyRecord({
    ...record,
    saved_solar_reports: nextReports,
    stored_at: new Date().toISOString(),
  });

  return {
    quote,
    report: updatedReport,
    reports: nextReports,
  };
}

function fetchDemoSolarQuote(quoteId) {
  for (const record of demoPropertyRecords.values()) {
    const report = (record.saved_solar_reports || []).find(
      (candidate) => candidate.homeowner_quote?.id === quoteId,
    );

    if (!report) {
      continue;
    }

    return {
      quote: report.homeowner_quote,
      report,
      address: record.address,
      property_preview: record.property_preview ?? null,
    };
  }

  throw new Error("Solar quote not found");
}

function findDemoPropertyRecordByAddress(address) {
  const lookupKey = buildAddressLookupKey(address);

  if (!lookupKey) {
    return null;
  }

  return (
    Array.from(demoPropertyRecords.values())
      .reverse()
      .find((record) => buildAddressLookupKey(record.address) === lookupKey) || null
  );
}

function listDemoPropertyRecords({ maxItems = 8, requireGardenZones = false } = {}) {
  return Array.from(demoPropertyRecords.values())
    .reverse()
    .filter((record) => !requireGardenZones || (record.garden_zones || []).length > 0)
    .slice(0, maxItems);
}

function buildDemoPropertyPreview(address) {
  const seed = `${address.street}|${address.city}|${address.state}|${address.zip}|${address.country}`
    .split("")
    .reduce((total, character) => total + character.charCodeAt(0), 0);

  const latitude = Number((30.2672 + ((seed % 9) - 4) * 0.0031).toFixed(6));
  const longitude = Number((-97.7431 + (((seed >> 3) % 9) - 4) * 0.0036).toFixed(6));

  return {
    query: buildAddressLabel(address),
    formatted_address: buildAddressLabel(address),
    latitude,
    longitude,
    bounds: {
      south: Number((latitude - 0.0015).toFixed(6)),
      north: Number((latitude + 0.0015).toFixed(6)),
      west: Number((longitude - 0.0019).toFixed(6)),
      east: Number((longitude + 0.0019).toFixed(6)),
    },
    source: "demo",
    match_quality: "high",
    match_score: null,
    address: { ...address },
  };
}

function buildDemoBrowserLocationPreview(coordinates) {
  const latitude = Number(coordinates.latitude.toFixed(6));
  const longitude = Number(coordinates.longitude.toFixed(6));

  return {
    query: `${latitude}, ${longitude}`,
    formatted_address: "Current browser location (demo)",
    latitude,
    longitude,
    bounds: {
      south: Number((latitude - 0.0015).toFixed(6)),
      north: Number((latitude + 0.0015).toFixed(6)),
      west: Number((longitude - 0.0019).toFixed(6)),
      east: Number((longitude + 0.0019).toFixed(6)),
    },
    source: "browser-location-demo",
    match_quality: "high",
    match_score: null,
    address: {
      street: "Current browser location",
      city: "Demo City",
      state: "TX",
      zip: "00000",
      country: "United States",
    },
  };
}

function buildDemoSpaceWeather(coordinates) {
  const now = new Date();
  const fetchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 60 * 1000).toISOString();
  const seed = Math.abs(
    Math.round((Number(coordinates.latitude || 0) + Number(coordinates.longitude || 0)) * 100),
  );
  const localHour = now.getHours();
  const isDaylight = localHour >= 6 && localHour < 18;
  const radioBlackoutScale = seed % 4 === 0 ? 2 : 0;
  const radiationStormScale = seed % 9 === 0 ? 1 : 0;
  const geomagneticStormScale = seed % 3;
  const alertLevel =
    radioBlackoutScale >= 2 && isDaylight
      ? "alert"
      : geomagneticStormScale >= 2 || radiationStormScale >= 1
        ? "watch"
        : "low";

  return {
    latitude: Number(coordinates.latitude.toFixed(6)),
    longitude: Number(coordinates.longitude.toFixed(6)),
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    observed_at: fetchedAt,
    global: {
      radio_blackout_scale: {
        scale: radioBlackoutScale,
        label: radioBlackoutScale >= 2 ? "moderate" : "none",
      },
      radiation_storm_scale: {
        scale: radiationStormScale,
        label: radiationStormScale >= 1 ? "minor" : "none",
      },
      geomagnetic_storm_scale: {
        scale: geomagneticStormScale,
        label: geomagneticStormScale >= 2 ? "moderate" : geomagneticStormScale >= 1 ? "minor" : "none",
      },
      solar_wind: {
        observed_at: fetchedAt,
        density_p_cm3: Number((2.2 + (seed % 7) * 0.4).toFixed(2)),
        speed_km_s: Number((405 + (seed % 6) * 18).toFixed(1)),
        temperature_k: 145000 + (seed % 5) * 12000,
      },
      current_xray_class: radioBlackoutScale >= 2 ? "M2.1" : "C3.4",
      peak_xray_24h_class: radioBlackoutScale >= 2 ? "M4.3" : "C5.0",
      lookahead: {
        day_1: {
          radio_blackout: { scale: radioBlackoutScale, label: radioBlackoutScale >= 2 ? "moderate" : "none" },
          radiation_storm: { scale: radiationStormScale, label: radiationStormScale >= 1 ? "minor" : "none" },
          geomagnetic_storm: { scale: geomagneticStormScale, label: geomagneticStormScale >= 2 ? "moderate" : geomagneticStormScale >= 1 ? "minor" : "none" },
        },
      },
    },
    local: {
      is_daylight: isDaylight,
      latitude_band: Math.abs(coordinates.latitude) >= 40 ? "mid" : "low",
      aurora_viewline: {
        source: "demo",
        forecast_status: "available",
        basis: "ovation-footprint-inference",
        local_aurora_value: !isDaylight && geomagneticStormScale >= 2 ? 6 : 0,
        distance_to_viewline_km:
          !isDaylight && geomagneticStormScale >= 2
            ? 420
            : Math.abs(coordinates.latitude) >= 45
              ? 820
              : 1680,
        southern_edge_latitude: Math.abs(coordinates.latitude) >= 45 ? 42 : 55,
        reach:
          !isDaylight && geomagneticStormScale >= 2
            ? "nearby-viewline"
            : Math.abs(coordinates.latitude) >= 45
              ? "distant-viewline"
              : "far",
        reach_label:
          !isDaylight && geomagneticStormScale >= 2
            ? "nearby viewline"
            : Math.abs(coordinates.latitude) >= 45
              ? "distant viewline"
              : "far",
        reach_tone: !isDaylight && geomagneticStormScale >= 2 ? "watch" : "low",
        visibility: !isDaylight && geomagneticStormScale >= 2 ? "possible" : "low",
        detail:
          !isDaylight && geomagneticStormScale >= 2
            ? "The NOAA-style aurora footprint sits close enough to this longitude band that darker skies could matter tonight."
            : "The current aurora footprint stays poleward of this property in demo mode.",
      },
      aurora_visibility_potential:
        !isDaylight && geomagneticStormScale >= 2 ? "possible" : "low",
      hf_radio_risk:
        radioBlackoutScale >= 2 && isDaylight ? "moderate" : "low",
      gnss_risk: geomagneticStormScale >= 2 ? "moderate" : "low",
      ground_radiation_note: "No elevated residential ground-level concern.",
    },
    alert_level: alertLevel,
    alert_count: radiationStormScale >= 1 ? 1 : 0,
    watch_count: geomagneticStormScale >= 2 ? 1 : 0,
    warning_count: radioBlackoutScale >= 2 ? 1 : 0,
    freshness: {
      status: "fresh",
      checked_at: fetchedAt,
      fetched_at: fetchedAt,
      latest_fetched_at: fetchedAt,
      expires_at: expiresAt,
      age_seconds: 0,
      seconds_until_expiry: 60,
      is_stale: false,
      refresh_failed: false,
      source_count: 1,
      sources: {
        demo: {
          source: "demo",
          status: "fresh",
          fetched_at: fetchedAt,
          expires_at: expiresAt,
          ttl_seconds: 60,
          age_seconds: 0,
          seconds_until_expiry: 60,
          is_stale: false,
          cache_hit: false,
          refresh_failed: false,
        },
      },
    },
    reasons: [
      {
        id: "daylight-side",
        label: isDaylight ? "Daylight side" : "Night side",
        tone: isDaylight && radioBlackoutScale >= 2 ? "moderate" : "neutral",
        detail: isDaylight
          ? "This property is on the daylight side, so flare-driven radio blackout effects matter more locally."
          : "This property is on the night side, so flare-driven radio blackout effects are muted locally.",
      },
      {
        id: "latitude-band",
        label: `Latitude ${Math.abs(coordinates.latitude) >= 40 ? "mid" : "low"}`,
        tone: geomagneticStormScale >= 2 ? "watch" : "neutral",
        detail:
          Math.abs(coordinates.latitude) >= 40
            ? "This latitude band can start to see aurora and GNSS relevance when geomagnetic activity rises."
            : "This latitude band usually needs stronger geomagnetic conditions before local effects matter.",
      },
      {
        id: "aurora-reach",
        label: !isDaylight && geomagneticStormScale >= 2 ? "Aurora possible" : "Aurora low",
        tone: !isDaylight && geomagneticStormScale >= 2 ? "possible" : "low",
        detail:
          !isDaylight && geomagneticStormScale >= 2
            ? "Nighttime geomagnetic conditions could support visible aurora farther south than usual."
            : "Aurora reach is not a strong local signal at the moment.",
      },
      {
        id: "gnss",
        label: geomagneticStormScale >= 2 ? "GNSS moderate" : "GNSS low",
        tone: geomagneticStormScale >= 2 ? "moderate" : "low",
        detail:
          geomagneticStormScale >= 2
            ? "Navigation and timing systems are the main local risk path under these geomagnetic conditions."
            : "Current geomagnetic conditions do not suggest meaningful local GNSS disruption.",
      },
    ],
    recent_headlines:
      alertLevel === "alert"
        ? ["WARNING: Radio blackout conditions are elevated on the sunlit side."]
        : ["WATCH: Geomagnetic activity may increase local aurora and GNSS effects."],
    recent_activity: {
      latest_flare_event: {
        class: radioBlackoutScale >= 2 ? "M4.3" : "C5.0",
        peak_time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      latest_geomagnetic_storm:
        geomagneticStormScale >= 1
          ? {
              start_time: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
              max_kp_index: Number((4.67 + geomagneticStormScale).toFixed(2)),
            }
          : null,
    },
    summary:
      alertLevel === "alert"
        ? "Space-weather conditions are elevated enough to matter locally, but this is still not a residential ground-level radiation alarm."
        : alertLevel === "watch"
          ? "Geomagnetic conditions are elevated, with moderate relevance to this location."
          : "Space-weather conditions are quiet to minor for this location right now.",
    sources: ["demo"],
  };
}

function buildDemoSurfaceIrradiance(coordinates) {
  const seed = Math.abs(
    Math.round((Number(coordinates.latitude || 0) * 11 + Number(coordinates.longitude || 0) * 7) * 10),
  );
  const now = new Date();
  const fetchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const localHour = now.getHours();
  const isDaylight = localHour >= 6 && localHour < 19;
  const baseGhi = isDaylight ? 280 + (seed % 6) * 90 : 0;
  const currentGhi = Number(baseGhi.toFixed(1));
  const currentDni = Number((currentGhi * 0.82).toFixed(1));
  const nextHourGhi = Number((isDaylight ? currentGhi + ((seed % 3) - 1) * 120 : 0).toFixed(1));
  const peakHourOffset = isDaylight ? 2 : Math.max(1, 8 - localHour);
  const peakDate = new Date(now.getTime() + peakHourOffset * 60 * 60 * 1000);
  const peakGhi = Number((Math.max(currentGhi, 720 + (seed % 3) * 65)).toFixed(1));
  const spikeLevel = peakGhi >= 850 ? "alert" : peakGhi >= 700 ? "watch" : "low";
  const hourlyProfile = Array.from({ length: 8 }, (_, index) => {
    const hourDate = new Date(now.getTime() + index * 60 * 60 * 1000);
    const rawGhi = isDaylight ? Math.max(0, currentGhi + (index - 2) * 55) : 0;
    return {
      time: `${hourDate.getFullYear()}-${String(hourDate.getMonth() + 1).padStart(2, "0")}-${String(
        hourDate.getDate(),
      ).padStart(2, "0")}T${String(hourDate.getHours()).padStart(2, "0")}:00`,
      ghi_w_m2: Number(rawGhi.toFixed(1)),
      dni_w_m2: Number((rawGhi * 0.82).toFixed(1)),
    };
  });

  return {
    latitude: Number(coordinates.latitude.toFixed(6)),
    longitude: Number(coordinates.longitude.toFixed(6)),
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    observed_at: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    source: "demo",
    is_daylight: isDaylight,
    current: {
      ghi_w_m2: currentGhi,
      dni_w_m2: currentDni,
      intensity_level: currentGhi >= 700 ? "high" : currentGhi >= 350 ? "moderate" : "low",
    },
    trend: {
      previous_hour_ghi_w_m2: Number((Math.max(0, currentGhi - 140)).toFixed(1)),
      change_from_previous_hour_w_m2: Number((140).toFixed(1)),
      next_hour_ghi_w_m2: nextHourGhi,
      change_to_next_hour_w_m2: Number((nextHourGhi - currentGhi).toFixed(1)),
      max_hourly_ramp_w_m2: Number((Math.abs(nextHourGhi - currentGhi) + 60).toFixed(1)),
      ramp_start_time: hourlyProfile[0]?.time || null,
      ramp_end_time: hourlyProfile[1]?.time || null,
    },
    next_peak: {
      time: `${peakDate.getFullYear()}-${String(peakDate.getMonth() + 1).padStart(2, "0")}-${String(
        peakDate.getDate(),
      ).padStart(2, "0")}T${String(peakDate.getHours()).padStart(2, "0")}:00`,
      ghi_w_m2: peakGhi,
      dni_w_m2: Number((peakGhi * 0.84).toFixed(1)),
    },
    spike_level: spikeLevel,
    freshness: {
      status: "fresh",
      checked_at: fetchedAt,
      fetched_at: fetchedAt,
      latest_fetched_at: fetchedAt,
      expires_at: expiresAt,
      age_seconds: 0,
      seconds_until_expiry: 600,
      is_stale: false,
      refresh_failed: false,
      source_count: 1,
      sources: {
        demo: {
          source: "demo",
          status: "fresh",
          fetched_at: fetchedAt,
          expires_at: expiresAt,
          ttl_seconds: 600,
          age_seconds: 0,
          seconds_until_expiry: 600,
          is_stale: false,
          cache_hit: false,
          refresh_failed: false,
        },
      },
    },
    reasons: [
      {
        id: "daylight",
        label: isDaylight ? "Daylight" : "Night",
        tone: isDaylight ? "watch" : "neutral",
        detail: isDaylight
          ? "The property is in daylight, so surface sunlight can ramp materially over the next forecast hours."
          : "It is currently dark at the property, so irradiance remains naturally suppressed until sunrise.",
      },
      {
        id: "current-intensity",
        label: `Current intensity ${currentGhi >= 700 ? "high" : currentGhi >= 350 ? "moderate" : "low"}`,
        tone: currentGhi >= 700 ? "high" : currentGhi >= 350 ? "moderate" : "low",
        detail: `Current global horizontal irradiance is about ${currentGhi.toFixed(0)} W/m².`,
      },
      {
        id: "next-hour-ramp",
        label: `Next-hour trend ${spikeLevel}`,
        tone: spikeLevel,
        detail:
          nextHourGhi >= currentGhi
            ? `Forecast sunlight rises by about ${(nextHourGhi - currentGhi).toFixed(0)} W/m² over the next hour.`
            : `Forecast sunlight eases by about ${(currentGhi - nextHourGhi).toFixed(0)} W/m² over the next hour.`,
      },
      {
        id: "peak-window",
        label: "Next peak window",
        tone: spikeLevel,
        detail: `The next forecast peak is around ${hourlyProfile[Math.min(peakHourOffset, hourlyProfile.length - 1)]?.time || peakDate.toISOString()} near ${peakGhi.toFixed(0)} W/m².`,
      },
    ],
    summary:
      !isDaylight
        ? "It is currently dark at this property, so surface irradiance is minimal."
        : spikeLevel === "alert"
          ? "Surface sunlight is very strong with a sharp daytime ramp."
          : spikeLevel === "watch"
            ? "Surface irradiance is elevated enough to watch through the next daylight window."
            : "Surface sunlight is stable right now for this property.",
    hourly_profile: hourlyProfile,
  };
}

function buildMonthDayFromDayOfYear(dayOfYear) {
  const nextDate = new Date(Date.UTC(2001, 0, dayOfYear));
  return `${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-${String(
    nextDate.getUTCDate(),
  ).padStart(2, "0")}`;
}

function buildMonthDayLabel(monthDay) {
  const [month, day] = String(monthDay)
    .split("-")
    .map((value) => Number(value));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2001, month - 1, day)));
}

function buildDemoPropertyClimate(coordinates) {
  const latitude = Number(coordinates.latitude.toFixed(6));
  const longitude = Number(coordinates.longitude.toFixed(6));
  const seed = Math.abs(Math.round((latitude * 17 + longitude * 11) * 10));
  const annualTemperatureF = clamp(89 - Math.abs(latitude) * 0.58 + (seed % 5) - 2, 42, 78);
  const annualHumidity = clamp(69 - Math.abs(latitude - 32) * 0.16 + (seed % 9) - 4, 42, 84);
  const annualSolarKwh = clamp(5.8 - Math.abs(latitude - 31) * 0.05 + ((seed % 5) - 2) * 0.12, 2.4, 7.2);
  const averageAnnualExtremeMinF = clamp(61 - Math.abs(latitude) * 1.28 + (seed % 7) - 3, -35, 67);
  const hardiness = buildEstimatedHardinessLabel(averageAnnualExtremeMinF);
  const monthlyProfiles = {};

  for (const [monthKey] of Object.entries(MONTH_DAY_COUNTS)) {
    const monthIndex = Number(monthKey);
    const seasonality = Math.cos(((monthIndex - 7) / 6) * Math.PI);
    const averageTemperatureF = annualTemperatureF + seasonality * 18;
    const averageRelativeHumidity = annualHumidity - seasonality * 6 + (((seed + monthIndex) % 3) - 1) * 1.5;
    const averageSolarKwh = Math.max(1.2, annualSolarKwh + seasonality * 1.7);

    monthlyProfiles[monthKey] = {
      average_temperature_f: Number(averageTemperatureF.toFixed(1)),
      average_relative_humidity: Number(averageRelativeHumidity.toFixed(1)),
      average_daily_shortwave_radiation_kwh_m2: Number(averageSolarKwh.toFixed(2)),
    };
  }

  const growingMonths = ["04", "05", "06", "07", "08", "09"];
  const averageGrowingSeasonTemperatureF =
    growingMonths.reduce((total, monthKey) => total + monthlyProfiles[monthKey].average_temperature_f, 0) /
    growingMonths.length;
  const averageGrowingSeasonHumidity =
    growingMonths.reduce((total, monthKey) => total + monthlyProfiles[monthKey].average_relative_humidity, 0) /
    growingMonths.length;
  const averageGrowingSeasonSolar =
    growingMonths.reduce(
      (total, monthKey) => total + monthlyProfiles[monthKey].average_daily_shortwave_radiation_kwh_m2,
      0,
    ) / growingMonths.length;
  const lastSpringFrostDay = Math.round(clamp(150 - annualTemperatureF * 1.8 + (seed % 11) - 5, 45, 165));
  const firstFallFrostDay = Math.round(
    clamp(248 + annualTemperatureF * 1.7 + (seed % 15) - 7, 230, 355),
  );
  const lastSpringFrostMonthDay = buildMonthDayFromDayOfYear(lastSpringFrostDay);
  const firstFallFrostMonthDay = buildMonthDayFromDayOfYear(firstFallFrostDay);
  const monthlyEntries = Object.entries(monthlyProfiles);
  const warmestMonth = monthlyEntries.reduce((current, candidate) =>
    candidate[1].average_temperature_f > current[1].average_temperature_f ? candidate : current,
  );
  const coolestMonth = monthlyEntries.reduce((current, candidate) =>
    candidate[1].average_temperature_f < current[1].average_temperature_f ? candidate : current,
  );
  const mostHumidMonth = monthlyEntries.reduce((current, candidate) =>
    candidate[1].average_relative_humidity > current[1].average_relative_humidity ? candidate : current,
  );
  const sunniestMonth = monthlyEntries.reduce((current, candidate) =>
    candidate[1].average_daily_shortwave_radiation_kwh_m2 >
    current[1].average_daily_shortwave_radiation_kwh_m2
      ? candidate
      : current,
  );

  return {
    latitude,
    longitude,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    source: "demo",
    period_start: "2016-01-01",
    period_end: "2025-12-31",
    years_sampled: 10,
    season_window: {
      label: "April-September",
      start_month: "04",
      end_month: "09",
    },
    hardiness_zone: {
      label: hardiness.label,
      average_annual_extreme_min_f: Number(averageAnnualExtremeMinF.toFixed(1)),
      range_f: hardiness.range_f,
      estimated: true,
    },
    frost_window: {
      model_version: "frost-window-v1",
      threshold_f: 32,
      last_spring_frost: {
        threshold_f: 32,
        median_month_day: lastSpringFrostMonthDay,
        median_label: buildMonthDayLabel(lastSpringFrostMonthDay),
        median_day_of_year: lastSpringFrostDay,
        earliest_month_day: buildMonthDayFromDayOfYear(lastSpringFrostDay - 12),
        earliest_label: buildMonthDayLabel(buildMonthDayFromDayOfYear(lastSpringFrostDay - 12)),
        latest_month_day: buildMonthDayFromDayOfYear(lastSpringFrostDay + 16),
        latest_label: buildMonthDayLabel(buildMonthDayFromDayOfYear(lastSpringFrostDay + 16)),
        sample_years: 10,
      },
      first_fall_frost: {
        threshold_f: 32,
        median_month_day: firstFallFrostMonthDay,
        median_label: buildMonthDayLabel(firstFallFrostMonthDay),
        median_day_of_year: firstFallFrostDay,
        earliest_month_day: buildMonthDayFromDayOfYear(firstFallFrostDay - 18),
        earliest_label: buildMonthDayLabel(buildMonthDayFromDayOfYear(firstFallFrostDay - 18)),
        latest_month_day: buildMonthDayFromDayOfYear(firstFallFrostDay + 14),
        latest_label: buildMonthDayLabel(buildMonthDayFromDayOfYear(firstFallFrostDay + 14)),
        sample_years: 10,
      },
      median_frost_free_days: firstFallFrostDay - lastSpringFrostDay - 1,
      confidence: "moderate",
      sample_years: 10,
      summary: `Typical last spring frost near ${buildMonthDayLabel(lastSpringFrostMonthDay)} and first fall frost near ${buildMonthDayLabel(firstFallFrostMonthDay)}.`,
    },
    annual: {
      average_temperature_f: Number(annualTemperatureF.toFixed(1)),
      average_relative_humidity: Number(annualHumidity.toFixed(1)),
      average_daily_shortwave_radiation_kwh_m2: Number(annualSolarKwh.toFixed(2)),
    },
    growing_season: {
      label: "April-September",
      average_temperature_f: Number(averageGrowingSeasonTemperatureF.toFixed(1)),
      average_relative_humidity: Number(averageGrowingSeasonHumidity.toFixed(1)),
      average_daily_shortwave_radiation_kwh_m2: Number(averageGrowingSeasonSolar.toFixed(2)),
    },
    monthly_profiles: monthlyProfiles,
    monthly_temperature_f: Object.fromEntries(
      monthlyEntries.map(([monthKey, profile]) => [monthKey, profile.average_temperature_f]),
    ),
    monthly_relative_humidity: Object.fromEntries(
      monthlyEntries.map(([monthKey, profile]) => [monthKey, profile.average_relative_humidity]),
    ),
    monthly_shortwave_radiation_kwh_m2: Object.fromEntries(
      monthlyEntries.map(([monthKey, profile]) => [monthKey, profile.average_daily_shortwave_radiation_kwh_m2]),
    ),
    seasonal_extremes: {
      warmest_month: {
        month: warmestMonth[0],
        temperature_f: warmestMonth[1].average_temperature_f,
      },
      coolest_month: {
        month: coolestMonth[0],
        temperature_f: coolestMonth[1].average_temperature_f,
      },
      most_humid_month: {
        month: mostHumidMonth[0],
        relative_humidity: mostHumidMonth[1].average_relative_humidity,
      },
      sunniest_month: {
        month: sunniestMonth[0],
        shortwave_radiation_kwh_m2: sunniestMonth[1].average_daily_shortwave_radiation_kwh_m2,
      },
    },
    summary: `Estimated hardiness band ${hardiness.label} using a recent historical window. Average growing-season conditions run about ${averageGrowingSeasonTemperatureF.toFixed(1)}°F and ${averageGrowingSeasonHumidity.toFixed(0)}% relative humidity. Typical last spring frost lands near ${buildMonthDayLabel(lastSpringFrostMonthDay)} and first fall frost near ${buildMonthDayLabel(firstFallFrostMonthDay)}.`,
    model_note:
      "Property-level climate averages from historical weather. This does not model parcel-specific shade, tree canopy, soil, or irrigation conditions.",
  };
}

function buildDemoPropertyContext({ latitude, longitude, bounds, matchQuality }) {
  const roundedLatitude = Number(latitude.toFixed(6));
  const roundedLongitude = Number(longitude.toFixed(6));
  const seed = Math.abs(Math.round((roundedLatitude * 13 + roundedLongitude * 19) * 100));
  const envelope =
    bounds ?? {
      south: Number((roundedLatitude - 0.00024).toFixed(6)),
      north: Number((roundedLatitude + 0.00024).toFixed(6)),
      west: Number((roundedLongitude - 0.00034).toFixed(6)),
      east: Number((roundedLongitude + 0.00034).toFixed(6)),
    };
  const buildingCount = 2 + (seed % 3);
  const directionalPressure = {
    north: Number((0.14 + (seed % 3) * 0.08).toFixed(2)),
    south: Number((0.42 + (seed % 5) * 0.18).toFixed(2)),
    east: Number((0.18 + (seed % 4) * 0.07).toFixed(2)),
    west: Number((0.11 + (seed % 2) * 0.06).toFixed(2)),
  };
  const nearbyBuildings = Array.from({ length: buildingCount }, (_, index) => {
    const distance = 16 + index * 11 + (seed % 5);
    const height = 7 + index * 4 + (seed % 4);
    const directionBuckets = ["south", "southeast", "east", "northwest"];
    const directionBucket = directionBuckets[index % directionBuckets.length];
    const centroidLat = roundedLatitude + 0.00006 * (index + 1) * (index % 2 === 0 ? -1 : 1);
    const centroidLng = roundedLongitude + 0.00008 * (index + 1) * (index % 3 === 0 ? 1 : -1);
    const geometry = {
      type: "Polygon",
      coordinates: [[
        [Number((centroidLng - 0.00005).toFixed(6)), Number((centroidLat + 0.00004).toFixed(6))],
        [Number((centroidLng + 0.00005).toFixed(6)), Number((centroidLat + 0.00004).toFixed(6))],
        [Number((centroidLng + 0.00005).toFixed(6)), Number((centroidLat - 0.00004).toFixed(6))],
        [Number((centroidLng - 0.00005).toFixed(6)), Number((centroidLat - 0.00004).toFixed(6))],
        [Number((centroidLng - 0.00005).toFixed(6)), Number((centroidLat + 0.00004).toFixed(6))],
      ]],
    };

    return {
      id: `demo-building-${index + 1}`,
      name: index === 0 ? "Nearby building" : `Structure ${index + 1}`,
      kind: index === 0 ? "residential" : "commercial",
      levels: 2 + index,
      height_m: Number(height.toFixed(1)),
      distance_m: Number(distance.toFixed(1)),
      direction_bucket: directionBucket,
      direction_group:
        directionBucket.includes("south")
          ? "south"
          : directionBucket.includes("north")
            ? "north"
            : directionBucket.includes("east")
              ? "east"
              : "west",
      bearing_degrees: [188, 142, 96, 322][index % 4],
      shadow_pressure: Number((height / distance).toFixed(2)),
      obstruction_risk: height / distance >= 0.7 ? "high" : height / distance >= 0.35 ? "moderate" : "low",
      centroid: {
        lat: Number(centroidLat.toFixed(6)),
        lng: Number(centroidLng.toFixed(6)),
      },
      geometry,
    };
  });
  const aspectOptions = ["south-facing", "flat", "north-facing", "west-facing"];
  const dominantAspect = aspectOptions[seed % aspectOptions.length];
  const slopePercent = Number((2.8 + (seed % 6) * 1.7).toFixed(1));
  const terrainClass =
    slopePercent >= 14 ? "steep" : slopePercent >= 7 ? "rolling" : slopePercent >= 3 ? "gentle" : "flat";
  const obstructionRisk =
    directionalPressure.south >= 0.9 ? "high" : directionalPressure.south >= 0.42 ? "moderate" : "low";

  return {
    context_version: "property-context-v1",
    latitude: roundedLatitude,
    longitude: roundedLongitude,
    match_quality: matchQuality || "high",
    match_envelope: {
      bounds: envelope,
      width_m: 78.4,
      height_m: 57.2,
      source: bounds ? "geocoder-match-envelope" : "synthetic-planning-envelope",
      label: bounds ? "Geocoder match envelope" : "Planning envelope",
    },
    building_context: {
      source: "demo",
      search_radius_m: 82,
      building_count: buildingCount,
      nearby_buildings: nearbyBuildings,
      nearest_building: nearbyBuildings[0],
      directional_pressure: directionalPressure,
      obstruction_risk: obstructionRisk,
      summary: `${buildingCount} nearby building footprints found. The strongest structure pressure sits on the south side of the property.`,
    },
    terrain_context: {
      source: "demo",
      center_elevation_m: 158 + (seed % 12),
      local_relief_m: Number((4.2 + (seed % 5) * 2.1).toFixed(1)),
      dominant_aspect: dominantAspect,
      slope_percent: slopePercent,
      terrain_class: terrainClass,
      sample_radius_m: 34,
      samples: [],
      summary: `Local terrain reads as ${terrainClass} with a ${dominantAspect} bias.`,
    },
    shade_context: {
      obstruction_risk: obstructionRisk,
      terrain_bias:
        dominantAspect === "north-facing"
          ? "less solar-favored"
          : dominantAspect === "south-facing"
            ? "more solar-favored"
            : "mostly neutral",
      summary: `Structure-driven shade risk reads as ${obstructionRisk}.`,
    },
    summary: `${buildingCount} nearby building footprints found. Local terrain reads as ${terrainClass} with a ${dominantAspect} bias. Structure-driven shade risk reads as ${obstructionRisk}.`,
    model_note:
      "This first context layer uses nearby buildings and terrain cues only. Trees, fences, and parcel-certified boundaries are not modeled yet.",
  };
}

export async function fetchPropertyPreview(address) {
  if (demoMode) {
    return buildDemoPropertyPreview(address);
  }

  return request("/api/property-preview", address);
}

export async function reverseGeocodeCoordinates(coordinates) {
  if (demoMode) {
    return buildDemoBrowserLocationPreview(coordinates);
  }

  return request("/api/reverse-geocode", coordinates);
}

export async function fetchSpaceWeather(coordinates, options = {}) {
  if (demoMode) {
    return buildDemoSpaceWeather(coordinates);
  }

  return request("/api/space-weather", {
    ...coordinates,
    force_refresh: Boolean(options.forceRefresh),
  });
}

export async function fetchSurfaceIrradiance(coordinates, options = {}) {
  if (demoMode) {
    return buildDemoSurfaceIrradiance(coordinates);
  }

  return request("/api/surface-irradiance", {
    ...coordinates,
    force_refresh: Boolean(options.forceRefresh),
  });
}

export async function fetchGardenCropCatalog() {
  if (demoMode) {
    return {
      catalog_id: "demo-unavailable",
      version: "unavailable",
      model_note:
        "Garden crop catalog persistence is only available when the backend API is running.",
      source_basis: [],
      crops: [],
    };
  }

  return request("/api/garden-crop-catalog", {});
}

export async function fetchPropertyClimate(coordinates) {
  if (demoMode) {
    return buildDemoPropertyClimate(coordinates);
  }

  return request("/api/property-climate", coordinates);
}

export async function fetchPropertyContext({ latitude, longitude, bounds, matchQuality }) {
  if (demoMode) {
    return buildDemoPropertyContext({ latitude, longitude, bounds, matchQuality });
  }

  return request("/api/property-context", {
    latitude,
    longitude,
    bounds,
    match_quality: matchQuality,
  });
}

export async function findPropertyRecordByAddress(address) {
  if (demoMode) {
    return findDemoPropertyRecordByAddress(address);
  }

  const response = await request("/api/property-record/find", address);
  return response.record || null;
}

export async function upsertPropertyRecord({
  guid,
  address,
  propertyPreview,
  propertyContext,
  propertyClimate,
  roofSelection,
  gardenZones,
}) {
  if (demoMode) {
    return upsertDemoPropertyRecord({
      guid,
      address,
      propertyPreview,
      propertyContext,
      propertyClimate,
      roofSelection,
      gardenZones,
    });
  }

  return request("/api/property-record", {
    guid,
    address,
    property_preview: propertyPreview,
    property_context: propertyContext,
    property_climate: propertyClimate,
    roof_selection: roofSelection,
    garden_zones: gardenZones,
  });
}

export async function listPropertyRecords({ maxItems = 8, requireGardenZones = false } = {}) {
  if (demoMode) {
    return listDemoPropertyRecords({ maxItems, requireGardenZones });
  }

  const response = await request("/api/property-record/recent", {
    max_items: maxItems,
    require_garden_zones: requireGardenZones,
  });
  return response.records || [];
}

export async function fetchSolarEstimate(formValues) {
  if (demoMode) {
    return buildDemoEstimate(formValues);
  }

  const {
    guid,
    roofSelection,
    system_size,
    panel_efficiency,
    electricity_rate,
    installation_cost_per_watt,
  } = formValues;

  if (!guid) {
    throw new Error("Locate the property first.");
  }

  return request("/api/solar-potential", {
    guid,
    system_size: roofSelection?.recommendedKw ?? system_size ?? null,
    panel_efficiency,
    electricity_rate,
    installation_cost_per_watt,
    roof_selection: roofSelection ?? null,
  });
}

export async function saveSolarReport({
  guid,
  reportName,
  panel_efficiency,
  electricity_rate,
  installation_cost_per_watt,
  roofSelection,
}) {
  if (demoMode) {
    return saveDemoSolarReport({
      guid,
      reportName,
      panel_efficiency,
      electricity_rate,
      installation_cost_per_watt,
      roofSelection,
    });
  }

  return request("/api/solar-report", {
    guid,
    report_name: reportName,
    panel_efficiency,
    electricity_rate,
    installation_cost_per_watt,
    roof_selection: roofSelection ?? null,
  });
}

export async function createSolarQuote({ guid, reportId }) {
  if (demoMode) {
    return createDemoSolarQuote({ guid, reportId });
  }

  const response = await fetch(`${apiBaseUrl}/api/solar-quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      guid,
      report_id: reportId,
    }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail || "Unable to create homeowner quote");
  }

  return data;
}

export async function fetchSolarQuote(quoteId) {
  if (demoMode) {
    return fetchDemoSolarQuote(quoteId);
  }

  const response = await fetch(`${apiBaseUrl}/api/solar-quote/${quoteId}`, {
    headers: {
      Accept: "application/json",
    },
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.detail || "Unable to load homeowner quote");
  }

  return data;
}

export { apiBaseUrl };
