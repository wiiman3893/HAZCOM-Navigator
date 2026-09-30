use jsonwebtoken::{decode,decode_header,Algorithm,DecodingKey,Validation};
use serde::{Deserialize,Serialize};
use std::{collections::BTreeMap,fs,path::{Path,PathBuf},time::{SystemTime,UNIX_EPOCH}};
use tauri::Manager;
use windows::{core::{Array,HSTRING},Security::Cryptography::{CryptographicBuffer,DataProtection::DataProtectionProvider}};

const KEY_ID:&str="offline-lease-es256-v1";
const AUDIENCE:&str="hazcom-navigator-windows";
const MAX_SECONDS:i64=7*24*60*60;
const CLOCK_SKEW_SECONDS:i64=300;
#[cfg(test)]const TEST_PUBLIC_KEY:&str="-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEyqZlcSTfZDfUJBEpo6VEF2Lk7HYM\nZquulbPXU5QlFLyvMaLIyt1haTyETxoMhCBHwhd4nnGQvG4QnHAjiMH9AQ==\n-----END PUBLIC KEY-----";

#[derive(Debug,Clone,Serialize,Deserialize)]pub struct Claims{v:u32,env:String,#[serde(rename="companyId")]company_id:String,role:String,#[serde(rename="canAuthor")]can_author:bool,iss:String,aud:String,sub:String,iat:i64,exp:i64,jti:String}
#[derive(Debug,Clone,Serialize,Deserialize)]struct Entry{token:String,claims:Claims}
#[derive(Default,Serialize,Deserialize)]struct Cache{version:u32,last_observed:i64,entries:BTreeMap<String,Entry>}
#[derive(Debug,Clone,Serialize)]#[serde(rename_all="camelCase")]
pub struct LeaseMetadata{account_id:String,company_id:String,environment:String,role:String,issued_at:i64,expires_at:i64,state:String}
pub struct OfflineGrant{pub read_only:bool,pub expires_at:i64,pub last_observed:i64}

