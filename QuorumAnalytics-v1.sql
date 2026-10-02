-- ════════════════════════════════════════════════════════════════════════════
-- QUORUM — Growth & behaviour analytics (v1)
-- Read-only: nothing here writes, alters or creates anything.
--
-- HOW TO RUN: Supabase → SQL Editor. Paste ONE query at a time (the editor only
-- shows the result of the last statement). Queries are separated by ═══ banners.
--
-- HOW PEOPLE ARE COUNTED
--   • Signed-up person  = a row in auth.users (user_id).
--   • Anonymous person  = a device_id (browser localStorage) that has started a
--     decision but has NO linked user. If that device later signs up, the person
--     flips to "signed_up" automatically (sessions get linked by the app).
--   • A "decision attempt" = one chat_intakes row (chat flow) OR one classic-form
--     session. Reanalyze child sessions (parent_session_id) are not new attempts.
--   • Day boundaries use IST (Asia/Kolkata). Change it if you want UTC.
--
-- KNOWN BLIND SPOT
--   Visitors who land but never send a first message leave no row in the DB, so
--   landing → first-message drop-off can't be measured from SQL alone.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════ QUERY 1 — Cohort funnel: anonymous vs signed-up ═══════════════
-- "New" = signed up in the window (signed_up) or first seen in the window while
-- still anonymous (anonymous). Funnel = lifetime progress of that cohort.
-- Sections: A who joined · B funnel (ever reached) · C where they stopped
-- (each person counted once, at their furthest point) · D engagement · E access.

with params as (
  select 30 as days,                                       -- ← window in days
         array['your-test-email@example.com']::text[] as excluded_emails   -- ← your own / test emails
),

attempts as (
  select ci.id as attempt_id, 'chat'::text as mode, ci.created_at, ci.device_id,
         ci.user_id as ci_user_id, ci.user_email as ci_email,
         ci.exchange_count, ci.session_id
  from chat_intakes ci
  union all
  select s.id, 'classic'::text, s.created_at, s.device_id,
         null::uuid, null::text, null::int, s.id
  from sessions s
  where s.chat_intake_id is null
    and s.parent_session_id is null
),

-- device → user, learned from sessions the app has already linked
device_owner as (
  select device_id, (array_agg(user_id order by created_at))[1] as user_id
  from sessions
  where device_id is not null and user_id is not null
  group by device_id
),

att as (
  select
    a.attempt_id, a.mode, a.created_at, a.exchange_count,
    coalesce(s.user_id, a.ci_user_id, o.user_id)                       as user_id,
    coalesce(a.device_id, s.device_id)                                 as device_id,
    coalesce(s.user_email, a.ci_email)                                 as pre_auth_email,
    (s.id is not null)                                                 as confirmed,
    (s.initial_instinct is not null
       and s.optimization_priority is not null)                        as chips,
    (s.quorum_prediction_generated_at is not null)                     as saw_prediction,
    exists (select 1 from examiner_responses er where er.session_id = s.id) as quick_check,
    coalesce(s.status = 'completed', false)                            as chose_done,
    exists (select 1 from synthesis_versions sv
            where sv.session_id = s.id and sv.version = 0)             as saw_council,
    (s.final_decision_locked_at is not null)                           as locked,
    (s.commitment_captured_at is not null)                             as committed,
    exists (select 1 from outcomes oc where oc.session_id = s.id)      as outcome_logged
  from attempts a
  left join sessions s on s.id = a.session_id
  left join device_owner o on o.device_id = coalesce(a.device_id, s.device_id)
),

staged as (
  select att.*,
    coalesce(user_id::text, 'dev:' || device_id, 'att:' || attempt_id::text) as pkey,
    case
      when locked                          then 8
      when saw_council                     then 7
      when chose_done                      then 6
      when quick_check                     then 5
      when saw_prediction                  then 4
      when confirmed                       then 3
      when coalesce(exchange_count, 0) >= 2 then 2
      else 1
    end as stage
  from att
),

