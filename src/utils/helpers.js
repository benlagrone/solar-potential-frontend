import UAParser from 'ua-parser-js';

export const getBrowserData = () => {
  const parser = new UAParser();
  return {
    userAgent: navigator.userAgent,
    screenResolution: `${window.screen.width}x${window.screen.height}`,
    languagePreference: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrerUrl: document.referrer,
    deviceType: parser.getDevice().type || 'desktop'
  };
};