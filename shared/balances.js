export const categories = {
  home: 'Casa',
  food: 'Comida',
  utilities: 'Servicios',
  transport: 'Transporte',
  leisure: 'Planes',
  other: 'Otros',
};
export function splitEqually(amountCents, memberIds) {
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    !memberIds.length ||
    new Set(memberIds).size !== memberIds.length
  )
    throw new Error('El reparto no es válido.');
  const ids = [...memberIds].sort();
  const base = Math.floor(amountCents / ids.length);
  const remainder = amountCents % ids.length;
  return ids.map((userId, index) => ({ userId, amountCents: base + (index < remainder ? 1 : 0) }));
}
export function calculateBalances(members, expenses, settlements) {
  const balances = Object.fromEntries(members.map((member) => [member.id, 0]));
  for (const expense of expenses) {
    if (expense.deletedAt) continue;
    balances[expense.payerId] += expense.amountCents;
    for (const share of expense.shares) balances[share.userId] -= share.amountCents;
  }
  for (const settlement of settlements) {
    if (settlement.status !== 'confirmed') continue;
    balances[settlement.fromId] += settlement.amountCents;
    balances[settlement.toId] -= settlement.amountCents;
  }
  return balances;
}
export function suggestTransfers(balances) {
  const debtors = Object.entries(balances)
    .filter(([, amount]) => amount < 0)
    .map(([id, amount]) => ({ id, amount: -amount }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const creditors = Object.entries(balances)
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const transfers = [];
  let debtor = 0,
    creditor = 0;
  while (debtor < debtors.length && creditor < creditors.length) {
    const amountCents = Math.min(debtors[debtor].amount, creditors[creditor].amount);
    transfers.push({ fromId: debtors[debtor].id, toId: creditors[creditor].id, amountCents });
    debtors[debtor].amount -= amountCents;
    creditors[creditor].amount -= amountCents;
    if (!debtors[debtor].amount) debtor++;
    if (!creditors[creditor].amount) creditor++;
  }
  return transfers;
}
export function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