per_person as (
  select
    pkey,
    (array_agg(user_id) filter (where user_id is not null))[1]            as user_id,
    min(created_at)                                                       as first_attempt_at,
    count(*)                                                              as attempts,
    count(*) filter (where confirmed)                                     as decisions,
    count(distinct (created_at at time zone 'Asia/Kolkata')::date)        as active_days,
    max(stage)                                                            as furthest_stage,
    bool_or(coalesce(exchange_count, 0) >= 2 or confirmed)                as f_chatted,
    bool_or(confirmed)                                                    as f_confirmed,
    bool_or(chips)                                                        as f_chips,
    bool_or(saw_prediction)                                               as f_prediction,
    bool_or(quick_check)                                                  as f_quick_check,
    bool_or(saw_council)                                                  as f_council,
    bool_or(locked)                                                       as f_locked,
    bool_or(committed)                                                    as f_committed,
    bool_or(outcome_logged)                                               as f_outcome,
    coalesce(array_agg(distinct lower(pre_auth_email))
             filter (where pre_auth_email is not null), '{}'::text[])     as pre_emails
  from staged
  group by pkey
),

signups as (
  select u.id as user_id, u.id::text as pkey, u.created_at as signed_up_at,
         lower(u.email) as email,
         coalesce(u.raw_app_meta_data->>'provider', 'unknown') as provider
  from auth.users u
),

people as (
  select
    coalesce(pp.pkey, sg.pkey)                    as pkey,
    coalesce(pp.user_id, sg.user_id)              as user_id,
    sg.signed_up_at, sg.provider, sg.email,
    pp.first_attempt_at,
    coalesce(pp.attempts, 0)                      as attempts,
    coalesce(pp.decisions, 0)                     as decisions,
    coalesce(pp.active_days, 0)                   as active_days,
    coalesce(pp.furthest_stage, 0)                as furthest_stage,
    coalesce(pp.f_chatted, false)                 as f_chatted,
    coalesce(pp.f_confirmed, false)               as f_confirmed,
    coalesce(pp.f_chips, false)                   as f_chips,
    coalesce(pp.f_prediction, false)              as f_prediction,
    coalesce(pp.f_quick_check, false)             as f_quick_check,
    coalesce(pp.f_council, false)                 as f_council,
    coalesce(pp.f_locked, false)                  as f_locked,
    coalesce(pp.f_committed, false)               as f_committed,
    coalesce(pp.f_outcome, false)                 as f_outcome,
    coalesce(pp.pre_emails, '{}'::text[])         as pre_emails
  from per_person pp
  full outer join signups sg on sg.pkey = pp.pkey
),

cohort as (
  select
    p.*,
    case when p.user_id is not null then 'signed_up' else 'anonymous' end as seg,
    (ma.user_id is not null) as has_access
  from people p
  cross join params
  left join mirror_access ma on ma.user_id = p.user_id
  where (
          p.signed_up_at >= now() - params.days * interval '1 day'
          or (p.user_id is null
              and p.first_attempt_at >= now() - params.days * interval '1 day')
        )
    and not (coalesce(p.email, '') = any (params.excluded_emails))
    and not (p.pre_emails && params.excluded_emails)
),

