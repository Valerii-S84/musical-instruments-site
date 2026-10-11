/* Локальні регресії віолончелі. Потрібні playwright-core та Chromium; мережевих залежностей сторінка не має. */
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const root=path.resolve(__dirname,'..');
const html=path.join(root,'standalone','Cello_Studio.html');
const siteHtml=path.join(root,'dist','cello','index.html');
const url=pathToFileURL(html).href;
const output=process.env.CELLO_QA_OUTPUT_DIR;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('Віолончель: браузерні регресії та аудіовихід', {timeout:180000}, async t=>{
 const browser=process.env.CELLO_CDP_URL?await chromium.connectOverCDP(process.env.CELLO_CDP_URL):await chromium.launch({headless:true,chromiumSandbox:true,timeout:20000,...(process.env.CELLO_CHROMIUM_PATH?{executablePath:process.env.CELLO_CHROMIUM_PATH}:{})});
 t.after(()=>browser.close());
 if(output)fs.mkdirSync(output,{recursive:true});
 const errors=[],measurements=[];
 async function pageAt(viewport={width:1440,height:900},init){
  const page=await browser.newPage({viewport,hasTouch:true,isMobile:viewport.width<=760});
  page.setDefaultTimeout(7000);
  page.on('pageerror',e=>errors.push(e.message));
  if(init)await page.addInitScript(init);
  await page.goto(url);await page.waitForFunction(()=>window.CelloStudio?.geometry);
  return page;
 }
 const state=page=>page.evaluate(()=>CelloStudio.state);
 const voice=page=>page.evaluate(()=>CelloStudio.audio.voice?.midi??null);
 const click=async(page,selector)=>{await page.locator(selector).click();await delay(35);};
 async function trace(page){await page.evaluate(()=>{
  window.noteStarts=[];
  const a=CelloStudio.audio,bow=a.bow.bind(a),pluck=a.pluck.bind(a);
  a.bow=(...args)=>{const old=a.voice,result=bow(...args);if(a.voice&&a.voice!==old)noteStarts.push({kind:'arco',midi:a.voice.midi});return result;};
  a.pluck=(...args)=>{const result=pluck(...args);if(result)noteStarts.push({kind:'pizz',midi:args[0]});return result;};
 });}
 async function initAudio(page){await click(page,'#soundToggle');assert.equal((await state(page)).audioState,'running');}

 await t.test('Перша позиція: усі позначки доступні на восьми екранах',async()=>{
  for(const [width,height] of [[320,568],[360,740],[390,844],[430,932],[768,1024],[1440,900],[844,390],[640,360]]){
   const page=await pageAt({width,height});
   for(const mode of ['free','learn']){
    await click(page,`[data-mode=${mode}]`);
    if(mode==='learn')await page.locator('#lessonSelect').selectOption('steps');
    else await click(page,'#positionButton');
    await delay(100);
    const layout=await page.evaluate(()=>{
     const g=CelloStudio.geometry,r=document.querySelector('#cello').getBoundingClientRect();
     const points=CelloStudio.offsets.slice(1).flatMap(offset=>[0,1,2,3].map(i=>{
      const y=145+645*(1-2**(-offset/12)),x=260+(i-1.5)*(25+((y-145)/645)*8);
      const px=g.ox+x*g.scale,py=g.oy+y*g.scale;
      return {x:px,y:py,canvas:document.elementFromPoint(r.left+px,r.top+py)?.id};
     }));
     return {points,w:r.width,h:r.height,overflow:document.documentElement.scrollWidth>innerWidth+1};
    });
    assert.equal(layout.overflow,false,`${width}×${height} ${mode}`);
    assert.ok(layout.points.every(p=>p.x>=12&&p.x<=layout.w-12&&p.y>=80&&p.y<layout.h-40),JSON.stringify({width,height,mode,layout}));
    assert.ok(layout.points.every(p=>p.canvas==='cello'),'Позначки мають приймати дотики');
    if(output&&[390,1440].includes(width))await page.screenshot({path:path.join(output,`first-${mode}-${width}.png`),fullPage:true});
   }
   measurements.push({viewport:[width,height],fingerMarkers:'pass'});await page.close();
  }
 });

 await t.test('Щипок із клавіатури не запускає смичок',async()=>{
  const page=await pageAt();await click(page,'[data-technique=pizz]');await initAudio(page);await trace(page);
  await page.keyboard.down('KeyQ');await delay(35);await page.keyboard.press('Digit1');await delay(35);
  assert.equal(await voice(page),null);assert.equal((await state(page)).midi,38);
  assert.deepEqual(await page.evaluate(()=>noteStarts.map(n=>[n.kind,n.midi])),[['pizz',36],['pizz',38]]);
  await page.keyboard.up('KeyQ');await page.close();
 });

 await t.test('Повторні перетини однієї струни дають окремі щипки',async()=>{
  const page=await pageAt();await click(page,'[data-technique=pizz]');await initAudio(page);await trace(page);
  const p=await page.evaluate(()=>{const g=CelloStudio.geometry,r=document.querySelector('#cello').getBoundingClientRect(),y=650,x=260+.5*(25+(y-145)/645*8);return {x:r.left+g.ox+x*g.scale,y:r.top+g.oy+y*g.scale,d:8*g.scale};});
  await page.mouse.move(p.x+p.d,p.y);await page.mouse.down();await delay(30);
  for(const direction of [-1,1,-1,1]){await page.mouse.move(p.x+direction*p.d,p.y);await delay(25);}
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>noteStarts.map(n=>n.midi)),[50,50,50,50,50]);await page.close();
 });

 await t.test('Повторна Ля зараховується лише після нової атаки',async()=>{
  const page=await pageAt();await click(page,'[data-mode=learn]');await trace(page);
  for(const key of ['KeyQ','KeyW','KeyE']){await page.keyboard.down(key);await delay(30);await page.keyboard.up(key);}
  await page.keyboard.down('KeyR');await delay(40);assert.equal((await state(page)).step,4);
  await page.keyboard.press('Digit0');assert.equal((await state(page)).step,4);
  await page.keyboard.up('KeyR');await page.keyboard.down('KeyR');await delay(35);assert.equal((await state(page)).step,5);
  assert.equal((await page.evaluate(()=>noteStarts.filter(n=>n.midi===57))).length,2);
  await page.keyboard.up('KeyR');await page.close();
 });

 await t.test('Кнопки пальців і струн зберігають клавіатурне утримання',async()=>{
  const page=await pageAt();await click(page,'#positionButton');await initAudio(page);await trace(page);
  await page.keyboard.down('KeyE');await delay(35);
  const button=await page.locator('.finger').nth(2).boundingBox();await page.mouse.move(button.x+button.width/2,button.y+button.height/2);await page.mouse.down();await delay(35);
  assert.equal((await state(page)).midi,53);assert.equal(await voice(page),53);
  await page.mouse.up();await delay(850);assert.equal(await voice(page),53);
  await page.locator('.string-button').nth(3).click();await delay(35);assert.equal(await voice(page),60);
  await page.keyboard.up('KeyE');assert.equal(await voice(page),null);
  assert.deepEqual(await page.evaluate(()=>noteStarts.map(n=>n.midi)),[50,53,60]);await page.close();
 });

 await t.test('Повільний смичок накопичує рух і стихає після паузи',async()=>{
  const page=await pageAt();await initAudio(page);
  const r=await page.locator('#bowPad').boundingBox(),x=r.x+60,y=r.y+30;
  await page.mouse.move(x,y);await page.mouse.down();
  for(let i=1;i<=20;i++){await page.mouse.move(x+i*.3,y);await delay(8);}
  assert.equal((await state(page)).bowing,true);assert.equal(await voice(page),50);
  await delay(190);assert.equal(await voice(page),null);await page.mouse.up();await page.close();
 });

 await t.test('Зміна напрямку смичка створює нову ноту для навчання',async()=>{
  const page=await pageAt();await click(page,'[data-mode=learn]');await initAudio(page);await trace(page);
  const r=await page.locator('#bowPad').boundingBox(),x=r.x+70,y=r.y+30;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+20,y);await delay(40);
  assert.equal((await state(page)).step,1);
  for(let i=1;i<=4;i++){await delay(35);await page.mouse.move(x+20+i*3,y);}
  await page.mouse.move(x+20,y);await delay(35);
  assert.equal((await state(page)).step,1);
  assert.equal((await page.evaluate(()=>noteStarts)).length,2);await page.mouse.up();await page.close();
 });

 await t.test('Esc прибирає тимчасове затискання дотиком',async()=>{
  const page=await pageAt();await click(page,'#positionButton');await initAudio(page);
  const p=await page.evaluate(()=>{const g=CelloStudio.geometry,r=document.querySelector('#cello').getBoundingClientRect(),y=145+645*(1-2**(-5/12)),x=260+.5*(25+(y-145)/645*8);return {x:r.left+g.ox+x*g.scale,y:r.top+g.oy+y*g.scale};});
  const r=await page.locator('#bowPad').boundingBox(),cdp=await page.context().newCDPSession(page);
  const finger={id:1,x:p.x,y:p.y,radiusX:2,radiusY:2,force:.5},bow={id:2,x:r.x+60,y:r.y+30,radiusX:2,radiusY:2,force:.5};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});
  assert.equal((await state(page)).finger,4);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger,bow]});
  bow.x+=25;await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[finger,bow]});await delay(35);assert.equal(await voice(page),55);
  await page.keyboard.press('Escape');assert.equal((await state(page)).finger,0);assert.equal(await voice(page),null);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal((await state(page)).finger,0);await page.close();
 });

 await t.test('Доступні назви відповідають звучній ноті',async()=>{
  const page=await pageAt();await click(page,'#positionButton');await page.locator('.finger').nth(2).click();
  assert.match(await page.locator('.string-button').nth(2).getAttribute('aria-label'),/Фа F3/);
  await page.keyboard.press('Escape');await click(page,'#positionButton');assert.match(await page.locator('.string-button').nth(2).getAttribute('aria-label'),/Ре D3/);await page.close();
 });

 await t.test('Діалоги: закриття, Esc, Tab і фокус з API та без нього',async()=>{
  for(const fallback of [false,true]){
   const page=await pageAt(undefined,fallback?()=>{HTMLDialogElement.prototype.showModal=undefined;HTMLDialogElement.prototype.close=undefined;}:undefined);
   for(const id of ['help','settings']){
    const opener=id==='help'?'#helpButton':'#settingsButton';await click(page,opener);
    assert.equal(await page.locator(`#${id}Dialog`).evaluate(d=>d.hasAttribute('open')),true);
    const buttons=page.locator(`#${id}Dialog [data-close]`);await buttons.last().focus();await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-close')),`${id}Dialog`);
    await page.keyboard.press('Shift+Tab');assert.equal(await buttons.last().evaluate(b=>b===document.activeElement),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator(`#${id}Dialog`).evaluate(d=>d.hasAttribute('open')),false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),opener.slice(1));
    await click(page,opener);await buttons.first().click();assert.equal(await page.locator(`#${id}Dialog`).evaluate(d=>d.hasAttribute('open')),false);
    if(fallback){await click(page,opener);await page.locator('.dialog-fallback-backdrop').click({position:{x:5,y:5}});assert.equal(await page.locator(`#${id}Dialog`).evaluate(d=>d.hasAttribute('open')),false);}
   }
   await page.close();
  }
 });

 await t.test('Усі вправи, збереження прогресу та сталі картки нот',async()=>{
  const page=await pageAt();await click(page,'[data-mode=learn]');
  const lessons=await page.evaluate(()=>CelloStudio.lessons);
  for(const lesson of lessons){
   await page.locator('#lessonSelect').selectOption(lesson.id);
   await page.evaluate(()=>{window.firstCard=document.querySelector('#score').firstElementChild;});
   for(const [s,f] of lesson.notes){
    if(lesson.first){const current=await state(page);if(current.string!==s)await page.locator('.string-button').nth(s).dispatchEvent('pointerdown',{pointerType:'touch',button:0});await page.locator('.finger').nth(f).click();}
    else await page.locator('.string-button').nth(s).click();
    await delay(30);
   }
   assert.equal((await state(page)).step,lesson.notes.length,lesson.id);
   assert.equal(await page.evaluate(()=>firstCard===document.querySelector('#score').firstElementChild),true);
  }
  await page.reload();assert.deepEqual((await state(page)).completed,lessons.map(l=>l.id));await page.close();
 });

 await t.test('Запізнілий запуск звуку, недоступний Web Audio та заборонене сховище',async()=>{
  const page=await pageAt(undefined,()=>{const Original=AudioContext;window.AudioContext=function(...args){const c=new Original(...args),resume=c.resume.bind(c);c.resume=()=>new Promise(resolve=>setTimeout(()=>resolve(resume()),180));return c;};});
  await page.keyboard.down('KeyQ');await page.keyboard.up('KeyQ');await delay(300);assert.equal(await voice(page),null);assert.equal((await state(page)).step,0);await page.close();
  const noAudio=await pageAt(undefined,()=>{window.AudioContext=undefined;window.webkitAudioContext=undefined;});await noAudio.locator('.string-button').first().click();await delay(35);assert.equal(await noAudio.locator('#audioError').isVisible(),true);await noAudio.close();
  const noStorage=await pageAt(undefined,()=>{Storage.prototype.getItem=()=>{throw new Error('Заборонено');};Storage.prototype.setItem=()=>{throw new Error('Заборонено');};});await initAudio(noStorage);await noStorage.close();
 });

 await t.test('Переривання дотиків і закритий AudioContext відновлюються',async()=>{
  const page=await pageAt();await initAudio(page);await page.locator('.string-button').nth(2).click();await delay(35);
  await page.evaluate(()=>CelloStudio.audio.ctx.close());await page.keyboard.press('Escape');await page.locator('.string-button').nth(2).click();await delay(50);
  assert.equal(await voice(page),50);assert.equal((await state(page)).audioState,'running');
  await page.evaluate(()=>document.querySelector('#cello').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,pointerType:'touch'})));
  assert.equal(await voice(page),null);assert.equal((await state(page)).pointerCount,0);
  await page.locator('.string-button').nth(3).click();await delay(35);assert.equal(await voice(page),57);await page.close();
 });

 await t.test('Поліфонія: піки нижчі за цифрову межу',async()=>{
  const scenarios=[{count:4,volume:1,spacing:0,warmth:.38},{count:8,volume:.75,spacing:0,warmth:.38},{count:8,volume:1,spacing:.1,warmth:.38},{count:16,volume:1,spacing:0,warmth:1},{count:8,volume:1,spacing:0,warmth:0},{count:8,volume:1,spacing:.02,warmth:1,mixed:true}];
  for(const scenario of scenarios){
   const page=await pageAt(undefined,()=>{window.AudioContext=function(){const c=new OfflineAudioContext(1,144000,48000);Object.defineProperty(c,'state',{get:()=> 'running'});window.offlineAudio=c;return c;};});
   await initAudio(page);
   const result=await page.evaluate(async scenario=>{
    const a=CelloStudio.audio;a.setVolume(scenario.volume);a.master.gain.value=scenario.volume;a.warmth=scenario.warmth;
    let at=0;Object.defineProperty(offlineAudio,'currentTime',{get:()=>at});
    for(let i=0;i<scenario.count;i++){at=i*scenario.spacing;a.pluck(scenario.mixed?[36,43,50,57][i%4]:36,1);}
    if(scenario.mixed){a.bow(55,.95,true);a.click(true);}
    const buffer=await offlineAudio.startRendering(),samples=buffer.getChannelData(0);let peak=0,invalid=0;
    for(const sample of samples){if(!Number.isFinite(sample))invalid++;peak=Math.max(peak,Math.abs(sample));}
    return {peak,invalid,voices:a.plucks.size};
   },scenario);
   assert.equal(result.invalid,0);assert.ok(result.peak<.91,JSON.stringify({scenario,result}));measurements.push({scenario,...result});await page.close();
  }
 });

 await t.test('HTML-копії однакові; HTTP-маршрут працює офлайн',async()=>{
  assert.deepEqual(fs.readFileSync(html),fs.readFileSync(siteHtml));
  const server=http.createServer((req,res)=>{if(req.url==='/cello/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(siteHtml));}else{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const page=await browser.newPage();const requests=[];page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
   const httpUrl=`http://127.0.0.1:${server.address().port}/cello/`,response=await page.goto(httpUrl);
   assert.equal(response.status(),200);assert.equal(await page.locator('#homeLink').getAttribute('href'),'/');await initAudio(page);
   assert.ok(requests.every(u=>u.startsWith(httpUrl)),'Зовнішні запити відсутні');await page.close();
  }finally{await new Promise(resolve=>server.close(resolve));}
 });
 assert.deepEqual(errors,[]);
 if(output)fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({measurements,errors},null,2));
 console.log(JSON.stringify({measurements,errors}));
});
