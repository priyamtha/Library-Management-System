const app = document.querySelector("#app");
const bookDialog = document.querySelector("#book-dialog");
const toast = document.querySelector("#toast");

const state = {
  token: localStorage.getItem("folio-token"),
  user: null,
  books: [],
  loans: [],
  view: "overview",
  category: "All books",
  search: "",
  authMode: "login",
  loanFilter: "active",
};

const icons = { overview: "⌂", catalog: "▤", loans: "↗", collection: "+" };
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const safeCover = (value) => typeof value === "string" && /^https:\/\//i.test(value) ? value : "";
const initials = (name = "Reader") => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const dateLabel = (date) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(date));

async function api(path, options = {}) {
  const headers = { "content-type": "application/json", ...(state.token ? { authorization: `Bearer ${state.token}` } : {}), ...options.headers };
  const response = await fetch(`/api/${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
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
      <section class="auth-art" aria-label="Folio library">
        <div class="brand"><span class="brand-mark">f.</span><span>folio</span></div>
        <div class="auth-story">
          <p class="eyebrow">A LITTLE MORE ROOM TO READ</p>
          <h1 class="serif">Every good story starts somewhere.</h1>
          <p>Your shelves, lending, and next great read, all in one considered place.</p>
        </div>
        <div class="auth-footer"><div class="avatar-stack" aria-hidden="true"><span>AM</span><span>JR</span><span>SK</span></div><span>Made for the people who keep the pages turning.</span></div>
      </section>
      <section class="auth-panel">
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
            <button class="button button-primary auth-submit" type="submit">${register ? "Create my account" : "Sign in to Folio"}<span aria-hidden="true">↗</span></button>
          </form>
          <p class="auth-legal">Your library data stays yours. Passwords are securely hashed before storage.</p>
        </div>
      </section>
    </main>`;
}

function navItem(view, label, count = "") {
  return `<button class="nav-item ${state.view === view ? "active" : ""}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ""}><span class="nav-icon" aria-hidden="true">${icons[view]}</span><span>${label}</span>${count ? `<span class="nav-count">${count}</span>` : ""}</button>`;
}

function renderShell() {
  const activeLoans = state.loans.filter((loan) => !loan.returnedAt).length;
  const viewLabel = { overview: "Overview", catalog: "Browse the catalog", loans: "My loans" }[state.view];
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">f.</span><span>folio</span></div>
        <p class="sidebar-label">YOUR LIBRARY</p>
        <nav class="nav-list" aria-label="Main navigation">
          ${navItem("overview", "Overview")}${navItem("catalog", "Browse books")}${navItem("loans", "My loans", activeLoans || "")}
        </nav>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-note"><strong>A note for today</strong><p>“A room without books is like a body without a soul.”<br />— Cicero</p></div>
        <div class="user-profile"><span class="profile-avatar">${escapeHtml(initials(state.user?.name))}</span><div class="profile-copy"><strong>${escapeHtml(state.user?.name)}</strong><span>${escapeHtml(state.user?.email)}</span></div><button class="icon-button" type="button" data-action="logout" aria-label="Sign out" title="Sign out">↪</button></div>
      </aside>
      <div class="main-column">
        <header class="topbar"><div class="breadcrumb">Library <span aria-hidden="true">/</span> <strong>${viewLabel}</strong></div><div class="topbar-right"><label class="search-box"><span aria-hidden="true">⌕</span><input id="global-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search books or authors" aria-label="Search books or authors" /></label><span class="today-label">${new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span></div></header>
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

function bookCard(book) {
  const cover = safeCover(book.cover);
  const available = Number(book.available) > 0;
  return `<article class="book-card">
    <div class="book-cover-wrap"><div class="cover-fallback" aria-hidden="true"><span>${escapeHtml(book.title)}</span></div>${cover ? `<img class="book-cover" src="${escapeHtml(cover)}" alt="Cover of ${escapeHtml(book.title)}" loading="lazy" />` : ""}</div>
    <div class="book-meta"><span class="book-category">${escapeHtml(book.category || "Other")}</span><h3 class="book-title">${escapeHtml(book.title)}</h3><p class="book-author">${escapeHtml(book.author)} · ${escapeHtml(book.year || "")}</p>
      <div class="book-footer"><span class="availability ${available ? "" : "out"}">${available ? `${book.available} available` : "All on loan"}</span><a class="book-action" href="${escapeHtml(googleBooksUrl(book))}" target="_blank" rel="noopener noreferrer" aria-label="Find ${escapeHtml(book.title)} on Google Books">Read</a></div>
      <button class="book-remove" type="button" data-action="remove-book" data-id="${escapeHtml(book.id)}">Remove from collection</button>
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

function filteredBooks() {
  const query = state.search.trim().toLowerCase();
  return state.books.filter((book) => {
    const matchesCategory = state.category === "All books" || book.category === state.category;
    const matchesSearch = !query || `${book.title} ${book.author} ${book.category} ${book.isbn}`.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });
}

function renderOverview() {
  const availableCount = state.books.reduce((total, book) => total + Number(book.available || 0), 0);
  const borrowedCount = state.loans.filter((loan) => !loan.returnedAt).length;
  const featured = state.books[0];
  const recentLoans = state.loans.filter((loan) => !loan.returnedAt).slice(0, 2);
  const categories = new Set(state.books.map((book) => book.category).filter(Boolean)).size;
  return `<div class="page-heading"><div><p class="eyebrow">${new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</p><h1 class="serif">Good to see you, ${escapeHtml(state.user?.name?.split(" ")[0])}.</h1><p>Your little corner of the reading world is looking good.</p></div><button class="button button-secondary" type="button" data-action="add-book">＋ Add a book</button></div>
    <section class="welcome-banner"><div class="welcome-copy"><p class="eyebrow">A COLLECTION WITH CHARACTER</p><h2 class="serif">A good book has a way of finding its person.</h2><p>Keep your shelves in order, share stories, and make space for what's next.</p><button class="button" type="button" data-view="catalog">Find your next read <span aria-hidden="true">↗</span></button></div><div class="welcome-cover">${featured && safeCover(featured.cover) ? `<img src="${escapeHtml(safeCover(featured.cover))}" alt="Cover of ${escapeHtml(featured.title)}" />` : `<span class="cover-fallback"><span>${escapeHtml(featured?.title || "A good book")}</span></span>`}</div></section>
    <section class="stats-row" aria-label="Library statistics"><div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">▤</span>Titles in your library</div><strong>${state.books.length}</strong></div><div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">✳</span>Copies ready to read</div><strong>${availableCount}</strong></div><div class="stat"><div class="stat-top"><span class="stat-icon" aria-hidden="true">↗</span>Currently borrowed</div><strong>${borrowedCount}<small style="font-size:12px;color:var(--muted);font-weight:400"> / 3</small></strong></div></section>
    <div class="section-heading"><div><h2 class="serif">A few from the shelves</h2><p>${categories} lovely corners of the collection</p></div><button class="text-button" type="button" data-view="catalog">Explore all books <span aria-hidden="true">↗</span></button></div>
    ${state.books.length ? `<div class="book-grid">${state.books.slice(0, 4).map(bookCard).join("")}</div>` : `<div class="empty-state"><strong>Your shelves are waiting.</strong><p>Add your first book to start your collection.</p><button class="button button-primary" data-action="add-book" type="button">＋ Add a book</button></div>`}
    <section class="shelf-section"><div class="section-heading"><div><h2 class="serif">Out in the world</h2><p>${borrowedCount ? "Your currently borrowed books" : "Books you borrow will find a home here"}</p></div><button class="text-button" type="button" data-view="loans">View all loans <span aria-hidden="true">↗</span></button></div>${recentLoans.length ? `<div class="loan-list">${recentLoans.map(loanRow).join("")}</div>` : ""}</section>`;
}

function renderCatalog() {
  const categories = ["All books", ...new Set(state.books.map((book) => book.category).filter(Boolean).sort())];
  const books = filteredBooks();
  return `<div class="page-heading"><div><p class="eyebrow">MAKE YOURSELF AT HOME</p><h1 class="serif">The collection</h1><p>Every title has its own little story. Find one that speaks to you.</p></div><button class="button button-primary" type="button" data-action="add-book">＋ Add a book</button></div>
    <div class="category-filter" role="group" aria-label="Filter by category">${categories.map((category) => `<button type="button" class="filter-chip ${category === state.category ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}</div>
    <div class="catalog-tools"><span class="result-count">Showing ${books.length} of ${state.books.length} ${state.books.length === 1 ? "book" : "books"}</span></div>
    ${books.length ? `<div class="book-grid">${books.map(bookCard).join("")}</div>` : `<div class="empty-state"><strong>No books found just yet.</strong><p>Try another title, author, or category.</p>${state.books.length ? "" : `<button class="button button-primary" data-action="add-book" type="button">＋ Add a book</button>`}</div>`}`;
}

function renderLoans() {
  const loans = state.loans.filter((loan) => state.loanFilter === "all" || (state.loanFilter === "active" ? !loan.returnedAt : Boolean(loan.returnedAt)));
  const active = state.loans.filter((loan) => !loan.returnedAt).length;
  return `<div class="page-heading"><div><p class="eyebrow">ON LOAN, BACK SOON</p><h1 class="serif">Your reading list</h1><p>Keep an eye on what's due and return a book when you're ready.</p></div><button class="button button-primary" type="button" data-view="catalog">Find a book <span aria-hidden="true">↗</span></button></div>
    <div class="category-filter" role="group" aria-label="Filter loans"><button class="filter-chip ${state.loanFilter === "active" ? "active" : ""}" data-loan-filter="active">Active${active ? ` · ${active}` : ""}</button><button class="filter-chip ${state.loanFilter === "returned" ? "active" : ""}" data-loan-filter="returned">Returned</button><button class="filter-chip ${state.loanFilter === "all" ? "active" : ""}" data-loan-filter="all">All history</button></div>
    ${loans.length ? `<div class="loan-list">${loans.map(loanRow).join("")}</div>` : `<div class="empty-state"><strong>${state.loanFilter === "returned" ? "No returned books yet." : "Nothing checked out right now."}</strong><p>Your next favorite could be one shelf away.</p><button class="button button-primary" type="button" data-view="catalog">Browse the collection <span aria-hidden="true">↗</span></button></div>`}`;
}

function renderView() {
  const main = document.querySelector("#main-content");
  if (!main) return;
  main.innerHTML = state.view === "catalog" ? renderCatalog() : state.view === "loans" ? renderLoans() : renderOverview();
}

async function refresh() {
  const result = await api("bootstrap");
  state.user = result.user;
  state.books = result.books;
  state.loans = result.loans;
  renderShell();
}

app.addEventListener("submit", async (event) => {
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
  if (event.target.id === "book-form") {
    event.preventDefault();
    const form = event.target;
    const errorBox = form.querySelector("#book-form-error");
    const submitButton = form.querySelector("button[type=submit]");
    const book = Object.fromEntries(new FormData(form).entries());
    submitButton.disabled = true;
    errorBox.textContent = "";
    try {
      await api("books", { method: "POST", body: JSON.stringify(book) });
      bookDialog.close();
      form.reset();
      form.elements.total.value = 1;
      await refresh();
      state.view = "catalog";
      renderShell();
      notify("Added to your collection.");
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  }
});

app.addEventListener("click", async (event) => {
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
  const categoryButton = event.target.closest("[data-category]");
  if (categoryButton) {
    state.category = categoryButton.dataset.category;
    renderView();
    return;
  }
  const loanFilterButton = event.target.closest("[data-loan-filter]");
  if (loanFilterButton) {
    state.loanFilter = loanFilterButton.dataset.loanFilter;
    renderView();
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "add-book") {
    document.querySelector("#book-form-error").textContent = "";
    bookDialog.showModal();
  }
  if (action.dataset.action === "close-dialog") bookDialog.close();
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
    try { await api("auth/logout", { method: "POST", body: "{}" }); } catch { /* Expired sessions are cleared locally too. */ }
    localStorage.removeItem("folio-token");
    state.token = null;
    state.user = null;
    state.books = [];
    state.loans = [];
    state.authMode = "login";
    renderAuth();
  }
});

app.addEventListener("input", (event) => {
  if (event.target.id !== "global-search") return;
  state.search = event.target.value;
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

document.addEventListener("error", (event) => {
  if (!event.target.matches?.(".book-cover")) return;
  event.target.remove();
}, true);

bookDialog.addEventListener("click", (event) => {
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