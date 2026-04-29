import { defineApp } from 'convex/server';
import actionCache from '@convex-dev/action-cache/convex.config.js';
import shardedCounter from '@convex-dev/sharded-counter/convex.config.js';
import workpool from '@convex-dev/workpool/convex.config.js';

const app = defineApp();

app.use(workpool, { name: 'interactiveWorkpool' });
app.use(workpool, { name: 'discoveryWorkpool' });
app.use(workpool, { name: 'statsWorkpool' });
app.use(actionCache, { name: 'actionCache' });
app.use(shardedCounter, { name: 'shardedCounter' });

export default app;
