import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import JSZip from 'jszip';

let browser, server, base;
const root = resolve(import.meta.dirname, '..');
const triangle = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n';
const multi = 'mtllib mats/model.mtl\no shared\nv 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nvt 1 1\nusemtl red\nf 1/1 2/2 3/3\nusemtl blue\nf 2/2 4/4 3/3\n';

before(async () => {
    await mkdir(resolve(root, '.work'), { recursive: true });
    server = createServer(async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await readFile(resolve(root, 'index.html')));
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
});

after(async () => {
    await browser?.close();
    await new Promise(done => server?.close(done));
});

async function open(t, viewport = { width: 900, height: 700 }, url = base) {
    const page = await browser.newPage({ viewport });
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    // 使用同版本官方依赖，隔离 CDN 网络波动；不替换加载器或渲染器。
    await page.route('https://**/*', async route => {
        const url = route.request().url();
        const prefix = 'https://cdn.jsdelivr.net/npm/three@0.163.0/';
        let file;
        if (url.startsWith(prefix)) file = resolve(root, 'node_modules/three', url.slice(prefix.length));
        else if (url.includes('jszip')) file = resolve(root, 'node_modules/jszip/dist/jszip.min.js');
        else throw new Error(`Unexpected request: ${url}`);
        await route.fulfill({ body: await readFile(file), contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.goto(url);
    await page.waitForFunction(() => !!window.web3d);
    return page;
}

async function upload(page, files, select) {
    const zip = new JSZip();
    for (const [name, value] of Object.entries(files)) zip.file(name, value);
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await page.locator('#zip-input').setInputFiles({ name: 'model.zip', mimeType: 'application/zip', buffer });
    if (select) {
        await page.getByLabel('OBJ 模型').selectOption(select);
        await page.getByText('打开模型', { exact: true }).click();
    }
    await page.waitForFunction(() => !window.web3d.getDiagnostics().loading);
    return page.locator('#status-text').textContent();
}

const diagnostics = page => page.evaluate(() => window.web3d.getDiagnostics());
async function png(page) {
    return Buffer.from(await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 4;
        const context = canvas.getContext('2d');
        context.fillStyle = '#ff0000'; context.fillRect(0, 0, 4, 4);
        return canvas.toDataURL().split(',')[1];
    }), 'base64');
}

test('同一对象的两个材质分组保留独立颜色', async t => {
    const page = await open(t);
    const status = await upload(page, { 'model.obj': multi, 'mats/model.mtl': 'newmtl red\nKd 1 0 0\nnewmtl blue\nKd 0 0 1\n' });
    assert.match(status, /2 材质/);
    const { meshes } = await diagnostics(page);
    assert.equal(meshes.length, 1);
    assert.deepEqual(meshes[0].groups.map(g => g.materialIndex), [0, 1]);
    assert.deepEqual(meshes[0].materials.map(m => m.name), ['red', 'blue']);
    assert.deepEqual(meshes[0].materials.map(m => m.color), [0xff0000, 0x0000ff]);
});

test('纹理相对路径、同源色彩空间、UV 参数和 specularMap', async t => {
    const page = await open(t);
    const image = await png(page);
    const status = await upload(page, {
        'model.obj': multi,
        'mats/model.mtl': 'newmtl red\nmap_Kd -s 2 3 1 -o 0.2 0.3 0 ../a/diffuse.png\nmap_bump -bm 0.1 ../a/diffuse.png\nmap_Ks ../a/diffuse.png\nnewmtl blue\nmap_Kd ../b/diffuse.png\n',
        'a/diffuse.png': image, 'b/diffuse.png': image,
        'unused.png': 'invalid image',
    });
    assert.match(status, /2 张贴图/);
    const d = await diagnostics(page);
    const [red, blue] = d.meshes[0].materials;
    assert.deepEqual(red.maps.map.repeat, [2, 3]);
    assert.deepEqual(red.maps.map.offset, [0.2, 0.3]);
    assert.equal(red.maps.map.colorSpace, 'srgb');
    assert.equal(red.maps.bumpMap.colorSpace, '');
    assert.equal(red.maps.map.source, red.maps.bumpMap.source);
    assert.notEqual(red.maps.map.source, blue.maps.map.source);
    assert.ok(red.maps.specularMap);
    assert.equal(d.blobUrls, 2);
});

test('纹理歧义和损坏图片失败时保留旧模型并清理资源', async t => {
    const page = await open(t);
    await upload(page, { 'good.obj': triangle });
    const baseline = await diagnostics(page);
    const obj = 'mtllib model.mtl\nusemtl red\n' + triangle;
    let status = await upload(page, { 'bad.obj': obj, 'model.mtl': 'newmtl red\nmap_Kd diffuse.png', 'a/diffuse.png': 'bad', 'b/diffuse.png': 'bad' });
    assert.match(status, /歧义/);
    status = await upload(page, { 'bad.obj': obj, 'model.mtl': 'newmtl red\nmap_Kd corrupt.png', 'corrupt.png': 'bad' });
    assert.match(status, /贴图解码失败：corrupt.png/);
    assert.ok(await page.locator('#status .dot.error').count());
    const d = await diagnostics(page);
    assert.deepEqual(d.meshes, baseline.meshes);
    assert.equal(d.blobUrls, 0);
    assert.match(await page.locator('#file-name').textContent(), /good.obj/);
});

test('多 OBJ 可选择，多个 mtllib 按声明加载', async t => {
    const page = await open(t);
    const status = await upload(page, {
        'a.obj': triangle,
        'b.obj': multi.replace('mtllib mats/model.mtl', 'mtllib red.mtl\nmtllib blue.mtl'),
        'red.mtl': 'newmtl red\nKd 1 0 0', 'blue.mtl': 'newmtl blue\nKd 0 0 1',
    }, 'b.obj');
    assert.match(status, /2 材质/);
    assert.match(await page.locator('#file-name').textContent(), /b.obj/);
});

test('静止停止调度，旋转恢复，连续加载资源计数稳定', async t => {
    const page = await open(t);
    const image = await png(page);
    const files = { 'model.obj': 'mtllib model.mtl\nusemtl red\n' + triangle, 'model.mtl': 'newmtl red\nmap_Kd texture.png', 'texture.png': image };
    await upload(page, files);
    await page.waitForFunction(() => !window.web3d.getDiagnostics().scheduled);
    const baseline = await diagnostics(page);
    await page.waitForTimeout(250);
    assert.equal((await diagnostics(page)).frame, baseline.frame);
    await page.locator('#btn-auto').click();
    await page.waitForTimeout(150);
    assert.ok((await diagnostics(page)).frame > baseline.frame);
    await page.locator('#btn-auto').click();
    for (let i = 0; i < 8; i++) await upload(page, files);
    await page.waitForFunction(() => !window.web3d.getDiagnostics().scheduled);
    const d = await diagnostics(page);
    assert.deepEqual(d.memory, baseline.memory);
    assert.equal(d.blobUrls, 1);
    t.diagnostic(JSON.stringify({ baseline: baseline.memory, afterEightLoads: d.memory, idleFrameDelta: 0 }));
});

test('竖屏、小尺度模型相机有效；截图导出 PNG', async t => {
    const page = await open(t, { width: 320, height: 800 });
    await upload(page, { 'small.obj': triangle.replace('v 1 0 0', 'v 0.001 0 0').replace('v 0 1 0', 'v 0 0.001 0') });
    const d = await diagnostics(page);
    assert.ok(d.camera.near > 0 && d.camera.near < 0.00001);
    assert.ok(d.camera.position.every(Number.isFinite));
    const downloaded = page.waitForEvent('download');
    await page.locator('#btn-shot').click();
    const download = await downloaded;
    const buffer = await readFile(await download.path());
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(buffer.length > 1000);
    const image = await page.evaluate(async encoded => {
        const blob = await (await fetch('data:image/png;base64,' + encoded)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const pixels = new Uint32Array(rgba.buffer);
        const background = pixels[0];
        let opaque = 0, foreground = 0;
        for (let i = 0; i < pixels.length; i++) {
            if (rgba[i * 4 + 3] === 255) opaque++;
            if (pixels[i] !== background) foreground++;
        }
        const result = { width: bitmap.width, height: bitmap.height, colors: new Set(pixels).size, opaque, foreground };
        bitmap.close();
        return result;
    }, buffer.toString('base64'));
    assert.equal(image.width, 320);
    assert.equal(image.height, 800);
    t.diagnostic(JSON.stringify(image));
    assert.equal(image.opaque, 320 * 800);
    assert.ok(image.colors > 1 && image.foreground > 100, '截图应包含实际模型或网格像素');
});

test('取消模型选择后可以继续加载；缺失材质不会套用其他材质', async t => {
    const page = await open(t);
    const zip = new JSZip();
    zip.file('a.obj', triangle); zip.file('b.obj', triangle);
    await page.locator('#zip-input').setInputFiles({ name: 'multiple.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
    await page.getByText('取消', { exact: true }).click();
    await page.waitForFunction(() => !window.web3d.getDiagnostics().loading);
    assert.match(await page.locator('#status-text').textContent(), /已取消/);
    await upload(page, { 'model.obj': multi, 'mats/model.mtl': 'newmtl\tred\nKd\t1 0 0\n' });
    const materials = (await diagnostics(page)).meshes[0].materials;
    assert.deepEqual(materials.map(m => m.name), ['red', 'blue']);
    assert.deepEqual(materials.map(m => m.color), [0xff0000, 0xffffff]);
});

test('解压时拒绝超过单文件预算的 OBJ', async t => {
    const page = await open(t);
    const status = await upload(page, { 'large.obj': '#'.repeat(128 * 1024 * 1024 + 1) });
    assert.match(status, /解压资源超限/);
    assert.equal((await diagnostics(page)).blobUrls, 0);
});

function manyFaces(count) {
    const side = Math.ceil(Math.sqrt(count / 2));
    const lines = [];
    for (let y = 0; y <= side; y++) {
        for (let x = 0; x <= side; x++) lines.push(`v ${x} ${y} 0`);
    }
    let faces = 0;
    for (let y = 0; y < side && faces < count; y++) {
        for (let x = 0; x < side && faces < count; x++) {
            const a = y * (side + 1) + x + 1;
            const b = a + 1, c = a + side + 1, d = c + 1;
            lines.push(`f ${a} ${b} ${c}`); faces++;
            if (faces < count) { lines.push(`f ${b} ${d} ${c}`); faces++; }
        }
    }
    return lines.join('\n');
}

test('30 万面在 Worker 解析，主线程定时器继续执行', async t => {
    const page = await open(t);
    await page.evaluate(() => {
        window.workerTicks = 0;
        window.tickTimer = setInterval(() => {
            if (window.web3d.getDiagnostics().lastParse?.state === 'parsing') window.workerTicks++;
        }, 10);
    });
    const status = await upload(page, { 'large.obj': manyFaces(300000) });
    assert.match(status, /0 材质/);
    const ticks = await page.evaluate(() => { clearInterval(window.tickTimer); return window.workerTicks; });
    const d = await diagnostics(page);
    assert.equal(d.lastParse.state, 'complete');
    assert.equal(d.lastParse.vertices, 900000);
    assert.equal(d.lastParse.geometryBytes, 900000 * 6 * 4);
    assert.equal(d.workerRunning, false);
    assert.ok(ticks > 0, '解析期间主线程应能运行定时器');
    assert.equal(await page.locator('#tri-count').textContent(), '300,000');
    t.diagnostic(JSON.stringify({ ticksDuringParsing: ticks, ...d.lastParse }));
});

test('解析期间取消会终止 Worker，保留旧模型并允许再次加载', async t => {
    const page = await open(t);
    await upload(page, { 'old.obj': triangle });
    await page.waitForFunction(() => !window.web3d.getDiagnostics().scheduled);
    const previous = await diagnostics(page);
    const zip = new JSZip();
    zip.file('large.obj', manyFaces(900000));
    await page.locator('#zip-input').setInputFiles({ name: 'large.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) });
    await page.waitForFunction(() => window.web3d.getDiagnostics().lastParse?.state === 'parsing');
    const start = Date.now();
    await page.locator('#btn-cancel').click();
    await page.waitForFunction(() => !window.web3d.getDiagnostics().loading);
    const d = await diagnostics(page);
    assert.equal(d.lastParse.state, 'cancelled');
    assert.equal(d.workerRunning, false);
    assert.deepEqual(d.meshes, previous.meshes);
    assert.deepEqual(d.memory, previous.memory);
    assert.equal(d.blobUrls, 0);
    assert.match(await page.locator('#file-name').textContent(), /old.obj/);
    assert.match(await page.locator('#status-text').textContent(), /已取消/);
    t.diagnostic(`Cancellation settled in ${Date.now() - start} ms`);
    assert.match(await upload(page, { 'next.obj': triangle }), /0 材质/);
});

test('Worker 拒绝对象数超限及无效坐标，之后可恢复', async t => {
    const page = await open(t);
    const objects = 'v 0 0 0\nv 1 0 0\nv 0 1 0\n' + Array.from({ length: 10001 }, (_, i) => `o part${i}\nf 1 2 3\n`).join('');
    assert.match(await upload(page, { 'objects.obj': objects }), /几何体超限/);
    assert.equal((await diagnostics(page)).workerRunning, false);
    assert.match(await upload(page, { 'invalid.obj': 'v NaN 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3' }), /无效/);
    assert.match(await upload(page, { 'valid.obj': triangle }), /0 材质/);
});

test('解压过程中取消释放任务并保留旧模型', async t => {
    const page = await open(t);
    await upload(page, { 'old.obj': triangle });
    const zip = new JSZip();
    zip.file('large.obj', '#'.repeat(64 * 1024 * 1024));
    await page.locator('#zip-input').setInputFiles({ name: 'large.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) });
    await page.locator('#btn-cancel').click();
    await page.waitForFunction(() => !window.web3d.getDiagnostics().loading);
    assert.match(await page.locator('#status-text').textContent(), /已取消/);
    assert.match(await page.locator('#file-name').textContent(), /old.obj/);
    assert.equal((await diagnostics(page)).workerRunning, false);
    assert.match(await upload(page, { 'next.obj': triangle }), /0 材质/);
});

test('本地单 HTML 使用内嵌 Worker；保留线、点、顶点颜色和平滑状态', async t => {
    const page = await open(t, undefined, pathToFileURL(resolve(root, 'index.html')).href);
    const obj = 'v 0 0 0 1 0 0\nv 1 0 0 0 1 0\nv 0 1 0 0 0 1\no face\ns off\nf 1 2 3\no line\nl 1 2\no points\np 3\n';
    assert.match(await upload(page, { 'primitives.obj': obj }), /0 材质/);
    const d = await diagnostics(page);
    assert.equal(d.lastParse.state, 'complete');
    assert.deepEqual(d.primitives.map(item => item.type), ['Mesh', 'LineSegments', 'Points']);
    assert.deepEqual(d.primitives.map(item => item.vertices), [3, 2, 1]);
    assert.equal(d.meshes[0].materials[0].flatShading, true);
    assert.equal(d.meshes[0].materials[0].vertexColors, true);
});
