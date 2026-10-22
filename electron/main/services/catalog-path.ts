import { existsSync } from 'node:fs';
import path from 'node:path';
import { CATALOG_MEDIA_PREFIX } from '../../../shared/valorant-catalog';

const escapesRoot = (relative: string): boolean =>
  relative === '..' ||
  relative.startsWith(`..${path.sep}`) ||
  path.isAbsolute(relative);

/** Only card-icons under the catalog root may be served. */
export const resolveCatalogMediaFile = (
  catalogRoot: string,
  requestPath: string,
): string | null => {
  let decoded = requestPath.replace(/^\/+/, '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  const prefix = `${CATALOG_MEDIA_PREFIX}/`;
  if (!decoded.startsWith(prefix) || decoded.includes('\0')) return null;
  const relative = decoded.slice(prefix.length).replace(/\\/g, '/');
  if (!relative.startsWith('card-icons/') || relative.includes('..')) return null;
  const root = path.resolve(catalogRoot);
  const absolute = path.resolve(root, ...relative.split('/'));
  const fromRoot = path.relative(root, absolute);
  if (escapesRoot(fromRoot)) return null;
  if (!existsSync(absolute)) return null;
  return absolute;
};

export const catalogRootFromApp = (
  appPath: string,
  resourcesPath: string,
  packaged: boolean,
): string =>
  packaged
    ? path.join(resourcesPath, 'resources', 'valorant-catalog')
    : path.join(appPath, 'resources', 'valorant-catalog');
