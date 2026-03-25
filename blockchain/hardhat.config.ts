import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const mainnetRpcUrl =
  process.env.ETHEREUM_RPC_URL ||
  process.env.MAINNET_RPC_URL ||
  process.env.RPC_URL ||
  "";

const sepoliaRpcUrl =
  process.env.SEPOLIA_RPC_URL ||
  process.env.RPC_URL ||
  "";

const polygonRpcUrl =
  process.env.POLYGON_RPC_URL ||
  process.env.RPC_URL ||
  "";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    mainnet: {
      url: mainnetRpcUrl,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    },
    polygon: {
      url: polygonRpcUrl,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    },
    sepolia: {
      url: sepoliaRpcUrl,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  }
};

export default config;
