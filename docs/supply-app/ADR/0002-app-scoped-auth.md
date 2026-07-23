# ADR 0002: app-scoped authentication

The existing global PIN verifier cannot by itself grant Supply access. Supply
uses an app-scoped verification path plus `user_app_access` and active
facility membership. It issues a separate `supply_session` cookie and signing
secret.
