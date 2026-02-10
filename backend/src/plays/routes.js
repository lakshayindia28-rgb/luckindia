const express = require('express');

const { getDb } = require('../../db/db');
const { requireAuth, requireRole } = require('../auth/middleware');
const { ensureSlot, assertDate, assertHour } = require('../slots/service');

const router = express.Router();

function normalizeQuizType(q) {
  const v = String(q || '').toUpperCase();
  if (!['SILVER', 'GOLD', 'DIAMOND'].includes(v)) return null;
  return v;
}

function getCurrentPrices(db) {
  const rows = db.prepare('SELECT quiz_type, price FROM prices').all();
  const prices = { SILVER: 11, GOLD: 55, DIAMOND: 110 };
  for (const r of rows) prices[r.quiz_type] = r.price;
  return prices;
}

function assertAssigned(db, superUserId, vendorUserId) {
  const row = db
    .prepare('SELECT 1 AS ok FROM assignments WHERE super_user_id = ? AND vendor_user_id = ?')
    .get(superUserId, vendorUserId);
  if (!row) {
    const err = new Error('Vendor not assigned to this Super');
    err.statusCode = 403;
    throw err;
  }
}

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

function currentIndiaSlot() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const yyyy = get('year');
  const mm = get('month');
  const dd = get('day');
  const hh = get('hour');

  return { date: `${yyyy}-${mm}-${dd}`, hour: Number(hh) };
}

function assertVendorIsCurrentSlot(slotDate, slotHour) {
  const now = currentIndiaSlot();
  if (String(slotDate) !== String(now.date) || Number(slotHour) !== Number(now.hour)) {
    const err = new Error('SLOT CLOSED');
    err.statusCode = 409;
    throw err;
  }
}

function assertCanPlaySlotQuiz(db, slotId, quizType) {
  const published = db
    .prepare('SELECT 1 AS ok FROM results WHERE slot_id = ? AND quiz_type = ? LIMIT 1')
    .get(slotId, quizType);
  if (published) {
    const err = new Error('SLOT CLOSED: result already published');
    err.statusCode = 409;
    throw err;
  }
}

function canBypassPublishedLock(req) {
  return req.user?.role === 'SUPER';
}

function upsertPlay(db, { vendorUserId, slotId, quizType, selectedNumber, tickets, priceEach, totalBet, createdByUserId }) {
  // If the vendor adds tickets again for the same number, we increment tickets + total_bet.
  db.prepare(
    `INSERT INTO plays
     (vendor_user_id, slot_id, quiz_type, selected_number, tickets, price_each, total_bet, created_by_user_id, created_at)
     VALUES
     (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(vendor_user_id, slot_id, quiz_type, selected_number)
     DO UPDATE SET
       tickets = plays.tickets + excluded.tickets,
       total_bet = plays.total_bet + excluded.total_bet,
       price_each = excluded.price_each,
       created_by_user_id = excluded.created_by_user_id`
  ).run(vendorUserId, slotId, quizType, selectedNumber, tickets, priceEach, totalBet, createdByUserId);
}

router.post('/', requireAuth, (req, res) => {
  const { vendorUserId, date, hour, quizType, selectedNumber, tickets } = req.body || {};

  const qt = normalizeQuizType(quizType);
  if (!qt) return res.status(400).json({ ok: false, error: 'Invalid quizType' });

  try {
    assertDate(date);
    assertHour(Number(hour));
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  const sn = Number(selectedNumber);
  const tk = Number(tickets);

  if (!Number.isInteger(sn) || sn < 0 || sn > 9) {
    return res.status(400).json({ ok: false, error: 'selectedNumber must be 0-9' });
  }
  if (!Number.isInteger(tk) || tk <= 0) {
    return res.status(400).json({ ok: false, error: 'tickets must be a positive integer' });
  }

  const db = getDb();

  let targetVendorId;
  if (req.user.role === 'VENDOR') {
    targetVendorId = req.user.id;
    try {
      assertVendorIsCurrentSlot(date, Number(hour));
    } catch (e) {
      return res.status(e.statusCode || 409).json({ ok: false, error: e.message });
    }
  } else {
    targetVendorId = Number(vendorUserId);
    if (!targetVendorId) return res.status(400).json({ ok: false, error: 'vendorUserId required' });

    const vendor = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetVendorId);
    if (!vendor || vendor.role !== 'VENDOR') {
      return res.status(400).json({ ok: false, error: 'vendorUserId must be a VENDOR' });
    }

    if (req.user.role === 'SUPER') {
      try {
        assertAssigned(db, req.user.id, targetVendorId);
      } catch (e) {
        return res.status(e.statusCode || 403).json({ ok: false, error: e.message });
      }
    }
  }

  const slot = ensureSlot(date, Number(hour));

  if (!canBypassPublishedLock(req)) {
    try {
      assertCanPlaySlotQuiz(db, slot.id, qt);
    } catch (e) {
      return res.status(e.statusCode || 409).json({ ok: false, error: e.message });
    }
  }

  const prices = getCurrentPrices(db);
  const priceEach = prices[qt];
  const totalBet = priceEach * tk;

  upsertPlay(db, {
    vendorUserId: targetVendorId,
    slotId: slot.id,
    quizType: qt,
    selectedNumber: sn,
    tickets: tk,
    priceEach,
    totalBet,
    createdByUserId: req.user.id,
  });

  res.status(201).json({ ok: true });
});

