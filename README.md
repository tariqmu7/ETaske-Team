# ETaske Team

The project team's workspace — chat with @mentions, tasks per person, daily progress updates,
photos and files — built to replace the project WhatsApp group. A lean sibling of ETaske:
same look, Arabic/English with full RTL, but the data lives in **Google Sheets + Google Drive**
behind an Apps Script web app, and people sign in with their Google account.

- Design and build order: [docs/DESIGN.md](docs/DESIGN.md)

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the two public values
npm run dev
npm run lint                 # type-check (also catches a missing Arabic string)
npm run test:api             # back-end tests: apps-script/Code.gs against in-memory Google fakes
```

## Back end

`apps-script/Code.gs` + `apps-script/appsscript.json` are pasted into the Apps Script editor
of the data Sheet (Extensions → Apps Script). Run `setup()` once, then deploy as a web app
(*Execute as: me*, *Who has access: Anyone*). The answer format and every action are in
[docs/DESIGN.md](docs/DESIGN.md) §4.

## Deploy

A push to `main` builds and publishes to GitHub Pages
(`.github/workflows/deploy.yml`). The build reads two **repository variables**
(Settings → Secrets and variables → Actions → *Variables*): `VITE_API_URL` and
`VITE_GOOGLE_CLIENT_ID`. Both are public values; no secrets live in this repo, and no team
data is ever committed.
