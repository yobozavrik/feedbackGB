# Фудкост: колонка «Дані з постачання» для продукту 121

## Контракт

- Пілот — **Пельмені зі свинини** (`product_id=121`), сторінка `/admin/technologist/food-cost`.
- Період — останні **30 календарних дат Europe/Kyiv включно з поточною**; зріз охоплює накладні, наявні в Poster **на час запуску синхронізації**, а не всі майбутні накладні поточного дня.
- Обсяг — усі активні (`delete != 1`) документи `storage.getSupplies` усієї мережі, незалежно від складу. Для кожного документа викликається `storage.getSupplyIngredients`.
- Ціна інгредієнта: `sum(supply_ingredient_sum) / sum(supply_ingredient_num)` за однаковим `ingredient_id` і `ingredient_unit`. Чисельник — мінорні грошові одиниці Poster; знаменник — кількість. Це **середньозважена закупівельна ціна накладних**, не поточна собівартість залишку.
- Кількість у техкарті: `g → kg`, `ml → l`, `p → p`. Несумісні одиниці не перетворюються.
- Напівфабрикат розкладається на складові `menu.getPrepack`; їхню суму множимо на `brutto / out`. Одиниця `out` у відповіді API не названа, тому перерахунок дозволено лише коли співвідношення підтверджується ціною рядка техкарти Poster (похибка ≤ 2 мінорні одиниці). Вкладений напівфабрикат у пілоті не підтримується.
- Якщо немає ціни хоч одного компонента або немає повного знімка, **загальний підсумок не показуємо**. Нуль не підставляємо.
- Колонки «За техкартою Poster» і «Дані з постачання» — незалежні методики; друга не замінює показник `product.cost` Poster і не є фактичним фудкостом продажів.

## Джерела та зберігання

| Призначення | Джерело |
|---|---|
| Продукт, техкарта, ціни магазинів | Poster live: `menu.getProduct`, `access.getSpots`, `settings.getAllSettings` |
| Склад напівфабрикату | Poster live: `menu.getPrepack` |
| Заголовки накладних | Poster live: `storage.getSupplies` за `dateFrom/dateTo` |
| Рядки накладних | Poster live: `storage.getSupplyIngredients` для кожного `supply_id` |
| Стан синхронізації та агрегати | `feedbackgb.poster_supply_cost_runs`, `feedbackgb.poster_supply_cost_documents`, `feedbackgb.poster_supply_cost_averages` |

Міграція: [`036_poster_supply_cost_snapshots.sql`](../supabase/036_poster_supply_cost_snapshots.sql). Таблиці у `feedbackgb`, з увімкненим RLS і доступом лише `service_role`. У `public` об'єктів немає. Cron-маршрут захищений `CRON_SECRET`; Preview не записує у спільну з Production БД.

## Запуск і перевірка поетапно

1. Застосувати 036 **спочатку на staging**. Перевірити наявність усіх трьох таблиць у `feedbackgb`, RLS та права `service_role`; перевірити відсутність нових об'єктів у `public`. Поки цього немає, UI чесно показує «міграцію 036 ще не застосовано».
2. Перевірити чинний `CRON_SECRET`, `POSTER_TOKEN`, Supabase service role **без виведення значень**. Після deploy у Production Cron викликає `/api/cron/poster-supply-cost` двічі на добу (03:00 і 05:00 UTC). Preview пропускає синхронізацію.
3. Після першого запуску прочитати стан:

```sql
select window_start, window_end, status, expected_supplies, seeded_at, completed_at
from feedbackgb.poster_supply_cost_runs order by started_at desc limit 3;

select r.window_start, r.window_end,
       count(d.*) as documents,
       count(*) filter (where d.supply_id is not null and d.lines is null) as missing_details,
       count(*) filter (where d.supply_id is not null and d.attempts >= 3 and d.lines is null) as exhausted_retries
from feedbackgb.poster_supply_cost_runs r
left join feedbackgb.poster_supply_cost_documents d on d.run_id = r.id
group by r.id order by r.window_end desc limit 3;
```

4. Тільки якщо `status='completed'`, звірити кількість документів із `expected_supplies`, `missing_details=0`, кількість рядків у `poster_supply_cost_averages`, вручну перепорахувати один `ingredient_id` з JSON накладних за формулою вище.
5. Авторизований E2E: відкрити сторінку, перевірити часові межі та час знімка, рядки, відсутність підсумку при нестачі цін, світлу/темну тему та мобільний екран. Зіставити Poster-колонку з live API окремо від колонки накладних.

## Відомі межі і відкат

- Код і локальні тести **не доводять**, що повний збір сотень рядків Poster завершиться за час Vercel; це перевіряється після міграції на staging. Незавершений знімок не відображається як готовий. Після трьох невдалих спроб для одного документа потрібна діагностика цього документа та повторний запуск/скидання спроб; автоматичного обходу битих даних немає.
- Дані з накладних не включають інвентаризації, списання, рухи складу, продажі або поточний залишок; тому вони можуть відрізнятися від `product.cost` Poster.
- Відкат коду: прибрати колонку/cron, залишивши таблиці безпечними для читання. Відкат таблиць можливий лише після експорту потрібних історичних знімків; `DROP` видалить їх без відновлення.
