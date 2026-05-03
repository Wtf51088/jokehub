require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database("jokes.db");

const uploadDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + "-" + crypto.randomBytes(8).toString("hex") + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("შეიძლება მხოლოდ jpg, png, webp ან gif."));
    }

    cb(null, true);
  }
});

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    avatar TEXT,
    token TEXT UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS jokes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    category TEXT NOT NULL,
    image TEXT,
    laughs INTEGER DEFAULT 0,
    dead INTEGER DEFAULT 0,
    hmm INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    joke_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (joke_id) REFERENCES jokes(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    joke_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (joke_id) REFERENCES jokes(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    joke_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(joke_id, user_id),
    FOREIGN KEY (joke_id) REFERENCES jokes(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`).run();

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(col => col.name);

  if (!columns.includes(column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

addColumnIfMissing("users", "role", "TEXT DEFAULT 'user'");
addColumnIfMissing("users", "avatar", "TEXT");
addColumnIfMissing("users", "token", "TEXT UNIQUE");
addColumnIfMissing("jokes", "user_id", "INTEGER");
addColumnIfMissing("jokes", "image", "TEXT");

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function checkPassword(password, hash) {
  if (!hash) return false;

  if (hash.length === 64 && /^[a-f0-9]+$/i.test(hash)) {
    return crypto.createHash("sha256").update(password).digest("hex") === hash;
  }

  return bcrypt.compareSync(password, hash);
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_-]{2,20}$/.test(username);
}

function getUserFromRequest(req) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.replace("Bearer ", "");
  return db.prepare("SELECT * FROM users WHERE token = ?").get(token);
}

function requireUser(req, res, next) {
  const user = getUserFromRequest(req);

  if (!user) {
    return res.status(401).json({ error: "ჯერ უნდა შეხვიდე ანგარიშში." });
  }

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getUserFromRequest(req);

  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "ეს გვერდი მხოლოდ admin-ისთვისაა." });
  }

  req.user = user;
  next();
}

function canManageJoke(user, joke) {
  return user.role === "admin" || joke.user_id === user.id;
}

function safeDeleteFile(filePath) {
  if (!filePath) return;

  const cleanPath = filePath.replace(/^\/+/, "");
  const fullPath = path.join(__dirname, "public", cleanPath);

  if (fullPath.startsWith(uploadDir) && fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

function getPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    avatar: user.avatar
  };
}

const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin1234";

const adminExists = db.prepare("SELECT id FROM users WHERE username = ?").get(adminUsername);
if (!adminExists) {
  db.prepare("INSERT INTO users (username, password_hash, role, token) VALUES (?, ?, ?, ?)")
    .run(adminUsername, hashPassword(adminPassword), "admin", makeToken());
}

const gitaExists = db.prepare("SELECT id FROM users WHERE username = ?").get("gita");
if (!gitaExists) {
  db.prepare("INSERT INTO users (username, password_hash, role, token) VALUES (?, ?, ?, ?)")
    .run("gita", hashPassword("1234"), "user", makeToken());
}

const jokeCount = db.prepare("SELECT COUNT(*) as total FROM jokes").get().total;
if (jokeCount === 0) {
  const gita = db.prepare("SELECT * FROM users WHERE username = ?").get("gita");
  const insert = db.prepare(`
    INSERT INTO jokes (user_id, username, text, category, laughs, dead, hmm)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(gita.id, "gita", "ჩემი Wi-Fi ისეთი სუსტია, პაროლიც კი დეპრესიაშია.", "IT", 128, 44, 12);
  insert.run(gita.id, "gita", "ლექტორმა თქვა მარტივი დავალებააო. მაშინ მივხვდი, რომ ცხოვრება რთულია.", "სტუდენტური", 91, 30, 5);
  insert.run(gita.id, "gita", "ავტობუსში ადგილი დავუთმე, მაგრამ ცხოვრებამ მაინც არ დამითმო.", "ყოველდღიური", 203, 76, 18);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  const cleanUsername = String(username || "").trim();

  if (!isValidUsername(cleanUsername)) {
    return res.status(400).json({
      error: "username უნდა იყოს 2-20 სიმბოლო და შეიცავდეს მხოლოდ a-z, A-Z, 0-9, _ ან -."
    });
  }

  if (!password || password.length < 4) {
    return res.status(400).json({ error: "პაროლი მინიმუმ 4 სიმბოლო უნდა იყოს." });
  }

  if (cleanUsername.toLowerCase() === adminUsername.toLowerCase()) {
    return res.status(400).json({ error: "admin სახელი დაკავებულია." });
  }

  const exists = db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(cleanUsername);

  if (exists) {
    return res.status(400).json({ error: "ეს სახელი უკვე დაკავებულია." });
  }

  const token = makeToken();

  const result = db.prepare("INSERT INTO users (username, password_hash, role, token) VALUES (?, ?, 'user', ?)")
    .run(cleanUsername, hashPassword(password), token);

  res.status(201).json({
    id: result.lastInsertRowid,
    username: cleanUsername,
    role: "user",
    avatar: null,
    token
  });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

  if (!user || !checkPassword(password || "", user.password_hash)) {
    return res.status(401).json({ error: "სახელი ან პაროლი არასწორია." });
  }

  const token = makeToken();

  db.prepare("UPDATE users SET token = ? WHERE id = ?").run(token, user.id);

  res.json({ ...getPublicUser(user), token });
});

app.get("/api/me", (req, res) => {
  const user = getUserFromRequest(req);

  if (!user) return res.json(null);

  res.json(getPublicUser(user));
});

app.post("/api/logout", requireUser, (req, res) => {
  db.prepare("UPDATE users SET token = NULL WHERE id = ?").run(req.user.id);
  res.json({ message: "გამოხვედი ანგარიშიდან." });
});

app.post("/api/profile/avatar", requireUser, upload.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ფოტო არ აირჩიე." });

  if (req.user.avatar) safeDeleteFile(req.user.avatar);

  const avatarPath = "/uploads/" + req.file.filename;
  db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(avatarPath, req.user.id);

  res.json({ avatar: avatarPath });
});

