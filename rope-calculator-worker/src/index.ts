import type { Env } from './catalog/client';
import { handleRequest } from './http/app';

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
