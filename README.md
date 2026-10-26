# LibraHub Library Management

LibraHub — Manage Today, Read a Brighter Tomorrow. A responsive library management app with account registration and sign-in, ISBN metadata lookup, a searchable, filterable book catalog, saved books, reservations, personal notes, and loan tracking. Gutenberg editions open directly from the catalog. The web app and API are designed to deploy together on Netlify.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm install
npm run dev
```

Create a local environment file from the example, then add your server-only configuration:

```powershell
Copy-Item .env.example .env
```

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and set `GEMINI_API_KEY` in `.env`. Set `LIBRARIAN_EMAILS` to a comma-separated list of librarian email addresses. `.env` is loaded by the server function and is excluded from Git. Never put the key in frontend code or a `VITE_`/`NEXT_PUBLIC_` variable.

Start Netlify Dev with `npm run dev` and open its printed local URL. Netlify Dev serves the site, runs the Functions API, and emulates Netlify Blobs for local development. Create an account using a configured librarian email to manage books; other accounts have reader access. A starter collection is added automatically. Without a key, the catalog still works and the LibraHub Guide reports that AI is not configured.

## Deploy to Netlify

1. Push this repository to GitHub.
2. In Netlify, choose **Add new site → Import an existing project** and select the repository.
3. Keep the detected `netlify.toml` settings. The site publishes from the repository root and uses the function in `netlify/functions`.
4. In **Site configuration → Environment variables**, set server-side `LIBRARIAN_EMAILS` and `GEMINI_API_KEY`. Get the key from [Google AI Studio](https://aistudio.google.com/apikey). Save the variables and redeploy the site so the Functions receive them. A frontend hosting provider does not automatically configure variables for a separately hosted backend; set the secret in the hosting environment that runs this API function.

The deployed URL is ready to share after the first successful deploy. The Netlify site URL can be changed under **Domain management**.

## Local catalog import

The verified catalog import is for the local JSON fallback only (`.data/library-management.json`); it does not modify Netlify Blobs or a production database. Stop the local server before applying an import so its in-memory store cannot overwrite the file.

```powershell
node scripts/import-catalog.mjs
node scripts/import-catalog.mjs --apply
```

The first command is a read-only preview. The second creates and verifies a timestamped sibling backup, then appends only ISBN/title-author-unique catalog records. Re-running the script skips books already imported. Added catalog-only records have `inventoryTracked: false` and null copy counts; they cannot be borrowed or reserved until real inventory has been recorded.

## Notes

- Netlify Blobs stores accounts, sessions, catalog records, loans, and per-user notes. Passwords are hashed with scrypt; session tokens are random and expire after 14 days.
- Librarian access is granted only to addresses in `LIBRARIAN_EMAILS`; catalog writes are also checked by the API. Readers can borrow books, reserve unavailable titles, and manage their own saved list.
- The LibraHub Guide sends the reader's question and a limited catalog/saved-books/active-loans context to Google Gemini through the server-side function. The API key is never returned to the browser.
- Reservations enter a waiting queue when all copies are loaned. When a copy is returned, the next reader has 48 hours to borrow it. The overview shows due and overdue reminders.
- The starter collection is initialized the first time a library is opened. Catalog changes and loan activity persist across deploys.
- The original Kivy desktop files remain in the repository; Netlify serves the web app from `index.html`.