import React, { useEffect, useRef } from 'react';
import FilmGrainCanvas from './FilmGrainCanvas';

const BackgroundLayers: React.FC = () => {
  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      {/* Layer 1: Solid cream base */}
      <div style={{ position: 'absolute', inset: 0, background: '#eae7de', zIndex: -4 }} />
      
      {/* Layer 2: Blurred blue gradient blobs — these turn green with mix-blend-multiply over cream */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.6, mixBlendMode: 'multiply', zIndex: -3, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-10%', left: '-5%', width: '60vw', height: '60vw', background: '#38bdf8', borderRadius: '9999px', filter: 'blur(140px)', opacity: 0.25 }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '70vw', height: '70vw', background: '#0ea5e9', borderRadius: '9999px', filter: 'blur(160px)', opacity: 0.2 }} />
      </div>
      
      {/* Layer 3: Cream paper texture overlay */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: "url('https://www.transparenttextures.com/patterns/cream-paper.png')", opacity: 0.4, mixBlendMode: 'multiply', zIndex: -2 }} />
      
      {/* Layer 4: Particle field — adapted for light cream background, dark particles */}
      <ParticleFieldLight />
      
      {/* Layer 5: Film grain on top */}
      <FilmGrainCanvas />
    </div>
  );
};

// Light-background version of particle field (dark green particles on cream)
const ParticleFieldLight: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let rafId: number;
    const PARTICLE_COUNT = 60;
    const MAX_DIST = 120;
    const MOUSE_REPEL_RADIUS = 150;
    const MOUSE_REPEL_STRENGTH = 0.8;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const mouseRef = { x: -1000, y: -1000 };
    const onMouseMove = (e: MouseEvent) => { mouseRef.x = e.clientX; mouseRef.y = e.clientY; };
    window.addEventListener('mousemove', onMouseMove);

    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      size: Math.random() * 1.5 + 0.5,
    }));

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const mouse = mouseRef;

      for (const p of particles) {
        p.vx += (Math.random() - 0.5) * 0.1;
        p.vy += (Math.random() - 0.5) * 0.1;
        p.vx *= 0.98;
        p.vy *= 0.98;
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_REPEL_RADIUS && dist > 0) {
          const force = (MOUSE_REPEL_RADIUS - dist) / MOUSE_REPEL_RADIUS * MOUSE_REPEL_STRENGTH;
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
            // Dark green lines for light background
            const color = highlight ? '#166534' : '#14532d';
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
        ctx.fillStyle = '#14532d';
        ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none' }}
    />
  );
};

export default BackgroundLayers;
