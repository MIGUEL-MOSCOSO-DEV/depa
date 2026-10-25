import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
let f, alice, bob, outsider, groupId, token, expenseId, settlementId;
const expense = () => ({
  description: 'Gasto de prueba',
  amountCents: 10001,
  payerId: alice.id,
  date: '2026-10-25',
  category: 'food',
  splitMode: 'equal',
  participantIds: [alice.id, bob.id],
  shares: [],
});
before(async () => {
  f = await fixture();
  alice = await f.register('Alice');
  bob = await f.register('Bob');
  outsider = await f.register('Outsider');
});
after(async () => {
  await f.close();
});
test('el grupo no es visible para cuentas que no pertenecen a él', async () => {
  const result = await f.request('/workspace/groups', {
    cookie: alice.cookie,
    method: 'POST',
    body: { name: 'Grupo de prueba', description: '', currency: 'PEN' },
  });
  assert.equal(result.status, 201);
  groupId = result.data.group.id;
  token = new URL(result.data.url).pathname.split('/')[2];
  assert.equal(
    (await f.request('/workspace/groups/' + groupId, { cookie: bob.cookie })).status,
    404,
  );
  assert.equal((await f.request('/workspace/state', { cookie: bob.cookie })).data.groups.length, 0);
});
test('la invitación no expone el historial y unirse es idempotente', async () => {
  const invite = await f.request('/invite/' + token);
  assert.equal(invite.status, 200);
  assert.equal('members' in invite.data, false);
  for (let count = 0; count < 2; count++)
    assert.equal(
      (
        await f.request('/workspace/join/' + token, {
          cookie: bob.cookie,
          method: 'POST',
          body: {},
        })
      ).status,
      200,
    );
  const group = await f.request('/workspace/groups/' + groupId, { cookie: bob.cookie });
  assert.equal(group.data.members.length, 2);
});
test('valida las partes exactas y los participantes', async () => {
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/expenses', {
        cookie: alice.cookie,
        method: 'POST',
        body: { ...expense(), splitMode: 'exact', shares: [{ userId: alice.id, amountCents: 1 }] },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/expenses', {
        cookie: alice.cookie,
        method: 'POST',
        body: { ...expense(), participantIds: [] },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/expenses', {
        cookie: alice.cookie,
        method: 'POST',
        body: { ...expense(), participantIds: [outsider.id] },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/expenses', {
        cookie: outsider.cookie,
        method: 'POST',
        body: expense(),
      })
    ).status,
    404,
  );
});
test('reparte al céntimo y conserva la suma de balances en cero', async () => {
  const result = await f.request('/workspace/groups/' + groupId + '/expenses', {
    cookie: alice.cookie,
    method: 'POST',
    body: expense(),
  });
  assert.equal(result.status, 201);
  expenseId = result.data.id;
  const detail = (await f.request('/workspace/groups/' + groupId, { cookie: alice.cookie })).data;
  assert.equal(
    detail.expenses[0].shares.reduce((sum, share) => sum + share.amountCents, 0),
    10001,
  );
  assert.equal(
    Object.values(detail.balances).reduce((a, b) => a + b, 0),
    0,
  );
  assert.equal(
    detail.balances[alice.id],
    detail.expenses[0].shares.find((share) => share.userId === bob.id).amountCents,
  );
});
test('solo quien registró el gasto o creó el grupo puede modificarlo', async () => {
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/expenses/' + expenseId, {
        cookie: bob.cookie,
        method: 'PUT',
        body: expense(),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/expenses/' + expenseId, {
        cookie: bob.cookie,
        method: 'DELETE',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/expenses/' + expenseId, {
        cookie: alice.cookie,
        method: 'PUT',
        body: { ...expense(), description: 'Gasto ajustado' },
      })
    ).status,
    200,
  );
});
test('los pagos pendientes no cambian el balance y solo confirma el receptor', async () => {
  const before = (await f.request('/workspace/groups/' + groupId, { cookie: bob.cookie })).data;
  const amount = -before.balances[bob.id];
  const result = await f.request('/workspace/groups/' + groupId + '/settlements', {
    cookie: bob.cookie,
    method: 'POST',
    body: { toId: alice.id, amountCents: amount, note: '' },
  });
  assert.equal(result.status, 201);
  settlementId = result.data.id;
  assert.deepEqual(
    (await f.request('/workspace/groups/' + groupId, { cookie: bob.cookie })).data.balances,
    before.balances,
  );
  assert.equal(
    (
      await f.request(
        '/workspace/groups/' + groupId + '/settlements/' + settlementId + '/confirm',
        { cookie: bob.cookie, method: 'POST', body: {} },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request(
        '/workspace/groups/' + groupId + '/settlements/' + settlementId + '/confirm',
        { cookie: alice.cookie, method: 'POST', body: {} },
      )
    ).status,
    200,
  );
  const after = (await f.request('/workspace/groups/' + groupId, { cookie: alice.cookie })).data;
  assert.equal(after.balances[alice.id], 0);
  assert.equal(after.balances[bob.id], 0);
  assert.equal(
    (
      await f.request(
        '/workspace/groups/' + groupId + '/settlements/' + settlementId + '/confirm',
        { cookie: alice.cookie, method: 'POST', body: {} },
      )
    ).status,
    409,
  );
});
test('no admite pagos que superen el saldo pendiente', async () => {
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/settlements', {
        cookie: bob.cookie,
        method: 'POST',
        body: { toId: alice.id, amountCents: 1, note: '' },
      })
    ).status,
    409,
  );
});
test('la exportación protege las descripciones que parecen fórmulas', async () => {
  await f.request('/workspace/groups/' + groupId + '/expenses/' + expenseId, {
    cookie: alice.cookie,
    method: 'PUT',
    body: { ...expense(), description: '=SUM(A1)' },
  });
  const response = await f.request('/workspace/groups/' + groupId + '/export', {
    cookie: bob.cookie,
  });
  assert.equal(response.status, 200);
  assert.ok(response.data.includes("'=SUM(A1)"));
  assert.equal(
    (await f.request('/workspace/groups/' + groupId + '/export', { cookie: outsider.cookie }))
      .status,
    404,
  );
});
test('retirar un gasto lo conserva en el historial sin sumarlo', async () => {
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/expenses/' + expenseId, {
        cookie: alice.cookie,
        method: 'DELETE',
      })
    ).status,
    200,
  );
  const detail = (await f.request('/workspace/groups/' + groupId, { cookie: alice.cookie })).data;
  assert.equal(detail.expenses.length, 0);
  assert.ok(detail.activity.some((item) => item.action === 'expense_deleted'));
  assert.ok(f.db.prepare('SELECT deleted_at FROM expenses WHERE id=?').get(expenseId).deleted_at);
});
test('renovar invitación mantiene a los miembros y revocar bloquea nuevas entradas', async () => {
  const old = token;
  const result = await f.request('/workspace/groups/' + groupId + '/invite', {
    cookie: alice.cookie,
    method: 'POST',
    body: {},
  });
  token = new URL(result.data.url).pathname.split('/')[2];
  assert.equal((await f.request('/invite/' + old)).status, 404);
  assert.equal(
    (await f.request('/workspace/groups/' + groupId, { cookie: bob.cookie })).status,
    200,
  );
  await f.request('/workspace/groups/' + groupId + '/invite', {
    cookie: alice.cookie,
    method: 'DELETE',
  });
  assert.equal((await f.request('/invite/' + token)).status, 404);
});
test('solo el propietario archiva y un grupo archivado es de consulta', async () => {
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/status', {
        cookie: bob.cookie,
        method: 'PATCH',
        body: { status: 'archived' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/status', {
        cookie: alice.cookie,
        method: 'PATCH',
        body: { status: 'archived' },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request('/workspace/groups/' + groupId + '/expenses', {
        cookie: alice.cookie,
        method: 'POST',
        body: expense(),
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.request('/workspace/groups/' + groupId, { cookie: bob.cookie })).status,
    200,
  );
});
