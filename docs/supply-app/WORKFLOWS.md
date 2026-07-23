# Supply workflows

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> submitted
  submitted --> accepted
  submitted --> rejected
  accepted --> processing
  processing --> fulfilled
  submitted --> cancelled
  accepted --> cancelled
```

The preceding state flow is for raw-material orders.

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> submitted
  submitted --> checking
  checking --> approved
  checking --> rejected
  approved --> posted_to_crm
```

The second flow is for raw-material defects and incoming documents. A server
use case writes status history, business audit and outbox event atomically.
