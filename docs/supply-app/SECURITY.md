# Supply App security

- Only `admin` and `super_admin` may access `feedback-admin`.
- Only `super_admin` manages supply users, PINs, app access and memberships.
- Supply login is app-scoped. Seller cookies are not accepted by Supply App.
- PIN remains exactly six digits to preserve the current FeedbackGB contract.
- Supply sessions use `HttpOnly`, `Secure`, `SameSite=Lax` cookies, a separate
  signing secret and an 8–12 hour TTL.
- Login is IP-rate-limited and errors do not reveal user/access existence.
- Storage is private, MIME/size restricted and served by short-lived signed
  URLs after authorization.
- Logs and telemetry exclude PINs, cookies, secrets, document content, full
  names, attachment content and raw webhook payloads.
