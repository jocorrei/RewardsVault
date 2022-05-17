pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LockRewards is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error InsufficientAmount();
    error FundsInLockPeriod();

    struct Account {
        uint256 balance;
        // uint256 lockDate;
        // uint256 lockPeriod;
        uint256 lockEpochs;
        uint256 lastEpochPaid;
        uint256 rewards1;
        uint256 rewards2;
    }

    struct Epoch {
        mapping(address => uint256) balanceLocked;
        uint256 start;
        uint256 finish;
        uint256 totalLocked;
        uint256 rewards1;
        uint256 rewards2;
        bool    isSet;
        // bool    isCurrent;
    }
    
    /* ========== STATE VARIABLES ========== */

    mapping(address => Account) public accounts;
    mapping(uint256 => Epoch) public epochs;
    uint256 public currentEpoch = 0;
    uint256 public nextUnsetEpoch = 1;

    address public lockToken;
    address public rewardToken1;
    address public rewardToken2;
    uint256 public epochDuration = 7 days;
    uint256 public totalAssets;
    uint256 public totalRewards1;
    uint256 public totalRewardsPaid1;
    uint256 public totalRewards2;
    uint256 public totalRewardsPaid2;
    
    /* ========== CONSTRUCTOR ========== */

    // constructor(
    //     address _owner,
    //     address _rewardsDistribution,
    //     address _rewardsToken,
    //     address _stakingToken
    // ) public Owned(_owner) {
    //     rewardsToken = IERC20(_rewardsToken);
    //     stakingToken = IERC20(_stakingToken);
    //     rewardsDistribution = _rewardsDistribution;
    // }

    /* ========== VIEWS ========== */

    // function totalSupply() external view returns (uint256) {
    //     return _totalSupply;
    // }

    // function balanceOf(address account) external view returns (uint256) {
    //     return _balances[account];
    // }

    // function lastTimeRewardApplicable() public view returns (uint256) {
    //     return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    // }

    // function rewardPerToken() public view returns (uint256) {
    //     if (_totalSupply == 0) {
    //         return rewardPerTokenStored;
    //     }
    //     return
    //         rewardPerTokenStored.add(
    //             lastTimeRewardApplicable().sub(lastUpdateTime).mul(rewardRate).mul(1e18).div(_totalSupply)
    //         );
    // }

    // function earned(address account) public view returns (uint256) {
    //     return _balances[account].mul(rewardPerToken().sub(userRewardPerTokenPaid[account])).div(1e18).add(rewards[account]);
    // }

    // function getRewardForDuration() external view returns (uint256) {
    //     return rewardRate.mul(rewardsDuration);
    // }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function deposit(uint256 amount, uint256 lockTime) public nonReentrant updateEpoch updateReward(msg.sender) {
        if (amount <= 0) revert InsufficientAmount();
        IERC20 lToken = IERC20(lockToken);
        uint256 next = currentEpoch + 1;
        
        uint256 lockEpochs =  lockTime / epochDuration;
        if (accounts[msg.sender].lockEpochs < lockEpochs)
            accounts[msg.sender].lockEpochs = lockEpochs;
        
        lToken.safeTransferFrom(msg.sender, address(this), amount);
        totalAssets += amount;

        for (uint256 i = 0; i < lockEpochs; i++) {
            epochs[i + next].totalLocked += amount;
            epochs[i + next].balanceLocked[msg.sender] += amount;
        }
        accounts[msg.sender].balance += amount;
        emit Deposit(msg.sender, amount, accounts[msg.sender].lockEpochs);
    }

    function withdraw(uint256 amount) public nonReentrant updateEpoch updateReward(msg.sender) {
        if (amount <= 0 || accounts[msg.sender].balance < amount) revert InsufficientAmount();
        if (accounts[msg.sender].lockEpochs > 0) revert FundsInLockPeriod(accounts[msg.sender].balance);

        IERC20(lockToken).safeTransfer(msg.sender, amount);
        accounts[msg.sender].balance -= amount;
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() public nonReentrant updateEpoch updateReward(msg.sender) {
        uint256 reward1 = accounts[msg.sender].reward1;
        uint256 reward2 = accounts[msg.sender].reward2;

        if (reward1 > 0) {
            IERC20 rToken1 = IERC20(reward1);
            account[msg.sender].reward1 = 0;
            rToken1.safeTransfer(msg.sender, reward1);
            emit RewardPaid(msg.sender, rewardToken1, reward1);
        }
        if (reward2 > 0) {
            IERC20 rToken2 = IERC20(reward2);
            account[msg.sender].reward2 = 0;
            rToken2.safeTransfer(msg.sender, reward2);
            emit RewardPaid(msg.sender, rewardToken2, reward2);
        }
    }

    function exit() external {
        withdraw(accounts[msg.sender].balance);
        claimReward();
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    function setNextEpoch(uint256 reward1, uint256 reward2) external onlyOwner updateEpoch {
        uint256 next = nextUnsetEpoch;

        uint256 _now = block.timestamp;
        uint256 finish = epochs[next - 1].finish;
        if (finish < _now) {
            epochs[next].start = _now;
        } else {
            epochs[next].start = finish;
        }

        epochs[next].finish = epochs[next].start + epochDuration;
        // Should check balance of contract for reward?
        // totalRewardPaid totalRewards 
        // availableUnclaimed = totalReward - totalRewardPaid -> balanceOf - availableUnclaimed == currentReward + allNext + the of to be setted.
        epochs[next].reward1 = reward1;
        epochs[next].reward2 = reward2;
        epochs[next].isSet = true;
        
        nextUnsetEpoch += 1;
        emit SetNextReward(next, reward1, reward2, epoch[next].start, epoch[next].finish);
    }

    // // Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
    // function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
    //     require(tokenAddress != address(stakingToken), "Cannot withdraw the staking token");
    //     IERC20(tokenAddress).safeTransfer(owner, tokenAmount);
    //     emit Recovered(tokenAddress, tokenAmount);
    // }

    // function setRewardsDuration(uint256 _rewardsDuration) external onlyOwner {
    //     require(
    //         block.timestamp > periodFinish,
    //         "Previous rewards period must be complete before changing the duration for the new period"
    //     );
    //     rewardsDuration = _rewardsDuration;
    //     emit RewardsDurationUpdated(rewardsDuration);
    // }

    /* ========== MODIFIERS ========== */
    
    // Think about edge case like the last valid epoch is due
    // But owner wants to set new rewards again. What will happen?
    modifier updateEpoch {
        uint256 current = currentEpoch;

        if (epochs[current].finish <= block.timestamp && epochs[current].isSet == true)
            currentEpoch += 1;
        _;
    }

    modifier updateReward(address account) {
        uint256 current = currentEpoch;
        uint256 lastEpochPaid = accounts[msg.sender].lastEpochPaid;

        for (int i = lastEpochPaid; i < current; i++) {
            uint256 share = epochs[i].balanceLocked[msg.sender] * 1e18 / epochs[i].totalLocked;

            uint256 rewardPaid1 = share * epochs[i].reward1 / 1e18;
            uint256 rewardPaid2 = share * epochs[i].reward2 / 1e18;

            totalRewardsPaid1 += paidReward1;
            totalRewardsPaid2 += paidReward2;

            accounts[msg.sender].reward1 += paidReward1;
            accounts[msg.sender].reward2 += paidReward2;
            
            accounts[msg.sender].lockEpochs -= 1;
        }
        accounts[msg.sender].lastEpochPaid = current;
        _;
    }

    /* ========== EVENTS ========== */

    // Create more events and delete unused ones
    event RewardAdded(uint256 reward);
    event Deposit(address indexed user, uint256 amount, uint256 lockedEpochs);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event Recovered(address token, uint256 amount);
    event SetNextReward(uint256 indexed epochId, uint256 reward1, uint256 reward2, uint256 start, uint256 finish);
}