// Home page view toggle: the Pitchers button swaps the embedded hitters
// list for the "coming soon" placeholder and back. Hitters has its own
// page (hitters.html), so it's a plain link, not a toggle.

const pitchersBtn = document.querySelector('.site-menu [data-view="pitchers"]');
const hittersView = document.getElementById('view-hitters');
const pitchersView = document.getElementById('view-pitchers');

if (pitchersBtn && hittersView && pitchersView) {
  pitchersBtn.addEventListener('click', () => {
    const showPitchers = pitchersView.hidden;
    pitchersView.hidden = !showPitchers;
    hittersView.hidden = showPitchers;
    pitchersBtn.classList.toggle('is-active', showPitchers);
  });
}