// VENDOR/SUPER/ADMIN: bulk add tickets (multiple numbers, multiple quizzes) for a slot
// Body: { date: 'YYYY-MM-DD', hour: 0-23, vendorUserId?: number, plays: [{ quizType, selectedNumber, tickets }] }
router.post('/bulk', requireAuth, (req, res) => {
  const { vendorUserId, date, hour, plays } = req.body || {};

  try {
    assertDate(date);
    assertHour(Number(hour));
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  if (!Array.isArray(plays) || plays.length === 0) {
    return res.status(400).json({ ok: false, error: 'plays array required' });
  }
  if (plays.length > 60) {
    return res.status(400).json({ ok: false, error: 'Too many items (max 60)' });
  }

  const db = getDb();

  let targetVendorId;
  if (req.user.role === 'VENDOR') {
    targetVendorId = req.user.id;
    try {
      assertVendorIsCurrentSlot(date, Number(hour));
    } catch (e) {
      return res.status(e.statusCode || 409).json({ ok: false, error: e.message });
    }
  } else {
    targetVendorId = Number(vendorUserId);
    if (!targetVendorId) return res.status(400).json({ ok: false, error: 'vendorUserId required' });

    const vendor = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetVendorId);
    if (!vendor || vendor.role !== 'VENDOR') {
      return res.status(400).json({ ok: false, error: 'vendorUserId must be a VENDOR' });
    }

    if (req.user.role === 'SUPER') {
      try {
        assertAssigned(db, req.user.id, targetVendorId);
      } catch (e) {
        return res.status(e.statusCode || 403).json({ ok: false, error: e.message });
      }
    }
  }

  const parsed = [];
  for (const item of plays) {
    const qt = normalizeQuizType(item?.quizType);
    if (!qt) return res.status(400).json({ ok: false, error: 'Invalid quizType in plays' });

    const sn = Number(item?.selectedNumber);
    if (!Number.isInteger(sn) || sn < 0 || sn > 9) {
      return res.status(400).json({ ok: false, error: 'selectedNumber must be 0-9' });
    }

    const tk = Number(item?.tickets);
    if (!isPositiveInt(tk)) {
      return res.status(400).json({ ok: false, error: 'tickets must be a positive integer' });
    }

    parsed.push({ quizType: qt, selectedNumber: sn, tickets: tk });
  }

  const slot = ensureSlot(date, Number(hour));

  if (!canBypassPublishedLock(req)) {
    // Pre-check closed quizzes
    const closed = [];
    for (const p of parsed) {
      const published = db
        .prepare('SELECT 1 AS ok FROM results WHERE slot_id = ? AND quiz_type = ? LIMIT 1')
        .get(slot.id, p.quizType);
      if (published) closed.push(p.quizType);
    }
    if (closed.length > 0) {
      return res
        .status(409)
        .json({ ok: false, error: 'SLOT CLOSED: result already published', closed: Array.from(new Set(closed)) });
    }
  }

  const prices = getCurrentPrices(db);

  const tx = db.transaction(() => {
    for (const p of parsed) {
      const priceEach = prices[p.quizType];
      const totalBet = priceEach * p.tickets;
      upsertPlay(db, {
        vendorUserId: targetVendorId,
        slotId: slot.id,
        quizType: p.quizType,
        selectedNumber: p.selectedNumber,
        tickets: p.tickets,
        priceEach,
        totalBet,
        createdByUserId: req.user.id,
      });
    }
  });

  tx();
  res.status(201).json({ ok: true, added: parsed.length });
});

