// Route-aware chrome: the pill indicator slides to the active section's link,
// the breadcrumb and side rail follow, the nav flips theme over light sections,
// and the bar leans with scroll velocity (inertia) like a physical object.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { EASE, NAV_INERTIA } from '../config.js';
import { prefersReducedMotion } from './env.js';
import { clamp } from './math.js';
import { scrollToTarget, scrollVelocity } from './scroll.js';

export function initNav({ nav, rail, brand = 'STUDIO' }) {
  const sections = [...document.querySelectorAll('[data-route]')];
  if (!nav || !sections.length) return () => {};
  const links = [...nav.querySelectorAll('[data-nav-link]')];
  const pill = nav.querySelector('[data-nav-pill]');
  const crumb = nav.querySelector('[data-crumb]');
  const reduced = prefersReducedMotion();
  const offs = [];

  const railItems = sections.map((section) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'rail-item';
    const label = document.createElement('span');
    const line = document.createElement('span');
    label.className = 'rail-label';
    label.textContent = section.dataset.label || ''; // textContent: labels may come from a CMS later
    line.className = 'rail-line';
    item.append(label, line);
    item.setAttribute('aria-label', `Go to ${section.dataset.label}`);
    item.addEventListener('click', () => scrollToTarget(section));
    rail?.append(item);
    return item;
  });

  const movePill = (link, instant = false) => {
    if (!pill) return;
    if (!link) {
      gsap.to(pill, { autoAlpha: 0, duration: 0.3, overwrite: 'auto' });
      return;
    }
    const host = pill.parentElement;
    const x = link.getBoundingClientRect().left - (host.getBoundingClientRect().left + host.clientLeft);
    gsap.to(pill, {
      x,
      width: link.offsetWidth,
      autoAlpha: 1,
      duration: instant || reduced ? 0 : 0.9,
      ease: EASE.pill,
      overwrite: 'auto',
    });
  };

  const activate = (index) => {
    const section = sections[index];
    const label = section.dataset.label;
    links.forEach((l) => l.classList.toggle('is-active', l.getAttribute('href') === `#${section.id}`));
    movePill(links.find((l) => l.classList.contains('is-active')));
    railItems.forEach((item, i) => item.classList.toggle('is-active', i === index));
    if (crumb) crumb.textContent = `${brand}/${label.toUpperCase()}`;
  };

  // Browser chrome matches the scene under the bar (Web Interface Guidelines: theme-color = page background).
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  // ...and the fixed chrome (nav mark, cursor ring, focus ring outside sections) takes the scene's --chrome.
  const tint = (section) => {
    const css = getComputedStyle(section);
    if (themeMeta) themeMeta.content = css.backgroundColor;
    document.documentElement.style.setProperty('--chrome', css.getPropertyValue('--chrome').trim() || 'var(--accent)');
  };
  const routeTriggers = [];
  const themeTriggers = [];
  sections.forEach((section, index) => {
    const routeTrigger = ScrollTrigger.create({
      trigger: section,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => self.isActive && activate(index),
    });
    // Theme follows whatever section sits under the bar.
    const themeTrigger = ScrollTrigger.create({
      trigger: section,
      start: 'top top+=40',
      end: 'bottom top+=40',
      onToggle: (self) => {
        if (!self.isActive) return;
        document.documentElement.dataset.chrome = section.dataset.theme || 'dark';
        tint(section);
      },
    });
    routeTriggers.push(routeTrigger);
    themeTriggers.push(themeTrigger);
    offs.push(() => routeTrigger.kill(), () => themeTrigger.kill());
  });

  links.forEach((link) => {
    const onClick = (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      scrollToTarget(target);
    };
    link.addEventListener('click', onClick);
    offs.push(() => link.removeEventListener('click', onClick));
  });

  const onResize = () => movePill(nav.querySelector('[data-nav-link].is-active'), true);
  window.addEventListener('resize', onResize);
  offs.push(() => window.removeEventListener('resize', onResize));
  // A reload can restore the scroll position mid-page, so start from whatever is active now.
  const current = routeTriggers.findIndex((t) => t.isActive);
  activate(current >= 0 ? current : 0);
  const underBar = themeTriggers.findIndex((t) => t.isActive);
  document.documentElement.dataset.chrome = sections[Math.max(0, underBar)].dataset.theme || 'dark';
  tint(sections[Math.max(0, underBar)]);

  if (!reduced) offs.push(initInertia(nav.querySelector('[data-nav-body]') || nav));
  return () => offs.forEach((off) => off());
}

function initInertia(el) {
  // Any transform on the bar turns it into the containing block for position:fixed
  // children, which would trap the mobile bottom nav. So below the breakpoint the
  // bar carries no transform at all, not even an identity one.
  const narrow = window.matchMedia(`(max-width: ${NAV_INERTIA.disableBelow}px)`);
  const { smoothing, clampVelocity, strength, max, bend, maxBend, lag } = NAV_INERTIA;
  let toY = null;
  let toBend = null;
  let smoothed = 0;

  const arm = () => {
    if (narrow.matches) {
      toY = toBend = null;
      smoothed = 0;
      gsap.killTweensOf(el);
      gsap.set(el, { clearProps: 'transform' });
      return;
    }
    gsap.set(el, { transformPerspective: 700, force3D: true });
    toY = gsap.quickTo(el, 'y', { duration: lag, ease: 'power3.out' });
    toBend = gsap.quickTo(el, 'rotationX', { duration: lag, ease: 'power3.out' });
  };
  const tick = () => {
    if (!toY) return;
    smoothed = clamp(smoothed + (scrollVelocity() - smoothed) * smoothing, -clampVelocity, clampVelocity);
    toY(clamp(-smoothed * strength, -max, max));
    toBend(clamp(smoothed * bend, -maxBend, maxBend));
  };

  arm();
  narrow.addEventListener('change', arm);
  gsap.ticker.add(tick);
  return () => {
    gsap.ticker.remove(tick);
    narrow.removeEventListener('change', arm);
    gsap.set(el, { clearProps: 'transform' });
  };
}
