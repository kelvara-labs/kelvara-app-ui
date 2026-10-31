const MAINNET_RPC='https://api.mainnet-beta.solana.com';
const SUBSCRIPTIONS_PROGRAM='De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44';

export function buildSubscriptionTeardownInstructions({finding,wallet,web3}){
  const policy=finding?.policyVerification==='verified'&&finding.policies?.length===1&&finding.policies[0]?.kind==='fixed'?finding.policies[0]:null;
  if(!policy||finding.ownerWallet!==wallet)throw new Error('subscription_teardown_unverified');
  const programId=new web3.PublicKey(SUBSCRIPTIONS_PROGRAM),owner=new web3.PublicKey(wallet),tokenAccount=new web3.PublicKey(finding.tokenAccount),mint=new web3.PublicKey(finding.mint),tokenProgram=new web3.PublicKey(finding.programId),authority=new web3.PublicKey(finding.delegate),policyAccount=new web3.PublicKey(policy.address);
  return[
    new web3.TransactionInstruction({programId,keys:[{pubkey:owner,isSigner:true,isWritable:true},{pubkey:policyAccount,isSigner:false,isWritable:true}],data:Uint8Array.of(3)}),
    new web3.TransactionInstruction({programId,keys:[{pubkey:owner,isSigner:true,isWritable:true},{pubkey:tokenAccount,isSigner:false,isWritable:true},{pubkey:mint,isSigner:false,isWritable:false},{pubkey:tokenProgram,isSigner:false,isWritable:false},{pubkey:authority,isSigner:false,isWritable:true}],data:Uint8Array.of(14)}),
  ];
}

export async function reconcileExpiredConfirmation(connection,signature){
  const status=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value?.[0];
  if(status?.err)throw new Error('revoke_transaction_failed');
  return status?.confirmationStatus==='confirmed'||status?.confirmationStatus==='finalized';
}

export async function revokeTokenDelegate({finding,wallet,provider,web3=globalThis.solanaWeb3,rpcUrl=MAINNET_RPC,fetchImpl=globalThis.fetch,rpc,onStage=()=>{}}){
  if(!finding||finding.ownerWallet!==wallet)throw new Error('revoke_wallet_mismatch');
  if(!provider?.signTransaction||!web3)throw new Error('wallet_cannot_sign');
  const owner=new web3.PublicKey(wallet),tokenAccount=new web3.PublicKey(finding.tokenAccount),programId=new web3.PublicKey(finding.programId),policy=finding.policies?.[0],policyAccount=policy&&new web3.PublicKey(policy.address),authorityAccount=new web3.PublicKey(finding.delegate);
  const relayFetch=rpc?async(_url,options)=>{const request=JSON.parse(options.body),result=await rpc(request.method,request.params);return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200,headers:{'content-type':'application/json'}})}:fetchImpl;
  const connection=new web3.Connection(rpc?new URL('/api/wallet-exposure/rpc',globalThis.location?.href??'http://localhost').href:rpcUrl,{commitment:'finalized',fetch:relayFetch});
  const [before,policyBefore,authorityBefore]=await Promise.all([connection.getParsedAccountInfo(tokenAccount,'finalized'),policyAccount&&connection.getAccountInfo(policyAccount,'finalized'),connection.getAccountInfo(authorityAccount,'finalized')]),info=before.value?.data?.parsed?.info;
  if(!info||info.owner!==wallet||info.delegate!==finding.delegate)throw new Error('delegate_state_changed');
  if(!policyBefore||!authorityBefore||policyBefore.owner?.toString()!==SUBSCRIPTIONS_PROGRAM||authorityBefore.owner?.toString()!==SUBSCRIPTIONS_PROGRAM)throw new Error('subscription_teardown_state_changed');
  const instructions=buildSubscriptionTeardownInstructions({finding,wallet,web3});
  for(let attempt=0;attempt<2;attempt++){
    const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash('confirmed'),transaction=new web3.Transaction({feePayer:owner,recentBlockhash:blockhash}).add(...instructions),simulation=await connection.simulateTransaction(transaction,undefined,true);
    if(simulation.value.err)throw new Error('revoke_simulation_failed');
    onStage(attempt?'retrying':'wallet_pending');
    let signed;try{signed=await provider.signTransaction(transaction)}catch(error){onStage('wallet_rejected');throw error}
    onStage('submitting');
    const signature=await connection.sendRawTransaction(signed.serialize(),{skipPreflight:false,maxRetries:3});
    onStage('submitted',signature);
    try{
      const confirmation=await connection.confirmTransaction({signature,blockhash,lastValidBlockHeight},'finalized');
      if(confirmation.value.err)throw new Error('revoke_transaction_failed');
    }catch(error){
      if(!/block height exceeded|blockheight/i.test(String(error?.message))||await reconcileExpiredConfirmation(connection,signature)){if(!/block height exceeded|blockheight/i.test(String(error?.message)))throw error}
      else{
        if(attempt===1)throw error;
        const fresh=await connection.getParsedAccountInfo(tokenAccount,'finalized'),freshInfo=fresh.value?.data?.parsed?.info;
        if(!freshInfo||freshInfo.owner!==wallet||freshInfo.delegate!==finding.delegate)throw new Error('delegate_state_changed');
        continue;
      }
    }
    onStage('finalizing',signature);
    const [after,policyAfter,authorityAfter]=await Promise.all([connection.getParsedAccountInfo(tokenAccount,'finalized'),connection.getAccountInfo(policyAccount,'finalized'),connection.getAccountInfo(authorityAccount,'finalized')]),afterInfo=after.value?.data?.parsed?.info;
    if(!afterInfo||afterInfo.owner!==wallet||afterInfo.delegate!=null||policyAfter||authorityAfter)throw new Error('revoke_post_state_unverified');
    onStage('finalized',signature);
    return{signature,slot:after.context.slot,revoked:true,accountsClosed:[policy.address,finding.delegate],grossRentLamports:policyBefore.lamports+authorityBefore.lamports};
  }
}