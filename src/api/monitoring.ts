import { graphql } from './client';
import { t } from '../i18n';

/** What a component reports about itself. */
export type ComponentStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

/** Something a component needs to be up. */
export interface Dependency {
  name: string;
  description: string;
  reachable: boolean;
  /** Its own interface, for the ones that have one; null offers no link. */
  url?: string | null;
  /** What the check saw, ready to show. */
  detail: string;
}

export interface Component {
  name: string;
  description: string;
  status: ComponentStatus;
  version: string | null;
  detail: string;
  lastCheckedAt: string;
  dependencies: Dependency[];
}

const COMPONENTS_QUERY = `
  query Components {
    components {
      name
      description
      status
      version
      detail
      lastCheckedAt
      dependencies { name description reachable detail url }
    }
  }
`;

/** Each call re-checks the service, so the page shows what is true now. */
export async function fetchComponents(): Promise<Component[]> {
  const data = await graphql<{ components: Component[] }>(COMPONENTS_QUERY);
  return data.components;
}

/**
 * The browser itself. Nothing has to check it: this code running is the check,
 * and the version is the one the bundle was built at.
 */
export function uiComponent(): Component {
  return {
    name: 'orknux-ui',
    description: t('The web interface you are looking at'),
    status: 'HEALTHY',
    version: __APP_VERSION__,
    detail: 'Loaded',
    lastCheckedAt: new Date().toISOString(),
    dependencies: [],
  };
}
