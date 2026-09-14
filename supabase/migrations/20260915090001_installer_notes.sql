-- ── Installer notes + installer edit allowlist ─────────────────────────
-- Part 1 of the 2026-09-15 job field tidy-up (the additive half).
--
-- Job "Notes" becomes Fred's notes TO the installer, read-only for
-- installers. Installers get their own column for comments back to Fred.
--
-- The installer rule in guard_jobs_update() flips from a denylist (six
-- named columns blocked, everything else writable, which silently made
-- every new column installer-editable, this one included) to an
-- allowlist: installers may change installer_notes and nothing else.
-- updated_at / version are excluded from the comparison only because
-- b_bump_job_version owns them and fires after this trigger.
--
-- The drop half (jobs.fixes_needed, and vehicle / site_access_notes /
-- special_instructions / additional_notes on installation_requests) is a
-- separate migration, applied only after the frontend that stops writing
-- them is deployed. The live app's "Save details" still sends
-- fixes_needed; dropping it first would break every admin job save.

alter table public.jobs
  add column installer_notes text not null default '';

-- Last defined in 20260719000001_phase2_restructure.sql. Stage block unchanged.
create or replace function private.guard_jobs_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_flag_on   boolean := coalesce(current_setting('app.allow_stage_writes', true), '') = 'on';
  v_direct    boolean := (select auth.uid()) is null;
  v_installer_writable constant text[] := array['installer_notes', 'updated_at', 'version'];
begin
  if not (v_flag_on or v_direct) then
    if new.stage                     is distinct from old.stage
      or new.step                    is distinct from old.step
      or new.planned_install_date    is distinct from old.planned_install_date
      or new.install_start_date      is distinct from old.install_start_date
      or new.install_completion_date is distinct from old.install_completion_date
      or new.ces_submitted           is distinct from old.ces_submitted
      or new.ces_received            is distinct from old.ces_received
      or new.rebate_submitted        is distinct from old.rebate_submitted
      or new.rebate_received         is distinct from old.rebate_received
    then
      raise exception 'stage_write_blocked: stage, step and pipeline dates change only via advance_job_stage / move_job_back / reschedule_booking';
    end if;

    -- Installers may only touch installer_notes. Allowlist: a column added
    -- later stays admin-only until someone deliberately adds it here.
    if not coalesce((select private.is_admin()), false) then
      if (to_jsonb(new) - v_installer_writable) is distinct from (to_jsonb(old) - v_installer_writable) then
        raise exception 'installer_edit_blocked: installers can only edit installer notes';
      end if;
    end if;
  end if;
  return new;
end;
$$;
