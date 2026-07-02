// Keys stored in the request-scoped CLS context (nestjs-cls / AsyncLocalStorage).
// This is the Node equivalent of Django's crum.get_current_user() thread-local.
export const CLS_USER_ID = "userId";
export const CLS_REQUEST_ID = "requestId";
export const CLS_ORIGIN = "origin";
