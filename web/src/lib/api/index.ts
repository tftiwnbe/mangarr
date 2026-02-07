import createClient from 'openapi-fetch';
import type { paths } from './v2';

const client = createClient<paths>({});
export default client;
