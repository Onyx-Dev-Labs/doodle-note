import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {sql} from '@repo/db';
import {createInMemoryDb} from '@repo/db/testing';
import {hashToken,mintToken} from '../lib/sync-auth';

test('native data routes enforce current membership and billing; identity route remains usable after lapse',async()=>{
  const f=await createInMemoryDb();
  const globalDb=globalThis as {__repoDbClient?:unknown}, previousDb=globalDb.__repoDbClient;
  const settings={DOODLENOTE_SYNC_V2_ENABLED:'true',DOODLENOTE_SYNC_CURSOR_SECRET:'synthetic-cursor-key-at-least-32-characters',
    DOODLENOTE_SELF_HOSTED:'false',STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_ACCOUNT_ID:'acct_synthetic',
    STRIPE_PRICE_ID:'price_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',STRIPE_PORTAL_CONFIGURATION_ID:'bpc_synthetic'};
  const previous=new Map(Object.keys(settings).map(key=>[key,process.env[key]]));
  Object.assign(process.env,settings);globalDb.__repoDbClient=f.db;
  try {
    await f.db.execute(sql`insert into "user"(id,name,email,email_verified,created_at,updated_at) values('mobile-user','Mobile','mobile@example.test',true,now(),now())`);
    await f.db.execute(sql`insert into organization(id,name,slug,created_at) values('mobile-org','Mobile','mobile-org',now())`);
    await f.db.execute(sql`insert into member(id,organization_id,user_id,role,created_at) values('mobile-member','mobile-org','mobile-user','member',now())`);
    await f.db.execute(sql`insert into subscriptions(user_id,status) values('mobile-user','active')`);
    const token=mintToken();
    await f.db.execute(sql`insert into sync_devices(id,token_hash,user_id,organization_id) values(${randomUUID()}::uuid,${hashToken(token)},'mobile-user','mobile-org')`);
    const request=(path:string)=>new Request('https://fixture/api/sync/'+path,{headers:{authorization:'Bearer '+token}});
    const {GET:v2}=await import('../app/api/sync/v2/route');
    const {GET:legacy}=await import('../app/api/sync/legacy/route');
    const {GET:account}=await import('../app/api/sync/account/route');
    assert.equal((await v2(request('v2'))).status,200);
    const discovery=await legacy(request('legacy'));assert.equal(discovery.status,200);assert.match(discovery.headers.get('cache-control')!,/no-store/);
    await f.db.execute(sql`update subscriptions set status='canceled',current_period_end=now()-interval '1 day' where user_id='mobile-user'`);
    assert.equal((await v2(request('v2'))).status,402);
    assert.equal((await legacy(request('legacy'))).status,402);
    const identity=await account(request('account'));assert.equal(identity.status,200);assert.equal((await identity.json()).entitled,false);
    await f.db.execute(sql`delete from member where id='mobile-member'`);
    assert.equal((await account(request('account'))).status,401);
    assert.equal((await v2(request('v2'))).status,401);
    assert.equal((await legacy(request('legacy'))).status,401);
    process.env.DOODLENOTE_SYNC_V2_ENABLED='false';
    assert.equal((await legacy(request('legacy'))).status,404);
  } finally {
    globalDb.__repoDbClient=previousDb;
    for(const [key,value] of previous) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await f.close();
  }
});
