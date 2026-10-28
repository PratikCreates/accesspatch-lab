const {chromium} = require('playwright');
const fs = require('fs');
(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const options = {headless:true, args:['--disable-background-networking','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']};
  if (process.env.ACCESSPATCH_BROWSER) options.executablePath = process.env.ACCESSPATCH_BROWSER;
  const browser = await chromium.launch(options);
  try {
    const context = await browser.newContext({javaScriptEnabled:input.mode === 'local', serviceWorkers:'block', acceptDownloads:false});
    await context.route('**/*', route => route.abort());
    if (typeof context.routeWebSocket !== 'function') throw new Error('This Playwright version cannot intercept WebSockets; refusing to run the page.');
    await context.routeWebSocket('**/*', socket => socket.close());
    // Defense in depth only: browser JavaScript is not a security boundary.
    await context.addInitScript(() => {
      for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
        try { Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false }); }
        catch { try { globalThis[name] = undefined; } catch {} }
      }
    });
    const page = await context.newPage();
    await page.setContent(input.source, {waitUntil:'load', timeout:10000});
    if (input.mode === 'local') {
      const checks = await page.evaluate(() => {
        const images = [...document.querySelectorAll('img')];
        const inputs = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')];
        const missingAlt = images.filter(e => !e.hasAttribute('alt'));
        const missingLabel = inputs.filter(e => {const ref=(e.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean); return !(e.labels && [...e.labels].some(l => l.textContent.trim())) && !(e.getAttribute('aria-label') || '').trim() && !ref.some(id => document.getElementById(id)?.textContent.trim());});
        return [
          {id:'image_alt', title:'Images have alt attributes', status:missingAlt.length?'fail':'pass',detail:`${missingAlt.length} of ${images.length} images lack alt attributes. Alt quality requires human review.`,source:'browser'},
          {id:'input_label', title:'Inputs have a labeling mechanism', status:missingLabel.length?'fail':'pass',detail:`${missingLabel.length} of ${inputs.length} controls lack nonempty label text, aria-label, or a resolvable aria-labelledby. Label quality needs human review.`,source:'browser'}
        ];
      });
      const keyboard=[];
      for (const [index,key] of input.journey.entries()) {
        await page.keyboard.press(key);
        const active=await page.evaluate(() => {let e=document.activeElement, labels=e.labels;return {target:e.id || e.getAttribute('name') || e.tagName.toLowerCase(),role:e.getAttribute('role') || e.tagName.toLowerCase(),name:(e.getAttribute('aria-label') || (labels && labels.length ? labels[0].textContent : '') || (['BUTTON','A'].includes(e.tagName) ? e.textContent : '')).trim().slice(0,200)};});
        keyboard.push({step:index+1,key,...active,source:'browser'});
      }
      const passed=checks.filter(x=>x.status==='pass').length;
      process.stdout.write(JSON.stringify({checks,keyboard,summary:{passed,total:checks.length}})); return;
    }
    const checks = await page.evaluate(() => {
      const image = document.querySelector('#garden-image');
      const email = document.querySelector('#email');
      const submit = document.querySelector('#submit');
      return [
        {id:'image_alt',title:'Image has an alt attribute',status:image && image.hasAttribute('alt')?'pass':'fail',detail:image && image.hasAttribute('alt') ? 'Image has an alt attribute; its meaning still needs human review.' : 'The image has no alt attribute.',source:'browser'},
        {id:'email_label',title:'Email input has an associated label',status:email && email.labels && email.labels.length?'pass':'fail',detail:email && email.labels && email.labels.length ? `Associated label: ${email.labels[0].textContent.trim()}` : 'The email input has no programmatically associated label.',source:'browser'},
        {id:'submit_semantics',title:'Sign-up control is a native button',status:submit && submit.tagName==='BUTTON'?'pass':'fail',detail:submit && submit.tagName==='BUTTON' ? 'The control is a native button.' : 'The sign-up control is not a native button.',source:'browser'}
      ];
    });
    const keyboard=[];
    for(let i=0;i<4;i++){
      await page.keyboard.press('Tab');
      const active=await page.evaluate(() => {let e=document.activeElement;let labels=e.labels;return {target:e.id || e.tagName.toLowerCase(),role:e.tagName.toLowerCase(),name:(e.getAttribute('aria-label') || (labels && labels.length ? labels[0].textContent : '') || (e.tagName==='BUTTON' ? e.textContent : '')).trim()};});
      keyboard.push({step:i+1,...active,source:'browser'});
    }
    const passed=checks.filter(x=>x.status==='pass').length;
    process.stdout.write(JSON.stringify({checks,keyboard,summary:{passed,total:checks.length}}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e.message);process.exit(1)});
