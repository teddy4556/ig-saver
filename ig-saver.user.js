// ==UserScript==
// @name               IG Saver
// @name:zh-CN         IG Saver - Instagram 原图/视频无损下载
// @namespace          https://github.com/teddy4556/ig-saver
// @version            0.3.73
// @description        一键下载 Instagram Post / Reels / Stories / Highlights / Avatar 原图和视频。
// @description:zh-CN  原图最高 3072w + Reels 音视频自动合成有声 MP4 + 14 个文件名占位符。Console 第一行打印 [IG-SAVER-<版本号>] 启动行,对不上说明装的是旧版。
// @author             teddy4556
// @match              https://www.instagram.com/*
// @match              https://*.instagram.com/*
// @grant              GM_addStyle
// @grant              GM_download
// @grant              GM_getValue
// @grant              GM_registerMenuCommand
// @grant              GM_setValue
// @grant              GM_unregisterMenuCommand
// @grant              GM_xmlhttpRequest
// @grant              GM_info
// @grant              GM_notification
// @connect            i.instagram.com
// @connect            www.instagram.com
// @connect            cdn.jsdelivr.net
// @connect            scontent.cdninstagram.com
// @connect            *.cdninstagram.com
// @connect            *.fbcdn.net
// @compatible         chrome >= 100
// @compatible         edge >= 100
// @compatible         firefox >= 100
// @icon64             https://raw.githubusercontent.com/teddy4556/ig-saver/main/assets/logo-128.png
// @icon               https://raw.githubusercontent.com/teddy4556/ig-saver/main/assets/logo-32.png
// @license            MIT
// @run-at             document-idle
// ==/UserScript==

/**
 * IG Saver v0.2.4 (2026-10-12)
 *
 * v0.2.4 升级点(关键修复):
 *   1. 短码守卫:`getMediaInfo` 只接受纯数字 mediaId,字母短码直接拦掉
 *   2. fetchWithFallback 改为 GM_xmlhttpRequest 主路(绕过 fetch layer 拦截)
 *   3. Content-Type 守卫:HTML 风控页返回 ok:false,不算成功
 *   4. 启动时强制打印 [IG-SAVER-0.2.4] 到 console,确保你装的是新版
 *   5. 修原生 querySelector 的 :not([hidden]) 报错(用 :not([hidden]) + offsetParent)
 *   6. Feed 每个 article 加 2 个 FAB(下载当前 + 下载全部),全自动不弹窗
 *
 * 重装指南:
 *   1. 油猴 Dashboard → 找到 IG Saver → 删除(完整删除,不是 disable)
 *   2. 浏览器关闭 → 重启
 *   3. 油猴 Dashboard → 新建脚本 → Ctrl+A / Del / Ctrl+V / Ctrl+S
 *   4. 重启浏览器
 *   5. 刷 IG 主页 → 看 console 第一行是否是 [IG-SAVER-0.2.4]
 *
 * 保留(对照 SN-Koarashi IG Helper 4.2.1):
 *   - 5 类抓取入口(Post/Reels/Stories/Highlights/Avatar)
 *   - Media API 走 X-IG-App-ID
 *   - replaceSameOriginHost 防 fbcdn.net 同源
 *   - PerformanceObserver 缓存图片 URL 12h
 *   - 命名模板 + 油猴菜单配置
 */

