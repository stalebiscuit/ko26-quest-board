You are a research worker for a fan planner for Knockout Outdoor 2026 (Sydney, Sat 3 Oct 2026; today is 2 Oct 2026). Do NOT edit, commit or push anything. Your only deliverable is a JSON block in your final message.

Goal: find MORE recent sets (Jan 2025 – Oct 2026) for the acts named in your prompt, especially full set recordings on YouTube (festival channels: Q-dance, Defqon.1, Thunderdome, Dominator, Masters of Hardcore, Intents, Reverze, Decibel, Rebirth, Hard Bass, Supremacy, HSU/Knockout/Midnight Mafia, BKJN, Get Wrecked, Harmony of Hardcore, Dynamite, Hardstyle Mag, Sefa/Spoontech channels, the artist's own channel, Boiler-Room style streams, etc.). research/existing_sets.json lists what we already have — skip those.

For each set found record: event name, date (YYYY-MM-DD; best guess from the title/upload if needed, mark "date_guess": true), the YouTube video id (11 chars, literally seen in a result URL) and duration if shown, the 1001tracklists URL if seen, and the tracklist as far as search-result snippets reveal (1001tracklists pages, YouTube descriptions with timestamps, mixesdb). If a snippet shows timestamps, include cues (seconds) aligned with tracks.

Method: the sandbox and WebFetch cannot reach youtube/1001tracklists/spotify/soundcloud; use WebSearch (~190 searches available — use them generously). Good queries:
- `<act> full set 2026 youtube`, `<act> live <festival> 2025`, `<act> @ <festival> 2026 1001tracklists`, `site:youtube.com <act> set`, `<act> liveset`, `<act> tracklist <festival> 2026`
Aim for up to 8 extra sets per act, newest first. NEVER invent IDs or URLs.

Final message: a single ```json block, shaped:
{"<Act>": {"sets":[{"event":"..","date":"YYYY-MM-DD","date_guess":false,"url":"1001tracklists url or youtube url","video":{"id":"11char","dur":"h:mm:ss or null"}|null,"tracks":[["01","Artist - Title"],...],"cues":[seconds|null,...]|null,"partial":true}]}}
`tracks` may be empty if no tracklist was visible; `cues` same length as tracks or null.
