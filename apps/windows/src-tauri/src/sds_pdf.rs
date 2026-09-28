use crate::workspace::{checked, WorkspaceState};
use lopdf::Document;
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};

const MAX_SOURCE_BYTES:u64=250*1024*1024;
const MAX_CHILD_BYTES:usize=5*1024*1024;

#[derive(serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct ChildPdf { bytes:Vec<u8>, sha256:String, size_bytes:usize, page_count:usize, materialization_version:u32 }

fn safe_relative(value:&str)->bool{
 let path=Path::new(value);
 !value.is_empty()&&!value.contains(':')&&path.components().all(|part|matches!(part,std::path::Component::Normal(_)))
}

fn extract_pages(source:&[u8],start_page:u32,end_page:u32)->Result<ChildPdf,String>{
 if start_page==0||end_page<start_page{return Err("SDS_CHILD_PAGE_RANGE_INVALID".into());}
 let mut document=Document::load_mem(source).map_err(|_|"SDS_SOURCE_PDF_INVALID".to_string())?;
 let pages=document.get_pages();
 if pages.is_empty()||end_page as usize>pages.len(){return Err("SDS_CHILD_PAGE_RANGE_INVALID".into());}
 let remove=pages.keys().copied().filter(|page|*page<start_page||*page>end_page).collect::<Vec<_>>();
 document.delete_pages(&remove);document.prune_objects();document.renumber_objects();
 let mut bytes=Vec::new();document.save_to(&mut bytes).map_err(|_|"SDS_CHILD_PDF_WRITE_FAILED".to_string())?;
 if bytes.len()>MAX_CHILD_BYTES{return Err("SDS_CHILD_PDF_TOO_LARGE".into());}
 let verified=Document::load_mem(&bytes).map_err(|_|"SDS_CHILD_PDF_VERIFY_FAILED".to_string())?;
 let expected=(end_page-start_page+1) as usize;
 if verified.get_pages().len()!=expected{return Err("SDS_CHILD_PDF_PAGE_COUNT_MISMATCH".into());}
 let sha256=format!("{:x}",Sha256::digest(&bytes));
 Ok(ChildPdf{size_bytes:bytes.len(),bytes,sha256,page_count:expected,materialization_version:1})
}

#[tauri::command]
pub async fn workspace_materialize_sds_pdf(state:tauri::State<'_,WorkspaceState>,token:String,session_id:String,start_page:u32,end_page:u32)->Result<ChildPdf,String>{
 let source= {
  let guard=state.0.lock().await;let session=checked(&guard,&token)?;
  if session.lease.read_only{return Err("WORKSPACE_EXPORT_ONLY".into());}
  if !crate::workspace::valid_id(&session_id){return Err("SDS_IMPORT_SESSION_INVALID".into());}
  let path:String=sqlx::query_scalar("SELECT managed_source_path FROM sds_import_session WHERE id=? AND company_id=?")
   .bind(&session_id).bind(&session.lease.company_id).fetch_optional(&session.pool).await.map_err(|e|e.to_string())?.ok_or("SDS_IMPORT_SESSION_NOT_FOUND")?;
  if !safe_relative(&path){return Err("WORKSPACE_FILE_PATH_INVALID".into());}
  let root=session.files.canonicalize().map_err(|e|e.to_string())?;
  let file=session.files.join(path).canonicalize().map_err(|e|e.to_string())?;
  if !file.starts_with(&root){return Err("WORKSPACE_PATH_ESCAPE".into());}
  let mut bytes=Vec::new();fs::File::open(file).map_err(|e|e.to_string())?.take(MAX_SOURCE_BYTES+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
  if bytes.len() as u64>MAX_SOURCE_BYTES{return Err("SDS_SOURCE_PDF_TOO_LARGE".into());}bytes
 };
 tokio::task::spawn_blocking(move||extract_pages(&source,start_page,end_page)).await.map_err(|_|"SDS_CHILD_PDF_TASK_FAILED".to_string())?
}

#[cfg(test)]
mod tests{
 use super::*;use lopdf::{dictionary,content::{Content,Operation},Object,Stream};
 fn fixture(pages:u32)->Vec<u8>{
  let mut doc=Document::with_version("1.5");let pages_id=doc.new_object_id();let resources_id=doc.add_object(dictionary!{});let mut kids=Vec::new();
  for page in 1..=pages {let content=Content{operations:vec![Operation::new("BT",vec![]),Operation::new("Tj",vec![Object::string_literal(format!("page-{page}"))]),Operation::new("ET",vec![])]};let content_id=doc.add_object(Stream::new(dictionary!{},content.encode().unwrap()));let page_id=doc.add_object(dictionary!{"Type"=>"Page","Parent"=>pages_id,"Contents"=>content_id});kids.push(page_id.into());}
  doc.objects.insert(pages_id,Object::Dictionary(dictionary!{"Type"=>"Pages","Kids"=>kids,"Count"=>pages as i64,"Resources"=>resources_id,"MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()]}));let catalog=doc.add_object(dictionary!{"Type"=>"Catalog","Pages"=>pages_id});doc.trailer.set("Root",catalog);let mut bytes=Vec::new();doc.save_to(&mut bytes).unwrap();bytes
 }
 #[test]fn child_pdf_copies_only_requested_pages_and_is_deterministic(){let source=fixture(4);let first=extract_pages(&source,2,3).unwrap();let second=extract_pages(&source,2,3).unwrap();assert_eq!(first.bytes,second.bytes);assert_eq!(first.page_count,2);assert_eq!(first.size_bytes,first.bytes.len());assert_eq!(first.sha256,format!("{:x}",Sha256::digest(&first.bytes)));assert_eq!(Document::load_mem(&first.bytes).unwrap().get_pages().len(),2);}
 #[test]fn child_pdf_rejects_invalid_ranges_and_inputs(){let source=fixture(2);assert!(extract_pages(&source,0,1).is_err());assert!(extract_pages(&source,2,1).is_err());assert!(extract_pages(&source,1,3).is_err());assert!(extract_pages(b"not pdf",1,1).is_err());}
}
