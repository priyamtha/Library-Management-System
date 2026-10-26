const app = document.querySelector("#app");
const bookDialog = document.querySelector("#book-dialog");
const bookDetailsDialog = document.querySelector("#book-details-dialog");
const toast = document.querySelector("#toast");
const initialTheme = (() => {
  try {
    return localStorage.getItem("librahub-theme")
      || localStorage.getItem("folio-theme")
      || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
})();

const state = {
  token: localStorage.getItem("folio-token"),
  user: null,
  books: [],
  loans: [],
  reservations: [],
  favorites: [],
  notes: [],
  activeNoteId: null,
  notesSaveState: "saved",
  view: "overview",
  category: "All books",
  search: "",
  catalogPage: 1,
  catalogSort: "title",
  catalogPageSize: 12,
  authMode: "login",
  loanFilter: "active",
  assistantMessages: [],
  assistantPending: false,
  librarianDashboard: null,
  theme: initialTheme === "dark" ? "dark" : "light",
};

const icons = { overview: "⌂", catalog: "▤", loans: "↗", saved: "☆", notes: "✎", profile: "◉", assistant: "✦" };
const compactNavLabels = { overview: "Home", catalog: "Books", loans: "Loans", saved: "Saved", notes: "Notes", profile: "Profile", assistant: "Ask" };
const noteColors = ["butter", "rose", "mint", "sky"];
const dailyReadingNotes = [
  { quote: "A room without books is like a body without a soul.", author: "Cicero" },
  { quote: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { quote: "Books are a uniquely portable magic.", author: "Stephen King" },
  { quote: "Reading is a conversation. All books talk. But a good reader listens.", author: "M. H. Abrams" },
  { quote: "I have always imagined that Paradise will be a kind of library.", author: "Jorge Luis Borges" },
  { quote: "So many books, so little time.", author: "Frank Zappa" },
  { quote: "A book is a dream that you hold in your hand.", author: "Neil Gaiman" },
  { quote: "Once you learn to read, you will be forever free.", author: "Frederick Douglass" },
  { quote: "The more that you read, the more things you will know.", author: "Dr. Seuss" },
  { quote: "Reading makes a full man; conference a ready man; and writing an exact man.", author: "Francis Bacon" },
];
let noteSaveTimer;
let noteSaveRevision = 0;
const escapeHtml = (value = "") => String(value).replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const safeCover = (value) => typeof value === "string" && /^https:\/\//i.test(value) ? value : "";
const initials = (name = "Reader") => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const dateLabel = (date) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(date));
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", state.theme === "dark" ? "#141414" : "#F7F8F4");
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) icon.href = state.theme === "dark" ? "assets/librahub-icon-dark.svg" : "assets/librahub-icon.svg";
  const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
  if (appleIcon) appleIcon.href = state.theme === "dark" ? "assets/librahub-icon-dark.svg" : "assets/librahub-icon.svg";
}

applyTheme();

function brandLogo({ compact = false, darkBackground = false } = {}) {
  if (compact) {
    return `<span class="brand brand-compact"><img class="brand-icon brand-icon-light" src="assets/librahub-icon.svg" alt="LibraHub" /><img class="brand-icon brand-icon-dark" src="assets/librahub-icon-dark.svg" alt="LibraHub" /></span>`;
  }
  return `<span class="brand${darkBackground ? " brand-on-dark" : ""}"><img class="brand-logo brand-logo-light" src="assets/librahub-logo.svg" alt="LibraHub — Manage Today, Read a Brighter Tomorrow" /><img class="brand-logo brand-logo-dark" src="assets/librahub-logo-dark.svg" alt="LibraHub — Manage Today, Read a Brighter Tomorrow" /></span>`;
}

function themeToggle() {
  const darkMode = state.theme === "dark";
  const label = `Switch to ${darkMode ? "light" : "dark"} mode`;
  return `<button class="theme-toggle" type="button" data-action="toggle-theme" aria-label="${label}" aria-pressed="${darkMode}" title="${label}"><span aria-hidden="true">${darkMode ? "☼" : "☾"}</span><span>${darkMode ? "Light" : "Dark"}</span></button>`;
}

function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  try {
    localStorage.setItem("librahub-theme", state.theme);
  } catch {
    notify("Theme changed for this visit. Browser storage is unavailable.");
  }
  applyTheme();
  if (state.token) renderShell();
  else renderAuth();
}

const todaysReadingNote = () => {
  const elapsedDays = Math.floor(Date.now() / 86400000);
  return dailyReadingNotes[elapsedDays % dailyReadingNotes.length];
};

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(state.token ? { authorization: `Bearer ${state.token}` } : {}), ...options.headers };
  const response = await fetch(`/api/${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

async function lookupBookByIsbn(button) {
  const form = document.querySelector("#book-form");
  const isbn = form.elements.isbn.value.replace(/[^0-9X]/gi, "");
  const errorBox = form.querySelector("#book-form-error");
  if (!isbn) {
    errorBox.textContent = "Enter an ISBN to look up book details.";
    return;
  }

  button.disabled = true;
  button.textContent = "Looking up…";
  errorBox.textContent = "";
  try {
    let metadata;
    try {
      const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`isbn:${isbn}`)}`);
      if (!response.ok) throw new Error("Google Books lookup failed.");
      const result = await response.json();
      const book = result.items?.[0]?.volumeInfo;
      if (book) {
        metadata = {
          title: book.title,
          author: book.authors?.join(", "),
          year: book.publishedDate?.match(/\d{4}/)?.[0],
          category: book.categories?.[0],
          cover: book.imageLinks?.thumbnail?.replace(/^http:/i, "https:"),
        };
      }
    } catch {
      // Fall back to Open Library when Google Books is unavailable or rate-limited.
    }

    if (!metadata) {
      const response = await fetch(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
      if (!response.ok) throw new Error("No book was found for that ISBN.");
      const book = await response.json();
      let author = book.author?.map((name) => {
        const [lastName, firstNames] = name.replace(/\.$/, "").split(/,\s*/, 2);
        return firstNames ? `${firstNames} ${lastName}` : lastName;
      }).join(", ");
      if (!author && book.authors?.length) {
        const authorRecords = await Promise.all(book.authors.map(async ({ key }) => {
          if (!key) return "";
          try {
            const authorResponse = await fetch(`https://openlibrary.org${key}.json`);
            return authorResponse.ok ? (await authorResponse.json()).name || "" : "";
          } catch {
            return "";
          }
        }));
        author = authorRecords.filter(Boolean).join(", ");
      }
      metadata = {
        title: book.title,
        author,
        year: book.publish_date?.match(/\d{4}/)?.[0],
        category: book.subjects?.[0],
        cover: book.covers?.[0] ? `https://covers.openlibrary.org/b/id/${book.covers[0]}-L.jpg` : "",
      };
    }

    if (metadata.title) form.elements.title.value = metadata.title;
    if (metadata.author) form.elements.author.value = metadata.author;
    if (metadata.year) form.elements.year.value = metadata.year;
    if (metadata.category) form.elements.category.value = metadata.category.slice(0, 40);
    if (metadata.cover) form.elements.cover.value = metadata.cover;
  } catch (error) {
    errorBox.textContent = error.message || "Book details could not be found. You can still enter them manually.";
  } finally {
    button.disabled = false;
    button.textContent = "Lookup";
  }
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function setSession(payload) {
  state.token = payload.token;
  state.user = payload.user;
  localStorage.setItem("folio-token", state.token);
}

