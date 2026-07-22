-- Structured cart for category=consumables_request.
-- Existing feedback rows and all other categories remain unchanged.

BEGIN;

ALTER TABLE feedbackgb.feedback
  ADD COLUMN IF NOT EXISTS cart_items jsonb;

ALTER TABLE feedbackgb.feedback
  DROP CONSTRAINT IF EXISTS feedback_consumables_cart_check;

ALTER TABLE feedbackgb.feedback
  ADD CONSTRAINT feedback_consumables_cart_check
  CHECK (
    category <> 'consumables_request'
    OR (
      cart_items IS NOT NULL
      AND jsonb_typeof(cart_items) = 'array'
      AND jsonb_array_length(cart_items) > 0
    )
  ) NOT VALID;

COMMENT ON COLUMN feedbackgb.feedback.cart_items IS
  'Structured consumables basket: [{"product_id": integer, "quantity": numeric}].';

COMMIT;