app.get("/api/users/:username", (req, res) => {
  const { username } = req.params;
  const user = db.prepare("SELECT id, username, role, avatar, created_at FROM users WHERE username = ?").get(username);

  if (!user) return res.status(404).json({ error: "მომხმარებელი ვერ მოიძებნა." });

  const jokes = db.prepare("SELECT * FROM jokes WHERE user_id = ? ORDER BY id DESC").all(user.id);
  const commentsCount = db.prepare("SELECT COUNT(*) as total FROM comments WHERE user_id = ?").get(user.id).total;

  res.json({ user, jokes, commentsCount });
});

app.get("/api/jokes", (req, res) => {
  const { search = "", category = "ყველა", sort = "new" } = req.query;
  const user = getUserFromRequest(req);

  let query = `
    SELECT jokes.*, users.avatar
    FROM jokes
    LEFT JOIN users ON jokes.user_id = users.id
    WHERE 1=1
  `;
  const params = {};

  if (category !== "ყველა") {
    query += " AND jokes.category = @category";
    params.category = category;
  }

  if (search.trim() !== "") {
    query += " AND (LOWER(jokes.text) LIKE @search OR LOWER(jokes.username) LIKE @search)";
    params.search = `%${search.toLowerCase()}%`;
  }

  if (sort === "top") query += " ORDER BY jokes.laughs DESC";
  else if (sort === "dead") query += " ORDER BY jokes.dead DESC";
  else query += " ORDER BY jokes.id DESC";

  const jokes = db.prepare(query).all(params).map(joke => {
    const commentCount = db.prepare("SELECT COUNT(*) as total FROM comments WHERE joke_id = ?").get(joke.id).total;
    const reportCount = db.prepare("SELECT COUNT(*) as total FROM reports WHERE joke_id = ?").get(joke.id).total;

    return {
      ...joke,
      commentsCount: commentCount,
      reportsCount: reportCount,
      canEdit: user ? canManageJoke(user, joke) : false,
      isAdminView: user ? user.role === "admin" : false
    };
  });

  res.json(jokes);
});

app.post("/api/jokes", requireUser, upload.single("image"), (req, res) => {
  const { text, category } = req.body;

  if (!text || text.trim().length < 8) {
    return res.status(400).json({ error: "ხუმრობა ძალიან მოკლეა." });
  }

  const allowedCategories = ["სტუდენტური", "IT", "ყოველდღიური", "შავი იუმორი", "აბსურდული"];

  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ error: "არასწორი კატეგორია." });
  }

  const imagePath = req.file ? "/uploads/" + req.file.filename : null;

  const result = db.prepare("INSERT INTO jokes (user_id, username, text, category, image) VALUES (?, ?, ?, ?, ?)")
    .run(req.user.id, req.user.username, text.trim(), category, imagePath);

  const joke = db.prepare("SELECT * FROM jokes WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ ...joke, canEdit: true });
});

