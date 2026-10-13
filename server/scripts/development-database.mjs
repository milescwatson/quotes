import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
export const target={environment:'development',account:'415221799122',region:'us-west-2',cluster:'3zuetvjhixkp3qeuzxxosvlssq',profile:'quotes-development'};
export const aws=args=>execFileSync('aws',[...args,'--profile',target.profile,'--region',target.region],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export function developmentDatabase() {
  const caller=JSON.parse(aws(['sts','get-caller-identity']));assert.equal(caller.Account,target.account);
  assert.equal(JSON.parse(aws(['dsql','get-cluster','--identifier',target.cluster])).status,'ACTIVE');
  const host=`${target.cluster}.dsql.${target.region}.on.aws`;
  const db=new pg.Client({host,user:'admin',database:'postgres',password:aws(['dsql','generate-db-connect-admin-auth-token','--hostname',host]),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:5000,query_timeout:15000});
  return {db,caller};
}
