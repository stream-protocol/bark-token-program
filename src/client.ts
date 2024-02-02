import {
    sendAndConfirmTransaction,
    Connection,
    Keypair,
    SystemProgram,
    Transaction,
    PublicKey,
  } from '@solana/web3.js';
  
  import {
    ExtensionType,
    createInitializeMintInstruction,
    mintTo,
    createAccount,
    getMintLen,
    getTransferFeeAmount,
    unpackAccount,
    TOKEN_2022_PROGRAM_ID,
    createInitializeTransferFeeConfigInstruction,
    harvestWithheldTokensToMint,
    transferCheckedWithFee,
    withdrawWithheldTokensFromAccounts,
    withdrawWithheldTokensFromMint,
    getOrCreateAssociatedTokenAccount,
    createAssociatedTokenAccountIdempotent,
  } from '@solana/spl-token';
  
  // Initialize connection to the local Solana node
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Generate keys for payer, mint authority, and mint
  const payer = Keypair.generate();
  const mintAuthority = Keypair.generate();
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  
  // Generate keys for transfer fee config authority and withdrawal authority
  const transferFeeConfigAuthority = Keypair.generate();
  const withdrawWithheldAuthority = Keypair.generate();
  
  // Define the extensions to be used by the mint
  const extensions = [ExtensionType.TransferFeeConfig];
  
  // Calculate the length of the mint
  const mintLen = getMintLen(extensions);
  
  // Set the decimals, fee basis points, and maximum fee
  const decimals = 9;
  const feeBasisPoints = 250; // 2.5%
  const maxSupply = BigInt(20_000_000_000 * Math.pow(10, decimals)); // 20 billion tokens
  
  // Define the amount to be minted and the amount to be transferred, accounting for decimals
  const mintAmount = maxSupply; // Mint the entire max supply
  const transferAmount = BigInt(1_000 * Math.pow(10, decimals)); // Transfer 1,000 tokens
  
  // Calculate the fee for the transfer
  const calcFee = (transferAmount * BigInt(feeBasisPoints)) / BigInt(10_000);
  const maxFee = calcFee > maxSupply ? maxSupply : calcFee;
  
  // Token details
  const symbol = "BARK";
  const tokenName = "Bark";
  
  // Helper function to generate Explorer URL
  function generateExplorerTxUrl(txId: string): string {
    return `https://explorer.solana.com/tx/${txId}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`;
  }
  
  async function createNewToken(): Promise<PublicKey> {
    console.log("Step 2 - Create a New Token");
    const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);
    const mintTransaction = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: mintLen,
            lamports: mintLamports,
            programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeTransferFeeConfigInstruction(
            mintKeypair.publicKey,
            transferFeeConfigAuthority.publicKey,
            withdrawWithheldAuthority.publicKey,
            feeBasisPoints,
            maxFee,
            TOKEN_2022_PROGRAM_ID
        ),
        createInitializeMintInstruction(mintKeypair.publicKey, decimals, mintAuthority.publicKey, null, TOKEN_2022_PROGRAM_ID)
    );
  
    const newTokenTx = await sendAndConfirmTransaction(connection, mintTransaction, [payer, mintKeypair], undefined);
    console.log("New Token Created:", generateExplorerTxUrl(newTokenTx));
  
    return mintKeypair.publicKey;
  }
  
  async function mintTokensToOwner(mint: PublicKey): Promise<{ owner: Keypair, sourceAccount: PublicKey }> {
    console.log("Step 3 - Mint tokens to Owner");
    const owner = Keypair.generate();
    const sourceAccount = await createAssociatedTokenAccountIdempotent(connection, payer, mint, owner.publicKey, {}, TOKEN_2022_PROGRAM_ID);
    const mintSig = await mintTo(connection, payer, mint, sourceAccount, mintAuthority, mintAmount, [], undefined, TOKEN_2022_PROGRAM_ID);
    console.log("Tokens Minted:", generateExplorerTxUrl(mintSig));
  
    return { owner, sourceAccount };
  }
  
  async function transferTokens(sourceAccount: PublicKey, mint: PublicKey, owner: Keypair): Promise<PublicKey> {
    console.log("Step 4 - Send Tokens from Owner to a New Account");
    const destinationOwner = Keypair.generate();
    const destinationAccount = await createAssociatedTokenAccountIdempotent(connection, payer, mint, destinationOwner.publicKey, {}, TOKEN_2022_PROGRAM_ID);
    const transferSig = await transferCheckedWithFee(
        connection,
        payer,
        sourceAccount,
        mint,
        destinationAccount,
        owner,
        transferAmount,
        decimals,
        maxFee,
        []
    );
    console.log("Tokens Transferred:", generateExplorerTxUrl(transferSig));
  
    return destinationAccount;
  }
  
  async function fetchFeeAccounts(mint: PublicKey): Promise<PublicKey[]> {
    console.log("Step 5 - Fetch Fee Accounts");
    const allAccounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [{ memcmp: { offset: 0, bytes: mint.toString() } }],
    });
  
    const accountsToWithdrawFrom: PublicKey[] = [];
    for (const accountInfo of allAccounts) {
        const account = unpackAccount(accountInfo.pubkey, accountInfo.account, TOKEN_2022_PROGRAM_ID);
        const transferFeeAmount = getTransferFeeAmount(account);
        if (transferFeeAmount !== null && transferFeeAmount.withheldAmount > BigInt(0)) {
            accountsToWithdrawFrom.push(accountInfo.pubkey);
        }
    }
  
    return accountsToWithdrawFrom;
  }
  
  async function withdrawFeesByAuthority(accountsToWithdrawFrom: PublicKey[]): Promise<void> {
    console.log("Step 6 - Withdraw Fees by Authority");
    const feeVault = Keypair.generate();
    const feeVaultAccount = await createAssociatedTokenAccountIdempotent(connection, payer, mintKeypair.publicKey, feeVault.publicKey, {}, TOKEN_2022_PROGRAM_ID);
  
    const withdrawSig1 = await withdrawWithheldTokensFromAccounts(
        connection,
        payer,
        mintKeypair.publicKey,
        feeVaultAccount,
        withdrawWithheldAuthority,
        [],
        accountsToWithdrawFrom
    );
    console.log("Withdraw from Accounts:", generateExplorerTxUrl(withdrawSig1));
  }
  
  export async function main(): Promise<void> {
    try {
        const mint = await createNewToken();
        const { owner, sourceAccount } = await mintTokensToOwner(mint);
        const destinationAccount = await transferTokens(sourceAccount, mint, owner);
        const accountsToWithdrawFrom = await fetchFeeAccounts(mint);
        await withdrawFeesByAuthority(accountsToWithdrawFrom);
  
        console.log("Process completed successfully.");
    } catch (error) {
        console.error("An error occurred:", error);
    }
  }
  
  // Execute the main function
  main();
  