function renderAuth(error = "") {
  const register = state.authMode === "register";
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-art" aria-label="LibraHub">
        ${brandLogo({ darkBackground: true })}
        <div class="auth-story">
          <p class="eyebrow">MANAGE TODAY, READ A BRIGHTER TOMORROW</p>
          <h1 class="serif">Your next great chapter starts here.</h1>
          <p>Bring your shelves, lending, and reading life together in one welcoming place.</p>
        </div>
        <div class="auth-footer"><span>Thoughtfully made for readers and the people who care for their libraries.</span></div>
      </section>
      <section class="auth-panel">
        <div class="auth-theme-control">${themeToggle()}</div>
        <div class="auth-form-wrap">
          <p class="eyebrow">YOUR LIBRARY, IN GOOD ORDER</p>
          <h2 class="serif">${register ? "Make yourself at home." : "Welcome back."}</h2>
          <p class="auth-subtitle">${register ? "Create your account and start building your collection." : "Sign in to pick up right where you left off."}</p>
          <div class="auth-tabs" role="tablist" aria-label="Account options">
            <button type="button" role="tab" aria-selected="${!register}" class="${!register ? "active" : ""}" data-auth-mode="login">Sign in</button>
            <button type="button" role="tab" aria-selected="${register}" class="${register ? "active" : ""}" data-auth-mode="register">Create account</button>
          </div>
          <form class="auth-form" id="auth-form">
            ${register ? `<label>Your name<input name="name" required minlength="2" maxlength="80" autocomplete="name" placeholder="Alex Morgan" /></label>` : ""}
            <label>Email address<input name="email" required type="email" autocomplete="email" placeholder="you@example.com" /></label>
            <label>Password<input name="password" required type="password" minlength="${register ? 8 : 1}" autocomplete="${register ? "new-password" : "current-password"}" placeholder="${register ? "At least 8 characters" : "Your password"}" /></label>
            ${register ? `<p class="password-note">Use at least 8 characters.</p>` : ""}
            <p class="form-error" role="alert">${escapeHtml(error)}</p>
            <button class="button button-primary auth-submit" type="submit">${register ? "Create my account" : "Sign in to LibraHub"}<span aria-hidden="true">↗</span></button>
          </form>
          <p class="auth-legal">Your library data stays yours. Passwords are securely hashed before storage.</p>
          <p class="auth-tagline">Manage Today, Read a Brighter Tomorrow</p>
        </div>
      </section>
    </main>`;
}

function showBookDetails(bookId) {
  const book = state.books.find((entry) => entry.id === bookId);
  if (!book) return;
  const inventoryTracked = book.inventoryTracked !== false && book.available != null && book.total != null;
  const cover = safeCover(book.cover);
  const sourceUrl = typeof book.sourceUrl === "string" && /^https:\/\//i.test(book.sourceUrl) ? book.sourceUrl : googleBooksUrl(book);
  document.querySelector("#book-details-content").innerHTML = `
    <div class="dialog-heading"><div><p class="eyebrow">BOOK DETAILS</p><h2 id="book-details-title">${escapeHtml(book.title)}</h2></div><button class="icon-button" type="button" data-action="close-details" aria-label="Close details">×</button></div>
    <div class="book-details-body">${cover ? `<img class="book-details-cover" src="${escapeHtml(cover)}" alt="Cover of ${escapeHtml(book.title)}" />` : ""}
      <div><p class="book-details-author">${escapeHtml(book.author)}${book.year ? ` · ${escapeHtml(book.year)}` : ""}</p><p class="book-category">${escapeHtml(book.category || "Other")}</p>
      ${book.isbn ? `<p><strong>ISBN:</strong> ${escapeHtml(book.isbn)}</p>` : ""}
      <p><strong>Inventory:</strong> ${inventoryTracked ? `${escapeHtml(book.available)} of ${escapeHtml(book.total)} copies available` : "Not recorded"}</p>
      ${book.description ? `<p class="book-details-description">${escapeHtml(book.description)}</p>` : ""}
      <a class="button button-secondary" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">View edition source ↗</a></div>
    </div>`;
  bookDetailsDialog.showModal();
}

function navItem(view, label, count = "") {
  return `<button class="nav-item ${state.view === view ? "active" : ""}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ""}><span class="nav-icon" aria-hidden="true">${icons[view]}</span><span class="nav-label">${label}</span><span class="nav-label-mobile">${compactNavLabels[view] || label}</span>${count ? `<span class="nav-count">${count}</span>` : ""}</button>`;
}

