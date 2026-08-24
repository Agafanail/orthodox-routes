import { externalPlaceLinks, externalRouteLinks, type ExternalMapTarget } from '@/lib/geo/external-maps';

/**
 * Outbound links to another maps application.
 *
 * Rendered only where opening a place or building a route elsewhere is genuinely useful. These
 * are plain links: no external map, search, or routing interface is embedded, and nothing about
 * the person is sent along beyond the coordinate they are already looking at.
 */
export function ExternalMapLinks({
  mode,
  target,
  title = 'Открыть в другом приложении',
}: {
  mode: 'place' | 'route';
  target: ExternalMapTarget;
  title?: string;
}) {
  const links = mode === 'route' ? externalRouteLinks(target) : externalPlaceLinks(target);

  return (
    <nav className="mt-3 grid gap-2" data-external-maps={mode}>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={link.id}>
            <a
              className="inline-flex min-h-11 items-center rounded-lg border border-stone-400 px-4 py-1 text-sm font-semibold"
              data-external-map={link.id}
              href={link.href}
              rel="noreferrer noopener"
              target="_blank"
            >
              {link.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
