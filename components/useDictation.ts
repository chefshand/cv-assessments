"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typing for the Web Speech API (not in lib.dom for all browsers).
interface SRResult { isFinal: boolean; 0: { transcript: string } }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SR {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

export function useDictation(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SR | null>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    setSupported(true);
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else interimText += res[0].transcript;
      }
      setInterim(interimText);
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    r.onerror = (e) => {
      setError(e.error === "not-allowed" ? "Microphone permission denied" : `Dictation error: ${e.error}`);
      setListening(false);
    };
    rec.current = r;
    return () => r.stop();
  }, []);

  const toggle = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    setError(null);
    if (listening) {
      r.stop();
    } else {
      try {
        r.start();
        setListening(true);
      } catch {
        /* already started */
      }
    }
  }, [listening]);

  return { supported, listening, interim, error, toggle };
}
