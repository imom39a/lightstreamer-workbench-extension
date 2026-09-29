(() => {
  const measurementId = "__SITE_GA_MEASUREMENT_ID__";
  const siteOrigin = "https://imom39a.github.io";
  const basePath = "/lightstreamer-workbench-extension/";
  const preferenceKey = "lightstreamer-workbench.website-analytics.disabled";
  const cookiePrefix = "lsew_site";
  const toggle = document.querySelector("[data-site-analytics-toggle]");
  const status = document.querySelector("[data-site-analytics-status]");
  const isOfficialSite = location.origin === siteOrigin && location.pathname.startsWith(basePath);
  const isConfigured = /^G-[A-Z0-9]+$/.test(measurementId);

  if (!isOfficialSite || !isConfigured) {
    if (toggle) toggle.hidden = true;
    if (status) status.textContent = "Website analytics runs only on the published site.";
    return;
  }

  let disabled;
  try {
    disabled = localStorage.getItem(preferenceKey) === "1";
  } catch {
    // Do not start collection if a saved preference cannot be read.
    if (toggle) toggle.hidden = true;
    if (status) status.textContent = "Website analytics is unavailable in this browser.";
    return;
  }

  function renderPreference() {
    if (toggle) {
      toggle.hidden = false;
      toggle.textContent = disabled ? "Turn on website analytics" : "Turn off website analytics";
      toggle.setAttribute("aria-pressed", String(!disabled));
    }
    if (status) status.textContent = disabled ? "Website analytics is off in this browser." : "Website analytics is on in this browser.";
  }

  function clearAnalyticsCookies() {
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.trim().split("=", 1)[0];
      if (name.startsWith(`${cookiePrefix}_`)) {
        document.cookie = `${name}=; Max-Age=0; Path=${basePath}; SameSite=Lax; Secure`;
      }
    }
  }

  renderPreference();
  if (toggle) toggle.addEventListener("click", () => {
    try {
      localStorage.setItem(preferenceKey, disabled ? "0" : "1");
    } catch {
      if (status) status.textContent = "This browser did not save the change.";
      return;
    }
    disabled = !disabled;
    window[`ga-disable-${measurementId}`] = disabled;
    if (disabled) clearAnalyticsCookies();
    renderPreference();
    if (!disabled) location.reload();
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== preferenceKey) return;
    const nextDisabled = event.newValue === "1";
    if (nextDisabled === disabled) return;
    disabled = nextDisabled;
    window[`ga-disable-${measurementId}`] = disabled;
    if (disabled) clearAnalyticsCookies();
    renderPreference();
    if (!disabled) location.reload();
  });

  window[`ga-disable-${measurementId}`] = disabled;
  if (disabled) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag("js", new Date());
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted"
  });

  const pageLocation = `${siteOrigin}${location.pathname}`;
  gtag("set", {
    page_location: pageLocation,
    page_referrer: "",
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    app_surface: "website"
  });
  gtag("config", measurementId, {
    send_page_view: false,
    page_location: pageLocation,
    page_referrer: "",
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    app_surface: "website",
    cookie_prefix: cookiePrefix,
    cookie_path: basePath,
    cookie_domain: "none"
  });
  gtag("event", "page_view", {
    send_to: measurementId,
    page_location: pageLocation,
    page_referrer: "",
    page_title: document.title,
    app_surface: "website"
  });

  const script = document.createElement("script");
  script.async = true;
  script.referrerPolicy = "no-referrer";
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.append(script);
})();
