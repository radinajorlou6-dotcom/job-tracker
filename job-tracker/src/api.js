import { useMemo } from 'react';
import { useAuth } from '@clerk/clerk-react';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function toQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Returns an API client bound to the signed-in user's Clerk token. Every method
 * throws ApiError on a non-2xx response so callers can surface the server's
 * own message instead of a generic failure.
 */
export function useApi() {
  const { getToken } = useAuth();

  return useMemo(() => {
    async function request(path, { method = 'GET', body, params } = {}) {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const response = await fetch(`${BASE}${path}${toQuery(params)}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (response.status === 204) return null;

      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { error: text };
        }
      }

      if (!response.ok) {
        throw new ApiError(payload?.error || `Request failed (${response.status})`, response.status);
      }
      return payload;
    }

    return {
      // Applications
      listApplications: (params) => request('/applications', { params }),
      getApplication: (id) => request(`/applications/${id}`),
      createApplication: (body) => request('/applications', { method: 'POST', body }),
      applyToListing: (listingId, body) =>
        request(`/applications/from-listing/${listingId}`, { method: 'POST', body: body ?? {} }),
      updateApplication: (id, body) => request(`/applications/${id}`, { method: 'PATCH', body }),
      deleteApplication: (id) => request(`/applications/${id}`, { method: 'DELETE' }),
      getAnalytics: (params) => request('/applications/analytics', { params }),
      getPendingUpdates: () => request('/applications/updates'),
      getUpstream: (id) => request(`/applications/${id}/upstream`),
      acceptUpstream: (id) => request(`/applications/${id}/upstream/accept`, { method: 'POST' }),
      dismissUpstream: (id) => request(`/applications/${id}/upstream/dismiss`, { method: 'POST' }),

      // Listings
      listListings: (params) => request('/listings', { params }),
      getListing: (id) => request(`/listings/${id}`),
      getFacets: () => request('/listings/facets'),
      getFeeds: () => request('/listings/feeds'),
      importListings: () => request('/listings/import', { method: 'POST' }),

      // Preferences + matching
      getPreferences: () => request('/preferences'),
      savePreferences: (body) => request('/preferences', { method: 'PUT', body }),
      getMatchStatus: () => request('/match/status'),
      runMatching: (body) => request('/match/run', { method: 'POST', body: body ?? {} }),
    };
  }, [getToken]);
}
