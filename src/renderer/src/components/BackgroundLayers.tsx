import React, { useEffect, useRef } from "react";

const BackgroundLayers: React.FC = () => {
  return (
    <div className="background-layers" aria-hidden="true">
      <div className="background-layer-base" />
      <div className="background-layer-wash">
        <div className="background-layer-wash-primary" />
        <div className="background-layer-wash-secondary" />
      </div>
      <StaticParticleField />
    </div>
  );
};

type ThemeName = "light" | "dark";

function getResolvedTheme(): ThemeName {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

type Particle = {
  x: number;
  y: number;
  size: number;
};

const StaticParticleField: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const PARTICLE_COUNT = 28;
    const MAX_DIST = 135;

    const ensureParticles = (width: number, height: number) => {
      if (particlesRef.current.length === PARTICLE_COUNT) return;
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 1.4 + 0.6,
      }));
    };

    const render = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = Math.ceil(width * dpr);
      canvas.height = Math.ceil(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      ensureParticles(width, height);
      const particles = particlesRef.current;
      const theme = getResolvedTheme();
      const lineColor = theme === "dark" ? "#2f6f4e" : "#14532d";
      const dotColor = theme === "dark" ? "#4ade80" : "#14532d";

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < MAX_DIST) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = lineColor;
            ctx.globalAlpha = (1 - distance / MAX_DIST) * 0.22;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }

      ctx.globalAlpha = theme === "dark" ? 0.62 : 0.9;
      for (const particle of particles) {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    render();
    window.addEventListener("resize", render);
    const themeObserver = new MutationObserver(render);
    themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });

    return () => {
      window.removeEventListener("resize", render);
      themeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="background-layer-particles" />;
};

export default BackgroundLayers;
