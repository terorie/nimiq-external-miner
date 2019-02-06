const fs = require('fs');
const JSON5 = require('json5');
const Miner = require('./src/Miner.js');

function humanHashrate(hashes) {
    let thresh = 1000;
    if (Math.abs(hashes) < thresh) {
        return hashes + ' H/s';
    }
    let units = ['kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s', 'ZH/s', 'YH/s'];
    let u = -1;
    do {
        hashes /= thresh;
        ++u;
    } while (Math.abs(hashes) >= thresh && u < units.length - 1);
    return hashes.toFixed(1) + ' ' + units[u];
}

function readConfigFile(fileName) {
    try {
        const config = JSON5.parse(fs.readFileSync(fileName));
        // TODO: Validate
        return config;
    } catch (e) {
        console.error(`Failed to read config file ${fileName}: ${e.message}`);
        return false;
    }
}

const config = readConfigFile('./miner.conf');
if (!config) {
    process.exit(1);
}

(async () => {

    const miner = new Miner(config.host, config.port, config.address, config.extraData,
        config.devices, config.memory);

    miner.on('share', nonce => {
        console.log(`Share found. Nonce: ${nonce}`);
    });
    miner.on('hashrates-changed', hashrates => {
        const totalHashRate = hashrates.reduce((a, b) => a + b);
        const gpuInfo = miner.gpuInfo;
        console.log(`Hashrate: ${humanHashrate(totalHashRate)} | ${hashrates.map((hr, idx) => `GPU${gpuInfo[idx].idx}: ${humanHashrate(hr)}`).join(' | ')}`);
    });

    miner.start();


})().catch(e => {
    console.error(e);
    process.exit(1);
});
