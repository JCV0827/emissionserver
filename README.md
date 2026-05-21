# Emission Server

Node.js/Express backend for emission tracking. This repository is deployed on Vercel and uses a single `server.js` entrypoint (configured in `vercel.json`).

**Features**
- Express API
- MySQL integration
- JWT authentication
- File uploads
- TOTP 2FA and email notifications

**Vercel deployment**
- The project is configured for Vercel via `vercel.json`, which routes requests to `server.js`.
- `npm run dev` runs `vercel dev` (see `package.json`) and will run the same `server.js` locally using the `@vercel/node` runtime.

**Environment variables**
Set these in your Vercel project settings or provide a `.env` for local development. `server.js` loads dotenv from the parent folder by default (`path.join(__dirname, '..', '.env')`).

- `DB_HOST` - MySQL host
- `DB_USER` - MySQL user
- `DB_PASSWORD` - MySQL password
- `DB_NAME` - MySQL database
- `DB_PORT` - MySQL port
- `JWT_SECRET` - JWT secret key
- `EMAIL_USER` / `EMAIL_PASS` - SMTP credentials for nodemailer

Note: Vercel provides a dynamic `PORT` when running in its environment; you usually don't need to set it there.

**Local development**

1. Install dependencies:

```bash
npm install
```

2. Option A — Run with Vercel CLI (recommended, mirrors production routing):

```bash
# install globally or use npx
npx vercel dev
# or
npm run dev
```

This uses `vercel dev` and will route requests the same way `vercel.json` specifies (to `server.js`).

3. Option B — Run the server directly (no Vercel runtime):

```bash
# set env vars in your shell, then:
node server.js
```

PowerShell example to set a couple of env vars inline and run:

```powershell
$env:JWT_SECRET='your_secret'; $env:DB_HOST='localhost'; node server.js
```

4. Note about `npm start`:

The `start` script in `package.json` runs `node api/server.js`. This project uses `server.js` at the repository root and is routed by Vercel, so running `node server.js` or `npx vercel dev` is typically the correct local workflow.

**Endpoints**
- The server exposes multiple API routes (e.g. `/login`, `/register`, `/carbon-factor`, `/upload`, etc.) — when running under Vercel the routing is handled by `vercel.json` pointing to `server.js`.

If you'd like, I can also add a small example `.env.example` file to the repo to make local setup easier.
