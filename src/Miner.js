const Observable = require('./Observable.js');
const NativeMiner = require('bindings')('nimiq_miner.node');

const request = require('request').defaults({
    json: true
});

const POLL_INTERVAL = 1000;

const INITIAL_SEED_SIZE = 256;
const MAX_NONCE = 2 ** 32;
const HASHRATE_MOVING_AVERAGE = 5; // seconds
const HASHRATE_REPORT_INTERVAL = 5; // seconds

const ARGON2_ITERATIONS = 1;
const ARGON2_LANES = 1;
const ARGON2_MEMORY_COST = 512;
const ARGON2_VERSION = 0x13;
const ARGON2_TYPE = 0; // Argon2D
const ARGON2_SALT = 'nimiqrocks!';
const ARGON2_HASH_LENGTH = 32;

class Miner extends Observable {

    constructor(host, port, address, extraData, allowedDevices, memorySizes) {
        super();
        this._url = `http://${host}:${port}`;
        this._address = address;
        this._extraData = Buffer.isBuffer(extraData) ? extraData : Buffer.from(extraData);

        this._miningEnabled = false;
        this._height = 0;
        this._nonce = 0;
        this._workId = 0;

        allowedDevices = Array.isArray(allowedDevices) ? allowedDevices : [];
        memorySizes = Array.isArray(memorySizes) ? memorySizes : [];

        const miner = new NativeMiner.Miner(allowedDevices, memorySizes);
        const workers = miner.getWorkers();

        this._hashes = new Array(workers.length).fill(0);
        this._lastHashRates = this._hashes.map(_ => []);

        this._miner = miner; // Keep GC away
        this._workers = workers.map((w, idx) => {
            const noncesPerRun = w.noncesPerRun;

            return (blockHeader, blockSuffix, shareCompact) => {
                const workId = this._workId;
                const next = () => {
                    const startNonce = this._nonce;
                    this._nonce += noncesPerRun;
                    w.mineNonces((error, nonce) => {
                        if (error) {
                            throw error;
                        }
                        this._hashes[idx] += noncesPerRun;
                        // Another block arrived
                        if (workId !== this._workId) {
                            return;
                        }
                        if (nonce > 0) {
                            this._onWorkerShare(blockHeader, blockSuffix, nonce);
                        }
                        if (this._miningEnabled && this._nonce < MAX_NONCE) {
                            next();
                        }
                    }, startNonce, shareCompact);
                }

                w.setup(this._getInitialSeed(blockHeader));
                next();
            };
        });
        this._gpuInfo = workers.map(w => {
            return {
                idx: w.deviceIndex,
                name: w.deviceName,
                vendor: w.deviceVendor,
                driver: w.driverVersion,
                computeUnits: w.maxComputeUnits,
                clockFrequency: w.maxClockFrequency,
                memSize: w.globalMemSize
            };
        });
    }

    _getInitialSeed(blockHeader) {
        const seed = Buffer.alloc(INITIAL_SEED_SIZE);
        seed.writeUInt32LE(ARGON2_LANES, 0);
        seed.writeUInt32LE(ARGON2_HASH_LENGTH, 4);
        seed.writeUInt32LE(ARGON2_MEMORY_COST, 8);
        seed.writeUInt32LE(ARGON2_ITERATIONS, 12);
        seed.writeUInt32LE(ARGON2_VERSION, 16);
        seed.writeUInt32LE(ARGON2_TYPE, 20);
        seed.writeUInt32LE(blockHeader.length, 24);
        blockHeader.copy(seed, 28);
        seed.writeUInt32LE(ARGON2_SALT.length, 174);
        seed.write(ARGON2_SALT, 178, 'ascii');
        return seed;
    }

    _reportHashRates() {
        this._lastHashRates.forEach((hashRates, idx) => {
            const hashRate = this._hashes[idx] / HASHRATE_REPORT_INTERVAL;
            hashRates.push(hashRate);
            if (hashRates.length > HASHRATE_MOVING_AVERAGE) {
                hashRates.shift();
            }
        });
        this._hashes.fill(0);
        const averageHashRates = this._lastHashRates.map(hashRates => hashRates.reduce((sum, val) => sum + val, 0) / hashRates.length);
        this.fire('hashrates-changed', averageHashRates);
    }


    _rpc(method, params) {
        return new Promise((resolve, reject) => {
            const body = { jsonrpc: '2.0', id: 42, method, params };
            request.post({ url: this._url, body }, (error, response, body) => {
                if (error) {
                    reject(error);
                    return;
                }
                if (response.statusCode !== 200) {
                    reject(new Error(`Request (${method}) failed: ${response.statusCode} ${response.statusMessage || ''}`));
                    return;
                }
                if (body.error) {
                    reject(new Error(`Request (${method}) failed: ${body.error.code} ${body.error.message || ''}`));
                    return;
                }
                resolve(body.result);
            });
        });
    }

    _getWork() {
        return this._rpc('getWork', [this._address, this._extraData.toString('hex')]);
    }

    _submitShare(blockHeader, blockSuffix, nonce) {
        const block = Buffer.concat([blockHeader, blockSuffix]);
        block.writeUInt32BE(nonce, 142);
        return this._rpc('submitBlock', [block.toString('hex')]);
    }

    _startMiningOnBlock(blockHeader, blockSuffix, shareCompact, height) {
        this._workId++;
        this._nonce = 0;
        if (!this._hashRateTimer) {
            this._hashRateTimer = setInterval(() => this._reportHashRates(), 1000 * HASHRATE_REPORT_INTERVAL);
        }

        console.log(`Starting work on block #${height}`);
        this._workers.forEach(worker => worker(blockHeader, blockSuffix, shareCompact));
    }

    async _pollNextBlock() {
        if (!this._miningEnabled) {
            return;
        }
        try {
            const work = await this._getWork();
            const blockHeader = Buffer.from(work.data, 'hex');
            const height = blockHeader.readUInt32BE(134);
            if (height > this._height) {
                this._height = height;
                const blockSuffix = Buffer.from(work.suffix, 'hex'); // interlink + body
                const shareCompact = work.target;
                this._startMiningOnBlock(blockHeader, blockSuffix, shareCompact, height);
            }
        } catch (e) {
            console.error('Failed polling next block', e);
            // TODO Stop GPU if RPC is not available
        }
        setTimeout(() => this._pollNextBlock(), POLL_INTERVAL);
    }

    async _onWorkerShare(blockHeader, blockSuffix, nonce) {
        try {
            await this._submitShare(blockHeader, blockSuffix, nonce);
            this.fire('share', nonce);
        } catch (e) {
            console.error('Failed submitting block', e);
        }
    }

    start() {
        this._miningEnabled = true;
        this._pollNextBlock();
    }

    stop() {
        this._miningEnabled = false;
        if (this._hashRateTimer) {
            clearInterval(this._hashRateTimer);
            delete this._hashRateTimer;
        }
    }

    get gpuInfo() {
        return this._gpuInfo;
    }
}

module.exports = Miner;
