## Pairing & deployment notes

- **Pairing:** open `/pair`, enter the number in international format (e.g. `2547XXXXXXXX`, no `+`), press **Get Pairing Code**, then enter the code on the phone under *Settings > Linked Devices > Link with Phone Number*. The bot's WebSocket must be open before a code can be issued; the page retries automatically while the bot is starting up.
- **Session persistence:** the WhatsApp session lives in `auth_info_baileys/` (override with the `SESSION_DIR` env var). On Render the filesystem is **ephemeral** — attach a Disk and set `SESSION_DIR=/data/auth_info_baileys` (already wired up in `render.yaml`), or every deploy/restart logs the bot out and forces a full re-pair.
- **Restarts:** the process no longer calls `logout()` on SIGTERM, so deploys keep the existing session.
- **Web endpoint security:** `/api/reset` and `/api/pair` require `ADMIN_TOKEN` when called remotely (`Authorization: Bearer <token>` or `?token=`). With no token configured they only accept requests from localhost. `/api/pair` is rate-limited to 5 requests/minute per IP because the `/pair` page needs it during onboarding.
- **AI engines:** `.ai` and auto-chat try Gemini → Groq → OpenAI → Meta AI in order. Set at least one of `GEMINI_KEY` / `GROQ_KEY` / `OPENAI_KEY`.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest (command registry + security checks)
npm run dev         # tsx watch
```
