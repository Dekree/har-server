var Promise = require( 'bluebird' );
var fs = require( 'fs' );
var http = require( 'http' );
var https = require( 'https' );
var harValidator = require( 'har-validator' );
var isRoot = require( 'is-root' );
var _ = require( 'lodash' );
var urlLib = require( 'url' );
var isIp = require( 'net' ).isIP;
var hostile = require( 'hostile' );
var pem = require( 'pem' );

var userConfig = require( '../config' );


Promise.promisifyAll( hostile );
Promise.promisifyAll( fs );
Promise.promisifyAll( pem );

/**
 * Har Server please let jsdoc find this
 * @constructor
 * @param config.harFileName {string} name of HAR file to load.  Relative to current path
 * @param config.setHostFileEntries {boolean} allows setHostFile() to run
 * @param config.hostFileIp {string} IP address to match with DNS names in the host file
 * @param config.removeHostFileEntries {boolean} allows cleanHostFile() to run
 * @param config.listeningPort {int} the port which the server will listen on
 * @param config.useSSL {boolean} Start the server using encryption
 * @param config.generateKey {boolean} generate and use a SSL key and cert
 * @param config.sslKeyFile {string} A file containing a SSL key
 * @param config.sslCertFile {string} A file containing a SSL certificate
 * @returns {HarServer}
 */
