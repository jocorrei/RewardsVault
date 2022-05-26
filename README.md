# Rewards distribution contract

This contract is a contribution to the NewOrder DAO rewards distribution hub.

This contract will be responsible for distributing rewards on governance tokens (emissions from the treasury) and revenue emssions (WETH) to the users who lock their tokens into it. The owner of the contract will set the rewards epochs and amount and in the end of each epoch the contract will distribute these rewards to the addresses that were lock on that epoch based on the amount of tokens they locked.

# How to run:

Install all dependencies: <br>
`npm install` 

Run an ethereum fork node: <br>
`npx hardhat npx hardhat node --fork https://eth-mainnet.alchemyapi.io/v2/<INSERT YOUR ALCHEMY KEY HERE>`

On another terminal deploy the contract: <br>
`npx hardhat test --network localhost`
