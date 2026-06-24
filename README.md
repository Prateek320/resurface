# Resurface — Turn buried opportunities into action

An AI-powered opportunity-to-action platform. Paste messy text from WhatsApp, LinkedIn, or job posts → get structured, prioritized follow-ups with AI-drafted messages, reminders, and cloud sync.

## Quick start

```bash
cp .env.example .env
# Add your OpenAI key to .env

npm install
npm start
# Open http://localhost:3000
```

## Deploy (Railway / Render)

1. Push to GitHub
2. Set `OPENAI_API_KEY` env var
3. Optionally set Supabase env vars for cloud sync (see below)
4. Start command: `node server.js`

## Features

### Action engine
- **AI extraction** — paste text, review editable preview, save
- **AI follow-up drafts** — channel-specific copy (email, LinkedIn DM, WhatsApp)
- **One-click actions** — copy, open Gmail, LinkedIn search, Google Calendar
- **Reminders** — browser notifications (1 day before, day-of, stalled)
- **Snooze** — hide opportunities for 3 or 7 days
- **Activity log** — track status changes, drafts, reminders per opportunity
- **Outcome tracking** — Applied / Got reply / Rejected / Ghosted

### Accounts & sync (optional)
- Sign in with email magic link or Google (requires Supabase)
- Cloud sync across devices
- Import local data on first sign-in

### Capture
- **PWA** — installable app with share target (share text from mobile apps)
- **Chrome extension** — save selected text or LinkedIn pages (see `extension/`)

### Intelligence
- **Profile onboarding** — personalize AI priority and follow-up actions
- **Duplicate detection** — warns before saving similar opportunities

### Platform
- Full-text search, filters, sort
- Export JSON / CSV, import JSON
- Free tier: 10 extractions + 3 drafts/month (when signed in)
- Pro tier: unlimited (demo upgrade, no payment)

## Supabase setup (optional)

1. Create a project at [supabase.com](https://supabase.com)
2. Run [`db/schema.sql`](db/schema.sql) in the SQL editor
3. Enable Email and Google auth providers
4. Add env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

Without Supabase, the app works fully in local-only mode.

## Chrome extension

1. Open `chrome://extensions` → Developer mode
2. Load unpacked → select the `extension/` folder
3. Set your Resurface URL in the extension popup (default: `http://localhost:3000`)
4. On LinkedIn, use the floating button or right-click → "Save to Resurface"

## Project structure

```
resurface/
├── server.js           # Express API + OpenAI
├── db/schema.sql       # Supabase schema
├── extension/          # Chrome extension
├── public/
│   ├── index.html      # SPA shell
│   ├── app.js          # Frontend logic
│   ├── manifest.json   # PWA manifest
│   └── sw.js           # Service worker
└── package.json
```
