"use client";

import {
  CalendarOutlined,
  CommentOutlined,
  SendOutlined,
  ShopOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Drawer,
  Image,
  Input,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  addFeedbackComment,
  fetchFeedbackComments,
  patchFeedback,
  type FeedbackComment,
  type FeedbackPatch,
} from "@/lib/adminFeedbackApi";
import { authorOf, formatRelative, TINT_COLOR, type CategoryMeta } from "@/lib/feedFormat";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_META,
  isFeedbackStatus,
  type FeedbackStatus,
} from "@/lib/feedbackStatus";
import type { AdminOption, FeedRow } from "@/app/(admin)/admin/page";

const { Text, Paragraph, Title } = Typography;
const { TextArea } = Input;

interface Props {
  row: FeedRow | null;
  category: CategoryMeta | null;
  admins: AdminOption[];
  currentAdminId: string | null;
  onClose: () => void;
}

export function FeedDrawer({
  row,
  category,
  admins,
  currentAdminId,
  onClose,
}: Props) {
  const { token } = antdTheme.useToken();
  const { message } = App.useApp();
  const router = useRouter();

  // Драфт-стан керується ключем по id, щоб при перемиканні рядка все
  // скинулось без явних effect-ів.
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<FeedbackStatus>("new");
  const [draftAssignee, setDraftAssignee] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  if (row && row.id !== draftKey) {
    setDraftKey(row.id);
    setDraftStatus(isFeedbackStatus(row.status) ? row.status : "new");
    setDraftAssignee(row.assigned_to);
    setComment("");
  } else if (!row && draftKey !== null) {
    // Скидаємо draftKey при закритті — щоб повторне відкриття того ж рядка
    // підхопило свіжі серверні значення (а не залишилось зі stale draft-ом).
    setDraftKey(null);
  }

  const [commentsList, setCommentsList] = useState<FeedbackComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  const fetchComments = useCallback(async (feedbackId: string) => {
    setLoadingComments(true);
    try {
      const comments = await fetchFeedbackComments(feedbackId);
      if (comments) {
        setCommentsList(comments);
      }
    } catch (e) {
      console.error("Failed to load comments", e);
    } finally {
      setLoadingComments(false);
    }
  }, []);

  useEffect(() => {
    if (row?.id) {
      fetchComments(row.id);
    } else {
      setCommentsList([]);
    }
  }, [row?.id, fetchComments]);

  const handleAddComment = useCallback(async () => {
    if (!row || !newCommentText.trim()) return;
    setSubmittingComment(true);
    try {
      const result = await addFeedbackComment(row.id, newCommentText);
      if (!result.ok) {
        message.error(result.error ?? "Не вдалося додати коментар");
        return;
      }
      message.success("Коментар додано");
      setNewCommentText("");
      fetchComments(row.id);
    } catch (e) {
      message.error("Помилка мережі");
    } finally {
      setSubmittingComment(false);
    }
  }, [row, newCommentText, fetchComments, message]);

  const handleSave = useCallback(async () => {
    if (!row) return;
    const body: FeedbackPatch = {};
    if (draftStatus !== row.status) body.status = draftStatus;
    if (draftAssignee !== row.assigned_to) body.assigned_to = draftAssignee;
    const trimmed = comment.trim();
    if (trimmed.length > 0) body.comment = trimmed;
    if (Object.keys(body).length === 0) {
      message.info("Немає змін для збереження.");
      return;
    }
    setSaving(true);
    try {
      const result = await patchFeedback(row.id, body);
      if (!result.ok) {
        message.error(result.error ?? `Помилка ${result.status}`);
        return;
      }
      message.success("Збережено");
      setComment("");
      router.refresh();
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Помилка мережі");
    } finally {
      setSaving(false);
    }
  }, [row, draftStatus, draftAssignee, comment, message, router, onClose]);

  if (!row) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const fieldEntries = row.fields ? Object.entries(row.fields) : [];
  const meta = isFeedbackStatus(row.status)
    ? FEEDBACK_STATUS_META[row.status]
    : { text: row.status, color: "default" };
  const tintColor = category ? TINT_COLOR[category.tint] ?? "default" : "default";

  const adminOptions = admins.map((a) => ({
    label: a.id === currentAdminId ? `${a.full_name} (я)` : a.full_name,
    value: a.id,
  }));

  const dirty =
    draftStatus !== row.status ||
    draftAssignee !== row.assigned_to ||
    comment.trim().length > 0;

  return (
    <Drawer
      className="admin-feed-drawer"
      open
      onClose={onClose}
      width={520}
      title={
        <Space size={8} wrap>
          <Tag color={tintColor} bordered={false}>
            <span aria-hidden style={{ marginInlineEnd: 4 }}>
              {row.category_emoji ?? category?.emoji ?? "📝"}
            </span>
            {row.category_title ?? category?.title ?? row.category}
          </Tag>
          <Tag color={meta.color} bordered={false}>
            {meta.text}
          </Tag>
        </Space>
      }
      extra={
        <Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(row.created_at).toLocaleString("uk-UA")}
        </Text>
      }
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Space size={12} wrap>
          {row.store_name ? (
            <Space size={4}>
              <ShopOutlined style={{ color: token.colorPrimary }} />
              <Text>{row.store_name}</Text>
            </Space>
          ) : null}
          <Space size={4}>
            <UserOutlined style={{ color: token.colorPrimary }} />
            <Text>{authorOf(row)}</Text>
            {row.user_role === "admin" ? (
              <Tag color="magenta" bordered={false}>
                адмін
              </Tag>
            ) : null}
          </Space>
          <Space size={4}>
            <CalendarOutlined style={{ color: token.colorPrimary }} />
            <Text type="secondary">{formatRelative(row.created_at)}</Text>
          </Space>
        </Space>

        {row.product_name ? (
          <div
            style={{
              background: token.colorInfoBg,
              border: `1px solid ${token.colorInfoBorder}`,
              borderRadius: token.borderRadiusLG,
              padding: "8px 12px",
            }}
          >
            <Text
              type="secondary"
              style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}
            >
              Обраний товар
            </Text>
            <div style={{ marginTop: 2 }}>
              <Text strong style={{ fontSize: 14 }}>
                {row.product_name}
              </Text>
              {row.product_unit ? (
                <Text type="secondary" style={{ marginLeft: 6, fontSize: 13 }}>
                  ({row.product_unit})
                </Text>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* === КЕРУВАННЯ === */}
        <div
          style={{
            background: token.colorFillAlter,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
            padding: 12,
          }}
        >
          <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
            Управління
          </Title>
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <div>
              <Text
                type="secondary"
                style={{ fontSize: 11, textTransform: "uppercase" }}
              >
                Статус
              </Text>
              <div style={{ marginTop: 4 }}>
                <Segmented<FeedbackStatus>
                  value={draftStatus}
                  onChange={(v) => setDraftStatus(v as FeedbackStatus)}
                  options={FEEDBACK_STATUSES.map((s) => ({
                    label: FEEDBACK_STATUS_META[s].text,
                    value: s,
                  }))}
                />
              </div>
            </div>
            <div>
              <Text
                type="secondary"
                style={{ fontSize: 11, textTransform: "uppercase" }}
              >
                Призначено
              </Text>
              <div style={{ marginTop: 4 }}>
                <Space size={6} wrap>
                  <Select
                    style={{ minWidth: 220 }}
                    placeholder="— не призначено"
                    value={draftAssignee ?? undefined}
                    onChange={(v) => setDraftAssignee(v ?? null)}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={adminOptions}
                  />
                  {currentAdminId && draftAssignee !== currentAdminId ? (
                    <Button
                      size="small"
                      onClick={() => setDraftAssignee(currentAdminId)}
                    >
                      На себе
                    </Button>
                  ) : null}
                </Space>
              </div>
            </div>
            <div>
              <Text
                type="secondary"
                style={{ fontSize: 11, textTransform: "uppercase" }}
              >
                Коментар (опціонально)
              </Text>
              <TextArea
                style={{ marginTop: 4 }}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Що зробив / куди передав / коли очікувати… Запис потрапить у Журнал."
                maxLength={500}
                showCount
                autoSize={{ minRows: 2, maxRows: 4 }}
              />
            </div>
            <Space>
              <Button
                type="primary"
                onClick={handleSave}
                loading={saving}
                disabled={!dirty}
              >
                Зберегти
              </Button>
              {dirty ? (
                <Button
                  onClick={() => {
                    setDraftStatus(isFeedbackStatus(row.status) ? row.status : "new");
                    setDraftAssignee(row.assigned_to);
                    setComment("");
                  }}
                  disabled={saving}
                >
                  Скинути
                </Button>
              ) : null}
            </Space>
          </Space>
        </div>

        {fieldEntries.length > 0 ? (
          <div>
            <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
              Деталі
            </Title>
            <dl style={{ margin: 0 }}>
              {fieldEntries.map(([k, v]) =>
                v == null || v === "" ? null : (
                  <div
                    key={k}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      paddingBlock: 6,
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  >
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                      }}
                    >
                      {k}
                    </Text>
                    <Paragraph
                      style={{
                        margin: 0,
                        marginTop: 2,
                        whiteSpace: "pre-wrap",
                        fontSize: 14,
                      }}
                    >
                      {String(v)}
                    </Paragraph>
                  </div>
                ),
              )}
            </dl>
          </div>
        ) : (
          <Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {row.summary}
          </Paragraph>
        )}

        {row.photo_url ? (
          <div>
            <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
              Фото
            </Title>
            <Image
              src={row.photo_url}
              alt="фото фідбеку"
              style={{
                borderRadius: 8,
                maxHeight: 480,
                objectFit: "contain",
              }}
            />
          </div>
        ) : null}

        {row.tg_username || row.tg_display_name ? (
          <div>
            <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
              Telegram
            </Title>
            <Space size={4} wrap>
              {row.tg_username ? (
                <Tag bordered={false}>@{row.tg_username}</Tag>
              ) : null}
              {row.tg_display_name &&
              row.tg_display_name !== row.user_full_name ? (
                <Tag bordered={false}>{row.tg_display_name}</Tag>
              ) : null}
              {row.tg_verified ? (
                <Tag color="green" bordered={false}>
                  verified
                </Tag>
              ) : null}
            </Space>
          </div>
        ) : null}

        {/* === ОБГОВОРЕННЯ (КОМЕНТАРІ) === */}
        <div
          style={{
            marginTop: 8,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            paddingTop: 16,
          }}
        >
          <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
            <CommentOutlined style={{ marginRight: 6 }} /> Обговорення
          </Title>

          {/* Comments List */}
          <div
            style={{
              maxHeight: 300,
              overflowY: "auto",
              marginBottom: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {loadingComments ? (
              <Text type="secondary" style={{ fontSize: 13 }}>Завантаження коментарів...</Text>
            ) : commentsList.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 13, fontStyle: "italic" }}>
                Коментарів ще немає. Ви можете написати повідомлення продавчині.
              </Text>
            ) : (
              commentsList.map((c) => {
                const isAdmin = c.author_role === "admin" || c.author_role === "super_admin";
                return (
                  <div
                    key={c.id}
                    style={{
                      background: isAdmin ? token.colorFillAlter : "transparent",
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadius,
                      padding: "8px 12px",
                      maxWidth: "90%",
                      alignSelf: isAdmin ? "flex-start" : "flex-end",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
                      <Space size={4}>
                        <Text strong style={{ fontSize: 12 }}>{c.author_name}</Text>
                        <Tag
                          color={c.author_role === "super_admin" ? "red" : c.author_role === "admin" ? "magenta" : "default"}
                          bordered={false}
                          style={{ fontSize: 10, lineHeight: "14px", height: "16px", paddingInline: 4 }}
                        >
                          {c.author_role === "super_admin" ? "супер-адмін" : c.author_role === "admin" ? "адмін" : "продавець"}
                        </Tag>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {formatRelative(c.created_at)}
                      </Text>
                    </div>
                    <Paragraph style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>
                      {c.body}
                    </Paragraph>
                  </div>
                );
              })
            )}
          </div>

          {/* New Comment Form */}
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              placeholder="Написати повідомлення продавчині..."
              onPressEnter={handleAddComment}
              disabled={submittingComment}
              maxLength={2000}
            />
            <Button
              type="primary"
              onClick={handleAddComment}
              loading={submittingComment}
              disabled={!newCommentText.trim()}
              icon={<SendOutlined />}
            />
          </Space.Compact>
        </div>
      </Space>
    </Drawer>
  );
}
