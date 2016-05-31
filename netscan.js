var newNetscanMinion = function (funcObj) {
    // Build a minion from an anonymous function body
    var blobURL = URL.createObjectURL(new Blob(['(',funcObj.toString(),')()'], {
        type: 'application/javascript'})),
        minion = new Worker(blobURL);
    var _parentMessageHandler;
    var _parentErrorHandler;
    
    minion.onMessageHandler = function(parentMessageHandler){
        if(typeof('function' === _parentMessageHandler)){
            minion.removeEventListener('message', _parentMessageHandler);
        }
        _parentMessageHandler = parentMessageHandler;
        minion.addEventListener('message', _parentMessageHandler);
    }

    minion.onErrorHandler = function(parentErrorHandler){
        if(typeof('function' === _parentErrorHandler)){
            minion.removeEventListener('error', _parentErrorHandler);
        }
        _parentErrorHandler = parentErrorHandler;
        minion.addEventListener('error', _parentErrorHandler);
    }
    
    //release the blob resource
    URL.revokeObjectURL(blobURL);
    return minion;
}

var netscan = {};

var nsVerbosity = {
    None : 0,
    Error : 1,
    Status : 2,
    Info : 3,
    Debug : 4
};

var nsPortScanProtocol = {
    Cors: 0,
    WebSocket: 1
};


