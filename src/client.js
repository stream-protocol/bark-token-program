"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
// Initialize connection to the local Solana node
const connection = new web3_js_1.Connection('https://api.devnet.solana.com', 'confirmed');
// Generate keys for payer, mint authority, and mint
const payer = web3_js_1.Keypair.generate();
const mintAuthority = web3_js_1.Keypair.generate();
const mintKeypair = web3_js_1.Keypair.generate();
const mint = mintKeypair.publicKey;
// Generate keys for transfer fee config authority and withdrawal authority
const transferFeeConfigAuthority = web3_js_1.Keypair.generate();
const withdrawWithheldAuthority = web3_js_1.Keypair.generate();
// Define the extensions to be used by the mint
const extensions = [spl_token_1.ExtensionType.TransferFeeConfig];
// Calculate the length of the mint
const mintLen = (0, spl_token_1.getMintLen)(extensions);
// Set the decimals, fee basis points, and maximum fee
const decimals = 9;
const feeBasisPoints = 250; // 2.5%
const maxSupply = BigInt(20000000000 * Math.pow(10, decimals)); // 20 billion tokens
// Define the amount to be minted and the amount to be transferred, accounting for decimals
const mintAmount = maxSupply; // Mint the entire max supply
const transferAmount = BigInt(1000 * Math.pow(10, decimals)); // Transfer 1,000 tokens
// Calculate the fee for the transfer
const calcFee = (transferAmount * BigInt(feeBasisPoints)) / BigInt(10000);
const maxFee = calcFee > maxSupply ? maxSupply : calcFee;
// Token details
const symbol = "BARK";
const tokenName = "Bark";
// Helper function to generate Explorer URL
function generateExplorerTxUrl(txId) {
    return `https://explorer.solana.com/tx/${txId}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`;
}
function createNewToken() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Step 2 - Create a New Token");
        const mintLamports = yield connection.getMinimumBalanceForRentExemption(mintLen);
        const mintTransaction = new web3_js_1.Transaction().add(web3_js_1.SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: mintLen,
            lamports: mintLamports,
            programId: spl_token_1.TOKEN_2022_PROGRAM_ID,
        }), (0, spl_token_1.createInitializeTransferFeeConfigInstruction)(mintKeypair.publicKey, transferFeeConfigAuthority.publicKey, withdrawWithheldAuthority.publicKey, feeBasisPoints, maxFee, spl_token_1.TOKEN_2022_PROGRAM_ID), (0, spl_token_1.createInitializeMintInstruction)(mintKeypair.publicKey, decimals, mintAuthority.publicKey, null, spl_token_1.TOKEN_2022_PROGRAM_ID));
        const newTokenTx = yield (0, web3_js_1.sendAndConfirmTransaction)(connection, mintTransaction, [payer, mintKeypair], undefined);
        console.log("New Token Created:", generateExplorerTxUrl(newTokenTx));
        return mintKeypair.publicKey;
    });
}
function mintTokensToOwner(mint) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Step 3 - Mint tokens to Owner");
        const owner = web3_js_1.Keypair.generate();
        const sourceAccount = yield (0, spl_token_1.createAssociatedTokenAccountIdempotent)(connection, payer, mint, owner.publicKey, {}, spl_token_1.TOKEN_2022_PROGRAM_ID);
        const mintSig = yield (0, spl_token_1.mintTo)(connection, payer, mint, sourceAccount, mintAuthority, mintAmount, [], undefined, spl_token_1.TOKEN_2022_PROGRAM_ID);
        console.log("Tokens Minted:", generateExplorerTxUrl(mintSig));
        return { owner, sourceAccount };
    });
}
function transferTokens(sourceAccount, mint, owner) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Step 4 - Send Tokens from Owner to a New Account");
        const destinationOwner = web3_js_1.Keypair.generate();
        const destinationAccount = yield (0, spl_token_1.createAssociatedTokenAccountIdempotent)(connection, payer, mint, destinationOwner.publicKey, {}, spl_token_1.TOKEN_2022_PROGRAM_ID);
        const transferSig = yield (0, spl_token_1.transferCheckedWithFee)(connection, payer, sourceAccount, mint, destinationAccount, owner, transferAmount, decimals, maxFee, []);
        console.log("Tokens Transferred:", generateExplorerTxUrl(transferSig));
        return destinationAccount;
    });
}
function fetchFeeAccounts(mint) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Step 5 - Fetch Fee Accounts");
        const allAccounts = yield connection.getProgramAccounts(spl_token_1.TOKEN_2022_PROGRAM_ID, {
            commitment: 'confirmed',
            filters: [{ memcmp: { offset: 0, bytes: mint.toString() } }],
        });
        const accountsToWithdrawFrom = [];
        for (const accountInfo of allAccounts) {
            const account = (0, spl_token_1.unpackAccount)(accountInfo.pubkey, accountInfo.account, spl_token_1.TOKEN_2022_PROGRAM_ID);
            const transferFeeAmount = (0, spl_token_1.getTransferFeeAmount)(account);
            if (transferFeeAmount !== null && transferFeeAmount.withheldAmount > BigInt(0)) {
                accountsToWithdrawFrom.push(accountInfo.pubkey);
            }
        }
        return accountsToWithdrawFrom;
    });
}
function withdrawFeesByAuthority(accountsToWithdrawFrom) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("Step 6 - Withdraw Fees by Authority");
        const feeVault = web3_js_1.Keypair.generate();
        const feeVaultAccount = yield (0, spl_token_1.createAssociatedTokenAccountIdempotent)(connection, payer, mintKeypair.publicKey, feeVault.publicKey, {}, spl_token_1.TOKEN_2022_PROGRAM_ID);
        const withdrawSig1 = yield (0, spl_token_1.withdrawWithheldTokensFromAccounts)(connection, payer, mintKeypair.publicKey, feeVaultAccount, withdrawWithheldAuthority, [], accountsToWithdrawFrom);
        console.log("Withdraw from Accounts:", generateExplorerTxUrl(withdrawSig1));
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const mint = yield createNewToken();
            const { owner, sourceAccount } = yield mintTokensToOwner(mint);
            const destinationAccount = yield transferTokens(sourceAccount, mint, owner);
            const accountsToWithdrawFrom = yield fetchFeeAccounts(mint);
            yield withdrawFeesByAuthority(accountsToWithdrawFrom);
            console.log("Process completed successfully.");
        }
        catch (error) {
            console.error("An error occurred:", error);
        }
    });
}
exports.main = main;
// Execute the main function
main();
