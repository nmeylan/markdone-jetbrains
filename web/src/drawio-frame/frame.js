/*
 * The draw.io frame (nmey/DRAWIO.md §4.2). The only place that runs draw.io code: sandbox="allow-scripts",
 * opaque origin, own CSP. Plain script, not bundled. It accepts one `render` message from the parent page
 * and shows the diagram with the vendored viewer; it sends `size` and `error` messages back.
 */
(function () {
  'use strict';
  var MAX_XML = 5 * 1024 * 1024;
  var MAX_HEIGHT = 10000;
  var BASE = new URL('./', location.href).href;

  // The viewer defaults are `window.X = window.X || "https://viewer.diagrams.net/..."`: a value set before it loads wins.
  window.PROXY_URL = BASE + 'proxy-disabled';
  window.STYLE_PATH = BASE + 'styles';
  window.SHAPES_PATH = BASE + 'shapes';
  window.STENCIL_PATH = BASE + 'stencils';
  window.GRAPH_IMAGE_PATH = BASE + 'img';
  window.IMAGE_PATH = BASE + 'img';
  window.DRAW_MATH_URL = BASE + 'math-disabled';
  window.mxBasePath = BASE + 'mxgraph/';
  window.mxImageBasePath = BASE + 'mxgraph/images';
  window.DRAWIO_LIGHTBOX_URL = '';
  window.DRAWIO_BASE_URL = BASE;
  window.DRAWIO_SERVER_URL = BASE;
  window.mxLoadResources = false;
  window.mxLoadStylesheets = false;

  var started = false;

  // The parent origin is not the frame origin (opaque) and the message holds no secret.
  function send(message) {
    parent.postMessage(message, '*');
  }

  function valid(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
    var keys = Object.keys(m);
    if (keys.length !== 4 || keys.indexOf('type') < 0 || keys.indexOf('xml') < 0 || keys.indexOf('page') < 0 || keys.indexOf('dark') < 0) return false;
    if (m.type !== 'render' || typeof m.xml !== 'string' || m.xml.length > MAX_XML || typeof m.dark !== 'boolean') return false;
    return m.page === null || (Number.isSafeInteger(m.page) && m.page >= 0);
  }

  function start(m) {
    try {
      var container = document.getElementById('g');
      var doc = mxUtils.parseXml(m.xml);
      var config = {
        highlight: '#0000ff',
        nav: false,
        resize: true,
        toolbar: 'pages zoom layers',
        lightbox: false,
        edit: null,
        'dark-mode': m.dark ? 'dark' : 'light',
      };
      if (m.page !== null) config.page = m.page;
      var viewer = new GraphViewer(container, doc.documentElement, config);
      // The stock lightbox and the links call window.open to viewer.diagrams.net or to the link target.
      viewer.lightboxClickEnabled = false;
      viewer.showLightbox = function () {};
      viewer.graph.openLink = function () {};
      var last = 0;
      var report = function () {
        // The container alone under-reports by the 26 px toolbar strip.
        var height = Math.max(1, Math.min(MAX_HEIGHT, Math.round(document.body.getBoundingClientRect().bottom + window.scrollY) || 1));
        if (height !== last) {
          last = height;
          send({ type: 'size', height: height });
        }
      };
      var observer = new ResizeObserver(report);
      observer.observe(document.body);
      observer.observe(container);
      report();
    } catch (e) {
      send({ type: 'error', message: String((e && e.message) || e).slice(0, 500) });
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== parent || started || !valid(event.data)) return;
    started = true;
    start(event.data);
  });
})();
