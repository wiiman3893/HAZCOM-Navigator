use std::{fs, io::Read, path::Path};
#[cfg(test)]
fn store_pdf(root: &Path, company: &str, id: &str, bytes: &[u8]) -> Result<String,String> {
    store_pdf_with_limit(root, company, id, bytes, 5 * 1024 * 1024)
}
pub(crate) fn store_pdf_with_limit(root: &Path, company: &str, id: &str, bytes: &[u8], max_bytes: usize) -> Result<String,String> {
    use std::io::Write;
    for part in [company,id] { if part.is_empty() || part.len()>128 || !part.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_') {return Err("Invalid managed SDS identity".into());} }
    if bytes.len()>max_bytes || !bytes.starts_with(b"%PDF-") {return Err("Invalid SDS PDF or size".into());}
    fs::create_dir_all(root).map_err(|e|e.to_string())?;
    let root=root.canonicalize().map_err(|e|e.to_string())?;
    let folder=root.join(company);fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
    let folder=folder.canonicalize().map_err(|e|e.to_string())?;
    if !folder.starts_with(&root){return Err("Managed SDS directory escapes workspace".into());}
    let target=folder.join(format!("{id}.pdf"));
    match fs::OpenOptions::new().create_new(true).write(true).open(&target){
        Ok(mut file)=>{if let Err(e)=file.write_all(bytes).and_then(|_|file.sync_all()){let _=fs::remove_file(&target);return Err(e.to_string());}},
        Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>{
            let canonical=target.canonicalize().map_err(|e|e.to_string())?;
            if !canonical.starts_with(&root){return Err("Managed SDS file escapes workspace".into());}
            let mut old=Vec::new();fs::File::open(canonical).map_err(|e|e.to_string())?.take(max_bytes as u64+1).read_to_end(&mut old).map_err(|e|e.to_string())?;
            if old!=bytes{return Err("Managed SDS ID contains different bytes; choose a new ID".into());}
        },Err(e)=>return Err(e.to_string())
    }
    Ok(format!("{company}/{id}.pdf"))
}
#[cfg(test)]
mod authoring_file_tests {
    use super::*;
    #[test]
    fn managed_pdf_bounds_paths_and_retry(){
        let root=std::env::temp_dir().join(format!("hazcom-authoring-{}",rand::random::<u64>()));
        assert!(store_pdf(&root,"../escape","id",b"%PDF-test").is_err());
        assert!(store_pdf(&root,"company","id",b"not PDF").is_err());
        assert_eq!(store_pdf(&root,"company","id",b"%PDF-test").unwrap(),"company/id.pdf");
        assert!(store_pdf(&root,"company","id",b"%PDF-test").is_ok());
        assert!(store_pdf(&root,"company","id",b"%PDF-changed").is_err());
        assert_eq!(fs::read(root.join("company/id.pdf")).unwrap(),b"%PDF-test");
        fs::remove_dir_all(root).unwrap();
    }
}
