// SPDX-License-Identifier: MIT 
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract LockRewards is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    error InsufficientAmount();
    error InsufficientBalance();
    error FundsInLockPeriod(uint256 balance);
    error InsufficientFundsForRewards(address token, uint256 available, uint256 rewardAmount);
    error LockEpochsMax(uint256 maxEpochs);
    error NotWhitelisted();
    
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

    struct RewardToken {
        address addr;
        uint256 rewards;
        uint256 rewardsPaid;
    }
    
    /* ========== STATE VARIABLES ========== */

    mapping(address => Account) public accounts;
    mapping(uint256 => Epoch) public epochs;
    uint256 public currentEpoch = 1;
    uint256 public nextUnsetEpoch = 1;
    uint256 public totalAssets;
    bool public enforceTime = true;

    uint256 public maxEpochs;
    address public lockToken;
    RewardToken[2] public rewardToken;

    mapping(address => bool) public whitelistRecoverERC20;
    
    // TODO
    // Views -> balanceOf, allowance, lockEpochs, currentEpoch, nextSet, reward per epoch, balanceOfEpoch (general and for account),
    // totalLocked, totalLocked per epoch
    /* ========== CONSTRUCTOR ========== */

    // Owner is the deployer
    // To change it call transferOwnership
    constructor(
        address _lockToken,
        address _rewardAddr1,
        address _rewardAddr2,
        uint256 _maxEpochs
    ) {
        lockToken = _lockToken;
        rewardToken[0].addr  = _rewardAddr1;  
        rewardToken[1].addr  = _rewardAddr2;  
        maxEpochs = _maxEpochs;
    }

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

    function deposit(
        uint256 amount,
        uint256 lockEpochs
    ) external nonReentrant updateEpoch updateReward(msg.sender) {
        if (amount <= 0) revert InsufficientAmount();
        if (lockEpochs > maxEpochs) revert LockEpochsMax(maxEpochs);
        IERC20 lToken = IERC20(lockToken);

        // Check if current epoch is in course
        // Then, set the deposit for the upcoming ones
        uint256 next = currentEpoch;
        if (epochs[next].isSet)
            next += 1;
        
        // In case of a relock, set the lockEpochs to the
        // biggest number of epochs. Starting for the next
        // possible epoch.
        if (accounts[msg.sender].lockEpochs < lockEpochs) {
            accounts[msg.sender].lockEpochs = lockEpochs;
        } else {
            lockEpochs = accounts[msg.sender].lockEpochs;
        }
        
        lToken.safeTransferFrom(msg.sender, address(this), amount);
        totalAssets += amount;
        accounts[msg.sender].balance += amount;
        uint256 newBalance = accounts[msg.sender].balance;

        // Since all funds will be locked for the same period
        // Update all lock epochs for this new value
        for (uint256 i = 0; i < lockEpochs; i++) {
            epochs[i + next].totalLocked += newBalance - epochs[i + next].balanceLocked[msg.sender];
            epochs[i + next].balanceLocked[msg.sender] = newBalance;
        }
        emit Deposit(msg.sender, amount, accounts[msg.sender].lockEpochs);
    }

    function withdraw(
        uint256 amount
    ) external nonReentrant updateEpoch updateReward(msg.sender) {
        _withdraw(amount);
    }

    function claimReward() external nonReentrant updateEpoch updateReward(msg.sender) returns(uint256, uint256) {
        return _claim();
    }

    function exit() external returns(uint256, uint256) {
        _withdraw(accounts[msg.sender].balance);
        return _claim();
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    // If epoch is finished and there isn't a new to start, the contract will hold.
    // But in that case, when the next epoch is set it'll already start (meaning: start will be the current block timestamp).
    function setNextEpoch(
        uint256 reward1,
        uint256 reward2,
        uint256 epochDurationInDays
    ) external onlyOwner updateEpoch {
        uint256[2] memory rewards = [reward1, reward2];

        for (uint256 i = 0; i < 2; i++) {
            uint256 unclaimed = rewardToken[i].rewards - rewardToken[i].rewardsPaid;
            uint256 balance = IERC20(rewardToken[i].addr).balanceOf(address(this));
            
            if (balance - unclaimed < rewards[i])
                revert InsufficientFundsForRewards(rewardToken[i].addr, balance - unclaimed, rewards[i]);
            
            rewardToken[i].rewards += rewards[i];
        }
        
        uint256 next = nextUnsetEpoch;
        
        if (currentEpoch == next) {
            epochs[next].start = block.timestamp;
        } else {
            epochs[next].start = epochs[next - 1].finish + 1;
        }
        epochs[next].finish = epochs[next].start + (epochDurationInDays * 86400); // Seconds in a day

        epochs[next].rewards1 = reward1;
        epochs[next].rewards2 = reward2;
        epochs[next].isSet = true;
        
        nextUnsetEpoch += 1;
        emit SetNextReward(next, reward1, reward2, epochs[next].start, epochs[next].finish);
    }
    
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        if (whitelistRecoverERC20[tokenAddress] == false) revert NotWhitelisted();
        
        uint balance = IERC20(tokenAddress).balanceOf(address(this));
        if (balance < tokenAmount) revert InsufficientBalance(); 

        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
        emit RecoveredERC20(tokenAddress, tokenAmount);
    }

    function changeRecoverWhitelist(address tokenAddress, bool flag) external onlyOwner {
        whitelistRecoverERC20[tokenAddress] = flag;
        emit ChangeERC20Whiltelist(tokenAddress, flag);
    }

    function recoverERC721(address tokenAddress, uint256 tokenId) external onlyOwner {
        IERC721(tokenAddress).transferFrom(address(this), owner(), tokenId);
        emit RecoveredERC721(tokenAddress, tokenId);
    }

    function changeEnforceTime(bool flag) external onlyOwner {
        enforceTime = flag;
        emit ChangeEnforceTime(block.timestamp, flag);
    }

    function changeMaxEpochs(uint256 _maxEpochs) external onlyOwner {
        uint256 oldEpochs = maxEpochs;
        maxEpochs = _maxEpochs;
        emit ChangeMaxLockEpochs(block.timestamp, oldEpochs, _maxEpochs);
    }
    
    /* ========== INTERNAL FUNCTIONS ========== */
    
    function _withdraw(
        uint256 amount
    ) internal {
        if (amount <= 0 || accounts[msg.sender].balance < amount) revert InsufficientAmount();
        if (accounts[msg.sender].lockEpochs > 0 && enforceTime) revert FundsInLockPeriod(accounts[msg.sender].balance);

        IERC20(lockToken).safeTransfer(msg.sender, amount);
        totalAssets -= amount;
        accounts[msg.sender].balance -= amount;
        emit Withdrawn(msg.sender, amount);
    }

    function _claim() internal returns(uint256, uint256) {
        uint256 reward1 = accounts[msg.sender].rewards1;
        uint256 reward2 = accounts[msg.sender].rewards2;

        if (reward1 > 0) {
            accounts[msg.sender].rewards1 = 0;
            IERC20(rewardToken[0].addr).safeTransfer(msg.sender, reward1);
            emit RewardPaid(msg.sender, rewardToken[0].addr, reward1);
        }
        if (reward2 > 0) {
            accounts[msg.sender].rewards2 = 0;
            IERC20(rewardToken[1].addr).safeTransfer(msg.sender, reward2);
            emit RewardPaid(msg.sender, rewardToken[1].addr, reward2);
        }
        return (reward1, reward2);
    }

    /* ========== MODIFIERS ========== */
    
    modifier updateEpoch {
        uint256 current = currentEpoch;

        if (epochs[current].finish <= block.timestamp && epochs[current].isSet == true)
            currentEpoch += 1;
        _;
    }

    modifier updateReward(address account) {
        uint256 current = currentEpoch;
        uint256 lastEpochPaid = accounts[msg.sender].lastEpochPaid;

        for (uint256 i = lastEpochPaid; i < current; i++) {
            uint256 share = epochs[i].balanceLocked[msg.sender] * 1e18 / epochs[i].totalLocked;

            uint256 rewardPaid1 = share * epochs[i].rewards1 / 1e18;
            uint256 rewardPaid2 = share * epochs[i].rewards2 / 1e18;

            rewardToken[0].rewardsPaid += rewardPaid1;
            rewardToken[1].rewardsPaid += rewardPaid2;

            accounts[msg.sender].rewards1 += rewardPaid1;
            accounts[msg.sender].rewards2 += rewardPaid2;
            
            accounts[msg.sender].lockEpochs -= 1;
        }
        if (lastEpochPaid != current)
            accounts[msg.sender].lastEpochPaid = current;
        _;
    }

    /* ========== EVENTS ========== */

    // Create more events and delete unused ones
    event Deposit(address indexed user, uint256 amount, uint256 lockedEpochs);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, address token, uint256 reward);
    event SetNextReward(uint256 indexed epochId, uint256 reward1, uint256 reward2, uint256 start, uint256 finish);
    event RecoveredERC20(address token, uint256 amount);
    event RecoveredERC721(address token, uint256 tokenId);
    event ChangeERC20Whiltelist(address token, bool tokenState);
    event ChangeEnforceTime(uint256 indexed currentTime, bool flag);
    event ChangeMaxLockEpochs(uint256 indexed currentTime, uint256 oldEpochs, uint256 newEpochs);
}