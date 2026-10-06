# Chef's Quest Boards: rules for every session

Read this before touching the site. These are Scott's standing rules; follow them on every change.

## The site
- Static GitHub Pages site (repo root). Supabase backend (see `supabase/setup.sql`, `ko-supa.js`, `ko-config.js`).
- `index.html` is the landing page: one key-art card per rave, newest first (`EDITIONS` list at the bottom).
- Each rave has its own **quest board** (`ko26.html`, `epik26/index.html`, ...), plus its own **Leaderboard** and **Gallery** (kickroll videos for that rave's songs).
- **Groups are global**, not tied to a rave. They're linked from the landing page and work across every rave.
- How to add the next rave: `PLAYBOOK.md`. Every new rave gets the full feature set: board, leaderboard, gallery, and its songs in groups. No rave ships with only a board.

## Look and layout
- Every page uses the same header: chef logo, eyebrow, title, then the nav. Their positions match on every page, so nothing jumps when you switch pages. Rave boards don't have a separate banner image on top; the key art lives on the landing card.
- It has to work on a phone at the rave: 16px side gutters, no sideways scroll. Test at 360, 390 and 1280 wide.
- Key art and event branding: use HSU's official logo files in `assets/`. Never redraw or alter an official logo. EPIK is ominous: near-black, red smoke, no lasers, no act icons.
- The lineup poster board (EPIK style) uses HSU's exact poster. Only overlay clickable blocks.

## Boards
- Single-stage raves (most HSU events): there's no "lock in" or "+" on acts. The player card auto-includes every act on the lineup. Multi-stage timetables (like KO26) keep picks and clash checks.
- MCs and hosts (e.g. Villain) aren't clickable and have no song sheet.

## Artist data standard (same format as KO26; see `ko26.html` `#ko-data`)
For every act on a board:
- **Released:** check Spotify, SoundCloud and YouTube. Each released song needs its Spotify track id (`sp`, `spotify`, `album`, `release_date`) so it plays in-app in full through the Spotify embed. Add the official YouTube upload (`yt: {id, channel, dur}`) where there is one. The Deezer 30-second preview is only a fallback, never the only player.
- **Unreleased and IDs:** confirm each one really is still unreleased: search Spotify, SoundCloud and YouTube. If it's out, move it to Released with its ids. Otherwise attach any posted clip (YouTube/Shorts, SoundCloud, Instagram, TikTok).
- **Sets:** every set should have its YouTube recording where one exists (`video: {id, dur}`), with track `cues` in seconds where a timestamped tracklist exists, plus the 1001Tracklists url.
- Never invent a track, id or link. Only record ids you actually saw for the right artist and version. If nothing is found, keep an honest empty state or note.
- Tools from the KO26 pass are in `tools/data/` (Spotify search, YouTube set search, id verifier). WebFetch can usually read 1001Tracklists. curl can reach YouTube and Spotify's web endpoints.

## Workflow
- **Who does what:** Claude Code (the cloud session on this repo) implements everything: code, data, builds, PRs and merges. Anything the cloud session can't reach (sites that block it, like 1001Tracklists; anything that needs a real browser, a login or Scott's computer) goes to **Claude Cowork** as a handoff file in the repo root, named `HANDOFF_COWORK*.md`. The handoff says exactly what to collect and the exact JSON to return. Scott brings the result back and Claude Code puts it into the site. Cowork never edits the repo.
- Develop on the session's `claude/...` branch, open a PR and merge it to `main` so the site updates (Scott's usual flow).
- Never push a handoff folder wholesale over the repo. Merge its changes in, because the repo has features (leaderboard, gallery, groups, accounts, dashboard) that older copies don't.
- Never put passwords, tokens or keys in the repo or chat. The moderator login only lives in the cloud environment variables `KO26_MOD_EMAIL` / `KO26_MOD_PASSWORD`. The Supabase anon key is public by design.
- Database changes go in `supabase/setup.sql` (idempotent). Scott runs it in the Supabase SQL editor, so tell him when it needs rerunning.
- Use subagents for separate concerns (data research, backend, pages) and verify their work with screenshots before merging.
