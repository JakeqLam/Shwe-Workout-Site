/*
 * Local server: leave apiBaseUrl blank so the page uses the same origin.
 * GitHub Pages: leaving it blank makes the page use browser-only storage.
 * Later, after putting the API behind HTTPS, set apiBaseUrl to that HTTPS URL.
 * Example: apiBaseUrl: "https://workouts.example.com"
 */
window.PLUS_TRACKER_CONFIG = {
  apiBaseUrl: "",
  useDatabase: true
};
