-- Update tech_issue title and short description in the database
update feedbackgb.categories 
set title = 'Заявка на ремонт', 
    short = 'Зламалось обладнання / потрібен ремонт' 
where id = 'tech_issue';

-- Insert consumables_request category
insert into feedbackgb.categories (id, emoji, title, short, sort_order) 
values ('consumables_request', '📋', 'Заявка на розхідні матеріали', 'Чекова стрічка, пакети, хімія', 9)
on conflict (id) do update set
  emoji = excluded.emoji,
  title = excluded.title,
  short = excluded.short,
  sort_order = excluded.sort_order;
