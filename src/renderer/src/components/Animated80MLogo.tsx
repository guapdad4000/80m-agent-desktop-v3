import { useEffect, useRef } from "react";

const Animated80MLogo: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let rafId: number;
    const startTime = Date.now();

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const draw = () => {
      const elapsed = Date.now() - startTime;
      // ~3s breathing period
      const breathe = 0.5 + 0.5 * Math.sin((elapsed / 3000) * Math.PI * 2);
      const glowRadius = 3 + breathe * 8;

      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;
      const insetX = 14;
      const insetY = 8;

      ctx.clearRect(0, 0, w, h);

      // Shadow/glow layer
      ctx.save();
      ctx.shadowColor = "#4ade80";
      ctx.shadowBlur = glowRadius;
      ctx.font = `bold ${Math.min(34, h * 0.68)}px 'Bodoni Moda', 'Georgia', serif`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      // Draw "80m" in off-white
      ctx.fillStyle = "#e8e8e8";
      ctx.fillText("80m", insetX, insetY);

      // Draw "." dot in green with breathing glow
      ctx.shadowBlur = glowRadius + 4;
      ctx.fillStyle = `rgba(74, ${197 + Math.floor(breathe * 30)}, 128, ${0.8 + breathe * 0.2})`;
      const dotX = insetX + ctx.measureText("80m").width + 2;
      ctx.fillText(".", dotX, insetY);

      ctx.restore();

      rafId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 132, height: 56, display: "block" }}
      aria-hidden="true"
    />
  );
};

export default Animated80MLogo;
