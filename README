## Quickstart (Ubuntu/Debian)

0. You need [Nimiq node](https://github.com/nimiq-network/core) running somewhere with RPC server enabled (`--rpc`).

1. Install [Node.js](https://github.com/nodesource/distributions/blob/master/README.md#debinstall).
2. Install `git` and `build-essential`: `sudo apt-get install -y git build-essential`.
3. Install `opencl-headers`: `sudo apt-get install opencl-headers`.
4. Install OpenCL-capable drivers for your GPU ([Nvidia](https://www.nvidia.com/Download/index.aspx) or [AMD](https://www.amd.com/en/support)).
5. Clone this repository: `git clone https://github.com/tomkha/nimiq-external-miner.git`.
6. Build the project: `cd nimiq-external-miner && npm install`.
7. Copy miner.sample.conf to miner.conf: `cp miner.sample.conf miner.conf`.
8. Edit miner.conf, specify Nimiq RPC server host and port, your wallet address and the UNIQUE extra data.
9. Run the miner `UV_THREADPOOL_SIZE=8 nodejs index.js`. Ensure UV_THREADPOOL_SIZE is higher than a number of GPU in your system.
