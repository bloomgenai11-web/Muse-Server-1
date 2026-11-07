# Dev Container — Muse gateway

`postStart` menjalankan `gateway.js` saja. `bot_github.js` tidak dijalankan.

## Gate start-bot

Wajib ada:

1. `gateway.js`, `cookie_pool.js`, `platforms/muse.js`, `qstash_deadman.js`, `camoufox_launch.js`, `.env`
2. `node`, npm: `camoufox-js`, `@upstash/redis`, `dotenv`, `express`, `cors`
3. `libgtk-3.so` dan binary Camoufox
4. key `.env`: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `BOT_PROXY_HOST`, `BOT_PROXY_PORT`

`BOT_PROXY_*` hanya supaya gate sama dengan skrip ChatGPT terakhir. Browser tidak memakai proxy selama `FORCE_DIRECT` bukan `0` (default `1`, internet Codespace).

## Manual

```bash
bash .devcontainer/setup.sh
bash .devcontainer/start-bot.sh
tail -f gateway.log
```
