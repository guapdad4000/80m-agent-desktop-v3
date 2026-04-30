import { useEffect } from "react";
import AtmMascot from "../../components/80m/AtmMascot";
import Animated80MLogo from "../../components/Animated80MLogo";
import splashSound from "../../splash-sound.mp3";

interface Props {
  onFinished: () => void;
}

export default function SplashScreen({ onFinished }: Props): React.JSX.Element {
  useEffect(() => {
    try {
      const audio = new Audio(splashSound);
      audio.volume = 0.5;
      audio.play().catch((e) => console.log("Audio play failed:", e));
    } catch (e) {
      // ignore
    }

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
          <Animated80MLogo className="animated-80m-logo-splash" />
          <div className="splash-80m-branding-tagline">Agent Control</div>
        </div>
      </div>
    </div>
  );
}
