import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = process.env.ASHA_TEST_BASE || "http://127.0.0.1:4180/";
const browser = await chromium.launch({headless:true, executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"});
const page = await browser.newPage({viewport:{width:390,height:844}, reducedMotion:"reduce"});
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const profile = {patientId:"0123456789abcdef01234567",label:"UI fixture",assessment:{eyes:"reliable",head:"reliable",canSee:true,canHear:true},recommendation:{primary:"facespeak"},voice:{name:"",rate:.9}};
try {
  // Exercise local sensing screens without creating production care records.
  await page.route("**/api/session**", route => route.fulfill({json:route.request().method()==="POST" ? {...profile, patientToken:"ui-patient",caregiverToken:"ui-care"} : {profile,events:[]}}));
  await page.route("**/api/health", route => route.fulfill({json:{cloudConfigured:true,caregiverConfigured:true}}));
  await page.goto(base + "?module=vitalsense");
  await page.locator("#details:not([hidden])").waitFor();
  await page.getByRole("heading",{name:"VitalSense",exact:true}).waitFor();
  await page.getByRole("button",{name:"Calibrate 30 seconds",exact:true}).waitFor();
  assert.equal(await page.locator("#pulseValue").innerText(),"—");
  assert.equal(await page.locator("#vsBaseline").innerText(),"Not calibrated");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
  await fs.mkdir("artifacts/release",{recursive:true});
  for (const theme of ["light","dark"]) {
    const current = await page.locator("html").getAttribute("data-theme");
    if (current!==theme) await page.locator("#themeButton").click();
    await page.locator(".vitals-studio").screenshot({path:`artifacts/release/vitals-${theme}-mobile.png`});
  }
  // Recovered observations render as observations; pause immediately clears all
  // live numbers while the session history remains available.
  await page.evaluate(async () => {
    const {paintVitals} = await import("/app/vitals-studio.js");
    const pulse={bpm:78,quality:.9,confidence:90,status:"good",windowSeconds:12,requiredSeconds:12,sampleFps:30,roiCount:3,breathingBpm:15,reason:"Fixture signal",signal:[0,1,0,-1,0,1],hrv:{rmssd:null,beats:8,meanIbi:null,reason:"Timing not sufficient"},baseline:{bpm:76,progress:1,calibrating:false},trend:[{t:12000,bpm:78},{t:16000,bpm:79}],readings:[{t:12000,bpm:78,quality:.9}]};
    paintVitals(pulse,true);
    window.vitalsUiPause=()=>paintVitals(pulse,false);
  });
  assert.equal(await page.locator("#pulseValue").innerText(),"78");
  assert.equal(await page.locator("#vsBreathing").innerText(),"15");
  assert.equal(await page.locator("#vsCompared").innerText(),"+2 bpm");
  assert.match(await page.locator("#vsSampling").innerText(),/3 \/ 3 skin regions/);
  await page.evaluate(()=>window.vitalsUiPause());
  assert.equal(await page.locator("#pulseValue").innerText(),"—");
  assert.equal(await page.locator("#vsBreathing").innerText(),"—");
  assert.equal(await page.locator("#vsStatus").innerText(),"Camera paused");
  assert.match(await page.locator("#vsLog").innerText(),/78 bpm/);
  await page.locator('#moduleTabs [data-module="senseassist"]').click();
  await page.getByRole("heading",{name:"SenseAssist",exact:true}).waitFor();
  await page.locator('#moduleTabs [data-module="vitalsense"]').click();
  await page.getByRole("heading",{name:"VitalSense",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
  await page.evaluate(() => localStorage.removeItem("asha_live_patient"));
  await page.goto(base);
  await page.locator("#hero-title").waitFor();
  if (await page.locator("html").getAttribute("data-theme")!=="light") await page.locator("#themeButton").click();
  await page.screenshot({path:"artifacts/release/homepage-light-mobile.png"});
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:"artifacts/release/homepage-light-desktop.png"});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({mobileThemes:true,fullVitalSense:true,liveValuesClearOnPause:true,sessionHistoryRetained:true,moduleNavigation:true,errors}));
} finally {await browser.close();}
