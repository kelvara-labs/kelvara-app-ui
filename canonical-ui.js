export function overviewResolvedCopy({positions=[],networkLabel='Mainnet'}={}){
 const count=positions.length;
 return count?{heading:'Portfolio overview',evidence:`Loaded ${count} eligible position${count===1?'':'s'} on ${networkLabel}.`,valueNote:'Current eligible value'}:{heading:'Your capital. Your control.',evidence:'Understand what controls your DeFi positions. Monitor important changes and prepare for the unexpected.',valueNote:'No eligible balance'};
}

export function positionDisplayAmount(position={}){
 const amount=position.details?.underlyingAmount??position.underlyingAmount??position.display?.amount??position.display?.balance;
 const asset=position.details?.asset??position.asset??position.token?.symbol;
 if(amount==null||amount==='')return'Balance unavailable';
 const numeric=Number(amount),display=Number.isFinite(numeric)?new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(numeric).replace(/,/g,'\u00A0'):String(amount);
 return`${display}${asset?` ${asset}`:''}`;
}

export function uniqueSafeguardVaults(vaults=[]){
 const seen=new Set();
 return vaults.filter(vault=>{const key=String(vault?.targetId||vault?.vaultId||'').trim();if(!key||seen.has(key))return false;seen.add(key);return true});
}

export function exitRailStageCopy(title,stage={}){
 const resolvedTitle=String(title||''),status=String(stage.label||'Unavailable');
 return{title:resolvedTitle,status,display:`${resolvedTitle} · ${status}`};
}
