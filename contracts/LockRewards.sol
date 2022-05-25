// SPDX-License-Identifier: MIT 
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/ILockRewards.sol";

/** @title Lock tokens and receive rewards in
 * 2 different tokens
 *  @author gcontarini jocorrei
 *  @notice The locking mechanism is based on epochs.
 * How long each epoch is going to last is up to the
 * contract owner to decide when setting an epoch with
 * the amount of rewards needed. To receive rewards, the
 * funds must be locked before the epoch start and will
 * become claimable at the epoch end. Relocking with 
 * more tokens increases the amount received moving forward.
 * But it also can relock ALL funds for longer periods.
 *  @dev Contract follows a simple owner access control implemented
 * by the Ownable contract. The contract deployer is the owner at 
 * start.
 */
contract LockRewards is ILockRewards, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /// @dev Account hold all user information 
    mapping(address => Account) public accounts;
    /// @dev Total amount of lockTokes that the contract holds
    uint256 public totalAssets;
    address public lockToken;
    /// @dev Hold all rewardToken information like token address
    RewardToken[2] public rewardToken;
    
    /// @dev If false, allows users to withdraw their tokens before the locking end period
    bool    public enforceTime = true;
    
    /// @dev Hold all epoch information like rewards and balance locked for each user
    mapping(uint256 => Epoch) public epochs;
    uint256 public currentEpoch = 1;
    uint256 public nextUnsetEpoch = 1;
    uint256 public maxEpochs;

    /// @dev Contract owner can whitelist an ERC20 token and withdraw its funds
    mapping(address => bool) public whitelistRecoverERC20;
    
    /**
     *  @notice maxEpochs can be changed afterwards by the contract owner
     *  @dev Owner is the deployer
     *  @param _lockToken: token address which users can deposit to receive rewards
     *  @param _rewardAddr1: token address used to pay users rewards
     *  @param _rewardAddr2: token address used to pay users rewards
     *  @param _maxEpochs: max number of epochs an user can lock its funds 
     */
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
    
    /**
     *  @notice Total deposited for address in lockTokens
     *  @dev Show the total balance, not necessary it's all locked
     *  @param owner: user address
     *  @return balance: total balance of address
     */
    function balanceOf(address owner) external view returns (uint256) {
        return accounts[owner].balance;
    }

    /**
     *  @notice Shows the total of tokens locked in an epoch for an user
     *  @param owner: user address
     *  @param epochId: the epoch number
     *  @return balance: total of tokens locked for an epoch 
     */
    function balanceOfInEpoch(address owner, uint256 epochId) external view returns (uint256) {
        return epochs[epochId].balanceLocked[owner];
    }

    /**
     *  @notice Total assets that contract holds
     *  @dev Not all tokens are actually locked
     *  @return totalAssets: amount of lock Tokens deposit in this contract
     */
    function totalLocked() external view returns (uint256) {
        return totalAssets;
    }

    /**
     *  @notice Show all information for on going epoch
     */
    function getCurrentEpoch() external view returns (
        uint256 start,
        uint256 finish,
        uint256 locked,
        uint256 rewards1,
        uint256 rewards2,
        bool    isSet
    ) {
        return _getEpoch(currentEpoch);
    }

    /**
     *  @notice Show all information for next epoch
     *  @dev If next epoch is not set, return all zeros and nulls
     */
    function getNextEpoch() external view returns (
        uint256 start,
        uint256 finish,
        uint256 locked,
        uint256 rewards1,
        uint256 rewards2,
        bool    isSet
    ) {
        if (currentEpoch == nextUnsetEpoch) 
            return (0, 0, 0, 0, 0, false);
        return _getEpoch(currentEpoch + 1);
    }

    /** 
     *  @notice Show information for a given epoch
     *  @dev Start and finish values are seconds 
     *  @param epochId: number of epoch
     */
    function getEpoch(uint256 epochId) external view returns (
        uint256 start,
        uint256 finish,
        uint256 locked,
        uint256 rewards1,
        uint256 rewards2,
        bool    isSet
    ) {
        return _getEpoch(epochId);
    }
    
    /** 
     *  @notice Show information for an account 
     *  @dev LastEpochPaid tell when was the last epoch in each
     * this accounts was updated, which means receive rewards. 
     *  @param owner: address for account 
     */
    function getAccount(
        address owner
    ) external view returns (
        uint256 balance,
        uint256 lockEpochs,
        uint256 lastEpochPaid,
        uint256 rewards1,
        uint256 rewards2
    ) {
        return _getAccount(owner);
    }
    
    /* ========== MUTATIVE FUNCTIONS ========== */

    /**
     *  @notice Update caller account state (grant rewards if available)
     */
    function updateAccount() external updateEpoch updateReward(msg.sender) returns (
        uint256 balance,
        uint256 lockEpochs,
        uint256 lastEpochPaid,
        uint256 rewards1,
        uint256 rewards2
    ) {
        return _getAccount(msg.sender);
    }

    /**
     *  @notice Deposit tokens to receive rewards
     *  @dev Allows relocking by setting amount to zero
     *  @param amount: the amount of lock tokens to deposit
     *  @param lockEpochs: how many epochs to lock tokens,
     * value must be less than maxEpochs 
     */
    function deposit(
        uint256 amount,
        uint256 lockEpochs
    ) external nonReentrant updateEpoch updateReward(msg.sender) {
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
        
        // This is done to save gas in case of a relock
        // Also, emits a different event for deposit or relock
        if (amount > 0) {
            lToken.safeTransferFrom(msg.sender, address(this), amount);
            totalAssets += amount;
            accounts[msg.sender].balance += amount;
        
            emit Deposit(msg.sender, amount, accounts[msg.sender].lockEpochs);
        } else {
            emit Relock(msg.sender, accounts[msg.sender].balance, accounts[msg.sender].lockEpochs);
        }
        
        // Since all funds will be locked for the same period
        // Update all lock epochs for this new value
        uint256 newBalance = accounts[msg.sender].balance;
        for (uint256 i = 0; i < lockEpochs; i++) {
            epochs[i + next].totalLocked += newBalance - epochs[i + next].balanceLocked[msg.sender];
            epochs[i + next].balanceLocked[msg.sender] = newBalance;
        }
    }

    /**
     *  @notice Allows withdraw after lockEpochs is zero 
     *  @param amount: tokens to caller receive
     */
    function withdraw(
        uint256 amount
    ) external nonReentrant updateEpoch updateReward(msg.sender) {
        _withdraw(amount);
    }

    /**
     *  @notice User can receive its claimable rewards 
     */
    function claimReward() external nonReentrant updateEpoch updateReward(msg.sender) returns(uint256, uint256) {
        return _claim();
    }

    /**
     *  @notice User withdraw all its funds and receive all available rewards 
     *  @dev If user funds it's still locked, all transaction will revert
     */
    function exit() external nonReentrant updateEpoch updateReward(msg.sender) returns(uint256, uint256) {
        _withdraw(accounts[msg.sender].balance);
        return _claim();
    }

    /* ========== RESTRICTED FUNCTIONS ========== */
    
    /**
     *  @notice Set a new epoch. The amount needed of tokens
     * should be transfered before calling setNextEpoch. Can only
     * have 2 epochs set, the on going one and the next.
     *  @dev Can set a start epoch different from now when there's
     * no epoch on going. If there's an epoch on going, can
     * only set the start after the finish of current epoch.
     *  @param reward1: the amount of rewards to be distributed
     * in token 1 for this epoch
     *  @param reward2: the amount of rewards to be distributed
     * in token 2 for this epoch
     *  @param epochDurationInDays: how long the epoch will last
     * in days
     *  @param epochStart: the epoch start date in unix epoch (seconds) 
     */
    function setNextEpoch(
        uint256 reward1,
        uint256 reward2,
        uint256 epochDurationInDays,
        uint256 epochStart
    ) external onlyOwner updateEpoch {
        _setEpoch(reward1, reward2, epochDurationInDays, epochStart);
    }

    /**
     *  @notice Set a new epoch. The amount needed of tokens
     * should be transfered before calling setNextEpoch. Can only
     * have 2 epochs set, the on going one and the next.
     *  @dev If epoch is finished and there isn't a new to start,
     * the contract will hold. But in that case, when the next 
     * epoch is set it'll already start (meaning: start will be
     * the current block timestamp).
     *  @param reward1: the amount of rewards to be distributed
     * in token 1 for this epoch
     *  @param reward2: the amount of rewards to be distributed
     * in token 2 for this epoch
     *  @param epochDurationInDays: how long the epoch will last
     * in days
     */
    function setNextEpoch(
        uint256 reward1,
        uint256 reward2,
        uint256 epochDurationInDays
    ) external onlyOwner updateEpoch {
        _setEpoch(reward1, reward2, epochDurationInDays, block.timestamp);
    }
    
    /**
     *  @notice To recover ERC20 sent by accident.
     * All funds are only transfered to contract owner.
     *  @dev To allow a withdraw, first the token must be whitelisted
     *  @param tokenAddress: token to transfer funds
     *  @param tokenAmount: the amount to transfer to owner
     */
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        if (whitelistRecoverERC20[tokenAddress] == false) revert NotWhitelisted();
        
        uint balance = IERC20(tokenAddress).balanceOf(address(this));
        if (balance < tokenAmount) revert InsufficientBalance(); 

        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
        emit RecoveredERC20(tokenAddress, tokenAmount);
    }

    /**
     *  @notice  Add or remove a token from recover whitelist
     *  @dev Only contract owner are allowed. Emits an event
     * allowing users to perceive the changes in contract rules.
     * The contract allows to whitelist the underlying tokens
     * (both lock token and rewards tokens). This can be exploited
     * by the owner to remove all funds deposited from all users.
     * This is done bacause the owner is mean to be a multisig or
     * treasury wallet from a DAO
     *  @param flag: set true to allow recover
     */
    function changeRecoverWhitelist(address tokenAddress, bool flag) external onlyOwner {
        whitelistRecoverERC20[tokenAddress] = flag;
        emit ChangeERC20Whiltelist(tokenAddress, flag);
    }

    /**
     *  @notice Allows recover for NFTs 
     */
    function recoverERC721(address tokenAddress, uint256 tokenId) external onlyOwner {
        IERC721(tokenAddress).transferFrom(address(this), owner(), tokenId);
        emit RecoveredERC721(tokenAddress, tokenId);
    }

    /**
     *  @notice Allows owner change rule to allow users' withdraw
     * before the lock period is over
     *  @dev In case a major flaw, do this to prevent users from losing
     * their funds. Also, if no more epochs are going to be setted allows 
     * users to withdraw their assets
     *  @param flag: set false to allow withdraws
     */
    function changeEnforceTime(bool flag) external onlyOwner {
        enforceTime = flag;
        emit ChangeEnforceTime(block.timestamp, flag);
    }

    /**
     *  @notice Allows owner to change the max epochs an 
     * user can lock their funds
     *  @param _maxEpochs: new value for maxEpochs
     */
    function changeMaxEpochs(uint256 _maxEpochs) external onlyOwner {
        uint256 oldEpochs = maxEpochs;
        maxEpochs = _maxEpochs;
        emit ChangeMaxLockEpochs(block.timestamp, oldEpochs, _maxEpochs);
    }
    
    /* ========== INTERNAL FUNCTIONS ========== */
    
    /**
     *  @notice Implements internal setEpoch logic
     *  @dev Can only set 2 epochs, the on going and
     * the next one. This has to be done in 2 different
     * transactions.
     *  @param reward1: the amount of rewards to be distributed
     * in token 1 for this epoch
     *  @param reward2: the amount of rewards to be distributed
     * in token 2 for this epoch
     *  @param epochDurationInDays: how long the epoch will last
     * in days
     *  @param epochStart: the epoch start date in unix epoch (seconds) 
     */
    function _setEpoch(
        uint256 reward1,
        uint256 reward2,
        uint256 epochDurationInDays,
        uint256 epochStart
    ) internal {
        if (nextUnsetEpoch - currentEpoch > 1)
            revert EpochMaxReached(2);
        if (epochStart < block.timestamp)
            revert EpochStartInvalid(epochStart, block.timestamp);

        uint256[2] memory rewards = [reward1, reward2];

        for (uint256 i = 0; i < 2; i++) {
            uint256 unclaimed = rewardToken[i].rewards - rewardToken[i].rewardsPaid;
            uint256 balance = IERC20(rewardToken[i].addr).balanceOf(address(this));
            
            if (balance - unclaimed < rewards[i])
                revert InsufficientFundsForRewards(rewardToken[i].addr, balance - unclaimed, rewards[i]);
            
            rewardToken[i].rewards += rewards[i];
        }
        
        uint256 next = nextUnsetEpoch;
        
        if (currentEpoch == next || epochStart > epochs[next - 1].finish + 1) {
            epochs[next].start = epochStart;
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
    
    /**
     *  @notice Implements internal withdraw logic
     *  @dev The withdraw is always done in name 
     * of caller for caller
     *  @param amount: amount of tokens to withdraw
     */
    function _withdraw(uint256 amount) internal {
        if (amount <= 0 || accounts[msg.sender].balance < amount) revert InsufficientAmount();
        if (accounts[msg.sender].lockEpochs > 0 && enforceTime) revert FundsInLockPeriod(accounts[msg.sender].balance);

        IERC20(lockToken).safeTransfer(msg.sender, amount);
        totalAssets -= amount;
        accounts[msg.sender].balance -= amount;
        emit Withdrawn(msg.sender, amount);
    }

    /**
     *  @notice Implements internal claim rewards logic
     *  @dev The claim is always done in name 
     * of caller for caller
     *  @return amount of rewards transfer in token 1
     *  @return amount of rewards transfer in token 2
     */
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
    
    /**
     *  @notice Implements internal getAccount logic
     *  @param owner: address to check information§
     */
    function _getAccount(
        address owner
    ) internal view returns (
        uint256 balance,
        uint256 lockEpochs,
        uint256 lastEpochPaid,
        uint256 rewards1,
        uint256 rewards2
    ) {
        return (
            accounts[owner].balance,
            accounts[owner].lockEpochs,
            accounts[owner].lastEpochPaid,
            accounts[owner].rewards1,
            accounts[owner].rewards2
        );
    }
    
    /**
     *  @notice Implements internal getEpoch logic
     *  @param epochId: the number of the epoch
     */
    function _getEpoch(uint256 epochId) internal view returns (
        uint256 start,
        uint256 finish,
        uint256 locked,
        uint256 rewards1,
        uint256 rewards2,
        bool    isSet
    ) {
        return (
            epochs[epochId].start, 
            epochs[epochId].finish,
            epochs[epochId].totalLocked,
            epochs[epochId].rewards1,
            epochs[epochId].rewards2,
            epochs[epochId].isSet
            );
    }

    /* ========== MODIFIERS ========== */
    
    modifier updateEpoch {
        uint256 current = currentEpoch;

        while (epochs[current].finish <= block.timestamp && epochs[current].isSet == true)
            current++;
        currentEpoch = current;
        _;
    }

    modifier updateReward(address owner) {
        uint256 current = currentEpoch;
        uint256 lockEpochs = accounts[owner].lockEpochs;
        uint256 lastEpochPaid = accounts[owner].lastEpochPaid;

        uint256 limit = lastEpochPaid + lockEpochs; 
        if (limit > current)
            limit = current;

        for (uint256 i = lastEpochPaid; i < limit; i++) {
            if (epochs[i].totalLocked == 0) continue;

            uint256 share = epochs[i].balanceLocked[owner] * 1e18 / epochs[i].totalLocked;

            uint256 rewardPaid1 = share * epochs[i].rewards1 / 1e18;
            uint256 rewardPaid2 = share * epochs[i].rewards2 / 1e18;

            rewardToken[0].rewardsPaid += rewardPaid1;
            rewardToken[1].rewardsPaid += rewardPaid2;

            accounts[owner].rewards1 += rewardPaid1;
            accounts[owner].rewards2 += rewardPaid2;
            
            accounts[owner].lockEpochs -= 1;
        }
        if (lastEpochPaid != current)
            accounts[owner].lastEpochPaid = current;
        _;
    }
}