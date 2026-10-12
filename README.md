## Mtaula 01 — pairing, persistence & admin

### Pairing the bot's WhatsApp account

- Open `/pair`, enter the number in international format (e.g. `2547XXXXXXXX`, no `+`), press **Get Pairing Code**, then enter the code on the phone under *Settings > Linked Devices > Link with Phone Number*. The bot's WebSocket must be open before a code can be issued; the page retries automatically while the bot is starting up.
- `/api/pair` is rate-limited to 5 requests/minute per IP.

### Persistence (no re-pairing after an update)

Everything that must survive a redeploy lives on the persistent Disk:

- **WhatsApp session** — `SESSION_DIR` (`/data/auth_info_baileys` on Render). The process does not call `logout()` on SIGTERM, so deploys keep the existing session.
- **Admin data & device pairings** — `DATA_DIR` (`/data/mtaula-data` on Render). Accounts, sessions, activity, deploy history **and device pairings** are stored here.

If either directory is *not* on a mounted Disk, the boot log warns loudly: the ephemeral filesystem would force the owner and every paired device to re-pair on each deploy. On a local checkout the defaults (`./auth_info_baileys`, `./data`) are fine.

Writes are atomic (temp file + rename), so a crash mid-write can never truncate `users.json` into an empty file.

### Persistent device pairing

Pairing is a long-lived credential linking one browser/device to an admin account:

1. An admin adds a user (optionally checking **Generate a pairing QR**) or uses **Pairing → Generate QR**.
2. The unique QR encodes `<origin>/?pair=<token>`. Opening it claims the pairing once (recording device name / IP / user-agent) and stores the token in the browser.
3. Every later request authenticates with that token. Because the record is on the persistent disk, an update does **not** invalidate it — the device keeps working without re-pairing.
4. Admins can **revoke** a pairing at any time; deleting a user revokes all of their devices.

### Authentication

All admin endpoints require a token (`Authorization: Bearer <token>`) — either a login token from `/api/auth/login` or a persistent device-pairing token. Permissions: `admin` (full), `operator` (scan, deploy, run commands, view), `viewer` (view only). The default account is `admin`; its password is `ADMIN_TOKEN` when set, otherwise `admin123` (a startup warning reminds you to change it).

Public by design (needed before login): `/health`, `/health-web`, `/`, `/dashboard`, `/pair`, `/api/status`, `/api/qr`, `/api/qr/raw`, `/api/pair`, `/api/pair/claim`.

Everything else — `/api/users*`, `/api/pairings*`, `/api/activity`, `/api/deploys`, `/api/engines`, `/api/commands`, `/api/commands/run`, `/api/reset`, `/api/session/export`, `/api/session/import` — is authenticated and permission-checked.

### Environment

See `.env.example` / `render.yaml`. Notable: `OWNER_NUMBER`, `ADMIN_TOKEN`, `SESSION_DIR`, `DATA_DIR`, `GEMINI_KEY` / `GROQ_KEY` / `OPENAI_KEY`, `PREFIX`, `MODE`.

AI engines: `.ai` and auto-chat try Gemini → Groq → OpenAI → Meta AI in order. Set at least one of `GEMINI_KEY` / `GROQ_KEY` / `OPENAI_KEY`.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest (command registry, security checks, pairing & auth)
npm run dev         # tsx watch
npm run build && npm start
```
