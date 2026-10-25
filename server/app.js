import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createBase, finishApi, problem, text, date, money, currencies } from './core.js';
import { hashToken, createToken } from './auth.js';
import { transaction } from './db.js';
import {
  categories,
  splitEqually,
  calculateBalances,
  suggestTransfers,
  csvCell,
} from '../shared/balances.js';

const groupSchema = z.object({
  name: text(120).min(1),
  description: text(1000),
  currency: z.enum(currencies),
});
const expenseSchema = z.object({
  description: text(200).min(1),
  amountCents: money,
  payerId: z.string().uuid(),
  date,
  category: z.enum(Object.keys(categories)),
  splitMode: z.enum(['equal', 'exact']),
  participantIds: z.array(z.string().uuid()).max(50).default([]),
  shares: z
    .array(
      z.object({ userId: z.string().uuid(), amountCents: z.number().int().min(0).max(100000000) }),
    )
    .max(50)
    .default([]),
});
const readGroup = (row) => ({
  id: row.id,
  ownerId: row.owner_id,
  name: row.name,
  description: row.description,
  currency: row.currency,
  status: row.status,
  hasInvite: Boolean(row.invite_hash),
  createdAt: row.created_at,
});
const readExpense = (row) => ({
  id: row.id,
  groupId: row.group_id,
  createdBy: row.created_by,
  payerId: row.payer_id,
  description: row.description,
  amountCents: row.amount_cents,
  category: row.category,
  date: row.expense_date,
  splitMode: row.split_mode,
  shares: JSON.parse(row.shares),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});
const readSettlement = (row) => ({
  id: row.id,
  fromId: row.from_id,
  toId: row.to_id,
  amountCents: row.amount_cents,
  status: row.status,
  note: row.note,
  createdAt: row.created_at,
  confirmedAt: row.confirmed_at,
});

