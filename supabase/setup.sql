-- KO26 Kickroll Leaderboard: run this once in Supabase → SQL Editor → New query → paste ALL of it → Run
-- (with nothing highlighted: if any text is selected, Supabase runs only the selection).
-- Safe to run again after changes: it updates what's already there.
--
-- Accounts: posting and rating need a real account (email + password, email confirmed). Supabase Auth stores
-- passwords as bcrypt hashes; this site never sees or stores them. Browsing needs no account.
-- New uploads wait in a review queue (status 'pending') until approved in the /login/ dashboard; people who've
-- had a video approved are trusted and their next uploads go live straight away.
-- Voting and uploads close 7 days after the rave: 10 Oct 2026, 23:59 Sydney time.
-- To change it, edit ko26_deadline() below and KO_CONFIG.deadline in ko-config.js.

create or replace function public.ko26_deadline() returns timestamptz
language sql immutable as $fn$ select timestamptz '2026-10-10 23:59:59+11' $fn$;

-- a signed-in, non-anonymous account (anonymous sign-ins, if ever switched on, can't post or vote)
create or replace function public.ko26_is_member() returns boolean
language sql stable as $fn$
  select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$fn$;

create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admins enable row level security;
drop policy if exists "admins see themselves" on public.admins;
create policy "admins see themselves" on public.admins for select to authenticated using (user_id = auth.uid());

create or replace function public.ko26_is_admin() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.admins where user_id = auth.uid())
$fn$;

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
alter table public.kickrolls add column if not exists status text not null default 'pending';
alter table public.kickrolls add column if not exists reviewed_at timestamptz;
alter table public.kickrolls add column if not exists review_note text;
alter table public.kickrolls drop constraint if exists kickrolls_status_check;
alter table public.kickrolls add constraint kickrolls_status_check check (status in ('pending', 'approved', 'rejected'));
-- no links or spam in names and captions
alter table public.kickrolls drop constraint if exists kickrolls_no_links;
alter table public.kickrolls add constraint kickrolls_no_links check (
  coalesce(caption, '') !~* '(https?://|www\.|\.(com|net|org|io|ru|xyz|ly|gg)\y|t\.me/|@[a-z0-9_.]{3,}\.)'
  and name !~* '(https?://|www\.|\.(com|net|org|io|ru|xyz)\y)');
create index if not exists kickrolls_song_idx on public.kickrolls (song_key);
create index if not exists kickrolls_act_idx on public.kickrolls (act);
create index if not exists kickrolls_status_idx on public.kickrolls (status);
-- one video per person per song (delete yours to post a better take)
create unique index if not exists kickrolls_one_per_song on public.kickrolls (owner, song_key);

-- ---------- linked posts: a TikTok / Instagram post instead of an upload ----------
alter table public.kickrolls add column if not exists source text not null default 'upload';
alter table public.kickrolls add column if not exists external_url text;
alter table public.kickrolls add column if not exists external_id text;
alter table public.kickrolls add column if not exists handle text;
alter table public.kickrolls add column if not exists thumb_url text;
alter table public.kickrolls alter column path drop not null;
alter table public.kickrolls alter column mime drop not null;
alter table public.kickrolls alter column size_bytes drop not null;
alter table public.kickrolls drop constraint if exists kickrolls_source_check;
alter table public.kickrolls add constraint kickrolls_source_check check (
  (source = 'upload' and path is not null and mime is not null and size_bytes is not null)
  or (source = 'tiktok' and external_url ~ '^https://([a-z]+\.)?tiktok\.com/' and path is null)
  or (source = 'instagram' and external_url ~ '^https://(www\.)?instagram\.com/(reel|reels|p|tv)/[A-Za-z0-9_-]+' and path is null));
alter table public.kickrolls drop constraint if exists kickrolls_link_fields;
alter table public.kickrolls add constraint kickrolls_link_fields check (
  char_length(coalesce(external_url, '')) <= 300 and char_length(coalesce(external_id, '')) <= 64
  and coalesce(handle, '') ~ '^[A-Za-z0-9._]{0,30}$' and coalesce(thumb_url, '') ~ '^(https://\S+)?$' and char_length(coalesce(thumb_url, '')) <= 1000);
