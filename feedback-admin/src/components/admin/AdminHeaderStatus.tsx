"use client";

import { UserOutlined } from "@ant-design/icons";
import { Typography, theme as antdTheme } from "antd";
import { useEffect, useState } from "react";
import { roleLabel } from "@/components/admin/AdminShell";
import type { UserRole } from "@/lib/session";

const { Text } = Typography;

// Магазини мережі — усі в Чернівцях (див. адреси у v_stores), тому
// достатньо однієї фіксованої точки без geolocation-дозволів.
const CHERNIVTSI = { lat: 48.2921, lon: 25.9358 };
const WEATHER_REFRESH_MS = 15 * 60 * 1000;

// Підмножина WMO weather codes (https://open-meteo.com/en/docs), яка
// реально трапляється у прогнозі для Чернівців.
function weatherIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫";
  if (code >= 51 && code <= 57) return "🌦";
  if (code >= 61 && code <= 67) return "🌧";
  if (code >= 71 && code <= 77) return "🌨";
  if (code >= 80 && code <= 82) return "🌧";
  if (code >= 85 && code <= 86) return "🌨";
  if (code >= 95) return "⛈";
  return "🌡";
}

interface WeatherState {
  temp: number;
  code: number;
}

interface Props {
  currentUser: { fullName: string; role: UserRole };
}

/**
 * Компактний віджет у "extra"-слоті шапки сторінки `/admin`: годинник у
 * реальному часі, дата/день тижня/рік, погода у Чернівцях (Open-Meteo,
 * без ключа) і хто зараз працює під цим обліковим записом.
 *
 * Годинник рендериться лише після client mount — інакше SSR-пас і перша
 * client-гідратація бачать різний `Date.now()` і React кидає hydration
 * mismatch (той самий прийом, що й у AdminShell).
 */
export function AdminHeaderStatus({ currentUser }: Props) {
  const { token } = antdTheme.useToken();
  const [now, setNow] = useState<Date | null>(null);
  const [weather, setWeather] = useState<WeatherState | null>(null);
  const [weatherError, setWeatherError] = useState(false);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadWeather() {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${CHERNIVTSI.lat}&longitude=${CHERNIVTSI.lon}&current_weather=true&timezone=Europe%2FKyiv`,
        );
        if (!res.ok) throw new Error(`weather http ${res.status}`);
        const data = await res.json();
        const cw = data?.current_weather;
        if (!cancelled && cw && typeof cw.temperature === "number") {
          setWeather({ temp: Math.round(cw.temperature), code: cw.weathercode });
          setWeatherError(false);
        }
      } catch {
        if (!cancelled) setWeatherError(true);
      }
    }

    loadWeather();
    const id = setInterval(loadWeather, WEATHER_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!now) {
    return <div className="admin-header-status admin-header-status--placeholder" />;
  }

  const time = now.toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dateLabel = now.toLocaleDateString("uk-UA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="admin-header-status">
      <div className="admin-header-status__clock" style={{ color: token.colorPrimary }}>
        {time}
      </div>
      <Text type="secondary" className="admin-header-status__date">
        {dateLabel}
      </Text>
      <div className="admin-header-status__sep" />
      <Text type="secondary" className="admin-header-status__weather">
        {weatherError
          ? "Погода недоступна"
          : weather
            ? `${weatherIcon(weather.code)} ${weather.temp}°C · Чернівці`
            : "Завантаження погоди…"}
      </Text>
      <div className="admin-header-status__sep" />
      <Text type="secondary" className="admin-header-status__user">
        <UserOutlined /> {currentUser.fullName} · {roleLabel(currentUser.role)}
      </Text>
    </div>
  );
}
