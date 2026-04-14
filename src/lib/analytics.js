import { gaMeasurementId } from "./config.js";

function analyticsReady() {
  return (
    typeof window !== "undefined" &&
    typeof window.gtag === "function" &&
    Boolean(gaMeasurementId)
  );
}

export function trackBuddyPageView(pageId, pageLabel) {
  if (!analyticsReady()) {
    return;
  }

  const pageHash = `#${pageId}`;
  const pagePath = `${window.location.pathname}${window.location.search}${pageHash}`;
  const pageTitle = `${pageLabel} | Solar Buddy`;

  window.gtag("event", "page_view", {
    page_title: pageTitle,
    page_location: window.location.href,
    page_path: pagePath,
    buddy_mode: pageId,
  });

  window.gtag("event", "buddy_mode_view", {
    buddy_mode: pageId,
    buddy_label: pageLabel,
    page_path: pagePath,
  });
}
