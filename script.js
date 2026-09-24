/* ==========================================================================
   REJOUICE — motion
   Requires: GSAP 3.12 + ScrollTrigger. Lenis is optional (graceful fallback).
   ========================================================================== */

(function () {
  'use strict';

  var doc = document.documentElement;
  var loaderEl = document.getElementById('loader');

  /* If GSAP never arrived, strip the "js" flag so every element that CSS was
     holding off-screen for an animation becomes visible again. */
  if (typeof window.gsap === 'undefined') {
    doc.classList.remove('js');
    if (loaderEl) loaderEl.remove();
    return;
  }

  var hasST = typeof window.ScrollTrigger !== 'undefined';
  if (hasST) gsap.registerPlugin(ScrollTrigger);

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* One ease for the whole site. Long, soft tail — this is what makes motion
     read as "smooth" rather than merely "animated". */
  var EASE = 'expo.out';

  var lenis = null;
  var cursorPaused = false;

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* ======================================================================
     1. Smooth scrolling
     ====================================================================== */
  function initSmoothScroll() {
    if (reduced || typeof window.Lenis === 'undefined') return;

    lenis = new Lenis({
      lerp: 0.085,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
      smoothWheel: true
    });

    if (hasST) {
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    } else {
      requestAnimationFrame(function raf(t) { lenis.raf(t); requestAnimationFrame(raf); });
    }
  }

  /* ======================================================================
     2. Cursor — the orange ball on page 1

     Three transform layers so no two animations write the same property:
       #cursor         x / y (follow) and scale (open, shrink, press)
       .cursor__squash rotation + scaleX/scaleY (velocity squash & stretch)
       .cursor__label  never transformed, so the text stays upright

     Position uses gsap.quickTo: one reusable tween that gets re-targeted,
     instead of spawning a fresh gsap.to on every mousemove. That is the
     single biggest difference in how smooth this feels.
     ====================================================================== */
  function initCursor() {
    var cursor = document.getElementById('cursor');
    var hero = document.getElementById('page1');
    if (!cursor || !hero) return;

    if (!fine || reduced) { cursor.remove(); return; }

    var squash = cursor.querySelector('.cursor__squash');

    /* xPercent/yPercent keeps the ball centred on the pointer inside GSAP's
       transform model. The original did this with a CSS translate(-50%,-50%),
       which GSAP overwrote the moment it set x/y — so the ball sat low-right
       of the real pointer. */
    gsap.set(cursor, {
      xPercent: -50,
      yPercent: -50,
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      scale: 0,
      opacity: 1
    });

    var xTo = gsap.quickTo(cursor, 'x', { duration: 0.55, ease: EASE });
    var yTo = gsap.quickTo(cursor, 'y', { duration: 0.55, ease: EASE });
    var scaleTo = gsap.quickTo(cursor, 'scale', { duration: 0.55, ease: EASE });
    var labelTo = gsap.quickTo('.cursor__label', 'opacity', { duration: 0.35, ease: 'power2.out' });

    var mx = window.innerWidth / 2;
    var my = window.innerHeight / 2;
    var lastX = mx, lastY = my, dirX = 0, dirY = 0, prevAmt = 0;
    var primed = false;
    var hasPointer = false;
    var shrink = false;
    var pressed = false;
    var lastScale = -1;

    window.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      mx = e.clientX;
      my = e.clientY;
      hasPointer = true;

      if (!primed) {          /* first move: jump, don't fly in from centre */
        primed = true;
        gsap.set(cursor, { x: mx, y: my });
        lastX = mx; lastY = my;
        return;
      }
      xTo(mx);
      yTo(my);
    }, { passive: true });

    /* Pointer left the window entirely */
    doc.addEventListener('pointerleave', function () { hasPointer = false; });
    window.addEventListener('blur', function () { hasPointer = false; });

    hero.addEventListener('pointerdown', function () { pressed = true; });
    window.addEventListener('pointerup', function () { pressed = false; });

    /* Links and buttons pull the ball down to a small dot */
    hero.querySelectorAll('[data-cursor-shrink], a, button:not(#reel-open)').forEach(function (el) {
      el.addEventListener('pointerenter', function () { shrink = true; });
      el.addEventListener('pointerleave', function () { shrink = false; });
    });

    gsap.ticker.add(function () {
      /* ---- state: open / shrink / hidden -------------------------------- */
      var heroBottom = hero.getBoundingClientRect().bottom;
      var visible = hasPointer && !cursorPaused && my < heroBottom - 2;
      var target = !visible ? 0 : (shrink ? 0.34 : 1);
      if (pressed && target > 0) target *= 0.86;

      if (target !== lastScale) {
        scaleTo(target);
        labelTo(visible && !shrink ? 1 : 0);
        lastScale = target;
      }

      /* ---- squash & stretch --------------------------------------------
         Measured from the ball's own eased position, not the raw pointer, so
         the stretch builds as it chases and relaxes as it settles. Smoothing
         the direction as a vector (rather than an angle) avoids the 180/-180
         flip that would make the ball spin. */
      var cx = gsap.getProperty(cursor, 'x');
      var cy = gsap.getProperty(cursor, 'y');
      var dx = cx - lastX;
      var dy = cy - lastY;
      lastX = cx;
      lastY = cy;

      dirX += (dx - dirX) * 0.18;
      dirY += (dy - dirY) * 0.18;

      var amt = gsap.utils.clamp(0, 1, Math.sqrt(dirX * dirX + dirY * dirY) / 38);
      if (amt < 0.002 && prevAmt < 0.002) return;   /* skip writes at rest */
      prevAmt = amt;

      gsap.set(squash, {
        rotation: Math.atan2(dirY, dirX) * 180 / Math.PI,
        scaleX: 1 + amt * 0.30,
        scaleY: 1 - amt * 0.20
      });
    });
  }

  /* ======================================================================
     3. Intro — loader, then the hero reveal as one continuous sequence
     ====================================================================== */
  function initIntro() {
    var chars = gsap.utils.toArray('.hero-type .h-char > i');
    var bg = document.querySelector('#page1 .page1__bg');
    var counter = document.querySelector('[data-count]');

    if (reduced || !loaderEl) {
      if (loaderEl) loaderEl.remove();
      gsap.set(chars, { y: '0%' });
      gsap.set('.reveal', { opacity: 1 });
      return;
    }

    window.scrollTo(0, 0);
    doc.classList.add('is-loading');
    if (lenis) lenis.stop();
    gsap.set(bg, { scale: 1.22 });

    var count = { v: 0 };

    gsap.timeline({
      onComplete: function () {
        loaderEl.remove();
        doc.classList.remove('is-loading');
        if (lenis) lenis.start();
        if (hasST) ScrollTrigger.refresh();
      }
    })
      .to('.loader__word span', { y: '0%', duration: 0.9, ease: EASE }, 0)
      .to(count, {
        v: 100,
        duration: 1.0,
        ease: 'power2.inOut',
        onUpdate: function () { if (counter) counter.textContent = Math.round(count.v); }
      }, 0)
      .to('.loader__word span', { y: '-105%', duration: 0.6, ease: 'power3.inOut' }, 1.05)
      .to('.loader__count', { opacity: 0, duration: 0.35 }, 1.05)
      .to(loaderEl, { yPercent: -100, duration: 1.0, ease: EASE }, 1.2)
      .to(bg, { scale: 1, duration: 2.0, ease: EASE }, 1.3)
      .to(chars, { y: '0%', duration: 1.25, stagger: 0.055, ease: EASE }, 1.45)
      .to('.reveal', { opacity: 1, duration: 0.8, stagger: 0.08, ease: 'power2.out' }, 1.8);
  }

  /* ======================================================================
     4. Hero parallax on scroll
     ====================================================================== */
  function initHeroScroll() {
    if (reduced || !hasST) return;

    gsap.to('#page1 .page1__bg', {
      yPercent: 16,
      ease: 'none',
      scrollTrigger: { trigger: '#page1', start: 'top top', end: 'bottom top', scrub: true }
    });

    gsap.to('#page1-content', {
      yPercent: 10,
      opacity: 0,
      ease: 'none',
      scrollTrigger: { trigger: '#page1', start: 'top top', end: 'bottom top', scrub: true }
    });
  }

  /* ======================================================================
     5. Masked line reveals
     ====================================================================== */
  function initLines() {
    var blocks = gsap.utils.toArray('#page2-heading, #page3-top, #page4-content, #page5');

    blocks.forEach(function (block) {
      var inners = block.querySelectorAll('.line > span');
      if (!inners.length) return;

      if (reduced || !hasST) { gsap.set(inners, { y: '0%' }); return; }

      gsap.to(inners, {
        y: '0%',
        duration: 1.2,
        stagger: 0.08,
        ease: EASE,
        scrollTrigger: { trigger: block, start: 'top 82%', once: true }
      });
    });

    var note = document.querySelector('.contact__note');
    if (note && hasST && !reduced) {
      gsap.from(note, {
        opacity: 0,
        y: 14,
        duration: 0.9,
        ease: 'power2.out',
        scrollTrigger: { trigger: note, start: 'top 90%', once: true }
      });
    }
  }

  /* ======================================================================
     6. Client marquee — seamless loop that speeds up with scroll
     ====================================================================== */
  function initMarquee() {
    var track = document.querySelector('.marquee__track');
    if (!track) return;

    var loop = gsap.to(track, { xPercent: -50, duration: 34, ease: 'none', repeat: -1 });

    if (reduced) { loop.pause(); return; }
    if (!hasST) return;

    var settle;
    ScrollTrigger.create({
      onUpdate: function (self) {
        var boost = gsap.utils.clamp(1, 3.4, 1 + Math.abs(self.getVelocity()) / 900);
        gsap.to(loop, { timeScale: boost, duration: 0.25, overwrite: true });
        clearTimeout(settle);
        settle = setTimeout(function () {
          gsap.to(loop, { timeScale: 1, duration: 1.1, overwrite: true });
        }, 160);
      }
    });
  }

  /* ======================================================================
     7. Page 3 — clip reveal plus a light parallax offset
     ====================================================================== */
  function initBoxes() {
    var boxes = gsap.utils.toArray('#page3-elements .box');
    if (!boxes.length) return;

    if (reduced || !hasST) { gsap.set(boxes, { clipPath: 'none' }); return; }

    gsap.to(boxes, {
      clipPath: 'inset(0% 0% 0% 0%)',
      duration: 1.4,
      stagger: 0.12,
      ease: EASE,
      scrollTrigger: { trigger: '#page3-elements', start: 'top 78%', once: true }
    });

    var drift = [-25, -70, -45];
    boxes.forEach(function (box, i) {
      gsap.to(box, {
        y: drift[i] || -50,
        ease: 'none',
        scrollTrigger: { trigger: '#page3', start: 'top bottom', end: 'bottom top', scrub: 1 }
      });
    });
  }

  /* ======================================================================
     8. Page 4 — the ring draws itself, the dot rides the drawn edge
     ====================================================================== */
  function initRing() {
    var draw = document.querySelector('#page4 .ring__draw');
    var orbit = document.querySelector('#page4 .orbit');
    var ball = document.querySelector('.page4__ball');
    if (!draw) return;

    var C = 2 * Math.PI * 49;          /* r = 49 in the 100x100 viewBox */
    var remaining = 0.32;              /* leaves a 245° arc, where the dot lands */

    gsap.set(draw, { strokeDasharray: C, strokeDashoffset: C });
    gsap.set(orbit, { transformOrigin: '50% 50%' });

    /* Continuous, clearly-visible motion once the reveal has landed — the
       ball floats and breathes, the dot keeps circling the ring for good */
    function startIdleMotion() {
      if (reduced) return;
      if (ball) {
        gsap.to(ball, { y: '+=14', duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        gsap.to(ball, { scale: 1.1, duration: 3.4, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      }
      if (orbit) {
        gsap.to(orbit, { rotation: '+=360', duration: 18, ease: 'none', repeat: -1 });
      }
    }

    if (reduced || !hasST) {
      gsap.set(draw, { strokeDashoffset: C * remaining });
      gsap.set(orbit, { rotation: (1 - remaining) * 360 });
      startIdleMotion();
      return;
    }

    var tl = gsap.timeline({ scrollTrigger: { trigger: '#page4', start: 'top 62%', once: true } })
      .to(draw, { strokeDashoffset: C * remaining, duration: 2.4, ease: EASE }, 0)
      .to(orbit, { rotation: (1 - remaining) * 360, duration: 2.4, ease: EASE }, 0)
      .fromTo(ball, { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.6, ease: EASE }, 0.15);

    tl.eventCallback('onComplete', startIdleMotion);

    gsap.to(ball, {
      yPercent: -10,
      ease: 'none',
      scrollTrigger: { trigger: '#page4', start: 'top bottom', end: 'bottom top', scrub: 1 }
    });
  }

  /* ======================================================================
     9. Magnetic contact link
     ====================================================================== */
  function initMagnetic() {
    if (!fine || reduced) return;

    gsap.utils.toArray('[data-magnetic]').forEach(function (el) {
      var mx = gsap.quickTo(el, 'x', { duration: 0.6, ease: EASE });
      var my = gsap.quickTo(el, 'y', { duration: 0.6, ease: EASE });

      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        mx((e.clientX - (r.left + r.width / 2)) * 0.3);
        my((e.clientY - (r.top + r.height / 2)) * 0.45);
      });
      el.addEventListener('pointerleave', function () { mx(0); my(0); });
    });
  }

  /* ======================================================================
     10. Footer reveal (replaces the jQuery version, which never ran —
         jQuery was never loaded on the page)
     ====================================================================== */
  function initFooter() {
    var logo = document.querySelector('footer .logo > span');
    var nav = document.querySelector('footer nav');
    if (!logo) return;

    if (reduced || !hasST) { gsap.set(logo, { y: '0%' }); return; }

    gsap.set(nav, { opacity: 0, y: 18 });

    var tl = gsap.timeline({ paused: true })
      .to(logo, { y: '0%', duration: 1.2, ease: EASE })
      .to(nav, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' }, 0.25);

    ScrollTrigger.create({
      trigger: '#main',
      start: 'bottom 80%',
      onEnter: function () { tl.play(); },
      onLeaveBack: function () { tl.reverse(); }
    });
  }

  /* ======================================================================
     11. Side menu
     ====================================================================== */
  function initMenu() {
    var menu = document.getElementById('menu');
    var toggles = document.querySelectorAll('[data-menu-toggle]');
    if (!menu || !toggles.length) return;

    var panel = menu.querySelector('.menu__panel');
    var backdrop = menu.querySelector('.menu__backdrop');
    var closeBtn = menu.querySelector('.menu__close');
    var linkInners = menu.querySelectorAll('.menu__link > span');
    var meta = menu.querySelector('.menu__meta');
    var fab = document.querySelector('.menu-fab');
    var isOpen = false;

    gsap.set(panel, { xPercent: 100 });
    gsap.set(meta, { opacity: 0, y: 18 });

    var tl = gsap.timeline({ paused: true })
      .set(menu, { visibility: 'visible' })
      .to(backdrop, { opacity: 1, duration: 0.7, ease: 'power2.out' }, 0)
      .to(panel, { xPercent: 0, duration: 0.95, ease: EASE }, 0)
      .to(linkInners, { y: '0%', duration: 0.9, stagger: 0.07, ease: EASE }, 0.28)
      .to(meta, { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' }, 0.5);

    if (reduced) tl.timeScale(12);

    function setExpanded(v) {
      toggles.forEach(function (t) { t.setAttribute('aria-expanded', v ? 'true' : 'false'); });
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      cursorPaused = true;                 /* the orange ball steps aside */
      menu.setAttribute('aria-hidden', 'false');
      setExpanded(true);
      doc.classList.add('is-menu-open');
      if (lenis) lenis.stop();
      tl.play();
      gsap.set(menu, { visibility: 'visible' });   /* so focus() can land */
      closeBtn.focus();
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      cursorPaused = false;
      menu.setAttribute('aria-hidden', 'true');
      setExpanded(false);
      doc.classList.remove('is-menu-open');
      if (lenis) lenis.start();
      tl.reverse().eventCallback('onReverseComplete', function () {
        gsap.set(menu, { visibility: 'hidden' });
      });
    }

    toggles.forEach(function (t) {
      t.addEventListener('click', function () { isOpen ? close() : open(); });
    });
    closeBtn.addEventListener('click', function () {
      close();
      toggles[0].focus();
    });
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) { close(); toggles[0].focus(); }
    });

    /* Keep tabbing inside the panel while it is open */
    menu.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || !isOpen) return;
      var f = panel.querySelectorAll('a[href], button');
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    /* Menu links scroll the page rather than jumping it */
    menu.querySelectorAll('[data-scroll-to]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var target = document.querySelector(link.getAttribute('data-scroll-to'));
        if (!target) return;
        e.preventDefault();
        close();
        gsap.delayedCall(0.2, function () {
          if (lenis) lenis.scrollTo(target, { duration: 1.5 });
          else target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
        });
      });
    });

    /* The hero nav scrolls away, so a sticky toggle fades in below it */
    if (fab && hasST) {
      ScrollTrigger.create({
        trigger: '#page1',
        start: 'bottom 60%',
        onEnter: function () {
          fab.classList.add('is-visible');
          gsap.to(fab, { opacity: 1, duration: 0.5, ease: 'power2.out' });
        },
        onLeaveBack: function () {
          fab.classList.remove('is-visible');
          gsap.to(fab, { opacity: 0, duration: 0.35, ease: 'power2.out' });
        }
      });
    } else if (fab) {
      fab.classList.add('is-visible');
      gsap.set(fab, { opacity: 1 });
    }
  }

  /* ======================================================================
     12. Reel overlay — gives the "Play reel" label something to do
     ====================================================================== */
  function initReel() {
    var overlay = document.getElementById('reel');
    var video = document.getElementById('reel-video');
    var openBtn = document.getElementById('reel-open');
    var closeBtn = document.getElementById('reel-close');
    if (!overlay || !video || !openBtn) return;

    var isOpen = false;

    var tl = gsap.timeline({ paused: true })
      .set(overlay, { visibility: 'visible' })
      .to(overlay, {
        opacity: 1,
        clipPath: 'inset(0% 0% 0% 0%)',
        duration: 0.9,
        ease: EASE
      });

    function open() {
      if (isOpen) return;
      isOpen = true;
      cursorPaused = true;
      doc.classList.add('is-reel-open');
      overlay.setAttribute('aria-hidden', 'false');
      if (lenis) lenis.stop();
      tl.play();
      video.currentTime = 0;
      video.muted = false;
      var p = video.play();
      if (p && p.catch) p.catch(function () { video.muted = true; video.play(); });
      closeBtn.focus();
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      cursorPaused = false;
      doc.classList.remove('is-reel-open');
      overlay.setAttribute('aria-hidden', 'true');
      if (lenis) lenis.start();
      tl.reverse().eventCallback('onReverseComplete', function () {
        gsap.set(overlay, { visibility: 'hidden' });
      });
      video.pause();
      openBtn.focus();
    }

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  /* ======================================================================
     13. Hero CTA — "View My Work" / "Get in Touch" scroll like the menu
         links do, without going through the menu itself
     ====================================================================== */
  function initHeroCta() {
    document.querySelectorAll('.hero-cta [data-scroll-to]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var target = document.querySelector(link.getAttribute('data-scroll-to'));
        if (!target) return;
        e.preventDefault();
        if (lenis) lenis.scrollTo(target, { duration: 1.5 });
        else target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
      });
    });
  }

  /* ======================================================================
     19. Active-section indicator in the menu
     ====================================================================== */
  function initActiveNav() {
    if (!hasST) return;
    var links = document.querySelectorAll('.menu__link[data-scroll-to]');
    if (!links.length) return;

    var map = {};
    links.forEach(function (link) { map[link.getAttribute('data-scroll-to')] = link; });

    function setActive(sel) {
      Object.keys(map).forEach(function (key) {
        map[key].classList.toggle('is-active', key === sel);
      });
    }

    Object.keys(map).forEach(function (sel) {
      var section = document.querySelector(sel);
      if (!section) return;
      ScrollTrigger.create({
        trigger: section,
        start: 'top center',
        end: 'bottom center',
        onEnter: function () { setActive(sel); },
        onEnterBack: function () { setActive(sel); }
      });
    });
  }

  /* ======================================================================
     16. Scroll progress — thin bar across the top of the viewport
     ====================================================================== */
  function initScrollProgress() {
    var bar = document.getElementById('scroll-progress');
    if (!bar) return;

    if (!hasST) {
      window.addEventListener('scroll', function () {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
      }, { passive: true });
      return;
    }

    ScrollTrigger.create({
      trigger: document.body,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: function (self) { bar.style.width = (self.progress * 100) + '%'; }
    });
  }

  /* ======================================================================
     17. Hero parallax — the wordmark drifts gently toward the cursor
     ====================================================================== */
  function initHeroParallax() {
    if (reduced || !fine) return;
    var hero = document.getElementById('page1');
    var word = document.querySelector('.hero-type');
    if (!hero || !word) return;

    var qx = gsap.quickTo(word, 'x', { duration: 1, ease: 'power3.out' });
    var qy = gsap.quickTo(word, 'y', { duration: 1, ease: 'power3.out' });

    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      qx(((e.clientX - r.left) / r.width - 0.5) * 26);
      qy(((e.clientY - r.top) / r.height - 0.5) * 16);
    });
    hero.addEventListener('mouseleave', function () { qx(0); qy(0); });
  }

  /* ======================================================================
     18. Skill-box tilt — subtle 3D lean toward the cursor
     ====================================================================== */
  function initBoxTilt() {
    if (reduced || !fine) return;
    document.querySelectorAll('#page3-elements .box').forEach(function (box) {
      box.addEventListener('mousemove', function (e) {
        var r = box.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        gsap.to(box, {
          rotateY: px * 8,
          rotateX: py * -8,
          transformPerspective: 800,
          duration: 0.6,
          ease: 'power2.out'
        });
      });
      box.addEventListener('mouseleave', function () {
        gsap.to(box, { rotateY: 0, rotateX: 0, duration: 0.8, ease: 'power3.out' });
      });
    });
  }

  /* ======================================================================
     14. Contact form — static export, no backend, so submitting hands off
         to a pre-filled mailto: instead. Swap in a real endpoint later.
     ====================================================================== */
  function initContactForm() {
    var form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.elements.name.value.trim();
      var email = form.elements.email.value.trim();
      var message = form.elements.message.value.trim();

      var subject = 'Portfolio contact from ' + (name || 'website visitor');
      var body = message + '\n\n— ' + name + (email ? ' (' + email + ')' : '');

      window.location.href = 'mailto:aafiurrahman531@gmail.com'
        + '?subject=' + encodeURIComponent(subject)
        + '&body=' + encodeURIComponent(body);
    });
  }

  /* ======================================================================
     15. Autoplay rescue — some browsers hold muted video until first input
     ====================================================================== */
  function initVideos() {
    var vids = document.querySelectorAll('#main video');

    function play() {
      vids.forEach(function (v) {
        if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      });
    }
    play();
    ['pointerdown', 'touchstart', 'keydown'].forEach(function (evt) {
      window.addEventListener(evt, play, { once: true, passive: true });
    });
  }

  /* ======================================================================
     Boot
     ====================================================================== */
  function boot() {
    initSmoothScroll();
    initCursor();
    initIntro();
    initHeroScroll();
    initLines();
    initMarquee();
    initBoxes();
    initRing();
    initMagnetic();
    initFooter();
    initMenu();
    initReel();
    initHeroCta();
    initContactForm();
    initScrollProgress();
    initHeroParallax();
    initBoxTilt();
    initActiveNav();
    initVideos();

    /* Display faces change metrics once loaded — re-measure trigger points. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { if (hasST) ScrollTrigger.refresh(); });
    }
    window.addEventListener('load', function () { if (hasST) ScrollTrigger.refresh(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