app.put("/api/jokes/:id", requireUser, upload.single("image"), (req, res) => {
  const { id } = req.params;
  const { text, category, removeImage } = req.body;
  const joke = db.prepare("SELECT * FROM jokes WHERE id = ?").get(id);

  if (!joke) return res.status(404).json({ error: "ხუმრობა ვერ მოიძებნა." });
  if (!canManageJoke(req.user, joke)) {
    return res.status(403).json({ error: "შეგიძლია შეცვალო მხოლოდ შენი ხუმრობა. admin-ს შეუძლია ყველა." });
  }

  if (!text || text.trim().length < 8) {
    return res.status(400).json({ error: "ხუმრობა ძალიან მოკლეა." });
  }

  const allowedCategories = ["სტუდენტური", "IT", "ყოველდღიური", "შავი იუმორი", "აბსურდული"];

  if (!allowedCategories.includes(category)) {
    return res.status(400).json({ error: "არასწორი კატეგორია." });
  }

  let imagePath = joke.image;

  if (removeImage === "true") {
    safeDeleteFile(joke.image);
    imagePath = null;
  }

  if (req.file) {
    safeDeleteFile(joke.image);
    imagePath = "/uploads/" + req.file.filename;
  }

  db.prepare("UPDATE jokes SET text = ?, category = ?, image = ? WHERE id = ?")
    .run(text.trim(), category, imagePath, id);

  const updatedJoke = db.prepare("SELECT * FROM jokes WHERE id = ?").get(id);
  res.json({ ...updatedJoke, canEdit: true });
});

app.patch("/api/jokes/:id/react", requireUser, (req, res) => {
  const { id } = req.params;
  const { type } = req.body;
  const allowedTypes = ["laughs", "dead", "hmm"];

  if (!allowedTypes.includes(type)) {
    return res.status(400).json({ error: "არასწორი რეაქცია." });
  }

  const joke = db.prepare("SELECT * FROM jokes WHERE id = ?").get(id);

  if (!joke) {
    return res.status(404).json({ error: "ხუმრობა ვერ მოიძებნა." });
  }

  const oldReaction = db.prepare(`
    SELECT * FROM reactions
    WHERE joke_id = ? AND user_id = ?
  `).get(id, req.user.id);

  if (oldReaction && oldReaction.type === type) {
    return res.status(400).json({ error: "ამ reaction-ზე უკვე დაჭერილი გაქვს." });
  }

  const transaction = db.transaction(() => {
    if (oldReaction) {
      db.prepare(`UPDATE jokes SET ${oldReaction.type} = CASE WHEN ${oldReaction.type} > 0 THEN ${oldReaction.type} - 1 ELSE 0 END WHERE id = ?`).run(id);
      db.prepare("UPDATE reactions SET type = ? WHERE joke_id = ? AND user_id = ?").run(type, id, req.user.id);
    } else {
      db.prepare("INSERT INTO reactions (joke_id, user_id, type) VALUES (?, ?, ?)").run(id, req.user.id, type);
    }

    db.prepare(`UPDATE jokes SET ${type} = ${type} + 1 WHERE id = ?`).run(id);
  });

  transaction();

  const updatedJoke = db.prepare("SELECT * FROM jokes WHERE id = ?").get(id);
  res.json(updatedJoke);
});

app.delete("/api/jokes/:id", requireUser, (req, res) => {
  const { id } = req.params;
  const joke = db.prepare("SELECT * FROM jokes WHERE id = ?").get(id);

  if (!joke) return res.status(404).json({ error: "ხუმრობა ვერ მოიძებნა." });
  if (!canManageJoke(req.user, joke)) {
    return res.status(403).json({ error: "შეგიძლია წაშალო მხოლოდ შენი ხუმრობა. admin-ს შეუძლია ყველა." });
  }

  safeDeleteFile(joke.image);
  db.prepare("DELETE FROM comments WHERE joke_id = ?").run(id);
  db.prepare("DELETE FROM reports WHERE joke_id = ?").run(id);
  db.prepare("DELETE FROM reactions WHERE joke_id = ?").run(id);
  db.prepare("DELETE FROM jokes WHERE id = ?").run(id);

  res.json({ message: "ხუმრობა წაიშალა." });
});

