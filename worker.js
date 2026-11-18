import { handleApi } from './server/api.js'

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleApi(request)
    return env.ASSETS.fetch(request)
  },
}
