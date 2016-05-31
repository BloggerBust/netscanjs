#What is this about?
Netscanjs is intended for educational pruposes only. I am currently working on a blog that uses this netscanjs to illustrate examples. Once the blog has been published I will add a link to it and improve this readme. Netscanjs is limited in many ways, but it is simple to use and worked well for my purposes.

#Code Example
```javascript
var scan = new netscan({
    verbosity: nsVerbosity.Debug, //defaults to nsVerbosity.None
    waitOnPortMaxInterval: 2200, //defaults to 2000ms. I honestly don't know what a good default is here. What is optimal for subnet and host scanning is not optimal for port scanning.
    maxWebSocketConnectionsToUniqueHosts: 100 //Defaults to 200 which is the default maximum number of allowable websocket connections by firefox.
});

var scanForSubnets = function(firstTwoOctets){
    scan.scanSubnets(firstTwoOctets, {
        discoveredHosts: function(hosts){
            console.log('subNets returned to calling code: ', hosts);
        },
        onErrorHandler: function(error) {
            console.log('Error From calling code: Line '+ error.lineno + ' in ' + error.filename + ': ' + error.message);
        }});
};

var scanSubnetForHosts = function(subnet){
    scan.scanSubnetForHosts(subnet, {
        discoveredHosts: function(hosts){
            console.log('hosts returned to calling code: ', hosts);
        },
        onErrorHandler: function(error) {
            console.log('Error From calling code: Line '+ error.lineno + ' in ' + error.filename + ': ' + error.message);
        }});
};


var scanHostForPorts = function(host, startPort, endPort){
    scan.scanHostForPorts(host, startPort, endPort, {
        discoveredPorts: function(openPorts){
            console.log('ports returned to calling code: ', openPorts);
        },
        onErrorHandler: function(error) {
            console.log('Error From calling code: Line '+ error.lineno + ' in ' + error.filename + ': ' + error.message);
        }});
};
```
It is important to not call these functions concurrently. If you want to be able to use them together then you will need to make use of the callback functions. I regret not using promises now, but again the point of this library is for illustration and is not meant to be part of a solution.

##To scan for subnets
```javascript
scanForSubnets([192,168]);
```
##To scan a subnet for hosts
```javascript
scanSubnetForHosts('192.168.10.1');
```
##To get the hosts internal IP addresss
```javascript
scan.getInternalIpAddress(function(ip){
     console.log('Internal IP = ' + ip);
});
```

##To get the hosts external IP addresses
```javascript
scan.getExternalIpAddress(function(ip){
    console.log('External IP = ' + ip);
 });
 ```
 #Motivation
 Used by a blog that I am currently writing for illustration and educational purposes.

#License
GPLv3