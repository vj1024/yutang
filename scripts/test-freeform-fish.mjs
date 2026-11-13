import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';

const server = await createServer({server:{host:'127.0.0.1', port:0, strictPort:false}, logLevel:'error'});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || undefined});
  const page = await browser.newPage({viewport:{width:1100,height:880}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await page.goto(server.resolvedUrls.local[0]);
  const button = name => page.getByRole('button', {name, exact:true});
  await button('画锦鲤').click();
  await button('自由鱼形').click();
  assert.ok(await button('放入池塘').isDisabled());
  const board = page.getByLabel('自由鱼形画布');
  async function stroke(points) {
    const rect = await board.boundingBox();
    for (const [i, [x,y]] of points.entries()) {
      await page.mouse.move(rect.x + rect.width * x / 640, rect.y + rect.height * y / 320);
      if (i === 0) await page.mouse.down();
    }
    await page.mouse.up();
  }
  await stroke([[104,68],[151,83],[191,113],[229,135],[250,122],[279,98],[311,78],
    [350,59],[337,89],[348,100],[387,97],[417,102],[444,113],[469,132],[486,151],
    [488,161],[480,172],[453,182],[415,191],[371,195],[347,208],[319,233],[313,208],
    [296,189],[269,184],[234,164],[205,170],[176,199],[139,224],[108,235],[128,201],
    [143,171],[160,150],[137,128],[118,101],[104,68]]);
  await button('画花纹').click();
  await button('颜料 #fff6df').click();
  await stroke([[286,124],[294,134],[301,147],[308,164]]);
  await stroke([[324,115],[337,125],[345,140],[347,158],[353,173]]);
  await button('颜料 #203b38').click();
  await stroke([[455,147]]);
  await button('橡皮').click();
  await stroke([[393,132]]);
  assert.equal(await board.evaluate(c => c.getContext('2d').getImageData(393,132,1,1).data[3]), 0);
  const ink = await board.evaluate(c => c.toDataURL());
  await button('清空自由画布').click();
  assert.ok(await button('放入池塘').isDisabled());
  await button('撤销自由绘画').click();
  assert.equal(await board.evaluate(c => c.toDataURL()), ink);
  await button('定鱼头').click();
  await stroke([[150,160],[470,150]]);
  await button('试游').click();
  assert.ok(await board.isHidden());
  const preview = page.getByLabel('自由鱼形试游预览');
  const frame = await preview.evaluate(c => c.toDataURL());
  await page.waitForFunction(before => document.querySelector('canvas[aria-label="自由鱼形试游预览"]').toDataURL() !== before, frame);
  await page.getByLabel('自由鱼名字').fill('月牙叉尾');
  await button('放入池塘').click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fusheng-fish'))[0]);
  assert.equal(saved.appearance, 'freeform-v1');

  await page.reload();
  await page.waitForSelector('.pond-canvas');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(r => r.name).findLast(u => u.includes('/src/engine/pond.js'));
    const {PondEngine} = await import(url);
    const original = PondEngine.prototype.drawFish;
    PondEngine.prototype.drawFish = function(fish, shadow) {
      original.call(this, fish, shadow);
      if (!shadow && fish.custom && this.images.get(fish.custom.texture)?.freeform) window.drawnFish = fish;
    };
  });
  await page.waitForFunction(() => window.drawnFish?.drawnMouth);
  const start = await page.evaluate(() => ({x:window.drawnFish.x,y:window.drawnFish.y,phase:window.drawnFish.phase}));
  await page.waitForFunction(p => window.drawnFish.phase > p.phase && Math.hypot(window.drawnFish.x-p.x, window.drawnFish.y-p.y) > 1, start);
  await button('画锦鲤').click();
  await page.getByRole('button',{name:/我的锦鲤/}).click();
  await page.waitForFunction(() => document.querySelector('.koi-thumbnail')?.getContext('2d').getImageData(0,0,1280,640).data.some((v,i) => i % 4 === 3 && v > 0));
  await page.getByRole('slider',{name:'月牙叉尾的大小'}).press('ArrowRight');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('fusheng-fish'))[0].size), 1.05);
  await button('移走月牙叉尾').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('fusheng-fish')).length), 0);
  assert.deepEqual(errors, []);
  console.log('Freeform fish drawing, preview, pond reload, resizing and removal passed.');
} finally {
  await browser?.close();
  await server.close();
}
