-- KO26 Kickroll Leaderboard: run this once in Supabase → SQL Editor → New query → paste ALL of it → Run
-- (with nothing highlighted: if any text is selected, Supabase runs only the selection).
-- Also turn on Authentication → Sign In / Providers → "Allow anonymous sign-ins"
-- (every visitor gets a silent anonymous account, so one rating per person per video holds).
--
-- Voting and uploads close 7 days after the rave: 10 Oct 2026, 23:59 Sydney time.
-- To change it, edit ko26_deadline() below and KO_CONFIG.deadline in ko-config.js.

create or replace function public.ko26_deadline() returns timestamptz
language sql immutable as $fn$ select timestamptz '2026-10-10 23:59:59+11' $fn$;

-- ---------- kickroll videos ----------
create table if not exists public.kickrolls (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  act         text not null check (char_length(act) between 1 and 80),
  song_key    text not null check (char_length(song_key) between 1 and 300),
  song        text not null check (char_length(song) between 1 and 300),
  name        text not null check (char_length(name) between 1 and 24),
  caption     text check (char_length(caption) <= 140),
  path        text not null check (char_length(path) <= 300),
  mime        text not null check (mime like 'video/%'),
  size_bytes  integer not null check (size_bytes between 1 and 52428800),
  hidden      boolean not null default false
);
create index if not exists kickrolls_song_idx on public.kickrolls (song_key);
create index if not exists kickrolls_act_idx on public.kickrolls (act);

-- ---------- star ratings: one per person per video ----------
create table if not exists public.ratings (
  kickroll_id uuid not null references public.kickrolls(id) on delete cascade,
  rater       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  stars       smallint not null check (stars between 1 and 5),
  created_at  timestamptz not null default now(),
  primary key (kickroll_id, rater)
);

-- ---------- reports: 3 reports hide a video until you review it ----------
create table if not exists public.reports (
  kickroll_id uuid not null references public.kickrolls(id) on delete cascade,
  reporter    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (kickroll_id, reporter)
);

-- ---------- scores (what the pages read) ----------
create or replace view public.kickroll_scores with (security_invoker = on) as
select k.id, k.created_at, k.owner, k.act, k.song_key, k.song, k.name, k.caption, k.path, k.mime, k.size_bytes,
       coalesce(round(avg(r.stars)::numeric, 2), 0) as avg_stars,
       count(r.stars)::int as votes,
       (select count(*) from public.reports p where p.kickroll_id = k.id)::int as report_count
from public.kickrolls k
left join public.ratings r on r.kickroll_id = k.id
where not k.hidden
group by k.id
having (select count(*) from public.reports p where p.kickroll_id = k.id) < 3;

-- ---------- row level security ----------
alter table public.kickrolls enable row level security;
alter table public.ratings   enable row level security;
alter table public.reports   enable row level security;

drop policy if exists "read videos" on public.kickrolls;
create policy "read videos" on public.kickrolls for select to anon, authenticated using (not hidden);
drop policy if exists "upload own video before deadline" on public.kickrolls;
create policy "upload own video before deadline" on public.kickrolls for insert to authenticated
  with check (owner = auth.uid() and now() < public.ko26_deadline() and hidden = false
              and path like auth.uid()::text || '/%');
drop policy if exists "delete own video" on public.kickrolls;
create policy "delete own video" on public.kickrolls for delete to authenticated using (owner = auth.uid());

drop policy if exists "read ratings" on public.ratings;
create policy "read ratings" on public.ratings for select to anon, authenticated using (true);
drop policy if exists "rate before deadline, not your own" on public.ratings;
create policy "rate before deadline, not your own" on public.ratings for insert to authenticated
  with check (rater = auth.uid() and now() < public.ko26_deadline()
              and not exists (select 1 from public.kickrolls k where k.id = kickroll_id and k.owner = auth.uid()));
drop policy if exists "change own rating before deadline" on public.ratings;
create policy "change own rating before deadline" on public.ratings for update to authenticated
  using (rater = auth.uid()) with check (rater = auth.uid() and now() < public.ko26_deadline());

drop policy if exists "read reports" on public.reports;
create policy "read reports" on public.reports for select to anon, authenticated using (true);
drop policy if exists "report once" on public.reports;
create policy "report once" on public.reports for insert to authenticated with check (reporter = auth.uid());

-- at most 15 uploads per person per day
create or replace function public.ko26_upload_limit() returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if (select count(*) from public.kickrolls where owner = new.owner and created_at > now() - interval '1 day') >= 15 then
    raise exception 'upload limit reached, try again tomorrow';
  end if;
  return new;
end $fn$;
drop trigger if exists ko26_upload_limit on public.kickrolls;
create trigger ko26_upload_limit before insert on public.kickrolls for each row execute function public.ko26_upload_limit();

