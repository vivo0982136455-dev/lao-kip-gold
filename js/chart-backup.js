// Chart.js did not arrive from the first CDN - some networks block cdnjs, or the file failed its integrity check.
// Load the same file from jsDelivr, with the same integrity hash (the two CDNs serve the identical file of the npm
// package chart.js 4.5.1), and tell app.js to redraw so the charts appear.
// A plain script on purpose (not a module, no inline code in index.html): it runs right after the first CDN's
// script tag, and the page's Content-Security-Policy allows no inline script at all (audit 2026-10-02, P2-9).
(function () {
  if (window.Chart) return;
  var s = document.createElement("script");
  s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js";
  s.integrity = "sha512-WoViKhKD4qI2WruSZqv9+kvM4WfFhUMQCLN4QlDTt5aU56fLQy2gYoxWIqlEnXqJy/+Ac5q/hk1oWfqnMDhwMA==";
  s.crossOrigin = "anonymous";
  s.onload = function () {
    window.dispatchEvent(new Event("chartjs-ready"));
  };
  document.head.appendChild(s);
})();
