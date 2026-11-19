import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { getPayer, list, paidRequest } from '../../shared/x402';

const API = 'https://asin402.com';

const MARKETPLACES = ['us', 'uk', 'de', 'fr', 'jp', 'ca', 'it', 'es', 'in', 'mx', 'br'].map((m) => ({
	name: m.toUpperCase(),
	value: m,
}));

const ASIN_OPS = ['dealCheck', 'sellScore', 'fbaProfit', 'productSnapshot', 'compareMarketplaces'];
const MARKET_OPS = ['dealCheck', 'sellScore', 'fbaProfit', 'productSnapshot', 'lookupBarcode', 'searchProducts', 'bestSellers'];

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'dealCheck',
		options: [
			{ name: 'Best Sellers', value: 'bestSellers', action: 'Get best sellers in a category', description: 'Top products in a category by sales rank (~$0.02-0.10)' },
			{ name: 'Compare Marketplaces', value: 'compareMarketplaces', action: 'Compare a product across marketplaces', description: 'Price and rank of one ASIN across up to 11 Amazon marketplaces' },
			{ name: 'Custom Request', value: 'custom', action: 'Call any ASIN402 endpoint', description: 'Call any ASIN402 API path (see asin402.com/openapi.json)' },
			{ name: 'Deal Check', value: 'dealCheck', action: 'Check if a price is a good deal', description: 'Current price vs 30/90/180-day history: buy_now, fair_price, wait or verify_offer ($0.02)' },
			{ name: 'FBA Profit', value: 'fbaProfit', action: 'Calculate FBA profit', description: 'Referral and FBA fees, net profit, margin, ROI and break-even cost ($0.05)' },
			{ name: 'Lookup Barcode', value: 'lookupBarcode', action: 'Find products by barcode', description: 'UPC/EAN/ISBN-13 to Amazon listings' },
			{ name: 'Product Snapshot', value: 'productSnapshot', action: 'Get a product snapshot', description: 'Prices, sales rank, est. monthly sales, rating and offers ($0.01)' },
			{ name: 'Search Products', value: 'searchProducts', action: 'Search products by keyword', description: 'Amazon keyword search, up to 10 products per page' },
			{ name: 'Sell Score', value: 'sellScore', action: 'Score a selling opportunity', description: '0-100 opportunity score with risk flags ($0.10)' },
		],
	},
	{
		displayName: 'ASIN',
		name: 'asin',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'B0CHX3QBCH',
		description: '10-character Amazon ASIN (books: ISBN-10)',
		displayOptions: { show: { operation: ASIN_OPS } },
	},
	{
		displayName: 'Marketplace',
		name: 'domain',
		type: 'options',
		options: MARKETPLACES,
		default: 'us',
		displayOptions: { show: { operation: MARKET_OPS } },
	},
	// FBA profit
	{
		displayName: 'Unit Cost',
		name: 'cost',
		type: 'number',
		default: 0,
		description: 'Your cost of goods per unit (0 = leave out)',
		displayOptions: { show: { operation: ['fbaProfit'] } },
	},
	{
		displayName: 'Inbound Shipping per Unit',
		name: 'shipping',
		type: 'number',
		default: 0,
		displayOptions: { show: { operation: ['fbaProfit'] } },
	},
	{
		displayName: 'Sell Price Override',
		name: 'price',
		type: 'number',
		default: 0,
		description: '0 = use the current buy box price',
		displayOptions: { show: { operation: ['fbaProfit'] } },
	},
	// Compare marketplaces
	{
		displayName: 'Marketplaces',
		name: 'marketplaces',
		type: 'multiOptions',
		options: MARKETPLACES,
		default: [],
		description: 'Leave empty to compare all 11',
		displayOptions: { show: { operation: ['compareMarketplaces'] } },
	},
	// Barcode
	{
		displayName: 'Barcodes',
		name: 'codes',
		type: 'string',
		default: '',
		required: true,
		placeholder: '9780735211292, 0885909950805',
		description: 'One or more UPC/EAN/ISBN-13 codes, comma separated (max 20)',
		displayOptions: { show: { operation: ['lookupBarcode'] } },
	},
	{
		displayName: 'Max Listings per Barcode',
		name: 'maxPerCode',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 5 },
		default: 3,
		displayOptions: { show: { operation: ['lookupBarcode'] } },
	},
	// Search
	{
		displayName: 'Search Term',
		name: 'term',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { operation: ['searchProducts'] } },
	},
	{
		displayName: 'Page',
		name: 'page',
		type: 'number',
		typeOptions: { minValue: 0, maxValue: 9 },
		default: 0,
		displayOptions: { show: { operation: ['searchProducts'] } },
	},
	// Best sellers
	{
		displayName: 'Category',
		name: 'category',
		type: 'string',
		default: '',
		required: true,
		placeholder: '172282',
		description: 'Amazon category ID or product group name',
		displayOptions: { show: { operation: ['bestSellers'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { operation: ['bestSellers'] } },
	},
	// Custom
	{
		displayName: 'Method',
		name: 'method',
		type: 'options',
		options: [
			{ name: 'GET', value: 'GET' },
			{ name: 'POST', value: 'POST' },
		],
		default: 'GET',
		displayOptions: { show: { operation: ['custom'] } },
	},
	{
		displayName: 'Path',
		name: 'path',
		type: 'string',
		default: '/api/deal-check',
		required: true,
		description: 'API path, e.g. /api/data/finder. Full list: asin402.com/openapi.json.',
		displayOptions: { show: { operation: ['custom'] } },
	},
	{
		displayName: 'Query Parameters (JSON)',
		name: 'query',
		type: 'json',
		default: '{}',
		displayOptions: { show: { operation: ['custom'] } },
	},
	{
		displayName: 'Body (JSON)',
		name: 'body',
		type: 'json',
		default: '{}',
		displayOptions: { show: { operation: ['custom'], method: ['POST'] } },
	},
];

function parseJson(ctx: IExecuteFunctions, v: unknown, field: string, i: number): IDataObject {
	if (v && typeof v === 'object') return v as IDataObject;
	try {
		return JSON.parse(String(v || '{}')) as IDataObject;
	} catch {
		throw new NodeOperationError(ctx.getNode(), `${field} is not valid JSON`, { itemIndex: i });
	}
}

export class Asin402 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ASIN402',
		name: 'asin402',
		icon: 'file:asin402.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Live Amazon data: prices, price history, deal verdicts, FBA profit and sell scores. Paid per call in USDC via x402.',
		defaults: { name: 'ASIN402' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'x402WalletApi', required: true }],
		properties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const payer = await getPayer(this);
		for (let i = 0; i < items.length; i++) {
			try {
				const op = this.getNodeParameter('operation', i) as string;
				const p = (name: string, d?: unknown) => this.getNodeParameter(name, i, d);
				let res: IDataObject;
				const asin = op === 'custom' ? '' : String(p('asin', '') || '').trim().toUpperCase();
				if (ASIN_OPS.includes(op) && !/^[A-Z0-9]{10}$/.test(asin)) {
					throw new NodeOperationError(this.getNode(), `"${asin}" is not a 10-character ASIN`, { itemIndex: i });
				}
				const domain = MARKET_OPS.includes(op) ? (p('domain', 'us') as string) : undefined;
				switch (op) {
					case 'dealCheck':
						res = await paidRequest(this, payer, API, '/api/deal-check', { asin, domain }, undefined, i);
						break;
					case 'sellScore':
						res = await paidRequest(this, payer, API, '/api/sell-score', { asin, domain }, undefined, i);
						break;
					case 'productSnapshot':
						res = await paidRequest(this, payer, API, '/api/product', { asin, domain }, undefined, i);
						break;
					case 'fbaProfit': {
						const num = (n: string) => {
							const v = Number(p(n, 0));
							return v > 0 ? v : undefined;
						};
						res = await paidRequest(this, payer, API, '/api/fba-profit', { asin, domain, cost: num('cost'), shipping: num('shipping'), price: num('price') }, undefined, i);
						break;
					}
					case 'compareMarketplaces':
						res = await paidRequest(this, payer, API, '/api/compare-marketplaces', { asin, marketplaces: p('marketplaces', []) as string[] }, undefined, i);
						break;
					case 'lookupBarcode': {
						const codes = list(p('codes', ''), false);
						if (!codes.length) throw new NodeOperationError(this.getNode(), 'Enter at least one barcode', { itemIndex: i });
						res = await paidRequest(this, payer, API, '/api/lookup', { code: codes, max_per_code: p('maxPerCode', 3) as number, domain }, undefined, i);
						break;
					}
					case 'searchProducts':
						res = await paidRequest(this, payer, API, '/api/data/search', { term: p('term', '') as string, page: p('page', 0) as number, domain }, undefined, i);
						break;
					case 'bestSellers':
						res = await paidRequest(this, payer, API, '/api/data/bestsellers', { category: p('category', '') as string, limit: p('limit', 50) as number, domain }, undefined, i);
						break;
					case 'custom': {
						let path = String(p('path', '')).trim();
						if (!path.startsWith('/')) path = `/${path}`;
						const query = parseJson(this, p('query', '{}'), 'Query Parameters', i);
						const body = p('method', 'GET') === 'POST' ? parseJson(this, p('body', '{}'), 'Body', i) : undefined;
						res = await paidRequest(this, payer, API, path, query, body, i);
						break;
					}
					default:
						throw new NodeOperationError(this.getNode(), `Unknown operation ${op}`, { itemIndex: i });
				}
				out.push({ json: res, pairedItem: { item: i } });
			} catch (e) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (e as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw e;
			}
		}
		return [out];
	}
}
