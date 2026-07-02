"use client";

import { useEffect, useRef } from "react";
import type { Interaction } from "@/lib/interactionStats";

// Self-contained phone mockup + canvas heatmap overlay. This block is a
// deliberate stylistic island: it imitates the seller Mini App (its own
// Tailwind slate/rose palette), not the admin theme — do not "fix" it to
// antd tokens.

interface Props {
  pagePath: string;
  interactions: Interaction[];
}

export function PhoneHeatmapPreview({ pagePath, interactions }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Draw Heatmap on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (interactions.length === 0) return;

    // Draw Heatmap spots
    interactions.forEach((pt) => {
      const x = pt.x_ratio * width;
      const y = pt.y_ratio * height;

      // Draw radial gradient for beautiful glowing heat spots
      const radius = 22;
      const grad = ctx.createRadialGradient(x, y, 2, x, y, radius);

      // Warm pink/orange palette
      grad.addColorStop(0, "rgba(255, 30, 80, 0.7)");
      grad.addColorStop(0.3, "rgba(255, 110, 0, 0.45)");
      grad.addColorStop(0.6, "rgba(255, 210, 0, 0.2)");
      grad.addColorStop(1, "rgba(255, 255, 0, 0)");

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fill();
    });
  }, [interactions]);

  return (
    <div style={{ position: "relative", width: 340, height: 600 }} className="phone-container">
      {/* Mobile phone frame */}
      <div className="absolute inset-0 border-[8px] border-slate-800 rounded-[36px] bg-slate-950 shadow-2xl pointer-events-none z-30" />
      {/* Inner screen container */}
      <div className="absolute inset-[8px] rounded-[28px] overflow-hidden bg-slate-100 z-10 select-none">
        {/* 1. LOGIN SCREEN MOCKUP */}
        {pagePath === "/login" && (
          <div className="h-full flex flex-col items-center justify-center bg-white px-4 pb-8 pt-10 text-center font-sans text-slate-800">
            <div className="text-3xl mb-1">🌸</div>
            <div className="text-[20px] font-bold tracking-tight text-slate-900 font-display leading-none">
              Галя слухає
            </div>
            <div className="text-[12px] text-slate-400 mt-1">Введи свій PIN</div>

            {/* Dots indicator */}
            <div className="flex gap-2.5 mt-6 mb-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="h-3 w-3 rounded-full border border-slate-300 bg-slate-50" />
              ))}
            </div>

            {/* Keypad */}
            <div className="grid grid-cols-3 gap-3.5 mt-2 max-w-[210px]">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((key, i) => (
                <div
                  key={i}
                  className={`h-[50px] w-[50px] rounded-full flex items-center justify-center text-[18px] font-medium ${
                    key === "OK"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-50 text-slate-800 border border-slate-200/50"
                  }`}
                >
                  {key}
                </div>
              ))}
            </div>
            <div className="text-[10px] text-slate-400 mt-8 max-w-[180px] leading-tight">
              Якщо забула PIN — попроси адміна в чаті.
            </div>
          </div>
        )}

        {/* 2. MAIN FEEDBACK FORM MOCKUP */}
        {pagePath === "/" && (
          <div className="h-full flex flex-col bg-slate-50 px-3 py-4 text-left font-sans text-[12px] text-slate-800 overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <span className="font-bold text-slate-900">🌸 Галя слухає</span>
              <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600">Магазин 18</span>
            </div>

            {/* Categories */}
            <div className="mt-3">
              <div className="font-medium text-slate-500 mb-1.5">Категорія фідбеку</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { name: "Не вистачає", color: "bg-rose-100" },
                  { name: "Постачання", color: "bg-orange-100" },
                  { name: "Ідея", color: "bg-emerald-100" },
                  { name: "Підгледіла", color: "bg-sky-100" },
                  { name: "Поломка", color: "bg-amber-100" },
                  { name: "Голос клієнта", color: "bg-indigo-100" },
                ].map((cat, i) => (
                  <div
                    key={i}
                    className={`p-2 rounded-lg border border-slate-200 text-center font-medium ${cat.color}`}
                  >
                    {cat.name}
                  </div>
                ))}
              </div>
            </div>

            {/* Comment Textarea */}
            <div className="mt-3">
              <div className="font-medium text-slate-500 mb-1">Коментар</div>
              <div className="h-14 bg-white border border-slate-200 rounded-lg p-1.5 text-slate-300">
                Опишіть ситуацію детальніше...
              </div>
            </div>

            {/* Photo Attach */}
            <div className="mt-3 bg-white border border-dashed border-slate-300 rounded-lg p-2.5 text-center text-slate-400">
              📸 Додати фото
            </div>

            {/* Submit button */}
            <div className="mt-auto pt-3">
              <div className="h-9 bg-rose-500 text-white rounded-lg flex items-center justify-center font-bold text-[13px]">
                Надіслати фідбек
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Canvas Overlay for Heatmap drawing */}
      <canvas
        ref={canvasRef}
        width={324}
        height={584}
        style={{
          position: "absolute",
          left: 8,
          top: 8,
          width: "calc(100% - 16px)",
          height: "calc(100% - 16px)",
          zIndex: 20,
          pointerEvents: "none",
          borderRadius: "28px",
        }}
      />
    </div>
  );
}
