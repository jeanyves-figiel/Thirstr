// Run from repo root: python3 design/brand/glyphs.py && node design/brand/build.js (needs Playwright + Chromium).
// Then strip alpha from icon.png / android-icon-background.png (App Store rejects alpha).
// Builds design/brand SVG sources (outlined Bricolage Grotesque 800) and app PNGs.
const fs=require('fs');const path=require('path');const {chromium}=require('playwright');
const G=JSON.parse(fs.readFileSync(path.join(__dirname,'glyphs.json')));
const C={ink:'#17142E',coral:'#FF6B5B',violet:'#A78BFA',lime:'#B8F04A',sun:'#FFC93C',white:'#FFFFFF'};
const R=path.resolve(__dirname,'../..');
const glyph=(ch,x,y,s,fill)=>`<path transform="translate(${+x.toFixed(2)} ${+y.toFixed(2)}) scale(${s})" fill="${fill}" d="${G[ch].d}"/>`;
const dots=(x,cy,r,gap,cols=[C.sun,C.violet,C.lime])=>cols.map((c,i)=>`<circle cx="${+(x+r+i*(2*r+gap)).toFixed(2)}" cy="${+cy.toFixed(2)}" r="${r}" fill="${c}"/>`).join('');
// Short-form mark (icon concept A): fs 600, x0 118, baseline 702.
function mark(mono){const s=.6,x0=118,b=702,w=mono?C.white:null;
 return glyph('t',x0,b,s,w||C.white)+glyph('r',x0+366*s,b,s,w||C.coral)+dots(x0+796*s+34,b-40,40,18,mono?[w,w,w]:undefined);}
const svg=(body,bgc)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${bgc?`<rect width="1024" height="1024" fill="${bgc}"/>`:''}${body}</svg>\n`;
// Adaptive foreground: mark scaled 0.66 about centre so it fits Android's 66% safe circle.
const adaptive=mono=>`<g transform="translate(512 512) scale(0.66) translate(-512 -512)">${mark(mono)}</g>`;
// Wordmark: thirstr + dots, letter-spacing -0.04em, dots Ø0.3em gap 0.08em baseline-aligned.
function wordmark(fs_,x0,b){const s=fs_/1000;let x=x0,out='';for(const [i,ch] of [...'thirstr'].entries()){out+=glyph(ch,x,b,s,i===6?C.coral:C.white);x+=(G[ch].adv-40)*s;}
 x+=40*s; // no tracking after last glyph
 const r=150*s,gap=80*s;return {body:out+dots(x+gap,b-r,r,gap),width:x+gap+3*2*r+2*gap-x0};}
const files={
 'app-icon.svg':svg(mark(false),C.ink),
 'app-icon-foreground.svg':svg(adaptive(false)),
 'app-icon-monochrome.svg':svg(adaptive(true)),
};
// measure wordmark at fs 1000 then fit to 70% of 1024 for the splash
const w0=wordmark(1000,0,0).width;const fsS=1024*.70/w0*1000;const wm=wordmark(fsS,(1024-w0*fsS/1000)/2,512+ (540-0)/2*fsS/1000*0.5);
files['splash-wordmark.svg']=svg(wm.body);
const wmw=wordmark(200,8,200);files['wordmark.svg']=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(wmw.width+16)} 260" width="${Math.ceil(wmw.width+16)}" height="260">${wmw.body}</svg>\n`;
for(const [n,c] of Object.entries(files))fs.writeFileSync(`${R}/design/brand/${n}`,c);
const pngs=[['app-icon.svg','icon.png',1024],['app-icon-foreground.svg','android-icon-foreground.png',1024],['app-icon-monochrome.svg','android-icon-monochrome.png',1024],['splash-wordmark.svg','splash-icon.png',1024],['app-icon.svg','favicon.png',48]];
(async()=>{const b=await chromium.launch();
 for(const [src,out,size] of pngs){const p=await b.newPage({viewport:{width:size,height:size}});
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${files[src]}`);
  await p.screenshot({path:`${R}/apps/mobile/assets/${out}`,omitBackground:true});await p.close();}
 const p=await b.newPage({viewport:{width:1024,height:1024}});await p.setContent(`<body style="margin:0;background:${C.ink}"></body>`);await p.screenshot({path:`${R}/apps/mobile/assets/android-icon-background.png`});
 await b.close();})();
