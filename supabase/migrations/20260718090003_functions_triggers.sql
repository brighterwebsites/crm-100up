-- 100UP CRM — Phase 1 migration 3/3: job triggers + stage-transition RPCs
--
-- This is the fix for the old app's documented stock-consumption bug:
-- consumption/restoration only ever happens inside these RPCs, and a
-- guard trigger makes stage/step/pipeline-date columns unwritable through
-- any other path (including future code that doesn't know this history).

-- ── Version bump ───────────────────────────────────────────────────────
-- Runs on every jobs update; also stops clients tampering with version.
create or replace function private.bump_job_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- ── Guard: stage-linked columns are RPC-only ───────────────────────────
-- The old app had three separate code paths that could write dateBooked/
-- installStart/installDate, only one of which ran the consumption logic.
-- Here: unless the transaction-local flag set by the RPCs is present (or
-- the write comes from direct SQL / service role, where auth.uid() is
-- null), any change to these columns is rejected outright.
create or replace function private.guard_jobs_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_flag_on   boolean := coalesce(current_setting('app.allow_stage_writes', true), '') = 'on';
  v_direct    boolean := (select auth.uid()) is null;
begin
  if not (v_flag_on or v_direct) then
    if new.stage            is distinct from old.stage
      or new.step             is distinct from old.step
      or new.date_booked      is distinct from old.date_booked
      or new.install_start    is distinct from old.install_start
      or new.install_date     is distinct from old.install_date
      or new.ces_submitted    is distinct from old.ces_submitted
      or new.ces_received     is distinct from old.ces_received
      or new.rebate_submitted is distinct from old.rebate_submitted
      or new.rebate_received  is distinct from old.rebate_received
    then
      raise exception 'stage_write_blocked: stage, step and pipeline dates change only via advance_job_stage / move_job_back / reschedule_booking';
    end if;

    -- Installers may only touch notes and fixes_needed directly.
    if not coalesce((select private.is_admin()), false) then
      if new.name                  is distinct from old.name
        or new.location              is distinct from old.location
        or new.system_description    is distinct from old.system_description
        or new.value                 is distinct from old.value
        or new.email                 is distinct from old.email
        or new.phone                 is distinct from old.phone
        or new.contact_method        is distinct from old.contact_method
        or new.job_type              is distinct from old.job_type
        or new.assigned_installer_id is distinct from old.assigned_installer_id
        or new.job_order             is distinct from old.job_order
      then
        raise exception 'installer_edit_blocked: installers can only edit notes and the fixes flag';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Alphabetical trigger names fix execution order: guard first, then bump.
create trigger a_guard_jobs_update
  before update on public.jobs
  for each row execute function private.guard_jobs_update();

create trigger b_bump_job_version
  before update on public.jobs
  for each row execute function private.bump_job_version();

-- ── Internal: apply pending BOM (pending -> assigned, merge by stock) ──
-- Port of applyPendingBom() (line 5484): quantities merge into any
-- existing assigned line for the same stock item.
create or replace function private.apply_pending_bom(p_job_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved integer;
begin
  with moved as (
    delete from public.job_stock_items
    where job_id = p_job_id and status = 'pending'
    returning stock_id, qty, notes
  )
  insert into public.job_stock_items
    (job_id, stock_id, qty, notes, status, assigned_at)
  select p_job_id, stock_id, qty, notes, 'assigned', now()
  from moved
  on conflict (job_id, stock_id, status)
  do update set qty = public.job_stock_items.qty + excluded.qty;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

revoke all on function private.apply_pending_bom(bigint) from public, anon, authenticated;

-- ── Internal: permission + optimistic-lock preamble ────────────────────
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
    coalesce((select private.is_admin()), false)
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

revoke all on function private.lock_job_for_transition(bigint, integer) from public, anon, authenticated;

-- ── advance_job_stage ──────────────────────────────────────────────────
-- Port of doAdvance() (line 7408). Side effects key off the RESULTING
-- (stage, step), exactly as the original:
--   (3,1) set date_booked (given date or today), apply pending BOM
--   (3,3) set install_start, consume assigned stock (qty clamped at 0)
--   (3,4) set install_date
--   (4,0)/(4,3)/(4,4)/(4,5) set CES/rebate dates — always *today*, never
--         the passed date (faithful to lines 7437-7440)
create or replace function public.advance_job_stage(
  p_job_id bigint,
  p_expected_version integer,
  p_date date default null,
  p_override_stage smallint default null,
  p_override_step smallint default null
) returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j          public.jobs%rowtype;
  v_max_step smallint;
  v_stage    smallint;
  v_step     smallint;
  v_today    date := (now() at time zone 'Australia/Melbourne')::date;
begin
  j := private.lock_job_for_transition(p_job_id, p_expected_version);

  select max(step) into v_max_step
  from public.pipeline_steps where stage = j.stage;

  if p_override_stage is not null then
    v_stage := p_override_stage;
    v_step  := coalesce(p_override_step, 0);
  elsif j.step < v_max_step then
    v_stage := j.stage;
    v_step  := j.step + 1;
  elsif j.stage < 4 then
    v_stage := j.stage + 1;
    v_step  := 0;
  else
    return j;  -- already at the final step; nothing to advance
  end if;

  perform set_config('app.allow_stage_writes', 'on', true);

  update public.jobs set
    stage            = v_stage,
    step             = v_step,
    date_booked      = case when v_stage = 3 and v_step = 1
                            then coalesce(p_date, v_today) else date_booked end,
    install_start    = case when v_stage = 3 and v_step = 3
                            then coalesce(p_date, v_today) else install_start end,
    install_date     = case when v_stage = 3 and v_step = 4
                            then coalesce(p_date, v_today) else install_date end,
    ces_submitted    = case when v_stage = 4 and v_step = 0
                            then v_today else ces_submitted end,
    ces_received     = case when v_stage = 4 and v_step = 3
                            then v_today else ces_received end,
    rebate_submitted = case when v_stage = 4 and v_step = 4
                            then v_today else rebate_submitted end,
    rebate_received  = case when v_stage = 4 and v_step = 5
                            then v_today else rebate_received end
  where id = p_job_id;

  if v_stage = 3 and v_step = 1 then
    perform private.apply_pending_bom(p_job_id);
  end if;

  if v_stage = 3 and v_step = 3 then
    -- Consume: decrement stock (clamped at 0, faithful to the original's
    -- Math.max at line 7429), then flip assigned -> consumed.
    update public.stocks s
    set qty = greatest(0, s.qty - c.total)
    from (
      select stock_id, sum(qty) as total
      from public.job_stock_items
      where job_id = p_job_id and status = 'assigned'
      group by stock_id
    ) c
    where s.id = c.stock_id;

    with moved as (
      delete from public.job_stock_items
      where job_id = p_job_id and status = 'assigned'
      returning stock_id, qty, notes, assigned_at
    )
    insert into public.job_stock_items
      (job_id, stock_id, qty, notes, status, assigned_at, consumed_at)
    select p_job_id, stock_id, qty, notes, 'consumed', assigned_at, now()
    from moved
    on conflict (job_id, stock_id, status)
    do update set qty = public.job_stock_items.qty + excluded.qty,
                  consumed_at = excluded.consumed_at;
  end if;

  insert into public.job_events (job_id, event_type, payload, actor)
  values (
    p_job_id, 'stage_advanced',
    jsonb_build_object(
      'from', jsonb_build_object('stage', j.stage, 'step', j.step),
      'to',   jsonb_build_object('stage', v_stage, 'step', v_step)
    ),
    (select auth.uid())
  );

  select * into j from public.jobs where id = p_job_id;
  return j;
end;
$$;

-- ── move_job_back ──────────────────────────────────────────────────────
-- Port of moveBack() (line 7445), including the date-clearing rules and
-- stock restoration when stepping back off "Install in progress".
create or replace function public.move_job_back(
  p_job_id bigint,
  p_expected_version integer
) returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j            public.jobs%rowtype;
  v_stage      smallint;
  v_step       smallint;
  v_same_stage boolean;
begin
  j := private.lock_job_for_transition(p_job_id, p_expected_version);

  if j.step > 0 then
    v_stage := j.stage;
    v_step  := j.step - 1;
    v_same_stage := true;
  elsif j.stage > 1 then
    v_stage := j.stage - 1;
    select max(step) into v_step
    from public.pipeline_steps where stage = v_stage;
    v_same_stage := false;
  else
    return j;  -- already at the very first step
  end if;

  perform set_config('app.allow_stage_writes', 'on', true);

  -- Restore stock when stepping back off (3,3), before the step change —
  -- faithful to lines 7449-7458.
  if v_same_stage and j.stage = 3 and j.step = 3 then
    update public.stocks s
    set qty = s.qty + c.total
    from (
      select stock_id, sum(qty) as total
      from public.job_stock_items
      where job_id = p_job_id and status = 'consumed'
      group by stock_id
    ) c
    where s.id = c.stock_id;

    with moved as (
      delete from public.job_stock_items
      where job_id = p_job_id and status = 'consumed'
      returning stock_id, qty, notes, assigned_at
    )
    insert into public.job_stock_items
      (job_id, stock_id, qty, notes, status, assigned_at)
    select p_job_id, stock_id, qty, notes, 'assigned', coalesce(assigned_at, now())
    from moved
    on conflict (job_id, stock_id, status)
    do update set qty = public.job_stock_items.qty + excluded.qty;
  end if;

  update public.jobs set
    stage = v_stage,
    step  = v_step,
    rebate_received  = case
        when v_same_stage and v_stage = 4 and v_step < 5 then null
        when not v_same_stage and v_stage = 3 then null
        else rebate_received end,
    rebate_submitted = case
        when v_same_stage and v_stage = 4 and v_step < 4 then null
        when not v_same_stage and v_stage = 3 then null
        else rebate_submitted end,
    ces_received     = case
        when v_same_stage and v_stage = 4 and v_step < 3 then null
        when not v_same_stage and v_stage = 3 then null
        else ces_received end,
    ces_submitted    = case
        when v_same_stage and v_stage = 4 and v_step < 1 then null
        when not v_same_stage and v_stage = 3 then null
        else ces_submitted end,
    install_date     = case
        when v_same_stage and v_stage = 3 and v_step < 4 then null
        else install_date end,
    install_start    = case
        when v_same_stage and v_stage = 3 and v_step < 3 then null
        else install_start end,
    date_booked      = case
        when v_same_stage and v_stage = 3 and v_step < 1 then null
        else date_booked end
  where id = p_job_id;

  insert into public.job_events (job_id, event_type, payload, actor)
  values (
    p_job_id, 'stage_moved_back',
    jsonb_build_object(
      'from', jsonb_build_object('stage', j.stage, 'step', j.step),
      'to',   jsonb_build_object('stage', v_stage, 'step', v_step)
    ),
    (select auth.uid())
  );

  select * into j from public.jobs where id = p_job_id;
  return j;
end;
$$;

-- ── apply_pending_bom_now ──────────────────────────────────────────────
-- Port of applyPendingBomNow() (line 5502): Fred's explicit "assign the
-- quote's parts before booking" override. Admin-only.
create or replace function public.apply_pending_bom_now(p_job_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((select private.is_admin()), false) then
    raise exception 'not_allowed: admin only';
  end if;
  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'job_not_found: job % does not exist', p_job_id;
  end if;
  return private.apply_pending_bom(p_job_id);
end;
$$;

-- ── reschedule_booking ─────────────────────────────────────────────────
-- The old app allowed editing dateBooked directly in the detail form
-- (with clash warning) and re-fired pending-BOM assignment (lines
-- 7492-7495). That direct write is now blocked by the guard, so
-- rescheduling gets its own explicit RPC. Admin-only.
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
  if not coalesce((select private.is_admin()), false) then
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

-- ── receive_stock ──────────────────────────────────────────────────────
-- The other multi-table atomic write: one receipt + per-line stock qty
-- increments + optional brand-new stock rows, in a single transaction.
-- Lines: [{"stock_id": 12, "qty": 4} | {"new_name": "Jinko 475W panel", "qty": 40}]
-- New items inherit the receipt's supplier. Admin-only.
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
  if not coalesce((select private.is_admin()), false) then
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

-- ── RPC grants ─────────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC by default: strip it, then grant to
-- authenticated only (each function still checks its own permissions).
revoke all on function public.advance_job_stage(bigint, integer, date, smallint, smallint) from public, anon;
revoke all on function public.move_job_back(bigint, integer) from public, anon;
revoke all on function public.apply_pending_bom_now(bigint) from public, anon;
revoke all on function public.reschedule_booking(bigint, integer, date) from public, anon;
revoke all on function public.receive_stock(bigint, text, date, jsonb) from public, anon;

grant execute on function public.advance_job_stage(bigint, integer, date, smallint, smallint) to authenticated;
grant execute on function public.move_job_back(bigint, integer) to authenticated;
grant execute on function public.apply_pending_bom_now(bigint) to authenticated;
grant execute on function public.reschedule_booking(bigint, integer, date) to authenticated;
grant execute on function public.receive_stock(bigint, text, date, jsonb) to authenticated;

-- ── Realtime ───────────────────────────────────────────────────────────
-- Admin dashboard live updates; RLS scopes what each subscriber receives.
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.job_stock_items;
alter publication supabase_realtime add table public.stocks;
