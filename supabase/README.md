# Connect the kickroll leaderboard (about 5 minutes)

Until this is done, leaderboard.html and gallery.html run in demo mode: uploads and ratings stay on the device.

1. Go to https://supabase.com, sign in, and create a **New project** (the free plan is fine). Pick the Sydney region (ap-southeast-2) and any database password.
2. In the project, open **SQL Editor → New query**, paste all of `supabase/setup.sql`, and click **Run**. It creates the tables, the rating and upload rules, and the `kickrolls` video bucket (50 MB per video).
3. Open **Authentication → Sign In / Providers** and turn on **Allow anonymous sign-ins**. Visitors don't make accounts. Each browser gets a silent anonymous id, which keeps it to one rating per person per video.
4. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `ko-config.js` (`supabaseUrl`, `supabaseAnonKey`), then commit. The anon key is meant to be public; the rules in setup.sql decide what visitors can do.

Moderation: 3 reports hide a video automatically. To hide one yourself, run in SQL Editor: `update public.kickrolls set hidden = true where id = '…';`

The deadline (10 Oct 2026, 23:59 Sydney) lives in two places: `ko26_deadline()` in setup.sql and `deadline` in ko-config.js.

## Your private visitor dashboard

Every page loads `ko-track.js`, which records anonymous visits: a random per-browser id, the page, phone/tablet/desktop, the referring site, and the language. It sends no names and no IPs, and skips browsers that send Do Not Track. Only admins can read this data.

1. After the steps above, open `https://<your-site>/ko26-quest-board/login/`. Nothing on the site links to it.
2. Tap **First time? Create your admin account** and sign up with your email and a password. Confirm the email if Supabase asks you to.
3. In Supabase SQL Editor, run the line the page shows you:
   `insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';`
4. Sign in. You'll see visitors right now, today, this week and all time, new vs returning per day, pages, devices, where people came from, busiest hours, and kickroll upload and rating counts.