-- ---------- video storage: public bucket, 50 MB per file, video only ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kickrolls', 'kickrolls', true, 52428800, array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kickrolls upload into own folder" on storage.objects;
create policy "kickrolls upload into own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'kickrolls' and (storage.foldername(name))[1] = auth.uid()::text and now() < public.ko26_deadline());
drop policy if exists "kickrolls delete own" on storage.objects;
create policy "kickrolls delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'kickrolls' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- moderation (run by hand when needed) ----------
-- hide a video:     update public.kickrolls set hidden = true where id = '...';
-- see reported:     select k.*, count(*) from public.reports p join public.kickrolls k on k.id = p.kickroll_id group by k.id order by 2 desc;

-- =====================================================================
-- Visitor analytics (anonymous) + admin dashboard at /login/
-- =====================================================================
-- Each browser gets a random visitor id (no names, no IPs). Anyone can add a visit row; only admins can read them.

create table if not exists public.visits (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  visitor_id  uuid not null,
  first_visit boolean not null default false,
  page        text not null check (char_length(page) <= 40),
  referrer    text check (char_length(referrer) <= 120),
  device      text check (device in ('phone', 'tablet', 'desktop')),
  lang        text check (char_length(lang) <= 20)
);
create index if not exists visits_created_idx on public.visits (created_at);
create index if not exists visits_visitor_idx on public.visits (visitor_id);

create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admins enable row level security;
drop policy if exists "admins see themselves" on public.admins;
create policy "admins see themselves" on public.admins for select to authenticated using (user_id = auth.uid());

create or replace function public.ko26_is_admin() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.admins where user_id = auth.uid())
$fn$;

alter table public.visits enable row level security;
drop policy if exists "anyone logs a visit" on public.visits;
create policy "anyone logs a visit" on public.visits for insert to anon, authenticated
  with check (created_at > now() - interval '5 minutes' and created_at < now() + interval '5 minutes');
drop policy if exists "admins read visits" on public.visits;
create policy "admins read visits" on public.visits for select to authenticated using (public.ko26_is_admin());

-- One call returns everything the dashboard shows. Times are bucketed in Sydney time.
create or replace function public.ko26_stats(days integer default 30) returns json
language plpgsql stable security definer set search_path = public as $fn$
declare since timestamptz := now() - make_interval(days => greatest(1, least(days, 365)));
begin
  if not public.ko26_is_admin() then raise exception 'not allowed'; end if;
  return json_build_object(
    'generated_at', now(),
    'totals', (select json_build_object(
        'visitors_all', (select count(distinct visitor_id) from visits),
        'views_all', (select count(*) from visits),
        'visitors_today', (select count(distinct visitor_id) from visits where created_at >= date_trunc('day', now() at time zone 'Australia/Sydney') at time zone 'Australia/Sydney'),
        'visitors_7d', (select count(distinct visitor_id) from visits where created_at > now() - interval '7 days'),
        'visitors_30d', (select count(distinct visitor_id) from visits where created_at > now() - interval '30 days'),
        'active_now', (select count(distinct visitor_id) from visits where created_at > now() - interval '5 minutes'),
        'returning_all', (select count(*) from (select visitor_id from visits group by visitor_id
                                                having count(distinct (created_at at time zone 'Australia/Sydney')::date) > 1) r))),
    'daily', (select coalesce(json_agg(d order by d.day), '[]') from (
        select (v.created_at at time zone 'Australia/Sydney')::date as day,
               count(distinct v.visitor_id) as visitors,
               count(distinct v.visitor_id) filter (where f.first_day = (v.created_at at time zone 'Australia/Sydney')::date) as new_visitors,
               count(*) as views
        from visits v
        join (select visitor_id, min((created_at at time zone 'Australia/Sydney')::date) as first_day from visits group by visitor_id) f using (visitor_id)
        where v.created_at > since group by 1) d),
    'pages', (select coalesce(json_agg(p order by p.views desc), '[]') from (
        select page, count(*) as views, count(distinct visitor_id) as visitors from visits where created_at > since group by page) p),
    'devices', (select coalesce(json_agg(x order by x.visitors desc), '[]') from (
        select coalesce(device, 'unknown') as device, count(distinct visitor_id) as visitors from visits where created_at > since group by 1) x),
    'referrers', (select coalesce(json_agg(x order by x.visitors desc), '[]') from (
        select coalesce(nullif(referrer, ''), 'direct') as referrer, count(distinct visitor_id) as visitors from visits where created_at > since group by 1 limit 15) x),
    'hours', (select coalesce(json_agg(x order by x.hour), '[]') from (
        select extract(hour from created_at at time zone 'Australia/Sydney')::int as hour, count(*) as views from visits where created_at > since group by 1) x),
    'kickrolls', (select json_build_object(
        'videos', (select count(*) from kickrolls), 'ratings', (select count(*) from ratings),
        'uploaders', (select count(distinct owner) from kickrolls), 'reported', (select count(distinct kickroll_id) from reports)))
  );
end $fn$;
revoke all on function public.ko26_stats(integer) from public, anon;
grant execute on function public.ko26_stats(integer) to authenticated;

-- Make yourself the admin: sign up once on the /login/ page with your email and a password,
-- then run this with YOUR email (not stored anywhere else):
--   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
