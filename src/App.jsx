import { useEffect, useMemo, useState } from "react";
import PropertyMap from "./components/PropertyMap.jsx";
import {
  createSolarQuote,
  fetchPropertyClimate,
  fetchPropertyContext,
  findPropertyRecordByAddress,
  fetchPropertyPreview,
  fetchSolarEstimate,
  fetchSpaceWeather,
  fetchSurfaceIrradiance,
  listPropertyRecords,
  reverseGeocodeCoordinates,
  saveSolarReport,
  upsertPropertyRecord,
} from "./lib/api.js";
import { analyzeGardenZones } from "./lib/gardenAnalysis.js";
import { buildGardenZone, buildRoofModel } from "./lib/geometry.js";
import { buildPlantingGuidance } from "./lib/plantGuidance.js";

const pageModes = [
  { id: "solar", label: "Solar Buddy" },
  { id: "space-weather", label: "Space Weather" },
  { id: "garden", label: "Garden Buddy" },
];

const monthLabels = [
  ["01", "Jan"],
  ["02", "Feb"],
  ["03", "Mar"],
  ["04", "Apr"],
  ["05", "May"],
  ["06", "Jun"],
  ["07", "Jul"],
  ["08", "Aug"],
  ["09", "Sep"],
  ["10", "Oct"],
  ["11", "Nov"],
  ["12", "Dec"],
];

const initialForm = {
  address: {
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "United States",
  },
  system_size: 7,
  panel_efficiency: 0.2,
  electricity_rate: 0.16,
  installation_cost_per_watt: 3,
};

const modeContentByMode = {
  solar: {
    resultPanelCopy:
      "Estimate output uses the saved roof selection, monthly solar resource data, and the current system inputs.",
  },
  garden: {
    resultPanelCopy:
      "Review recent saved garden plans, obstruction-aware property context, climate, live sunlight, and planting guidance on the active property.",
  },
};

const landingContentByPage = {
  solar: {
    title: "Locate the property and run the roof estimate.",
    summary: "Address first. Draw the usable roof plane, then calculate.",
    steps: ["Address", "Map", "Roof", "Estimate"],
    intakeTitle: "Run solar estimate",
    intakeCopy: "Find the property, draw the roof, and calculate.",
    pageLabel: "Solar Buddy",
  },
  "space-weather": {
    title: "Locate the property and check live space weather.",
    summary: "Address first. Then review flare, geomagnetic, aurora, and surface sunlight alerts.",
    steps: ["Address", "Locate", "Alerts", "Now"],
    intakeTitle: "Track space weather",
    intakeCopy: "Find the property, then review live flare, solar-wind, and surface irradiance conditions.",
    pageLabel: "Space Weather",
  },
  garden: {
    title: "Locate the property and start yard sun planning.",
    summary: "Address first. Draw the real yard zones, then review the sun guidance.",
    steps: ["Address", "Map", "Zones", "Plan"],
    intakeTitle: "Set up garden plan",
    intakeCopy: "Find the property, draw yard zones, and review guidance.",
    pageLabel: "Garden Buddy",
  },
};

const pageIds = new Set(pageModes.map(({ id }) => id));

function getPageIdFromHash(hash) {
  const normalized = String(hash || "")
    .replace(/^#\/?/, "")
    .trim()
    .toLowerCase();

  return pageIds.has(normalized) ? normalized : "solar";
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCoordinate(value) {
  return typeof value === "number" ? formatNumber(value, 4) : "N/A";
}

function formatDateTime(value) {
  if (!value) {
    return "Saved recently";
  }

  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) {
    return "Saved recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(nextDate);
}

function formatLocalHour(value) {
  if (!value) {
    return "N/A";
  }

  const [, timePart = ""] = String(value).split("T");
  const [hourValue, minuteValue = "00"] = timePart.split(":");
  const hour = Number(hourValue);

  if (!Number.isFinite(hour)) {
    return value;
  }

  const period = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 || 12;
  return `${normalizedHour}:${minuteValue.slice(0, 2)} ${period}`;
}

function formatSignedNumber(value, digits = 0) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }

  return `${value >= 0 ? "+" : "-"}${formatNumber(Math.abs(value), digits)}`;
}

function formatLabel(value) {
  return String(value || "unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatAddressLine(address) {
  if (!address) {
    return "Saved property";
  }

  const region = [address.city, [address.state, address.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [address.street, region, address.country].filter(Boolean).join(", ") || "Saved property";
}

function getMonthLabel(monthId) {
  return monthLabels.find(([candidate]) => candidate === monthId)?.[1] || monthId || "N/A";
}

function getMatchLabel(matchQuality) {
  if (matchQuality === "high") {
    return "Strong address match";
  }

  if (matchQuality === "medium") {
    return "Approximate address match";
  }

  if (matchQuality === "low") {
    return "Loose address match";
  }

  return "Match not rated";
}

function buildPropertyPreviewFromEstimate(estimate, previousPreview) {
  return {
    query: estimate.address,
    formatted_address: estimate.address,
    latitude: estimate.latitude,
    longitude: estimate.longitude,
    bounds: previousPreview?.bounds || null,
    source: previousPreview?.source || estimate.data_source || "estimate",
    match_quality: previousPreview?.match_quality || "high",
    match_score: previousPreview?.match_score || null,
    address: previousPreview?.address || null,
  };
}

function getBrowserCoordinates() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Browser location is not available on this device."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 300000,
    });
  });
}

function getGeolocationErrorMessage(error) {
  if (!error) {
    return "Unable to access browser location.";
  }

  if (error.code === 1) {
    return "Location access was blocked. Allow browser location and try again.";
  }

  if (error.code === 2) {
    return "Browser location was unavailable. Try again in a clearer signal area.";
  }

  if (error.code === 3) {
    return "Browser location timed out. Try again.";
  }

  return error.message || "Unable to access browser location.";
}

function StatCard({ label, value, detail }) {
  return (
    <article className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {detail ? <p className="stat-detail">{detail}</p> : null}
    </article>
  );
}

function AddressFields({ address, onChange }) {
  return (
    <>
      <label>
        Street address
        <input
          required
          value={address.street}
          onChange={(event) => onChange("street", event.target.value)}
          placeholder="123 Main St"
        />
      </label>

      <div className="field-row">
        <label>
          City
          <input
            required
            value={address.city}
            onChange={(event) => onChange("city", event.target.value)}
            placeholder="Austin"
          />
        </label>

        <label>
          State
          <input
            required
            value={address.state}
            onChange={(event) => onChange("state", event.target.value)}
            placeholder="TX"
          />
        </label>
      </div>

      <div className="field-row">
        <label>
          ZIP code
          <input
            required
            value={address.zip}
            onChange={(event) => onChange("zip", event.target.value)}
            placeholder="78702"
          />
        </label>

        <label>
          Country
          <input
            required
            value={address.country}
            onChange={(event) => onChange("country", event.target.value)}
            placeholder="United States"
          />
        </label>
      </div>
    </>
  );
}

