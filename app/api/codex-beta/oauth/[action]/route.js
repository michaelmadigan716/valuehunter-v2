import { oauthRequest } from '../../../../../lib/codexBetaOAuth.mjs';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function handle(request, context) { return oauthRequest(request, (await context.params).action); }
export const GET = handle;
export const POST = handle;
