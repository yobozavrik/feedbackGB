# ADR 0003: outbox and CRM audit gate

Local document, status history, business audit and outbox event are atomic.
CRM adapters are blocked until a read-only live audit documents the actual
source of truth, write interface, external ID and idempotency guarantees.