function renderShell() {
  const activeLoans = state.loans.filter((loan) => !loan.returnedAt).length;
  const todayNote = todaysReadingNote();
  const viewLabel = { overview: "Overview", catalog: "Browse the catalog", loans: "My loans", saved: "Want to read", notes: "Notepad", profile: "My profile", assistant: "LibraHub Guide" }[state.view];
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        ${brandLogo()}
        <p class="sidebar-label">YOUR LIBRARY</p>
        <nav class="nav-list" aria-label="Main navigation">
          ${navItem("overview", "Overview")}${navItem("catalog", "Browse books")}${navItem("loans", "My loans", activeLoans || "")}${navItem("saved", "Want to read", state.favorites.length || "")}${navItem("notes", "Notepad", state.notes.length || "")}${navItem("profile", "My profile")}${navItem("assistant", "LibraHub Guide")}
        </nav>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-note"><strong>A note for today</strong><p>“${escapeHtml(todayNote.quote)}”<br />— ${escapeHtml(todayNote.author)}</p></div>
        <div class="user-profile" data-action="profile" aria-label="Open your profile" role="button" tabindex="0"><span class="profile-avatar">${escapeHtml(initials(state.user?.name))}</span><div class="profile-copy"><strong>${escapeHtml(state.user?.name)}</strong><span>${escapeHtml(state.user?.email)} · ${state.user?.role === "librarian" ? "Librarian" : "Reader"}</span></div><button class="icon-button" type="button" data-action="logout" aria-label="Sign out" title="Sign out">↪</button></div>
      </aside>
      <div class="main-column">
        <header class="topbar"><div class="breadcrumb">LibraHub <span aria-hidden="true">/</span> <strong>${viewLabel}</strong></div><div class="topbar-right"><label class="search-box"><span aria-hidden="true">⌕</span><input id="global-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search books or authors" aria-label="Search books or authors" /></label>${themeToggle()}<span class="today-label">${new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span></div></header>
        <main class="main-content" id="main-content"></main>
      </div>
    </div>`;
  renderView();
}

function googleBooksUrl(book) {
  const isbn = String(book.isbn || "").trim();
  const query = isbn ? `isbn:${isbn}` : `intitle:${book.title} inauthor:${book.author}`;
  return `https://books.google.com/books?${new URLSearchParams({ q: query })}`;
}

function ebookUrl(book) {
  return /^https:\/\/www\.gutenberg\.org\/ebooks\/\d+\/?$/i.test(book.ebookUrl || "")
    ? book.ebookUrl
    : googleBooksUrl(book);
}

function bookCard(book) {
  const cover = safeCover(book.cover);
  const inventoryTracked = book.inventoryTracked !== false && book.available != null && book.total != null;
  const available = inventoryTracked && Number(book.available) > 0;
  const hasEbook = Boolean(book.ebookUrl && ebookUrl(book) === book.ebookUrl);
  const saved = state.favorites.includes(book.id);
  const reservation = state.reservations.find((entry) => entry.bookId === book.id && ["waiting", "ready"].includes(entry.status));
  return `<article class="book-card">
    <div class="book-cover-wrap"><div class="cover-fallback" aria-hidden="true"><span>${escapeHtml(book.title)}</span></div>${cover ? `<img class="book-cover" src="${escapeHtml(cover)}" alt="Cover of ${escapeHtml(book.title)}" loading="lazy" />` : ""}</div>
    <div class="book-meta"><span class="book-category">${escapeHtml(book.category || "Other")}</span><h3 class="book-title">${escapeHtml(book.title)}</h3><p class="book-author">${escapeHtml(book.author)}${book.year ? ` · ${escapeHtml(book.year)}` : ""}</p>
      <div class="book-footer"><span class="availability ${available ? "" : "out"}">${inventoryTracked ? (available ? `${book.available} available` : "All on loan") : "Inventory not recorded"}</span><div class="book-actions"><button class="book-save ${saved ? "saved" : ""}" type="button" data-action="favorite" data-id="${escapeHtml(book.id)}" aria-pressed="${saved}" aria-label="${saved ? "Remove from" : "Add to"} want-to-read list" title="${saved ? "Remove from" : "Add to"} want-to-read list">${saved ? "★" : "☆"}</button><button class="book-action" type="button" data-action="book-details" data-id="${escapeHtml(book.id)}">Details</button><a class="book-action" href="${escapeHtml(ebookUrl(book))}" target="_blank" rel="noopener noreferrer" aria-label="${hasEbook ? `Read ${escapeHtml(book.title)} on Project Gutenberg` : `Find ${escapeHtml(book.title)} on Google Books`}">${hasEbook ? "Free read" : "Read"}</a>${inventoryTracked ? (available ? `<button class="book-action borrow-action" type="button" data-action="borrow" data-id="${escapeHtml(book.id)}">Borrow</button>` : `<button class="book-action reserve-action" type="button" data-action="reserve" data-id="${escapeHtml(book.id)}" ${reservation ? "disabled" : ""}>${reservation ? (reservation.status === "ready" ? "Reserved" : "Waiting") : "Reserve"}</button>`) : ""}</div></div>
      ${state.user?.role === "librarian" ? `<button class="book-remove" type="button" data-action="remove-book" data-id="${escapeHtml(book.id)}">Remove from collection</button>` : ""}
    </div>
  </article>`;
}

function loanStatus(loan) {
  if (loan.returnedAt) return { label: "Returned", className: "returned" };
  if (new Date(loan.dueAt) < new Date()) return { label: "Overdue", className: "overdue" };
  return { label: "On loan", className: "" };
}

function loanRow(loan) {
  const book = state.books.find((entry) => entry.id === loan.bookId);
  const title = book?.title || "Book no longer in collection";
  const cover = safeCover(book?.cover);
  const status = loanStatus(loan);
  return `<article class="loan-row">
    <div class="loan-book">${cover ? `<img class="loan-thumb" src="${escapeHtml(cover)}" alt="" loading="lazy" />` : `<span class="loan-thumb" aria-hidden="true"></span>`}<div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(book?.author || "")}</span></div></div>
    <div><span class="loan-label">Due date</span><span class="loan-date">${dateLabel(loan.dueAt)}</span></div>
    <span class="loan-status ${status.className}">${status.label}</span>
    ${loan.returnedAt ? `<span class="loan-date">${dateLabel(loan.returnedAt)}</span>` : `<button class="button button-secondary" type="button" data-action="return" data-id="${escapeHtml(loan.id)}">Return book</button>`}
  </article>`;
}

function reservationRow(reservation) {
  const book = state.books.find((entry) => entry.id === reservation.bookId);
  const status = reservation.status === "ready"
    ? `Ready until ${dateLabel(reservation.expiresAt)}`
    : reservation.status === "waiting" ? "Waiting for a copy" : reservation.status;
  const active = ["waiting", "ready"].includes(reservation.status);
  return `<article class="loan-row reservation-row"><div class="loan-book"><div><strong>${escapeHtml(book?.title || "Book no longer in collection")}</strong><span>${escapeHtml(book?.author || "")}</span></div></div><span class="loan-status ${reservation.status === "ready" ? "" : "returned"}">${escapeHtml(status)}</span>${active ? `<button class="button button-secondary" type="button" data-action="cancel-reservation" data-id="${escapeHtml(reservation.id)}">Cancel hold</button>` : ""}</article>`;
}

function filteredBooks() {
  const query = normalizeCatalogText(state.search);
  const isbnQuery = state.search.replace(/[^\dX]/gi, "").toUpperCase();
  const books = state.books.filter((book) => {
    const matchesCategory = state.category === "All books" || book.category === state.category;
    const searchable = normalizeCatalogText(`${book.title} ${book.author} ${book.category} ${book.isbn}`);
    const matchesSearch = !query || searchable.includes(query) || (isbnQuery && String(book.isbn || "").replace(/[^\dX]/gi, "").toUpperCase().includes(isbnQuery));
    return matchesCategory && matchesSearch;
  });
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  books.sort((first, second) => {
    if (state.catalogSort === "author") return collator.compare(first.author, second.author) || collator.compare(first.title, second.title);
    if (state.catalogSort === "year") return (Number(second.year) || 0) - (Number(first.year) || 0) || collator.compare(first.title, second.title);
    if (state.catalogSort === "availability") {
      const firstTracked = first.inventoryTracked !== false && first.available != null && first.total != null;
      const secondTracked = second.inventoryTracked !== false && second.available != null && second.total != null;
      if (firstTracked !== secondTracked) return firstTracked ? -1 : 1;
      return (Number(second.available) || 0) - (Number(first.available) || 0) || collator.compare(first.title, second.title);
    }
    return collator.compare(first.title, second.title);
  });
  return books;
}

function normalizeCatalogText(value) {
  return String(value || "").normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function renderLibrarianDashboard() {
  const dashboard = state.librarianDashboard || { overdueLoans: [], dueSoonLoans: [], activeReservations: [] };
  const overdueLoans = dashboard.overdueLoans;
  const dueSoonLoans = dashboard.dueSoonLoans;
  const activeReservations = dashboard.activeReservations;
  const needsAttention = [...overdueLoans.map((loan) => ({
    label: "Overdue",
    bookId: loan.bookId,
    detail: `Due ${dateLabel(loan.dueAt)}`,
  })), ...dueSoonLoans.map((loan) => ({
    label: "Due soon",
    bookId: loan.bookId,
    detail: `Due ${dateLabel(loan.dueAt)}`,
  })), ...activeReservations.map((reservation) => ({
    label: reservation.status === "ready" ? "Ready to collect" : "Waiting",
    bookId: reservation.bookId,
    detail: reservation.status === "ready" ? `Available until ${dateLabel(reservation.expiresAt)}` : "Queued for next copy",
  }))].slice(0, 4);

  const loaderItems = needsAttention.length
    ? needsAttention.map((item) => {
        const book = state.books.find((entry) => entry.id === item.bookId);
        return `<article class="loan-row"><div class="loan-book"><div><strong>${escapeHtml(book?.title || "Unknown title")}</strong><span>${escapeHtml(item.detail)}</span></div></div><span class="loan-status ${item.label === "Overdue" ? "overdue" : "returned"}">${escapeHtml(item.label)}</span></article>`;
      }).join("")
    : `<p class="empty-inline">Everything looks steady right now.</p>`;

  return `<section class="shelf-section"><div class="section-heading"><div><h2 class="serif">Librarian dashboard</h2><p>Quick view of the books that need attention.</p></div><button class="text-button" type="button" data-view="catalog">Open collection <span aria-hidden="true">↗</span></button></div>
    <section class="stats-row" aria-label="Librarian dashboard statistics">
      <div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">↗</span>Overdue</div><strong>${overdueLoans.length}</strong></div>
      <div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">☆</span>Waiting list</div><strong>${activeReservations.length}</strong></div>
      <div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">✦</span>Due soon</div><strong>${dueSoonLoans.length}</strong></div>
    </section>
    <div class="loan-list">${loaderItems}</div>
  </section>`;
}

function renderOverview() {
  const availableCount = state.books.reduce((total, book) => total + Number(book.available || 0), 0);
  const borrowedCount = state.loans.filter((loan) => !loan.returnedAt).length;
  const dueNotices = state.loans.filter((loan) => {
    if (loan.returnedAt) return false;
    return new Date(loan.dueAt).getTime() - Date.now() <= 7 * 24 * 60 * 60 * 1000;
  });
  const featured = state.books[0];
  const recentLoans = state.loans.filter((loan) => !loan.returnedAt).slice(0, 2);
  const categories = new Set(state.books.map((book) => book.category).filter(Boolean)).size;
  return `<div class="page-heading"><div><p class="eyebrow">${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</p><h1 class="serif">Good to see you, ${escapeHtml(state.user?.name?.split(" ")[0])}.</h1><p>Your little corner of the reading world is looking good.</p></div>${state.user?.role === "librarian" ? `<button class="button button-secondary" type="button" data-action="add-book">＋ Add a book</button>` : ""}</div>
    ${dueNotices.length ? `<section class="due-notice" role="status"><div><strong>${dueNotices.length === 1 ? "A book needs your attention" : `${dueNotices.length} books need your attention`}</strong><p>${dueNotices.map((loan) => { const book = state.books.find((entry) => entry.id === loan.bookId); const overdue = new Date(loan.dueAt) < new Date(); return `${escapeHtml(book?.title || "A borrowed book")} ${overdue ? "is overdue" : `is due ${dateLabel(loan.dueAt)}`}`; }).join(" · ")}</p></div><button class="text-button" type="button" data-view="loans">View loans ↗</button></section>` : ""}
    <section class="welcome-banner"><div class="welcome-copy"><p class="eyebrow">A COLLECTION WITH CHARACTER</p><h2 class="serif">A good book has a way of finding its person.</h2><p>Keep your shelves in order, share stories, and make space for what's next.</p><button class="button" type="button" data-view="catalog">Find your next read <span aria-hidden="true">↗</span></button></div><div class="welcome-cover">${featured && safeCover(featured.cover) ? `<img src="${escapeHtml(safeCover(featured.cover))}" alt="Cover of ${escapeHtml(featured.title)}" />` : `<span class="cover-fallback"><span>${escapeHtml(featured?.title || "A good book")}</span></span>`}</div></section>
    <section class="stats-row" aria-label="Library statistics"><div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">▤</span>Titles in your library</div><strong>${state.books.length}</strong></div><div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">✳</span>Copies ready to read</div><strong>${availableCount}</strong></div><div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">↗</span>Currently borrowed</div><strong>${borrowedCount}<small style="font-size:12px;color:var(--muted);font-weight:400"> / 3</small></strong></div></section>
    ${state.user?.role === "librarian" ? renderLibrarianDashboard() : ""}
    <div class="section-heading"><div><h2 class="serif">A few from the shelves</h2><p>${categories} lovely corners of the collection</p></div><button class="text-button" type="button" data-view="catalog">Explore all books <span aria-hidden="true">↗</span></button></div>
    ${state.books.length ? `<div class="book-grid">${state.books.slice(0, 4).map(bookCard).join("")}</div>` : `<div class="empty-state"><strong>Your shelves are waiting.</strong><p>Add your first book to start your collection.</p><button class="button button-primary" data-action="add-book" type="button">＋ Add a book</button></div>`}
    <section class="shelf-section"><div class="section-heading"><div><h2 class="serif">Out in the world</h2><p>${borrowedCount ? "Your currently borrowed books" : "Books you borrow will find a home here"}</p></div><button class="text-button" type="button" data-view="loans">View all loans <span aria-hidden="true">↗</span></button></div>${recentLoans.length ? `<div class="loan-list">${recentLoans.map(loanRow).join("")}</div>` : ""}</section>`;
}

function renderCatalog() {
  const categories = ["All books", ...new Set(state.books.map((book) => book.category).filter(Boolean).sort())];
  const books = filteredBooks();
  const pageCount = Math.max(1, Math.ceil(books.length / state.catalogPageSize));
  state.catalogPage = Math.min(state.catalogPage, pageCount);
  const start = (state.catalogPage - 1) * state.catalogPageSize;
  const pageBooks = books.slice(start, start + state.catalogPageSize);
  const pagination = pageCount > 1 ? `<nav class="catalog-pagination" aria-label="Collection pages"><button type="button" class="button button-secondary" data-catalog-page="${state.catalogPage - 1}" ${state.catalogPage === 1 ? "disabled" : ""}>Previous</button><span>Page ${state.catalogPage} of ${pageCount}</span><button type="button" class="button button-secondary" data-catalog-page="${state.catalogPage + 1}" ${state.catalogPage === pageCount ? "disabled" : ""}>Next</button></nav>` : "";
  return `<div class="page-heading"><div><p class="eyebrow">MAKE YOURSELF AT HOME</p><h1 class="serif">The collection</h1><p>Every title has its own little story. Find one that speaks to you.</p></div>${state.user?.role === "librarian" ? `<button class="button button-primary" type="button" data-action="add-book">＋ Add a book</button>` : ""}</div>
    <div class="category-filter" role="group" aria-label="Filter by category">${categories.map((category) => `<button type="button" class="filter-chip ${category === state.category ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}</div>
    <div class="catalog-tools"><span class="result-count">${books.length ? `Showing ${start + 1}–${Math.min(start + state.catalogPageSize, books.length)} of ${books.length}` : "Showing 0"} (${state.books.length} total)</span><label class="catalog-sort">Sort by<select id="catalog-sort" aria-label="Sort books"><option value="title" ${state.catalogSort === "title" ? "selected" : ""}>Title</option><option value="author" ${state.catalogSort === "author" ? "selected" : ""}>Author</option><option value="year" ${state.catalogSort === "year" ? "selected" : ""}>Newest</option><option value="availability" ${state.catalogSort === "availability" ? "selected" : ""}>Availability</option></select></label></div>
    ${books.length ? `<div class="book-grid">${pageBooks.map(bookCard).join("")}</div>${pagination}` : `<div class="empty-state"><strong>No books found just yet.</strong><p>Try another title, author, or category.</p>${state.books.length || state.user?.role !== "librarian" ? "" : `<button class="button button-primary" data-action="add-book" type="button">＋ Add a book</button>`}</div>`}`;
}

function renderLoans() {
  const loans = state.loans.filter((loan) => state.loanFilter === "all" || (state.loanFilter === "active" ? !loan.returnedAt : Boolean(loan.returnedAt)));
  const active = state.loans.filter((loan) => !loan.returnedAt).length;
  const activeReservations = state.reservations.filter((reservation) => ["waiting", "ready"].includes(reservation.status));
  return `<div class="page-heading"><div><p class="eyebrow">ON LOAN, BACK SOON</p><h1 class="serif">Your reading list</h1><p>Keep an eye on what's due and return a book when you're ready.</p></div><button class="button button-primary" type="button" data-view="catalog">Find a book <span aria-hidden="true">↗</span></button></div>
    <div class="category-filter" role="group" aria-label="Filter loans"><button class="filter-chip ${state.loanFilter === "active" ? "active" : ""}" data-loan-filter="active">Active${active ? ` · ${active}` : ""}</button><button class="filter-chip ${state.loanFilter === "returned" ? "active" : ""}" data-loan-filter="returned">Returned</button><button class="filter-chip ${state.loanFilter === "all" ? "active" : ""}" data-loan-filter="all">All history</button></div>
    ${loans.length ? `<div class="loan-list">${loans.map(loanRow).join("")}</div>` : `<div class="empty-state"><strong>${state.loanFilter === "returned" ? "No returned books yet." : "Nothing checked out right now."}</strong><p>Your next favorite could be one shelf away.</p><button class="button button-primary" type="button" data-view="catalog">Browse the collection <span aria-hidden="true">↗</span></button></div>`}
    <section class="shelf-section"><div class="section-heading"><div><h2 class="serif">Reservations</h2><p>Holds on books that are currently out</p></div></div>${activeReservations.length ? `<div class="loan-list">${activeReservations.map(reservationRow).join("")}</div>` : `<p class="empty-inline">No active reservations.</p>`}</section>`;
}

function renderSaved() {
  const books = state.books.filter((book) => state.favorites.includes(book.id));
  return `<div class="page-heading"><div><p class="eyebrow">FOR ANOTHER DAY</p><h1 class="serif">Want to read</h1><p>Books you’ve saved for later.</p></div><button class="button button-secondary" type="button" data-view="catalog">Browse books</button></div>${books.length ? `<div class="book-grid">${books.map(bookCard).join("")}</div>` : `<div class="empty-state"><strong>Your list is waiting.</strong><p>Save a book with the star to keep it here.</p><button class="button button-primary" type="button" data-view="catalog">Browse books</button></div>`}`;
}

function renderAssistantMessage(message) {
  const isUser = message.role === "user";
  const text = escapeHtml(message.text).replace(/\n/g, "<br>");
  return `<article class="assistant-message ${isUser ? "from-user" : "from-assistant"} ${message.role === "error" ? "assistant-error" : ""}"><span class="assistant-avatar" aria-hidden="true">${isUser ? escapeHtml(initials(state.user?.name)) : "L"}</span><p>${text}</p></article>`;
}

function renderAssistant() {
  const savedBooks = state.books.filter((book) => state.favorites.includes(book.id));
  const activeLoans = state.loans.filter((loan) => !loan.returnedAt);
  const conversation = state.assistantMessages.length
    ? state.assistantMessages.map(renderAssistantMessage).join("")
    : renderAssistantMessage({ role: "assistant", text: "Tell me what you feel like reading, and I’ll look through your shelves." });
  const typing = state.assistantPending
    ? `<article class="assistant-message from-assistant assistant-typing" role="status" aria-label="LibraHub is thinking"><span class="assistant-avatar" aria-hidden="true">L</span><p><span></span><span></span><span></span></p></article>`
    : "";

  return `<div class="assistant-page">
    <div class="page-heading assistant-heading"><div><p class="eyebrow">A READING COMPANION</p><h1 class="serif">LibraHub Guide</h1><p>Find your next book in the collection.</p></div><button class="button button-secondary" type="button" data-view="catalog">Browse shelves <span aria-hidden="true">↗</span></button></div>
    <div class="assistant-layout">
      <section class="assistant-panel" aria-label="LibraHub reading assistant">
        <div class="assistant-panel-heading"><div><span class="assistant-mark" aria-hidden="true">✦</span><div><strong>Your LibraHub librarian</strong><span>Grounded in your collection</span></div></div><span class="assistant-live"><i></i> READY</span></div>
        <div class="assistant-thread" id="assistant-thread" aria-live="polite">${conversation}${typing}</div>
        <div class="assistant-compose-area">
          <div class="assistant-prompts" aria-label="Suggested questions"><button type="button" data-assistant-prompt="Find me a free classic I can read online.">A free classic</button><button type="button" data-assistant-prompt="Recommend something thoughtful from my shelves.">Something thoughtful</button><button type="button" data-assistant-prompt="What should I borrow next?">Pick my next read</button></div>
          <form id="assistant-form" class="assistant-compose"><label class="sr-only" for="assistant-question">Ask LibraHub a question</label><textarea id="assistant-question" name="question" rows="2" maxlength="600" placeholder="What are you in the mood for?" required ${state.assistantPending ? "disabled" : ""}></textarea><button class="assistant-send" type="submit" aria-label="Send question" title="Send question" ${state.assistantPending ? "disabled" : ""}><span aria-hidden="true">↗</span></button></form>
          <p class="assistant-privacy">Your question and book details are sent to Google Gemini to create a reply.</p>
        </div>
      </section>
      <aside class="assistant-shelf" aria-label="Your library context"><p class="eyebrow">ON YOUR SHELVES</p><h2 class="serif">Your library</h2><div class="assistant-stat"><span>Titles</span><strong>${state.books.length}</strong></div><div class="assistant-stat"><span>Saved for later</span><strong>${savedBooks.length}</strong></div><div class="assistant-stat"><span>Currently borrowed</span><strong>${activeLoans.length}</strong></div><div class="assistant-saved"><h3>Saved titles</h3>${savedBooks.length ? savedBooks.slice(0, 4).map((book) => `<p>${escapeHtml(book.title)}</p>`).join("") : `<p class="assistant-muted">Your saved list is empty.</p>`}</div></aside>
    </div>
  </div>`;
}

function renderProfile() {
  const todayNote = todaysReadingNote();
  const activeLoans = state.loans.filter((loan) => !loan.returnedAt).length;
  const savedBooks = state.books.filter((book) => state.favorites.includes(book.id));
  const notesCount = state.notes.length;
  const daysBorrowed = state.loans.filter((loan) => loan.returnedAt).length;

  return `<div class="page-heading"><div><p class="eyebrow">YOUR PROFILE</p><h1 class="serif">${escapeHtml(state.user?.name || "Reader profile")}</h1><p>Keep track of your reading habits and library activity.</p></div></div>
    <section class="welcome-banner profile-banner">
      <div class="welcome-copy">
        <p class="eyebrow">ACCOUNT</p>
        <h2 class="serif">${escapeHtml(state.user?.name || "Reader")}</h2>
        <p>${escapeHtml(state.user?.email || "reader@example.com")} · ${state.user?.role === "librarian" ? "Librarian" : "Reader"}</p>
        <button class="button button-secondary" type="button" data-action="logout">Sign out</button>
      </div>
      <div class="welcome-cover"><span class="cover-fallback"><span>${escapeHtml(initials(state.user?.name))}</span></span></div>
    </section>
    <section class="stats-row" aria-label="Your profile statistics">
      <div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">▤</span>Books in library</div><strong>${state.books.length}</strong></div>
      <div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">☆</span>Saved titles</div><strong>${savedBooks.length}</strong></div>
      <div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">↗</span>Active loans</div><strong>${activeLoans}</strong></div>
      <div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">✎</span>Notes</div><strong>${notesCount}</strong></div>
    </section>
    <div class="section-heading"><div><h2 class="serif">Reading rhythm</h2><p>${daysBorrowed} returned book${daysBorrowed === 1 ? "" : "s"} in your record</p></div></div>
    <section class="shelf-section">
      <div class="section-heading"><div><h2 class="serif">Today’s thought</h2><p>Fresh for the day</p></div></div>
      <div class="loan-list">
        <article class="loan-row">
          <div class="loan-book"><div><strong>Daily reading note</strong><span>“${escapeHtml(todayNote.quote)}”</span></div></div>
          <span class="loan-status">— ${escapeHtml(todayNote.author)}</span>
        </article>
      </div>
    </section>
  `;
}

function currentNote() {
  return state.notes.find((note) => note.id === state.activeNoteId) || state.notes[0] || null;
}

function scheduleNotesSave() {
  const revision = ++noteSaveRevision;
  state.notesSaveState = "saving";
  const status = document.querySelector("#note-save-status");
  if (status) status.textContent = "Saving…";
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(async () => {
    try {
      const result = await api("notes", { method: "PUT", body: JSON.stringify({ notes: state.notes }) });
      if (revision !== noteSaveRevision) return;
      state.notes = result.notes;
      state.notesSaveState = "saved";
      const saveStatus = document.querySelector("#note-save-status");
      if (saveStatus) saveStatus.textContent = "All changes saved";
      updateNoteListPreview(currentNote());
    } catch {
      if (revision !== noteSaveRevision) return;
      state.notesSaveState = "error";
      const saveStatus = document.querySelector("#note-save-status");
      if (saveStatus) saveStatus.textContent = "Couldn't save. Try typing again.";
    }
  }, 500);
}

function updateNoteListPreview(note) {
  if (!note) return;
  const title = note.title.trim() || "Untitled note";
  const preview = note.content.replace(/\s+/g, " ").trim() || "A little blank space";
  const updated = note.updatedAt ? dateLabel(note.updatedAt) : "Just now";
  for (const item of document.querySelectorAll("[data-note-id]")) {
    if (item.dataset.noteId !== note.id) continue;
    const titleNode = item.querySelector(".note-index-title");
    const previewNode = item.querySelector(".note-index-preview");
    const dateNode = item.querySelector(".note-index-date");
    if (titleNode) titleNode.textContent = title;
    if (previewNode) previewNode.textContent = preview.slice(0, 64);
    if (dateNode) dateNode.textContent = updated;
  }
  const footerDate = document.querySelector(".note-paper-footer span:last-child");
  if (footerDate && note.updatedAt) footerDate.textContent = `Edited ${dateLabel(note.updatedAt)}`;
}

function renderNotepad() {
  const note = currentNote();
  const header = `<div class="page-heading notes-heading"><div><p class="eyebrow">A LITTLE SPACE FOR THOUGHTS</p><h1 class="serif">Notepad</h1><p>Quotes, plans, and things worth remembering.</p></div><button class="button button-secondary" type="button" data-action="add-note">＋ New note</button></div>`;
  if (!note) {
    return `<div class="notes-page">${header}<section class="notes-empty"><span class="notes-empty-mark" aria-hidden="true">✎</span><h2 class="serif">A fresh page is waiting.</h2><p>Start with a quote, a reading idea, or a thought for later.</p><button class="button button-primary" type="button" data-action="add-note">Write a note <span aria-hidden="true">↗</span></button></section></div>`;
  }

  const notesIndex = state.notes.map((entry) => {
    const title = entry.title.trim() || "Untitled note";
    const preview = entry.content.replace(/\s+/g, " ").trim() || "A little blank space";
    const updated = entry.updatedAt ? dateLabel(entry.updatedAt) : "Just now";
    return `<button class="note-index-item ${entry.id === note.id ? "active" : ""}" type="button" data-action="select-note" data-id="${escapeHtml(entry.id)}" data-note-id="${escapeHtml(entry.id)}"><span class="note-index-dot note-color-${escapeHtml(entry.color)}"></span><span class="note-index-copy"><strong class="note-index-title">${escapeHtml(title)}</strong><span class="note-index-preview">${escapeHtml(preview.slice(0, 64))}</span><span class="note-index-date">${escapeHtml(updated)}</span></span></button>`;
  }).join("");

  return `<div class="notes-page">${header}<div class="notes-workspace"><aside class="notes-index" aria-label="Your notes"><div class="notes-index-heading"><div><strong>My notes</strong><span>${state.notes.length} ${state.notes.length === 1 ? "note" : "notes"}</span></div><button class="icon-button notes-add-button" type="button" data-action="add-note" aria-label="Create a new note" title="New note">＋</button></div><div class="notes-index-list">${notesIndex}</div></aside><section class="note-paper note-paper-${escapeHtml(note.color)}" aria-label="Note editor"><div class="note-paper-fold" aria-hidden="true"></div><div class="note-toolbar"><span class="note-save-status" id="note-save-status" role="status">${state.notesSaveState === "saving" ? "Saving…" : state.notesSaveState === "error" ? "Couldn't save. Try typing again." : "All changes saved"}</span><div class="note-toolbar-actions"><div class="note-color-picker" role="group" aria-label="Note color">${noteColors.map((color) => `<button class="note-color-swatch note-color-${color} ${note.color === color ? "active" : ""}" type="button" data-action="note-color" data-color="${color}" aria-label="${color} paper" aria-pressed="${note.color === color}" title="${color} paper"></button>`).join("")}</div><button class="icon-button note-delete-button" type="button" data-action="delete-note" data-id="${escapeHtml(note.id)}" aria-label="Delete note" title="Delete note">×</button></div></div><input class="note-title-input" data-note-field="title" maxlength="80" value="${escapeHtml(note.title)}" placeholder="A note to self…" aria-label="Note title" /><textarea class="note-content-input" data-note-field="content" maxlength="12000" placeholder="Start wherever your thoughts take you…" aria-label="Note text">${escapeHtml(note.content)}</textarea><div class="note-paper-footer"><span>✳ Take your time</span><span>${note.updatedAt ? `Edited ${dateLabel(note.updatedAt)}` : "New note"}</span></div></section></div></div>`;
}

function renderView() {
  const main = document.querySelector("#main-content");
  if (!main) return;
  main.innerHTML = state.view === "catalog"
    ? renderCatalog()
    : state.view === "loans"
      ? renderLoans()
      : state.view === "saved"
        ? renderSaved()
        : state.view === "notes"
          ? renderNotepad()
          : state.view === "profile"
            ? renderProfile()
            : state.view === "assistant"
              ? renderAssistant()
              : renderOverview();
}

async function refresh() {
  const result = await api("bootstrap");
  state.user = result.user;
  state.books = result.books;
  state.loans = result.loans;
  state.reservations = result.reservations || [];
  state.librarianDashboard = result.librarianDashboard || null;
  state.favorites = result.favorites || [];
  state.notes = result.notes || [];
  if (!state.notes.some((note) => note.id === state.activeNoteId)) state.activeNoteId = state.notes[0]?.id || null;
  renderShell();
}

app.addEventListener("submit", async (event) => {
  if (event.target.id === "assistant-form") {
    event.preventDefault();
    const form = event.target;
    const question = form.elements.question.value.trim();
    if (!question || state.assistantPending) return;
    const requestToken = state.token;
    const history = state.assistantMessages.filter((message) => ["user", "assistant"].includes(message.role)).slice(-8);
    state.assistantMessages.push({ role: "user", text: question });
    state.assistantPending = true;
    renderShell();
    try {
      const result = await api("assistant", {
        method: "POST",
        body: JSON.stringify({ question, history }),
      });
      if (state.token === requestToken) state.assistantMessages.push({ role: "assistant", text: result.answer });
    } catch (error) {
      if (state.token === requestToken) state.assistantMessages.push({ role: "error", text: error.message });
    } finally {
      if (state.token === requestToken) state.assistantPending = false;
      if (state.token === requestToken && state.view === "assistant") {
        renderShell();
        const thread = document.querySelector("#assistant-thread");
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        thread?.scrollTo({ top: thread.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
      }
    }
    return;
  }
  if (event.target.id === "auth-form") {
    event.preventDefault();
    const formData = new FormData(event.target);
    const credentials = Object.fromEntries(formData.entries());
    const submitButton = event.target.querySelector("button[type=submit]");
    submitButton.disabled = true;
    submitButton.textContent = "One moment…";
    try {
      const payload = await api(`auth/${state.authMode}`, { method: "POST", body: JSON.stringify(credentials) });
      setSession(payload);
      state.view = "overview";
      await refresh();
    } catch (error) {
      renderAuth(error.message);
    }
  }
});

bookDetailsDialog.addEventListener("click", (event) => {
  if (event.target === bookDetailsDialog || event.target.closest('[data-action="close-details"]')) bookDetailsDialog.close();
});

bookDialog.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const errorBox = form.querySelector("#book-form-error");
  const submitButton = form.querySelector("button[type=submit]");
  const book = Object.fromEntries(new FormData(form).entries());
  book.inventoryTracked = form.elements.inventoryTracked.checked;
  book.total = book.inventoryTracked ? Number(book.total) : null;
  submitButton.disabled = true;
  errorBox.textContent = "";
  try {
    await api("books", { method: "POST", body: JSON.stringify(book) });
    bookDialog.close();
    form.reset();
    form.elements.total.value = 1;
    syncInventoryInput();
    await refresh();
    state.view = "catalog";
    renderShell();
    notify("Added to your collection.");
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

app.addEventListener("click", async (event) => {
  const assistantPrompt = event.target.closest("[data-assistant-prompt]");
  if (assistantPrompt) {
    const input = document.querySelector("#assistant-question");
    const form = document.querySelector("#assistant-form");
    if (input && form) {
      input.value = assistantPrompt.dataset.assistantPrompt;
      form.requestSubmit();
    }
    return;
  }
  const modeButton = event.target.closest("[data-auth-mode]");
  if (modeButton) {
    state.authMode = modeButton.dataset.authMode;
    renderAuth();
    return;
  }
  const navButton = event.target.closest("[data-view]");
  if (navButton) {
    state.view = navButton.dataset.view;
    renderShell();
    return;
  }
  const action = event.target.closest("[data-action]");
  if (action?.dataset.action === "toggle-theme") {
    toggleTheme();
    return;
  }
  if (action && action.dataset.action === "profile") {
    state.view = "profile";
    renderShell();
    return;
  }
  const categoryButton = event.target.closest("[data-category]");
  if (categoryButton) {
    state.category = categoryButton.dataset.category;
    state.catalogPage = 1;
    renderView();
    return;
  }
  const catalogPageButton = event.target.closest("[data-catalog-page]");
  if (catalogPageButton) {
    state.catalogPage = Number(catalogPageButton.dataset.catalogPage);
    renderView();
    return;
  }
  if (action?.dataset.action === "book-details") {
    showBookDetails(action.dataset.id);
    return;
  }
  if (action?.dataset.action === "close-details") {
    bookDetailsDialog.close();
    return;
  }
  const loanFilterButton = event.target.closest("[data-loan-filter]");
  if (loanFilterButton) {
    state.loanFilter = loanFilterButton.dataset.loanFilter;
    renderView();
    return;
  }
  if (!action) return;
  if (action.dataset.action === "add-book") {
    if (state.user?.role !== "librarian") return;
    document.querySelector("#book-form-error").textContent = "";
    syncInventoryInput();
    bookDialog.showModal();
  }
  if (action.dataset.action === "add-note") {
    const note = {
      id: globalThis.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title: "",
      content: "",
      color: "butter",
    };
    state.notes.unshift(note);
    state.activeNoteId = note.id;
    state.view = "notes";
    renderShell();
    scheduleNotesSave();
    document.querySelector(".note-title-input")?.focus();
  }
  if (action.dataset.action === "select-note") {
    state.activeNoteId = action.dataset.id;
    renderView();
  }
  if (action.dataset.action === "note-color") {
    const note = currentNote();
    if (!note || !noteColors.includes(action.dataset.color)) return;
    note.color = action.dataset.color;
    renderView();
    scheduleNotesSave();
  }
  if (action.dataset.action === "delete-note") {
    const note = currentNote();
    if (!note || !window.confirm("Delete this note? This cannot be undone.")) return;
    state.notes = state.notes.filter((entry) => entry.id !== note.id);
    state.activeNoteId = state.notes[0]?.id || null;
    renderShell();
    scheduleNotesSave();
  }
  if (action.dataset.action === "favorite") {
    action.disabled = true;
    try {
      const path = `favorites/${encodeURIComponent(action.dataset.id)}`;
      const result = action.getAttribute("aria-pressed") === "true"
        ? await api(path, { method: "DELETE" })
        : await api("favorites", { method: "POST", body: JSON.stringify({ bookId: action.dataset.id }) });
      state.favorites = result.favorites;
      renderShell();
    } catch (error) {
      notify(error.message);
      action.disabled = false;
    }
  }
  if (action.dataset.action === "reserve") {
    action.disabled = true;
    try {
      await api("reservations", { method: "POST", body: JSON.stringify({ bookId: action.dataset.id }) });
      await refresh();
      state.view = "catalog";
      renderShell();
      notify("You’re in the reservation queue.");
    } catch (error) {
      notify(error.message);
      action.disabled = false;
    }
  }
  if (action.dataset.action === "cancel-reservation") {
    action.disabled = true;
    try {
      await api(`reservations/${encodeURIComponent(action.dataset.id)}`, { method: "DELETE" });
      await refresh();
      state.view = "loans";
      renderShell();
      notify("Reservation cancelled.");
    } catch (error) {
      notify(error.message);
      action.disabled = false;
    }
  }
  if (action.dataset.action === "borrow") {
    action.disabled = true;
    try {
      await api("loans", { method: "POST", body: JSON.stringify({ bookId: action.dataset.id }) });
      await refresh();
      notify("Book checked out. Happy reading!");
    } catch (error) {
      notify(error.message);
      action.disabled = false;
    }
  }
  if (action.dataset.action === "return") {
    action.disabled = true;
    try {
      await api(`loans/${encodeURIComponent(action.dataset.id)}/return`, { method: "POST", body: "{}" });
      await refresh();
      notify("Book returned. Thanks for taking good care of it.");
    } catch (error) {
      notify(error.message);
      action.disabled = false;
    }
  }
  if (action.dataset.action === "remove-book") {
    const book = state.books.find((entry) => entry.id === action.dataset.id);
    if (!book || !window.confirm(`Remove “${book.title}” from your collection?`)) return;
    try {
      await api(`books/${encodeURIComponent(book.id)}`, { method: "DELETE" });
      await refresh();
      notify("Book removed from your collection.");
    } catch (error) {
      notify(error.message);
    }
  }
  if (action.dataset.action === "logout") {
    if (noteSaveTimer) {
      clearTimeout(noteSaveTimer);
      noteSaveTimer = null;
      try {
        await api("notes", { method: "PUT", body: JSON.stringify({ notes: state.notes }) });
      } catch {
        notify("A note couldn't be saved before sign out.");
      }
    }
    noteSaveRevision += 1;
    try { await api("auth/logout", { method: "POST", body: "{}" }); } catch { /* Expired sessions are cleared locally too. */ }
    localStorage.removeItem("folio-token");
    state.token = null;
    state.user = null;
    state.books = [];
    state.loans = [];
    state.reservations = [];
    state.librarianDashboard = null;
    state.favorites = [];
    state.notes = [];
    state.activeNoteId = null;
    state.assistantMessages = [];
    state.assistantPending = false;
    state.authMode = "login";
    renderAuth();
  }
});

app.addEventListener("input", (event) => {
  const noteField = event.target.closest?.("[data-note-field]");
  if (noteField) {
    const note = currentNote();
    if (!note) return;
    if (noteField.dataset.noteField === "title") note.title = noteField.value;
    if (noteField.dataset.noteField === "content") note.content = noteField.value;
    updateNoteListPreview(note);
    scheduleNotesSave();
    return;
  }
  if (event.target.id !== "global-search") return;
  state.search = event.target.value;
  state.catalogPage = 1;
  if (state.view !== "catalog") {
    const cursor = event.target.selectionStart;
    state.view = "catalog";
    state.category = "All books";
    renderShell();
    const search = document.querySelector("#global-search");
    search.focus();
    search.setSelectionRange(cursor, cursor);
    return;
  }
  renderView();
});

function syncInventoryInput() {
  const form = document.querySelector("#book-form");
  const tracked = form.elements.inventoryTracked.checked;
  const total = form.elements.total;
  total.disabled = !tracked;
  total.required = tracked;
  total.closest("label").classList.toggle("field-disabled", !tracked);
}

document.querySelector("#book-form").elements.inventoryTracked.addEventListener("change", syncInventoryInput);
app.addEventListener("change", (event) => {
  if (event.target.id !== "catalog-sort") return;
  state.catalogSort = event.target.value;
  state.catalogPage = 1;
  renderView();
});

document.addEventListener("error", (event) => {
  if (!event.target.matches?.(".book-cover, .book-details-cover")) return;
  event.target.remove();
}, true);

bookDialog.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="close-dialog"]')) bookDialog.close();
  const lookupButton = event.target.closest('[data-action="lookup-isbn"]');
  if (lookupButton) lookupBookByIsbn(lookupButton);
  if (event.target === bookDialog) bookDialog.close();
});

async function start() {
  if (!state.token) {
    renderAuth();
    return;
  }
  try {
    await refresh();
  } catch {
    localStorage.removeItem("folio-token");
    state.token = null;
    renderAuth();
  }
}

start();