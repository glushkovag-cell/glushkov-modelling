import { handleRequest } from './http/app';

export default {
  fetch(request: Request): Promise<Response> {
    return handleRequest(request);
  },
};
