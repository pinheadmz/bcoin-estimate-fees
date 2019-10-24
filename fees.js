// This script starts a full node, generates blocks, then starts generating
// transactions with specified fee rates. The block size limit is lowered.
// Large batches of TXs are generated such that they take 5 blocks to clear out.
// The number of transactions generated at each fee rate is calibrated with
// the block size limit such that transactions within a fee range are always
// confirmed together, at increasing numbers of blocks. The goal is to feed
// the fee estimator a set of data with a "right answer".
// For example, TXs with fees under 1000 will always take 5 blocks to confirm.
// TXs with fees in the range 1000-10000 will take 4 blocks, and so on. This
// can be checked by watching the output from the stubbed processBlockTX
// function. After enough cycles, we expect the fee estimator to return target
// estimates for each nBlocks that match the TXs/confirmation times we created.

'use strict';

const bcoin = require('bcoin');
const plugin = bcoin.wallet.plugin;

// Create a bcoin full node
const node = new bcoin.FullNode({
  network: 'regtest',
  memory: true
});

// Stub mempool function to log TX details (optional)
node.mempool.fees.f = node.mempool.fees.processBlockTX;
node.mempool.fees.processBlockTX = function processBlockTX(height, entry) {
  const blocks = height - entry.height;
  const fee = entry.getFee();
  console.log(`Fee: ${fee}, Blocks: ${blocks}`);

  return node.mempool.fees.f(height, entry);
};

// Add a wallet to the full node
node.use(plugin);
const wdb = node.plugins.walletdb.wdb;

// Function to mine blocks and add to chain
async function mineBlock() {
  const block = await node.miner.mineBlock();
  await node.chain.add(block);
  return block;
}

// Function to send a transaction with a specific fee rate
let primary, newAddr;
async function sendTX(rate) {
  await primary.send({
    outputs: [{value: 800, address: newAddr}],
    rate: rate
  });
}

// Function to output fee estimates for a range of targets
async function printRates() {
  for (let i = 1; i <= 6; i++)
    console.log(`Target ${i} blocks: ${node.fees.estimateFee(i, true)}`);
}

(async () => {
  await node.open();
  await node.connect();

  // Artificially limit the block size
  node.miner.options.maxWeight = 45000;

  // Get a wallet address to mine to
  primary = await wdb.get('primary');
  const minerReceive = await primary.receiveAddress(0);
  node.miner.addresses.length = 0;
  node.miner.addAddress(minerReceive);

  // Get an address to send transactions to
  newAddr = await primary.receiveAddress(0);

  // Mine initial blocks
  for (let i = 0; i < 400; i++)
    await mineBlock();

  // Give the wallet DB a chance to catch up to the chain
  await wdb.rescan();

  // Create blocks and transactions
  for (let blocks = 0; blocks < 500; blocks++) {
    console.log(`Generating block #${blocks}`);

    if (blocks % 3 === 0) {
      for (let txs = 0; txs < 45; txs++)
        await sendTX(100000);

      for (let txs = 0; txs < 45; txs++)
        await sendTX(10000);

      for (let txs = 0; txs < 45; txs++)
        await sendTX(1000);
    }

    const block = await mineBlock();

    // Monitor mempool "backlog"
    console.log(
      'Block txs:',
      block.txs.length,
      'Mempool size:',
      node.mempool.getSnapshot().length
    );
      printRates();
      // for (const s of node.fees.feeStats.confAvg)
      // console.log(s.toString())
      console.log('--');
  }

  process.exit(0);
})().catch((err) => {
  console.error(err.stack);
  process.exit(1);
});
