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

        // lockRewards deployement
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

        // aprove newo spendind to addr2 
        await newoToken
        .connect(addr2)
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
                ["setNextEpoch(uint256,uint256,uint256)"](newoReward, wethReward, 7)

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
                ["setNextEpoch(uint256,uint256,uint256)"](1000, 1000, 7)
            ).to.be.revertedWith("Ownable: caller is not the owner")
        }),
        it("SetNextEpoch should revert if there is not enought balance on the contract", async () => {
            await expect(lockRewards
                .connect(owner)
                ["setNextEpoch(uint256,uint256,uint256)"](1000, 1000, 7)
            ).to.be.revertedWith("InsufficientFundsForRewards")
        }),
        it("setNextEpoch should set the first epoch correctly when called by the first time", async () => {
            const newoToReward = parseNewo(10);
            const WethToReward = parseWETH(2)
            const durationInDays = 7

            // Set first epoch rewards with 10 governace tokens, 2 WETH and for 7 days
            await setRewards(newoToReward, WethToReward, durationInDays)            
            
            // Get first epoch info
            const epochOneInfo = await lockRewards.getEpoch(1);
        
            // epoch should last for 7 days
            expect((epochOneInfo.finish as BigNumber).sub(epochOneInfo.start as BigNumber)).to.be.equal(days(7))

            // should have no tokens locked
            expect(epochOneInfo.locked).to.be.equal(0)
            
            // governance tokens rewards should be 10
            expect(epochOneInfo.rewards1).to.be.equal(newoToReward)

            // WETH tokens rewards should be 2
            expect(epochOneInfo.rewards2).to.be.equal(WethToReward)
        }),
        it("setNextEpoch should set the next epoch corretly when epoch one is already setted", async () => {
            const newoToReward = parseNewo(100);
            const WethToReward = parseWETH(1)
            const durationInDays = 10
            
            // Set second epoch
            await setRewards(newoToReward, WethToReward, durationInDays)
            
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
            expect(epochTwoInfo.rewards1).to.be.equal(newoToReward)

            // WETH tokens rewards should be 1
            expect(epochTwoInfo.rewards2).to.be.equal(WethToReward)
        }),
        it("should not be possible to set more epochs than two epochs at a time", async () => {            
            // Set third epoch should revert
            await expect(
                setRewards(20, 1, 10)
            ).to.be.revertedWith("EpochMaxReached")
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
        it("relocking should update epochs info (user relock for more epochs) and total assets managed by the vault ", async () => {
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
            expect(accountInfo.lockEpochs).to.be.equal(3)
            expect(accountInfo.lastEpochPaid).to.be.equal(1)
        })
    })

    describe("Integrated relocking tests 1", () => {
        before(initialize);
        it("User lock before set first epoch. After epochs are set, it should be able to claim rewards after second epoch start", async () => {
            const newoToRewards = parseNewo(50);
            const WethToReward = parseWETH(1);
            const durationInDays = 8;
            const newoToLock = parseNewo(10);

            // user lock for the next epoch
            await lockRewards
                .connect(addr1)
                .deposit(newoToLock, 1);
            
            // set rewards for 8 days;
            await setRewards(newoToRewards, WethToReward, durationInDays);

            // travel one day before first epoch start
            await timeTravel(days(1));
            
            // withdraw during the first epoch should revert
            await expect(lockRewards
                .connect(addr1)
                .withdraw(newoToLock)
            ).to.be.revertedWith("FundsInLockPeriod")

            // time travel to after the end of the first epoch
            await timeTravel(days(9));

            const {balNewo : balNewoBefore, balWETH: balWethBefore } = await checkBalances(addr1);

            // user should be able to claim rewards now
            await lockRewards.connect(addr1).claimReward()

            const {balNewo : balNewoAfter, balWETH: balWethAfter } = await checkBalances(addr1);

            // user should earn right rewards
            expect((balNewoAfter as BigNumber).sub(balNewoBefore)).to.be.equal(newoToRewards)
            expect((balWethAfter as BigNumber).sub(balWethBefore)).to.be.equal(WethToReward)

            const {balNewo : balNewoBeforeWithdraw } = await checkBalances(addr1);
            
            await lockRewards.connect(addr1).withdraw(newoToLock)

            const {balNewo : balNewoAfterWithdraw } = await checkBalances(addr1);

            // user should be able to withdraw the right amount
            expect((balNewoAfterWithdraw as BigNumber).sub(balNewoBeforeWithdraw)).to.be.equal(newoToLock)

        })
        it("owner set new epoch. User lock for one epoch(second) and them lock for one more epoch(third). User should only be able to withdraw after third epoch ends", async () => {
            const newoToRewards = parseNewo(50);
            const WethToReward = parseWETH(1);
            const durationInDays = 8;
            const newoToLock = parseNewo(10);
            const newoToRewards2 = parseNewo(20);
            
            // user lock for second epoch
            await lockRewards.connect(addr1).deposit(newoToLock, 1);
            // user relock for third epoch
            await lockRewards.connect(addr1).deposit(newoToLock, 1);
            
            // set second epoch
            await setRewards(newoToRewards, WethToReward, durationInDays)
            // set third epoch
            await setRewards(newoToRewards2, WethToReward, durationInDays)
            
            // user try to withdraw in the middle of second epoch should revert
            await expect(lockRewards
                .connect(addr1)
                .withdraw(newoToLock)
            ).to.be.revertedWith("FundsInLockPeriod")
            
            // time travel to third epoch
            await timeTravel(days(9))

            // user try to withdraw im the middle of third epoch should revert
            await expect(lockRewards
                .connect(addr1)
                .withdraw(newoToLock)
            ).to.be.revertedWith("FundsInLockPeriod")

            // time travel to the end of the third epoch
            await timeTravel(days(9))

            // const testing = await lockRewards.connect(addr1).getAccount(address(addr1))

            // const testing1 = await lockRewards.connect(addr1).getCurrentEpoch()

            // console.log("\n\n im here testing", testing, testing1);

            const {balNewo : balNewoBefore } = await checkBalances(addr1);
            
            // user should be able to withdraw everything now
            await lockRewards
                .connect(addr1)
                .withdraw((newoToLock as BigNumber).mul(2))
            
            const {balNewo : balNewoAfterWithdraw } = await checkBalances(addr1);

            expect((balNewoBefore as BigNumber).sub(balNewoAfterWithdraw)).to.be.equal((newoToLock as BigNumber).mul(2));
        })
    })

    describe("Integrated relocking tests 2", () => {
        before(initialize);
        it("user should be able to relock more tokens for the same amount of epochs (deposit for zero epochs)", async () => {
            const newoToRewards = parseNewo(50);
            const WethToReward = parseWETH(1);
            const durationInDays = 8;
            const newoToLock = parseNewo(10);

            // user lock for one epoch
            await lockRewards
                .connect(addr1)
                .deposit(newoToLock, 1);
            // user relock more tokens for same one epoch
            await lockRewards
                .connect(addr1)
                .deposit(newoToLock, 0);
            
            // set first epoch
            await setRewards(newoToRewards, WethToReward, durationInDays);

            // get account info
            const accountInfo = await lockRewards.connect(addr1).getAccount(address(addr1))

            expect(accountInfo.balance).to.be.equal((newoToLock as BigNumber).mul(2))

            // time travel to the end of first epoch
            await timeTravel(days(9));

            const {balNewo : balNewoBefore } = await checkBalances(addr1);

            // user withdraw everything
            await lockRewards.connect(addr1).withdraw((newoToLock as BigNumber).mul(2))

            const {balNewo : balNewoAfterWithdraw } = await checkBalances(addr1);

            // user should have earned the right amount of tokens back
            expect((balNewoAfterWithdraw as BigNumber).sub(balNewoBefore)).to.be.equal((newoToLock as BigNumber).mul(2))
        })

    })
    
    describe("Testing rewards distribution", async () => {
        before(initialize);
        it("user should not earn any reward until the end of the epoch", async () => {
            const newoToRewards = parseNewo(50);
            const WethToReward = parseWETH(1);
            const durationInDays = 8;
            const newoToLock = parseNewo(10);

            // user lock for one epoch
            await lockRewards.connect(addr1).deposit(newoToLock, 1);
            
            const {balNewo: balNewoBefore, balWETH: balWETHBefore} = await checkBalances(addr1)

            // set rewards for epoch one
            await setRewards(newoToRewards, WethToReward, durationInDays);

            await timeTravel(days(2))
            
            await lockRewards.connect(addr1).claimReward()

            const {balNewo: balNewoAfter, balWETH: balWETHAfter} = await checkBalances(addr1)
            
            // check if user earned zero rewards
            expect(balNewoBefore).to.be.equal(balNewoAfter)
            expect(balWETHBefore).to.be.equal(balWETHAfter)
        })
        it("user should earn right amount of rewards if epoch is over(addr1 is the only user locked so it should earn all the rewards)", async () => {
            const newoToRewards = parseNewo(50);
            const WethToReward = parseWETH(1);
            
            // time trival after the end of first epoch
            await timeTravel(days(8))
            
            const { balNewo: balNewoBefore, balWETH: balWETHBefore } = await checkBalances(addr1)

            await lockRewards.connect(addr1).claimReward()

            const { balNewo: balNewoAfter, balWETH: balWETHAfter } = await checkBalances(addr1)

            expect((balNewoAfter as BigNumber).sub(balNewoBefore)).to.be.equal(newoToRewards)
            expect((balWETHAfter as BigNumber).sub(balWETHBefore)).to.be.equal(WethToReward)
        })
        it("if user lock in the middle of epoch 2 he will only be able to collect rewards of epoch 3 (after is over)", async () => {
            const newoToLock = parseNewo(100);
            const newoToRewards = parseNewo(100);
            const WethToReward = parseWETH(2);
            const durationInDays = 7;

            // Set second epoch. It will start automatically.
            await setRewards(newoToRewards, WethToReward, durationInDays)

            // Set third epoch. It will start in the end of second epoch
            await setRewards(newoToRewards, WethToReward, durationInDays)

            await timeTravel(days(2))
            
            //addr1 lock for one epoch in the middle of second epoch
            await lockRewards.connect(addr1).deposit(newoToLock, 1)
             
            // time travel to the middle of third epoch
            await timeTravel(days(10))
            
            const { balNewo: balNewoBefore, balWETH: balWETHBefore } = await checkBalances(addr1)

            // user try to claim rewards in the middle of third epoch (it should earn zero rewards)
            await lockRewards.connect(addr1).claimReward()

            const { balNewo: balNewoAfter, balWETH: balWETHAfter } = await checkBalances(addr1)

            expect(balNewoBefore).to.be.equal(balNewoAfter)
            expect(balWETHBefore).to.be.equal(balWETHAfter)

            // time travel to the end of third epoch (user should be able to claim rewards now)
            await timeTravel(days(100))

            const { balNewo: balNewoBeforeClaim, balWETH: balWETHBeforeClaim } = await checkBalances(addr1)
            
            await lockRewards.connect(addr1).claimReward()

            const { balNewo: balNewoAfterClaim, balWETH: balWETHAfterClaim } = await checkBalances(addr1)

            // address should have earned all the rewards
            expect((balNewoAfterClaim as BigNumber).sub(balNewoBeforeClaim)).to.be.equal(newoToRewards)
            expect((balWETHAfterClaim as BigNumber).sub(balWETHBeforeClaim)).to.be.equal(WethToReward)
        })
    })

    describe("Testing rewards distribution (second run)", async () => {
        before(initialize);
        it("user lock for 3 epochs. in the end of the third epoch he should be able to claim the rewards from all past epochs", async () => {
            const newoToLock = parseNewo(100);
            const newoToRewards = parseNewo(100);
            const WethToReward = parseWETH(2);
            const durationInDays = 10;

            // deposit for 3 epochs
            await lockRewards.connect(addr1).deposit(newoToLock, 3)

            // set first epoch
            await setRewards(newoToRewards, WethToReward, durationInDays)
            // set second epoch
            await setRewards(newoToRewards, WethToReward, durationInDays)

            await timeTravel(days(11))
    
            // set third epoch
            await setRewards(newoToRewards, WethToReward, durationInDays)
        
            // time travel to after the end of the third epoch
            await timeTravel(days(31))

            const { balNewo: balNewoBefore, balWETH: balWETHBefore } = await checkBalances(addr1)

            // clain the rewards
            await lockRewards.connect(addr1).claimReward()

            const { balNewo: balNewoAfter, balWETH: balWETHAfter } = await checkBalances(addr1)

            expect((balNewoAfter as BigNumber).sub(balNewoBefore)).to.be.equal((newoToRewards as BigNumber).mul(3))
            expect((balWETHAfter as BigNumber).sub(balWETHBefore)).to.be.equal((WethToReward as BigNumber).mul(3))
        })
    })

    describe("Testing rewards distribution (third run)", () => {
        before(initialize);
        it("users should earn rewards based on the amount of tokens they locked", async () => {
            const newoToLock = parseNewo(500);
            const newoToRewards = parseNewo(100);
            const WethToReward = parseWETH(2);
            const durationInDays = 10;

            // Send 1000 newo to addr2 so it can lock
            await newoToken
                .connect(treasury)
                .transfer(address(addr2), newoToLock);
            
            // addr2 lock for one epoch   
            await lockRewards
                .connect(addr2)
                .deposit(newoToLock, 1)
            
            // addr1 lock double of the amount of tokens than addr2 for the same epoch
            await lockRewards
                .connect(addr1)
                .deposit((newoToLock as BigNumber).mul(2), 1)

            // set first epoch
            await setRewards(newoToRewards, WethToReward, durationInDays)

            // time travel to the end of first epoch
            await timeTravel(days(11));

            // Check balances for both addresses before claim
            const {balNewo : balNewoAddr1Before, balWETH: balWETHAddr1Before } = await checkBalances(addr1);
            const {balNewo : balNewoAddr2Before, balWETH: balWETHAddr2Before } = await checkBalances(addr2);

            // addr1 claim rewards
            await lockRewards.connect(addr1).claimReward();

            //addr2 claim rewards
            await lockRewards.connect(addr2).claimReward();

            // Check balances for both addresses after claim
            const {balNewo : balNewoAddr1After, balWETH: balWETHAddr1After } = await checkBalances(addr1);
            const {balNewo : balNewoAddr2After, balWETH: balWETHAddr2After } = await checkBalances(addr2);

            const newoEarnedAddr1 = (balNewoAddr1After as BigNumber).sub(balNewoAddr1Before)
            const newoEarnedAddr2 = (balNewoAddr2After as BigNumber).sub(balNewoAddr2Before)
            const wEthEarnedAddr1 = (balWETHAddr1After as BigNumber).sub(balWETHAddr1Before)
            const wEthEarnedAddr2 = (balWETHAddr2After as BigNumber).sub(balWETHAddr2Before)

            // addr1 should have earned double of rewards than addr1
            expect((newoEarnedAddr1 as BigNumber).div(newoEarnedAddr2)).to.be.equal(2);
            expect((wEthEarnedAddr1 as BigNumber).div(wEthEarnedAddr2)).to.be.equal(2);
        })
    })

    describe("Testing withdraw", () => {        
        before(initialize);
        it("user shouldnt be able to withdraw more than its balance", async () => {
            const newoToLock = parseNewo(500);
            const newoToRewards = parseNewo(100);
            const WethToReward = parseWETH(2);
            const durationInDays = 10;
            
            // addr1 lock for one epoch   
            await lockRewards
                .connect(addr1)
                .deposit(newoToLock, 1)

            // set first epoch
            await setRewards(newoToRewards, WethToReward, durationInDays)

            // user try to claim more than its balance
            await expect(lockRewards
                .connect(addr1)
                .withdraw((newoToLock as BigNumber).add(1))
            ).to.be.revertedWith("InsufficientAmount")
        })
        it("user shouldnt be able to withdraw during locking period(in this case one epoch)", async () => {
            const newoToLock = parseNewo(500);
            // time travel to some point during first epoch
            await timeTravel(days(2));
            
            await expect(lockRewards
                .connect(addr1)
                .withdraw(newoToLock)
            ).to.be.revertedWith("FundsInLockPeriod")
        })
        it("user should be able to withdraw after locking period", async () => {
            const newoToLock = parseNewo(500);
            // time travel to some point after first epoch
            await timeTravel(days(11));

            const { balNewo: balNewoBefore } = await checkBalances(addr1);

            await lockRewards.connect(addr1).withdraw(newoToLock);

            const { balNewo: balNewoAfter } = await checkBalances(addr1);

            expect((balNewoAfter as BigNumber).sub(balNewoBefore)).to.be.equal(newoToLock);
        })
        it("withdraw should update totalAssets managed by the vault and userInfo", async () => {
            expect(await lockRewards.totalLocked()).to.be.equal(0)
            
            const userInfo = await lockRewards.getAccount(address(addr1))
            
            expect(userInfo.balance).to.be.equal(0);
            expect(userInfo.lockEpochs).to.be.equal(0);
            expect(userInfo.rewards1).to.be.equal(parseNewo(100));
            expect(userInfo.rewards2).to.be.equal(parseWETH(2));
        })
    })

    describe("Testing exit", () => {
        before(initialize);
        it("exit function should withdraw and claim everything to user", async () => {
            const newoToLock = parseNewo(500);
            const newoToRewards = parseNewo(100);
            const WethToReward = parseWETH(2);
            const durationInDays = 10;
            
            // addr1 lock for one epoch   
            await lockRewards
                .connect(addr1)
                .deposit(newoToLock, 1)

            // set first epoch
            await setRewards(newoToRewards, WethToReward, durationInDays)

            // time trave to the end of first epoch
            await timeTravel(days(12));

            const { balNewo: balNewoBefore, balWETH: balWETHBefore} = await checkBalances(addr1);
            
            await lockRewards.connect(addr1).exit()

            const { balNewo: balNewoAfter, balWETH: balWETHAfter} = await checkBalances(addr1);
            
            expect(await lockRewards.totalLocked()).to.be.equal(0)

            // address should have earned his newo locked plus newo rewards
            expect((balNewoAfter as BigNumber).sub(balNewoBefore)).to.be.equal((newoToLock as BigNumber).add(newoToRewards))

            //address should have earned all WETH rewards
            expect((balWETHAfter as BigNumber).sub(balWETHBefore)).to.be.equal(WethToReward)
        })
    })

    describe("Integrated Tests", () => {
        before(initialize) 
        it("If user lock for the first epoch before owner set Rewards, when owner setReward user should not be able to withdraw before the end of the first epoch", async () => {
            const newoToLock = parseNewo(500);
            const newoToRewards = parseNewo(100);
            const WethToReward = parseWETH(2);
            const durationInDays = 10;
            
            // addr1 lock for one epoch   
            await lockRewards
                .connect(addr1)
                .deposit(newoToLock, 1)
            
            // set first epoch
            await setRewards(newoToRewards, WethToReward, durationInDays)

            // go to somewhere in the middle of the first epoch
            await timeTravel(days(1))

            // withdraw should revert
            await expect(lockRewards
                .connect(addr1)
                .withdraw(newoToLock)
            ).to.be.revertedWith("FundsInLockPeriod")
        })
        it("Relocking for in the middle of the first epoch and trying to withdraw again should revert", async () => {
            const newoToLock = parseNewo(500);
            // addr 1 relock somewhere in the middle of first epoch
            await lockRewards
                .connect(addr1)
                .deposit(newoToLock, 1)

            // withdraw should revert
            await expect(lockRewards
                .connect(addr1)
                .withdraw(newoToLock)
            ).to.be.revertedWith("FundsInLockPeriod")
        })
        it("withdrawn in the middle of the second epoch should also revert since user relocked in the middle of the first", async () => {
            const newoToLock = parseNewo(1000);
            const newoToRewards = parseNewo(100);
            const WethToReward = parseWETH(2);
            const durationInDays = 10;
            
            // Set second epoch
            await setRewards(newoToRewards, WethToReward, durationInDays)

            // time travel to one day after second epoch start
            await timeTravel(days(10))

            // withdraw should revert
            await expect(lockRewards
                .connect(addr1)
                .withdraw(newoToLock)
            ).to.be.revertedWith("FundsInLockPeriod")
        })
        it("user should be able to withdraw everything when second epoch end", async () => {
            const newoToWithdraw = parseNewo(1000);
            
            // time travel to third epoch
            await timeTravel(days(11))
            
            const { balNewo: balNewoBefore } = await checkBalances(addr1);

            // address withdraw all its balance
            await lockRewards
                .connect(addr1)
                .withdraw(newoToWithdraw)

            const { balNewo: balNewoAfter } = await checkBalances(addr1);

            expect((balNewoAfter as BigNumber).sub(balNewoBefore)).to.be.equal(newoToWithdraw)

        })
    })
    
    describe("Testing pause functionality", () => {
        before(initialize);
        it("Pause should only be callable by owner", async () => {
            await expect(lockRewards
                .connect(addr1)
                .pause()
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })
        it("Unpause should revert if contract is not paused", async () => {
            await expect(lockRewards
                .connect(owner)
                .unpause()
            ).to.be.revertedWith("Pausable: not paused")
        })
        it("pause() should set contract to pause mode. deposit, withdraw and claim should revert", async () => {
            await lockRewards
                .connect(owner)
                .pause()
            
            const paused = await lockRewards.connect(addr1).paused()

            expect(paused).to.be.equal(true)
            
            await expect(lockRewards
                .connect(addr1)
                .deposit(parseNewo(10), 1)
            ).to.be.revertedWith("Pausable: paused")

            await expect(lockRewards
                .connect(addr1)
                .withdraw(parseNewo(10))
            ).to.be.revertedWith("Pausable: paused")

            await expect(lockRewards
                .connect(addr1)
                .claimReward()
            ).to.be.revertedWith("Pausable: paused")
        })
        it("Pause should revert if contract is paused", async () => {
            await expect(lockRewards
                .connect(owner)
                .pause()
            ).to.be.revertedWith("Pausable: paused")
        })
        it("Unpause should only be callable by owner", async () => {
            await expect(lockRewards
                .connect(addr1)
                .unpause()
            ).to.be.revertedWith("Ownable: caller is not the owner")
        })
        it("Unpause should set pause to false", async () => {
            await lockRewards
                .connect(owner)
                .unpause()

            const paused = await lockRewards.connect(addr1).paused()
            
            expect(paused).to.be.equal(false)
        })
    })

    /**
    * This function will set the next rewards epoch
    */
    async function setRewards(amountNewo: BigNumberish, amountWETH: BigNumberish, durationInDays: number){
        
        // Transfering governance tokens to the contract before setting next rewards epoch
        await newoToken
            .connect(treasury)
            .transfer(address(lockRewards), amountNewo)
    
        // Transfering WETH to the contract before setting next rewards epoch
        await WETH
            .connect(whale)
            .transfer(address(lockRewards), amountWETH)
        
        // Set next rewards epoch
        await lockRewards
            .connect(owner)
            ["setNextEpoch(uint256,uint256,uint256)"](amountNewo, amountWETH, durationInDays)
    }

    /**
     * This function will check the balance of Newo and WETH
    */
    async function checkBalances(signer: Signer) {
        const balNewo = await balanceNewo(signer);
        const balWETH = await balanceWETH(signer);
        // console.log("\tBalance report:");
        
        // console.log(
        //     `\tbalance of newo of ${address(signer)}: ${formatNewo(
        //         balNewo
        //     )}`
        // );
        // console.log(
        //     `\tbalance of WETH of ${address(signer)}: ${formatWETH(
        //         balWETH
        //     )}\n`
        // );
        return { balNewo, balWETH };
    }
});