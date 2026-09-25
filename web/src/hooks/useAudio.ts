import { useCallback, useEffect, useRef, useState } from "react";

const TRACKS = ["/audio/prove-it.mp3", "/audio/circuit-chase.mp3", "/audio/nullified.mp3"];

/** The title-bar player: three tracks in a loop, play/pause, next and previous, feeds the spectrum. */
export function useAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
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

  // play the current track whenever it changes while playing; a resume keeps its position
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playing) return;
    if (!audio.src.endsWith(TRACKS[track])) audio.src = TRACKS[track];
    audio.play().catch(() => setPlaying(false));
  }, [track, playing]);

  const next = useCallback(() => setTrack((i) => (i + 1) % TRACKS.length), []);
  const prev = useCallback(() => setTrack((i) => (i + TRACKS.length - 1) % TRACKS.length), []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    setStarted(true);
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

  return { playing, started, analyser, toggle, next, prev, track };
}
