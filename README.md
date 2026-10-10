## THIS PROJECT IS CURRENTLY UNDER MAINTENANCE
 due to cloners bad habits, we as XTR Softwares, we decided to pause this project and let cloners Suffer, We shall be back with a new repo though.

## Pairing & deployment notes

- **Pairing:** open `/pair`, enter the number in international format (e.g. `2547XXXXXXXX`, no `+`), press **Get Pairing Code**, then enter the code on the phone under *Settings > Linked Devices > Link with Phone Number*. The bot's WebSocket must be open before a code can be issued; the page retries automatically while the bot is starting up.
- **Session persistence:** the WhatsApp session lives in `auth_info_baileys/` (override with the `AUTH_DIR` env var). On Render the filesystem is **ephemeral** — attach a Disk and set `AUTH_DIR=/data/auth_info_baileys`, or every deploy/restart logs the bot out and forces a full re-pair.
- **Restarts:** the process no longer calls `logout()` on SIGTERM, so deploys keep the existing session.
