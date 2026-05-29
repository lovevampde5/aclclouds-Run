import { chromium } from 'playwright';

const EMAIL     = process.env.ACL_EMAIL;
const PASSWORD  = process.env.ACL_PASSWORD;
const SERVER_ID = process.env.ACL_SERVER_ID;
const TG_TOKEN  = process.env.TG_BOT_TOKEN;
const TG_CHAT   = process.env.TG_CHAT_ID;
const PROXY_SRV = 'socks5://127.0.0.1:1080';
const BASE_URL  = 'https://dash.aclclouds.com';

async function tgNotify(msg) {
  if (!TG_TOKEN || !TG_CHAT) { console.log('[TG] 未配置，跳过'); return; }
  try {
    const res = await fetch('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
    });
    const d = await res.json();
    console.log(d.ok ? '[TG] 已发送' : '[TG] 失败: ' + d.description);
  } catch (e) { console.error('[TG] 异常:', e.message); }
}

function parseHours(text) {
  const t = text || '';
  const days  = parseInt((t.match(/(\d+)\s*[jd](?!\w)/) || [])[1] || '0', 10);
  const hours = parseInt((t.match(/(\d+)\s*h/)           || [])[1] || '0', 10);
  const mins  = parseInt((t.match(/(\d+)\s*min/)         || [])[1] || '0', 10);
  return days * 24 + hours + mins / 60;
}

function extractTimeStr(raw) {
  let m = raw.match(/\d+\s*[jd]\s*\d+\s*h\s*\d+\s*min/);
  if (m) return m[0];
  m = raw.match(/\d+\s*h\s*\d+\s*min/);
  if (m) return m[0];
  return raw.trim();
}

