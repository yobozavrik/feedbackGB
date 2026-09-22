# Staging readback: HR-заявки та графік відсутностей (035)

Статус: виконувати лише після застосування `035_hr_absence_request_linking.sql` у staging. Production не є заміною staging.

## 1. Readback схеми

```sql
select to_regclass('feedbackgb.v_hr_absence_requests') as requests_view;
select to_regprocedure('feedbackgb.approve_hr_absence_request(uuid,uuid,text,date)') as approve_function;
select to_regprocedure('feedbackgb.review_hr_absence_request(uuid,uuid,text)') as review_function;
select to_regprocedure('feedbackgb.reject_hr_absence_request(uuid,uuid,text)') as reject_function;
select column_name, data_type from information_schema.columns where table_schema = 'feedbackgb' and table_name = 'employee_absences' and column_name = 'source_feedback_id';
```

Очікується: view і три функції існують; `source_feedback_id` має тип `uuid`.

## 2. Контроль даних

```sql
select hr_topic, count(*) from feedbackgb.v_hr_absence_requests group by hr_topic order by hr_topic;
select count(*) as resignation_rows from feedbackgb.v_hr_absence_requests where hr_topic = 'resignation';
select source_feedback_id, count(*) from feedbackgb.employee_absences where source_feedback_id is not null group by source_feedback_id having count(*) > 1;
```

Очікується: `resignation_rows = 0`; останній запит не повертає рядків.

## 3. Обов'язковий E2E-набір

1. Відпустка: створити продавцем, взяти в роботу, погодити; створюється рівно одна активна відсутність з тим самим `source_feedback_id`.
2. Відкритий лікарняний (є дата початку, немає кінцевої) з'являється у Kanban поточного і наступного місяця, доки має статус `new` або `in_progress`; не погоджується без дати в модальному вікні.
3. Відхилення без причини заблоковане; причина відображається продавцю в коментарях заявки.
4. Дві вкладки погоджують одну заявку: успішна рівно одна операція, друга отримує конфлікт.
5. Переведення не створює `employee_absences`.
6. Нова зміна в локальну дату активної відсутності повертає `422 schedule_employee_absent`.
7. Скасування відсутності потребує причину та разом заповнює `cancelled_by`, `cancelled_at`, `cancel_reason`.
8. У Kanban не потрапляє звільнення; фото HR-заявки відкривається лише через захищений endpoint адміністратора.

## 4. Межа

Це readback-документ, не міграція. Він нічого не змінює у базі.
