// Neutral wallet identicon: a mirrored 5x5 grid seeded from the address, one muted cool tone per wallet.
const BASE58=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function seeded(value){let hash=0x811c9dc5;for(const char of value){hash^=char.charCodeAt(0);hash=Math.imul(hash,0x01000193)>>>0}return()=>(hash=Math.imul(hash^(hash>>>15),0x85ebca6b)>>>0)}

export function identiconCells(publicKey){
 if(typeof publicKey!=="string"||!BASE58.test(publicKey))return null;
 const next=seeded(publicKey),hue=190+next()%80,cells=[];
 for(let row=0;row<5;row++)for(let col=0;col<3;col++)if(next()%2)for(const x of new Set([col,4-col]))cells.push([x,row]);
 return{hue,cells};
}

export function identiconSvg(publicKey){
 const traits=identiconCells(publicKey);if(!traits)return null;
 const{hue,cells}=traits,rects=cells.map(([x,y])=>`<rect x="${x+1.5}" y="${y+1.5}" width="1" height="1"/>`).join("");
 return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" aria-hidden="true" focusable="false"><rect width="8" height="8" fill="hsl(${hue} 14% 14%)"/><g fill="hsl(${hue} 18% 72%)">${rects}</g></svg>`;
}
