-- ── PO drafts, part 1: the enum value ──────────────────────────────────
-- An enum value cannot be used in the same transaction that adds it, so
-- this stands alone. 20260915120002 builds the draft lifecycle on it.
alter type public.po_status add value if not exists 'draft' before 'sent';
