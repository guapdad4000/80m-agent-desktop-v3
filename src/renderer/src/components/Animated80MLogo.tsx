import { useEffect, useRef } from 'react';

const Animated80MLogo: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let rafId: number;
    const startTime = Date.now();

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();

    const draw = () => {
      const elapsed = Date.now() - startTime;
      // ~3s breathing period
      const breathe = 0.5 + 0.5 * Math.sin((elapsed / 3000) * Math.PI * 2);
      const glowRadius = 4 + breathe * 12;

      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;

      ctx.clearRect(0, 0, w, h);

      // Shadow/glow layer
      ctx.save();
      ctx.shadowColor = '#4ade80';
      ctx.shadowBlur = glowRadius;
      ctx.font = `bold ${h * 0.85}px 'Bodoni Moda', 'Georgia', serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';

      // Draw "80M" in off-white
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText('80M', 0, 0);

      // Draw "." dot in green with breathing glow
      ctx.shadowBlur = glowRadius + 4;
      ctx.fillStyle = `rgba(74, ${197 + Math.floor(breathe * 30)}, 128, ${0.8 + breathe * 0.2})`;
      const dotX = ctx.measureText('80M').width + 2;
      ctx.fillText('.', dotX, 0);

      ctx.restore();

      rafId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 100, height: 40, display: 'block' }}
      aria-hidden="true"
    />
  );
};

export default Animated80MLogo;
