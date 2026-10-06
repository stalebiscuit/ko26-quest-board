# EPIK 2026 artist data pass (same standard as KO26)

Read /home/user/ko26-quest-board/CLAUDE.md ("Artist data standard") first. EPIK 2026 is HSU Events, Sat 12 Dec 2026, Sydney Showground. Today is 6 Oct 2026.

Input: `_kit/build/epik26/artists.json` (current data per act: sets with 1001TL urls and tracks, released/unreleased lists with search-only Spotify links and Deezer previews).
Target format: exactly the KO26 artist object in `ko26.html` (`<script id="ko-data">` → `artists[<Act>]`). Study 2–3 KO26 acts there first (e.g. Suae, Rebelion, Weaver; all three are also on EPIK, so reuse their verified KO26 data and add newer material).

For each act you own, write `_kit/build/epik26/verified/<Act>.json` = one artist object with these fields:
- `sets`: [{event, date, url (1001TL), tracks:[[pos,"Artist - Title"]], video:{id,dur}|null, cues:[sec|null...]|null}]. Find the YouTube recording of each set (and add recent YouTube sets that have tracklists or are notable, from the last ~12 months, at most ~6 sets per act). Use cues when a timestamped tracklist exists.
- `released`: [{artist,title,plays,sets:[set indexes],spotify:"https://open.spotify.com/track/<id>", sp:"<id>", album:{id,name,type}, release_date, yt:{id,channel,dur}|null, source, proof}]. Every released track needs a real Spotify track id so it plays in full in-app. Check Spotify, and SoundCloud/YouTube for official uploads.
- `unreleased`: [{artist,title,plays,sets,kind:"unreleased"|"ID"|"edit"|"mashup"|"tool", ref:{label,url}, checked:["spotify","soundcloud","youtube"], clip:{type,url,yt_id}|null}]. Verify each is really still unreleased (search Spotify, SoundCloud, YouTube). If it's out, move it to released with ids.
- `unknown_ids`: count, `own_note`: short honest note if relevant.
Also include the act's own 2026 releases (singles/EPs) even if not played in a set yet (`plays:0, sets:[]`).

How to reach the services from this container:
- curl/urllib can reach youtube.com (search results page `ytInitialData`, `youtube.com/oembed`, watch page descriptions for timestamped tracklists) and Spotify's web endpoints (anonymous token + search; see tools/data/spfind.py for a working method, and tools/data/verify.py for checking ids via open.spotify.com/embed/track/<id> and YouTube oembed; tools/data/ytsets.py for YouTube set search). Those scripts have hard-coded paths for the KO26 run; copy the techniques, don't run them as-is.
- Deezer API (api.deezer.com) works for previews/release types.
- WebFetch can often read www.1001tracklists.com pages (ask it for "every track row with its position number"). If it's blocked, keep the existing tracks.
- WebSearch is limited; use it sparingly.

Rules: never invent an id, track or link; only record ids you actually saw for the right artist AND version (a remix/edit is not the original). Validate your JSON (`python3 -m json.tool`). Don't edit any other files, don't run build.py, don't commit.

Final reply: per act, counts (sets with video, released with Spotify id, unreleased confirmed, moved to released) and anything you couldn't verify.
