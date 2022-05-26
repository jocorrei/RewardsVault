import hre = require("hardhat");
import { ethers } from "hardhat";

const newoTokenAddress = "0x98585dFc8d9e7D48F0b1aE47ce33332CF4237D96";
const WethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

async function main() {

  // Get signer address
  const [deployer] = await ethers.getSigners();
  console.log("Current deployer addresses:", deployer.address);

  // Get contract's factory
  const LockRewards = await ethers.getContractFactory("LockRewards");
  
  const lockRewards = await LockRewards.deploy(
	  newoTokenAddress, // address lockToken_,
	  newoTokenAddress, // address rewardToken0,
	  WethAddress, // address rewardToken1
	  4, // max epochs
	);
    await lockRewards.deployed();
  
  console.log("lockRewards deployed to:", lockRewards.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});