// Hitters/Pitchers nav toggle -- swaps which view section is visible;
// the page never navigates away from index.html.

const navButtons = document.querySelectorAll('.site-menu button[data-view]');
const views = {
  hitters: document.getElementById('view-hitters'),
  pitchers: document.getElementById('view-pitchers'),
};

navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.view;
    navButtons.forEach(b => b.classList.toggle('is-active', b === btn));
    Object.entries(views).forEach(([key, section]) => {
      if (section) section.hidden = key !== target;
    });
  });
});
