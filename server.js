'use strict';

/* =========================================================
   Chat de Voz — servidor de contas
   Sem dependências: só precisa do Node 18 ou mais novo.
     node server.js   →   http://localhost:3000

   Faz: cadastro, login (senha com scrypt + sessão em cookie),
   lista de amigos, presença (quem está online / em qual sala)
   e guarda os servidores de cada usuário.
   A voz continua sendo P2P (PeerJS) e não passa por aqui.
   ========================================================= */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';   // use 1 atrás de Render/Railway/Nginx etc.

const SESSION_MS = 30 * 24 * 3600 * 1000;
const ONLINE_MS = 90 * 1000;          // sem sinal por 90 s = offline
const MAX_BODY = 64 * 1024;

/* ---------------- Banco de dados (arquivo JSON) ---------------- */

let db = { users: {}, sessions: {}, friendships: [] };
const byName = new Map();             // username -> id

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('Não consegui ler ' + DB_FILE + ': ' + e.message + '\nConfira o arquivo antes de continuar (nada foi apagado).');
      process.exit(1);
    }
  }
  const now = Date.now();
  for (const k of Object.keys(db.sessions)) if (db.sessions[k].exp < now) delete db.sessions[k];
  for (const u of Object.values(db.users)) byName.set(u.username, u.id);
}

// Grava em arquivo temporário e renomeia: nunca deixa o banco pela metade
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

/* ---------------- Senhas e sessões ---------------- */

const scrypt = (pw, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key)));
});

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return 'scrypt$' + salt.toString('base64') + '$' + key.toString('base64');
}

async function verifyPassword(pw, stored) {
  const [, s, h] = String(stored).split('$');
  const key = await scrypt(pw, Buffer.from(s || '', 'base64'));
  const want = Buffer.from(h || '', 'base64');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

// Usado quando o usuário não existe, para o tempo de resposta não revelar quais usuários existem
const DUMMY_HASH = hashPassword('senha-falsa-para-igualar-o-tempo');

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function newSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions[sha(token)] = { userId, exp: Date.now() + SESSION_MS };
  saveDb();
  return token;
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function sessionToken(req) { return parseCookies(req.headers.cookie).sid || ''; }

function currentUser(req) {
  const token = sessionToken(req);
  if (!token) return null;
  const s = db.sessions[sha(token)];
  if (!s || s.exp < Date.now()) return null;
  return db.users[s.userId] || null;
}

function isHttps(req) {
  return !!req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function cookie(req, token, maxAgeSec) {
  return 'sid=' + token + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + maxAgeSec + (isHttps(req) ? '; Secure' : '');
}

/* ---------------- Limite de tentativas (em memória) ---------------- */

const hits = new Map();
function tooMany(key, max, windowMs, count = true) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  if (count) h.n++;
  return h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k); }, 600000).unref();

function clientIp(req) {
  if (TRUST_PROXY) return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  return req.socket.remoteAddress;
}

/* ---------------- Presença (quem está online e em qual sala) ---------------- */

const presence = new Map();   // userId -> { t, room }

function presenceOf(id) {
  const p = presence.get(id);
  if (!p || Date.now() - p.t > ONLINE_MS) return { online: false, room: null };
  const room = p.room ? { code: p.room.code, title: p.room.title, count: roomCount(p.room.code) } : null;
  return { online: true, room };
}

function roomCount(code) {
  let n = 0;
  const now = Date.now();
  for (const p of presence.values()) if (p.room && p.room.code === code && now - p.t <= ONLINE_MS) n++;
  return n;
}

/* ---------------- Validação ---------------- */

const USER_RE = /^[a-z0-9_.]{3,20}$/;
const cleanText = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.displayName });

// Os servidores do usuário são "dados do cliente": confere o formato antes de guardar
function sanitizeServers(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, s] of Object.entries(input).slice(0, 50)) {
    if (!/^[A-Z0-9]{4}$/.test(key) || !s || !Array.isArray(s.ch)) continue;
    const ch = s.ch.slice(0, 12)
      .filter((c) => c && /^[A-Z0-9]{2}$/.test(String(c.id)))
      .map((c) => ({ id: String(c.id), name: cleanText(c.name, 24) || 'Sala' }));
    if (!ch.length) continue;
    out[key] = { id: key, name: cleanText(s.name, 30) || 'Servidor', emoji: cleanText(s.emoji, 4) || '🎧', v: Math.max(1, Math.min(1e6, +s.v || 1)), mine: !!s.mine, ch };
  }
  return out;
}

