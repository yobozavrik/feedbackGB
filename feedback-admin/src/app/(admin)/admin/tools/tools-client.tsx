"use client";

import { Col, Row } from "antd";
import { ExportCard } from "@/components/admin/tools/ExportCard";
import { MirrorTool } from "@/components/admin/tools/MirrorTool";
import { ReportTool } from "@/components/admin/tools/ReportTool";

export function ToolsClient() {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={12}>
        <ReportTool />
      </Col>
      <Col xs={24} md={12}>
        <MirrorTool />
      </Col>
      <Col xs={24}>
        <ExportCard />
      </Col>
    </Row>
  );
}