function MonthlyExposure({
  eyebrow = "Seasonality",
  title = "Monthly profile",
  copy = "",
  monthlyValues = {},
  unit,
  digits = 1,
}) {
  const maxValue = Math.max(...Object.values(monthlyValues), 1);

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <p className="panel-copy">{copy}</p>
      </div>

      <div className="month-grid">
        {monthLabels.map(([key, label]) => {
          const value = monthlyValues[key] ?? 0;
          const height = `${Math.max((value / maxValue) * 100, 8)}%`;

          return (
            <div className="month-card" key={key}>
              <span className="month-value">{formatNumber(value, digits)}</span>
              <div className="month-bar-track">
                <div className="month-bar-fill" style={{ height }} />
              </div>
              <strong>{label}</strong>
              <span>{unit}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SunClassBadge({ sunClass }) {
  if (!sunClass) {
    return null;
  }

  return (
    <span className={`soft-badge sun-class-badge sun-class-badge-${sunClass.id}`}>
      {sunClass.label}
    </span>
  );
}

function ConfidenceBadge({ confidence }) {
  if (!confidence?.id) {
    return null;
  }

  return (
    <span className={`soft-badge solar-confidence-badge solar-confidence-badge-${confidence.id}`}>
      {confidence.label} confidence
    </span>
  );
}

function getBadgeTone(value) {
  const normalized = String(value || "").toLowerCase();

  if (["alert", "warning", "high"].includes(normalized)) {
    return "alert";
  }

  if (["watch", "moderate", "possible", "likely"].includes(normalized)) {
    return "watch";
  }

  if (["low", "minor"].includes(normalized)) {
    return "low";
  }

  return "neutral";
}

function LevelBadge({ label, tone }) {
  return <span className={`soft-badge soft-badge-${getBadgeTone(tone)}`}>{label}</span>;
}

function SpaceWeatherPanel({ data, loading, error }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Space weather</p>
          <h2>Live flare and solar-wind context</h2>
        </div>
        <p className="panel-copy">
          Separate from the annual solar estimate. This layer focuses on local relevance for flare,
          geomagnetic, aurora, and GNSS conditions.
        </p>
      </div>

      {loading ? (
        <div className="status-card status-card-muted">
          <span className="status-label">Live status</span>
          <strong>Loading space weather</strong>
          <p>Pulling current NOAA and NASA context for this property.</p>
        </div>
      ) : error ? (
        <div className="status-card status-card-muted">
          <span className="status-label">Live status</span>
          <strong>Space weather unavailable</strong>
          <p>{error}</p>
        </div>
      ) : data ? (
        <>
          <p className="summary-copy">{data.summary}</p>

          <div className="condition-badge-row">
            <LevelBadge label={`Local ${formatLabel(data.alert_level)}`} tone={data.alert_level} />
            <LevelBadge
              label={data.local?.is_daylight ? "Daylight side" : "Night side"}
              tone={data.local?.is_daylight ? "watch" : "neutral"}
            />
            <LevelBadge
              label={`Aurora ${formatLabel(data.local?.aurora_visibility_potential)}`}
              tone={data.local?.aurora_visibility_potential}
            />
            <LevelBadge
              label={`GNSS ${formatLabel(data.local?.gnss_risk)}`}
              tone={data.local?.gnss_risk}
            />
          </div>

          <div className="stats-grid">
            <StatCard
              label="Radio blackout"
              value={`R${data.global?.radio_blackout_scale?.scale ?? 0}`}
              detail={formatLabel(data.global?.radio_blackout_scale?.label)}
            />
            <StatCard
              label="Radiation storm"
              value={`S${data.global?.radiation_storm_scale?.scale ?? 0}`}
              detail={formatLabel(data.global?.radiation_storm_scale?.label)}
            />
            <StatCard
              label="Geomagnetic storm"
              value={`G${data.global?.geomagnetic_storm_scale?.scale ?? 0}`}
              detail={formatLabel(data.global?.geomagnetic_storm_scale?.label)}
            />
            <StatCard
              label="Solar wind"
              value={`${formatNumber(data.global?.solar_wind?.speed_km_s || 0, 1)} km/s`}
              detail={`${formatNumber(data.global?.solar_wind?.density_p_cm3 || 0, 2)} p/cm³ density`}
            />
            <StatCard
              label="X-ray now"
              value={data.global?.current_xray_class || "Unknown"}
              detail={`24h peak ${data.global?.peak_xray_24h_class || "Unknown"}`}
            />
            <StatCard
              label="Latitude band"
              value={formatLabel(data.local?.latitude_band)}
              detail={data.local?.ground_radiation_note || "Local impact note unavailable."}
            />
          </div>

          <div className="guidance-stack solar-insight-stack">
            <article className="guidance-card">
              <div className="insight-heading">
                <strong>Local relevance</strong>
                <LevelBadge label={formatLabel(data.alert_level)} tone={data.alert_level} />
              </div>
              <div className="status-list">
                <div className="status-row">
                  <strong>HF radio risk</strong>
                  <p>{formatLabel(data.local?.hf_radio_risk)}</p>
                </div>
                <div className="status-row">
                  <strong>GNSS risk</strong>
                  <p>{formatLabel(data.local?.gnss_risk)}</p>
                </div>
                <div className="status-row">
                  <strong>Ground-level note</strong>
                  <p>{data.local?.ground_radiation_note || "Not available."}</p>
                </div>
              </div>
            </article>

            <article className="guidance-card">
              <strong>Current watches and warnings</strong>
              {data.recent_headlines?.length ? (
                <div className="status-list">
                  {data.recent_headlines.map((headline) => (
                    <div className="status-row" key={headline}>
                      <strong>Headline</strong>
                      <p>{headline}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p>No active watch headlines are being surfaced right now.</p>
              )}
            </article>

            <article className="guidance-card">
              <strong>Recent activity</strong>
              <div className="status-list">
                <div className="status-row">
                  <strong>Latest flare event</strong>
                  <p>
                    {data.recent_activity?.latest_flare_event?.class || "Unknown"} at{" "}
                    {formatDateTime(data.recent_activity?.latest_flare_event?.peak_time)}
                  </p>
                </div>
                <div className="status-row">
                  <strong>Latest geomagnetic storm</strong>
                  <p>
                    {data.recent_activity?.latest_geomagnetic_storm
                      ? `Kp ${formatNumber(data.recent_activity.latest_geomagnetic_storm.max_kp_index || 0, 2)} from ${formatDateTime(
                          data.recent_activity.latest_geomagnetic_storm.start_time,
                        )}`
                      : "No recent storm in the current response window."}
                  </p>
                </div>
              </div>
            </article>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <h3>No space weather data yet</h3>
          <p>Locate a property to pull live flare, solar-wind, and geomagnetic context.</p>
        </div>
      )}
    </section>
  );
}

function SurfaceIrradiancePanel({ data, loading, error }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Surface irradiance</p>
          <h2>Local sunlight spikes and ramps</h2>
        </div>
        <p className="panel-copy">
          Separate from space weather. This tracks surface sunlight at the property using local
          irradiance conditions and the near-term forecast window.
        </p>
      </div>

      {loading ? (
        <div className="status-card status-card-muted">
          <span className="status-label">Live status</span>
          <strong>Loading irradiance</strong>
          <p>Pulling current and near-term surface sunlight for this property.</p>
        </div>
      ) : error ? (
        <div className="status-card status-card-muted">
          <span className="status-label">Live status</span>
          <strong>Surface irradiance unavailable</strong>
          <p>{error}</p>
        </div>
      ) : data ? (
        <>
          <p className="summary-copy">{data.summary}</p>

          <div className="condition-badge-row">
            <LevelBadge label={`Spike ${formatLabel(data.spike_level)}`} tone={data.spike_level} />
            <LevelBadge
              label={`Intensity ${formatLabel(data.current?.intensity_level)}`}
              tone={data.current?.intensity_level}
            />
            <LevelBadge
              label={data.is_daylight ? "Daylight" : "Night"}
              tone={data.is_daylight ? "watch" : "neutral"}
            />
            <LevelBadge
              label={`Source ${formatLabel(data.source)}`}
              tone="neutral"
            />
          </div>

          <div className="stats-grid">
            <StatCard
              label="Current GHI"
              value={`${formatNumber(data.current?.ghi_w_m2 || 0, 0)} W/m²`}
              detail={`Observed ${formatLocalHour(data.observed_at)}`}
            />
            <StatCard
              label="Current DNI"
              value={`${formatNumber(data.current?.dni_w_m2 || 0, 0)} W/m²`}
              detail={`Time zone ${data.time_zone || "Unknown"}`}
            />
            <StatCard
              label="Next peak"
              value={`${formatNumber(data.next_peak?.ghi_w_m2 || 0, 0)} W/m²`}
              detail={formatLocalHour(data.next_peak?.time)}
            />
            <StatCard
              label="Next-hour change"
              value={`${formatSignedNumber(data.trend?.change_to_next_hour_w_m2 || 0, 0)} W/m²`}
              detail={
                data.trend?.next_hour_ghi_w_m2 != null
                  ? `Next hour ${formatNumber(data.trend.next_hour_ghi_w_m2, 0)} W/m²`
                  : "Next hour forecast unavailable"
              }
            />
            <StatCard
              label="Prev-hour change"
              value={`${formatSignedNumber(data.trend?.change_from_previous_hour_w_m2 || 0, 0)} W/m²`}
              detail={
                data.trend?.previous_hour_ghi_w_m2 != null
                  ? `Previous hour ${formatNumber(data.trend.previous_hour_ghi_w_m2, 0)} W/m²`
                  : "Previous hour unavailable"
              }
            />
            <StatCard
              label="Max hourly ramp"
              value={`${formatNumber(data.trend?.max_hourly_ramp_w_m2 || 0, 0)} W/m²`}
              detail={
                data.trend?.ramp_start_time && data.trend?.ramp_end_time
                  ? `${formatLocalHour(data.trend.ramp_start_time)} to ${formatLocalHour(
                      data.trend.ramp_end_time,
                    )}`
                  : "Ramp window unavailable"
              }
            />
          </div>

          <div className="guidance-stack solar-insight-stack">
            <article className="guidance-card">
              <strong>Forecast window</strong>
              <div className="condition-badge-row">
                {(data.hourly_profile || []).slice(0, 6).map((entry) => (
                  <span className="soft-badge soft-badge-neutral" key={entry.time}>
                    {formatLocalHour(entry.time)} · {formatNumber(entry.ghi_w_m2 || 0, 0)} W/m²
                  </span>
                ))}
              </div>
            </article>

            <article className="guidance-card">
              <strong>Interpretation</strong>
              <div className="status-list">
                <div className="status-row">
                  <strong>Current intensity</strong>
                  <p>{formatLabel(data.current?.intensity_level)}</p>
                </div>
                <div className="status-row">
                  <strong>Spike level</strong>
                  <p>{formatLabel(data.spike_level)}</p>
                </div>
                <div className="status-row">
                  <strong>Why this is separate</strong>
                  <p>
                    This measures local surface sunlight behavior. It is not the same signal as
                    flare or geomagnetic activity.
                  </p>
                </div>
              </div>
            </article>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <h3>No irradiance data yet</h3>
          <p>Locate a property to pull local surface sunlight and spike behavior.</p>
        </div>
      )}
    </section>
  );
}

function GardenClimatePanel({
  climate,
  climateLoading,
  climateError,
  irradiance,
  irradianceLoading,
  irradianceError,
}) {
  return (
    <section className="panel garden-climate-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Climate context</p>
          <h2>Property climate and live sunlight</h2>
        </div>
        <p className="panel-copy">
          Property-level historical weather plus live irradiance. This informs planning, but it is
          not parcel-perfect shade or zone-specific microclimate.
        </p>
      </div>

      {climateLoading && !climate ? (
        <div className="status-card status-card-muted">
          <span className="status-label">Climate status</span>
          <strong>Loading property climate</strong>
          <p>Pulling recent historical temperature, humidity, and sunlight context for this property.</p>
        </div>
      ) : climateError && !climate ? (
        <div className="status-card status-card-muted">
          <span className="status-label">Climate status</span>
          <strong>Property climate unavailable</strong>
          <p>{climateError}</p>
        </div>
      ) : climate ? (
        <>
          <p className="summary-copy">{climate.summary}</p>

          <div className="condition-badge-row">
            <LevelBadge
              label={`Hardiness ${climate.hardiness_zone?.label || "Unknown"}`}
              tone="neutral"
            />
            <LevelBadge label={climate.season_window?.label || "Growing season"} tone="watch" />
            <LevelBadge
              label={
                irradianceLoading && !irradiance
                  ? "Live loading"
                  : irradianceError && !irradiance
                    ? "Live unavailable"
                    : irradiance?.is_daylight
                      ? "Live daylight"
                      : "Live night"
              }
              tone={irradiance?.is_daylight ? "watch" : "neutral"}
            />
            <LevelBadge label={`Source ${formatLabel(climate.source)}`} tone="neutral" />
          </div>

          <div className="stats-grid">
            <StatCard
              label="Hardiness band"
              value={climate.hardiness_zone?.label || "Unknown"}
              detail={
                climate.hardiness_zone?.range_f ||
                "Estimated from recent historical weather."
              }
            />
            <StatCard
              label="Annual avg temp"
              value={`${formatNumber(climate.annual?.average_temperature_f || 0, 1)}°F`}
              detail={`${climate.years_sampled || 0} full years sampled`}
            />
            <StatCard
              label="Growing-season temp"
              value={`${formatNumber(climate.growing_season?.average_temperature_f || 0, 1)}°F`}
              detail={climate.growing_season?.label || "April-September"}
            />
            <StatCard
              label="Annual avg humidity"
              value={`${formatNumber(climate.annual?.average_relative_humidity || 0, 0)}%`}
              detail="Property-level historical mean"
            />
            <StatCard
              label="Growing-season humidity"
              value={`${formatNumber(climate.growing_season?.average_relative_humidity || 0, 0)}%`}
              detail={climate.growing_season?.label || "April-September"}
            />
            <StatCard
              label="Daily sun energy"
              value={`${formatNumber(
                climate.growing_season?.average_daily_shortwave_radiation_kwh_m2 || 0,
                2,
              )} kWh/m²`}
              detail="Growing-season daily average"
            />
            <StatCard
              label="Live sun now"
              value={
                irradianceLoading && !irradiance
                  ? "Loading..."
                  : irradianceError
                    ? "Unavailable"
                    : `${formatNumber(irradiance?.current?.ghi_w_m2 || 0, 0)} W/m²`
              }
              detail={
                irradianceError
                  ? irradianceError
                  : irradiance
                    ? `Observed ${formatLocalHour(irradiance.observed_at)}`
                    : "Live irradiance not loaded yet."
              }
            />
            <StatCard
              label="Next daylight peak"
              value={
                irradiance
                  ? `${formatNumber(irradiance.next_peak?.ghi_w_m2 || 0, 0)} W/m²`
                  : "Pending"
              }
              detail={
                irradiance ? formatLocalHour(irradiance.next_peak?.time) : "Waiting for live irradiance"
              }
            />
          </div>

          <div className="guidance-stack">
            <article className="guidance-card">
              <strong>Seasonal swing</strong>
              <div className="status-list">
                <div className="status-row">
                  <strong>Warmest month</strong>
                  <p>
                    {getMonthLabel(climate.seasonal_extremes?.warmest_month?.month)} at about{" "}
                    {formatNumber(climate.seasonal_extremes?.warmest_month?.temperature_f || 0, 1)}°F
                  </p>
                </div>
                <div className="status-row">
                  <strong>Coolest month</strong>
                  <p>
                    {getMonthLabel(climate.seasonal_extremes?.coolest_month?.month)} at about{" "}
                    {formatNumber(climate.seasonal_extremes?.coolest_month?.temperature_f || 0, 1)}°F
                  </p>
                </div>
                <div className="status-row">
                  <strong>Most humid month</strong>
                  <p>
                    {getMonthLabel(climate.seasonal_extremes?.most_humid_month?.month)} near{" "}
                    {formatNumber(
                      climate.seasonal_extremes?.most_humid_month?.relative_humidity || 0,
                      0,
                    )}
                    % average humidity
                  </p>
                </div>
                <div className="status-row">
                  <strong>Sunniest month</strong>
                  <p>
                    {getMonthLabel(climate.seasonal_extremes?.sunniest_month?.month)} around{" "}
                    {formatNumber(
                      climate.seasonal_extremes?.sunniest_month?.shortwave_radiation_kwh_m2 || 0,
                      2,
                    )}{" "}
                    kWh/m² per day
                  </p>
                </div>
              </div>
            </article>

            <article className="guidance-card">
              <strong>How to use this with zones</strong>
              <div className="status-list">
                <div className="status-row">
                  <strong>Zone exposure vs climate</strong>
                  <p>
                    Keep using the selected zone for open-sky light class and monthly sun hours. This
                    climate layer adds property-level temperature, humidity, and seasonal sunlight context.
                  </p>
                </div>
                <div className="status-row">
                  <strong>Live sunlight</strong>
                  <p>
                    Live irradiance shows how strong the sun is at the property right now, but not how
                    trees, fences, or nearby structures split that light by zone.
                  </p>
                </div>
                <div className="status-row">
                  <strong>Model boundary</strong>
                  <p>{climate.model_note}</p>
                </div>
              </div>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}

function GardenSiteContextPanel({ context, loading, error, zone }) {
  return (
    <section className="panel garden-context-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Site context</p>
          <h2>Nearby buildings and terrain cues</h2>
        </div>
        <p className="panel-copy">
          This first context layer adds building and terrain pressure to the garden workflow. It is
          still not canopy-aware or parcel-certified.
        </p>
      </div>

      {loading && !context ? (
        <div className="status-card status-card-muted">
          <span className="status-label">Context status</span>
          <strong>Loading site context</strong>
          <p>Pulling nearby building footprints and terrain cues for this property.</p>
        </div>
      ) : error && !context ? (
        <div className="status-card status-card-muted">
          <span className="status-label">Context status</span>
          <strong>Site context unavailable</strong>
          <p>{error}</p>
        </div>
      ) : context ? (
        <>
          <p className="summary-copy">{context.summary}</p>

          <div className="condition-badge-row">
            <LevelBadge
              label={`Shade risk ${formatLabel(context.shade_context?.obstruction_risk)}`}
              tone={context.shade_context?.obstruction_risk}
            />
            <LevelBadge
              label={`Terrain ${formatLabel(context.terrain_context?.terrain_class)}`}
              tone="neutral"
            />
            <LevelBadge
              label={context.match_envelope?.label || "Planning envelope"}
              tone="neutral"
            />
            <LevelBadge
              label={`Match ${formatLabel(context.match_quality)}`}
              tone={context.match_quality === "high" ? "low" : "watch"}
            />
          </div>

          <div className="stats-grid">
            <StatCard
              label="Nearby buildings"
              value={String(context.building_context?.building_count || 0)}
              detail={`${formatNumber(context.match_envelope?.width_m || 0, 0)} m context width`}
            />
            <StatCard
              label="Nearest structure"
              value={
                context.building_context?.nearest_building
                  ? `${formatNumber(context.building_context.nearest_building.distance_m || 0, 0)} m`
                  : "None mapped"
              }
              detail={
                context.building_context?.nearest_building
                  ? `${formatLabel(context.building_context.nearest_building.direction_bucket)} · ${formatNumber(
                      context.building_context.nearest_building.height_m || 0,
                      1,
                    )} m tall`
                  : "No nearby footprint in the current radius."
              }
            />
            <StatCard
              label="South pressure"
              value={formatNumber(context.building_context?.directional_pressure?.south || 0, 2)}
              detail="Higher values mean stronger structure pressure from the south side."
            />
            <StatCard
              label="Terrain profile"
              value={formatLabel(context.terrain_context?.terrain_class)}
              detail={formatLabel(context.terrain_context?.dominant_aspect || "flat")}
            />
            <StatCard
              label="Local relief"
              value={`${formatNumber(context.terrain_context?.local_relief_m || 0, 1)} m`}
              detail={`${formatNumber(context.terrain_context?.slope_percent || 0, 1)}% slope estimate`}
            />
            <StatCard
              label="Selected zone effect"
              value={
                zone?.analysis?.contextAdjustment
                  ? zone.analysis.contextAdjustment.maxMonthlyPenaltyHours
                    ? `${formatSignedNumber(
                        -zone.analysis.contextAdjustment.maxMonthlyPenaltyHours,
                        1,
                      )} hrs/day`
                    : "0.0 hrs/day"
                  : "Pending zone"
              }
              detail={
                zone?.analysis?.obstructionRisk
                  ? `${zone.analysis.obstructionRisk.label} obstruction risk`
                  : "Draw or select a zone to see the local pressure."
              }
            />
          </div>

          <div className="guidance-stack">
            <article className="guidance-card">
              <strong>Closest obstructions</strong>
              {(context.building_context?.nearby_buildings || []).length ? (
                <div className="status-list">
                  {context.building_context.nearby_buildings.slice(0, 3).map((building) => (
                    <div className="status-row" key={building.id}>
                      <strong>{building.name || "Nearby building"}</strong>
                      <p>
                        {formatLabel(building.direction_bucket)} side, about{" "}
                        {formatNumber(building.distance_m || 0, 0)} m away,{" "}
                        {formatNumber(building.height_m || 0, 1)} m tall.
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p>No nearby building footprints are being surfaced in this planning radius.</p>
              )}
            </article>

            <article className="guidance-card">
              <strong>What changed in Garden Buddy</strong>
              <div className="status-list">
                <div className="status-row">
                  <strong>Zone model</strong>
                  <p>
                    Zone sun hours now temper the open-sky estimate with nearby building pressure and
                    a light terrain bias instead of relying on latitude and lot position alone.
                  </p>
                </div>
                <div className="status-row">
                  <strong>Current boundary</strong>
                  <p>{context.model_note}</p>
                </div>
              </div>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}

function buildShareUrl(sharePath) {
  if (!sharePath) {
    return "";
  }

  return new URL(sharePath, window.location.origin).toString();
}

function SavedSolarReportList({
  reports,
  onCreateQuote,
  onCopyQuoteLink,
  quoteCreatingReportId,
  copiedQuoteId,
}) {
  if (!reports.length) {
    return (
      <p className="saved-report-empty">
        No saved report yet. Save the current estimate to keep a property-tied snapshot of this
        roof, economics, and model state.
      </p>
    );
  }

  return (
    <div className="saved-report-list">
      {reports.map((report) => (
        <article className="saved-report-card" key={report.id}>
          <div className="saved-report-heading">
            <div>
              <strong>{report.name}</strong>
              <p>{formatDateTime(report.created_at)}</p>
            </div>
            <ConfidenceBadge confidence={report.confidence} />
          </div>

          <p className="saved-report-summary">{report.summary}</p>

          <div className="saved-report-metrics">
            <span>{formatNumber(report.system_size_kw, 1)} kW</span>
            <span>{formatCurrency(report.annual_savings)}/yr</span>
            <span>{formatNumber(report.specific_yield, 0)} kWh/kW-yr</span>
            <span>
              Peak {getMonthLabel(report.production_model?.peak_month?.month || report.peak_month?.month)}
            </span>
          </div>

          <div className="saved-report-actions">
            {report.homeowner_quote ? (
              <>
                <a
                  className="secondary-button"
                  href={report.homeowner_quote.share_path}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open homeowner quote
                </a>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onCopyQuoteLink(report.homeowner_quote)}
                >
                  {copiedQuoteId === report.homeowner_quote.id ? "Link copied" : "Copy share link"}
                </button>
              </>
            ) : (
              <button
                className="secondary-button"
                type="button"
                onClick={() => onCreateQuote(report.id)}
                disabled={quoteCreatingReportId === report.id}
              >
                {quoteCreatingReportId === report.id
                  ? "Creating quote..."
                  : "Create homeowner quote"}
              </button>
            )}
          </div>

          {report.homeowner_quote ? (
            <>
              <p className="saved-report-quote-note">
                Share-ready quote updated{" "}
                {formatDateTime(
                  report.homeowner_quote.updated_at || report.homeowner_quote.created_at,
                )}
                .
              </p>
              <a
                className="saved-report-share-url"
                href={report.homeowner_quote.share_path}
                target="_blank"
                rel="noreferrer"
              >
                {buildShareUrl(report.homeowner_quote.share_path)}
              </a>
            </>
          ) : (
            <p className="saved-report-quote-note">
              Promote this saved report into a shareable homeowner quote when you are ready.
            </p>
          )}
        </article>
      ))}
    </div>
  );
}

function SavedGardenPlans({ records, activeGuid, onOpen, loading, error }) {
  return (
    <section className="saved-plan-section">
      <div className="saved-plan-header">
        <div>
          <p className="eyebrow">Saved plans</p>
          <h3>Recent garden properties</h3>
        </div>
        <p className="panel-copy">
          Reopen mapped yard plans from the shared property record instead of rebuilding each
          property from scratch.
        </p>
      </div>

      {loading && !records.length ? (
        <div className="status-card status-card-muted">
          <span className="status-label">Saved plans</span>
          <strong>Loading recent garden properties</strong>
          <p>Pulling saved plans with mapped garden zones.</p>
        </div>
      ) : records.length ? (
        <div className="saved-plan-list">
          {records.map((record) => {
            const zoneCount = (record.garden_zones || []).length;
            const totalAreaSquareFeet = (record.garden_zones || []).reduce(
              (total, zone) => total + Number(zone.areaSquareFeet || 0),
              0,
            );
            const addressLabel =
              record.property_preview?.formatted_address || formatAddressLine(record.address);
            const isActive = record.guid === activeGuid;
            const canOpen = Boolean(record.property_preview);

            return (
              <article
                className={`saved-plan-card ${isActive ? "saved-plan-card-active" : ""}`}
                key={record.guid}
              >
                <div className="saved-plan-card-header">
                  <div>
                    <strong>{addressLabel}</strong>
                    <p>{formatDateTime(record.stored_at)}</p>
                  </div>
                  {isActive ? <span className="soft-badge soft-badge-neutral">Current plan</span> : null}
                </div>

                <div className="saved-plan-metrics">
                  <span>{zoneCount} mapped zones</span>
                  <span>{formatNumber(totalAreaSquareFeet, 0)} sq ft</span>
                  <span>{record.saved_solar_reports?.length || 0} saved solar reports</span>
                </div>

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onOpen(record)}
                  disabled={isActive || !canOpen}
                >
                  {isActive ? "Current plan" : canOpen ? "Open plan" : "Preview unavailable"}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="saved-plan-empty">
          No saved garden plans yet. Draw and save at least one mapped garden zone to start a
          reusable plan library.
        </p>
      )}

      {error ? <p className="saved-plan-empty">{error}</p> : null}
    </section>
  );
}

function GardenZoneSelector({ zones, selectedZoneId, onSelect }) {
  if (!zones.length) {
    return null;
  }

  return (
    <section className="garden-zone-selector">
      <p className="eyebrow">Mapped zones</p>
      <div className="garden-zone-grid">
        {zones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={`garden-zone-button ${
              zone.id === selectedZoneId ? "garden-zone-button-active" : ""
            }`}
            onClick={() => onSelect(zone.id)}
          >
            <strong>{zone.name}</strong>
            <div className="garden-zone-meta">
              <SunClassBadge sunClass={zone.analysis?.sunClass} />
              <span>{formatNumber(zone.areaSquareFeet, 0)} sq ft</span>
            </div>
            <span>
              {formatNumber(zone.analysis?.growingSeasonAverageSunHours ?? 0, 1)} hrs/day avg
              Apr-Sep
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function GardenPlantingGuidance({ zone, climate }) {
  const guidance = buildPlantingGuidance(zone, climate);

  if (!guidance) {
    return null;
  }

  return (
    <section className="garden-guidance-section">
      <div className="garden-guidance-header">
        <div>
          <p className="eyebrow">Planting guidance</p>
          <h3>{zone.name} crop fit</h3>
        </div>
        <SunClassBadge sunClass={zone.analysis?.sunClass} />
      </div>

      <div className="garden-guidance-grid">
        <article className="guidance-card garden-guidance-card-feature">
          <span className="status-label">Best fit</span>
          <strong>{guidance.headline}</strong>
          <p>{guidance.summary}</p>
          <ul className="guidance-list">
            {guidance.cropMatches.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="guidance-card">
          <span className="status-label">Timing</span>
          <strong>Match the crop window to the light curve</strong>
          <ul className="guidance-list">
            {guidance.timingMoves.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="guidance-card">
          <span className="status-label">Layout</span>
          <strong>Protect the brightest part of the zone</strong>
          <ul className="guidance-list">
            {guidance.layoutMoves.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="guidance-card">
          <span className="status-label">Watchouts</span>
          <strong>Keep the model limits visible</strong>
          <ul className="guidance-list">
            {guidance.watchOuts.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </div>

      <article className="guidance-card status-card-muted garden-guidance-data-note">
        <span className="status-label">Zone + season data</span>
        <strong>Use hardiness to choose crop types, then use light to place them</strong>
        <p>{guidance.zoneSummary}</p>
        <p>{guidance.seasonModelNote}</p>
      </article>

      {guidance.seasonPlans.length || guidance.perennialPlan ? (
        <div className="garden-guidance-grid">
          {guidance.seasonPlans.map((plan) => (
            <article className="guidance-card" key={plan.id}>
              <span className="status-label">{plan.label}</span>
              <strong>{plan.summary}</strong>
              <ul className="guidance-list">
                {plan.crops.map((crop) => (
                  <li key={crop.id}>
                    <span className="crop-fit-name">{crop.name}</span>
                    <span>{crop.detail}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}

          {guidance.perennialPlan ? (
            <article className="guidance-card" key="perennial-fit">
              <span className="status-label">{guidance.perennialPlan.label}</span>
              <strong>{guidance.perennialPlan.summary}</strong>
              <ul className="guidance-list">
                {guidance.perennialPlan.outdoor.map((crop) => (
                  <li key={crop.id}>
                    <span className="crop-fit-name">{crop.name}</span>
                    <span>{crop.detail}</span>
                  </li>
                ))}
              </ul>
              {guidance.perennialPlan.container.length ? (
                <>
                  <p className="garden-guidance-subcopy">Container or protected options</p>
                  <ul className="guidance-list">
                    {guidance.perennialPlan.container.map((crop) => (
                      <li key={crop.id}>
                        <span className="crop-fit-name">{crop.name}</span>
                        <span>{crop.detail}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState(() =>
    typeof window === "undefined" ? "solar" : getPageIdFromHash(window.location.hash),
  );
  const [form, setForm] = useState(initialForm);
  const [propertyRecordGuid, setPropertyRecordGuid] = useState(null);
  const [propertyPreview, setPropertyPreview] = useState(null);
  const [propertyLoading, setPropertyLoading] = useState(false);
  const [browserLocationLoading, setBrowserLocationLoading] = useState(false);
  const [propertyRecordSaving, setPropertyRecordSaving] = useState(false);
  const [propertyError, setPropertyError] = useState("");
  const [roofSelection, setRoofSelection] = useState(null);
  const [gardenZones, setGardenZones] = useState([]);
  const [selectedGardenZoneId, setSelectedGardenZoneId] = useState(null);
  const [drawingTarget, setDrawingTarget] = useState(null);
  const [drawingPoints, setDrawingPoints] = useState([]);
  const [result, setResult] = useState(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState("");
  const [savedSolarReports, setSavedSolarReports] = useState([]);
  const [reportSaving, setReportSaving] = useState(false);
  const [reportError, setReportError] = useState("");
  const [quoteCreatingReportId, setQuoteCreatingReportId] = useState("");
  const [copiedQuoteId, setCopiedQuoteId] = useState("");
  const [spaceWeather, setSpaceWeather] = useState(null);
  const [spaceWeatherLoading, setSpaceWeatherLoading] = useState(false);
  const [spaceWeatherError, setSpaceWeatherError] = useState("");
  const [surfaceIrradiance, setSurfaceIrradiance] = useState(null);
  const [surfaceIrradianceLoading, setSurfaceIrradianceLoading] = useState(false);
  const [surfaceIrradianceError, setSurfaceIrradianceError] = useState("");
  const [propertyContext, setPropertyContext] = useState(null);
  const [propertyContextLoading, setPropertyContextLoading] = useState(false);
  const [propertyContextError, setPropertyContextError] = useState("");
  const [propertyClimate, setPropertyClimate] = useState(null);
  const [propertyClimateLoading, setPropertyClimateLoading] = useState(false);
  const [propertyClimateError, setPropertyClimateError] = useState("");
  const [savedGardenPlans, setSavedGardenPlans] = useState([]);
  const [savedGardenPlansLoading, setSavedGardenPlansLoading] = useState(false);
  const [savedGardenPlansError, setSavedGardenPlansError] = useState("");
  const isSolarPage = activePage === "solar";
  const isSpaceWeatherPage = activePage === "space-weather";
  const isGardenPage = activePage === "garden";
  const activeBuddy = isGardenPage ? "garden" : "solar";

  const addressReady = useMemo(
    () =>
      Object.values(form.address).every((value) => String(value).trim().length > 0),
    [form.address],
  );
  const propertyLocated = Boolean(propertyPreview);
  const solarReadyForEstimate =
    propertyLocated && Boolean(roofSelection) && Boolean(propertyRecordGuid) && !propertyRecordSaving;

  const highLevelSummary = result
    ? `This address shows ${
        result.avg_all_sky_radiation >= 5
          ? "strong"
          : result.avg_all_sky_radiation >= 4
            ? "solid"
            : "moderate"
      } solar potential with about ${formatNumber(
        result.annual_production,
        0,
      )} kWh of yearly production using a ${formatNumber(
        result.system_size_kw || roofSelection?.recommendedKw || form.system_size,
        1,
      )} kW roof-backed system size.`
    : null;

  const analyzedGardenZones = useMemo(
    () => analyzeGardenZones(gardenZones, propertyPreview, propertyContext),
    [gardenZones, propertyPreview, propertyContext],
  );

  const totalGardenAreaSquareFeet = useMemo(
    () => analyzedGardenZones.reduce((total, zone) => total + zone.areaSquareFeet, 0),
    [analyzedGardenZones],
  );

  const selectedGardenZone =
    analyzedGardenZones.find((zone) => zone.id === selectedGardenZoneId) ||
    analyzedGardenZones[0] ||
    null;
  const activeModeContent = modeContentByMode[activeBuddy];
  const landingContent = landingContentByPage[activePage];

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleHashChange = () => {
      setActivePage(getPageIdFromHash(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextHash = `#${activePage}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
    }
  }, [activePage]);

  useEffect(() => {
    setDrawingTarget(null);
    setDrawingPoints([]);
  }, [activePage]);

  useEffect(() => {
    if (!propertyPreview?.latitude || !propertyPreview?.longitude) {
      setSurfaceIrradiance(null);
      setSurfaceIrradianceLoading(false);
      setSurfaceIrradianceError("");
      return;
    }

    let cancelled = false;
    const coordinates = {
      latitude: propertyPreview.latitude,
      longitude: propertyPreview.longitude,
    };

    setSurfaceIrradianceLoading(true);
    setSurfaceIrradianceError("");

    fetchSurfaceIrradiance(coordinates)
      .then((nextSurfaceIrradiance) => {
        if (cancelled) {
          return;
        }

        setSurfaceIrradiance(nextSurfaceIrradiance);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSurfaceIrradiance(null);
        setSurfaceIrradianceError(
          error?.message || "Unable to load local surface irradiance conditions.",
        );
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setSurfaceIrradianceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [propertyPreview?.latitude, propertyPreview?.longitude]);

  useEffect(() => {
    if (!propertyPreview?.latitude || !propertyPreview?.longitude) {
      setSpaceWeather(null);
      setSpaceWeatherLoading(false);
      setSpaceWeatherError("");
      return;
    }

    if (!isSpaceWeatherPage) {
      return;
    }

    let cancelled = false;
    const coordinates = {
      latitude: propertyPreview.latitude,
      longitude: propertyPreview.longitude,
    };

    setSpaceWeatherLoading(true);
    setSpaceWeatherError("");

    fetchSpaceWeather(coordinates)
      .then((nextSpaceWeather) => {
        if (cancelled) {
          return;
        }

        setSpaceWeather(nextSpaceWeather);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setSpaceWeather(null);
        setSpaceWeatherError(error?.message || "Unable to load live space-weather conditions.");
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setSpaceWeatherLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isSpaceWeatherPage, propertyPreview?.latitude, propertyPreview?.longitude]);

  useEffect(() => {
    if (!propertyPreview?.latitude || !propertyPreview?.longitude) {
      setPropertyContext(null);
      setPropertyContextLoading(false);
      setPropertyContextError("");
      return;
    }

    if (!isGardenPage) {
      return;
    }

    const coordinatesMatch =
      propertyContext?.context_version === "property-context-v1" &&
      Math.abs((propertyContext?.latitude || 0) - propertyPreview.latitude) < 0.000001 &&
      Math.abs((propertyContext?.longitude || 0) - propertyPreview.longitude) < 0.000001;
    if (coordinatesMatch) {
      return;
    }

    let cancelled = false;

    setPropertyContextLoading(true);
    setPropertyContextError("");

    fetchPropertyContext({
      latitude: propertyPreview.latitude,
      longitude: propertyPreview.longitude,
      bounds: propertyPreview.bounds || null,
      matchQuality: propertyPreview.match_quality,
    })
      .then(async (nextPropertyContext) => {
        if (cancelled) {
          return;
        }

        setPropertyContext(nextPropertyContext);

        if (!propertyRecordGuid) {
          return;
        }

        try {
          await persistPropertyRecord({
            guid: propertyRecordGuid,
            address: propertyPreview.address || form.address,
            preview: propertyPreview,
            nextRoofSelection: roofSelection,
            nextGardenZones: gardenZones,
            nextPropertyContext,
          });
        } catch (submissionError) {
          if (!cancelled) {
            setPropertyContextError(
              submissionError.message ||
                "Site context loaded, but saving it to the property record failed.",
            );
          }
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setPropertyContext(null);
        setPropertyContextError(
          error?.message || "Unable to load nearby building and terrain context for this property.",
        );
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setPropertyContextLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    isGardenPage,
    form.address,
    gardenZones,
    propertyContext,
    propertyPreview,
    propertyRecordGuid,
    roofSelection,
  ]);

  useEffect(() => {
    if (!propertyPreview?.latitude || !propertyPreview?.longitude) {
      setPropertyClimate(null);
      setPropertyClimateLoading(false);
      setPropertyClimateError("");
      return;
    }

    if (!isGardenPage) {
      return;
    }

    let cancelled = false;
    const coordinates = {
      latitude: propertyPreview.latitude,
      longitude: propertyPreview.longitude,
    };

    setPropertyClimateLoading(true);
    setPropertyClimateError("");

    fetchPropertyClimate(coordinates)
      .then((nextPropertyClimate) => {
        if (cancelled) {
          return;
        }

        setPropertyClimate(nextPropertyClimate);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setPropertyClimate(null);
        setPropertyClimateError(
          error?.message || "Unable to load recent historical climate for this property.",
        );
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setPropertyClimateLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isGardenPage, propertyPreview?.latitude, propertyPreview?.longitude]);

  useEffect(() => {
    if (!isGardenPage) {
      return;
    }

    void loadSavedGardenPlans();
  }, [isGardenPage]);

  function resetPropertyState() {
    setPropertyRecordGuid(null);
    setPropertyPreview(null);
    setPropertyRecordSaving(false);
    setPropertyError("");
    setResult(null);
    setEstimateError("");
    setSavedSolarReports([]);
    setReportSaving(false);
    setReportError("");
    setQuoteCreatingReportId("");
    setCopiedQuoteId("");
    setRoofSelection(null);
    setGardenZones([]);
    setSelectedGardenZoneId(null);
    setDrawingTarget(null);
    setDrawingPoints([]);
    setSpaceWeather(null);
    setSpaceWeatherError("");
    setSpaceWeatherLoading(false);
    setSurfaceIrradiance(null);
    setSurfaceIrradianceError("");
    setSurfaceIrradianceLoading(false);
    setPropertyContext(null);
    setPropertyContextError("");
    setPropertyContextLoading(false);
    setPropertyClimate(null);
    setPropertyClimateError("");
    setPropertyClimateLoading(false);
  }

  function updateAddress(field, value) {
    setForm((current) => ({
      ...current,
      address: {
        ...current.address,
        [field]: value,
      },
    }));
    resetPropertyState();
  }

  function updateNumber(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value === "" ? "" : Number(value),
    }));
  }

  function hydrateSavedPropertyRecord(record) {
    const restoredRoofSelection = record?.roof_selection || null;
    const restoredGardenZones = record?.garden_zones || [];
    const restoredSolarReports = record?.saved_solar_reports || [];
    const restoredPropertyContext = record?.property_context || null;

    setRoofSelection(restoredRoofSelection);
    setGardenZones(restoredGardenZones);
    setSavedSolarReports(restoredSolarReports);
    setPropertyContext(restoredPropertyContext);
    setSelectedGardenZoneId((current) => {
      if (!restoredGardenZones.length) {
        return null;
      }

      if (current && restoredGardenZones.some((zone) => zone.id === current)) {
        return current;
      }

      return restoredGardenZones[0].id;
    });
  }

  async function loadSavedGardenPlans({ background = false } = {}) {
    if (!background) {
      setSavedGardenPlansLoading(true);
    }

    setSavedGardenPlansError("");

    try {
      const records = await listPropertyRecords({
        maxItems: 8,
        requireGardenZones: true,
      });
      setSavedGardenPlans(records);
      return records;
    } catch (submissionError) {
      if (!background) {
        setSavedGardenPlans([]);
      }
      setSavedGardenPlansError(
        submissionError.message || "Unable to load recent saved garden plans.",
      );
      return [];
    } finally {
      if (!background) {
        setSavedGardenPlansLoading(false);
      }
    }
  }

  async function persistPropertyRecord({
    guid = propertyRecordGuid,
    address,
    preview = propertyPreview,
    nextRoofSelection = roofSelection,
    nextGardenZones = gardenZones,
    nextPropertyContext = propertyContext,
  }) {
    setPropertyRecordSaving(true);

    try {
      const savedRecord = await upsertPropertyRecord({
        guid,
        address,
        propertyPreview: preview,
        propertyContext: nextPropertyContext,
        roofSelection: nextRoofSelection,
        gardenZones: nextGardenZones,
      });
      setPropertyRecordGuid(savedRecord.guid);
      setPropertyContext(savedRecord.property_context || nextPropertyContext || null);
      setSavedSolarReports(savedRecord.saved_solar_reports || []);
      if (isGardenPage || (savedRecord.garden_zones || []).length) {
        void loadSavedGardenPlans({ background: true });
      }
      return savedRecord;
    } finally {
      setPropertyRecordSaving(false);
    }
  }

  function handleOpenSavedGardenPlan(record) {
    if (!record?.property_preview) {
      setPropertyError("This saved garden plan is missing map preview data and cannot reopen yet.");
      return;
    }

    setForm((current) => ({
      ...current,
      address: {
        ...current.address,
        ...(record.address || {}),
      },
    }));
    setPropertyRecordGuid(record.guid || null);
    setPropertyPreview(record.property_preview);
    setPropertyLoading(false);
    setBrowserLocationLoading(false);
    setPropertyRecordSaving(false);
    setPropertyError("");
    setResult(null);
    setEstimateError("");
    setReportSaving(false);
    setReportError("");
    setQuoteCreatingReportId("");
    setCopiedQuoteId("");
    setDrawingTarget(null);
    setDrawingPoints([]);
    setSpaceWeather(null);
    setSpaceWeatherError("");
    setSpaceWeatherLoading(false);
    setSurfaceIrradiance(null);
    setSurfaceIrradianceError("");
    setSurfaceIrradianceLoading(false);
    setPropertyContext(record?.property_context || null);
    setPropertyContextError("");
    setPropertyContextLoading(false);
    hydrateSavedPropertyRecord(record);
  }

  async function handleLocateProperty() {
    if (!addressReady) {
      setPropertyError("Enter a complete address first.");
      return;
    }

    setPropertyLoading(true);
    setPropertyError("");
    setReportError("");

    try {
      const nextPreview = await fetchPropertyPreview(form.address);
      const resolvedAddress = nextPreview.address
        ? {
            ...form.address,
            ...nextPreview.address,
          }
        : form.address;

      if (nextPreview.address) {
        setForm((current) => ({
          ...current,
          address: {
            ...current.address,
            ...nextPreview.address,
          },
        }));
      }
      const existingRecord = await findPropertyRecordByAddress(resolvedAddress);
      const restoredRoofSelection = existingRecord?.roof_selection ?? roofSelection;
      const restoredGardenZones = existingRecord?.garden_zones ?? gardenZones;
      const restoredPropertyContext = existingRecord?.property_context ?? null;
      const savedRecord = await persistPropertyRecord({
        guid: existingRecord?.guid ?? propertyRecordGuid,
        address: resolvedAddress,
        preview: nextPreview,
        nextRoofSelection: restoredRoofSelection,
        nextGardenZones: restoredGardenZones,
        nextPropertyContext: restoredPropertyContext,
      });
      hydrateSavedPropertyRecord(savedRecord);
      setPropertyPreview(nextPreview);
    } catch (submissionError) {
      setPropertyError(submissionError.message || "Unable to locate the property.");
    } finally {
      setPropertyLoading(false);
    }
  }

  async function handleUseBrowserLocation() {
    setBrowserLocationLoading(true);
    setPropertyError("");
    setReportError("");

    try {
      const position = await getBrowserCoordinates();
      const nextPreview = await reverseGeocodeCoordinates({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const resolvedAddress = {
        ...form.address,
        ...nextPreview.address,
      };

      setForm((current) => ({
        ...current,
        address: {
          ...current.address,
          ...nextPreview.address,
        },
      }));
      resetPropertyState();
      const existingRecord = await findPropertyRecordByAddress(resolvedAddress);
      const restoredRoofSelection = existingRecord?.roof_selection ?? null;
      const restoredGardenZones = existingRecord?.garden_zones ?? [];
      const restoredPropertyContext = existingRecord?.property_context ?? null;
      const savedRecord = await persistPropertyRecord({
        guid: existingRecord?.guid ?? null,
        address: resolvedAddress,
        preview: nextPreview,
        nextRoofSelection: restoredRoofSelection,
        nextGardenZones: restoredGardenZones,
        nextPropertyContext: restoredPropertyContext,
      });
      hydrateSavedPropertyRecord(savedRecord);
      setPropertyPreview(nextPreview);
    } catch (locationError) {
      setPropertyError(getGeolocationErrorMessage(locationError));
    } finally {
      setBrowserLocationLoading(false);
    }
  }

  function startRoofDrawing() {
    setDrawingTarget("roof");
    setDrawingPoints([]);
  }

  function startGardenDrawing() {
    setDrawingTarget("garden");
    setDrawingPoints([]);
  }

  function cancelDrawing() {
    setDrawingTarget(null);
    setDrawingPoints([]);
  }

  function addDrawingPoint(point) {
    setDrawingPoints((current) => [...current, point]);
  }

  async function finishDrawing() {
    if (drawingPoints.length < 3) {
      return;
    }

    if (drawingTarget === "roof") {
      const nextRoofSelection = buildRoofModel(drawingPoints);
      setRoofSelection(nextRoofSelection);

      if (isSolarPage && propertyPreview) {
        try {
          await persistPropertyRecord({
            address: propertyPreview.address || form.address,
            preview: propertyPreview,
            nextRoofSelection,
          });
        } catch (submissionError) {
          setPropertyError(
            submissionError.message ||
              "Roof drawn, but saving the property record failed. The estimate will try again with this roof selection.",
          );
        }
      }
    }

    if (drawingTarget === "garden") {
      const nextZone = buildGardenZone(drawingPoints, gardenZones.length);
      const nextGardenZones = [...gardenZones, nextZone];
      setGardenZones(nextGardenZones);
      setSelectedGardenZoneId(nextZone.id);

      if (propertyPreview) {
        try {
          await persistPropertyRecord({
            address: propertyPreview.address || form.address,
            preview: propertyPreview,
            nextRoofSelection: roofSelection,
            nextGardenZones,
          });
        } catch (submissionError) {
          setPropertyError(
            submissionError.message ||
              "Zone drawn, but saving the property record failed. The garden layout is still visible locally.",
          );
        }
      }
    }

    setDrawingTarget(null);
    setDrawingPoints([]);
  }

  async function clearRoof() {
    if (propertyPreview && propertyRecordGuid) {
      try {
        await persistPropertyRecord({
          address: propertyPreview.address || form.address,
          preview: propertyPreview,
          nextRoofSelection: null,
        });
      } catch (submissionError) {
        setPropertyError(
          submissionError.message || "Unable to clear the saved roof selection.",
        );
        return;
      }
    }

    setRoofSelection(null);
    setResult(null);
    if (drawingTarget === "roof") {
      cancelDrawing();
    }
  }

  async function removeSelectedGardenZone(zoneId) {
    const nextGardenZones = gardenZones.filter((zone) => zone.id !== zoneId);
    const nextSelectedGardenZoneId =
      selectedGardenZoneId === zoneId ? nextGardenZones[0]?.id || null : selectedGardenZoneId;

    setGardenZones(nextGardenZones);
    setSelectedGardenZoneId(nextSelectedGardenZoneId);

    if (propertyPreview) {
      try {
        await persistPropertyRecord({
          address: propertyPreview.address || form.address,
          preview: propertyPreview,
          nextRoofSelection: roofSelection,
          nextGardenZones,
        });
      } catch (submissionError) {
        setPropertyError(
          submissionError.message ||
            "Zone removed locally, but saving the updated property record failed.",
        );
      }
    }
  }

  async function clearGardenZones() {
    setGardenZones([]);
    setSelectedGardenZoneId(null);

    if (propertyPreview) {
      try {
        await persistPropertyRecord({
          address: propertyPreview.address || form.address,
          preview: propertyPreview,
          nextRoofSelection: roofSelection,
          nextGardenZones: [],
        });
      } catch (submissionError) {
        setPropertyError(
          submissionError.message ||
            "Garden zones were cleared locally, but saving the empty property record failed.",
        );
      }
    }

    if (drawingTarget === "garden") {
      cancelDrawing();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!isSolarPage) {
      return;
    }

    if (!propertyLocated) {
      setEstimateError("Locate the property on the map first.");
      return;
    }

    if (!roofSelection) {
      setEstimateError("Draw a roof area on the map first.");
      return;
    }

    if (!propertyRecordGuid) {
      setEstimateError("Property context is still saving. Try again in a moment.");
      return;
    }

    setEstimateLoading(true);
    setEstimateError("");
    setReportError("");

    try {
      const nextResult = await fetchSolarEstimate({
        ...form,
        guid: propertyRecordGuid,
        roofSelection,
      });
      setResult(nextResult);
      setPropertyPreview((current) => buildPropertyPreviewFromEstimate(nextResult, current));
    } catch (submissionError) {
      setEstimateError(submissionError.message || "Unable to calculate a solar estimate.");
    } finally {
      setEstimateLoading(false);
    }
  }

  function handlePageChange(pageId) {
    setActivePage(pageId);
  }

  function handleIntakeSubmit(event) {
    if (isSolarPage) {
      void handleSubmit(event);
      return;
    }

    event.preventDefault();
    void handleLocateProperty();
  }

  async function handleSaveSolarReport() {
    if (!propertyRecordGuid) {
      setReportError("Property context is still saving. Try again in a moment.");
      return;
    }

    if (!result) {
      setReportError("Run the estimate before saving a report.");
      return;
    }

    setReportSaving(true);
    setReportError("");

    try {
      const response = await saveSolarReport({
        guid: propertyRecordGuid,
        panel_efficiency: form.panel_efficiency,
        electricity_rate: form.electricity_rate,
        installation_cost_per_watt: form.installation_cost_per_watt,
        roofSelection,
      });
      if (response.estimate) {
        setResult(response.estimate);
        setPropertyPreview((current) => buildPropertyPreviewFromEstimate(response.estimate, current));
      }
      setSavedSolarReports(response.reports || []);
    } catch (submissionError) {
      setReportError(submissionError.message || "Unable to save the current solar report.");
    } finally {
      setReportSaving(false);
    }
  }

  async function handleCreateSolarQuote(reportId) {
    if (!propertyRecordGuid) {
      setReportError("Property context is still saving. Try again in a moment.");
      return;
    }

    setQuoteCreatingReportId(reportId);
    setReportError("");

    try {
      const response = await createSolarQuote({
        guid: propertyRecordGuid,
        reportId,
      });
      setSavedSolarReports(response.reports || []);
    } catch (submissionError) {
      setReportError(submissionError.message || "Unable to create the homeowner quote.");
    } finally {
      setQuoteCreatingReportId("");
    }
  }

  async function handleCopyQuoteLink(quote) {
    if (!quote?.share_path) {
      setReportError("Homeowner quote link is not available yet.");
      return;
    }

    try {
      await navigator.clipboard.writeText(buildShareUrl(quote.share_path));
      setCopiedQuoteId(quote.id);
      window.setTimeout(() => {
        setCopiedQuoteId((current) => (current === quote.id ? "" : current));
      }, 2000);
    } catch (copyError) {
      setReportError("Unable to copy the homeowner quote link.");
    }
  }

  return (
    <div className="page-shell">
      <div className="background-orb background-orb-left" />
      <div className="background-orb background-orb-right" />

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Buddy platform</p>
          <h1>{landingContent.title}</h1>
          <p className="hero-text">{landingContent.summary}</p>
        </div>

        <div className="hero-actions">
          <div className="hero-steps" aria-label="Workflow">
            {landingContent.steps.map((step) => (
              <span key={step} className="soft-badge">
                {step}
              </span>
            ))}
          </div>
          <div className="buddy-switch" role="tablist" aria-label="Product page switch">
            {pageModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`buddy-switch-button ${
                  activePage === mode.id ? "buddy-switch-button-active" : ""
                }`}
                onClick={() => handlePageChange(mode.id)}
              >
                <strong>{mode.label}</strong>
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="layout-grid">
        <section className="panel intake-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{landingContent.pageLabel}</p>
              <h2>{landingContent.intakeTitle}</h2>
            </div>
            <p className="panel-copy">{landingContent.intakeCopy}</p>
          </div>

          <form className="solar-form" onSubmit={handleIntakeSubmit}>
            <AddressFields address={form.address} onChange={updateAddress} />

            <div className="action-row">
              <button
                className="secondary-button"
                type="button"
                onClick={handleLocateProperty}
                disabled={
                  propertyLoading || browserLocationLoading || propertyRecordSaving || !addressReady
                }
              >
                {propertyLoading
                  ? "Locating..."
                  : "Locate property"}
              </button>

              {isSolarPage ? (
                <button
                  className="primary-button"
                  type="submit"
                  disabled={estimateLoading || !solarReadyForEstimate}
                >
                  {estimateLoading
                    ? "Calculating..."
                    : !propertyLocated
                      ? "Locate property first"
                      : !roofSelection
                        ? "Draw roof first"
                        : propertyRecordSaving
                          ? "Saving roof..."
                          : "Calculate solar estimate"}
                </button>
              ) : null}
            </div>

            {isSolarPage ? (
              <>
                <div className="field-row">
                  <label>
                    Roof-backed system size
                    <input
                      readOnly
                      value={
                        roofSelection
                          ? `${formatNumber(roofSelection.recommendedKw, 1)} kW from drawn roof`
                          : "Draw a roof area on the map"
                      }
                    />
                  </label>

                  <label>
                    Panel efficiency
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      required
                      value={form.panel_efficiency}
                      onChange={(event) => updateNumber("panel_efficiency", event.target.value)}
                    />
                  </label>
                </div>

                <div className="field-row">
                  <label>
                    Electricity rate ($/kWh)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={form.electricity_rate}
                      onChange={(event) => updateNumber("electricity_rate", event.target.value)}
                    />
                  </label>

                  <label>
                    Install cost ($/W)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={form.installation_cost_per_watt}
                      onChange={(event) =>
                        updateNumber("installation_cost_per_watt", event.target.value)
                      }
                    />
                  </label>
                </div>
              </>
            ) : null}
          </form>

          {propertyError ? <p className="error-banner">{propertyError}</p> : null}
          {estimateError ? <p className="error-banner">{estimateError}</p> : null}
          {reportError ? <p className="error-banner">{reportError}</p> : null}

          {propertyPreview ? (
            <div className="status-card">
              <span className="status-label">Current property</span>
              <strong>{propertyPreview.formatted_address}</strong>
              <p>
                Centered at {formatCoordinate(propertyPreview.latitude)},{" "}
                {formatCoordinate(propertyPreview.longitude)} from the current{" "}
                {String(propertyPreview.source || "").includes("browser-location")
                  ? "browser location match"
                  : "geocode match"}
                .
              </p>
              {propertyPreview.address ? (
                <p>
                  Using resolved address: {propertyPreview.address.street},{" "}
                  {propertyPreview.address.city}, {propertyPreview.address.state}{" "}
                  {propertyPreview.address.zip}, {propertyPreview.address.country}
                </p>
              ) : null}
              {propertyPreview.match_quality !== "high" ? (
                <p>
                  Match quality is {propertyPreview.match_quality}. The map may be close but not
                  parcel-exact until roof editing and better property data land.
                </p>
              ) : null}
              {isSolarPage && propertyRecordGuid ? (
                <p>
                  Property record {propertyRecordSaving ? "is saving" : "is active"} for the
                  current roof-backed estimate flow with {savedSolarReports.length} saved
                  {savedSolarReports.length === 1 ? " report" : " reports"}.
                </p>
              ) : null}
              {isSpaceWeatherPage ? (
                <p>
                  Space Weather uses this property center for live flare, aurora, geomagnetic, and
                  surface sunlight conditions.
                </p>
              ) : null}
              {isGardenPage && propertyRecordGuid ? (
                <p>
                  Garden zones {propertyRecordSaving ? "are saving into" : "now live in"} the
                  shared property record, recent saved plans can reopen directly from the garden
                  library, and planting guidance follows the saved exposure model.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="status-card status-card-muted">
              <span className="status-label">Current property</span>
              <strong>No property located yet</strong>
              <p>Enter a full address or use browser location to begin.</p>
            </div>
          )}

          {isGardenPage ? (
            <SavedGardenPlans
              records={savedGardenPlans}
              activeGuid={propertyRecordGuid}
              onOpen={handleOpenSavedGardenPlan}
              loading={savedGardenPlansLoading}
              error={savedGardenPlansError}
            />
          ) : null}

          {isSolarPage && roofSelection ? (
            <div className="status-card">
              <span className="status-label">Roof geometry</span>
              <strong>{roofSelection.areaSquareFeet} sq ft drawn on the live map</strong>
              <p>
                That suggests about {roofSelection.recommendedKw} kW of first-pass usable capacity
                for the selected roof plane at baseline panel efficiency. The live estimate now
                rechecks system size from this roof and your selected panel efficiency before it
                models production.
              </p>
            </div>
          ) : null}

          {isGardenPage ? (
            <div className="guidance-stack">
              <article className="guidance-card">
                <strong>Use Street first</strong>
                <p>Street tiles are better for lot-level inspection and nearby structures.</p>
              </article>
              <article className="guidance-card">
                <strong>Use Terrain second</strong>
                <p>Terrain is now contextual only. Use it for slope and surrounding elevation cues, not parcel-close placement.</p>
              </article>
            </div>
          ) : null}
        </section>

        <section className="results-column">
          <PropertyMap
            preview={propertyPreview}
            mode={activePage}
            isLocating={propertyLoading || browserLocationLoading || propertyRecordSaving}
            roofSelection={roofSelection}
            propertyContext={propertyContext}
            gardenZones={analyzedGardenZones}
            selectedGardenZoneId={selectedGardenZoneId}
            drawingTarget={drawingTarget}
            drawingPoints={drawingPoints}
            onMapPointAdd={addDrawingPoint}
            onUseBrowserLocation={handleUseBrowserLocation}
            onStartRoofDrawing={startRoofDrawing}
            onStartGardenDrawing={startGardenDrawing}
            onFinishDrawing={finishDrawing}
            onCancelDrawing={cancelDrawing}
            onClearRoof={clearRoof}
            onSelectGardenZone={setSelectedGardenZoneId}
            onRemoveSelectedGardenZone={removeSelectedGardenZone}
            onClearGardenZones={clearGardenZones}
          />

          {isSolarPage ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Solar result</p>
                  <h2>What Solar Buddy sees</h2>
                </div>
                <p className="panel-copy">{activeModeContent.resultPanelCopy}</p>
              </div>

              {result ? (
                <>
                  <p className="summary-copy">{highLevelSummary}</p>

                  <div className="stats-grid">
                    <StatCard
                      label="Annual production"
                      value={`${formatNumber(result.annual_production, 0)} kWh`}
                      detail={`Daily average ${formatNumber(result.daily_production, 1)} kWh`}
                    />
                    <StatCard
                      label="Annual savings"
                      value={formatCurrency(result.annual_savings)}
                      detail={`25-year savings ${formatCurrency(result.total_savings_25_years)}`}
                    />
                    <StatCard
                      label="Payback"
                      value={
                        result.payback_period
                          ? `${formatNumber(result.payback_period, 1)} years`
                          : "N/A"
                      }
                      detail={`System cost ${formatCurrency(result.system_cost)}`}
                    />
                    <StatCard
                      label="Data source"
                      value={result.data_source || "unknown"}
                      detail={`Quality: ${result.data_quality || "unknown"}`}
                    />
                    <StatCard
                      label="Estimate confidence"
                      value={result.confidence?.label || "Pending"}
                      detail={result.confidence?.description || "Confidence details unavailable."}
                    />
                    <StatCard
                      label="System size"
                      value={`${formatNumber(result.system_size_kw, 1)} kW`}
                      detail={
                        result.sizing_source === "roof-geometry"
                          ? "Derived from the saved roof selection."
                          : "Using manual sizing fallback."
                      }
                    />
                    <StatCard
                      label="Roof area"
                      value={
                        result.roof_area_square_feet
                          ? `${formatNumber(result.roof_area_square_feet, 0)} sq ft`
                          : roofSelection
                            ? `${formatNumber(roofSelection.areaSquareFeet, 0)} sq ft`
                            : "Not drawn"
                      }
                      detail={
                        result.roof_area_square_feet
                          ? `${formatNumber(result.system_size_kw, 1)} kW used in estimate`
                          : roofSelection
                            ? `${formatNumber(roofSelection.recommendedKw, 1)} kW suggested`
                          : "Draw a roof polygon on the live map."
                      }
                    />
                    <StatCard
                      label="Specific yield"
                      value={`${formatNumber(result.specific_yield, 0)} kWh/kW-yr`}
                      detail={`Capacity factor ${formatNumber((result.capacity_factor || 0) * 100, 1)}%`}
                    />
                  </div>

                  <div className="info-grid">
                    <article className="info-card">
                      <span>Address</span>
                      <strong>{result.address}</strong>
                    </article>
                    <article className="info-card">
                      <span>Coordinates</span>
                      <strong>
                        {formatCoordinate(result.latitude)}, {formatCoordinate(result.longitude)}
                      </strong>
                    </article>
                    <article className="info-card">
                      <span>All-sky radiation</span>
                      <strong>
                        {formatNumber(result.avg_all_sky_radiation, 2)} {result.unit}
                      </strong>
                    </article>
                    <article className="info-card">
                      <span>Time zone</span>
                      <strong>{result.time_zone || "Unknown"}</strong>
                    </article>
                    <article className="info-card">
                      <span>Production model</span>
                      <strong>{result.production_model?.label || "Unknown"}</strong>
                    </article>
                    <article className="info-card">
                      <span>Peak month</span>
                      <strong>
                        {getMonthLabel(result.peak_month?.month)}{" "}
                        {formatNumber(result.peak_month?.value || 0, 0)} kWh
                      </strong>
                    </article>
                  </div>

                  <div className="guidance-stack solar-insight-stack">
                    <article className="guidance-card">
                      <div className="insight-heading">
                        <strong>Production model</strong>
                        <span className="soft-badge">{result.production_model?.label || "Unknown"}</span>
                      </div>
                      <p>
                        {result.production_model?.description ||
                          "Production model details unavailable."}
                      </p>
                      <div className="status-list">
                        <div className="status-row">
                          <strong>Performance ratio</strong>
                          <p>
                            About {formatNumber((result.production_model?.performance_ratio || 0) * 100, 0)}%
                            after modeled inverter, electrical, soiling, availability, temperature,
                            and layout losses.
                          </p>
                        </div>
                        <div className="status-row">
                          <strong>Roof-backed sizing</strong>
                          <p>
                            The current estimate uses {formatNumber(result.system_size_kw, 1)} kW
                            from the saved roof and about{" "}
                            {formatNumber(
                              (result.production_model?.effective_panel_efficiency || form.panel_efficiency) * 100,
                              0,
                            )}
                            % panel efficiency.
                          </p>
                        </div>
                        <div className="status-row">
                          <strong>Seasonality</strong>
                          <p>
                            Peak output is around {getMonthLabel(result.peak_month?.month)} at{" "}
                            {formatNumber(result.peak_month?.value || 0, 0)} kWh, with the weakest
                            month near {getMonthLabel(result.lowest_month?.month)}.
                          </p>
                        </div>
                      </div>
                    </article>

                    <article className="guidance-card">
                      <div className="insight-heading">
                        <strong>Estimate confidence</strong>
                        <ConfidenceBadge confidence={result.confidence} />
                      </div>
                      <p>{result.confidence?.description || "Confidence details unavailable."}</p>
                      {result.confidence?.factors?.length ? (
                        <div className="status-list">
                          {result.confidence.factors.map((factor) => (
                            <div className="status-row" key={factor}>
                              <strong>Signal</strong>
                              <p>{factor}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </article>

                    <article className="guidance-card">
                      <div className="insight-heading">
                        <strong>Saved reports</strong>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={handleSaveSolarReport}
                          disabled={reportSaving || propertyRecordSaving}
                        >
                          {reportSaving
                            ? "Saving report..."
                            : propertyRecordSaving
                              ? "Saving property..."
                              : "Save current report"}
                        </button>
                      </div>
                      <p>
                        Save the current roof-backed estimate as a property-tied planning report,
                        then promote any saved report into a shareable homeowner quote.
                      </p>
                      <SavedSolarReportList
                        reports={savedSolarReports}
                        onCreateQuote={handleCreateSolarQuote}
                        onCopyQuoteLink={handleCopyQuoteLink}
                        quoteCreatingReportId={quoteCreatingReportId}
                        copiedQuoteId={copiedQuoteId}
                      />
                    </article>

                    <article className="guidance-card">
                      <strong>Current assumptions</strong>
                      <ul className="assumption-list">
                        {(result.assumptions || []).map((assumption) => (
                          <li key={assumption}>{assumption}</li>
                        ))}
                      </ul>
                    </article>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <h3>No estimate yet</h3>
                  <p>
                    The useful flow now starts by locating a real property. Run the estimate once
                    you are ready to connect that address to actual production and savings output.
                  </p>
                </div>
              )}
            </section>
          ) : isGardenPage ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Garden Buddy</p>
                  <h2>What Garden Buddy sees</h2>
                </div>
                <p className="panel-copy">{activeModeContent.resultPanelCopy}</p>
              </div>

              {propertyPreview ? (
                <>
                  <p className="summary-copy">
                    {selectedGardenZone
                      ? `${selectedGardenZone.name} currently reads as ${selectedGardenZone.analysis.sunClass.label.toLowerCase()} with about ${formatNumber(
                          selectedGardenZone.analysis.growingSeasonAverageSunHours,
                          1,
                        )} modeled sun hours per day from April through September.${selectedGardenZone.analysis.contextAdjustment?.maxMonthlyPenaltyHours ? ` Nearby structures can trim the open-sky estimate by as much as ${formatNumber(
                          selectedGardenZone.analysis.contextAdjustment.maxMonthlyPenaltyHours,
                          1,
                        )} hrs/day in the strongest month.` : ""}${propertyClimate?.growing_season?.average_temperature_f != null && propertyClimate?.growing_season?.average_relative_humidity != null ? ` Property climate for that same window averages about ${formatNumber(
                          propertyClimate.growing_season.average_temperature_f,
                          1,
                        )}°F and ${formatNumber(
                          propertyClimate.growing_season.average_relative_humidity,
                          0,
                        )}% humidity, with an estimated hardiness band of ${propertyClimate?.hardiness_zone?.label || "unknown"}.` : ""} These zones now save with the shared property record, show up in the recent garden-plan library, reopen directly into the map, and now temper the open-sky model with nearby building and terrain context. ${selectedGardenZone.analysis.modelNote}`
                      : "Garden Buddy now starts with the same address-grade property match as Solar Buddy. Draw one or more real yard zones on the live map to save them with this property, reopen them later from the recent garden-plan library, and unlock property context, climate context, first-pass sun classes, planting guidance, and monthly exposure summaries."}
                  </p>

                  <GardenZoneSelector
                    zones={analyzedGardenZones}
                    selectedZoneId={selectedGardenZone?.id || null}
                    onSelect={setSelectedGardenZoneId}
                  />

                  <div className="stats-grid">
                    <StatCard
                      label="Address match"
                      value={getMatchLabel(propertyPreview.match_quality)}
                      detail={propertyPreview.formatted_address}
                    />
                    <StatCard
                      label="Garden zones"
                      value={analyzedGardenZones.length ? String(analyzedGardenZones.length) : "None yet"}
                      detail="Draw one or more beds directly on the live map."
                    />
                    <StatCard
                      label="Mapped area"
                      value={
                        analyzedGardenZones.length
                          ? `${formatNumber(totalGardenAreaSquareFeet, 0)} sq ft`
                          : "0 sq ft"
                      }
                      detail="Total area across all drawn garden zones."
                    />
                    <StatCard
                      label="Selected zone"
                      value={selectedGardenZone ? selectedGardenZone.name : "No selection"}
                      detail={
                        selectedGardenZone
                          ? `${formatNumber(selectedGardenZone.areaSquareFeet, 0)} sq ft drawn`
                          : "Click or draw a zone on the map."
                      }
                    />
                    <StatCard
                      label="Sun class"
                      value={selectedGardenZone?.analysis?.sunClass?.label || "Not modeled yet"}
                      detail={
                        selectedGardenZone
                          ? `${formatNumber(
                              selectedGardenZone.analysis.growingSeasonAverageSunHours,
                              1,
                            )} hrs/day average from April through September`
                          : "Draw a zone to estimate first-pass light."
                      }
                    />
                    <StatCard
                      label="Planning confidence"
                      value={selectedGardenZone?.analysis?.confidence?.label || "Pending"}
                      detail={
                        selectedGardenZone
                          ? selectedGardenZone.analysis.confidence.description
                          : "Property match plus zone geometry are required before modeling starts."
                      }
                    />
                    <StatCard
                      label="Obstruction risk"
                      value={selectedGardenZone?.analysis?.obstructionRisk?.label || "Pending"}
                      detail={
                        selectedGardenZone?.analysis?.obstructionRisk?.description ||
                        "Nearby structure pressure appears after site context loads."
                      }
                    />
                    <StatCard
                      label="Context slice"
                      value={propertyContext ? "Buildings + terrain" : "Open sky only"}
                      detail={
                        propertyContext
                          ? `${propertyContext.building_context?.building_count || 0} nearby buildings in the current context radius`
                          : "Site context has not loaded yet."
                      }
                    />
                  </div>

                  <div className="info-grid">
                    <article className="info-card">
                      <span>Property match</span>
                      <strong>{propertyPreview.formatted_address}</strong>
                    </article>
                    <article className="info-card">
                      <span>Coordinates</span>
                      <strong>
                        {formatCoordinate(propertyPreview.latitude)},{" "}
                        {formatCoordinate(propertyPreview.longitude)}
                      </strong>
                    </article>
                    <article className="info-card">
                      <span>Match quality</span>
                      <strong>{propertyPreview.match_quality || "unknown"}</strong>
                    </article>
                    <article className="info-card">
                      <span>Source</span>
                      <strong>{propertyPreview.source || "unknown"}</strong>
                    </article>
                    <article className="info-card">
                      <span>Lot position</span>
                      <strong>
                        {selectedGardenZone?.analysis?.lotPositionLabel || "Pending zone selection"}
                      </strong>
                    </article>
                    <article className="info-card">
                      <span>Model boundary</span>
                      <strong>
                        {propertyContext
                          ? "Buildings and terrain only, no canopy yet"
                          : "No tree or building shade yet"}
                      </strong>
                    </article>
                  </div>

                  <GardenSiteContextPanel
                    context={propertyContext}
                    loading={propertyContextLoading}
                    error={propertyContextError}
                    zone={selectedGardenZone}
                  />

                  <GardenClimatePanel
                    climate={propertyClimate}
                    climateLoading={propertyClimateLoading}
                    climateError={propertyClimateError}
                    irradiance={surfaceIrradiance}
                    irradianceLoading={surfaceIrradianceLoading}
                    irradianceError={surfaceIrradianceError}
                  />

                  {selectedGardenZone ? (
                    <>
                      <div className="info-grid garden-season-grid">
                        {selectedGardenZone.analysis.seasonalSummaries.map((season) => (
                          <article className="info-card" key={season.id}>
                            <span>{season.label}</span>
                            <strong>{season.sunClass.label}</strong>
                            <p className="stat-detail">
                              {formatNumber(season.averageSunHours, 1)} hrs/day average
                            </p>
                          </article>
                        ))}
                      </div>

                      <div className="status-card status-card-muted">
                        <span className="status-label">Selected zone</span>
                        <strong>
                          {selectedGardenZone.analysis.bestMonth.label} peaks near{" "}
                          {formatNumber(selectedGardenZone.analysis.bestMonth.hoursPerDay, 1)} hrs/day
                        </strong>
                        <p>
                          Lowest month is {selectedGardenZone.analysis.lowestMonth.label} at about{" "}
                          {formatNumber(selectedGardenZone.analysis.lowestMonth.hoursPerDay, 1)} hrs/day.
                        </p>
                        {selectedGardenZone.analysis.contextAdjustment?.maxMonthlyPenaltyHours ? (
                          <p>
                            Open sky would read about{" "}
                            {formatNumber(
                              selectedGardenZone.analysis.openSkyGrowingSeasonAverageSunHours,
                              1,
                            )}{" "}
                            hrs/day in the growing season before the current building and terrain
                            slice is applied.
                          </p>
                        ) : null}
                        {selectedGardenZone.analysis.contextAdjustment?.strongestBuilding ? (
                          <p>
                            Strongest nearby structure pressure is on the{" "}
                            {formatLabel(
                              selectedGardenZone.analysis.contextAdjustment.strongestBuilding.direction_bucket,
                            )}{" "}
                            side from a building about{" "}
                            {formatNumber(
                              selectedGardenZone.analysis.contextAdjustment.strongestBuilding.distance_m || 0,
                              0,
                            )}{" "}
                            m away.
                          </p>
                        ) : null}
                        <p>{selectedGardenZone.analysis.sunClass.description}</p>
                      </div>

                      <GardenPlantingGuidance
                        zone={selectedGardenZone}
                        climate={propertyClimate}
                      />
                    </>
                  ) : null}
                </>
              ) : (
                <div className="empty-state">
                  <h3>No garden property yet</h3>
                  <p>
                    Locate a real address first. Garden Buddy uses the same property lookup as
                    Solar Buddy, then unlocks yard-zone drawing, a reusable saved-plan library,
                    sun classification, and planting guidance.
                  </p>
                </div>
              )}
            </section>
          ) : null}

          {isSpaceWeatherPage ? (
            <SpaceWeatherPanel
              data={spaceWeather}
              loading={spaceWeatherLoading}
              error={spaceWeatherError}
            />
          ) : null}

          {isSpaceWeatherPage ? (
            <SurfaceIrradiancePanel
              data={surfaceIrradiance}
              loading={surfaceIrradianceLoading}
              error={surfaceIrradianceError}
            />
          ) : null}

          {isSolarPage && result ? (
            <MonthlyExposure
              eyebrow="Seasonality"
              title="Monthly production profile"
              copy="Modeled monthly production using month-by-month solar resource data and the current roof-backed system size."
              monthlyValues={result.monthly_production}
              unit="kWh"
              digits={0}
            />
          ) : null}

          {isGardenPage && selectedGardenZone ? (
            <MonthlyExposure
              eyebrow="Sun window estimate"
              title={`${selectedGardenZone.name} by month`}
              copy={selectedGardenZone.analysis.modelNote}
              monthlyValues={selectedGardenZone.analysis.monthlySunHours}
              unit="hrs/day"
            />
          ) : null}
        </section>
      </main>

      <footer className="page-footer">
        <a className="footer-link" href="/release-history.html">
          Release history
        </a>
      </footer>
    </div>
  );
}
