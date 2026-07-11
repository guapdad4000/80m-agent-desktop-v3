import { localFileUrl, plainSpeechText } from "./chatAreaUtils";

export function playDoneSound(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (_) {
    // Audio not available.
  }
}

export async function playTTS(text: string): Promise<void> {
  const clean = plainSpeechText(text);
  if (!clean) return;

  window.dispatchEvent(new CustomEvent("agent-speaking-start"));
  try {
    const audioPath = await window.hermesAPI?.ttsSpeak(clean);
    if (audioPath) {
      const audio = new Audio(localFileUrl(audioPath));
      audio.volume = 0.9;
      audio.onended = () =>
        window.dispatchEvent(new CustomEvent("agent-speaking-stop"));
      audio.onerror = () => {
        window.dispatchEvent(new CustomEvent("agent-speaking-stop"));
      };
      await audio.play();
      return;
    }
  } catch (err) {
    console.warn("Hermes TTS failed:", err);
  }

  window.dispatchEvent(new CustomEvent("agent-speaking-stop"));
}

export function playTypingSound(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "square";
    osc.frequency.setValueAtTime(150 + Math.random() * 50, ctx.currentTime);

    gain.gain.setValueAtTime(0.01, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.05);
  } catch (_) {
    // Audio not available.
  }
}
