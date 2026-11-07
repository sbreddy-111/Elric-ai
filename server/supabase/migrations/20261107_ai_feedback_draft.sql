-- Draft fact for the owner's Review tab (ai-autofix writes it when it cannot fix an item alone).
-- Touches ONLY public.ai_feedback. Never auto-added; the owner checks and approves it.
alter table public.ai_feedback
  add column if not exists draft_fact text,
  add column if not exists draft_source text,
  add column if not exists draft_news boolean not null default false;
alter table public.ai_feedback drop constraint if exists ai_feedback_draft_len_chk;
alter table public.ai_feedback add constraint ai_feedback_draft_len_chk check (
  (draft_fact is null or char_length(draft_fact) <= 300) and (draft_source is null or char_length(draft_source) <= 2000)
);
-- anon keeps its column-level insert grant (question/answer/note etc. only), so reporters can never set a draft.
