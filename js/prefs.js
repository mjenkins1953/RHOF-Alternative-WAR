// Tiny per-browser preference store for The True Hall of Fame.
// Everything lives in localStorage under the "thof:" prefix — no network,
// no cookies. It never leaves this browser and never syncs between devices.
// Every read/write is wrapped: private windows, disabled storage, and full
// quotas all just fall back to "no saved state" instead of throwing.
(function () {
  var NS = 'thof:';
  var ok = false;
  try {
    localStorage.setItem(NS + '_probe', '1');
    localStorage.removeItem(NS + '_probe');
    ok = true;
  } catch (e) { ok = false; }

  window.THOF = {
    enabled: ok,
    get: function (key, fallback) {
      if (!ok) return fallback;
      try {
        var raw = localStorage.getItem(NS + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      if (!ok) return;
      try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) {}
    },
    remove: function (key) {
      if (!ok) return;
      try { localStorage.removeItem(NS + key); } catch (e) {}
    }
  };

  // Record where the visitor is, so the home page can offer a "Resume" link.
  var PAGE_LABELS = {
    'hitters.html': 'Hitters',
    'pitchers.html': 'Pitchers',
    'yourhall.html': 'Your Hall — Hitters',
    'yourhall-pitchers.html': 'Your Hall — Pitchers',
    'stats.html': 'Stats — Hitters',
    'stats-pitchers.html': 'Stats — Pitchers',
    'methodology.html': 'Methodology',
    'why.html': "Who's Better",
    'validation.html': 'Validation'
  };
  var file = (location.pathname.split('/').pop() || '').toLowerCase();
  if (PAGE_LABELS[file]) {
    window.THOF.set('lastPage', { file: file, label: PAGE_LABELS[file], at: Date.now() });
  }
})();
