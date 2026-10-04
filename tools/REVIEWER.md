# Automatic kickroll reviewer

A scheduled Claude cloud task runs every hour. It reviews new uploads and anything people reported, then approves or rejects them. Results show up in the dashboard's "Recently reviewed" list, with notes starting "auto:". You can override any decision from the dashboard.

## The rules it applies

**Approve** a video when the frames show at least one person dancing: a kickroll, shuffle, hardstyle or rawstyle dance, or other rave dancing. It can be at a festival, a party, at home or outside. Crowd shots with someone clearly dancing count, and so do funny or low-quality clips.

**Reject** a video, with a short reason, when it is:
- spam, an advert, a QR code, or a screen that's mostly text or links
- a slideshow or a still image
- unrelated content with no dancing at all (a car, a meme, a screenshot)
- nudity or sexual content
- violence, gore, weapons, drug use as the focus, hate symbols or harassment
- a filmed screen of someone else's video
- a minor in an unsafe situation

**Leave it pending** when it can't tell: a broken video, frames too dark to judge, or a genuine borderline case. The owner decides those in the dashboard.

## Setup (once)
1. Make your admin account (the dashboard at /login/, or the leaderboard's sign-up), then run the admin SQL line in Supabase.
2. In the cloud environment's settings (environment menu → Edit → environment variables), add `KO26_MOD_EMAIL` and `KO26_MOD_PASSWORD` with that account's login. Never put them in the repo or in chat.

## Linked TikTok and Instagram posts
Some kickrolls are links to a TikTok or Instagram post rather than uploaded files. `fetch` returns these with `source`, `post`, `post_handle`, `post_title` and `cover_image`:
- **TikTok:** `fetch` expands short links (vm.tiktok.com) and saves the real video id. Judge the post from its cover image (one frame) plus its TikTok title or caption. Approve if the cover shows someone dancing or a rave, and nothing in the title contradicts it. If the cover isn't enough to tell, leave it pending.
- **TikTok link that can't be found** (deleted or private, `note` says so): reject it with "TikTok post not found or private".
- **Instagram:** there's no cover image to check, so leave it pending for the owner, unless the caption or name is plainly spam or abuse, in which case reject it.
- **Someone else's video:** if `post_handle` clearly belongs to a different person than the uploader and a report says the video was stolen, reject it with "posted by someone other than the creator".
