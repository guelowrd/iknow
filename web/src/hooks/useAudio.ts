import { useCallback, useEffect, useRef, useState } from "react";

const TRACKS = ["/audio/prove-it.mp3", "/audio/circuit-chase.mp3", "/audio/nullified.mp3"];

/** Hidden player behind the title-bar LED: plays the three tracks in a loop, feeds the spectrum. */
export function useAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [playing, setPlaying] = useState(false);
  const [track, setTrack] = useState(0);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none";
    audioRef.current = audio;
    const next = () => setTrack((i) => (i + 1) % TRACKS.length);
    audio.addEventListener("ended", next);
    return () => {
      audio.removeEventListener("ended", next);
      audio.pause();
      contextRef.current?.close().catch(() => undefined);
    };
  }, []);

  // play the current track whenever it changes while playing
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playing) return;
    audio.src = TRACKS[track];
    audio.play().catch(() => setPlaying(false));
  }, [track, playing]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      audio.currentTime = 0;
      setPlaying(false);
      return;
    }
    if (!contextRef.current) {
      const context = new AudioContext();
      const node = context.createAnalyser();
      node.fftSize = 64;
      node.smoothingTimeConstant = 0.8;
      context.createMediaElementSource(audio).connect(node);
      node.connect(context.destination);
      contextRef.current = context;
      setAnalyser(node);
    }
    contextRef.current.resume().catch(() => undefined);
    setPlaying(true);
  }, [playing]);

  return { playing, analyser, toggle, track };
}
