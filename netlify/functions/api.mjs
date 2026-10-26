import "dotenv/config";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getStore } from "@netlify/blobs";
import { generateGeminiRecommendation } from "../gemini.mjs";

const scrypt = promisify(scryptCallback);
const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectoryPath = dirname(currentFilePath);
const testStorePath = process.env.FOLIO_TEST_MODE === "1" ? process.env.FOLIO_TEST_STORE_PATH : null;
if (process.env.FOLIO_TEST_MODE === "1" && !testStorePath) {
  throw new Error("FOLIO_TEST_STORE_PATH is required when FOLIO_TEST_MODE is enabled.");
}
const fallbackStorePath = testStorePath || join(currentDirectoryPath, "..", "..", ".data", "library-management.json");

function createLocalStore() {
  const data = new Map();

  function ensureDirectory() {
    const directory = dirname(fallbackStorePath);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  }

  function load() {
    if (!existsSync(fallbackStorePath)) return;
    try {
      const raw = readFileSync(fallbackStorePath, "utf8");
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw);
      for (const [key, value] of Object.entries(parsed)) data.set(key, value);
    } catch (error) {
      throw new Error("Could not read local library data; refusing to overwrite it.", { cause: error });
    }
  }

  function save() {
    ensureDirectory();
    const temporaryPath = `${fallbackStorePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(Object.fromEntries(data), null, 2));
    renameSync(temporaryPath, fallbackStorePath);
  }

  load();

  return {
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async setJSON(key, value) {
      data.set(key, value);
      save();
      return value;
    },
    async delete(key) {
      data.delete(key);
      save();
    },
  };
}

let store;
if (process.env.FOLIO_TEST_MODE === "1") {
  store = createLocalStore();
} else {
  try {
    store = getStore("library-management");
  } catch (error) {
    console.warn("Netlify Blobs is not configured; using a local fallback store.");
    store = createLocalStore();
  }
}
const sessionLifetime = 1000 * 60 * 60 * 24 * 14;
const maxRequestBytes = 1024 * 1024;
const assistantRequestWindowMs = 60 * 1000;
const assistantRequestLimit = 6;
const assistantRequestCounts = new Map();

const starterBooks = [
  { id: "book-01", title: "The Creative Act", author: "Rick Rubin", category: "Creativity", year: 2023, isbn: "978-0593652886", cover: "https://covers.openlibrary.org/b/isbn/9780593652886-L.jpg", total: 4, available: 4 },
  { id: "book-02", title: "Tomorrow, and Tomorrow, and Tomorrow", author: "Gabrielle Zevin", category: "Fiction", year: 2022, isbn: "978-0593321201", cover: "https://covers.openlibrary.org/b/isbn/9780593321201-L.jpg", total: 5, available: 5 },
  { id: "book-03", title: "Crying in H Mart", author: "Michelle Zauner", category: "Memoir", year: 2021, isbn: "978-0525657743", cover: "https://covers.openlibrary.org/b/isbn/9780525657743-L.jpg", total: 3, available: 3 },
  { id: "book-04", title: "The Design of Everyday Things", author: "Don Norman", category: "Design", year: 2013, isbn: "978-0465050659", cover: "https://covers.openlibrary.org/b/isbn/9780465050659-L.jpg", total: 4, available: 4 },
  { id: "book-05", title: "Braiding Sweetgrass", author: "Robin Wall Kimmerer", category: "Nature", year: 2013, isbn: "978-1571313560", cover: "https://covers.openlibrary.org/b/isbn/9781571313560-L.jpg", total: 3, available: 3 },
  { id: "book-06", title: "Pachinko", author: "Min Jin Lee", category: "Fiction", year: 2017, isbn: "978-1455563937", cover: "https://covers.openlibrary.org/b/isbn/9781455563937-L.jpg", total: 4, available: 4 },
  { id: "book-07", title: "Four Thousand Weeks", author: "Oliver Burkeman", category: "Personal growth", year: 2021, isbn: "978-0374159122", cover: "https://covers.openlibrary.org/b/isbn/9780374159122-L.jpg", total: 3, available: 3 },
  { id: "book-08", title: "A Psalm for the Wild-Built", author: "Becky Chambers", category: "Science fiction", year: 2021, isbn: "978-1250236210", cover: "https://covers.openlibrary.org/b/isbn/9781250236210-L.jpg", total: 3, available: 3 },
  { id: "book-09", title: "Invisible Cities", author: "Italo Calvino", category: "Fiction", year: 1972, isbn: "978-0156453806", cover: "https://covers.openlibrary.org/b/isbn/9780156453806-L.jpg", total: 2, available: 2 },
];

const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const read = async (key, fallback = []) => (await store.get(key, { type: "json" })) ?? fallback;
const write = (key, value) => store.setJSON(key, value);
const cleanUser = ({ id, name, email, role }) => ({ id, name, email, role: role || "reader" });

function configuredLibrarians() {
  return new Set((process.env.LIBRARIAN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

function assignRoles(users) {
  const configured = configuredLibrarians();
  let changed = false;
  for (const user of users) {
    const role = configured.has(user.email.toLowerCase()) ? "librarian" : "reader";
    if (user.role !== role) {
      user.role = role;
      changed = true;
    }
  }
  return changed;
}

function promoteReservation(book, reservations, now = new Date()) {
  if (!book || book.inventoryTracked === false || book.available == null || book.available < 1 || reservations.some((reservation) => reservation.bookId === book.id && reservation.status === "ready")) return false;
  const next = reservations
    .filter((reservation) => reservation.bookId === book.id && reservation.status === "waiting")
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt))[0];
  if (!next) return false;
  next.status = "ready";
  next.readyAt = now.toISOString();
  next.expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  return true;
}

function expireReservations(books, reservations, now = new Date()) {
  let changed = false;
  for (const reservation of reservations) {
    if (reservation.status === "ready" && new Date(reservation.expiresAt) <= now) {
      reservation.status = "expired";
      reservation.expiredAt = now.toISOString();
      changed = true;
    }
  }
  for (const book of books) changed = promoteReservation(book, reservations, now) || changed;
  return changed;
}

async function ensureBooks() {
  const books = await read("books", null);
  if (books) return books;
  await write("books", starterBooks);
  return starterBooks;
}

async function authenticatedUser(headers) {
  const authHeader = headers instanceof Headers ? headers.get("authorization") : headers?.authorization;
  const token = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "") : "";
  if (!token) return null;
  const session = await read(`session:${token}`, null);
  if (!session || session.expiresAt < Date.now()) return null;
  const users = await read("users");
  if (assignRoles(users)) await write("users", users);
  return users.find((user) => user.id === session.userId) ?? null;
}

function validEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validEbookUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^https:\/\/www\.gutenberg\.org\/(?:ebooks|files)\//i.test(trimmed)
    && !/\s/.test(trimmed)
    && /^https:\/\/www\.gutenberg\.org\/(?:ebooks|files)\/[A-Za-z0-9._/-]+(?:[?#].*)?$/i.test(trimmed);
}

function normalizeBookText(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeIsbn(value) {
  return String(value || "").replace(/[^\dX]/gi, "").toUpperCase();
}

async function createSession(user) {
  const token = randomBytes(32).toString("hex");
  await write(`session:${token}`, { userId: user.id, expiresAt: Date.now() + sessionLifetime });
  return token;
}

function readRequestPayload(event) {
  if (event instanceof Request) {
    return { url: new URL(event.url), method: event.method, headers: event.headers, body: event.clone().text() };
  }

  return {
    url: new URL(event.rawUrl ?? `https://library.local${event.path ?? "/api"}`),
    method: event.httpMethod ?? "GET",
    headers: event.headers instanceof Headers ? event.headers : new Headers(event.headers ?? {}),
    body: Promise.resolve(typeof event.body === "string"
      ? event.body
      : event.body && typeof event.body === "object"
        ? JSON.stringify(event.body)
        : "")
  };
}