pub fn now()->i64{SystemTime::now().duration_since(UNIX_EPOCH).map(|v|v.as_secs() as i64).unwrap_or(i64::MAX)}
fn key(account:&str,company:&str,environment:&str)->String{format!("{environment}\u{1f}{account}\u{1f}{company}")}
fn cache_path(root:&Path)->PathBuf{root.join("offline-authorization.bin")}
fn trust(environment:&str)->Result<String,String>{
 #[cfg(test)]if environment=="demo-hazcom-navigator"{return Ok(TEST_PUBLIC_KEY.into());}
 let configured=option_env!("HAZCOM_OFFLINE_LEASE_ENVIRONMENT").ok_or("OFFLINE_AUTHORIZATION_TRUST_UNAVAILABLE")?;
 if configured!=environment{return Err("OFFLINE_AUTHORIZATION_ENVIRONMENT_UNTRUSTED".into());}
 let json=option_env!("HAZCOM_OFFLINE_LEASE_PUBLIC_KEYS_JSON").ok_or("OFFLINE_AUTHORIZATION_TRUST_UNAVAILABLE")?;
 let keys:serde_json::Value=serde_json::from_str(json).map_err(|_|"OFFLINE_AUTHORIZATION_TRUST_INVALID")?;
 keys.get(KEY_ID).and_then(|v|v.as_str()).map(str::to_string).ok_or_else(||"OFFLINE_AUTHORIZATION_KEY_UNKNOWN".into())
}
fn verify(token:&str,account:&str,company:&str,environment:&str,at:i64)->Result<(Claims,bool),String>{
 let header=decode_header(token).map_err(|_|"OFFLINE_AUTHORIZATION_MALFORMED")?;
 if header.alg!=Algorithm::ES256||header.kid.as_deref()!=Some(KEY_ID){return Err("OFFLINE_AUTHORIZATION_KEY_UNKNOWN".into());}
 let issuer=format!("https://hazcom.navigator/offline-authorization/{environment}");
 let mut validation=Validation::new(Algorithm::ES256);validation.validate_exp=false;validation.validate_nbf=false;
 validation.set_audience(&[AUDIENCE]);validation.set_issuer(&[issuer.as_str()]);validation.set_required_spec_claims(&["exp","iat","iss","aud","sub"]);
 let trusted=trust(environment)?;let claims=decode::<Claims>(token,&DecodingKey::from_ec_pem(trusted.as_bytes()).map_err(|_|"OFFLINE_AUTHORIZATION_TRUST_INVALID")?,&validation).map_err(|_|"OFFLINE_AUTHORIZATION_INVALID")?.claims;
 if claims.v!=1||claims.env!=environment||claims.sub!=account||claims.company_id!=company||!matches!(claims.role.as_str(),"administrator"|"manager")||!claims.can_author||claims.jti.is_empty(){return Err("OFFLINE_AUTHORIZATION_SCOPE_INVALID".into());}
 if claims.iat>at+CLOCK_SKEW_SECONDS||claims.exp<=claims.iat||claims.exp-claims.iat>MAX_SECONDS{return Err("OFFLINE_AUTHORIZATION_TIME_INVALID".into());}
 Ok((claims.clone(),at<claims.exp))
}
fn protect(bytes:&[u8])->Result<Vec<u8>,String>{
 let provider=DataProtectionProvider::CreateOverloadExplicit(&HSTRING::from("LOCAL=user")).map_err(|_|"OFFLINE_AUTHORIZATION_PROTECTION_UNAVAILABLE")?;
 let input=CryptographicBuffer::CreateFromByteArray(bytes).map_err(|_|"OFFLINE_AUTHORIZATION_PROTECTION_UNAVAILABLE")?;
 let output=provider.ProtectAsync(&input).and_then(|v|v.get()).map_err(|_|"OFFLINE_AUTHORIZATION_PROTECTION_FAILED")?;
 let mut result=Array::<u8>::new();CryptographicBuffer::CopyToByteArray(&output,&mut result).map_err(|_|"OFFLINE_AUTHORIZATION_PROTECTION_FAILED")?;Ok(result.to_vec())
}
fn unprotect(bytes:&[u8])->Result<Vec<u8>,String>{
 let provider=DataProtectionProvider::new().map_err(|_|"OFFLINE_AUTHORIZATION_PROTECTION_UNAVAILABLE")?;
 let input=CryptographicBuffer::CreateFromByteArray(bytes).map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_CORRUPT")?;
 let output=provider.UnprotectAsync(&input).and_then(|v|v.get()).map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_CORRUPT")?;
 let mut result=Array::<u8>::new();CryptographicBuffer::CopyToByteArray(&output,&mut result).map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_CORRUPT")?;Ok(result.to_vec())
}
fn read(root:&Path)->Result<Cache,String>{let path=cache_path(root);if !path.exists(){return Ok(Cache{version:1,..Default::default()});}let bytes=fs::read(path).map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_UNAVAILABLE")?;let cache:Cache=serde_json::from_slice(&unprotect(&bytes)?).map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_CORRUPT")?;if cache.version!=1{return Err("OFFLINE_AUTHORIZATION_CACHE_VERSION".into());}Ok(cache)}
fn write(root:&Path,cache:&Cache)->Result<(),String>{fs::create_dir_all(root).map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_UNAVAILABLE")?;let path=cache_path(root);let temp=root.join(format!("offline-authorization-{:x}.tmp",rand::random::<u64>()));let bytes=protect(&serde_json::to_vec(cache).map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_INVALID")?)?;fs::write(&temp,bytes).map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_UNAVAILABLE")?;fs::rename(&temp,&path).map_err(|_|{fs::remove_file(&temp).ok();"OFFLINE_AUTHORIZATION_CACHE_UNAVAILABLE".to_string()})}
fn metadata(claims:&Claims,state:&str)->LeaseMetadata{LeaseMetadata{account_id:claims.sub.clone(),company_id:claims.company_id.clone(),environment:claims.env.clone(),role:claims.role.clone(),issued_at:claims.iat*1000,expires_at:claims.exp*1000,state:state.into()}}
pub fn grant(root:&Path,account:&str,company:&str,environment:&str)->Result<OfflineGrant,String>{let mut cache=read(root)?;let at=now();let rollback=at+CLOCK_SKEW_SECONDS<cache.last_observed;let effective=at.max(cache.last_observed);let entry=cache.entries.get(&key(account,company,environment)).ok_or("OFFLINE_AUTHORIZATION_REQUIRED")?;let (claims,writable)=verify(&entry.token,account,company,environment,effective)?;cache.last_observed=effective;let observed=cache.last_observed;write(root,&cache)?;Ok(OfflineGrant{read_only:rollback||!writable,expires_at:claims.exp,last_observed:observed})}
pub fn record_observed(root:&Path,at:i64)->Result<i64,String>{let mut cache=read(root)?;cache.last_observed=cache.last_observed.max(at);let observed=cache.last_observed;write(root,&cache)?;Ok(observed)}

