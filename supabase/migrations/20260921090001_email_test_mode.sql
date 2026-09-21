-- 100UP CRM — record where a redirected test email actually went.
--
-- Fred started testing the live app on 2026-09-20, and the email capability
-- is being built out while he does. That creates a window in which a wrong
-- click could send a real email to a real customer, supplier or installer.
--
-- The fix is NOT another email column on `customers`. Two addresses with
-- swapped meanings ("the real field holds the test address") is a trap:
-- nobody remembers which is which a month later, Fred and Vanessa would be
-- looking at different data models, and it does not actually prevent a send —
-- any code path that reads the real column still sends for real.
--
-- Instead, intercept at the single point every email already passes through:
-- the `send-email` Edge Function. Customer data stays true, Fred sees the
-- real address where the address belongs, and no UI path can bypass the
-- redirect because it is enforced server-side.
--
-- `email_sends.to_address` / `cc_address` keep recording the INTENDED
-- recipients — that is what needs verifying. `redirected_to` records where
-- the message was actually delivered while test mode was on. Empty means it
-- went where it says it went.
--
-- Test mode itself lives in `integrations.config` for provider 'email'
-- (`test_mode`, `test_redirect_to`), so it needs no schema of its own and is
-- already admin-only and service-role-readable.
--
-- FAIL-SAFE BY DEFAULT: the function treats anything other than an explicit
-- `test_mode: false` as test mode ON. An absent or half-written config
-- redirects rather than sends. Turning real sending on is a deliberate act at
-- cutover, not something that happens by forgetting.

alter table public.email_sends
  add column redirected_to text not null default '';

comment on column public.email_sends.redirected_to is
  'Where this email was actually delivered when test mode rewrote the recipients. Empty means it went to to_address/cc_address as recorded. Set by the send-email Edge Function.';

-- Existing rows predate test mode. They were real sends (the Settings test
-- button, to whatever address was typed), so the default of '' is correct
-- for them and no backfill is needed.
