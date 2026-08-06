import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { PAGES } from './pages/registry';

/**
 * The harness shell: a panel of every published surface, one page each.
 *
 * Routing is the hash, not react-router. A router would be a dependency the
 * harness carries but none of the packages under test require, and every
 * dependency here is one more thing that can explain a failure that is supposed
 * to be about OUR packages. `location.hash` needs nothing.
 */
function useHashSlug(fallback: string) {
  const read = () => window.location.hash.replace(/^#\/?/, '') || fallback;
  const [slug, setSlug] = useState(read);
  useEffect(() => {
    const onChange = () => setSlug(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  });
  return slug;
}

function Shell() {
  const slug = useHashSlug(PAGES[0].slug);
  const page = PAGES.find((candidate) => candidate.slug === slug);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <nav
        data-testid="harness-nav"
        style={{ width: 260, flexShrink: 0, borderRight: '1px solid #ddd', padding: 16 }}
      >
        <h1 style={{ fontSize: 14, textTransform: 'uppercase', color: '#666' }}>Published surfaces</h1>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {PAGES.map((entry) => (
            <li key={entry.slug} style={{ margin: '12px 0' }}>
              <a
                href={`#/${entry.slug}`}
                data-testid={`harness-nav-${entry.slug}`}
                aria-current={entry.slug === slug ? 'page' : undefined}
                style={{ fontWeight: entry.slug === slug ? 700 : 400 }}
              >
                {entry.title}
              </a>
              <div style={{ fontSize: 12, color: '#888' }}>{entry.pkg}</div>
            </li>
          ))}
        </ul>
      </nav>

      <main data-testid="harness-page" data-page={page?.slug ?? 'unknown'} style={{ flex: 1, padding: 24 }}>
        {/* An unknown slug is a spec pointing at a page that was renamed or
            removed. Saying so beats rendering the first page, which would let
            that spec keep passing against something it is not asking for. */}
        {page ? <page.Component /> : <p data-testid="harness-unknown-page">No harness page named “{slug}”.</p>}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Shell />);
