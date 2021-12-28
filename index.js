require('dotenv').config();

const { ethers } = require("ethers");
const { formatEther } = require("ethers/lib/utils");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const SOS_ABI = require("./abi/OpenDAO.json");
const SOS_ADDRESS = "0x3b484b82567a09e2588A13D54D032153f0c0aEe0";
const OPENSEA_ABI = require("./abi/OpenSea.json");
const OPENSEA_ADDRESS = "0x7Be8076f4EA4A4AD08075C2508e481d6C946D12b";
const SOS_START_BLOCK = 13860522;
const OPENSEA_START_BLOCK = 5774644;

const csvWriter = createCsvWriter({
  path: "sos_scan.csv",
  header: [
    {id: "wallet", title: "Wallet"},
    {id: "claimed", title: "Claimed"},
    {id: "txHash", title: "Tx Hash"},
  ],
  append: true,
})

const main = async () => {
  const provider = new ethers.providers.WebSocketProvider(process.env.WS_NODE_URI);
  const contract = getSOSContract(provider);

  const endBlock = await provider.getBlockNumber();
  const interval = 5000;

  for (let i = SOS_START_BLOCK; i < endBlock; i += interval) {
    const _startBlock = i;
    const _endBlock = Math.min(endBlock, i + 4999);
    console.log(`------ Scanning Block ${_startBlock} to ${_endBlock} ----------`);
    const claims = await getClaims(contract, _startBlock, _endBlock);
    console.log(`Found ${claims.length} claims`);
    await filterZeroOpenSeaWallet(provider, claims);
  }
}

const getSOSContract = (provider) => {
  const contract = new ethers.Contract(SOS_ADDRESS, SOS_ABI, provider);
  return contract;
}

const getClaims = async (contract, startBlock, endBlock) => {
  const filter = contract.filters.Transfer(ethers.constants.AddressZero);
  const events = await contract.queryFilter(filter, startBlock, endBlock);
  return events;
}

const filterOSEvents = async (opensea, filter) => {
  const interval = 100000;
  for (let i = SOS_START_BLOCK; i > OPENSEA_START_BLOCK; i -= interval) {
    const startBlock = Math.max(i, OPENSEA_START_BLOCK);
    const endBlock = i + interval;
    const events = await opensea.queryFilter(filter, startBlock, endBlock);
    if (events.length > 0) {
      return true;
    }
  }

  return false;
}

const filterZeroOpenSeaWallet = async (provider, claimEvents) => {
  const opensea = new ethers.Contract(OPENSEA_ADDRESS, OPENSEA_ABI, provider);

  for (const event of claimEvents) {
    const wallet = event.args.to;
    const buyerFilter = opensea.filters.OrdersMatched(null, null, null, wallet)
    const hasBuyEvents = await filterOSEvents(opensea, buyerFilter);
    if (!hasBuyEvents) {
      const sellerFilter = opensea.filters.OrdersMatched(null, null, wallet)
      const hasSellEvents = await filterOSEvents(opensea, sellerFilter);
      if (!hasSellEvents) {
        console.log(`!!!!!!!!!!!!!!!!!!!!!!!!!!! No OS transaction ${wallet} !!!!!!!!!!!!!!!!!!!!!!`);
        const amountClaimed = formatEther(event.args.value);
        const maliciousData = [{
          wallet: wallet,
          claimed: amountClaimed,
          txHash: event.transactionHash,
        }]
        csvWriter.writeRecords(maliciousData)
      } else {
        console.log(`${wallet}: has sales`);
      }
    } else {
      console.log(`${wallet}: has buys`);
    }
  }
}

main()
  .then(text => {
    console.log(text);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