(() => {
  'use strict';

  const VERSION = '0.3.73';
  const NS = 'ig-saver';

  // v0.3.72:IG 移动端 UA 提到模块作用域。
  // v0.3.71 及之前(全部 61 个归档版本)这行缩进为 0,看着像顶层,实际落在 getPostMedia 函数体内(368-507),
  // getStories / getHighlightStories 引用它 → 运行时 ReferenceError → Story / Highlights 按钮 100% 失效。
  // 顺带修 UA typo:'Pixel 7 XL)Build/' 少一个空格。
  const IG_MOBILE_UA = 'Mozilla/5.0 (Linux; Android 10; Pixel 7 XL) Build/RP1A.20845.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 Chrome/117.0.5938.60 Mobile Safari/537.36 Instagram 307.0.0.34.111';

  // ============================================================
  // 启动确认 + 全局错误捕获
  // ============================================================
  // v0.2.4 关键:console 第一行打 [IG-SAVER-0.2.4]
  console.log(`[IG-SAVER-${VERSION}] 启动中...`);
  console.log(`[IG-SAVER-${VERSION}] GM_xmlhttpRequest: ${typeof GM_xmlhttpRequest}`);
  console.log(`[IG-SAVER-${VERSION}] GM_info.version: ${GM_info?.script?.version || 'unknown'}`);

  const toast = (msg, ms = 3000, type = 'info') => {
    try {
      const el = document.createElement('div');
      const colors = {
        info: { bg: '#374151', fg: '#fff' },
        success: { bg: '#10b981', fg: '#fff' },
        error: { bg: '#ef4444', fg: '#fff' },
        warn: { bg: '#f59e0b', fg: '#fff' },
      };
      const c = colors[type] || colors.info;
      el.style.cssText = `position:fixed;top:60px;right:24px;z-index:2147483647;background:${c.bg};color:${c.fg};padding:12px 18px;border-radius:8px;font:13px/1.5 system-ui;box-shadow:0 4px 12px rgba(0,0,0,.2);max-width:420px;white-space:pre-line;`;
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), ms);
    } catch {}
  };

  // 全局错误捕获
  window.addEventListener('error', (e) => {
    try {
      const src = String(e?.filename || '');
      const stack = String(e?.error?.stack || '');
      const isSelf = src.includes(NS) || stack.includes(NS) || (e?.error?.stack || '').includes('ig-saver');
      if (!isSelf) return;
      toast(`❌ ig-saver v${VERSION} 报错\n${e.message}`, 6000, 'error');
    } catch {}
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason = String(e?.reason?.message || e?.reason || '');
      console.error(`[IG-SAVER-${VERSION}] Promise 报错:`, reason);
    } catch {}
  });

  setTimeout(() => toast(`✅ IG Saver v${VERSION} 已加载 · 每帖一键全下`, 2500, 'success'), 600);

  // ============================================================
  // 配置开关
  // ============================================================
  const CFG_KEY = 'IG_SAVER_CONFIG';
  const defaultCfg = {
    HD_ORIGINAL: true,         // 保留"原图下载"选项:默认走 Media API 高清
    useGMDownload: false,       // 用 GM_download(部分浏览器批量更稳)
  };
  let cfg = Object.assign({}, defaultCfg, GM_getValue(CFG_KEY, {}));
  const saveCfg = () => GM_setValue(CFG_KEY, cfg);

  // ============================================================
  // 命名模板
  // ============================================================
  const TPL_KEY = 'IG_SAVER_TEMPLATE';
  // v0.3.58:对齐 IG Helper 4.2.1 14 个占位符,默认格式同名
  const TPL_DEFAULT = '%USERNAME%-%SOURCE_TYPE%-%SHORTCODE%-%YEAR%%MONTH%%DAY%_%HOUR%%MINUTE%%SECOND%_%INDEX%';

  const getTemplate = () => GM_getValue(TPL_KEY, TPL_DEFAULT);
  const setTemplate = (v) => GM_setValue(TPL_KEY, v);

  // v0.3.58:sanitize 保留 % 让 %KEY% 占位符不被破坏
  const sanitize = (s) => String(s ?? 'x')
    .replace(/[\/\\:*?"<>|#+&,'`~;{}!@$()\[\]?=+……\n\r\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'x';

  // v0.3.58:对齐 IG Helper 4.2.1 — %KEY% 大写占位符
  const renderTemplate = (tpl, ctx) => {
    const cleanCtx = {};
    for (const [k, v] of Object.entries(ctx)) cleanCtx[k] = sanitize(v);
    let out = tpl;
    for (const [k, v] of Object.entries(cleanCtx)) {
      out = out.split(`%${k.toUpperCase()}%`).join(v);
    }
    // 未知占位符替换成 x
    out = out.replace(/%[\w-]+%/g, 'x');
    return out.slice(0, 200);
  };

  // ============================================================
  // 图片 URL 缓存(12h TTL)
  // ============================================================
  const CACHE_KEY = 'IG_SAVER_URL_CACHE';
  const CACHE_MAX_AGE = 12 * 60 * 60 * 1000;
  const CACHE_MAX_ITEMS = 300;

  // v0.3.58:HD 原图 cache(key 是 shortcode + idx)
  // 在单帖页 IG 注水里有 display_resources 完整宽度,这里存 1440w
  const HD_CACHE_KEY = 'IG_SAVER_HD_CACHE';
  const HD_CACHE_MAX_AGE = 12 * 60 * 60 * 1000;
  const HD_CACHE_MAX_ITEMS = 600;
  let hdCache = GM_getValue(HD_CACHE_KEY, {});

  const hdCacheSet = (raw, url, width) => {
    if (!raw) return;
    const keys = Object.keys(hdCache);
    if (keys.length >= HD_CACHE_MAX_ITEMS) {
      keys.sort((a, b) => hdCache[a].ts - hdCache[b].ts);
      delete hdCache[keys[0]];
    }
    hdCache[raw] = { url, width, ts: Date.now() };
    GM_setValue(HD_CACHE_KEY, hdCache);
  };

  const hdCacheGet = (raw) => {
    if (!raw) return null;
    const entry = hdCache[raw];
    if (!entry) return null;
    if ((Date.now() - entry.ts) > HD_CACHE_MAX_AGE) {
      delete hdCache[raw];
      GM_setValue(HD_CACHE_KEY, hdCache);
      return null;
    }
    return entry;
  };

  let urlCache = GM_getValue(CACHE_KEY, {});

  const mediaIdFromURL = (url) => {
    try {
      const u = new URL(url);
      const key = u.searchParams.get('ig_cache_key');
      if (!key) return null;
      return atob(key.split('.')[0]);
    } catch { return null; }
  };

  const putInCache = (id, url) => {
    if (!id) return;
    const keys = Object.keys(urlCache);
    if (keys.length >= CACHE_MAX_ITEMS) {
      keys.sort((a, b) => urlCache[a].ts - urlCache[b].ts);
      delete urlCache[(window.IG_SAVER_DEBUG || 'all')[0]];
    }
    urlCache[id] = { url, ts: Date.now() };
    GM_setValue(CACHE_KEY, urlCache);
  };

  const getFromCache = (id) => {
    if (!id) return null;
    const entry = urlCache[id];
    if (!entry) return null;
    if ((Date.now() - entry.ts) > CACHE_MAX_AGE) {
      delete urlCache[id];
      GM_setValue(CACHE_KEY, urlCache);
      return null;
    }
    return entry.url;
  };

  // PerformanceObserver
  try {
    const perfObs = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.initiatorType !== 'img') return;
        const u = entry.name;
        if (/_e15|_e35_s|_s\d+x\d+|_p\d+x\d+/.test(u)) return;
        if (u.includes('avatar') || u.includes('s150x150')) return;
        if (/\.(jpg|jpeg|png|webp)(\?|$|#)/i.test(u)) {
          const id = mediaIdFromURL(u);
          if (id && !urlCache[id]) putInCache(id, u);
        }
      });
    });
    perfObs.observe({ entryTypes: ['resource'] });
  } catch (err) {
    console.warn(`[IG-SAVER-${VERSION}] PerformanceObserver 失败:`, err);
  }

  // ============================================================
  // IG 内部 API
  // ============================================================
  const getAppID = () => {
    let result = null;
    document.querySelectorAll('script[type="application/json"]').forEach((s) => {
      const text = s.textContent || '';
      const m = text.match(/"APP_ID":"([0-9]+)"/);
      if (m) result = m[1];
    });
    return result;
  };

  const replaceSameOriginHost = (url) => {
    try {
      const u = new URL(url);
      if (u.host.includes('fbcdn.net')) u.host = 'scontent.cdninstagram.com';
      return u.href;
    } catch { return url; }
  };

  // v0.2.4 重写 fetchWithFallback:GM_xmlhttpRequest 主路
  // v0.3.58:加 Referer + Origin + X-Requested-With + Accept-Language,跟 IG Helper 完全同款头
  // + 启动后 30s 延迟避免被 IG 风控标记成"新装脚本高频 fetch"
  const _igSaverStartTs = Date.now();
  // v0.3.58:优先用 GM_xmlhttpRequest(IG Helper 4.2.1 用的,绕过 fetch 的 ERR_BLOCKED_BY_CLIENT)
  //    失败时 fallback 到 fetch
  const fetchWithFallback = async (url, opts = {}) => {
    // v0.3.58:默认不带 Referer/Origin/X-Requested-With(IG Helper 4.2.1 也不带,IG 风控识别标志)
    //    opts.bare = true 强制连 User-Agent 也不加(纯 GM_xhr 模式)
    const isBare = opts.bare === true;
    const headers = isBare
      ? { Accept: '*/*', ...(opts.headers || {}) }
      : {
          // v0.3.72:改引模块作用域的 IG_MOBILE_UA(原来这里是内联字面量,和第 380 行重复两份,typo 也一样)
          'User-Agent': IG_MOBILE_UA,
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(opts.headers || {}),
        };

    // 1) 优先 GM_xmlhttpRequest
    if (typeof GM_xmlhttpRequest === 'function') {
      try {
        return await new Promise((resolve) => {
          GM_xmlhttpRequest({
            method: opts.method || 'GET',
            url,
            headers,
            anonymous: false,  // 带 cookie
            responseType: 'json',
            onload: (r) => {
              const ct = r.responseHeaders?.match(/content-type:\s*([^;\r\n]+)/i)?.[1] || '';
              const isHTML = ct.toLowerCase().includes('text/html');
              console.log(`[IG-SAVER-${VERSION}] GM_xhr ${url.substring(0, 60)}... → status=${r.status} ct=${ct} isHTML=${isHTML}`);
              resolve({
                ok: r.status >= 200 && r.status < 300 && !isHTML,
                status: r.status,
                contentType: ct,
                isHTML,
                responseText: r.responseText,
                json: async () => {
                  try { return typeof r.response === 'object' ? r.response : JSON.parse(r.responseText); }
                  catch { return null; }
                },
              });
            },
            onerror: (err) => {
              console.warn(`[IG-SAVER-${VERSION}] GM_xhr 失败:`, err?.error || err);
              resolve({ ok: false, status: 0, json: async () => null, isHTML: false });
            },
            ontimeout: () => {
              console.warn(`[IG-SAVER-${VERSION}] GM_xhr timeout`);
              resolve({ ok: false, status: 0, json: async () => null, isHTML: false });
            },
          });
        });
      } catch (err) {
        console.warn(`[IG-SAVER-${VERSION}] GM_xhr 异常,fallback 到 fetch:`, err);
      }
    }

    // 2) fallback 到 fetch
    const finalOpts = { ...opts, headers, credentials: opts.credentials ?? 'include' };
    try {
      const res = await fetch(url, finalOpts);
      const ct = res.headers.get('content-type') || '';
      const isHTML = ct.toLowerCase().includes('text/html');
      console.log(`[IG-SAVER-${VERSION}] fetch ${url.substring(0, 80)}... → status=${res.status} ct=${ct} isHTML=${isHTML}`);
      return {
        ok: res.ok && !isHTML,
        status: res.status,
        contentType: ct,
        isHTML,
        responseText: '',
        json: async () => {
          try { return await res.json(); } catch { return null; }
        },
      };
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] fetch failed:`, err.message, url);
      return { ok: false, status: 0, json: async () => null, isHTML: false };
    }
  };

  // v0.2.4 DOM 注水抓短码 → 优先用
  const getPostMediaFromDOM = (shortcode) => {
    try {
      const scripts = document.querySelectorAll('script[type="application/json"]');
      for (const s of scripts) {
        const text = s.textContent || '';
        if (!text.includes(shortcode)) continue;
        let data;
        try { data = JSON.parse(text); } catch { continue; }
        const m = data?.shortcode_media || data?.data?.shortcode_media;
        if (m && m.shortcode === shortcode) {
          return {
            mediaId: m.id,
            shortcode: m.shortcode,
            owner: m.owner?.username || 'unknown',
            takenAt: m.taken_at_timestamp || m.taken_at || Date.now() / 1000,
            items: extractPostItems(m),
            _source: 'dom-injection',
          };
        }
      }
    } catch {}
    return null;
  };

  // v0.2.4 核心:getPostMedia 4 路 fallback
  const getPostMedia = async (shortcode) => {
    console.log(`[IG-SAVER-${VERSION}] getPostMedia(${shortcode})`);

    // 1. DOM 注水(主页 article 节点旁注水了 mediaInfo)
    const dom = getPostMediaFromDOM(shortcode);
    if (dom && dom.items.length) {
      console.log(`[IG-SAVER-${VERSION}] DOM 注水命中,${dom.items.length} items`);
      return dom;
    }

    const appId = getAppID();
    // 关键:SN 原版用 Instagram 307.0.0.34.111 移动端 UA,桌面 web UA 被 IG 当 web 风控
    // v0.3.72:IG_MOBILE_UA 已提到模块作用域(见文件头),这里只保留 headers 局部变量
    const headers = { 'User-Agent': IG_MOBILE_UA, Accept: '*/*' };
    if (appId) headers['X-IG-App-ID'] = appId;

    // 2. 0.3.41 跳过 query_hash(实测必返 400,IG 2026 已弃用 query_hash 路径,只留 query_id 9496392173716084)
    //    历史 17 次重试都用过 query_hash,100% 失败 + 多花 1.2s 等返回
    //    保留代码段以便 IG 改版后快速启用
    const SKIP_QUERY_HASH = true;
    if (!SKIP_QUERY_HASH) {
      const graphqlURL = `https://www.instagram.com/graphql/query/?query_hash=2c4c2e343a8f64c625ba02b2aa12c7f8&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;
      try {
        const res = await fetchWithFallback(graphqlURL, { headers, bare: true });
        if (res.ok && !res.isHTML) {
          const data = await res.json();
          if (data?.data?.shortcode_media) {
            const m = data.data.shortcode_media;
            console.log(`[IG-SAVER-${VERSION}] graphql 命中,mediaId=${m.id}`);
            return {
              mediaId: m.id,
              shortcode: m.shortcode,
              owner: m.owner?.username || 'unknown',
              takenAt: m.taken_at_timestamp,
              items: extractPostItems(m),
            };
          }
        }
      } catch (err) {
        console.warn(`[IG-SAVER-${VERSION}] graphql 异常:`, err);
      }
    } else {
      console.log(`[IG-SAVER-${VERSION}] 跳过 query_hash(必败),直跑 query_id...`);
    }

    // 3. v0.3.14 query_id fallback + Relay 字段 + 1 次重试(等 1.5s)
    //    IG 风控是滑窗期,失败时等 1.5s 再试一次通常能过
    const tryQueryId = async () => {
      const queryIdURL = `https://www.instagram.com/graphql/query/?query_id=9496392173716084&variables=${encodeURIComponent(JSON.stringify({
        shortcode,
        __relay_internal__pv__PolarisFeedShareMenurelayprovider: true,
        __relay_internal__pv__PolarisIsLoggedInrelayprovider: true,
      }))}`;
      const res = await fetchWithFallback(queryIdURL, { headers: { 'User-Agent': IG_MOBILE_UA, Accept: '*/*' } });
      if (res.ok && !res.isHTML) {
        try {
          const root = await res.json();
          // v0.3.58:body 多一层 data!{data: {xdt_api__v1__media__shortcode__web_info: {items: [...]}}}
          // IG Helper 4.2.1 也是这么读。覆盖两层结构
          const inner = root?.data ?? root;
          const items = inner?.xdt_api__v1__media__shortcode__web_info?.items?.[0];
          if (items) return { ok: true, data: root, items };
          if (inner?.shortcode_media) return { ok: true, data: root, items: inner.shortcode_media };
          return { ok: false, data: root, status: res.status, contentType: res.contentType };
        } catch (parseErr) {
          // body 不是 JSON
          let raw = '';
          try { raw = (await res.json && (await res.json())) ? '' : ''; } catch {}
          return { ok: false, status: res.status, contentType: res.contentType, parseError: parseErr.message };
        }
      }
      return { ok: false, status: res.status, contentType: res.contentType };
    };
    for (let retry = 0; retry < 2; retry++) {
      try {
        const r = await tryQueryId();
        if (r.ok) {
          // v0.3.58:补回 RAW BODY console.log(诊断 IG 风控假象)
      if (r.data) {
        // v0.3.58:RAW BODY 打 1500 字,找 user 字段真实位置(query_id 响应 user 字段可能在 m.user / m.owner / m.user_id / m.owner_id)
      console.log(`[IG-SAVER-${VERSION}] query_id RAW BODY (前 1500):`, JSON.stringify(r.data).slice(0, 1500));
      }
      console.log(`[IG-SAVER-${VERSION}] query_id 命中(第 ${retry + 1} 次),mediaId=${r.items.id}`);
          return {
            mediaId: r.items.id,
            shortcode: r.items.code || shortcode,
            owner: r.items.user?.username || 'unknown',
            takenAt: r.items.taken_at || Date.now() / 1000,
            items: extractPostItems(r.items),
            // v0.3.58:遍历多个字段位置找 user.pk(IG query_id 响应可能 user.id / owner.id / owner.pk_id)
            uid: r.items.user?.id || r.items.user?.pk_id || r.items.user?.pk
                || r.items.owner?.id || r.items.owner?.pk_id || r.items.owner?.pk
                || (r.items.id ? String(r.items.id).split('_').pop() : null),
          };
        }
        // v0.3.58:诊断日志,失败时打印 body 真实内容
        if (r.data) {
          console.warn(`[IG-SAVER-${VERSION}] query_id 失败(第 ${retry + 1} 次) RAW BODY:`, JSON.stringify(r.data).slice(0, 500));
        } else if (r.status) {
          console.warn(`[IG-SAVER-${VERSION}] query_id 失败(第 ${retry + 1} 次) status=${r.status} ct=${r.contentType || '?'}`);
        }
        console.warn(`[IG-SAVER-${VERSION}] query_id 失败(第 ${retry + 1} 次),1.5s 后重试...`);
        if (retry === 0) await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.warn(`[IG-SAVER-${VERSION}] query_id 异常(第 ${retry + 1} 次):`, err);
        if (retry === 0) await new Promise(r => setTimeout(r, 1500));
      }
    }

    // 4. v0.3.8 Media API(无守卫,IG 自己 404 判;短码/老 mediaId 都能查)
    try {
      const mi = await getMediaInfo(shortcode);
      if (mi && mi.id) {
        console.log(`[IG-SAVER-${VERSION}] Media API 命中,${shortcode} → mediaId=${mi.id}`);
          const items = [{
            mediaId: mi.id,
            isVideo: !!mi.video_versions?.length,
            url: mi.video_versions?.[0]?.url || mi.image_versions2?.candidates?.[0]?.url,
            shortcode: mi.code || shortcode,
            owner: mi.user?.username || 'unknown',
            takenAt: mi.taken_at || Date.now() / 1000,
            idx: 1,
          }].filter(it => it.url);
          if (items.length) {
            return {
              mediaId: mi.id,
              shortcode: mi.code || shortcode,
              owner: mi.user?.username || 'unknown',
              takenAt: mi.taken_at,
              items,
            };
          }
        }
      } catch (err) {
        console.warn(`[IG-SAVER-${VERSION}] Media API 异常:`, err);
      }

    console.warn(`[IG-SAVER-${VERSION}] 所有路径失败,${shortcode} 无 media`);
    return { mediaId: null, shortcode, owner: 'unknown', items: [] };
  };

  const extractPostItems = (m) => {
    const items = [];
    // v0.3.12 关键改动:按 width 降序排取最大(原图 = 1440w)
    const pickMaxImage = (node) => {
      // 优先 image_versions2.candidates(原图字段,通常有 1440w)
      // 退回 display_resources(主页缩略图,最多 1080w)
      const imgs = (node.image_versions2?.candidates?.length ? node.image_versions2.candidates : null)
                || (node.display_resources?.length ? node.display_resources : null);
      if (!imgs?.length) return null;
      const sorted = [...imgs].sort((a, b) => {
        const wa = a.width || a.config_width || 0;
        const wb = b.width || b.config_width || 0;
        return wb - wa;  // 降序
      });
      const best = sorted[0];
      // v0.3.58:query_id body 里字段是 .url,display_resources/DOM 注水可能是 .src
      const url = best?.url || best?.src;
      if (!url) return null;
      console.log(`[IG-SAVER-${VERSION}] pickMaxImage: ${best.width || best.config_width}w (候选 ${imgs.length} 张, 字段=${best.url ? 'url' : 'src'})`);
      return url;
    };
    const addItem = (node, idx) => {
      // v0.3.65:isVideo 判定放宽 —— IG 某些视频只在 clip / dash_abr_media 等字段出现
      const isVideo = !!node.video_url || !!node.video_versions?.length || !!node.video_dash_manifest
        || !!node.dash_info?.video_dash_manifest || !!node.clip?.video_dash_manifest;
      // v0.3.0:优先 video_dash_manifest 里的最高码率 mp4
      let url;
      if (isVideo) {
        // v0.3.58:优先 DASH(最高码率)+ audio URL
        if (node.video_dash_manifest && typeof parseDashMPA === 'function') {
          const parsed = parseDashMPA(node.video_dash_manifest);
          // v0.3.65:audio url **独立**取值 —— 原代码只在 video 命中时才设 _dash_audio_url,
          //    导致「manifest 有 audio 但 video 分支没走通」时音轨被整个丢掉(用户反馈「视频没合并」)
          node._dash_audio_url = parsed?.audio?.[0]?.url || null;
          if (!node._dash_audio_url && parsed?.all?.length) {
            console.warn(`[IG-SAVER-${VERSION}] manifest 有 ${parsed.all.length} reps 但没识别出音轨 —— 该视频可能本就无声`);
          }
          if (parsed?.video?.length) {
            const best = parsed.video[0];
            if (best?.url) {
              console.log(`[IG-SAVER-${VERSION}] 选 DASH 视频: ${best.width}x${best.height} @ ${best.bandwidth}bps`
                + (node._dash_audio_url ? ' + 有音轨' : ' + 无音轨'));
              url = best.url;
            }
          }
        }
        // 退路:video_url 或 video_versions[0]
        if (!url) {
          url = node.video_url || node.video_versions?.[0]?.url;
          if (!url) console.warn(`[IG-SAVER-${VERSION}] 视频 url 失败,DASH=${node.video_dash_manifest ? '有' : '无'}, video_url=${node.video_url ? '有' : '无'}, video_versions=${node.video_versions ? '有' : '无'}`);
        }
      } else if (node.video_versions?.length) {
        // v0.3.58:视频也走 video_versions(IG 主页不返 video_versions,只返 DASH manifest)
        // 视频 URL 优先级:video_url > video_versions[0]
        url = node.video_url || node.video_versions?.[0]?.url;
      } else {
        // v0.3.12 关键改动:按 width 降序取最大(原图)
        url = pickMaxImage(node);
        // v0.3.58:诊断 — 图片 path 拿 url 失败时打印 node 顶层 key
        if (!url) {
          console.warn(`[IG-SAVER-${VERSION}] 图片 url 失败,node keys:`, Object.keys(node || {}).slice(0, 30).join(','));
          console.warn(`[IG-SAVER-${VERSION}] image_versions2:`, node?.image_versions2 ? '有' : '无', '| display_resources:', node?.display_resources ? '有' : '无');
        }
      }
      items.push({
        mediaId: node.id || m.id,
        isVideo,
        url,
        shortcode: m.shortcode || m.code,
        owner: m.owner?.username || m.user?.username || 'unknown',
        // v0.3.58:遍历多个字段位置找 user.pk
        uid: m.owner?.id || m.owner?.pk_id || m.owner?.pk
            || m.user?.id || m.user?.pk_id || m.user?.pk
            || node.owner?.id || node.owner?.pk_id || node.owner?.pk
            || node.user?.id || node.user?.pk_id || node.user?.pk
            || (m.id ? String(m.id).split('_').pop() : null),
        takenAt: m.taken_at_timestamp || m.taken_at || Date.now() / 1000,
        idx,
        _dashAudioUrl: node._dash_audio_url,
        _dashManifest: node.video_dash_manifest || null,
        _noAudioTrack: !node._dash_audio_url,
      });
    };

    if (m.__typename === 'GraphSidecar' && m.edge_sidecar_to_children) {
      m.edge_sidecar_to_children.edges.forEach((e, i) => addItem(e.node, i + 1));
    } else if (m.carousel_media) {
      m.carousel_media.forEach((n, i) => addItem(n, i + 1));
    } else {
      addItem(m, 1);
    }
    return items;
  };

  // 改成 lazy:需要 mux 时才 fetch + 注入 Mediabunny
  let _MB = null;
  let _MB_promise = null;
    const lazyLoadMediabunny = async () => {
    // v0.3.58:用 GM_xmlhttpRequest 拉 esm(绕 IG CSP),blob URL 动态 import
    if (typeof window.Mediabunny !== 'undefined') return window.Mediabunny;
    if (window.mediabunnyPromise) return window.mediabunnyPromise;
    window.mediabunnyPromise = (async () => {
      try {
        const esmText = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://cdn.jsdelivr.net/npm/mediabunny@1.34.5/+esm',
            onload: (r) => resolve(r.responseText),
            onerror: (e) => reject(new Error('Mediabunny esm fetch failed')),
          });
        });
        const blob = new Blob([esmText], { type: 'application/javascript' });
        const blobURL = URL.createObjectURL(blob);
        const mod = await import(blobURL);
        URL.revokeObjectURL(blobURL);
        window.Mediabunny = mod;
        // v0.3.59:修反引号 bug(v0.3.58 单引号 → ${VERSION} 打不出来,日志在骗人)
        console.log(`[IG-SAVER-${VERSION}] Mediabunny 动态加载完成`);
        return mod;
      } catch (e) {
        console.warn(`[IG-SAVER-${VERSION}] Mediabunny 加载失败:`, e.message);
        return null;
      }
    })();
    return window.mediabunnyPromise;
  }

  const muxDashVideoAudioToMp4 = async (videoBuf, audioBuf) => {
    // v0.3.58:回到 Mediabunny 路径(对齐 IG Helper 4.2.1)
    //    v0.3.40/0.3.41 ffmpeg.wasm 失败是因为 v0.3.25 那次实测 aBuf 太小,不代表 mux 本身坏
    const MB = await lazyLoadMediabunny();
    if (!MB) throw new Error('Mediabunny 不可用,fallback 下分文件');

    const videoInput = new MB.Input({
      formats: [MB.MP4],
      source: new MB.BufferSource(videoBuf),
    });
    const audioInput = new MB.Input({
      formats: [MB.MP4],
      source: new MB.BufferSource(audioBuf),
    });
    const vTrack = await videoInput.getPrimaryVideoTrack();
    if (!vTrack || !vTrack.codec) throw new Error('No video track found');
    const aTrack = await audioInput.getPrimaryAudioTrack();
    if (!aTrack || !aTrack.codec) throw new Error('No audio track found');
    const vSink = new MB.EncodedPacketSink(vTrack);
    const aSink = new MB.EncodedPacketSink(aTrack);
    const output = new MB.Output({
      format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new MB.BufferTarget(),
    });
    const vSource = new MB.EncodedVideoPacketSource(vTrack.codec);
    const aSource = new MB.EncodedAudioPacketSource(aTrack.codec);
    output.addVideoTrack(vSource, { rotation: vTrack.rotation || 0 });
    output.addAudioTrack(aSource);
    await output.start();
    const vDecoderConfig = await vTrack.getDecoderConfig();
    const aDecoderConfig = await aTrack.getDecoderConfig();
    const vMeta = vDecoderConfig ? { decoderConfig: vDecoderConfig } : undefined;
    const aMeta = aDecoderConfig ? { decoderConfig: aDecoderConfig } : undefined;
    const vIter = vSink.packets();
    const aIter = aSink.packets();
    let vNext = await vIter.next();
    let aNext = await aIter.next();
    let vSentMeta = false;
    let aSentMeta = false;
    while (!vNext.done || !aNext.done) {
      const takeVideo = (() => {
        if (vNext.done) return false;
        if (aNext.done) return true;
        return vNext.value.timestamp <= aNext.value.timestamp;
      })();
      if (takeVideo) {
        await vSource.add(vNext.value, vSentMeta ? undefined : vMeta);
        vSentMeta = true;
        vNext = await vIter.next();
      } else {
        await aSource.add(aNext.value, aSentMeta ? undefined : aMeta);
        aSentMeta = true;
        aNext = await aIter.next();
      }
    }
    await output.finalize();
    const outBuf = output.target.buffer;
    if (outBuf instanceof ArrayBuffer) return outBuf;
    if (outBuf && outBuf.buffer) {
      return outBuf.buffer.slice(outBuf.byteOffset, outBuf.byteOffset + outBuf.byteLength);
    }
    throw new Error('Unexpected output buffer type');
  };

  // v0.3.0 异步下载 URL → ArrayBuffer
  const fetchArrayBuffer = async (url) => {
    const finalURL = replaceSameOriginHost(url);
    const tryOnce = async (creds) => {
      const res = await fetch(finalURL, { credentials: creds });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    };
    try { return await tryOnce('omit'); }
    catch (e1) {
      try { return await tryOnce('include'); }
      catch (e2) {
        if (typeof GM_xmlhttpRequest === 'function') {
          return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
              method: 'GET', url: finalURL,
              responseType: 'arraybuffer',
              onload: (r) => r.status >= 200 && r.status < 300
                ? resolve(r.response)
                : reject(new Error(`HTTP ${r.status}`)),
              onerror: () => reject(new Error('GM_xhr failed')),
            });
          });
        }
        throw e2;
      }
    }
  };

  // v0.2.9 新增:解析 MPEG-DASH manifest(MPD XML)
  // 挑最高码率视频轨 + 音频轨
  const parseDashMPA = (mpdXml) => {
    try {
      if (!mpdXml || typeof mpdXml !== 'string') return null;
      const xml = new DOMParser().parseFromString(mpdXml, 'application/xml');
      if (xml.querySelector('parsererror')) return null;
      const reps = Array.from(xml.querySelectorAll('Representation'));
      const candidates = reps.map((rep) => {
        const base = rep.querySelector('BaseURL')?.textContent?.trim();
        if (!base) return null;
        const set = rep.closest('AdaptationSet');
        const mimeType = rep.getAttribute('mimeType') || set?.getAttribute('mimeType') || '';
        const contentType = set?.getAttribute('contentType') || '';
        const bandwidth = parseInt(rep.getAttribute('bandwidth') || '0', 10) || 0;
        const width = parseInt(rep.getAttribute('width') || '0', 10) || 0;
        const height = parseInt(rep.getAttribute('height') || '0', 10) || 0;
        const codecs = rep.getAttribute('codecs') || '';
        const subtype = set?.getAttribute('subtype') || '';
        return { url: base, mimeType, contentType, codecs, subtype, bandwidth, width, height };
      }).filter(Boolean);
      // v0.3.65:分类判定放宽(用户反馈「视频没合并」)。
      // 原判定用 includes/startsWith,**大小写敏感**,且只看 contentType + mimeType 两个字段。
      // DASH 标准里音视频标记可能出现在:mimeType 前缀、contentType、codecs 字符串、
      // 甚至只在 AdaptationSet 上而 Representation 上为空。全都小写化后合并判断。
      const blobOf = (c) => `${c.contentType || ''} ${c.mimeType || ''} ${c.codecs || ''} ${c.subtype || ''}`.toLowerCase();
      const isVideo = (c) => {
        const b = blobOf(c);
        return b.includes('video') || b.includes('avc') || b.includes('hev') || b.includes('hvc')
            || b.includes('vp9') || b.includes('vp8') || b.includes('av01');
      };
      const isAudio = (c) => {
        const b = blobOf(c);
        return b.includes('audio') || b.includes('mp4a') || b.includes('ac-3') || b.includes('ec-3')
            || b.includes('opus') || b.includes('aac') || b.includes('vorbis');
      };
      const video = candidates.filter(isVideo).sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
      const audio = candidates.filter(isAudio).sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
      // v0.3.65:诊断日志 —— 一眼看出 manifest 里到底有没有音轨
      console.log(`[IG-SAVER-${VERSION}] parseDashMPA: ${candidates.length} reps → video=${video.length} audio=${audio.length}`
        + (audio.length === 0 ? ' (⚠️ 无音轨,可能 IG 该视频本就无声,或分类未命中)' : ''));
      return { video, audio, all: candidates };
    } catch (e) {
      console.warn(`[IG-SAVER-${VERSION}] parseDashMPA 失败:`, e);
      return null;
    }
  };

  // Media API - 必须传纯数字 mediaId
  const getMediaInfo = async (mediaId) => {
    // v0.3.58:无守卫,IG 自己判 404/200
    const appId = getAppID();
    if (!appId) {
      console.warn(`[IG-SAVER-${VERSION}] 无 APP_ID,跳过 Media API`);
      return null;
    }
    try {
      const res = await fetchWithFallback(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, {
        headers: { 'X-IG-App-ID': appId, Accept: '*/*' },
        credentials: 'include',
      });
      if (res.ok && !res.isHTML) {
        const data = await res.json();
        if (data?.items?.[0]) return data.items[0];
        // IG 返 {status:'fail'} 是 404,正常返回 null
        if (data?.status === 'fail') return null;
      }
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] getMediaInfo 异常:`, err);
    }
    return null;
  };

  const getStories = async (userId) => {
    const url = `https://www.instagram.com/graphql/query/?query_hash=15463e8449a83d3d60b06be7e90627c7&variables=${encodeURIComponent(JSON.stringify({ reel_ids: [String(userId)], precomposed_overlay: false }))}`;
    try {
      const res = await fetchWithFallback(url, { headers: { 'User-Agent': IG_MOBILE_UA }, credentials: 'include' });
      if (res.ok && !res.isHTML) return (await res.json())?.data || null;
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] getStories 异常:`, err);
    }
    return null;
  };

  const getHighlightStories = async (highlightId) => {
    const url = `https://www.instagram.com/graphql/query/?query_hash=45246d3fe16ccc6577e0bd297a5db1ab&variables=${encodeURIComponent(JSON.stringify({ highlight_reel_ids: [highlightId], precomposed_overlay: false }))}`;
    try {
      const res = await fetchWithFallback(url, { headers: { 'User-Agent': IG_MOBILE_UA }, credentials: 'include' });
      if (res.ok && !res.isHTML) return (await res.json())?.data || null;
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] getHighlightStories 异常:`, err);
    }
    return null;
  };

  const getUserId = async (username) => {
    try {
      const res = await fetchWithFallback(`https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(username)}`, { credentials: 'include' });
      if (res.ok && !res.isHTML) {
        const data = await res.json();
        const found = (data.users || []).find((u) => u.user?.username?.toLowerCase() === username.toLowerCase());
        if (found) return found.user;
      }
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] getUserId topsearch 异常:`, err);
    }
    try {
      const appId = getAppID();
      const res = await fetchWithFallback(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
        headers: appId ? { 'X-IG-App-ID': appId } : {},
        credentials: 'include',
      });
      if (res.ok && !res.isHTML) {
        const data = await res.json();
        if (data?.data?.user) {
          data.data.user.pk = data.data.user.id;
          return data.data.user;
        }
      }
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] getUserId web_profile 异常:`, err);
    }
    return null;
  };

  const getHDProfile = async (userId) => {
    try {
      const res = await fetchWithFallback(`https://www.instagram.com/api/v1/users/${userId}/info/`, {
        headers: { 'User-Agent': 'Instagram 307.0.0.34.111' },
        credentials: 'include',
      });
      if (res.ok && !res.isHTML) {
        const data = await res.json();
        if (data?.status === 'ok') {
          return data.user?.hd_profile_pic_url_info?.url || data.user?.profile_pic_url || null;
        }
      }
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] getHDProfile 异常:`, err);
    }
    return null;
  };

  // ============================================================
  // 下载工具
  // ============================================================
  // v0.3.58:在任何 IG 页都跑 harvest —— IG 主页 article 节点旁就注水了 GraphImage
  // 之前要求单帖页是错的,主页 article 节点 DOM 就有 display_resources 全数组
  // v0.3.58:不再限 shortcode(IG 主页注水 shortcode 路径不定)+ 加诊断 console
  const harvestFromPage = (targetShortcode) => {
    const result = [];
    const scripts = document.querySelectorAll('script[type="application/json"]');
    let diagnostic = [];
    for (const s of scripts) {
      const text = s.textContent || '';
      // v0.3.58:加 xdt_api__v1__media__shortcode__web_info 关键字
      if (!text.includes('image_versions2') && !text.includes('carousel_media')
          && !text.includes('video_versions') && !text.includes('display_resources')
          && !text.includes('xdt_api__v1__media__shortcode__web_info')
          && !text.includes('shortcode_media')) continue;
      let data;
      try { data = JSON.parse(text); } catch { continue; }

      // 诊断:记录注水根对象的关键字段
      const topKeys = Object.keys(data || {}).slice(0, 10);
      const hasXdt = !!data?.xdt_api__v1__media__shortcode__web_info;
      const hasSc = !!data?.shortcode_media;
      const hasCarousel = !!data?.carousel_media;
      const hasImgV2 = !!data?.image_versions2;
      if (hasXdt || hasSc || hasCarousel || hasImgV2) {
        diagnostic.push({ topKeys, hasXdt, hasSc, hasCarousel, hasImgV2, size: text.length });
      }

      // v0.3.72 三处修:
      //  1) collect(node, inheritedSc) —— 子节点继承父 shortcode(carousel 子节点自身没有 code/shortcode,
      //     v0.3.71 拿不到 shortcode → harvest 产出的 item.shortcode 全是 undefined → downloadItem 的
      //     HD cache 分支直接短路,graphql 路径的原图缓存永远用不上)
      //  2) isTarget 过滤 —— v0.3.71 收了 targetShortcode 参数但从不使用,feed 注水有多个帖时
      //     点 A 帖会连带下到 B 帖的图
      //  3) 新增 video_dash_manifest 分支 —— v0.3.71 完全不看 manifest,Reels 只拿到封面 jpg,
      //     且产出的 item 没有 _dashAudioUrl → runOne 的 mux 分支永远进不去
      const collect = (node, inheritedSc) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach((x) => collect(x, inheritedSc)); return; }

        const sc = node.shortcode || node.code || inheritedSc;
        const isTarget = !targetShortcode || !sc || sc === targetShortcode;

        const owner = node.owner?.username || node.user?.username || 'unknown';
        const takenAt = node.taken_at_timestamp || node.taken_at || Date.now() / 1000;
        const pk = node.id || node.pk;

        // v0.3.72(3):DASH 视频 —— 必须在 image_versions2 分支之前,视频帖不该下封面图
        if (pk && isTarget && node.video_dash_manifest && typeof parseDashMPA === 'function') {
          const parsed = parseDashMPA(node.video_dash_manifest);
          if (parsed?.video?.length) {
            const best = parsed.video[0];
            result.push({
              mediaId: pk, isVideo: true, url: best.url,
              shortcode: sc, owner, takenAt, idx: result.length + 1,
              _width: best.width || 0,
              _dashAudioUrl: parsed.audio?.[0]?.url || null,
              _dashManifest: node.video_dash_manifest,
              _source: 'page-harvest',
            });
            return;   // 视频帖不再推封面图
          }
        }

        if (pk && isTarget) {
          if (node.video_versions?.length) {
            const v = node.video_versions[0];
            if (v?.url) {
              result.push({
                mediaId: pk, isVideo: true, url: v.url,
                shortcode: sc, owner, takenAt, idx: result.length + 1,
                _width: v.width || 0, _source: 'page-harvest',
              });
            }
          }
          if (node.image_versions2?.candidates?.length) {
            const sorted = [...node.image_versions2.candidates].sort((a, b) => (b.width || 0) - (a.width || 0));
            const c = sorted[0];
            if (c?.url) {
              result.push({
                mediaId: pk, isVideo: false, url: c.url,
                shortcode: sc, owner, takenAt, idx: result.length + 1,
                _width: c.width || 0, _source: 'page-harvest',
              });
            }
          }
        }

        if (Array.isArray(node.carousel_media)) {
          node.carousel_media.forEach((m) => {
            if (m.video_versions?.length) {
              const v = m.video_versions[0];
              if (v?.url) result.push({
                mediaId: m.pk, isVideo: true, url: v.url,
                shortcode: sc, owner, takenAt, idx: result.length + 1,
                _width: v.width || 0, _source: 'page-harvest-carousel',
              });
            }
            if (m.image_versions2?.candidates?.length) {
              const sorted = [...m.image_versions2.candidates].sort((a, b) => (b.width || 0) - (a.width || 0));
              const c = sorted[0];
              if (c?.url) result.push({
                mediaId: m.pk, isVideo: false, url: c.url,
                shortcode: sc, owner, takenAt, idx: result.length + 1,
                _width: c.width || 0, _source: 'page-harvest-carousel',
              });
            }
          });
        }
        if (node.edge_sidecar_to_children?.edges) {
          node.edge_sidecar_to_children.edges.forEach((e) => collect(e.node, sc));
        }
        // 递归所有 data/xdt_api 包裹
        if (node.data) collect(node.data, sc);
        if (node.xdt_api__v1__media__shortcode__web_info) {
          const xdt = node.xdt_api__v1__media__shortcode__web_info;
          // v0.3.72:删掉 `if (xdt.items?.[0]) collect(xdt.items[0])`
          // 原代码 forEach 之后又单收 items[0] → 每个帖的第 1 张图必然被收两遍
          // (实测:单图帖 2 items,三图 carousel 6 items)
          if (Array.isArray(xdt.items)) xdt.items.forEach((it) => collect(it, sc));
        }
      };

      collect(data, null);
      // v0.3.72:命中目标帖才 break。v0.3.71 是 `if (result.length) break`,
      // 第一个注水 script 只要有任意媒体就 break → feed 上抓到别的帖就直接放弃目标帖
      const hitTarget = targetShortcode
        ? result.some((r) => r.shortcode === targetShortcode)
        : result.length > 0;
      if (hitTarget) break;
    }
    if (diagnostic.length) {
      console.log(`[IG-SAVER-${VERSION}] harvest 诊断 (${diagnostic.length} 个相关注水):`, JSON.stringify(diagnostic, null, 0).slice(0, 800));
    } else {
      console.log(`[IG-SAVER-${VERSION}] harvest 诊断: 0 个相关注水(script 里没 carousel_media/shortcode_media/xdt_api 字段)`);
    }
    return result;
  };

  const harvestHDFromPostPage = () => {
    try {
      const scripts = document.querySelectorAll('script[type="application/json"]');
      let count = 0;
      for (const s of scripts) {
        const text = s.textContent || '';
        if (!text.includes('display_resources') && !text.includes('image_versions2')) continue;
        let data;
        try { data = JSON.parse(text); } catch { continue; }
        const findAndHarvest = (node) => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) {
            for (const x of node) findAndHarvest(x);
            return;
          }
          // 主页 article 节点旁注水里可能套了 graphql response:{data:{shortcode_media:{...}}}
          // 把这种结构拆开,递归走
          if (node.data?.shortcode_media) {
            findAndHarvest(node.data.shortcode_media);
          }
          if (node.shortcode_media) {
            findAndHarvest(node.shortcode_media);
          }
          // GraphImage / GraphVideo / GraphSidecar 节点
          if (node.display_resources || node.image_versions2) {
            // v0.3.69:HD cache 只允许存**原图**。原代码把 display_resources 全部按索引写入,
            //    导致 __0 可能命中 640w 缩略图,下载到的不是原图。
            //    修法:display_resources 只取**最宽的一张**写进 __0,且宽度 < 1080 时直接不写
            //    (display_resources 本身最多 1080w,达不到原图级别,宁可不写也不要写错的)。
            const shortcodeKey = node.shortcode || node.code;
            const pathMatch = location.pathname.match(/\/(?:[\w.\-_]+\/)?p\/?([\w-]+)/);
            const fallbackSC = pathMatch?.[1];
            const cacheSC = shortcodeKey || fallbackSC || 'unknown';
            // 宽度取值口径跟 pickMaxImage 对齐:width 优先,再 config_width
            const widthOf = (c) => (c?.width || c?.config_width || 0);

            // ---- display_resources:只写最宽的,且必须 >= 1080 ----
            const dr = node.display_resources || [];
            if (dr.length) {
              const sortedDr = [...dr].sort((a, b) => widthOf(b) - widthOf(a));
              const bestDr = sortedDr[0];
              const bw = widthOf(bestDr);
              const burl = bestDr?.src || bestDr?.url;
              if (burl && bw >= 1080) {
                hdCacheSet(`${cacheSC}__0`, burl, bw);
                count++;
              } else if (burl) {
                console.log(`[IG-SAVER-${VERSION}] display_resources 最宽仅 ${bw}w(<1080),不写 cache,避免污染原图位`);
              }
            }

            // ---- image_versions2:原图字段,取最宽写入 __hd 和 __0(覆盖 display_resources 的缩略图) ----
            const iv = node.image_versions2?.candidates || [];
            if (iv.length) {
              const sortedIv = [...iv].sort((a, b) => widthOf(b) - widthOf(a));
              const bestIv = sortedIv[0];
              const iw = widthOf(bestIv);
              const iurl = bestIv?.url || bestIv?.src;
              if (iurl) {
                hdCacheSet(`${cacheSC}__hd`, iurl, iw);
                // v0.3.69:__0 是 downloadItem 主要查的索引位,必须写原图而不是缩略图
                hdCacheSet(`${cacheSC}__0`, iurl, iw);
                count++;
                console.log(`[IG-SAVER-${VERSION}] HD cache 写入 ${cacheSC}: ${iw}w ← 原图`);
              }
            }
          }
          // 递归 GraphSidecar 子节点
          if (node.edge_sidecar_to_children?.edges) {
            for (const e of node.edge_sidecar_to_children.edges) findAndHarvest(e.node);
          }
        };
        findAndHarvest(data);
      }
      if (count) console.log(`[IG-SAVER-${VERSION}] HD 候选 harvest: ${count} 个`);
      return count;
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] harvestHD 失败:`, err);
      return 0;
    }
  };

  const downloadBlob = async (url, filename, useGMDownload = false) => {
    const finalURL = replaceSameOriginHost(url);
    // v0.3.0:CDN 图片是公开资源,带 credentials 反而 CORS 拒。两种都试。
    const tryOnce = async (creds) => {
      const res = await fetch(finalURL, { credentials: creds });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    };
    const tryDownload = async () => {
      try { return await tryOnce('omit'); }
      catch (e1) {
        console.warn(`[IG-SAVER-${VERSION}] fetch omit 失败,试 include:`, e1.message);
        try { return await tryOnce('include'); }
        catch (e2) {
          console.warn(`[IG-SAVER-${VERSION}] fetch include 失败,试 GM_xhr:`, e2.message);
          if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => {
              GM_xmlhttpRequest({
                method: 'GET', url: finalURL,
                responseType: 'blob',
                onload: (r) => r.status >= 200 && r.status < 300
                  ? resolve(r.response)
                  : reject(new Error(`HTTP ${r.status}`)),
                onerror: (err) => reject(new Error('GM_xhr failed')),
              });
            });
          }
          throw e2;
        }
      }
    };

    if (useGMDownload) {
      return new Promise((resolve) => {
        GM_download({
          url: finalURL,
          name: filename,
          onload: () => resolve(true),
          onerror: () => resolve(false),
        });
      });
    }
    try {
      const blob = await tryDownload();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { a.remove(); URL.revokeObjectURL(a.href); } catch {}
      }, 250);
      return true;
    } catch (err) {
      console.error(`[IG-SAVER-${VERSION}] download failed:`, err.message, finalURL);
      return false;
    }
  };

  // ============================================================
  // CSS
  // ============================================================
  GM_addStyle(`
    .ig-saver-fab {
      position: absolute;
      /* v0.3.66:32px → 26px(缩小以塞进图片右缘外的窄边距) */
      width: 26px; height: 26px; border-radius: 50%;
      background: rgba(0,0,0,.7); color: #fff;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; z-index: 9999;
      backdrop-filter: blur(4px);
      transition: transform .15s, background .15s;
    }
    .ig-saver-fab:hover { background: rgba(0,0,0,.9) !important; transform: scale(1.1); }
    .ig-saver-fab:active { transform: scale(.95); }
    /* v0.3.68:两个按钮改为**竖排**(column)—— 用户要求。
       顺带好处:胶囊宽度从 ~66px 降到 ~36px,更贴图片右缘,也不容易压到图片 */
    .ig-saver-fab-pair { display: flex; flex-direction: column; gap: 4px; }
    .ig-saver-fab-pair .ig-saver-fab { position: relative; }
    .ig-saver-progress {
      position: fixed; top: 20px; right: 20px; z-index: 2147483647;
      background: rgba(0,0,0,.85); color: #fff; padding: 12px 16px;
      border-radius: 8px; font: 13px/1.5 system-ui;
      box-shadow: 0 4px 12px rgba(0,0,0,.3);
    }
  `);

  let progressEl = null;
  const showProgress = (text) => {
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.className = 'ig-saver-progress';
      document.body.appendChild(progressEl);
    }
    progressEl.textContent = text;
  };
  const hideProgress = () => {
    if (progressEl) {
      progressEl.remove();
      progressEl = null;
    }
  };

  // ============================================================
  // 下载一个 item
  // ============================================================
  // v0.3.58:抽 getFileName 工具
  // v0.3.58:对齐 IG Helper 4.2.1 14 个占位符
  // v0.3.58:对齐 IG Helper 4.2.1 — 4 个关键占位符的真值
  //  1. USERNAME = item.owner (字符串)
  //  2. UID = item.uid || mediaId 拆 user_id (纯数字,IG mediaId 格式 pk_userid)
  //  3. ORIGINAL_NAME = url pathname 最后段 (如 840378709_1837...)
  //  4. ORIGINAL_NAME_FIRST = ORIGINAL_NAME 按 _ 拆第一段
  const getFileName = (item, ext) => {
    const ts = (item.takenAt || Date.now() / 1000) * 1000;
    const date = new Date(ts);
    const year = String(date.getFullYear());
    const year2 = year.slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    // 1. UID:从 item.uid 拿纯数字 user.pk,否则从 mediaId 拆 user_id
    let uid = item.uid;
    if (!uid && item.mediaId) {
      const parts = String(item.mediaId).split(/[_-]/);
      uid = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    }
    if (!uid) uid = 'unknown';
    // 2. ORIGINAL_NAME:从 item.url 拿 pathname 最后段
    let originalName = 'unknown';
    if (item.url) {
      try {
        const path = new URL(item.url).pathname;
        const lastSeg = path.split('/').filter(s => s.length).pop() || 'unknown';
        originalName = lastSeg.split('.').slice(0, -1).join('.') || lastSeg;
      } catch { /* invalid url */ }
    }
    const originalNameFirst = originalName.split('_')[0] || 'unknown';
    const sourceType = item._sourceType || 'Post';
    return renderTemplate(getTemplate(), {
      USERNAME: item.owner || 'unknown',
      SOURCE_TYPE: sourceType,
      SHORTCODE: item.shortcode || 'unknown',
      YEAR: year,
      '2-YEAR': year2,
      MONTH: month,
      DAY: day,
      HOUR: hour,
      MINUTE: minute,
      SECOND: second,
      ORIGINAL_NAME: originalName,
      ORIGINAL_NAME_FIRST: originalNameFirst,
      INDEX: item.idx || 1,
      UID: uid,
    }) + '.' + ext;
  };

  // v0.3.58:DASH 视频下载(video-only mp4 + audio-only m4a → Mediabunny mux → 完整 mp4)
  const downloadDashVideo = async (item, opts = {}) => {
    const { silent = false } = opts;
    if (!item._dashAudioUrl) {
      // v0.3.65:走到这里说明没音轨 —— 明确告诉用户「为什么没合并」,而不是静默出一个无声视频
      if (item._dashManifest) {
        console.log(`[IG-SAVER-${VERSION}] 该视频 manifest 内无音轨(IG 数据本身无声轨),跳过合并`);
      } else {
        console.log(`[IG-SAVER-${VERSION}] 该视频无 DASH manifest,直接下 video_url(可能本就含音频)`);
      }
      return await downloadItem(item, opts);
    }
    try {
      if (!silent) showProgress(`下视频+音频 ${item.shortcode} #${item.idx}…`);
      const [vBuf, aBuf] = await Promise.all([
        fetchArrayBuffer(item.url),
        fetchArrayBuffer(item._dashAudioUrl),
      ]);
      // v0.3.58:诊断 — 任一 buf 为空/太小就走 fallback
      const vOK = vBuf && vBuf.byteLength > 1000;
      const aOK = aBuf && aBuf.byteLength > 100;
      console.log(`[IG-SAVER-${VERSION}] DASH fetch: video=${vOK ? vBuf.byteLength : 'FAIL'}B, audio=${aOK ? aBuf.byteLength : 'FAIL'}B`);
      if (!vOK || !aOK) {
        throw new Error(`DASH fetch 失败 video=${vOK} audio=${aOK},fallback 下分文件`);
      }
      if (!silent) showProgress(`Mediabunny mux ${item.shortcode} #${item.idx}…`);
      // v0.3.58:timeout 30s 防 Mediabunny 卡死
      const muxPromise = muxDashVideoAudioToMp4(vBuf, aBuf);
      const mergedBuf = await Promise.race([
        muxPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('mux timeout 30s')), 30000)),
      ]);
      if (!mergedBuf || mergedBuf.byteLength < 1000) {
        throw new Error(`mux 输出过小 ${mergedBuf?.byteLength || 0}B,可能 Mediabunny 拼接坏文件`);
      }
      const mergedBlob = new Blob([mergedBuf], { type: 'video/mp4' });
      const filename = getFileName(item, 'mp4');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(mergedBlob);
      a.download = filename;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { a.remove(); URL.revokeObjectURL(a.href); } catch {} }, 250);
      if (!silent) hideProgress();
      console.log(`[IG-SAVER-${VERSION}] ✅ mux 完成 ${mergedBuf.byteLength}B → ${filename}`);
      return true;
    } catch (err) {
      console.error(`[IG-SAVER-${VERSION}] DASH mux failed:`, err.message);
      if (!silent) hideProgress();
      const baseFilename = getFileName(item, 'mp4').replace(/\.mp4$/, '');
      // v0.3.58:fallback 不再静默,先下分文件 + 提示用户
      await downloadBlob(item.url, baseFilename + '.video.mp4', cfg.useGMDownload);
      await downloadBlob(item._dashAudioUrl, baseFilename + '.audio.m4a', cfg.useGMDownload);
      // v0.3.58:对齐 IG Helper 4.2.1 fallback 行为 — IG DASH manifest 在浏览器内 mux 不可靠
      //    多数情况下,IG Helper 同样会下分文件让用户本地 ffmpeg 拼
      toast(`⚠️ DASH mux 不可靠(IG Helper 同问题)\n已下分文件,本地拼:\nffmpeg -i "${baseFilename}.video.mp4" -i "${baseFilename}.audio.m4a" -c copy "${baseFilename}.mp4"`, 12000, 'warn');
      return true;
    }
  };

  const downloadItem = async (item, opts = {}) => {
    const { silent = false } = opts;
    let url = item.url;

    // v0.3.58:优先查 HD cache(单帖页 harvest 进来的 1440w)
    if (item.shortcode && item.idx !== undefined) {
      const hdKey = `${item.shortcode}__${item.idx - 1}`;
      const hd = hdCacheGet(hdKey);
      if (hd?.url) {
        // v0.3.69:保险 —— cache 里若残留历史缩略图(<1080),宁可丢弃也不能用它替换原图 URL
        if ((hd.width || 0) >= 1080) {
          console.log(`[IG-SAVER-${VERSION}] HD cache 命中: ${hd.width}w ← 原图`);
          url = hd.url;
        } else {
          console.log(`[IG-SAVER-${VERSION}] HD cache 丢弃: ${hd.width}w < 1080(疑似缩略图),用主路径 URL`);
        }
      } else {
        const hdKey2 = `${item.shortcode}__hd`;
        const hd2 = hdCacheGet(hdKey2);
        if (hd2?.url && (hd2.width || 0) >= 1080) {
          console.log(`[IG-SAVER-${VERSION}] HD cache 命中(sidecar): ${hd2.width}w`);
          url = hd2.url;
        }
      }
    }



    // 普通图 / 普通视频
    if (!url) {
      if (!silent) toast(`❌ 找不到 ${item.shortcode} #${item.idx} 的 URL`, 3000, 'error');
      return false;
    }

    // v0.3.58:扩展名判断 + 走 getFileName
    const ext = item.isVideo || /\.(mp4|webm|mov)(\?|$|#)/i.test(url) ? 'mp4' : 'jpg';
    const filename = getFileName(item, ext);

    if (!silent) showProgress(`下载 ${item.shortcode} #${item.idx} 中…`);
    const ok = await downloadBlob(url, filename, cfg.useGMDownload);
    if (!silent) hideProgress();
    return ok;
  };

  // ============================================================
  // v0.2.0 新增:Feed 内联 FAB
  // ============================================================
  const SVG_DW = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/></svg>';
  const SVG_DW_ALL = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 13v9"/><path d="m8 17 4 4 4-4"/><path d="M4 7h16"/><path d="M4 11h10"/></svg>';

  const MOUNT_ATTR = 'data-ig-saver-mounted';

  const getShortcodeFromArticle = (article) => {
    const a = article.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    if (!a) return null;
    const m = (a.getAttribute('href') || '').match(/\/(p|reel|reels)\/([\w-]+)/);
    return m ? m[2] : null;
  };

  const getVisibleSlideIndex = (article) => {
    const uls = article.querySelectorAll('ul');
    for (const ul of uls) {
      const lis = ul.querySelectorAll('li');
      if (lis.length < 2) continue;
      for (let i = 0; i < lis.length; i++) {
        const tf = (lis[i].style.transform || '') + (lis[i].getAttribute('style') || '');
        if (tf.includes('translateX') && tf.includes('(0%)')) return i;
        if (tf.includes('translateX(-0%')) return i;
      }
    }
    return 0;
  };

  // v0.3.58:从 article 右上角 absolute → 插入到 IG 自带工具栏(分享图标后面)
  //    避免压在"关注/头像"按钮上。IG 2026 工具栏 selector:
  //    svg[aria-label="分享"] / svg[aria-label="Share"] / [data-testid="post-share-button"]
  // v0.3.58:姐姐错了,IG 没改版,是 v0.3.34 改了 inline-flex 引入的 bug
  //    改回 v0.3.25/v0.3.33 验证过的 absolute 位置(top:12 right:12,32x32 圆黑底)
  //    跟 v0.3.33 完全一致
  // v0.3.58:把按钮插到 IG 分享按钮后面(用户要求)
  //    5 层 fallback 找 share 按钮,找不到退到右下角
  // v0.3.62:定位「媒体容器」—— 按钮要挂在图片/视频那个框里(用户截图:红框标的位置,在图片内部左上角)
  //    做法:几何定位,零 IG class 名依赖(复刻 deepExtractMaxHighImages 已验证的头像/缩略图排除规则)
  //    IG 改版不会因为 class 名变了就失效 —— 这正是 v0.3.55 编 5 层 selector 编死的教训
  //
  // v0.3.61 的 bug:要求容器 `box.parentElement === article`(必须是 article 直接子节点)。
  //    IG 单帖页真实结构里,媒体图往上 2 层**往往还不到 article 直接子级**(中间隔了缩放/裁切层),
  //    于是命中不了 → 一路兜底回 article → 按钮骑在头像栏上(用户截图实证)。
  //
  // v0.3.62 修法:不再要求直接子级。改成从媒体图往上找,**取第一个「几何上就是图片那个框」的容器**:
  //    判定 = 该容器的 rendered 尺寸 ≈ 媒体图尺寸(宽高都不小于图片的 95%),且仍在 article 内。
  //    这样按钮的 absolute 定位坐标系就等于图片框本身,自然落在图片内部左上角。
  // v0.3.64:整段重写。v0.3.60-0.3.63 四版全错,根因是「先找媒体容器再挂上去」这个思路本身不可靠。
  // 用户 console 日志实证(IG-SAVER-0.3.63):
  //   「无媒体根节点(候选 0),兜底 article」← 按 getBoundingClientRect 宽高筛图,
  //        IG feed 图懒加载,未进视口时 rect=0 → 所有候选被毙掉
  //   「兜底 article —— 向上没找到媒体框」← 「容器宽度≈article 宽度就停」判据,
  //        但 IG 媒体容器就是 100% 宽(=article 宽)→ 第一层就 break → chosen 永远 null
  //
  // v0.3.64 思路:【不找容器】。用媒体图 getBoundingClientRect() 直接算它相对 article 的偏移,
  // 按钮 absolute 定位到该坐标内缩 12px —— 就是图片左上角内部。
  // DOM 套几层、carousel、视频、懒加载,全都不影响。
  // 选图信号改用 srcset 最大宽度(懒加载时也可靠,不依赖渲染尺寸):
  //   头像 = 32w/58w/150w,媒体图 = 640w/750w/1080w/1440w → 阈值 500w

  // v0.3.70:统一 srcset 描述符解析。
  // 原代码三处只认 w 描述符,遇到 x 描述符(2x/3x)全部返回 0。
  // 症状:用户日志 `deepExtract: top 3: ['0w VIS']` —— 宽度解析失败,排序失效,拿不到原图。
  // 本函数:w 描述符直接取数;x 描述符乘以基准宽度(naturalWidth/clientWidth);
  //          两者都没有时用 img 真实渲染宽度兜底。
  const parseSrcsetWidth = (desc, imgEl) => {
    try {
      const d = String(desc || '').trim();
      // 描述符为空 → 直接用 img 真实宽度兜底(而不是返回 0,否则排序失效)
      if (!d) return imgEl ? (imgEl.naturalWidth || imgEl.clientWidth || imgEl.width || 0) : 0;
      const wm = d.match(/(\d+(?:\.\d+)?)w/);
      if (wm) return Math.round(parseFloat(wm[1]));
      const xm = d.match(/(\d+(?:\.\d+)?)x/);
      if (xm) {
        const base = (imgEl && (imgEl.naturalWidth || imgEl.clientWidth || imgEl.width)) || 0;
        return base ? Math.round(parseFloat(xm[1]) * base) : 0;
      }
      if (imgEl) return imgEl.naturalWidth || imgEl.clientWidth || imgEl.width || 0;
      return 0;
    } catch { return 0; }
  };

  const maxSrcsetWidth = (el) => {
    try {
      const ss = el.getAttribute('srcset') || '';
      let mx = 0;
      for (const part of ss.split(',')) {
        const w = parseSrcsetWidth(part.trim(), el);
        if (w > mx) mx = w;
      }
      return mx;
    } catch { return 0; }
  };

  const pickMediaTarget = (article) => {
    const imgs = Array.from(article.querySelectorAll('img[src], img[srcset]'));
    // v0.3.71:统一排除头像 —— 三条路径都必须过滤。
    // v0.3.70 回归根因:只有第 1 条(srcset≥500)有 alt/header 过滤,后两条没有;
    // 当第 1 条落空掉到第 2 条时会选中用户头像 → 按钮坐标跳到页面左边(用户反馈「按钮自动到左边了」)。
    const isAvatar = (img) => {
      if (img.closest('header')) return true;
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      if (/profile picture|个人资料|头像|profile photo|用户照片/.test(alt)) return true;
      const blob = (img.src || '') + ' ' + (img.getAttribute('srcset') || '');
      if (/avatar|s150x150|s320x320/.test(blob)) return true;
      return false;
    };

    // 1) srcset 宽度信号(懒加载也可靠)
    let best = null, bestW = 0;
    for (const img of imgs) {
      if (isAvatar(img)) continue;
      const mw = maxSrcsetWidth(img);
      if (mw >= 500 && mw > bestW) { bestW = mw; best = img; }
    }
    if (best) return best;

    // 2) 退路:非头像里渲染尺寸最大的图(v0.3.71:加 isAvatar 过滤 + 宽度下限提到 200)
    let bw = 0;
    for (const img of imgs) {
      if (isAvatar(img)) continue;
      const r = img.getBoundingClientRect();
      if (r.width > bw) { bw = r.width; best = img; }
    }
    if (best && bw >= 200) return best;

    // 3) 视频帖
    const vid = article.querySelector('video');
    if (vid) {
      const r = vid.getBoundingClientRect();
      if (r.width >= 200) return vid;
    }
    // 4) 全落空 → 明确返回 null,由 injectArticleFAB 打日志并下个 tick 重试
    //    (绝不用「猜测」的目标去定位,否则按钮会跑到莫名其妙的位置)
    console.log(`[IG-SAVER-${VERSION}] pickMediaTarget: 没找到媒体图(${imgs.length} 个 img 全被判定为头像/太小),稍后重试`);
    return null;
  };

  const placeInArticle = (wrap, article, target) => {
    try {
      const ir = target.getBoundingClientRect();
      const ar = article.getBoundingClientRect();
      if (!ir.width || !ir.height || !ar.width || !ar.height) return false;
      if (ir.width < 40 || ir.height < 40) return false;
      wrap.style.position = 'absolute';
      // v0.3.66:按钮挪到图片**右侧外部**(用户红框标注:图片右缘外的空白边距,不压图片)
      //    top  = 图片顶部 + 12px(与图片顶对齐)
      //    left = 图片右缘 + 8px(完全在图片外,留一点间距)
      const TOP_INSET = 12;    // 距图片顶部
      // v0.3.67:SIDE_GAP 8 → 14 —— 用户截图红框实测在图片右缘外 x=763..833(离右缘 753 有 10px 起点),
      //    而按钮总宽约 66px;gap=8 时按钮左边会落在 x=724,仍压住图片 29px。
      //    gap=14 才能让按钮整体落在图片右缘之外。
      // v0.3.68:14 → 10 —— 竖排后按钮宽度从 66px 降到 36px,可以更贴近图片边缘
      const SIDE_GAP = 10;     // 距图片右缘
      wrap.style.top = Math.round((ir.top - ar.top) + TOP_INSET) + 'px';
      wrap.style.left = Math.round((ir.right - ar.left) + SIDE_GAP) + 'px';
      return true;
    } catch { return false; }
  };

  const repositionMountedFABs = () => {
    document.querySelectorAll('.ig-saver-fab-pair[data-ig-reposition]').forEach((wrap) => {
      const a = wrap.__igArticle, t = wrap.__igTarget;
      if (a && t && document.contains(a)) placeInArticle(wrap, a, t);
    });
  };

  const injectArticleFAB = (article) => {
    if (article.getAttribute(MOUNT_ATTR) === '1') return;
    const shortcode = getShortcodeFromArticle(article);
    if (!shortcode) return;

    // v0.3.64:选媒体根 + 算坐标;图片没加载出尺寸就 return,不设 MOUNT_ATTR → 1s 后 tick 自动重试
    const target = pickMediaTarget(article);
    if (!target) return;

    article.style.position = 'relative';

    const wrap = document.createElement('div');
    wrap.className = 'ig-saver-fab-pair';
    // v0.3.63:图片框内左上角(0.3.58 右下 → 0.3.60 误挂 article → 0.3.61/0.3.62 兜底 → 0.3.63 真挂)
    // v0.3.66:按钮缩小(32→26px,间距 6→4,padding 4x6→3x5)—— 两按钮总宽约 60px,
    //    配合「图片右侧外部」定位,才能塞进图片右缘外那条窄边距
    // v0.3.68:竖排胶囊 —— 圆角收小一点更贴合竖长条形状
    wrap.style.cssText = 'position:absolute;z-index:9999;display:flex;flex-direction:column;gap:4px;background:rgba(0,0,0,0.65);border-radius:16px;padding:4px 4px;backdrop-filter:blur(4px);';
    wrap.dataset.pos = 'img-right-outside';
    wrap.dataset.igReposition = '1';

    // 算不出位置(图片懒加载中)→ 放弃本次挂载,下个 tick 自动重试
    if (!placeInArticle(wrap, article, target)) {
      console.log(`[IG-SAVER-${VERSION}] ${shortcode}: 图片未加载出尺寸,稍后重试定位`);
      return;
    }

    const fabCur = document.createElement('div');
    fabCur.className = 'ig-saver-fab ig-saver-fab-current';
    fabCur.title = 'IG Saver: 下载当前';
    fabCur.innerHTML = SVG_DW;
    fabCur.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); await runDownloadCurrent(article, shortcode); });

    const fabAll = document.createElement('div');
    fabAll.className = 'ig-saver-fab ig-saver-fab-all';
    fabAll.title = 'IG Saver: 下载全部';
    fabAll.innerHTML = SVG_DW_ALL;
    fabAll.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); await runDownloadAll(article, shortcode); });

    wrap.appendChild(fabCur);
    wrap.appendChild(fabAll);
    // 坐标已由 placeInArticle 算好(相对 article),直接挂 article
    wrap.__igArticle = article;
    wrap.__igTarget = target;
    article.setAttribute(MOUNT_ATTR, '1');
    article.appendChild(wrap);
  };

  const runDownloadCurrent = async (article, shortcode) => {
    toast(`⏳ 解析 ${shortcode} …`, 1500);
    // v0.3.58:深挖 article 节点所有 img(找最高位原图)
    let dom = deepExtractMaxHighImages(article, shortcode);
    if (!dom || !dom.items.length) {
      dom = getPostMediaFromArticle(article, shortcode);
    }
    if (dom && dom.items.length) {
      const best = dom.items[0];
      console.log(`[IG-SAVER-${VERSION}] DOM deep-extract 命中 ${dom.items.length} items,top=${best._width || '?'}w`);
      const ok = await downloadItem(best);
      const width = best._width || '?';
      toast(ok ? `✅ 已保存 ${shortcode} (${width}w)` : `❌ 保存失败`, 3000, ok ? 'success' : 'error');
      return;
    }
    const post = await getPostMedia(shortcode);
    if (!post.items.length) {
      toast(`❌ ${shortcode} 找不到媒体(看 console [IG-SAVER-${VERSION}] 日志)`, 4000, 'error');
      return;
    }
    const idx = getVisibleSlideIndex(article);
    const item = post.items[idx] || post.items[0];
    const ok = await downloadItem(item);
    toast(ok ? `✅ 已保存 ${shortcode} #${item.idx}` : `❌ ${shortcode} #${item.idx} 保存失败`, 3000, ok ? 'success' : 'error');
  };

  // v0.3.2 新增:深挖 article 节点所有 img(包括隐藏),按 width 排序取最高位
  // IG 主页 lazy load 时,所有候选图都在 DOM 中(只是当前轮播只显示 1 张)
  const deepExtractMaxHighImages = (article, shortcode) => {
    try {
      if (!article) return null;
      const imgs = article.querySelectorAll('img[src], img[srcset]');
      if (!imgs.length) return null;

      // 收集所有有效 url + width
      const candidates = [];
      const seen = new Set();
      for (const img of imgs) {
        const alt = (img.getAttribute('alt') || '').trim();
        const srcset = img.getAttribute('srcset') || '';
        const src = img.src || '';

        // 排除头像 / 缩略图
        if (src && (src.includes('avatar') || src.includes('s150x150') || src.includes('s320x320'))) continue;

        // 解析 srcset
        const sources = [];
        if (srcset) {
          for (const c of srcset.split(',').map(s => s.trim()).filter(Boolean)) {
            const parts = c.split(' ');
            const url = parts[0];
            const w = parseSrcsetWidth(parts[1], img);
            sources.push({ url, width: w });
          }
        }
        if (src && !srcset) sources.push({ url: src, width: 0 });

        for (const s of sources) {
          if (!s.url || seen.has(s.url)) continue;
          // 排除 IG 头像 + 缩略图关键字
          if (s.url.includes('avatar')) continue;
          if (/_s\d+x\d+_/.test(s.url) && (s.width || 0) <= 320) continue;
          if (/\?stp=/.test(s.url)) continue; // IG 缩略图标识 stp 参数

          seen.add(s.url);
          candidates.push({
            url: s.url,
            width: s.width,
            alt,
            isVisible: img.offsetParent !== null,
            element: img,
          });
        }
      }

      if (!candidates.length) return null;

      // 优先可见 + 宽的优先;其次 + 宽度
      candidates.sort((a, b) => {
        if (a.isVisible !== b.isVisible) return b.isVisible - a.isVisible; // 可见优先
        return (b.width || 0) - (a.width || 0); // 然后宽度
      });

      console.log(`[IG-SAVER-${VERSION}] deepExtract: 找到 ${candidates.length} 个候选,top 3:`,
        candidates.slice(0, 3).map(c => `${c.width}w ${c.isVisible ? 'VIS' : 'hidden'}`));

      const items = [];
      for (let i = 0; i < Math.min(candidates.length, 10); i++) { // 最多 10 张
        const c = candidates[i];
        if (!c.url) continue;
        items.push({
          mediaId: shortcode,
          isVideo: false,
          url: c.url,
          shortcode,
          owner: 'current_page',
          takenAt: Date.now() / 1000,
          idx: items.length + 1,
          _width: c.width,
        });
      }
      if (!items.length) return null;
      return {
        mediaId: shortcode, shortcode, owner: 'current_page',
        takenAt: Date.now() / 1000, items, _source: 'deep-extract',
      };
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] deepExtract 失败:`, err);
      return null;
    }
  };

  // v0.2.7 新增:从 article 节点拿当前可见图片(主路,保证能下)
  const getPostMediaFromArticle = (article, shortcode) => {
    try {
      if (!article) return null;
      const imgs = article.querySelectorAll('img[src]');
      if (!imgs.length) return null;
      const items = [];
      for (const img of imgs) {
        const alt = (img.getAttribute('alt') || '').trim();
        const srcset = img.getAttribute('srcset') || img.src || '';
        if (!srcset) continue;
        const candidates = srcset.split(',').map(s => s.trim()).filter(Boolean);
        let bestUrl = '', bestWidth = 0;
        for (const c of candidates) {
          const parts = c.split(' ');
          const url = parts[0];
          const w = parseSrcsetWidth(parts[1], img);
          if (w > bestWidth) { bestWidth = w; bestUrl = url; }
        }
        if (!bestUrl) bestUrl = img.src;
        if (bestUrl.includes('avatar') || bestUrl.includes('s150x150') || bestUrl.includes('s320x320')) continue;
        if (!alt && bestWidth <= 320) continue;
        if (items.length === 0) {
          items.push({
            mediaId: shortcode, isVideo: false, url: bestUrl,
            shortcode, owner: 'current_page',
            takenAt: Date.now() / 1000, idx: 1,
          });
          break;
        }
      }
      if (!items.length) return null;
      return {
        mediaId: shortcode, shortcode, owner: 'current_page',
        takenAt: Date.now() / 1000, items, _source: 'dom-current-img',
      };
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] DOM article 拿图失败:`, err);
      return null;
    }
  };

  const getVideoFromArticle = (article, shortcode) => {
    try {
      if (!article) return null;
      const videos = article.querySelectorAll('video');
      for (const v of videos) {
        const src = v.src || v.querySelector('source')?.src || '';
        if (src && src.startsWith('blob:')) continue;
        if (src && /\.(mp4|webm)/.test(src)) {
          return {
            mediaId: shortcode, isVideo: true, url: src,
            shortcode, owner: 'current_page',
            takenAt: Date.now() / 1000, idx: 1,
          };
        }
      }
      return null;
    } catch {}
    return null;
  };

    const runDownloadAll = async (article, shortcode) => {
    toast(`⏳ 解析 ${shortcode} …`, 1500);

    // v0.3.9 优先级:page 注水 harvest(image_versions2/carousel_media 含 1440w)> graphql > DOM deep-extract
    let post = null;

    // 0. 先挖 page 注水
    const harvested = harvestFromPage(shortcode);
    if (harvested.length) {
      console.log(`[IG-SAVER-${VERSION}] page-harvest 命中 ${harvested.length} items,top widths:`,
        harvested.map(i => i._width).join(','));
      post = {
        mediaId: harvested[0].mediaId, shortcode, owner: harvested[0].owner,
        takenAt: harvested[0].takenAt, items: harvested,
      };
    }

    // 1. harvest 失败 → 试 graphql
    if (!post) {
      console.log(`[IG-SAVER-${VERSION}] page-harvest 失败 → 试 graphql...`);
      post = await getPostMedia(shortcode);
      if (post.items.length) {
        console.log(`[IG-SAVER-${VERSION}] graphql 命中 ${post.items.length} items`);
      }
    }

    // 2. graphql 失败 → DOM deep-extract
    if ((!post || !post.items.length) && article) {
      const deep = deepExtractMaxHighImages(article, shortcode);
      if (deep && deep.items.length) {
        console.log(`[IG-SAVER-${VERSION}] graphql 失败 → DOM deep-extract 命中 ${deep.items.length} items`);
        post = deep;
      }
    }

    if (!post || !post.items.length) {
      toast(`❌ ${shortcode} 找不到媒体(看 console [IG-SAVER-${VERSION}] 日志)`, 4000, 'error');
      return;
    }

    // v0.3.58:并行下载 3 个一组(用户实测 2 太慢,4 触发风控,3 是稳的折中)
    const PARALLEL = 3;
    let ok = 0;
    const errors = [];
    const runOne = async (item) => {
      let r;
      if (item.isVideo) {
        if (item._dashAudioUrl) {
          // v0.3.58:DASH manifest 完整 → mux
          console.log(`[IG-SAVER-${VERSION}] DASH 视频 #${item.idx},开始 mux video+audio...`);
          r = await downloadDashVideo(item, { silent: true });
        } else {
          // v0.3.58:isVideo 但没 _dashAudioUrl → IG 视频无音轨(部分 Reels)或 manifest 解析失败
          //    区分 2 种:
          //    A. video_dash_manifest 有,但 parseDashMPA 没拿到 audio(IG 视频本身可能没音轨)
          //    B. video_dash_manifest 也没,只有 video_url 或 video_versions
          //    两种都先下 video_url,然后看 item._noAudioTrack 决定
          // v0.3.72:字段名修正。v0.3.71 读 item.video_dash_manifest,但 extractPostItems / 新增的 harvest
      //    分支产出的字段叫 _dashManifest → 这个判断恒 false → 无音轨 Reels 静默走 downloadItem
      //    直接下 DASH video-only,用户拿到无声视频且无任何提示(v0.3.65 想修的问题在这条分支上没修到)
          if (item._dashManifest && !item._dashAudioUrl) {
            console.log(`[IG-SAVER-${VERSION}] 视频 #${item.idx} DASH 解析只到 video,无 audio(IG Reels 无音轨)`);
          } else {
            console.log(`[IG-SAVER-${VERSION}] 视频 #${item.idx} 走 video_url/video_versions(无 DASH manifest)`);
          }
          r = await downloadItem(item, { silent: true });
        }
      } else {
        r = await downloadItem(item, { silent: true });
      }
      return { item, r };
    };
    for (let i = 0; i < post.items.length; i += PARALLEL) {
      const chunk = post.items.slice(i, i + PARALLEL);
      const results = await Promise.all(chunk.map(runOne));
      for (const { item, r } of results) {
        if (r) ok++;
        else errors.push(item.idx || '?');
      }
    }
    if (ok === post.items.length) {
      toast(`✅ ${shortcode}: ${ok}/${post.items.length} 已保存${harvested.length ? '(原图)' : ''}`, 4000, 'success');
    } else {
      toast(`⚠️ ${shortcode}: ${ok}/${post.items.length} 成功,失败 #${errors.join(',#')}`, 5000, 'warn');
    }
  };

  const mountFeedFABs = () => {
    document.querySelectorAll('article:not([' + MOUNT_ATTR + '="1"])').forEach(injectArticleFAB);
    Array.from(document.querySelectorAll('section:not([hidden]) > main > div > div > div > div > div > hr'))
      .filter(hr => hr.offsetParent !== null)
      .forEach((hr) => {
        const article = hr.parentElement?.parentElement?.parentElement?.parentElement;
        if (article && article.tagName === 'ARTICLE' && article.getAttribute(MOUNT_ATTR) !== '1') {
          injectArticleFAB(article);
        }
      });
  };

  // ============================================================
  // 帖子页 FAB
  // ============================================================
  const makeFAB = (cls, title, icon) => {
    const el = document.createElement('div');
    el.className = `ig-saver-fab ${cls}`;
    el.title = title;
    el.style.cssText = 'position:absolute;width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9999;backdrop-filter:blur(4px);';
    el.innerHTML = icon;
    return el;
  };

  const getPostShortcode = () => {
    const path = location.pathname.replace(/\/$/, '');
    const parts = path.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === 'p' || p === 'reel' || p === 'reels');
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    const a = document.querySelector('a[href*="/p/"], a[href*="/reel/"]');
    if (a) {
      const href = a.getAttribute('href');
      const m = href.match(/\/(p|reel|reels)\/([\w-]+)/);
      if (m) return m[2];
    }
    return null;
  };

  // v0.3.58:删除 injectPostFAB(单帖页多余按钮,保留主帖子 2 个 FAB)


  // ============================================================
  // Story FAB
  // ============================================================
  const injectStoryFAB = () => {
    if (!/^\/stories\//.test(location.pathname)) return;
    if (document.querySelector('.ig-saver-story-fab')) return;

    const anchor = document.querySelector('section._ac0a:not([hidden]), [role="dialog"] section:not([hidden])')
      || Array.from(document.querySelectorAll('section:not([hidden]) > div > div[style]:not([class])')).find(el => el.offsetParent !== null);

    if (!anchor) return;

    const isHighlight = /^\/stories\/highlights\//.test(location.pathname);
    const fab = makeFAB('ig-saver-story-fab', `IG Saver: 下载 ${isHighlight ? 'Highlight' : 'Story'}`, SVG_DW);
    fab.style.cssText += 'top:80px;right:12px;';
    fab.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const path = location.pathname.replace(/\/$/, '').split('/');
      const lastId = path[path.length - 1];
      const username = path[2] || (document.querySelector('header a[href^="/"]')?.textContent || '').trim();
      toast(`⏳ 解析 ${isHighlight ? 'Highlight' : 'Story'} ${lastId} …`, 1500);
      let data = null;
      if (isHighlight) {
        data = await getHighlightStories(lastId);
      } else {
        const user = await getUserId(username);
        if (!user) { toast(`❌ 找不到用户 ${username}`, 3000, 'error'); return; }
        data = await getStories(user.pk || user.id);
      }
      if (!data?.reels_media?.[0]?.items?.length) {
        toast(`❌ 找不到媒体`, 3000, 'error'); return;
      }
      const item = data.reels_media[0].items.find((it) => String(it.id) === String(lastId)) || data.reels_media[0].items[0];
      const owner = data.reels_media[0].owner?.username || username;
      if (item.display_resources) item.display_resources.sort((a, b) => b.config_width - a.config_width);
      const ext = item.is_video ? 'mp4' : 'jpg';
      const url = item.is_video
        ? item.video_resources?.at(-1)?.src
        : item.display_resources?.[0]?.src;
      if (!url) { toast(`❌ 找不到 URL`, 3000, 'error'); return; }
      // v0.3.59:Story ctx 对齐 14 个 %KEY%(v0.3.58 还在用 v0.3.21 小写 ctx → 文件名全是 x)
      const sTs = new Date((item.taken_at_timestamp || Date.now() / 1000) * 1000);
      const sYear = String(sTs.getFullYear());
      const sOriginalName = (() => {
        try {
          const seg = new URL(url).pathname.split('/').filter(s => s.length).pop() || 'unknown';
          return seg.split('.').slice(0, -1).join('.') || seg;
        } catch { return 'unknown'; }
      })();
      const filename = renderTemplate(getTemplate(), {
        USERNAME: owner || 'unknown',
        SOURCE_TYPE: isHighlight ? 'Highlight' : 'Story',
        SHORTCODE: lastId,
        YEAR: sYear,
        '2-YEAR': sYear.slice(-2),
        MONTH: String(sTs.getMonth() + 1).padStart(2, '0'),
        DAY: String(sTs.getDate()).padStart(2, '0'),
        HOUR: String(sTs.getHours()).padStart(2, '0'),
        MINUTE: String(sTs.getMinutes()).padStart(2, '0'),
        SECOND: String(sTs.getSeconds()).padStart(2, '0'),
        ORIGINAL_NAME: sOriginalName,
        ORIGINAL_NAME_FIRST: sOriginalName.split('_')[0] || 'unknown',
        INDEX: 1,
        UID: item.owner?.id || item.user?.id || (item.id ? String(item.id).split(/[_-]/).pop() : 'unknown'),
      }) + '.' + ext;
      showProgress('下载中…');
      await downloadBlob(url, filename, cfg.useGMDownload);
      hideProgress();
      toast(`✅ ${isHighlight ? 'Highlight' : 'Story'} 已保存`, 3000, 'success');
    });
    anchor.style.position = 'relative';
    anchor.appendChild(fab);
  };

  // ============================================================
  // Reels FAB
  // ============================================================
  const injectReelsFAB = () => {
    if (!/^\/reels?\//.test(location.pathname)) return;
    if (document.querySelector('.ig-saver-reels-fab')) return;
    const anchor = document.querySelector('section > main[role="main"] div div[aria-busy][tabindex] > div') || document.querySelector('main[role="main"] > div > div > div');
    if (!anchor) return;
    const fab = makeFAB('ig-saver-reels-fab', 'IG Saver: 下载 Reel', SVG_DW);
    fab.style.cssText += 'top:60px;right:12px;';
    fab.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const path = location.pathname.replace(/\/$/, '').split('/').filter(Boolean);
      let shortcode;
      const reelIdx = path.findIndex((p) => p === 'reel' || p === 'reels');
      shortcode = reelIdx >= 0 ? path[reelIdx + 1] : path[path.length - 1];
      toast(`⏳ 解析 Reel ${shortcode} …`, 1500);
      const post = await getPostMedia(shortcode);
      if (!post.items.length || !post.items[0].isVideo) {
        toast(`❌ 找不到视频`, 3000, 'error'); return;
      }
      const ok = await downloadItem(post.items[0]);
      if (ok) toast(`✅ Reel 已保存`, 3000, 'success');
      else toast(`❌ Reel 保存失败`, 3000, 'error');
    });
    anchor.style.position = 'relative';
    anchor.appendChild(fab);
  };

  // ============================================================
  // Profile Avatar FAB
  // ============================================================
  const injectAvatarFAB = () => {
    const path = location.pathname.replace(/\/$/, '');
    if (!/^\/[\w.\-_]+\/?$/.test(path)) return;
    if (document.querySelector('.ig-saver-avatar-fab')) return;
    const avatarImg = document.querySelector('header img[alt][draggable="true"]');
    if (!avatarImg) return;
    const fab = makeFAB('ig-saver-avatar-fab', 'IG Saver: 下载头像', SVG_DW);
    fab.style.cssText += 'bottom:8px;right:8px;width:28px;height:28px;';
    fab.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const username = path.split('/').filter(Boolean)[0];
      toast(`⏳ 解析 ${username} …`, 1500);
      const user = await getUserId(username);
      if (!user) { toast(`❌ 找不到用户`, 3000, 'error'); return; }
      const hdURL = await getHDProfile(user.pk || user.id);
      if (!hdURL) { toast(`❌ 找不到头像`, 3000, 'error'); return; }
      // v0.3.59:Avatar ctx 对齐 14 个 %KEY%(v0.3.58 同样用小写 ctx → 文件名全是 x)
      const aTs = new Date();
      const aYear = String(aTs.getFullYear());
      const aOriginalName = (() => {
        try {
          const seg = new URL(hdURL).pathname.split('/').filter(s => s.length).pop() || 'unknown';
          return seg.split('.').slice(0, -1).join('.') || seg;
        } catch { return 'unknown'; }
      })();
      const filename = renderTemplate(getTemplate(), {
        USERNAME: username,
        SOURCE_TYPE: 'Avatar',
        SHORTCODE: 'avatar',
        YEAR: aYear,
        '2-YEAR': aYear.slice(-2),
        MONTH: String(aTs.getMonth() + 1).padStart(2, '0'),
        DAY: String(aTs.getDate()).padStart(2, '0'),
        HOUR: String(aTs.getHours()).padStart(2, '0'),
        MINUTE: String(aTs.getMinutes()).padStart(2, '0'),
        SECOND: String(aTs.getSeconds()).padStart(2, '0'),
        ORIGINAL_NAME: aOriginalName,
        ORIGINAL_NAME_FIRST: aOriginalName.split('_')[0] || 'unknown',
        INDEX: 1,
        UID: user.pk || user.id || 'unknown',
      }) + '.jpg';
      showProgress('下载头像中…');
      await downloadBlob(hdURL, filename, cfg.useGMDownload);
      hideProgress();
      toast(`✅ 头像已保存`, 3000, 'success');
    });
    const container = avatarImg.closest('div[class]') || avatarImg.parentElement;
    container.style.position = 'relative';
    container.appendChild(fab);
  };

  // ============================================================
  // 主循环
  // ============================================================
  let currentURL = '';
  const tick = () => {
    const href = location.href;
    if (href === currentURL) {
      mountFeedFABs();
      repositionMountedFABs();   // v0.3.64:图片懒加载完成/布局变化后重新对齐
      return;
    }
    currentURL = href;
    document.querySelectorAll('.ig-saver-post-fab, .ig-saver-story-fab, .ig-saver-reels-fab, .ig-saver-avatar-fab').forEach((el) => el.remove());
    // v0.3.58:在任何 IG 页都跑 harvest(主页 article 节点就有 display_resources)
    harvestHDFromPostPage();
    setTimeout(() => {
      try { injectStoryFAB(); } catch (e) { console.error(`[IG-SAVER-${VERSION}] story FAB:`, e); }
      try { injectReelsFAB(); } catch (e) { console.error(`[IG-SAVER-${VERSION}] reels FAB:`, e); }
      try { injectAvatarFAB(); } catch (e) { console.error(`[IG-SAVER-${VERSION}] avatar FAB:`, e); }
      try { mountFeedFABs(); } catch (e) { console.error(`[IG-SAVER-${VERSION}] feed FAB:`, e); }
    }, 800);
  };

  setInterval(tick, 1000);
  tick();

  // ============================================================
  // 油猴菜单
  // ============================================================
  GM_registerMenuCommand('📝 设置命名模板', () => {
    const cur = getTemplate();
    // v0.3.58:对齐 IG Helper 4.2.1 14 个占位符列表
    const help = `当前模板:${cur}\n\n可用占位符(对齐 IG Helper 4.2.1):\n%USERNAME% 作者名\n%SOURCE_TYPE% Post/Story/Reel/Highlight/Avatar\n%SHORTCODE% 帖子短码\n%YEAR% 年(4位)\n%2-YEAR% 年(2位)\n%MONTH% 月\n%DAY% 日\n%HOUR% 时\n%MINUTE% 分\n%SECOND% 秒\n%ORIGINAL_NAME% IG 原文件名\n%ORIGINAL_NAME_FIRST% 原文件名第一段\n%INDEX% 序号(carousel)\n%UID% 用户数字ID\n\n示例:\n%USERNAME%-%SOURCE_TYPE%-%SHORTCODE%-%YEAR%%MONTH%%DAY%\n%USERNAME%/%YEAR%-%MONTH%-%DAY%/%SHORTCODE%_%INDEX%`;
    const next = window.prompt(help, cur);
    if (next && next.trim()) {
      setTemplate(next.trim());
      toast('✅ 模板已保存', 2000, 'success');
    }
  });

  GM_registerMenuCommand('🔄 重置模板', () => {
    setTemplate(TPL_DEFAULT);
    toast(`✅ 已重置为 ${TPL_DEFAULT}`, 2000, 'success');
  });

  GM_registerMenuCommand('🧹 清空 URL 缓存', () => {
    urlCache = {};
    GM_setValue(CACHE_KEY, {});
    toast('✅ 缓存已清空', 2000, 'success');
  });

  GM_registerMenuCommand(cfg.HD_ORIGINAL ? '🖼️ 关闭原图下载(用 GraphQL 回退版)' : '🖼️ 开启原图下载(Media API 高清)', () => {
    cfg.HD_ORIGINAL = !cfg.HD_ORIGINAL;
    saveCfg();
    toast(`✅ 原图下载 ${cfg.HD_ORIGINAL ? '开启' : '关闭'}`, 800, 'success');
  });

  GM_registerMenuCommand(cfg.useGMDownload ? '⬇️ 关闭 GM_download 模式' : '⬇️ 开启 GM_download 模式', () => {
    cfg.useGMDownload = !cfg.useGMDownload;
    saveCfg();
    toast(`✅ GM_download ${cfg.useGMDownload ? '开启' : '关闭'}`, 800, 'success');
  });

})();
