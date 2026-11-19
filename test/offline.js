// Offline test: runs both nodes against a local mock x402 server (no real payments, no network).
// Checks: 402 -> signed payment -> 200 with receipt, price cap refusal, request shapes, error handling.
const http = require('http');
const assert = require('assert');
const { encodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentResponseHeader } = require('@x402/core/http');

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // throwaway test key
const PAY_TO = '0x820bb89345d372288C77c65d70b6CA3dB395C191';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PRICES = { '/api/deal-check': '20000', '/api/sell-score': '100000', '/api/fetch': '5000', '/api/search/compare': '20000', '/api/data/bestsellers': '900000' };

const seen = [];
const server = http.createServer((req, res) => {
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		const u = new URL(req.url, 'http://x');
		seen.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: body ? JSON.parse(body) : undefined, paid: !!req.headers['payment-signature'] });
		if (u.pathname === '/api/broken') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":"bad asin"}'); }
		const amount = PRICES[u.pathname] || '10000';
		const accepts = [{ scheme: 'exact', network: 'eip155:8453', amount, asset: USDC, payTo: PAY_TO, maxTimeoutSeconds: 120, extra: { name: 'USD Coin', version: '2' } }];
		const sig = req.headers['payment-signature'];
		if (!sig) {
			const pr = { x402Version: 2, resource: { url: `http://x${u.pathname}`, description: 'test', mimeType: 'application/json' }, accepts };
			res.writeHead(402, { 'content-type': 'application/json', 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(pr) });
			return res.end('{}');
		}
		const p = decodePaymentSignatureHeader(sig);
		assert.equal(p.accepted.amount, amount);
		assert.equal(p.accepted.payTo, PAY_TO);
		const receipt = encodePaymentResponseHeader({ success: true, transaction: '0xabc', network: 'eip155:8453', payer: p.payload.authorization.from });
		res.writeHead(200, { 'content-type': 'application/json', 'PAYMENT-RESPONSE': receipt });
		res.end(JSON.stringify({ ok: true, path: u.pathname }));
	});
});

function ctx(node, params, items = 1, creds = {}) {
	return {
		getInputData: () => Array.from({ length: items }, () => ({ json: {} })),
		getNodeParameter: (n, i, d) => (n in params ? params[n] : d),
		getCredentials: async () => ({ privateKey: KEY, maxPerCall: 0.25, ...creds }),
		getNode: () => ({ name: node, type: node }),
		continueOnFail: () => !!params.__continue,
	};
}

(async () => {
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	// Point the compiled nodes at the mock server
	const fs = require('fs');
	const load = (f, from) => {
		const src = fs.readFileSync(f, 'utf8').replace(from, base);
		const m = { exports: {} };
		new Function('require', 'module', 'exports', src)((p) => require(p.startsWith('.') ? require('path').resolve(require('path').dirname(f), p) : p), m, m.exports);
		return m.exports;
	};
	const { Asin402 } = load('dist/nodes/Asin402/Asin402.node.js', 'https://asin402.com');
	const { Geo402 } = load('dist/nodes/Geo402/Geo402.node.js', 'https://geo402.com');
	const A = new Asin402(), G = new Geo402();

	// 1. Deal check pays and returns a receipt
	let [[r]] = await A.execute.call(ctx('ASIN402', { operation: 'dealCheck', asin: 'b0chx3qbch', domain: 'de' }));
	assert.equal(r.json.ok, true);
	assert.equal(r.json._payment.paid_usd, 0.02);
	assert.equal(r.json._payment.tx, '0xabc');
	let s = seen.filter((x) => x.path === '/api/deal-check');
	assert.deepEqual(s.map((x) => x.paid), [false, true]);
	assert.deepEqual(s[1].query, { asin: 'B0CHX3QBCH', domain: 'de' });

	// 2. FBA profit omits zero fields
	await A.execute.call(ctx('ASIN402', { operation: 'fbaProfit', asin: 'B0CHX3QBCH', domain: 'us', cost: 4.5, shipping: 0, price: 0 }));
	assert.deepEqual(seen.at(-1).query, { asin: 'B0CHX3QBCH', domain: 'us', cost: '4.5' });

	// 3. Price above cap is refused and never signed
	const before = seen.length;
	await assert.rejects(A.execute.call(ctx('ASIN402', { operation: 'bestSellers', category: '172282', limit: 10, domain: 'us' })), /max price per call/);
	assert.ok(seen.slice(before).every((x) => !x.paid));

	// 4. Invalid ASIN rejected before any request
	const n = seen.length;
	await assert.rejects(A.execute.call(ctx('ASIN402', { operation: 'sellScore', asin: 'abc' })), /10-character ASIN/);
	assert.equal(seen.length, n);

	// 5. Several input items, barcode list parsing
	let [out] = await A.execute.call(ctx('ASIN402', { operation: 'lookupBarcode', codes: '9780735211292, 0885909950805', maxPerCode: 2, domain: 'us' }, 2));
	assert.equal(out.length, 2);
	assert.deepEqual(out.map((o) => o.pairedItem.item), [0, 1]);
	assert.equal(seen.at(-1).query.code, '9780735211292,0885909950805');

	// 6. API error -> not charged, continueOnFail returns error item
	[[r]] = await A.execute.call(ctx('ASIN402', { operation: 'custom', method: 'GET', path: 'api/broken', query: '{"asin":"X"}', __continue: true }));
	assert.match(r.json.error, /Error 400 \(not charged\): bad asin/);

	// 7. Geo402 fetch (GET) and compare search (POST body)
	[[r]] = await G.execute.call(ctx('Geo402', { operation: 'fetchPage', url: 'https://example.com', country: 'DE', format: 'markdown', options: { city: 'berlin' } }));
	assert.equal(r.json._payment.paid_usd, 0.005);
	assert.deepEqual(seen.at(-1).query, { url: 'https://example.com', country: 'de', format: 'markdown', city: 'berlin' });
	[[r]] = await G.execute.call(ctx('Geo402', { operation: 'compareSearch', q: 'running shoes', countries: 'US, ca fr', num: 5, domain: '', options: {} }));
	assert.equal(seen.at(-1).method, 'POST');
	assert.deepEqual(seen.at(-1).body, { q: 'running shoes', countries: ['us', 'ca', 'fr'], num: 5 });

	// 8. Country count validation
	await assert.rejects(G.execute.call(ctx('Geo402', { operation: 'comparePage', url: 'https://example.com', countries: 'us' })), /2 to 5/);

	server.close();
	console.log('All n8n node tests passed');
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