counts as (
  select v.ord, v.section, v.step,
    count(*) filter (where c.seg = 'anonymous' and v.ok)::numeric as anonymous,
    count(*) filter (where c.seg = 'signed_up' and v.ok)::numeric as signed_up,
    count(*) filter (where v.ok)::numeric                         as total
  from cohort c
  cross join lateral (values
    -- A. who joined
    (10, 'A. Who joined', 'New people (cohort)',                         true),
    (11, 'A. Who joined', '…started a decision',                         c.attempts > 0),
    (12, 'A. Who joined', '…joined but never started a decision',        c.attempts = 0),
    (13, 'A. Who joined', 'Signed up via Google',                        c.provider = 'google'),
    (14, 'A. Who joined', 'Signed up via email link',                    c.provider = 'email'),

    -- B. funnel: ever reached (cumulative; base = started a decision)
    (20, 'B. Funnel (ever reached)', 'Started a decision',               c.attempts > 0),
    (21, 'B. Funnel (ever reached)', 'Went past the 1st message',        c.f_chatted),
    (22, 'B. Funnel (ever reached)', 'Confirmed the decision',           c.f_confirmed),
    (23, 'B. Funnel (ever reached)', 'Picked lean + priority',           c.f_chips),
    (24, 'B. Funnel (ever reached)', 'Saw the prediction',               c.f_prediction),
    (25, 'B. Funnel (ever reached)', 'Did the quick check',              c.f_quick_check),
    (26, 'B. Funnel (ever reached)', 'Saw council synthesis',            c.f_council),
    (27, 'B. Funnel (ever reached)', 'Locked a final decision',          c.f_locked),
    (28, 'B. Funnel (ever reached)', 'Logged a commitment',              c.f_committed),
    (29, 'B. Funnel (ever reached)', 'Logged a real-world outcome',      c.f_outcome),

    -- C. where they stopped (exclusive; base = started a decision)
    (30, 'C. Where they stopped', 'All who started a decision',                          c.attempts > 0),
    (31, 'C. Where they stopped', '1 · Left right after the first message',              c.furthest_stage = 1),
    (32, 'C. Where they stopped', '2 · Left mid-chat (2+ msgs), never confirmed',        c.furthest_stage = 2),
    (33, 'C. Where they stopped', '3 · Confirmed, left before prediction',               c.furthest_stage = 3),
    (34, 'C. Where they stopped', '4 · Saw prediction, left before quick check',         c.furthest_stage = 4),
    (35, 'C. Where they stopped', '5 · Did quick check, never saw council',              c.furthest_stage = 5),
    (36, 'C. Where they stopped', '6 · Chose "I''m done" (skipped council)',             c.furthest_stage = 6),
    (37, 'C. Where they stopped', '7 · Saw council, did not lock',                       c.furthest_stage = 7),
    (38, 'C. Where they stopped', '8 · Locked a decision (full journey)',                c.furthest_stage = 8),

    -- D. engagement (base = confirmed at least 1 decision)
    (40, 'D. Engagement', 'Confirmed 1+ decision',                       c.decisions >= 1),
    (41, 'D. Engagement', 'Ran 2+ decisions',                            c.decisions >= 2),
    (42, 'D. Engagement', 'Ran 3+ decisions',                            c.decisions >= 3),
    (43, 'D. Engagement', 'Active on 2+ different days',                 c.active_days >= 2),

    -- E. access (signed-up only; base = signed-up in cohort)
    (50, 'E. Access', 'Signed-up people in cohort',                      c.seg = 'signed_up'),
    (51, 'E. Access', 'Has Mirror access (paid or admin-granted)',       c.has_access)
  ) as v(ord, section, step, ok)
  group by v.ord, v.section, v.step
),

avg_rows as (
  select 45 as ord, 'D. Engagement' as section,
         'Avg chat messages before confirming' as step,
         round(avg(a.exchange_count) filter (where c.seg = 'anonymous' and a.mode = 'chat' and a.confirmed), 1) as anonymous,
         round(avg(a.exchange_count) filter (where c.seg = 'signed_up' and a.mode = 'chat' and a.confirmed), 1) as signed_up,
         round(avg(a.exchange_count) filter (where a.mode = 'chat' and a.confirmed), 1)                         as total
  from staged a join cohort c on c.pkey = a.pkey
  union all
  select 46, 'D. Engagement', 'Avg chat messages when they left mid-chat',
         round(avg(a.exchange_count) filter (where c.seg = 'anonymous' and a.mode = 'chat' and not a.confirmed), 1),
         round(avg(a.exchange_count) filter (where c.seg = 'signed_up' and a.mode = 'chat' and not a.confirmed), 1),
         round(avg(a.exchange_count) filter (where a.mode = 'chat' and not a.confirmed), 1)
  from staged a join cohort c on c.pkey = a.pkey
)

select
  r.section, r.step, r.anonymous, r.signed_up, r.total,
  case when r.step like 'Avg%' then null
       else round(100.0 * r.total
                  / nullif(first_value(r.total) over (partition by r.section order by r.ord), 0), 1)
  end as pct_of_section_base
from (
  select * from counts
  union all
  select ord, section, step, anonymous, signed_up, total from avg_rows
) r
order by r.ord;


