# Важно: объединение security и графиков работы

**Дата фиксации:** 2026-09-22.  
**Не удалять этот документ до завершения интеграции.**

## Контекст

Разработка ведётся в двух независимых ветках с общим базовым коммитом:

```text
11dad1d  feat(admin): add 14-day photo report period and project docs
├── security/remediation       # исправления безопасности
└── design/app-cosmetic-refresh # графики, DnD и контроль фотозвитов
```

## Важный дублирующий коммит

Во время работы активная ветка была неожиданно переключена на `security/remediation`. Поэтому коммит графиков сначала был создан там:

```text
0abace3  feat(admin): add schedule photo control and accessible drag drop
```

Он был затем корректно перенесён в целевую ветку графиков через cherry-pick:

```text
1c3cd0b  feat(admin): add schedule photo control and accessible drag drop
           branch: design/app-cosmetic-refresh
```

Это одинаковое содержимое с разными SHA. Если без подготовки выполнить merge двух веток, Git не обязан распознать их как один коммит: возможны конфликты или повторное применение изменения.

## Обязательный безопасный порядок

1. Ничего не force-push и не удалять на обеих исходных ветках.
2. Перед интеграцией прочитать актуальный `git log --graph --oneline --decorate --all` и убедиться, что SHA не изменились.
3. Создать отдельную integration-ветку от согласованной базы/production ref.
4. Внести security-изменения, **исключив дублирующий `0abace3`** из security-линии. Способ выбирается только после просмотра актуальной истории:
   - безопасный вариант — новая clean security-ветка без `0abace3`;
   - не переписывать опубликованную security-ветку без отдельного подтверждения владельца.
5. Влить `design/app-cosmetic-refresh` с `1c3cd0b` ровно один раз.
6. Выполнить `git diff`, проверить, что в итоге есть все security fixes и один экземпляр DnD/графиков.
7. Запустить typecheck, unit/API-тесты, затем Preview E2E.
8. Отдельно применить и проверить миграции Supabase на staging (`030` → `031` → `032` → `033` → `034`), только после этого рассматривать production.
9. Деплоить admin и seller приложения как отдельные Vercel-гейты; не считать push production-релизом.

## Что проверять при code review

- Security-файлы не откатились и не продублировались.
- В `design/app-cosmetic-refresh` нет второго применения содержимого `0abace3`.
- `feedback-admin/supabase/034_store_schedule_photo_report_control.sql` присутствует один раз и не применён автоматически кодом.
- Новая DnD-библиотека присутствует в `feedback-admin/package.json` и lockfile.
- Локальная `feedback-admin/.playwright-cli/` не включена в Git.

## Запрещено без отдельного согласования

- `git reset --hard`, force-push или удаление любой из двух веток;
- применение `034` сразу в production;
- объявлять факт фотозвита фактической явкой или зарплатным временем.
