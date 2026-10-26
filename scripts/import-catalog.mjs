import { constants, copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const storePath = resolve(directory, "..", ".data", "library-management.json");
const applyChanges = process.argv.includes("--apply");

const candidates = [
  ["Fiction", "The Night Circus", "Erin Morgenstern", 2011, "9780307744432"],
  ["Fiction", "The Book Thief", "Markus Zusak", 2007, "9780375842207"],
  ["Fiction", "Project Hail Mary", "Andy Weir", 2021, "9780593135204"],
  ["Mystery", "The Thursday Murder Club", "Richard Osman", 2021, "9781984880987"],
  ["Mystery", "The Hound of the Baskervilles", "Arthur Conan Doyle", 2001, "9780451528018"],
  ["Mystery", "And Then There Were None", "Agatha Christie", 2011, "9780062073488"],
  ["Fantasy", "The Hobbit", "J. R. R. Tolkien", 2012, "9780547928227"],
  ["Fantasy", "The Name of the Wind", "Patrick Rothfuss", 2008, "9780756404741"],
  ["Fantasy", "Harry Potter and the Sorcerer's Stone", "J. K. Rowling", 1999, "9780439708180"],
  ["Romance", "The Notebook", "Nicholas Sparks", 2004, "9780446605236"],
  ["Romance", "The Love Hypothesis", "Ali Hazelwood", 2021, "9780593336823"],
  ["Romance", "Book Lovers", "Emily Henry", 2022, "9780593334836"],
  ["Science fiction", "Dune", "Frank Herbert", 2020, "9780441172719"],
  ["Science fiction", "Fahrenheit 451", "Ray Bradbury", 2012, "9781451673319"],
  ["Science fiction", "The Left Hand of Darkness", "Ursula K. Le Guin", 2003, "9780441478125"],
  ["Science fiction", "Neuromancer", "William Gibson", 1984, "9780441569595"],
  ["Biography", "Long Walk to Freedom", "Nelson Mandela", 2013, "9780316548182"],
  ["Biography", "When Breath Becomes Air", "Paul Kalanithi", 2016, "9780812988406"],
  ["Biography", "Becoming", "Michelle Obama", 2018, "9781524763138"],
  ["History", "Guns, Germs, and Steel", "Jared Diamond", 2017, "9780393354324"],
  ["History", "The Silk Roads", "Peter Frankopan", 2017, "9781101912379"],
  ["History", "Sapiens", "Yuval Noah Harari", 2015, "9780062316097"],
  ["Self-improvement", "Deep Work", "Cal Newport", 2016, "9781455586691"],
  ["Self-improvement", "The Subtle Art of Not Giving a F*ck", "Mark Manson", 2016, "9780062457714"],
  ["Self-improvement", "The 7 Habits of Highly Effective People", "Stephen R. Covey", 2004, "9780743269513"],
  ["Technology", "Code", "Charles Petzold", 2000, "9780735611313"],
  ["Technology", "The Innovators", "Walter Isaacson", 2014, "9781476708690"],
  ["Programming", "Python Crash Course, 2nd Edition", "Eric Matthes", 2019, "9781593279288"],
  ["Programming", "Eloquent JavaScript", "Marijn Haverbeke", 2018, "9781593279509"],
  ["Programming", "The Pragmatic Programmer", "Andy Hunt", 2019, "9780135957059"],
  ["Computer science", "Algorithms to Live By", "Brian Christian", 2016, "9781627790369"],
  ["Computer science", "Computer Networks", "Andrew S. Tanenbaum", 2011, "9780132126953"],
  ["Computer science", "Introduction to Algorithms", "Thomas H. Cormen", 2009, "9780262033848"],
  ["Business", "Good to Great", "Jim Collins", 2001, "9780066620992"],
  ["Business", "Hooked", "Nir Eyal", 2014, "9781591847786"],
  ["Business", "Start with Why", "Simon Sinek", 2011, "9781591846444"],
  ["Education", "How Learning Works", "Susan A. Ambrose", 2010, "9780470484104"],
  ["Education", "Pedagogy of the Oppressed", "Paulo Freire", 2000, "9780826412768"],
  ["Education", "The Flat World and Education", "Linda Darling-Hammond", 2010, "9780807749630"],
  ["Classic literature", "1984", "George Orwell", 1977, "9780451524935"],
  ["Classic literature", "Frankenstein", "Mary Shelley", 2018, "9780486282114"],
  ["Classic literature", "Pride and Prejudice", "Jane Austen", 2003, "9780141439518"],
].map(([category, title, author, year, isbn]) => ({
  id: `catalog-isbn-${isbn}`,
  title,
  author,
  category,
  year,
  isbn,
  cover: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
  inventoryTracked: false,
  total: null,
  available: null,
  sourceUrl: `https://openlibrary.org/isbn/${isbn}`,
}));

function normalizeText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeIsbn(value) {
  return String(value || "").replace(/[^\dX]/gi, "").toUpperCase();
}

function checksumValid(isbn) {
  const normalized = normalizeIsbn(isbn);
  if (!/^97[89]\d{10}$/.test(normalized)) return false;
  const sum = [...normalized.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(normalized[12]);
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex");
}

if (!existsSync(storePath)) throw new Error(`Fallback store not found: ${storePath}`);
const originalText = readFileSync(storePath, "utf8");
const store = JSON.parse(originalText);
if (!store || typeof store !== "object" || Array.isArray(store) || !Array.isArray(store.books)) {
  throw new Error("Fallback store does not contain a books array; refusing to modify it.");
}

const existingIds = new Set(store.books.map((book) => book.id));
const existingIsbns = new Set(store.books.map((book) => normalizeIsbn(book.isbn)).filter(Boolean));
const existingTitleAuthors = new Set(store.books.map((book) => `${normalizeText(book.title)}|${normalizeText(book.author)}`));
const additions = [];
const duplicates = [];

for (const candidate of candidates) {
  if (!checksumValid(candidate.isbn)) throw new Error(`Invalid ISBN-13 checksum: ${candidate.isbn}`);
  const duplicate = existingIsbns.has(candidate.isbn)
    || existingTitleAuthors.has(`${normalizeText(candidate.title)}|${normalizeText(candidate.author)}`);
  if (duplicate) {
    duplicates.push(candidate);
    continue;
  }
  if (existingIds.has(candidate.id)) throw new Error(`Catalog ID already exists for a different book: ${candidate.id}`);
  existingIds.add(candidate.id);
  existingIsbns.add(candidate.isbn);
  existingTitleAuthors.add(`${normalizeText(candidate.title)}|${normalizeText(candidate.author)}`);
  additions.push(candidate);
}

console.log(`Current books: ${store.books.length}`);
console.log(`Verified candidate books: ${candidates.length}`);
console.log(`Duplicates skipped: ${duplicates.length}`);
console.log(`Books to add: ${additions.length}`);
for (const duplicate of duplicates) console.log(`  skipped: ${duplicate.title} (${duplicate.isbn})`);

if (!applyChanges || additions.length === 0) {
  console.log(applyChanges ? "No changes needed." : "Dry run only; pass --apply to back up and add the new catalog entries.");
  process.exit(0);
}

const backupPath = `${storePath}.pre-catalog-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`;
copyFileSync(storePath, backupPath, constants.COPYFILE_EXCL);
if (fingerprint(readFileSync(backupPath)) !== fingerprint(originalText)) {
  throw new Error("Backup verification failed; the library store was not modified.");
}

const updated = { ...store, books: [...store.books, ...additions] };
const serialized = `${JSON.stringify(updated, null, 2)}\n`;
const temporaryPath = join(dirname(storePath), `.library-management-${randomUUID()}.tmp`);
writeFileSync(temporaryPath, serialized, { flag: "wx" });
JSON.parse(readFileSync(temporaryPath, "utf8"));
try {
  renameSync(temporaryPath, storePath);
} finally {
  if (existsSync(temporaryPath)) rmSync(temporaryPath);
}

console.log(`Backup created and verified: ${backupPath}`);
console.log(`Books added: ${additions.length}`);
console.log(`New total books: ${updated.books.length}`);
