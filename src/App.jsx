import React, { useState } from 'react';
import {
  House,
  Users,
  Settings2,
  Plus,
  ArrowUpRight,
  Receipt,
  Wallet,
  ArrowRight,
  Copy,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { api } from './api.js';
import {
  Session,
  Shell,
  Profile,
  Heading,
  Stat,
  Button,
  Modal,
  Empty,
  Notice,
  useTask,
  useData,
  money,
  Brand,
} from './ui.jsx';
import GroupDetails from './GroupDetails.jsx';
import GroupForm from './GroupForm.jsx';

export default function App() {
  const path = window.location.pathname.split('/');
  if (path[1] === 'join' && path[2]) return <Invitation token={path[2]} />;
  return <Session>{(user, setUser) => <Workspace user={user} onUserChange={setUser} />}</Session>;
}
function Workspace({ user, onUserChange }) {
  const [page, setPage] = useState('groups');
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [invite, setInvite] = useState('');
  const { data, error, reload } = useData('/workspace/state');
  const items = [
    {
      id: 'groups',
      label: 'Mis grupos',
      Icon: House,
      count: data?.groups.filter((group) => group.status === 'active').length || 0,
    },
    { id: 'settings', label: 'Mi perfil', Icon: Settings2 },
  ];
  function navigate(page) {
    setPage(page);
    setSelected(null);
  }
  return (
    <Shell user={user} onUserChange={onUserChange} page={page} onPage={navigate} items={items}>
      <Notice error={error} />
      {page === 'settings' ? (
        <Profile
          user={user}
          onUserChange={onUserChange}
          labels={{ title: 'Mi perfil', label: 'Nombre de mi espacio' }}
        />
      ) : !data ? (
        <div className="loading-inline">Poniendo las cuentas en su sitio…</div>
      ) : selected ? (
        <GroupDetails
          id={selected}
          user={user}
          onBack={() => setSelected(null)}
          reloadWorkspace={reload}
          onInvite={setInvite}
        />
      ) : (
        <Groups
          groups={data.groups}
          user={user}
          onCreate={() => setCreating(true)}
          onOpen={(group) => setSelected(group.id)}
          reload={reload}
        />
      )}{' '}
      {creating && (
        <GroupForm
          currency={user.currency}
          onClose={() => setCreating(false)}
          onSaved={async (result) => {
            setCreating(false);
            await reload();
            setSelected(result.group.id);
            setInvite(result.url);
          }}
        />
      )}
      {invite && <InviteModal url={invite} onClose={() => setInvite('')} />}
    </Shell>
  );
}
function Groups({ groups, user, onCreate, onOpen, reload }) {
  const [filter, setFilter] = useState('active');
  const task = useTask();
  const filtered = groups.filter((group) => group.status === filter);
  const balances = {};
  for (const group of groups.filter((group) => group.status === 'active'))
    balances[group.currency] = (balances[group.currency] || 0) + group.myBalanceCents;
  return (
    <>
      <Heading
        eyebrow="LO COMPARTIDO, BIEN LLEVADO"
        title={'Hola, ' + user.name.split(' ')[0] + '. Todo en casa.'}
        description="Un vistazo a los grupos y las cuentas que compartes."
        action={
          <Button onClick={onCreate}>
            <Plus size={18} /> Crear grupo
          </Button>
        }
      />
      <section className="depa-hero">
        <div>
          <span className="eyebrow">MENOS CUENTAS. MÁS BUENOS MOMENTOS.</span>
          <h2>
            Compartir la vida.
            <br />
            <em>Sin enredar las cuentas.</em>
          </h2>
          <p>Una compra, un viaje, un hogar. Cada gasto en su lugar.</p>
          <button className="text-button" onClick={onCreate}>
            Abre un nuevo grupo <ArrowRight size={16} />
          </button>
        </div>
        <div className="house-art" aria-hidden="true">
          <House size={86} strokeWidth={1} />
          <span>✦</span>
          <i />
          <b />
        </div>
      </section>
      <div className="stats-grid three">
        <Stat
          label="Grupos activos"
          value={groups.filter((group) => group.status === 'active').length}
          icon={Users}
          note="Espacios para compartir"
        />
        <Stat
          label="Gastos registrados"
          value={groups.reduce((sum, group) => sum + group.expenseCount, 0)}
          icon={Receipt}
          note="Todo queda en el historial"
        />
        <Stat
          label="Tu balance por moneda"
          value={
            Object.keys(balances).length
              ? Object.entries(balances)
                  .map(
                    ([currency, amount]) =>
                      (amount < 0 ? '−' : amount > 0 ? '+' : '') +
                      money(Math.abs(amount), currency),
                  )
                  .join(' / ')
              : '—'
          }
          icon={Wallet}
          note="A favor (+) o por aportar (−). Sin conversiones."
        />
      </div>
      <div className="section-bar">
        <div className="segmented">
          <button
            className={filter === 'active' ? 'active' : ''}
            onClick={() => setFilter('active')}
          >
            En movimiento
          </button>
          <button
            className={filter === 'archived' ? 'active' : ''}
            onClick={() => setFilter('archived')}
          >
            Archivados
          </button>
        </div>
        <button className="text-button" onClick={() => task.perform(reload)}>
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>
      <Notice error={task.error} />
      {filtered.length ? (
        <div className="group-grid">
          {filtered.map((group, index) => (
            <button className="group-card panel" onClick={() => onOpen(group)} key={group.id}>
              <header>
                <span className={'group-symbol hue-' + (index % 4)}>
                  <House size={25} />
                </span>
                <ArrowUpRight size={20} />
              </header>
              <span className="eyebrow">
                {group.memberCount} {group.memberCount === 1 ? 'PERSONA' : 'PERSONAS'} ·{' '}
                {group.currency}
              </span>
              <h2>{group.name}</h2>
              <p>{group.description || 'Un espacio para lo que compartes.'}</p>
              <div className="group-balance">
                <span>
                  {group.myBalanceCents < 0
                    ? 'Te toca aportar'
                    : group.myBalanceCents > 0
                      ? 'A tu favor'
                      : 'Tus cuentas están al día'}
                </span>
                <strong
                  className={
                    group.myBalanceCents < 0
                      ? 'negative'
                      : group.myBalanceCents > 0
                        ? 'positive'
                        : ''
                  }
                >
                  {money(Math.abs(group.myBalanceCents), group.currency)}
                </strong>
              </div>
              <footer>
                <span>
                  <Receipt size={14} />
                  {group.expenseCount} gastos
                </span>
                <span>{money(group.totalCents, group.currency)} compartidos</span>
              </footer>
            </button>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            icon={House}
            title={
              filter === 'archived' ? 'Sin grupos archivados' : 'Un buen comienzo para compartir'
            }
            action={
              filter === 'active' && (
                <Button variant="secondary" onClick={onCreate}>
                  Crear mi primer grupo
                </Button>
              )
            }
          >
            {filter === 'archived'
              ? 'Los grupos que cierres conservarán aquí su historial.'
              : 'Crea un grupo e invita a tu gente. Los gastos y balances se verán solo entre sus miembros.'}
          </Empty>
        </section>
      )}
    </>
  );
}
export function InviteModal({ url, onClose }) {
  const task = useTask();
  return (
    <Modal title="Hay sitio para tu gente" onClose={onClose}>
      <div className="stack">
        <span className="invite-symbol">
          <Users size={32} />
        </span>
        <p>
          Comparte este enlace con quienes deban ver y registrar los gastos. Necesitarán su propia
          cuenta para unirse.
        </p>
        <a className="share-link" href={url} target="_blank" rel="noreferrer">
          {url}
          <ExternalLink size={16} />
        </a>
        <p className="muted small">
          Guárdalo antes de cerrar. Crear otra invitación invalida este enlace.
        </p>
        <Notice error={task.error} success={task.success} />
        <Button
          onClick={() =>
            task.perform(() => navigator.clipboard.writeText(url), 'Invitación copiada.')
          }
        >
          <Copy size={16} /> Copiar invitación
        </Button>
      </div>
    </Modal>
  );
}
function Invitation({ token }) {
  const { data, error } = useData('/invite/' + token);
  if (error)
    return (
      <div className="invite-page">
        <Brand />
        <Empty title="Esta invitación ya no está disponible">{error}</Empty>
        <a className="button secondary" href="/">
          Ir a Depa
        </a>
      </div>
    );
  if (!data) return <div className="loading">Abriendo la invitación…</div>;
  if (data.status !== 'active')
    return (
      <div className="invite-page">
        <Brand />
        <Empty title="Este grupo está archivado">
          Pide a quien lo creó que lo reactive antes de unirte.
        </Empty>
      </div>
    );
  return (
    <Session>{(user, setUser) => <JoinPanel group={data} token={token} user={user} />}</Session>
  );
}
function JoinPanel({ group, token, user }) {
  const task = useTask();
  return (
    <main className="invite-page">
      <Brand />
      <section className="join-card panel">
        <span className="invite-symbol">
          <House size={37} />
        </span>
        <span className="eyebrow">TE HICIERON UN LUGAR</span>
        <h1>{group.name}</h1>
        <p>{group.description}</p>
        <span className="badge active">
          {group.memberCount} {group.memberCount === 1 ? 'persona' : 'personas'} · {group.currency}
        </span>
        <p className="muted small">
          Te unirás como {user.name}. Podrás ver el historial y participar en los gastos de este
          grupo.
        </p>
        <Notice error={task.error} />
        <Button
          busy={task.busy}
          onClick={() =>
            task.perform(async () => {
              await api('/workspace/join/' + token, { method: 'POST', body: {} });
              window.location.assign('/');
            })
          }
        >
          Unirme al grupo <ArrowRight size={17} />
        </Button>
        <a href="/" className="text-button">
          Volver a mi espacio
        </a>
      </section>
    </main>
  );
}
