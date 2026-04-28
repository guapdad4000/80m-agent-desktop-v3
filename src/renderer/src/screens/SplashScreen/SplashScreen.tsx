import { useEffect } from "react";
import AtmMascot from "../../components/80m/AtmMascot";

interface Props {
  onFinished: () => void;
}

export default function SplashScreen({ onFinished }: Props): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(onFinished, 2800);
    return () => clearTimeout(timer);
  }, [onFinished]);

  return (
    <div className="splash-screen">
      <div className="mascot-intro-container">
        <div className="mascot-intro-wrapper">
          <AtmMascot isIntro={true} />
        </div>
        <div className="impact-ring" />
        <div className="impact-ring-2" />
        <div className="impact-ring-3" />
        <div className="splash-80m-branding">
          <div className="splash-80m-branding-logo">
            80<span>M</span>
          </div>
          <div className="splash-80m-branding-tagline">Agent Control</div>
        </div>
      </div>
    </div>
  );
}
