import express from 'express';
import * as http from "node:http";
import * as https from "node:https";

const app = express();
app.use(express.raw({ type: '*/*' }));

// Whitelist: only allow gutenberg.org to prevent open proxy abuse
const ALLOWED_HOSTS = [
  'www.gutenberg.org',
  'gutenberg.org',
];

app.all('*', async (req, res) => {
    const targetParams = parseTargetParameters(req);
    if (!targetParams.url) {
        res.status(400).send("Provide target URL via '?url=' param or path: /https://...");
        return;
    }

    const targetReqUrl = targetParams.url;

    // if (!ALLOWED_HOSTS.includes(targetReqUrl.hostname)) {
    //     res.status(403).send(`Host '${targetReqUrl.hostname}' is not allowed`);
    //     return;
    // }

    const targetReqHandler = (targetRes) => {
        res.status(targetRes.statusCode);
        res.setHeaders(new Map(Object.entries(targetRes.headersDistinct)));
        res.setHeader('access-control-allow-origin', '*');
        res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.removeHeader('cross-origin-resource-policy');
        res.removeHeader('content-security-policy');
        res.removeHeader('content-security-policy-report-only');
        res.removeHeader('reporting-endpoints');
        res.removeHeader('report-to');

        targetRes.on('data', (chunk) => res.write(chunk));
        targetRes.on('end', () => res.end());
        targetRes.on('error', (err) => res.destroy(err));
    };

    const targetReq = request(targetReqUrl, { method: req.method }, targetReqHandler);
    targetReq.setHeaders(new Map(Object.entries(req.headersDistinct)
        .filter(([name]) => !name.startsWith('x-vercel-'))));
    targetReq.setHeader('host', targetReqUrl.host);
    if (req.body && req.body?.length > 0) {
        targetReq.write(req.body);
    }
    targetReq.on('error', (err) => {
        res.status(500).json({ error: "Proxy error", details: err.message });
    });
    targetReq.end();
});

function request(url, options = {}, callback) {
    const httpModule = url.protocol === 'https:' ? https : http;
    return httpModule.request(url, options, callback);
}

function parseTargetParameters(proxyRequest) {
    const params = {};

    // Method 1: ?url= query parameter
    const urlMatch = proxyRequest.url.match(/(?<=[?&])url=(?<url>.*)$/);
    if (urlMatch) {
        try {
            params.url = new URL(decodeURIComponent(urlMatch.groups.url));
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

export default app;
