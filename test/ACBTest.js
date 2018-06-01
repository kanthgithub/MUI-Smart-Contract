let Utils = require('./utils');

let BigNumber = web3.BigNumber;

let should = require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bignumber')(BigNumber))
    .should();

let ACB = artifacts.require("ACB");
let MuiToken = artifacts.require("MuiToken");

contract('ACB', () => {
    let initialEtherBalance = Utils.ether(2);
    let initialTokenPrice = new BigNumber(1);
    let initialTokenSupply = new BigNumber('1e9');
    let clientToken = new BigNumber(10000);
    // Notice that this approximation does not neccessarily mean that it is correct.
    // Therefore do not rely on this approximation all the time
    // If there needs fine tuning to check/compare ether balances before and after transactions,
    // change this gas amount accordingly or adjust it by multiplying by some constants
    // Also it may change depending of gas fee!
    let approximateGasFee = new BigNumber('1e16'); // 0.01 ether
    let admin = web3.eth.accounts[0];
    let beneficiary = web3.eth.accounts[1];
    let client = web3.eth.accounts[2];
    let nonAuthorizedAddr = web3.eth.accounts[3];

    beforeEach(async () => {
        // Deploy MUI Token contract
        this.token = await MuiToken.new(beneficiary);
        // Deploy Algorithmic Central Bank contract and fund some ether
        this.acb = await ACB.new(this.token.address, initialTokenPrice, initialTokenPrice, {value: initialEtherBalance});
        // Fund the ACB contract with MUI token
        await this.token.transfer(this.acb.address, initialTokenSupply, {from: beneficiary});
        // Fund the client with some MUI token
        await this.token.transfer(client, clientToken, {from: beneficiary});
    });

    it('should reject direct ether receivals', async () => {
        await this.acb.sendTransaction({value: Utils.ether(1)}).should.be.rejected; 
    });

    it('should accept ether receivals through depositEther function', async () => {
        await this.acb.depositEther({value: Utils.ether(1)}).should.be.fulfilled; 
    });

    describe('Admin', () => {
        it('should be able to set prices', async () => {
            let buyPrice = new BigNumber('3e14');   // 0.0003 ether
            let sellPrice = new BigNumber('33e13'); // 0.00033 ether
            // Set prices
            await this.acb.setPrices(buyPrice, sellPrice).should.be.fulfilled;
            // Get prices
            let expectedBuyPrice = await this.acb.buyPriceACB();
            let expectedSellPrice = await this.acb.sellPriceACB();
            // Compare the prices returned back from the contract and the prices set to contract
            expectedBuyPrice.should.be.bignumber.equal(buyPrice);
            expectedSellPrice.should.be.bignumber.equal(sellPrice);
        });

        it('should be able to set fee rate', async () => {
            let feeRate = new BigNumber('3e13');   // 0.00003 ether
            // Set fee rate
            await this.acb.setFeeRate(feeRate).should.be.fulfilled;
            // Get fee rate
            let expectedFeeRate = await this.acb.feeRateACB();
            // Compare the fee rate returned back from the contract and the fee rate set to contract
            expectedFeeRate.should.be.bignumber.equal(feeRate);
        });

        it('should be able to set available supplies', async () => {
            let buySupply = new BigNumber('1e15');   // 10**15 token
            let sellSupply = new BigNumber('0');     // 0 token
            // Set supplies
            await this.acb.setAvailableSupplies(buySupply, sellSupply).should.be.fulfilled;
            // Get supplies
            let expectedBuySupply= await this.acb.buySupplyACB();
            let expectedSellSupply= await this.acb.sellSupplyACB();
            // Compare the supplies returned back from the contract and the supplies set to contract
            expectedBuySupply.should.be.bignumber.equal(buySupply);
            expectedSellSupply.should.be.bignumber.equal(sellSupply);
        });

        it('should not be able to set sell supply to an amount greater than token balance of this contract', async () => {
            let sellSupply = new BigNumber('1e10');
            // Set sell supply to a number which is greater than the current sell supply
            // initialTokenSupply (1e9) < sellSupply (1e10)
            await this.acb.setAvailableSupplies(0, sellSupply).should.be.rejected;
        });

        it('should be able to withdraw ether and token', async () => {
            let tokenAmount = new BigNumber(5000);
            let etherAmount = Utils.ether(1);
            let preAdminEtherBalance = await web3.eth.getBalance(admin);
            let preAdminTokenBalance = await this.token.balanceOf(admin);
            
            // Withdraw some ether from ACB
            await this.acb.withdrawEtherAuthorized(etherAmount, {from: admin}).should.be.fulfilled;
            // Withdraw some token from ACB
            await this.acb.withdrawTokenAuthorized(this.token.address, tokenAmount, {from: admin}).should.be.fulfilled;

            let postAdminEtherBalance = await web3.eth.getBalance(admin);
            let postAdminTokenBalance = await this.token.balanceOf(admin);

            // Compare pre and post balances for both ether and token
            postAdminEtherBalance.should.be.bignumber.above(preAdminEtherBalance.add(etherAmount).sub(approximateGasFee));
            postAdminTokenBalance.should.be.bignumber.equal(preAdminTokenBalance.add(tokenAmount));
        });
    });

    describe('Non-authorized callee', () => {
        it('should not be able to call admin functions', async () => {
            let buyPrice = new BigNumber('3e14');    // 0.0003 ether
            let sellPrice = new BigNumber('33e13');  // 0.00033 ether
            let buySupply = new BigNumber('1e15');   // 10**15 token
            let sellSupply = new BigNumber('0');     // 0 token
            let feeRate = new BigNumber('3e13');     // 0.00003 ether
            // Try to set prices
            await this.acb.setPrices(buyPrice, sellPrice, {from: nonAuthorizedAddr}).should.be.rejected;
            // Try to set fee rate
            await this.acb.setFeeRate(feeRate, {from: nonAuthorizedAddr}).should.be.rejected;
            // Try to set supplies
            await this.acb.setAvailableSupplies(buySupply, sellSupply, {from: nonAuthorizedAddr}).should.be.rejected;
            // Try to withdraw some ether from ACB
            await this.acb.withdrawEtherAuthorized(Utils.ether(1), {from: nonAuthorizedAddr}).should.be.rejected;
            // Try to withdraw some token from ACB
            await this.acb.withdrawTokenAuthorized(this.token.address, clientToken, {from: nonAuthorizedAddr}).should.be.rejected;
        });
    });

    // TODO: Add tests for trades which include fee > 0
    describe('Successful trades', () => {
        let tokenAmount = new BigNumber('5e3');   // 5000 token
        let buyPrice = new BigNumber('3e14');     // 0.0003 ether
        let sellPrice = new BigNumber('33e13');   // 0.00033 ether
        let preClientTokenBalance;
        let preClientEtherBalance;
        let preACBTokenBalance;
        let preACBEtherBalance;
        let postClientTokenBalance;
        let postClientEtherBalance;
        let postACBTokenBalance;
        let postACBEtherBalance;

        beforeEach(async () => {
            // Set prices and supplies before any trade
            await this.acb.setPrices(buyPrice, sellPrice).should.be.fulfilled;
            await this.acb.setAvailableSupplies(initialTokenSupply, initialTokenSupply).should.be.fulfilled;

            // Get token and ether balances of both the client and ACB contract before any trade
            preClientTokenBalance = await this.token.balanceOf(client);
            preClientEtherBalance = await web3.eth.getBalance(client);
            preACBTokenBalance = await this.token.balanceOf(this.acb.address);
            preACBEtherBalance = await web3.eth.getBalance(this.acb.address);
        });

        it('should be able to buy', async () => {
            let purchaseCost = Utils.calculateCost(tokenAmount, sellPrice, 0, true);

            // Buy some tokens from ACB as a client
            await this.acb.buyFromACB(tokenAmount, {value: purchaseCost, from: client}).should.be.fulfilled;

            // Get token and ether balances of both the client and ACB contract after the trade
            postClientTokenBalance = await this.token.balanceOf(client);
            postClientEtherBalance = await web3.eth.getBalance(client);
            postACBTokenBalance = await this.token.balanceOf(this.acb.address);
            postACBEtherBalance = await web3.eth.getBalance(this.acb.address);

            // Compare token and ether balances of both the client and ACB contract before and after the trade
            postClientTokenBalance.should.be.bignumber.equal(preClientTokenBalance.add(tokenAmount));
            postClientEtherBalance.should.be.bignumber.above(preClientEtherBalance.sub(purchaseCost).sub(approximateGasFee));
            postACBEtherBalance.should.be.bignumber.equal(preACBEtherBalance.add(purchaseCost));
            postACBTokenBalance.should.be.bignumber.equal(preACBTokenBalance.sub(tokenAmount));
        });

        it('should be able to sell', async () => {
            let purchaseCost = Utils.calculateCost(tokenAmount, buyPrice, 0, false);

            // Allow ACB contract to transfer tokens from client's balance
            await this.token.approve(this.acb.address, tokenAmount, {from: client}).should.be.fulfilled;
            // Buy some tokens from ACB with as a client 
            await this.acb.sellToACB(tokenAmount, {from: client}).should.be.fulfilled;

            // Get token and ether balances of both the client and ACB contract after the trade
            postClientTokenBalance = await this.token.balanceOf(client);
            postClientEtherBalance = await web3.eth.getBalance(client);
            postACBTokenBalance = await this.token.balanceOf(this.acb.address);
            postACBEtherBalance = await web3.eth.getBalance(this.acb.address);

            // Compare token and ether balances of both the client and ACB contract before and after the trade
            postClientTokenBalance.should.be.bignumber.equal(preClientTokenBalance.sub(tokenAmount));
            postClientEtherBalance.should.be.bignumber.above(preClientEtherBalance.add(purchaseCost).sub(approximateGasFee));
            postACBEtherBalance.should.be.bignumber.equal(preACBEtherBalance.sub(purchaseCost));
            postACBTokenBalance.should.be.bignumber.equal(preACBTokenBalance.add(tokenAmount));
        });
    });

    describe('Failed trades', () => {
        let tokenAmount = new BigNumber('5e3');   // 5000 token
        let buyPrice = new BigNumber('3e14');     // 0.0003 ether
        let sellPrice = new BigNumber('33e13');   // 0.00033 ether
        let preClientTokenBalance;
        let preClientEtherBalance;
        let preACBTokenBalance;
        let preACBEtherBalance;
        let postClientTokenBalance;
        let postClientEtherBalance;
        let postACBTokenBalance;
        let postACBEtherBalance;

        beforeEach(async () => {
            // Set prices and supplies before any trade
            await this.acb.setPrices(buyPrice, sellPrice).should.be.fulfilled;
            await this.acb.setAvailableSupplies(initialTokenSupply, initialTokenSupply).should.be.fulfilled;

            // Get token and ether balances of both the client and ACB contract before any trade
            preClientTokenBalance = await this.token.balanceOf(client);
            preClientEtherBalance = await web3.eth.getBalance(client);
            preACBTokenBalance = await this.token.balanceOf(this.acb.address);
            preACBEtherBalance = await web3.eth.getBalance(this.acb.address);
        });

        it('should not be able to buy if ether sent to ACB is not enough', async () => {
            let purchaseCost = Utils.calculateCost(tokenAmount, sellPrice, 0, true);
            // Buy some tokens from ACB by sending ether which is less than the expected cost
            await this.acb.buyFromACB(tokenAmount, {value: purchaseCost.sub(1), from: client}).should.be.rejected;

            // Check post ether balance of client whether she/he has lost ether or not
            postClientEtherBalance = await web3.eth.getBalance(client);
            postClientEtherBalance.should.be.bignumber.above(preClientEtherBalance.sub(approximateGasFee));
        });

        it('should not be able to buy if the avaible sell supply is not enough', async () => {
            let purchaseCost = Utils.calculateCost(tokenAmount, sellPrice, 0, true);
            // First set available sell supply less than the desired amount of token which will be purchased
            await this.acb.setAvailableSupplies(0, tokenAmount.sub(1)).should.be.fulfilled;
            // Then try to buy that desired amount of token from ACB
            await this.acb.buyFromACB(tokenAmount, {value: purchaseCost, from: client}).should.be.rejected;

            // Check post ether balance of client whether she/he has lost ether or not
            postClientEtherBalance = await web3.eth.getBalance(client);
            postClientEtherBalance.should.be.bignumber.above(preClientEtherBalance.sub(approximateGasFee));
        });

        it('should not be able to buy if token balance of ACB is not enough', async () => {
            // First set the sell price something low so that client account can afford to buy
            // token as amount of initialTokenSupply. Because ACB was funded in the deployment
            // with token as amount of initialTokenSupply and we cannot call `transfer()` function
            // with callee of ACB's address to reduce to token balance.
            sellPrice = new BigNumber('1e8');
            await this.acb.setPrices(0, sellPrice).should.be.fulfilled;

            tokenAmount = initialTokenSupply.add(1);   // initialTokenSupply + 1
            let purchaseCost = Utils.calculateCost(tokenAmount, sellPrice, 0, true);
            // Try to buy token from ACB which is more than token balance of ACB contract
            await this.acb.buyFromACB(tokenAmount, {value: purchaseCost, from: client}).should.be.rejected;

            // Check post ether balance of client whether she/he has lost ether or not
            postClientEtherBalance = await web3.eth.getBalance(client);
            postClientEtherBalance.should.be.bignumber.above(preClientEtherBalance.sub(approximateGasFee));
        });

        it('should not be able to sell if ether balance of ACB is not enough', async () => {
            // First set buy first to a higher value so that the amount of token to be sold
            // values more than ether balance of ACB. i.e. initialEtherBalance < buyPrice * tokenAmount
            buyPrice = Utils.ether(1);     // 1 ether
            await this.acb.setPrices(buyPrice, sellPrice).should.be.fulfilled;
            // Allow ACB contract to transfer tokens from client's balance
            await this.token.approve(this.acb.address, tokenAmount, {from: client}).should.be.fulfilled;
            // Buy some tokens from ACB with as a client 
            await this.acb.sellToACB(tokenAmount, {from: client}).should.be.rejected;

            // Check post token balance of client whether she/he has lost token or not
            postClientTokenBalance = await this.token.balanceOf(client);
            postClientTokenBalance.should.be.bignumber.equal(preClientTokenBalance);
        });

        it('should not be able to sell if the avaible buy supply is not enough', async () => {
            // Set buy supply of ACB to a number less than amount of token to be sold
            // buySupplyACB = tokenAmount - 1
            await this.acb.setAvailableSupplies(tokenAmount.sub(1), 0).should.be.fulfilled;
            // Allow ACB contract to transfer tokens from client's balance
            await this.token.approve(this.acb.address, tokenAmount, {from: client}).should.be.fulfilled;
            // Buy some tokens from ACB with as a client 
            await this.acb.sellToACB(tokenAmount, {from: client}).should.be.rejected;

            // Check post token balance of client whether she/he has lost token or not
            postClientTokenBalance = await this.token.balanceOf(client);
            postClientTokenBalance.should.be.bignumber.equal(preClientTokenBalance);
        });

        it('should not be able to sell if token balance of client is not enough', async () => {
            // Set the amount of token to be sold to a number more than client's token balance
            tokenAmount = clientToken.add(1); // clientToken + 1

            // Allow ACB contract to transfer tokens from client's balance
            await this.token.approve(this.acb.address, tokenAmount, {from: client}).should.be.fulfilled;
            // Buy some tokens from ACB with as a client 
            await this.acb.sellToACB(tokenAmount, {from: client}).should.be.rejected;

            // Check post token balance of client whether she/he has lost token or not
            postClientTokenBalance = await this.token.balanceOf(client);
            postClientTokenBalance.should.be.bignumber.equal(preClientTokenBalance);
        });
    });
});
