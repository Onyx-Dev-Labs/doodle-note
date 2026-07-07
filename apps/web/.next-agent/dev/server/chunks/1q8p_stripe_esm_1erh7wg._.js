module.exports = [
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Error.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* eslint-disable camelcase */ /* eslint-disable no-warning-comments */ __turbopack_context__.s([
    "RateLimitError",
    ()=>RateLimitError,
    "StripeAPIError",
    ()=>StripeAPIError,
    "StripeAuthenticationError",
    ()=>StripeAuthenticationError,
    "StripeCardError",
    ()=>StripeCardError,
    "StripeConnectionError",
    ()=>StripeConnectionError,
    "StripeError",
    ()=>StripeError,
    "StripeIdempotencyError",
    ()=>StripeIdempotencyError,
    "StripeInvalidClientError",
    ()=>StripeInvalidClientError,
    "StripeInvalidGrantError",
    ()=>StripeInvalidGrantError,
    "StripeInvalidRequestError",
    ()=>StripeInvalidRequestError,
    "StripeInvalidScopeError",
    ()=>StripeInvalidScopeError,
    "StripeOAuthError",
    ()=>StripeOAuthError,
    "StripeOAuthInvalidRequestError",
    ()=>StripeOAuthInvalidRequestError,
    "StripePermissionError",
    ()=>StripePermissionError,
    "StripeRateLimitError",
    ()=>StripeRateLimitError,
    "StripeSignatureVerificationError",
    ()=>StripeSignatureVerificationError,
    "StripeUnsupportedGrantTypeError",
    ()=>StripeUnsupportedGrantTypeError,
    "StripeUnsupportedResponseTypeError",
    ()=>StripeUnsupportedResponseTypeError,
    "TemporarySessionExpiredError",
    ()=>TemporarySessionExpiredError,
    "generateOAuthError",
    ()=>generateOAuthError,
    "generateV1Error",
    ()=>generateV1Error,
    "generateV2Error",
    ()=>generateV2Error
]);
const generateV1Error = (rawStripeError)=>{
    const statusCode = rawStripeError.statusCode;
    if (statusCode === 429 || statusCode === 400 && rawStripeError.code === 'rate_limit') {
        return new StripeRateLimitError(rawStripeError);
    }
    if (statusCode === 400 || statusCode === 404) {
        if (rawStripeError.type === 'idempotency_error') {
            return new StripeIdempotencyError(rawStripeError);
        }
        return new StripeInvalidRequestError(rawStripeError);
    }
    if (statusCode === 401) {
        return new StripeAuthenticationError(rawStripeError);
    }
    if (statusCode === 402) {
        return new StripeCardError(rawStripeError);
    }
    if (statusCode === 403) {
        return new StripePermissionError(rawStripeError);
    }
    return new StripeAPIError(rawStripeError);
};
const generateOAuthError = (rawStripeError)=>{
    const oauthType = rawStripeError.type;
    switch(oauthType){
        case 'invalid_grant':
            return new StripeInvalidGrantError(rawStripeError);
        case 'invalid_client':
            return new StripeInvalidClientError(rawStripeError);
        case 'invalid_request':
            return new StripeOAuthInvalidRequestError(rawStripeError);
        case 'invalid_scope':
            return new StripeInvalidScopeError(rawStripeError);
        case 'unsupported_grant_type':
            return new StripeUnsupportedGrantTypeError(rawStripeError);
        case 'unsupported_response_type':
            return new StripeUnsupportedResponseTypeError(rawStripeError);
        default:
            return new StripeOAuthError(rawStripeError);
    }
};
const generateV2Error = (rawStripeError)=>{
    switch(rawStripeError.type){
        case 'idempotency_error':
            return new StripeIdempotencyError(rawStripeError);
        // switchCases: The beginning of the section generated from our OpenAPI spec
        case 'rate_limit':
            return new RateLimitError(rawStripeError);
        case 'temporary_session_expired':
            return new TemporarySessionExpiredError(rawStripeError);
    }
    // Special handling for requests with missing required fields in V2 APIs.
    // invalid_field response in V2 APIs returns the field 'code' instead of 'type'.
    switch(rawStripeError.code){
        case 'invalid_fields':
            return new StripeInvalidRequestError(rawStripeError);
    }
    return generateV1Error(rawStripeError);
};
class StripeError extends Error {
    constructor(raw = {}, type = null){
        super(raw.message);
        this.type = type || this.constructor.name;
        this.raw = raw;
        this.rawType = raw.type;
        this.code = raw.code;
        this.doc_url = raw.doc_url;
        this.param = raw.param;
        this.detail = raw.detail;
        this.headers = raw.headers;
        this.requestId = raw.requestId;
        this.statusCode = raw.statusCode;
        this.message = raw.message ?? '';
        this.userMessage = raw.user_message;
        this.charge = raw.charge;
        this.decline_code = raw.decline_code;
        this.payment_intent = raw.payment_intent;
        this.payment_method = raw.payment_method;
        this.payment_method_type = raw.payment_method_type;
        this.setup_intent = raw.setup_intent;
        this.source = raw.source;
    }
}
/**
 * Helper factory which takes raw stripe errors and outputs wrapping instances
 */ StripeError.generate = generateV1Error;
class StripeCardError extends StripeError {
    constructor(raw = {}){
        super(raw, 'StripeCardError');
        this.decline_code = raw.decline_code ?? '';
    }
}
class StripeInvalidRequestError extends StripeError {
    constructor(raw = {}){
        super(raw, 'StripeInvalidRequestError');
    }
}
class StripeAPIError extends StripeError {
    constructor(raw = {}){
        super(raw, 'StripeAPIError');
    }
}
class StripeAuthenticationError extends StripeError {
    constructor(raw = {}){
        super(raw, 'StripeAuthenticationError');
    }
}
class StripePermissionError extends StripeError {
    constructor(raw = {}){
        super(raw, 'StripePermissionError');
    }
}
class StripeRateLimitError extends StripeError {
    constructor(raw = {}){
        super(raw, 'StripeRateLimitError');
    }
}
class StripeConnectionError extends StripeError {
    constructor(raw = {}){
        super(raw, 'StripeConnectionError');
    }
}
class StripeSignatureVerificationError extends StripeError {
    constructor(header, payload, raw = {}){
        super(raw, 'StripeSignatureVerificationError');
        this.header = header;
        this.payload = payload;
    }
}
class StripeIdempotencyError extends StripeError {
    constructor(raw = {}){
        super(raw, 'StripeIdempotencyError');
    }
}
class StripeOAuthError extends StripeError {
    constructor(raw = {}, type = 'StripeOAuthError'){
        super(raw, type);
    }
}
class StripeInvalidGrantError extends StripeOAuthError {
    constructor(raw = {}){
        super(raw, 'StripeInvalidGrantError');
    }
}
class StripeInvalidClientError extends StripeOAuthError {
    constructor(raw = {}){
        super(raw, 'StripeInvalidClientError');
    }
}
class StripeOAuthInvalidRequestError extends StripeOAuthError {
    constructor(raw = {}){
        super(raw, 'StripeOAuthInvalidRequestError');
    }
}
class StripeInvalidScopeError extends StripeOAuthError {
    constructor(raw = {}){
        super(raw, 'StripeInvalidScopeError');
    }
}
class StripeUnsupportedGrantTypeError extends StripeOAuthError {
    constructor(raw = {}){
        super(raw, 'StripeUnsupportedGrantTypeError');
    }
}
class StripeUnsupportedResponseTypeError extends StripeOAuthError {
    constructor(raw = {}){
        super(raw, 'StripeUnsupportedResponseTypeError');
    }
}
class RateLimitError extends StripeError {
    constructor(rawStripeError = {}){
        super(rawStripeError, 'RateLimitError');
    }
}
class TemporarySessionExpiredError extends StripeError {
    constructor(rawStripeError = {}){
        super(rawStripeError, 'TemporarySessionExpiredError');
    }
} // classDefinitions: The end of the section generated from our OpenAPI spec
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/net/HttpClient.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Encapsulates the logic for issuing a request to the Stripe API.
 *
 * A custom HTTP client should should implement:
 * 1. A response class which extends HttpClientResponse and wraps around their
 *    own internal representation of a response.
 * 2. A client class which extends HttpClient and implements all methods,
 *    returning their own response class when making requests.
 */ __turbopack_context__.s([
    "HttpClient",
    ()=>HttpClient,
    "HttpClientResponse",
    ()=>HttpClientResponse
]);
class HttpClient {
    /** The client name used for diagnostics. */ getClientName() {
        throw new Error('getClientName not implemented.');
    }
    makeRequest(host, port, path, method, headers, requestData, protocol, timeout) {
        throw new Error('makeRequest not implemented.');
    }
    /** Helper to make a consistent timeout error across implementations. */ static makeTimeoutError() {
        const timeoutErr = new TypeError(HttpClient.TIMEOUT_ERROR_CODE);
        timeoutErr.code = HttpClient.TIMEOUT_ERROR_CODE;
        return timeoutErr;
    }
}
// Public API accessible via Stripe.HttpClient
HttpClient.CONNECTION_CLOSED_ERROR_CODES = [
    'ECONNRESET',
    'EPIPE'
];
HttpClient.TIMEOUT_ERROR_CODE = 'ETIMEDOUT';
class HttpClientResponse {
    constructor(statusCode, headers){
        this._statusCode = statusCode;
        this._headers = headers;
    }
    getStatusCode() {
        return this._statusCode;
    }
    getHeaders() {
        return this._headers;
    }
    getRawResponse() {
        throw new Error('getRawResponse not implemented.');
    }
    toStream(streamCompleteCallback) {
        throw new Error('toStream not implemented.');
    }
    toJSON() {
        throw new Error('toJSON not implemented.');
    }
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/net/NodeHttpClient.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "NodeHttpClient",
    ()=>NodeHttpClient,
    "NodeHttpClientResponse",
    ()=>NodeHttpClientResponse
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$http__$5b$external$5d$__$28$http$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/http [external] (http, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$https__$5b$external$5d$__$28$https$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/https [external] (https, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/net/HttpClient.js [app-route] (ecmascript)");
;
;
;
// `import * as http_ from 'http'` creates a "Module Namespace Exotic Object"
// which is immune to monkey-patching, whereas http_.default (in an ES Module context)
// will resolve to the same thing as require('http'), which is
// monkey-patchable. We care about this because users in their test
// suites might be using a library like "nock" which relies on the ability
// to monkey-patch and intercept calls to http.request.
const http = __TURBOPACK__imported__module__$5b$externals$5d2f$http__$5b$external$5d$__$28$http$2c$__cjs$29$__.default || __TURBOPACK__imported__module__$5b$externals$5d2f$http__$5b$external$5d$__$28$http$2c$__cjs$29$__;
const https = __TURBOPACK__imported__module__$5b$externals$5d2f$https__$5b$external$5d$__$28$https$2c$__cjs$29$__.default || __TURBOPACK__imported__module__$5b$externals$5d2f$https__$5b$external$5d$__$28$https$2c$__cjs$29$__;
const defaultHttpAgent = new http.Agent({
    keepAlive: true
});
const defaultHttpsAgent = new https.Agent({
    keepAlive: true
});
class NodeHttpClient extends __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClient"] {
    constructor(agent){
        super();
        this._agent = agent;
    }
    /** @override. */ getClientName() {
        return 'node';
    }
    makeRequest(host, port, path, method, headers, requestData, protocol, timeout) {
        const isInsecureConnection = protocol === 'http';
        let agent = this._agent;
        if (!agent) {
            agent = isInsecureConnection ? defaultHttpAgent : defaultHttpsAgent;
        }
        const requestPromise = new Promise((resolve, reject)=>{
            const req = (isInsecureConnection ? http : https).request({
                host: host,
                port: port,
                path,
                method,
                agent,
                headers,
                ciphers: 'DEFAULT:!aNULL:!eNULL:!LOW:!EXPORT:!SSLv2:!MD5'
            });
            req.setTimeout(timeout, ()=>{
                req.destroy(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClient"].makeTimeoutError());
            });
            req.on('response', (res)=>{
                resolve(new NodeHttpClientResponse(res));
            });
            req.on('error', (error)=>{
                reject(error);
            });
            req.once('socket', (socket)=>{
                if (socket.connecting) {
                    socket.once(isInsecureConnection ? 'connect' : 'secureConnect', ()=>{
                        // Send payload; we're safe:
                        req.write(requestData);
                        req.end();
                    });
                } else {
                    // we're already connected
                    req.write(requestData);
                    req.end();
                }
            });
        });
        return requestPromise;
    }
}
class NodeHttpClientResponse extends __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClientResponse"] {
    constructor(res){
        // @ts-ignore
        super(res.statusCode, res.headers || {});
        this._res = res;
    }
    getRawResponse() {
        return this._res;
    }
    toStream(streamCompleteCallback) {
        // The raw response is itself the stream, so we just return that. To be
        // backwards compatible, we should invoke the streamCompleteCallback only
        // once the stream has been fully consumed.
        this._res.once('end', ()=>streamCompleteCallback());
        return this._res;
    }
    toJSON() {
        return new Promise((resolve, reject)=>{
            let response = '';
            this._res.setEncoding('utf8');
            this._res.on('data', (chunk)=>{
                response += chunk;
            });
            this._res.once('end', ()=>{
                try {
                    resolve(JSON.parse(response));
                } catch (e) {
                    if (e instanceof Error) {
                        e.rawBody = response;
                    }
                    reject(e);
                }
            });
        });
    }
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/net/FetchHttpClient.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FetchHttpClient",
    ()=>FetchHttpClient,
    "FetchHttpClientResponse",
    ()=>FetchHttpClientResponse
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/utils.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/net/HttpClient.js [app-route] (ecmascript)");
;
;
class FetchHttpClient extends __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClient"] {
    constructor(fetchFn){
        super();
        // Default to global fetch if available
        if (!fetchFn) {
            if (!globalThis.fetch) {
                throw new Error('fetch() function not provided and is not defined in the global scope. ' + 'You must provide a fetch implementation.');
            }
            fetchFn = globalThis.fetch;
        }
        // Both timeout behaviors differs from Node:
        // - Fetch uses a single timeout for the entire length of the request.
        // - Node is more fine-grained and resets the timeout after each stage of the request.
        if (globalThis.AbortController) {
            // Utilise native AbortController if available
            // AbortController was added in Node v15.0.0, v14.17.0
            this._fetchFn = FetchHttpClient.makeFetchWithAbortTimeout(fetchFn);
        } else {
            // Fall back to racing against a timeout promise if not available in the runtime
            // This does not actually cancel the underlying fetch operation or resources
            this._fetchFn = FetchHttpClient.makeFetchWithRaceTimeout(fetchFn);
        }
    }
    static makeFetchWithRaceTimeout(fetchFn) {
        return (url, init, timeout)=>{
            let pendingTimeoutId;
            const timeoutPromise = new Promise((_, reject)=>{
                pendingTimeoutId = setTimeout(()=>{
                    pendingTimeoutId = null;
                    reject(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClient"].makeTimeoutError());
                }, timeout);
            });
            const fetchPromise = fetchFn(url, init);
            return Promise.race([
                fetchPromise,
                timeoutPromise
            ]).finally(()=>{
                if (pendingTimeoutId) {
                    clearTimeout(pendingTimeoutId);
                }
            });
        };
    }
    static makeFetchWithAbortTimeout(fetchFn) {
        return async (url, init, timeout)=>{
            // Use AbortController because AbortSignal.timeout() was added later in Node v17.3.0, v16.14.0
            const abort = new AbortController();
            let timeoutId = setTimeout(()=>{
                timeoutId = null;
                abort.abort(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClient"].makeTimeoutError());
            }, timeout);
            try {
                return await fetchFn(url, {
                    ...init,
                    signal: abort.signal
                });
            } catch (err) {
                // Some implementations, like node-fetch, do not respect the reason passed to AbortController.abort()
                // and instead it always throws an AbortError
                // We catch this case to normalise all timeout errors
                if (err.name === 'AbortError') {
                    throw __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClient"].makeTimeoutError();
                } else {
                    throw err;
                }
            } finally{
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            }
        };
    }
    /** @override. */ getClientName() {
        return 'fetch';
    }
    async makeRequest(host, port, path, method, headers, requestData, protocol, timeout) {
        const isInsecureConnection = protocol === 'http';
        if (!path.startsWith('/')) {
            throw new Error(`Only relative paths are supported, got: "${path}"`);
        }
        const url = new URL(`${isInsecureConnection ? 'http' : 'https'}://${host}${path}`);
        url.port = port;
        // For methods which expect payloads, we should always pass a body value
        // even when it is empty. Without this, some JS runtimes (eg. Deno) will
        // inject a second Content-Length header. See https://github.com/stripe/stripe-node/issues/1519
        // for more details.
        const methodHasPayload = method == 'POST' || method == 'PUT' || method == 'PATCH';
        const body = requestData || (methodHasPayload ? '' : undefined);
        const res = await this._fetchFn(url.toString(), {
            method,
            headers: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["parseHeadersForFetch"])(headers),
            body: body
        }, timeout);
        return new FetchHttpClientResponse(res);
    }
}
class FetchHttpClientResponse extends __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClientResponse"] {
    constructor(res){
        super(res.status, FetchHttpClientResponse._transformHeadersToObject(res.headers));
        this._res = res;
    }
    getRawResponse() {
        return this._res;
    }
    toStream(streamCompleteCallback) {
        // Unfortunately `fetch` does not have event handlers for when the stream is
        // completely read. We therefore invoke the streamCompleteCallback right
        // away. This callback emits a response event with metadata and completes
        // metrics, so it's ok to do this without waiting for the stream to be
        // completely read.
        streamCompleteCallback();
        // Fetch's `body` property is expected to be a readable stream of the body.
        return this._res.body;
    }
    toJSON() {
        return this._res.text().then((text)=>{
            try {
                return JSON.parse(text);
            } catch (e) {
                if (e instanceof Error) {
                    e.rawBody = text;
                }
                throw e;
            }
        });
    }
    static _transformHeadersToObject(headers) {
        // Fetch uses a Headers instance so this must be converted to a barebones
        // JS object to meet the HttpClient interface.
        const headersObj = {};
        for (const entry of headers){
            if (!Array.isArray(entry) || entry.length != 2) {
                throw new Error('Response objects produced by the fetch function given to FetchHttpClient do not have an iterable headers map. Response#headers should be an iterable object.');
            }
            headersObj[entry[0]] = entry[1];
        }
        return headersObj;
    }
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Types.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_BASE_ADDRESSES",
    ()=>DEFAULT_BASE_ADDRESSES
]);
const DEFAULT_BASE_ADDRESSES = {
    api: 'api.stripe.com',
    files: 'files.stripe.com',
    connect: 'connect.stripe.com',
    meter_events: 'meter-events.stripe.com'
};
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/utils.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AI_AGENTS",
    ()=>AI_AGENTS,
    "attachCallSiteToError",
    ()=>attachCallSiteToError,
    "concat",
    ()=>concat,
    "createApiKeyAuthenticator",
    ()=>createApiKeyAuthenticator,
    "detectAIAgent",
    ()=>detectAIAgent,
    "extractUrlParams",
    ()=>extractUrlParams,
    "flattenAndStringify",
    ()=>flattenAndStringify,
    "getAPIMode",
    ()=>getAPIMode,
    "isObject",
    ()=>isObject,
    "isOptionsHash",
    ()=>isOptionsHash,
    "jsonStringifyRequestData",
    ()=>jsonStringifyRequestData,
    "makeURLInterpolator",
    ()=>makeURLInterpolator,
    "normalizeHeader",
    ()=>normalizeHeader,
    "normalizeHeaders",
    ()=>normalizeHeaders,
    "parseHeadersForFetch",
    ()=>parseHeadersForFetch,
    "parseHttpHeaderAsNumber",
    ()=>parseHttpHeaderAsNumber,
    "parseHttpHeaderAsString",
    ()=>parseHttpHeaderAsString,
    "pascalToCamelCase",
    ()=>pascalToCamelCase,
    "processOptions",
    ()=>processOptions,
    "queryStringifyRequestData",
    ()=>queryStringifyRequestData,
    "removeNullish",
    ()=>removeNullish,
    "validateApiBase",
    ()=>validateApiBase,
    "validateInteger",
    ()=>validateInteger
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Types$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Types.js [app-route] (ecmascript)");
;
const OPTIONS_KEYS = [
    'apiKey',
    'idempotencyKey',
    'stripeAccount',
    'apiVersion',
    'maxNetworkRetries',
    'timeout',
    'apiBase',
    'authenticator',
    'stripeContext',
    'headers',
    'additionalHeaders',
    'streaming'
];
function isOptionsHash(o) {
    return o && typeof o === 'object' && OPTIONS_KEYS.some((prop)=>Object.prototype.hasOwnProperty.call(o, prop));
}
function queryStringifyRequestData(data) {
    return stringifyRequestData(data);
}
/**
 * Encodes a value for use in a query string, keeping brackets unencoded
 * for readability (the server accepts both encoded and unencoded brackets).
 */ function encodeQueryValue(value) {
    return encodeURIComponent(value)// Encode characters not encoded by encodeURIComponent but encoded by qs
    .replace(/!/g, '%21').replace(/\*/g, '%2A').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/'/g, '%27')// Decode brackets for readability (server accepts both)
    .replace(/%5B/g, '[').replace(/%5D/g, ']');
}
/**
 * Converts a value to a string representation for query string encoding.
 * Dates are converted to Unix timestamps.
 */ function valueToString(value) {
    if (value instanceof Date) {
        return Math.floor(value.getTime() / 1000).toString();
    }
    if (value === null) {
        return '';
    }
    return String(value);
}
/**
 * Custom query string stringifier that handles nested objects and arrays.
 * Produces output compatible with the qs library's indexed array format.
 */ function stringifyRequestData(data) {
    const pairs = [];
    function encode(key, value) {
        if (value === undefined) {
            return;
        }
        if (value === null || typeof value !== 'object' || value instanceof Date) {
            // Primitive value (including null and Date)
            pairs.push(encodeQueryValue(key) + '=' + encodeQueryValue(valueToString(value)));
            return;
        }
        if (Array.isArray(value)) {
            // Array: use indexed format arr[0], arr[1], etc.
            for(let i = 0; i < value.length; i++){
                if (value[i] !== undefined) {
                    encode(key + '[' + i + ']', value[i]);
                }
            }
            return;
        }
        // Object: recurse with bracket notation
        for (const k of Object.keys(value)){
            encode(key + '[' + k + ']', value[k]);
        }
    }
    // Handle top-level object
    if (typeof data === 'object' && data !== null) {
        for (const key of Object.keys(data)){
            encode(key, data[key]);
        }
    }
    return pairs.join('&');
}
const makeURLInterpolator = (()=>{
    const rc = {
        '\n': '\\n',
        '"': '\\"',
        '\u2028': '\\u2028',
        '\u2029': '\\u2029'
    };
    return (str)=>{
        const cleanString = str.replace(/["\n\r\u2028\u2029]/g, ($0)=>rc[$0]);
        return (outputs)=>{
            return cleanString.replace(/\{([\s\S]+?)\}/g, ($0, $1)=>{
                const output = outputs[$1];
                if (isValidEncodeUriComponentType(output)) return encodeURIComponent(output);
                return '';
            });
        };
    };
})();
function isValidEncodeUriComponentType(value) {
    return [
        'number',
        'string',
        'boolean'
    ].includes(typeof value);
}
function extractUrlParams(path) {
    const params = path.match(/\{\w+\}/g);
    if (!params) {
        return [];
    }
    return params.map((param)=>param.replace(/[{}]/g, ''));
}
const validateApiBase = (apiBase)=>{
    if (typeof apiBase !== 'string') {
        throw new Error(`API base must be a string, got: ${typeof apiBase}`);
    }
    return apiBase in __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Types$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DEFAULT_BASE_ADDRESSES"];
};
function processOptions(options) {
    const result = {
        authenticator: null,
        headers: {},
        settings: {},
        streaming: false,
        apiBase: null
    };
    if (!options) {
        return result;
    }
    if (options.apiKey) {
        result.authenticator = createApiKeyAuthenticator(options.apiKey);
    }
    if (options.idempotencyKey) {
        result.headers['Idempotency-Key'] = options.idempotencyKey;
    }
    if (options.stripeAccount) {
        result.headers['Stripe-Account'] = options.stripeAccount;
    }
    if (options.stripeContext) {
        if (result.headers['Stripe-Account']) {
            throw new Error("Can't specify both stripeAccount and stripeContext.");
        }
        result.headers['Stripe-Context'] = options.stripeContext;
    }
    if (options.apiVersion) {
        result.headers['Stripe-Version'] = options.apiVersion;
    }
    if (Number.isInteger(options.maxNetworkRetries)) {
        result.settings.maxNetworkRetries = options.maxNetworkRetries;
    }
    if (Number.isInteger(options.timeout)) {
        result.settings.timeout = options.timeout;
    }
    if (options.authenticator) {
        if (options.apiKey) {
            throw new Error("Can't specify both apiKey and authenticator.");
        }
        if (typeof options.authenticator !== 'function') {
            throw new Error('The authenticator must be a function ' + 'receiving a request as the first parameter.');
        }
        result.authenticator = options.authenticator;
    }
    if (options.headers) {
        Object.assign(result.headers, options.headers);
    }
    if (options.streaming) {
        result.streaming = true;
    }
    return result;
}
function removeNullish(obj) {
    if (typeof obj !== 'object') {
        throw new Error('Argument must be an object');
    }
    return Object.keys(obj).reduce((result, key)=>{
        if (obj[key] != null) {
            result[key] = obj[key];
        }
        return result;
    }, {});
}
function normalizeHeaders(obj) {
    if (!(obj && typeof obj === 'object')) {
        return obj;
    }
    return Object.keys(obj).reduce((result, header)=>{
        result[normalizeHeader(header)] = obj[header];
        return result;
    }, {});
}
function normalizeHeader(header) {
    return header.split('-').map((text)=>text.charAt(0).toUpperCase() + text.substr(1).toLowerCase()).join('-');
}
function pascalToCamelCase(name) {
    if (name === 'OAuth') {
        return 'oauth';
    } else {
        return name[0].toLowerCase() + name.substring(1);
    }
}
function isObject(obj) {
    const type = typeof obj;
    return (type === 'function' || type === 'object') && !!obj;
}
function flattenAndStringify(data) {
    const result = {};
    const step = (obj, prevKey)=>{
        Object.entries(obj).forEach(([key, value])=>{
            const newKey = prevKey ? `${prevKey}[${key}]` : key;
            if (isObject(value)) {
                if (!(value instanceof Uint8Array) && !Object.prototype.hasOwnProperty.call(value, 'data')) {
                    // Non-buffer non-file Objects are recursively flattened
                    return step(value, newKey);
                } else {
                    // Buffers and file objects are stored without modification
                    result[newKey] = value;
                }
            } else {
                // Primitives are converted to strings
                result[newKey] = String(value);
            }
        });
    };
    step(data, null);
    return result;
}
function validateInteger(name, n, defaultVal) {
    if (!Number.isInteger(n)) {
        if (defaultVal !== undefined) {
            return defaultVal;
        } else {
            throw new Error(`${name} must be an integer`);
        }
    }
    return n;
}
const AI_AGENTS = [
    // The beginning of the section generated from our OpenAPI spec
    [
        'ANTIGRAVITY_CLI_ALIAS',
        'antigravity'
    ],
    [
        'CLAUDECODE',
        'claude_code'
    ],
    [
        'CLINE_ACTIVE',
        'cline'
    ],
    [
        'CODEX_SANDBOX',
        'codex_cli'
    ],
    [
        'CODEX_THREAD_ID',
        'codex_cli'
    ],
    [
        'CODEX_SANDBOX_NETWORK_DISABLED',
        'codex_cli'
    ],
    [
        'CODEX_CI',
        'codex_cli'
    ],
    [
        'CURSOR_AGENT',
        'cursor'
    ],
    [
        'GEMINI_CLI',
        'gemini_cli'
    ],
    [
        'OPENCLAW_SHELL',
        'openclaw'
    ],
    [
        'OPENCODE',
        'open_code'
    ]
];
function detectAIAgent(env) {
    for (const [envVar, agentName] of AI_AGENTS){
        if (env[envVar]) {
            return agentName;
        }
    }
    return '';
}
function createApiKeyAuthenticator(apiKey) {
    const authenticator = (request)=>{
        request.headers.Authorization = 'Bearer ' + apiKey;
        return Promise.resolve();
    };
    // For testing
    authenticator._apiKey = apiKey;
    return authenticator;
}
function concat(arrays) {
    const totalLength = arrays.reduce((len, array)=>len + array.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    arrays.forEach((array)=>{
        merged.set(array, offset);
        offset += array.length;
    });
    return merged;
}
/**
 * Replaces Date objects with Unix timestamps
 */ function dateTimeReplacer(key, value) {
    if (this[key] instanceof Date) {
        return Math.floor(this[key].getTime() / 1000).toString();
    }
    return value;
}
function jsonStringifyRequestData(data) {
    return JSON.stringify(data, dateTimeReplacer);
}
function getAPIMode(path) {
    if (!path) {
        return 'v1';
    }
    return path.startsWith('/v2') ? 'v2' : 'v1';
}
function parseHttpHeaderAsString(header) {
    if (Array.isArray(header)) {
        return header.join(', ');
    }
    return String(header);
}
function parseHttpHeaderAsNumber(header) {
    const value = Array.isArray(header) ? header[0] : header;
    if (value == null) {
        return undefined;
    }
    const trimmed = String(value).trim();
    if (trimmed === '') {
        return undefined;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }
    return parsed;
}
function parseHeadersForFetch(headers) {
    return Object.entries(headers).map(([key, value])=>{
        return [
            key,
            parseHttpHeaderAsString(value)
        ];
    });
}
const CALL_SITE_MARKER = '\nOriginating from:';
function attachCallSiteToError(err, callSiteStack) {
    if (!err || !err.stack || !callSiteStack) {
        return;
    }
    const callerFrames = callSiteStack.substring(callSiteStack.indexOf('\n') + 1);
    const existingMarkerIdx = err.stack.indexOf(CALL_SITE_MARKER);
    const baseStack = existingMarkerIdx >= 0 ? err.stack.substring(0, existingMarkerIdx) : err.stack;
    err.stack = `${baseStack}${CALL_SITE_MARKER}\n${callerFrames}`;
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/RequestSender.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "RequestSender",
    ()=>RequestSender
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Error.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/net/HttpClient.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/utils.js [app-route] (ecmascript)");
;
;
;
const MAX_RETRY_AFTER_WAIT = 60;
class RequestSender {
    constructor(stripe, maxBufferedRequestMetric){
        this._stripe = stripe;
        this._maxBufferedRequestMetric = maxBufferedRequestMetric;
    }
    _normalizeStripeContext(optsContext, clientContext) {
        if (optsContext) {
            return optsContext.toString() || null; // return null for empty strings
        }
        return clientContext?.toString() || null; // return null for empty strings
    }
    _addHeadersDirectlyToObject(obj, headers) {
        // For convenience, make some headers easily accessible on
        // lastResponse.
        // NOTE: Stripe responds with lowercase header names/keys.
        obj.requestId = headers['request-id'];
        obj.stripeAccount = obj.stripeAccount || headers['stripe-account'];
        obj.apiVersion = obj.apiVersion || headers['stripe-version'];
        obj.idempotencyKey = obj.idempotencyKey || headers['idempotency-key'];
    }
    _makeResponseEvent(requestEvent, statusCode, headers) {
        const requestEndTime = Date.now();
        const requestDurationMs = requestEndTime - requestEvent.request_start_time;
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["removeNullish"])({
            api_version: headers['stripe-version'],
            account: headers['stripe-account'],
            idempotency_key: headers['idempotency-key'],
            method: requestEvent.method,
            path: requestEvent.path,
            status: statusCode,
            request_id: this._getRequestId(headers),
            elapsed: requestDurationMs,
            request_start_time: requestEvent.request_start_time,
            request_end_time: requestEndTime
        });
    }
    _getRequestId(headers) {
        return headers['request-id'];
    }
    _emitStripeNotice(headers) {
        const notice = headers['stripe-notice'];
        if (notice) {
            this._stripe._platformFunctions.emitWarning(typeof notice === 'string' ? notice : notice[0]);
        }
    }
    /**
     * Used by methods with spec.streaming === true. For these methods, we do not
     * buffer successful responses into memory or do parse them into stripe
     * objects, we delegate that all of that to the user and pass back the raw
     * http.Response object to the callback.
     *
     * (Unsuccessful responses shouldn't make it here, they should
     * still be buffered/parsed and handled by _jsonResponseHandler -- see
     * makeRequest)
     */ _streamingResponseHandler(requestEvent, usage, callback) {
        return (res)=>{
            const headers = res.getHeaders();
            this._emitStripeNotice(headers);
            const streamCompleteCallback = ()=>{
                const responseEvent = this._makeResponseEvent(requestEvent, res.getStatusCode(), headers);
                this._stripe._emitter.emit('response', responseEvent);
                this._recordRequestMetrics(this._getRequestId(headers), responseEvent.elapsed, usage);
            };
            const stream = res.toStream(streamCompleteCallback);
            // This is here for backwards compatibility, as the stream is a raw
            // HTTP response in Node and the legacy behavior was to mutate this
            // response.
            this._addHeadersDirectlyToObject(stream, headers);
            return callback(null, stream);
        };
    }
    /**
     * Default handler for Stripe responses. Buffers the response into memory,
     * parses the JSON and returns it (i.e. passes it to the callback) if there
     * is no "error" field. Otherwise constructs/passes an appropriate Error.
     */ _jsonResponseHandler(requestEvent, apiMode, usage, callback) {
        return (res)=>{
            const headers = res.getHeaders();
            this._emitStripeNotice(headers);
            const requestId = this._getRequestId(headers);
            const statusCode = res.getStatusCode();
            const responseEvent = this._makeResponseEvent(requestEvent, statusCode, headers);
            res.toJSON().then((jsonResponse)=>{
                if (this._stripe.getEmitEventBodiesEnabled()) {
                    responseEvent.body = jsonResponse;
                }
                if (jsonResponse.error) {
                    const isOAuth = typeof jsonResponse.error === 'string';
                    if (isOAuth) {
                        jsonResponse.error = {
                            type: jsonResponse.error,
                            message: jsonResponse.error_description
                        };
                    }
                    jsonResponse.error.headers = headers;
                    jsonResponse.error.statusCode = statusCode;
                    jsonResponse.error.requestId = requestId;
                    let err;
                    if (isOAuth) {
                        err = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["generateOAuthError"])(jsonResponse.error);
                    } else if (apiMode === 'v2') {
                        err = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["generateV2Error"])(jsonResponse.error);
                    } else {
                        err = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["generateV1Error"])(jsonResponse.error);
                    }
                    throw err;
                }
                return jsonResponse;
            }, (e)=>{
                if (this._stripe.getEmitEventBodiesEnabled() && e.rawBody) {
                    responseEvent.body = e.rawBody;
                }
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeAPIError"]({
                    message: 'Invalid JSON received from the Stripe API',
                    exception: e,
                    requestId: headers['request-id']
                });
            }).then((jsonResponse)=>{
                this._stripe._emitter.emit('response', responseEvent);
                this._recordRequestMetrics(requestId, responseEvent.elapsed, usage);
                // Expose raw response object.
                const rawResponse = res.getRawResponse();
                this._addHeadersDirectlyToObject(rawResponse, headers);
                Object.defineProperty(jsonResponse, 'lastResponse', {
                    enumerable: false,
                    writable: false,
                    value: rawResponse
                });
                callback(null, jsonResponse);
            }, (e)=>{
                this._stripe._emitter.emit('response', responseEvent);
                callback(e, null);
            });
        };
    }
    static _generateConnectionErrorMessage(requestRetries) {
        return `An error occurred with our connection to Stripe.${requestRetries > 0 ? ` Request was retried ${requestRetries} times.` : ''}`;
    }
    // For more on when and how to retry API requests, see https://stripe.com/docs/error-handling#safely-retrying-requests-with-idempotency
    static _shouldRetry(res, numRetries, maxRetries, error) {
        if (error && numRetries === 0 && __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClient"].CONNECTION_CLOSED_ERROR_CODES.includes(error.code)) {
            return true;
        }
        // Do not retry if we are out of retries.
        if (numRetries >= maxRetries) {
            return false;
        }
        // Retry on connection error.
        if (!res) {
            return true;
        }
        // The API may ask us not to retry (e.g., if doing so would be a no-op)
        // or advise us to retry (e.g., in cases of lock timeouts); we defer to that.
        if (res.getHeaders()['stripe-should-retry'] === 'false') {
            return false;
        }
        if (res.getHeaders()['stripe-should-retry'] === 'true') {
            return true;
        }
        // Retry on conflict errors.
        if (res.getStatusCode() === 409) {
            return true;
        }
        // Retry on 500, 503, and other internal errors.
        //
        // Note that we expect the stripe-should-retry header to be false
        // in most cases when a 500 is returned, since our idempotency framework
        // would typically replay it anyway.
        if (res.getStatusCode() >= 500) {
            return true;
        }
        return false;
    }
    _getSleepTimeInMS(numRetries, retryAfter) {
        const initialNetworkRetryDelay = this._stripe.getInitialNetworkRetryDelay();
        const maxNetworkRetryDelay = this._stripe.getMaxNetworkRetryDelay();
        // Apply exponential backoff with initialNetworkRetryDelay on the
        // number of numRetries so far as inputs. Do not allow the number to exceed
        // maxNetworkRetryDelay.
        let sleepSeconds = Math.min(initialNetworkRetryDelay * Math.pow(2, numRetries - 1), maxNetworkRetryDelay);
        // Apply some jitter by randomizing the value in the range of
        // (sleepSeconds / 2) to (sleepSeconds).
        sleepSeconds *= 0.5 * (1 + Math.random());
        // But never sleep less than the base sleep seconds.
        sleepSeconds = Math.max(initialNetworkRetryDelay, sleepSeconds);
        // And never sleep less than the time the API asks us to wait, assuming it's a reasonable ask.
        if (Number.isInteger(retryAfter) && retryAfter <= MAX_RETRY_AFTER_WAIT) {
            sleepSeconds = Math.max(sleepSeconds, retryAfter);
        }
        return sleepSeconds * 1000;
    }
    // Max retries can be set on a per request basis. Favor those over the global setting
    _getMaxNetworkRetries(settings = {}) {
        return settings.maxNetworkRetries !== undefined && Number.isInteger(settings.maxNetworkRetries) ? settings.maxNetworkRetries : this._stripe.getMaxNetworkRetries();
    }
    _defaultIdempotencyKey(method, settings, apiMode) {
        // If this is a POST and we allow multiple retries, ensure an idempotency key.
        const maxRetries = this._getMaxNetworkRetries(settings);
        const genKey = ()=>`stripe-node-retry-${this._stripe._platformFunctions.uuid4()}`;
        // more verbose than it needs to be, but gives clear separation between V1 and V2 behavior
        if (apiMode === 'v2') {
            if (method === 'POST' || method === 'DELETE') {
                return genKey();
            }
        } else if (apiMode === 'v1') {
            if (method === 'POST' && maxRetries > 0) {
                return genKey();
            }
        }
        return null;
    }
    _makeHeaders({ contentType, contentLength, apiVersion, clientUserAgent, method, userSuppliedHeaders, userSuppliedSettings, stripeAccount, stripeContext, apiMode }) {
        const defaultHeaders = {
            Accept: 'application/json',
            'Content-Type': contentType,
            'User-Agent': this._getUserAgentString(apiMode),
            'X-Stripe-Client-User-Agent': clientUserAgent,
            'X-Stripe-Client-Telemetry': this._getTelemetryHeader(),
            'Stripe-Version': apiVersion,
            'Stripe-Account': stripeAccount,
            'Stripe-Context': stripeContext,
            'Idempotency-Key': this._defaultIdempotencyKey(method, userSuppliedSettings, apiMode)
        };
        // As per https://datatracker.ietf.org/doc/html/rfc7230#section-3.3.2:
        //   A user agent SHOULD send a Content-Length in a request message when
        //   no Transfer-Encoding is sent and the request method defines a meaning
        //   for an enclosed payload body.  For example, a Content-Length header
        //   field is normally sent in a POST request even when the value is 0
        //   (indicating an empty payload body).  A user agent SHOULD NOT send a
        //   Content-Length header field when the request message does not contain
        //   a payload body and the method semantics do not anticipate such a
        //   body.
        //
        // These method types are expected to have bodies and so we should always
        // include a Content-Length.
        const methodHasPayload = method == 'POST' || method == 'PUT' || method == 'PATCH';
        // If a content length was specified, we always include it regardless of
        // whether the method semantics anticipate such a body. This keeps us
        // consistent with historical behavior. We do however want to warn on this
        // and fix these cases as they are semantically incorrect.
        if (methodHasPayload || contentLength) {
            if (!methodHasPayload) {
                this._stripe._platformFunctions.emitWarning(`${method} method had non-zero contentLength but no payload is expected for this verb`);
            }
            defaultHeaders['Content-Length'] = contentLength;
        }
        return Object.assign((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["removeNullish"])(defaultHeaders), // If the user supplied, say 'idempotency-key', override instead of appending by ensuring caps are the same.
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["normalizeHeaders"])(userSuppliedHeaders));
    }
    _getUserAgentString(apiMode) {
        const packageVersion = this._stripe.getConstant('PACKAGE_VERSION');
        const appInfo = this._stripe._appInfo ? this._stripe.getAppInfoAsString() : '';
        const aiAgent = this._stripe.getConstant('AI_AGENT');
        let uaString = `Stripe/${apiMode} NodeBindings/${packageVersion}`;
        if (appInfo) {
            uaString += ` ${appInfo}`;
        }
        if (aiAgent) {
            uaString += ` AIAgent/${aiAgent}`;
        }
        return uaString;
    }
    _getTelemetryHeader() {
        if (this._stripe.getTelemetryEnabled() && this._stripe._prevRequestMetrics.length > 0) {
            const metrics = this._stripe._prevRequestMetrics.shift();
            return JSON.stringify({
                last_request_metrics: metrics
            });
        }
    }
    _recordRequestMetrics(requestId, requestDurationMs, usage) {
        if (this._stripe.getTelemetryEnabled() && requestId) {
            if (this._stripe._prevRequestMetrics.length > this._maxBufferedRequestMetric) {
                this._stripe._platformFunctions.emitWarning('Request metrics buffer is full, dropping telemetry message.');
            } else {
                const m = {
                    request_id: requestId,
                    request_duration_ms: requestDurationMs
                };
                if (usage && usage.length > 0) {
                    m.usage = usage;
                }
                this._stripe._prevRequestMetrics.push(m);
            }
        }
    }
    _rawRequest(method, path, params, options, usage) {
        return new Promise((resolve, reject)=>{
            try {
                const requestMethod = method.toUpperCase();
                if (requestMethod !== 'POST' && params && Object.keys(params).length !== 0) {
                    throw new Error('rawRequest only supports params on POST requests. Please pass null and add your parameters to path.');
                }
                const data = requestMethod === 'POST' ? Object.assign({}, params) : null;
                const processed = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["processOptions"])(options);
                // Handle additionalHeaders from RawRequestOptions
                if (options?.additionalHeaders) {
                    Object.assign(processed.headers, options.additionalHeaders);
                }
                const apiBase = processed.apiBase || (options?.apiBase ?? null);
                const host = apiBase ? this._stripe.resolveBaseAddress(apiBase) : null;
                this._request(requestMethod, host, path, data, processed.authenticator, {
                    headers: processed.headers,
                    settings: processed.settings,
                    streaming: processed.streaming
                }, usage || [
                    'raw_request'
                ], (err, response)=>{
                    if (err) {
                        reject(err);
                    } else {
                        resolve(response);
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }
    _getContentLength(data) {
        // if we calculate this wrong, the server treats it as invalid json
        // or if content length is too big, the request never finishes and it
        // times out.
        return typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
    }
    /**
     * This is the main HTTP method that all resources eventually call
     */ _request(method, host, path, data, authenticator, options, usage = [], callback, requestDataProcessor = null) {
        let requestData;
        authenticator = authenticator ?? this._stripe._authenticator;
        const apiMode = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getAPIMode"])(path);
        const retryRequest = (requestFn, apiVersion, headers, requestRetries, retryAfter)=>{
            return setTimeout(requestFn, this._getSleepTimeInMS(requestRetries, retryAfter), apiVersion, headers, requestRetries + 1);
        };
        const makeRequest = (apiVersion, headers, numRetries)=>{
            // timeout can be set on a per-request basis. Favor that over the global setting
            const timeout = options.settings && options.settings.timeout && Number.isInteger(options.settings.timeout) && options.settings.timeout >= 0 ? options.settings.timeout : this._stripe.getApiField('timeout');
            const request = {
                host: host || this._stripe.getApiField('host'),
                port: this._stripe.getApiField('port'),
                path: path,
                method: method,
                headers: Object.assign({}, headers),
                body: requestData,
                protocol: this._stripe.getApiField('protocol')
            };
            if (!authenticator) {
                throw Error("Authenticator was't initialized. Please pass an API Key or an Authenticator when initializing StripeClient.");
            }
            authenticator(request).then(()=>{
                const req = this._stripe.getApiField('httpClient').makeRequest(request.host, request.port, request.path, request.method, request.headers, request.body, request.protocol, timeout);
                const requestStartTime = Date.now();
                const requestEvent = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["removeNullish"])({
                    api_version: apiVersion,
                    account: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["parseHttpHeaderAsString"])(headers['Stripe-Account']),
                    idempotency_key: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["parseHttpHeaderAsString"])(headers['Idempotency-Key']),
                    method,
                    path,
                    body: this._stripe.getEmitEventBodiesEnabled() ? data ?? undefined : undefined,
                    request_start_time: requestStartTime
                });
                const requestRetries = numRetries || 0;
                const maxRetries = this._getMaxNetworkRetries(options.settings || {});
                this._stripe._emitter.emit('request', requestEvent);
                req.then((res)=>{
                    if (RequestSender._shouldRetry(res, requestRetries, maxRetries)) {
                        return retryRequest(makeRequest, apiVersion, headers, requestRetries, (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["parseHttpHeaderAsNumber"])(res.getHeaders()['retry-after']));
                    } else if (options.streaming && res.getStatusCode() < 400) {
                        return this._streamingResponseHandler(requestEvent, usage, callback)(res);
                    } else {
                        return this._jsonResponseHandler(requestEvent, apiMode, usage, callback)(res);
                    }
                }).catch((error)=>{
                    if (RequestSender._shouldRetry(null, requestRetries, maxRetries, error)) {
                        return retryRequest(makeRequest, apiVersion, headers, requestRetries);
                    } else {
                        const isTimeoutError = error.code && error.code === __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClient"].TIMEOUT_ERROR_CODE;
                        return callback(new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeConnectionError"]({
                            message: isTimeoutError ? `Request aborted due to timeout being reached (${timeout}ms)` : RequestSender._generateConnectionErrorMessage(requestRetries),
                            detail: error
                        }));
                    }
                });
            }).catch((e)=>{
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeError"]({
                    message: 'Unable to authenticate the request',
                    exception: e
                });
            });
        };
        const prepareAndMakeRequest = (error, data)=>{
            if (error) {
                return callback(error);
            }
            requestData = data;
            this._stripe.getClientUserAgent((clientUserAgent)=>{
                const apiVersion = this._stripe.getApiField('version');
                const headers = this._makeHeaders({
                    contentType: apiMode == 'v2' ? 'application/json' : 'application/x-www-form-urlencoded',
                    contentLength: this._getContentLength(data),
                    apiVersion: apiVersion,
                    clientUserAgent,
                    method,
                    // other callers expect null, but .headers being optional means it's undefined if not supplied. So we normalize to null.
                    userSuppliedHeaders: options.headers ?? null,
                    userSuppliedSettings: options.settings ?? {},
                    stripeAccount: options.stripeAccount ?? this._stripe.getApiField('stripeAccount'),
                    stripeContext: this._normalizeStripeContext(options.stripeContext, this._stripe.getApiField('stripeContext')),
                    apiMode: apiMode
                });
                makeRequest(apiVersion, headers, 0);
            });
        };
        if (requestDataProcessor) {
            requestDataProcessor(method, data, options.headers, prepareAndMakeRequest);
        } else {
            let stringifiedData;
            if (apiMode == 'v2') {
                stringifiedData = data ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["jsonStringifyRequestData"])(data) : '';
            } else {
                stringifiedData = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["queryStringifyRequestData"])(data || {});
            }
            prepareAndMakeRequest(null, stringifiedData);
        }
    }
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Decimal.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DEFAULT_DIV_PRECISION",
    ()=>DEFAULT_DIV_PRECISION,
    "Decimal",
    ()=>Decimal,
    "isDecimal",
    ()=>isDecimal
]);
/**
 * Maps built-in preset names to their {@link DecimalRoundingOptions}.
 * Used internally by {@link DecimalImpl.round}.
 *
 * @internal
 */ const ROUNDING_PRESETS = {
    'ubb-usage-count': {
        mode: 'significant-figures',
        value: 15
    },
    'v1-api': {
        mode: 'decimal-places',
        value: 12
    }
};
const DEFAULT_DIV_PRECISION = 34;
/**
 * Maximum number of digits in plain (non-exponential) notation produced
 * by {@link DecimalImpl.toString}. Values exceeding this threshold are
 * emitted in scientific notation (`1.23E+40`).
 *
 * @internal
 */ const PLAIN_NOTATION_DIGIT_LIMIT = 30;
