import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {startOrdinaryWebHost} from './ordinary-web-host.js';
import {ordinaryWebChecks} from './ordinary-web-checks.js';

// CI driver for the same checks run through CUA in the desktop session.
// No evaluate()/replacement DOM, fake provider flags, or product test routes.
export async function runOrdinaryWebBrowserChecks(){
  const {chromium}=await import('playwright');const host=await startOrdinaryWebHost();let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.ASK_KAI_BROWSER_EXECUTABLE});
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(host.url);const checks=ordinaryWebChecks({page,reload:()=>page.reload(),control:host.control});
    const cases=await checks.run();await checks.finish();
    const report={version:1,driver:'playwright_chromium',ordinary_web:true,unmodified_web_module:true,synthetic_provider:true,synthetic_planner:true,real_provider:false,microphone:false,cases,page_errors:errors.length,passed:cases.length===checks.ids.length&&cases.every(item=>item.passed)&&!errors.length};
    await mkdir('.local/voice-slides-control',{recursive:true,mode:0o700});await writeFile('.local/voice-slides-control/ordinary-web-chromium-report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});return report;
  }finally{await browser?.close();await host.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const report=await runOrdinaryWebBrowserChecks();console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;}
