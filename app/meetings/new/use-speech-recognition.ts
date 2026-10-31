"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Minimal typings for the Web Speech API (Chrome/Edge expose it as webkitSpeechRecognition).
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlternative;
}
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface SpeechErrorEvent {
  error: string;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

function errorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow the mic from the icon in your address bar, then try again.";
    case "audio-capture":
      return "We couldn't find a microphone. Plug one in, or paste the transcript instead.";
    case "network":
      return "Voice typing needs an internet connection (the browser sends audio to its speech service). Check your connection, or paste the transcript.";
    case "language-not-supported":
      return "This browser doesn't support that voice language. Try English (India).";
    default:
      return "Voice typing stopped unexpectedly. Press the mic to continue.";
  }
}

/**
 * Browser speech-to-text. Calls onFinalText with each finished phrase; exposes the
 * in-progress phrase as `interim`. Keeps listening through pauses until stop().
 */
export function useSpeechRecognition(onFinalText: (text: string) => void) {
  // false on the server and before hydration; real value in the browser.
  const supported = useSyncExternalStore(noopSubscribe, () => getRecognitionCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<Recognition | null>(null);
  const keepGoingRef = useRef(false);
  const onFinalRef = useRef(onFinalText);
  useEffect(() => {
    onFinalRef.current = onFinalText;
  });

  const start = useCallback((lang: string) => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || recRef.current) return;
    setError(null);

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          if (text) onFinalRef.current(text);
        } else {
          pending += r[0].transcript;
        }
      }
      setInterim(pending);
    };
    rec.onerror = (e) => {
      // Silence and our own stop() are not real errors.
      if (e.error === "no-speech" || e.error === "aborted") return;
      keepGoingRef.current = false;
      setError(errorMessage(e.error));
    };
    rec.onend = () => {
      setInterim("");
      // Chrome ends the session after a pause; quietly restart until the user stops.
      if (keepGoingRef.current) {
        try {
          rec.start();
          return;
        } catch {
          // fall through and stop
        }
      }
      keepGoingRef.current = false;
      recRef.current = null;
      setListening(false);
    };

    keepGoingRef.current = true;
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      keepGoingRef.current = false;
      recRef.current = null;
      setError(errorMessage("start"));
    }
  }, []);

  const stop = useCallback(() => {
    keepGoingRef.current = false;
    recRef.current?.stop();
  }, []);

  // Release the mic if the user navigates away mid-recording.
  useEffect(
    () => () => {
      keepGoingRef.current = false;
      recRef.current?.abort();
    },
    [],
  );

  return { supported, listening, interim, error, start, stop };
}
