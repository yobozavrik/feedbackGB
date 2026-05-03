-- 008_login_geoip.sql
-- Enrich user logins with location data resolved from the client IP via
-- ipinfo.io. Drives the location columns in /admin/users and the new
-- "Звідки" column (city + ISP + flag) in /admin/audit.
--
-- Backwards compatible: all new columns are nullable. Existing logins
-- that predate the rollout simply leave the columns NULL and the UI
-- falls back to "—".
--
-- VPN / proxy / Tor / datacenter classification is OUT of scope for this
-- migration — adding it requires a second provider (ipqualityscore,
-- ipapi.is, ipinfo Privacy paid plan, …). When that lands, follow up
-- with `009_login_proxy_flags.sql` adding `last_login_is_proxy boolean`.

set search_path = feedbackgb, public;

alter table feedbackgb.users
  add column if not exists last_login_country text,
  add column if not exists last_login_city    text,
  add column if not exists last_login_asn     text,
  add column if not exists last_login_isp     text;

comment on column feedbackgb.users.last_login_country is 'ISO 3166-1 alpha-2 country code from the most recent successful login (ipinfo.io).';
comment on column feedbackgb.users.last_login_city    is 'City name (best effort, mobile NAT often resolves to capital).';
comment on column feedbackgb.users.last_login_asn     is 'Autonomous System number, e.g. "AS15895".';
comment on column feedbackgb.users.last_login_isp     is 'ISP / org as reported by ipinfo.io.';

-- audit_log.meta JSON shape (informational — JSON column, no schema
-- enforcement, but documenting the structure for readers):
--
--   meta: {
--     ...existing fields,
--     geoip: {
--       country: text,    -- ISO-2
--       city:    text,
--       asn:     text,
--       isp:     text
--     }
--   }
