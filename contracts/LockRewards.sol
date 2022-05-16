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
        uint256 lockDate;
        uint256 lockPeriod;
        uint256 lockEpochs;
        uint256 rewards1;
        uint256 rewards2;
    }

    struct Total {
        uint256 managed;
        uint256 locked;
        uint256 rewardPerToken1;
        uint256 rewardPerToken1;
    }

    // Mapping to a struct, the end or start date is the 
    // key and the struct has the info to distribute rewards
    struct Epoch {
        uint256 start;
        uint256 finish;
        uint256 epoch;
        bool    status;
    }

    // Array to store the rewards paid, account has an index in which tells where to for loop
    address public lockToken;
    address public rewardToken1;
    address public rewardToken2;
    uint256 public epoch = 7 days;
    
    Epoch public currentEpoch;
    Total public total;
    mapping(address => Account) public accounts;

    /* ========== STATE VARIABLES ========== */

    IERC20 public rewards1;
    IERC20 public stakingToken;
    uint256 public periodFinish = 0;
    uint256 public rewardRate = 0;
    uint256 public rewardsDuration = 7 days;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address _owner,
        address _rewardsDistribution,
        address _rewardsToken,
        address _stakingToken
    ) public Owned(_owner) {
        rewardsToken = IERC20(_rewardsToken);
        stakingToken = IERC20(_stakingToken);
        rewardsDistribution = _rewardsDistribution;
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

    // function deposit(uint256 amount, uint256 lockTime) public nonReentrant updateReward(msg.sender) {
    //     if (amount <= 0) revert InsufficientAmount();
    //     IERC20 lToken = IERC20(lockToken);
    //     uint256 unlockDate = accounts[msg.sender].lockDate + accounts[msg.sender].lockPeriod;
    //     uint256 newUnlockdate = block.timestamp + lockTime;

    //     accounts[msg.sender].balance += amount;
    //     // Ja deu ruim aqui, isso nao funciona
    //     // Pq eu preciso quanto foi depositado e quando pra dar o valor certo de reward.
    //     if (unlockDate < newUnlockdate) {
    //         accounts[msg.sender].
    //     }
    //     accounts[msg.sender].lockDate = block.timestamp;
    //     total.managed += amount;
        
    //     // Probably not right
    //     lToken.safeTransferFrom(msg.sender, address(this), amount);
    //     emit LockTokens(msg.sender, amount, block.timestamp + lockTime);
    // }

    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        if (amount <= 0 || accounts[msg.sender].balance < amount) revert InsufficientAmount();
        
        uint256 unlockDate = accounts[msg.sender].lockDate + accounts[msg.sender].lockPeriod;
        if (unlockDate > block.timestamp) revert FundsInLockPeriod();

        IERC20 lToken = IERC20(lockToken);

        accounts[msg.sender].balance -= amount;
        accounts[msg.sender].lockDate = 0;

        lToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function claimReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward1 = accounts[msg.sender].reward1;
        uint256 reward2 = accounts[msg.sender].reward2;
        if (reward1 > 0) {
            IERC20 rToken1 = IERC20(reward1);
            account[msg.sender].reward1 = 0;
            rToken1.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, rewardToken1, reward);
        }
        if (reward2 > 0) {
            IERC20 rToken2 = IERC20(reward2);
            account[msg.sender].reward2 = 0;
            rToken2.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, rewardToken2, reward);
        }
    }

    // function exit() external {
    //     withdraw(_balances[msg.sender]);
    //     getReward();
    // }

    /* ========== RESTRICTED FUNCTIONS ========== */

    function setNextEpoch(uint256 reward1, uint256 reward2) external onlyRewardsDistribution updateReward(address(0)) {
        // Check if epoch is current right now
        // Then set the next one
        // Calculate the reward per token for this epoch
        // Set the epoch stuff
        if (nextEpoch.status) revert NextEpochAlreadySet();

        nextEpoch.start = block.timestamp;
        nextEpoch.finish = block.timestamp + epoch;
        nextEpoch.reward1PerToken = reward1 / total.Locked;
        nextEpoch.reward2PerToken = reward2 / total.Locked;
    }

    // Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(stakingToken), "Cannot withdraw the staking token");
        IERC20(tokenAddress).safeTransfer(owner, tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    function setRewardsDuration(uint256 _rewardsDuration) external onlyOwner {
        require(
            block.timestamp > periodFinish,
            "Previous rewards period must be complete before changing the duration for the new period"
        );
        rewardsDuration = _rewardsDuration;
        emit RewardsDurationUpdated(rewardsDuration);
    }

    /* ========== MODIFIERS ========== */

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /* ========== EVENTS ========== */

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event Recovered(address token, uint256 amount);
}