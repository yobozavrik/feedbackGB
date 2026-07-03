-- Adds the "Питання по HR" category (shared/lib/categories.ts: hr_question).
-- Required because feedback.category has a FK to feedbackgb.categories(id).
insert into feedbackgb.categories (id, emoji, title, short, sort_order)
values (
  'hr_question',
  '🧑‍💼',
  'Питання по HR',
  'Відпустка, вихідні, лікарняний, звільнення',
  10
)
on conflict (id) do update set
  emoji = excluded.emoji,
  title = excluded.title,
  short = excluded.short,
  sort_order = excluded.sort_order;
