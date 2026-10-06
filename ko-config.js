// Kickroll leaderboard backend. Paste your Supabase project's URL and anon (public) key here.
// Supabase → Project Settings → API. The anon key is meant to be public; the database rules in
// supabase/setup.sql decide what visitors can do. Leave both empty to run the pages in demo mode
// (videos and ratings stay on this device only).
window.KO_CONFIG = {
  supabaseUrl: "https://gkzekcevqrcmzvkgvwam.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdremVrY2V2cXJjbXp2a2d2d2FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwODk3MzAsImV4cCI6MjEwNjY2NTczMH0.cajM4dLt6HgPyod4X8A9IvID-NRvrwlHLn94ScIk3s8",
  bucket: "kickrolls",
  maxUploadMB: 50,
  // Every rave gets its own Leaderboard and Gallery: leaderboard.html?rave=<id>, gallery.html?rave=<id> (no ?rave= means ko26).
  // Its songs come from <id>.json. Uploads and voting close 7 days after the rave; keep each deadline in step with
  // the public.raves rows in supabase/setup.sql. theme: "ko" (Knockout purple) or "epik" (EPIK red).
  defaultRave: "ko26",
  raves: {
    ko26: {name: "Knockout Outdoor 2026", short: "KO26", tagline: "Level Up", date: "2026-10-03",
           board: "ko26.html", theme: "ko", deadline: "2026-10-10T23:59:59+11:00"},
    epik26: {name: "EPIK 2026", short: "EPIK26", tagline: "Sydney Showground", date: "2026-12-12",
             board: "epik26/", theme: "epik", deadline: "2026-12-19T23:59:59+11:00"}
  }
};
