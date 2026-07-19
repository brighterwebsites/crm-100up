-- 100UP CRM — Phase 1 migration 4/4: allow direct SQL / service-role
-- callers through the RPC permission check.
--
-- The guard trigger already treats auth.uid() IS NULL (SQL editor,
-- service role — never reachable from a browser client) as trusted;
-- the RPC preamble should agree, so admin fix-up scripts and smoke
-- tests can drive stage transitions without a JWT.

create or replace function private.lock_job_for_transition(
  p_job_id bigint,
  p_expected_version integer
) returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs%rowtype;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'job_not_found: job % does not exist', p_job_id;
  end if;

  if not (
    (select auth.uid()) is null  -- direct SQL / service role
    or coalesce((select private.is_admin()), false)
    or j.assigned_installer_id = (select auth.uid())
  ) then
    raise exception 'not_allowed: you do not have access to job %', p_job_id;
  end if;

  if j.version <> p_expected_version then
    raise exception 'version_conflict: job % changed since you loaded it (expected v%, now v%)',
      p_job_id, p_expected_version, j.version
      using errcode = '40001';
  end if;

  return j;
end;
$$;

-- Shared "admin or trusted server-side caller" check for the admin-only
-- RPCs, mirroring the same rule.
create or replace function private.is_elevated()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is null
    or coalesce(
      (select role from public.profiles where id = (select auth.uid())) = 'admin',
      false
    );
$$;

revoke all on function private.is_elevated() from public, anon;
grant execute on function private.is_elevated() to authenticated;

create or replace function public.apply_pending_bom_now(p_job_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;
  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'job_not_found: job % does not exist', p_job_id;
  end if;
  return private.apply_pending_bom(p_job_id);
end;
$$;

create or replace function public.reschedule_booking(
  p_job_id bigint,
  p_expected_version integer,
  p_new_date date
) returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs%rowtype;
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;

  j := private.lock_job_for_transition(p_job_id, p_expected_version);

  perform set_config('app.allow_stage_writes', 'on', true);

  update public.jobs set date_booked = p_new_date where id = p_job_id;
  perform private.apply_pending_bom(p_job_id);

  insert into public.job_events (job_id, event_type, payload, actor)
  values (
    p_job_id, 'booking_rescheduled',
    jsonb_build_object('from', j.date_booked, 'to', p_new_date),
    (select auth.uid())
  );

  select * into j from public.jobs where id = p_job_id;
  return j;
end;
$$;

create or replace function public.receive_stock(
  p_supplier_id bigint,
  p_invoice_ref text,
  p_occurred_at date,
  p_lines jsonb
) returns public.receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  l           jsonb;
  v_stock_id  bigint;
  v_qty       integer;
  v_count     integer := 0;
  v_units     integer := 0;
  r           public.receipts%rowtype;
begin
  if not private.is_elevated() then
    raise exception 'not_allowed: admin only';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invalid_lines: expected a non-empty array of {stock_id|new_name, qty}';
  end if;

  if p_supplier_id is not null
     and not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'supplier_not_found: supplier % does not exist', p_supplier_id;
  end if;

  for l in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce((l ->> 'qty')::integer, 0);
    if v_qty <= 0 then
      continue;  -- skip zero/invalid lines, same as the old flow's review step
    end if;

    if l ? 'stock_id' then
      v_stock_id := (l ->> 'stock_id')::bigint;
      update public.stocks set qty = qty + v_qty where id = v_stock_id;
      if not found then
        raise exception 'stock_not_found: stock item % does not exist', v_stock_id;
      end if;
    elsif coalesce(trim(l ->> 'new_name'), '') <> '' then
      insert into public.stocks (name, qty, supplier_id)
      values (trim(l ->> 'new_name'), v_qty, p_supplier_id);
    else
      raise exception 'invalid_line: each line needs stock_id or new_name (%)', l::text;
    end if;

    v_count := v_count + 1;
    v_units := v_units + v_qty;
  end loop;

  if v_count = 0 then
    raise exception 'invalid_lines: no line had a positive quantity';
  end if;

  insert into public.receipts (occurred_at, supplier_id, invoice_ref, item_count, total_units)
  values (coalesce(p_occurred_at, (now() at time zone 'Australia/Melbourne')::date),
          p_supplier_id, coalesce(p_invoice_ref, ''), v_count, v_units)
  returning * into r;

  return r;
end;
$$;
