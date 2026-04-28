import { useEffect } from "react";

interface Props {
  onFinished: () => void;
}

export default function SplashScreen({ onFinished }: Props): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(onFinished, 2200);
    return () => clearTimeout(timer);
  }, [onFinished]);

  return (
    <div className="splash-screen">
      <div className="splash-80m">
        <div className="splash-80m-logo">
          80<span>M</span>
        </div>
        <div className="splash-80m-tagline">Agent Control</div>
        <div className="splash-80m-bar" />
      </div>
    </div>
  );
}
