module.exports = function(tracer) {
    const validHeader = header => {
        header = header.toLowerCase();

        return header === 'host' || header === 'user-agent' || header.startsWith('x-');
    };
    const whitelistHeaders = (headers = {}) => Object.keys(headers).reduce((newHeaders, header) => !validHeader(header) ? newHeaders : Object.assign(newHeaders, {[header]: headers[header]}), {});
    const configReq = req => ({
        method: req.method,
        url: req.originalUrl,
        headers: whitelistHeaders(req.headers)
    });
    const configRes = res => ({
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        headers: whitelistHeaders(res.headers)
    });

    // TODO: We would need globally-unique ids for both requests and operations
    let reqId = 0;
    let opId = 0;
    let currentReqId = reqId;

    return {
        middleware: function(req, res, next) {
            let _reqId = req.get('x-wake-request-id') || ++reqId;
            currentReqId = _reqId;

            const wrapRes = propFn => {
                const _fn = res[propFn].bind(res);

                return (...args) => {
                    tracer(Object.assign({}, configRes(res), { requestId: _reqId, type: 'response', result: 'success' }));
                    res.set('x-wake-request-id', _reqId);
                    return _fn(...args);
                };
            };

            req.currentReqId = _reqId;
            res.currentReqId = _reqId;
            res.end = wrapRes('end');
            res.send = wrapRes('send');
            res.sendFile = wrapRes('sendFile');
            res.sendStatus = wrapRes('sendStatus');

            tracer(Object.assign({}, configReq(req), { requestId: _reqId, type: 'request' }));
            return next();
        },
        error: function(err, req, res, next) {
            tracer(Object.assign({}, configRes(res), { requestId: res.currentReqId, type: 'response', result: 'error', error: err }));
            res.set('x-wake-request-id', res.currentReqId);
            return next();
        },
        decorator: function(tag, config, fn) {
            return function (...args) {
                let _reqId = currentReqId;
                let _opId = ++opId;

                tracer(Object.assign({}, config(...args), { tag, requestId: _reqId, operationId: _opId, type: 'request' }));
                // request data is provided to the decorated function as the this argument
                return fn.call({ requestId: _reqId, operationId: _opId }, ...args)
                    .then(result => {
                        tracer(Object.assign({}, config(...args), { tag, requestId: _reqId, operationId: _opId, type: 'response', result: 'success' }));
                        currentReqId = _reqId;
                        return result;
                    })
                    .catch(err => {
                        tracer(Object.assign({}, config(...args), { tag, requestId: _reqId, operationId: _opId, type: 'response', result: 'error', error: err }));
                        currentReqId = _reqId;
                        return Promise.reject(err);
                    });
            };
        }
    };
};