-- ════════════ QUERY 2 — Daily trend, last 14 days (IST) ═════════════════════
-- new_devices = browsers seen for the first time that day.
-- new_devices_still_anonymous = of those, devices that have NOT signed up (yet).

with bounds as (
  select (now() at time zone 'Asia/Kolkata')::date as today
),
days as (
  select generate_series((today - 13)::timestamp, today::timestamp, interval '1 day')::date as day
  from bounds
),
first_seen_device as (
  select device_id, min(created_at) as first_at
  from (
    select device_id, created_at from chat_intakes
    union all
    select device_id, created_at from sessions
  ) x
  where device_id is not null
  group by device_id
),
anon_devices as (
  select f.*
  from first_seen_device f
  where not exists (
    select 1 from sessions s where s.device_id = f.device_id and s.user_id is not null
  )
)
select
  d.day,
  (select count(*) from auth.users u
    where (u.created_at at time zone 'Asia/Kolkata')::date = d.day)                  as signups,
  (select count(*) from first_seen_device f
    where (f.first_at at time zone 'Asia/Kolkata')::date = d.day)                    as new_devices,
  (select count(*) from anon_devices f
    where (f.first_at at time zone 'Asia/Kolkata')::date = d.day)                    as new_devices_still_anonymous,
  (select count(*) from chat_intakes ci
    where (ci.created_at at time zone 'Asia/Kolkata')::date = d.day)                 as chats_started,
  (select count(*) from sessions s
    where s.parent_session_id is null
      and (s.created_at at time zone 'Asia/Kolkata')::date = d.day)                  as decisions_confirmed,
  (select count(*) from synthesis_versions sv
    where sv.version = 0
      and (sv.created_at at time zone 'Asia/Kolkata')::date = d.day)                 as reached_council,
  (select count(*) from sessions s
    where s.final_decision_locked_at is not null
      and (s.final_decision_locked_at at time zone 'Asia/Kolkata')::date = d.day)    as locked
from days d
order by d.day desc;


-- ════════════ QUERY 3 — Signups by source / campaign (last 30 days) ═════════
-- UTM is only captured at signup (user_profiles.signup_utm_*), so this covers
-- signed-up people only. Anonymous visitors have no source recorded.

select
  coalesce(up.signup_utm_source,   '(none / organic)') as source,
  coalesce(up.signup_utm_campaign, '-')                as campaign,
  coalesce(up.signup_utm_content,  '-')                as content,
  count(*)                                             as signups,
  count(*) filter (where exists (
    select 1 from sessions s where s.user_id = u.id and s.parent_session_id is null
  ))                                                   as ran_a_decision,
  count(*) filter (where exists (
    select 1 from sessions s join synthesis_versions sv on sv.session_id = s.id and sv.version = 0
    where s.user_id = u.id
  ))                                                   as reached_council,
  count(*) filter (where exists (
    select 1 from sessions s where s.user_id = u.id and s.final_decision_locked_at is not null
  ))                                                   as locked_a_decision,
  count(*) filter (where exists (
    select 1 from mirror_access ma where ma.user_id = u.id
  ))                                                   as has_paid_access
from auth.users u
left join user_profiles up on up.user_id = u.id
where u.created_at >= now() - interval '30 days'       -- ← window
  -- and lower(u.email) not in ('your-test-email@example.com')
group by 1, 2, 3
order by signups desc;


-- ════════════ QUERY 4 — Chat drop-off curve (last 30 days) ══════════════════
-- For every chat started: how many messages did they send, and did they
-- confirm the decision? Shows exactly which message number people leave at.
-- "logged_out_at_start" = no user_id when the chat began (anonymous).

select
  case when user_id is null then 'logged_out_at_start' else 'logged_in' end as who,
  least(coalesce(exchange_count, 0), 10)                                    as messages_sent,   -- 10 = 10 or more
  count(*) filter (where status <> 'checkpointed')                          as left_here,
  count(*) filter (where status =  'checkpointed')                          as confirmed_decision,
  round(100.0 * count(*) filter (where status = 'checkpointed')
        / nullif(count(*), 0), 1)                                           as pct_confirmed
from chat_intakes
where created_at >= now() - interval '30 days'         -- ← window
group by 1, 2
order by 1, 2;
