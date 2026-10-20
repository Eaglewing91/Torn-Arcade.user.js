# Torn Arcade server

Runs online play for Torn Arcade: sign-in with a Torn ID, online games and the global leaderboard. Hosted on Railway with a Postgres database.

- **Sign-in:** `POST /v1/auth/torn {key}` checks the key once with `api.torn.com` (`/v2/user/basic`, a Public key is enough), then forgets it. The key is never stored or logged. You get a sign-in token, which is stored only as a SHA-256 hash.
- **Guests:** `POST /v1/auth/guest` gives an unverified `Guest-1234` account. Guests can play but don't appear on the leaderboard. Verifying later keeps the same account.
- **Leaderboards:** `GET /v1/leaderboard/territories` (online rating) and `GET /v1/leaderboard/<board>` for best scores, such as `flappy:hard`, `bombs:normal` (fastest time), `eggdash:endless`, `bogies:total`, `defence:1`–`defence:6`, `tornies:caught`, `tornies:medals` and `invasion:standard`. Verified players only.
- **Best scores:** `POST /v1/scores {scores: {board: value}}` (verified players only). The server keeps whichever is better, the new value or the saved one, and rejects values outside each board's limits. Best scores come from players' own devices, so they can't be fully checked; the limits throw out impossible ones.
- **Your account:** `GET /v1/me`, `POST /v1/auth/logout`, and `DELETE /v1/me` (deletes your account, sign-ins and ratings).
- **Health:** `GET /health`.

Needs `DATABASE_URL`; the tables are created on start-up. `npm test` runs the end-to-end tests against a local Postgres on port 5433 and a fake Torn API.

Licensed for use with Torn Arcade only. All rights reserved.
