// ==UserScript==
// @name               IG Saver
// @name:zh-CN         IG Saver - Instagram 原图/视频无损下载
// @namespace          https://github.com/teddy4556/ig-saver
// @version 0.3.114
// @description        一键下载 Instagram Post / Reels / Stories / Highlights / Avatar 原图和视频。
// @description:zh-CN  原图最高 3072w + Reels 音视频自动合成有声 MP4 + 14 个文件名占位符。Console 第一行打印 [IG-SAVER-<版本号>] 启动行,对不上说明装的是旧版。
// @author             阑珊 <teddy4556@users.noreply.github.com>
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
// @connect            graph.instagram.com
// @connect            cdn.jsdelivr.net
// @connect            scontent.cdninstagram.com
// @connect            cdninstagram.com
// @connect            fbcdn.net
// @compatible         chrome >= 100
// @compatible         edge >= 100
// @compatible         firefox >= 100
// @icon64             https://raw.githubusercontent.com/teddy4556/ig-saver/main/assets/logo-128.png
// @icon               https://raw.githubusercontent.com/teddy4556/ig-saver/main/assets/logo-32.png
// @license            MIT
// @run-at             document-idle
// ==/UserScript==

/**
 * IG Saver v0.3.96 (2026-10-27)
 *
 * ★★ 本版只修「视频下载不出声 / 变成两个文件」,不动 UI、不动命名模板、不动抓取主链。
 *
 * 触发:用户贴了 v0.3.95 的浏览器 console 日志,里面有两条真症状 ——
 *   症状 A:[IG-SAVER-0.3.95] Mediabunny 加载失败: Mediabunny esm fetch failed
 *           → DASH mux failed: Mediabunny 不可用,fallback 下分文件
 *           → 每个 DASH 视频都下成 .video.mp4 + .audio.m4a 两个文件,用户还得自己 ffmpeg
 *   症状 B:parseDashMPA: 3 reps → video=3 audio=0
 *           → 视频 #N DASH 解析只到 video,无 audio
 *           → 下到无声视频,且毫无提示
 *
 * ── 5-Why 根因链(每层都有日志/实测支撑,不是猜)──
 *   1. 症状 A 为什么?→ v0.3.95 的 lazyLoadMediabunny 只打 jsdelivr **一个**源。
 *      那个源在用户环境被拦/超时 → GM_xhr onerror → mux 全线瘫。
 *   2. 为什么一个源这么脆?→ 无多源回退、无缓存、无内容校验。
 *      沙箱实测三源都活着(jsdelivr .min.mjs / unpkg .min.mjs / jsdelivr +esm,
 *      均 200 + 零 import 语句 + 导出名齐全),说明是**用户网络/拦截环境**选择性挡掉了那一个源。
 *   3. 为什么症状 B 也一起出现?→ parseDashMPA 的音视频分类没命中时,
 *      脚本直接下 DASH 的 video-only rep —— 而 IG 那个 rep 本来就不含音轨。
 *   4. 那为什么不干脆用 video_versions?→ 因为脚本历史上把 progressive 当「低码率退路」,
 *      优先选了 DASH 最高码率 + 独立 audio 去 mux。mux 一挂,progressive 这条有声的路就没人走。
 *   5. 根因(可干预):**「拿到完整有声视频」这件事有两条路(DASH mux / progressive),
 *      脚本只做了一条,另一条没接进决策树。**
 *
 * ── 本版三处改动(每处对应上面一条症状)──
 *   1. lazyLoadMediabunny:单源 → 三源依次尝试 + GM 缓存 + 内容校验
 *      (status/长度/HTML 检测/export 语句检测),失败源逐个跳过而不是一击出局。
 *      拉成功一次写进 GM_setValue('IG_SAVER_MB_1345'),以后离线/被墙也能用。
 *      ★ esm.sh 已排除:它返 91B 的 re-export 桩(export * from "/..."),
 *        blob 动态 import 必炸 —— 这类「看着 200 其实不能用」的源必须真验证过再写进去。
 *   2. addItem / harvest.collect 新增 _progressiveUrl:记下 video_versions 里
 *      width 最大那档的 URL。
 *   3. 回落链打通:
 *        mux 失败  → 先试 progressive 完整 mp4(自带音轨)→ 再退分文件 + ffmpeg 提示
 *        无音轨    → 直接走 progressive 完整 mp4,不再下 video-only
 *      ★ progressive 自带音轨是**实测结论**,不是推测:
 *        沙箱从用户日志原文抽 6 个 IG 视频 URL,ffprobe 全中 h264+aac(6/6)。
 *
 * ── 真实验证(2026-10-27,沙箱)──
 *   · node --check 过;tests/test-unit.js 75 项全绿(新增 8 项 v0.3.96 断言)
 *   · Mediabunny 三源 curl 实测:200 / 零 import 语句 / 所需导出名(Input/MP4/BufferSource/
 *     EncodedPacketSink/EncodedVideoPacketSource/EncodedAudioPacketSource/
 *     Mp4OutputFormat/BufferTarget/Output)全部齐全
 *   · IG 视频 progressive mp4 ffprobe 实测:6/6 带音轨(h264 + aac)
 *
 * IG Saver v0.3.95 (2026-10-21)
 *
 * ★★ 基线来源(改任何代码前先 md5sum 对一下):
 *   本版基于 v0.3.84 回退后的真基线 —— md5 = 631b0cfcd141fd7a312596f054d5332a
 *   (即 versions/ig-saver-v0.3.84-20261017-192736.user.js)
 *   ⚠ 不是 v0.3.94。versions/ 里平铺的 v0.3.85~v0.3.94 是已废弃的「双列」分支
 *     (整批回滚丢弃,见 versions/_discarded-rollback-20261016/ 及
 *      ig-saver-v0.3.94-双列功能-已废弃-20261020-133731.user.js),
 *     它们编号比真基线高,但不是基线 —— 别按 versions/ 里的最高编号判断版本。
 *   本版只做命名模板统一骨架的改动,不含任何废弃分支的内容
 *   (双列/瀑布流特征计数 = 0,与 v0.3.84 真基线一致)。
 *
 * v0.3.95 变更(仅命名模板,不动下载逻辑):
 *   1. 默认模板改成跨平台统一骨架「平台名#作者#帖子id#日期#时间#序号」
 *      IG#%USERNAME%#%SHORTCODE%#%YEAR%%MONTH%%DAY%#%HOUR%%MINUTE%%SECOND%#%INDEX%
 *      渲染实例:IG#yourshortname#C1a2B3c4D5e#20261021#085823#01.jpg
 *   2. %INDEX% 序号在【渲染层】补零到 2 位(01/02/10);数据层 item.idx 仍是裸数字
 *   3. 长度收敛改成「砍头不砍尾」:序号前的 '#' + 序号 + 扩展名 = 受保护尾部,
 *      永不因超长被砍;另补 ext4 字节预算 + emoji 代理对保护
 *   4. 旧默认模板一次性迁移(只迁「精确等于旧默认值」,用户自定义模板不动)
 *   5. 平台特有字段(%SOURCE_TYPE% / %ORIGINAL_NAME% / %UID%)占位符全部保留可用
 *
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

  const VERSION = '0.3.114';
  // ★ v0.3.111:取 URL 的 host(诊断用,不抛异常)
  const hostOf = (u) => {
    try { return new URL(String(u || '')).host || '?'; }
    catch { return '?'; }
  };
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

  // ★ v0.3.113:@connect 运行时自检 —— 装完立刻知道白名单有没有生效。
  //   起因(2026-10-30 用户 v0.3.112 实测):脚本声明了 `*.cdninstagram.com`
  //   却仍被 ScriptCat 拒(Refused to connect ... not a part of the @connect list)。
  //   源码级根因:ScriptCat 的 getConnectMatched(gm_api.ts:253-295)只做**字符串后缀匹配**
  //   (`.${host}`.endsWith(`.${meta}`)),**完全不解析通配符** → 通配符条目永远失配。
  //   ⇒ 这里用同一套规则在运行时自检:哪些 CDN 父域真的盖得住、哪些条目是废的。
  //   GM_info.script.connects 是**复数**(ScriptCat gm_info.ts:6-18:connects: script.metadata.connect || [])。
  {
    try {
      const conns = (GM_info && GM_info.script && (GM_info.script.connects || GM_info.script.connect)) || [];
      const host = (() => { try { return location.hostname; } catch { return ''; } })();
      // 与 ScriptCat 同规则:同源恒放行;父域条目盖住全部子域
      const covered = (h) => {
        const c = String(h || '').toLowerCase();
        if (!c) return false;
        if (host && (`.${h}`.endsWith(`.${host}`))) return true;   // 同源/子域豁免
        return conns.some((raw) => {
          const m = String(raw || '').toLowerCase().trim();
          if (!m) return false;
          if (m === '*') return true;
          return `.${h}`.endsWith(`.${m}`);
        });
      };
      const CDN_PARENTS = ['cdninstagram.com', 'fbcdn.net'];
      const dead = conns.filter((raw) => String(raw || '').includes('*'));
      const cdnOk = CDN_PARENTS.every((p) => covered(p));
      console.log(`[IG-SAVER-${VERSION}] @connect 自检:生效 ${conns.length} 条`
        + (conns.length ? ` [${conns.join(', ')}]` : '(无)')
        + ` | CDN 白名单 ${cdnOk ? '✅ 覆盖' : '❌ 未覆盖'}`);
      if (dead.length) {
        // 通配符在 ScriptCat 里是字面量 → 永远失配,必须换成父域
        console.warn(`[IG-SAVER-${VERSION}] ⚠️ @connect 里的通配符条目在 ScriptCat 无效`
          + `(只做后缀匹配,不解析 *): ${dead.join(', ')} —— 请改成父域(例 cdninstagram.com)`);
      }
      if (!cdnOk) {
        console.warn(`[IG-SAVER-${VERSION}] ⚠️ CDN 父域未在 @connect 里 → GM_xhr 会被拒`
          + `("not a part of the @connect list")。请加: @connect cdninstagram.com`);
      }
    } catch (e) {
      console.warn(`[IG-SAVER-${VERSION}] @connect 自检异常:`, e && e.message ? e.message : e);
    }
  }

  // ★ v0.3.113:网络护栏常量(修批次死锁)
  //   FETCH_TIMEOUT_MS:单次 CDN fetch 的硬上限。CDN 连接挂死时,
  //     没有 AbortController 的 fetch **promise 永不 settle** → 整批下载卡死。
  //   ITEM_WATCHDOG_MS:单个 item 的总时长上限(内层所有重试都算进去)。
  //     即使某条内部路径仍会挂死,到点就放弃这个 item,不让它拖住整批。
  const FETCH_TIMEOUT_MS = 20000;
  // ★ v0.3.114:body 读取需要独立预算。
  //   v0.3.113 的 fetchWithTimeout 只保护**响应头**阶段,拿到 Response 就 clearTimeout,
  //   而真正下载 body 的 res.blob()/res.arrayBuffer() 在保护范围之外 ——
  //   响应头 100ms 就到,之后 body 挂死 → promise 永不 settle → 批次卡死
  //   (2026-10-30 用户 5.3MB 日志:三个视频批次全部无终态)。
  //   ⇒ body 阶段给更长预算,并且必须**在同一个 AbortController 保护内**。
  const HEAD_TIMEOUT_MS = 20000;    // 等响应头
  const BODY_TIMEOUT_MS = 120000;   // 读 body(视频几 MB,20s 必然不够)
  const ITEM_WATCHDOG_MS = 90000;

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

  // ★ v0.3.111(修「冒名认领别人的错」):
  //   旧版对**所有**脚本的 unhandledrejection 都打 `[IG-SAVER-VERSION]` 前缀。
  //   实测日志证据(2026-10-30 用户 v0.3.110):
  //     [IG-SAVER-0.3.110] Promise 报错: Illegal invocation
  //     （匿名） @ userscript.html?name=IG-Saver.user.js&id=...:181
  //     At @ VM341:10          ← 栈顶是 VM341(别的脚本的沙箱),不是 IG Saver
  //     n @ VM341:85
  //   → 同一个错 IG Saver 记了一份、抛错的脚本自己也记了一份,
  //     而且用户会误以为 IG Saver 坏了。
  //   → 现在:**自己的错**才用 IG-SAVER 前缀;**别人的错**单独标注来源,不冒名。
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason = String(e?.reason?.message || e?.reason || '');
      // 取 rejection 的堆栈,判断是不是自己代码发起的
      const stack = String(e?.reason?.stack || '');
      const isOurs = /IG-SAVER|igSaver|ig-saver/i.test(stack)
        || /downloadItem|downloadDashVideo|harvestFrom|runDownloadAll|muxDash/i.test(stack);
      if (isOurs) {
        console.error(`[IG-SAVER-${VERSION}] Promise 报错:`, reason);
      } else {
        // ★ 别人的错:明确说不是 IG Saver 的锅,但仍然记下来(排查时有用)
        console.warn(`[IG-SAVER-${VERSION}] 提示:检测到其他脚本的未捕获 Promise 拒绝(与 IG Saver 无关):`, reason);
      }
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
  // ★ v0.3.95:默认模板改成跨平台统一骨架「平台名#作者#帖子id#日期#时间#序号」
  //   IG#%USERNAME%#%SHORTCODE%#%YEAR%%MONTH%%DAY%#%HOUR%%MINUTE%%SECOND%#%INDEX%
  //   与 微博 / 豆瓣 / 小红书 同构同序(唯一真源:skill userscript/authoring
  //   §4.2 + references/unified-naming-skeleton.md)。
  //   帖子 id 段用 %SHORTCODE%(IG 短码,约 11 位,天然跟其他平台齐整)。
  //   平台特有字段(%SOURCE_TYPE% / %ORIGINAL_NAME% / %UID%)
  //   占位符全部保留可用,只是不进默认模板(统一骨架铁律 ⑥)。
  //   扩展名不写进模板 —— 落盘层自动补(见 getFileName)。
  const TPL_DEFAULT = 'IG#%USERNAME%#%SHORTCODE%#%YEAR%%MONTH%%DAY%#%HOUR%%MINUTE%%SECOND%#%INDEX%';

  // ★ v0.3.95:旧默认模板 —— 只用于一次性迁移。
  //   用户在油猴菜单里存过旧默认值时,GM_getValue 优先于 default,
  //   不迁移就一直用旧格式(改了默认值等于没改,见 skill §10.18)。
  const TPL_LEGACY_DEFAULT = '%USERNAME%-%SOURCE_TYPE%-%SHORTCODE%-%YEAR%%MONTH%%DAY%_%HOUR%%MINUTE%%SECOND%_%INDEX%';

  const getTemplate = () => GM_getValue(TPL_KEY, TPL_DEFAULT);
  const setTemplate = (v) => GM_setValue(TPL_KEY, v);

  // ★ v0.3.95:一次性迁移 —— 存量旧默认值 → 新统一骨架默认值。
  //   独立 stamp key 保证只跑一次;只迁「精确等于旧默认值」的情况,
  //   用户自己改过的模板一律尊重不动。抽成函数是为了能写单元测试。
  const TPL_STAMP_KEY = 'IG_SAVER_TEMPLATE_STAMP_V';
  const TPL_STAMP_V = '0.3.95';
  const migrateTemplate = () => {
    if (GM_getValue(TPL_STAMP_KEY, '') === TPL_STAMP_V) return false;
    const stored = GM_getValue(TPL_KEY, '');
    const changed = stored === TPL_LEGACY_DEFAULT;
    if (changed) setTemplate(TPL_DEFAULT);
    GM_setValue(TPL_STAMP_KEY, TPL_STAMP_V);
    return changed;
  };
  migrateTemplate();

  // v0.3.58:sanitize 保留 % 让 %KEY% 占位符不被破坏
  //   ⚠ 统一骨架的分隔符 # 不会被洗掉 —— 模板字面量根本不经过 sanitize,
  //     sanitize 只清洗 ctx 的「值」。值里的 # 仍转成 _,
  //     防止用户值注入额外分隔符,把 5 段骨架撑成 6 段。
  const sanitize = (s) => String(s ?? 'x')
    .replace(/[\/\\:*?"<>|#+&,'`~;{}!@$()\[\]?=+……\n\r\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'x';

  // ★ v0.3.95:序号补零到 2 位(01 / 02 / 10)—— 统一骨架铁律 ④
  //   补零在【渲染层】做;数据层 item.idx 保持裸数字(它还有别的用途:
  //   HD 缓存 key、进度提示、错误提示都直接读 item.idx)。
  const pad2 = (n) => {
    const s = String(n ?? 1);
    return /^\d+$/.test(s) ? s.padStart(2, '0') : s;
  };

  // ============================================================
  // 文件名长度收敛(双预算,见 skill §5.1)
  //   NTFS 255 code unit / ext4 255 字节 —— 两个都得守
  //   纯中文 200 字 = 600 字节,只守 code unit 会撑爆 ext4
  // ============================================================
  const FN_MAX_CU = 200;    // code unit 上限(与 v0.3.84 的 slice(0,200) 同值)
  const FN_MAX_BYTE = 245;  // 字节上限(255 预留 10 字节给 '.jpg' 之类扩展名)
  const utf8Len = (s) => new TextEncoder().encode(s).length;

  // 截断不劈代理对:emoji 占 2 个 code unit,
  // slice 到高代理(0xD800-0xDBFF)中间会产出孤立代理对 → 文件名乱码
  const safeTruncateCu = (s, maxCu) => {
    if (maxCu <= 0) return '';
    let t = s.length > maxCu ? s.slice(0, maxCu) : s;
    const last = t.charCodeAt(t.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) t = t.slice(0, -1);
    return t;
  };

  // 收敛:只砍 head,tail(序号 + 后缀)是受保护尾部,永不被砍
  //   head 含「平台名#作者#帖子id#日期#时间#」全部可变段 —— 它们可以被砍短
  //   tail 含「序号 + 扩展名」—— 永不被砍
  const fitStem = (head, tail) => {
    let h = safeTruncateCu(head, Math.max(0, FN_MAX_CU - tail.length));
    // 字节预算:code unit 不超但字节超时再收一收(仍然只砍 head)
    while (h.length && utf8Len(h + tail) > FN_MAX_BYTE) {
      h = h.slice(0, -1);
      const last = h.charCodeAt(h.length - 1);
      if (last >= 0xD800 && last <= 0xDBFF) h = h.slice(0, -1);
    }
    return h + tail;
  };

  // v0.3.58:对齐 IG Helper 4.2.1 — %KEY% 大写占位符
  // ★ v0.3.95:序号 %INDEX% 渲染时补零到 2 位;长度收敛改成「砍头不砍尾」——
  //   %INDEX% 段是受保护尾部,永不被砍(见 skill §5.1 铁律 1/5)。
  const renderTemplate = (tpl, ctx) => {
    const cleanCtx = {};
    let idxVal = '01';
    let hasIdxKey = false;
    for (const [k, v] of Object.entries(ctx)) {
      const key = k.toUpperCase();
      if (key === 'INDEX') {
        hasIdxKey = true;
        idxVal = pad2(sanitize(v));
        cleanCtx[k] = idxVal;
      } else {
        cleanCtx[k] = sanitize(v);
      }
    }
    // 已知占位符全部替换;剩下的未知 %XXX% 降级成 x
    const subst = (s) => {
      let o = String(s);
      for (const [k, v] of Object.entries(cleanCtx)) {
        o = o.split(`%${k.toUpperCase()}%`).join(v);
      }
      return o.replace(/%[\w-]+%/g, 'x');
    };
    const tplStr = String(tpl);
    const IDX_TOK = '%INDEX%';
    const lastAt = hasIdxKey ? tplStr.lastIndexOf(IDX_TOK) : -1;
    // 模板没写 %INDEX%(与 v0.3.84 一致:不自动补序号)
    if (lastAt < 0) return fitStem(subst(tplStr), '');
    // %INDEX% 是受保护尾部 —— 长度收敛时永不被砍
    let head = subst(tplStr.slice(0, lastAt));
    const tail = subst(tplStr.slice(lastAt + IDX_TOK.length));
    // ★ 序号前面的「#」分隔符也归受保护尾部 ——
    //   否则收敛时 '#' 被砍掉,6 段结构塌成 5 段(实测尾部只剩 "...CCC01.jpg")
    let sep = '';
    if (head.endsWith('#')) { sep = '#'; head = head.slice(0, -1); }
    return fitStem(head, sep + idxVal + tail);
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
  // ★ v0.3.113:带超时的 fetch —— 防「连接挂死 → promise 永不 settle」
  //   实测(用户 v0.3.112 日志):fetch omit 失败后转 GM_xhr,
  //   GM_xhr 也失败,重试时第二次 fetch **一直没有任何结果**,
  //   导致 Promise.all 整组挂起 → 7 张轮播只下了 2 张,且永远不打 📊 总结。
  //   AbortController.abort() 会让 fetch 以 AbortError  reject → 可捕获、可重试、可记账。
  // ★ v0.3.114 重写:body 读取必须在同一个 AbortController 保护内。
  //   旧版(523-541)拿到 Response 头就 finally clearTimeout,
  //   而 res.blob()/res.arrayBuffer() 在外面调用 —— body 挂死 → 永久 pending。
  //
  //   新形态:
  //     fetchWithTimeout(url, opts)                  → 只拿 Response(头阶段保护)
  //     fetchWithTimeout(url, opts, { withBody })    → 直接把 body 读完,全程受保护
  //   withBody 可传 'blob' | 'arraybuffer' | 自定义 fn(res)
  const fetchWithTimeout = async (url, opts = {}, timeoutMs = HEAD_TIMEOUT_MS, bodyOpts = null) => {
    const withBody = bodyOpts && bodyOpts.withBody;
    const bodyTimeoutMs = (bodyOpts && bodyOpts.bodyTimeoutMs) || BODY_TIMEOUT_MS;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let headTimer = null;
    let bodyTimer = null;
    const abort = () => { try { ctrl && ctrl.abort(); } catch {} };
    try {
      if (!ctrl) {
        const res0 = await fetch(url, opts);
        if (!withBody) return res0;
        return withBody === 'blob' ? res0.blob() : res0.arrayBuffer();
      }
      // 阶段一:等响应头
      headTimer = setTimeout(abort, timeoutMs);
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      if (!withBody) {
        // 只保护头阶段 —— 调用方若要读 body,必须用 withBody 形态
        clearTimeout(headTimer); headTimer = null;
        return res;
      }
      // 阶段二:读 body —— **同一个 signal**,另给更长预算
      clearTimeout(headTimer); headTimer = null;
      bodyTimer = setTimeout(abort, bodyTimeoutMs);
      if (withBody === 'blob') return await res.blob();
      if (withBody === 'arraybuffer') return await res.arrayBuffer();
      if (typeof withBody === 'function') return await withBody(res);
      return await res.arrayBuffer();
    } catch (err) {
      // AbortError → 归一成「超时」文案,isRetryableError 会认它(可重试)
      if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')))) {
        throw new Error(`fetch 超时(${withBody ? bodyTimeoutMs : timeoutMs}ms)`);
      }
      throw err;
    } finally {
      if (headTimer) { try { clearTimeout(headTimer); } catch {} }
      if (bodyTimer) { try { clearTimeout(bodyTimer); } catch {} }
    }
  };

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
              // v0.3.97(纯诊断,不改取数逻辑):responseType:'json' 时,GM 对非 2xx 响应可能不给 r.response,
              //   只留 r.responseText(或两者皆空)。这里兜底取原始文本,保证失败时 body 拿得到。
              const rawText = (typeof r.responseText === 'string' && r.responseText) ? r.responseText
                : (typeof r.response === 'string' ? r.response : '');
              resolve({
                ok: r.status >= 200 && r.status < 300 && !isHTML,
                status: r.status,
                contentType: ct,
                isHTML,
                responseText: rawText,
                // v0.3.97:失败时也必须能 parse 出 body(RAW BODY 诊断要靠它)
                json: async () => {
                  try {
                    if (r.response && typeof r.response === 'object') return r.response;
                    if (rawText) return JSON.parse(rawText);
                    return null;
                  } catch { return null; }
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
      // ★ v0.3.113:加 AbortSignal 超时
      const res = await fetchWithTimeout(url, finalOpts);
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
  // ★ v0.3.106:账号级风控短路标记(模块作用域,同一次页面会话内共享)。
  //   实测:query_id 连续 8 次返 feedback_required / is_spam:true,
  //   而每次都重试 1 次 → 每次点击白等 1.5s + 多打 IG 一次(风控越打越重)。
  //   这类是**账号持续状态**,不是滑窗期 → 重试无意义,标记后本会话直接跳过。
  let graphqlSpamBlocked = false;

  const getPostMedia = async (shortcode) => {
    console.log(`[IG-SAVER-${VERSION}] getPostMedia(${shortcode})`);
    if (graphqlSpamBlocked) {
      console.log(`[IG-SAVER-${VERSION}] graphql 已被标记为账号级风控(feedback_required),本次会话跳过 GraphQL 路`);
    }

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
      // v0.3.97(纯诊断):无论 ok 与否都把 body 读出来。
      //   旧版只在 res.ok 分支 parse → 400/401 时 body 整个丢失,
      //   导致「query_id 失败 status=400」看不到真实原因(是 spam 判定? execution error? 参数错?),
      //   违反 references/ig-query-id-pitfalls.md §6「失败时必打 RAW BODY」。
      let diagBody = null;
      try { diagBody = await res.json(); } catch { diagBody = null; }
      if (res.ok && !res.isHTML) {
        try {
          const root = diagBody;
          // v0.3.58:body 多一层 data!{data: {xdt_api__v1__media__shortcode__web_info: {items: [...]}}}
          // IG Helper 4.2.1 也是这么读。覆盖两层结构
          const inner = root?.data ?? root;
          const items = inner?.xdt_api__v1__media__shortcode__web_info?.items?.[0];
          if (items) return { ok: true, data: root, items };
          if (inner?.shortcode_media) return { ok: true, data: root, items: inner.shortcode_media };
          return { ok: false, data: root, status: res.status, contentType: res.contentType };
        } catch (parseErr) {
          // body 不是 JSON
          return { ok: false, status: res.status, contentType: res.contentType, parseError: parseErr.message };
        }
      }
      // v0.3.97(纯诊断):失败也带上 body / 原始文本,让「400 到底为什么」看得见
      return {
        ok: false,
        status: res.status,
        contentType: res.contentType,
        data: diagBody,
        rawText: (res.responseText || '').slice(0, 800),
      };
    };
    for (let retry = 0; retry < 2 && !graphqlSpamBlocked; retry++) {
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
        // v0.3.97(纯诊断):失败时 body / 原文一律打出来,不再只打一个 status=400
        if (r.data) {
          console.warn(`[IG-SAVER-${VERSION}] query_id 失败(第 ${retry + 1} 次) RAW BODY:`, JSON.stringify(r.data).slice(0, 800));
        } else {
          console.warn(`[IG-SAVER-${VERSION}] query_id 失败(第 ${retry + 1} 次) status=${r.status} ct=${r.contentType || '?'}`);
          // v0.3.97(纯诊断):body 解析不出 JSON 时,打原始文本(IG 的错误提示常在纯文本里)
          if (r.rawText) console.warn(`[IG-SAVER-${VERSION}] query_id 失败 RAW TEXT:`, r.rawText);
        }
        // ★ v0.3.106:feedback_required / is_spam = 账号级持续风控,不是滑窗期
        //   → 不重试(省 1.5s + 少打 IG 一次),并标记本会话后续跳过 GraphQL。
        if (r.data && (r.data.feedback_required || r.data.is_spam === true
                       || r.data.message === 'feedback_required')) {
          graphqlSpamBlocked = true;
          console.warn(`[IG-SAVER-${VERSION}] query_id 命中账号级风控(feedback_required/is_spam),本次会话不再重试 GraphQL`);
          break;
        }
        console.warn(`[IG-SAVER-${VERSION}] query_id 失败(第 ${retry + 1} 次),1.5s 后重试...`);
        if (retry === 0) await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.warn(`[IG-SAVER-${VERSION}] query_id 异常(第 ${retry + 1} 次):`, err);
        if (retry === 0) await new Promise(r => setTimeout(r, 1500));
      }
    }

    // 4. v0.3.8 Media API(无守卫,IG 自己 404 判;短码/老 mediaId 都能查)
    // ★ v0.3.106:短码必然被 IG 拒(实测 body = {"message":"Invalid media_id <短码>","status":"fail"},
    //   铁律 2.10 已定性)→ 只在拿到**纯数字 mediaId** 时才查,短码直接跳过(省一次白跑请求)。
    try {
      const mi = /^\d{10,}$/.test(String(shortcode)) ? await getMediaInfo(shortcode) : null;
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

    // ★ v0.3.109:措辞修正 —— 这条日志在 **getPostMedia 内部**,只代表「API 路全败」,
    //   主取数链后面还会走单帖页 HTML 路(实测经常靠这条路成功)。
    //   旧措辞「所有路径失败」会让用户以为整个功能挂了(实测日志里
    //   「所有路径失败」后面紧跟着「单帖页命中 → ✅ 下载完成」)。
    console.warn(`[IG-SAVER-${VERSION}] API 路全败(graphql/media-api),${shortcode} 无 media`
      + ` → 继续走单帖页 HTML 路`);
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
        // v0.3.96:progressive 兜底 URL(video_versions[0])。
        //   实测(2026-10-27,沙箱 ffprobe 抽 6 个 IG 视频 URL):video_versions 的
        //   progressive mp4 **自带音轨**(h264 + aac,6/6 全中),而 DASH manifest 里的
        //   video rep 是 video-only 的。所以 mux 不可用 / manifest 漏判音轨时,
        //   progressive 才是「单个完整有声 mp4」的正解 —— 不必分文件再本地 ffmpeg。
        //   优先挑 width 最大的那档(IG 一般给 720w / 1276w 两档)。
        _progressiveUrl: (() => {
          const vv = node.video_versions;
          if (!Array.isArray(vv) || !vv.length) return node.video_url || null;
          const best = [...vv].filter(v => v?.url).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
          return best?.url || node.video_url || null;
        })(),
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
  // v0.3.96:Mediabunny 多源 + GM 缓存。
  //   病根(2026-10-27 用户日志实证):v0.3.95 只打 jsdelivr 一个源,
  //   那个源被用户环境的拦截器/网络挡掉时 GM_xhr 走 onerror →
  //   "Mediabunny esm fetch failed" → mux 全废 → 每个 DASH 视频退化成分文件。
  //   三源实测(沙箱 curl,2026-10-27):
  //     jsdelivr +esm     200 / 481210B / 0 条 import / 导出名齐全 ✅
  //     jsdelivr .min.mjs 200 / 469673B / 0 条 import / 导出名齐全 ✅
  //     unpkg    .min.mjs 200 / 469673B / 0 条 import / 导出名齐全 ✅
  //     esm.sh            200 / 91B —— 是 re-export 桩(export * from "/..."),
  //                      blob 动态 import 必炸,已排除 ❌
  //   顺序按「独立 bundle 优先」排:.min.mjs 是打包好的单文件,零外部依赖,最稳。
  const MB_SOURCES = [
    'https://cdn.jsdelivr.net/npm/mediabunny@1.34.5/dist/bundles/mediabunny.min.mjs',
    'https://unpkg.com/mediabunny@1.34.5/dist/bundles/mediabunny.min.mjs',
    'https://cdn.jsdelivr.net/npm/mediabunny@1.34.5/+esm',
  ];
  const MB_CACHE_KEY = 'IG_SAVER_MB_1345';
  // v0.3.96:GM 缓存 —— 拉过一次存下来,以后离线/被墙也能用。
  //   只在内容校验通过后写缓存,别把错误页/拦截页存进去。
  const mbFetchText = (url) => new Promise((resolve, reject) => {
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 30000,
        onload: (r) => {
          if (r.status !== 200) return reject(new Error(`HTTP ${r.status}`));
          const txt = r.responseText || '';
          if (!txt || txt.length < 10000) return reject(new Error(`响应过短 ${txt.length}B`));
          // 内容校验:必须像 JS,不能是 HTML 拦截页 / JSON 错误体
          const head = txt.slice(0, 400);
          if (/^\s*<(!doctype|html)/i.test(head)) return reject(new Error('返回 HTML(非 JS)'));
          if (!/export\s*\{|export\s+(default|const|function|class)/.test(txt)) {
            return reject(new Error('无 export 语句,不是 ESM'));
          }
          resolve(txt);
        },
        onerror: () => reject(new Error('GM_xhr 网络失败')),
        ontimeout: () => reject(new Error('GM_xhr 超时 30s')),
      });
    } catch (e) {
      reject(new Error('GM_xhr 抛异常: ' + (e?.message || e)));
    }
  });

  const lazyLoadMediabunny = async () => {
    if (typeof window.Mediabunny !== 'undefined') return window.Mediabunny;
    if (window.mediabunnyPromise) return window.mediabunnyPromise;
    window.mediabunnyPromise = (async () => {
      // 路径 1:GM 缓存(上次拉成功过)
      try {
        const cached = GM_getValue(MB_CACHE_KEY, '');
        if (cached && cached.length > 10000) {
          const blob = new Blob([cached], { type: 'application/javascript' });
          const blobURL = URL.createObjectURL(blob);
          const mod = await import(blobURL);
          URL.revokeObjectURL(blobURL);
          window.Mediabunny = mod;
          console.log(`[IG-SAVER-${VERSION}] Mediabunny 从 GM 缓存加载完成(${cached.length}B)`);
          return mod;
        }
      } catch (e) {
        console.warn(`[IG-SAVER-${VERSION}] GM 缓存加载失败,回退网络:`, e.message);
      }
      // 路径 2:多源依次尝试
      for (let i = 0; i < MB_SOURCES.length; i++) {
        const url = MB_SOURCES[i];
        try {
          const esmText = await mbFetchText(url);
          const blob = new Blob([esmText], { type: 'application/javascript' });
          const blobURL = URL.createObjectURL(blob);
          const mod = await import(blobURL);
          URL.revokeObjectURL(blobURL);
          window.Mediabunny = mod;
          try { GM_setValue(MB_CACHE_KEY, esmText); } catch {}
          console.log(`[IG-SAVER-${VERSION}] Mediabunny 动态加载完成(源 ${i + 1}/${MB_SOURCES.length},${esmText.length}B)`);
          return mod;
        } catch (e) {
          console.warn(`[IG-SAVER-${VERSION}] Mediabunny 源 ${i + 1}/${MB_SOURCES.length} 失败:`, e.message);
        }
      }
      console.warn(`[IG-SAVER-${VERSION}] Mediabunny 全部 ${MB_SOURCES.length} 源失败,放弃 mux(改走 progressive 回落)`);
      return null;
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
    // ★★ v0.3.96:时间戳归零 —— IG 原生数据的特性,不归零 mux 必炸。
    //   实测(2026-10-27 真浏览器 + 真 IG 视频):IG 音频轨的**首包 PTS 是负数**
    //   (-0.114694s,IG 用它做音画同步预卷),视频轨从 0 起。
    //   Mediabunny 的 validateAndNormalizeTimestamp 会直接抛:
    //     "Timestamps must be non-negative (got -0.11469387755102041s)."
    //   ⇒ v0.3.95 的 mux 在**真实 IG 数据上根本跑不通**,即使 Mediabunny 能加载。
    //     (这解释了为什么用户日志里 mux 一直失败 —— 不止是 CDN 拉不到。)
    //   修法:逐包加上「该轨首包负偏移」,保持轨内相对关系不变。
    //   ★ getFirstTimestamp() 是**异步**的,必须 await(不 await 会拿到 Promise,
    //     算出来的偏移是 NaN)。★ 包对象的 timestamp 可直接写(实测可写)。
    const vFirst = await vTrack.getFirstTimestamp();
    const aFirst = await aTrack.getFirstTimestamp();
    const vShift = (typeof vFirst === 'number' && vFirst < 0) ? -vFirst : 0;
    const aShift = (typeof aFirst === 'number' && aFirst < 0) ? -aFirst : 0;
    if (vShift || aShift) {
      console.log(`[IG-SAVER-${VERSION}] 时间戳归零: video ${vFirst}→0, audio ${aFirst}→0(IG 音轨首包 PTS 为负)`);
    }
    const shiftTs = (it, off) => {
      if (it.done || !off) return it;
      const pk = it.value;
      if (pk && typeof pk.timestamp === 'number') pk.timestamp = pk.timestamp + off;
      return it;
    };
    output.addVideoTrack(vSource, { rotation: vTrack.rotation || 0 });
    output.addAudioTrack(aSource);
    await output.start();
    const vDecoderConfig = await vTrack.getDecoderConfig();
    const aDecoderConfig = await aTrack.getDecoderConfig();
    const vMeta = vDecoderConfig ? { decoderConfig: vDecoderConfig } : undefined;
    const aMeta = aDecoderConfig ? { decoderConfig: aDecoderConfig } : undefined;
    const vIter = vSink.packets();
    const aIter = aSink.packets();
    let vNext = shiftTs(await vIter.next(), vShift);
    let aNext = shiftTs(await aIter.next(), aShift);
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
        vNext = shiftTs(await vIter.next(), vShift);
      } else {
        await aSource.add(aNext.value, aSentMeta ? undefined : aMeta);
        aSentMeta = true;
        aNext = shiftTs(await aIter.next(), aShift);
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
      // ★ v0.3.114:withBody 形态 —— **单请求**,body 读取纳入 AbortController 保护。
      //   旧版只保护响应头,body(DASH 视频段几 MB)挂死 → promise 永不 settle。
      //   状态检查放在 body reader 里,避免为了看状态码多发一次请求。
      return await fetchWithTimeout(finalURL, { credentials: creds }, HEAD_TIMEOUT_MS, {
        withBody: async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.arrayBuffer();
        },
      });
    };
    // ★ v0.3.113:**去掉 credentials:'include' 路** —— 与 downloadBlob 同理。
    //   v0.3.112 只改了 downloadBlob,漏了 fetchArrayBuffer 这处。
    //   IG CDN 的 ACAO 是空串、ACAC 不是 'true' → include 模式**注定**被 CORS 拒。
    //   留着它只是白等一次往返(而且每次 DASH 下载都要多等一个 RTT)。
    try { return await tryOnce('omit'); }
    catch (e1) {
      if (typeof GM_xmlhttpRequest === 'function') {
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET', url: finalURL,
            responseType: 'arraybuffer',
            // ★ v0.3.114:timeout 按 body 大小给 —— DASH 视频段几 MB,
            //   20s(GM_xhr 是整体超时,含 body 下载)必然不够 → 误判超时。
            timeout: BODY_TIMEOUT_MS,
            onload: (r) => r.status >= 200 && r.status < 300
              ? resolve(r.response)
              : reject(new Error(`HTTP ${r.status}`)),
            // ★ v0.3.113:文案统一成 'GM_xhr 网络失败' ——
            //   旧文案 'GM_xhr failed' 不含 'failed to fetch' 子串,
            //   isRetryableError 认不出来 → 视频下载失败时**不会重试**。
            onerror: () => reject(new Error('GM_xhr 网络失败')),
            ontimeout: () => reject(new Error('GM_xhr 超时')),
          });
        });
      }
      throw e1;
    }
  };

  // v0.2.9 新增:解析 MPEG-DASH manifest(MPD XML)
  // 挑最高码率视频轨 + 音频轨
  // ★ v0.3.110(消重):同一份 manifest 会被老路径(L763)和 Relay 路径(L1379)各解析一次
  //   → 日志重复、XML 白解析两遍。用文本级 memo 缓存,同一份 XML 只解析一次。
  //   ★ 用 manifest 文本本身当 key(不是对象引用)—— 两次拿到的是**不同的对象实例**,
  //     但内容完全一样(同一个 manifest 字段),所以按文本去重才对。
  const DASH_PARSE_MEMO = new Map();
  const DASH_MEMO_MAX = 32;
  const parseDashMPA = (mpdXml) => {
    if (typeof mpdXml === 'string' && mpdXml.length) {
      const memoKey = mpdXml.length + '|' + mpdXml.slice(0, 256) + '|' + mpdXml.slice(-128);
      if (DASH_PARSE_MEMO.has(memoKey)) return DASH_PARSE_MEMO.get(memoKey);
      const parsed = parseDashMPARaw(mpdXml);
      if (DASH_PARSE_MEMO.size >= DASH_MEMO_MAX) {
        DASH_PARSE_MEMO.delete(DASH_PARSE_MEMO.keys().next().value);
      }
      DASH_PARSE_MEMO.set(memoKey, parsed);
      return parsed;
    }
    return parseDashMPARaw(mpdXml);
  };
  const parseDashMPARaw = (mpdXml) => {
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
      // v0.3.97(纯诊断):Media API 失败时把 body 原文打出来
      //   (旧版完全静默 → 只在 log 里留一条 status=400,看不出 IG 到底说了什么)
      {
        let mb = null;
        try { mb = await res.json(); } catch {}
        console.warn(`[IG-SAVER-${VERSION}] Media API 未命中 ${mediaId} → status=${res.status} ct=${res.contentType || '?'} body=${JSON.stringify(mb || res.responseText || '').slice(0, 400)}`);
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
  // ★ v0.3.106:从 IG CDN URL 本身反解「这份 URL 交付了多少像素宽」。
  //   为什么需要:perf-cache / deep-extract 两条兜底路拿不到 candidates[].width,
  //   旧版 _width 恒 0 → 判定永远「宽度未知」→ efg 交叉验证形同虚设。
  //   IG CDN URL 上的尺寸线索有两处(优先 stp,其次路径段):
  //     ① ?stp=dst-jpg_e35_p1080x1080_sh2.08_tt6 → 服务端按 1080x1080 交付 → 1080
  //     ② 路径里的 _s640x640_ / _p150x150_        → 640 / 150
  //   两处都没有(原图 URL 形如 xxx_n.jpg?stp=dst-jpg_e35)→ 返回 0 = 未知。
  const widthFromUrl = (url) => {
    try {
      const u = String(url || '');
      if (!u) return 0;
      // ① stp 里的 _p<N>x<M>
      const stp = u.match(/[?&]stp=[^&]*?_p(\d+)x(\d+)/);
      if (stp) return parseInt(stp[1], 10) || 0;
      // ② 路径里的 _s<N>x<M>_ / _p<N>x<M>_
      const seg = u.match(/[/_]([sp])(\d+)x(\d+)/);
      if (seg) return parseInt(seg[2], 10) || 0;
      return 0;
    } catch { return 0; }
  };

  // ★ v0.3.106:从 feed article 反查作者名。
  //   perf-cache / deep-extract 两条兜底路拿不到注水里的 owner 字段,
  //   旧版分别写死 'unknown' / 'current_page' → 文件名变成 IG#unknown#xxx / IG#current_page#xxx,
  //   用户按作者归档时没法归类。IG feed 卡片里作者信息形态稳定:
  //     ① <img alt="<username> 的头像照片"> / "<username>'s profile picture"
  //     ② <a href="/<username>/"> 一级路径(排除 /p/ /reel/ /stories/ /explore/ 等)
  // ★ v0.3.107(owner 反查按 IG Helper 4.2.2 权威写法重写):
  //   IG Helper 4.2.2 L1368-1370 的 feed DOM 反查写法是:
  //     $self.find("header > div:last-child > div:first-child span a").first().text()
  //       || $self.find('a[href^="/"]').filter(t => t.text().length > 0).first().text();
  //   ★ 关键是**取 a 元素的文本**,不是 img 的 alt、也不是 href 里的路径。
  //     v0.3.106 我只用了 alt + 一级 href → 实际 IG feed 的 header 里作者名是
  //     <header>…<span><a>username</a></span>,图片 alt 为空、href 是 /p/xxx(不是一级路径)
  //     → 两条路都落空 → owner 永远是 'unknown'。
  //   下面按「作者名合法形态」三重校验(排除 IG 的功能入口:点赞/评论/分享等)。
  const ownerFromArticle = (article) => {
    // ★ v0.3.107:判定用的常量**放在函数内部** —— 放模块级会造成作用域耦合
      //   (谁单独把这个函数抽出来跑都会 ReferenceError,测试已经踩到)。
      //   ownerFromArticle 必须是自包含的。
    const OWNER_RE = /^[A-Za-z0-9._]{1,30}$/;
    const OWNER_STOPWORDS = new Set([
      'p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'tv', 'about',
      'developer', 'challenge', 'directory', 'shopping', 'live', 'guides', 'edits',
      'saved', 'settings', 'search', 'home', 'notifications', 'messages', 'create',
      'likes', 'comments', 'share', 'follow', 'more', 'photography', 'besties',
      'photo', 'video', 'carousel', 'replay', 'audio',
    ]);
    // ★ v0.3.107:**每一步独立能力检查** —— 旧版第一步 querySelector 抛异常就被
    //   整体 catch 吞掉,导致 alt / href 两条退路也跟着废掉(反查永远 null)。
    //   → 任何一步失败只跳过那一步,后面的路照走。
    const txt = (el) => {
      try { return (el && el.textContent) ? String(el.textContent).trim() : ''; }
      catch { return ''; }
    };
    const qsa = (sel) => {
      try { return Array.from(article.querySelectorAll(sel) || []); }
      catch { return []; }
    };
    const qs = (sel) => {
      try { return article.querySelector(sel); } catch { return null; }
    };
    const accept = (t) => {
      if (!t) return null;
      const v = String(t).trim();
      if (!v || !OWNER_RE.test(v)) return null;
      if (OWNER_STOPWORDS.has(v.toLowerCase())) return null;
      return v;
    };
    try {
      if (!article) return null;

      // ① ★ IG Helper 权威写法:header 里第一个 span>a 的文本
      const t1 = accept(txt(qs('header span a')));
      if (t1) return t1;

      // ② header 里任意 a 的文本(header > div:last-child > div:first-child span a 的宽松版)
      for (const a of qsa('header a')) {
        const t = accept(txt(a));
        if (t) return t;
      }

      // ③ 退路:带非空文本的一级 href 链接(IG Helper 的 filter(t => t.text().length > 0))
      for (const a of qsa('a[href^="/"]')) {
        const t = accept(txt(a));
        if (t) return t;
        let href = '';
        try { href = a.getAttribute('href') || ''; } catch { /* noop */ }
        const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
        if (m && !OWNER_STOPWORDS.has(m[1].toLowerCase())) return m[1];
      }

      // ④ 退路:img alt(老版 IG 有 "xxx 的头像照片" / "xxx's profile picture")
      for (const img of qsa('img[alt]')) {
        let alt = '';
        try { alt = (img.getAttribute('alt') || '').trim(); } catch { /* noop */ }
        let m = alt.match(/^(.+?)的?头像/);
        if (m && m[1] && OWNER_RE.test(m[1].trim())) return m[1].trim();
        m = alt.match(/^(.+?)'s profile picture/i);
        if (m && m[1] && OWNER_RE.test(m[1].trim())) return m[1].trim();
      }
      return null;
    } catch { return null; }
  };

  // ★ v0.3.106:媒体收集器工厂 —— 收集逻辑抽出来给两条路共用:
  //   ① 页面注水(harvestFromPage):扫 document 里的 script[application/json]
  //   ② 单帖页 HTML 抓取(harvestFromPostPage):拉 /p/<sc>/ 的 HTML 再解析 script
  //   两条路的「同 mediaId 去重 / 同 shortcode 收敛 / 视频早退不推封面」必须完全一致,
  //   所以共用一份实现,而不是复制两份(复制必然漂移 → 串帖/视频回归)。
  const createMediaCollector = (targetShortcode) => {
    const result = [];
    const collectedIndex = new Map();
    const collect = (node, inheritedSc) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach((x) => collect(x, inheritedSc)); return; }

      // ★ v0.3.98:URL 去重。
      //   v0.3.98 加了通用深递归后,同一个媒体节点可能走两条路被收两遍
      //   (老固定路径 node.data / xdt_api 收一遍,深递归再收一遍)
      //   → 同一张图下载两次。
      //   判据:同一个 mediaId + 同一个 URL 视为同一资源,后者丢弃。
      // v0.3.103(去重语义修正 · 2026-10-30 用户实测暴露):
      //   旧 key = `${mediaId}|${url}` → **同一个 mediaId 走「老路径」和「Relay 路径」时,
      //   两边选的候选 URL 可能不同(不同 width 档)→ key 不同 → 同一张图被收两次**
      //   → 用户下载到重复图(实测:同一页面两次 harvest 宽度列表不同 = 两套路径混采)。
      //
      //   新语义:**按 mediaId 单图去重**(没有 mediaId 才退回按 url)。
      //   同 mediaId 再来一条时:**保留 width 更大的那个**(更高档 = 更接近原图),
      //   而不是简单丢弃后来的 —— 因为老路径/Relay 路径的候选档可能不一样大。
      // ★ v0.3.105(视频被封面顶掉 · 2026-10-30 用户实测「视频下载失败」):
      //   ★ 这是 **v0.3.103 引入的回归** —— 姐姐自己造的,认账。
      //
      //   v0.3.103 为了修「同一张图被收两次」,把去重改成「按 mediaId 单图去重,
      //   同 mediaId 保留更宽的」。但**视频帖的封面图和视频是同一个 mediaId**:
      //     pushItem({mediaId: pk, isVideo: true,  url: v_1080.mp4})  ← 视频
      //     pushItem({mediaId: pk, isVideo: false, url: c_1440.jpg })  ← 封面
      //   封面图 width 常常**大于**视频 width(视频 1080 / 封面 1440)
      //   → 「保留更宽的」把**视频顶成封面 JPG** → 下到 .jpg 而不是 .mp4。
      //
      //   修法:去重 key 加 **isVideo 维度** —— 视频和图片是**两种不同资源**,
      //   哪怕 mediaId 相同也不该合并。
      //   同为图片(或同为视频)时,仍按 v0.3.103 的规则保留更宽的档。
      //
      //   ★ 顺带保留 v0.3.104 的收获:「视频帖不该把封面当图片资源下」
      //     这条在 harvest 里由 isVideo 标记区分,下载端靠 isVideo 走 mp4 分支。
      //   ★ v0.3.105 补充:key 必须在「无 mediaId」时**退回用 url**,
      //     否则两个不同 url 会撞成同一个 key('|I')→ 不同图被误合并。
      const mediaKey = (it) => it.mediaId
        ? `${it.mediaId}|${it.isVideo ? 'V' : 'I'}`
        : `url:${it.url || ''}`;
      const pushItem = (item) => {
        if (!item || !item.url) return;
        const key = mediaKey(item);
        const at = collectedIndex.get(key);
        if (at !== undefined) {
          // 已收过同类资源 → 只在「后来这条更宽」时替换
          const prev = result[at];
          if ((item._width || 0) > (prev._width || 0)) {
            const keepIdx = prev.idx;
            result[at] = { ...item, idx: keepIdx };
          }
          return;
        }
        collectedIndex.set(key, result.length);
        item.idx = result.length + 1;
        result.push(item);
      };

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
          // v0.3.96:progressive 兜底 —— video_versions 的 progressive mp4 自带音轨(实测 6/6)
          const progUrl = (() => {
            const vv = node.video_versions;
            if (!Array.isArray(vv) || !vv.length) return node.video_url || null;
            const pb = [...vv].filter(v => v?.url).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
            return pb?.url || node.video_url || null;
          })();
          pushItem({
            mediaId: pk, isVideo: true, url: best.url,
            shortcode: sc, owner, takenAt, idx: result.length + 1,
            _width: best.width || 0,
            _dashAudioUrl: parsed.audio?.[0]?.url || null,
            _dashManifest: node.video_dash_manifest,
            _progressiveUrl: progUrl,
            _source: 'page-harvest',
          });
          return;   // 视频帖不再推封面图
        }
      }

      if (pk && isTarget) {
        if (node.video_versions?.length) {
          const v = node.video_versions[0];
          if (v?.url) {
            pushItem({
              mediaId: pk, isVideo: true, url: v.url,
              shortcode: sc, owner, takenAt, idx: result.length + 1,
              _width: v.width || 0, _source: 'page-harvest',
            });
            // ★ v0.3.105:视频帖**不再推封面图**。
            //   上面的 DASH 分支有 `return; 视频帖不再推封面图` 的早退,
            //   但**只覆盖「有 video_dash_manifest」的帖**。没有 manifest、
            //   只有 video_versions 的视频帖会继续往下走 → 又 push 一次
            //   image_versions2 封面图 → 用户点视频帖多下一个没用的 .jpg。
            //   (skill 铁律:视频封面和内容图要分开判 —— 封面不是内容。)
            return;
          }
        }
        if (node.image_versions2?.candidates?.length) {
          const sorted = [...node.image_versions2.candidates].sort((a, b) => (b.width || 0) - (a.width || 0));
          const c = sorted[0];
          if (c?.url) {
            pushItem({
              mediaId: pk, isVideo: false, url: c.url,
              shortcode: sc, owner, takenAt, idx: result.length + 1,
              _width: c.width || 0, _allWidths: sorted.map(x => x.width || 0),
              _source: 'page-harvest',
            });
          }
        }
      }

      // ★ v0.3.104(串帖修复 · 2026-10-30 用户实测):
      //   症状:点 A 帖的下载按钮,下到了 B 帖的轮播图。
      //   日志文件名证据(目标 DfGd00lzuGx):却下到了 IG#imthngnn#DfFaKeDEi-p#...#02.jpg。
      //
      //   根因:这个 carousel_media 分支**在 `if (pk && isTarget)` 块之外**
      //   → 不做任何 shortcode 收敛 → 页面上**任意帖子**的轮播子图都会被收进来。
      //   (v0.3.72 加 isTarget 过滤时只包住了 video_versions / image_versions2 两处,
      //    漏掉了这个分支。Relay 深递归那两处有 mIsTarget 守卫,是好的。)
      //
      //   修法:**按 sc 收敛**。sc = node.shortcode || node.code || inheritedSc,
      //   已经是「本节点自己的 shortcode」,拿它跟 targetShortcode 比即可。
      //   注意:targetShortcode 为空(feed 全量模式)时不过滤,保持旧行为。
      if (Array.isArray(node.carousel_media) && (!targetShortcode || sc === targetShortcode)) {
        node.carousel_media.forEach((m) => {
          if (!m) return;
          if (m.video_versions?.length) {
            const v = m.video_versions[0];
            if (v?.url) pushItem({
              mediaId: m.pk, isVideo: true, url: v.url,
              shortcode: sc, owner, takenAt, idx: result.length + 1,
              _width: v.width || 0, _source: 'page-harvest-carousel',
            });
            // ★ v0.3.105:轮播里的视频子项**不再推它的封面图**(同主帖早退,对称修复)。
            return;
          }
          if (m.image_versions2?.candidates?.length) {
            const sorted = [...m.image_versions2.candidates].sort((a, b) => (b.width || 0) - (a.width || 0));
            const c = sorted[0];
            if (c?.url) pushItem({
              mediaId: m.pk, isVideo: false, url: c.url,
              shortcode: sc, owner, takenAt, idx: result.length + 1,
              _width: c.width || 0, _allWidths: sorted.map(x => x.width || 0),
              _source: 'page-harvest-carousel',
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

      // ★ v0.3.98(根因修复):IG 改成 Relay 结构后,老字段被埋进 require / __bbox 深层嵌套。
      //   实测(用户日志,2026-10-30):顶层 topKeys=["require"],
      //   全文命中 image_versions2×4 / carousel_media×8 / video_versions×4 / __bbox×4,
      //   但老版 collect 只认 node.data 与 node.xdt_api__v1__media__shortcode__web_info
      //   两条固定路径 → 媒体节点根本走不到 → harvest 永远 0 命中。
      //   修法:加一条**通用深递归** —— 遍历任意数组/对象,凡命中媒体字段就当媒体节点处理。
      //   为什么用通用递归而不是照抄某条具体路径:IG 改一次嵌套层数/键名就得重抄,
      //   通用递归对任意嵌套深度都成立(平台改版免疫)。
      //   三条护栏:
      //     ① 只认「带媒体字段」的节点 → Relay 里大量非媒体对象不会误触发
      //     ② 必须带 pk/id → 媒体节点的身份标志,防止把包装层当媒体
      //     ③ 继承 shortcode → 多帖同页时不会抓到别的帖的图(v0.3.72 的 isTarget 依赖它)
      const hasMediaFields = !!(node.image_versions2?.candidates?.length
        || node.carousel_media || node.video_versions?.length || node.video_dash_manifest);
      const hasIdentity = !!(node.pk || node.id);
      if (hasMediaFields && hasIdentity) {
        // 媒体节点:用「自身 shortcode/code,没有才继承父级」重算一次 sc
        const msc = node.shortcode || node.code || inheritedSc;
        const mIsTarget = !targetShortcode || !msc || msc === targetShortcode;
        if (mIsTarget) {
          const mPk = node.id || node.pk;
          const mOwner = node.owner?.username || node.user?.username || owner;
          const mTaken = node.taken_at_timestamp || node.taken_at || takenAt;
          // 视频(有 manifest 或 video_versions)优先,别把视频帖推成封面图
          if (node.video_versions?.length) {
            const vv = [...node.video_versions].filter(v => v?.url)
              .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
            if (vv) pushItem({
              mediaId: mPk, isVideo: true, url: vv.url,
              shortcode: msc, owner: mOwner, takenAt: mTaken, idx: result.length + 1,
              _width: vv.width || 0, _source: 'page-harvest-relay',
            });
            // ★ v0.3.105:视频帖不再推封面图(同老路径的早退,对称修复)。
            //   Relay 视频帖同样会 video_versions + image_versions2 并存 →
            //   封面图会被当成内容图多下一个 .jpg。
          } else if (node.image_versions2?.candidates?.length) {
            const sorted = [...node.image_versions2.candidates].sort((a, b) => (b.width || 0) - (a.width || 0));
            const c = sorted[0];
            if (c?.url) pushItem({
              mediaId: mPk, isVideo: false, url: c.url,
              shortcode: msc, owner: mOwner, takenAt: mTaken, idx: result.length + 1,
              _width: c.width || 0, _allWidths: sorted.map(x => x.width || 0),
              _source: 'page-harvest-relay',
            });
          }
          // Relay 里的 carousel 可能在 __bbox 内,单独收一遍
          if (Array.isArray(node.carousel_media)) {
            node.carousel_media.forEach((m) => {
              if (!m) return;
              const mv = m.video_versions?.length
                ? [...m.video_versions].filter(v => v?.url).sort((a, b) => (b.width || 0) - (a.width || 0))[0]
                : null;
              if (mv?.url) {
                pushItem({
                  mediaId: m.pk || m.id || mPk, isVideo: true, url: mv.url,
                  shortcode: msc, owner: mOwner, takenAt: mTaken, idx: result.length + 1,
                  _width: mv.width || 0, _source: 'page-harvest-relay-carousel',
                });
                // ★ v0.3.105:轮播视频子项不再推封面(对称修复)
                return;
              }
              const mi = m.image_versions2?.candidates?.length
                ? [...m.image_versions2.candidates].sort((a, b) => (b.width || 0) - (a.width || 0))[0]
                : null;
              if (mi?.url) {
                pushItem({
                  mediaId: m.pk || m.id || mPk, isVideo: false, url: mi.url,
                  shortcode: msc, owner: mOwner, takenAt: mTaken, idx: result.length + 1,
                  _width: mi.width || 0, _allWidths: (m.image_versions2?.candidates || []).map(x => x.width || 0),
                  _source: 'page-harvest-relay-carousel',
                });
              }
            });
          }
        }
      }

      // ★ v0.3.98:通用深递归 —— 钻进 Relay 的 require / __bbox 等任意嵌套。
      //   只递归「对象/数组」,字符串/数字跳过;用 visited 集合防循环引用。
      //   注意:递归时把 sc 传下去,保证深层节点的 shortcode 继承正确。
      if (!node.__igVisited) {
        node.__igVisited = true;
        for (const key of Object.keys(node)) {
          if (key === 'carousel_media' || key === 'edge_sidecar_to_children'
            || key === 'data' || key === 'image_versions2' || key === 'video_versions') continue;
          const v = node[key];
          if (v && typeof v === 'object') collect(v, sc);
        }
      }
    };
    return { result, collect };
  };

  const harvestFromPage = (targetShortcode) => {
    // ★ v0.3.106:收集器来自工厂(与单帖页抓取路共用)
    const { result, collect } = createMediaCollector(targetShortcode);
    // v0.3.97(纯诊断):放宽 script 扫描范围。
    //   旧版只扫 `script[type="application/json"]`。IG 现在部分数据脚本带 data-sjs 属性,
    //   旧版漏扫 → 误判成「平台没有注水」。这里两种都收,只为诊断,不改取数逻辑。
    const scripts = document.querySelectorAll('script[type="application/json"], script[data-sjs]');
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

      // v0.3.97(纯诊断):顶层只查 4 个老字段 → 深层嵌套的老字段会被漏判成「没有」。
      //   改成全文关键字命中计数,老字段在不在,一眼看穿。
      const kwHits = {
        image_versions2: (text.match(/image_versions2/g) || []).length,
        carousel_media: (text.match(/carousel_media/g) || []).length,
        video_versions: (text.match(/video_versions/g) || []).length,
        display_resources: (text.match(/display_resources/g) || []).length,
        xdt_api_web_info: (text.match(/xdt_api__v1__media__shortcode__web_info/g) || []).length,
        shortcode_media: (text.match(/shortcode_media/g) || []).length,
        require: (text.match(/require/g) || []).length,
        bbox: (text.match(/__bbox/g) || []).length,
      };
      // 诊断:记录注水根对象的关键字段
      const topKeys = Object.keys(data || {}).slice(0, 10);
      const hasXdt = !!data?.xdt_api__v1__media__shortcode__web_info;
      const hasSc = !!data?.shortcode_media;
      const hasCarousel = !!data?.carousel_media;
      const hasImgV2 = !!data?.image_versions2;
      if (hasXdt || hasSc || hasCarousel || hasImgV2 || Object.values(kwHits).some(v => v > 0)) {
        diagnostic.push({ topKeys, hasXdt, hasSc, hasCarousel, hasImgV2, size: text.length, kwHits });
      }

      // v0.3.72 三处修:
      //  1) collect(node, inheritedSc) —— 子节点继承父 shortcode(carousel 子节点自身没有 code/shortcode,
      //     v0.3.71 拿不到 shortcode → harvest 产出的 item.shortcode 全是 undefined → downloadItem 的
      //     HD cache 分支直接短路,graphql 路径的原图缓存永远用不上)
      //  2) isTarget 过滤 —— v0.3.71 收了 targetShortcode 参数但从不使用,feed 注水有多个帖时
      //     点 A 帖会连带下到 B 帖的图
      //  3) 新增 video_dash_manifest 分支 —— v0.3.71 完全不看 manifest,Reels 只拿到封面 jpg,
      //     且产出的 item 没有 _dashAudioUrl → runOne 的 mux 分支永远进不去
      // ★ v0.3.106:collect / mediaKey / pushItem 已抽到 createMediaCollector 工厂
      //   (页面注水路 + 单帖页 HTML 抓取路共用同一套去重/守卫/早退逻辑 ——
      //    不复制一份,复制必然漂移:skill「多分支收集器的守卫必须对称」)

      collect(data, null);
      // v0.3.72:命中目标帖才 break。v0.3.71 是 `if (result.length) break`,
      // 第一个注水 script 只要有任意媒体就 break → feed 上抓到别的帖就直接放弃目标帖
      const hitTarget = targetShortcode
        ? result.some((r) => r.shortcode === targetShortcode)
        : result.length > 0;
      if (hitTarget) break;
    }
    if (diagnostic.length) {
      console.log(`[IG-SAVER-${VERSION}] harvest 诊断 (${diagnostic.length} 个相关注水):`, JSON.stringify(diagnostic, null, 0).slice(0, 1200));
      // v0.3.97(纯诊断):把「老字段到底在不在」汇总成一行,不用逐条翻 JSON
      const agg = diagnostic.reduce((a, d) => {
        for (const [k, v] of Object.entries(d.kwHits || {})) a[k] = (a[k] || 0) + v;
        return a;
      }, {});
      console.log(`[IG-SAVER-${VERSION}] harvest 老字段命中汇总:`, JSON.stringify(agg));
    } else {
      // v0.3.97(纯诊断):原来只说「0 个相关注水」,看不出是「字段没了」还是「script 没扫到」。
      //   补上扫了多少 script + 全文关键字统计,一眼区分这两种情况。
      const allText = Array.from(scripts).map(s => s.textContent || '').join('\n');
      const globalHits = {
        image_versions2: (allText.match(/image_versions2/g) || []).length,
        carousel_media: (allText.match(/carousel_media/g) || []).length,
        video_versions: (allText.match(/video_versions/g) || []).length,
        display_resources: (allText.match(/display_resources/g) || []).length,
        xdt_api_web_info: (allText.match(/xdt_api__v1__media__shortcode__web_info/g) || []).length,
        shortcode_media: (allText.match(/shortcode_media/g) || []).length,
        require: (allText.match(/require/g) || []).length,
        bbox: (allText.match(/__bbox/g) || []).length,
      };
      console.log(`[IG-SAVER-${VERSION}] harvest 诊断: 0 个相关注水(扫了 ${scripts.length} 个 script,全文关键字命中: ${JSON.stringify(globalHits)})`);
    }
    return result;
  };

  // ★ v0.3.106:第 5 路取数 —— 单帖页 HTML 抓取。
  //
  //  ★ 为什么需要这条路(用户实测日志实证,2026-10-30):
  //    一次 feed 会话里连续点 8 个帖子,`harvest 诊断` 打出来的注水**8 次完全相同**
  //    (size 恒为 38251、image_versions2 恒为 6、require 恒 2)—— **只有首屏那一批帖子**。
  //    首屏那几个 → page-harvest 命中(1440w / 1536w 原图 ✓);
  //    往下滚之后点的 → 那些帖子的 Relay 数据**不在任何 script 标签里**
  //    (IG 用 GraphQL 增量拉,不注水 DOM)→ page-harvest 必然落空。
  //    而 GraphQL 这条路被账号级风控挡着(feedback_required)→ 只能退到 perf-cache /
  //    deep-extract,拿到的是 feed 渲染档,拿不到完整多档候选。
  //
  //  ★ 为什么单帖页能解决:
  //    skill 已实测(§2.15):**完整多档候选(1440/1536/3072…)只在单帖页 `/p/<shortcode>/` 注水里**,
  //    feed 页只 lazy 当前显示的那一档。单帖页的 Relay 数据同样埋在 require/__bbox 深层,
  //    但它**只有目标帖这一个帖子的数据** → 深递归收集器直接可用,且不会串帖。
  //
  //  ★ 为什么走 GM_xmlhttpRequest(而不是 fetch):
  //    铁律 2.6:用户环境装了 OpenClash/广告拦截扩展,window.fetch 打 IG 域会被
  //    ERR_BLOCKED_BY_CLIENT 拦掉;GM_xmlhttpRequest 走油猴扩展层级,部分绕过。
  //    且必须带 cookie(anonymous:false)—— IG 单帖页要登录态才有完整 Relay 数据。
  // ★ v0.3.106:单帖页结果内存缓存(同一 shortcode 不重复抓,省时间也少打 IG)
  const postPageCache = new Map();
  const POST_PAGE_CACHE_MAX = 20;

  // ★ v0.3.107:返回值改成 {ok, text, status, len, why} —— 可诊断。
  //   沙箱无登录态时 IG 单帖页返回的是 PolarisErrorRoute 错误页(不是 404),
  //   光看「拿到 null」分不清是「被风控」「登录墙」「网络挂了」还是「真没这帖」。
  //   → 用户下一次实测的日志必须能直接看出这条路通不通。
  const fetchPostPageHtml = (shortcode) => new Promise((resolve) => {
    if (typeof GM_xmlhttpRequest !== 'function') {
      return resolve({ ok: false, text: null, status: 0, len: 0, why: 'GM_xmlhttpRequest 不可用' });
    }
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://www.instagram.com/p/${shortcode}/`,
        headers: { 'User-Agent': IG_MOBILE_UA, Accept: 'text/html,application/xhtml+xml' },
        anonymous: false,          // ★ 带 cookie(要登录态才有完整 Relay 数据)
        responseType: 'text',
        timeout: 15000,
        onload: (r) => {
          const text = typeof r.response === 'string' ? r.response : (r.responseText || '');
          const len = (text || '').length;
          if (r.status < 200 || r.status >= 300) {
            return finish({ ok: false, text: null, status: r.status, len, why: `HTTP ${r.status}` });
          }
          // 登录墙 / 错误页识别(IG 的行为:登录墙仍返 200)
          if (/PolarisErrorRoute|accounts\/login|loginForm|not-logged-in/.test(text.slice(0, 200000))) {
            return finish({ ok: false, text, status: r.status, len, why: '返回登录墙/错误页(cookie 可能没带上)' });
          }
          if (!len) {
            return finish({ ok: false, text: null, status: r.status, len, why: '响应为空' });
          }
          finish({ ok: true, text, status: r.status, len, why: '' });
        },
        onerror: (e) => finish({ ok: false, text: null, status: 0, len: 0, why: '网络错误(可能被扩展拦截)' }),
        ontimeout: () => finish({ ok: false, text: null, status: 0, len: 0, why: '超时(15s)' }),
      });
    } catch (e) {
      finish({ ok: false, text: null, status: 0, len: 0, why: `异常:${e && e.message ? e.message : e}` });
    }
  });

  // 从 HTML 里抽出所有 script[application/json] 的 JSON 根对象
  const parseHtmlScriptJson = (html) => {
    const roots = [];
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const els = doc.querySelectorAll('script[type="application/json"], script[data-sjs]');
      for (const el of els) {
        const t = el.textContent || '';
        if (!t || t.length < 2) continue;
        try { roots.push(JSON.parse(t)); } catch { /* 非 JSON,跳过 */ }
      }
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] parseHtmlScriptJson 异常:`, err?.message || err);
    }
    return roots;
  };

  // ★ v0.3.106:单帖页抓取 → 收集 → **按目标 shortcode 收敛**
  const harvestFromPostPage = async (shortcode) => {
    try {
      const cached = postPageCache.get(shortcode);
      if (cached) {
        console.log(`[IG-SAVER-${VERSION}] 单帖页命中缓存 ${shortcode}(${cached.items.length} items)`);
        return cached;
      }
      const res = await fetchPostPageHtml(shortcode);
      const html = res.text;
      if (!res.ok) {
        // ★ v0.3.107:失败必须带原因 —— 用户下一次实测看这一行就能判断这条路通不通
        console.warn(`[IG-SAVER-${VERSION}] 单帖页抓取失败 ${shortcode}: ${res.why}`
          + ` (status=${res.status} len=${res.len})`);
        return null;
      }
      const roots = parseHtmlScriptJson(html);
      if (!roots.length) {
        console.warn(`[IG-SAVER-${VERSION}] 单帖页 ${shortcode} 没有 script[application/json](len=${res.len})`);
        return null;
      }
      const { result, collect } = createMediaCollector(shortcode);
      for (const root of roots) {
        collect(root, null);
        // 命中目标帖即可停(单帖页数据量大,早退省时间)
        if (result.some((r) => r.shortcode === shortcode)) break;
      }
      if (!result.length) {
        console.warn(`[IG-SAVER-${VERSION}] 单帖页 ${shortcode} 收了 ${roots.length} 个注水块但没挖到媒体`);
        return null;
      }
      // ★ 收敛:优先只留 shortcode == 目标帖的项。
      //   单帖页会带「推荐帖/相关帖」,它们的媒体不该被算进来。
      const exact = result.filter((r) => r.shortcode === shortcode);
      const items = exact.length ? exact : result.filter((r) => !r.shortcode);
      console.log(`[IG-SAVER-${VERSION}] 单帖页命中 ${shortcode}: 注水 ${roots.length} 块 → 收 ${result.length} 项`
        + `(目标帖 ${exact.length} 项 / 无 shortcode ${result.length - exact.length} 项),`
        + `top widths: ${items.map((i) => i._width || '?').join(',')}`);
      if (!items.length) return null;
      const post = {
        mediaId: items[0].mediaId, shortcode,
        owner: items[0].owner, takenAt: items[0].takenAt, items,
        _source: 'post-page-html',
      };
      if (postPageCache.size >= POST_PAGE_CACHE_MAX) postPageCache.delete(postPageCache.keys().next().value);
      postPageCache.set(shortcode, post);
      return post;
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] harvestFromPostPage 异常:`, err?.message || err);
      return null;
    }
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

  // ★ v0.3.112:判断一次失败**值不值得重试**。
  //   铁证(2026-10-30 用户 v0.3.111 日志):同一个 URL 先 ERR_CONNECTION_CLOSED
  //   后下载成功 → 这是**网络抖动**(代理/CDN 边缘),重试就能救。
  //   但 HTTP 4xx(URL 失效)、CORS 结构性拒绝 → 重试纯属浪费。
  const isRetryableError = (msg) => {
    const raw = String(msg || '');
    if (!raw.trim()) return false;
    // ★ 归一化:小写 + 把 '_' 和 '-' 也当分隔符
    //   → 'net::ERR_HTTP2_PING_FAILED' → 'net::err http2 ping failed'
    //   (第一版正则写的是 'ping failed' 空格形式,漏了真实的下划线错误码)
    const m = raw.toLowerCase().replace(/[_-]+/g, ' ');
    // ★ HTTP 4xx 是明确的拒绝(URL 失效/无权限),重试无意义 → 先判掉
    if (/http\s*4\d\d/.test(m)) return false;
    // CORS 结构性拒绝 —— 重试无意义
    if (/cors/.test(m)) return false;
    // ★ ERR_FAILED 是 CORS 被拒时浏览器统一报的错误码(不是网络抖动)
    //   → 不重试(重试只会重复撞同一堵墙)
    if (/err failed/.test(m)) return false;
    // 网络层抖动 —— 值得重试(覆盖实测日志里出现过的全部形态)
    const RETRYABLE = [
      'failed to fetch',        // fetch 失败
      'network',                // GM_xhr 网络失败 / network error
      'networkerror',
      'connection',             // ERR_CONNECTION_CLOSED
      'closed',
      'timed out',              // ERR_TIMED_OUT
      'timeout',                // GM_xhr 超时
      '超时',                    // 中文:超时
      '网络',                    // 中文:网络失败
      'reset',                  // ECONNRESET
      'ping failed',            // ERR_HTTP2_PING_FAILED(归一化后)
      'abort',
      'econnreset',
      'econnrefused',
      'socket hang up',
      'failed to load',
    ];
    for (const kw of RETRYABLE) {
      if (m.includes(kw)) return true;
    }
    return false;
  };

  // ★ v0.3.108:嗅探 blob 的**真实图片格式**(不信 URL 后缀、不信 content-type)。
  //   IG CDN 走内容协商(Vary: Accept):URL 是 .jpg 但返回的可能是 webp 字节。
  //   → 扩展名必须跟真实字节一致,否则就是「.jpg 文件里装着 webp」。
  //   判据同 IG Helper 4.2.2 L4868-4871(RIFF....WEBP / FF D8)。
  const sniffImageExt = async (blob) => {
    try {
      if (!blob || typeof blob.slice !== 'function') return null;
      // ★ Blob.prototype.slice 是**同步**返回 Blob;但某些实现返回 Promise。
      //   → Promise.resolve 包一层,两种都吃。(直接 await blob.slice(...).arrayBuffer()
      //   在真实 Blob 上成立,在 Promise 版实现上会炸 —— 这层是兼容垫片。)
      const sliced = await Promise.resolve(blob.slice(0, 12));
      if (!sliced || typeof sliced.arrayBuffer !== 'function') return null;
      const head = new Uint8Array(await sliced.arrayBuffer());
      if (head.length >= 3 && head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return 'jpg';
      if (head.length >= 12
        && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46   // RIFF
        && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) { // WEBP
        return 'webp';
      }
      if (head.length >= 8
        && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) return 'png'; // PNG
      if (head.length >= 12
        && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70
        && head[8] === 0x61 && head[9] === 0x76 && head[10] === 0x69 && head[11] === 0x66) return 'avif'; // ftypavif
      // GIF
      if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'gif';
      return null;
    } catch { return null; }
  };

  // ★ v0.3.107:downloadBlob 回报失败原因(第 4 参 onFail),并**感知 a.click() 被静默拒绝**。
  //   旧版漏洞:拿到 blob → a.click() → 直接 return true。
  //   但浏览器/扩展可能**静默拒绝**这次下载(跨域多文件下载被拦、
  //   「下载多个文件」的询问被拒、非用户手势触发),旧版照样报「✅ 下载完成」→ 用户文件没下来。
  //   → 现在:click 后监听 a 自身的 click 事件是否真的派发;
  //     若 1.5s 内没有派发 → 判定为「浏览器/扩展静默拒绝」并明确报出来。
  // ★ v0.3.108:新增第 5 参 onBlob —— 把拿到的 blob 交给上层判断真实格式。
  const downloadBlob = async (url, filename, useGMDownload = false, onFail = null, onBlob = null) => {
    const finalURL = replaceSameOriginHost(url);
    const fail = (why) => { try { onFail && onFail(why); } catch {} return false; };
    // v0.3.0:CDN 图片是公开资源,带 credentials 反而 CORS 拒。两种都试。
    // ★ v0.3.108:显式声明只收 jpeg/png —— IG CDN 按 Accept 头做内容协商,
    //   不声明的话浏览器默认发 `image/avif,image/webp,*/*` → 拿回 webp 字节。
    //   这不是「降画质换格式」:IG 后端本来就存 jpg 档,协商只决定送不送。
    const tryOnce = async (creds) => {
      // ★ v0.3.114:withBody 形态 —— **单请求**,body 读取纳入 AbortController 保护。
      const opts = {
        credentials: creds,
        headers: { Accept: 'image/jpeg,image/png,*/*;q=0.8' },
      };
      return await fetchWithTimeout(finalURL, opts, HEAD_TIMEOUT_MS, {
        withBody: async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.blob();
        },
      });
    };
    // ★ v0.3.112:**去掉 credentials:'include' 路** —— 它**注定失败**。
    //   实测证据(2026-10-30 用户 v0.3.111 日志):
    //     Access to fetch at 'https://scontent-hkg1-1.cdninstagram.com/...'
    //     from origin 'https://www.instagram.com' has been blocked by CORS policy:
    //     The value of the 'Access-Control-Allow-Credentials' header in the
    //     response is '' which must be 'true' when the request's credentials
    //     mode is 'include'.
    //   → CDN 的 ACAO 是空串、ACAC 不是 'true' → include 模式**永远**被 CORS 拒。
    //     留着它只是白等一次往返 + 刷一条噪音日志。
    //   → 只保留 omit(公开资源,omit 才正确)。
    const tryDownload = async () => {
      try { return await tryOnce('omit'); }
      catch (e1) {
        console.warn(`[IG-SAVER-${VERSION}] fetch omit 失败,试 GM_xhr:`, e1.message);
        if (typeof GM_xmlhttpRequest === 'function') {
          return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
              method: 'GET', url: finalURL,
              responseType: 'blob',
              // ★ v0.3.108:同样显式声明只要 jpeg(否则 GM_xhr 也会协商出 webp)
              headers: { Accept: 'image/jpeg,image/png,*/*;q=0.8' },
              // ★ v0.3.114:补 timeout —— 否则 GM_xhr 挂死时 promise 永不 settle
              timeout: BODY_TIMEOUT_MS,
              onload: (r) => r.status >= 200 && r.status < 300
                ? resolve(r.response)
                : reject(new Error(`GM_xhr HTTP ${r.status}`)),
              onerror: () => reject(new Error('GM_xhr 网络失败')),
              ontimeout: () => reject(new Error('GM_xhr 超时')),
            });
          });
        }
        throw e1;
      }
    };

    if (useGMDownload) {
      // ★ v0.3.108:GM_download 直接把 URL 交给浏览器下载,**拿不到 blob 就没法嗅探**。
      //   → 显式声明只要 jpeg(浏览器会带上这个 Accept),并在日志里说明这条路的限制。
      // ★ v0.3.110:① 本次会话只提示一次(旧版每个 item 都刷一行,4 图帖刷 4 行)
      //   ② 措辞修正:v0.3.109 加了「URL 后缀判定层」,扩展名已由它保证,
      //      「如仍得到 webp 请关掉 GM_download 开关」是过时信息,会误导用户。
      if (!downloadBlob._gmNoticeShown) {
        downloadBlob._gmNoticeShown = true;
        console.log(`[IG-SAVER-${VERSION}] GM_download 模式:已声明 Accept: image/jpeg`
          + `(扩展名由 URL 后缀判定保证;此模式拿不到 blob,无法二次嗅探,如遇格式不符可关掉 GM_download 开关)`);
      }
      return new Promise((resolve) => {
        GM_download({
          url: finalURL,
          name: filename,
          headers: { Accept: 'image/jpeg,image/png,*/*;q=0.8' },
          onload: () => resolve(true),
          onerror: (e) => {
            const why = `GM_download 失败:${(e && (e.error || e.details || e.message)) || '未知'}`;
            console.warn(`[IG-SAVER-${VERSION}] ${why}`);
            resolve(fail(why));
          },
          ontimeout: () => resolve(fail('GM_download 超时')),
        });
      });
    }
    try {
      // ★ v0.3.112:**自动重试** —— 网络层抖动(ERR_CONNECTION_CLOSED /
      //   ERR_HTTP2_PING_FAILED / ERR_TIMED_OUT)是 IG CDN + 代理链的常态抖动,
      //   同一个 URL 重试一次通常就好(用户 v0.3.111 日志实证)。
      //   退避 800ms → 1800ms,最多 3 次机会;不可重试的错误(HTTP 4xx / CORS)立即放弃。
      const RETRY_DELAYS = [800, 1800];
      let blob = null;
      let lastErr = null;
      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
          blob = await tryDownload();
          if (attempt > 0) {
            console.log(`[IG-SAVER-${VERSION}] ✅ 重试第 ${attempt} 次成功: ${filename}`);
          }
          break;
        } catch (err) {
          lastErr = err;
          const why = err && err.message ? err.message : String(err);
          const canRetry = attempt < RETRY_DELAYS.length && isRetryableError(why);
          if (!canRetry) {
            console.warn(`[IG-SAVER-${VERSION}] 下载不再重试(${why})`);
            throw err;
          }
          const wait = RETRY_DELAYS[attempt];
          console.warn(`[IG-SAVER-${VERSION}] 下载失败(${why}),${wait}ms 后重试`
            + `(${attempt + 1}/${RETRY_DELAYS.length})`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      if (!blob) throw lastErr || new Error('取文件失败');
      // ★ v0.3.108:按**真实字节**修正扩展名(不信 URL 后缀)。
      //   IG CDN 内容协商:URL 是 .jpg 但返回的可能是 webp 字节。
      //   旧版硬写 .jpg → 存出来「.jpg 里装着 webp」→ 打开提示格式不符。
      let realName = filename;
      try {
        const realExt = await sniffImageExt(blob);
        if (realExt) {
          const curExt = (filename.match(/\.([A-Za-z0-9]+)$/) || [])[1];
          const curExtLower = curExt ? curExt.toLowerCase() : '';
          const isSame = (curExtLower === realExt)
            || (realExt === 'jpg' && curExtLower === 'jpeg')
            || (curExtLower === 'jpg' && realExt === 'jpeg');
          if (!isSame) {
            realName = filename.replace(/\.[A-Za-z0-9]+$/, '') + '.' + realExt;
            console.log(`[IG-SAVER-${VERSION}] 格式修正: ${filename} → ${realName}`
              + ` (CDN 内容协商给了 ${realExt.toUpperCase()},URL 后缀是 ${curExt || '无'})`);
          }
        }
      } catch { /* noop */ }
      // ★ v0.3.108:把 blob 交给上层 → 上层按真实字节决定扩展名
      if (onBlob) { try { await onBlob(blob, realName); } catch { /* noop */ } }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = realName;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      // ★ 感知静默拒绝:click 事件真的派发才算浏览器接了这次下载
      let dispatched = false;
      a.addEventListener('click', () => { dispatched = true; }, { once: true });
      a.click();
      // 给浏览器一点时间派发 click(同步派发,留 1.5s 余量给扩展异步处理)
      await new Promise((r) => setTimeout(r, 60));
      setTimeout(() => {
        try { a.remove(); URL.revokeObjectURL(a.href); } catch {}
      }, 250);
      if (!dispatched) {
        const why = 'a.click() 未派发(浏览器或扩展静默拒绝下载,常见:多文件下载询问被拒/扩展拦截)';
        console.warn(`[IG-SAVER-${VERSION}] ⚠ ${why}: ${filename}`);
        return fail(why);
      }
      return true;
    } catch (err) {
      const why = `取文件失败:${err && err.message ? err.message : String(err)}`;
      console.error(`[IG-SAVER-${VERSION}] download failed:`, err.message, finalURL);
      return fail(why);
    }
  };

  // ============================================================
  // CSS
  // ============================================================
  GM_addStyle(`
    .ig-saver-fab {
      position: absolute;
      /* v0.3.66:32px → 26px(缩小以塞进图片右缘外的窄边距) */
      width: 28px; height: 28px; border-radius: 50%;
      /* ★ v0.3.82 美化:默认态【无底色】,只有图标 —— 干净通透,不压照片。
         原来是 rgba(0,0,0,.7) 常驻,套在胶囊里就成了「黑饼叠黑底」。
         底色改到 :hover / :focus-visible 才出现(见下)。 */
      background: transparent; color: #fff;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; z-index: 99999;
      /* v0.3.78:显式 pointer-events:auto —— 宿主链任一层带 pointer-events:none 时,
         按钮会变成「看得见但点不到」(视频帖实证:探针捕获次数=0)。这里钉死。 */
      pointer-events: auto;
      /* 白色描边光晕:图标压在亮照片上也看得清(比纯白 fill 稳) */
      filter: drop-shadow(0 1px 2px rgba(0,0,0,.55));
      transition: transform .18s cubic-bezier(.2,.7,.3,1),
                  background-color .18s, box-shadow .18s;
    }
    /* ★ hover / 键盘聚焦时才出圆形底 —— 默认态干净,交互态明确 */
    .ig-saver-fab:hover,
    .ig-saver-fab:focus-visible {
      background-color: rgba(0,0,0,.55);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.22);
      transform: scale(1.12);
      outline: none;
    }
    .ig-saver-fab:active { transform: scale(.94); }
    /* v0.3.68:两个按钮改为**竖排**(column)—— 用户要求。
       顺带好处:胶囊宽度从 ~66px 降到 ~36px,更贴图片右缘,也不容易压到图片 */
    /* ★ v0.3.82:28px 圆钮 + 3px 间距,比例比 26px+4px 更匀称 */
    .ig-saver-fab-pair { display: flex; flex-direction: column; gap: 3px; }
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
      // ★ v0.3.107:owner 拿不到时**不要写 'unknown'** —— 用户看到一排
      //   IG#unknown#xxx#... 分不清哪个是哪个。改用 shortcode 前 6 位占位(可区分)。
      USERNAME: (item.owner && item.owner !== 'unknown') ? item.owner
        : (item.shortcode && item.shortcode !== 'unknown' ? item.shortcode.slice(0, 6) : 'nouser'),
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
      // ★ v0.3.111:失败时明确说下一步做什么(旧版只打 err.message,用户不知道后面还有回落)
      console.error(`[IG-SAVER-${VERSION}] DASH mux failed:`, err.message,
        `→ 开始回落(progressive 完整 mp4 → 分文件)`);
      if (!silent) hideProgress();
      // v0.3.96:回落顺序改了 —— 先试 progressive 完整 mp4,再考虑分文件。
      //   理由(2026-10-27 沙箱 ffprobe 实测):IG 的 video_versions progressive mp4
      //   自带音轨(h264+aac,6/6 全中),是「单个能直接播的有声 mp4」。
      //   v0.3.95 一遇 mux 失败就分文件 + 让用户自己 ffmpeg,白给用户添一步。
      //   progressive 拿不到时,才退回分文件 + ffmpeg 提示(老路径保底)。
      if (item._progressiveUrl && item._progressiveUrl !== item.url) {
        try {
          const progName = getFileName(item, 'mp4');
          console.log(`[IG-SAVER-${VERSION}] 回落 progressive 完整 mp4(自带音轨): ${progName}`);
          const ok = await downloadBlob(item._progressiveUrl, progName, cfg.useGMDownload);
          if (ok) {
            if (!silent) toast(`✅ 已保存(完整含音轨)\n${progName}`, 3000, 'success');
            return true;
          }
          console.warn(`[IG-SAVER-${VERSION}] progressive 回落下载失败,继续走分文件`);
        } catch (pe) {
          console.warn(`[IG-SAVER-${VERSION}] progressive 回落异常:`, pe?.message || pe);
        }
      }
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

  // ══════════════════════════════════════════════════════════════════════
  // ★ v0.3.101(原创真值判据 · 借鉴 skill references/ig-media-efg-truth.md):
  //   IG 媒体 CDN URL 上的 `efg=` 参数(base64url JSON)是**判断「下到的是不是原图」的唯一权威判据**。
  //
  //   为什么不能用 width 元数据判断:
  //     `image_versions2.candidates[].width` 是 **CDN 的处理意图**,不是解码后的真实尺寸。
  //     IG 常把原图重采样成 1080w 交付(URL 带 `stp=dst-jpg_p1080x1080`),
  //     这时 width 标 1080 但文件真身可能仍是 1440 原图。
  //     反过来也成立:博主原图宽可能是 1094 / 1774 这种怪数,IG 如实返回。
  //   真值在 efg 里:`vencode_tag` 的点分段 = `FEED.xpids.1536.sdr.regular_photo.C3`,
  //     其中 `xpids.<N>` = **IG 后端记录的原始像素宽度**。
  //     视频则是 `xpv_progressive.INSTAGRAM.CLIPS.C3.720...`,末段数字 = IG 标定的档位。
  //
  //   判据:**选中候选的 width == 自己解码出的 xpids.N → 拿到的是原图。**
  //
  //   ★ 对家 IG Helper 4.2.2 **没有**这个判据(grep efg/vencode_tag/xpids = 0),
  //     它只看 width 元数据 —— 这是咱们的差异化优势。
  // ══════════════════════════════════════════════════════════════════════
  const decodeEfg = (url) => {
    try {
      if (!url || typeof url !== 'string') return null;
      const m = url.match(/[?&]efg=([^&]+)/);
      if (!m) return null;
      const raw = decodeURIComponent(m[1]);
      let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const obj = JSON.parse(atob(b64));
      const tag = obj?.vencode_tag || '';
      if (!tag) return null;
      // 图片:FEED.xpids.1536.sdr.regular_photo.C3 → 1536
      // 视频:xpv_progressive....C3.720.... → 720(★ 取 .C<n>.<m> 的第二个数,
      //   不能取「末段数字」—— 视频 tag 末段是 dash_baseline_1_v1 的 1,会取错)
      const px = tag.match(/xpids\.(\d+)/);
      if (px) return { tag, origWidth: parseInt(px[1], 10), kind: kindOfEfg(tag) };
      const vid = tag.match(/\.C(\d+)\.(\d+)\b/);
      if (vid) return { tag, origWidth: parseInt(vid[2], 10), kind: kindOfEfg(tag) };
      return { tag, origWidth: null, kind: kindOfEfg(tag) };
    } catch { return null; }
  };

  // efg 资源类型分类(对齐 skill scripts/ig-efg-decode.py 的 kind_of)
  const kindOfEfg = (tag) => {
    if (!tag) return '?';
    const table = [
      ['FEED.xpids', 'feed 单图'],
      ['CAROUSEL_ITEM.xpids', '轮播子图'],
      ['PROFILE_PIC', '头像'],
      ['video_first_frame_thumbnail', 'Reels 封面(非内容)'],
      ['first_frame_thumbnail', '视频首帧'],
      ['xpv_progressive', '视频 progressive'],
      ['xpv_dash', '视频 dash'],
    ];
    for (const [p, label] of table) if (tag.includes(p)) return label;
    return '其它';
  };

  // 用 efg 真值判定「拿到的是是不是原图」,返回给日志用
  //
  // ★ v0.3.106(判定语义修正 · 用户实测日志实证):
  //   旧版把「宽度未知」也判成「降级档 ⚠」。
  //   实测 8 次点击里 6 条被误报 —— 连 efg 原宽 2838w / 2677w 的高清大图
  //   都被标成「拿到的是重采样档」(而原宽 2838 本身就是真原图,非标准档)。
  //   根因:perf-cache / deep-extract 这两条兜底路**根本没有 width 元数据**
  //   (旧版 _width 恒 0 / '?'),claimed=0 也走了 else 分支。
  //   ★ 正确语义:只有「**已知宽度** ≠ efg 原宽」才算降级;宽度未知 → 不下结论(ok=null),
  //   与「拿不到 efg」同等处理。**不知道 ≠ 降级。**
  const checkOriginalByEfg = (url, claimedWidth) => {
    const info = decodeEfg(url);
    if (!info) return { ok: null, note: 'URL 无 efg 参数(非 IG 标准媒体 URL 或已过期)' };
    if (!info.origWidth) return { ok: null, note: `efg 有 tag 但解不出宽度:${info.tag}` };
    const w = Number(claimedWidth) || 0;
    if (!w) {
      // 宽度未知 → 不下结论(与「无 efg」同等)
      return { ok: null, note: `宽度未知,无法比对(efg 原始 ${info.origWidth}w)`, origWidth: info.origWidth };
    }
    if (w === info.origWidth) {
      return { ok: true, note: `原图 ✓(选中 ${w}w == efg 原始 ${info.origWidth}w)`, origWidth: info.origWidth };
    }
    return {
      ok: false,
      note: `降级档 ⚠(选中 ${w}w != efg 原始 ${info.origWidth}w —— 拿到的是重采样档)`,
      origWidth: info.origWidth,
    };
  };

  const downloadItem = async (item, opts = {}) => {
    const { silent = false } = opts;
    let url = item.url;

    // v0.3.58:优先查 HD cache(单帖页 harvest 进来的 1440w)
    // v0.3.77:防御 —— 视频 item 绝不能被图片 HD cache 覆盖 URL
    //   (纯护栏,当前唯一视频入口已绕过 cache,这里防将来新增路径踩坑)
    if (!item.isVideo && item.shortcode && item.idx !== undefined) {
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
    // ★ v0.3.109:扩展名要**同时看三处**,不能只看「是不是视频」:
    //   ① 视频标记 / 视频后缀 → mp4
    //   ② **图片 URL 后缀**(IG 注水给的最高档可能**本身就是 .webp**)
    //      —— 实测:https://.../867752537_..._n.webp?_nc_cat=1
    //      旧逻辑非视频一律 'jpg' → 文件名 .jpg、内容 webp → 张冠李戴。
    //   ③ 兜底 jpg(下载后还有 sniffImageExt 兜底,两层互补:
    //      URL 后缀管「下载前就能判」,嗅探管「下载后才知道」)
    const isVideoUrl = item.isVideo || /\.(mp4|webm|mov)(\?|$|#)/i.test(url);
    let ext;
    if (isVideoUrl) {
      ext = 'mp4';
    } else {
      const urlExt = (String(url).match(/\.(webp|jpg|jpeg|png|avif|gif)(\?|$|#)/i) || [])[1];
      ext = urlExt ? urlExt.toLowerCase().replace('jpeg', 'jpg') : 'jpg';
    }
    const filename = getFileName(item, ext);

    // ★ v0.3.101(真值判据):下载前用 efg 解出「IG 后端记录的原始宽度」,
    //   跟选中候选的 width 对照 → 明确告诉用户「这是原图」还是「这是重采样档」。
    //   宽度元数据 ≠ 真实尺寸(见 decodeEfg 上方注释),这是唯一权威判据。
    {
      const claimed = item._width || 0;
      const verdict = checkOriginalByEfg(url, claimed);
      // ★ v0.3.104:区分「平台只给了这一档」 vs 「我们选错了档」。
      //   依据:注水里该媒体**所有候选的 width 列表**(_allWidths,harvest 时记录)。
      //     最大候选 == 选中档  → 注水最高就这一档 → **平台行为**(feed 页只 lazy 1080 档,
      //       完整多档只在单帖页注水)→ 不是脚本的锅,点进单帖页才有原图。
      //     最大候选 > 选中档   → 注水里有更大的档我们没选 → **脚本 bug**,必须修。
      const allW = Array.isArray(item._allWidths) ? item._allWidths : [];
      const maxW = allW.length ? Math.max(...allW) : claimed;
      let cause = '';
      if (verdict.ok === false) {
        if (allW.length && maxW <= claimed) {
          cause = ` | 注水只有 ${maxW}w 这一档(平台降配,单帖页才有完整多档)`;
        } else if (allW.length && maxW > claimed) {
          cause = ` | ★ 注水有 ${maxW}w 更大档却选了 ${claimed}w —— 选档逻辑有问题`;
        } else {
          cause = ' | 注水候选宽度未知';
        }
      }
      console.log(`[IG-SAVER-${VERSION}] 原图真值判定 #${item.idx ?? '?'}: ${verdict.note}`
        + (verdict.origWidth ? ` | efg 原宽=${verdict.origWidth}` : '')
        + cause);
    }

    if (!silent) showProgress(`下载 ${item.shortcode} #${item.idx} 中…`);
    // ★ v0.3.107:记录失败原因(由 downloadBlob 回填),供失败日志打印
    let downloadFailReason = '';
    const ok = await downloadBlob(url, filename, cfg.useGMDownload, (why) => { downloadFailReason = why; });
    if (!silent) hideProgress();
    // ★ v0.3.102(补确认盲区):图片下载走 a.click() 时**成功是完全静默的**
    //   (旧版只有失败才 console.error)→ 用户看日志只能看到「page-harvest 命中」,
    //   后面断了也不知道下没下下来。现在每个 item 都打一行确认。
    if (ok) {
      console.log(`[IG-SAVER-${VERSION}] ✅ 下载完成 #${item.idx ?? '?'} ${filename}`
        + ` | ${item.isVideo ? '视频' : '图片'} ${item._width || '?'}w | 源=${item._source || '?'}`);
    } else {
      // ★ v0.3.107:失败必须带原因 —— 旧版只打一句「❌ 下载失败」,
      //   用户看到「下载失败」但不知道是取数没拿到、还是 CDN 403、还是浏览器拦了。
      console.warn(`[IG-SAVER-${VERSION}] ❌ 下载失败 #${item.idx ?? '?'} ${filename}`
        + ` | 源=${item._source || '?'} | ${item._width || '?'}w`
        + ` | URL=${String(url).slice(0, 120)}`
        + ` | 失败原因=${downloadFailReason || '未捕获异常'}`);
    }
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
    // v0.3.76:【视频优先】先看 video,再走 img 路径。
    //   不这么排的话,视频帖的封面 <img> 会被 srcset 路径抢先 return,
    //   按钮挂到封面上 —— 这就是「视频帖按钮消失」的真凶。
    const vidFirst = article.querySelector('video');
    if (vidFirst) return vidFirst;

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
    // v0.3.76:视频帖的「封面」本身就是 img,会被路径1/2 抢先命中并 return ——
    //    返回的是封面 img,坐标系落到封面上,按钮看着像「消失」。
    //    修法:有真实渲染出来的 <video> 时**优先返回 video 本身**,
    //    让按钮挂视频框而不是封面图。宽度门槛从 200 放宽到 1
    //    (未播放的 video 可能宽度 0,但 parentElement 仍是有效宿主)。
    const vid = article.querySelector('video');
    if (vid) {
      const r = vid.getBoundingClientRect();
      if (r.width >= 1) return vid;
    }
    // 4) 全落空 → 明确返回 null,由 injectArticleFAB 打日志并下个 tick 重试
    //    (绝不用「猜测」的目标去定位,否则按钮会跑到莫名其妙的位置)
    // ★ v0.3.99(诊断):把「每个 img 为什么被淘汰」打出来。
    //   现象(2026-10-30 用户日志):「pickMediaTarget: 没找到媒体图(1 个 img 全被判定为头像/太小)」
    //   刷了几百次 —— 已知候选只有 1~2 个 img,全被淘汰。
    //   旧日志只说结论不说依据 → 猜不出是 isAvatar 误杀还是宽度门槛不够。
    //   现在逐个 img 打:srcset 宽度 / 渲染宽度 / 头像判定结果 / 判定原因。
    {
      const detail = imgs.map((img) => {
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        const blob = (img.src || '') + ' ' + (img.getAttribute('srcset') || '');
        let why = '';
        if (img.closest('header')) why = 'in-header';
        else if (/profile picture|个人资料|头像|profile photo|用户照片/.test(alt)) why = `alt:${alt.slice(0, 30)}`;
        else if (/avatar|s150x150|s320x320/.test(blob)) {
          const hit = blob.match(/avatar|s150x150|s320x320/)?.[0] || '';
          why = `url:${hit}`;
        }
        const r = img.getBoundingClientRect();
        return {
          srcsetW: maxSrcsetWidth(img),
          renderW: Math.round(r.width || 0),
          renderH: Math.round(r.height || 0),
          naturalW: img.naturalWidth || 0,
          alt: alt.slice(0, 30),
          why,
        };
      });
      // ★ 只在首次(或前 3 次)打详细日志,之后只打计数 —— 旧版 1 秒轮询 × 无限重试
      //   会把控制台刷爆(实测刷了几百行),既淹没有效信息也拖慢页面。
      // ★ v0.3.99:计数行本身也降频(每 20 次打一次)—— 对家 4.2.2 的做法是
      //   「50ms × 最多 100 次,超了 clearInterval + warn」= 有上限的退避,
      //   咱们原来是无上限重试。改成:前 3 次详细 → 之后每 20 次打一行计数。
      pickMediaTarget._diag = (pickMediaTarget._diag || 0) + 1;
      if (pickMediaTarget._diag <= 3) {
        console.log(`[IG-SAVER-${VERSION}] pickMediaTarget 诊断(第 ${pickMediaTarget._diag} 次):`, JSON.stringify(detail));
      } else if (pickMediaTarget._diag === 4) {
        console.log(`[IG-SAVER-${VERSION}] pickMediaTarget 诊断: 后续同因重复,详细输出已抑制(每 20 次打一行计数)`);
      }
      if (pickMediaTarget._diag <= 3 || pickMediaTarget._diag % 20 === 0) {
        console.log(`[IG-SAVER-${VERSION}] pickMediaTarget: 没找到媒体图(${imgs.length} 个 img 全被判定为头像/太小),稍后重试(第 ${pickMediaTarget._diag} 次)`);
      }
    }
    return null;
  };

  // v0.3.75:【纯 CSS 锚定,零 JS 坐标计算】
  //   按钮 wrap 直接包住媒体元素自身 -> wrap 的盒子 = 媒体盒子。
  //   再用 CSS top/right 内缩定位。媒体动 -> wrap 跟着动 -> 结构性不漂。
  const INSIDE = 12;   // 距媒体框右缘(v0.3.80 真身是 15,见 cssText)
  // ★ v0.3.81:让开 IG 右上角的「关注」按钮(用户反馈挡住了)。
  //   关注按钮在帖子卡片右上角、头像行那一层,高度约 40-48px。
  //   同一坑 v0.3.54 撞过一次(用户原话「按钮和关注重叠」),
  //   当时解法是挪右下角;这次保持在右上,改为【往下让开】。
  const AVOID_FOLLOW = 48;

  // v0.3.80:【照抄 IG Helper 4.2.2 的容器选择】—— 九版根因收口
  //   IG Helper 真身(GreasyFork 404535 / SN-Koarashi/ig-helper@master)line 1320:
  //       const $childElement = $mainElement.children("div").children("div");
  //   固定两层 children() 拿到 IG 自己的媒体容器 —— **不猜、不算、不找**。
  //   我此前九版都在自己造坐标系(pickMediaTarget + findHost 猜祖先),
  //   猜错就漂/点不到。而 IG 自己的容器正是视频覆盖层(z=1)所在的那个 context,
  //   挂进去 z-index:1 就够,不必拼 99999(拼了也没用,不在同一 context 不比较)。
  //   另:IG Helper line 1332 会把轮播计数器 ._acay + .x24i39r 下移到 37px 让位,
  //   这里照抄同款避让逻辑。
  const findIgMediaContainer = (article) => {
    try {
      const kids = article.children;
      for (let i = 0; i < kids.length; i++) {
        if (kids[i].tagName !== 'DIV') continue;
        const second = kids[i].children;
        for (let j = 0; j < second.length; j++) {
          if (second[j].tagName !== 'DIV') continue;
          const cand = second[j];
          // 必须有实际渲染面积,且不是外层大容器(排除只含文字/头像的壳)
          const r = cand.getBoundingClientRect();
          if (r.width > 40 && r.height > 40) {
            // 面积要接近媒体区(不能是整条 article 那么大),否则多半选错壳
            const ar = article.getBoundingClientRect();
            if (ar.height > 0 && r.height < ar.height * 0.98) return cand;
          }
        }
      }
    } catch (e) { /* noop */ }
    return null;
  };

  // v0.3.80:照抄 IG Helper —— 主动把 IG 自己的轮播计数器挪开,给按钮让位
  const dodgeIgCounter = (article) => {
    try {
      const acay = article.querySelector('._acay');
      if (!acay) return;
      const next = acay.nextElementSibling;
      if (next) next.style.top = '37px';
    } catch (e) { /* noop */ }
  };

  // v0.3.79:【覆盖层父容器】视频帖专用。
  //   IG 的视频区有一层 position:absolute + z-index:1 的覆盖层(吃点击的)。
  //   探针实测(用户):盖住按钮的就是它 cls=x10l6tqk x13vifvy。
  //   我的 wrap 与它**不在同一 stacking context**,所以 z-index:99999 无效。
  //   修法:挂到它的**父容器**,且该父容器 z-index 必须是 auto(不建 context),
  //        这样 wrap 与覆盖层同 context → z-index 直接可比 → 99999 赢。
  //   判据:position:relative 且 z-index ��为 auto。找不到返回 null(走老 findHost)。
  const findOverlayParent = (article, target) => {
    let n = target && target.parentElement;
    for (let i = 0; i < 10 && n; i++) {
      if (n === article) break;
      if (article.contains(n)) {
        const cs = getComputedStyle(n);
        if (cs.position === 'relative' && cs.zIndex === 'auto') return n;
      }
      n = n.parentElement;
    }
    return null;
  };

  // v0.3.76:【host 兜底链】找一个「能当定位上下文」的宿主。
  //   判据(全部几何实测,不猜 class 名):
  //     · 在 article 内
  //     · 有实际渲染面积(w>20 && h>20)
  //     · 自己不是 display:contents(那种不生成盒子,挂上去等于没挂)
  //   从 target.parentElement 起最多上溯 8 层;全不合格 → 返回 null(交由日志暴露)。
  const findHost = (article, target) => {
    let n = target && target.parentElement;
    for (let i = 0; i < 8 && n; i++) {
      if (n === article) break;
      if (article.contains(n)) {
        const r = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        if (cs.display !== 'contents' && r.width > 20 && r.height > 20) return n;
      }
      n = n.parentElement;
    }
    // 兜底:article 一定有面积 —— 但要确认它自己也合格,不合格就真的没救了
    const ar = article.getBoundingClientRect();
    if (ar.width > 20 && ar.height > 20) return article;
    return null;
  };

  // v0.3.76:定位失败的结构化诊断(每个 shortcode 只打一次,避免刷屏)
  const diagSeen = new Set();
  const diagOnce = (shortcode, target, host) => {
    if (diagSeen.has(shortcode)) return;
    diagSeen.add(shortcode);
    try {
      const chain = [];
      let n = target && target.parentElement;
      for (let i = 0; i < 5 && n; i++) {
        const r = n.getBoundingClientRect(), cs = getComputedStyle(n);
        chain.push(n.tagName + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
          + ' d=' + cs.display + ' p=' + cs.position + ' ov=' + cs.overflow);
        n = n.parentElement;
      }
      console.log('[IG-SAVER-' + VERSION + '] 定位失败 ' + shortcode
        + ' | tag=' + (target && target.tagName)
        + ' | video=' + !!document.querySelector('video')
        + ' | host=' + (host ? host.tagName : 'null') + '\n  祖先链: ' + chain.join('\n         '));
    } catch (e) {
      console.log('[IG-SAVER-' + VERSION + '] 定位失败 ' + shortcode + '(diag 异常)', e);
    }
  };

  const buildPair = (article, shortcode, target) => {
    const wrap = document.createElement('div');
    wrap.className = 'ig-saver-fab-pair';
    // position:absolute 挂在 target 旁边;top/right 是 CSS 固定内缩,不依赖任何测量
    // v0.3.78:z-index 9999 → 99999 + 显式 pointer-events:auto
    //   探针实证(用户实测 捕获次数=0):视频帖按钮「看得见点不到」——
    //   IG 的视频交互层盖在上面吃掉了 click。9999 与 IG 内部层同量级不够稳。
    // v0.3.80:样式对齐 IG Helper .button_wrapper 真身
    //   top/right 15、z-index 1、row-reverse 横排、gap 8、blur(8px)、radius 12
    //   ★ z-index 用 1 不是 99999 —— 进了 IG 自己的容器后,
    //     与视频覆盖层(z=1)同 context,DOM 在后即生效,不需要拼数值。
    wrap.style.cssText = 'position:absolute;z-index:1;pointer-events:auto;line-height:0;'
      + 'display:flex;flex-flow:row-reverse;gap:8px;'
      // ★ v0.3.82 美化:胶囊只留「极淡玻璃」,不再是一道灰黑框。
      //   底色降到 .18 + 保留 blur(8px) → 照片透上来,胶囊像一层薄玻璃。
      + 'background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.14);'
      + 'border-radius:14px;padding:5px 6px;backdrop-filter:blur(10px) saturate(1.4);'
      + '-webkit-backdrop-filter:blur(10px) saturate(1.4);'
      // 投影改柔和一档(原来 0 4px 12px/.2 偏重,小控件显得笨)
      + 'box-shadow:0 2px 10px rgba(0,0,0,0.18);'
      + 'top:' + AVOID_FOLLOW + 'px;right:' + INSIDE + 'px;';
    wrap.dataset.pos = 'media-inside-below-follow';

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

    // ★ v0.3.81 用户要求:调换「下载单个」/「下载全部」上下位置。
    //   wrap 是 flex-direction:column(竖排),DOM 顺序 = 视觉上下顺序,
    //   后 append 的显示在更下面。
    //   改成先 all(下载全部→上)后 cur(下载当前→下)。
    //   ★ 处理器仍绑在各自节点上,顺序换了不影响功能。
    wrap.appendChild(fabAll);
    wrap.appendChild(fabCur);
    wrap.__igArticle = article;
    return wrap;
  };

  // v0.3.83:【P0 自愈】MOUNT_ATTR 只标记「挂过」,不保证 wrap 现在还在 DOM 里。
  //   IG 是重 SPA,会复用同一 article 节点换内容;一旦它重渲染清掉了挂在
  //   自己容器里的 wrap,而 MOUNT_ATTR 留着,老代码直接 early return →
  //   按钮永远不再挂(实测:第1次挂上、第2次挂 0 个)。
  //   修法:early return 之前先核 wrap 真身在不在;不在就清属性走重挂。
  const hasLiveWrap = (article) => {
    try {
      const w = article.querySelector('.ig-saver-fab-pair');
      return !!(w && w.querySelector('.ig-saver-fab'));
    } catch (e) { return false; }
  };

  const injectArticleFAB = (article) => {
    if (article.getAttribute(MOUNT_ATTR) === '1') {
      if (hasLiveWrap(article)) return;          // 按钮还在,正常跳过
      article.removeAttribute(MOUNT_ATTR);        // 按钮已丢 → 清标记,本轮重挂
      try {
        const stale = article.querySelectorAll('.ig-saver-fab-pair');
        for (let i = 0; i < stale.length; i++) stale[i].remove();
      } catch (e) { /* noop */ }
    }
    const shortcode = getShortcodeFromArticle(article);
    if (!shortcode) return;

    // v0.3.75:拿媒体元素(几何尺寸只用于「是不是图」筛除,不用于算坐标)
    const target = pickMediaTarget(article);
    if (!target) return;

    // v0.3.76:【host 兜底链】parentElement 未必是能渲染的坐标系。
    //   视频帖的 <video> 常被 display:contents / 零面积中间层包着 ——
    //   wrap 挂上去坐标系没面积,按钮就渲染不出来(v0.3.75 的消失真凶)。
    //   逐级上溯,取第一个「有面积 + 在 article 内 + 本身可见」的祖先。
    // v0.3.80:【主修】优先挂到 IG 自己的媒体容器(照抄 IG Helper children×2)
    //   拿不到才退回 v0.3.79 的兜底链 —— 图片帖路径不回退。
    const igBox = findIgMediaContainer(article);
    const host = igBox || findOverlayParent(article, target) || findHost(article, target);
    if (!host) {
      diagOnce(shortcode, target, null);
      return;
    }
    dodgeIgCounter(article);
    // v0.3.83:【P1】原来读 host.style.position = **inline** style。
    //   IG 的容器定位几乎都写在 CSS 类里(CSSOM),inline 为空 → 判定 falsy
    //   → 无脑写 'relative',覆盖 IG 原生定位(实测:无定位宿主时 wrap 掉到 y=631)。
    //   修法:读 getComputedStyle(CSSOM 才是真值),只有真 static 才补,
    //   并把原 inline 值记在 host 上,卸载时可还原(不再单方面污染 IG 的 DOM)。
    try {
      const computedPos = getComputedStyle(host).position;
      if (computedPos === 'static') {
        if (!host.dataset.igSaverOrigPosition) {
          host.dataset.igSaverOrigPosition = host.style.position || '';
        }
        host.style.position = 'relative';
      }
    } catch (e) { /* noop */ }

    const wrap = buildPair(article, shortcode, target);
    // 坐标系 = host 本身(媒体框或其最近可渲染祖先),CSS top/right 内缩,零 JS 测量。
    // v0.3.78:【本版主修】insertBefore(wrap, target) → appendChild(wrap)
    //   老写法把 wrap 插到 <video> **之前** = DOM 顺序在 video 前面,
    //   同层 positioned 元素里后出现的 video 叠在 wrap 之上,
    //   加上 IG 的播放/静音/进度条层 → wrap 被完全遮蔽,点不到。
    //   appendChild 让 wrap 排到 video **之后** = 叠在上面。
    //   注:坐标系仍由 host 提供(CSS top/right 内缩),换挂载顺序不改变定位。
    host.appendChild(wrap);
    article.setAttribute(MOUNT_ATTR, '1');
  };

  // v0.3.77:判断 article 是不是视频帖(有 <video> 或 <video> 类容器)
  const articleHasVideo = (article) => {
    if (!article) return false;
    if (article.querySelector('video')) return true;
    try {
      return !!article.querySelector('video, [data-video-id], [class*="Video"]');
    } catch (e) { return false; }
  };

  const runDownloadCurrent = async (article, shortcode) => {
    toast(`⏳ 解析 ${shortcode} …`, 1500);

    // v0.3.77:【按媒体类型分流 —— 本版主修】
    //   老 bug:deepExtractMaxHighImages 排第一,而它只认 <img> 且 items.push
    //   硬编码 isVideo:false。视频帖 article 里**有封面 <img>**,必然被它截胡 →
    //   视频主链 getPostMedia 永远走不到 → 点了没反应。
    //   修法:视频帖直接跳视频主链,图片帖一字不改。
    if (articleHasVideo(article)) {
      console.log(`[IG-SAVER-${VERSION}] runDownloadCurrent: 视频帖,跳过图片辅助函数,直走视频主链`);
      const vpost = await getPostMedia(shortcode);
      const vitems = vpost && vpost.items ? vpost.items : [];
      if (!vitems.length) {
        toast(`❌ ${shortcode} 没取到视频(看 console 日志)`, 4000, 'error');
        return;
      }
      const vitem = vitems[0];
      if (!vitem.url) {
        toast(`❌ ${shortcode} 视频 URL 为空(DASH/video_url 都没拿到)`, 4000, 'error');
        return;
      }
      console.log(`[IG-SAVER-${VERSION}] 视频帖命中:isVideo=${!!vitem.isVideo} url=${String(vitem.url).slice(0, 90)}...`);
      const vok = await downloadItem(vitem);
      toast(vok ? `✅ 已保存 ${shortcode} 视频` : `❌ ${shortcode} 视频保存失败`, 3000, vok ? 'success' : 'error');
      return;
    }

    // v0.3.58:深挖 article 节点所有 img(找最高位原图)—— 图片帖原路径,行为不变
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
          // ★ v0.3.106:owner 从 article 反查(旧版写死 'current_page' → 文件名没法按作者归类)
          owner: ownerFromArticle(article) || 'current_page',
          takenAt: Date.now() / 1000,
          idx: items.length + 1,
          // ★ v0.3.106:宽度兜底从 URL 反解(srcset 描述符常缺失 → 旧版恒 0)
          _width: c.width || widthFromUrl(c.url),
          // ★ v0.3.106:补 _source(旧版 item 级缺 → 下载日志打「源=?」)
          _source: 'deep-extract',
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

    // 1b. ★ v0.3.106:graphql 也失败 → 单帖页 HTML 抓取(第 5 路)
    //   feed 注水只覆盖首屏那批帖子,往下滚的帖子数据不在注水里 →
    //   单帖页 /p/<sc>/ 的 Relay 数据**只有目标帖**,且带完整多档候选。
    if ((!post || !post.items.length)) {
      const pp = await harvestFromPostPage(shortcode);
      if (pp && pp.items.length) post = pp;
    }

    // 2. ★ v0.3.106:调换 perf-cache 与 deep-extract 的先后。
    //   依据(用户实测日志):两条路都命中时,perf-cache 给的是**浏览器实际加载过的原图档 URL**
    //   (isOriginalImageUrl 判据已排除缩略/小图,efg 能解出真实原始宽度),
    //   而 deep-extract 给的是 DOM srcset 候选(实测宽度常为 0 = 未知,可能是 stp 缩略档)。
    //   → 质量更高的一条排前面。两者覆盖范围不同(互补),顺序只影响「都命中」的情形。
    // 2a. PerformanceObserver 原图兜底
    if ((!post || !post.items.length) && article) {
      const perf = harvestFromPerfCache(article, shortcode);
      if (perf.length) {
        console.log(`[IG-SAVER-${VERSION}] → PerformanceObserver 原图兜底命中 ${perf.length} items`);
        post = {
          mediaId: perf[0].mediaId, shortcode, owner: perf[0].owner,
          takenAt: perf[0].takenAt, items: perf,
        };
      }
    }

    // 2b. DOM deep-extract
    if ((!post || !post.items.length) && article) {
      const deep = deepExtractMaxHighImages(article, shortcode);
      if (deep && deep.items.length) {
        console.log(`[IG-SAVER-${VERSION}] → DOM deep-extract 命中 ${deep.items.length} items`);
        post = deep;
      }
    }

    // ★ v0.3.107:取数链总诊断 —— 五路全挂时,把「每一路各自为什么没成」一次性打全。
    //   用户只需要看这一段就知道该修哪:是注水没覆盖?单帖页被拦?perf 没缓存?
    if (!post || !post.items.length) {
      console.warn(`[IG-SAVER-${VERSION}] ❌ ${shortcode} 取数失败(五路全未命中):`
        + ` | 注水=未覆盖(该帖不在首屏注水里)`
        + ` | graphql=${graphqlSpamBlocked ? '风控跳过' : '已试但失败'}`
        + ` | 单帖页=见上一行诊断`
        + ` | perf-cache=${article ? '已试未命中' : '无 article(非 feed 页)'}`
        + ` | deep-extract=${article ? '已试未命中' : '无 article(非 feed 页)'}`);
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
          // ★ v0.3.111(观测闭环):把要用的两个源打出来。
          //   旧版只打「开始 mux」,后面若失败/超时,日志里看不出用的是哪两个 URL。
          console.log(`[IG-SAVER-${VERSION}] DASH 视频 #${item.idx},开始 mux video+audio...`
            + ` | video=${hostOf(item.url)} audio=${hostOf(item._dashAudioUrl)}`);
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
          // v0.3.96:无音轨时优先回落 progressive —— 它自带音轨(实测 6/6),
          //   直接下 DASH video-only 会得到「无声视频」且毫无提示(用户实测症状)。
          //   progressive 都没有才走原路径(下 DASH video-only,可能本就无声)。
          if (item._progressiveUrl && item._progressiveUrl !== item.url) {
            console.log(`[IG-SAVER-${VERSION}] 视频 #${item.idx} 无音轨 → 回落 progressive 完整 mp4(自带音轨)`);
            const progItem = { ...item, url: item._progressiveUrl };
            r = await downloadItem(progItem, { silent: true });
            if (r) return { item, r };
            console.warn(`[IG-SAVER-${VERSION}] 视频 #${item.idx} progressive 回落失败,退回 DASH video-only`);
          }
          r = await downloadItem(item, { silent: true });
        }
      } else {
        r = await downloadItem(item, { silent: true });
      }
      return { item, r };
    };
    // ★ v0.3.113:**批次不再被单个 item 拖死**(修死锁核心)
    //   旧版:Promise.all(chunk.map(runOne)) —— 一个 item 挂死 → 整组不 resolve
    //        → 后续 chunk 永不执行 → 7 张轮播只下 2 张,且 📊 总结永不出现。
    //   现在:① runOne 外面套 ITEM_WATCHDOG_MS 护栏(到点强制判失败)
    //        ② Promise.all → Promise.allSettled(单项失败不 reject 整组)
    //        ③ 失败/超时 item 照常记账进 errors,📊 总结永远会出现。
    for (let i = 0; i < post.items.length; i += PARALLEL) {
      const chunk = post.items.slice(i, i + PARALLEL);
      const settled = await Promise.allSettled(chunk.map((item) => {
        // 单 item 总时长护栏:内部无论怎么挂,到点就放弃这个 item
        let timer = null;
        const guard = new Promise((_, rej) => {
          timer = setTimeout(() => {
            rej(new Error(`item 超时(${ITEM_WATCHDOG_MS}ms)`));
          }, ITEM_WATCHDOG_MS);
        });
        return Promise.race([runOne(item), guard]).finally(() => {
          if (timer) { try { clearTimeout(timer); } catch {} }
        });
      }));
      for (let k = 0; k < settled.length; k++) {
        const st = settled[k];
        const item = chunk[k];
        if (st.status === 'fulfilled') {
          const { r } = st.value;
          if (r) ok++;
          else errors.push(item.idx || '?');
        } else {
          // ★ 被护栏打断 / 内部抛错 → 明确记账,不让批次停摆
          const why = st.reason && st.reason.message ? st.reason.message : String(st.reason);
          console.warn(`[IG-SAVER-${VERSION}] ⚠️ item #${item.idx ?? '?'} 放弃: ${why}`);
          errors.push(item.idx || '?');
        }
      }
    }
    if (ok === post.items.length) {
      toast(`✅ ${shortcode}: ${ok}/${post.items.length} 已保存${harvested.length ? '(原图)' : ''}`, 4000, 'success');
    } else {
      toast(`⚠️ ${shortcode}: ${ok}/${post.items.length} 成功,失败 #${errors.join(',#')}`, 5000, 'warn');
    }
    // ★ v0.3.102(补总结行):旧版只有 toast,控制台里看不到最终战报。
    //   用户看日志只能看到「page-harvest 命中」,后面断了不知道成没成。
    console.log(`[IG-SAVER-${VERSION}] 📊 ${shortcode} 下载总结:成功 ${ok}/${post.items.length}`
      + (errors.length ? ` | 失败 #${errors.join(',#')}` : '')
      + ` | 取数来源=${post.items[0]?._source || '?'}`
      + ` | 宽度=${post.items.map(i => i._width || '?').join(',')}`);
    // ★ v0.3.113:批次收尾标记 —— 之前批次卡死时,日志停在半路,
    //   用户完全看不出「卡住了」,只看到「下到第 2 张就没动静了」。
    //   现在无论成败,最后一行一定是这句 → 批次结束状态一目了然。
    console.log(`[IG-SAVER-${VERSION}] 🏁 ${shortcode} 批次结束:成功 ${ok}/${post.items.length}`
      + (errors.length ? ` | 失败 #${errors.join(',#')}` : ' | 全部成功'));
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
  // ══════════════════════════════════════════════════════════════════════
  // ★ v0.3.100(借鉴 IG Helper 4.2.2):PerformanceObserver 原图抢救兜底
  //
  //   【背景】2026-10-30 用户日志实测:IG graphql 返回
  //     {"message":"feedback_required","is_spam":true,...} —— 账号被风控,
  //     API 全线不可用;DOM 注水虽能挖到(老字段被埋在 Relay require/__bbox 里),
  //     但结构随时会再变。
  //   【对家真值】IG Helper 4.2.2 的 mediaIdFromURL(L6077-6085) +
  //     registerPerformanceObserver(L6139-6161):
  //       IG 自己加载原图时,CDN URL 上带 ig_cache_key 参数,
  //       其 base64 前缀解出来就是 mediaId(实测 atob('MzY3...') = '3670776772828545770')。
  //       对家用 PerformanceObserver 监听 img 资源加载,只收「原图档」,
  //       建立 mediaId → 原图 URL 映射,API 全挂时仍能救图。
  //   【为什么这条路值得做】它是目前唯一**同时绕开 API 风控 + DOM 结构变更**的路:
  //     数据源是浏览器自己的网络层,IG 拦不到,DOM 改版也不影响。
  //   【收哪些图】只收原图档,跟对家同判据:
  //     - URL 含 '_e35'(图片原图)或 '_e15'(头像原图)或 '.webp?'
  //     - 排除 '_e35_s'(缩略变体)
  //     - 排除 '_sNxN' / '_pNxN'(小尺寸档)
  //   【本模块不主动下载】只建映射表,由取数链在最后兜底时查询。
  // ══════════════════════════════════════════════════════════════════════
  const PERF_CACHE = new Map();       // mediaId → { url, ts }
  const PERF_MAX_AGE = 12 * 60 * 60 * 1000;  // 12h,同对家 IMAGE_CACHE_MAX_AGE
  const PERF_MAX_ITEMS = 300;

  // 从 IG 的 CDN URL 里解出 mediaId(对家 mediaIdFromURL 的等价实现)
  const mediaIdFromUrl = (url) => {
    try {
      const u = new URL(url);
      const key = u.searchParams.get('ig_cache_key');
      if (!key) return null;
      const b64 = key.split('.')[0];
      const decoded = atob(b64);
      // mediaId 是纯数字串;解出来不是数字就说明形态变了,不当 mediaId 用
      return /^\d{10,}$/.test(decoded) ? decoded : null;
    } catch { return null; }
  };

  // 判断这个 URL 是不是「原图档」(对家 registerPerformanceObserver 的判据)
  const isOriginalImageUrl = (u) => {
    if (!(u.includes('_e35') || u.includes('_e15') || u.includes('.webp?'))) return false;
    if (u.includes('_e35_s')) return false;                       // 缩略变体
    if (u.match(/_[sp](\d+)x\1(?!\d)/)) return false;             // _s320x320 / _p150x150 小图
    return true;
  };

  const perfPut = (mediaId, url) => {
    if (!mediaId || !url) return;
    if (PERF_CACHE.size >= PERF_MAX_ITEMS) {
      // 淘汰最老的一条
      let oldestKey = null, oldestTs = Infinity;
      for (const [k, v] of PERF_CACHE) {
        if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
      }
      if (oldestKey) PERF_CACHE.delete(oldestKey);
    }
    PERF_CACHE.set(mediaId, { url, ts: Date.now() });
  };

  const perfGet = (mediaId) => {
    if (!mediaId) return null;
    const e = PERF_CACHE.get(mediaId);
    if (!e) return null;
    if (Date.now() - e.ts > PERF_MAX_AGE) { PERF_CACHE.delete(mediaId); return null; }
    return e.url;
  };

  // 注册 PerformanceObserver(一次性,页面生命周期内常驻)
  const registerPerfObserver = () => {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.initiatorType !== 'img') continue;
          const u = entry.name;
          if (!isOriginalImageUrl(u)) continue;
          const id = mediaIdFromUrl(u);
          if (id && !PERF_CACHE.has(id)) perfPut(id, u);
        }
      });
      obs.observe({ entryTypes: ['resource'] });
      console.log(`[IG-SAVER-${VERSION}] PerformanceObserver 原图兜底已启用(mediaId → 原图 URL)`);
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] PerformanceObserver 注册失败(非致命):`, err?.message || err);
    }
  };
  registerPerfObserver();

  // ★ v0.3.100:用 PerformanceObserver 缓存里的原图 URL 做兜底取数。
  //   流程:mediaId 未知 → 只能靠「当前页面上这个帖子的图片 URL」反查。
  //   因为 IG 在页面上加载某张图时,它的 URL 里就带着 mediaId,
  //   所以只要在页面 DOM 里找到属于该帖的 img(哪怕是缩略档),
  //   它的 ig_cache_key 解出的 mediaId 就能在 PERF_CACHE 里换到原图 URL。
  const harvestFromPerfCache = (article, targetShortcode) => {
    const items = [];
    try {
      if (!article) return items;
      const imgs = Array.from(article.querySelectorAll('img[src], img[srcset]'));
      const seen = new Set();
      for (const img of imgs) {
        const blob = (img.src || '') + ' ' + (img.getAttribute('srcset') || '');
        // 从 srcset 的每一档里都试解 mediaId
        const candidates = [img.src || '', ...(img.getAttribute('srcset') || '').split(',').map(s => s.trim().split(' ')[0])]
          .filter(Boolean);
        for (const c of candidates) {
          const mid = mediaIdFromUrl(c);
          if (!mid) continue;
          if (seen.has(mid)) continue;
          const orig = perfGet(mid);
          if (!orig) continue;
          seen.add(mid);
          items.push({
            mediaId: mid,
            isVideo: false,
            url: orig,
            shortcode: targetShortcode || '',
            // ★ v0.3.106:owner 从 article 反查(旧版写死 'unknown' → 文件名 IG#unknown#xxx)
            owner: ownerFromArticle(article) || 'unknown',
            takenAt: Date.now() / 1000,
            idx: items.length + 1,
            // ★ v0.3.106:宽度从 URL 反解(旧版恒 0 → efg 判定永远「宽度未知」)
            _width: widthFromUrl(orig),
            _source: 'perf-cache-original',
          });
          break;   // 一个 img 只取一档
        }
      }
    } catch (err) {
      console.warn(`[IG-SAVER-${VERSION}] harvestFromPerfCache 异常:`, err?.message || err);
    }
    if (items.length) {
      console.log(`[IG-SAVER-${VERSION}] PerformanceObserver 兜底命中 ${items.length} items(mediaId → 原图 URL)`);
    }
    return items;
  };

  const tick = () => {
    const href = location.href;
    if (href === currentURL) {
      mountFeedFABs();
      // v0.3.75:不再需要 reposition —— 按钮靠 CSS 锚定在媒体框上,媒体动它自动跟
      return;
    }
    currentURL = href;
    // v0.3.83:【P0】首项原为 '.ig-saver-post-fab' —— 该类名自 v0.3.33 起
        //   就不再被创建(帖子页/feed 早已改用 '.ig-saver-fab-pair'),是死 selector。
        //   而 feed 的 wrap 恰恰用的就是 '.ig-saver-fab-pair',它原本从不在清理名单里
        //   → SPA 切页时 feed 按钮永远不清(实测:清理前 1 → 清理后 1)。
    document.querySelectorAll('.ig-saver-fab-pair, .ig-saver-story-fab, .ig-saver-reels-fab, .ig-saver-avatar-fab').forEach((el) => el.remove());
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
    const help = `当前模板:${cur}\n\n可用占位符(对齐 IG Helper 4.2.1):\n%USERNAME% 作者名\n%SOURCE_TYPE% Post/Story/Reel/Highlight/Avatar\n%SHORTCODE% 帖子短码\n%YEAR% 年(4位)\n%2-YEAR% 年(2位)\n%MONTH% 月\n%DAY% 日\n%HOUR% 时\n%MINUTE% 分\n%SECOND% 秒\n%ORIGINAL_NAME% IG 原文件名\n%ORIGINAL_NAME_FIRST% 原文件名第一段\n%INDEX% 序号(carousel)\n%UID% 用户数字ID\n\n统一骨架(平台名#作者#帖子id#日期#时间#序号):\n${TPL_DEFAULT}\n\n示例:\n${TPL_DEFAULT}\nIG#%USERNAME%#%SOURCE_TYPE%#%INDEX%\n\n说明:\n· 扩展名不用写进模板,脚本自动补(.jpg / .mp4)\n· %INDEX% 序号自动补零成两位(01 / 02 / 10)\n· %SHORTCODE% 是帖子短码(约 11 位),取不到时是 unknown\n· 分隔符统一用 #,平台名前缀 IG 固定带在最前`;
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
