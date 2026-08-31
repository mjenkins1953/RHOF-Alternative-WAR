// Collapse toggle for the "Top N … by Stat Above Average" board box.
// The caret in the box's top-right corner hides everything below the
// headline (dek, stat row, explainers) and shrinks the box back to just
// the eyebrow + headline line. Shared by hitters.html and pitchers.html.

(function () {
  const board = document.querySelector('.saa-embed header.board');
  if (!board) return;

  const btn = board.querySelector('.board__toggle');
  const body = board.querySelector('.board__body');
  if (!btn || !body) return;

  function apply(collapsed) {
    board.classList.toggle('is-collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', collapsed ? 'Show list details' : 'Hide list details');
    btn.textContent = collapsed ? '▸' : '▾';
  }

  // remember collapsed/expanded per page (js/prefs.js)
  const key = 'collapsed:' + ((location.pathname.split('/').pop() || 'index.html').toLowerCase());

  btn.addEventListener('click', () => {
    const collapsed = !board.classList.contains('is-collapsed');
    apply(collapsed);
    if (window.THOF) THOF.set(key, collapsed);
  });

  apply(window.THOF ? THOF.get(key, false) === true : false);
})();