export function createApp(db, options = { appUrl: 'http://localhost:3300' }) {
  const { app, workspace, origin } = createBase(db, options);
  function groupFor(id, userId) {
    const row = db
      .prepare(
        'SELECT groups.* FROM groups JOIN memberships ON memberships.group_id=groups.id WHERE groups.id=? AND memberships.user_id=?',
      )
      .get(id, userId);
    if (!row) throw problem(404, 'No se encontró el grupo.');
    return row;
  }
  function requireActive(group) {
    if (group.status !== 'active') throw problem(409, 'El grupo está archivado.');
  }
  function requireOwner(group, userId) {
    if (group.owner_id !== userId)
      throw problem(403, 'Solo quien creó el grupo puede hacer este cambio.');
  }
  function membersOf(id) {
    return db
      .prepare(
        'SELECT users.id,users.profile,memberships.joined_at FROM memberships JOIN users ON users.id=memberships.user_id WHERE group_id=? ORDER BY joined_at,users.id',
      )
      .all(id)
      .map((row) => ({ id: row.id, name: JSON.parse(row.profile).name, joinedAt: row.joined_at }));
  }
  function expenseRows(id) {
    return db
      .prepare(
        'SELECT * FROM expenses WHERE group_id=? AND deleted_at IS NULL ORDER BY expense_date DESC,created_at DESC',
      )
      .all(id)
      .map(readExpense);
  }
  function settlementRows(id) {
    return db
      .prepare('SELECT * FROM settlements WHERE group_id=? ORDER BY created_at DESC')
      .all(id)
      .map(readSettlement);
  }
  function balancesOf(id) {
    return calculateBalances(membersOf(id), expenseRows(id), settlementRows(id));
  }
  function log(groupId, userId, action, description, data = {}) {
    db.prepare(
      'INSERT INTO activity(id,group_id,user_id,action,description,data,created_at) VALUES(?,?,?,?,?,?,?)',
    ).run(
      randomUUID(),
      groupId,
      userId,
      action,
      description,
      JSON.stringify(data),
      new Date().toISOString(),
    );
  }
  function inviteGroup(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw problem(404, 'La invitación no está disponible.');
    const group = db.prepare('SELECT * FROM groups WHERE invite_hash=?').get(hashToken(token));
    if (!group) throw problem(404, 'La invitación no está disponible.');
    return group;
  }
  function normalizedExpense(input, group) {
    const ids = membersOf(group.id).map((member) => member.id);
    if (!ids.includes(input.payerId)) throw problem(400, 'Quien pagó debe pertenecer al grupo.');
    if (
      input.splitMode === 'equal' &&
      (!input.participantIds.length ||
        new Set(input.participantIds).size !== input.participantIds.length)
    )
      throw problem(400, 'Selecciona las personas del reparto sin repetirlas.');
    const shares =
      input.splitMode === 'equal'
        ? splitEqually(input.amountCents, input.participantIds)
        : input.shares;
    if (
      !shares.length ||
      new Set(shares.map((share) => share.userId)).size !== shares.length ||
      shares.some((share) => !ids.includes(share.userId))
    )
      throw problem(400, 'Revisa las personas del reparto.');
    if (shares.reduce((sum, share) => sum + share.amountCents, 0) !== input.amountCents)
      throw problem(400, 'El reparto debe sumar exactamente el importe del gasto.');
    return shares;
  }
  app.get('/api/invite/:token', (req, res) => {
    const group = inviteGroup(req.params.token);
    res.json({
      name: group.name,
      description: group.description,
      currency: group.currency,
      status: group.status,
      memberCount: membersOf(group.id).length,
    });
  });
  workspace.post('/join/:token', (req, res) => {
    const group = inviteGroup(req.params.token);
    requireActive(group);
    const exists = db
      .prepare('SELECT user_id FROM memberships WHERE group_id=? AND user_id=?')
      .get(group.id, req.user.id);
    if (!exists) {
      if (membersOf(group.id).length >= 50)
        throw problem(409, 'El grupo alcanzó el límite de 50 miembros.');
      transaction(db, () => {
        db.prepare('INSERT INTO memberships(group_id,user_id,joined_at) VALUES(?,?,?)').run(
          group.id,
          req.user.id,
          new Date().toISOString(),
        );
        log(group.id, req.user.id, 'member_joined', 'Se unió al grupo');
      });
    }
    res.json({ id: group.id });
  });
  workspace.get('/state', (req, res) =>
    res.json({
      groups: db
        .prepare(
          'SELECT groups.* FROM groups JOIN memberships ON memberships.group_id=groups.id WHERE memberships.user_id=? ORDER BY groups.created_at DESC',
        )
        .all(req.user.id)
        .map((row) => {
          const balances = balancesOf(row.id);
          return {
            ...readGroup(row),
            memberCount: membersOf(row.id).length,
            myBalanceCents: balances[req.user.id] || 0,
            totalCents: expenseRows(row.id).reduce((sum, expense) => sum + expense.amountCents, 0),
            expenseCount: expenseRows(row.id).length,
          };
        }),
    }),
  );
  workspace.post('/groups', (req, res) => {
    const input = groupSchema.parse(req.body);
    const id = randomUUID();
    const token = createToken();
    transaction(db, () => {
      db.prepare(
        'INSERT INTO groups(id,owner_id,name,description,currency,invite_hash,created_at) VALUES(?,?,?,?,?,?,?)',
      ).run(
        id,
        req.user.id,
        input.name,
        input.description,
        input.currency,
        hashToken(token),
        new Date().toISOString(),
      );
      db.prepare('INSERT INTO memberships(group_id,user_id,joined_at) VALUES(?,?,?)').run(
        id,
        req.user.id,
        new Date().toISOString(),
      );
      log(id, req.user.id, 'group_created', 'Creó el grupo');
    });
    res
      .status(201)
      .json({ group: readGroup(groupFor(id, req.user.id)), url: origin + '/join/' + token });
  });
  workspace.get('/groups/:id', (req, res) => {
    const group = groupFor(req.params.id, req.user.id);
    const members = membersOf(group.id);
    const expenses = expenseRows(group.id);
    const settlements = settlementRows(group.id);
    const balances = calculateBalances(members, expenses, settlements);
    const activity = db
      .prepare(
        'SELECT activity.*,users.profile FROM activity JOIN users ON users.id=activity.user_id WHERE group_id=? ORDER BY activity.created_at DESC,activity.rowid DESC LIMIT 100',
      )
      .all(group.id)
      .map((row) => ({
        id: row.id,
        author: JSON.parse(row.profile).name,
        action: row.action,
        description: row.description,
        createdAt: row.created_at,
      }));
    res.json({
      group: readGroup(group),
      members,
      expenses,
      settlements,
      balances,
      transfers: suggestTransfers(balances),
      activity,
    });
  });
  workspace.put('/groups/:id', (req, res) => {
    const input = z.object({ name: text(120).min(1), description: text(1000) }).parse(req.body);
    const group = groupFor(req.params.id, req.user.id);
    requireOwner(group, req.user.id);
    db.prepare('UPDATE groups SET name=?,description=? WHERE id=?').run(
      input.name,
      input.description,
      group.id,
    );
    res.json({ ok: true });
  });
  workspace.patch('/groups/:id/status', (req, res) => {
    const input = z.object({ status: z.enum(['active', 'archived']) }).parse(req.body);
    const group = groupFor(req.params.id, req.user.id);
    requireOwner(group, req.user.id);
    transaction(db, () => {
      db.prepare('UPDATE groups SET status=? WHERE id=?').run(input.status, group.id);
      log(
        group.id,
        req.user.id,
        'group_status',
        input.status === 'archived' ? 'Archivó el grupo' : 'Reactivó el grupo',
      );
    });
    res.json({ ok: true });
  });
  workspace.post('/groups/:id/invite', (req, res) => {
    const group = groupFor(req.params.id, req.user.id);
    requireOwner(group, req.user.id);
    requireActive(group);
    const token = createToken();
    db.prepare('UPDATE groups SET invite_hash=? WHERE id=?').run(hashToken(token), group.id);
    res.json({ url: origin + '/join/' + token });
  });
  workspace.delete('/groups/:id/invite', (req, res) => {
    const group = groupFor(req.params.id, req.user.id);
    requireOwner(group, req.user.id);
    db.prepare('UPDATE groups SET invite_hash=NULL WHERE id=?').run(group.id);
    res.json({ ok: true });
  });
  workspace.post('/groups/:id/expenses', (req, res) => {
    const input = expenseSchema.parse(req.body);
    const group = groupFor(req.params.id, req.user.id);
    requireActive(group);
    const shares = normalizedExpense(input, group);
    const id = randomUUID();
    const now = new Date().toISOString();
    transaction(db, () => {
      db.prepare(
        'INSERT INTO expenses(id,group_id,created_by,payer_id,description,amount_cents,category,expense_date,split_mode,shares,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        group.id,
        req.user.id,
        input.payerId,
        input.description,
        input.amountCents,
        input.category,
        input.date,
        input.splitMode,
        JSON.stringify(shares),
        now,
        now,
      );
      log(group.id, req.user.id, 'expense_created', 'Agregó «' + input.description + '»', {
        id,
        ...input,
        shares,
      });
    });
    res.status(201).json({ id });
  });
  workspace.put('/groups/:id/expenses/:expenseId', (req, res) => {
    const input = expenseSchema.parse(req.body);
    const group = groupFor(req.params.id, req.user.id);
    requireActive(group);
    const expense = db
      .prepare('SELECT * FROM expenses WHERE id=? AND group_id=? AND deleted_at IS NULL')
      .get(req.params.expenseId, group.id);
    if (!expense) throw problem(404, 'No se encontró el gasto.');
    if (expense.created_by !== req.user.id && group.owner_id !== req.user.id)
      throw problem(403, 'Solo quien registró el gasto o creó el grupo puede editarlo.');
    const shares = normalizedExpense(input, group);
    transaction(db, () => {
      db.prepare(
        'UPDATE expenses SET payer_id=?,description=?,amount_cents=?,category=?,expense_date=?,split_mode=?,shares=?,updated_at=? WHERE id=?',
      ).run(
        input.payerId,
        input.description,
        input.amountCents,
        input.category,
        input.date,
        input.splitMode,
        JSON.stringify(shares),
        new Date().toISOString(),
        expense.id,
      );
      log(group.id, req.user.id, 'expense_updated', 'Actualizó «' + input.description + '»', {
        id: expense.id,
        before: readExpense(expense),
        after: { ...input, shares },
      });
    });
    res.json({ ok: true });
  });
  workspace.delete('/groups/:id/expenses/:expenseId', (req, res) => {
    const group = groupFor(req.params.id, req.user.id);
    requireActive(group);
    const expense = db
      .prepare('SELECT * FROM expenses WHERE id=? AND group_id=? AND deleted_at IS NULL')
      .get(req.params.expenseId, group.id);
    if (!expense) throw problem(404, 'No se encontró el gasto.');
    if (expense.created_by !== req.user.id && group.owner_id !== req.user.id)
      throw problem(403, 'No puedes eliminar este gasto.');
    transaction(db, () => {
      db.prepare('UPDATE expenses SET deleted_at=? WHERE id=?').run(
        new Date().toISOString(),
        expense.id,
      );
      log(group.id, req.user.id, 'expense_deleted', 'Retiró «' + expense.description + '»', {
        expense: readExpense(expense),
      });
    });
    res.json({ ok: true });
  });
  workspace.post('/groups/:id/settlements', (req, res) => {
    const input = z
      .object({ toId: z.string().uuid(), amountCents: money, note: text(500) })
      .parse(req.body);
    const group = groupFor(req.params.id, req.user.id);
    requireActive(group);
    const balances = balancesOf(group.id);
    if (input.toId === req.user.id || !(input.toId in balances))
      throw problem(400, 'Selecciona otra persona del grupo.');
    if (input.amountCents > Math.min(-(balances[req.user.id] || 0), balances[input.toId] || 0))
      throw problem(409, 'El pago supera el saldo disponible. Actualiza los balances.');
    const id = randomUUID();
    transaction(db, () => {
      db.prepare(
        'INSERT INTO settlements(id,group_id,from_id,to_id,amount_cents,note,created_at) VALUES(?,?,?,?,?,?,?)',
      ).run(
        id,
        group.id,
        req.user.id,
        input.toId,
        input.amountCents,
        input.note,
        new Date().toISOString(),
      );
      log(
        group.id,
        req.user.id,
        'settlement_pending',
        'Registró un pago pendiente de confirmación',
        { id, ...input },
      );
    });
    res.status(201).json({ id });
  });
  workspace.post('/groups/:id/settlements/:settlementId/confirm', (req, res) => {
    const group = groupFor(req.params.id, req.user.id);
    requireActive(group);
    transaction(db, () => {
      const payment = db
        .prepare('SELECT * FROM settlements WHERE id=? AND group_id=?')
        .get(req.params.settlementId, group.id);
      if (!payment) throw problem(404, 'No se encontró el pago.');
      if (payment.to_id !== req.user.id)
        throw problem(403, 'Solo quien recibe puede confirmar el pago.');
      if (payment.status !== 'pending') throw problem(409, 'Este pago ya está cerrado.');
      const balances = balancesOf(group.id);
      if (payment.amount_cents > Math.min(-balances[payment.from_id], balances[payment.to_id]))
        throw problem(
          409,
          'El saldo cambió y este pago ya no se puede confirmar. Cancélalo y revisa los balances.',
        );
      db.prepare("UPDATE settlements SET status='confirmed',confirmed_at=? WHERE id=?").run(
        new Date().toISOString(),
        payment.id,
      );
      log(group.id, req.user.id, 'settlement_confirmed', 'Confirmó la recepción de un pago', {
        id: payment.id,
      });
    });
    res.json({ ok: true });
  });
  workspace.post('/groups/:id/settlements/:settlementId/cancel', (req, res) => {
    const group = groupFor(req.params.id, req.user.id);
    requireActive(group);
    const payment = db
      .prepare('SELECT * FROM settlements WHERE id=? AND group_id=?')
      .get(req.params.settlementId, group.id);
    if (!payment) throw problem(404, 'No se encontró el pago.');
    if (![payment.from_id, payment.to_id].includes(req.user.id))
      throw problem(403, 'No puedes cancelar este pago.');
    if (payment.status !== 'pending') throw problem(409, 'Este pago ya está cerrado.');
    transaction(db, () => {
      db.prepare("UPDATE settlements SET status='cancelled' WHERE id=?").run(payment.id);
      log(group.id, req.user.id, 'settlement_cancelled', 'Canceló un pago pendiente', {
        id: payment.id,
      });
    });
    res.json({ ok: true });
  });
  workspace.get('/groups/:id/export', (req, res) => {
    const group = groupFor(req.params.id, req.user.id);
    const members = membersOf(group.id);
    const names = Object.fromEntries(members.map((member) => [member.id, member.name]));
    const rows = [
      ['Fecha', 'Descripción', 'Categoría', 'Pagó', 'Importe', 'Moneda'],
      ...expenseRows(group.id).map((expense) => [
        expense.date,
        expense.description,
        categories[expense.category],
        names[expense.payerId],
        (expense.amountCents / 100).toFixed(2),
        group.currency,
      ]),
    ];
    res
      .attachment('depa-expenses.csv')
      .type('text/csv; charset=utf-8')
      .send('\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n'));
  });
  return finishApi(app);
}
