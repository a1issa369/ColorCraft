# ColorCraft analytics worker

A Cloudflare Worker with a D1 database. It stores the anonymous events the editor sends and returns aggregates at `GET /summary`.
Deploy steps are in the main README under "Usage counting". Edit `ALLOWED_ORIGINS` in `wrangler.toml` if the site moves.
