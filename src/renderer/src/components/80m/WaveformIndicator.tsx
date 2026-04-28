import React, { useEffect, useRef } from 'react';

interface WaveformIndicatorProps {
  isActive: boolean;
}

const WaveformIndicator: React.FC<WaveformIndicatorProps> = ({ isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = 44, H = 20;
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    let startTime: number | null = null;
    const BAR_COUNT = 6;
    const BAR_W = 4;
    const GAP = 3;
    const TOTAL_W = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * GAP;
    const START_X = (W - TOTAL_W) / 2;
    const CENTER_Y = H / 2;

    const draw = (ts: number) => {
      if (!startTime) startTime = ts;
      const elapsed = (ts - startTime) / 1000;
      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < BAR_COUNT; i++) {
        const x = START_X + i * (BAR_W + GAP);
        let barH: number;

        if (isActive) {
          const phase = (i / BAR_COUNT) * Math.PI * 2;
          const sineVal = Math.sin(elapsed * 4 + phase);
          barH = 1 + (sineVal + 1) * 3.5;
          const opacity = 0.4 + ((sineVal + 1) / 2) * 0.6;
          ctx.fillStyle = `rgba(34, 197, 94, ${opacity})`;
        } else {
          barH = 1;
          ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
        }

        const y = CENTER_Y - barH / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_W, barH, 1);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive]);

  return (
    <canvas
      ref={canvasRef}
      width={44 * window.devicePixelRatio}
      height={20 * window.devicePixelRatio}
      style={{ width: 44, height: 20 }}
      className={`transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-30'}`}
    />
  );
};

export default WaveformIndicator;
