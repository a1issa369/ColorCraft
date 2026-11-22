# ColorCraft worker

A Cloudflare Worker with a D1 database. It does three things:

- `POST /e` stores the anonymous usage events the editor sends.
- `GET /summary` returns the aggregates shown at `#stats`.
- `POST /chat` runs the photo assistant: it checks and rate limits the request, asks Claude with a short list of tools, and returns the reply plus checked actions.

Deploy steps are in the main README under "Usage counting". Edit `ALLOWED_ORIGINS`, `CHAT_MODEL`, `CHAT_PER_USER` and `CHAT_PER_DAY` in `wrangler.toml`. The Anthropic key is set with `npx wrangler secret put ANTHROPIC_API_KEY`, never in a file.