-- the same post can only be entered once, by anyone (stops people claiming someone else's video twice over)
create unique index if not exists kickrolls_one_external on public.kickrolls (source, external_id) where external_id is not null;
create unique index if not exists kickrolls_one_external_url on public.kickrolls (external_url) where external_url is not null;

-- ---------- profiles: the socials people link to their account ----------
create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tiktok     text check (tiktok ~ '^[A-Za-z0-9._]{2,24}$'),
  instagram  text check (instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "write own profile" on public.profiles;
create policy "write own profile" on public.profiles for insert to authenticated with check (public.ko26_is_member() and user_id = auth.uid());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- star ratings: one per account per video ----------
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

-- ---------- scores (what the public pages read): approved, not hidden, under 3 reports ----------
drop view if exists public.kickroll_scores;
create view public.kickroll_scores with (security_invoker = on) as
select k.id, k.created_at, k.owner, k.act, k.song_key, k.song, k.name, k.caption, k.path, k.mime, k.size_bytes,
       k.source, k.external_url, k.external_id, k.handle, k.thumb_url, pr.tiktok as owner_tiktok, pr.instagram as owner_instagram,
       coalesce(round(avg(r.stars)::numeric, 2), 0) as avg_stars,
       count(r.stars)::int as votes,
       (select count(*) from public.reports p where p.kickroll_id = k.id)::int as report_count
from public.kickrolls k
left join public.ratings r on r.kickroll_id = k.id
left join public.profiles pr on pr.user_id = k.owner
where not k.hidden and k.status = 'approved'
group by k.id, pr.user_id
having (select count(*) from public.reports p where p.kickroll_id = k.id) < 3;

-- ---------- row level security ----------
alter table public.kickrolls enable row level security;
alter table public.ratings   enable row level security;
alter table public.reports   enable row level security;

drop policy if exists "read videos" on public.kickrolls;
create policy "read videos" on public.kickrolls for select to anon, authenticated
  using ((status = 'approved' and not hidden) or owner = auth.uid() or public.ko26_is_admin());
drop policy if exists "upload own video before deadline" on public.kickrolls;
create policy "upload own video before deadline" on public.kickrolls for insert to authenticated
  with check (public.ko26_is_member() and owner = auth.uid() and now() < public.ko26_deadline() and hidden = false
              and ((source = 'upload' and path like auth.uid()::text || '/%') or (source <> 'upload' and path is null)));
drop policy if exists "delete own video" on public.kickrolls;
create policy "delete own video" on public.kickrolls for delete to authenticated using (owner = auth.uid() or public.ko26_is_admin());

drop policy if exists "read ratings" on public.ratings;
create policy "read ratings" on public.ratings for select to anon, authenticated using (true);
drop policy if exists "rate before deadline, not your own" on public.ratings;
create policy "rate before deadline, not your own" on public.ratings for insert to authenticated
  with check (public.ko26_is_member() and rater = auth.uid() and now() < public.ko26_deadline()
              and exists (select 1 from public.kickrolls k where k.id = kickroll_id and k.owner <> auth.uid() and k.status = 'approved'));
drop policy if exists "change own rating before deadline" on public.ratings;
create policy "change own rating before deadline" on public.ratings for update to authenticated
  using (rater = auth.uid()) with check (public.ko26_is_member() and rater = auth.uid() and now() < public.ko26_deadline());

drop policy if exists "read reports" on public.reports;
create policy "read reports" on public.reports for select to anon, authenticated using (true);
drop policy if exists "report once" on public.reports;
create policy "report once" on public.reports for insert to authenticated with check (public.ko26_is_member() and reporter = auth.uid());

-- spam limits + review status, set by the server whatever the browser sends
create or replace function public.ko26_upload_limit() returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if (select count(*) from public.kickrolls where owner = new.owner and created_at > now() - interval '1 day') >= 5 then
    raise exception 'upload limit reached (5 a day). try again tomorrow';
  end if;
  if (select count(*) from public.kickrolls where owner = new.owner and created_at > now() - interval '2 minutes') >= 1 then
    raise exception 'slow down: one upload every 2 minutes';
  end if;
  if exists (select 1 from public.kickrolls where owner = new.owner and status = 'rejected' and reviewed_at > now() - interval '1 day') then
    raise exception 'a recent upload of yours was rejected, so uploads are paused for a day';
  end if;
  new.hidden := false; new.reviewed_at := null; new.review_note := null;
  new.status := case when exists (select 1 from public.kickrolls where owner = new.owner and status = 'approved')
                      and not exists (select 1 from public.kickrolls where owner = new.owner and status = 'rejected')
                     then 'approved' else 'pending' end;
  return new;
end $fn$;
drop trigger if exists ko26_upload_limit on public.kickrolls;
create trigger ko26_upload_limit before insert on public.kickrolls for each row execute function public.ko26_upload_limit();

-- review queue: admins approve or reject (from the /login/ dashboard)
create or replace function public.ko26_moderate(kickroll uuid, approve boolean, note text default null) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.ko26_is_admin() then raise exception 'not allowed'; end if;
  update public.kickrolls set status = case when approve then 'approved' else 'rejected' end,
         hidden = case when approve then false else hidden end,
         reviewed_at = now(), review_note = left(note, 200)
   where id = kickroll;
end $fn$;
revoke all on function public.ko26_moderate(uuid, boolean, text) from public, anon;
-- the reviewer fills in a linked post's real video id / handle / cover once it has expanded a short link
create or replace function public.ko26_set_link(kickroll uuid, ext_id text, ext_url text, ext_handle text, thumb text) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.ko26_is_admin() then raise exception 'not allowed'; end if;
  update public.kickrolls set external_id = coalesce(ext_id, external_id), external_url = coalesce(ext_url, external_url),
         handle = coalesce(ext_handle, handle), thumb_url = coalesce(thumb, thumb_url)
   where id = kickroll and source <> 'upload';
end $fn$;
revoke all on function public.ko26_set_link(uuid, text, text, text, text) from public, anon;
grant execute on function public.ko26_set_link(uuid, text, text, text, text) to authenticated;
grant execute on function public.ko26_moderate(uuid, boolean, text) to authenticated;

-- ---------- video storage: public bucket, 50 MB per file, video only ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kickrolls', 'kickrolls', true, 52428800, array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kickrolls upload into own folder" on storage.objects;
create policy "kickrolls upload into own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'kickrolls' and public.ko26_is_member() and (storage.foldername(name))[1] = auth.uid()::text and now() < public.ko26_deadline());
drop policy if exists "kickrolls delete own" on storage.objects;
create policy "kickrolls delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'kickrolls' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- groups: invite friends, compare kickrolls on a group leaderboard ----------
create table if not exists public.ko_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40 and name !~* '(https?://|www\.)'),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_at  timestamptz not null default now()
);
create table if not exists public.ko_group_members (
  group_id  uuid not null references public.ko_groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists ko_group_members_user_idx on public.ko_group_members (user_id);
alter table public.ko_groups enable row level security;
alter table public.ko_group_members enable row level security;
-- direct reads only of your own groups / co-members; every change goes through the functions below
create or replace function public.ko26_in_group(g uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.ko_group_members where group_id = g and user_id = auth.uid())
$fn$;
drop policy if exists "members read their groups" on public.ko_groups;
create policy "members read their groups" on public.ko_groups for select to authenticated using (public.ko26_in_group(id));
drop policy if exists "members read co-members" on public.ko_group_members;
create policy "members read co-members" on public.ko_group_members for select to authenticated using (public.ko26_in_group(group_id));

create or replace function public.ko26_group_create(gname text) returns json
language plpgsql security definer set search_path = public as $fn$
declare g public.ko_groups;
begin
  if not public.ko26_is_member() then raise exception 'sign in to make a group'; end if;
  if (select count(*) from public.ko_groups where owner = auth.uid()) >= 5 then raise exception 'you can own up to 5 groups'; end if;
  if (select count(*) from public.ko_group_members where user_id = auth.uid()) >= 15 then raise exception 'you can be in up to 15 groups'; end if;
  insert into public.ko_groups (name, owner) values (trim(gname), auth.uid()) returning * into g;
  insert into public.ko_group_members (group_id, user_id) values (g.id, auth.uid());
  return json_build_object('id', g.id, 'name', g.name, 'code', g.invite_code);
end $fn$;

create or replace function public.ko26_group_join(code text) returns json
language plpgsql security definer set search_path = public as $fn$
declare g public.ko_groups;
begin
  if not public.ko26_is_member() then raise exception 'sign in to join a group'; end if;
  select * into g from public.ko_groups where invite_code = upper(trim(code));
  if g.id is null then raise exception 'that invite code is not valid (it may have been changed)'; end if;
  if (select count(*) from public.ko_group_members where user_id = auth.uid()) >= 15 then raise exception 'you can be in up to 15 groups'; end if;
  if (select count(*) from public.ko_group_members where group_id = g.id) >= 100 then raise exception 'that group is full (100 members)'; end if;
  insert into public.ko_group_members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  return json_build_object('id', g.id, 'name', g.name);
end $fn$;

create or replace function public.ko26_my_groups() returns json
language sql stable security definer set search_path = public as $fn$
  select coalesce(json_agg(x order by x.joined_at desc), '[]') from (
    select g.id, g.name, case when g.owner = auth.uid() then g.invite_code end as code, g.invite_code as invite,
           (g.owner = auth.uid()) as is_owner, m.joined_at,
           (select count(*) from public.ko_group_members m2 where m2.group_id = g.id) as members
    from public.ko_group_members m join public.ko_groups g on g.id = m.group_id
    where m.user_id = auth.uid()) x
$fn$;

-- the group leaderboard: per member, approved kickrolls, stars received, votes, best kickroll (Bayesian, same as the site)
create or replace function public.ko26_group_board(g uuid) returns json
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.ko26_in_group(g) then raise exception 'you are not in that group'; end if;
  return (select json_build_object(
    'group', (select json_build_object('id', id, 'name', name, 'invite', invite_code, 'is_owner', owner = auth.uid(), 'owner', owner) from public.ko_groups where id = g),
    'members', (select coalesce(json_agg(r order by r.best_score desc nulls last, r.avg_stars desc, r.posts desc, r.joined_at), '[]') from (
      select m.user_id, m.joined_at, (m.user_id = auth.uid()) as is_me,
             coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), (select k.name from public.kickrolls k where k.owner = m.user_id order by k.created_at desc limit 1), 'Raver') as name,
             pr.tiktok, pr.instagram,
             (select count(*) from public.kickroll_scores s where s.owner = m.user_id) as posts,
             (select round(avg(r.stars)::numeric, 2) from public.ratings r join public.kickroll_scores s on s.id = r.kickroll_id where s.owner = m.user_id) as avg_stars,
             (select coalesce(sum(s.votes), 0) from public.kickroll_scores s where s.owner = m.user_id) as votes,
             (select max((3.5 * 3 + s.avg_stars * s.votes) / (3 + s.votes)) from public.kickroll_scores s where s.owner = m.user_id and s.votes > 0) as best_score,
             (select json_build_object('id', s.id, 'song', s.song, 'act', s.act, 'avg', s.avg_stars, 'votes', s.votes)
                from public.kickroll_scores s where s.owner = m.user_id and s.votes > 0
               order by (3.5 * 3 + s.avg_stars * s.votes) / (3 + s.votes) desc limit 1) as best,
             (select count(*) from public.ratings r where r.rater = m.user_id) as ratings_given
      from public.ko_group_members m
      join auth.users u on u.id = m.user_id
      left join public.profiles pr on pr.user_id = m.user_id
      where m.group_id = g) r)
  ));