/**
 * Maximum absolute value for the internal exponent.
 *
 * @remarks
 * This bound also implicitly limits exponent differences used in
 * arithmetic (e.g., scaling by `10^exponentDiff`), preventing
 * astronomically large BigInt allocations that could hang or
 * exhaust the process.
 *
 * The chosen limit is intentionally conservative but still far beyond
 * any magnitude needed for typical financial or billing calculations.
 *
 * @internal
 */ const MAX_EXPONENT = 1000000;
/**
 * Internal implementation of arbitrary-precision decimal arithmetic.
 *
 * @remarks
 * Represents a decimal value as `coefficient × 10^exponent` using
 * native `BigInt` for the coefficient, giving unlimited precision with
 * no rounding on construction. Instances are always
 * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze | frozen}
 * and all arithmetic produces new instances.
 *
 * This class is **not** exported directly — consumers interact with
 * the branded {@link Decimal} type and the {@link Decimal | Decimal companion object}.
 *
 * @internal
 */ class DecimalImpl {
    /**
     * Construct and normalise a decimal value.
     *
     * @param coefficient - The unscaled integer value.
     * @param exponent - The power-of-ten scale factor.
     *
     * @internal
     */ constructor(coefficient, exponent){
        const [normalizedCoef, normalizedExp] = DecimalImpl.normalize(coefficient, exponent);
        this._coefficient = normalizedCoef;
        this._exponent = normalizedExp;
        Object.freeze(this);
    }
    /**
     * Strip trailing zeros from `coefficient`, incrementing `exponent`
     * for each zero removed. Zero always normalises to `(0n, 0)`.
     *
     * @param coefficient - Raw coefficient before normalisation.
     * @param exponent - Raw exponent before normalisation.
     * @returns A `[coefficient, exponent]` tuple with trailing zeros removed.
     *
     * @internal
     */ static normalize(coefficient, exponent) {
        if (coefficient === 0n) {
            return [
                0n,
                0
            ];
        }
        let coef = coefficient;
        let exp = exponent;
        while(coef !== 0n && coef % 10n === 0n){
            coef /= 10n;
            exp += 1;
        }
        return [
            coef,
            exp
        ];
    }
    /**
     * Apply rounding to the result of an integer division.
     *
     * @remarks
     * BigInt division truncates toward zero. This helper inspects the
     * `remainder` to decide whether to adjust the truncated `quotient`
     * by ±1 according to the chosen {@link RoundDirection}.
     *
     * The rounding direction is derived from the signs of `remainder`
     * and `divisor`: when they agree the exact fractional part is
     * positive (the truncation point is below the true value, so +1
     * rounds to nearest); when they disagree the fractional part is
     * negative (−1 rounds to nearest).
     *
     * @param quotient - Truncated integer quotient (`dividend / divisor`).
     * @param remainder - Division remainder (`dividend % divisor`).
     * @param divisor - The divisor used in the division.
     * @param direction - The rounding strategy to apply.
     * @returns The rounded quotient.
     *
     * @internal
     */ static roundDivision(quotient, remainder, divisor, direction) {
        if (remainder === 0n) {
            return quotient;
        }
        // 'round-down': truncate toward zero — BigInt division already does this.
        if (direction === 'round-down') {
            return quotient;
        }
        // The sign of remainder/divisor tells us which side of the truncation
        // point the exact value lies on.
        // Same sign → fractional part is positive (exact value > quotient) → +1 adjusts upward.
        // Opposite sign → fractional part is negative (exact value < quotient) → -1 adjusts downward.
        const roundDir = remainder > 0n === divisor > 0n ? 1n : -1n;
        // 'round-up': away from zero whenever there is any remainder.
        if (direction === 'round-up') {
            return quotient + roundDir;
        }
        // 'ceil': toward positive infinity.
        // If the fractional part is positive (roundDir === 1n), round up.
        // If the fractional part is negative (roundDir === -1n), truncation already went toward +∞.
        if (direction === 'ceil') {
            return roundDir === 1n ? quotient + 1n : quotient;
        }
        // 'floor': toward negative infinity.
        // If the fractional part is negative (roundDir === -1n), round down.
        // If the fractional part is positive (roundDir === 1n), truncation already went toward -∞.
        if (direction === 'floor') {
            return roundDir === -1n ? quotient - 1n : quotient;
        }
        // For the half-* modes we need to compare the remainder to exactly half the divisor.
        const absRemainder = remainder < 0n ? -remainder : remainder;
        const absDivisor = divisor < 0n ? -divisor : divisor;
        const doubled = absRemainder * 2n;
        let cmp;
        if (doubled === absDivisor) {
            cmp = 0;
        } else if (doubled < absDivisor) {
            cmp = -1;
        } else {
            cmp = 1;
        }
        if (cmp < 0) {
            // Less than half — truncation is already the nearest value.
            return quotient;
        }
        if (cmp > 0) {
            // More than half — round to nearest (away from truncation point).
            return quotient + roundDir;
        }
        // Exactly half — tie-breaking depends on the chosen mode.
        if (direction === 'half-up') {
            // Round away from zero.
            return quotient + roundDir;
        }
        if (direction === 'half-down') {
            // Round toward zero — stay at the truncated quotient.
            return quotient;
        }
        // HALF_EVEN: round to nearest even.
        if (quotient % 2n === 0n) {
            // Already even — stay at truncation.
            return quotient;
        } else {
            // Odd — adjust to make even.
            return quotient + roundDir;
        }
    }
    // -------------------------------------------------------------------
    // Arithmetic
    // -------------------------------------------------------------------
    /**
     * Return the sum of this value and `other`.
     *
     * @param other - The addend.
     * @returns A new {@link Decimal} equal to `this + other`.
     *
     * @public
     */ add(other) {
        const otherImpl = other;
        // Align exponents — use the smaller (more precision) exponent as target.
        if (this._exponent === otherImpl._exponent) {
            return new DecimalImpl(this._coefficient + otherImpl._coefficient, this._exponent);
        }
        if (this._exponent < otherImpl._exponent) {
            const scale = 10n ** BigInt(otherImpl._exponent - this._exponent);
            return new DecimalImpl(this._coefficient + otherImpl._coefficient * scale, this._exponent);
        } else {
            const scale = 10n ** BigInt(this._exponent - otherImpl._exponent);
            return new DecimalImpl(this._coefficient * scale + otherImpl._coefficient, otherImpl._exponent);
        }
    }
    /**
     * Return the difference of this value and `other`.
     *
     * @param other - The subtrahend.
     * @returns A new {@link Decimal} equal to `this - other`.
     *
     * @public
     */ sub(other) {
        const otherImpl = other;
        if (this._exponent === otherImpl._exponent) {
            return new DecimalImpl(this._coefficient - otherImpl._coefficient, this._exponent);
        }
        if (this._exponent < otherImpl._exponent) {
            const scale = 10n ** BigInt(otherImpl._exponent - this._exponent);
            return new DecimalImpl(this._coefficient - otherImpl._coefficient * scale, this._exponent);
        } else {
            const scale = 10n ** BigInt(this._exponent - otherImpl._exponent);
            return new DecimalImpl(this._coefficient * scale - otherImpl._coefficient, otherImpl._exponent);
        }
    }
    /**
     * Return the product of this value and `other`.
     *
     * @param other - The multiplicand.
     * @returns A new {@link Decimal} equal to `this × other`.
     *
     * @public
     */ mul(other) {
        const otherImpl = other;
        return new DecimalImpl(this._coefficient * otherImpl._coefficient, this._exponent + otherImpl._exponent);
    }
    /**
     * Return the quotient of this value divided by `other`.
     *
     * @remarks
     * Division scales the dividend to produce `precision` decimal digits
     * in the result, then applies integer division and rounds the
     * remainder according to `direction`.
     *
     * Division requires explicit rounding control — no invisible defaults
     * in financial code. For full precision use {@link DEFAULT_DIV_PRECISION}
     * (34, matching the IEEE 754 decimal128 coefficient size).
     *
     * @example
     * ```ts
     * Decimal.from('1').div(Decimal.from('3'), 5, 'half-up');   // "0.33333"
     * Decimal.from('5').div(Decimal.from('2'), 0, 'half-up');   // "3"
     * Decimal.from('5').div(Decimal.from('2'), 0, 'half-even'); // "2"
     * ```
     *
     * @param other - The divisor. Must not be zero.
     * @param precision - Maximum number of decimal digits in the result.
     * @param direction - How to round when the exact quotient cannot
     *   be represented at the requested precision.
     * @returns A new {@link Decimal} equal to `this ÷ other`, rounded to
     *   `precision` decimal places.
     * @throws {@link Error} if `other` is zero.
     * @throws {@link Error} if `precision` is negative or non-integer.
     *
     * @public
     */ div(other, precision, direction) {
        if (precision < 0 || !Number.isInteger(precision)) {
            throw new Error('precision must be a non-negative integer');
        }
        const otherImpl = other;
        if (otherImpl._coefficient === 0n) {
            throw new Error('Division by zero');
        }
        // result_coefficient = this.coefficient × 10^(thisExp - otherExp + precision) / other.coefficient
        // result_exponent   = -precision
        const scale = this._exponent - otherImpl._exponent + precision;
        let quotient;
        let remainder;
        let roundingDivisor;
        if (scale >= 0) {
            const scaledDividend = this._coefficient * 10n ** BigInt(scale);
            quotient = scaledDividend / otherImpl._coefficient;
            remainder = scaledDividend % otherImpl._coefficient;
            roundingDivisor = otherImpl._coefficient;
        } else {
            // Negative scale: shift the power onto the divisor side to avoid
            // BigInt exponentiation with a negative exponent (which throws).
            const scaledDivisor = otherImpl._coefficient * 10n ** BigInt(-scale);
            quotient = this._coefficient / scaledDivisor;
            remainder = this._coefficient % scaledDivisor;
            roundingDivisor = scaledDivisor;
        }
        const roundedQuotient = DecimalImpl.roundDivision(quotient, remainder, roundingDivisor, direction);
        return new DecimalImpl(roundedQuotient, -precision);
    }
    // -------------------------------------------------------------------
    // Comparison
    // -------------------------------------------------------------------
    /**
     * Three-way comparison of this value with `other`.
     *
     * @example
     * ```ts
     * const a = Decimal.from('1.5');
     * const b = Decimal.from('2');
     * a.cmp(b); // -1
     * b.cmp(a); //  1
     * a.cmp(a); //  0
     * ```
     *
     * @param other - The value to compare against.
     * @returns `-1` if `this \< other`, `0` if equal, `1` if `this \> other`.
     *
     * @public
     */ cmp(other) {
        const otherImpl = other;
        if (this._exponent === otherImpl._exponent) {
            if (this._coefficient < otherImpl._coefficient) return -1;
            if (this._coefficient > otherImpl._coefficient) return 1;
            return 0;
        }
        if (this._exponent < otherImpl._exponent) {
            // this has smaller exponent — scale other's coefficient to match.
            const scale = 10n ** BigInt(otherImpl._exponent - this._exponent);
            const scaledOther = otherImpl._coefficient * scale;
            if (this._coefficient < scaledOther) return -1;
            if (this._coefficient > scaledOther) return 1;
            return 0;
        } else {
            // other has smaller exponent — scale this's coefficient to match.
            const scale = 10n ** BigInt(this._exponent - otherImpl._exponent);
            const scaledThis = this._coefficient * scale;
            if (scaledThis < otherImpl._coefficient) return -1;
            if (scaledThis > otherImpl._coefficient) return 1;
            return 0;
        }
    }
    /**
     * Return `true` if this value is numerically equal to `other`.
     *
     * @param other - The value to compare against.
     * @returns `true` if `this === other` in value, `false` otherwise.
     *
     * @public
     */ eq(other) {
        return this.cmp(other) === 0;
    }
    /**
     * Return `true` if this value is strictly less than `other`.
     *
     * @param other - The value to compare against.
     * @returns `true` if `this \< other`, `false` otherwise.
     *
     * @public
     */ lt(other) {
        return this.cmp(other) === -1;
    }
    /**
     * Return `true` if this value is less than or equal to `other`.
     *
     * @param other - The value to compare against.
     * @returns `true` if `this ≤ other`, `false` otherwise.
     *
     * @public
     */ lte(other) {
        return this.cmp(other) <= 0;
    }
    /**
     * Return `true` if this value is strictly greater than `other`.
     *
     * @param other - The value to compare against.
     * @returns `true` if `this \> other`, `false` otherwise.
     *
     * @public
     */ gt(other) {
        return this.cmp(other) === 1;
    }
    /**
     * Return `true` if this value is greater than or equal to `other`.
     *
     * @param other - The value to compare against.
     * @returns `true` if `this ≥ other`, `false` otherwise.
     *
     * @public
     */ gte(other) {
        return this.cmp(other) >= 0;
    }
    // -------------------------------------------------------------------
    // Predicates
    // -------------------------------------------------------------------
    /**
     * Return `true` if this value is exactly zero.
     *
     * @returns `true` if the value is zero, `false` otherwise.
     *
     * @public
     */ isZero() {
        return this._coefficient === 0n;
    }
    /**
     * Return `true` if this value is strictly less than zero.
     *
     * @returns `true` if negative, `false` if zero or positive.
     *
     * @public
     */ isNegative() {
        return this._coefficient < 0n;
    }
    /**
     * Return `true` if this value is strictly greater than zero.
     *
     * @returns `true` if positive, `false` if zero or negative.
     *
     * @public
     */ isPositive() {
        return this._coefficient > 0n;
    }
    // -------------------------------------------------------------------
    // Unary operations
    // -------------------------------------------------------------------
    /**
     * Return the additive inverse of this value.
     *
     * @returns A new {@link Decimal} equal to `-this`.
     *
     * @public
     */ neg() {
        return new DecimalImpl(-this._coefficient, this._exponent);
    }
    /**
     * Return the absolute value.
     *
     * @returns A new {@link Decimal} equal to `|this|`. If this value is
     *   already non-negative, returns `this` (no allocation).
     *
     * @public
     */ abs() {
        if (this._coefficient < 0n) {
            return new DecimalImpl(-this._coefficient, this._exponent);
        }
        return this;
    }
    // -------------------------------------------------------------------
    // Rounding
    // -------------------------------------------------------------------
    /**
     * Round this value to a specified precision.
     *
     * @remarks
     * **Rounding directions** (IEEE 754-2019 §4.3):
     *
     * | Direction      | Behavior                                       |
     * | -------------- | ---------------------------------------------- |
     * | `'ceil'`       |  1.1→2, -1.1→-1, 1.0→1 (toward +∞)             |
     * | `'floor'`      |  1.9→1, -1.1→-2, 1.0→1 (toward -∞)             |
     * | `'round-down'` |  1.9→1, -1.9→-1 (toward zero / truncate)       |
     * | `'round-up'`   |  1.1→2, -1.1→-2 (away from zero)               |
     * | `'half-up'`    |  0.5→1, 1.5→2, -0.5→-1 (ties away from zero)   |
     * | `'half-down'`  |  0.5→0, 1.5→1, -0.5→0 (ties toward zero)       |
     * | `'half-even'`  |  0.5→0, 1.5→2, 2.5→2, 3.5→4 (ties to even)     |
     *
     * **Precision** is specified as a {@link DecimalRoundingOptions} object
     * or a preset name from {@link DecimalRoundingPresets}:
     *
     * @example
     * ```ts
     * // Using a preset
     * amount.round('half-even', 'v1-api');
     *
     * // Using explicit options
     * amount.round('half-even', { mode: 'decimal-places', value: 2 });
     * amount.round('half-up', { mode: 'significant-figures', value: 4 });
     * ```
     *
     * @param direction - How to round.
     * @param options - A {@link DecimalRoundingOptions} object or key of {@link DecimalRoundingPresets}.
     * @returns A new {@link Decimal} rounded to the specified precision.
     * @throws {@link Error} if `options.value` is negative or non-integer.
     * @throws {@link Error} if the preset name is not recognized.
     *
     * @public
     */ round(direction, options) {
        const resolved = typeof options === 'string' ? // ROUNDING_PRESETS only knows about built-in keys at runtime.  The double
        // cast through `unknown` is intentional: we want an undefined-safe lookup
        // so the runtime guard below can produce a clear error for unrecognised
        // (e.g. declaration-merged) preset names that were not also added to
        // ROUNDING_PRESETS.
        ROUNDING_PRESETS[options] : options;
        if (resolved === undefined) {
            throw new Error(`Unknown rounding preset: "${options}"`);
        }
        if (resolved.value < 0 || !Number.isInteger(resolved.value)) {
            throw new Error('DecimalRoundingOptions.value must be a non-negative integer');
        }
        if (resolved.mode === 'decimal-places') {
            // Reuse toFixed logic: round to resolved.value decimal places then re-parse.
            const fixed = this.toFixed(resolved.value, direction);
            return Decimal.from(fixed);
        }
        // significant-figures: round to resolved.value total significant digits.
        if (this._coefficient === 0n) {
            return this;
        }
        const coeffStr = this._coefficient < 0n ? (-this._coefficient).toString() : this._coefficient.toString();
        const currentSigFigs = coeffStr.length;
        if (resolved.value === 0) {
            // 0 significant figures is a degenerate case — return zero.
            return Decimal.zero;
        }
        if (currentSigFigs <= resolved.value) {
            // Already at or below requested precision — no rounding needed.
            return this;
        }
        // We need to reduce the number of significant figures.
        // The number of digits to drop from the coefficient:
        const digitsToTrim = currentSigFigs - resolved.value;
        const divisor = 10n ** BigInt(digitsToTrim);
        const quotient = this._coefficient / divisor;
        const remainder = this._coefficient % divisor;
        const rounded = DecimalImpl.roundDivision(quotient, remainder, divisor, direction);
        // The new exponent shifts to account for trimmed digits.
        return new DecimalImpl(rounded, this._exponent + digitsToTrim);
    }
    // -------------------------------------------------------------------
    // Conversion / serialisation
    // -------------------------------------------------------------------
    /**
     * Return a human-readable string representation.
     *
     * @remarks
     * Plain notation for values whose digit count is at most 30, and
     * scientific notation (`1.23E+40`) for larger values. Trailing zeros
     * are never present because the internal representation is normalised.
     *
     * @public
     */ toString() {
        if (this._coefficient === 0n) {
            return '0';
        }
        const coeffStr = this._coefficient.toString();
        const isNeg = coeffStr.startsWith('-');
        const absCoeffStr = isNeg ? coeffStr.slice(1) : coeffStr;
        if (this._exponent < 0) {
            const decimalPlaces = -this._exponent;
            // Guard against unbounded string allocation for extreme negative
            // exponents (e.g. 1e-1000000 would otherwise produce a million-char
            // string of leading zeros). Switch to scientific notation when the
            // number of leading zeros alone exceeds the digit limit. Normal
            // fractional values (e.g. 34-digit division results) pass through.
            const leadingZeroCount = decimalPlaces >= absCoeffStr.length ? decimalPlaces - absCoeffStr.length : 0;
            if (leadingZeroCount > PLAIN_NOTATION_DIGIT_LIMIT) {
                if (absCoeffStr.length === 1) {
                    return `${coeffStr}E${String(this._exponent)}`;
                }
                const intPart = absCoeffStr[0] ?? '';
                const fracPart = absCoeffStr.slice(1);
                const adjustedExp = this._exponent + absCoeffStr.length - 1;
                return `${isNeg ? '-' : ''}${intPart}.${fracPart}E${String(adjustedExp)}`;
            }
            if (decimalPlaces >= absCoeffStr.length) {
                const leadingZeros = '0'.repeat(decimalPlaces - absCoeffStr.length);
                return `${isNeg ? '-' : ''}0.${leadingZeros}${absCoeffStr}`;
            } else {
                const integerPart = absCoeffStr.slice(0, absCoeffStr.length - decimalPlaces);
                const fractionalPart = absCoeffStr.slice(absCoeffStr.length - decimalPlaces);
                return `${isNeg ? '-' : ''}${integerPart}.${fractionalPart}`;
            }
        }
        const plainLength = absCoeffStr.length + this._exponent;
        if (plainLength <= PLAIN_NOTATION_DIGIT_LIMIT) {
            if (this._exponent === 0) {
                return coeffStr;
            }
            const trailingZeros = '0'.repeat(this._exponent);
            return `${isNeg ? '-' : ''}${absCoeffStr}${trailingZeros}`;
        } else {
            if (absCoeffStr.length === 1) {
                return `${coeffStr}E+${String(this._exponent)}`;
            }
            const integerPart = absCoeffStr[0] ?? '';
            const fractionalPart = absCoeffStr.slice(1);
            const adjustedExponent = this._exponent + absCoeffStr.length - 1;
            return `${isNeg ? '-' : ''}${integerPart}.${fractionalPart}E+${String(adjustedExponent)}`;
        }
    }
    /**
     * Return the JSON-serialisable representation.
     *
     * @remarks
     * Returns a plain string matching the Stripe API convention where
     * decimal values are serialised as strings in JSON. Called
     * automatically by `JSON.stringify`.
     *
     * @public
     */ toJSON() {
        return this.toString();
    }
    /**
     * Convert to a JavaScript `number`.
     *
     * @remarks
     * This is an explicit, intentionally lossy conversion. Use it only
     * when you need a numeric value for display or interop with APIs
     * that require `number`. Prefer {@link Decimal.toString | toString}
     * or {@link Decimal.toFixed | toFixed} for lossless output.
     *
     * @public
     */ toNumber() {
        return Number(this.toString());
    }
    /**
     * Format this value as a fixed-point string with exactly
     * `decimalPlaces` digits after the decimal point.
     *
     * @remarks
     * Values are rounded according to `direction` when the internal
     * precision exceeds the requested number of decimal places.
     * The rounding direction is always required — no invisible defaults
     * in financial code.
     *
     * @example
     * ```ts
     * Decimal.from('1.235').toFixed(2, 'half-up');   // "1.24"
     * Decimal.from('1.225').toFixed(2, 'half-even'); // "1.22"
     * Decimal.from('42').toFixed(3, 'half-up');      // "42.000"
     * ```
     *
     * @param decimalPlaces - Number of digits after the decimal point.
     *   Must be a non-negative integer.
     * @param direction - How to round when truncating excess digits.
     * @returns A string with exactly `decimalPlaces` fractional digits.
     * @throws {@link Error} if `decimalPlaces` is negative or non-integer.
     *
     * @public
     */ toFixed(decimalPlaces, direction) {
        if (decimalPlaces < 0 || !Number.isInteger(decimalPlaces)) {
            throw new Error('decimalPlaces must be a non-negative integer');
        }
        const formatFixed = (coef)=>{
            const coeffStr = coef.toString();
            const isNeg = coeffStr.startsWith('-');
            const absCoeffStr = isNeg ? coeffStr.slice(1) : coeffStr;
            if (decimalPlaces === 0) {
                return coeffStr;
            }
            if (decimalPlaces >= absCoeffStr.length) {
                const leadingZeros = '0'.repeat(decimalPlaces - absCoeffStr.length);
                return `${isNeg ? '-' : ''}0.${leadingZeros}${absCoeffStr}`;
            } else {
                const integerPart = absCoeffStr.slice(0, absCoeffStr.length - decimalPlaces);
                const fractionalPart = absCoeffStr.slice(absCoeffStr.length - decimalPlaces);
                return `${isNeg ? '-' : ''}${integerPart}.${fractionalPart}`;
            }
        };
        const targetExponent = -decimalPlaces;
        if (this._exponent === targetExponent) {
            return formatFixed(this._coefficient);
        }
        if (this._exponent < targetExponent) {
            // Need to reduce precision — round the excess digits.
            const scaleDiff = targetExponent - this._exponent;
            const divisor = 10n ** BigInt(scaleDiff);
            const quotient = this._coefficient / divisor;
            const remainder = this._coefficient % divisor;
            const rounded = DecimalImpl.roundDivision(quotient, remainder, divisor, direction);
            return formatFixed(rounded);
        } else {
            // Need to increase precision — pad with trailing zeros.
            const scaleDiff = this._exponent - targetExponent;
            const scaled = this._coefficient * 10n ** BigInt(scaleDiff);
            return formatFixed(scaled);
        }
    }
    /**
     * Return a string primitive when the runtime coerces the value.
     *
     * @remarks
     * Deliberately returns a `string` (not a `number`) to discourage
     * silent precision loss through implicit arithmetic coercion.
     * When used in a numeric context (for example, `+myDecimal`), the
     * JavaScript runtime will first call this method and then coerce
     * the resulting string to a `number`, which may lose precision.
     * Callers should prefer the explicit
     * {@link Decimal.toNumber | toNumber} method when an IEEE 754
     * `number` is required.
     *
     * @public
     */ valueOf() {
        return this.toString();
    }
}
function isDecimal(value) {
    return value instanceof DecimalImpl;
}
const Decimal = {
    /**
     * Create a {@link Decimal} from a string, number, or bigint.
     *
     * @remarks
     * - **string**: Parsed as a decimal literal. Accepts an optional sign,
     *   integer digits, an optional fractional part, and an optional `e`/`E`
     *   exponent. Leading/trailing whitespace is trimmed.
     * - **number**: Must be finite. Converted via `Number.prototype.toString()`
     *   then parsed, so `Decimal.from(0.1)` produces `"0.1"` (not the
     *   53-bit binary approximation).
     * - **bigint**: Treated as an integer with exponent 0.
     *
     * @example
     * ```ts
     * Decimal.from('1.23');   // string
     * Decimal.from(42);       // number
     * Decimal.from(100n);     // bigint
     * Decimal.from('1.5e3');  // scientific notation → 1500
     * ```
     *
     * @param value - The value to convert.
     * @returns A new frozen {@link Decimal} instance.
     * @throws {@link Error} if `value` is a non-finite number, an empty
     *   string, or a string that does not match the decimal literal grammar.
     *
     * @public
     */ from (value) {
        if (typeof value === 'bigint') {
            return new DecimalImpl(value, 0);
        }
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
                throw new Error('Number must be finite');
            }
            return Decimal.from(value.toString());
        }
        // Parse string.
        const trimmed = value.trim();
        if (trimmed === '') {
            throw new Error('Cannot parse empty string as Decimal');
        }
        // Match: optional sign, integer digits, optional fraction, optional exponent.
        const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(trimmed);
        if (!match) {
            throw new Error(`Invalid decimal string: ${value}`);
        }
        const sign = match[1] === '-' ? -1n : 1n;
        const integerPart = match[2] ?? '';
        const fractionalPart = match[3] ?? '';
        const exponentPart = match[4] ? Number(match[4]) : 0;
        if (!Number.isSafeInteger(exponentPart) || exponentPart > MAX_EXPONENT || exponentPart < -MAX_EXPONENT) {
            throw new Error(`Exponent out of range: ${String(match[4])} exceeds safe integer bounds`);
        }
        const coefficientStr = integerPart + fractionalPart;
        const coefficient = sign * BigInt(coefficientStr);
        const exponent = exponentPart - fractionalPart.length;
        if (!Number.isSafeInteger(exponent) || exponent > MAX_EXPONENT || exponent < -MAX_EXPONENT) {
            throw new Error(`Computed exponent out of range: ${String(exponent)} exceeds safe integer bounds`);
        }
        return new DecimalImpl(coefficient, exponent);
    },
    /**
     * The {@link Decimal} value representing zero.
     *
     * @remarks
     * Pre-allocated singleton — prefer `Decimal.zero` over
     * `Decimal.from(0)` to avoid an unnecessary allocation.
     *
     * @public
     */ zero: new DecimalImpl(0n, 0)
};
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/V2Coercion.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "coerceV2RequestData",
    ()=>coerceV2RequestData,
    "coerceV2ResponseData",
    ()=>coerceV2ResponseData
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Decimal$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Decimal.js [app-route] (ecmascript)");
;
const coerceV2RequestData = (data, schema)=>{
    if (data == null) {
        return data;
    }
    switch(schema.kind){
        case 'int64_string':
            return typeof data === 'bigint' || typeof data === 'number' ? String(data) : data;
        case 'decimal_string':
            // Duck-type check: Decimal instances have toFixed() and isZero() methods.
            return typeof data.toFixed === 'function' && typeof data.isZero === 'function' ? data.toString() : data;
        case 'object':
            {
                if (typeof data !== 'object' || Array.isArray(data)) {
                    return data;
                }
                const obj = data;
                const result = {};
                for (const key of Object.keys(obj)){
                    const fieldSchema = schema.fields[key];
                    result[key] = fieldSchema ? coerceV2RequestData(obj[key], fieldSchema) : obj[key];
                }
                return result;
            }
        case 'array':
            {
                if (!Array.isArray(data)) {
                    return data;
                }
                return data.map((element)=>coerceV2RequestData(element, schema.element));
            }
        case 'nullable':
            return coerceV2RequestData(data, schema.inner);
    }
};
const coerceV2ResponseData = (data, schema)=>{
    if (data == null) {
        return data;
    }
    switch(schema.kind){
        case 'int64_string':
            if (typeof data === 'string') {
                try {
                    return BigInt(data);
                } catch  {
                    throw new Error(`Failed to coerce int64_string value: expected an integer string, got '${data}'`);
                }
            }
            return data;
        case 'decimal_string':
            if (typeof data === 'string') {
                try {
                    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Decimal$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Decimal"].from(data);
                } catch  {
                    throw new Error(`Failed to coerce decimal_string value: expected a decimal string, got '${data}'`);
                }
            }
            return data;
        case 'object':
            {
                if (typeof data !== 'object' || Array.isArray(data)) {
                    return data;
                }
                const obj = data;
                for (const key of Object.keys(schema.fields)){
                    if (key in obj) {
                        obj[key] = coerceV2ResponseData(obj[key], schema.fields[key]);
                    }
                }
                return obj;
            }
        case 'array':
            {
                if (!Array.isArray(data)) {
                    return data;
                }
                for(let i = 0; i < data.length; i++){
                    data[i] = coerceV2ResponseData(data[i], schema.element);
                }
                return data;
            }
        case 'nullable':
            return coerceV2ResponseData(data, schema.inner);
    }
};
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/autoPagination.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "makeAutoPaginationMethods",
    ()=>makeAutoPaginationMethods
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/utils.js [app-route] (ecmascript)");
;
class V1Iterator {
    constructor(firstPagePromise, params, options, method, path, spec, stripeResource){
        this.index = 0;
        this.pagePromise = firstPagePromise;
        this.promiseCache = {
            currentPromise: null
        };
        this.params = params;
        this.options = options;
        this.method = method;
        this.path = path;
        this.spec = spec;
        this.stripeResource = stripeResource;
    }
    async iterate(pageResult) {
        if (!(pageResult && pageResult.data && typeof pageResult.data.length === 'number')) {
            throw Error('Unexpected: Stripe API response does not have a well-formed `data` array.');
        }
        const reverseIteration = !!this.params.ending_before;
        if (this.index < pageResult.data.length) {
            const idx = reverseIteration ? pageResult.data.length - 1 - this.index : this.index;
            const value = pageResult.data[idx];
            this.index += 1;
            return {
                value,
                done: false
            };
        } else if (pageResult.has_more) {
            // Reset counter, request next page, and recurse.
            this.index = 0;
            this.pagePromise = this.getNextPage(pageResult);
            const nextPageResult = await this.pagePromise;
            return this.iterate(nextPageResult);
        }
        return {
            done: true,
            value: undefined
        };
    }
    /** @abstract */ getNextPage(_pageResult) {
        throw new Error('Unimplemented');
    }
    async _next() {
        return this.iterate(await this.pagePromise);
    }
    next() {
        /**
         * If a user calls `.next()` multiple times in parallel,
         * return the same result until something has resolved
         * to prevent page-turning race conditions.
         */ if (this.promiseCache.currentPromise) {
            return this.promiseCache.currentPromise;
        }
        const nextPromise = (async ()=>{
            const ret = await this._next();
            this.promiseCache.currentPromise = null;
            return ret;
        })();
        this.promiseCache.currentPromise = nextPromise;
        return nextPromise;
    }
}
class V1ListIterator extends V1Iterator {
    getNextPage(pageResult) {
        const reverseIteration = !!this.params.ending_before;
        const lastId = getLastId(pageResult, reverseIteration);
        const nextParams = {
            ...this.params,
            [reverseIteration ? 'ending_before' : 'starting_after']: lastId
        };
        return this.stripeResource._makeRequest(this.method, this.path, nextParams, this.options, this.spec);
    }
}
class V1SearchIterator extends V1Iterator {
    getNextPage(pageResult) {
        if (!pageResult.next_page) {
            throw Error('Unexpected: Stripe API response does not have a well-formed `next_page` field, but `has_more` was true.');
        }
        const nextParams = {
            ...this.params,
            page: pageResult.next_page
        };
        return this.stripeResource._makeRequest(this.method, this.path, nextParams, this.options, this.spec);
    }
}
class V2ListIterator {
    constructor(firstPagePromise, options, spec, stripeResource){
        this.firstPagePromise = firstPagePromise;
        this.currentPageIterator = null;
        this.nextPageUrl = null;
        this.promiseCache = {
            currentPromise: null
        };
        this.options = options;
        this.spec = spec;
        this.stripeResource = stripeResource;
    }
    async initFirstPage() {
        if (this.firstPagePromise) {
            const page = await this.firstPagePromise;
            this.firstPagePromise = null;
            this.currentPageIterator = page.data[Symbol.iterator]();
            this.nextPageUrl = page.next_page_url || null;
        }
    }
    async turnPage() {
        if (!this.nextPageUrl) return null;
        const page = await this.stripeResource._makeRequest('GET', this.nextPageUrl, undefined, this.options, this.spec);
        this.nextPageUrl = page.next_page_url || null;
        this.currentPageIterator = page.data[Symbol.iterator]();
        return this.currentPageIterator;
    }
    async _next() {
        await this.initFirstPage();
        if (this.currentPageIterator) {
            const result = this.currentPageIterator.next();
            if (!result.done) return {
                done: false,
                value: result.value
            };
        }
        return this.nextFromNewPage();
    }
    async nextFromNewPage() {
        const nextPageIterator = await this.turnPage();
        if (!nextPageIterator) {
            return {
                done: true,
                value: undefined
            };
        }
        const result = nextPageIterator.next();
        if (!result.done) return {
            done: false,
            value: result.value
        };
        // Empty intermediate page — recurse to try the next page.
        return this.nextFromNewPage();
    }
    next() {
        /**
         * If a user calls `.next()` multiple times in parallel,
         * return the same result until something has resolved
         * to prevent page-turning race conditions.
         */ if (this.promiseCache.currentPromise) {
            return this.promiseCache.currentPromise;
        }
        const nextPromise = (async ()=>{
            try {
                return await this._next();
            } finally{
                this.promiseCache.currentPromise = null;
            }
        })();
        this.promiseCache.currentPromise = nextPromise;
        return nextPromise;
    }
}
const makeAutoPaginationMethods = (stripeResource, params, options, method, path, spec, firstPagePromise)=>{
    const apiMode = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getAPIMode"])(path);
    const methodType = spec?.methodType;
    if (apiMode !== 'v2' && methodType === 'search') {
        return makeAutoPaginationMethodsFromIterator(new V1SearchIterator(firstPagePromise, params, options, method, path, spec, stripeResource));
    }
    if (apiMode !== 'v2' && methodType === 'list') {
        return makeAutoPaginationMethodsFromIterator(new V1ListIterator(firstPagePromise, params, options, method, path, spec, stripeResource));
    }
    if (apiMode === 'v2' && methodType === 'list') {
        return makeAutoPaginationMethodsFromIterator(new V2ListIterator(firstPagePromise, options, spec, stripeResource));
    }
    return null;
};
const makeAutoPaginationMethodsFromIterator = (iterator)=>{
    const autoPagingEach = makeAutoPagingEach((...args)=>iterator.next(...args));
    const autoPagingToArray = makeAutoPagingToArray(autoPagingEach);
    const autoPaginationMethods = {
        autoPagingEach,
        autoPagingToArray,
        // Async iterator functions:
        next: ()=>iterator.next(),
        return: ()=>{
            // This is required for `break`.
            return {};
        },
        [getAsyncIteratorSymbol()]: ()=>{
            return autoPaginationMethods;
        }
    };
    return autoPaginationMethods;
};
/**
 * ----------------
 * Private Helpers:
 * ----------------
 */ function getAsyncIteratorSymbol() {
    if (typeof Symbol !== 'undefined' && Symbol.asyncIterator) {
        return Symbol.asyncIterator;
    }
    // Follow the convention from libraries like iterall: https://github.com/leebyron/iterall#asynciterator-1
    return '@@asyncIterator';
}
function getDoneCallback(args) {
    if (args.length < 2) {
        return null;
    }
    const onDone = args[1];
    if (typeof onDone !== 'function') {
        throw Error(`The second argument to autoPagingEach, if present, must be a callback function; received ${typeof onDone}`);
    }
    return onDone;
}
/**
 * We allow four forms of the `onItem` callback (the middle two being equivalent),
 *
 *   1. `.autoPagingEach((item) => { doSomething(item); return false; });`
 *   2. `.autoPagingEach(async (item) => { await doSomething(item); return false; });`
 *   3. `.autoPagingEach((item) => doSomething(item).then(() => false));`
 *   4. `.autoPagingEach((item, next) => { doSomething(item); next(false); });`
 *
 * In addition to standard validation, this helper
 * coalesces the former forms into the latter form.
 */ function getItemCallback(args) {
    if (args.length === 0) {
        return undefined;
    }
    const onItem = args[0];
    if (typeof onItem !== 'function') {
        throw Error(`The first argument to autoPagingEach, if present, must be a callback function; received ${typeof onItem}`);
    }
    // 4. `.autoPagingEach((item, next) => { doSomething(item); next(false); });`
    if (onItem.length === 2) {
        return onItem;
    }
    if (onItem.length > 2) {
        throw Error(`The \`onItem\` callback function passed to autoPagingEach must accept at most two arguments; got ${onItem}`);
    }
    // This magically handles all three of these usecases (the latter two being functionally identical):
    // 1. `.autoPagingEach((item) => { doSomething(item); return false; });`
    // 2. `.autoPagingEach(async (item) => { await doSomething(item); return false; });`
    // 3. `.autoPagingEach((item) => doSomething(item).then(() => false));`
    return function _onItem(item, next) {
        const shouldContinue = onItem(item);
        next(shouldContinue);
    };
}
function getLastId(listResult, reverseIteration) {
    const lastIdx = reverseIteration ? 0 : listResult.data.length - 1;
    const lastItem = listResult.data[lastIdx];
    const lastId = lastItem && lastItem.id;
    if (!lastId) {
        throw Error('Unexpected: No `id` found on the last item while auto-paging a list.');
    }
    return lastId;
}
function makeAutoPagingEach(asyncIteratorNext) {
    return function autoPagingEach() {
        // Capture the caller's stack before the async boundary. For paginated
        // requests, _makeRequest is called from autopagination internals, so the
        // stack it captures only contains SDK frames. We replace that here with
        // the true user call site.
        const callSiteStack = new Error().stack;
        const args = [].slice.call(arguments);
        const onItem = getItemCallback(args);
        const onDone = getDoneCallback(args);
        if (args.length > 2) {
            throw Error(`autoPagingEach takes up to two arguments; received ${args}`);
        }
        const autoPagePromise = wrapAsyncIteratorWithCallback(asyncIteratorNext, // @ts-ignore we might need a null check
        onItem).catch((err)=>{
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["attachCallSiteToError"])(err, callSiteStack);
            throw err;
        });
        if (onDone) {
            autoPagePromise.then(()=>onDone(), (err)=>onDone(err));
        }
        return autoPagePromise;
    };
}
function makeAutoPagingToArray(autoPagingEach) {
    return function autoPagingToArray(opts, onDone) {
        const callSiteStack = new Error().stack;
        const limit = opts && opts.limit;
        if (!limit) {
            throw Error('You must pass a `limit` option to autoPagingToArray, e.g., `autoPagingToArray({limit: 1000});`.');
        }
        if (limit > 10000) {
            throw Error('You cannot specify a limit of more than 10,000 items to fetch in `autoPagingToArray`; use `autoPagingEach` to iterate through longer lists.');
        }
        const promise = new Promise((resolve, reject)=>{
            const items = [];
            autoPagingEach((item)=>{
                items.push(item);
                if (items.length >= limit) {
                    return false;
                }
            }).then(()=>{
                resolve(items);
            }).catch((err)=>{
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["attachCallSiteToError"])(err, callSiteStack);
                reject(err);
            });
        });
        if (onDone) {
            promise.then((items)=>onDone(null, items), (err)=>onDone(err));
        }
        return promise;
    };
}
function wrapAsyncIteratorWithCallback(asyncIteratorNext, onItem) {
    return new Promise((resolve, reject)=>{
        function handleIteration(iterResult) {
            if (iterResult.done) {
                resolve();
                return;
            }
            const item = iterResult.value;
            return new Promise((next)=>{
                // Bit confusing, perhaps; we pass a `resolve` fn
                // to the user, so they can decide when and if to continue.
                // They can return false, or a promise which resolves to false, to break.
                onItem(item, next);
            }).then((shouldContinue)=>{
                if (shouldContinue === false) {
                    return handleIteration({
                        done: true,
                        value: undefined
                    });
                } else {
                    return asyncIteratorNext().then(handleIteration);
                }
            });
        }
        asyncIteratorNext().then(handleIteration).catch(reject);
    });
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/StripeResource.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "StripeResource",
    ()=>StripeResource
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/utils.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$V2Coercion$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/V2Coercion.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$autoPagination$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/autoPagination.js [app-route] (ecmascript)");
;
;
;
/**
 * Encapsulates request logic for a Stripe Resource
 */ class StripeResource {
    constructor(stripe, deprecatedUrlData){
        this.resourcePath = '';
        // Function to override the default data processor. This allows full control
        // over how a StripeResource's request data will get converted into an HTTP
        // body. This is useful for non-standard HTTP requests. The function should
        // take method name, data, and headers as arguments.
        this.requestDataProcessor = null;
        this._stripe = stripe;
        if (deprecatedUrlData) {
            throw new Error('Support for curried url params was dropped in stripe-node v7.0.0. Instead, pass two ids.');
        }
        this.basePath = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["makeURLInterpolator"])(// @ts-expect-error changing type of basePath
        this.basePath || stripe.getApiField('basePath'));
        // @ts-ignore changing type of path - path comes from prototype as string, convert to interpolator
        const rawPath = this.path || '';
        this.resourcePath = rawPath;
        this.path = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["makeURLInterpolator"])(rawPath);
        this.initialize(stripe, deprecatedUrlData);
    }
    initialize(_stripe, _deprecatedUrlData) {}
    _makeRequest(method, path, params, options, spec) {
        const requestMethod = method.toUpperCase();
        const encode = spec?.encode || ((data)=>data);
        const data = encode(params ? {
            ...params
        } : {});
        const processed = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["processOptions"])(options);
        const apiBase = processed.apiBase || spec?.apiBase || null;
        const host = apiBase ? this._stripe.resolveBaseAddress(apiBase) : null;
        const streaming = processed.streaming || !!spec?.streaming;
        const headers = Object.assign(processed.headers, spec?.headers);
        const usage = spec?.usage || [];
        const dataInQuery = requestMethod === 'GET' || requestMethod === 'DELETE';
        let bodyData = dataInQuery ? null : data;
        const queryData = dataInQuery ? data : {};
        try {
            if (spec?.validator) {
                spec.validator(data, {
                    headers
                });
            }
            // Coerce int64_string/decimal_string fields in request body
            if (spec?.requestSchema && bodyData) {
                bodyData = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$V2Coercion$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["coerceV2RequestData"])(bodyData, spec.requestSchema);
            }
        } catch (err) {
            return Promise.reject(err);
        }
        // Capture the caller's stack trace before the async boundary so errors can
        // include the user's call site, not just SDK internals.
        const callSiteStack = new Error().stack;
        const innerPromise = new Promise((resolve, reject)=>{
            function requestCallback(err, response) {
                if (err) {
                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["attachCallSiteToError"])(err, callSiteStack);
                    reject(err);
                } else {
                    try {
                        if (spec?.responseSchema) {
                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$V2Coercion$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["coerceV2ResponseData"])(response, spec.responseSchema);
                        }
                        resolve(spec?.transformResponseData ? spec.transformResponseData(response) : response);
                    } catch (e) {
                        reject(e);
                    }
                }
            }
            const emptyQuery = Object.keys(queryData).length === 0;
            const fullPath = [
                path,
                emptyQuery ? '' : '?',
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["queryStringifyRequestData"])(queryData)
            ].join('');
            this._stripe._requestSender._request(requestMethod, host, fullPath, bodyData, processed.authenticator, {
                headers,
                settings: processed.settings,
                streaming
            }, usage, requestCallback, this.requestDataProcessor?.bind(this));
        });
        // Attach auto-pagination methods for list/search endpoints
        if (spec?.methodType) {
            Object.assign(innerPromise, (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$autoPagination$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["makeAutoPaginationMethods"])(this, params ? {
                ...params
            } : {}, options, requestMethod, path, spec, innerPromise));
        }
        return innerPromise;
    }
}
StripeResource.MAX_BUFFERED_REQUEST_METRICS = 100;
;
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/StripeContext.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * The StripeContext class provides an immutable container and convenience methods for interacting with the `Stripe-Context` header. All methods return a new instance of StripeContext.
 * You can use it whenever you're initializing a `Stripe` instance or sending `stripeContext` with a request. It's also found in the `EventNotification.context` property.
 */ __turbopack_context__.s([
    "StripeContext",
    ()=>StripeContext
]);
class StripeContext {
    /**
     * Creates a new StripeContext with the given segments.
     */ constructor(segments = []){
        this._segments = [
            ...segments
        ];
    }
    /**
     * Gets a copy of the segments of this Context.
     */ get segments() {
        return [
            ...this._segments
        ];
    }
    /**
     * Creates a new StripeContext with an additional segment appended.
     */ push(segment) {
        if (!segment) {
            throw new Error('Segment cannot be null or undefined');
        }
        return new StripeContext([
            ...this._segments,
            segment
        ]);
    }
    /**
     * Creates a new StripeContext with the last segment removed.
     * If there are no segments, throws an error.
     */ pop() {
        if (this._segments.length === 0) {
            throw new Error('Cannot pop from an empty context');
        }
        return new StripeContext(this._segments.slice(0, -1));
    }
    /**
     * Converts this context to its string representation.
     */ toString() {
        return this._segments.join('/');
    }
    /**
     * Parses a context string into a StripeContext instance.
     */ static parse(contextStr) {
        if (!contextStr) {
            return new StripeContext([]);
        }
        return new StripeContext(contextStr.split('/'));
    }
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/crypto/CryptoProvider.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Interface encapsulating the various crypto computations used by the library,
 * allowing pluggable underlying crypto implementations.
 *
 * Implementations can choose which methods they want to implement (eg. a
 * CryptoProvider can be used which only implements the asynchronous
 * versions of each crypto computation).
 */ __turbopack_context__.s([
    "CryptoProvider",
    ()=>CryptoProvider,
    "CryptoProviderOnlySupportsAsyncError",
    ()=>CryptoProviderOnlySupportsAsyncError
]);
class CryptoProvider {
    /**
     * Computes a SHA-256 HMAC given a secret and a payload (encoded in UTF-8).
     * The output HMAC should be encoded in hexadecimal.
     *
     * Sample values for implementations:
     * - computeHMACSignature('', 'test_secret') => 'f7f9bd47fb987337b5796fdc1fdb9ba221d0d5396814bfcaf9521f43fd8927fd'
     * - computeHMACSignature('\ud83d\ude00', 'test_secret') => '837da296d05c4fe31f61d5d7ead035099d9585a5bcde87de952012a78f0b0c43
     */ computeHMACSignature(payload, secret) {
        throw new Error('computeHMACSignature not implemented.');
    }
    /**
     * Asynchronous version of `computeHMACSignature`. Some implementations may
     * only allow support async signature computation.
     *
     * Computes a SHA-256 HMAC given a secret and a payload (encoded in UTF-8).
     * The output HMAC should be encoded in hexadecimal.
     *
     * Sample values for implementations:
     * - computeHMACSignature('', 'test_secret') => 'f7f9bd47fb987337b5796fdc1fdb9ba221d0d5396814bfcaf9521f43fd8927fd'
     * - computeHMACSignature('\ud83d\ude00', 'test_secret') => '837da296d05c4fe31f61d5d7ead035099d9585a5bcde87de952012a78f0b0c43
     */ computeHMACSignatureAsync(payload, secret) {
        throw new Error('computeHMACSignatureAsync not implemented.');
    }
    /**
     * Computes a SHA-256 hash of the data.
     */ computeSHA256Async(data) {
        throw new Error('computeSHA256 not implemented.');
    }
}
class CryptoProviderOnlySupportsAsyncError extends Error {
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/crypto/NodeCryptoProvider.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "NodeCryptoProvider",
    ()=>NodeCryptoProvider
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/crypto [external] (crypto, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$CryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/crypto/CryptoProvider.js [app-route] (ecmascript)");
;
;
class NodeCryptoProvider extends __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$CryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CryptoProvider"] {
    /** @override */ computeHMACSignature(payload, secret) {
        return __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["createHmac"]('sha256', secret).update(payload, 'utf8').digest('hex');
    }
    /** @override */ async computeHMACSignatureAsync(payload, secret) {
        const signature = await this.computeHMACSignature(payload, secret);
        return signature;
    }
    /** @override */ async computeSHA256Async(data) {
        return new Uint8Array(await __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["createHash"]('sha256').update(data).digest());
    }
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/crypto/SubtleCryptoProvider.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SubtleCryptoProvider",
    ()=>SubtleCryptoProvider
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$CryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/crypto/CryptoProvider.js [app-route] (ecmascript)");
;
class SubtleCryptoProvider extends __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$CryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CryptoProvider"] {
    constructor(subtleCrypto){
        super();
        // If no subtle crypto is interface, default to the global namespace. This
        // is to allow custom interfaces (eg. using the Node webcrypto interface in
        // tests).
        this.subtleCrypto = subtleCrypto || crypto.subtle;
    }
    /** @override */ computeHMACSignature(payload, secret) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$CryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CryptoProviderOnlySupportsAsyncError"]('SubtleCryptoProvider cannot be used in a synchronous context.');
    }
    /** @override */ async computeHMACSignatureAsync(payload, secret) {
        const encoder = new TextEncoder();
        const key = await this.subtleCrypto.importKey('raw', encoder.encode(secret), {
            name: 'HMAC',
            hash: {
                name: 'SHA-256'
            }
        }, false, [
            'sign'
        ]);
        const signatureBuffer = await this.subtleCrypto.sign('hmac', key, encoder.encode(payload));
        // crypto.subtle returns the signature in base64 format. This must be
        // encoded in hex to match the CryptoProvider contract. We map each byte in
        // the buffer to its corresponding hex octet and then combine into a string.
        const signatureBytes = new Uint8Array(signatureBuffer);
        const signatureHexCodes = new Array(signatureBytes.length);
        for(let i = 0; i < signatureBytes.length; i++){
            signatureHexCodes[i] = byteHexMapping[signatureBytes[i]];
        }
        return signatureHexCodes.join('');
    }
    /** @override */ async computeSHA256Async(data) {
        return new Uint8Array(await this.subtleCrypto.digest('SHA-256', data));
    }
}
// Cached mapping of byte to hex representation. We do this once to avoid re-
// computing every time we need to convert the result of a signature to hex.
const byteHexMapping = new Array(256);
for(let i = 0; i < byteHexMapping.length; i++){
    byteHexMapping[i] = i.toString(16).padStart(2, '0');
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/platform/PlatformFunctions.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "PlatformFunctions",
    ()=>PlatformFunctions
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$FetchHttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/net/FetchHttpClient.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$SubtleCryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/crypto/SubtleCryptoProvider.js [app-route] (ecmascript)");
;
;
class PlatformFunctions {
    constructor(){
        this._fetchFn = null;
        this._agent = null;
    }
    /**
     * Returns platform info string for telemetry, or null if unavailable.
     */ getPlatformInfo() {
        return null;
    }
    getSourceHash() {
        return null;
    }
    /**
     * Emits a warning. Node.js uses process.emitWarning; other runtimes
     * fall back to console.warn.
     */ emitWarning(warning) {
        /* eslint-disable no-console */ console.warn(`Stripe: ${warning}`);
    /* eslint-enable no-console */ }
    /**
     * Returns environment variables, or null if unavailable.
     */ getEnv() {
        return null;
    }
    /**
     * Returns the runtime version string, or null if unavailable.
     */ getRuntimeVersion() {
        return null;
    }
    /**
     * Generates a v4 UUID. See https://stackoverflow.com/a/2117523
     */ uuid4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c)=>{
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : r & 0x3 | 0x8;
            return v.toString(16);
        });
    }
    /**
     * Compares strings in constant time.
     */ secureCompare(a, b) {
        // return early here if buffer lengths are not equal
        if (a.length !== b.length) {
            return false;
        }
        const len = a.length;
        let result = 0;
        for(let i = 0; i < len; ++i){
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    }
    /**
     * Creates an event emitter.
     */ createEmitter() {
        throw new Error('createEmitter not implemented.');
    }
    /**
     * Checks if the request data is a stream. If so, read the entire stream
     * to a buffer and return the buffer.
     */ tryBufferData(data) {
        throw new Error('tryBufferData not implemented.');
    }
    /**
     * Creates an HTTP client which uses the Node `http` and `https` packages
     * to issue requests.
     */ createNodeHttpClient(agent) {
        throw new Error('createNodeHttpClient not implemented.');
    }
    /**
     * Creates an HTTP client for issuing Stripe API requests which uses the Web
     * Fetch API.
     *
     * A fetch function can optionally be passed in as a parameter. If none is
     * passed, will default to the default `fetch` function in the global scope.
     */ createFetchHttpClient(fetchFn) {
        return new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$FetchHttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["FetchHttpClient"](fetchFn);
    }
    /**
     * Creates an HTTP client using runtime-specific APIs.
     */ createDefaultHttpClient() {
        throw new Error('createDefaultHttpClient not implemented.');
    }
    /**
     * Creates a CryptoProvider which uses the Node `crypto` package for its computations.
     */ createNodeCryptoProvider() {
        throw new Error('createNodeCryptoProvider not implemented.');
    }
    /**
     * Creates a CryptoProvider which uses the SubtleCrypto interface of the Web Crypto API.
     */ createSubtleCryptoProvider(subtleCrypto) {
        return new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$SubtleCryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SubtleCryptoProvider"](subtleCrypto);
    }
    createDefaultCryptoProvider() {
        throw new Error('createDefaultCryptoProvider not implemented.');
    }
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/platform/NodePlatformFunctions.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "NodePlatformFunctions",
    ()=>NodePlatformFunctions
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/crypto [external] (crypto, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/os [external] (os, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$events__$5b$external$5d$__$28$events$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/events [external] (events, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$NodeCryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/crypto/NodeCryptoProvider.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$NodeHttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/net/NodeHttpClient.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$platform$2f$PlatformFunctions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/platform/PlatformFunctions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Error.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/utils.js [app-route] (ecmascript)");
;
;
;
;
;
;
;
;
class StreamProcessingError extends __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeError"] {
}
class NodePlatformFunctions extends __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$platform$2f$PlatformFunctions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PlatformFunctions"] {
    /** @override */ uuid4() {
        // available in: v14.17.x+
        if (__TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["randomUUID"]) {
            return __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["randomUUID"]();
        }
        return super.uuid4();
    }
    /** @override */ getPlatformInfo() {
        return `${process.platform} ${__TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__["release"]()} ${__TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__["arch"]()}`;
    }
    /** @override */ emitWarning(warning) {
        if (typeof process.emitWarning === 'function') {
            process.emitWarning(warning, 'Stripe');
        } else {
            super.emitWarning(warning);
        }
    }
    /** @override */ getEnv() {
        return process.env;
    }
    /** @override */ getRuntimeVersion() {
        return process.version;
    }
    getUname() {
        try {
            const parts = [
                __TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__["type"](),
                __TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__["release"](),
                __TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__["arch"]()
            ];
            // os.version() returns detailed kernel version, available since Node 10.7.0
            // It may not exist in older typings, so access carefully
            const version = __TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__["version"]?.();
            if (version) parts.push(version);
            try {
                parts.push(__TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__["hostname"]());
            // eslint-disable-next-line no-empty
            } catch (_e) {}
            return parts.join(' ');
        } catch  {
            return null;
        }
    }
    /** @override */ getSourceHash() {
        try {
            const uname = this.getUname();
            return uname ? __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["createHash"]('md5').update(uname).digest('hex') : null;
        } catch  {
            return null;
        }
    }
    /**
     * @override
     * Secure compare, from https://github.com/freewil/scmp
     */ secureCompare(a, b) {
        if (!a || !b) {
            throw new Error('secureCompare must receive two arguments');
        }
        // return early here if buffer lengths are not equal since timingSafeEqual
        // will throw if buffer lengths are not equal
        if (a.length !== b.length) {
            return false;
        }
        // use crypto.timingSafeEqual if available (since Node.js v6.6.0),
        // otherwise use our own scmp-internal function.
        if (__TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["timingSafeEqual"]) {
            const textEncoder = new TextEncoder();
            const aEncoded = textEncoder.encode(a);
            const bEncoded = textEncoder.encode(b);
            return __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["timingSafeEqual"](aEncoded, bEncoded);
        }
        return super.secureCompare(a, b);
    }
    createEmitter() {
        return new __TURBOPACK__imported__module__$5b$externals$5d2f$events__$5b$external$5d$__$28$events$2c$__cjs$29$__["EventEmitter"]();
    }
    /** @override */ tryBufferData(data) {
        if (!(data.file.data instanceof __TURBOPACK__imported__module__$5b$externals$5d2f$events__$5b$external$5d$__$28$events$2c$__cjs$29$__["EventEmitter"])) {
            return Promise.resolve(data);
        }
        const bufferArray = [];
        return new Promise((resolve, reject)=>{
            data.file.data.on('data', (line)=>{
                bufferArray.push(line);
            }).once('end', ()=>{
                // @ts-ignore
                const bufferData = Object.assign({}, data);
                bufferData.file.data = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["concat"])(bufferArray);
                resolve(bufferData);
            }).on('error', (err)=>{
                reject(new StreamProcessingError({
                    message: 'An error occurred while attempting to process the file for upload.',
                    detail: err
                }));
            });
        });
    }
    /** @override */ createNodeHttpClient(agent) {
        return new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$NodeHttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NodeHttpClient"](agent);
    }
    /** @override */ createDefaultHttpClient() {
        return new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$NodeHttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NodeHttpClient"]();
    }
    /** @override */ createNodeCryptoProvider() {
        return new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$NodeCryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NodeCryptoProvider"]();
    }
    /** @override */ createDefaultCryptoProvider() {
        return this.createNodeCryptoProvider();
    }
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Webhooks.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createWebhooks",
    ()=>createWebhooks
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Error.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$CryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/crypto/CryptoProvider.js [app-route] (ecmascript)");
;
;
function createWebhooks(platformFunctions) {
    const Webhook = {
        DEFAULT_TOLERANCE: 300,
        signature: null,
        constructEvent (payload, header, secret, tolerance, cryptoProvider, receivedAt) {
            try {
                if (!this.signature) {
                    throw new Error('ERR: missing signature helper, unable to verify');
                }
                cryptoProvider = cryptoProvider || getCryptoProvider();
                this.signature.verifyHeader(payload, header, secret, tolerance || Webhook.DEFAULT_TOLERANCE, cryptoProvider, receivedAt);
            } catch (e) {
                if (e instanceof __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$CryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CryptoProviderOnlySupportsAsyncError"]) {
                    e.message += '\nUse `await constructEventAsync(...)` instead of `constructEvent(...)`';
                }
                throw e;
            }
            const jsonPayload = payload instanceof Uint8Array ? JSON.parse(new TextDecoder('utf8').decode(payload)) : JSON.parse(payload);
            if (jsonPayload && jsonPayload.object === 'v2.core.event') {
                throw new Error('You passed an event notification to stripe.webhooks.constructEvent, which expects a webhook payload. Use stripe.parseEventNotification instead.');
            }
            return jsonPayload;
        },
        async constructEventAsync (payload, header, secret, tolerance, cryptoProvider, receivedAt) {
            if (!this.signature) {
                throw new Error('ERR: missing signature helper, unable to verify');
            }
            cryptoProvider = cryptoProvider || getCryptoProvider();
            await this.signature.verifyHeaderAsync(payload, header, secret, tolerance || Webhook.DEFAULT_TOLERANCE, cryptoProvider, receivedAt);
            const jsonPayload = payload instanceof Uint8Array ? JSON.parse(new TextDecoder('utf8').decode(payload)) : JSON.parse(payload);
            if (jsonPayload && jsonPayload.object === 'v2.core.event') {
                throw new Error('You passed an event notification to stripe.webhooks.constructEvent, which expects a webhook payload. Use stripe.parseEventNotificationAsync instead.');
            }
            return jsonPayload;
        },
        /**
         * Generates a header to be used for webhook mocking
         *
         * @typedef {object} opts
         * @property {number} timestamp - Timestamp of the header. Defaults to Date.now()
         * @property {string} payload - JSON stringified payload object, containing the 'id' and 'object' parameters
         * @property {string} secret - Stripe webhook secret 'whsec_...'
         * @property {string} scheme - Version of API to hit. Defaults to 'v1'.
         * @property {string} signature - Computed webhook signature
         * @property {CryptoProvider} cryptoProvider - Crypto provider to use for computing the signature if none was provided. Defaults to NodeCryptoProvider.
         */ generateTestHeaderString: function(opts) {
            const preparedOpts = prepareOptions(opts);
            const signature = preparedOpts.signature || preparedOpts.cryptoProvider.computeHMACSignature(preparedOpts.payloadString, preparedOpts.secret);
            return preparedOpts.generateHeaderString(signature);
        },
        generateTestHeaderStringAsync: async function(opts) {
            const preparedOpts = prepareOptions(opts);
            const signature = preparedOpts.signature || await preparedOpts.cryptoProvider.computeHMACSignatureAsync(preparedOpts.payloadString, preparedOpts.secret);
            return preparedOpts.generateHeaderString(signature);
        }
    };
    const signature = {
        EXPECTED_SCHEME: 'v1',
        verifyHeader (encodedPayload, encodedHeader, secret, tolerance, cryptoProvider, receivedAt) {
            const { decodedHeader: header, decodedPayload: payload, details, suspectPayloadType } = parseEventDetails(encodedPayload, encodedHeader, this.EXPECTED_SCHEME);
            const secretContainsWhitespace = /\s/.test(secret);
            cryptoProvider = cryptoProvider || getCryptoProvider();
            const expectedSignature = cryptoProvider.computeHMACSignature(makeHMACContent(payload, details), secret);
            /**
             * TODO(MAJOR): https://go/j/DEVSDK-3087
             * Passing in 0 by default skips timestamp tolerance verifications. Although it is mostly used in test,
             * we should change the default behavior to pass DEFAULT_TOLERANCE instead of 0 in the next major.
             */ validateComputedSignature(payload, header, details, expectedSignature, tolerance || 0, suspectPayloadType, secretContainsWhitespace, receivedAt);
            return true;
        },
        async verifyHeaderAsync (encodedPayload, encodedHeader, secret, tolerance, cryptoProvider, receivedAt) {
            const { decodedHeader: header, decodedPayload: payload, details, suspectPayloadType } = parseEventDetails(encodedPayload, encodedHeader, this.EXPECTED_SCHEME);
            const secretContainsWhitespace = /\s/.test(secret);
            cryptoProvider = cryptoProvider || getCryptoProvider();
            const expectedSignature = await cryptoProvider.computeHMACSignatureAsync(makeHMACContent(payload, details), secret);
            /**
             * TODO(MAJOR): https://go/j/DEVSDK-3087
             * Passing in 0 by default skips timestamp tolerance verifications. Although it is mostly used in test,
             * we should change the default behavior to pass DEFAULT_TOLERANCE instead of 0 in the next major.
             */ return validateComputedSignature(payload, header, details, expectedSignature, tolerance || 0, suspectPayloadType, secretContainsWhitespace, receivedAt);
        }
    };
    function makeHMACContent(payload, details) {
        return `${details.timestamp}.${payload}`;
    }
    function parseEventDetails(encodedPayload, encodedHeader, expectedScheme) {
        // Express's type for `Request#headers` is `string | []string`
        // which is because the `set-cookie` header is an array,
        // but no other headers are an array (docs: https://nodejs.org/api/http.html#http_message_headers)
        // (Express's Request class is an extension of http.IncomingMessage, and doesn't appear to be relevantly modified: https://github.com/expressjs/express/blob/master/lib/request.js#L31)
        if (Array.isArray(encodedHeader)) {
            throw new Error('Unexpected: An array was passed as a header, which should not be possible for the stripe-signature header.');
        }
        if (!encodedPayload) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeSignatureVerificationError"](encodedHeader, encodedPayload, {
                message: 'No webhook payload was provided.'
            });
        }
        const suspectPayloadType = typeof encodedPayload != 'string' && !(encodedPayload instanceof Uint8Array);
        const textDecoder = new TextDecoder('utf8');
        const decodedPayload = encodedPayload instanceof Uint8Array ? textDecoder.decode(encodedPayload) : encodedPayload;
        if (encodedHeader == null || encodedHeader == '') {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeSignatureVerificationError"](encodedHeader, encodedPayload, {
                message: 'No stripe-signature header value was provided.'
            });
        }
        const decodedHeader = encodedHeader instanceof Uint8Array ? textDecoder.decode(encodedHeader) : encodedHeader;
        const details = parseHeader(decodedHeader, expectedScheme);
        if (!details || details.timestamp === -1) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeSignatureVerificationError"](decodedHeader, decodedPayload, {
                message: 'Unable to extract timestamp and signatures from header'
            });
        }
        if (!details.signatures.length) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeSignatureVerificationError"](decodedHeader, decodedPayload, {
                message: 'No signatures found with expected scheme'
            });
        }
        return {
            decodedPayload,
            decodedHeader,
            details,
            suspectPayloadType
        };
    }
    /**
     * Validates that at least one signature in the parsed header matches the
     * expected signature, and that the event timestamp is within the allowed
     * {@link tolerance} window (in seconds). Set `tolerance` to `0` to skip
     * timestamp verification.
     *
     * TODO(MAJOR): https://go/j/DEVSDK-3087 - Change this default behavior to use DEFAULT_TOLERANCE instead of 0.
     * By default, validateComputedSignature doesn't perform timestamp verification.
     *
     * This method is mostly meant for tests or offline processing where the delivery time
     * of the event isn't important.
     * Integrations that process webhooks as they come in should use constructEvent method instead.
     *
     * @param payload The decoded webhook payload string.
     * @param header  The decoded `stripe-signature` header value.
     * @param details Parsed header containing timestamp and signatures.
     * @param expectedSignature HMAC signature computed from the payload and secret.
     * @param tolerance Maximum allowed age of the event in seconds. Use 0 to skip timestamp tolerance verification.
     * @param suspectPayloadType Whether the payload was not a string or Buffer.
     * @param secretContainsWhitespace Whether the signing secret contains whitespace.
     * @param receivedAt - Timestamp for age calculation
     * @returns `true` if the signature and timestamp are valid.
     *
     * @throws {StripeSignatureVerificationError} If verification fails.
     */ function validateComputedSignature(payload, header, details, expectedSignature, tolerance, suspectPayloadType, secretContainsWhitespace, receivedAt) {
        const signatureFound = !!details.signatures.filter(platformFunctions.secureCompare.bind(platformFunctions, expectedSignature)).length;
        const docsLocation = '\nLearn more about webhook signing and explore webhook integration examples for various frameworks at ' + 'https://docs.stripe.com/webhooks/signature';
        const whitespaceMessage = secretContainsWhitespace ? '\n\nNote: The provided signing secret contains whitespace. This often indicates an extra newline or space is in the value' : '';
        if (!signatureFound) {
            if (suspectPayloadType) {
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeSignatureVerificationError"](header, payload, {
                    message: 'Webhook payload must be provided as a string or a Buffer (https://nodejs.org/api/buffer.html) instance representing the _raw_ request body.' + 'Payload was provided as a parsed JavaScript object instead. \n' + 'Signature verification is impossible without access to the original signed material. \n' + docsLocation + '\n' + whitespaceMessage
                });
            }
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeSignatureVerificationError"](header, payload, {
                message: 'No signatures found matching the expected signature for payload.' + ' Are you passing the raw request body you received from Stripe? \n' + ' If a webhook request is being forwarded by a third-party tool,' + ' ensure that the exact request body, including JSON formatting and new line style, is preserved.\n' + docsLocation + '\n' + whitespaceMessage
            });
        }
        const timestampAge = Math.floor((typeof receivedAt === 'number' ? receivedAt : Date.now()) / 1000) - details.timestamp;
        if (tolerance > 0 && timestampAge > tolerance) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeSignatureVerificationError"](header, payload, {
                message: 'Timestamp outside the tolerance zone'
            });
        }
        return true;
    }
    function parseHeader(header, scheme) {
        if (typeof header !== 'string') {
            return null;
        }
        scheme = scheme || signature.EXPECTED_SCHEME;
        return header.split(',').reduce((accum, item)=>{
            const kv = item.split('=');
            if (kv[0] === 't') {
                accum.timestamp = parseInt(kv[1], 10);
            }
            if (kv[0] === scheme) {
                accum.signatures.push(kv[1]);
            }
            return accum;
        }, {
            timestamp: -1,
            signatures: []
        });
    }
    let webhooksCryptoProviderInstance = null;
    /**
     * Lazily instantiate a CryptoProvider instance. This is a stateless object
     * so a singleton can be used here.
     */ function getCryptoProvider() {
        if (!webhooksCryptoProviderInstance) {
            webhooksCryptoProviderInstance = platformFunctions.createDefaultCryptoProvider();
        }
        return webhooksCryptoProviderInstance;
    }
    function prepareOptions(opts) {
        if (!opts) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeError"]({
                message: 'Options are required'
            });
        }
        const timestamp = opts.timestamp && Math.floor(opts.timestamp) || Math.floor(Date.now() / 1000);
        const scheme = opts.scheme || signature.EXPECTED_SCHEME;
        const cryptoProvider = opts.cryptoProvider || getCryptoProvider();
        const payloadString = `${timestamp}.${opts.payload}`;
        const generateHeaderString = (signature)=>{
            return `t=${timestamp},${scheme}=${signature}`;
        };
        return {
            ...opts,
            timestamp,
            scheme,
            cryptoProvider,
            payloadString,
            generateHeaderString
        };
    }
    Webhook.signature = signature;
    return Webhook;
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/apiVersion.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// File generated from our OpenAPI spec
__turbopack_context__.s([
    "ApiMajorVersion",
    ()=>ApiMajorVersion,
    "ApiVersion",
    ()=>ApiVersion
]);
const ApiVersion = '2026-06-24.dahlia';
const ApiMajorVersion = 'dahlia';
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/ResourceNamespace.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "resourceNamespace",
    ()=>resourceNamespace
]);
// ResourceNamespace allows you to create nested resources, i.e. `stripe.issuing.cards`.
// It also works recursively, so you could do i.e. `stripe.billing.invoicing.pay`.
function ResourceNamespace(stripe, resources) {
    for(const name in resources){
        if (!Object.prototype.hasOwnProperty.call(resources, name)) {
            continue;
        }
        const camelCaseName = name[0].toLowerCase() + name.substring(1);
        const resource = new resources[name](stripe);
        this[camelCaseName] = resource;
    }
}
function resourceNamespace(namespace, resources) {
    return function(stripe) {
        return new ResourceNamespace(stripe, resources);
    };
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/multipart.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "multipartRequestDataProcessor",
    ()=>multipartRequestDataProcessor
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/utils.js [app-route] (ecmascript)");
;
// Method for formatting HTTP body for the multipart/form-data specification
// Mostly taken from Fermata.js
// https://github.com/natevw/fermata/blob/5d9732a33d776ce925013a265935facd1626cc88/fermata.js#L315-L343
const multipartDataGenerator = (method, data, headers)=>{
    const segno = (Math.round(Math.random() * 1e16) + Math.round(Math.random() * 1e16)).toString();
    headers['Content-Type'] = `multipart/form-data; boundary=${segno}`;
    const textEncoder = new TextEncoder();
    let buffer = new Uint8Array(0);
    const endBuffer = textEncoder.encode('\r\n');
    function push(l) {
        const prevBuffer = buffer;
        const newBuffer = l instanceof Uint8Array ? l : new Uint8Array(textEncoder.encode(l));
        buffer = new Uint8Array(prevBuffer.length + newBuffer.length + 2);
        buffer.set(prevBuffer);
        buffer.set(newBuffer, prevBuffer.length);
        buffer.set(endBuffer, buffer.length - 2);
    }
    function q(s) {
        return `"${s.replace(/"|"/g, '%22').replace(/\r\n|\r|\n/g, ' ')}"`;
    }
    const flattenedData = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["flattenAndStringify"])(data);
    for(const k in flattenedData){
        if (!Object.prototype.hasOwnProperty.call(flattenedData, k)) {
            continue;
        }
        const v = flattenedData[k];
        push(`--${segno}`);
        if (Object.prototype.hasOwnProperty.call(v, 'data')) {
            const typedEntry = v;
            push(`Content-Disposition: form-data; name=${q(k)}; filename=${q(typedEntry.name || 'blob')}`);
            push(`Content-Type: ${typedEntry.type || 'application/octet-stream'}`);
            push('');
            push(typedEntry.data);
        } else {
            push(`Content-Disposition: form-data; name=${q(k)}`);
            push('');
            push(v);
        }
    }
    push(`--${segno}--`);
    return buffer;
};
function multipartRequestDataProcessor(method, data, headers, callback) {
    data = data || {};
    if (method !== 'POST') {
        return callback(null, (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["queryStringifyRequestData"])(data));
    }
    this._stripe._platformFunctions.tryBufferData(data).then((bufferedData)=>{
        const buffer = multipartDataGenerator(method, bufferedData, headers);
        return callback(null, buffer);
    }).catch((err)=>callback(err, null));
}
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources.js [app-route] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Apps",
    ()=>Apps,
    "Billing",
    ()=>Billing,
    "BillingPortal",
    ()=>BillingPortal,
    "Checkout",
    ()=>Checkout,
    "Climate",
    ()=>Climate,
    "Entitlements",
    ()=>Entitlements,
    "FinancialConnections",
    ()=>FinancialConnections,
    "Forwarding",
    ()=>Forwarding,
    "Identity",
    ()=>Identity,
    "Issuing",
    ()=>Issuing,
    "Radar",
    ()=>Radar,
    "Reporting",
    ()=>Reporting,
    "Sigma",
    ()=>Sigma,
    "Tax",
    ()=>Tax,
    "Terminal",
    ()=>Terminal,
    "TestHelpers",
    ()=>TestHelpers,
    "Treasury",
    ()=>Treasury,
    "V2",
    ()=>V2
]);
// File generated from our OpenAPI spec
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/ResourceNamespace.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Core$2f$AccountLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/V2/Core/AccountLinks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Core$2f$AccountTokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/V2/Core/AccountTokens.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FinancialConnections$2f$Accounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/FinancialConnections/Accounts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Core$2f$Accounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/V2/Core/Accounts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Entitlements$2f$ActiveEntitlements$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Entitlements/ActiveEntitlements.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$Alerts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Billing/Alerts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$Associations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Tax/Associations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Authorizations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Issuing/Authorizations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Issuing$2f$Authorizations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Issuing/Authorizations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$Calculations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Tax/Calculations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Cardholders$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Issuing/Cardholders.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Cards$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Issuing/Cards.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Issuing$2f$Cards$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Issuing/Cards.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BillingPortal$2f$Configurations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/BillingPortal/Configurations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$Configurations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Terminal/Configurations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$ConfirmationTokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/ConfirmationTokens.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$ConnectionTokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Terminal/ConnectionTokens.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$CreditBalanceSummary$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Billing/CreditBalanceSummary.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$CreditBalanceTransactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Billing/CreditBalanceTransactions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$CreditGrants$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Billing/CreditGrants.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$CreditReversals$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Treasury/CreditReversals.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Customers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Customers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$DebitReversals$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Treasury/DebitReversals.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Disputes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Issuing/Disputes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Radar$2f$EarlyFraudWarnings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Radar/EarlyFraudWarnings.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Core$2f$EventDestinations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/V2/Core/EventDestinations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Core$2f$Events$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/V2/Core/Events.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Entitlements$2f$Features$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Entitlements/Features.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$FinancialAccounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Treasury/FinancialAccounts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Commerce$2f$ProductCatalog$2f$Imports$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/V2/Commerce/ProductCatalog/Imports.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Treasury$2f$InboundTransfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Treasury/InboundTransfers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$InboundTransfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Treasury/InboundTransfers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$Locations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Terminal/Locations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$MeterEventAdjustments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Billing/MeterEventAdjustments.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Billing$2f$MeterEventAdjustments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/V2/Billing/MeterEventAdjustments.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Billing$2f$MeterEventSession$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/V2/Billing/MeterEventSession.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Billing$2f$MeterEventStream$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/V2/Billing/MeterEventStream.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$MeterEvents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Billing/MeterEvents.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Billing$2f$MeterEvents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/V2/Billing/MeterEvents.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$Meters$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Billing/Meters.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$OnboardingLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Terminal/OnboardingLinks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Climate$2f$Orders$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Climate/Orders.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Treasury$2f$OutboundPayments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Treasury/OutboundPayments.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$OutboundPayments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Treasury/OutboundPayments.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Treasury$2f$OutboundTransfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Treasury/OutboundTransfers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$OutboundTransfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Treasury/OutboundTransfers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Radar$2f$PaymentEvaluations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Radar/PaymentEvaluations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$PersonalizationDesigns$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Issuing/PersonalizationDesigns.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Issuing$2f$PersonalizationDesigns$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Issuing/PersonalizationDesigns.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$PhysicalBundles$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Issuing/PhysicalBundles.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Climate$2f$Products$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Climate/Products.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$Readers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Terminal/Readers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Terminal$2f$Readers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Terminal/Readers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Treasury$2f$ReceivedCredits$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Treasury/ReceivedCredits.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$ReceivedCredits$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Treasury/ReceivedCredits.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Treasury$2f$ReceivedDebits$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Treasury/ReceivedDebits.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$ReceivedDebits$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Treasury/ReceivedDebits.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Refunds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Refunds.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$Registrations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Tax/Registrations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Reporting$2f$ReportRuns$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Reporting/ReportRuns.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Reporting$2f$ReportTypes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Reporting/ReportTypes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Forwarding$2f$Requests$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Forwarding/Requests.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Sigma$2f$ScheduledQueryRuns$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Sigma/ScheduledQueryRuns.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Apps$2f$Secrets$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Apps/Secrets.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BillingPortal$2f$Sessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/BillingPortal/Sessions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Checkout$2f$Sessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Checkout/Sessions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FinancialConnections$2f$Sessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/FinancialConnections/Sessions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$Settings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Tax/Settings.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Climate$2f$Suppliers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Climate/Suppliers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$TestClocks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/TestClocks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Tokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Issuing/Tokens.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$TransactionEntries$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Treasury/TransactionEntries.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FinancialConnections$2f$Transactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/FinancialConnections/Transactions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Transactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Issuing/Transactions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$Transactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Tax/Transactions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Issuing$2f$Transactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/Issuing/Transactions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$Transactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Treasury/Transactions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Radar$2f$ValueListItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Radar/ValueListItems.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Radar$2f$ValueLists$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Radar/ValueLists.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Identity$2f$VerificationReports$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Identity/VerificationReports.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Identity$2f$VerificationSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Identity/VerificationSessions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Accounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Accounts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$AccountLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/AccountLinks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$AccountSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/AccountSessions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ApplePayDomains$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ApplePayDomains.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ApplicationFees$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ApplicationFees.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Balance$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Balance.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BalanceSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/BalanceSettings.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BalanceTransactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/BalanceTransactions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Charges$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Charges.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ConfirmationTokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ConfirmationTokens.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CountrySpecs$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/CountrySpecs.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Coupons$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Coupons.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CreditNotes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/CreditNotes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Customers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Customers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CustomerSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/CustomerSessions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Disputes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Disputes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$EphemeralKeys$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/EphemeralKeys.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Events$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Events.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ExchangeRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ExchangeRates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Files$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Files.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FileLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/FileLinks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Invoices$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Invoices.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoiceItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/InvoiceItems.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoicePayments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/InvoicePayments.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoiceRenderingTemplates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/InvoiceRenderingTemplates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Mandates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Mandates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$OAuth$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/OAuth.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentAttemptRecords$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentAttemptRecords.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentIntents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentIntents.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentLinks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethods$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentMethods.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethodConfigurations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentMethodConfigurations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethodDomains$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentMethodDomains.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentRecords$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentRecords.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Payouts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Payouts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Plans$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Plans.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Prices$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Prices.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Products$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Products.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PromotionCodes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PromotionCodes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Quotes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Quotes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Refunds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Refunds.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Reviews$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Reviews.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SetupAttempts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SetupAttempts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SetupIntents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SetupIntents.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ShippingRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ShippingRates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Sources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Sources.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Subscriptions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Subscriptions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SubscriptionItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SubscriptionItems.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SubscriptionSchedules$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SubscriptionSchedules.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxCodes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TaxCodes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxIds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TaxIds.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TaxRates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Tokens.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Topups$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Topups.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Transfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Transfers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$WebhookEndpoints$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/WebhookEndpoints.js [app-route] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
const Apps = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('apps', {
    Secrets: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Apps$2f$Secrets$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SecretResource"]
});
const Billing = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('billing', {
    Alerts: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$Alerts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AlertResource"],
    CreditBalanceSummary: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$CreditBalanceSummary$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CreditBalanceSummaryResource"],
    CreditBalanceTransactions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$CreditBalanceTransactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CreditBalanceTransactionResource"],
    CreditGrants: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$CreditGrants$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CreditGrantResource"],
    MeterEventAdjustments: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$MeterEventAdjustments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["MeterEventAdjustmentResource"],
    MeterEvents: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$MeterEvents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["MeterEventResource"],
    Meters: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$Meters$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["MeterResource"]
});
const BillingPortal = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('billingPortal', {
    Configurations: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BillingPortal$2f$Configurations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ConfigurationResource"],
    Sessions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BillingPortal$2f$Sessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SessionResource"]
});
const Checkout = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('checkout', {
    Sessions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Checkout$2f$Sessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SessionResource"]
});
const Climate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('climate', {
    Orders: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Climate$2f$Orders$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["OrderResource"],
    Products: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Climate$2f$Products$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ProductResource"],
    Suppliers: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Climate$2f$Suppliers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SupplierResource"]
});
const Entitlements = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('entitlements', {
    ActiveEntitlements: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Entitlements$2f$ActiveEntitlements$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ActiveEntitlementResource"],
    Features: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Entitlements$2f$Features$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["FeatureResource"]
});
const FinancialConnections = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('financialConnections', {
    Accounts: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FinancialConnections$2f$Accounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AccountResource"],
    Sessions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FinancialConnections$2f$Sessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SessionResource"],
    Transactions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FinancialConnections$2f$Transactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TransactionResource"]
});
const Forwarding = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('forwarding', {
    Requests: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Forwarding$2f$Requests$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["RequestResource"]
});
const Identity = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('identity', {
    VerificationReports: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Identity$2f$VerificationReports$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["VerificationReportResource"],
    VerificationSessions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Identity$2f$VerificationSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["VerificationSessionResource"]
});
const Issuing = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('issuing', {
    Authorizations: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Authorizations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AuthorizationResource"],
    Cardholders: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Cardholders$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CardholderResource"],
    Cards: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Cards$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CardResource"],
    Disputes: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Disputes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DisputeResource"],
    PersonalizationDesigns: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$PersonalizationDesigns$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PersonalizationDesignResource"],
    PhysicalBundles: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$PhysicalBundles$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PhysicalBundleResource"],
    Tokens: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Tokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TokenResource"],
    Transactions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$Transactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TransactionResource"]
});
const Radar = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('radar', {
    EarlyFraudWarnings: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Radar$2f$EarlyFraudWarnings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["EarlyFraudWarningResource"],
    PaymentEvaluations: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Radar$2f$PaymentEvaluations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentEvaluationResource"],
    ValueListItems: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Radar$2f$ValueListItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ValueListItemResource"],
    ValueLists: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Radar$2f$ValueLists$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ValueListResource"]
});
const Reporting = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('reporting', {
    ReportRuns: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Reporting$2f$ReportRuns$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ReportRunResource"],
    ReportTypes: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Reporting$2f$ReportTypes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ReportTypeResource"]
});
const Sigma = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('sigma', {
    ScheduledQueryRuns: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Sigma$2f$ScheduledQueryRuns$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ScheduledQueryRunResource"]
});
const Tax = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('tax', {
    Associations: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$Associations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AssociationResource"],
    Calculations: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$Calculations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CalculationResource"],
    Registrations: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$Registrations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["RegistrationResource"],
    Settings: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$Settings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SettingResource"],
    Transactions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$Transactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TransactionResource"]
});
const Terminal = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('terminal', {
    Configurations: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$Configurations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ConfigurationResource"],
    ConnectionTokens: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$ConnectionTokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ConnectionTokenResource"],
    Locations: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$Locations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["LocationResource"],
    OnboardingLinks: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$OnboardingLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["OnboardingLinkResource"],
    Readers: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$Readers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ReaderResource"]
});
const TestHelpers = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('testHelpers', {
    ConfirmationTokens: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$ConfirmationTokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ConfirmationTokenResource"],
    Customers: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Customers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CustomerResource"],
    Refunds: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Refunds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["RefundResource"],
    TestClocks: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$TestClocks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TestClockResource"],
    Issuing: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('issuing', {
        Authorizations: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Issuing$2f$Authorizations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AuthorizationResource"],
        Cards: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Issuing$2f$Cards$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CardResource"],
        PersonalizationDesigns: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Issuing$2f$PersonalizationDesigns$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PersonalizationDesignResource"],
        Transactions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Issuing$2f$Transactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TransactionResource"]
    }),
    Terminal: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('terminal', {
        Readers: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Terminal$2f$Readers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ReaderResource"]
    }),
    Treasury: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('treasury', {
        InboundTransfers: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Treasury$2f$InboundTransfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["InboundTransferResource"],
        OutboundPayments: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Treasury$2f$OutboundPayments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["OutboundPaymentResource"],
        OutboundTransfers: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Treasury$2f$OutboundTransfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["OutboundTransferResource"],
        ReceivedCredits: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Treasury$2f$ReceivedCredits$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ReceivedCreditResource"],
        ReceivedDebits: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$Treasury$2f$ReceivedDebits$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ReceivedDebitResource"]
    })
});
const Treasury = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('treasury', {
    CreditReversals: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$CreditReversals$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CreditReversalResource"],
    DebitReversals: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$DebitReversals$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DebitReversalResource"],
    FinancialAccounts: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$FinancialAccounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["FinancialAccountResource"],
    InboundTransfers: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$InboundTransfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["InboundTransferResource"],
    OutboundPayments: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$OutboundPayments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["OutboundPaymentResource"],
    OutboundTransfers: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$OutboundTransfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["OutboundTransferResource"],
    ReceivedCredits: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$ReceivedCredits$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ReceivedCreditResource"],
    ReceivedDebits: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$ReceivedDebits$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ReceivedDebitResource"],
    TransactionEntries: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$TransactionEntries$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TransactionEntryResource"],
    Transactions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$Transactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TransactionResource"]
});
const V2 = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('v2', {
    Billing: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('billing', {
        MeterEventAdjustments: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Billing$2f$MeterEventAdjustments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["MeterEventAdjustmentResource"],
        MeterEventSession: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Billing$2f$MeterEventSession$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["MeterEventSessionResource"],
        MeterEventStream: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Billing$2f$MeterEventStream$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["MeterEventStreamResource"],
        MeterEvents: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Billing$2f$MeterEvents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["MeterEventResource"]
    }),
    Commerce: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('commerce', {
        ProductCatalog: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('productCatalog', {
            Imports: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Commerce$2f$ProductCatalog$2f$Imports$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ImportResource"]
        })
    }),
    Core: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$ResourceNamespace$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resourceNamespace"])('core', {
        AccountLinks: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Core$2f$AccountLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AccountLinkResource"],
        AccountTokens: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Core$2f$AccountTokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AccountTokenResource"],
        Accounts: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Core$2f$Accounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AccountResource"],
        EventDestinations: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Core$2f$EventDestinations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["EventDestinationResource"],
        Events: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$Core$2f$Events$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["EventResource"]
    })
});
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Account",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Accounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AccountResource"],
    "AccountLinks",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$AccountLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AccountLinkResource"],
    "AccountSessions",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$AccountSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AccountSessionResource"],
    "Accounts",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Accounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AccountResource"],
    "ApplePayDomains",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ApplePayDomains$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ApplePayDomainResource"],
    "ApplicationFees",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ApplicationFees$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ApplicationFeeResource"],
    "Apps",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Apps"],
    "Balance",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Balance$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["BalanceResource"],
    "BalanceSettings",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BalanceSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["BalanceSettingResource"],
    "BalanceTransactions",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BalanceTransactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["BalanceTransactionResource"],
    "Balances",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Balance$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["BalanceResource"],
    "Billing",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Billing"],
    "BillingPortal",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["BillingPortal"],
    "Charges",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Charges$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ChargeResource"],
    "Checkout",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Checkout"],
    "Climate",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Climate"],
    "ConfirmationTokens",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ConfirmationTokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ConfirmationTokenResource"],
    "CountrySpecs",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CountrySpecs$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CountrySpecResource"],
    "Coupons",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Coupons$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CouponResource"],
    "CreditNotes",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CreditNotes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CreditNoteResource"],
    "CustomerSessions",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CustomerSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CustomerSessionResource"],
    "Customers",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Customers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CustomerResource"],
    "Disputes",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Disputes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DisputeResource"],
    "Entitlements",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Entitlements"],
    "EphemeralKeys",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$EphemeralKeys$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["EphemeralKeyResource"],
    "Events",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Events$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["EventResource"],
    "ExchangeRates",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ExchangeRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ExchangeRateResource"],
    "FileLinks",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FileLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["FileLinkResource"],
    "Files",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Files$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["FileResource"],
    "FinancialConnections",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["FinancialConnections"],
    "Forwarding",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Forwarding"],
    "Identity",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Identity"],
    "InvoiceItems",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoiceItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["InvoiceItemResource"],
    "InvoicePayments",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoicePayments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["InvoicePaymentResource"],
    "InvoiceRenderingTemplates",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoiceRenderingTemplates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["InvoiceRenderingTemplateResource"],
    "Invoices",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Invoices$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["InvoiceResource"],
    "Issuing",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Issuing"],
    "Mandates",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Mandates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["MandateResource"],
    "OAuthResource",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$OAuth$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["OAuthResource"],
    "PaymentAttemptRecords",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentAttemptRecords$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentAttemptRecordResource"],
    "PaymentIntents",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentIntents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentIntentResource"],
    "PaymentLinks",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentLinkResource"],
    "PaymentMethodConfigurations",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethodConfigurations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentMethodConfigurationResource"],
    "PaymentMethodDomains",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethodDomains$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentMethodDomainResource"],
    "PaymentMethods",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethods$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentMethodResource"],
    "PaymentRecords",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentRecords$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentRecordResource"],
    "Payouts",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Payouts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PayoutResource"],
    "Plans",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Plans$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PlanResource"],
    "Prices",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Prices$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PriceResource"],
    "Products",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Products$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ProductResource"],
    "PromotionCodes",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PromotionCodes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PromotionCodeResource"],
    "Quotes",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Quotes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["QuoteResource"],
    "Radar",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Radar"],
    "Refunds",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Refunds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["RefundResource"],
    "Reporting",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Reporting"],
    "Reviews",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Reviews$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ReviewResource"],
    "SetupAttempts",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SetupAttempts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SetupAttemptResource"],
    "SetupIntents",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SetupIntents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SetupIntentResource"],
    "ShippingRates",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ShippingRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ShippingRateResource"],
    "Sigma",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Sigma"],
    "Sources",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Sources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SourceResource"],
    "SubscriptionItems",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SubscriptionItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SubscriptionItemResource"],
    "SubscriptionSchedules",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SubscriptionSchedules$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SubscriptionScheduleResource"],
    "Subscriptions",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Subscriptions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SubscriptionResource"],
    "Tax",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Tax"],
    "TaxCodes",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxCodes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TaxCodeResource"],
    "TaxIds",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxIds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TaxIdResource"],
    "TaxRates",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TaxRateResource"],
    "Terminal",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Terminal"],
    "TestHelpers",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["TestHelpers"],
    "Tokens",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TokenResource"],
    "Topups",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Topups$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TopupResource"],
    "Transfers",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Transfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TransferResource"],
    "Treasury",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["Treasury"],
    "V2",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["V2"],
    "WebhookEndpoints",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$WebhookEndpoints$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["WebhookEndpointResource"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources.js [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Accounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Accounts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$AccountLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/AccountLinks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$AccountSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/AccountSessions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ApplePayDomains$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ApplePayDomains.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ApplicationFees$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ApplicationFees.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Balance$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Balance.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BalanceSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/BalanceSettings.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BalanceTransactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/BalanceTransactions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Charges$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Charges.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ConfirmationTokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ConfirmationTokens.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CountrySpecs$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/CountrySpecs.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Coupons$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Coupons.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CreditNotes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/CreditNotes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Customers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Customers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CustomerSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/CustomerSessions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Disputes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Disputes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$EphemeralKeys$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/EphemeralKeys.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Events$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Events.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ExchangeRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ExchangeRates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Files$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Files.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FileLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/FileLinks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Invoices$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Invoices.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoiceItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/InvoiceItems.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoicePayments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/InvoicePayments.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoiceRenderingTemplates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/InvoiceRenderingTemplates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Mandates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Mandates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$OAuth$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/OAuth.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentAttemptRecords$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentAttemptRecords.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentIntents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentIntents.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentLinks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethods$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentMethods.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethodConfigurations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentMethodConfigurations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethodDomains$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentMethodDomains.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentRecords$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentRecords.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Payouts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Payouts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Plans$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Plans.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Prices$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Prices.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Products$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Products.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PromotionCodes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PromotionCodes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Quotes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Quotes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Refunds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Refunds.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Reviews$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Reviews.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SetupAttempts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SetupAttempts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SetupIntents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SetupIntents.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ShippingRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ShippingRates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Sources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Sources.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Subscriptions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Subscriptions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SubscriptionItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SubscriptionItems.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SubscriptionSchedules$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SubscriptionSchedules.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxCodes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TaxCodes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxIds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TaxIds.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TaxRates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Tokens.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Topups$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Topups.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Transfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Transfers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$WebhookEndpoints$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/WebhookEndpoints.js [app-route] (ecmascript)");
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/shared.js [app-route] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Decimal$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Decimal.js [app-route] (ecmascript)");
;
}),
"[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/stripe.esm.node.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Stripe",
    ()=>Stripe,
    "createStripe",
    ()=>createStripe,
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Error.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$RequestSender$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/RequestSender.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$StripeResource$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/StripeResource.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$StripeContext$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/StripeContext.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$platform$2f$NodePlatformFunctions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/platform/NodePlatformFunctions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Types$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Types.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Webhooks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Webhooks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$apiVersion$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/apiVersion.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$CryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/crypto/CryptoProvider.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/net/HttpClient.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources.js [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/utils.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$shared$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/shared.js [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Decimal$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/Decimal.js [app-route] (ecmascript)");
// StripeInstanceImports: The beginning of the section generated from our OpenAPI spec
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Accounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Accounts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$AccountLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/AccountLinks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$AccountSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/AccountSessions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ApplePayDomains$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ApplePayDomains.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ApplicationFees$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ApplicationFees.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Balance$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Balance.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BalanceSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/BalanceSettings.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BalanceTransactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/BalanceTransactions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Charges$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Charges.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ConfirmationTokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ConfirmationTokens.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CountrySpecs$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/CountrySpecs.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Coupons$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Coupons.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CreditNotes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/CreditNotes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Customers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Customers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CustomerSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/CustomerSessions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Disputes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Disputes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$EphemeralKeys$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/EphemeralKeys.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ExchangeRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ExchangeRates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Files$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Files.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FileLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/FileLinks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Invoices$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Invoices.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoiceItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/InvoiceItems.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoicePayments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/InvoicePayments.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoiceRenderingTemplates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/InvoiceRenderingTemplates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Mandates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Mandates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentAttemptRecords$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentAttemptRecords.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentIntents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentIntents.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentLinks.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethods$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentMethods.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethodConfigurations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentMethodConfigurations.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethodDomains$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentMethodDomains.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentRecords$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PaymentRecords.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Payouts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Payouts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Plans$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Plans.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Prices$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Prices.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Products$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Products.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PromotionCodes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/PromotionCodes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Quotes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Quotes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Refunds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Refunds.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Reviews$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Reviews.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SetupAttempts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SetupAttempts.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SetupIntents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SetupIntents.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ShippingRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/ShippingRates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Sources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Sources.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Subscriptions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Subscriptions.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SubscriptionItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SubscriptionItems.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SubscriptionSchedules$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/SubscriptionSchedules.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxCodes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TaxCodes.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxIds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TaxIds.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TaxRates.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Tokens.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Topups$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Topups.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Transfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Transfers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$WebhookEndpoints$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/WebhookEndpoints.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Apps$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Apps/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Billing/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BillingPortal$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/BillingPortal/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Checkout$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Checkout/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Climate$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Climate/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Entitlements$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Entitlements/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FinancialConnections$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/FinancialConnections/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Forwarding$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Forwarding/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Identity$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Identity/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Issuing/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Radar$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Radar/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Reporting$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Reporting/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Sigma$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Sigma/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Tax/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Terminal/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/TestHelpers/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Treasury/index.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/V2/index.js [app-route] (ecmascript)");
// StripeInstanceImports: The end of the section generated from our OpenAPI spec
// V1EventImports: The beginning of the section generated from our OpenAPI spec
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Events$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/Events.js [app-route] (ecmascript)");
// V1EventImports: The end of the section generated from our OpenAPI spec
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$OAuth$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/stripe@22.3.0_@types+node@20.19.43/node_modules/stripe/esm/resources/OAuth.js [app-route] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
;
const DEFAULT_HOST = 'api.stripe.com';
const DEFAULT_PORT = '443';
const DEFAULT_BASE_PATH = '/v1/';
const DEFAULT_API_VERSION = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$apiVersion$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ApiVersion"];
const DEFAULT_TIMEOUT = 80000;
const MAX_NETWORK_RETRY_DELAY_SEC = 5;
const INITIAL_NETWORK_RETRY_DELAY_SEC = 0.5;
const APP_INFO_PROPERTIES = [
    'name',
    'version',
    'url',
    'partner_id'
];
const ALLOWED_CONFIG_PROPERTIES = [
    'authenticator',
    'apiVersion',
    'typescript',
    'maxNetworkRetries',
    'httpAgent',
    'httpClient',
    'timeout',
    'host',
    'port',
    'protocol',
    'telemetry',
    'emitEventBodies',
    'appInfo',
    'stripeAccount',
    'stripeContext'
];
const defaultRequestSenderFactory = (stripe)=>new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$RequestSender$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["RequestSender"](stripe, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$StripeResource$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeResource"].MAX_BUFFERED_REQUEST_METRICS);
class Stripe {
    static initialize(platformFunctions, requestSenderFactory = defaultRequestSenderFactory) {
        Stripe._platformFunctions = platformFunctions;
        Stripe._requestSenderFactory = requestSenderFactory;
        Stripe.webhooks = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Webhooks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["createWebhooks"])(platformFunctions);
        Stripe.createNodeHttpClient = platformFunctions.createNodeHttpClient;
        Stripe.createFetchHttpClient = platformFunctions.createFetchHttpClient;
        Stripe.createNodeCryptoProvider = platformFunctions.createNodeCryptoProvider;
        Stripe.createSubtleCryptoProvider = platformFunctions.createSubtleCryptoProvider;
        const env = platformFunctions.getEnv();
        const runtimeVersion = platformFunctions.getRuntimeVersion();
        Stripe.aiAgent = env ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["detectAIAgent"])(env) : '';
        Stripe.AI_AGENT = Stripe.aiAgent;
        Stripe.USER_AGENT = {
            bindings_version: Stripe.PACKAGE_VERSION,
            lang: 'node',
            typescript: false,
            ...runtimeVersion ? {
                lang_version: runtimeVersion
            } : {},
            ...Stripe.aiAgent ? {
                ai_agent: Stripe.aiAgent
            } : {}
        };
    }
    constructor(key, config = {}){
        this._authenticator = null;
        const props = this._getPropsFromConfig(config);
        this._platformFunctions = Stripe._platformFunctions;
        Object.defineProperty(this, '_emitter', {
            value: this._platformFunctions.createEmitter(),
            enumerable: false,
            configurable: false,
            writable: false
        });
        this.VERSION = Stripe.PACKAGE_VERSION;
        this.on = this._emitter.on.bind(this._emitter);
        this.once = this._emitter.once.bind(this._emitter);
        this.off = this._emitter.removeListener.bind(this._emitter);
        const agent = props.httpAgent || null;
        this._api = {
            host: props.host || DEFAULT_HOST,
            port: props.port || DEFAULT_PORT,
            protocol: props.protocol || 'https',
            basePath: DEFAULT_BASE_PATH,
            version: props.apiVersion || DEFAULT_API_VERSION,
            timeout: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["validateInteger"])('timeout', props.timeout, DEFAULT_TIMEOUT),
            maxNetworkRetries: (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["validateInteger"])('maxNetworkRetries', props.maxNetworkRetries, 2),
            agent: agent,
            httpClient: props.httpClient || (agent ? this._platformFunctions.createNodeHttpClient(agent) : this._platformFunctions.createDefaultHttpClient()),
            dev: false,
            stripeAccount: props.stripeAccount || null,
            stripeContext: props.stripeContext || null
        };
        const typescript = props.typescript || false;
        if (typescript !== Stripe.USER_AGENT.typescript) {
            // The mutation here is uncomfortable, but likely fastest;
            // serializing the user agent involves shelling out to the system,
            // and given some users may instantiate the library many times without switching between TS and non-TS,
            // we only want to incur the performance hit when that actually happens.
            Stripe.USER_AGENT.typescript = typescript;
        }
        if (props.appInfo) {
            this._setAppInfo(props.appInfo);
        }
        this._setAuthenticator(key, props.authenticator || null);
        this.errors = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__;
        this.Decimal = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Decimal$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Decimal"];
        this.webhooks = Stripe.webhooks;
        this._prevRequestMetrics = [];
        this._enableTelemetry = props.telemetry !== false;
        this._emitEventBodies = props.emitEventBodies === true;
        this._requestSender = Stripe._requestSenderFactory(this);
        // StripeInitInstanceVariables: The beginning of the section generated from our OpenAPI spec
        this.accountLinks = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$AccountLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AccountLinkResource"](this);
        this.accountSessions = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$AccountSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AccountSessionResource"](this);
        this.accounts = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Accounts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AccountResource"](this);
        this.applePayDomains = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ApplePayDomains$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ApplePayDomainResource"](this);
        this.applicationFees = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ApplicationFees$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ApplicationFeeResource"](this);
        this.balance = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Balance$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["BalanceResource"](this);
        this.balanceSettings = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BalanceSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["BalanceSettingResource"](this);
        this.balanceTransactions = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BalanceTransactions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["BalanceTransactionResource"](this);
        this.charges = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Charges$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ChargeResource"](this);
        this.confirmationTokens = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ConfirmationTokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ConfirmationTokenResource"](this);
        this.countrySpecs = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CountrySpecs$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CountrySpecResource"](this);
        this.coupons = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Coupons$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CouponResource"](this);
        this.creditNotes = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CreditNotes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CreditNoteResource"](this);
        this.customerSessions = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$CustomerSessions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CustomerSessionResource"](this);
        this.customers = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Customers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CustomerResource"](this);
        this.disputes = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Disputes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DisputeResource"](this);
        this.ephemeralKeys = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$EphemeralKeys$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["EphemeralKeyResource"](this);
        this.events = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Events$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["EventResource"](this);
        this.exchangeRates = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ExchangeRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ExchangeRateResource"](this);
        this.fileLinks = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FileLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["FileLinkResource"](this);
        this.files = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Files$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["FileResource"](this);
        this.invoiceItems = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoiceItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["InvoiceItemResource"](this);
        this.invoicePayments = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoicePayments$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["InvoicePaymentResource"](this);
        this.invoiceRenderingTemplates = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$InvoiceRenderingTemplates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["InvoiceRenderingTemplateResource"](this);
        this.invoices = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Invoices$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["InvoiceResource"](this);
        this.mandates = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Mandates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["MandateResource"](this);
        this.paymentAttemptRecords = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentAttemptRecords$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentAttemptRecordResource"](this);
        this.paymentIntents = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentIntents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentIntentResource"](this);
        this.paymentLinks = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentLinks$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentLinkResource"](this);
        this.paymentMethodConfigurations = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethodConfigurations$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentMethodConfigurationResource"](this);
        this.paymentMethodDomains = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethodDomains$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentMethodDomainResource"](this);
        this.paymentMethods = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentMethods$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentMethodResource"](this);
        this.paymentRecords = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PaymentRecords$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PaymentRecordResource"](this);
        this.payouts = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Payouts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PayoutResource"](this);
        this.plans = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Plans$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PlanResource"](this);
        this.prices = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Prices$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PriceResource"](this);
        this.products = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Products$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ProductResource"](this);
        this.promotionCodes = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$PromotionCodes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PromotionCodeResource"](this);
        this.quotes = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Quotes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["QuoteResource"](this);
        this.refunds = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Refunds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["RefundResource"](this);
        this.reviews = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Reviews$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ReviewResource"](this);
        this.setupAttempts = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SetupAttempts$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SetupAttemptResource"](this);
        this.setupIntents = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SetupIntents$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SetupIntentResource"](this);
        this.shippingRates = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$ShippingRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ShippingRateResource"](this);
        this.sources = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Sources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SourceResource"](this);
        this.subscriptionItems = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SubscriptionItems$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SubscriptionItemResource"](this);
        this.subscriptionSchedules = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$SubscriptionSchedules$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SubscriptionScheduleResource"](this);
        this.subscriptions = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Subscriptions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SubscriptionResource"](this);
        this.taxCodes = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxCodes$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TaxCodeResource"](this);
        this.taxIds = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxIds$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TaxIdResource"](this);
        this.taxRates = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TaxRates$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TaxRateResource"](this);
        this.tokens = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tokens$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TokenResource"](this);
        this.topups = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Topups$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TopupResource"](this);
        this.transfers = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Transfers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TransferResource"](this);
        this.webhookEndpoints = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$WebhookEndpoints$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["WebhookEndpointResource"](this);
        this.apps = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Apps$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Apps"](this);
        this.billing = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Billing$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Billing"](this);
        this.billingPortal = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$BillingPortal$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["BillingPortal"](this);
        this.checkout = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Checkout$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Checkout"](this);
        this.climate = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Climate$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Climate"](this);
        this.entitlements = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Entitlements$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Entitlements"](this);
        this.financialConnections = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$FinancialConnections$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["FinancialConnections"](this);
        this.forwarding = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Forwarding$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Forwarding"](this);
        this.identity = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Identity$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Identity"](this);
        this.issuing = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Issuing$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Issuing"](this);
        this.radar = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Radar$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Radar"](this);
        this.reporting = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Reporting$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Reporting"](this);
        this.sigma = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Sigma$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Sigma"](this);
        this.tax = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Tax$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Tax"](this);
        this.terminal = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Terminal$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Terminal"](this);
        this.testHelpers = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$TestHelpers$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["TestHelpers"](this);
        this.treasury = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$Treasury$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Treasury"](this);
        this.v2 = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$V2$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["V2"](this);
        // StripeInitInstanceVariables: The end of the section generated from our OpenAPI spec
        // hardcoded properties and resources
        // account property is added for backward compatibility
        this.account = this.accounts;
        this.oauth = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2f$OAuth$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["OAuthResource"](this);
    // this._prepResources();
    }
    /**
     * Allows for sending "raw" requests to the Stripe API, which can be used for
     * testing new API endpoints or performing requests that the library does
     * not support yet.
     *
     * @param method - HTTP request method, 'GET', 'POST', or 'DELETE'
     * @param path - The path of the request, e.g. '/v1/beta_endpoint'
     * @param params - The parameters to include in the request body.
     * @param options - Additional request options.
     */ rawRequest(method, path, params, options) {
        return this._requestSender._rawRequest(method, path, params, options);
    }
    /**
     * @private
     */ _setAuthenticator(key, authenticator) {
        if (key && authenticator) {
            throw new Error("Can't specify both apiKey and authenticator");
        }
        if (!key && !authenticator) {
            throw new Error('Neither apiKey nor config.authenticator provided');
        }
        this._authenticator = key ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["createApiKeyAuthenticator"])(key) : authenticator;
    }
    /**
     * @private
     * This may be removed in the future.
     */ _setAppInfo(info) {
        if (info && typeof info !== 'object') {
            throw new Error('AppInfo must be an object.');
        }
        if (info && !info.name) {
            throw new Error('AppInfo.name is required');
        }
        info = info || {};
        this._appInfo = APP_INFO_PROPERTIES.reduce((accum, prop)=>{
            if (typeof info[prop] == 'string') {
                accum = accum || {};
                accum[prop] = info[prop];
            }
            return accum;
        }, {});
    }
    setClientId(clientId) {
        this._clientId = clientId;
    }
    getClientId() {
        return this._clientId;
    }
    /**
     * @private
     * Please open or upvote an issue at github.com/stripe/stripe-node
     * if you use this, detailing your use-case.
     *
     * It may be deprecated and removed in the future.
     */ getConstant(c) {
        switch(c){
            case 'DEFAULT_HOST':
                return DEFAULT_HOST;
            case 'DEFAULT_PORT':
                return DEFAULT_PORT;
            case 'DEFAULT_BASE_PATH':
                return DEFAULT_BASE_PATH;
            case 'DEFAULT_API_VERSION':
                return DEFAULT_API_VERSION;
            case 'DEFAULT_TIMEOUT':
                return DEFAULT_TIMEOUT;
            case 'MAX_NETWORK_RETRY_DELAY_SEC':
                return MAX_NETWORK_RETRY_DELAY_SEC;
            case 'INITIAL_NETWORK_RETRY_DELAY_SEC':
                return INITIAL_NETWORK_RETRY_DELAY_SEC;
        }
        return Stripe[c];
    }
    resolveBaseAddress(apiBase) {
        // can override host globally, but not locally
        const instanceHost = this.getApiField('host');
        if (instanceHost !== DEFAULT_HOST) {
            return instanceHost;
        }
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Types$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DEFAULT_BASE_ADDRESSES"][apiBase];
    }
    getMaxNetworkRetries() {
        return this.getApiField('maxNetworkRetries');
    }
    /**
     * @private
     * This may be removed in the future.
     */ _setApiNumberField(prop, n, defaultVal) {
        // @ts-ignore
        const val = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["validateInteger"])(prop, n, defaultVal);
        this._setApiField(prop, val);
    }
    getMaxNetworkRetryDelay() {
        return MAX_NETWORK_RETRY_DELAY_SEC;
    }
    getInitialNetworkRetryDelay() {
        return INITIAL_NETWORK_RETRY_DELAY_SEC;
    }
    /**
     * @private
     * Please open or upvote an issue at github.com/stripe/stripe-node
     * if you use this, detailing your use-case.
     *
     * It may be deprecated and removed in the future.
     *
     * Gets a JSON version of a User-Agent and uses a cached version for a slight
     * speed advantage.
     */ getClientUserAgent(cb) {
        return this.getClientUserAgentSeeded(Stripe.USER_AGENT, cb);
    }
    /**
     * @private
     * Please open or upvote an issue at github.com/stripe/stripe-node
     * if you use this, detailing your use-case.
     *
     * It may be deprecated and removed in the future.
     *
     * Gets a JSON version of a User-Agent by encoding a seeded object and
     * fetching a uname from the system.
     */ getClientUserAgentSeeded(seed, cb) {
        const userAgent = {};
        for(const field in seed){
            if (!Object.prototype.hasOwnProperty.call(seed, field)) {
                continue;
            }
            userAgent[field] = encodeURIComponent(seed[field] ?? 'null');
        }
        const platformInfo = this._platformFunctions.getPlatformInfo();
        if (platformInfo && this.getTelemetryEnabled()) {
            userAgent.platform = encodeURIComponent(platformInfo);
        } else {
            delete userAgent.platform;
        }
        const client = this.getApiField('httpClient');
        if (client) {
            userAgent.httplib = encodeURIComponent(client.getClientName());
        }
        if (this._appInfo) {
            userAgent.application = this._appInfo;
        }
        cb(JSON.stringify(userAgent));
    }
    /**
     * @private
     * Please open or upvote an issue at github.com/stripe/stripe-node
     * if you use this, detailing your use-case.
     *
     * It may be deprecated and removed in the future.
     */ getAppInfoAsString() {
        if (!this._appInfo) {
            return '';
        }
        let formatted = this._appInfo.name;
        if (this._appInfo.version) {
            formatted += `/${this._appInfo.version}`;
        }
        if (this._appInfo.url) {
            formatted += ` (${this._appInfo.url})`;
        }
        return formatted;
    }
    getTelemetryEnabled() {
        return this._enableTelemetry;
    }
    getEmitEventBodiesEnabled() {
        return this._emitEventBodies;
    }
    /**
     * @private
     * This may be removed in the future.
     */ _prepResources() {
        for(const name in __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__){
            if (!Object.prototype.hasOwnProperty.call(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__, name)) {
                continue;
            }
            // @ts-ignore
            this[(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$utils$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pascalToCamelCase"])(name.replace('Resource', ''))] = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__[name](this);
        }
    }
    /**
     * @private
     * This may be removed in the future.
     */ _getPropsFromConfig(config) {
        // If config is null or undefined, just bail early with no props
        if (!config) {
            return {};
        }
        // config can be an object or a string
        const isString = typeof config === 'string';
        const isObject = config === Object(config) && !Array.isArray(config);
        if (!isObject && !isString) {
            throw new Error('Config must either be an object or a string');
        }
        // If config is a string, we assume the old behavior of passing in a string representation of the api version
        if (isString) {
            return {
                apiVersion: config
            };
        }
        // If config is an object, we assume the new behavior and make sure it doesn't contain any unexpected values
        const values = Object.keys(config).filter((value)=>!ALLOWED_CONFIG_PROPERTIES.includes(value));
        if (values.length > 0) {
            throw new Error(`Config object may only contain the following: ${ALLOWED_CONFIG_PROPERTIES.join(', ')}`);
        }
        return config;
    }
    /**
     * @private
     * This may be removed in the future.
     */ _setApiField(key, value) {
        this._api[key] = value;
    }
    /**
     * @private
     * Please open or upvote an issue at github.com/stripe/stripe-node
     * if you use this, detailing your use-case.
     *
     * It may be deprecated and removed in the future.
     */ getApiField(key) {
        return this._api[key];
    }
    parseEventNotification(payload, header, secret, tolerance, cryptoProvider, receivedAt) {
        // Verify the signature using the internal signature helper directly,
        // bypassing constructEvent's v2 payload check (since v2 payloads are
        // expected here).
        if (!this.webhooks.signature) {
            throw new Error('ERR: missing signature helper, unable to verify');
        }
        this.webhooks.signature.verifyHeader(payload, header, secret, tolerance || this.webhooks.DEFAULT_TOLERANCE, cryptoProvider || this._platformFunctions.createDefaultCryptoProvider(), receivedAt);
        const eventNotification = payload instanceof Uint8Array ? JSON.parse(new TextDecoder('utf8').decode(payload)) : JSON.parse(payload);
        if (eventNotification && eventNotification.object === 'event') {
            throw new Error('You passed a webhook payload to stripe.parseEventNotification, which expects an event notification. Use stripe.webhooks.constructEvent instead.');
        }
        // Parse string context into StripeContext object if present
        if (eventNotification.context) {
            eventNotification.context = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$StripeContext$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeContext"].parse(eventNotification.context);
        }
        eventNotification.fetchEvent = ()=>{
            return this._requestSender._rawRequest('GET', `/v2/core/events/${eventNotification.id}`, undefined, {
                stripeContext: eventNotification.context,
                headers: {
                    'Stripe-Request-Trigger': `event=${eventNotification.id}`
                }
            }, [
                'fetch_event'
            ]);
        };
        eventNotification.fetchRelatedObject = ()=>{
            if (!eventNotification.related_object) {
                return Promise.resolve(null);
            }
            return this._requestSender._rawRequest('GET', eventNotification.related_object.url, undefined, {
                stripeContext: eventNotification.context,
                headers: {
                    'Stripe-Request-Trigger': `event=${eventNotification.id}`
                }
            }, [
                'fetch_related_object'
            ]);
        };
        return eventNotification;
    }
    async parseEventNotificationAsync(payload, header, secret, tolerance, cryptoProvider, receivedAt) {
        // Verify the signature using the internal signature helper directly,
        // bypassing constructEvent's v2 payload check (since v2 payloads are
        // expected here).
        if (!this.webhooks.signature) {
            throw new Error('ERR: missing signature helper, unable to verify');
        }
        await this.webhooks.signature.verifyHeaderAsync(payload, header, secret, tolerance || this.webhooks.DEFAULT_TOLERANCE, cryptoProvider || this._platformFunctions.createDefaultCryptoProvider(), receivedAt);
        const eventNotification = payload instanceof Uint8Array ? JSON.parse(new TextDecoder('utf8').decode(payload)) : JSON.parse(payload);
        if (eventNotification && eventNotification.object === 'event') {
            throw new Error('You passed a webhook payload to stripe.parseEventNotificationAsync, which expects an event notification. Use stripe.webhooks.constructEventAsync instead.');
        }
        // Parse string context into StripeContext object if present
        if (eventNotification.context) {
            eventNotification.context = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$StripeContext$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeContext"].parse(eventNotification.context);
        }
        eventNotification.fetchEvent = ()=>{
            return this._requestSender._rawRequest('GET', `/v2/core/events/${eventNotification.id}`, undefined, {
                stripeContext: eventNotification.context,
                headers: {
                    'Stripe-Request-Trigger': `event=${eventNotification.id}`
                }
            }, [
                'fetch_event'
            ]);
        };
        eventNotification.fetchRelatedObject = ()=>{
            if (!eventNotification.related_object) {
                return Promise.resolve(null);
            }
            return this._requestSender._rawRequest('GET', eventNotification.related_object.url, undefined, {
                stripeContext: eventNotification.context,
                headers: {
                    'Stripe-Request-Trigger': `event=${eventNotification.id}`
                }
            }, [
                'fetch_related_object'
            ]);
        };
        return eventNotification;
    }
}
Stripe.PACKAGE_VERSION = '22.3.0';
Stripe.API_VERSION = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$apiVersion$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ApiVersion"];
Stripe.aiAgent = '';
Stripe.AI_AGENT = '';
Stripe.USER_AGENT = {
    bindings_version: Stripe.PACKAGE_VERSION,
    lang: 'node',
    typescript: false
};
Stripe.StripeResource = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$StripeResource$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeResource"];
Stripe.resources = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$resources$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__;
Stripe.HttpClient = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClient"];
Stripe.HttpClientResponse = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$net$2f$HttpClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["HttpClientResponse"];
Stripe.CryptoProvider = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$crypto$2f$CryptoProvider$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["CryptoProvider"];
Stripe.StripeContext = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$StripeContext$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["StripeContext"];
Stripe.errors = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Error$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__;
Stripe.Decimal = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$Decimal$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Decimal"];
Stripe._requestSenderFactory = defaultRequestSenderFactory;
function createStripe(platformFunctions, requestSender = defaultRequestSenderFactory) {
    // Initialize static properties
    Stripe.initialize(platformFunctions, requestSender);
    return Stripe;
}
Stripe.initialize(new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$stripe$40$22$2e$3$2e$0_$40$types$2b$node$40$20$2e$19$2e$43$2f$node_modules$2f$stripe$2f$esm$2f$platform$2f$NodePlatformFunctions$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NodePlatformFunctions"]());
const __TURBOPACK__default__export__ = Stripe;
}),
];

//# sourceMappingURL=1q8p_stripe_esm_1erh7wg._.js.map