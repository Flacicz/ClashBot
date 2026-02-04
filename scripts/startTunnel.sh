#!/bin/bash

remoteServerIP="45.138.74.213"
localPort=8080
remotePort=443
remoteHost="api.clashofclans.com"


echo "Setting up a SSH tunnel..."
echo "Open tunnel through IP = $remoteServerIP"
echo "Local port: $localPort"

if lsof -ti :$localPort > /dev/null 2>&1; then 
	echo "Tunnel is running, stoping..."
	kill $(lsof -ti :$localPort) 2>/dev/null || true
	sleep 2
fi

echo "Checking server availability..."
if ! ping -c 2 $remoteServerIP > /dev/null 2>&1; then
	echo "Server $remoteServerIP not avaliable"
    exit 1
fi

echo "Start tunnel..."
ssh -f \
	-o ServerAliveInterval=30 \
	-o ServerAliveCountMax=3 \
    -L $localPort:$remoteHost:$remotePort root@$remoteServerIP "echo 'Tunnel active' && sleep 3600"

sleep 3
if curl -k -s --max-time 5 https://localhost:$localPort/v1/ > /dev/null; then 
	echo "Tunnel launched successfuly!"
    echo "PID of process: $(lsof -ti :$localPort)"
else
	echo "Can't launch the tunnel"
    exit 1
fi