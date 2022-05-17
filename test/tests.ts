import { expect } from "chai";
import { ethers } from "hardhat";
import hre = require("hardhat");
import { 
    LockRewards__factory,
    lockRewards,
} from '../typechain'

import { Signer, Contract, BigNumberish, BigNumber } from "ethers";

import newOrderABI from "../abi/NewOrderERC20.json";
import WETHABI from "../abi/WETH.json"

import {
    balance,
    parseToken,
    days,
    address,
    years,
    timeTravel,
    formatToken,
} from "./utils";

/** 
 * Since we are forking mainNet,
 * we need the addresses that we are going to interact with 
 */

const newoTokenAddress = "0x98585dFc8d9e7D48F0b1aE47ce33332CF4237D96";
const TreasuryAddress = "0xdb36b23964FAB32dCa717c99D6AEFC9FB5748f3a";
const WhaleAddress = "0x316c15213B097854a0c31565a0eC8705f6f9e72B";
const WethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

describe("Rewards contract test", function () {
    
    let LockRewards: LockRewards__factory;
    let lockRewards: lockRewards;

    let newoToken: Contract;
    let WETH: Contract;

    let owner: Signer;
    let addr1: Signer;
    let addr2: Signer;
    let treasury: Signer;
    let whale: Signer;

    let balanceNewo: (entity: any) => Promise<BigNumberish>;
    let balanceWETH: (entity: any) => Promise<BigNumberish>;

    let parseNewo: (input: number) => BigNumberish;
    let parseWETH: (input: number) => BigNumberish;

    let formatNewo: (input: BigNumberish) => string;
    let formatWETH: (input: BigNumberish) => string;
    

    const initialize = async () => {
        // reset the block number
        await hre.network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.ETH_MAINFORK || "",
                        blockNumber: 14670842,
                    },
                },
            ],
        });

        // Get contract's factory
        LockRewards = await ethers.getContractFactory("LockRewards");

        // Get contracts factory for already deployed contracts
        newoToken = await ethers.getContractAt(newOrderABI, newoTokenAddress);
        balanceNewo = balance(newoToken);
        parseNewo = await parseToken(newoToken);
        formatNewo = await formatToken(newoToken);

        // Get contracts factory for already deployed contracts
        WETH = await ethers.getContractAt(WETHABI, WethAddress);
        balanceWETH = balance(WETH);
        parseWETH = await parseToken(WETH);
        formatWETH = await formatToken(WETH);

        // Create signers
        const signers = await ethers.getSigners();
        owner = signers[0];
        addr1 = signers[1];
        addr2 = signers[2];

        // Impersonate Treasury
        await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [TreasuryAddress],
        });

        // Grant more gas to Treasury
        await hre.network.provider.send("hardhat_setBalance", [
            TreasuryAddress,
            "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        ]);

        // Get treasury signature
        treasury = await ethers.getSigner(TreasuryAddress);

        /* Impersonate Whale Account 
        (this address will be used to set WETH reward to the contract)
        */
        await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [WhaleAddress],
        });

        // Grant more gas to whale
        await hre.network.provider.send("hardhat_setBalance", [
            WhaleAddress,
            "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        ]);

        // Get whale signature
        whale = await ethers.getSigner(WhaleAddress)

        // veNewo deployement
        lockRewards = await LockRewards.deploy(
            address(owner), // address owner_,
            newoTokenAddress, // address stakingToken_,
            days(7), // uint256 gracePeriod_,
            days(90), // uint256 minLockTime_,
            years(3), // uint256 maxLockTime_,
            2, // uint256 penaltyPerc_,
            15, // uint256 maxPenalty_,
            5, // uint256 minPenalty_,
            86400 // uint256 epoch_
        );
        await lockRewards.deployed();

        // Transfer some Newo to addr1 so he can spend freelly;
        const numberOfTokens = parseNewo(10000);
        await newoToken
            .connect(treasury)
            .transfer(address(addr1), numberOfTokens
        );
    };

    // Tests for view functions
    describe("Testing fork", async () => {        
        before(initialize);
        it("checking balances", async () => {
            const { balNewo: NewoBalTest } = await checkBalances(addr1);
            console.log(NewoBalTest);
        })
    })

    /**
     * This function will check the balance of Newo and WETH
    */
    async function checkBalances(signer: Signer) {
        const balNewo = await balanceNewo(signer);
        const balWETH = await balanceWETH(signer);
        console.log("\tBalance report:");
        
        console.log(
            `\tbalance of newo of ${address(signer)}: ${formatNewo(
                balNewo
            )}`
        );
        console.log(
            `\tbalance of USDC of ${address(signer)}: ${formatWETH(
                balWETH
            )}\n`
        );
        return { balNewo, balWETH };
    }
});