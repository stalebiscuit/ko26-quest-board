# Chef's KO26 Quest Board

A one-page planner for Knockout Outdoor 2026 (Level Up, Sat 3 Oct 2026, ENGIE Stadium, Sydney Showground). It has the set-times poster, an artist sheet for each act (released tracks with previews, unreleased tracks and IDs, source sets), KR (kick roll) picks, and a Player card. Picks are saved in your browser.

Live site: https://stalebiscuit.github.io/ko26-quest-board/

## Updating

Data lives in the script block with id ko-data near the end of index.html, as JSON with slots and artists. To swap the header logo, change const LOGO = 1 in the main script to 1, 2, 3 or 4. Each act's emblem is a symbol with id em-SLUG in the hidden SVG block.

## Credits

Set times from HSU Events' official KO26 timetable. Tracklists from 1001Tracklists. 30-second previews from the Deezer public API; full tracks link to Spotify. Emblems are original artwork, not official artist logos.

## v3 notes

The poster header comes from one EVENT config object in the main script, so the board can be re-skinned for another rave. Released vs unreleased was checked against Deezer, plus SoundCloud and YouTube spot checks; each released track links to its proof. The Sets tab lists every song from each source set with cue times, and sets with a video posted on 1001Tracklists embed it so you can jump to any song.
