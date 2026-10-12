## Mtaula 01 — pairing, persistence & admin

### Pairing the bot's WhatsApp account

- Open `/pair`, enter the number in international format (e.g. `2547XXXXXXXX`, no `+`), press **Get Pairing Code**, then enter the code on the phone under *Settings > Linked Devices > Link with Phone Number*. The bot's WebSocket must be open before a code can be issued; the page retries automatically while the bot is starting up.
- `/api/pair` is rate-limited to 5 requests/minute per IP.

### Persistence (no re-pairing after an update)

Everything that must survive a redeploy lives on the persistent Disk:

- **WhatsApp session** — `SESSION_DIR` (`/data/auth_info_baileys` on Render). The process does not call `logout()` on SIGTERM, so deploys keep the existing session. `creds.json` is written **atomically** (temp file + rename) and mirrored to `creds.json.backup`; if the live file is ever missing or truncated (crash, `SIGKILL`, container freeze) it is restored from the backup on the next boot instead of falling back to a blank, unpaired session.
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

### 24/7 uptime — staying online without sleeping or logging out

The most common cause of "it logs out and asks me to pair again" was **not** WhatsApp: on Render's free tier the service is spun down after ~15 minutes with no inbound traffic. The previous keep-alive pinged `127.0.0.1`, which never leaves the container and therefore does **not** count as activity — the service still slept, the socket died, and the wake-up could read a half-written session.

What the bot does now:

1. **Public self-ping** — if `RENDER_EXTERNAL_URL` is set (Render sets it automatically), the bot requests its own `/health` every 10 minutes. That request leaves and re-enters through Render's edge, so it resets the spin-down timer.
2. **Loopback check** — a secondary `127.0.0.1/health` probe surfaces a broken HTTP layer in the logs.
3. **WhatsApp presence ping** every 4 minutes keeps the socket from being dropped as idle.
4. **Resilient credentials** — atomic writes + automatic backup restore (see *Persistence* above).
5. **Reconnect hardening** — `515 restartRequired` / `440 connectionReplaced` / `428 connectionClosed` reconnect immediately without growing the backoff and **without** wiping credentials; only `401 loggedOut` / `411 multideviceMismatch` (a genuine unlink) rotate the session, and even then the bot now drops the dead session and shows a fresh QR automatically instead of sitting dead.
6. **Watchdog** — if the socket is silent for 3 minutes with no reconnect pending, it forces one, so a missed event can no longer leave the bot offline forever.

**Recommended: add an external monitor as a belt-and-braces backstop.** Even with the self-ping, a free instance can be spun down for platform reasons. Point a free monitor (UptimeRobot, cron-job.org, or a scheduled GitHub Action) at `https://<your-service>.onrender.com/health` every 5 minutes. On a paid Render instance (or any always-on host) none of this is necessary.

### "Waiting for this message. This may take a while."

This is WhatsApp telling you it could not decrypt a message and is waiting for the sender to re-send it. WhatsApp asks for that re-send with a *retry receipt*; Baileys can only answer it if the socket was given a `getMessage` function that returns the original message. The bot previously passed none, so Baileys' default (`async () => undefined`) silently dropped every retry and the message stayed "waiting" forever.

Fixed by:

- implementing `getMessage` on the socket, backed by a bounded, 48-hour [message cache](src/core/message-cache.ts); and
- caching **every** upsert, including the bot's own outgoing messages — Baileys emits those with type `append`, and the old handler ignored anything that was not `notify`, so the bot's own replies could never be re-sent.

Retries are what fix the *first* message in a chat failing to decrypt, so this also clears the delay when you send a command.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest (registry, security, pairing/auth, auth-state & reconnect)
npm run dev         # tsx watch
npm run build && npm start
```
