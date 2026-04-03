const express = require("express");
const http = require("http");
const https = require("https");

const app = express();
app.use(express.raw({ type: "*/*" }));

const MAX_REDIRECTS = 10;

function setCorsHeaders(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-expose-headers", "*");
}

async function proxyHandler(req, res) {
  // Handle CORS preflight directly without forwarding
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.status(204).end();
    return;
  }

  const targetParams = parseTargetParameters(req);
  if (!targetParams.url) {
    res
      .status(400)
      .send("Provide target URL via '?url=' param or path: /https://...");
    return;
  }

  followRequest(targetParams.url, req, res, 0);
}

function followRequest(targetReqUrl, req, res, redirectCount) {
  if (redirectCount > MAX_REDIRECTS) {
    setCorsHeaders(res);
    res.status(502).json({ error: "Too many redirects" });
    return;
  }

  const targetReqHandler = (targetRes) => {
    // Follow redirects server-side instead of passing them to the browser
    if (
      [301, 302, 303, 307, 308].includes(targetRes.statusCode) &&
      targetRes.headers.location
    ) {
      const redirectUrl = new URL(targetRes.headers.location, targetReqUrl);
      targetRes.resume(); // drain the response
      followRequest(redirectUrl, req, res, redirectCount + 1);
      return;
    }

    res.status(targetRes.statusCode);
    res.setHeaders(new Map(Object.entries(targetRes.headersDistinct)));
    setCorsHeaders(res);
    res.removeHeader("cross-origin-resource-policy");
    res.removeHeader("content-security-policy");
    res.removeHeader("content-security-policy-report-only");
    res.removeHeader("reporting-endpoints");
    res.removeHeader("report-to");

    targetRes.on("data", (chunk) => res.write(chunk));
    targetRes.on("end", () => res.end());
    targetRes.on("error", (err) => res.destroy(err));
  };

  const targetReq = request(
    targetReqUrl,
    { method: req.method },
    targetReqHandler,
  );
  targetReq.setHeaders(
    new Map(
      Object.entries(req.headersDistinct).filter(
        ([name]) => !name.startsWith("x-vercel-"),
      ),
    ),
  );
  targetReq.setHeader("host", targetReqUrl.host);
  if (req.body && req.body?.length > 0) {
    targetReq.write(req.body);
  }
  targetReq.on("error", (err) => {
    setCorsHeaders(res);
    res.status(500).json({ error: "Proxy error", details: err.message });
  });
  targetReq.end();
}

app.all("/", proxyHandler);
app.all("/*path", proxyHandler);

function request(url, options = {}, callback) {
  const httpModule = url.protocol === "https:" ? https : http;
  const requestOptions = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    ...options,
  };
  return httpModule.request(requestOptions, callback);
}

function parseTargetParameters(proxyRequest) {
  const params = {};

  // Method 1: ?url= query parameter
  const urlMatch = proxyRequest.url.match(/(?<=[?&])url=(?<url>.*)$/);
  if (urlMatch) {
    try {
      // Strip redundant leading "?url=" prefixes (e.g. ?url=?url=https://...)
      const raw = urlMatch.groups.url.replace(/^(\??url=)+/, "");
      params.url = new URL(decodeURIComponent(raw));
      return params;
    } catch (_) {}
  }

  // Method 2: path-encoded URL, e.g. /https://www.gutenberg.org/ebooks/21.epub3.images
  const pathMatch = proxyRequest.url.match(/^\/(https?:\/\/.+)$/);
  if (pathMatch) {
    try {
      params.url = new URL(pathMatch[1]);
    } catch (_) {}
  }

  return params;
}

module.exports = app;
