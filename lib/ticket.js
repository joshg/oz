// Load modules

var Boom = require('boom');
var Iron = require('iron');
var Cryptiles = require('cryptiles');
var Hawk = require('hawk');
var Hoek = require('hoek');
var Scope = require('./scope');


// Declare internals

var internals = {};


exports.settings = {
    ttl: 60 * 60 * 1000,                                // 1 hour
    secretBytes: 32,                                    // Ticket secret size in bytes
    hmacAlgorithm: 'sha256'
};

Hoek.merge(exports.settings, Iron.defaults);


/*
    var app = {
        id: '123',                  // Application id
        scope: ['a', 'b'],          // Grant scope
        *secret: 'secret'           // Used in endpoints for Basic auth authentication
    };

    var grant = {
        id: 'd832d9283hd9823dh',    // Persitant identifier used to issue additional tickets or revoke access
        user: '456',                // User id
        exp: 1352535473414,         // Grant expiration
        scope: ['b']                // Grant scope
    };

    var options = {
        ttl: 60 * 1000,             // 1 min
        scope: ['b'],               // Ticket scope
        ext: {                      // Server-specific extension data
            tos: '0.0.1',
            private: { x: 1 }       // Anything inside 'private' is only included in the encrypted portion
        }
    };
*/

exports.issue = function (app, grant, encryptionPassword, options, callback) {

    Hoek.toss(app && app.id, Boom.internal('Invalid application object'), callback);
    Hoek.toss(!grant || (grant.id && grant.user && grant.exp), Boom.internal('Invalid grant object'), callback);
    Hoek.toss(encryptionPassword, Boom.internal('Invalid encryption password'), callback);
    Hoek.toss(options, Boom.internal('Invalid options object'), callback);

    var scope = options.scope || (grant ? grant.scope : null) || app.scope || [];
    Hoek.toss(Scope.validate(scope), callback);

    // Construct ticket

    var exp = (Hawk.utils.now() + (options.ttl || exports.settings.ttl));
    if (grant) {
        exp = Math.min(exp, grant.exp);
    }

    var ticket = {
        exp: exp,
        app: app.id,
        scope: scope
    };

    if (options.ext) {
        ticket.ext = options.ext;
    }

    if (grant) {
        ticket.grant = grant.id;
        ticket.user = grant.user;
    }

    exports.generate(ticket, encryptionPassword, callback);
};


// Reissue ticket

/*
    var options = {
        scope: ['b'],                   // Ticket scope (must be equal or lesser than original)
        grantExp: 1352535473414,        // Grant expiration timestamp
        issueTo: '123'                  // Delegated to application id
*/

exports.reissue = function (parentTicket, encryptionPassword, options, callback) {

    Hoek.toss(parentTicket, Boom.internal('Invalid parent ticket object'), callback);
    Hoek.toss(encryptionPassword, Boom.internal('Invalid encryption password'), callback);
    Hoek.toss(options, Boom.internal('Invalid options object'), callback);
    Hoek.toss(!options.scope || Scope.isSubset(parentTicket.scope, options.scope), Boom.forbidden('New scope is not a subset of the parent ticket scope'), callback);
    Hoek.toss(!options.issueTo || !parentTicket.dlg, Boom.badRequest('Cannot re-delegate'), callback);

    // Construct ticket

    var exp = (Hawk.utils.now() + (options.ttl || exports.settings.ttl));
    if (options.grantExp) {
        exp = Math.min(exp, options.grantExp);
    }

    var ticket = {
        exp: exp,
        app: options.issueTo || parentTicket.app,
        scope: options.scope || parentTicket.scope
    };

    if (options.ext || parentTicket.ext) {
        ticket.ext = options.ext || parentTicket.ext;
    }

    if (parentTicket.grant) {
        ticket.grant = parentTicket.grant;
        ticket.user = parentTicket.user;
    }

    if (options.issueTo) {
        ticket.dlg = parentTicket.app;
    }
    else if (parentTicket.dlg) {
        ticket.dlg = parentTicket.dlg;
    }

    exports.generate(ticket, encryptionPassword, callback);
};


/*
    var ticket = {

        // Inputs into generate()

        exp:                time in msec
        app:                app id ticked is issued to
        scope:              ticket scope
        ext:                application data (child key 'private' has special meaning)
        grant:              grand id
        user:               user id
        dlg:                app id of the delegating party

        // Added by generate()

        key:                ticket secret key (Hawk)
        algorithm:          ticket hmac algorithm (Hawk)
        id:                 ticket key id (Hawk)
    };
*/

exports.generate = function (ticket, encryptionPassword, callback) {

    // Generate ticket secret

    var random = Cryptiles.randomString(exports.settings.secretBytes);
    if (random instanceof Error) {
        return callback(random);
    }

    ticket.key = random.toString('hex');
    ticket.algorithm = exports.settings.hmacAlgorithm;

    // Seal ticket

    Iron.seal(ticket, encryptionPassword, exports.settings, function (err, sealed) {

        if (err) {
            return callback(err);
        }

        ticket.id = sealed;

        // Hide private ext data

        if (ticket.ext &&
            ticket.ext.private) {

            delete ticket.ext.private;
        }

        return callback(null, ticket);
    });
};


/*
    // The requesting application

    var app = {
        id: '123',                  // Application id
    };

    // The resource owner

    var grant = {
        id: 'd832d9283hd9823dh'     // Persitant identifier used to issue additional tickets or revoke access
    };
*/

exports.rsvp = function (app, grant, encryptionPassword, options, callback) {

    Hoek.toss(app && app.id, Boom.internal('Invalid application object'), callback);
    Hoek.toss(grant && grant.id, Boom.internal('Invalid grant object'), callback);
    Hoek.toss(encryptionPassword, Boom.internal('Invalid encryption password'), callback);
    Hoek.toss(options, Boom.internal('Invalid options object'), callback);

    options.ttl = options.ttl || 1 * 60 * 1000                                  // 1 minute

    // Construct envelope

    var envelope = {
        app: app.id,
        exp: Hawk.utils.now() + options.ttl,
        grant: grant.id
    };

    // Stringify and encrypt

    Iron.seal(envelope, encryptionPassword, exports.settings, function (err, sealed) {

        if (err) {
            return callback(err);
        }

        var rsvp = sealed;
        return callback(null, rsvp);
    });
};


// Parse ticket id

exports.parse = function (id, encryptionPassword, callback) {

    Hoek.toss(encryptionPassword, Boom.internal('Invalid encryption password'), callback);

    Iron.unseal(id, encryptionPassword, exports.settings, function (err, object) {

        if (err) {
            return callback(err);
        }

        var ticket = object;
        ticket.id = id;
        return callback(null, ticket);
    });
};
