import type { AuthConfig } from 'convex/server';

import { getConvexAuthConfig } from '../lib/server/convex-auth';

export default getConvexAuthConfig() satisfies AuthConfig;
