"use client";

import { Col, Row } from "antd";
import { useEffect, useMemo, useState } from "react";
import { FiltersCard } from "@/components/admin/analytics/FiltersCard";
import { HeatmapGuideCard } from "@/components/admin/analytics/HeatmapGuideCard";
import { PhoneHeatmapPreview } from "@/components/admin/analytics/PhoneHeatmapPreview";
import { TopElementsCard } from "@/components/admin/analytics/TopElementsCard";
import { fetchInteractions } from "@/lib/adminAnalyticsApi";
import {
  aggregateElementClicks,
  type Interaction,
} from "@/lib/interactionStats";
import type { AnalyticsUserOpt } from "./page";

interface Props {
  users: AnalyticsUserOpt[];
}

export function AnalyticsClient({ users }: Props) {
  const [selectedUser, setSelectedUser] = useState<string | undefined>(undefined);
  const [selectedPage, setSelectedPage] = useState<string>("/login");
  const [interactions, setInteractions] = useState<Interaction[]>([]);

  // Fetch interactions based on filters
  useEffect(() => {
    let active = true;
    async function loadData() {
      try {
        const list = await fetchInteractions(selectedUser, selectedPage);
        if (active) {
          setInteractions(list);
        }
      } catch (err) {
        console.error("Failed to load interactions:", err);
      }
    }
    void loadData();
    return () => {
      active = false;
    };
  }, [selectedUser, selectedPage]);

  const stats = useMemo(
    () => aggregateElementClicks(interactions),
    [interactions],
  );

  return (
    <Row gutter={[24, 24]}>
      <Col span={24}>
        <FiltersCard
          users={users}
          selectedUser={selectedUser}
          selectedPage={selectedPage}
          total={stats.total}
          onUserChange={setSelectedUser}
          onPageChange={setSelectedPage}
        />
      </Col>

      <Col xs={24} md={10} lg={9} xl={8} style={{ display: "flex", justifyContent: "center" }}>
        <PhoneHeatmapPreview pagePath={selectedPage} interactions={interactions} />
      </Col>

      <Col xs={24} md={14} lg={15} xl={16}>
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <TopElementsCard stats={stats} />
          </Col>
          <Col span={24}>
            <HeatmapGuideCard />
          </Col>
        </Row>
      </Col>
    </Row>
  );
}
