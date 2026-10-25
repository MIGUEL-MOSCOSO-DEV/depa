import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Plus,
  Users,
  Receipt,
  ArrowRight,
  Clock3,
  Check,
  Pencil,
  Trash2,
  Archive,
  Download,
  Search,
  Activity,
  Wallet,
  RefreshCw,
  Unlink,
} from 'lucide-react';
import { api } from './api.js';
import {
  Heading,
  Stat,
  Button,
  Field,
  Modal,
  Empty,
  Notice,
  useTask,
  useData,
  money,
  dateLabel,
} from './ui.jsx';
import { categories } from '../shared/balances.js';
import ExpenseForm from './ExpenseForm.jsx';
import GroupForm from './GroupForm.jsx';

export default function GroupDetails({ id, user, onBack, reloadWorkspace, onInvite }) {
  const { data, error, reload } = useData('/workspace/groups/' + id);
  const [tab, setTab] = useState('expenses');
  const [editing, setEditing] = useState(null);
  const [editingGroup, setEditingGroup] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [payment, setPayment] = useState(null);
  const [confirm, setConfirm] = useState('');
  const [search, setSearch] = useState('');
  const task = useTask();
  useEffect(() => {
    const timer = setInterval(() => reload().catch(() => {}), 30000);
    return () => clearInterval(timer);
  }, [reload]);
  async function refresh() {
    await Promise.all([reload(), reloadWorkspace()]);
  }
  if (!data)
    return (
      <>
        <Notice error={error} />
        <div className="loading-inline">Revisando las cuentas…</div>
      </>
    );
  const { group, members, expenses, settlements, balances, transfers, activity } = data;
  const names = Object.fromEntries(members.map((member) => [member.id, member.name]));
  const owner = group.ownerId === user.id;
  const active = group.status === 'active';
  const myBalance = balances[user.id] || 0;
  const filtered = expenses.filter((expense) =>
    [expense.description, names[expense.payerId], categories[expense.category]]
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  function settleAction(settlement, action) {
    task.perform(async () => {
      await api('/workspace/groups/' + id + '/settlements/' + settlement.id + '/' + action, {
        method: 'POST',
        body: {},
      });
      await refresh();
    });
  }
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} /> Mis grupos
      </button>
      <Heading
        eyebrow={members.length + ' PERSONAS · ' + group.currency}
        title={group.name}
        description={group.description}
        action={
          <div className="actions wrap">
            {owner && active && (
              <Button variant="secondary" onClick={() => setConfirm('invite')}>
                <Users size={16} /> Invitar
              </Button>
            )}
            {active && (
              <Button onClick={() => setEditing({})}>
                <Plus size={17} /> Agregar gasto
              </Button>
            )}
          </div>
        }
      />
      <div className="group-members-row">
        <div className="member-avatars">
          {members.slice(0, 6).map((member) => (
            <span className="avatar" key={member.id} title={member.name}>
              {member.name.slice(0, 2).toUpperCase()}
            </span>
          ))}
        </div>
        <span>
          {members
            .map((member) => (member.id === user.id ? 'Tú' : member.name))
            .slice(0, 4)
            .join(', ')}
          {members.length > 4 ? ' y ' + (members.length - 4) + ' más' : ''}
        </span>
        <span className={'badge ' + group.status}>{active ? 'En movimiento' : 'Archivado'}</span>
        {owner && (
          <button className="text-button" onClick={() => setEditingGroup(true)}>
            <Pencil size={14} /> Editar
          </button>
        )}
      </div>
      <div className="stats-grid three">
        <Stat
          label="Gastos compartidos"
          value={money(
            expenses.reduce((sum, expense) => sum + expense.amountCents, 0),
            group.currency,
          )}
          icon={Receipt}
          note={expenses.length + ' gastos registrados'}
        />
        <Stat
          label={
            myBalance < 0 ? 'Te toca aportar' : myBalance > 0 ? 'A tu favor' : 'Tus cuentas, al día'
          }
          value={money(Math.abs(myBalance), group.currency)}
          icon={Wallet}
          note={
            myBalance < 0
              ? 'Lo que falta compensar'
              : myBalance > 0
                ? 'Lo que el grupo te debe'
                : 'Nada pendiente por compensar'
          }
        />
        <Stat
          label="Pagos por confirmar"
          value={settlements.filter((settlement) => settlement.status === 'pending').length}
          icon={Clock3}
          note="El receptor tiene la última palabra"
        />
      </div>
      <Notice error={task.error} />
      <div className="section-bar">
        <div className="segmented">
          {[
            ['expenses', 'Gastos'],
            ['balances', 'Balances y pagos'],
            ['activity', 'Actividad'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={tab === value ? 'active' : ''}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="actions">
          <button
            className="icon-button"
            aria-label="Actualizar grupo"
            onClick={() => task.perform(refresh)}
          >
            <RefreshCw size={16} />
          </button>
          <a className="text-button" href={'/api/workspace/groups/' + id + '/export'} download>
            <Download size={15} /> CSV
          </a>
        </div>
      </div>
      {tab === 'expenses' ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>Lo que vamos compartiendo</h2>
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Buscar gastos"
                placeholder="Buscar un gasto…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          {filtered.length ? (
            <div className="expense-list">
              {filtered.map((expense) => (
                <article className="expense-row" key={expense.id}>
                  <span className={'category-icon ' + expense.category}>
                    <Receipt size={20} />
                  </span>
                  <div className="expense-info">
                    <h3>{expense.description}</h3>
                    <p>
                      {names[expense.payerId]} pagó · {dateLabel(expense.date)} ·{' '}
                      {categories[expense.category]}
                    </p>
                    <small>
                      {expense.splitMode === 'equal' ? 'Por igual' : 'Importes exactos'} entre{' '}
                      {expense.shares.length} {expense.shares.length === 1 ? 'persona' : 'personas'}{' '}
                      · Tu parte:{' '}
                      {money(
                        expense.shares.find((share) => share.userId === user.id)?.amountCents || 0,
                        group.currency,
                      )}
                    </small>
                  </div>
                  <strong className="expense-amount">
                    {money(expense.amountCents, group.currency)}
                  </strong>
                  {active && (owner || expense.createdBy === user.id) && (
                    <div className="actions">
                      <button
                        className="icon-button"
                        aria-label={'Editar ' + expense.description}
                        onClick={() => setEditing(expense)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button danger-text"
                        aria-label={'Retirar ' + expense.description}
                        onClick={() => setDeleting(expense)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <Empty
              icon={Receipt}
              title={search ? 'Sin coincidencias' : 'El primer gasto está por llegar'}
              action={
                active &&
                !search && (
                  <Button variant="secondary" onClick={() => setEditing({})}>
                    Registrar un gasto
                  </Button>
                )
              }
            >
              {search
                ? 'Prueba otra descripción o nombre.'
                : 'Cuando alguien pague algo compartido, regístralo aquí y repartimos las cuentas.'}
            </Empty>
          )}
        </section>
      ) : tab === 'balances' ? (
        <div className="balances-layout">
          <section className="panel padded">
            <h2>Así estamos</h2>
            <p className="muted small">
              Un saldo positivo está a favor. Uno negativo está por compensar.
            </p>
            <div className="balance-members">
              {members.map((member) => (
                <div key={member.id}>
                  <span className="avatar">{member.name.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <strong>
                      {member.name}
                      {member.id === user.id ? ' (tú)' : ''}
                    </strong>
                    <small>
                      {balances[member.id] > 0
                        ? 'Tiene a favor'
                        : balances[member.id] < 0
                          ? 'Tiene por aportar'
                          : 'Al día'}
                    </small>
                  </div>
                  <b
                    className={
                      balances[member.id] < 0
                        ? 'negative'
                        : balances[member.id] > 0
                          ? 'positive'
                          : ''
                    }
                  >
                    {balances[member.id] < 0 ? '−' : balances[member.id] > 0 ? '+' : ''}
                    {money(Math.abs(balances[member.id]), group.currency)}
                  </b>
                </div>
              ))}
            </div>
          </section>
          <section className="panel padded">
            <span className="eyebrow">VOLVAMOS A CERO</span>
            <h2>Para dejarlo parejo</h2>
            <p className="muted small">
              Estas transferencias compensan los balances actuales. Los pagos pendientes aún no
              están descontados.
            </p>
            {transfers.length ? (
              <div className="transfer-list">
                {transfers.map((transfer, index) => (
                  <article key={index}>
                    <div>
                      <span>{names[transfer.fromId]}</span>
                      <ArrowRight size={15} />
                      <span>{names[transfer.toId]}</span>
                    </div>
                    <strong>{money(transfer.amountCents, group.currency)}</strong>
                    {active && transfer.fromId === user.id ? (
                      <Button variant="secondary" onClick={() => setPayment(transfer)}>
                        Ya realicé este pago
                      </Button>
                    ) : (
                      <small className="muted">
                        {transfer.fromId === user.id
                          ? 'Grupo archivado'
                          : names[transfer.fromId] +
                            ' registra el pago; ' +
                            names[transfer.toId] +
                            ' lo confirma.'}
                      </small>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="balanced-state">
                <Check size={32} />
                <h3>Todo está parejo.</h3>
                <p>No hay balances por compensar.</p>
              </div>
            )}
          </section>
          <section className="panel payments-panel">
            <div className="panel-heading">
              <h2>Pagos y confirmaciones</h2>
              <span>{settlements.length}</span>
            </div>
            {settlements.length ? (
              <div className="payment-list">
                {settlements.map((settlement) => (
                  <article key={settlement.id}>
                    <div>
                      <strong>
                        {names[settlement.fromId]} <ArrowRight size={13} /> {names[settlement.toId]}
                      </strong>
                      <p>
                        {money(settlement.amountCents, group.currency)} ·{' '}
                        {dateLabel(settlement.createdAt)}
                      </p>
                      {settlement.note && <small>{settlement.note}</small>}
                    </div>
                    <span className={'badge ' + settlement.status}>
                      {settlement.status === 'pending'
                        ? 'Por confirmar'
                        : settlement.status === 'confirmed'
                          ? 'Confirmado'
                          : 'Cancelado'}
                    </span>
                    {active && settlement.status === 'pending' && (
                      <div className="actions">
                        {settlement.toId === user.id && (
                          <Button
                            busy={task.busy}
                            onClick={() => settleAction(settlement, 'confirm')}
                          >
                            <Check size={14} /> Recibido
                          </Button>
                        )}
                        {[settlement.fromId, settlement.toId].includes(user.id) && (
                          <Button
                            variant="secondary"
                            busy={task.busy}
                            onClick={() => settleAction(settlement, 'cancel')}
                          >
                            Cancelar
                          </Button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <Empty icon={Wallet} title="Sin pagos registrados">
                Los pagos solo cambiarán los balances cuando quien recibe confirme la recepción.
              </Empty>
            )}
          </section>
        </div>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <h2>Lo que ha pasado en el grupo</h2>
            <Activity size={18} />
          </div>
          <div className="activity-list">
            {activity.map((item) => (
              <article key={item.id}>
                <span className="activity-dot" />
                <div>
                  <strong>{item.author}</strong>
                  <p>{item.description}</p>
                </div>
                <time>{dateLabel(item.createdAt)}</time>
              </article>
            ))}
          </div>
          <p className="activity-foot">
            Se muestran las últimas 100 acciones. El historial completo se conserva en la base de
            datos.
          </p>
        </section>
      )}
      {owner && (
        <div className="group-footer">
          <button className="text-button" onClick={() => setConfirm('status')}>
            <Archive size={14} />
            {active ? 'Archivar grupo' : 'Reactivar grupo'}
          </button>
          {group.hasInvite && (
            <button className="text-button danger-text" onClick={() => setConfirm('revoke')}>
              <Unlink size={14} /> Revocar invitación
            </button>
          )}
        </div>
      )}
      {editing && (
        <ExpenseForm
          group={group}
          members={members}
          user={user}
          expense={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
      {editingGroup && (
        <GroupForm
          group={group}
          onClose={() => setEditingGroup(false)}
          onSaved={async () => {
            setEditingGroup(false);
            await refresh();
          }}
        />
      )}
      {deleting && (
        <Modal title="Retirar este gasto" onClose={() => setDeleting(null)}>
          <div className="stack">
            <Notice error={task.error} />
            <p>
              «{deleting.description}» dejará de contar en los balances. Su registro se conservará
              en el historial.
            </p>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Volver
              </Button>
              <Button
                variant="danger"
                busy={task.busy}
                onClick={() =>
                  task.perform(async () => {
                    await api('/workspace/groups/' + id + '/expenses/' + deleting.id, {
                      method: 'DELETE',
                    });
                    setDeleting(null);
                    await refresh();
                  })
                }
              >
                Retirar gasto
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {payment && (
        <PaymentForm
          group={group}
          transfer={payment}
          names={names}
          onClose={() => setPayment(null)}
          onSaved={async () => {
            setPayment(null);
            await refresh();
          }}
        />
      )}
      {confirm && (
        <Modal
          title={
            confirm === 'invite'
              ? 'Invitar al grupo'
              : confirm === 'revoke'
                ? 'Revocar invitación'
                : active
                  ? 'Archivar grupo'
                  : 'Reactivar grupo'
          }
          onClose={() => setConfirm('')}
        >
          <div className="stack">
            <Notice error={task.error} />
            <p>
              {confirm === 'invite'
                ? 'Se creará una nueva invitación y la anterior dejará de funcionar. Quienes ya pertenecen al grupo conservarán el acceso.'
                : confirm === 'revoke'
                  ? 'Nadie podrá unirse con la invitación anterior. Los miembros actuales conservarán el acceso.'
                  : active
                    ? 'El grupo conservará su historial, pero no aceptará gastos, pagos ni nuevos miembros.'
                    : 'Podrán volver a registrarse gastos y pagos en el grupo.'}
            </p>
            <div className="modal-actions">
              <Button variant="secondary" onClick={() => setConfirm('')}>
                Volver
              </Button>
              <Button
                busy={task.busy}
                onClick={() =>
                  task.perform(async () => {
                    if (confirm === 'invite') {
                      const result = await api('/workspace/groups/' + id + '/invite', {
                        method: 'POST',
                        body: {},
                      });
                      onInvite(result.url);
                    } else if (confirm === 'revoke') {
                      await api('/workspace/groups/' + id + '/invite', { method: 'DELETE' });
                    } else {
                      await api('/workspace/groups/' + id + '/status', {
                        method: 'PATCH',
                        body: { status: active ? 'archived' : 'active' },
                      });
                    }
                    setConfirm('');
                    await refresh();
                  })
                }
              >
                Confirmar
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function PaymentForm({ group, transfer, names, onClose, onSaved }) {
  const task = useTask();
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    task.perform(async () => {
      await api('/workspace/groups/' + group.id + '/settlements', {
        method: 'POST',
        body: {
          toId: transfer.toId,
          amountCents: Math.round(Number(form.get('amount')) * 100),
          note: form.get('note'),
        },
      });
      await onSaved();
    });
  }
  return (
    <Modal title="Registrar un pago realizado" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Notice error={task.error} />
        <div className="payment-destination">
          <span>{names[transfer.fromId]}</span>
          <ArrowRight size={19} />
          <strong>{names[transfer.toId]}</strong>
        </div>
        <Field
          label={'Importe · ' + group.currency}
          name="amount"
          type="number"
          min="0.01"
          max={transfer.amountCents / 100}
          step="0.01"
          defaultValue={transfer.amountCents / 100}
          required
        />
        <Field label="Nota opcional">
          <textarea name="note" maxLength={500} rows={2} />
        </Field>
        <p className="muted small">
          Depa no mueve dinero. Registra únicamente un pago que ya hayas hecho por otro medio. El
          balance se actualizará cuando {names[transfer.toId]} confirme que lo recibió.
        </p>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button busy={task.busy}>Registrar pago</Button>
        </div>
      </form>
    </Modal>
  );
}
