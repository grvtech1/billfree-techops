import { useState } from 'react';
import type { CreateTicketPayload } from '@billfree/web-core';
import { SUPPORT_TYPES } from '@billfree/web-core';
import { api } from '@billfree/api';
import { useAuthStore, useUiStore, useCSRF } from '@billfree/app-state';
import { Modal } from '@billfree/ui';
import { useTickets } from '../hooks/useTickets';

interface Props {
  isOpen:  boolean;
  onClose: () => void;
}

const EMPTY_FORM: CreateTicketPayload = {
  agentName: '', agentEmail: '', requestedBy: '',
  mid: '', business: '', pos: '', supportType: 'Customer Support',
  concern: '', remark: '', phone: '',
};

export default function CreateTicketModal({ isOpen, onClose }: Props) {
  const { user, agents } = useAuthStore();
  const showToast        = useUiStore(s => s.showToast);
  const { withCSRF }     = useCSRF();
  const { fetchData }    = useTickets();

  const [form,      setForm]      = useState<CreateTicketPayload>(() => ({
    ...EMPTY_FORM,
    agentName:  user?.name  ?? '',
    agentEmail: user?.email ?? '',
  }));
  const [busy,    setBusy]    = useState(false);
  const [errors,  setErrors]  = useState<Partial<Record<keyof CreateTicketPayload, string>>>({});

  const field = (key: keyof CreateTicketPayload) => ({
    value:    form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm(f => ({ ...f, [key]: e.target.value }));
      setErrors(er => ({ ...er, [key]: undefined }));
    },
  });

  const validate = (): boolean => {
    const errs: typeof errors = {};
    if (!form.requestedBy.trim())  errs.requestedBy = 'Required';
    if (!form.mid.trim())          errs.mid         = 'Required';
    if (!form.business.trim())     errs.business    = 'Required';
    if (!form.concern.trim())      errs.concern     = 'Required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !user) return;
    setBusy(true);
    try {
      const result = await withCSRF(csrf =>
        api.createTicket({ data: form, csrfToken: csrf, token: user.token })
      );
      showToast(`Ticket created: ${result.ticketId ?? ''}`, 'success');
      await fetchData();
      onClose();
      setForm({ ...EMPTY_FORM, agentName: user.name ?? '', agentEmail: user.email });
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Create failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Ticket"
      maxWidth="640px"
      id="create-ticket-modal"
    >
      <form onSubmit={handleSubmit} className="ticket-form" noValidate>
        {/* Agent — autofilled, but changeable */}
        <div className="form-row form-row-2">
          <div className="form-group">
            <label className="form-label" htmlFor="ct-agent-name">Agent Name</label>
            <select
              id="ct-agent-name"
              className="form-input"
              {...field('agentName')}
              onChange={e => {
                const agent = agents.find(a => a.name === e.target.value);
                setForm(f => ({
                  ...f,
                  agentName:  e.target.value,
                  agentEmail: agent?.email ?? f.agentEmail,
                }));
              }}
            >
              {agents.map(a => (
                <option key={a.email} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ct-agent-email">Agent Email</label>
            <input
              id="ct-agent-email"
              type="email"
              className="form-input"
              {...field('agentEmail')}
              readOnly
            />
          </div>
        </div>

        {/* Requested by + Phone */}
        <div className="form-row form-row-2">
          <div className="form-group">
            <label className="form-label" htmlFor="ct-requested-by">
              Requested By <span className="required">*</span>
            </label>
            <input
              id="ct-requested-by"
              className={`form-input ${errors.requestedBy ? 'form-input-error' : ''}`}
              {...field('requestedBy')}
              placeholder="Branch / Customer"
            />
            {errors.requestedBy && (
              <span className="form-error">{errors.requestedBy}</span>
            )}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ct-phone">Phone</label>
            <input
              id="ct-phone"
              className="form-input"
              {...field('phone')}
              placeholder="10-digit mobile"
              maxLength={15}
            />
          </div>
        </div>

        {/* MID + Business */}
        <div className="form-row form-row-2">
          <div className="form-group">
            <label className="form-label" htmlFor="ct-mid">
              MID <span className="required">*</span>
            </label>
            <input
              id="ct-mid"
              className={`form-input ${errors.mid ? 'form-input-error' : ''}`}
              {...field('mid')}
              placeholder="Merchant MID"
            />
            {errors.mid && <span className="form-error">{errors.mid}</span>}
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ct-business">
              Business Name <span className="required">*</span>
            </label>
            <input
              id="ct-business"
              className={`form-input ${errors.business ? 'form-input-error' : ''}`}
              {...field('business')}
              placeholder="Business / merchant name"
            />
            {errors.business && <span className="form-error">{errors.business}</span>}
          </div>
        </div>

        {/* POS + Support type */}
        <div className="form-row form-row-2">
          <div className="form-group">
            <label className="form-label" htmlFor="ct-pos">POS System</label>
            <input
              id="ct-pos"
              className="form-input"
              {...field('pos')}
              placeholder="e.g. Tally, GoFrugal"
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ct-support-type">Support Type</label>
            <select id="ct-support-type" className="form-input" {...field('supportType')}>
              {SUPPORT_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Concern */}
        <div className="form-group">
          <label className="form-label" htmlFor="ct-concern">
            Concern <span className="required">*</span>
          </label>
          <input
            id="ct-concern"
            className={`form-input ${errors.concern ? 'form-input-error' : ''}`}
            {...field('concern')}
            placeholder="Describe the issue"
          />
          {errors.concern && <span className="form-error">{errors.concern}</span>}
        </div>

        {/* Remark */}
        <div className="form-group">
          <label className="form-label" htmlFor="ct-remark">Remark</label>
          <textarea
            id="ct-remark"
            className="form-input form-textarea"
            {...field('remark')}
            rows={3}
            placeholder="Optional initial remark"
          />
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            id="create-ticket-submit-btn"
            disabled={busy}
          >
            {busy ? 'Creating…' : 'Create Ticket'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
