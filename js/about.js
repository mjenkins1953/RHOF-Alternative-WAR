// About dialog — opened from the "About" menu link on every page.
// Bump both counters by .001 on every commit + push:
//   RHOF_VERSION  1.000  -> 1.001 -> 1.002 ...
//   RHOF_BUILD    <date>.000 -> <date>.001 ...  (date = the build date)
// The dialog shows only the date portion of RHOF_BUILD; the trailing
// counter stays in the constant as the monotonic build number.

const RHOF_VERSION = '1.030';
const RHOF_BUILD = '2026.08.30.030';

(function () {
  const modal = document.getElementById('aboutModal');
  const link = document.querySelector('.site-menu__link[href$="#about"]');
  if (!modal || !link) return;

  const vEl = modal.querySelector('#aboutVersion');
  const bEl = modal.querySelector('#aboutBuild');
  if (vEl) vEl.textContent = RHOF_VERSION;
  if (bEl) bEl.textContent = RHOF_BUILD.split('.').slice(0, 3).join('.');

  link.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
  });

  modal.querySelector('.about-modal__close')?.addEventListener('click', () => modal.close());

  // click on the backdrop (outside the panel) closes it
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });
})();
