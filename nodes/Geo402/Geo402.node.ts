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

const API = 'https://geo402.com';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'fetchPage',
		options: [
			{ name: 'Compare Page Across Countries', value: 'comparePage', action: 'Compare a page across countries', description: 'The same page from 2-5 countries side by side (~$0.005 per country)' },
			{ name: 'Compare Search Across Countries', value: 'compareSearch', action: 'Compare Google results across countries', description: 'One Google search in 2-5 countries, with optional domain rank tracking' },
			{ name: 'Fetch Page', value: 'fetchPage', action: 'Fetch a page from a country', description: 'One public page through a residential IP in a country, as markdown (~$0.005)' },
			{ name: 'Search', value: 'search', action: 'Search Google from a country', description: 'Google results as seen in a country: web, news, places or images' },
			{ name: 'Search and Read', value: 'searchAndRead', action: 'Search and read the top results', description: 'Search from a country, then read the top 1-5 results as markdown' },
		],
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://www.amazon.de/dp/B0CHX3QBCH',
		description: 'Public http(s) page',
		displayOptions: { show: { operation: ['fetchPage', 'comparePage'] } },
	},
	{
		displayName: 'Query',
		name: 'q',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { operation: ['search', 'compareSearch', 'searchAndRead'] } },
	},
	{
		displayName: 'Country',
		name: 'country',
		type: 'string',
		default: 'us',
		placeholder: 'de',
		description: '2-letter country code (empty = any country)',
		displayOptions: { show: { operation: ['fetchPage', 'search', 'searchAndRead'] } },
	},
	{
		displayName: 'Countries',
		name: 'countries',
		type: 'string',
		default: 'us, de, jp',
		required: true,
		description: '2-5 country codes, comma separated',
		displayOptions: { show: { operation: ['comparePage', 'compareSearch'] } },
	},
	{
		displayName: 'Format',
		name: 'format',
		type: 'options',
		options: [
			{ name: 'Markdown', value: 'markdown' },
			{ name: 'Text', value: 'text' },
			{ name: 'HTML', value: 'html' },
		],
		default: 'markdown',
		displayOptions: { show: { operation: ['fetchPage', 'comparePage'] } },
	},
	{
		displayName: 'Include Full Content',
		name: 'includeContent',
		type: 'boolean',
		default: false,
		description: 'Whether to return full page content per country instead of short excerpts',
		displayOptions: { show: { operation: ['comparePage'] } },
	},
	{
		displayName: 'Search Type',
		name: 'type',
		type: 'options',
		options: [
			{ name: 'Web', value: 'web' },
			{ name: 'News', value: 'news' },
			{ name: 'Places', value: 'places' },
			{ name: 'Images', value: 'images' },
		],
		default: 'web',
		displayOptions: { show: { operation: ['search'] } },
	},
	{
		displayName: 'Number of Results',
		name: 'num',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 20 },
		default: 10,
		displayOptions: { show: { operation: ['search', 'compareSearch'] } },
	},
	{
		displayName: 'Track Domain',
		name: 'domain',
		type: 'string',
		default: '',
		placeholder: 'example.com',
		description: 'Optional: show where this site ranks in each country',
		displayOptions: { show: { operation: ['compareSearch'] } },
	},
	{
		displayName: 'Results to Read',
		name: 'read',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 5 },
		default: 3,
		displayOptions: { show: { operation: ['searchAndRead'] } },
	},
	{
		displayName: 'Max Characters per Page',
		name: 'maxChars',
		type: 'number',
		typeOptions: { minValue: 500, maxValue: 20000 },
		default: 4000,
		displayOptions: { show: { operation: ['searchAndRead'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { operation: ['fetchPage', 'search', 'compareSearch', 'searchAndRead'] } },
		options: [
			{ displayName: 'Language', name: 'lang', type: 'string', default: '', placeholder: 'de', description: 'Search language (default: the country\'s own)' },
			{ displayName: 'City', name: 'city', type: 'string', default: '', placeholder: 'berlin', description: 'Fetch Page only: exit IP city (small extra charge)' },
			{ displayName: 'US State', name: 'state', type: 'string', default: '', placeholder: 'texas', description: 'Fetch Page only, country us: exit IP state (small extra charge)' },
		],
	},
];

export class Geo402 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Geo402',
		name: 'geo402',
		icon: 'file:geo402.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Read web pages and Google results as they appear from 190+ countries, as clean markdown. Paid per call in USDC via x402.',
		defaults: { name: 'Geo402' },
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
				const opts = (['fetchPage', 'search', 'compareSearch', 'searchAndRead'].includes(op) ? p('options', {}) : {}) as IDataObject;
				const country = ['fetchPage', 'search', 'searchAndRead'].includes(op) ? String(p('country', '') || '').trim().toLowerCase() || undefined : undefined;
				const countries = ['comparePage', 'compareSearch'].includes(op) ? list(p('countries', '')) : [];
				if (countries.length && (countries.length < 2 || countries.length > 5)) {
					throw new NodeOperationError(this.getNode(), 'Enter 2 to 5 country codes', { itemIndex: i });
				}
				let res: IDataObject;
				switch (op) {
					case 'fetchPage':
						res = await paidRequest(this, payer, API, '/api/fetch', { url: p('url', '') as string, country, format: p('format', 'markdown') as string, city: opts.city, state: opts.state }, undefined, i);
						break;
					case 'comparePage':
						res = await paidRequest(this, payer, API, '/api/compare', {}, { url: p('url', '') as string, countries, include_content: p('includeContent', false) as boolean, format: p('format', 'markdown') as string }, i);
						break;
					case 'search':
						res = await paidRequest(this, payer, API, '/api/search', { q: p('q', '') as string, country, lang: opts.lang, type: p('type', 'web') as string, num: p('num', 10) as number }, undefined, i);
						break;
					case 'compareSearch':
						res = await paidRequest(this, payer, API, '/api/search/compare', {}, { q: p('q', '') as string, countries, domain: p('domain', '') as string, lang: opts.lang, num: p('num', 10) as number }, i);
						break;
					case 'searchAndRead':
						res = await paidRequest(this, payer, API, '/api/search/read', {}, { q: p('q', '') as string, country, lang: opts.lang, read: p('read', 3) as number, max_chars: p('maxChars', 4000) as number }, i);
						break;
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
