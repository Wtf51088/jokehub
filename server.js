require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

io.on("connection", socket => {
  console.log("Client connected:", socket.id);
});

function broadcast(event, data = {}) {
  io.emit(event, data);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype)) {
      return cb(new Error('შეიძლება მხოლოდ jpg, png, webp ან gif.'));
    }
    cb(null, true);
  }
});

const hashPassword = p => bcrypt.hashSync(p, 10);
const checkPassword = (p, h) => bcrypt.compareSync(p, h);
const makeToken = () => crypto.randomBytes(32).toString('hex');
const validUsername = u => /^[a-zA-Z0-9_-]{2,20}$/.test(u);
const canManageJoke = (user, joke) => user.role === 'admin' || joke.user_id === user.id;
const publicUser = u => ({ id:u.id, username:u.username, role:u.role, avatar:u.avatar });

function publicIdFromCloudinaryUrl(url) {
  if (!url || !url.includes('/upload/')) return null;
  const afterUpload = url.split('/upload/')[1];
  const parts = afterUpload.split('/');
  if (parts[0] && parts[0].startsWith('v')) parts.shift();
  return parts.join('/').replace(/\.[^/.]+$/, '');
}
async function uploadCloud(file, folder) {
  if (!file) return null;
  if (!process.env.CLOUDINARY_CLOUD_NAME) throw new Error('Cloudinary ENV variables არ არის დაყენებული.');
  return await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type:'image' }, (err, result) => {
      if (err) reject(err); else resolve(result.secure_url);
    });
    streamifier.createReadStream(file.buffer).pipe(stream);
  });
}
async function deleteCloud(url) {
  const id = publicIdFromCloudinaryUrl(url);
  if (!id) return;
  try { await cloudinary.uploader.destroy(id); } catch(e) { console.log('Cloudinary delete error:', e.message); }
}

