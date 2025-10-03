import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const http = createServer(app);
const io = new Server(http, {
  cors: { origin: '*' },
  pingTimeout: 25000,
  pingInterval: 20000,
});

// sessions[sid] = { items: Map(inv -> item) }
const sessions = Object.create(null);

// импорт списка
app.post('/api/session/:sid/import', (req, res) => {
  const sid = req.params.sid;
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ ok: false });

  if (!sessions[sid]) sessions[sid] = { items: new Map() };
  const S = sessions[sid];

  for (const it of items) {
    const inv = String(it.inv || '').trim();
    const name = String(it.name || '').trim();
    const location = (it.location ?? '').toString().trim() || null;
    if (!inv || !name) continue;

    const prev = S.items.get(inv) || {};
    const actualLocation = prev.actualLocation || null;

    S.items.set(inv, {
      id: it.id || inv,
      inv, name,
      location,                // из 3-го столбца
      actualLocation,          // фактический, если уже ставили
      serial: it.serial, resp: it.resp, note: it.note,
      scannedAt: prev.scannedAt || null,
      duplicateCount: prev.duplicateCount || 0,
      lastUser: prev.lastUser || null,
    });
  }
  io.to(sid).emit('state', { items: [...S.items.values()] });
  res.json({ ok: true, count: S.items.size });
});

// получить состояние
app.get('/api/session/:sid/items', (req, res) => {
  const sid = req.params.sid;
  const S = sessions[sid];
  res.json({ ok: true, items: S ? [...S.items.values()] : [] });
});

// Полная очистка сессии
app.delete('/api/session/:sid/clear', (req, res) => {
  const sid = req.params.sid;
  if (!sessions[sid]) sessions[sid] = { items: new Map() };
  sessions[sid].items.clear();
  io.to(sid).emit('state', { items: [] });
  res.json({ ok: true });
});

// сокеты: join + scan + relocate
io.on('connection', (socket) => {
  socket.on('join', ({ sid }) => {
    socket.join(sid);
    const S = sessions[sid] || (sessions[sid] = { items: new Map() });
    socket.emit('state', { items: [...S.items.values()] });
  });

  socket.on('scan', ({ sid, userId, inv }) => {
    const S = sessions[sid];
    if (!S) return;
    const it = S.items.get(inv);
    if (!it) return;

    if (it.scannedAt) it.duplicateCount = (it.duplicateCount || 0) + 1;
    else it.scannedAt = new Date().toISOString();
    it.lastUser = userId;

    S.items.set(inv, it);
    io.to(sid).emit('itemUpdated', it);
  });

  // новый эвент: установка фактического кабинета
  socket.on('relocate', ({ sid, inv, actualLocation }) => {
    const S = sessions[sid];
    if (!S) return;
    const it = S.items.get(inv);
    if (!it) return;

    it.actualLocation = (actualLocation ?? '').toString().trim() || null;
    S.items.set(inv, it);
    io.to(sid).emit('itemUpdated', it);
  });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => console.log('server on :' + PORT));
