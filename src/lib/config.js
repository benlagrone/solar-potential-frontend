function parseBoolean(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeUrl(value) {
  return value ? value.replace(/\/$/, "") : "";
}

const runtimeConfig =
  typeof window !== "undefined" && window.__APP_CONFIG__ ? window.__APP_CONFIG__ : {};

export const apiBaseUrl = normalizeUrl(
  runtimeConfig.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "",
);

export const gaMeasurementId =
  runtimeConfig.gaMeasurementId || import.meta.env.VITE_GA_MEASUREMENT_ID || "";

export const demoMode = parseBoolean(
  runtimeConfig.demoMode ?? import.meta.env.VITE_DEMO_MODE ?? false,
);

export const secondaryFrontendUrl = normalizeUrl(
  runtimeConfig.secondaryFrontendUrl ?? import.meta.env.VITE_SECONDARY_FRONTEND_URL ?? "",
);
