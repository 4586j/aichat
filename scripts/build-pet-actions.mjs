// Maintenance only: pack imagegen's transparent 6x4 artwork, preserving its alpha and real poses.
// node scripts/build-pet-actions.mjs <pet-id> <6x4-sheet.png>
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const sharp = createRequire(import.meta.url)(process.env.SHARP_MODULE_PATH || 'sharp');
const size = 384, ids = ['cream-cat', 'shiba', 'lop-rabbit', 'little-fox'];
const [id, source, waveSource] = process.argv.slice(2);
const path = name => fileURLToPath(new URL(`../${name}`, import.meta.url));
if (id === '--preview') {
  const tiles = [];
  for (const [row, pet] of ids.entries()) for (let col = 0; col < 4; col++) {
    const input = await sharp(path(`public/assets/pets/${pet}-actions-v3.webp`))
      .extract({left: 3*size, top: col*size, width:size, height:size}).resize(240).toBuffer();
    tiles.push({input, left:col*240, top:row*240});
  }
  await mkdir(path('docs/assets'), {recursive:true});
  await sharp({create:{width:960,height:960,channels:4,background:'#edf2e7'}}).composite(tiles)
    .webp({quality:90}).toFile(path('docs/assets/pet-actions-v3.webp'));
  process.exit(0);
}
if (!ids.includes(id) || !source) throw new Error('Usage: node scripts/build-pet-actions.mjs <pet-id> <6x4-sheet.png>');
const meta = await sharp(source).metadata();
if (meta.width % 6 || meta.height % 4 || meta.width/6 !== meta.height/4) throw new Error('Expected a 6x4 sheet of equal square cells.');
if (!(await sharp(source).stats()).channels[3] || (await sharp(source).stats()).isOpaque) throw new Error('Artwork must have genuine transparent alpha.');
const cell = meta.width/6;
const waveMeta=waveSource?await sharp(waveSource).metadata():null;
if(waveMeta && (waveMeta.width%3 || waveMeta.height%2 || waveMeta.width/3!==waveMeta.height/2))throw new Error('Wave replacement must be a 3x2 transparent sheet.');
function isolateCharacter(data) {
  // A generated grid can include a disconnected whisker/tail from its neighbour at the cell edge.
  // Keep the complete main alpha component, including its soft fur; do not redraw or key colors.
  const visited=new Uint8Array(cell*cell),queue=new Int32Array(cell*cell);let largest=[];
  for(let start=0;start<visited.length;start++){
    if(visited[start]||data[start*4+3]<=32)continue;
    let head=0,tail=1;queue[0]=start;visited[start]=1;
    while(head<tail){const p=queue[head++],x=p%cell,y=Math.floor(p/cell);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=x+dx,ny=y+dy;if(nx<0||nx>=cell||ny<0||ny>=cell)continue;
        const next=ny*cell+nx;if(!visited[next]&&data[next*4+3]>32){visited[next]=1;queue[tail++]=next;}
      }
    }
    if(tail>largest.length)largest=Array.from(queue.subarray(0,tail));
  }
  // Retain a three-pixel soft-alpha fringe around the selected component.
  const keep=new Uint8Array(cell*cell);for(const p of largest){const x=p%cell,y=Math.floor(p/cell);
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const nx=x+dx,ny=y+dy;if(nx>=0&&nx<cell&&ny>=0&&ny<cell)keep[ny*cell+nx]=1;}
  }
  for(let p=0;p<keep.length;p++)if(!keep[p])data[p*4+3]=0;
  return data;
}
function bounds(data, width, height) {
  let left=width, right=-1, top=height, bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>32){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<left)throw new Error('An animation cell is empty.');
  return {left,right,top,bottom,width:right-left+1,height:bottom-top+1,cx:(left+right)/2};
}
const original=await sharp(path(`public/assets/pets/${id}-v1.png`)).resize(size,size).ensureAlpha().raw().toBuffer();
const target=bounds(original,size,size), cells=[];
for(let row=0;row<4;row++)for(let col=0;col<6;col++){
  const replacement=row===0 && waveMeta, edge=replacement?waveMeta.width/3:cell;
  const input=replacement?waveSource:source, left=replacement?col%3*edge:col*edge, top=replacement?Math.floor(col/3)*edge:row*edge;
  const data=isolateCharacter(await sharp(input).extract({left,top,width:edge,height:edge}).resize(cell,cell).ensureAlpha().raw().toBuffer());
  cells.push({data,bounds:bounds(data,cell,cell),row,col});
}
// One scale for all 24 poses; never enlarge each pose separately (which cancels a stretch/jump).
const neutralHeight=cells.filter(item=>item.col===0||item.col===5).reduce((sum,item)=>sum+item.bounds.height,0)/8;
const centers=Array.from({length:4},(_,row)=>(cells[row*6].bounds.cx+cells[row*6+5].bounds.cx)/2);
const leftExtent=Math.max(...cells.map(item=>centers[item.row]-item.bounds.left));
const rightExtent=Math.max(...cells.map(item=>item.bounds.right-centers[item.row]));
const scale=Math.min(target.height/neutralHeight,(size-16)/Math.max(...cells.map(item=>item.bounds.height)),(size-16)/(leftExtent+rightExtent));
const resized=Math.round(cell*scale), actualScale=resized/cell, packed=[];
const targetCenter=Math.max(8+leftExtent*actualScale,Math.min(target.cx,size-8-rightExtent*actualScale));
for(const item of cells){
  const resting=[cells[item.row*6].bounds,cells[item.row*6+5].bounds];
  const center=resting.reduce((sum,b)=>sum+b.cx,0)/2;
  const floor=resting.reduce((sum,b)=>sum+b.bottom,0)/2;
  const airborne=item.row===3 && [2,3].includes(item.col);
  const left=Math.round(targetCenter-center*actualScale);
  const top=Math.round(Math.min(size-8,target.bottom)-(airborne?floor:item.bounds.bottom)*actualScale);
  const frame=await sharp(item.data,{raw:{width:cell,height:cell,channels:4}}).resize(resized,resized).png().toBuffer();
  // Sharp composite requires images within the canvas. Crop surplus transparent padding, not fur.
  const sx=Math.max(0,-left), sy=Math.max(0,-top), dx=Math.max(0,left), dy=Math.max(0,top);
  const width=Math.min(resized-sx,size-dx),height=Math.min(resized-sy,size-dy);
  const cropped=await sharp(frame).extract({left:sx,top:sy,width,height}).toBuffer();
  const input=await sharp({create:{width:size,height:size,channels:4,background:'#00000000'}}).composite([{input:cropped,left:dx,top:dy}]).png().toBuffer();
  const check=bounds(await sharp(input).raw().toBuffer(),size,size);
  if(check.left<1||check.right>size-2||check.top<1||check.bottom>size-2)throw new Error(`${id} row ${item.row} col ${item.col}: pose touches output boundary.`);
  packed.push({input,left:item.col*size,top:item.row*size});
}
const output=path(`public/assets/pets/${id}-actions-v3.webp`);
await sharp({create:{width:size*6,height:size*4,channels:4,background:'#00000000'}}).composite(packed)
  .webp({quality:88,alphaQuality:100,effort:6}).toFile(output);
console.log(JSON.stringify({id,output,frames:24,scale:actualScale}));
