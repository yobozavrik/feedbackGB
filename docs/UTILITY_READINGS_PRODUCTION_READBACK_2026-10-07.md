# «Надати показники»: read-only перевірка production-схеми

**Дата:** 07.10.2026. **Середовище:** production за підтвердженням власника проєкту. **Застосування міграції:** власник повідомив, що `056_utility_readings.sql` завершилася в Supabase SQL Editor відповіддю «Success. No rows returned». Виконавець міграцію не запускав.

## Джерело і межі

Після повідомлення власника виконано лише `SELECT` через підключений Supabase connector. Запити повторюють `feedback-admin/supabase/056_utility_readings_readback.sql` окремими одноструктурними викликами; додатково перевірені прямі права на таблиці, режим функцій і політики RLS. Connector не показує ідентифікатор Supabase-проєкту, тому належність підключення саме до названого production-середовища спирається на підтвердження власника та наявність нових об'єктів у підключеній БД.

| Перевірка | Результат readback |
|---|---|
| Таблиці `feedbackgb.utility_%` | Рівно 6: `utility_periods`, `utility_submissions`, `utility_uploads`, `utility_photos`, `utility_delivery_jobs`, `utility_events`. |
| RLS | У всіх 6 таблиць `relrowsecurity = true`; окремих політик для цих таблиць немає. |
| Прямі права на таблиці | `anon` і `authenticated`: `SELECT=false`, `INSERT=false` для всіх 6; `service_role`: `SELECT=true`. |
| RPC | Рівно 4 очікувані функції: `ensure_current_utility_period`, `submit_utility_photos`, `review_utility_submission`, `claim_utility_delivery_job`. `EXECUTE`: `service_role=true`, `anon=false`, `authenticated=false` для кожної. Усі мають `security_definer=false` і `search_path=feedbackgb, public, pg_catalog`. |
| Storage bucket | `utility-reading-photos`: `public=false`, ліміт 2 097 152 байт, дозволені JPEG/PNG/WebP. |
| Дані на момент перевірки | `utility_periods=0`, `utility_submissions=0`, `utility_delivery_jobs=0`. Поточного періоду ще немає: він створюється тільки при першому виклику `ensure_current_utility_period()`. |

**Висновок:** очікувані об'єкти, базові права та приватність bucket підтверджені в підключеній БД. Це перевірка структури, а не наскрізний тест. RPC не викликали, пробні подання/фото не створювали, Telegram не надсилали. Не перевірені прямий доступ до Storage як `anon/authenticated`, поведінка RPC з реальними ролями, пристрої, cron і фактична доставка в окремий чат. Feature flags не вмикали.

**Наступний gate:** окремо пройти staging-тести маршруту та негативні сценарії, визначити Telegram chat ID і правило виправлення після deadline. Production-міграцію повторно не запускати: `CREATE TABLE` у файлі не є ідемпотентним.
