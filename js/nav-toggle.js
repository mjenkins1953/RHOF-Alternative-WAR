// Mobile dropdown behavior for the .site-menu nav (hamburger toggle).
(function () {
  document.querySelectorAll('.site-menu').forEach((nav) => {
    const toggle = nav.querySelector('.site-menu__toggle');
    const links = nav.querySelector('.site-menu__links');
    if (!toggle || !links) return;

    const close = () => {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    links.querySelectorAll('.site-menu__link').forEach((link) => {
      link.addEventListener('click', close);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  });
})();
