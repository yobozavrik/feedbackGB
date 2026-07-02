"use client";

import { App, Col, Row } from "antd";
import { useCallback, useState } from "react";
import { DailyReportCard } from "@/components/admin/settings/DailyReportCard";
import { IntegrationsCard } from "@/components/admin/settings/IntegrationsCard";
import { MirrorCard } from "@/components/admin/settings/MirrorCard";
import { NotificationsCard } from "@/components/admin/settings/NotificationsCard";
import {
  PinModal,
  type PinModalValues,
} from "@/components/admin/settings/PinModal";
import { ProfileCard } from "@/components/admin/settings/ProfileCard";
import { setUserPin } from "@/lib/adminUsersApi";
import type { SettingsData } from "./page";

const PIN_RE = /^\d{6}$/;

interface Props {
  data: SettingsData;
}

export function SettingsClient({ data }: Props) {
  const { message } = App.useApp();
  const [hasPin, setHasPin] = useState(data.profile.has_pin);
  const [pinModalOpen, setPinModalOpen] = useState(false);

  const [soundEnabled, setSoundEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("fbgb_sound_enabled") !== "false";
    }
    return true;
  });

  const [pushEnabled, setPushEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("fbgb_push_enabled") === "true";
    }
    return false;
  });

  const handleToggleSound = useCallback((val: boolean) => {
    setSoundEnabled(val);
    localStorage.setItem("fbgb_sound_enabled", String(val));
    message.success(val ? "Звукові сповіщення увімкнено" : "Звукові сповіщення вимкнено");
  }, [message]);

  const handleTogglePush = useCallback(async (val: boolean) => {
    if (val && typeof window !== "undefined" && "Notification" in window) {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        message.error("Дозвіл на сповіщення відхилено");
        setPushEnabled(false);
        localStorage.setItem("fbgb_push_enabled", "false");
        return;
      }
    }
    setPushEnabled(val);
    localStorage.setItem("fbgb_push_enabled", String(val));
    message.success(val ? "Браузерні сповіщення увімкнено" : "Браузерні сповіщення вимкнено");
  }, [message]);

  const handleSavePin = useCallback(
    async (values: PinModalValues) => {
      if (values.pin !== values.confirm) {
        message.error("Підтвердження не співпадає.");
        return false;
      }
      if (!PIN_RE.test(values.pin)) {
        message.error("PIN має бути 6–8 цифр.");
        return false;
      }
      const result = await setUserPin(data.profile.uid, values.pin);
      if (!result.ok) {
        message.error(result.error ?? "Помилка сервера");
        return false;
      }
      setHasPin(true);
      message.success(hasPin ? "PIN оновлено" : "PIN встановлено");
      return true;
    },
    [data.profile.uid, hasPin, message],
  );

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <ProfileCard
          profile={data.profile}
          hasPin={hasPin}
          onChangePin={() => setPinModalOpen(true)}
        />
      </Col>

      <Col xs={24} lg={12}>
        <IntegrationsCard integrations={data.integrations} />
      </Col>

      <Col xs={24} lg={12}>
        <DailyReportCard
          crons={data.crons}
          lastManualReport={data.lastManualReport}
        />
      </Col>

      <Col xs={24} lg={12}>
        <MirrorCard lastManualMirror={data.lastManualMirror} />
      </Col>

      <Col xs={24} lg={12}>
        <NotificationsCard
          soundEnabled={soundEnabled}
          pushEnabled={pushEnabled}
          onToggleSound={handleToggleSound}
          onTogglePush={handleTogglePush}
        />
      </Col>

      <PinModal
        open={pinModalOpen}
        hasPin={hasPin}
        onOpenChange={setPinModalOpen}
        onFinish={handleSavePin}
      />
    </Row>
  );
}
