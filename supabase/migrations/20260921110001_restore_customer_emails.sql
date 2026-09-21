-- 100UP CRM — put the real customer email addresses back.
--
-- `20260915150001` replaced every customer email with a
-- support+{initials}{id}@brighterwebsites.com.au dummy, because notifications
-- were about to be built and nothing could be allowed to reach a real
-- customer. The originals went to private.customer_email_backup.
--
-- That protection is now in the right place. Since `20260921090001` the
-- send-email Edge Function redirects every recipient while test mode is on,
-- which is enforced server-side and fails safe — an absent or half-written
-- config redirects rather than sends. Scrambling the DATA to prevent a send
-- was always the blunt version of that, and it has a real cost: Fred is
-- testing now, and he sees a fake address where his customer's address
-- should be.
--
-- So the addresses go back and the interception does the protecting.
--
-- ORDER MATTERS, AND IS ENFORCED BELOW RATHER THAN TRUSTED. Restoring real
-- emails while test mode is off would put live addresses behind live send
-- buttons in one step. The guard refuses to run in that case.

do $$
declare cfg jsonb;
begin
  select config into cfg from public.integrations where provider = 'email';

  -- Mirrors the Edge Function's own rule: anything other than an explicit
  -- false means test mode is ON. A missing integrations row is also fine —
  -- nothing can send at all without a key.
  if cfg is not null and cfg ? 'test_mode' and (cfg ->> 'test_mode') = 'false' then
    raise exception
      'Refusing to restore real customer emails: email test mode is OFF, so a send would reach the customer. Turn test mode on in Settings -> Integrations, then re-run this migration.';
  end if;
end $$;

update public.customers c
set email = b.email
from private.customer_email_backup b
where b.customer_id = c.id
  and c.email is distinct from b.email;

-- The backup table stays. It is the record of what was scrubbed and when,
-- it costs nothing, and the API cannot reach it (PostgREST serves `public`
-- only). Dropping it would only lose the audit trail.
--
-- Not covered, deliberately: customers CREATED during testing. They were
-- never scrubbed, so they have no backup row and keep whatever address was
-- typed — which for test records is a dummy, correctly. At cutover the
-- importer reloads customers from the V46 freeze export anyway, so this
-- restore matters for CRM-native records only.
