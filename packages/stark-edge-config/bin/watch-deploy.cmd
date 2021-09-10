@ECHO OFF
cd ../../..
if not exist ".\dist\" npm install

node dist/cli/cli stark-edge-config
pause