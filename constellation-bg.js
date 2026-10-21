/* Full-page animated constellation background for NxtSpace account/dashboard views. */
(() => {
  "use strict";
  if (document.getElementById("nxtspace-constellation-bg")) return;

  const canvas = document.createElement("canvas");
  canvas.id = "nxtspace-constellation-bg";
  canvas.setAttribute("aria-hidden", "true");
  canvas.tabIndex = -1;
  document.body.prepend(canvas);

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width = 0, height = 0, dpr = 1, nodes = [], frame = 0, paused = document.hidden;
  const mouse = { x: null, y: null };

  const getPalette = () => {
    const style = getComputedStyle(document.documentElement);
    return {
      line: style.getPropertyValue("--primary").trim() || "#62cfff",
      point: style.getPropertyValue("--primary-2").trim() || "#8f82ff"
    };
  };

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const desired = Math.max(34, Math.min(92, Math.round((width * height) / 14500)));
    nodes = Array.from({ length: desired }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: reduceMotion ? 0 : (Math.random() - 0.5) * 0.24,
      vy: reduceMotion ? 0 : (Math.random() - 0.5) * 0.24,
      r: Math.random() * 1.35 + 0.65
    }));
    draw();
  };

  const draw = () => {
    if (!context) return;
    const palette = getPalette();
    context.clearRect(0, 0, width, height);
    const maxDistance = Math.min(155, Math.max(100, width * 0.13));

    for (const node of nodes) {
      if (!reduceMotion && !paused) {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < -8 || node.x > width + 8) node.vx *= -1;
        if (node.y < -8 || node.y > height + 8) node.vy *= -1;
        if (mouse.x !== null) {
          const dx = node.x - mouse.x, dy = node.y - mouse.y;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < 85) {
            node.x += dx / distance * 0.25;
            node.y += dy / distance * 0.25;
          }
        }
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance < maxDistance) {
          context.globalAlpha = (1 - distance / maxDistance) * 0.28;
          context.strokeStyle = palette.line;
          context.lineWidth = 0.75;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }
    }

    nodes.forEach((node, index) => {
      context.globalAlpha = index % 4 === 0 ? 0.82 : 0.48;
      context.fillStyle = index % 4 === 0 ? palette.point : palette.line;
      context.beginPath();
      context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      context.fill();
    });
    context.globalAlpha = 1;
  };

  const animate = () => {
    if (paused || reduceMotion) return;
    draw();
    frame = window.requestAnimationFrame(animate);
  };

  const start = () => {
    window.cancelAnimationFrame(frame);
    if (paused || reduceMotion) { draw(); return; }
    frame = window.requestAnimationFrame(animate);
  };

  window.addEventListener("resize", () => { resize(); start(); }, { passive: true });
  window.addEventListener("pointermove", event => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
  }, { passive: true });
  window.addEventListener("pointerleave", () => { mouse.x = mouse.y = null; });
  document.addEventListener("visibilitychange", () => {
    paused = document.hidden;
    start();
  });

  resize();
  start();
})();
