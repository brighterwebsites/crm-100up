-- ── Step permissions, step keys, editable step dates ───────────────────
-- Installer model part 1 (docs/design/installer-model-design.md).
--
-- 1. pipeline_steps gains a stable `key`, an `installer_can_set` flag and a
--    `date_column` (for the seven steps whose date lives on jobs). The step
--    functions now read these instead of hardcoded (stage, step) numbers, so
--    adding or splitting a step (Inspector review is next) is a data change.
-- 2. Who may tick a step is enforced here, not just hidden in the UI. Until
--    now an installer could run their own job through every step, admin-only
--    ones included: job 200 went to "Job closed" on 2026-09-14 via the
--    normal Advance button.
-- 3. job_step_dates holds the date for every step with no column on jobs,
--    so every step in the Job progress panel has a date. Backfilled from
--    job_events, whose history starts 2026-07-19.
-- 4. set_step_date() edits a reached step's date under the same rule and
--    logs the change to job_events.
--
-- move_job_back also loses a latent off-by-one: stepping back from
-- Inspector review to CES submitted cleared the CES submitted date while
-- leaving the job sitting on that step. Dates are now cleared by "belongs
-- to a step after the new position", which cannot drift from the steps.

-- ── 1. pipeline_steps metadata ─────────────────────────────────────────
alter table public.pipeline_steps
  add column key text,
  add column installer_can_set boolean not null default false,
  add column date_column text
    check (date_column in ('planned_install_date', 'install_start_date', 'install_completion_date',
                           'ces_submitted', 'ces_received', 'rebate_submitted', 'rebate_received'));

update public.pipeline_steps ps set
  key               = v.key,
  installer_can_set = v.installer,
  date_column       = v.date_column
from (values
  (1, 0, 'first_contact',         false, null::text),
  (1, 1, 'info_collection',       false, null),
  (1, 2, 'system_proposals',      false, null),
  (1, 3, 'customer_selects',      false, null),
  (2, 0, 'quote_in_xero',         false, null),
  (2, 1, 'send_quote',            false, null),
  (2, 2, 'deposit_received',      false, null),
  (3, 0, 'job_info_to_installer', false, null),
  (3, 1, 'date_booked',           false, 'planned_install_date'),
  (3, 2, 'parts_ordered',         false, null),
  (3, 3, 'install_in_progress',   true,  'install_start_date'),
  (3, 4, 'install_complete',      true,  'install_completion_date'),
  (4, 0, 'ces_submitted',         true,  'ces_submitted'),
  (4, 1, 'inspector_review',      false, null),
  (4, 2, 'fixes_complete',        true,  null),
  (4, 3, 'ces_received',          false, 'ces_received'),
  (4, 4, 'rebate_submitted',      false, 'rebate_submitted'),
  (4, 5, 'rebate_received',       false, 'rebate_received'),
  (4, 6, 'job_closed',            false, null)
) as v(stage, step, key, installer, date_column)
where ps.stage = v.stage and ps.step = v.step;

-- set not null fails the whole migration if any step was missed above.
alter table public.pipeline_steps
  alter column key set not null,
  add constraint pipeline_steps_key_key unique (key),
  add constraint pipeline_steps_date_column_key unique (date_column);

-- ── 3. job_step_dates ──────────────────────────────────────────────────
create table public.job_step_dates (
  job_id     bigint      not null references public.jobs (id) on delete cascade,
  step_key   text        not null references public.pipeline_steps (key) on update cascade,
  date       date        not null,
  set_by     uuid        references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (job_id, step_key)
);

-- Default privileges hand ALL to anon/authenticated on every new table
-- (docs/bugs.md #13), so revoke before granting.
revoke all on public.job_step_dates from anon, authenticated;
grant select on public.job_step_dates to authenticated;
alter table public.job_step_dates enable row level security;

-- Reads follow the job. No write policies: rows change only through the
-- SECURITY DEFINER step functions below.
create policy job_step_dates_select on public.job_step_dates
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.jobs j
      where j.id = job_step_dates.job_id
        and j.assigned_installer_id = (select auth.uid())
    )
  );

alter publication supabase_realtime add table public.job_step_dates;