router.get('/lock-status', requireAuth, (req, res) => {
  const { vendorUserId, date, hour } = req.query;

  try {
    assertDate(String(date));
    assertHour(Number(hour));
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  const db = getDb();

  let targetVendorId;
  if (req.user.role === 'VENDOR') {
    targetVendorId = req.user.id;
  } else {
    targetVendorId = Number(vendorUserId);
    if (!targetVendorId) return res.status(400).json({ ok: false, error: 'vendorUserId required' });

    if (req.user.role === 'SUPER') {
      try {
        assertAssigned(db, req.user.id, targetVendorId);
      } catch (e) {
        return res.status(403).json({ ok: false, error: e.message });
      }

      // SUPER can enter plays even after results are published, so don't mark anything locked.
      return res.json({ ok: true, locked: { SILVER: false, GOLD: false, DIAMOND: false } });
    }
  }

  const slot = db
    .prepare('SELECT id FROM slots WHERE slot_date = ? AND slot_hour = ?')
    .get(String(date), Number(hour));

  if (!slot) return res.json({ ok: true, locked: { SILVER: false, GOLD: false, DIAMOND: false } });

  // Lock only quizzes whose results are published.
  const published = db
    .prepare("SELECT quiz_type FROM results WHERE slot_id = ? AND quiz_type IN ('SILVER','GOLD','DIAMOND')")
    .all(slot.id);

  const locked = { SILVER: false, GOLD: false, DIAMOND: false };
  for (const r of published) locked[r.quiz_type] = true;

  res.json({ ok: true, locked });
});

// VENDOR: fetch what I played for a given slot
// Query: ?date=YYYY-MM-DD&hour=0-23
// SUPER/ADMIN: can pass vendorUserId
router.get('/mine', requireAuth, (req, res) => {
  const { vendorUserId, date, hour } = req.query;

  try {
    assertDate(String(date));
    assertHour(Number(hour));
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  const db = getDb();

  let targetVendorId;
  if (req.user.role === 'VENDOR') {
    targetVendorId = req.user.id;
  } else {
    targetVendorId = Number(vendorUserId);
    if (!targetVendorId) return res.status(400).json({ ok: false, error: 'vendorUserId required' });

    const vendor = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetVendorId);
    if (!vendor || vendor.role !== 'VENDOR') {
      return res.status(400).json({ ok: false, error: 'vendorUserId must be a VENDOR' });
    }

    if (req.user.role === 'SUPER') {
      try {
        assertAssigned(db, req.user.id, targetVendorId);
      } catch (e) {
        return res.status(e.statusCode || 403).json({ ok: false, error: e.message });
      }
    }
  }

  const slot = db
    .prepare('SELECT id FROM slots WHERE slot_date = ? AND slot_hour = ?')
    .get(String(date), Number(hour));

  if (!slot) return res.json({ ok: true, rows: [] });

  const rows = db
    .prepare(
      `SELECT
         p.quiz_type AS quizType,
         p.selected_number AS selectedNumber,
         st.title AS selectedTitle,
         SUM(p.tickets) AS tickets,
         MAX(p.price_each) AS priceEach,
         SUM(p.total_bet) AS totalBet,
         MIN(p.created_at) AS firstCreatedAt,
         MAX(p.created_at) AS lastCreatedAt
       FROM plays p
       LEFT JOIN stories s ON s.slot_id = p.slot_id AND s.quiz_type = p.quiz_type
       LEFT JOIN story_titles st ON st.story_id = s.id AND st.number = p.selected_number
       WHERE p.vendor_user_id = ? AND p.slot_id = ?
       GROUP BY p.quiz_type, p.selected_number
       ORDER BY p.quiz_type, p.selected_number`
    )
    .all(targetVendorId, slot.id);

  res.json({ ok: true, rows });
});

// ADMIN: audit trail of vendor plays (who played what, for which slot, and when)
// Query: ?date=YYYY-MM-DD&hour=0-23&vendorUserId=123&vendor=rahul&quizType=SILVER&limit=100&offset=0
router.get('/audit', requireAuth, requireRole('ADMIN'), (req, res) => {
  const { date, hour, vendorUserId, vendor, vendorUsername, quizType, limit, offset } = req.query;

  const qt = quizType ? normalizeQuizType(quizType) : null;
  if (quizType && !qt) return res.status(400).json({ ok: false, error: 'Invalid quizType' });

  if (date) {
    try {
      assertDate(String(date));
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  }

  let hourNum = null;
  if (hour !== undefined && hour !== null && String(hour).length > 0) {
    hourNum = Number(hour);
    try {
      assertHour(hourNum);
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
  }

  const vid = vendorUserId ? Number(vendorUserId) : null;
  if (vendorUserId && !vid) return res.status(400).json({ ok: false, error: 'Invalid vendorUserId' });

  const vendorQRaw = String(vendorUsername || vendor || '').trim();
  const vendorQ = vendorQRaw.length ? vendorQRaw : null;

  const limRaw = limit ? Number(limit) : 100;
  const offRaw = offset ? Number(offset) : 0;
  const lim = Number.isInteger(limRaw) ? Math.min(Math.max(limRaw, 1), 500) : 100;
  const off = Number.isInteger(offRaw) && offRaw >= 0 ? offRaw : 0;

  const db = getDb();

  const where = [];
  const args = [];
  if (date) {
    where.push('sl.slot_date = ?');
    args.push(String(date));
  }
  if (hourNum !== null) {
    where.push('sl.slot_hour = ?');
    args.push(hourNum);
  }
  if (vid) {
    where.push('p.vendor_user_id = ?');
    args.push(vid);
  }
  if (!vid && vendorQ) {
    if (/^\d+$/.test(vendorQ)) {
      where.push('p.vendor_user_id = ?');
      args.push(Number(vendorQ));
    } else {
      where.push('LOWER(vu.username) LIKE ?');
      args.push(`%${vendorQ.toLowerCase()}%`);
    }
  }
  if (qt) {
    where.push('p.quiz_type = ?');
    args.push(qt);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT
         p.id,
         p.vendor_user_id,
         vu.username AS vendor_username,
         sl.slot_date,
         sl.slot_hour,
         p.quiz_type,
         p.selected_number,
         st.title AS selected_title,
         p.tickets,
         p.price_each,
         p.total_bet,
         p.created_by_user_id,
         cu.username AS created_by_username,
         cu.role AS created_by_role,
         p.created_at
       FROM plays p
       JOIN users vu ON vu.id = p.vendor_user_id
       JOIN slots sl ON sl.id = p.slot_id
       JOIN users cu ON cu.id = p.created_by_user_id
       LEFT JOIN stories s ON s.slot_id = p.slot_id AND s.quiz_type = p.quiz_type
       LEFT JOIN story_titles st ON st.story_id = s.id AND st.number = p.selected_number
       ${whereSql}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...args, lim, off);

  const totalRow = db
    .prepare(
      `SELECT COUNT(1) AS total
       FROM plays p
       JOIN users vu ON vu.id = p.vendor_user_id
       JOIN slots sl ON sl.id = p.slot_id
       ${whereSql}`
    )
    .get(...args);

  res.json({ ok: true, total: totalRow ? totalRow.total : 0, rows, limit: lim, offset: off });
});

// ADMIN: delete play audit logs by slot date range (inclusive)
// Body: { fromDate: 'YYYY-MM-DD', toDate: 'YYYY-MM-DD' }
router.post('/audit/delete-range', requireAuth, requireRole('ADMIN'), (req, res) => {
  const fromDate = String(req.body?.fromDate || '').trim();
  const toDate = String(req.body?.toDate || '').trim();

  try {
    assertDate(fromDate);
    assertDate(toDate);
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  if (fromDate > toDate) {
    return res.status(400).json({ ok: false, error: 'fromDate must be <= toDate' });
  }

  const db = getDb();

  const tx = db.transaction(() => {
    // Delete plays for all slots in range.
    const info = db
      .prepare(
        `DELETE FROM plays
         WHERE slot_id IN (
           SELECT id FROM slots WHERE slot_date BETWEEN ? AND ?
         )`
      )
      .run(fromDate, toDate);
    return info.changes || 0;
  });

  const deleted = tx();
  res.json({ ok: true, deleted });
});

// ADMIN/SUPER: delete tickets (plays) for a specific slot
// Body: { date: 'YYYY-MM-DD', hour: 0-23, quizType?: 'SILVER'|'GOLD'|'DIAMOND' }
router.post('/delete-slot', requireAuth, requireRole(['ADMIN', 'SUPER']), (req, res) => {
  const date = String(req.body?.date || '').trim();
  const hour = Number(req.body?.hour);
  const qtRaw = req.body?.quizType;

  try {
    assertDate(date);
    assertHour(Number(hour));
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }

  const quizType = qtRaw ? normalizeQuizType(qtRaw) : null;
  if (qtRaw && !quizType) {
    return res.status(400).json({ ok: false, error: 'Invalid quizType' });
  }

  const db = getDb();
  const slot = ensureSlot(date, Number(hour));

  const info = quizType
    ? db.prepare('DELETE FROM plays WHERE slot_id = ? AND quiz_type = ?').run(slot.id, quizType)
    : db.prepare("DELETE FROM plays WHERE slot_id = ? AND quiz_type IN ('SILVER','GOLD','DIAMOND')").run(slot.id);

  res.json({ ok: true, slotId: slot.id, deleted: info.changes || 0, quizType: quizType || 'ALL' });
});

module.exports = router;
