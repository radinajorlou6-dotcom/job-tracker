import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api';
import {
  EmptyState,
  Field,
  MatchScore,
  Skeleton,
  Spinner,
  formatDate,
  formatRelative,
  useDebounced,
  useToast,
} from '../ui';

const SORTS = [
  { value: 'match', label: 'Best match' },
  { value: 'recent', label: 'Newest' },
  { value: 'company', label: 'Company A–Z' },
];

function ListingCard({ listing, onApply, applying }) {
  const match = listing.match;
  return (
    <article className={`listing-card ${listing.applied ? 'is-applied' : ''}`}>
      <MatchScore match={match} />

      <div className="listing-body">
        <div className="listing-role">{listing.role || 'Untitled role'}</div>
        <div className="listing-company">{listing.company || 'Unknown company'}</div>

        <div className="listing-meta">
          {listing.locations?.slice(0, 3).map((location) => (
            <span key={location} className="tag">
              📍 {location}
            </span>
          ))}
          {listing.locations?.length > 3 && (
            <span className="tag">+{listing.locations.length - 3} more</span>
          )}
          {listing.category && <span className="tag">{listing.category}</span>}
          {listing.terms?.slice(0, 2).map((term) => (
            <span key={term} className="tag">
              {term}
            </span>
          ))}
          {listing.sponsorship && listing.sponsorship !== 'Other' && (
            <span className="tag">{listing.sponsorship}</span>
          )}
        </div>

        {match?.summary && (
          <div className="match-summary">
            {match.summary}
            {(match.reasons?.length > 0 || match.concerns?.length > 0) && (
              <div className="match-points">
                {match.reasons?.slice(0, 2).map((reason) => (
                  <div key={reason} className="match-point pro">
                    <span className="mark">+</span>
                    <span>{reason}</span>
                  </div>
                ))}
                {match.concerns?.slice(0, 2).map((concern) => (
                  <div key={concern} className="match-point con">
                    <span className="mark">−</span>
                    <span>{concern}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="listing-side">
        <span className="small faint" title={formatDate(listing.datePosted)}>
          {listing.datePosted ? formatRelative(listing.datePosted) : '—'}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {listing.url && (
            <a
              className="btn btn-sm"
              href={listing.url}
              target="_blank"
              rel="noreferrer"
              title="Open the original posting"
            >
              View ↗
            </a>
          )}
          {listing.applied ? (
            <span className="badge badge-success">✓ in tracker</span>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => onApply(listing)}
              disabled={applying}
            >
              {applying ? <Spinner /> : '+'} Apply
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function FeedPage() {
  const api = useApi();
  const toast = useToast();

  const [data, setData] = useState({ items: [], total: 0, page: 1, totalPages: 1 });
  const [facets, setFacets] = useState({ categories: [], terms: [], degrees: [], locations: [] });
  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('match');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    feed: '',
    category: '',
    term: '',
    degree: '',
    sponsorship: '',
    postedWithinDays: '',
    minScore: '',
    includeInactive: 'false',
  });

  const debouncedSearch = useDebounced(search);

  useEffect(() => {
    Promise.all([api.getFacets(), api.getFeeds()])
      .then(([facetData, feedData]) => {
        setFacets(facetData);
        setFeeds(feedData);
      })
      .catch(() => {
        /* filters just stay empty if this fails */
      });
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await api.listListings({
          q: debouncedSearch,
          sort,
          page,
          pageSize: 20,
          ...filters,
          minScore: sort === 'match' ? filters.minScore : '',
        }),
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [api, debouncedSearch, sort, page, filters, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Any filter change invalidates the current page number.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, sort, filters]);

  const setFilter = (key) => (event) =>
    setFilters((current) => ({ ...current, [key]: event.target.value }));

  async function apply(listing) {
    setApplyingId(listing.id);
    try {
      await api.applyToListing(listing.id);
      toast.success(`${listing.role || 'Listing'} added to your tracker`);
      setData((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === listing.id ? { ...item, applied: true } : item,
        ),
      }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setApplyingId(null);
    }
  }

  async function refreshFeeds() {
    setImporting(true);
    toast.notify('Pulling the latest listings — this can take a minute.');
    try {
      const result = await api.importListings();
      const created = result.results.reduce((sum, r) => sum + (r.created ?? 0), 0);
      const updated = result.results.reduce((sum, r) => sum + (r.updated ?? 0), 0);
      toast.success(`Feeds refreshed: ${created} new, ${updated} changed`);
      await load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setImporting(false);
    }
  }

  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => value !== '' && !(key === 'includeInactive' && value === 'false'),
  ).length;

  const scoredCount = data.items.filter((item) => item.match).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Listings</h1>
          <p className="subtitle">
            {data.total.toLocaleString()} live postings from the SimplifyJobs feeds, scored against
            your preferences.
          </p>
        </div>
        <div className="page-head-actions">
          <button className="btn" onClick={refreshFeeds} disabled={importing}>
            {importing ? <Spinner /> : '↻'} Refresh feeds
          </button>
        </div>
      </div>

      {!loading && data.items.length > 0 && scoredCount === 0 && (
        <div className="banner info">
          <span>✨</span>
          <div className="grow">
            <strong>These listings have not been scored yet.</strong>
            <div className="small" style={{ marginTop: 2 }}>
              Set your preferences and run a match to sort thousands of postings by how well they
              actually fit you.
            </div>
          </div>
          <Link className="btn btn-sm btn-primary" to="/preferences">
            Set preferences
          </Link>
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <span className="search-icon">⌕</span>
          <input
            className="input"
            placeholder="Search role, company or category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="segmented">
          {SORTS.map((option) => (
            <button
              key={option.value}
              className={sort === option.value ? 'active' : ''}
              onClick={() => setSort(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => setShowFilters((v) => !v)}>
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="filter-drawer">
          <Field label="Feed">
            <select className="select" value={filters.feed} onChange={setFilter('feed')}>
              <option value="">All feeds</option>
              {feeds.map((feed) => (
                <option key={feed.key} value={feed.key}>
                  {feed.label} ({feed.activeCount})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select className="select" value={filters.category} onChange={setFilter('category')}>
              <option value="">Any category</option>
              {facets.categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </Field>
          <Field label="Term">
            <select className="select" value={filters.term} onChange={setFilter('term')}>
              <option value="">Any term</option>
              {facets.terms.map((term) => (
                <option key={term}>{term}</option>
              ))}
            </select>
          </Field>
          <Field label="Degree">
            <select className="select" value={filters.degree} onChange={setFilter('degree')}>
              <option value="">Any degree</option>
              {facets.degrees.map((degree) => (
                <option key={degree}>{degree}</option>
              ))}
            </select>
          </Field>
          <Field label="Sponsorship">
            <select
              className="select"
              value={filters.sponsorship}
              onChange={setFilter('sponsorship')}
            >
              <option value="">Any</option>
              <option value="offered">Offers sponsorship</option>
              <option value="no-citizenship">No citizenship requirement</option>
            </select>
          </Field>
          <Field label="Posted within">
            <select
              className="select"
              value={filters.postedWithinDays}
              onChange={setFilter('postedWithinDays')}
            >
              <option value="">Any time</option>
              <option value="3">Last 3 days</option>
              <option value="7">Last week</option>
              <option value="30">Last month</option>
            </select>
          </Field>
          {sort === 'match' && (
            <Field label="Minimum match score">
              <select className="select" value={filters.minScore} onChange={setFilter('minScore')}>
                <option value="">Any score</option>
                <option value="80">Strong only (80+)</option>
                <option value="65">Good and up (65+)</option>
                <option value="45">Stretch and up (45+)</option>
              </select>
            </Field>
          )}
          <Field label="Inactive listings">
            <select
              className="select"
              value={filters.includeInactive}
              onChange={setFilter('includeInactive')}
            >
              <option value="false">Hide inactive</option>
              <option value="true">Show everything</option>
            </select>
          </Field>
        </div>
      )}

      {loading ? (
        <Skeleton rows={6} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon="🔍"
          title={sort === 'match' ? 'No scored listings match those filters' : 'No listings match'}
          action={
            sort === 'match' ? (
              <Link className="btn btn-primary" to="/preferences">
                Run a match
              </Link>
            ) : null
          }
        >
          {sort === 'match'
            ? 'Sorting by match only shows listings that have been scored. Run a match from Preferences, or switch to Newest.'
            : 'Try widening your filters or clearing the search.'}
        </EmptyState>
      ) : (
        <>
          <div className="listing-grid">
            {data.items.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onApply={apply}
                applying={applyingId === listing.id}
              />
            ))}
          </div>

          <div className="pagination">
            <button
              className="btn btn-sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              ← Previous
            </button>
            <span>
              Page {data.page} of {data.totalPages.toLocaleString()} ·{' '}
              {data.total.toLocaleString()} listings
            </span>
            <button
              className="btn btn-sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= data.totalPages}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </main>
  );
}
