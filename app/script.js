/*
  Electric Code Assistant - Ultra-lightweight AI Web IDE
  Developed by Electric Code Assistant | Created by Lakhvinder Singh
  Vanilla JS. Zero frameworks. Auto-save. Multi-model routing. APK-ready.
*/
(function () {
  'use strict';

  /* ============================= Utilities ============================= */

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  };
  var debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };
  var now = function () {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  var uid = function () { return Math.random().toString(36).slice(2, 10); };

  var b64 = {
    encode: function (u8) {
      var chunks = [];
      for (var i = 0; i < u8.length; i += 0x8000) chunks.push(String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)));
      return btoa(chunks.join(''));
    },
    decode: function (s) {
      var bin = atob(s), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    }
  };

  var CryptoBox = {
    _key: null,
    keyBytes: function () {
      if (this._key) return Promise.resolve(this._key);
      var k = localStorage.getItem('eca_key');
      try {
        if (!k) {
          k = b64.encode(crypto.getRandomValues(new Uint8Array(32)));
          localStorage.setItem('eca_key', k);
        }
        this._key = b64.decode(k);
        return Promise.resolve(this._key);
      } catch (e) {
        this._key = new TextEncoder().encode('eca-local-fallback');
        return Promise.resolve(this._key);
      }
    },
    xor: function (s) {
      var k = this._key || new TextEncoder().encode('eca');
      var out = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) ^ k[i % k.length];
      return String.fromCharCode.apply(null, out);
    },
    encrypt: function (str) {
      var self = this;
      return this.keyBytes().then(function (raw) {
        if (!window.crypto || !window.crypto.subtle) {
          return '0.' + b64.encode(new TextEncoder().encode(self.xor(str)));
        }
        var iv = crypto.getRandomValues(new Uint8Array(12));
        return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']).then(function (key) {
          return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(str));
        }).then(function (ct) {
          return '1.' + b64.encode(iv) + '.' + b64.encode(new Uint8Array(ct));
        });
      });
    },
    decrypt: function (str) {
      var self = this;
      return this.keyBytes().then(function (raw) {
        if (!str) return '';
        var parts = String(str).split('.');
        if (parts[0] === '0') {
          return self.xor(new TextDecoder().decode(b64.decode(parts[1])));
        }
        if (parts[0] !== '1' || parts.length < 3) return '';
        if (!window.crypto || !window.crypto.subtle) return '';
        var iv = b64.decode(parts[1]), ct = b64.decode(parts[2]);
        return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']).then(function (key) {
          return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
        }).then(function (pt) { return new TextDecoder().decode(pt); });
      });
    }
  };

  var Store = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem('eca_' + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem('eca_' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ }
    }
  };

  var Secrets = {
    get: function (name) {
      var raw = localStorage.getItem('eca_secret_' + name);
      if (!raw) return Promise.resolve('');
      return CryptoBox.decrypt(raw).catch(function () { return ''; });
    },
    set: function (name, val) {
      if (!val) { localStorage.removeItem('eca_secret_' + name); return Promise.resolve(); }
      return CryptoBox.encrypt(val).then(function (enc) { localStorage.setItem('eca_secret_' + name, enc); });
    },
    clear: function () {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('eca_secret_') === 0) localStorage.removeItem(k);
      });
    }
  };

  /* ============================= Providers ============================= */

  var PROVIDERS = {
    groq: { name: 'Groq', link: 'https://console.groq.com/keys', defaultBase: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', format: 'openai', blurb: 'Fastest - UI/CSS generation' },
    nvidia: { name: 'NVIDIA', link: 'https://build.nvidia.com', defaultBase: 'https://integrate.api.nvidia.com/v1', defaultModel: 'meta/llama-3.1-70b-instruct', format: 'openai', blurb: 'Fast - UI/CSS generation' },
    gemini: { name: 'Google Gemini', link: 'https://aistudio.google.com/apikey', defaultBase: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash', format: 'gemini', blurb: 'Strong - logic & complex reasoning' },
    deepseek: { name: 'DeepSeek', link: 'https://platform.deepseek.com/api_keys', defaultBase: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', format: 'openai', blurb: 'Strong - debugging & logic' },
    openrouter: { name: 'OpenRouter', link: 'https://openrouter.ai/keys', defaultBase: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', format: 'openai', blurb: 'Fallback - many models', demoKey: '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' },
    julelum: { name: 'Julelum', link: 'https://julelum.ai/keys', defaultBase: 'https://api.julelum.ai/v1', defaultModel: 'julelum-1', format: 'openai', blurb: 'Fallback' },
    search: { name: 'Live Search API', link: 'https://brave.com/search/api/', defaultBase: 'https://api.search.brave.com', defaultModel: '', format: 'brave', blurb: 'Real-time web data (Brave Search)' }
  };

  function providerCfg(name) {
    var saved = Store.get('providers', {})[name] || {};
    return {
      base: saved.base || PROVIDERS[name].defaultBase,
      model: saved.model || PROVIDERS[name].defaultModel
    };
  }

  function effectiveKey(name) {
    return Secrets.get(name).then(function (k) {
      if (k) return k;
      return PROVIDERS[name].demoKey || '';
    });
  }

  var ROUTES = {
    generate: ['groq', 'nvidia', 'gemini', 'deepseek', 'openrouter', 'julelum'],
    debug: ['deepseek', 'gemini', 'openrouter', 'groq', 'nvidia', 'julelum'],
    test: ['groq', 'nvidia', 'gemini', 'deepseek', 'openrouter', 'julelum']
  };

  function firstAvailable(list) {
    var chain = Promise.resolve(null);
    list.forEach(function (p) {
      chain = chain.then(function (found) {
        if (found) return found;
        return effectiveKey(p).then(function (k) { return k ? p : null; });
      });
    });
    return chain;
  }

  function route(taskType) {
    var pref = Store.get('route_pref', 'auto');
    if (pref !== 'auto') {
      return Secrets.get(pref).then(function (k) {
        if (k) return pref;
        return firstAvailable(ROUTES[taskType] || ROUTES.generate);
      });
    }
    return firstAvailable(ROUTES[taskType] || ROUTES.generate);
  }

  /* ============================= LLM calls ============================= */

  function openaiCall(cfg, key, messages, opts) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 120000);
    return fetch(cfg.base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: cfg.model,
        messages: messages,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        max_tokens: opts.maxTokens || 4096
      }),
      signal: ctrl.signal
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error((j && j.error && j.error.message) ? j.error.message : 'HTTP ' + res.status);
        });
      }
      return res.json();
    }).then(function (j) {
      return j && j.choices && j.choices[0] ? (j.choices[0].message && j.choices[0].message.content || '') : '';
    });
  }

  function geminiCall(cfg, key, messages, opts) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 120000);
    var url = cfg.base.replace(/\/+$/, '') + '/models/' + encodeURIComponent(cfg.model) + ':generateContent';
    return fetch(url + '?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages.map(function (m) {
          return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
        }),
        generationConfig: {
          temperature: opts.temperature != null ? opts.temperature : 0.7,
          maxOutputTokens: opts.maxTokens || 4096
        }
      }),
      signal: ctrl.signal
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error((j && j.error && j.error.message) ? j.error.message : 'HTTP ' + res.status);
        });
      }
      return res.json();
    }).then(function (j) {
      if (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) {
        return j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
      }
      return '';
    });
  }

  function llmChat(provider, messages, opts) {
    opts = opts || {};
    return effectiveKey(provider).then(function (key) {
      if (!key) throw new Error('No API key configured for ' + PROVIDERS[provider].name + '. Open the API Hub and add one.');
      var cfg = providerCfg(provider);
      if (PROVIDERS[provider].format === 'gemini') return geminiCall(cfg, key, messages, opts);
      return openaiCall(cfg, key, messages, opts);
    });
  }

  function liveSearch(query) {
    return Secrets.get('search').then(function (key) {
      if (!key) return Promise.resolve(null);
      var cfg = providerCfg('search');
      var url = cfg.base.replace(/\/+$/, '') + '/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=5';
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 15000);
      return fetch(url, { headers: { 'X-Subscription-Token': key, Accept: 'application/json' }, signal: ctrl.signal }).then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error('Search failed HTTP ' + res.status);
        return res.json();
      }).then(function (j) {
        if (!j || !j.web || !j.web.results) return [];
        return j.web.results.slice(0, 5).map(function (r) {
          return { title: r.title || '', url: r.url || '', desc: r.description || '' };
        });
      }).catch(function () { return null; });
    });
  }

  /* ============================= Project state ============================= */

  var DEFAULT_HTML = '<header class="app-head">\n  <h1>Electric App</h1>\n  <p class="sub">Ready for your ideas.</p>\n</header>\n<main class="card">\n  <p>Describe an app in the Chat panel and I will build it live.</p>\n</main>\n';
  var DEFAULT_CSS = '/* Electric App base styles */\n* { box-sizing: border-box; margin: 0; }\nbody {\n  font-family: system-ui, sans-serif;\n  min-height: 100vh;\n  background: linear-gradient(160deg, #0f0f0f, #1a1a2e);\n  color: #e8e8e8;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 20px;\n  padding: 24px;\n}\n.app-head { text-align: center; }\n.app-head h1 {\n  font-size: 2.2rem;\n  background: linear-gradient(90deg, #22d3ee, #a78bfa);\n  -webkit-background-clip: text;\n  background-clip: text;\n  color: transparent;\n}\n.sub { color: #9a9a9a; margin-top: 6px; }\n.card {\n  background: rgba(255,255,255,0.05);\n  border: 1px solid rgba(255,255,255,0.1);\n  border-radius: 16px;\n  padding: 24px;\n  max-width: 420px;\n  text-align: center;\n  backdrop-filter: blur(12px);\n  line-height: 1.6;\n}\n';
  var DEFAULT_JS = '// Live wiring runs on load\ndocument.addEventListener("DOMContentLoaded", function () {\n  var clock = document.querySelector(".sub");\n  if (clock) {\n    var tick = function () {\n      clock.textContent = "Live: " + new Date().toLocaleTimeString();\n    };\n    tick();\n    setInterval(tick, 1000);\n  }\n});\n';

  var Project = {
    state: null,
    load: function () {
      this.state = Store.get('project', null);
      if (!this.state || !this.state.files) this.reset();
      return this.state;
    },
    reset: function () {
      this.state = { title: 'Electric App', external: [], files: { 'index.html': DEFAULT_HTML, 'style.css': DEFAULT_CSS, 'script.js': DEFAULT_JS } };
      this.save();
    },
    save: function () { Store.set('project', this.state); },
    names: function () { return Object.keys(this.state.files); },
    get: function (n) { return this.state.files[n] || ''; },
    set: function (n, c) { this.state.files[n] = c; this.save(); },
    add: function (n) {
      var ext = n.split('.').pop().toLowerCase();
      if (ext === 'html') { this.state.files[n] = '<section class="block">New HTML section</section>\n'; }
      else if (ext === 'css') { this.state.files[n] = '/* ' + n + ' */\n.block { padding: 20px; }\n'; }
      else { this.state.files[n] = '// ' + n + '\n'; }
      this.save();
    },
    remove: function (n) {
      if (Object.keys(this.state.files).length <= 1) return;
      delete this.state.files[n];
      this.save();
    }
  };

  /* ============================= Editor ============================= */

  var currentFile = Store.get('curFile', 'index.html');

  var HL = {
    js: function (text) {
      var re = /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|typeof|instanceof|in|of|try|catch|finally|throw|async|await|yield|import|from|export|default|delete|void|null|undefined|true|false|static|get|set)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;
      return this._scan(text, re, function (m) {
        if (m[1] != null) return 'tok-com'; if (m[2] != null) return 'tok-com';
        if (m[3] != null) return 'tok-str'; if (m[4] != null) return 'tok-kw';
        if (m[5] != null) return 'tok-num'; if (m[6] != null) return 'tok-fn';
        return '';
      });
    },
    html: function (text) {
      var re = /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z][\w-]*)|(\/?>)|("[^"]*"|'[^']*')|([a-zA-Z-]+)(?==)|(#[0-9a-fA-F]{3,8}\b)/g;
      return this._scan(text, re, function (m) {
        if (m[1] != null) return 'tok-com'; if (m[2] != null) return 'tok-tag';
        if (m[3] != null) return 'tok-tag'; if (m[4] != null) return 'tok-str';
        if (m[5] != null) return 'tok-attr'; if (m[6] != null) return 'tok-num';
        return '';
      });
    },
    css: function (text) {
      var re = /(\/\*[\s\S]*?\*\/)|("[^"]*"|'[^']*')|([.#]?[a-zA-Z][\w-]*)(?=\s*[,{])|([a-zA-Z-]+)(?=\s*:)|(#[0-9a-fA-F]{3,8}\b|\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|vmin|vmax|s|ms|fr|deg|pt|ch|ex)?)|([{}()])/g;
      return this._scan(text, re, function (m) {
        if (m[1] != null) return 'tok-com'; if (m[2] != null) return 'tok-str';
        if (m[3] != null) return 'tok-sel'; if (m[4] != null) return 'tok-prop';
        if (m[5] != null) return 'tok-num'; if (m[6] != null) return 'tok-brace';
        return '';
      });
    },
    _scan: function (text, re, fn) {
      re.lastIndex = 0;
      var out = '', last = 0, m;
      while ((m = re.exec(text))) {
        out += esc(text.slice(last, m.index));
        var cls = fn(m);
        var seg = esc(m[0]);
        out += cls ? '<span class="' + cls + '">' + seg + '</span>' : seg;
        last = m.index + m[0].length;
      }
      out += esc(text.slice(last));
      return out;
    }
  };

  function langOf(name) {
    var e = name.split('.').pop().toLowerCase();
    if (e === 'html' || e === 'htm') return 'html';
    if (e === 'css') return 'css';
    return 'js';
  }

  var hlEl = $('#hl'), codeEl = $('#code');
  var dirty = false;

  function renderFileList() {
    var list = $('#fileList');
    list.innerHTML = '';
    Project.names().forEach(function (name) {
      var li = document.createElement('li');
      li.className = 'file-item' + (name === currentFile ? ' active' : '');
      li.dataset.file = name;
      var fi = document.createElement('span');
      fi.className = 'fi';
      fi.textContent = langOf(name);
      var label = document.createElement('span');
      label.textContent = name;
      var del = document.createElement('button');
      del.className = 'del';
      del.title = 'Delete file';
      del.textContent = 'x';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        Project.remove(name);
        if (currentFile === name) { currentFile = Project.names()[0]; Store.set('curFile', currentFile); }
        renderFileList(); renderTabs(); openEditor();
      });
      li.appendChild(fi); li.appendChild(label); li.appendChild(del);
      li.addEventListener('click', function () {
        currentFile = name; Store.set('curFile', currentFile);
        renderFileList(); renderTabs(); openEditor();
      });
      list.appendChild(li);
    });
  }

  function renderTabs() {
    var tabs = $('#fileTabs');
    tabs.innerHTML = '';
    Project.names().forEach(function (name) {
      var t = document.createElement('div');
      t.className = 'tab' + (name === currentFile ? ' active' : '');
      t.textContent = name;
      t.addEventListener('click', function () {
        currentFile = name; Store.set('curFile', currentFile);
        renderFileList(); renderTabs(); openEditor();
      });
      tabs.appendChild(t);
    });
  }

  function openEditor() {
    if (!Project.state.files[currentFile]) currentFile = Project.names()[0];
    codeEl.value = Project.get(currentFile);
    refreshHighlight();
    $('#langInfo').textContent = langOf(currentFile).toUpperCase();
    updateLineInfo();
  }

  function refreshHighlight() {
    var lang = langOf(currentFile);
    hlEl.innerHTML = HL[lang] ? HL[lang](codeEl.value) : esc(codeEl.value);
    syncScroll();
  }

  function syncScroll() {
    hlEl.scrollTop = codeEl.scrollTop;
    hlEl.scrollLeft = codeEl.scrollLeft;
  }

  function updateLineInfo() {
    var pos = codeEl.selectionStart || 0;
    var before = codeEl.value.slice(0, pos);
    var lines = before.split('\n');
    $('#lineInfo').textContent = 'Ln ' + lines.length + ', Col ' + (lines[lines.length - 1].length + 1);
  }

  var savePillTimer;
  function markSaving() {
    var pill = $('#savePill');
    pill.textContent = 'Saving...';
    pill.classList.add('saving');
    clearTimeout(savePillTimer);
    savePillTimer = setTimeout(function () {
      pill.textContent = 'Saved';
      pill.classList.remove('saving');
    }, 700);
  }

  codeEl.addEventListener('input', function () {
    dirty = true;
    Project.set(currentFile, codeEl.value);
    refreshHighlight();
    updateLineInfo();
    markSaving();
    scheduleSave();
  });
  codeEl.addEventListener('scroll', syncScroll);
  codeEl.addEventListener('keyup', updateLineInfo);
  codeEl.addEventListener('click', updateLineInfo);

  function scheduleSave() {
    debounceSave();
  }
  var debounceSave = debounce(function () { Project.save(); }, 500);

  /* ============================= Preview ============================= */

  function buildStandalone() {
    var s = Project.state;
    var head = '';
    var scripts = '';
    (s.external || []).forEach(function (u) {
      if (/\.css($|\?)/i.test(u)) head += '<link rel="stylesheet" href="' + esc(u) + '">';
      else scripts += '<script src="' + esc(u) + '"><\/script>';
    });
    var htmlParts = '', cssParts = '', jsParts = '';
    Project.names().forEach(function (name) {
      var lang = langOf(name);
      var content = Project.get(name);
      if (lang === 'html') htmlParts += content + '\n';
      else if (lang === 'css') cssParts += content + '\n';
      else jsParts += content + '\n';
    });
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
      '<title>' + esc(s.title || 'Electric App') + '</title>\n' +
      head + '<style>' + cssParts + '</style>\n</head>\n<body>\n' +
      htmlParts +
      scripts +
      '<script>\ntry {\n' + jsParts + '\n} catch (err) {\n  parent.postMessage({type:"eca:error",msg:String(err && err.message || err)},"*");\n}\n<\/script>\n' +
      '<script>\nwindow.addEventListener("error",function(ev){parent.postMessage({type:"eca:error",msg:ev.message,line:ev.lineno},"*");});\n' +
      'window.addEventListener("unhandledrejection",function(ev){parent.postMessage({type:"eca:error",msg:"Unhandled rejection: "+String(ev.reason)},"*");});\n<\/script>\n' +
      '</body>\n</html>';
  }

  function renderPreview() {
    hidePreviewError();
    $('#preview').srcdoc = buildStandalone();
  }

  function openPreviewTab() {
    var blob = new Blob([buildStandalone()], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  var currentError = null;

  function showPreviewError(msg, line) {
    currentError = { msg: msg, line: line };
    $('#errMsg').textContent = line ? (msg + '  (line ' + line + ')') : msg;
    $('#errOverlay').classList.remove('hidden');
  }
  function hidePreviewError() {
    currentError = null;
    $('#errOverlay').classList.add('hidden');
  }

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'eca:error') {
      showPreviewError(e.data.msg || 'Unknown error', e.data.line);
      toast('Runtime error detected - use Auto-Fix', 'error');
    }
  });

  /* ============================= Auto-fix ============================= */

  function parseJSON(text) {
    var t = String(text).trim();
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    var s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try { return JSON.parse(t.slice(s, e + 1)); } catch (err) { /* fall through */ }
    }
    return null;
  }

  function autoFix() {
    if (!currentError) return;
    var err = currentError.msg;
    hidePreviewError();
    var filesDump = Project.names().map(function (n) {
      return '===== ' + n + ' =====\n' + Project.get(n);
    }).join('\n\n');
    var prompt = 'A web app generated in an editor has a runtime error.\n\nError: ' + err +
      '\n\nFiles:\n' + filesDump +
      '\n\nFix the bug. Reply with ONLY a JSON object: {"title":"...","files":{"filename":"full corrected content", ...}} - include EVERY file in "files" using the exact filenames above, each with its complete content.';

    addChatMsg('sys', 'Auto-fixing error with debug model...');
    setBusy(true, 'debug');
    route('debug').then(function (prov) {
      if (!prov) { throw new Error('No API key configured. Open the API Hub to add a debug model (DeepSeek recommended).'); }
      setBusyLabel(prov);
      return llmChat(prov, [
        { role: 'system', content: 'You are a precise senior web debugger. Output valid JSON only.' },
        { role: 'user', content: prompt }
      ], { temperature: 0.2, maxTokens: 8000 });
    }).then(function (text) {
      var obj = parseJSON(text);
      if (!obj || !obj.files) throw new Error('Debug model returned unparseable output.');
      var changed = [];
      Project.names().forEach(function (n) {
        if (typeof obj.files[n] === 'string') { Project.set(n, obj.files[n]); changed.push(n); }
      });
      Project.state.title = obj.title || Project.state.title;
      Project.save();
      if (changed.length) {
        openEditor(); renderFileList(); renderTabs();
        renderPreview();
        addChatMsg('ai', 'Fixed the error in: ' + changed.join(', ') + '. Preview refreshed.');
        toast('Auto-fix applied');
      } else {
        throw new Error('Debug model did not return any file content.');
      }
    }).catch(function (err) {
      addChatMsg('error', err.message);
      toast(err.message, 'error');
    }).then(function () {
      setBusy(false);
    });
  }

  /* ============================= Generation ============================= */

  var SYSTEM_PROMPT =
    'You are Electric Code Assistant, an elite front-end engineer built by Lakhvinder Singh. ' +
    'Generate complete, production-ready, ultra-lightweight web apps (vanilla HTML/CSS/JS, no frameworks). ' +
    'Reply with ONLY valid JSON - no markdown fences - matching exactly:\n' +
    '{"title":"...","summary":"...","html":"...full body HTML (no <html>/<head>/<body> tags)...",' +
    '"css":"...full stylesheet...","js":"...full script (no <script> tags)...","external":["...optional CDN URLs..."]}\n' +
    'Rules: dark-mode aesthetic with subtle glassmorphism and neon cyan/yellow/purple accents unless the user asks otherwise; ' +
    'mobile-first responsive design; large touch targets; graceful error handling in the JS; ' +
    'only reference external CDNs in the "external" array when strictly required. Escape quotes/newlines correctly in JSON.';

  var SEARCH_HINT = /\b(weather|news|score|cricket|lyrics|stock|price|forecast|sports|football|stocks|air quality|exchange rate|top (songs|movies)|recipe)\b/i;

  function buildGenerateMessages(prompt, searchCtx) {
    var msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
    var ctx = [];
    var hasContent = Project.names().some(function (n) { return Project.get(n).trim().length > 0; });
    if (hasContent && Store.get('first_gen', true) === false) {
      var dump = Project.names().map(function (n) { return '===== ' + n + ' =====\n' + Project.get(n); }).join('\n\n');
      ctx.push('The user already has this current project:\n' + dump +
        '\nTreat the request below as a MODIFICATION of this project. Produce a complete updated project.');
    } else {
      ctx.push('This is a fresh project. Build a brand new app.');
    }
    if (searchCtx && searchCtx.length) {
      ctx.push('\nLIVE WEB DATA gathered for this request (use it for real, dynamic content):\n' +
        searchCtx.map(function (r) { return '- ' + r.title + ' :: ' + r.url + ' :: ' + r.desc; }).join('\n'));
    }
    ctx.push('User request: ' + prompt);
    msgs.push({ role: 'user', content: ctx.join('\n\n') });
    return msgs;
  }

  function applyGenerated(obj) {
    var s = Project.state;
    s.title = obj.title || s.title;
    s.external = Array.isArray(obj.external) ? obj.external : [];
    var files = { 'index.html': obj.html || '', 'style.css': obj.css || '', 'script.js': obj.js || '' };
    s.files = files;
    Project.save();
    currentFile = 'index.html';
    Store.set('curFile', currentFile);
    openEditor();
    renderFileList();
    renderTabs();
    renderPreview();
    setFirstGenDone();
  }

  function setFirstGenDone() { Store.set('first_gen', false); }

  function handleGenerate() {
    var input = $('#chatInput');
    var prompt = input.value.trim();
    if (!prompt) return;
    input.value = '';
    input.style.height = 'auto';
    addChatMsg('user', prompt);

    var thinkingEl = addThinking('Routing to best model...');
    setBusy(true, 'generate');
    setView('chat');

    var searchPromise = SEARCH_HINT.test(prompt) ? liveSearch(prompt) : Promise.resolve(null);

    searchPromise.then(function (results) {
      if (results && results.length) {
        thinkingEl.querySelector('.label').textContent = 'Live data fetched - ' + results.length + ' results. Generating...';
      }
      return route('generate');
    }).then(function (prov) {
      if (!prov) throw new Error('No API key configured. Open the API Hub to add a provider (Groq or NVIDIA recommended).');
      setBusyLabel(prov);
      thinkingEl.querySelector('.label').textContent = 'Building with ' + PROVIDERS[prov].name + '...';
      return llmChat(prov, buildGenerateMessages(prompt, null), { temperature: 0.6, maxTokens: 8000 }).then(function (text) {
        return { prov: prov, text: text };
      });
    }).then(function (r) {
      var obj = parseJSON(r.text);
      if (!obj || typeof obj.html !== 'string') throw new Error('Model returned unparseable output. Try again or switch model.');
      applyGenerated(obj);
      removeMsg(thinkingEl);
      addChatMsg('ai', obj.summary || ('Generated "' + (obj.title || 'app') + '" successfully.'), { route: r.prov, ms: null });
      toast('App generated - ready for APK export');
      setView('preview');
    }).catch(function (err) {
      removeMsg(thinkingEl);
      addChatMsg('error', err.message);
      toast(err.message, 'error');
    }).then(function () {
      setBusy(false);
    });
  }

  /* ============================= Chat UI ============================= */

  var CHAT_KEY = 'chat_log';

  function persistChat() {
    var items = [];
    $$('#chatLog .msg').forEach(function (el) {
      items.push({ cls: el.classList.contains('user') ? 'user' : (el.classList.contains('error') ? 'error' : 'ai'), text: el.textContent });
    });
    Store.set(CHAT_KEY, items.slice(-60));
  }

  function addChatMsg(cls, text, meta) {
    var log = $('#chatLog');
    var div = document.createElement('div');
    div.className = 'msg ' + cls;
    var pre = document.createElement('div');
    pre.textContent = text;
    div.appendChild(pre);
    if (meta && meta.route) {
      var metaEl = document.createElement('span');
      metaEl.className = 'msg-meta';
      metaEl.textContent = 'via ' + PROVIDERS[meta.route].name + (meta.ms != null ? ' - ' + meta.ms + 's' : '');
      div.appendChild(metaEl);
    }
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    persistChat();
  }

  function addThinking(label) {
    var log = $('#chatLog');
    var div = document.createElement('div');
    div.className = 'thinking';
    div.innerHTML = '<span class="spinner"></span><span class="label"></span>';
    div.querySelector('.label').textContent = label;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function removeMsg(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function restoreChat() {
    var items = Store.get(CHAT_KEY, []);
    var log = $('#chatLog');
    log.innerHTML = '';
    items.forEach(function (it) {
      var div = document.createElement('div');
      div.className = 'msg ' + (it.cls === 'error' ? 'error' : it.cls);
      div.textContent = it.text;
      log.appendChild(div);
    });
    log.scrollTop = log.scrollHeight;
  }

  /* ============================= Busy / route pill ============================= */

  var busy = false;

  function setBusyLabel(prov) {
    var pill = $('#routePill');
    pill.innerHTML = '<span class="dot"></span>Route: ' + PROVIDERS[prov].name;
  }

  function setBusy(on, type) {
    busy = on;
    var pill = $('#routePill');
    var genBtn = $('#genBtn');
    genBtn.disabled = on;
    if (on) {
      pill.classList.add('busy');
      pill.innerHTML = '<span class="dot"></span>Working...';
    } else {
      pill.classList.remove('busy');
      refreshRoutePill();
    }
  }

  function refreshRoutePill() {
    var pill = $('#routePill');
    route('generate').then(function (p) {
      pill.innerHTML = p
        ? '<span class="dot"></span>Route: ' + PROVIDERS[p].name
        : 'Route: None (set API keys)';
    });
  }

  /* ============================= API Hub / Settings ============================= */

  function buildHub() {
    var body = $('#hubBody');
    body.innerHTML = '';
    var hasDemo = Object.keys(PROVIDERS).some(function (n) { return PROVIDERS[n].demoKey; });
    if (hasDemo) {
      var demoNote = document.createElement('div');
      demoNote.className = 'hub-note';
      demoNote.textContent = 'Demo AI is pre-enabled (OpenRouter) — just type your idea in Chat and press Generate. You can also replace it with your own key below.';
      body.appendChild(demoNote);
    }
    Object.keys(PROVIDERS).forEach(function (name) {
      var P = PROVIDERS[name];
      var cfg = providerCfg(name);

      var card = document.createElement('div');
      card.className = 'provider-card';
      card.dataset.provider = name;

      var head = document.createElement('div');
      head.className = 'pc-head';

      var nm = document.createElement('span');
      nm.className = 'pc-name';
      nm.textContent = P.name;

      var status = document.createElement('span');
      status.className = 'pc-status';
      status.innerHTML = '<span class="dot"></span><span class="txt">Not configured</span>';

      head.appendChild(nm);
      head.appendChild(status);
      card.appendChild(head);

      var bd = document.createElement('div');
      bd.className = 'pc-body';

      if (P.blurb) {
        var blurb = document.createElement('div');
        blurb.className = 'hub-note';
        blurb.textContent = P.blurb;
        bd.appendChild(blurb);
      }

      function mkField(labelText, idSuffix, type, val, ph) {
        var f = document.createElement('div');
        f.className = 'field';
        var l = document.createElement('label');
        l.textContent = labelText;
        var inp = document.createElement('input');
        inp.type = type;
        inp.value = val;
        inp.placeholder = ph || '';
        inp.dataset.field = idSuffix;
        f.appendChild(l);
        f.appendChild(inp);
        return f;
      }

      bd.appendChild(mkField('API Key (directly paste here)', 'key', 'password', '', 'Apni ' + P.name + ' API key yahan paste karein...'));
      if (P.format !== 'brave') {
        var row = document.createElement('div');
        row.className = 'field-row';
        row.appendChild(mkField('Base URL', 'base', 'text', cfg.base, ''));
        row.appendChild(mkField('Model', 'model', 'text', cfg.model, ''));
        bd.appendChild(row);
      } else {
        bd.appendChild(mkField('Base URL', 'base', 'text', cfg.base, ''));
      }

      var actions = document.createElement('div');
      actions.className = 'pc-actions';
      var testBtn = document.createElement('button');
      testBtn.className = 'mini-btn';
      testBtn.textContent = 'Test connection';
      var saveBtn = document.createElement('button');
      saveBtn.className = 'mini-btn';
      saveBtn.textContent = 'Save';
      actions.appendChild(testBtn);
      actions.appendChild(saveBtn);
      bd.appendChild(actions);

      card.appendChild(bd);
      body.appendChild(card);

      Secrets.get(name).then(function (k) {
        var keyInput = card.querySelector('input[data-field="key"]');
        if (k) {
          keyInput.value = k;
          status.classList.add('ok');
          status.querySelector('.txt').textContent = 'Key stored';
        } else if (P.demoKey) {
          keyInput.value = P.demoKey;
          status.classList.add('demo');
          status.querySelector('.txt').textContent = 'Demo key loaded';
        }
      });

      saveBtn.addEventListener('click', function () {
        var key = card.querySelector('input[data-field="key"]').value.trim();
        var base = card.querySelector('input[data-field="base"]');
        var model = card.querySelector('input[data-field="model"]');
        var prov = Store.get('providers', {});
        var saveBase = base ? base.value.trim() : '';
        var saveModel = model ? model.value.trim() : '';
        prov[name] = {
          base: saveBase || P.defaultBase,
          model: saveModel || P.defaultModel
        };
        Store.set('providers', prov);
        Secrets.set(name, key).then(function () {
          status.classList.add('ok');
          status.querySelector('.txt').textContent = key ? 'Key stored' : 'No key';
          toast(P.name + ' settings saved');
          refreshRoutePill();
        });
      });

      testBtn.addEventListener('click', function () {
        var key = card.querySelector('input[data-field="key"]').value.trim();
        status.className = 'pc-status';
        status.innerHTML = '<span class="dot"></span><span class="txt">Testing...</span>';
        if (!key) {
          status.classList.add('bad');
          status.querySelector('.txt').textContent = 'Enter a key first';
          return;
        }
        var base = card.querySelector('input[data-field="base"]');
        var model = card.querySelector('input[data-field="model"]');
        var p = Object.assign({}, PROVIDERS[name], {
          base: (base ? base.value.trim() : '') || P.defaultBase,
          model: (model ? model.value.trim() : '') || P.defaultModel
        });
        var t0 = Date.now();
        var work;
        if (P.format === 'brave') {
          work = fetch(p.base.replace(/\/+$/, '') + '/res/v1/web/search?q=test&count=1', {
            headers: { 'X-Subscription-Token': key, Accept: 'application/json' }
          }).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
        } else if (P.format === 'gemini') {
          work = fetch(p.base.replace(/\/+$/, '') + '/models/' + encodeURIComponent(p.model) + ':generateContent?key=' + encodeURIComponent(key), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] })
          }).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
        } else {
          work = fetch(p.base.replace(/\/+$/, '') + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 })
          }).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
        }
        work.then(function () {
          status.classList.add('ok');
          status.querySelector('.txt').textContent = 'OK - ' + ((Date.now() - t0) / 1000).toFixed(1) + 's';
        }).catch(function (err) {
          status.classList.add('bad');
          status.querySelector('.txt').textContent = err.message;
        });
      });
    });
  }

  /* ============================= Export (ZIP, APK-ready) ============================= */

  var CRC_TABLE = null;
  function crc32(buf) {
    if (!CRC_TABLE) {
      CRC_TABLE = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function buildModularHtml() {
    var s = Project.state;
    var cssLinks = '', jsLinks = '', htmlBody = '';
    Project.names().forEach(function (name) {
      var lang = langOf(name);
      if (lang === 'html') htmlBody += Project.get(name) + '\n';
    });
    Object.keys(s.files).forEach(function (name) {
      var lang = langOf(name);
      if (lang === 'css') cssLinks += '<link rel="stylesheet" href="' + esc(name) + '">\n';
      if (lang === 'js') jsLinks += '<script src="' + esc(name) + '"><\/script>\n';
    });
    (s.external || []).forEach(function (u) {
      if (/\.css($|\?)/i.test(u)) cssLinks += '<link rel="stylesheet" href="' + esc(u) + '">\n';
      else jsLinks += '<script src="' + esc(u) + '"><\/script>\n';
    });
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
      '<title>' + esc(s.title || 'Electric App') + '</title>\n' + cssLinks + '</head>\n<body>\n' +
      htmlBody + jsLinks + '</body>\n</html>\n';
  }

  function zipStore(files) {
    var enc = new TextEncoder();
    var parts = [], central = [];
    var offset = 0;
    files.forEach(function (f) {
      var data = enc.encode(f.content);
      var crc = crc32(data);
      var nameB = enc.encode(f.name);

      var lh = new Uint8Array(30 + nameB.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameB.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameB, 30);
      var local = new Uint8Array(lh.length + data.length);
      local.set(lh, 0);
      local.set(data, lh.length);
      parts.push(local);

      var ch = new Uint8Array(46 + nameB.length);
      var cd = new DataView(ch.buffer);
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, 0, true);
      cd.setUint16(14, 0, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameB.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, offset, true);
      ch.set(nameB, 46);
      central.push(ch);
      offset += local.length;
    });
    central.forEach(function (c) { parts.push(c); });

    var dirSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var eocd = new Uint8Array(22);
    var ed = new DataView(eocd.buffer);
    ed.setUint32(0, 0x06054b50, true);
    ed.setUint16(4, 0, true);
    ed.setUint16(6, 0, true);
    ed.setUint16(8, files.length, true);
    ed.setUint16(10, files.length, true);
    ed.setUint32(12, dirSize, true);
    ed.setUint32(16, offset, true);
    ed.setUint16(20, 0, true);
    parts.push(eocd);

    var total = parts.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Uint8Array(total), o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }

  function exportApk() {
    var s = Project.state;
    var files = [];
    files.push({ name: 'index.html', content: buildModularHtml() });
    Project.names().forEach(function (name) {
      if (name !== 'index.html') files.push({ name: name, content: Project.get(name) });
    });
    var readme =
      'ELECTRIC CODE ASSISTANT - APK-READY PROJECT\n' +
      'Developed by Electric Code Assistant | Created by Lakhvinder Singh\n\n' +
      'Files:\n' +
      '  index.html  - entry point (links style.css + script.js)\n' +
      '  style.css   - stylesheet\n' +
      '  script.js   - application logic\n\n' +
      'To build an APK:\n' +
      '  1. Wrap these files in an Android WebView (load index.html via loadUrl("file:///android_asset/index.html")).\n' +
      '  2. Or use any standard APK builder that packages a WebView with local assets.\n' +
      'No code changes required.\n';
    files.push({ name: 'README.txt', content: readme });
    var zip = zipStore(files);
    var slug = (s.title || 'electric-app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'electric-app';
    download(slug + '.zip', zip);
    toast('Exported ' + slug + '.zip - APK-ready');
  }

  function download(name, u8) {
    var blob = new Blob([u8.buffer], { type: 'application/zip' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  /* ============================= Toast ============================= */

  var toastTimer;
  function toast(msg, type) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (type === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  /* ============================= Navigation & views ============================= */

  function setView(v) {
    $$('.view-tabs .vtab').forEach(function (b) { b.classList.toggle('active', b.dataset.view === v); });
    $$('.pane').forEach(function (p) { p.classList.remove('active'); });
    var pane = $('.pane.view-' + v);
    if (pane) pane.classList.add('active');
  }

  function isDesktop() { return window.innerWidth >= 1024; }

  function syncView() {
    var v = Store.get('view', 'code');
    if (isDesktop()) {
      setView('code');
      $('#viewTabs').style.display = 'none';
      $('.chat-pane').style.display = 'flex';
    } else {
      $('#viewTabs').style.display = 'flex';
      $('.chat-pane').style.display = '';
      setView(v);
    }
  }

  function toggleSidebar(force) {
    var sb = $('#sidebar'), scrim = $('#scrim');
    var open = force != null ? force : !sb.classList.contains('open');
    sb.classList.toggle('open', open);
    scrim.classList.toggle('show', open);
  }

  /* ============================= Init / bindings ============================= */

  function init() {
    Project.load();
    CryptoBox.keyBytes();
    buildHub();
    renderFileList();
    renderTabs();
    openEditor();
    restoreChat();
    refreshRoutePill();
    syncView();

    $('#routeSel').value = Store.get('route_pref', 'auto');
    $('#routeSel').addEventListener('change', function () {
      Store.set('route_pref', this.value);
      refreshRoutePill();
      toast('Route preference: ' + this.value);
    });

    $('#runBtn').addEventListener('click', function () {
      renderPreview();
      toast('Preview refreshed');
      if (!isDesktop()) setView('preview');
    });
    $('#reloadBtn').addEventListener('click', renderPreview);
    $('#openTabBtn').addEventListener('click', openPreviewTab);

    $('#chatForm').addEventListener('submit', function (e) {
      e.preventDefault();
      handleGenerate();
    });

    var chatInput = $('#chatInput');
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleGenerate();
      }
    });
    chatInput.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 140) + 'px';
    });

    $('#fixBtn').addEventListener('click', autoFix);
    $('#dismissBtn').addEventListener('click', hidePreviewError);

    $('#exportBtn').addEventListener('click', exportApk);

    $('#settingsBtn').addEventListener('click', function () { openModal('#settingsModal'); });
    $('#settingsClose').addEventListener('click', function () { closeModal('#settingsModal'); });
    $('#saveAllBtn').addEventListener('click', function () {
      $$('#hubBody .provider-card').forEach(function (card) {
        var name = card.dataset.provider;
        var key = card.querySelector('input[data-field="key"]').value.trim();
        var base = card.querySelector('input[data-field="base"]');
        var model = card.querySelector('input[data-field="model"]');
        var prov = Store.get('providers', {});
        prov[name] = {
          base: (base ? base.value.trim() : '') || PROVIDERS[name].defaultBase,
          model: (model ? model.value.trim() : '') || PROVIDERS[name].defaultModel
        };
        Store.set('providers', prov);
        Secrets.set(name, key);
      });
      toast('All settings saved');
      refreshRoutePill();
    });

    $('#aboutBtn').addEventListener('click', function () { openModal('#aboutModal'); });
    $('#aboutClose').addEventListener('click', function () { closeModal('#aboutModal'); });

    $('#menuBtn').addEventListener('click', function () { toggleSidebar(); });
    $('#scrim').addEventListener('click', function () { toggleSidebar(false); });

    $('#newBtn').addEventListener('click', function () {
      if (confirm('Start a new empty project? Unsaved changes will be replaced.')) {
        Project.reset();
        currentFile = 'index.html';
        Store.set('curFile', currentFile);
        openEditor(); renderFileList(); renderTabs(); renderPreview();
        toast('New project created');
      }
    });

    $('#newFileBtn').addEventListener('click', function () {
      var name = prompt('New file name (must end in .html, .css or .js):', 'module.js');
      if (!name) return;
      if (!/\.(html?|css|js)$/i.test(name)) { toast('Name must end in .html, .css or .js', 'error'); return; }
      if (Project.state.files[name]) { toast('File already exists', 'error'); return; }
      Project.add(name);
      currentFile = name;
      Store.set('curFile', currentFile);
      renderFileList(); renderTabs(); openEditor();
    });

    $('#wipeBtn').addEventListener('click', function () {
      if (confirm('Wipe ALL local data (project, chat, saved API keys)? This cannot be undone.')) {
        Object.keys(localStorage).forEach(function (k) { if (k.indexOf('eca_') === 0) localStorage.removeItem(k); });
        location.reload();
      }
    });

    $$('.view-tabs .vtab').forEach(function (b) {
      b.addEventListener('click', function () {
        Store.set('view', b.dataset.view);
        setView(b.dataset.view);
      });
    });

    window.addEventListener('resize', debounce(syncView, 150));

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); Project.save(); toast('Saved'); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleGenerate(); }
    });

    window.addEventListener('beforeunload', function () { Project.save(); });
  }

  function openModal(sel) { $(sel).classList.remove('hidden'); }
  function closeModal(sel) { $(sel).classList.add('hidden'); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
