import { handleRequest } from './http/app';
import type { ProfileEnv } from './profiles/client';

export default {
  fetch(request: Request, env: ProfileEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