-- Backfill: the latest advance into each reached step that has no column.
insert into public.job_step_dates (job_id, step_key, date, set_by, updated_at)
select distinct on (e.job_id, ps.key)
       e.job_id,
       ps.key,
       (e.created_at at time zone 'Australia/Melbourne')::date,
       (select p.id from public.profiles p where p.id = e.actor),
       e.created_at
from public.job_events e
join public.pipeline_steps ps
  on ps.stage = (e.payload -> 'to' ->> 'stage')::smallint
 and ps.step  = (e.payload -> 'to' ->> 'step')::smallint
join public.jobs j on j.id = e.job_id
join public.pipeline_steps cur on cur.stage = j.stage and cur.step = j.step
where e.event_type = 'stage_advanced'
  and ps.date_column is null
  and ps.ordinal <= cur.ordinal
order by e.job_id, ps.key, e.created_at desc;

-- ── 2. advance_job_stage: step-key driven, permission checked ──────────
-- Last defined in 20260719000001_phase2_restructure.sql.
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
  v_target   public.pipeline_steps%rowtype;
  v_max_step smallint;
  v_stage    smallint;
  v_step     smallint;
  v_date     date := coalesce(p_date, (now() at time zone 'Australia/Melbourne')::date);
begin
  j := private.lock_job_for_transition(p_job_id, p_expected_version);

  if p_override_stage is not null and not private.is_elevated() then
    raise exception 'not_allowed: only an admin can jump a job to a specific step';
  end if;

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
    return j;
  end if;

  select * into v_target from public.pipeline_steps where stage = v_stage and step = v_step;
  if not found then
    raise exception 'unknown_step: stage % step %', v_stage, v_step;
  end if;

  if not (private.is_elevated() or v_target.installer_can_set) then
    raise exception 'not_allowed: only an admin can mark "%"', v_target.step_name;
  end if;

  perform set_config('app.allow_stage_writes', 'on', true);

  update public.jobs set
    stage                   = v_stage,
    step                    = v_step,
    planned_install_date    = case when v_target.date_column = 'planned_install_date'    then v_date else planned_install_date end,
    install_start_date      = case when v_target.date_column = 'install_start_date'      then v_date else install_start_date end,
    install_completion_date = case when v_target.date_column = 'install_completion_date' then v_date else install_completion_date end,
    ces_submitted           = case when v_target.date_column = 'ces_submitted'           then v_date else ces_submitted end,
    ces_received            = case when v_target.date_column = 'ces_received'            then v_date else ces_received end,
    rebate_submitted        = case when v_target.date_column = 'rebate_submitted'        then v_date else rebate_submitted end,
    rebate_received         = case when v_target.date_column = 'rebate_received'         then v_date else rebate_received end
  where id = p_job_id;

  if v_target.date_column is null then
    insert into public.job_step_dates (job_id, step_key, date, set_by)
    values (p_job_id, v_target.key, v_date, (select auth.uid()))
    on conflict (job_id, step_key) do update
      set date = excluded.date, set_by = excluded.set_by, updated_at = now();
  end if;

  if v_target.key = 'date_booked' then
    perform private.apply_pending_bom(p_job_id);
  end if;

  -- Stock leaves the shelf when the install starts.
  if v_target.key = 'install_in_progress' then
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

-- ── move_job_back: step-key driven, permission checked ─────────────────
-- Last defined in 20260719000001_phase2_restructure.sql.
create or replace function public.move_job_back(
  p_job_id bigint,
  p_expected_version integer
) returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j         public.jobs%rowtype;
  v_current public.pipeline_steps%rowtype;
  v_target  public.pipeline_steps%rowtype;
