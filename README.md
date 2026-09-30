# Folio Library Management

Folio is a responsive library management app with account registration and sign-in, a searchable book catalog, inventory management, and book checkout and return tracking. The web app and API are designed to deploy together on Netlify.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Netlify CLI. Netlify Dev serves the site, runs the Functions API, and emulates Netlify Blobs for local development. Create an account in the app to start; a starter collection is added automatically.

## Deploy to Netlify

1. Push this repository to GitHub.
2. In Netlify, choose **Add new site → Import an existing project** and select the repository.
3. Keep the detected `netlify.toml` settings. The site publishes from the repository root and uses the function in `netlify/functions`.
4. Deploy. Netlify Functions and Netlify Blobs provide the API and persistent storage; no separate database or environment secret is required.

The deployed URL is ready to share after the first successful deploy. The Netlify site URL can be changed under **Domain management**.

## Notes

- Netlify Blobs stores accounts, sessions, catalog records, and loans. Passwords are hashed with scrypt; session tokens are random and expire after 14 days.
- The starter collection is initialized the first time a library is opened. Catalog changes and loan activity persist across deploys.
- The original Kivy desktop files remain in the repository; Netlify serves the web app from `index.html`.