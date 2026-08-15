import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { ChipSelect, Field, Skeleton, Spinner, TagInput, useToast } from '../ui';

const REMOTE_OPTIONS = [
  { value: 'any', label: 'No preference' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
];

const ROLE_SUGGESTIONS = [
  'Software Engineer',
  'Backend Engineer',
  'Frontend Engineer',
  'Full Stack',
  'Machine Learning',
  'Data Science',
  'Product Management',
  'Security',
  'Infrastructure',
];

const LOCATION_SUGGESTIONS = [
  'Remote',
  'New York, NY',
  'San Francisco, CA',
  'Seattle, WA',
  'Austin, TX',
  'Boston, MA',
  'Chicago, IL',
];

/* ---- Match runner -------------------------------------------------------- */

function MatchRunner({ dirty }) {
  const api = useApi();
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.getMatchStatus();
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, [api]);

  useEffect(() => {
    refresh();
    return () => clearInterval(pollRef.current);
  }, [refresh]);

  const running = status?.job?.status === 'running';

  // Poll only while a run is actually in flight.
  useEffect(() => {
    clearInterval(pollRef.current);
    if (!running) return undefined;

    pollRef.current = setInterval(async () => {
      const next = await refresh();
      if (next?.job?.status !== 'running') {
        clearInterval(pollRef.current);
        if (next?.job?.status === 'done') {
          toast.success(
            next.job.degraded
              ? `Scored ${next.job.scored} listings (some batches used the offline scorer)`
              : `Scored ${next.job.scored} listings`,
          );
        } else if (next?.job?.status === 'error') {
          toast.error(next.job.error || 'The match run failed');
        }
      }
    }, 1500);

    return () => clearInterval(pollRef.current);
  }, [running, refresh, toast]);

  async function run(rescoreAll) {
    setStarting(true);
    try {
      await api.runMatching({ limit: 150, rescoreAll });
      toast.notify('Match run started — scores appear in the Listings tab as they land.');
      await refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setStarting(false);
    }
  }

  const coverage = status?.coverage;
  const job = status?.job;
  const progress = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <div className="panel">
      <div className="panel-title">Match your listings</div>
      <p className="panel-sub">
        {status?.engine?.ai
          ? `Scoring runs on Claude (${status.engine.model}), with a deterministic scorer as backup if a batch fails.`
          : 'No ANTHROPIC_API_KEY is set, so scoring uses the built-in deterministic scorer. Add a key to the backend .env to switch on Claude.'}
      </p>

      {coverage && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat">
            <div className="stat-label">Scored</div>
            <div className="stat-value">{coverage.scored.toLocaleString()}</div>
            <div className="stat-note">against your current preferences</div>
          </div>
          <div className="stat">
            <div className="stat-label">Stale</div>
            <div className="stat-value">{coverage.stale.toLocaleString()}</div>
            <div className="stat-note">scored before you last edited preferences</div>
          </div>
          <div className="stat">
            <div className="stat-label">Unscored</div>
            <div className="stat-value">{coverage.unscored.toLocaleString()}</div>
            <div className="stat-note">of {coverage.totalActive.toLocaleString()} active</div>
          </div>
        </div>
      )}

      {running && (
        <div className="stack" style={{ gap: 8, marginBottom: 16 }}>
          <div className="row-between small muted">
            <span>
              Scoring {job.done} of {job.total || '…'} · {job.engine}
            </span>
            <span>{job.total > 0 ? `${progress}%` : ''}</span>
          </div>
          <div className="progress-track">
            <div
              className={`progress-fill ${job.total === 0 ? 'indeterminate' : ''}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {dirty && (
        <div className="banner info" style={{ marginBottom: 16 }}>
          <span>💾</span>
          <div className="grow">Save your preferences first — a run uses the saved version.</div>
        </div>
      )}

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={() => run(false)}
          disabled={running || starting || dirty}
        >
          {(running || starting) && <Spinner />}
          {running ? 'Scoring…' : 'Score new & stale listings'}
        </button>
        <button className="btn" onClick={() => run(true)} disabled={running || starting || dirty}>
          Re-score everything
        </button>
        <Link className="btn btn-ghost" to="/feed">
          View scored listings →
        </Link>
      </div>

      <p className="small faint" style={{ marginTop: 12 }}>
        Each run scores up to 150 listings, newest first. Run it again to work further down the
        backlog.
      </p>
    </div>
  );
}

/* ---- Page ---------------------------------------------------------------- */

const EMPTY = {
  headline: '',
  desiredRoles: [],
  preferredLocations: [],
  remotePreference: 'any',
  terms: [],
  degrees: [],
  categories: [],
  needsSponsorship: false,
  excludedCompanies: [],
  mustHaves: '',
  dealBreakers: '',
  values: '',
};

export default function PreferencesPage() {
  const api = useApi();
  const toast = useToast();

  const [form, setForm] = useState(EMPTY);
  const [saved, setSaved] = useState(EMPTY);
  const [facets, setFacets] = useState({ categories: [], terms: [], degrees: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.getPreferences(), api.getFacets()])
      .then(([prefsData, facetData]) => {
        const { exists, updatedAt, ...values } = prefsData.preferences;
        setForm({ ...EMPTY, ...values });
        setSaved({ ...EMPTY, ...values });
        setFacets(facetData);
      })
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));
  }, [api, toast]);

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  const setEvent = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save() {
    setSaving(true);
    try {
      const result = await api.savePreferences(form);
      const { exists, updatedAt, ...values } = result.preferences;
      setForm({ ...EMPTY, ...values });
      setSaved({ ...EMPTY, ...values });
      toast.success(
        result.staleMatches > 0
          ? `Preferences saved — ${result.staleMatches.toLocaleString()} existing scores are now stale`
          : 'Preferences saved',
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="page">
        <Skeleton rows={8} />
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Preferences</h1>
          <p className="subtitle">
            The more specific you are here, the more useful the match scores get. Everything is
            optional.
          </p>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving && <Spinner />} {dirty ? 'Save preferences' : 'Saved'}
          </button>
        </div>
      </div>

      <div className="stack" style={{ gap: 16 }}>
        <MatchRunner dirty={dirty} />

        <div className="panel">
          <div className="panel-title">About you</div>
          <p className="panel-sub">A short description gives the model context the fields cannot.</p>
          <Field
            label="Summary"
            hint="e.g. Third-year CS student focused on backend and distributed systems, graduating May 2027."
          >
            <textarea
              className="textarea"
              value={form.headline}
              onChange={setEvent('headline')}
              placeholder="Who you are and what you're looking for"
            />
          </Field>
        </div>

        <div className="panel">
          <div className="panel-title">What you want</div>
          <p className="panel-sub">Used for the bulk of the score.</p>
          <div className="stack" style={{ gap: 18 }}>
            <Field label="Target roles" hint="Press Enter after each. Matched against role titles.">
              <TagInput
                value={form.desiredRoles}
                onChange={set('desiredRoles')}
                placeholder="Software Engineer"
                suggestions={ROLE_SUGGESTIONS}
              />
            </Field>

            <Field label="Preferred locations">
              <TagInput
                value={form.preferredLocations}
                onChange={set('preferredLocations')}
                placeholder="New York, NY"
                suggestions={LOCATION_SUGGESTIONS}
              />
            </Field>

            <Field label="Work arrangement">
              <select
                className="select"
                value={form.remotePreference}
                onChange={setEvent('remotePreference')}
                style={{ maxWidth: 240 }}
              >
                {REMOTE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            {facets.categories.length > 0 && (
              <Field label="Categories" hint="Leave empty to consider every category.">
                <ChipSelect
                  options={facets.categories}
                  value={form.categories}
                  onChange={set('categories')}
                />
              </Field>
            )}

            {facets.terms.length > 0 && (
              <Field label="Terms" hint="Which start dates work for you.">
                <ChipSelect
                  options={facets.terms.filter((t) => !t.includes('2024'))}
                  value={form.terms}
                  onChange={set('terms')}
                />
              </Field>
            )}

            {facets.degrees.length > 0 && (
              <Field label="Your degree level">
                <ChipSelect
                  options={facets.degrees}
                  value={form.degrees}
                  onChange={set('degrees')}
                />
              </Field>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Requirements and deal breakers</div>
          <p className="panel-sub">
            These carry the most weight — a listing that violates one drops sharply.
          </p>
          <div className="stack" style={{ gap: 18 }}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.needsSponsorship}
                onChange={(e) => set('needsSponsorship')(e.target.checked)}
              />
              <span>
                <span className="field-label">I need visa sponsorship</span>
                <span className="field-hint" style={{ display: 'block' }}>
                  Listings requiring citizenship or explicitly not sponsoring get pushed to the
                  bottom.
                </span>
              </span>
            </label>

            <Field label="Must haves" hint="Things a listing needs for you to bother applying.">
              <textarea
                className="textarea"
                value={form.mustHaves}
                onChange={setEvent('mustHaves')}
                placeholder="Pays at least $40/hr. Team works on infrastructure or developer tooling."
              />
            </Field>

            <Field label="Deal breakers">
              <textarea
                className="textarea"
                value={form.dealBreakers}
                onChange={setEvent('dealBreakers')}
                placeholder="No defense contractors. Not willing to relocate outside the US."
              />
            </Field>

            <Field label="What you value" hint="Culture, mission, team size, learning curve.">
              <textarea
                className="textarea"
                value={form.values}
                onChange={setEvent('values')}
                placeholder="Strong mentorship, small teams, ships to real users, mission I believe in."
              />
            </Field>

            <Field label="Companies to skip">
              <TagInput
                value={form.excludedCompanies}
                onChange={set('excludedCompanies')}
                placeholder="Company name"
              />
            </Field>
          </div>
        </div>
      </div>
    </main>
  );
}