async function saveScreenshot(page, name) {
  try {
    await page.screenshot({ path: name, fullPage: true });
    console.log('[截图] 已保存:', name);
  } catch (e) { console.log('[截图] 失败:', e.message); }
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 从页面提取剩余时间文字（只看精确的时间容器，不读整个 body）
async function findTimeText(page) {
  return await page.evaluate(() => {
    const keywords = ['Time remaining', 'Temps restant'];
    // 只找直接包含关键词且子元素少的小容器
    const allEls = Array.from(document.querySelectorAll('p, span, div, h1, h2, h3, h4'));
    for (const el of allEls) {
      // 跳过含大量子元素的容器（排除 body、大 div 等）
      if (el.children.length > 3) continue;
      const text = (el.textContent || '').trim();
      for (const kw of keywords) {
        if (text.startsWith(kw) && text.match(/\d+\s*[hjd]/)) {
          return text;
        }
      }
    }
    return null;
  });
}

(async () => {
  console.log('[代理]', PROXY_SRV);
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      proxy: { server: PROXY_SRV },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    });

    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
    });

    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);

    // ── Step 1: 登录页 + CSRF ──
    console.log('[1] 打开登录页...');
    await page.goto(BASE_URL + '/auth/login', { waitUntil: 'networkidle', timeout: 60000 });
    await saveScreenshot(page, 'debug-login.png');

    const csrfToken = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="csrf-token"]');
      if (meta) return meta.getAttribute('content');
      const input = document.querySelector('input[name="_token"]');
      if (input) return input.value;
      const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
      if (match) return decodeURIComponent(match[1]);
      return null;
    });
    console.log('[CSRF] token:', csrfToken ? csrfToken.slice(0, 20) + '...' : 'not found');
    if (!csrfToken) throw new Error('无法获取 CSRF token');

    // ── Step 2 & 3: 填邮箱密码 ──
    console.log('[2] 填写邮箱密码...');
    await page.waitForSelector('#username', { timeout: 30000 });
    await page.locator('#username').click();
    await page.keyboard.type(EMAIL, { delay: randInt(50, 120) });
    await page.locator('#password').click();
    await page.keyboard.type(PASSWORD, { delay: randInt(50, 120) });

    // ── Step 4: 模拟鼠标 + captcha ──
    console.log('[4] 模拟鼠标 + captcha...');
    await page.mouse.move(400, 300);
    await page.waitForTimeout(randInt(200, 400));
    await page.mouse.move(320, 370, { steps: 8 });
    await page.waitForTimeout(randInt(200, 400));
    await page.mouse.move(320, 595, { steps: 12 });
    await page.waitForTimeout(randInt(500, 1000));

    const captchaResult = await page.evaluate(async (opts) => {
      try {
        const r = await fetch('/auth/captcha', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': opts.csrf, 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'include',
          body: JSON.stringify({ mouse_movements: opts.movements, mouse_distance: opts.distance, clicks: opts.clicks, key_presses: opts.keys, elapsed_ms: opts.elapsed }),
        });
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return { error: 'not-json', status: r.status };
        return await r.json();
      } catch (e) { return { error: e.message }; }
    }, { csrf: csrfToken, movements: randInt(25, 60), distance: randInt(400, 900), clicks: 1, keys: EMAIL.length + PASSWORD.length, elapsed: randInt(5000, 9000) });

    console.log('[Captcha]', JSON.stringify(captchaResult));
    if (captchaResult.error) throw new Error('captcha 异常: ' + JSON.stringify(captchaResult));

    // ── Step 5: 登录 ──
    console.log('[5] POST /auth/login...');
    const loginResult = await page.evaluate(async (opts) => {
      try {
        const r = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': opts.csrf, 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'include',
          body: JSON.stringify({ user: opts.email, password: opts.password, captcha_token: opts.token, captcha_answer: opts.answer }),
        });
        const ct = r.headers.get('content-type') || '';
        const body = ct.includes('application/json') ? await r.json() : await r.text();
        return { status: r.status, body };
      } catch (e) { return { error: e.message }; }
    }, { csrf: csrfToken, email: EMAIL, password: PASSWORD, token: captchaResult.token || '', answer: captchaResult.answer || '' });

    console.log('[登录] status:', loginResult.status);
    if (loginResult.error) throw new Error('登录异常: ' + loginResult.error);
    if (loginResult.status !== 200 && loginResult.status !== 201) {
      throw new Error('登录失败 ' + loginResult.status + ': ' + JSON.stringify(loginResult.body).slice(0, 150));
    }

    // ── 访问服务器页面 ──
    const serverUrl = BASE_URL + '/server/' + SERVER_ID;
    console.log('[->] 跳转到:', serverUrl);
    await page.goto(serverUrl, { waitUntil: 'networkidle', timeout: 60000 });
    if (page.url().includes('/auth/')) throw new Error('被重定向回登录页');
    await page.waitForTimeout(3000);
    await saveScreenshot(page, 'debug-server.png');

    // ── 等待并读取剩余时间 ──
    console.log('[等待] 查找剩余时间...');
    let remainRaw = null;
    for (let i = 0; i < 30; i++) {
      remainRaw = await findTimeText(page);
      if (remainRaw) { console.log('[找到]', remainRaw); break; }
      await page.waitForTimeout(1000);
    }
    if (!remainRaw) throw new Error('30秒内未找到剩余时间');

    const remainText  = extractTimeStr(remainRaw);
    const remainHours = parseHours(remainText);
    console.log('[时间]', remainText, '->', remainHours.toFixed(1), 'h');

    if (remainHours <= 24) {
      console.log('[续期] 剩余 <= 1 天，点击续期...');

      // 点击续期按钮
      const btnText = await page.evaluate(() => {
        const keywords = ['Renouveler', 'Renew'];
        const buttons = Array.from(document.querySelectorAll('button, a'));
        for (const btn of buttons) {
          const t = (btn.textContent || '').trim();
          if (keywords.some(k => t === k || t.startsWith(k))) {
            btn.click();
            return t;
          }
        }
        return null;
      });
      if (!btnText) throw new Error('未找到续期按钮');
      console.log('[续期] 点击:', btnText);

      // 等待 "Renewing..." 状态消失，然后等新时间出现
      console.log('[续期] 等待续期完成...');
      let newRemainRaw = null;
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(1000);

        // 检查是否还在 "Renewing..." 状态
        const isRenewing = await page.evaluate(() => {
          return document.body.innerText.includes('Renewing');
        });
        if (isRenewing) {
          console.log('[续期] 还在续期中... (' + (i + 1) + 's)');
          continue;
        }

        // Renewing 消失了，读取新时间
        const t = await findTimeText(page);
        if (t) {
          const h = parseHours(extractTimeStr(t));
          // 新时间必须大于续期前时间，才说明续期真的生效了
          if (h > remainHours + 1) {
            newRemainRaw = t;
            console.log('[续期] 完成，耗时', i + 1, '秒');
            break;
          }
        }
      }

      await saveScreenshot(page, 'debug-after-renew.png');

      if (!newRemainRaw) {
        // 超时未检测到变化，直接重新加载页面获取最新时间
        console.log('[续期] 轮询超时，刷新页面读取最新时间...');
        await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);
        newRemainRaw = await findTimeText(page);
        await saveScreenshot(page, 'debug-after-renew.png');
      }

      const newText  = newRemainRaw ? extractTimeStr(newRemainRaw) : '未知';
      const newHours = parseHours(newText);
      const newDays  = Math.floor(newHours / 24);
      const newHrs   = Math.floor(newHours % 24);
      console.log('[续期后]', newText, '->', newHours.toFixed(1), 'h');

      await tgNotify(
        'ACLClouds 续期成功\n\n' +
        '服务器: ' + SERVER_ID + '\n' +
        '续期前: ' + remainText.trim() + '\n' +
        '续期后: ' + newDays + ' 天 ' + newHrs + ' 小时\n\n' +
        '时间: ' + new Date().toISOString()
      );

    } else {
      const d = Math.floor(remainHours / 24);
      const h = Math.floor(remainHours % 24);
      console.log('[跳过] 剩余', d, '天', h, '小时，无需续期');
      await tgNotify(
        'ACLClouds 无需续期\n\n' +
        '服务器: ' + SERVER_ID + '\n' +
        '当前剩余: ' + d + ' 天 ' + h + ' 小时（大于 1 天，跳过）\n\n' +
        '时间: ' + new Date().toISOString()
      );
    }

  } catch (err) {
    console.error('[错误]', err.message);
    if (browser) {
      try {
        const pg = browser.contexts()[0]?.pages()?.[0];
        if (pg) await saveScreenshot(pg, 'error-screenshot.png');
      } catch (_) {}
    }
    await tgNotify(
      'ACLClouds 续期失败\n\n' +
      '服务器: ' + (SERVER_ID || '未设置') + '\n' +
      '错误: ' + err.message.slice(0, 200) + '\n\n' +
      '时间: ' + new Date().toISOString()
    );
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
