import React, { useState } from 'react';
import { api } from './api.js';
import { Button, Field, Modal, Notice, useTask, money, today } from './ui.jsx';
import { categories, splitEqually } from '../shared/balances.js';
export default function ExpenseForm({ group, members, user, expense, onClose, onSaved }) {
  const [amount, setAmount] = useState(expense ? String(expense.amountCents / 100) : '');
  const [mode, setMode] = useState(expense?.splitMode || 'equal');
  const [selected, setSelected] = useState(
    expense ? expense.shares.map((share) => share.userId) : members.map((member) => member.id),
  );
  const [custom, setCustom] = useState(
    Object.fromEntries(
      members.map((member) => [
        member.id,
        String(
          (expense?.shares.find((share) => share.userId === member.id)?.amountCents || 0) / 100,
        ),
      ]),
    ),
  );
  const task = useTask();
  const amountCents = Math.round(Number(amount) * 100);
  const shares =
    mode === 'equal'
      ? selected.length && amountCents > 0
        ? splitEqually(amountCents, selected)
        : []
      : selected.map((userId) => ({
          userId,
          amountCents: Math.round(Number(custom[userId] || 0) * 100),
        }));
  const assigned = shares.reduce((sum, share) => sum + share.amountCents, 0);
  function toggle(id) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }
  function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    task.perform(async () => {
      if (!selected.length) throw new Error('Selecciona al menos una persona.');
      if (assigned !== amountCents)
        throw new Error('El reparto debe sumar exactamente el importe del gasto.');
      const body = {
        description: values.description,
        amountCents,
        payerId: values.payerId,
        date: values.date,
        category: values.category,
        splitMode: mode,
        participantIds: selected,
        shares,
      };
      await api('/workspace/groups/' + group.id + '/expenses' + (expense ? '/' + expense.id : ''), {
        method: expense ? 'PUT' : 'POST',
        body,
      });
      await onSaved();
    });
  }
  return (
    <Modal title={expense ? 'Ajustar un gasto' : 'Un gasto para compartir'} wide onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Notice error={task.error} />
        <Field
          label="¿En qué se gastó?"
          name="description"
          defaultValue={expense?.description || ''}
          required
          maxLength={200}
        />
        <div className="form-grid">
          <Field
            label={'Importe · ' + group.currency}
            type="number"
            min="0.01"
            max="1000000"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
          <Field label="Quién pagó">
            <select name="payerId" defaultValue={expense?.payerId || user.id}>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.id === user.id ? ' (tú)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Fecha"
            name="date"
            type="date"
            defaultValue={expense?.date || today()}
            required
          />
          <Field label="Categoría">
            <select name="category" defaultValue={expense?.category || 'other'}>
              {Object.entries(categories).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="split-heading">
          <h3>Cómo lo compartimos</h3>
          <div className="segmented">
            <button
              type="button"
              className={mode === 'equal' ? 'active' : ''}
              onClick={() => setMode('equal')}
            >
              Por igual
            </button>
            <button
              type="button"
              className={mode === 'exact' ? 'active' : ''}
              onClick={() => setMode('exact')}
            >
              Importes exactos
            </button>
          </div>
        </div>
        <div className="split-members">
          {members.map((member) => (
            <div key={member.id}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={selected.includes(member.id)}
                  onChange={() => toggle(member.id)}
                />
                <span className="avatar">{member.name.slice(0, 2).toUpperCase()}</span>
                {member.name}
              </label>
              {mode === 'exact' && selected.includes(member.id) ? (
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  aria-label={'Parte de ' + member.name}
                  value={custom[member.id]}
                  onChange={(event) => setCustom({ ...custom, [member.id]: event.target.value })}
                  required
                />
              ) : (
                <strong>
                  {money(
                    shares.find((share) => share.userId === member.id)?.amountCents || 0,
                    group.currency,
                  )}
                </strong>
              )}
            </div>
          ))}
        </div>
        <div className={'split-summary ' + (assigned !== amountCents ? 'unbalanced' : '')}>
          <span>
            {mode === 'equal'
              ? 'Reparto automático, incluido el último céntimo.'
              : 'Asignado: ' + money(assigned, group.currency)}
          </span>
          <strong>{money(amountCents || 0, group.currency)}</strong>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button busy={task.busy}>Guardar gasto</Button>
        </div>
      </form>
    </Modal>
  );
}
