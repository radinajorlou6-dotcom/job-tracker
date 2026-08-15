import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from '../api';
import { useAppData } from '../App';
import {
  Drawer,
  EmptyState,
  Field,
  Modal,
  Skeleton,
  Spinner,
  StatusBadge,
  TagInput,
  formatDate,
  formatRelative,
  formatValue,
  useToast,
} from '../ui';

const STATUSES = ['Applied', 'Interviewing', 'Offered', 'Rejected'];

const EVENT_LABELS = {
  created: 'Added to tracker',
  status: 'Status changed',
  upstream_accepted: 'Pulled in upstream update',
  upstream_dismissed: 'Dismissed upstream update',
};

/* ---- Add application ----------------------------------------------------- */

function AddApplicationModal({ onClose, onCreated }) {
  const api = useApi();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    company: '',
    role: '',
    status: 'Applied',
    url: '',
    category: '',
    salary: '',
    notes: '',
    dateApplied: new Date().toISOString().slice(0, 10),
  });
  const [locations, setLocations] = useState([]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (!form.company.trim() && !form.role.trim()) {
      toast.error('Add at least a company or a role');
      return;
    }
    setSaving(true);
    try {
      const created = await api.createApplication({ ...form, locations });
      toast.success(`Added ${created.role || created.company}`);
      onCreated(created);
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Add an application"
      subtitle="For anything you applied to outside the listings feed."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving && <Spinner />} Add application
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="stack">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Company">
            <input className="input" value={form.company} onChange={set('company')} autoFocus />
          </Field>
          <Field label="Role">
            <input className="input" value={form.role} onChange={set('role')} />
          </Field>
          <Field label="Status">
            <select className="select" value={form.status} onChange={set('status')}>
              {STATUSES.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </Field>
          <Field label="Date applied">
            <input
              type="date"
              className="input"
              value={form.dateApplied}
              onChange={set('dateApplied')}
            />
          </Field>
        </div>
        <Field label="Posting link">
          <input
            className="input"
            value={form.url}
            onChange={set('url')}
            placeholder="https://…"
          />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Category">
            <input
              className="input"
              value={form.category}
              onChange={set('category')}
              placeholder="Software"
            />
          </Field>
          <Field label="Salary">
            <input
              className="input"
              value={form.salary}
              onChange={set('salary')}
              placeholder="$45/hr"
            />
          </Field>
        </div>
        <Field label="Locations" hint="Press Enter after each one.">
          <TagInput value={locations} onChange={setLocations} placeholder="San Francisco, CA" />
        </Field>
        <Field label="Notes">
          <textarea
            className="textarea"
            value={form.notes}
            onChange={set('notes')}
            placeholder="Referral from…, recruiter contact, follow-up date"
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* ---- Upstream diff ------------------------------------------------------- */

function DiffModal({ application, changes, onClose, onAccept, onDismiss, busy }) {
  return (
    <Modal
      title="This posting changed upstream"
      subtitle={`${application.role || 'Role'} at ${application.company || 'company'} — your saved record is unchanged until you decide.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onDismiss} disabled={busy}>
            Keep my version
          </button>
          <button className="btn btn-primary" onClick={onAccept} disabled={busy}>
            {busy && <Spinner />} Pull in the update
          </button>
        </>
      }
    >
      {changes.length === 0 ? (
        <p className="muted">The listing was re-published but nothing you track actually changed.</p>
      ) : (
        <div className="diff-list">
          {changes.map((change) => (
            <div key={change.field} className="diff-item">
              <div className="diff-field">{change.label}</div>
              <div className="diff-values">
                <div className="diff-side diff-before">
                  <span className="diff-label">Your record</span>
                  {formatValue(change.before)}
                </div>
                <div className="diff-side diff-after">
                  <span className="diff-label">Upstream now</span>
                  {formatValue(change.after)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ---- Detail drawer ------------------------------------------------------- */

function ApplicationDrawer({ applicationId, onClose, onChanged, onDeleted, onOpenDiff }) {
  const api = useApi();
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getApplication(applicationId);
      setDetail(data);
      setDraft({
        status: data.status,
        company: data.company ?? '',
        role: data.role ?? '',
        url: data.url ?? '',
        salary: data.salary ?? '',
        notes: data.notes ?? '',
        dateApplied: data.dateApplied ? new Date(data.dateApplied).toISOString().slice(0, 10) : '',
      });
    } catch (error) {
      toast.error(error.message);
      onClose();
    } finally {
      setLoading(false);
    }
  }, [api, applicationId, onClose, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!detail || !draft) return false;
    return (
      draft.status !== detail.status ||
      draft.company !== (detail.company ?? '') ||
      draft.role !== (detail.role ?? '') ||
      draft.url !== (detail.url ?? '') ||
      draft.salary !== (detail.salary ?? '') ||
      draft.notes !== (detail.notes ?? '') ||
      draft.dateApplied !==
        (detail.dateApplied ? new Date(detail.dateApplied).toISOString().slice(0, 10) : '')
    );
  }, [detail, draft]);

  async function save() {
    setSaving(true);
    try {
      const updated = await api.updateApplication(applicationId, {
        ...draft,
        dateApplied: draft.dateApplied || null,
      });
      toast.success('Saved');
      onChanged(updated);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this application? This cannot be undone.')) return;
    try {
      await api.deleteApplication(applicationId);
      toast.success('Application deleted');
      onDeleted(applicationId);
      onClose();
    } catch (error) {
      toast.error(error.message);
    }
  }

  const set = (key) => (event) => setDraft((d) => ({ ...d, [key]: event.target.value }));

  return (
    <Drawer onClose={onClose}>
      <div className="drawer-head">
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 17 }}>{detail?.role || 'Application'}</h3>
          <p className="muted small" style={{ marginTop: 2 }}>
            {detail?.company || '—'}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="drawer-body">
        {loading || !draft ? (
          <Skeleton rows={4} />
        ) : (
          <>
            {detail.hasUpstreamChange && (
              <div className="banner alert" style={{ marginBottom: 0 }}>
                <span>⚠️</span>
                <div className="grow">
                  <strong>This posting changed upstream.</strong>
                  <div className="small" style={{ marginTop: 2 }}>
                    Your record stays as-is until you review the difference.
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => onOpenDiff(detail)}>
                  Review
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Status">
                <select className="select" value={draft.status} onChange={set('status')}>
                  {STATUSES.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </Field>
              <Field label="Date applied">
                <input
                  type="date"
                  className="input"
                  value={draft.dateApplied}
                  onChange={set('dateApplied')}
                />
              </Field>
              <Field label="Company">
                <input className="input" value={draft.company} onChange={set('company')} />
              </Field>
              <Field label="Role">
                <input className="input" value={draft.role} onChange={set('role')} />
              </Field>
            </div>

            <Field label="Posting link">
              <input className="input" value={draft.url} onChange={set('url')} />
            </Field>
            <Field label="Salary">
              <input className="input" value={draft.salary} onChange={set('salary')} />
            </Field>
            <Field label="Notes">
              <textarea className="textarea" value={draft.notes} onChange={set('notes')} />
            </Field>

            <div>
              <div className="panel-title" style={{ marginBottom: 10 }}>
                From the listing
              </div>
              <dl className="detail-grid">
                <dt>Locations</dt>
                <dd>{formatValue(detail.locations)}</dd>
                <dt>Category</dt>
                <dd>{formatValue(detail.category)}</dd>
                <dt>Terms</dt>
                <dd>{formatValue(detail.terms)}</dd>
                <dt>Degrees</dt>
                <dd>{formatValue(detail.degrees)}</dd>
                <dt>Sponsorship</dt>
                <dd>{formatValue(detail.sponsorship)}</dd>
                <dt>Posted</dt>
                <dd>{formatDate(detail.datePosted)}</dd>
                <dt>Source</dt>
                <dd>
                  {detail.listingId ? 'Imported from feed' : 'Added manually'}
                  {detail.listingActive === false && ' · no longer active upstream'}
                </dd>
                {detail.url && (
                  <>
                    <dt>Apply link</dt>
                    <dd>
                      <a href={detail.url} target="_blank" rel="noreferrer">
                        Open posting ↗
                      </a>
                    </dd>
                  </>
                )}
              </dl>
            </div>

            <div>
              <div className="panel-title" style={{ marginBottom: 12 }}>
                History
              </div>
              <div className="timeline">
                {detail.events.map((event) => (
                  <div key={event.id} className="timeline-item">
                    <div className="timeline-dot" />
                    <div className="timeline-content">
                      <div>
                        {EVENT_LABELS[event.type] ?? event.type}
                        {event.fromStatus && event.toStatus && (
                          <>
                            {': '}
                            <strong>{event.fromStatus}</strong> → <strong>{event.toStatus}</strong>
                          </>
                        )}
                      </div>
                      {event.detail && <div className="muted small">{event.detail}</div>}
                      <div className="timeline-time">
                        {formatDate(event.createdAt)} · {formatRelative(event.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="drawer-foot">
        <button className="btn btn-danger btn-sm" onClick={remove}>
          Delete
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
          {saving && <Spinner />} {dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
    </Drawer>
  );
}

/* ---- Page ---------------------------------------------------------------- */

export default function TrackerPage() {
  const api = useApi();
  const toast = useToast();
  const { pendingUpdates, refreshPending } = useAppData();

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sort, setSort] = useState('recent');
  const [showAdd, setShowAdd] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [diffFor, setDiffFor] = useState(null);
  const [diffChanges, setDiffChanges] = useState([]);
  const [diffBusy, setDiffBusy] = useState(false);

  // The whole list is fetched once and filtered in the browser, so the stat
  // strip and the per-status counts always describe every application rather
  // than whatever subset is currently on screen.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setApplications(await api.listApplications({ sort }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [api, sort, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return applications.filter((application) => {
      if (statusFilter !== 'All' && application.status !== statusFilter) return false;
      if (!query) return true;
      return [application.company, application.role, application.notes]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query));
    });
  }, [applications, statusFilter, search]);

  const totals = useMemo(() => {
    const count = (status) => applications.filter((a) => a.status === status).length;
    const total = applications.length;
    const responded = total - count('Applied');
    return {
      total,
      responded,
      interviewing: count('Interviewing'),
      offered: count('Offered'),
      rejected: count('Rejected'),
      responseRate: total > 0 ? Math.round((responded / total) * 100) : 0,
    };
  }, [applications]);

  async function changeStatus(application, status) {
    const previous = applications;
    setApplications((current) =>
      current.map((a) => (a.id === application.id ? { ...a, status } : a)),
    );
    try {
      await api.updateApplication(application.id, { status });
    } catch (error) {
      setApplications(previous);
      toast.error(error.message);
    }
  }

  async function openDiff(application) {
    try {
      const upstream = await api.getUpstream(application.id);
      setDiffChanges(upstream.changes ?? []);
      setDiffFor(application);
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function resolveDiff(action) {
    setDiffBusy(true);
    try {
      if (action === 'accept') {
        await api.acceptUpstream(diffFor.id);
        toast.success('Your record now matches the current posting');
      } else {
        await api.dismissUpstream(diffFor.id);
        toast.notify('Kept your version — we will tell you if it changes again');
      }
      setDiffFor(null);
      await Promise.all([load(), refreshPending()]);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDiffBusy(false);
    }
  }

  const filterCounts = useMemo(() => {
    const map = { All: applications.length };
    for (const status of STATUSES) {
      map[status] = applications.filter((a) => a.status === status).length;
    }
    return map;
  }, [applications]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Your tracker</h1>
          <p className="subtitle">
            Everything you have applied to, hand-added or imported — with the same fields either
            way.
          </p>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + Add application
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label">Applications</div>
          <div className="stat-value">{totals.total}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Interviewing</div>
          <div className="stat-value">{totals.interviewing}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Offers</div>
          <div className="stat-value">{totals.offered}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Response rate</div>
          <div className="stat-value">{totals.responseRate}%</div>
          <div className="stat-note">
            Heard back on {totals.responded} of {totals.total}
          </div>
        </div>
      </div>

      {pendingUpdates.length > 0 && (
        <div className="banner alert">
          <span>⚠️</span>
          <div className="grow">
            <strong>
              {pendingUpdates.length} posting{pendingUpdates.length === 1 ? '' : 's'} you applied to
              changed upstream.
            </strong>
            <div className="small" style={{ marginTop: 2 }}>
              {pendingUpdates
                .slice(0, 3)
                .map((update) => `${update.role || 'Role'} at ${update.company || '—'}`)
                .join(' · ')}
              {pendingUpdates.length > 3 && ` and ${pendingUpdates.length - 3} more`}
            </div>
          </div>
          <button
            className="btn btn-sm"
            onClick={() => {
              const first = applications.find((a) => a.id === pendingUpdates[0].applicationId);
              if (first) openDiff(first);
            }}
          >
            Review first
          </button>
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <span className="search-icon">⌕</span>
          <input
            className="input"
            placeholder="Search company, role or notes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="segmented">
          {['All', ...STATUSES].map((status) => (
            <button
              key={status}
              className={statusFilter === status ? 'active' : ''}
              onClick={() => setStatusFilter(status)}
            >
              {status}
              {filterCounts[status] > 0 && ` (${filterCounts[status]})`}
            </button>
          ))}
        </div>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">Most recent</option>
          <option value="company">Company A–Z</option>
          <option value="status">By status</option>
        </select>
      </div>

      {loading ? (
        <Skeleton rows={6} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📋"
          title={
            applications.length > 0 ? 'Nothing matches those filters' : 'No applications yet'
          }
          action={
            applications.length > 0 ? (
              <button
                className="btn"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('All');
                }}
              >
                Clear filters
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
                Add your first application
              </button>
            )
          }
        >
          {applications.length > 0
            ? 'Try clearing the search or switching back to All.'
            : 'Browse the Listings tab to one-click apply, or add something you applied to elsewhere.'}
        </EmptyState>
      ) : (
        <div className="row-list">
          {visible.map((application) => (
            <div
              key={application.id}
              className={`app-row ${openId === application.id ? 'is-selected' : ''}`}
              onClick={() => setOpenId(application.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setOpenId(application.id)}
            >
              <div className="app-main">
                <div className="app-title">
                  <span className="truncate">{application.role || 'Untitled role'}</span>
                  <span className="app-company">· {application.company || '—'}</span>
                  {application.hasUpstreamChange && (
                    <button
                      className="badge badge-alert"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDiff(application);
                      }}
                      style={{ border: 0, cursor: 'pointer' }}
                      title="This posting changed upstream"
                    >
                      updated ↗
                    </button>
                  )}
                  {application.listingId && <span className="badge">imported</span>}
                </div>
                <div className="app-meta">
                  <span>Applied {formatDate(application.dateApplied)}</span>
                  {application.locations?.length > 0 && (
                    <span className="truncate" style={{ maxWidth: 260 }}>
                      {application.locations.slice(0, 2).join(' · ')}
                    </span>
                  )}
                  {application.category && <span>{application.category}</span>}
                </div>
              </div>

              <div className="app-actions" onClick={(e) => e.stopPropagation()}>
                <StatusBadge status={application.status} />
                <select
                  className="select btn-sm"
                  value={application.status}
                  onChange={(e) => changeStatus(application, e.target.value)}
                  aria-label={`Status for ${application.role}`}
                >
                  {STATUSES.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
                {application.url && (
                  <a
                    className="btn btn-ghost btn-sm"
                    href={application.url}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the original posting"
                  >
                    ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddApplicationModal
          onClose={() => setShowAdd(false)}
          onCreated={() => load()}
        />
      )}

      {openId && (
        <ApplicationDrawer
          applicationId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => load()}
          onDeleted={() => load()}
          onOpenDiff={(detail) => openDiff(detail)}
        />
      )}

      {diffFor && (
        <DiffModal
          application={diffFor}
          changes={diffChanges}
          busy={diffBusy}
          onClose={() => setDiffFor(null)}
          onAccept={() => resolveDiff('accept')}
          onDismiss={() => resolveDiff('dismiss')}
        />
      )}
    </main>
  );
}
