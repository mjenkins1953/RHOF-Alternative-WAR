// Home page: the Pitchers button reveals or hides the "coming soon" panel.
// Hitters has its own page (hitters.html), reached via the menu link.

const pitchersBtn = document.querySelector('.site-menu [data-view="pitchers"]');
const pitchersView = document.getElementById('view-pitchers');

if (pitchersBtn && pitchersView) {
  pitchersBtn.addEventListener('click', () => {
    const show = pitchersView.hidden;
    pitchersView.hidden = !show;
    pitchersBtn.classList.toggle('is-active', show);
    if (show) pitchersView.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