export default async function handler(event, _context, dependencies = {}) {
  try {
    const request = readRequestPayload(event);
    const url = request.url;
    const route = url.pathname.replace(/^\/(?:api|\.netlify\/functions\/api)\/?/, "");
    const method = request.method ?? event.method ?? event.httpMethod ?? "GET";
    const headers = request.headers;
    const rawBody = await request.body;
    if (Buffer.byteLength(rawBody, "utf8") > maxRequestBytes) {
      return json(413, { error: "The request is too large." });
    }
    const body = rawBody ? (() => {
      try {
        const parsed = JSON.parse(rawBody);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    })() : {};
    if (body === null) return json(400, { error: "The request body must be a valid JSON object." });

    if (method === "POST" && route === "auth/register") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (name.length < 2 || name.length > 80 || !validEmail(email) || typeof body.password !== "string" || body.password.length < 8 || body.password.length > 1024) {
        return json(400, { error: "Enter a name, valid email, and password with at least 8 characters." });
      }
      const users = await read("users");
      assignRoles(users);
      if (users.some((user) => user.email === email)) return json(409, { error: "An account with that email already exists." });
      const salt = randomBytes(16).toString("hex");
      const passwordHash = (await scrypt(body.password, salt, 64)).toString("hex");
      const role = configuredLibrarians().has(email) ? "librarian" : "reader";
      const user = { id: randomBytes(12).toString("hex"), name, email, salt, passwordHash, role };
      users.push(user);
      await write("users", users);
      return json(201, { user: cleanUser(user), token: await createSession(user) });
    }

    if (method === "POST" && route === "auth/login") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const users = await read("users");
      const user = users.find((entry) => entry.email === email);
      if (!user || typeof body.password !== "string" || body.password.length > 1024) return json(401, { error: "Email or password is incorrect." });
      const candidate = await scrypt(body.password, user.salt, 64);
      if (!timingSafeEqual(candidate, Buffer.from(user.passwordHash, "hex"))) return json(401, { error: "Email or password is incorrect." });
      return json(200, { user: cleanUser(user), token: await createSession(user) });
    }

    const user = await authenticatedUser(headers);
    if (!user) return json(401, { error: "Please sign in to continue." });

    if (method === "GET" && route === "me") return json(200, { user: cleanUser(user) });
    if (method === "POST" && route === "auth/logout") {
      const authHeader = headers instanceof Headers ? headers.get("authorization") : headers?.authorization;
      const token = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "") : "";
      if (token) await store.delete(`session:${token}`);
      return json(200, { ok: true });
    }

    if (method === "GET" && route === "bootstrap") {
      const [books, loans, reservations] = await Promise.all([ensureBooks(), read("loans"), read("reservations")]);
      if (expireReservations(books, reservations)) {
        await Promise.all([write("books", books), write("reservations", reservations)]);
      }
      const myLoans = loans.filter((loan) => loan.userId === user.id).sort((a, b) => b.checkedOutAt.localeCompare(a.checkedOutAt));
      const myReservations = reservations.filter((reservation) => reservation.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const [favorites, notes] = await Promise.all([
        read(`favorites:${user.id}`),
        read(`notes:${user.id}`),
      ]);
      const librarianDashboard = user.role === "librarian" ? {
        overdueLoans: loans.filter((loan) => !loan.returnedAt && new Date(loan.dueAt).getTime() < Date.now())
          .map(({ id, bookId, dueAt }) => ({ id, bookId, dueAt })),
        dueSoonLoans: loans.filter((loan) => {
          const dueAt = new Date(loan.dueAt).getTime();
          return !loan.returnedAt && dueAt >= Date.now() && dueAt <= Date.now() + 7 * 24 * 60 * 60 * 1000;
        }).map(({ id, bookId, dueAt }) => ({ id, bookId, dueAt })),
        activeReservations: reservations.filter((reservation) => ["waiting", "ready"].includes(reservation.status))
          .map(({ id, bookId, status, createdAt, expiresAt }) => ({ id, bookId, status, createdAt, expiresAt })),
      } : null;
      return json(200, {
        user: cleanUser(user), books, loans: myLoans, reservations: myReservations, favorites, notes,
        ...(librarianDashboard ? { librarianDashboard } : {}),
      });
    }

    if (method === "GET" && route === "books") {
      const [books, reservations] = await Promise.all([ensureBooks(), read("reservations")]);
      if (expireReservations(books, reservations)) await write("reservations", reservations);
      return json(200, { books });
    }

    if (method === "GET" && route === "favorites") {
      return json(200, { favorites: await read(`favorites:${user.id}`) });
    }

    if (method === "GET" && route === "reservations") {
      const [reservations, books] = await Promise.all([read("reservations"), ensureBooks()]);
      if (expireReservations(books, reservations)) await write("reservations", reservations);
      return json(200, { reservations: reservations.filter((reservation) => reservation.userId === user.id) });
    }

    if (method === "GET" && route === "loans") {
      const loans = await read("loans");
      return json(200, { loans: loans.filter((loan) => loan.userId === user.id) });
    }

    if (method === "PUT" && route === "notes") {
      if (!Array.isArray(body.notes) || body.notes.length > 50) return json(400, { error: "Save up to 50 notes at a time." });
      const ids = new Set();
      const noteColors = new Set(["butter", "rose", "mint", "sky"]);
      const now = new Date().toISOString();
      const notes = [];
      for (const note of body.notes) {
        if (!note || typeof note !== "object" || typeof note.id !== "string" || !/^[a-z0-9_-]{1,80}$/i.test(note.id)) {
          return json(400, { error: "Each note needs a valid ID." });
        }
        if (ids.has(note.id)) return json(400, { error: "Note IDs must be unique." });
        if (typeof note.title !== "string" || note.title.trim().length === 0 || note.title.trim().length > 80 || typeof note.content !== "string" || note.content.length > 12000) {
          return json(400, { error: "Note titles are limited to 80 characters and notes to 12,000 characters." });
        }
        if (!noteColors.has(note.color)) return json(400, { error: "Choose a valid note color." });
        ids.add(note.id);
        notes.push({ id: note.id, title: note.title.trim(), content: note.content, color: note.color, updatedAt: now });
      }
      await write(`notes:${user.id}`, notes);
      return json(200, { notes });
    }

    if (method === "POST" && route === "assistant") {
      const question = typeof body.question === "string" ? body.question.trim() : "";
      if (!question || question.length > 600) return json(400, { error: "Ask a question between 1 and 600 characters." });
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) return json(503, { error: "AI recommendations are not configured yet. Add GEMINI_API_KEY to the server environment." });
      if (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 8
        || body.history.some((entry) => !entry || !["user", "assistant"].includes(entry.role)
          || typeof entry.text !== "string" || !entry.text.trim() || entry.text.trim().length > 1000))) {
        return json(400, { error: "Conversation history must contain up to 8 valid messages." });
      }
      const now = Date.now();
      const recentRequests = (assistantRequestCounts.get(user.id) || []).filter((timestamp) => now - timestamp < assistantRequestWindowMs);
      if (recentRequests.length >= assistantRequestLimit) {
        return json(429, { error: "You’ve sent several reading questions recently. Please wait a minute and try again." });
      }
      recentRequests.push(now);
      assistantRequestCounts.set(user.id, recentRequests);

      const [books, loans, favorites] = await Promise.all([
        ensureBooks(),
        read("loans"),
        read(`favorites:${user.id}`),
      ]);
      if (!Array.isArray(books) || books.length === 0) {
        return json(422, { error: "There are no books in the collection to recommend yet." });
      }
      const catalog = books.slice(0, 120).map(({ id, title, author, category, year, available, total, ebookUrl }) => ({
        id, title, author, category, year, available, total, freeEbook: ebookUrl || null,
      }));
      const savedTitles = books.filter((book) => favorites.includes(book.id)).map((book) => book.title);
      const activeLoanTitles = loans.filter((loan) => loan.userId === user.id && !loan.returnedAt)
        .map((loan) => books.find((book) => book.id === loan.bookId)?.title)
        .filter(Boolean);
      const history = Array.isArray(body.history) ? body.history.flatMap((entry) => {
        const text = entry.text.trim().slice(0, 1000);
        return [{ role: entry.role === "assistant" ? "model" : "user", parts: [{ text }] }];
      }) : [];
      const prompt = [
        `Catalog snapshot: ${JSON.stringify(catalog)}`,
        `Reader's saved titles: ${JSON.stringify(savedTitles)}`,
        `Reader's active loans: ${JSON.stringify(activeLoanTitles)}`,
        `Current question: ${question}`,
      ].join("\n\n");

      try {
        const generateRecommendation = dependencies.generateRecommendation || generateGeminiRecommendation;
        const answer = await generateRecommendation({
          apiKey,
          model: /^[a-z0-9.-]+$/i.test(process.env.GEMINI_MODEL || "") ? process.env.GEMINI_MODEL : "gemini-3.5-flash-lite",
          history,
          prompt,
        });
        if (typeof answer !== "string" || !answer.trim()) {
          return json(502, { error: "LibraHub did not receive a usable recommendation. Please try again." });
        }
        return json(200, { answer: answer.trim().slice(0, 4000) });
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 0;
        console.error("LibraHub AI request failed.", { status });
        if ([400, 401, 403, 404].includes(status)) {
          return json(503, { error: "AI recommendations are unavailable. Check the server’s Gemini API key and model configuration." });
        }
        if (status === 429) return json(503, { error: "Gemini is temporarily at its usage limit. Please try again later." });
        if (status === 408 || status === 504 || error?.name === "TimeoutError" || error?.name === "AbortError") {
          return json(504, { error: "LibraHub’s AI request took too long. Please try again." });
        }
        return json(502, { error: "LibraHub could not reach its AI provider. Please try again shortly." });
      }
    }

    if (method === "POST" && route === "books") {
      if (user.role !== "librarian") return json(403, { error: "Only librarians can add books." });
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const author = typeof body.author === "string" ? body.author.trim() : "";
      const inventoryTracked = body.inventoryTracked !== false;
      const total = Number(body.total);
      if (!title || title.length > 140 || !author || author.length > 100 || (inventoryTracked && (!Number.isInteger(total) || total < 1 || total > 500)) || (body.ebookUrl && !validEbookUrl(body.ebookUrl)) || (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 2000)) || (body.sourceUrl && (typeof body.sourceUrl !== "string" || !/^https:\/\//i.test(body.sourceUrl)))) {
        return json(400, { error: "Add a title and author, plus a valid copy count when inventory is tracked." });
      }
      const books = await ensureBooks();
      const normalizedIsbn = normalizeIsbn(body.isbn);
      const normalizedTitle = normalizeBookText(title);
      const normalizedAuthor = normalizeBookText(author);
      const duplicate = books.find((entry) =>
        (normalizedIsbn && normalizeIsbn(entry.isbn) === normalizedIsbn)
        || (normalizeBookText(entry.title) === normalizedTitle && normalizeBookText(entry.author) === normalizedAuthor)
      );
      if (duplicate) return json(409, { error: `${duplicate.title} by ${duplicate.author} is already in the collection.` });
      const book = {
        id: randomBytes(12).toString("hex"), title, author,
        category: typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 40) : "Other",
        year: Number.isInteger(Number(body.year)) ? Number(body.year) : new Date().getFullYear(),
        isbn: typeof body.isbn === "string" ? body.isbn.trim().slice(0, 24) : "",
        ebookUrl: validEbookUrl(body.ebookUrl) ? body.ebookUrl.trim() : "",
        cover: typeof body.cover === "string" && /^https:\/\//.test(body.cover) ? body.cover : "",
        ...(typeof body.description === "string" && body.description.trim() ? { description: body.description.trim() } : {}),
        ...(typeof body.sourceUrl === "string" && /^https:\/\//i.test(body.sourceUrl) ? { sourceUrl: body.sourceUrl.trim() } : {}),
        inventoryTracked, total: inventoryTracked ? total : null, available: inventoryTracked ? total : null,
      };
      books.unshift(book);
      await write("books", books);
      return json(201, { book });
    }

    const bookRoute = route.match(/^books\/([^/]+)$/);
    if (bookRoute && method === "PATCH") {
      if (user.role !== "librarian") return json(403, { error: "Only librarians can update book links." });
      if (!validEbookUrl(body.ebookUrl)) return json(400, { error: "Enter a valid Project Gutenberg ebook URL." });
      const books = await ensureBooks();
      const book = books.find((entry) => entry.id === bookRoute[1]);
      if (!book) return json(404, { error: "Book not found." });
      book.ebookUrl = body.ebookUrl.trim();
      await write("books", books);
      return json(200, { book });
    }
    if (bookRoute && method === "DELETE") {
      if (user.role !== "librarian") return json(403, { error: "Only librarians can remove books." });
      const [books, loans] = await Promise.all([ensureBooks(), read("loans")]);
      const book = books.find((entry) => entry.id === bookRoute[1]);
      if (!book) return json(404, { error: "Book not found." });
      if (loans.some((loan) => loan.bookId === book.id && !loan.returnedAt)) return json(409, { error: "This book has an active loan and cannot be removed yet." });
      const reservations = await read("reservations");
      if (reservations.some((reservation) => reservation.bookId === book.id && ["waiting", "ready"].includes(reservation.status))) {
        return json(409, { error: "This book has active reservations and cannot be removed yet." });
      }
      await write("books", books.filter((entry) => entry.id !== book.id));
      return json(200, { ok: true });
    }

    if (method === "POST" && route === "favorites") {
      const books = await ensureBooks();
      if (!books.some((book) => book.id === body.bookId)) return json(404, { error: "Book not found." });
      const favorites = await read(`favorites:${user.id}`);
      if (!favorites.includes(body.bookId)) favorites.push(body.bookId);
      await write(`favorites:${user.id}`, favorites);
      return json(200, { favorites });
    }

    const favoriteRoute = route.match(/^favorites\/([^/]+)$/);
    if (favoriteRoute && method === "DELETE") {
      const favorites = (await read(`favorites:${user.id}`)).filter((bookId) => bookId !== favoriteRoute[1]);
      await write(`favorites:${user.id}`, favorites);
      return json(200, { favorites });
    }

    if (method === "POST" && route === "reservations") {
      const [books, reservations] = await Promise.all([ensureBooks(), read("reservations")]);
      const book = books.find((entry) => entry.id === body.bookId);
      if (!book) return json(404, { error: "Book not found." });
      if (book.inventoryTracked === false || book.available == null || book.total == null) return json(409, { error: "Inventory has not been recorded for this book, so it cannot be reserved." });
      if (book.available > 0) return json(409, { error: "A copy is available now. Borrow it instead of reserving." });
      if (reservations.some((entry) => entry.bookId === book.id && entry.userId === user.id && ["waiting", "ready"].includes(entry.status))) {
        return json(409, { error: "You already have an active reservation for this book." });
      }
      const reservation = { id: randomBytes(12).toString("hex"), bookId: book.id, userId: user.id, createdAt: new Date().toISOString(), status: "waiting" };
      reservations.push(reservation);
      await write("reservations", reservations);
      return json(201, { reservation });
    }

    const reservationRoute = route.match(/^reservations\/([^/]+)$/);
    if (reservationRoute && method === "DELETE") {
      const reservations = await read("reservations");
      const reservation = reservations.find((entry) => entry.id === reservationRoute[1] && entry.userId === user.id);
      if (!reservation) return json(404, { error: "Reservation not found." });
      if (!["waiting", "ready"].includes(reservation.status)) return json(409, { error: "This reservation is no longer active." });
      reservation.status = "cancelled";
      reservation.cancelledAt = new Date().toISOString();
      const books = await ensureBooks();
      const book = books.find((entry) => entry.id === reservation.bookId);
      promoteReservation(book, reservations);
      await Promise.all([write("books", books), write("reservations", reservations)]);
      return json(200, { reservation });
    }

    if (method === "POST" && route === "loans") {
      const [books, loans, reservations] = await Promise.all([ensureBooks(), read("loans"), read("reservations")]);
      if (expireReservations(books, reservations)) await write("reservations", reservations);
      const book = books.find((entry) => entry.id === body.bookId);
      if (!book) return json(404, { error: "Book not found." });
      if (book.inventoryTracked === false || book.available == null || book.total == null) return json(409, { error: "Inventory has not been recorded for this book, so it cannot be borrowed." });
      const readyReservation = reservations.find((entry) => entry.bookId === book.id && entry.status === "ready");
      if (readyReservation && readyReservation.userId !== user.id) return json(409, { error: "This copy is being held for another reader." });
      if (book.available < 1) return json(409, { error: "No copies are available right now." });
      if (loans.filter((loan) => loan.userId === user.id && !loan.returnedAt).length >= 3) return json(409, { error: "You have reached the limit of 3 active loans." });
      const now = new Date();
      const due = new Date(now);
      due.setDate(due.getDate() + 21);
      const loan = { id: randomBytes(12).toString("hex"), userId: user.id, bookId: book.id, checkedOutAt: now.toISOString(), dueAt: due.toISOString(), returnedAt: null };
      if (readyReservation) {
        readyReservation.status = "claimed";
        readyReservation.claimedAt = now.toISOString();
      }
      book.available -= 1;
      loans.unshift(loan);
      await Promise.all([write("books", books), write("loans", loans), write("reservations", reservations)]);
      return json(201, { loan });
    }

    const loanRoute = route.match(/^loans\/([^/]+)\/return$/);
    if (method === "POST" && loanRoute) {
      const [books, loans, reservations] = await Promise.all([ensureBooks(), read("loans"), read("reservations")]);
      const loan = loans.find((entry) => entry.id === loanRoute[1] && entry.userId === user.id);
      if (!loan) return json(404, { error: "Loan not found." });
      if (loan.returnedAt) return json(409, { error: "This book has already been returned." });
      loan.returnedAt = new Date().toISOString();
      const book = books.find((entry) => entry.id === loan.bookId);
      if (book && book.inventoryTracked !== false && book.available != null && book.total != null) book.available = Math.min(book.total, book.available + 1);
      promoteReservation(book, reservations);
      await Promise.all([write("books", books), write("loans", loans), write("reservations", reservations)]);
      return json(200, { loan });
    }

    return json(404, { error: "That library route does not exist." });
  } catch (error) {
    console.error("Library API error:", error);
    return json(500, { error: "The library service could not complete that request." });
  }
}