"use client";

import { useState, useEffect } from "react";

interface Props {
  onTranscript: (text: string) => void;
}

export function VoiceInputButton({ onTranscript }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [supported, setSupported] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      setSupported(true);
      const rec = new SpeechRecognition();
      rec.continuous = false; // Stop listening when speaker pauses
      rec.interimResults = false;
      rec.lang = "uk-UA"; // Primary language of the Telegram Mini App (Ukrainian)

      rec.onstart = () => {
        setIsRecording(true);
      };

      rec.onend = () => {
        setIsRecording(false);
      };

      rec.onerror = (e: any) => {
        console.error("Speech recognition error", e);
        setIsRecording(false);
      };

      rec.onresult = (event: any) => {
        const resultText = event.results[0][0].transcript;
        if (resultText) {
          onTranscript(resultText);
        }
      };

      setRecognition(rec);
    }
  }, [onTranscript]);

  const toggleRecording = () => {
    if (!recognition) return;
    if (isRecording) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (e) {
        console.error(e);
      }
    }
  };

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggleRecording}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
        isRecording
          ? "bg-rose-500 text-white animate-pulse"
          : "bg-elev2 text-ink-600 hover:bg-elev3"
      }`}
      title="Записати голосом (укр)"
    >
      <span className={`h-2.5 w-2.5 rounded-full bg-current ${isRecording ? "scale-110" : ""}`} aria-hidden />
      {isRecording ? "Слухаю (укр)..." : "🎙️ Диктувати"}
    </button>
  );
}
