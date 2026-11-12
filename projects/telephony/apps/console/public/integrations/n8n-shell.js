/*
 * 中文导读：共享基础能力：n8n-shell.js。相关类型、配置或辅助实现集中在本文件。
 */
(function () {
  "use strict";
  if (window.parent === window) return;
  var allowed = new Set(["/home/workflows", "/home/workflows?showArchived=true", "/home/executions", "/home/credentials", "/home/datatables", "/settings/api", "/settings/community-nodes", "/settings/usage"]);
  var lastPath = "";
  var ready = false;
  var pendingDelete = null;
  var deleteSequence = 0;
  var approvedDelete = false;
  function routePath() { return window.location.pathname + window.location.search; }
  function scopedListUrl(input) {
    try {
      var url = new URL(String(input), window.location.href);
      if (url.origin === window.location.origin && url.pathname === '/workflow-editor/rest/workflows' && url.searchParams.has('sortBy') && new URLSearchParams(window.location.search).get('showArchived') === 'true') {
        var filter = JSON.parse(url.searchParams.get('filter') || '{}');
        if (filter && typeof filter === 'object' && !Array.isArray(filter)) { filter.isArchived = true; url.searchParams.set('filter', JSON.stringify(filter)); return url.href; }
      }
    } catch (_) {}
    return input;
  }
  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    var args = Array.from(arguments);
    if (String(args[0]).toUpperCase() === 'GET') args[1] = scopedListUrl(args[1]);
    return nativeOpen.apply(this, args);
  };
  var nativeFetch = window.fetch;
  window.fetch = function (input, options) {
    if ((options && options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase() === 'GET') {
      var original = input instanceof Request ? input.url : input;
      var changed = scopedListUrl(original);
      if (changed !== original) input = input instanceof Request ? new Request(changed, input) : changed;
    }
    return nativeFetch.call(this, input, options);
  };
  document.addEventListener('click', function (event) {
    var action = event.target.closest && event.target.closest('[data-test-id="action-archive"]');
    if (!action || approvedDelete) return;
    event.preventDefault(); event.stopImmediatePropagation();
    var menu = action.closest('[role="menu"]');
    var trigger = menu && document.getElementById(menu.getAttribute('aria-labelledby'));
    var card = trigger && trigger.closest('[data-test-id="resources-list-item-workflow"]');
    pendingDelete = { id: ++deleteSequence, action: action, trigger: trigger };
    window.parent.postMessage({ type: 'taigua:n8n:confirm-delete', id: pendingDelete.id, name: card ? card.getAttribute('data-resourcename') : '所选工作流' }, window.location.origin);
  }, true);
  function approveDeletion(id) {
    if (!pendingDelete || pendingDelete.id !== id) return;
    var pending = pendingDelete; pendingDelete = null;
    function activate() {
      var action = pending.action.isConnected ? pending.action : document.querySelector('[data-test-id="action-archive"]');
      if (!action) return;
      approvedDelete = true;
      try { action.click(); } finally { approvedDelete = false; }
    }
    if (pending.action.isConnected) activate();
    else if (pending.trigger && pending.trigger.isConnected) { pending.trigger.click(); requestAnimationFrame(activate); }
  }
  function syncEngineTheme() {
    var theme = document.documentElement.getAttribute("data-taigua-theme") || "light";
    // Set the engine's native theme too, including controls, dialogs and code editors.
    if (document.body && document.body.getAttribute("data-theme") !== theme) document.body.setAttribute("data-theme", theme);
  }
  function chineseDate(value) {
    var months = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
    return value.replace(/(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December)(?:,? (\d{4}))?/g, function (_, day, month, year) { return (year ? year + '年' : '') + months[month] + '月' + day + '日'; }).replace(/ @ /g, ' ');
  }
  function localizeDates() {
    document.querySelectorAll('[class*="_cardDescription_"], time, [data-test-id="execution-start-time"]').forEach(function (root) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); var node;
      while ((node = walker.nextNode())) { var next = chineseDate(node.nodeValue); if (next !== node.nodeValue) node.nodeValue = next; }
      root.querySelectorAll('[title]').forEach(function (el) { var value = el.getAttribute('title'); var next = chineseDate(value); if (next !== value) el.setAttribute('title', next); });
    });
  }
  function labelShell() {
    localizeDates();
    syncEngineTheme();
    if (document.title !== "自动化流程工作台") document.title = "自动化流程工作台";
    document.querySelectorAll("h1, h2, h3").forEach(function (heading) {
      if (/^n8n API(?: keys?)?$/i.test((heading.textContent || "").trim())) heading.textContent = "流程引擎接口";
    });
    var names = { "/home/workflows": "工作流", "/home/executions": "执行记录", "/home/credentials": "流程凭据", "/home/datatables": "数据表" };
    var heading = document.querySelector('[data-test-id="project-name"]');
    var route = window.location.pathname.replace(/^\/workflow-editor/, "");
    var recycle = new URLSearchParams(window.location.search).get("showArchived") === "true" && route === "/home/workflows";
    if (recycle) names["/home/workflows"] = "回收站";
    if (heading && names[route] && heading.textContent !== names[route]) heading.textContent = names[route];
    if (heading) {
      var wrapper = heading.closest('[class*="_wrapper_"]');
      if (wrapper) wrapper.setAttribute("data-taigua-list-page", "true");
    }
    // Keep the engine's native handlers; only make recoverable archive actions legible.
    var labels = { "存档": "删除（可恢复）", "解档": "恢复", "已存档": "已删除", "显示已归档的工作流": "查看回收站", "删除": "永久删除" };
    document.querySelectorAll('[role="menu"], [role="dialog"], .el-message-box, [data-test-id="workflow-card-archived"]').forEach(function (root) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var value = node.nodeValue.trim();
        if (labels[value]) node.nodeValue = node.nodeValue.replace(value, labels[value]);
      }
    });
    document.querySelectorAll('[data-test-id="archive-toast-delete-permanently-link"]').forEach(function (link) { link.textContent = "永久删除"; });
  }
  function send(type) {
    window.parent.postMessage({ type: type, path: routePath().replace(/^\/workflow-editor/, "") }, window.location.origin);
  }
  function checkReady(force) {
    var path = routePath();
    if (ready && lastPath && path !== lastPath) { ready = false; send("taigua:n8n:loading"); }
    var app = document.getElementById("n8n-app");
    var content = document.getElementById("content");
    if (!app || !content || !content.children.length || (content.textContent || "").trim().length < 30) return;
    // Toolbar text alone is not ready: the engine initially renders an empty/skeleton list.
    if (Array.from(content.querySelectorAll('.resource-list-loading, .resource-list-loading-instant')).some(function (e) { return getComputedStyle(e).display !== 'none'; })) {
      if (ready) { ready = false; send("taigua:n8n:loading"); }
      return;
    }
    if (!force && ready && path === lastPath) return;
    lastPath = path;
    ready = true;
    document.documentElement.setAttribute("data-taigua-route", path.includes("/settings/") ? "settings" : "workspace");
    labelShell();
    send("taigua:n8n:ready");
  }
  // Apply the host theme before the Vue editor renders.
  try {
    document.documentElement.setAttribute("data-taigua-theme", window.parent.document.documentElement.classList.contains("dark") ? "dark" : "light");
  } catch (_) {}
  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    var data = event.data || {};
    if (data.type === "taigua:n8n:approve-delete") approveDeletion(data.id);
    if (data.type === "taigua:n8n:check") checkReady(true);
    if (data.type === "taigua:n8n:theme" && ["light", "dark"].includes(data.theme)) {
      document.documentElement.setAttribute("data-taigua-theme", data.theme);
      syncEngineTheme();
    }
    if (data.type === "taigua:n8n:navigate" && allowed.has(data.path)) {
      var next = "/workflow-editor" + data.path;
      if (routePath() === next) { checkReady(true); return; }
      // The engine initializes list filters on mount. Remount when switching archive scopes.
      if (window.location.pathname === "/workflow-editor/home/workflows" && next.split("?")[0] === window.location.pathname && routePath() !== next) {
        ready = false; send("taigua:n8n:loading"); window.location.assign(next); return;
      }
      // Existing Vue navigation links retain unsaved-change guards for editor changes.
      var anchor = Array.from(document.querySelectorAll("a[href]")).find(function (a) { return a.getAttribute("href") === next; });
      if (anchor) anchor.click();
      else { ready = false; send("taigua:n8n:loading"); window.location.assign(next); }
    }
  });
  var scheduled = false;
  var observer = new MutationObserver(function () {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () { scheduled = false; labelShell(); checkReady(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("load", function () { checkReady(true); });
  window.addEventListener("popstate", function () { checkReady(); });
  setInterval(function () { if (!ready || routePath() !== lastPath) checkReady(); }, 250);
  checkReady();
})();
