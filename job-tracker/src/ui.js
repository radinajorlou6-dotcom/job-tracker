import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/* ---- Toasts -------------------------------------------------------------- */

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, tone = 'info') => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, tone }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4200);
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      notify: (message) => push(message, 'info'),
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            <span className="grow">{toast.message}</span>
            <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}

/* ---- Formatting ---------------------------------------------------------- */

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatRelative(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/* ---- Small display components -------------------------------------------- */

export function StatusBadge({ status }) {
  return <span className={`badge badge-${(status || '').toLowerCase()}`}>{status}</span>;
}

export function MatchScore({ match }) {
  if (!match) {
    return (
      <span className="score score-none" title="Not scored yet — run a match from Preferences">
        ?
      </span>
    );
  }
  return (
    <span
      className={`score score-${match.verdict || 'weak'}`}
      title={`${match.verdict} match · scored by ${match.engine}`}
    >
      {match.score}
      <small>{match.verdict}</small>
    </span>
  );
}

export function EmptyState({ icon, title, children, action }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 5 }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/* ---- Overlays ------------------------------------------------------------ */

function useEscapeKey(onClose) {
  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
}

export function Modal({ title, subtitle, onClose, children, footer }) {
  useEscapeKey(onClose);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div className="row-between">
            <h3 style={{ fontSize: 17 }}>{title}</h3>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          {subtitle && (
            <p className="muted small" style={{ marginTop: 4 }}>
              {subtitle}
            </p>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ onClose, children }) {
  useEscapeKey(onClose);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        {children}
      </aside>
    </>
  );
}

/* ---- Inputs -------------------------------------------------------------- */

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/**
 * Comma/Enter-separated tag entry. Used for roles, locations, and excluded
 * companies, where a free-form list beats a fixed dropdown.
 */
export function TagInput({ value, onChange, placeholder, suggestions = [] }) {
  const [draft, setDraft] = useState('');

  const add = (raw) => {
    const next = raw.trim();
    if (!next) return;
    if (!value.some((v) => v.toLowerCase() === next.toLowerCase())) {
      onChange([...value, next]);
    }
    setDraft('');
  };

  const remove = (tag) => onChange(value.filter((v) => v !== tag));

  const available = suggestions
    .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
    .slice(0, 6);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <input
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            remove(value[value.length - 1]);
          }
        }}
        onBlur={() => add(draft)}
      />
      {value.length > 0 && (
        <div className="tag-row">
          {value.map((tag) => (
            <span key={tag} className="tag tag-removable">
              {tag}
              <button
                type="button"
                className="tag-remove"
                onClick={() => remove(tag)}
                aria-label={`Remove ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div className="tag-row">
          {available.map((suggestion) => (
            <button key={suggestion} type="button" className="tag" onClick={() => add(suggestion)}>
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Multi-select rendered as toggle chips — better than a native multi-select. */
export function ChipSelect({ options, value, onChange, max }) {
  const shown = max ? options.slice(0, max) : options;
  const toggle = (option) => {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  };
  return (
    <div className="tag-row">
      {shown.map((option) => (
        <button
          key={option}
          type="button"
          className={`tag ${value.includes(option) ? 'tag-removable' : ''}`}
          onClick={() => toggle(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** Debounces a rapidly-changing value (search boxes) before it hits the API. */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
