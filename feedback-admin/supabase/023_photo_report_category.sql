-- Adds the category used by the seller Photo Report card. It is a FK target
-- for feedback.category, so this migration must be applied before deploying
-- either UI that can submit / query `photo_report`.
insert into feedbackgb.categories (id, emoji, title, short, sort_order)
values (
  'photo_report',
  '📸',
  'Фото звіт',
  'Надішли до 15 фото магазину',
  11
)
on conflict (id) do update set
  emoji = excluded.emoji,
  title = excluded.title,
  short = excluded.short,
  sort_order = excluded.sort_order;