async function initDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL არ არის დაყენებული.');
  await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT 'user', avatar TEXT, token TEXT UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS jokes (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, username TEXT NOT NULL, text TEXT NOT NULL, category TEXT NOT NULL, image TEXT, laughs INTEGER DEFAULT 0, dead INTEGER DEFAULT 0, hmm INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS comments (id SERIAL PRIMARY KEY, joke_id INTEGER REFERENCES jokes(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, username TEXT NOT NULL, text TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS reports (id SERIAL PRIMARY KEY, joke_id INTEGER REFERENCES jokes(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, username TEXT NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(joke_id,user_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS reactions (id SERIAL PRIMARY KEY, joke_id INTEGER REFERENCES jokes(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(joke_id,user_id))`);

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';
  const admin = await pool.query('SELECT id FROM users WHERE username=$1', [adminUsername]);
  if (!admin.rowCount) await pool.query('INSERT INTO users (username,password_hash,role,token) VALUES ($1,$2,$3,$4)', [adminUsername, hashPassword(adminPassword), 'admin', makeToken()]);
  const gita = await pool.query('SELECT id FROM users WHERE username=$1', ['gita']);
  if (!gita.rowCount) await pool.query('INSERT INTO users (username,password_hash,role,token) VALUES ($1,$2,$3,$4)', ['gita', hashPassword('1234'), 'user', makeToken()]);
  const c = await pool.query('SELECT COUNT(*) FROM jokes');
  if (+c.rows[0].count === 0) {
    const u = await pool.query('SELECT id FROM users WHERE username=$1', ['gita']);
    const uid = u.rows[0].id;
    await pool.query('INSERT INTO jokes (user_id,username,text,category,laughs,dead,hmm) VALUES ($1,$2,$3,$4,$5,$6,$7)', [uid,'gita','ჩემი Wi-Fi ისეთი სუსტია, პაროლიც კი დეპრესიაშია.','IT',128,44,12]);
    await pool.query('INSERT INTO jokes (user_id,username,text,category,laughs,dead,hmm) VALUES ($1,$2,$3,$4,$5,$6,$7)', [uid,'gita','ლექტორმა თქვა მარტივი დავალებააო. მაშინ მივხვდი, რომ ცხოვრება რთულია.','სტუდენტური',91,30,5]);
    await pool.query('INSERT INTO jokes (user_id,username,text,category,laughs,dead,hmm) VALUES ($1,$2,$3,$4,$5,$6,$7)', [uid,'gita','ავტობუსში ადგილი დავუთმე, მაგრამ ცხოვრებამ მაინც არ დამითმო.','ყოველდღიური',203,76,18]);
  }
}

async function getUser(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.replace('Bearer ', '');
  const r = await pool.query('SELECT * FROM users WHERE token=$1', [token]);
  return r.rows[0] || null;
}
async function requireUser(req,res,next) { const u = await getUser(req); if(!u) return res.status(401).json({error:'ჯერ უნდა შეხვიდე ანგარიშში.'}); req.user=u; next(); }
async function requireAdmin(req,res,next) { const u = await getUser(req); if(!u || u.role !== 'admin') return res.status(403).json({error:'ეს გვერდი მხოლოდ admin-ისთვისაა.'}); req.user=u; next(); }

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

app.post('/api/register', async (req,res,next)=>{ try{
  const username = String(req.body.username || '').trim(); const password = req.body.password || '';
  if(!validUsername(username)) return res.status(400).json({error:'username უნდა იყოს 2-20 სიმბოლო და შეიცავდეს მხოლოდ a-z, A-Z, 0-9, _ ან -.'});
  if(password.length < 4) return res.status(400).json({error:'პაროლი მინიმუმ 4 სიმბოლო უნდა იყოს.'});
  if(username.toLowerCase() === (process.env.ADMIN_USERNAME || 'admin').toLowerCase()) return res.status(400).json({error:'admin სახელი დაკავებულია.'});
  const exists = await pool.query('SELECT id FROM users WHERE LOWER(username)=LOWER($1)', [username]);
  if(exists.rowCount) return res.status(400).json({error:'ეს სახელი უკვე დაკავებულია.'});
  const token = makeToken();
  const r = await pool.query('INSERT INTO users (username,password_hash,role,token) VALUES ($1,$2,$3,$4) RETURNING id,username,role,avatar', [username,hashPassword(password),'user',token]);
  res.status(201).json({...r.rows[0], token});
} catch(e){next(e)} });

app.post('/api/login', async (req,res,next)=>{ try{
  const r = await pool.query('SELECT * FROM users WHERE username=$1', [req.body.username]); const u = r.rows[0];
  if(!u || !checkPassword(req.body.password || '', u.password_hash)) return res.status(401).json({error:'სახელი ან პაროლი არასწორია.'});
  const token = makeToken(); await pool.query('UPDATE users SET token=$1 WHERE id=$2', [token,u.id]);
  res.json({...publicUser(u), token});
} catch(e){next(e)} });

app.get('/api/me', async (req,res,next)=>{ try{ const u=await getUser(req); res.json(u?publicUser(u):null); } catch(e){next(e)} });
app.post('/api/logout', requireUser, async (req,res,next)=>{ try{ await pool.query('UPDATE users SET token=NULL WHERE id=$1',[req.user.id]); res.json({message:'გამოხვედი ანგარიშიდან.'}); } catch(e){next(e)} });
app.post('/api/profile/avatar', requireUser, upload.single('avatar'), async (req,res,next)=>{ try{ if(!req.file) return res.status(400).json({error:'ფოტო არ აირჩიე.'}); if(req.user.avatar) await deleteCloud(req.user.avatar); const avatar = await uploadCloud(req.file,'jokehub/avatars'); await pool.query('UPDATE users SET avatar=$1 WHERE id=$2',[avatar,req.user.id]); broadcast('profile:updated', { userId: req.user.id, username: req.user.username }); res.json({avatar}); } catch(e){next(e)} });

app.get('/api/users/:username', async (req,res,next)=>{ try{
  const u = await pool.query('SELECT id,username,role,avatar,created_at FROM users WHERE username=$1',[req.params.username]);
  if(!u.rowCount) return res.status(404).json({error:'მომხმარებელი ვერ მოიძებნა.'});
  const jokes = await pool.query('SELECT * FROM jokes WHERE user_id=$1 ORDER BY id DESC',[u.rows[0].id]);
  const cc = await pool.query('SELECT COUNT(*) FROM comments WHERE user_id=$1',[u.rows[0].id]);
  res.json({user:u.rows[0], jokes:jokes.rows, commentsCount:+cc.rows[0].count});
} catch(e){next(e)} });

app.get('/api/jokes', async (req,res,next)=>{ try{
  const {search='', category='ყველა', sort='new'} = req.query; const user = await getUser(req);
  const vals=[]; let i=1; let q=`SELECT jokes.*, users.avatar, (SELECT COUNT(*)::int FROM comments WHERE comments.joke_id=jokes.id) AS "commentsCount", (SELECT COUNT(*)::int FROM reports WHERE reports.joke_id=jokes.id) AS "reportsCount" FROM jokes LEFT JOIN users ON jokes.user_id=users.id WHERE 1=1`;
  if(category !== 'ყველა'){ q += ` AND jokes.category=$${i++}`; vals.push(category); }
  if(search.trim()){ q += ` AND (LOWER(jokes.text) LIKE $${i} OR LOWER(jokes.username) LIKE $${i})`; vals.push(`%${search.toLowerCase()}%`); i++; }
  if(sort==='top') q += ' ORDER BY jokes.laughs DESC'; else if(sort==='dead') q += ' ORDER BY jokes.dead DESC'; else q += ' ORDER BY jokes.id DESC';
  const r = await pool.query(q, vals);
  res.json(r.rows.map(j => ({...j, canEdit: user ? canManageJoke(user,j) : false, isAdminView: user ? user.role==='admin' : false})));
} catch(e){next(e)} });

app.post('/api/jokes', requireUser, upload.single('image'), async (req,res,next)=>{ try{
  const {text, category} = req.body; if(!text || text.trim().length < 8) return res.status(400).json({error:'ხუმრობა ძალიან მოკლეა.'});
  const allowed=['სტუდენტური','IT','ყოველდღიური','შავი იუმორი','აბსურდული']; if(!allowed.includes(category)) return res.status(400).json({error:'არასწორი კატეგორია.'});
  const image = req.file ? await uploadCloud(req.file,'jokehub/jokes') : null;
  const r = await pool.query('INSERT INTO jokes (user_id,username,text,category,image) VALUES ($1,$2,$3,$4,$5) RETURNING *',[req.user.id,req.user.username,text.trim(),category,image]);
  broadcast('joke:created', r.rows[0]);
  res.status(201).json({...r.rows[0], canEdit:true});
} catch(e){next(e)} });

app.put('/api/jokes/:id', requireUser, upload.single('image'), async (req,res,next)=>{ try{
  const jr = await pool.query('SELECT * FROM jokes WHERE id=$1',[req.params.id]); const joke = jr.rows[0];
  if(!joke) return res.status(404).json({error:'ხუმრობა ვერ მოიძებნა.'}); if(!canManageJoke(req.user,joke)) return res.status(403).json({error:'შეგიძლია შეცვალო მხოლოდ შენი ხუმრობა. admin-ს შეუძლია ყველა.'});
  const {text, category, removeImage} = req.body; if(!text || text.trim().length < 8) return res.status(400).json({error:'ხუმრობა ძალიან მოკლეა.'});
  const allowed=['სტუდენტური','IT','ყოველდღიური','შავი იუმორი','აბსურდული']; if(!allowed.includes(category)) return res.status(400).json({error:'არასწორი კატეგორია.'});
  let image = joke.image; if(removeImage === 'true'){ await deleteCloud(joke.image); image=null; } if(req.file){ await deleteCloud(joke.image); image = await uploadCloud(req.file,'jokehub/jokes'); }
  const r = await pool.query('UPDATE jokes SET text=$1, category=$2, image=$3 WHERE id=$4 RETURNING *',[text.trim(),category,image,req.params.id]);
  broadcast('joke:updated', r.rows[0]);
  res.json({...r.rows[0], canEdit:true});
} catch(e){next(e)} });

app.patch('/api/jokes/:id/react', requireUser, async (req,res,next)=>{ const client = await pool.connect(); try{
  const {type} = req.body; const id = req.params.id; if(!['laughs','dead','hmm'].includes(type)) return res.status(400).json({error:'არასწორი რეაქცია.'});
  const joke = await client.query('SELECT * FROM jokes WHERE id=$1',[id]); if(!joke.rowCount) return res.status(404).json({error:'ხუმრობა ვერ მოიძებნა.'});
  await client.query('BEGIN'); const old = await client.query('SELECT * FROM reactions WHERE joke_id=$1 AND user_id=$2 FOR UPDATE',[id,req.user.id]);
  if(old.rowCount && old.rows[0].type === type){ await client.query('ROLLBACK'); return res.status(400).json({error:'ამ reaction-ზე უკვე დაჭერილი გაქვს.'}); }
  if(old.rowCount){ const oldType = old.rows[0].type; await client.query(`UPDATE jokes SET ${oldType}=GREATEST(${oldType}-1,0) WHERE id=$1`,[id]); await client.query('UPDATE reactions SET type=$1 WHERE joke_id=$2 AND user_id=$3',[type,id,req.user.id]); }
  else await client.query('INSERT INTO reactions (joke_id,user_id,type) VALUES ($1,$2,$3)',[id,req.user.id,type]);
  await client.query(`UPDATE jokes SET ${type}=${type}+1 WHERE id=$1`,[id]); await client.query('COMMIT'); const updated = await pool.query('SELECT * FROM jokes WHERE id=$1',[id]); broadcast("joke:reacted", updated.rows[0]);
    res.json(updated.rows[0]);
} catch(e){ await client.query('ROLLBACK').catch(()=>{}); next(e); } finally { client.release(); } });

app.delete('/api/jokes/:id', requireUser, async (req,res,next)=>{ try{ const r=await pool.query('SELECT * FROM jokes WHERE id=$1',[req.params.id]); const joke=r.rows[0]; if(!joke) return res.status(404).json({error:'ხუმრობა ვერ მოიძებნა.'}); if(!canManageJoke(req.user,joke)) return res.status(403).json({error:'შეგიძლია წაშალო მხოლოდ შენი ხუმრობა. admin-ს შეუძლია ყველა.'}); await deleteCloud(joke.image); await pool.query('DELETE FROM jokes WHERE id=$1',[req.params.id]); broadcast('joke:deleted', { id: Number(req.params.id) }); res.json({message:'ხუმრობა წაიშალა.'}); } catch(e){next(e)} });

app.get('/api/jokes/:id/comments', async (req,res,next)=>{ try{ const r=await pool.query('SELECT comments.*, users.avatar FROM comments LEFT JOIN users ON comments.user_id=users.id WHERE joke_id=$1 ORDER BY comments.id ASC',[req.params.id]); res.json(r.rows); } catch(e){next(e)} });
app.post('/api/jokes/:id/comments', requireUser, async (req,res,next)=>{ try{ const {text}=req.body; if(!text || text.trim().length<2) return res.status(400).json({error:'კომენტარი ძალიან მოკლეა.'}); const joke=await pool.query('SELECT id FROM jokes WHERE id=$1',[req.params.id]); if(!joke.rowCount) return res.status(404).json({error:'ხუმრობა ვერ მოიძებნა.'}); const r=await pool.query('INSERT INTO comments (joke_id,user_id,username,text) VALUES ($1,$2,$3,$4) RETURNING *',[req.params.id,req.user.id,req.user.username,text.trim()]); broadcast('comment:created', { jokeId: Number(req.params.id), comment: r.rows[0] }); res.status(201).json(r.rows[0]); } catch(e){next(e)} });
app.delete('/api/comments/:id', requireUser, async (req,res,next)=>{ try{ const r=await pool.query('SELECT * FROM comments WHERE id=$1',[req.params.id]); const c=r.rows[0]; if(!c) return res.status(404).json({error:'კომენტარი ვერ მოიძებნა.'}); if(req.user.role !== 'admin' && c.user_id !== req.user.id) return res.status(403).json({error:'შეგიძლია წაშალო მხოლოდ შენი კომენტარი.'}); await pool.query('DELETE FROM comments WHERE id=$1',[req.params.id]); broadcast('comment:deleted', { id: Number(req.params.id), jokeId: c.joke_id }); res.json({message:'კომენტარი წაიშალა.'}); } catch(e){next(e)} });

app.post('/api/jokes/:id/report', requireUser, async (req,res,next)=>{ try{ const {reason}=req.body; if(!reason || reason.trim().length<3) return res.status(400).json({error:'მიზეზი ძალიან მოკლეა.'}); const joke=await pool.query('SELECT id FROM jokes WHERE id=$1',[req.params.id]); if(!joke.rowCount) return res.status(404).json({error:'ხუმრობა ვერ მოიძებნა.'}); try{ await pool.query('INSERT INTO reports (joke_id,user_id,username,reason) VALUES ($1,$2,$3,$4)',[req.params.id,req.user.id,req.user.username,reason.trim()]); } catch(e){ if(e.code==='23505') return res.status(400).json({error:'ეს ხუმრობა უკვე დარეპორტებული გაქვს.'}); throw e; } broadcast('report:created', { jokeId: Number(req.params.id) }); res.status(201).json({message:'Report გაიგზავნა.'}); } catch(e){next(e)} });
app.get('/api/admin/reports', requireAdmin, async (req,res,next)=>{ try{ const r=await pool.query('SELECT reports.*, jokes.text AS joke_text, jokes.username AS joke_author, jokes.image AS joke_image FROM reports LEFT JOIN jokes ON reports.joke_id=jokes.id ORDER BY reports.id DESC'); res.json(r.rows); } catch(e){next(e)} });
app.delete('/api/admin/reports/:id', requireAdmin, async (req,res,next)=>{ try{ await pool.query('DELETE FROM reports WHERE id=$1',[req.params.id]); broadcast('report:deleted', { id: Number(req.params.id) }); res.json({message:'Report წაიშალა.'}); } catch(e){next(e)} });
app.get('/api/admin/users', requireAdmin, async (req,res,next)=>{ try{ const r=await pool.query('SELECT users.id,users.username,users.role,users.avatar,users.created_at,(SELECT COUNT(*)::int FROM jokes WHERE jokes.user_id=users.id) AS "jokesCount",(SELECT COUNT(*)::int FROM comments WHERE comments.user_id=users.id) AS "commentsCount" FROM users ORDER BY users.id DESC'); res.json(r.rows); } catch(e){next(e)} });
app.get('/api/stats', async (req,res,next)=>{ try{ const tj=await pool.query('SELECT COUNT(*) FROM jokes'); const tl=await pool.query('SELECT COALESCE(SUM(laughs),0) AS total FROM jokes'); const tc=await pool.query('SELECT category, COUNT(*) FROM jokes GROUP BY category ORDER BY COUNT(*) DESC LIMIT 1'); res.json({totalJokes:+tj.rows[0].count,totalLaughs:+tl.rows[0].total,topCategory:tc.rows[0]?tc.rows[0].category:'-'}); } catch(e){next(e)} });

app.get('*', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err, req, res, next)=>{ console.error(err); if(err instanceof multer.MulterError && err.code==='LIMIT_FILE_SIZE') return res.status(400).json({error:'ფოტო ძალიან დიდია. მაქსიმუმ 10MB.'}); res.status(400).json({error: err.message || 'სერვერის შეცდომა.'}); });

initDb().then(()=>server.listen(PORT,()=>console.log(`JokeHub running on port ${PORT}`))).catch(e=>{ console.error('Database initialization failed:', e); process.exit(1); });