(function (){
    "use strict";

    
    netscan = function(config) {
        if(undefined === config || null === config) config = {};

        var RTCPeerConnection = window.RTCPeerConnection
            || window.mozRTCPeerConnection
            || window.webkitRTCPeerConnection;

        var maxWebSocketConnectionsToUniqueHosts = 0 < config.maxWebSocketConnectionsToUniqueHosts ? config.maxWebSocketConnectionsToUniqueHosts : 200; //by default firefox has this cap
        var currentnsVerbosity  = nsVerbosity.None < config.verbosity ? config.verbosity : nsVerbosity.None;        
        var waitOnPortMaxInterval = 0 < config.waitOnPortMaxInterval ? config.waitOnPortMaxInterval : 2000;
        var autoBlockedPorts = [        0,1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,139,143,179,389,465,512,513,514,515,526,530,531,532,540,556,563,587,601,636,993,995,2049,4045,6000
                               ];

        var minions = [];
        var workCompleteCount = 0;
        var startScanOffset = 0;

        var getScanStopPoint = function(startPoint, stopPoint){
            return  stopPoint > (startPoint + maxWebSocketConnectionsToUniqueHosts) ? startPoint + maxWebSocketConnectionsToUniqueHosts : stopPoint;
        }
        
        var createNsMinionParentMessageHandler = function(foundHosts, firstOctets, stopScanOctet, recurseFunction, callBacks){

            var handleRecurseFn = function(dispatch){
                if(dispatch.params.host){
                    foundHosts.push(dispatch.params.host);
                }
                
                if(++workCompleteCount >= (stopScanOctet - startScanOffset)){
                    //slide our range
                    startScanOffset++;
                    var startScanOctet = stopScanOctet + 1;

                    if(255 <= stopScanOctet){
                        log(nsVerbosity.Status, '100% complete')                        
                        currentCompletionStatus = CompletionStatus.Whole;
                        if(callBacks.discoveredHosts){
                            callBacks.discoveredHosts(foundHosts);
                        }
                        return;
                    }
                    
                    //recurse
                    recurseFunction(firstOctets, startScanOctet, foundHosts, callBacks);
                }

                if(0.25 <= (workCompleteCount / stopScanOctet) && currentCompletionStatus < CompletionStatus.Quarter){
                    log(nsVerbosity.Status, '25% complete');
                    currentCompletionStatus = CompletionStatus.Quarter;
                }
                else if(0.5 <= (workCompleteCount / stopScanOctet) && currentCompletionStatus < CompletionStatus.Half){
                    log(nsVerbosity.Status, '50% complete');
                    currentCompletionStatus = CompletionStatus.Half;
                }
                else if(0.75 <= (workCompleteCount / stopScanOctet) && currentCompletionStatus < CompletionStatus.ThreeQuarters){
                    log(nsVerbosity.Status, '75% complete');
                    currentCompletionStatus = CompletionStatus.ThreeQuarters;
                }
            }
            
            return function(e){
                var dispatch = JSON.parse(e.data);
                switch(dispatch.cmd){
                case 'Recurse':
                    handleRecurseFn(dispatch);
                    break;
                default:
                    log(nsVerbosity.Error, 'unhandled cmd in parentHandler');                    
                };
            };
        };

        var CompletionStatus = {
            None : 0,
            Quarter : 1,
            Half : 2,
            ThreeQuarters : 3,
            Whole : 4
        };

        var currentCompletionStatus = CompletionStatus.None;
        
        var createNsMinionPortScanParentMessageHandler = function(host, startPort, stopPort, foundPorts, recurseFunction, callBacks){

            var handleRecurseFn = function(dispatch){

                var stopScanPort = getScanStopPoint(startPort, stopPort);
                
                if(dispatch.params.port){
                    foundPorts.push(dispatch.params.port);
                }

                if(++workCompleteCount >= (stopScanPort - startScanOffset)){
                    startScanOffset++;

                    if(stopScanPort >= stopPort){
                        log(nsVerbosity.Status, '100% complete');                        
                        currentCompletionStatus = CompletionStatus.Whole;
                        if(callBacks.discoveredPorts){                        
                            callBacks.discoveredPorts(foundPorts);
                        }
                        return;
                    }

                    var startScanPort = stopScanPort + 1;
                    
                    recurseFunction(host, startScanPort, stopPort, foundPorts, callBacks);
                }

                if(0.25 <= (workCompleteCount / stopPort) && currentCompletionStatus < CompletionStatus.Quarter){
                    log(nsVerbosity.Status, '25% complete');
                    currentCompletionStatus = CompletionStatus.Quarter;
                }
                else if(0.5 <= (workCompleteCount / stopPort) && currentCompletionStatus < CompletionStatus.Half){
                    log(nsVerbosity.Status, '50% complete');
                    currentCompletionStatus = CompletionStatus.Half;
                }
                else if(0.75 <= (workCompleteCount / stopPort) && currentCompletionStatus < CompletionStatus.ThreeQuarters){
                    log(nsVerbosity.Status, '75% complete');
                    currentCompletionStatus = CompletionStatus.ThreeQuarters;
                }
            }
            
            return function(e){
                var dispatch = JSON.parse(e.data);
                switch(dispatch.cmd){
                case 'Recurse':                   
                    handleRecurseFn(dispatch);
                    break;
                default:
                    log(nsVerbosity.Error, 'unhandled cmd in parentHandler');                    
                };
            };
        };

        
        var nsMinion = function(){

            var WebSocketReadyState = {
                Connecting: 0, //The connection is not yet open.
                Open: 1, //The connection is open and ready to communicate.
                Closing: 2, //The connection is in the process of closing.
                Closed: 3, //The connection is closed or couldn't be opened.
            };
            var waitOnPortMaxInterval = 3000;
            self.isSocketOpen = false;

            var accumulateSubnets = function(ws, startTime, host, port)
            {                
                var networkAddress = host.split('.').splice(0,3);
                var interval = (new Date).getTime() - startTime;

                var closeAndRecurse = function(){
                    ws.close();
                    setTimeout(function(){
                        postMessage(JSON.stringify({'cmd': 'Recurse', 'params': {
                            'networkAddress': networkAddress
                        }}));
                    }, 1);
                    
                    return;
                };
                
                if(ws.readyState === WebSocketReadyState.Connecting) //connection not yet establised
                {
                    if(interval > waitOnPortMaxInterval)
                    {                        
                        closeAndRecurse();
                        
                        return;
                    }
                    else
                    {
                        
                        setTimeout(function(){
                            accumulateSubnets(ws, startTime, host, port); //try, try again
                        },100);
                    }
                }
                else
                {

                    if(interval > waitOnPortMaxInterval)
                    {
                        closeAndRecurse();
                        
                        return;
                    }

                    ws.close();
                    
                    setTimeout(function(){
                        postMessage(JSON.stringify({'cmd': 'Recurse', 'params': {
                            'networkAddress': networkAddress,
                            'host': host,
                            'port': port
                        }}));
                    }, 1);
                    
                    return;
                }
            };
            
            var detectHost = function(firstThreeOctets, fourthOctet, port)
            {
                port = port ? port : 80;

                var startTime = (new Date).getTime();                        

                var networkAddress = firstThreeOctets + "." + fourthOctet;
                var uri = "ws://" + networkAddress + ":" + port;
                var ws = new WebSocket(uri);
                self.isSocketOpen = true;

                ws.onclose = function(){
                    self.isSocketOpen = false;
                };
                setTimeout(function(){
                    accumulateSubnets(ws, startTime, firstThreeOctets + '.' + fourthOctet, port);
                },100);
            };
            
            var minionMessageHandler = function(event){
                var dispatch = JSON.parse(event.data);
                
                if(!isNaN(dispatch.params.waitOnPortMaxInterval)){
                    waitOnPortMaxInterval = dispatch.params.waitOnPortMaxInterval;
                }
                switch(dispatch.cmd){
                case 'detectHost':
                    detectHost(dispatch.params.firstThreeOctets, dispatch.params.fourthOctet, dispatch.params.port);
                    break;                        
                default:
                    console.log('unhandled command ', dispatch.cmd);
                    break;
                };
            };
            
            addEventListener('message', minionMessageHandler);
            
        };

        var loadMinionPool = function(){
            for(var index=0; index<minions.length; ++index){
                minions[index].terminate();
            }

            minions = [];
            
            for(var index=0; index<maxWebSocketConnectionsToUniqueHosts; ++index){
                minions.push(new newNetscanMinion(nsMinion));
            }
        };
        loadMinionPool();

        var scanSubnetsRec = function(firstTwoOctets, startThirdOctet, subNets, callBacks){

            var stopOctet = getScanStopPoint(startThirdOctet, 255);
            
            var messageHandler = createNsMinionParentMessageHandler(subNets, firstTwoOctets, stopOctet, scanSubnetsRec, callBacks);
            
            var thirdOctet = startThirdOctet;
            var numberOfOctets = stopOctet - startThirdOctet;

            for(var index=0; index<numberOfOctets; ++index){
                var minion = minions[index];
                minion.onMessageHandler(messageHandler);
                minion.onErrorHandler(callBacks.onErrorHandler);                
                
                minion.postMessage(JSON.stringify({'cmd': 'detectHost', 'params': {
                    'firstThreeOctets': firstTwoOctets.join(".") + "." + thirdOctet++,
                    'fourthOctet': 1,
                    'waitOnPortMaxInterval': waitOnPortMaxInterval
                }}));
            }
            
        };
        
        
        var scanSubnetForHostsRec = function(firstThreeOctets, startFourthOctet, hosts, callBacks){

            var stopOctet = getScanStopPoint(startFourthOctet, 255);
            
            var messageHandler = createNsMinionParentMessageHandler(hosts, firstThreeOctets, stopOctet, scanSubnetForHostsRec, callBacks);

            var fourthOctet = startFourthOctet;
            var numberOfOctets = stopOctet - startFourthOctet;

            for(var index=0; index<numberOfOctets; ++index){
                var minion = minions[index];
                
                minion.onMessageHandler(messageHandler);
                minion.onErrorHandler(callBacks.onErrorHandler);
                minion.postMessage(JSON.stringify({'cmd': 'detectHost', 'params': {
                    'firstThreeOctets': firstThreeOctets.join('.'),
                    'fourthOctet': fourthOctet++,
                    'waitOnPortMaxInterval': waitOnPortMaxInterval
                }}));
            }

        };

        var scanHostForPortsRec = function(host, startPort, stopPort, openPorts, callBacks){
            
            var stopScanPort = getScanStopPoint(startPort, stopPort);
            var messageHandler = createNsMinionPortScanParentMessageHandler(host, startPort, stopPort, openPorts, scanHostForPortsRec, callBacks);

            var port = startPort;
            var numberOfPorts = stopScanPort - startPort;            
            var bytes = host.split('.');
            var firstThreeOctets = bytes.splice(0,3);
            var fourthOctet = bytes;

            for(var index=0; index<numberOfPorts; ++index){
                if(isBlocked(port)) {
                    ++workCompleteCount;
                    continue;
                }

                var minion = minions[index];
                
                minion.onMessageHandler(messageHandler);
                minion.onErrorHandler(callBacks.onErrorHandler);
                minion.postMessage(JSON.stringify({'cmd': 'detectHost', 'params': {
                    'firstThreeOctets': firstThreeOctets.join('.'),
                    'fourthOctet': fourthOctet,
                    'port': port++,
                    'waitOnPortMaxInterval': waitOnPortMaxInterval
                }}));
            }

        }

        var accumulateIps = function(candidate, knownIps, callback){

            //match just the IP address
            var ip_regex = /([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/
                var ip_addr = ip_regex.exec(candidate)[1];
            //remove duplicates
            if(knownIps[ip_addr] === undefined)
                callback(ip_addr);

            knownIps[ip_addr] = true;
        }
        
        var log = function(verbosity, toLog, objToLog)
        {        
            switch(currentnsVerbosity){
            case nsVerbosity.None:
                break;        
            case nsVerbosity.Debug:
                if(nsVerbosity.Debug === verbosity){
                    console.log('Debug: '+ toLog, (objToLog ? objToLog : ''));
                }
            case nsVerbosity.Info:
                if(nsVerbosity.Info === verbosity){
                    console.log('Info: '+ toLog, (objToLog ? objToLog : ''));
                }            
            case nsVerbosity.Status:
                if(nsVerbosity.Status === verbosity){
                    console.log('Status: '+ toLog, (objToLog ? objToLog : ''));
                }
            case nsVerbosity.Error:
                if(nsVerbosity.Error === verbosity){
                    console.log('Error: '+ toLog, (objToLog ? objToLog : ''));
                }            
            };
        };

        var getHostIpAddress = function(callback, options){

            var knownIps = options && options.knownIps ? options.knownIps : {};                
            var servers = options && options.iceServers ? {iceServers: options.iceServers} : {iceServers: []};

            //construct a new RTCPeerConnection
            var pc = new RTCPeerConnection(servers, {optional: [{RtpDataChannels: true}]});

            //listen for candidate events
            pc.onicecandidate = function(ice){
                //skip non-candidate events
                if(ice.candidate)
                    accumulateIps(ice.candidate.candidate, knownIps, callback);
            };

            //create a bogus data channel
            pc.createDataChannel("");

            //create an offer sdp
            pc.createOffer().then(function(offer){
                //trigger the stun server request
                return pc.setLocalDescription(offer);

            }).then(function(){
                //read candidate info from local description
                var lines = pc.localDescription.sdp.split('\n');
                lines.forEach(function(line){
                    if(line.indexOf('a=candidate:') === 0){
                        accumulateIps(ice.candidate.candidate, knownIps, callback);
                    }
                });
            }).catch(function(reason){
                console.log('something went wrong and the reason was: ', reason);
            });
        };

        var resetScanOut = function()
        {
            workCompleteCount = 0;
            startScanOffset = 0;
            currentCompletionStatus = CompletionStatus.None;
            log(nsVerbosity.Info, '**************************************************************\r\n'
                + '****************** STARTING NEW SCAN *************************\r\n'
                + '**************************************************************');
        }

        var isValidIp = function(v_ip)
        {
            if(((v_ip[0] > 0) && (v_ip[0] <= 223)) &&((v_ip[1] >= 0) && (v_ip[1] <= 255)) && ((v_ip[2] >= 0) && (v_ip[2] <= 255)) && ((v_ip[3] > 0) && (v_ip[3] < 255)))
            {        
                return true;
            }
            else
            {
                log(nsVerbosity.Debug, 'invalid IP entered: ' + v_ip);
                return false;
            }
        };

        var isValidPort = function(port)
        {
            if(port > 0 && port < 65536)
            {
                return true;
            }
            else
            {
                log(nsVerbosity.Debug, 'invalid port entered: ' + port);
                return false;
            }
        };

        var isBlocked = function(port)
        {    
            for(var index=0;index<autoBlockedPorts.length;++index)
            {
                if(port === autoBlockedPorts[index])
                {            
                    return true;
                }
            }
            
            return false;
        };

        var validateCallbacks = function(callBacks){
            if(callBacks){
                if(callBacks.discoveredHosts && typeof callBacks.discoveredHosts !== 'function'){
                    var error = 'expected callBacks.discoveredHosts to be of type function, but was of type :' + typeof callBacks.discoveredHosts + ' aborting.';
                    log(nsVerbosity.Error, error);
                    throw error;
                }

                if(callBacks.onErrorHandler && typeof callBacks.onErrorHandler !== 'function'){
                    var error = 'expected callBacks.onErrorHandler to be of type function, but was of type :' + typeof callBacks.onErrorHandler + ' aborting.';
                    log(nsVerbosity.Error, error);
                    throw error
                }
            }
        };
        
        return {
            scanSubnets : function(firstTwoOctets, callBacks){

                if(!firstTwoOctets){
                    var message = 'please provide the first two octets in the form [octet1,octet2]';
                    log(nsVerbosity.Error, message);
                    throw message;
                }

                validateCallbacks(callBacks);

                resetScanOut();
                log(nsVerbosity.Info, '----------------\n\rScan Log (please be patient):');
                startScanOffset = 0;
                scanSubnetsRec(firstTwoOctets, startScanOffset, [], callBacks);
            },
            scanSubnetForHosts: function(subnet,  callBacks){
                resetScanOut();
                log(nsVerbosity.Info, '----------------\n\rScan Log (please be patient):');
                validateCallbacks(callBacks);
                var firstThreeOctets = subnet.split('.').splice(0,3);
                startScanOffset = 2;
                scanSubnetForHostsRec(firstThreeOctets, startScanOffset, [], callBacks);
            },
            scanHostForPorts: function(host, startPort, stopPort, callBacks){

                resetScanOut();
                log(nsVerbosity.Info, '----------------\n\rScan Log (please be patient):');
                
                if(!host || !isValidIp(host.split('.'))){
                    var message = 'please provide a valid ip address for host';
                    log(nsVerbosity.Error, message);
                    throw message;
                }
                if(!startPort || !isValidPort(startPort)){
                    var message = 'please provide a valid startPort';
                    log(nsVerbosity.Error, message);
                    throw message;
                }
                if(!stopPort || !isValidPort(stopPort)){
                    var message = 'please provide a valid endPort';
                    log(nsVerbosity.Error, message);
                    throw message;
                }
                
                validateCallbacks(callBacks);(callBacks);

                startScanOffset = startPort;
                scanHostForPortsRec(host, startPort, stopPort, [], callBacks);
            },
            getInternalIpAddress: function(callback){
                resetScanOut();
                log(nsVerbosity.Info, '----------------\n\rScan Log (please be patient):');

                getHostIpAddress(function(ip){
                    callback(ip);
                });
            },
            getExternalIpAddress: function(callback){
                resetScanOut();
                log(nsVerbosity.Info, '----------------\n\rScan Log (please be patient):');
                
                var options = {
                    knownIps:{},
                    iceServers: [{urls: "stun:stun.services.mozilla.com"}]
                };

                var foundIps = 0;
                var previousFoundIps = -1;
                var lastReceivedTime = (new Date).getTime();


                //////////////////////////////////////////////////////////////////
                // This is where I am.                                          //
                //     I am trying to get external ip addresses using recursion //
                //////////////////////////////////////////////////////////////////
                
                var getInternalIps = function(){
                    getHostIpAddress(function(ip){
                        lastReceivedTime = (new Date).getTime();
                        if(options.knownIps[ip]){
                            previousFoundIps = foundIps;
                        }
                        else{
                            options.knownIps[ip] = true;
                            previousFoundIps = foundIps++;
                            //callback(ip);                    
                        }
                    });
                };

                var getExternalIps = function(){
                    
                    var elapsed = (new Date).getTime() - lastReceivedTime;

                    if(elapsed < 1000){
                        setTimeout(getExternalIps, 500);
                    }
                    else{
                        getHostIpAddress(function(ip){
                            callback(ip);
                        }, options);
                    }
                    
                };

                
                getInternalIps();
                getExternalIps();
            }
        };
    };


    
})();
