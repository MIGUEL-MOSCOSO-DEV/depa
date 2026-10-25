import test from 'node:test';
import assert from 'node:assert/strict';
import { splitEqually, calculateBalances, suggestTransfers, csvCell } from '../shared/balances.js';
test('el reparto conserva todos los céntimos y es determinista', () => {
  for (let members = 1; members <= 12; members++) {
    const ids = Array.from({ length: members }, (_, index) => 'member-' + index);
    for (const amount of [1, 2, 99, 100, 101, 10001, 999999]) {
      const shares = splitEqually(amount, ids);
      assert.equal(
        shares.reduce((sum, share) => sum + share.amountCents, 0),
        amount,
      );
      assert.ok(
        Math.max(...shares.map((share) => share.amountCents)) -
          Math.min(...shares.map((share) => share.amountCents)) <=
          1,
      );
      assert.deepEqual(shares, splitEqually(amount, [...ids].reverse()));
    }
  }
});
test('rechaza participantes vacíos o repetidos', () => {
  assert.throws(() => splitEqually(100, []));
  assert.throws(() => splitEqually(100, ['a', 'a']));
  assert.throws(() => splitEqually(0, ['a']));
});
test('los pagos pendientes no alteran el balance y los confirmados sí', () => {
  const members = [{ id: 'a' }, { id: 'b' }];
  const expenses = [{ payerId: 'a', amountCents: 10001, shares: splitEqually(10001, ['a', 'b']) }];
  const pending = { fromId: 'b', toId: 'a', amountCents: 5000, status: 'pending' };
  assert.deepEqual(calculateBalances(members, expenses, [pending]), { a: 5000, b: -5000 });
  assert.deepEqual(calculateBalances(members, expenses, [{ ...pending, status: 'confirmed' }]), {
    a: 0,
    b: 0,
  });
});
test('las transferencias sugeridas compensan todos los saldos', () => {
  const balances = { a: -700, b: -300, c: 450, d: 550 };
  const remaining = { ...balances };
  for (const transfer of suggestTransfers(balances)) {
    assert.ok(transfer.amountCents > 0);
    remaining[transfer.fromId] += transfer.amountCents;
    remaining[transfer.toId] -= transfer.amountCents;
  }
  assert.deepEqual(Object.values(remaining), [0, 0, 0, 0]);
});

test('el CSV escapa comillas y neutraliza fórmulas de hojas de cálculo', () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  const cell = csvCell('=SUM(A1)');
  assert.equal(cell.charCodeAt(1), 39);
  assert.equal(cell.slice(2, -1), '=SUM(A1)');
  assert.equal(csvCell('@cmd').charCodeAt(1), 39);
});
