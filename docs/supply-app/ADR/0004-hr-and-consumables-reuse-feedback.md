# ADR 0004: границы bridge для HR, расходников и сырья

## Статус

Принято 2026-07-23.

## Решение

- `feedback` разрешено использовать только для переноса существующих HR-потоков
  и `consumables_request` из seller-app.
- Для `consumables_request` Supply bridge повторяет существующий синхронный
  server-to-server контракт `rpc_create_feedbackgb_consumables_order`: CRM
  принимает заявку до записи в журнал FeedbackGB; ключ связи — `feedback_id`.
- Это исключение не распространяется на сырьё. Заказ сырья, брак сырья и
  приходная накладная используют отдельные document tables, status history и
  transactional outbox; прямой CRM-вызов из Supply UI для них запрещён.
- Global `users.role = supply_worker` остаётся coarse app tier. Operational
  role живёт только в `user_facility_memberships.role` и имеет значения
  `supply_worker`, `supply_manager`, `receiver`, `quality_controller`.
- `facilities.kind` ограничен `production | warehouse`. Отдельный
  `supply_employee_profiles` и дублирующее `permission` поле не создаются.

## Последствия

Migration `20260723_001_supply_employees.sql` меняется до первого применения,
поэтому не требуется data migration. Права server use case выводятся из
membership role; facility assignment обязателен для supply_worker.