function HarServer( config ) {

    var self = this;

    self.config = config || {};
    var server;
    var har;

    var hostFileLocation = process.platform === 'win32'
        ? 'C:/Windows/System32/drivers/etc/hosts'
        : '/etc/hosts';


    /**
     * Reads the HAR file and validates it
     * @param harFileName {string} sets config.harFileName before reading HAR file.
     * @returns {Promise.<TResult>} Resolved after HAR file has been validated.
     */
    this.readHar = function readHar( harFileName ) {
        if( !_.isEmpty( harFileName ) && _.isString( harFileName ) ) {
            self.config.harFileName = harFileName
        }

        return fs.accessAsync( self.config.harFileName, fs.R_OK ).catch( function( err ) {
            throw new Error( 'Cannot read har file at ' + self.config.harFileName );

        } ).then( function() {
            return fs.readFileAsync( self.config.harFileName );

        } ).then( function( harRawData ) {
            har = JSON.parse( harRawData );
            // return harValidator.har( har );
            return har;

        } ).then( function() {
            return Promise.resolve();
        } );
    };

    this._getHostIpPairs = function _getHostIpPairs() {

        var hostFileObject = [];
        //preprocess all domians, and generate a host file.
        for( var i = 0; i < har.log.entries.length; i++ ) {
            var curEntry = har.log.entries[ i ];
            curEntry.parsedUrl = urlLib.parse( curEntry.request.url );

            if( _.find( hostFileObject, { name: curEntry.parsedUrl.hostname } ) ) {
                continue;
            }

            if( isIp( curEntry.parsedUrl.hostname ) !== 0 ) {
                continue;
            }

            hostFileObject.push( { name: curEntry.parsedUrl.hostname, ip: self.config.hostFileIp } );
        }
        return hostFileObject;
    };

    /**
     * Adds entries to host file.  Must be run after calling readHar
     * @returns {Promise.<TResult>} Resolved after host file has been updated
     */
    this.setHostFile = function setHostFile() {
        if( !self.config.setHostFileEntries ) {
            console.log( 'setHostFile called, but updateHostFile flag not set.  Not going to update host file' );
            return Promise.resolve();
        }

        if( !har ) {
            throw new Error( 'Must call readHar before setHostFile' );
        }

        return fs.accessAsync( hostFileLocation, fs.W_OK ).catch( function( err ) {
            throw new Error( 'Cannot access host file at ' + hostFileLocation );

        } ).then( function() {
            console.log( 'Setting host file' );
            return Promise.map( self._getHostIpPairs(), function( curHost ) {
                console.log( 'Adding: ' + curHost.ip + '  ' + curHost.name );
                return hostile.setAsync( curHost.ip, curHost.name );

            }, { concurrency: 1 } );
        } );
    };

    /**
     * Removes any host files entries that have been added.  Must be run after setHostFile
     * @returns {Promise.<TResult>} Resolved after host file has been updated
     */
    this.cleanHostFile = function cleanHostFile() {
        if( !self.config.removeHostFileEntries ) {
            console.log( 'cleanHostFile called, but cleanHostFile flag not set. Not going to clean host file' );
            return Promise.resolve();
        }

        if( !har ) {
            throw new Error( 'Must call readHar before setHostFile' );
        }


        return fs.accessAsync( hostFileLocation, fs.W_OK ).catch( function( err ) {
            throw new Error( 'Cannot access host file at ' + hostFileLocation );

        } ).then( function() {
            console.log( 'Cleaning host file' );
            return Promise.map( self._getHostIpPairs(), function( curHost ) {
                console.log( 'Removing ' + curHost.ip + '  ' + curHost.name );
                return hostile.removeAsync( curHost.ip, curHost.name );

            }, { concurrency: 1 } );
        } );
    };

    /**
     * Creates server.  Must be run after readHar
     * @param port {int} Sets the listening port
     * @param config.useSSL {boolean} Start the server using encryption
     * @param config.generateKey {boolean} generate and use a SSL key and cert
     * @param config.sslKeyFile {string} A file containing a SSL key
     * @param config.sslCertFile {string} A file containing a SSL certificate
     * @returns {Promise.<TResult>} Resolved after server is listening
     */
    this.start = function start( config ) {
        if( this.isRunning() ) {
            throw new Error( 'Server is already running' );
        }

        if( _.isUndefined( config ) ) {
            config = {};
        }

        if( _.isNumber( config.port ) && config.port > 0 && config.port <= 65535 ) {
            self.config.listeningPort = config.port;
        }

        if( !isRoot() && self.config.listeningPort <= 1024 ) {
            throw new Error( 'Cannot bind to ports less then 1024 without being root' );
        }

        if( !_.isUndefined( config.useSSL ) ) {
            self.config.useSSL = config.useSSL;
        }

        if( !_.isUndefined( config.generateKey ) ) {
            self.config.generateKey = config.generateKey;
        }

        if( !_.isUndefined( config.sslCertFile ) ) {
            self.config.sslCertFile = config.sslCertFile;
        }

        if( !_.isUndefined( config.sslKeyFile ) ) {
            self.config.sslKeyFile = config.sslKeyFile;
        }

        if( self.config.useSSL === true ) {
            if( self.config.generateKey === false
                && (_.isEmpty( self.config.sslCertFile ) ||
                    _.isEmpty( self.config.sslKeyFile )) ) {

                throw new Error( 'SSL requires either generateKey or to be given a ssl key and cert' );
            }

            if( !_.isEmpty( self.config.sslKeyFile ) && _.isEmpty( self.config.sslKeyFile ) ) {
                throw new Error( 'Missing SSL key' );
            }

            if( _.isEmpty( self.config.sslCertFile ) && !_.isEmpty( self.config.sslCertFile ) ) {
                throw new Error( 'Missing SSL cert' );
            }
        }

        return Promise.resolve().then( function() {
            if( !self.config.useSSL ) {
                return;
            }

            if( self.config.sslCertFile && self.config.sslKeyFile ) {
                console.log( 'Reading SSL cert from ' + self.config.sslCertFile );
                return fs.readFileAsync( self.config.sslCertFile ).then( function( cert ) {
                    self.config.sslCert = cert.toString();

                    console.log( 'Reading SSL key from ' + self.config.sslKeyFile );
                    return fs.readFileAsync( self.config.sslKeyFile );

                } ).then( function( key ) {
                    self.config.sslKey = key.toString();

                } );
            } else if( self.config.generateKey ) {
                console.log( 'Generating SSL key and cert' );
                return pem.createCertificateAsync( { days: 10, selfSigned: true } ).then( function( keys ) {
                    self.config.sslKey = keys.serviceKey;
                    self.config.sslCert = keys.certificate;
                } );

            }
        } ).then( function() {


            var protocol = '';
            if( self.config.useSSL ) {
                protocol = 'HTTPS';
                server = https.createServer( {
                    key: self.config.sslKey,
                    cert: self.config.sslCert
                }, this._requestHandler );
                console.log( 'To load the SSL har-server in Chrome, add the --ignore-certificate-errors command line switch' );

            } else {
                protocol = 'HTTP';
                server = http.createServer( this._requestHandler );

            }


            return new Promise( function( resolve, reject ) {
                server.listen( self.config.listeningPort, function( err ) {
                    if( err ) {
                        return reject( err );
                    }
                    console.log( protocol + ' is listening on ' + self.config.listeningPort );
                    resolve();
                } );
            } );
        } );
    };

    this._requestHandler = function _requestHandler( req, res ) {

        var reqChunks = [];
        var reqSize = 0;

        req.on( 'data', function( data ) {
            reqChunks.push( data );
            reqSize += data.length;
        } );

        req.on( 'end', function() {
            return Promise.resolve()
                .then( function() {
                    return handleRequest( req, res, reqChunks, reqSize );
                } );
        } );
    };

    /**
     * Returns true if the server is running; otherwise false
     * @returns {boolean}
     */
    this.isRunning = function isRunning() {
        return !_.isUndefined( server ) && _.isObject( server._handle ) && _.isNumber( server._handle.fd );
    };

    /**
     * Stops the server.  If the server is not running,
     * @returns {Promise.<TResult>} Resolves after server has stopped.
     */
    this.stop = function stop() {
        if( !this.isRunning() ) {
            return Promise.resolve();
        }

        return new Promise( function( resolve, reject ) {
            server.close( function( err ) {
                if( err ) {
                    return reject( err );
                }
                resolve();
            } );
        } );
    };

    return self;

    function handleRequest( req, res, reqChunks, reqSize ) {
        var reqBody = '';

        req.parsedUrl = urlLib.parse( req.url );

        if( reqSize > 0 ) reqBody = Buffer.concat( reqChunks, reqSize ).toString();

        res.setHeader( 'Access-Control-Allow-Origin', '*' );
        res.setHeader( 'Access-Control-Allow-Methods', '*' );
        res.setHeader( 'Access-Control-Allow-Headers', '*' );

        if( !userConfig.filterPaths.length ||
            ( userConfig.filterPaths.length &&
                userConfig.filterPaths[ 0 ] !== 'all' &&
                userConfig.filterPaths.indexOf( req.parsedUrl.path ) === -1 )
        ) {
            responseFromHttpRequest( req, res, reqBody );
        } else {
            responseFromHarFile( req, res, reqBody );
        }
    }

    function responseFromHttpRequest( req, res, reqBody ) {
        var reqHost = userConfig.serverUrl;
        var requestOption = {
            hostname: reqHost,
            path: req.parsedUrl.path,
            method: req.method,
            headers: Object.assign( req.headers, {
                'Content-Length': Buffer.byteLength( reqBody, 'utf8' )
            } )
        };
        if( userConfig.serverPort ) requestOption.port = userConfig.serverPort;
        if( userConfig.serverProtocol ) requestOption.protocol = userConfig.serverProtocol;

        var reqToServer = http.request( requestOption, function( response ) {
            var chunks = [];
            var size = 0;

            response.on( 'data', function( chunk ) {
                chunks.push( chunk );
                size += chunk.length;
            } );

            response.on( 'end', function() {
                var body = '';

                if( size > 0 ) body = Buffer.concat( chunks, size ).toString();

                if( response.statusCode !== 200 ) {
                    console.error( '\nError on request to serverUrl: ', response.statusMessage );
                    console.error( '\nResponse body: ', body );
                    console.log( '\nTrying to get data from har file...\n' );
                    responseFromHarFile( req, res, reqBody );
                    return;
                } else {
                    console.log( 'Requested from server: ' + req.method + ' (' + response.statusCode + ') ' + reqHost + ' ' + req.parsedUrl.path );

                    res.end( body );
                    return;
                }
            } );
        } );

        reqToServer.on( 'error', function( err ) {
            console.error( 'Error on request to serverUrl: ', err );
            console.log( 'Trying to get data from har file...' );
            responseFromHarFile( req, res, reqBody );
        } );

        reqToServer.write( reqBody );
        reqToServer.end();
    }

    function responseFromHarFile( req, res, reqBody ) {
        var reqHost = userConfig.serverUrl + ( userConfig.serverPort ? ':' + userConfig.serverPort : '' );
        var harEntry = findEntry( req, reqHost, reqBody, har );

        if( !reqHost ) {
            console.error( 'Not set serveUrl in config' );
            res.end( 'Not set serverUrl to config' );
            return;
        }

        if( harEntry === null || typeof harEntry === 'undefined' ) {
            res.statusCode = 404;
            console.error( req.method + ' (' + res.statusCode + ') ' + reqHost + ' ' + req.url + ' (Not in HAR file)' );
            res.end( JSON.stringify( {
                error: 'Cannot find HAR file entry for a ' + req.method + ' to ' + req.url
            } ) );
            return;
        }

        if( !harEntry.response.content.text && harEntry.response.content.size > 0 ) {
            res.statusCode = 404;
            console.error( req.method + ' (' + res.statusCode + ') ' + reqHost + ' ' + req.url + ' (No response body in HAR file.)' );
            res.end( JSON.stringify( {
                error: 'No response body in HAR file a ' + req.method + ' request to ' + req.url
            } ) );
            return;
        }


        res.statusCode = harEntry.response.status;
        for( var i = 0; i < harEntry.response.headers.length; i++ ) {
            var curHeader = harEntry.response.headers[ i ];

            var lowerCaseHeader = curHeader.name.toLowerCase();
            if( lowerCaseHeader === 'content-encoding' ) {
                continue;
            }

            if( lowerCaseHeader === 'content-length' ) {
                continue;
            }

            res.setHeader( curHeader.name, curHeader.value );
        }

        console.log( 'Requested from har file: ' + req.method + ' (' + harEntry.response.status + ') ' + reqHost + ' ' + req.parsedUrl.path );

        if( harEntry.response.content.encoding === 'base64' ) {
            return res.send( new Buffer( harEntry.response.content.text, 'base64' ) );
        }

        res.end( harEntry.response.content.text );
    }

    function findEntry( req, reqHost, reqBody ) {
        if( !har.log || !har.log.entries ) {
            return null;
        }

        return har.log.entries.find( function( entry ) {
            if( !_.isObject( entry.parsedUrl ) ) {
                entry.parsedUrl = urlLib.parse( entry.request.url );
            }

            if( req.method !== entry.request.method ) {
                return null;
            }

            if( req.parsedUrl.path !== entry.parsedUrl.path ) {
                return null;
            }

            if( reqHost !== entry.parsedUrl.host ) {
                return null;
            }

            if( reqBody || (entry.request.postData && entry.request.postData.text) ) {

                if( reqBody !== entry.request.postData.text ) {
                    return null;
                }
            }

            return entry;
        } );
    }

}

module.exports = HarServer;
