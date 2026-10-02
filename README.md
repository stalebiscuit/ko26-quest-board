# Chef's KO26 Quest Board

A one-page planner for Knockout Outdoor 2026 (Level Up, Sat 3 Oct 2026, ENGIE Stadium, Sydney Showground). It has the set-times poster, an artist sheet for each act (released tracks with previews, unreleased tracks and IDs, source sets), KR (kick roll) picks, and a Player card. Picks are saved in your browser.

Live site: https://stalebiscuit.github.io/ko26-quest-board/

## Updating

Data lives in the script block with id ko-data near the end of index.html, as JSON with slots and artists. To swap the header logo, change const LOGO = 1 in the main script to 1, 2, 3 or 4. Each act's emblem is a symbol with id em-SLUG in the hidden SVG block.

## Credits

Set times from HSU Events' official KO26 timetable. Tracklists from 1001Tracklists. 30-second previews from the Deezer public API; full tracks link to Spotify. Emblems are original artwork, not official artist logos.

## v3 notes

The poster header comes from one EVENT config object in the main script, so the board can be re-skinned for another rave. Released vs unreleased was checked against Deezer, plus SoundCloud and YouTube spot checks; each released track links to its proof. The Sets tab lists every song from each source set with cue times, and sets with a video posted on 1001Tracklists embed it so you can jump to any song.

## v5 notes

Player card sharing. Put your name on the card, then hit Share card. It makes an image of your run with a QR code, and opens your phone's share sheet (or saves the image). Copy link gives a link with the whole run packed into it. Your friend opens the link, scans the QR, or uses Load a card on the image you sent. They see your run next to theirs ("with you", "you too" on shared KR songs) and can save you to their crew. Crew members then show as "with <name>" on their own run. Nothing is uploaded anywhere: the run lives in the link and inside the image.

In-app listening. Tracks with a real Spotify ID have a Spotify button that plays in the now-playing bar: whole songs if you're signed in to Spotify in that browser, 30s otherwise. Official YouTube uploads still play full length. The Released tab can group tracks by EP or album (singles share one heading), with a play button for each release. Unreleased IDs that have a posted clip (YouTube, SoundCloud, TikTok, Instagram) get a clip button that embeds it under the row.

Data. data2.json is the same data as the ko-data block. Spotify track IDs, releases, 2026 new releases, clips and extra set videos were researched by parallel web-search agents. They only recorded IDs they saw in real Spotify or YouTube URLs. The research inputs are in research/.
