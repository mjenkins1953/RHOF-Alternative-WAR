// Home page only: if the visitor has been on a content page before, show a
// small "Resume where you left off" link in the hero. No auto-redirect —
// they choose. Needs js/prefs.js loaded first (window.THOF).
(function () {
  var wrap = document.querySelector('.hero__resume');
  if (!wrap || !window.THOF) return;
  var link = wrap.querySelector('a');
  if (!link) return;

  var last = window.THOF.get('lastPage', null);
  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  // only a real content page, and not wherever we already are
  if (!last || !last.file || !last.label || last.file === here) return;

  link.href = last.file;
  link.textContent = 'Resume where you left off: ' + last.label;
  wrap.hidden = false;
})();
