import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getStore } from "@netlify/blobs";

const scrypt = promisify(scryptCallback);
const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectoryPath = dirname(currentFilePath);
const fallbackStorePath = join(currentDirectoryPath, "..", "..", ".data", "library-management.json");

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
      console.warn("Could not read local fallback store; starting fresh.", error.message);
    }
  }

  function save() {
    ensureDirectory();
    writeFileSync(fallbackStorePath, JSON.stringify(Object.fromEntries(data), null, 2));
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
try {
  store = getStore("library-management");
} catch (error) {
  console.warn("Netlify Blobs is not configured; using a local fallback store.");
  store = createLocalStore();
}
const sessionLifetime = 1000 * 60 * 60 * 24 * 14;

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
const cleanUser = ({ id, name, email }) => ({ id, name, email });

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
  return users.find((user) => user.id === session.userId) ?? null;
}

function validEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

export default async function handler(event) {
  try {
    const request = readRequestPayload(event);
    const url = request.url;
    const route = url.pathname.replace(/^\/(?:api|\.netlify\/functions\/api)\/?/, "");
    const method = request.method ?? event.method ?? event.httpMethod ?? "GET";
    const headers = request.headers;
    const rawBody = await request.body;
    const body = rawBody ? (() => {
      try {
        return JSON.parse(rawBody);
      } catch {
        return {};
      }
    })() : {};

    if (method === "POST" && route === "auth/register") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (name.length < 2 || name.length > 80 || !validEmail(email) || typeof body.password !== "string" || body.password.length < 8) {
        return json(400, { error: "Enter a name, valid email, and password with at least 8 characters." });
      }
      const users = await read("users");
      if (users.some((user) => user.email === email)) return json(409, { error: "An account with that email already exists." });
      const salt = randomBytes(16).toString("hex");
      const passwordHash = (await scrypt(body.password, salt, 64)).toString("hex");
      const user = { id: randomBytes(12).toString("hex"), name, email, salt, passwordHash };
      users.push(user);
      await write("users", users);
      return json(201, { user: cleanUser(user), token: await createSession(user) });
    }

    if (method === "POST" && route === "auth/login") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const users = await read("users");
      const user = users.find((entry) => entry.email === email);
      if (!user || typeof body.password !== "string") return json(401, { error: "Email or password is incorrect." });
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
      const [books, loans] = await Promise.all([ensureBooks(), read("loans")]);
      const myLoans = loans.filter((loan) => loan.userId === user.id).sort((a, b) => b.checkedOutAt.localeCompare(a.checkedOutAt));
      return json(200, { user: cleanUser(user), books, loans: myLoans });
    }

    if (method === "POST" && route === "books") {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const author = typeof body.author === "string" ? body.author.trim() : "";
      const total = Number(body.total);
      if (!title || title.length > 140 || !author || author.length > 100 || !Number.isInteger(total) || total < 1 || total > 500) {
        return json(400, { error: "Add a title, author, and a total copy count from 1 to 500." });
      }
      const books = await ensureBooks();
      const book = {
        id: randomBytes(12).toString("hex"), title, author,
        category: typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 40) : "Other",
        year: Number.isInteger(Number(body.year)) ? Number(body.year) : new Date().getFullYear(),
        isbn: typeof body.isbn === "string" ? body.isbn.trim().slice(0, 24) : "",
        cover: typeof body.cover === "string" && /^https:\/\//.test(body.cover) ? body.cover : "",
        total, available: total,
      };
      books.unshift(book);
      await write("books", books);
      return json(201, { book });
    }

    const bookRoute = route.match(/^books\/([^/]+)$/);
    if (bookRoute && method === "DELETE") {
      const [books, loans] = await Promise.all([ensureBooks(), read("loans")]);
      const book = books.find((entry) => entry.id === bookRoute[1]);
      if (!book) return json(404, { error: "Book not found." });
      if (loans.some((loan) => loan.bookId === book.id && !loan.returnedAt)) return json(409, { error: "This book has an active loan and cannot be removed yet." });
      await write("books", books.filter((entry) => entry.id !== book.id));
      return json(200, { ok: true });
    }

    if (method === "POST" && route === "loans") {
      const [books, loans] = await Promise.all([ensureBooks(), read("loans")]);
      const book = books.find((entry) => entry.id === body.bookId);
      if (!book) return json(404, { error: "Book not found." });
      if (book.available < 1) return json(409, { error: "No copies are available right now." });
      if (loans.filter((loan) => loan.userId === user.id && !loan.returnedAt).length >= 3) return json(409, { error: "You have reached the limit of 3 active loans." });
      const now = new Date();
      const due = new Date(now);
      due.setDate(due.getDate() + 21);
      const loan = { id: randomBytes(12).toString("hex"), userId: user.id, bookId: book.id, checkedOutAt: now.toISOString(), dueAt: due.toISOString(), returnedAt: null };
      book.available -= 1;
      loans.unshift(loan);
      await Promise.all([write("books", books), write("loans", loans)]);
      return json(201, { loan });
    }

    const loanRoute = route.match(/^loans\/([^/]+)\/return$/);
    if (method === "POST" && loanRoute) {
      const [books, loans] = await Promise.all([ensureBooks(), read("loans")]);
      const loan = loans.find((entry) => entry.id === loanRoute[1] && entry.userId === user.id);
      if (!loan) return json(404, { error: "Loan not found." });
      if (loan.returnedAt) return json(409, { error: "This book has already been returned." });
      loan.returnedAt = new Date().toISOString();
      const book = books.find((entry) => entry.id === loan.bookId);
      if (book) book.available = Math.min(book.total, book.available + 1);
      await Promise.all([write("books", books), write("loans", loans)]);
      return json(200, { loan });
    }

    return json(404, { error: "That library route does not exist." });
  } catch (error) {
    console.error("Library API error:", error);
    return json(500, { error: "The library service could not complete that request." });
  }
}