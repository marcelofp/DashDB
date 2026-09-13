import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
const url=process.env.LIVE_URL ?? 'http://127.0.0.1:8088/';
const evidencePrefix=process.env.EVIDENCE_PREFIX ?? 'live';
const endpoint=path=>new URL(path,url).href;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const page=await context.newPage();
const errors=[];
const expectedNetworkErrors=[];
let testingRecovery=false;
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error') {
 if(testingRecovery && /ERR_CONNECTION|ERR_EMPTY_RESPONSE|ERR_NETWORK|Failed to load resource/.test(m.text())) expectedNetworkErrors.push(m.text());
 else errors.push(m.text());
}});
const evidence={url,startedAt:new Date().toISOString(),checks:[]};
try {
 await page.goto(url,{waitUntil:'networkidle'});
 await page.waitForSelector('[data-collector="available"]',{timeout:20000});
 const id=await page.locator('[data-sample]').getAttribute('data-sample');
 await page.waitForFunction(id=>document.querySelector('[data-sample]')?.getAttribute('data-sample')!==id,id,{timeout:8000});
 if((await page.locator('body').innerText()).includes('DADOS SIMULADOS'))throw Error('Unexpected mock data');
 const sample=await (await context.request.get(endpoint('/api/snapshot'))).json();
 evidence.sample={...sample,history:sample.history.length,queries:sample.queries.length,alerts:sample.alerts.length};
 evidence.checks.push('Live sample updates without reload; source=db2; no simulated badge');
 for(const size of [{width:1920,height:1080},{width:3840,height:2160}]) {
  await page.setViewportSize(size);
  await page.waitForTimeout(1200);
  const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
  if(dimensions.scrollWidth>size.width || dimensions.scrollHeight>size.height)throw Error('Live dashboard overflow '+JSON.stringify(dimensions));
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('main section[class*="_panel_"]')].flatMap(panel=>{
   const box=panel.getBoundingClientRect();
   return [...panel.children].filter(child=>getComputedStyle(child).position!=='absolute' && child.getBoundingClientRect().bottom>box.bottom+1).map(child=>({panel:panel.querySelector('h2')?.textContent,child:child.tagName,bottom:child.getBoundingClientRect().bottom,limit:box.bottom}));
  }));
  if(overflow.length)throw Error('Panel content overflow '+JSON.stringify(overflow));
  const path=`evidence/${evidencePrefix}-${size.width}.png`;
  await page.screenshot({path,fullPage:true});
  evidence.checks.push({viewport:size,dimensions,screenshot:path});
 }
 const stream=page.locator('[data-session-flow]:not([data-particles="0"])').first();
 if(await stream.count()) {
  const position=()=>stream.locator('[data-particle] circle').first().evaluate(n=>{const m=n.getCTM();return [m.e,m.f];});
  const before=await position();
  await page.waitForTimeout(600);
  const after=await position();
  if(JSON.stringify(before)===JSON.stringify(after))throw Error('Active session flow is not moving');
  const indicators=await page.locator('[data-session-motion]').count();
  if(!indicators)throw Error('Active session indicators missing');
  evidence.checks.push({activeSessionStreams:'moving',before,after,animatedSessionRows:indicators});
 }
 const page2=await context.newPage();
 const fallbackUrl=new URL(url);fallbackUrl.searchParams.set('webgl','0');
 await page2.goto(fallbackUrl.href,{waitUntil:'domcontentloaded'});
 await page2.waitForSelector('[data-collector="available"]',{timeout:15000});
 const health=await (await context.request.get(endpoint('/api/health'))).json();
 if(health.subscribers<2)throw Error('SSE second client not subscribed');
 evidence.checks.push({concurrentSseClients:health.subscribers});
 await page2.close();
 if(process.env.LIVE_RECOVERY_TEST==='1') {
  testingRecovery=true;
  console.log('READY_FOR_COLLECTOR_RESTART');
  const restart=process.env.LIVE_RESTART_HELPER ? execute(process.env.LIVE_RESTART_HELPER,[],{timeout:60000}).then(()=>null,error=>error) : Promise.resolve(null);
  await page.waitForSelector('[data-collector="unavailable"]',{timeout:45000});
  if((await page.getByTestId('connections').innerText()).trim()!=='—')throw Error('Old metric displayed during outage');
  evidence.checks.push('Stopped collector clears current metrics');
  await page.waitForSelector('[data-collector="available"]',{timeout:30000});
  evidence.checks.push('SSE reconnects automatically after collector restart');
  const restartError=await restart;
  if(restartError)throw restartError;
 }
 evidence.expectedNetworkErrors=expectedNetworkErrors;
 evidence.errors=errors;
 if(errors.length)throw Error(errors.join('\n'));
 evidence.finishedAt=new Date().toISOString();
 console.log(JSON.stringify({checks:evidence.checks,errors},null,2));
} finally {
 evidence.errors=errors;
 await writeFile(`evidence/${evidencePrefix}-browser-validation.json`,JSON.stringify(evidence,null,2)+'\n');
 await browser.close();
}