/* ---------------- Rotas da API ---------------- */

const relation = (a, b) => db.friendships.find((f) => (f.from === a && f.to === b) || (f.from === b && f.to === a));

async function register(req, body, ip) {
  if (tooMany('reg:' + ip, 10, 3600000)) throw new HttpError(429, 'Muitas contas criadas deste endereço. Tente de novo mais tarde.');
  const username = cleanText(body.username, 40).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!USER_RE.test(username)) throw new HttpError(400, 'Usuário: de 3 a 20 caracteres, só letras minúsculas, números, _ e ponto.');
  if (password.length < 8 || password.length > 128) throw new HttpError(400, 'A senha precisa ter de 8 a 128 caracteres.');
  if (byName.has(username)) throw new HttpError(409, 'Esse nome de usuário já está em uso.');
  const displayName = cleanText(body.displayName, 20) || username;

  const pass = await hashPassword(password);
  if (byName.has(username)) throw new HttpError(409, 'Esse nome de usuário já está em uso.');   // outra pessoa pode ter criado enquanto a senha era processada
  const user = { id: crypto.randomBytes(8).toString('hex'), username, displayName, pass, createdAt: Date.now(), servers: {} };
  db.users[user.id] = user;
  byName.set(username, user.id);
  const token = newSession(user.id);   // também grava o banco
  return { status: 201, body: { user: publicUser(user) }, cookie: cookie(req, token, SESSION_MS / 1000) };
}

async function login(req, body, ip) {
  const username = cleanText(body.username, 40).toLowerCase();
  const password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
  const key = 'login:' + ip + '|' + username;
  if (tooMany(key, 10, 600000, false)) throw new HttpError(429, 'Muitas tentativas. Espere alguns minutos e tente de novo.');
  const user = byName.has(username) ? db.users[byName.get(username)] : null;
  const ok = user ? await verifyPassword(password, user.pass) : (await verifyPassword(password, await DUMMY_HASH), false);
  if (!ok) {
    tooMany(key, 10, 600000);   // conta só as falhas
    throw new HttpError(401, 'Usuário ou senha incorretos.');
  }
  hits.delete(key);
  const token = newSession(user.id);
  return { body: { user: publicUser(user) }, cookie: cookie(req, token, SESSION_MS / 1000) };
}

function listFriends(user) {
  const friends = [], incoming = [], outgoing = [];
  for (const f of db.friendships) {
    if (f.from !== user.id && f.to !== user.id) continue;
    const other = db.users[f.from === user.id ? f.to : f.from];
    if (!other) continue;
    if (f.status === 'accepted') friends.push({ ...publicUser(other), ...presenceOf(other.id) });
    else if (f.to === user.id) incoming.push(publicUser(other));
    else outgoing.push(publicUser(other));
  }
  return { friends, incoming, outgoing };
}

function addFriend(user, body) {
  if (tooMany('add:' + user.id, 30, 3600000)) throw new HttpError(429, 'Pedidos demais por enquanto. Tente de novo mais tarde.');
  const name = cleanText(body.username, 40).replace(/^@/, '').toLowerCase();
  const target = byName.has(name) ? db.users[byName.get(name)] : null;
  if (!target) throw new HttpError(404, 'Não encontramos ninguém com esse nome de usuário.');
  if (target.id === user.id) throw new HttpError(400, 'Você não pode adicionar a si mesmo.');
  const rel = relation(user.id, target.id);
  if (rel) {
    if (rel.status === 'accepted') throw new HttpError(409, 'Vocês já são amigos.');
    if (rel.from === user.id) throw new HttpError(409, 'Você já enviou um pedido para essa pessoa.');
    rel.status = 'accepted';   // ela já tinha pedido: adicionar de volta aceita
    saveDb();
    return { message: 'Vocês agora são amigos!', accepted: true };
  }
  const pending = db.friendships.filter((f) => f.from === user.id && f.status === 'pending').length;
  if (pending >= 50) throw new HttpError(400, 'Você já tem muitos pedidos pendentes. Espere alguém responder.');
  db.friendships.push({ from: user.id, to: target.id, status: 'pending', at: Date.now() });
  saveDb();
  return { message: 'Pedido de amizade enviado para ' + target.displayName + '.' };
}

