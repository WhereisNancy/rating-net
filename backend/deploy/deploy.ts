import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  // Deploy RatingNet contract with FHEVM support
  log("Deploying RatingNet...");
  const result = await deploy("RatingNet", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: 1
  });
  log(`RatingNet deployed at ${result.address}`);
};

export default func;
func.tags = ["RatingNet"];


