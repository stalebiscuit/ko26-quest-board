You are a research worker for a fan planner for Knockout Outdoor 2026 (hardstyle/hardcore festival, Sydney, Sat 3 Oct 2026). Today is 2 Oct 2026. Do NOT edit, commit or push anything in the repository. Your only deliverable is a JSON block in your final message.

Goal: the app plays every song in-app via Spotify embeds (open.spotify.com/embed/track/<id>) and YouTube embeds, so we need real IDs.

## Rules
- The sandbox and WebFetch CANNOT reach spotify/deezer/youtube/soundcloud/1001tracklists. Use the WebSearch tool: Spotify track/album URLs and YouTube watch URLs show up directly in result links. You have ~190 searches; use them, one track per search is fine. Query forms that work: `"<title>" <main artist> spotify`, `<artist> <title> open.spotify.com track`, `<artist> <title> youtube`. For clips: `<artist> <title> id`, `... instagram`, `... tiktok`, `... soundcloud`.
- NEVER invent an ID. Only record a Spotify track ID (22-char base62) or YouTube ID (11-char) you literally saw in a result URL whose title matches the song (right artist AND right version: a "(X Remix)" must be that remix; a live "Edit" is NOT the original). If unsure, null + `note`.
- Spotify album URLs in results tell you the release (single/EP/album) — record as `album`.

## Tasks (todo list at the bottom)
1. `released`: find the Spotify track ID (+ album {id,name,type single|ep|album}, release_date). If `current_yt` is null, look for an official YouTube upload too. If it turns out NOT to be released, set status "unreleased".
2. `unreleased`: check whether it has been released since (2026 releases happen constantly) → status "released" + spotify info. Otherwise look for any posted clip (YouTube/Shorts, Instagram reel, TikTok, SoundCloud). Prioritise kind "ID"/"unreleased"/"tool" over "edit"/"mashup"; for edits/mashups just do one quick search for a SoundCloud/YouTube upload of the edit.
3. `new_releases`: each act's releases from ~May–Oct 2026 not in their list (skip titles in already_found_new_releases). Include spotify track id, album, release_date, yt if seen.

## Final message format
Your final message must be a single ```json fenced block, nothing else, shaped:
{"<Act>": {"released":[{"i":0,"status":"released","spotify_track":"id|null","album":{"id":"..","name":"..","type":"single"},"release_date":"YYYY-MM-DD|null","yt":{"id":"..","channel":".."},"evidence":"url","note":""}],
"unreleased":[{"i":0,"status":"unreleased","spotify_track":null,"clip":{"type":"youtube|instagram|tiktok|soundcloud","url":"..","yt_id":"11char|null"},"evidence":"url","note":""}],
"new_releases":[{"artist":"..","title":"..","spotify_track":"..","album":{..},"release_date":"..","yt":{..},"evidence":"url"}]}}
Only include entries you actually found something for (or a note worth keeping). Keep it compact.

## Todo
Your todo file is research/todo/rN.json in this repo (N given in your prompt).
