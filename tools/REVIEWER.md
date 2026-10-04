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
