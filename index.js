module.exports = function(tracer) {
    const configReq = req => ({}); // TODO: extract some data from the request for the tracer
    const configRes = res => ({}); // TODO: extract some data from the response for the tracer

    let reqId = 0;
    let opId = 0;
    let currentReqId = reqId;

    return {
        middleware: function(req, res, next) {
            const wrapRes = propFn => (...args) => {
                tracer(Object.assign({}, configRes(res), { requestId: _reqId, type: 'response', result: 'success' }));
                return res[propFn](...args);
            };

            // TODO: fetch requestId from headers if possible
            let _reqId = ++reqId;
            currentReqId = _reqId;

            req.currentReqId = _reqId;
            res.currentReqId = _reqId;
            res.send = wrapRes('send');
            res.sendFile = wrapRes('sendFile');
            res.sendStatus = wrapRes('sendStatus');

            tracer(Object.assign({}, configReq(req), { requestId: _reqId, type: 'request' }));
            return next();
        },
        error: function(err, req, res, next) {
            tracer(Object.assign({}, configRes(res), { requestId: req.currentReqId, type: 'response', result: 'error', error: err }));
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
                        tracer(Object.assign({}, config(...args), {tag, requestId: _reqId, operationId: _opId, type: 'response', result: 'error', error: err}));
                        currentReqId = _reqId;
                        return Promise.reject(err);
                    });
            };
        }
    };
};
