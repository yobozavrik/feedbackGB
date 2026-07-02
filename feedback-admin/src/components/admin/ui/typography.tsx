"use client";

import { Typography } from "antd";
import type { ReactNode } from "react";

const { Text, Paragraph } = Typography;

// Admin typography primitives. These own the recurring micro-typography
// that used to be assembled inline (fontSize/uppercase/secondary) at every
// call site. Use them instead of raw <Text style={{ fontSize: ... }}>.

/** Uppercase 11px micro-heading above a field or block ("Статус", "Обраний товар"). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      type="secondary"
      style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}
    >
      {children}
    </Text>
  );
}

/** Secondary 12px metadata text — timestamps, hints, counters. */
export function MetaText({ children }: { children: ReactNode }) {
  return (
    <Text type="secondary" style={{ fontSize: 12 }}>
      {children}
    </Text>
  );
}

/** Emphasized 13px title of a row/item inside lists and cards. */
export function ItemTitle({ children }: { children: ReactNode }) {
  return (
    <Text strong style={{ fontSize: 13 }}>
      {children}
    </Text>
  );
}

/** Secondary 12px paragraph pinned to the bottom of a card as a footnote. */
export function CardFootnote({ children }: { children: ReactNode }) {
  return (
    <Paragraph
      type="secondary"
      style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
    >
      {children}
    </Paragraph>
  );
}
