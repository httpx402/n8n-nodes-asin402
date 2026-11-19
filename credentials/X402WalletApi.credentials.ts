import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class X402WalletApi implements ICredentialType {
	name = 'x402WalletApi';

	displayName = 'x402 Wallet (USDC on Base)';

	documentationUrl = 'https://github.com/httpx402/n8n-nodes-asin402#readme';

	icon = 'file:x402.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName:
				'Use a small dedicated wallet holding a few dollars of USDC on Base, never your main wallet. The key stays in n8n and is only used to sign per-call USDC payments.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Private Key',
			name: 'privateKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: '0x...',
			description: 'Private key of the paying wallet (64 hex characters, with or without 0x)',
		},
		{
			displayName: 'Max Price per Call (USD)',
			name: 'maxPerCall',
			type: 'number',
			typeOptions: { minValue: 0.001, numberPrecision: 3 },
			default: 0.25,
			description: 'Any call priced above this is refused before anything is paid',
		},
	];
}
