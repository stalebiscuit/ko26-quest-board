// Kickroll leaderboard backend. Paste your Supabase project's URL and anon (public) key here.
// Supabase → Project Settings → API. The anon key is meant to be public; the database rules in
// supabase/setup.sql decide what visitors can do. Leave both empty to run the pages in demo mode
// (videos and ratings stay on this device only).
window.KO_CONFIG = {
  supabaseUrl: "https://gkzekcevqrcmzvkgvwam.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdremVrY2V2cXJjbXp2a2d2d2FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwODk3MzAsImV4cCI6MjEwNjY2NTczMH0.cajM4dLt6HgPyod4X8A9IvID-NRvrwlHLn94ScIk3s8",
  bucket: "kickrolls",
  maxUploadMB: 50,
  // uploads and voting close 7 days after the rave; keep in step with ko26_deadline() in supabase/setup.sql
  deadline: "2026-10-10T23:59:59+11:00"
};
