import { handleApi } from '../../server/api.js'

export function onRequest(context) {
  return handleApi(context.request, context.env)
}
