import React from 'react';
import { api } from './api.js';
import { Modal, Field, Button, Notice, useTask } from './ui.jsx';
export default function GroupForm({ group, currency, onClose, onSaved }) {
  const task = useTask();
  function submit(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    task.perform(async () => {
      const result = await api('/workspace/groups' + (group ? '/' + group.id : ''), {
        method: group ? 'PUT' : 'POST',
        body,
      });
      await onSaved(result);
    });
  }
  return (
    <Modal title={group ? 'Editar grupo' : 'Un espacio para compartir'} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Notice error={task.error} />
        <Field
          label="Nombre del grupo"
          name="name"
          defaultValue={group?.name || ''}
          maxLength={120}
          required
        />
        <Field label="Sobre este grupo">
          <textarea
            name="description"
            defaultValue={group?.description || ''}
            maxLength={1000}
            rows={3}
          />
        </Field>
        {!group && (
          <Field label="Moneda del grupo" hint="La moneda queda fijada al crear el grupo.">
            <select name="currency" defaultValue={currency}>
              {['USD', 'PEN', 'EUR', 'MXN', 'COP', 'CLP', 'ARS', 'GBP'].map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </Field>
        )}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button busy={task.busy}>{group ? 'Guardar cambios' : 'Crear grupo'}</Button>
        </div>
      </form>
    </Modal>
  );
}
