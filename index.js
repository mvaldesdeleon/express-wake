const uuid = require('uuid/v4');

const toObject = err => Object.getOwnPropertyNames(err).reduce((obj, prop) => Object.assign(obj, { [prop]: err[prop] }), {});
const validHeader = header => {
    header = header.toLowerCase();

    return header === 'host' || header === 'user-agent' || header.startsWith('x-');
};
const whitelistHeaders = (headers = {}) => Object.keys(headers).reduce((newHeaders, header) => !validHeader(header) ? newHeaders : Object.assign(newHeaders, {[header]: headers[header]}), {});
const configReq = req => Object.assign({ method: req.method, url: req.originalUrl }, req.headers ? { headers: whitelistHeaders(req.headers) } : {});
const configRes = res => Object.assign({ statusCode: res.statusCode, statusMessage: res.statusMessage }, res.headers ? { headers: whitelistHeaders(res.headers) } : {});

module.exports = function(tracer, options = {}) {
    let currentReqId;

    return {
        middleware: function(req, res, next) {
            let _reqId = req.get('x-wake-request-id') || uuid();
            currentReqId = _reqId;

            const wrapRes = propFn => {
                const _fn = res[propFn].bind(res);

                return (...args) => {
                    tracer(Object.assign(configRes(res), { requestId: _reqId, interface: 'external', type: 'response', result: 'success' }));
                    res.set('x-wake-request-id', _reqId);
                    return _fn(...args);
                };
            };

            req.currentReqId = _reqId;
            res.currentReqId = _reqId;
            res.end = wrapRes('end');

            tracer(Object.assign(configReq(req), { requestId: _reqId, interface: 'external', type: 'request' }));
            return next();
        },
        error: function(err, req, res, next) {
            tracer(Object.assign(configRes(res), { requestId: res.currentReqId, interface: 'external', type: 'response', result: 'error' }, options.debug ? { error: toObject(err) } : {}));
            res.set('x-wake-request-id', res.currentReqId);
            return next();
        },
        decorator: function(tag, config, fn) {
            return function (...args) {
                let _reqId = currentReqId;
                let _opId = uuid();

                tracer(Object.assign(config(...args), { tag, requestId: _reqId, operationId: _opId, interface: 'internal', type: 'request' }));
                // FUN FACT: Request data is provided to the decorated function as the `this` argument!
                return fn.call({ requestId: _reqId, operationId: _opId }, ...args)
                    .then(result => {
                        tracer(Object.assign(config(...args), { tag, requestId: _reqId, operationId: _opId, interface: 'internal', type: 'response', result: 'success' }));
                        currentReqId = _reqId;
                        return result;
                    })
                    .catch(err => {
                        tracer(Object.assign(config(...args), { tag, requestId: _reqId, operationId: _opId, interface: 'internal', type: 'response', result: 'error' }, options.debug ? { error: toObject(err) } : {}));
                        currentReqId = _reqId;
                        return Promise.reject(err);
                    });
            };
        },
        log: function(traceData) {
            let _reqId = currentReqId;

            tracer(Object.assign({}, traceData, { requestId: _reqId, type: 'log' }));
        }
    };
};
