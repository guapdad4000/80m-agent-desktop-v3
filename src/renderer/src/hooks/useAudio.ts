import { useRef, useCallback } from 'react';

export const useAudio = () => {
  const ctxRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return ctxRef.current;
  }, []);

  const unlock = useCallback(() => {
    if (unlockedRef.current) return;
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    unlockedRef.current = true;
  }, [getCtx]);

  const playSendClick = useCallback(() => {
    if (!unlockedRef.current) return;
    try {
      const ctx = getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
    } catch (_) {}
  }, [getCtx]);

  const playAgentChime = useCallback(() => {
    if (!unlockedRef.current) return;
    try {
      const ctx = getCtx();
      const now = ctx.currentTime;

      const tone = (freq: number, startTime: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.1, startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      tone(523, now, 0.08);
      tone(659, now + 0.12, 0.08);
    } catch (_) {}
  }, [getCtx]);

  return { unlock, playSendClick, playAgentChime };
};