function acceptFriend(user, body) {
  const f = db.friendships.find((x) => x.from === String(body.userId) && x.to === user.id && x.status === 'pending');
  if (!f) throw new HttpError(404, 'Pedido não encontrado.');
  f.status = 'accepted';
  saveDb();
  return {};
}

// Serve para remover amigo, recusar um pedido recebido ou cancelar um pedido enviado
function removeFriend(user, body) {
  const id = String(body.userId);
  const before = db.friendships.length;
  db.friendships = db.friendships.filter((f) => !((f.from === user.id && f.to === id) || (f.from === id && f.to === user.id)));
  if (db.friendships.length !== before) saveDb();
  return {};
}

function setPresence(user, body) {
  let room = null;
  if (body.room && typeof body.room === 'object') {
    const code = String(body.room.code || '').toUpperCase();
    if (/^[A-Z0-9]{4,8}$/.test(code)) room = { code, title: cleanText(body.room.title, 60) || 'Sala ' + code };
  }
  presence.set(user.id, { t: Date.now(), room });
  return {};
}

async function route(req, res, url, ip) {
  const method = req.method;
  const p = url.pathname;

  if (method !== 'GET') {
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Formato não aceito.');
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch (e) { /* inválido */ }
      if (host !== req.headers.host) throw new HttpError(403, 'Origem não permitida.');
    }
  }
  const body = method === 'GET' ? {} : await readJson(req);

  if (method === 'POST' && p === '/api/register') return register(req, body, ip);
  if (method === 'POST' && p === '/api/login') return login(req, body, ip);

  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Você não está conectado.');

  if (method === 'GET' && p === '/api/me') return { body: { user: publicUser(user) } };
  if (method === 'POST' && p === '/api/logout') {
    delete db.sessions[sha(sessionToken(req))];
    presence.delete(user.id);
    saveDb();
    return { body: {}, cookie: cookie(req, '', 0) };
  }
  if (method === 'GET' && p === '/api/friends') return { body: listFriends(user) };
  if (method === 'POST' && p === '/api/friends/add') return { body: addFriend(user, body) };
  if (method === 'POST' && p === '/api/friends/accept') return { body: acceptFriend(user, body) };
  if (method === 'POST' && p === '/api/friends/remove') return { body: removeFriend(user, body) };
  if (method === 'POST' && p === '/api/presence') return { body: setPresence(user, body) };
  if (method === 'POST' && p === '/api/presence/off') { presence.delete(user.id); return { body: {} }; }
  if (method === 'GET' && p === '/api/servers') return { body: { servers: user.servers || {} } };
  if (method === 'PUT' && p === '/api/servers') {
    user.servers = sanitizeServers(body.servers);
    saveDb();
    return { body: {} };
  }
  throw new HttpError(404, 'Rota não encontrada.');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Pedido grande demais.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' ? v : {});
      } catch (e) { reject(new HttpError(400, 'Pedido inválido.')); }
    });
    req.on('error', reject);
  });
}

/* ---------------- Arquivos do site (só estes, nada de pastas livres) ---------------- */

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/peerjs.min.js': ['peerjs.min.js', 'text/javascript; charset=utf-8']
};

function sendStatic(req, res, pathname) {
  const entry = STATIC[pathname];
  if (!entry || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  let data;
  try { data = fs.readFileSync(path.join(__dirname, entry[0])); } catch (e) { return false; }
  res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-cache', 'Content-Length': data.length });
  res.end(req.method === 'HEAD' ? undefined : data);
  return true;
}

/* ---------------- Servidor HTTP ---------------- */

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  const url = new URL(req.url, 'http://localhost');

  if (!url.pathname.startsWith('/api/')) {
    if (sendStatic(req, res, url.pathname)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Não encontrado');
  }

  try {
    const r = await route(req, res, url, clientIp(req));
    const out = JSON.stringify(r.body || {});
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (r.cookie) headers['Set-Cookie'] = r.cookie;
    res.writeHead(r.status || 200, headers);
    res.end(out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.end();
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: status === 500 ? 'Erro interno do servidor.' : e.message }));
  }
});

loadDb();
server.listen(PORT, HOST, () => {
  console.log('Chat de Voz rodando em http://localhost:' + PORT);
  console.log('Dados guardados em ' + DB_FILE);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
