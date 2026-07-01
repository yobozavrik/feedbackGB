# Tech Debt: Gamification And Bonus System

## Status

Draft plan. No implementation yet.

This document describes the target model for gamification and bonuses in the feedback web app and admin panel.

## Core Decision

Bonuses must belong to a specific employee, not to a store.

The store is only context for reporting, filtering, and anti-duplicate checks. The main owner of points is the seller/user who logged in with their own unique PIN.

## User Model

Each seller must be a separate user record:

- `id`
- `full_name`
- `display_label`
- `role = seller`
- `store_id`
- `pin_hash`
- `pin_set_at`
- `pin_last_used_at`
- `failed_attempts`
- `locked_until`
- `is_active`

PIN must be globally unique because the seller enters only the PIN during login. If two employees share a PIN, the app cannot safely identify the user.

Never store PIN values in plaintext.

## Feedback Ownership

Every feedback row must keep both:

- `user_id` - the employee who submitted the feedback.
- `store_id` - the store attached to that employee at submission time.

Bonus ownership must be based on `user_id`.

Example:

- Store: `Heroiv Pratsi`
- Seller A submits a defect: Seller A receives the bonus.
- Seller B submits customer voice from the same store: Seller B receives the bonus.
- Store analytics can aggregate both, but the personal bonus remains separate.

## Bonus Categories

The first version should bonus only high-value signal categories:

- `defect` - product defect.
- `customer_voice` - customer request, complaint, or repeated question.
- `store_idea` - internal idea for improving the store.
- `spotted_elsewhere` - useful observation from another store/place.

Do not bonus these categories in the first version:

- `missing_item`
- `overstock`
- `tech_issue`
- `consumables_request`
- `supply_problem`

They can still count as activity, but should not generate money-like bonuses at MVP stage because they are easier to spam or are operational requests rather than improvement signals.

## Points Rules

### Product Defect

Base:

- Product defect submitted: `10 points`.
- Product selected from catalog: `+5 points`.
- Photo attached: `+5 points`.
- Useful details/comment: `+3 points`.

Maximum before manual adjustment: `23 points`.

Rules:

- Full points only for the first meaningful defect signal for the same `store_id + product_id + category + day`.
- Duplicate from the same seller: `0 points`.
- Confirmation from another seller in the same store: `2 points`.
- Admin can override points when the duplicate is actually a separate defect case.

### Customer Voice

Base:

- Customer request, complaint, or frequent question submitted: `8 points`.
- Concrete phrase or clear customer need: `+4 points`.
- Frequency is specified: `+3 points`.

Maximum before manual adjustment: `15 points`.

Rules:

- Generic text like "clients are unhappy" without detail should be rejected.
- Same topic from the same seller on the same day should be treated as duplicate.
- Same topic from different stores is valuable and should stay visible as a trend.

### Store Idea

Base:

- Idea submitted: `10 points`.
- Idea explains what to do and why: `+5 points`.
- Photo, sketch, or example attached: `+5 points`.
- Admin marks idea as useful: `+15 points`.
- Idea is implemented: `+50 points`.

Maximum before implementation: `35 points`.
Maximum after implementation: `85 points`.

Rules:

- Empty ideas like "make it better" should be rejected.
- The idea does not need to be implemented to receive partial points.
- Only admin/manager can mark an idea as implemented.

### Spotted Elsewhere

Base:

- Observation from another store/place submitted: `12 points`.
- Photo attached: `+8 points`.
- Seller explains where it was seen and why it is useful: `+5 points`.
- Admin marks it as useful: `+15 points`.
- Observation is implemented: `+50 points`.

Maximum before implementation: `40 points`.
Maximum after implementation: `90 points`.

Rules:

- Photo is highly recommended because this category is visual.
- If no photo is attached, the text must be clear enough to evaluate.
- Duplicate observations should not receive full points.

## Bonus Lifecycle

Every bonus event must have a status:

- `pending` - created automatically after feedback submission.
- `approved` - reviewed and accepted by admin.
- `rejected` - reviewed and rejected.
- `duplicate` - marked as duplicate.
- `implemented` - extra implementation bonus granted.

Seller can see pending points, but only approved/implemented points count toward payout.

## Proposed Data Model

Create a dedicated table:

```sql
bonus_events (
  id uuid primary key,
  feedback_id uuid not null,
  user_id uuid not null,
  store_id integer,
  category text not null,
  status text not null,
  points_pending integer not null default 0,
  points_approved integer not null default 0,
  reason text,
  duplicate_of uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
)
```

Indexes:

- `(user_id, created_at)`
- `(store_id, created_at)`
- `(status, created_at)`
- `(feedback_id)`
- duplicate detection helper index for `category + store_id + created_at`.

## Anti-Fraud Rules

Required:

- Detect duplicates by `category + store_id + product_id + day`.
- Detect duplicate customer voice and ideas by normalized title/topic per seller per day.
- Cap automatic pending points per seller per day, for example `150`.
- Anything above the cap requires admin approval.
- Catalog-selected product earns more than manual product name.
- Photo increases score but must not be the only quality criterion.
- Admin can manually edit points with reason.

## Seller Web App

Add a `My Bonuses` section.

Show:

- points today;
- points this month;
- approved points;
- pending points;
- rejected points;
- current monthly rank;
- latest bonus events.

Example:

```text
My Bonuses

This month: 420 points
Approved: 340
Pending: 80

You are #3 this month

Recent:
+20 Product defect - approved
+12 Spotted elsewhere - pending
+50 Idea implemented - approved
```

Do not show negative rankings or "worst sellers".

## Admin Panel

Add a `Bonuses` section.

Filters:

- period;
- seller;
- store;
- category;
- status;
- pending only.

Actions:

- approve bonus;
- reject bonus;
- mark as duplicate;
- mark idea/observation as implemented;
- edit points manually;
- leave review comment.

Admin views:

- pending review queue;
- seller leaderboard;
- store leaderboard;
- category breakdown;
- implemented ideas list.

## Reporting

Daily report should include:

- new pending bonus points;
- approved bonus points;
- top sellers by approved points;
- top stores by approved points;
- best new ideas;
- repeated defect signals.

Monthly report should include:

- final approved points per seller;
- payout candidate amount;
- rejected/duplicate rate;
- top implemented ideas.

## Money Conversion

Do not hardwire payout on day one.

Recommended rollout:

1. Month 1: collect points only, no payout.
2. Review volume, duplicates, abuse patterns.
3. Decide conversion rate.

Possible starting conversion:

- `1 point = 1 UAH`.
- automatic monthly cap: `1000 UAH` per seller.
- above cap requires manager approval.

Alternative:

- points do not convert directly into money;
- monthly top sellers receive fixed prizes.

## MVP Scope

Phase 1:

- create `bonus_events`;
- auto-create pending bonus event on feedback submission;
- support four bonus categories: defect, customer voice, store idea, spotted elsewhere;
- admin can approve/reject/mark duplicate;
- seller can see personal monthly bonus summary.

Phase 2:

- leaderboards;
- implemented idea bonus;
- daily/monthly bonus reports;
- stronger duplicate detection.

Phase 3:

- payout export;
- admin-adjustable rules;
- per-store and per-role caps;
- analytics on quality and abuse.

## Open Questions

- Should points convert to money directly or only drive monthly prizes?
- What is the monthly payout cap per seller?
- Who is allowed to approve/reject bonuses: admin or only super_admin?
- Should store managers see only their own store's bonus data?
- Should sellers see the full leaderboard or only their own rank and nearby positions?

## Implementation Notes

- Keep bonus logic server-side only.
- Do not trust client-submitted point values.
- Bonus calculation should be deterministic and auditable.
- Store all manual admin changes in audit log.
- Keep store ranking secondary; personal seller ranking is the core motivation.