begin
  j := private.lock_job_for_transition(p_job_id, p_expected_version);

  select * into v_current from public.pipeline_steps where stage = j.stage and step = j.step;

  -- The previous step, in whichever stage it falls.
  select * into v_target from public.pipeline_steps
  where ordinal < v_current.ordinal
  order by ordinal desc
  limit 1;
  if not found then
    return j;
  end if;

  -- Installers may only undo a step they are allowed to set.
  if not (private.is_elevated() or v_current.installer_can_set) then
    raise exception 'not_allowed: only an admin can undo "%"', v_current.step_name;
  end if;

  perform set_config('app.allow_stage_writes', 'on', true);

  -- Stepping back off the step that consumed stock puts it back on the
  -- shelf (faithful to V46 lines 7449-7458).
  if v_current.key = 'install_in_progress' then
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

  -- Clear every date that belongs to a step after the new position.
  update public.jobs set
    stage = v_target.stage,
    step  = v_target.step,
    planned_install_date    = case when (select ordinal from public.pipeline_steps where date_column = 'planned_install_date')    > v_target.ordinal then null else planned_install_date end,
    install_start_date      = case when (select ordinal from public.pipeline_steps where date_column = 'install_start_date')      > v_target.ordinal then null else install_start_date end,
    install_completion_date = case when (select ordinal from public.pipeline_steps where date_column = 'install_completion_date') > v_target.ordinal then null else install_completion_date end,
    ces_submitted           = case when (select ordinal from public.pipeline_steps where date_column = 'ces_submitted')           > v_target.ordinal then null else ces_submitted end,
    ces_received            = case when (select ordinal from public.pipeline_steps where date_column = 'ces_received')            > v_target.ordinal then null else ces_received end,
    rebate_submitted        = case when (select ordinal from public.pipeline_steps where date_column = 'rebate_submitted')        > v_target.ordinal then null else rebate_submitted end,
    rebate_received         = case when (select ordinal from public.pipeline_steps where date_column = 'rebate_received')         > v_target.ordinal then null else rebate_received end
  where id = p_job_id;

  delete from public.job_step_dates d
  using public.pipeline_steps ps
  where d.job_id = p_job_id
    and ps.key = d.step_key
    and ps.ordinal > v_target.ordinal;

  insert into public.job_events (job_id, event_type, payload, actor)
  values (
    p_job_id, 'stage_moved_back',
    jsonb_build_object(
      'from', jsonb_build_object('stage', j.stage, 'step', j.step),
      'to',   jsonb_build_object('stage', v_target.stage, 'step', v_target.step)
    ),
    (select auth.uid())
  );

  select * into j from public.jobs where id = p_job_id;
  return j;
end;
$$;

-- ── 4. set_step_date ───────────────────────────────────────────────────
create or replace function public.set_step_date(
  p_job_id bigint,
  p_expected_version integer,
  p_step_key text,
  p_date date
) returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j      public.jobs%rowtype;
  v_step public.pipeline_steps%rowtype;
  v_cur  public.pipeline_steps%rowtype;
  v_old  date;
begin
  if p_date is null then
    raise exception 'date_required: pick a date';
  end if;

  j := private.lock_job_for_transition(p_job_id, p_expected_version);

  select * into v_step from public.pipeline_steps where key = p_step_key;
  if not found then
    raise exception 'unknown_step: %', p_step_key;
  end if;

  if not (private.is_elevated() or v_step.installer_can_set) then
    raise exception 'not_allowed: only an admin can change the "%" date', v_step.step_name;
  end if;

  select * into v_cur from public.pipeline_steps where stage = j.stage and step = j.step;
  if v_step.ordinal > v_cur.ordinal then
    raise exception 'step_not_reached: "%" has not happened yet', v_step.step_name;
  end if;

  -- The booking date has its own path: it re-applies pending stock.
  if v_step.key = 'date_booked' then
    return public.reschedule_booking(p_job_id, p_expected_version, p_date);
  end if;

  if v_step.date_column is not null then
    -- date_column is constrained to seven known column names, so %I is safe.
    execute format('select %I from public.jobs where id = $1', v_step.date_column)
      into v_old using p_job_id;
    perform set_config('app.allow_stage_writes', 'on', true);
    execute format('update public.jobs set %I = $1 where id = $2', v_step.date_column)
      using p_date, p_job_id;
  else
    select date into v_old from public.job_step_dates
    where job_id = p_job_id and step_key = p_step_key;
    insert into public.job_step_dates (job_id, step_key, date, set_by)
    values (p_job_id, p_step_key, p_date, (select auth.uid()))
    on conflict (job_id, step_key) do update
      set date = excluded.date, set_by = excluded.set_by, updated_at = now();
  end if;

  insert into public.job_events (job_id, event_type, payload, actor)
  values (
    p_job_id, 'step_date_changed',
    jsonb_build_object('step', p_step_key, 'from', v_old, 'to', p_date),
    (select auth.uid())
  );

  select * into j from public.jobs where id = p_job_id;
  return j;
end;
$$;

revoke all on function public.set_step_date(bigint, integer, text, date) from public, anon;
grant execute on function public.set_step_date(bigint, integer, text, date) to authenticated;
