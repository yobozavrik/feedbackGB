# ADR 0001: one app, two channels

Supply App is one mobile-first application that works in a normal browser and
as a Telegram Mini App. PIN plus app access is the authentication authority.
Telegram initData is optional, server-validated metadata and never replaces
PIN authentication.