end $fn$;

create or replace function public.ko26_group_leave(g uuid) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if exists (select 1 from public.ko_groups where id = g and owner = auth.uid()) then
    raise exception 'you own this group: delete it instead, or it stays yours';
  end if;
  delete from public.ko_group_members where group_id = g and user_id = auth.uid();
end $fn$;

create or replace function public.ko26_group_admin(g uuid, action text, target uuid default null, new_name text default null) returns json
language plpgsql security definer set search_path = public as $fn$
declare c text;
begin
  if not exists (select 1 from public.ko_groups where id = g and owner = auth.uid()) then raise exception 'only the group owner can do that'; end if;
  if action = 'remove' then
    if target = auth.uid() then raise exception 'you can''t remove yourself'; end if;
    delete from public.ko_group_members where group_id = g and user_id = target;
  elsif action = 'new_code' then
    update public.ko_groups set invite_code = upper(substr(md5(gen_random_uuid()::text), 1, 8)) where id = g returning invite_code into c;
    return json_build_object('code', c);
  elsif action = 'rename' then
    update public.ko_groups set name = trim(new_name) where id = g;
  elsif action = 'delete' then
    delete from public.ko_groups where id = g;
  else raise exception 'unknown action';
  end if;
  return '{}'::json;
end $fn$;

