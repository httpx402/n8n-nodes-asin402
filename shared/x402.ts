import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
// These packages ship CommonJS builds; loaded with require so the compiled node stays CommonJS for n8n.
/* eslint-disable @typescript-eslint/no-require-imports */
const { privateKeyToAccount } = require('viem/accounts');
const { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } = require('@x402/fetch');
const { ExactEvmScheme } = require('@x402/evm/exact/client');

const NETWORK = 'eip155:8453'; // Base mainnet

export type PayFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface Payer {
	payFetch: PayFetch;
	maxPerCall: number;
	address: string;
	lastAuthorized: { usd: number };
}

/** Builds a paying fetch from the node's x402 wallet credential. */
export async function getPayer(ctx: IExecuteFunctions): Promise<Payer> {
	const creds = await ctx.getCredentials('x402WalletApi');
	const raw = String(creds.privateKey ?? '').trim();
	const maxPerCall = Number(creds.maxPerCall ?? 0.25) || 0.25;
	let account;
	try {
		account = privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`);
	} catch {
		throw new NodeOperationError(ctx.getNode(), 'The x402 wallet credential does not contain a valid private key.');
	}
	const lastAuthorized = { usd: 0 };
	const client = x402Client.fromConfig({
		schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
		spendControls: { maxAmountPerPayment: `$${maxPerCall}` },
	} as never);
	client.onBeforePaymentCreation(async ({ selectedRequirements }: { selectedRequirements: { amount: string } }) => {
		const price = Number(selectedRequirements.amount) / 1e6;
		if (price > maxPerCall) {
			return { abort: true, reason: `Price $${price} exceeds your max price per call of $${maxPerCall}.` };
		}
		lastAuthorized.usd = price;
		return undefined;
	});
	return {
		payFetch: wrapFetchWithPayment(fetch, client) as PayFetch,
		maxPerCall,
		address: account.address,
		lastAuthorized,
	};
}

export function buildQuery(params: IDataObject): string {
	const u = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null || v === '') continue;
		if (Array.isArray(v)) {
			if (v.length) u.set(k, v.join(','));
		} else if (typeof v === 'boolean') u.set(k, v ? '1' : '0');
		else if (typeof v === 'object') u.set(k, JSON.stringify(v));
		else u.set(k, String(v));
	}
	const s = u.toString();
	return s ? `?${s}` : '';
}

function stripEmpty(o: IDataObject): IDataObject {
	const r: IDataObject = {};
	for (const [k, v] of Object.entries(o)) {
		if (v === undefined || v === null || v === '') continue;
		if (Array.isArray(v) && v.length === 0) continue;
		r[k] = v;
	}
	return r;
}

/** One paid call. Returns the JSON body plus a `_payment` receipt. Throws on failure (nothing is charged on errors). */
export async function paidRequest(
	ctx: IExecuteFunctions,
	payer: Payer,
	baseUrl: string,
	path: string,
	query: IDataObject = {},
	body?: IDataObject,
	itemIndex = 0,
): Promise<IDataObject> {
	const url = baseUrl + path + buildQuery(query);
	payer.lastAuthorized.usd = 0;
	let res: Response;
	try {
		res = await payer.payFetch(
			url,
			body
				? { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'n8n-nodes-asin402' }, body: JSON.stringify(stripEmpty(body)) }
				: { headers: { 'User-Agent': 'n8n-nodes-asin402' } },
		);
	} catch (e) {
		const m = String((e as Error).message || e);
		if (/spend controls|requirements were rejected|exceeds your max price/i.test(m)) {
			throw new NodeOperationError(ctx.getNode(), `This call costs more than your max price per call of $${payer.maxPerCall}, so it was not paid. Raise it in the x402 wallet credential.`, { itemIndex });
		}
		throw new NodeOperationError(ctx.getNode(), `Payment or network error (not charged): ${m}`, { itemIndex });
	}
	const text = await res.text();
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		data = { raw: text };
	}
	if (res.status === 402) {
		const hint = /insufficient|balance/i.test(text) ? ' Check that the wallet holds enough USDC on Base.' : '';
		throw new NodeOperationError(ctx.getNode(), `Payment was not completed (not charged).${hint}`, { itemIndex, description: text.slice(0, 1500) });
	}
	if (res.status >= 400) {
		const msg = data && typeof data === 'object' && 'error' in (data as IDataObject) ? String((data as IDataObject).error) : text.slice(0, 500);
		throw new NodeOperationError(ctx.getNode(), `Error ${res.status} (not charged): ${msg}`, { itemIndex });
	}
	const out: IDataObject = data && typeof data === 'object' && !Array.isArray(data) ? (data as IDataObject) : { results: data as IDataObject[] };
	const receipt = res.headers.get('payment-response');
	if (receipt) {
		try {
			const r = decodePaymentResponseHeader(receipt) as { success?: boolean; transaction?: string };
			if (r.success) out._payment = { paid_usd: payer.lastAuthorized.usd, tx: r.transaction, payer: payer.address };
		} catch {
			/* ignore malformed receipt */
		}
	}
	return out;
}

/** Comma/space separated text -> trimmed lowercase list. */
export function list(v: unknown, lower = true): string[] {
	return String(v ?? '')
		.split(/[\s,]+/)
		.map((s) => (lower ? s.trim().toLowerCase() : s.trim()))
		.filter(Boolean);
}