#[tauri::command]
pub fn store_offline_authorization(app:tauri::AppHandle,account_id:String,company_id:String,environment:String,lease:String)->Result<LeaseMetadata,String>{
 let at=now();let (claims,writable)=verify(&lease,&account_id,&company_id,&environment,at)?;if !writable{return Err("OFFLINE_AUTHORIZATION_EXPIRED".into());}
 let root=app.path().app_data_dir().map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_UNAVAILABLE")?;let mut cache=read(&root)?;
 if at+CLOCK_SKEW_SECONDS<cache.last_observed{return Err("OFFLINE_AUTHORIZATION_CLOCK_ROLLBACK".into());}
 cache.last_observed=cache.last_observed.max(at);cache.entries.insert(key(&account_id,&company_id,&environment),Entry{token:lease,claims:claims.clone()});write(&root,&cache)?;Ok(metadata(&claims,"writable"))
}
#[tauri::command]
pub fn list_offline_authorizations(app:tauri::AppHandle,account_id:String,environment:String)->Result<Vec<LeaseMetadata>,String>{
 let root=app.path().app_data_dir().map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_UNAVAILABLE")?;let mut cache=read(&root)?;let at=now();let rollback=at+CLOCK_SKEW_SECONDS<cache.last_observed;let mut result=Vec::new();
 let effective=at.max(cache.last_observed);for entry in cache.entries.values().filter(|entry|entry.claims.sub==account_id&&entry.claims.env==environment){if let Ok((claims,writable))=verify(&entry.token,&account_id,&entry.claims.company_id,&environment,effective){result.push(metadata(&claims,if writable&&!rollback{"writable"}else{"read_only"}));}}
 cache.last_observed=cache.last_observed.max(at);write(&root,&cache)?;result.sort_by(|a,b|a.company_id.cmp(&b.company_id));Ok(result)
}
#[tauri::command]
pub fn clear_offline_authorizations(app:tauri::AppHandle,account_id:String,company_id:Option<String>)->Result<(),String>{let root=app.path().app_data_dir().map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_UNAVAILABLE")?;let mut cache=match read(&root){Ok(cache)=>cache,Err(_)=>{let path=cache_path(&root);if path.exists(){fs::remove_file(path).map_err(|_|"OFFLINE_AUTHORIZATION_CACHE_UNAVAILABLE")?;}return Ok(());}};cache.entries.retain(|_,entry|entry.claims.sub!=account_id||company_id.as_ref().is_some_and(|company|&entry.claims.company_id!=company));write(&root,&cache)}

#[cfg(test)]mod tests{
 use super::*;use jsonwebtoken::{encode,EncodingKey,Header};
 const PRIVATE:&str="-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgNsATbdpZGtfUxenC\ngYn9pqIx3hNVU01ToYYKppCSzL2hRANCAATKpmVxJN9kN9QkESmjpUQXYuTsdgxm\nq66Vs9dTlCUUvK8xosjK3WFpPIRPGgyEIEfCF3iecZC8bhCccCOIwf0B\n-----END PRIVATE KEY-----";
 const WRONG_PRIVATE:&str="-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgvX7pmBYrV5kg0nXt\nHvukSBDWsKBdq5rvscsC9aSOk3OhRANCAASxp4QW/69QDZntLhefq1E6kb34CR2g\nsqWeoSqOWBHe75JmEyNgU84bfojlIxQPgm+X4X35M73ymhsQHEnhZJaF\n-----END PRIVATE KEY-----";
 fn signed(claims:Claims,kid:&str,key:&str)->String{let mut h=Header::new(Algorithm::ES256);h.kid=Some(kid.into());encode(&h,&claims,&EncodingKey::from_ec_pem(key.as_bytes()).unwrap()).unwrap()}
 fn token(claims:Claims)->String{signed(claims,KEY_ID,PRIVATE)}
 fn claims()->Claims{Claims{v:1,env:"demo-hazcom-navigator".into(),company_id:"company-a".into(),role:"manager".into(),can_author:true,iss:"https://hazcom.navigator/offline-authorization/demo-hazcom-navigator".into(),aud:AUDIENCE.into(),sub:"account-a".into(),iat:1_800_000_000,exp:1_800_000_000+MAX_SECONDS,jti:"id".into()}}
 #[test]fn verifies_scope_signature_duration_expiry_and_clock(){let c=claims();let value=token(c.clone());assert!(verify(&value,"account-a","company-a",&c.env,c.iat+1).unwrap().1);assert!(!verify(&value,"account-a","company-a",&c.env,c.exp).unwrap().1);assert!(verify(&value,"account-b","company-a",&c.env,c.iat).is_err());assert!(verify(&value,"account-a","company-b",&c.env,c.iat).is_err());assert!(verify(&value,"account-a","company-a","wrong-environment",c.iat).is_err());let mut long=c.clone();long.exp+=1;assert!(verify(&token(long),"account-a","company-a",&c.env,c.iat).is_err());let mut member=c.clone();member.role="member".into();assert!(verify(&token(member),"account-a","company-a",&c.env,c.iat).is_err());let mut future=c.clone();future.iat+=1000;future.exp+=1000;assert!(verify(&token(future),"account-a","company-a",&c.env,c.iat).is_err());let mut malformed=c.clone();malformed.exp=malformed.iat;assert!(verify(&token(malformed),"account-a","company-a",&c.env,c.iat).is_err());let mut issuer=c.clone();issuer.iss="https://wrong.example".into();assert!(verify(&token(issuer),"account-a","company-a",&c.env,c.iat).is_err());let mut audience=c.clone();audience.aud="wrong-audience".into();assert!(verify(&token(audience),"account-a","company-a",&c.env,c.iat).is_err());assert!(verify(&signed(c.clone(),"unknown",PRIVATE),"account-a","company-a",&c.env,c.iat).is_err());assert!(verify(&signed(c.clone(),KEY_ID,WRONG_PRIVATE),"account-a","company-a",&c.env,c.iat).is_err());let mut bytes=value.into_bytes();let end=bytes.len()-2;bytes[end]=if bytes[end]==b'a'{b'b'}else{b'a'};assert!(verify(&String::from_utf8(bytes).unwrap(),"account-a","company-a",&c.env,c.iat).is_err());}
 #[test]fn cache_payload_contains_only_lease_claims_and_is_never_sqlite(){let cache=Cache{version:1,last_observed:1,entries:BTreeMap::from([(key("account-a","company-a","demo-hazcom-navigator"),Entry{token:"signed.jwt".into(),claims:claims()})])};let value=serde_json::to_string(&cache).unwrap();assert!(value.contains("signed.jwt"));assert!(!value.contains("password"));assert!(!cache_path(Path::new("root")).to_string_lossy().ends_with(".db"));}
 #[test]fn dpapi_cache_is_user_protected_corruption_fails_and_account_removal_is_scoped(){let root=std::env::temp_dir().join(format!("hazcom-lease-{:x}",rand::random::<u64>()));let at=now();let mut a=claims();a.iat=at-10;a.exp=at+600;let mut b=a.clone();b.sub="account-b".into();b.company_id="company-b".into();let cache=Cache{version:1,last_observed:a.iat,entries:BTreeMap::from([(key(&a.sub,&a.company_id,&a.env),Entry{token:token(a.clone()),claims:a}),(key(&b.sub,&b.company_id,&b.env),Entry{token:token(b.clone()),claims:b})])};write(&root,&cache).unwrap();let raw=fs::read(cache_path(&root)).unwrap();assert!(serde_json::from_slice::<serde_json::Value>(&raw).is_err());assert!(!grant(&root,"account-a","company-a","demo-hazcom-navigator").unwrap().read_only);assert!(grant(&root,"account-a","company-b","demo-hazcom-navigator").is_err());assert!(grant(&root,"account-b","company-a","demo-hazcom-navigator").is_err());let mut rollback=read(&root).unwrap();rollback.last_observed=at+1000;write(&root,&rollback).unwrap();assert!(grant(&root,"account-a","company-a","demo-hazcom-navigator").unwrap().read_only);assert_eq!(read(&root).unwrap().last_observed,at+1000);rollback.last_observed=at;write(&root,&rollback).unwrap();let mut loaded=read(&root).unwrap();loaded.entries.retain(|_,entry|entry.claims.sub!="account-a");write(&root,&loaded).unwrap();let loaded=read(&root).unwrap();assert_eq!(loaded.entries.len(),1);assert_eq!(loaded.entries.values().next().unwrap().claims.sub,"account-b");fs::write(cache_path(&root),b"corrupt").unwrap();assert!(read(&root).is_err());assert!(trust("production-project").is_err());fs::remove_dir_all(root).unwrap();}
}