revoke all on function public.ko26_group_create(text), public.ko26_group_join(text), public.ko26_my_groups(), public.ko26_group_board(uuid),
  public.ko26_group_leave(uuid), public.ko26_group_admin(uuid, text, uuid, text) from public, anon;
grant execute on function public.ko26_group_create(text), public.ko26_group_join(text), public.ko26_my_groups(), public.ko26_group_board(uuid),
  public.ko26_group_leave(uuid), public.ko26_group_admin(uuid, text, uuid, text) to authenticated;

-- ---------- song ratings: rate the tracks themselves; your groups see each other's ----------
create table if not exists public.song_ratings (
  song_key   text not null check (char_length(song_key) between 1 and 300),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  act        text not null check (char_length(act) between 1 and 80),
  song       text not null check (char_length(song) between 1 and 300),
  stars      smallint not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (song_key, user_id)
);
create index if not exists song_ratings_user_idx on public.song_ratings (user_id);
alter table public.song_ratings enable row level security;
create or replace function public.ko26_shares_group(other uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select other = auth.uid() or exists (select 1 from public.ko_group_members a join public.ko_group_members b on a.group_id = b.group_id
                                        where a.user_id = auth.uid() and b.user_id = other)
$fn$;
drop policy if exists "see own and group mates' song ratings" on public.song_ratings;
create policy "see own and group mates' song ratings" on public.song_ratings for select to authenticated using (public.ko26_shares_group(user_id));
drop policy if exists "rate songs" on public.song_ratings;
create policy "rate songs" on public.song_ratings for insert to authenticated with check (public.ko26_is_member() and user_id = auth.uid());
drop policy if exists "change own song ratings" on public.song_ratings;
create policy "change own song ratings" on public.song_ratings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove own song ratings" on public.song_ratings;
create policy "remove own song ratings" on public.song_ratings for delete to authenticated using (user_id = auth.uid());

-- every song a group's members rated: group average + each member's stars
create or replace function public.ko26_group_songs(g uuid) returns json
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.ko26_in_group(g) then raise exception 'you are not in that group'; end if;
  return (select coalesce(json_agg(x order by x.avg desc, x.n desc, x.song), '[]') from (
    select sr.song_key, max(sr.act) as act, max(sr.song) as song, round(avg(sr.stars)::numeric, 2) as avg, count(*) as n,
           json_agg(json_build_object('user_id', sr.user_id, 'stars', sr.stars,
             'name', coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), 'Raver'), 'is_me', sr.user_id = auth.uid()) order by sr.stars desc) as ratings
    from public.song_ratings sr
    join public.ko_group_members m on m.user_id = sr.user_id and m.group_id = g
    join auth.users u on u.id = sr.user_id
    group by sr.song_key) x);