app.get("/api/jokes/:id/comments", (req, res) => {
  const { id } = req.params;
  const comments = db.prepare(`
    SELECT comments.*, users.avatar
    FROM comments
    LEFT JOIN users ON comments.user_id = users.id
    WHERE joke_id = ?
    ORDER BY comments.id ASC
  `).all(id);

  res.json(comments);
});

app.post("/api/jokes/:id/comments", requireUser, (req, res) => {
  const { id } = req.params;
  const { text } = req.body;

  const joke = db.prepare("SELECT * FROM jokes WHERE id = ?").get(id);
  if (!joke) return res.status(404).json({ error: "ხუმრობა ვერ მოიძებნა." });

  if (!text || text.trim().length < 2) return res.status(400).json({ error: "კომენტარი ძალიან მოკლეა." });

  const result = db.prepare("INSERT INTO comments (joke_id, user_id, username, text) VALUES (?, ?, ?, ?)")
    .run(id, req.user.id, req.user.username, text.trim());

  res.status(201).json(db.prepare("SELECT * FROM comments WHERE id = ?").get(result.lastInsertRowid));
});

app.delete("/api/comments/:id", requireUser, (req, res) => {
  const { id } = req.params;
  const comment = db.prepare("SELECT * FROM comments WHERE id = ?").get(id);

  if (!comment) return res.status(404).json({ error: "კომენტარი ვერ მოიძებნა." });

  if (req.user.role !== "admin" && comment.user_id !== req.user.id) {
    return res.status(403).json({ error: "შეგიძლია წაშალო მხოლოდ შენი კომენტარი." });
  }

  db.prepare("DELETE FROM comments WHERE id = ?").run(id);
  res.json({ message: "კომენტარი წაიშალა." });
});

app.post("/api/jokes/:id/report", requireUser, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const joke = db.prepare("SELECT * FROM jokes WHERE id = ?").get(id);
  if (!joke) return res.status(404).json({ error: "ხუმრობა ვერ მოიძებნა." });

  if (!reason || reason.trim().length < 3) return res.status(400).json({ error: "მიზეზი ძალიან მოკლეა." });

  const exists = db.prepare("SELECT id FROM reports WHERE joke_id = ? AND user_id = ?").get(id, req.user.id);

  if (exists) return res.status(400).json({ error: "ეს ხუმრობა უკვე დარეპორტებული გაქვს." });

  db.prepare("INSERT INTO reports (joke_id, user_id, username, reason) VALUES (?, ?, ?, ?)")
    .run(id, req.user.id, req.user.username, reason.trim());

  res.status(201).json({ message: "Report გაიგზავნა." });
});

app.get("/api/admin/reports", requireAdmin, (req, res) => {
  const reports = db.prepare(`
    SELECT reports.*, jokes.text as joke_text, jokes.username as joke_author, jokes.image as joke_image
    FROM reports
    LEFT JOIN jokes ON reports.joke_id = jokes.id
    ORDER BY reports.id DESC
  `).all();

  res.json(reports);
});

app.delete("/api/admin/reports/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM reports WHERE id = ?").run(req.params.id);
  res.json({ message: "Report წაიშალა." });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT users.id, users.username, users.role, users.avatar, users.created_at,
      (SELECT COUNT(*) FROM jokes WHERE jokes.user_id = users.id) as jokesCount,
      (SELECT COUNT(*) FROM comments WHERE comments.user_id = users.id) as commentsCount
    FROM users
    ORDER BY users.id DESC
  `).all();

  res.json(users);
});

app.get("/api/stats", (req, res) => {
  const totalJokes = db.prepare("SELECT COUNT(*) as total FROM jokes").get().total;
  const totalLaughs = db.prepare("SELECT COALESCE(SUM(laughs), 0) as total FROM jokes").get().total;

  const topCategoryRow = db.prepare(`
    SELECT category, COUNT(*) as count
    FROM jokes
    GROUP BY category
    ORDER BY count DESC
    LIMIT 1
  `).get();

  res.json({
    totalJokes,
    totalLaughs,
    topCategory: topCategoryRow ? topCategoryRow.category : "-"
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "ფოტო ძალიან დიდია. მაქსიმუმ 2MB." });
    }

    return res.status(400).json({ error: "ფოტოს ატვირთვის შეცდომა." });
  }

  if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: "სერვერის შეცდომა." });
});

app.listen(PORT, () => {
  console.log(`JokeHub is running on http://localhost:${PORT}`);
});
