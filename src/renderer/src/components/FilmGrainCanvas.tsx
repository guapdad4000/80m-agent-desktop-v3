import { useEffect, useMemo, useState } from "react";

type GrainTheme = "light" | "dark";

const GRAIN_TILE_SIZE = 192;

const getResolvedTheme = (): GrainTheme =>
  document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";

const getGrainOpacity = (theme: GrainTheme): number =>
  theme === "dark" ? 0.16 : 0.1;

const createStaticGrainTile = (): string => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(GRAIN_TILE_SIZE * dpr);
  canvas.height = Math.ceil(GRAIN_TILE_SIZE * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const imageData = ctx.createImageData(canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const value =
      128 + (Math.random() + Math.random() + Math.random() - 1.5) * 64;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
};

const FilmGrainCanvas: React.FC = () => {
  const [theme, setTheme] = useState<GrainTheme>(getResolvedTheme);
  const grainTile = useMemo(() => createStaticGrainTile(), []);

  useEffect(() => {
    const syncTheme = (): void => {
      setTheme(getResolvedTheme());
    };

    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["data-theme"],
    });

    return () => {
      themeObserver.disconnect();
    };
  }, []);

  return (
    <div
      className="film-grain-canvas"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        pointerEvents: "none",
        display: "block",
        backgroundImage: grainTile ? `url(${grainTile})` : undefined,
        backgroundRepeat: "repeat",
        backgroundSize: `${GRAIN_TILE_SIZE}px ${GRAIN_TILE_SIZE}px`,
        imageRendering: "auto",
        mixBlendMode: "soft-light",
        opacity: getGrainOpacity(theme),
      }}
      aria-hidden="true"
    />
  );
};

export default FilmGrainCanvas;