end $fn$;
-- one song: your rating and your group mates' (with names), for the leaderboard's song view
create or replace function public.ko26_song_mates(key text) returns json
language sql stable security definer set search_path = public as $fn$
  select coalesce(json_agg(json_build_object('user_id', sr.user_id, 'stars', sr.stars, 'is_me', sr.user_id = auth.uid(),
           'name', coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), 'Raver')) order by (sr.user_id = auth.uid()) desc, sr.stars desc), '[]')
  from public.song_ratings sr join auth.users u on u.id = sr.user_id
  where sr.song_key = key and public.ko26_shares_group(sr.user_id)
$fn$;
revoke all on function public.ko26_group_songs(uuid), public.ko26_song_mates(text) from public, anon;
grant execute on function public.ko26_group_songs(uuid), public.ko26_song_mates(text) to authenticated;

-- ---------- moderation by hand ----------
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
        'uploaders', (select count(distinct owner) from kickrolls), 'reported', (select count(distinct kickroll_id) from reports),
        'pending', (select count(*) from kickrolls where status = 'pending'), 'members', (select count(*) from auth.users where not coalesce(is_anonymous, false))))
  );
end $fn$;
revoke all on function public.ko26_stats(integer) from public, anon;
grant execute on function public.ko26_stats(integer) to authenticated;

-- Make yourself the admin: sign up once (on the /login/ page or the leaderboard) with your email and a password,
-- then run this with YOUR email (not stored anywhere else):
--   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
