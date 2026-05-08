export const defaultZonePurposeId = "mixed-bed";
export const defaultCareCadenceId = "two-three-times-weekly";

export const zonePurposeOptions = [
  {
    id: "mixed-bed",
    label: "Flexible mixed bed",
    shortLabel: "Mixed bed",
    summary:
      "Use this as a general bed that can rotate between greens, herbs, roots, and selective summer crops.",
    automationHint:
      "Good default for a zone that will likely rotate across the season instead of following one fixed crop script.",
  },
  {
    id: "production-bed",
    label: "Main production bed",
    shortLabel: "Production",
    summary:
      "Bias this zone toward the highest-output edible crops once the modeled light and heat window support it.",
    automationHint:
      "Strong candidate for later harvest, watering, and turnover reminders because the zone likely changes quickly.",
  },
  {
    id: "perennial-border",
    label: "Perennial border",
    shortLabel: "Perennial",
    summary:
      "Use this for slower-changing herbs, berries, flowers, and edges that should reopen season after season.",
    automationHint:
      "Later automation can stay lower-touch here and center on pruning, dividing, and slower recurring maintenance.",
  },
  {
    id: "pollinator-cutting",
    label: "Pollinator / flowers",
    shortLabel: "Flowers",
    summary:
      "Use this for cut flowers, pollinator habitat, companion planting, or a softer mixed ornamental edge.",
    automationHint:
      "Later automation can focus on bloom windows, deadheading, and lighter recurring maintenance instead of crop turnover.",
  },
  {
    id: "shade-trial",
    label: "Shade trial / nursery",
    shortLabel: "Shade trial",
    summary:
      "Use this for low-light experiments, nursery overflow, or containers until the shade pattern is more proven.",
    automationHint:
      "Good candidate for observation-first reminders because this zone may need more ground-truthing than hard commitments.",
  },
];

export const careCadenceOptions = [
  {
    id: "daily-check",
    label: "Daily check",
    shortLabel: "Daily",
    summary:
      "Treat this as a high-touch zone for harvest, irrigation, and quick issue catches during active growth.",
    automationHint: "Later automation should assume frequent check-ins here.",
  },
  {
    id: "two-three-times-weekly",
    label: "2-3x weekly",
    shortLabel: "2-3x weekly",
    summary:
      "Best default for a normal edible bed that needs structure, but not a full daily rhythm.",
    automationHint:
      "Later automation can group this into recurring midweek and weekend reminders.",
  },
  {
    id: "weekly-check",
    label: "Weekly check",
    shortLabel: "Weekly",
    summary:
      "Use this for steadier perennial or lower-output zones that only need one deliberate pass each week.",
    automationHint: "Later automation can treat this as a lower-touch recurring zone.",
  },
];

export function getZonePurposeOption(zonePurposeId) {
  return (
    zonePurposeOptions.find((option) => option.id === zonePurposeId) ||
    zonePurposeOptions[0]
  );
}

export function getCareCadenceOption(careCadenceId) {
  return (
    careCadenceOptions.find((option) => option.id === careCadenceId) ||
    careCadenceOptions[1]
  );
}

export function normalizeGardenZoneContext(zone) {
  if (!zone) {
    return zone;
  }

  return {
    ...zone,
    observedShadeProfile: zone.observedShadeProfile || "auto",
    zonePurposeId: zone.zonePurposeId || defaultZonePurposeId,
    careCadenceId: zone.careCadenceId || defaultCareCadenceId,
  };
}
