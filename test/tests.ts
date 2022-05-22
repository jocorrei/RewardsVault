import { expect } from "chai";
import { ethers } from "hardhat";
import hre = require("hardhat");
import { 
    LockRewards__factory,
    LockRewards,
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
const WhaleAddress = "0xf8e0C93Fd48B4C34A4194d3AF436b13032E641F3";
const WethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

describe("Rewards contract test", function () {
    
    let LockRewards: LockRewards__factory;
    let lockRewards: LockRewards;

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
                        blockNumber: 14621486,
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
            newoTokenAddress, // address lockToken_,
            newoTokenAddress, // address rewardToken0,
            WethAddress, // address rewardToken1
            4, // max epochs
        );
        await lockRewards.deployed();

        // Transfer some Newo to addr1 so he can spend freelly;
        const numberOfTokens = parseNewo(10000);
        await newoToken
            .connect(treasury)
            .transfer(address(addr1), numberOfTokens
        );

        // aprove Newo spending to addr1
        await newoToken
        .connect(addr1)
        .approve(
            address(lockRewards),
            "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        );

        // aprove WETH spending to whale address§
        await WETH
        .connect(whale)
        .approve(
            address(lockRewards),
            "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        );
    };

    // Tests for the constructor
    describe("Testing constructor", async () => {        
        before(initialize);
        it("onwer should be the deployer", async () => {
            expect(await lockRewards.owner()).to.be.equal(address(owner))
        }),
        it("rewards token 0 should be NewO token ", async () => {
            let rewardZeroAddress = await lockRewards.rewardToken(0);
            expect(rewardZeroAddress.addr).to.be.equal(newoTokenAddress)
        }),
        it("rewards token 1 should be WETH", async () => {
            let rewardOneAddress = await lockRewards.rewardToken(1);
            expect(rewardOneAddress.addr).to.be.equal(WethAddress);
        }),
        it("max epoch should be 4 and current epoch should be 1", async () => {
            expect(await lockRewards.currentEpoch()).to.be.equal(1)
            expect(await lockRewards.maxEpochs()).to.be.equal(4)
        })
    })

    // Tests for view functions
    describe("Testing view functions", async () => {        
        before(initialize);
        it("BalanceOf should return total locked by an user", async () => {
            // addr1 lock 10 Newo for one epoch
            await lockRewards
                .connect(addr1)
                .deposit(parseNewo(10), 1)
            
            expect(await lockRewards
                .balanceOf(address(addr1))
            ).to.be.equal(parseNewo(10))
        })
        it("balanceOfinEpoch should return the balance of an specific epoch", async () => {
            expect(await lockRewards
                .balanceOfInEpoch(address(addr1), 1)
            ).to.be.equal(parseNewo(10))
            
            // addr1 balance on the second epoch should be zero
            expect(await lockRewards
                .balanceOfInEpoch(address(addr1), 2)
            ).to.be.equal(parseNewo(0))
        })
        it("totalLocked should return total tokens loked in the contract", async () => {
            expect(await lockRewards
                .totalLocked()
            ).to.be.equal(parseNewo(10))
        })
        it("getCurrentEpoch should return information about the current epoch (first epoch)", async () => {
            // newo locked by addr1 on previous it
            const newoLocked = parseNewo(10)
            // newo to set reward for first epoch
            const newoReward = parseNewo(1000)
            // WETH to set reward for first epoch
            const wethReward = parseWETH(10)
            
            // Transfering governance tokens to the contract before setting next rewards epoch
            await newoToken
                .connect(treasury)
                .transfer(address(lockRewards), newoReward)
            
            // Transfering WETH to the contract before setting next rewards epoch
            await WETH
                .connect(whale)
                .transfer(address(lockRewards), wethReward)
            
            // Set first epoch (set first epoch rewards with 1000 governance tokens, 10 WETH for 7 days)
            await lockRewards
                .connect(owner)
                .setNextEpoch(newoReward, wethReward, 7)

            const currentEpochInfo = await lockRewards.getCurrentEpoch()
            
            // should have 7 days
            expect((currentEpochInfo.finish as BigNumber).sub(currentEpochInfo.start)).to.be.equal(days(7))
            // should return the amount locked on current epoch
            expect(currentEpochInfo.locked).to.be.equal(newoLocked)
            // should return reward1 to be distributed (governance token)
            expect(currentEpochInfo.rewards1).to.be.equal(newoReward)
            // should return reward2 to be distributed (WETH)
            expect(currentEpochInfo.rewards2).to.be.equal(wethReward)
        })
        it("getNextEpoch should return information about next epoch. since its not setted, should return 0 on every parameter", async () => {
            const nextEpochInfo = await lockRewards.getNextEpoch()
            
            expect(nextEpochInfo.start).to.be.equal(0)
            expect(nextEpochInfo.finish).to.be.equal(0)
            expect(nextEpochInfo.locked).to.be.equal(0)
            expect(nextEpochInfo.rewards1).to.be.equal(0)
            expect(nextEpochInfo.rewards2).to.be.equal(0)
        })
        it("getEpoch should return information about an specific epoch", async () => {
            const epochOneInfo = await lockRewards.getEpoch(1)
            const epochTwoInfo = await lockRewards.getEpoch(2)
            const newoLocked = parseNewo(10)
            const newoReward = parseNewo(1000)
            const wethReward = parseWETH(10)
            
            // first epoch info
            expect((epochOneInfo.finish as BigNumber).sub(epochOneInfo.start)).to.be.equal(days(7))
            expect(epochOneInfo.locked).to.be.equal(newoLocked)
            expect(epochOneInfo.rewards1).to.be.equal(newoReward)
            expect(epochOneInfo.rewards2).to.be.equal(wethReward)

            //second epoch info (not setted so every parameter should be zero)
            expect(epochTwoInfo.start).to.be.equal(0)
            expect(epochTwoInfo.finish).to.be.equal(0)
            expect(epochTwoInfo.locked).to.be.equal(0)
            expect(epochTwoInfo.rewards1).to.be.equal(0)
            expect(epochTwoInfo.rewards2).to.be.equal(0)
        })
        it("getAccount should return right information about an account", async () => {
            const newoLocked = parseNewo(10)
            const addr1Info = await lockRewards.getAccount(address(addr1));

            expect(addr1Info.lockEpochs).to.be.equal(1)
            expect(addr1Info.lastEpochPaid).to.be.equal(1)
            expect(addr1Info.balance).to.be.equal(newoLocked)
            expect(addr1Info.rewards1).to.be.equal(0)
            expect(addr1Info.rewards2).to.be.equal(0)
        })
    })

    describe("Testing SetNextEpoch", async () => {        
        before(initialize);
        it("SetNextEpoch should be only callable by owner", async () => {
            await expect(lockRewards
                .connect(addr1)
                .setNextEpoch(1000, 1000, 7)
            ).to.be.reverted
        }),
        it("SetNextEpoch should revert if there is not enought balance on the contract", async () => {
            await expect(lockRewards
                .connect(owner)
                .setNextEpoch(1000, 1000, 7)
            ).to.be.revertedWith("InsufficientFundsForRewards")
        }),
        it("setNextEpoch should set the first epoch correctly when called by the first time", async () => {
            // Transfering governance tokens to the contract before setting next rewards epoch
            await newoToken
                .connect(treasury)
                .transfer(address(lockRewards), parseNewo(1000))
            
            // Transfering WETH to the contract before setting next rewards epoch
            await WETH
                .connect(whale)
                .transfer(address(lockRewards), parseWETH(10))
            
            await lockRewards
                .connect(owner)
                .setNextEpoch(10, 2, 7)
            
            const epochOneInfo = await lockRewards.getEpoch(1);
            
            // epoch should last for 7 days
            expect((epochOneInfo.finish as BigNumber).sub(epochOneInfo.start)).to.be.equal(days(7))

            // should have no tokens locked
            expect(epochOneInfo.locked).to.be.equal(0)
            
            // governance tokens rewards should be 10
            expect(epochOneInfo.rewards1).to.be.equal(10)

            // WETH tokens rewards should be 2
            expect(epochOneInfo.rewards2).to.be.equal(2)
        }),
        it("setNextEpoch should set the next epoch corretly when epoch one is already setted", async () => {
            
            await lockRewards
                .connect(owner)
                .setNextEpoch(100, 1, 10)
            
            //get info about first epoch
            const epochOneInfo = await lockRewards.getEpoch(1)
            
            // get info about second epoch
            const epochTwoInfo = await lockRewards.getEpoch(2);

            // second epoch should start one second after first epoch finish
            expect(epochTwoInfo.start).to.be.equal((epochOneInfo.finish as BigNumber).add(1))
        
            // second epoch should last for 10 days
            expect((epochTwoInfo.finish as BigNumber).sub(epochTwoInfo.start)).to.be.equal(days(10))

            // should have no tokens locked
            expect(epochTwoInfo.locked).to.be.equal(0)
            
            // governance tokens rewards should be 100
            expect(epochTwoInfo.rewards1).to.be.equal(100)

            // WETH tokens rewards should be 1
            expect(epochTwoInfo.rewards2).to.be.equal(1)
        }),
        it("should not be possible to set more epochs than the max (in this case 4)", async () => {            
            // Set third epoch
            await lockRewards
                .connect(owner)
                .setNextEpoch(20, 1, 10)
            
            // Set forth epoch
            await lockRewards
                .connect(owner)
                .setNextEpoch(20, 1, 10)
            
            // Set fifth epoch (this one should revert)
            await expect(lockRewards
                .connect(owner)
                .setNextEpoch(20, 1, 10)
            ).to.be.reverted
        })
    })

    describe("Testing lock and relock", async () => {        
        before(initialize);
        it("locking for more than max epochs should revert", async () => {
            const newoToLock = parseNewo(200)
            
            await expect(lockRewards
                .connect(addr1)
                .deposit(newoToLock, 5)
            ).to.be.revertedWith("LockEpochsMax")
        })
        it("locking should transfer tokens from addr1 to the contract", async () => {
            const newoToLock = parseNewo(200)
            
            await lockRewards
                .connect(addr1)
                .deposit(newoToLock, 1)
            
            expect(await newoToken
                .balanceOf(address(lockRewards))
            ).to.be.equal(newoToLock)
        })
        it("locking should update account balance info", async () => {
            const accountInfo = await lockRewards.getAccount(address(addr1))
            expect(accountInfo.balance).to.be.equal(parseNewo(200))
        })
        it("relocking should update epochs info (user relock for more epochs) ", async () => {
            const newoToLock = parseNewo(200)
            
            await lockRewards
                .connect(addr1)
                .deposit(newoToLock, 2)
            
            const accountInfo = await lockRewards.getAccount(address(addr1))
            
            expect(accountInfo.balance).to.be.equal(parseNewo(400))

            const epochOneInfo = await lockRewards.getEpoch(1)
            const epochTwoInfo = await lockRewards.getEpoch(2)
            const epochThreeInfo = await lockRewards.getEpoch(3)

            expect(await lockRewards.totalAssets()).to.be.equal(parseNewo(400))
            expect(epochOneInfo.locked).to.be.equal(parseNewo(400))
            expect(epochTwoInfo.locked).to.be.equal(parseNewo(400))
            expect(epochThreeInfo.locked).to.be.equal(parseNewo(0))
        })
    })
    
    describe("Testing rewards distribution", async () => {
        before(initialize);
    })
    
    describe("Testing withdraw", async () => {        
        before(initialize);
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
            `\tbalance of WETH of ${address(signer)}: ${formatWETH(
                balWETH
            )}\n`
        );
        return { balNewo, balWETH };
    }
});