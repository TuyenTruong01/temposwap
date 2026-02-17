// public/config.js
window.APP_CONFIG = {
  appName: "NeuraSwap",

  // ===== Neura Testnet =====
  chain: {
    chainIdHex: "0x10b", // 267
    chainName: "Neura Testnet",
    rpcUrls: ["https://testnet.rpc.neuraprotocol.io/"],
    nativeCurrency: { name: "ANKR", symbol: "ANKR", decimals: 18 },
    blockExplorerUrls: ["https://testnet-blockscout.infra.neuraprotocol.io/"]
  },

  // ===== Contracts (NEW deploy) =====
  contracts: {
    HOUSE: "0x737644a73931E86bE1d1e20A0a6eE19ec0d5fEc7",
    BICY: "0xF014a7BEefA61DbDBa43C207Ca1c0D580e1897e2",
    FAUCET: "0xff63bB2Fe2a24C54bf11700a9125ee63633C3e0b",
    AMM: "0x3cEc783B292F246f02B4F4A2f37230686FE2CCD6"
  },

  // ===== ABI paths (served from Vite public/) =====
  abi: {
    erc20: "/abi/erc20.json",
    faucet: "/abi/faucet.json",
    amm: "/abi/fxpool.json"
  },

  // ===== Function mapping =====
  fn: {
    // Faucet (DualFaucet.sol)
    faucetClaimBoth: "claimBoth",

    // AMM (SimpleAMM.sol)
    ammGetAmountOut: "getAmountOut",
    ammSwap: "swap"
  },

  ui: {
    defaultFrom: "HOUSE",
    defaultTo: "BICY",
    slippageDefaultPct: 0.5
  }
};
