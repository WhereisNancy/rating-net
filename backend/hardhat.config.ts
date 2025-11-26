import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import { HDNodeWallet, Mnemonic } from "ethers";
import type { HardhatUserConfig } from "hardhat/config";

// Helper function to get accounts from mnemonic or private key
function getAccounts() {
  if (process.env.MNEMONIC) {
    // Derive the first account (index 0) from the mnemonic
    const mnemonic = Mnemonic.fromPhrase(process.env.MNEMONIC);
    const wallet = HDNodeWallet.fromMnemonic(mnemonic);
    return [wallet.privateKey];
  }
  if (process.env.PRIVATE_KEY) {
    return [process.env.PRIVATE_KEY];
  }
  return undefined;
}

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: 0
  },
  gasReporter: {
    enabled: false,
    currency: "USD"
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    anvil: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://sepolia.infura.io/v3/ZZZ",
      chainId: 11155111,
      accounts: getAccounts()
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
        runs: 800
      },
      evmVersion: "cancun"
    }
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6"
  }
};

export default config;


