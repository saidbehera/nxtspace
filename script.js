(() => {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Theme ---------- */
  const root = document.documentElement;
  const saved = (() => { try { return localStorage.getItem("theme"); } catch { return null; } })();
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = saved || (prefersDark ? "dark" : "light");
  $("#themeToggle")?.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch {}
  });

  /* ---------- Nav ---------- */
  const nav = $("#nav"), links = $("#navLinks"), menuBtn = $("#menuBtn"), toTop = $("#toTop");
  menuBtn?.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", open);
  });
  $$("a", links || document.createElement("div")).forEach(a => a.addEventListener("click", () => {
    links.classList.remove("open");
    menuBtn?.setAttribute("aria-expanded", "false");
  }));
  const onScroll = () => {
    nav?.classList.toggle("scrolled", window.scrollY > 10);
    toTop?.classList.toggle("show", window.scrollY > 600);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  toTop?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }));

  // Highlight active in-page section link (home page only)
  if (links) {
    const sections = $$("main section[id]");
    const navAnchors = $$("a[href^='#']", links);
    if (sections.length && navAnchors.length) {
      const spy = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            navAnchors.forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id));
          }
        });
      }, { rootMargin: "-45% 0px -50% 0px" });
      sections.forEach(s => spy.observe(s));
    }
  }

  /* ---------- Scroll reveal ---------- */
  $$(".reveal").forEach(el => {
    const sibs = [...el.parentElement.children].filter(c => c.classList.contains("reveal"));
    el.style.setProperty("--d", `${Math.min(sibs.indexOf(el), 5) * 0.08}s`);
  });
  const revealObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        revealObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.15 });
  $$(".reveal").forEach(el => revealObs.observe(el));

  /* ---------- Counters ---------- */
  const countObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target, end = +el.dataset.count, suffix = el.dataset.suffix || "";
      countObs.unobserve(el);
      if (reduceMotion) { el.textContent = end + suffix; return; }
      const start = performance.now(), dur = 1400;
      const tick = now => {
        const p = Math.min((now - start) / dur, 1);
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))) + (p === 1 ? suffix : "");
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.6 });
  $$("[data-count]").forEach(el => countObs.observe(el));

  /* ---------- Tabs (home) ---------- */
  const tabs = $$(".tab");
  if (tabs.length) {
    const activate = tab => {
      tabs.forEach(t => {
        const on = t === tab;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on);
        t.tabIndex = on ? 0 : -1;
        const panel = $("#panel-" + t.dataset.tab);
        panel.hidden = !on;
        panel.classList.toggle("active", on);
      });
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => activate(t));
      t.addEventListener("keydown", e => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
        next.focus();
        activate(next);
      });
    });
  }

  /* ---------- Hero network canvas ---------- */
  const canvas = $("#network");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    let W, H, nodes = [], raf;
    const mouse = { x: null, y: null };

    const colors = () => {
      const s = getComputedStyle(root);
      return { a: s.getPropertyValue("--primary").trim(), b: s.getPropertyValue("--primary-2").trim() };
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(Math.floor((W * H) / 14000), 90);
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35,
        r: Math.random() * 2 + 1
      }));
    };
    const draw = () => {
      const c = colors(), maxD = 130;
      ctx.clearRect(0, 0, W, H);
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
        if (mouse.x !== null) {
          const dx = n.x - mouse.x, dy = n.y - mouse.y, d = Math.hypot(dx, dy);
          if (d > 0 && d < 110) { n.x += dx / d * 0.8; n.y += dy / d * 0.8; }
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < maxD) {
            ctx.globalAlpha = (1 - d / maxD) * 0.35;
            ctx.strokeStyle = c.a;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 0.8;
      nodes.forEach((n, i) => {
        ctx.fillStyle = i % 3 ? c.a : c.b;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    resize();
    window.addEventListener("resize", resize);
    const host = canvas.parentElement;
    host.addEventListener("pointermove", e => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    });
    host.addEventListener("pointerleave", () => { mouse.x = mouse.y = null; });
    if (reduceMotion) {
      draw(); cancelAnimationFrame(raf);
    } else {
      draw();
      // Pause when the hero is off-screen
      new IntersectionObserver(([e]) => {
        cancelAnimationFrame(raf);
        if (e.isIntersecting) raf = requestAnimationFrame(draw);
      }).observe(canvas);
    }
  }

  /* ---------- Project cards: progress bars ---------- */
  const projObs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); projObs.unobserve(e.target); } });
  }, { threshold: 0.4 });
  $$(".project").forEach(p => projObs.observe(p));

  /* ---------- Research filters ---------- */
  const filters = $$(".filter");
  if (filters.length) {
    const cards = $$("#projectGrid .project");
    const count = $("#resultCount"), empty = $("#emptyMsg");
    const apply = key => {
      let shown = 0;
      cards.forEach(c => {
        const match = key === "all" || c.dataset.cat === key;
        c.hidden = !match;
        if (match) { shown++; c.classList.add("in"); }
      });
      filters.forEach(f => {
        const on = f.dataset.filter === key;
        f.classList.toggle("active", on);
        f.setAttribute("aria-pressed", on);
      });
      count.textContent = `Showing ${shown} project${shown === 1 ? "" : "s"}`;
      if (empty) empty.hidden = shown !== 0;
    };
    filters.forEach(f => f.addEventListener("click", () => apply(f.dataset.filter)));
    apply("all");
  }

  /* ---------- Footer year ---------- */
  const yr = $("#year");
  if (yr) yr.textContent = new Date().getFullYear();
})();
