require('dotenv').config();

const { ethers } = require("ethers");
const { formatEther, parseEther } = require("ethers/lib/utils");
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const SOS_ABI = require("./abi/OpenDAO.json");
const SOS_ADDRESS = "0x3b484b82567a09e2588A13D54D032153f0c0aEe0";
const OPENSEA_ABI = require("./abi/OpenSea.json");
const OPENSEA_ADDRESS = "0x7Be8076f4EA4A4AD08075C2508e481d6C946D12b";
const SOS_START_BLOCK = 13860522;
const OPENSEA_START_BLOCK = 5774644;
const SNAPSHOT_BLOCK = 13858107;

const csvWriterBad = createCsvWriter({
  path: "sos_bad_claims.csv",
  header: [
    {id: "wallet", title: "Wallet"},
    {id: "claimed", title: "Claimed"},
    {id: "txHash", title: "Tx Hash"},
  ],
  append: true,
})

const csvWriterAll = createCsvWriter({
  path: "sos_all_claims.csv",
  header: [
    {id: "wallet", title: "Wallet"},
    {id: "claimed", title: "Claimed"},
    {id: "txHash", title: "Tx Hash"},
    {id: "numberBuy", title: "# OS Purchases"},
    {id: "totalETHBuy", title: "Total ETH (Purchase)"},
    {id: "numberSell", title: "# OS Sales"},
    {id: "totalETHSell", title: "Total ETH (Sales)"},
  ],
  append: true,
})


const main = async () => {
  let providers = [
    new ethers.providers.WebSocketProvider(process.env.WS_NODE_URI),
    new ethers.providers.WebSocketProvider(process.env.WS_NODE_URI),
    new ethers.providers.WebSocketProvider(process.env.WS_NODE_URI),
  ]
  const contract = getSOSContract(providers[0]);

  const endBlock = await providers[0].getBlockNumber();
  const interval = 100;

  let tasks = [];
  let counter = 0;

  for (let i = SOS_START_BLOCK; i < endBlock; i += interval) {
    const _endBlock = Math.min(endBlock, i + interval);
    const task = parseClaims(providers[counter % 5], contract, i + 1, _endBlock);
    tasks.push(task);

    counter += 1;
    if ((counter % 3) == 0) {
      await Promise.all(tasks);
      tasks = [];
    }
  }
}

const getSOSContract = (provider) => {
  const contract = new ethers.Contract(SOS_ADDRESS, SOS_ABI, provider);
  return contract;
}

const parseClaims = async (provider, contract, startBlock, endBlock) => {
  console.log(`------ Scanning Block ${startBlock} to ${endBlock} ----------`);
  const filter = contract.filters.Transfer(ethers.constants.AddressZero);
  const claimEvents = await contract.queryFilter(filter, startBlock, endBlock);
  console.log(`Found ${claimEvents.length} claims`);
  await parseOpenseaTx(provider, claimEvents);
}

// const filterOSEvents = async (opensea, filter) => {
//   const interval = 10000;
//   let allEvents = []
//   for (let i = OPENSEA_START_BLOCK; i < SNAPSHOT_BLOCK; i += interval) {
//     const startBlock = i;
//     const endBlock = Math.min(i + interval, SNAPSHOT_BLOCK);
//     console.log(`Scanning filterOSEvents ${startBlock} to ${endBlock}`);
//     const events = await opensea.queryFilter(filter, startBlock, endBlock);
//     if (events.length > 0) {
//       allEvents = [...allEvents, events];
//     }
//   }
//   return allEvents;
// }


const filterOSEvents = async (opensea, filter) => {
  const interval = 10000;
  let allEvents = []
  for (let i = OPENSEA_START_BLOCK; i < SNAPSHOT_BLOCK; i += interval) {
    const startBlock = i;
    const endBlock = Math.min(i + interval, SNAPSHOT_BLOCK);
    const events = await opensea.queryFilter(filter, startBlock, endBlock);
    if (events.length > 0) {
      return true;
    }
  }
  return false;
}

const parseOpenseaTx = async (provider, claimEvents) => {
  const opensea = new ethers.Contract(OPENSEA_ADDRESS, OPENSEA_ABI, provider);
  let badData = []

  for (const event of claimEvents) {
    const wallet = event.args.to;
    const amountClaimed = formatEther(event.args.value);

    const buyerFilter = opensea.filters.OrdersMatched(null, null, null, wallet)
    const hasBuyEvents = await filterOSEvents(opensea, buyerFilter);

    const sellerFilter = opensea.filters.OrdersMatched(null, null, wallet)
    const hasSellEvents = await filterOSEvents(opensea, sellerFilter);
    if (!hasBuyEvents && !hasSellEvents) {
      badData.push({
        wallet: wallet,
        claimed: amountClaimed,
        txHash: event.transactionHash,
      });
    };
  };

  if (badData.length > 0) {
    console.log(`Writing ${badData.length} bad data rows`);
    await csvWriterBad.writeRecords(badData);
  };
}

// const parseOpenseaTx = async (provider, claimEvents) => {
//   const opensea = new ethers.Contract(OPENSEA_ADDRESS, OPENSEA_ABI, provider);
//   let badData = []
//   let allData = []

//   for (const event of claimEvents) {
//     const wallet = event.args.to;
//     const amountClaimed = formatEther(event.args.value);

//     const buyerFilter = opensea.filters.OrdersMatched(null, null, null, wallet)
//     const buyEvents = await filterOSEvents(opensea, buyerFilter);

//     const sellerFilter = opensea.filters.OrdersMatched(null, null, wallet)
//     const sellEvents = await filterOSEvents(opensea, sellerFilter);
//     if (buyEvents.length == 0 && sellEvents.length == 0) {
//       console.log(`!!!!!!!!!!!!!!!!!!!!!!!!!!! No OS transaction ${wallet} !!!!!!!!!!!!!!!!!!!!!!`);
//       badData.push({
//         wallet: wallet,
//         claimed: amountClaimed,
//         txHash: event.transactionHash,
//       });
//     } else {
//       let totalEthBuy = parseEther("0");
//       let totalEthSell = parseEther("0");
//       for (const event of buyEvents) {
//         totalEthBuy = totalEthBuy.add(event.args.price)
//       };
//       for (const event of sellEvents) {
//         totalEthSell = totalEthSell.add(event.args.price)
//       };

//       allData.push({
//         wallet,
//         claimed: amountClaimed,
//         txHash: event.transactionHash,
//         numberBuy: buyEvents.length,
//         totalETHBuy: formatEther(totalEthBuy),
//         numberSell: sellEvents.length,
//         totalETHSell: formatEther(totalEthSell),
//       })
//     };
//   };

//   if (badData.length > 0) {
//     console.log(`Writing ${badData.length} bad data rows`);
//     await csvWriterBad.writeRecords(badData);
//   };
//   if (allData.length > 0) {
//     console.log(`Writing ${allData.length} all data rows`);
//     await csvWriterAll.writeRecords(allData);
//   };
// }

main()
  .then(text => {
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

