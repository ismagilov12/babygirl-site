# UA checkout repair — release gates

This patch is not yet verified against a live payment or Meta receipt. Do not deploy until these checks are complete.

1. Apply `db/checkout-tracking.sql` with the Supabase migration tool. Verify anon/authenticated have no access, service_role has select/insert/update and RLS is enabled. No production order data should be modified by this schema change.
2. Verify production `FB_PIXEL_ID` is the BabyGirl dataset and `FB_ACCESS_TOKEN` is valid. Confirm a test event is accepted by Meta and the configured Graph API version is supported. Browser Purchase was removed deliberately, so CAPI must work before release. Do not use real customer data for test events.
3. Deploy the same tested commit. Check product events use catalog IDs, e.g. `suit-baby-girl-black`.
4. Run a controlled order with the owner's participation for payment. Confirm order, CRM mirror, private payment snapshot, full order total, correct 200 UAH COD prepayment, paid status and one Purchase with full order value. Check failed/cancelled payments do not produce Purchase. Redeliver the verified callback and verify no second event. Test callbacks in isolation, never forge payments against production.
5. Existing UA orders created before this release have no private snapshot and cannot request a new payment intent through the changed endpoint. An existing WayForPay form can still complete; old callbacks use the legacy order lookup.

Known separate issues: `bg_orders_anon_all` permits public reads and writes. The current admin uses the public key and a client-side gate, so removing this policy alone would break its order screen. Migrate admin authentication and check all CRM consumers before removing the policy; do not describe that access issue as fixed by this patch. The new tracking table grants no public access.

The English storefront uses WesternBid and is outside this UA checkout patch. It needs its own payment/return audit. Historical CRM discrepancies are not rewritten.

Local validation: `node --test tests/checkout.test.cjs` covers save failure, price lookup failure, forged discounts/payment overrides, missing saved orders, callback signatures/amounts, COD value/catalog IDs, duplicate callbacks and Meta retry. These are isolated tests, not evidence of live gateway or Meta acceptance.
