import React, { useEffect, useRef } from "react";

const TARGET_FPS = 20;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

const BackgroundLayers: React.FC = () => {
  return (
    <div className="background-layers" aria-hidden="true">
      <div className="background-layer-base" />
      <div className="background-layer-wash">
        <div className="background-layer-wash-primary" />
        <div className="background-layer-wash-secondary" />
      </div>
      <ParticleField />
    </div>
  );
};

type ThemeName = "light" | "dark";

function getResolvedTheme(): ThemeName {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

const ParticleField: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let rafId: number;
    let lastFrameTime = 0;
    const themeRef = { current: getResolvedTheme() };
    const PARTICLE_COUNT = 36;
    const MAX_DIST = 110;
    const MOUSE_REPEL_RADIUS = 150;
    const MOUSE_REPEL_STRENGTH = 0.8;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.ceil(window.innerWidth * dpr);
      canvas.height = Math.ceil(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const mouseRef = { x: -1000, y: -1000 };
    const onMouseMove = (e: MouseEvent) => {
      mouseRef.x = e.clientX;
      mouseRef.y = e.clientY;
    };
    window.addEventListener("mousemove", onMouseMove);

    const themeObserver = new MutationObserver(() => {
      themeRef.current = getResolvedTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["data-theme"],
    });

    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      size: Math.random() * 1.5 + 0.5,
    }));

    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);

      if (document.hidden || now - lastFrameTime < FRAME_INTERVAL_MS) {
        return;
      }
      lastFrameTime = now;

      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      const mouse = mouseRef;
      const theme = themeRef.current;

      for (const p of particles) {
        p.vx += (Math.random() - 0.5) * 0.1;
        p.vy += (Math.random() - 0.5) * 0.1;
        p.vx *= 0.98;
        p.vy *= 0.98;
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_REPEL_RADIUS && dist > 0) {
          const force =
            ((MOUSE_REPEL_RADIUS - dist) / MOUSE_REPEL_RADIUS) *
            MOUSE_REPEL_STRENGTH;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < MAX_DIST) {
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            const mDist = Math.sqrt((mx - mouse.x) ** 2 + (my - mouse.y) ** 2);
            const highlight = mDist < MOUSE_REPEL_RADIUS ? 1 : 0;
            const baseAlpha = (1 - d / MAX_DIST) * 0.4;
            const alpha = baseAlpha + highlight * 0.3;
            const color =
              theme === "dark"
                ? highlight
                  ? "#4ade80"
                  : "#2f6f4e"
                : highlight
                  ? "#166534"
                  : "#14532d";
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = color;
            ctx.globalAlpha = Math.min(alpha, 1);
            ctx.lineWidth = highlight ? 1.5 : 0.8;
            ctx.stroke();
          }
        }
      }

      ctx.globalAlpha = 1;
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = theme === "dark" ? "#4ade80" : "#14532d";
        ctx.globalAlpha = theme === "dark" ? 0.7 : 1;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      themeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="background-layer-particles" />;
};

export default BackgroundLayers;
