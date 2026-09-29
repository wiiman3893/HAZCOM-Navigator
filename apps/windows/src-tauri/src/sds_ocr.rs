use crate::workspace::{checked, valid_id, WorkspaceState};
use serde::Serialize;
use std::path::{Path,PathBuf};
use windows::{core::HSTRING,Data::Pdf::{PdfDocument,PdfPageRenderOptions},Graphics::Imaging::BitmapDecoder,Media::Ocr::OcrEngine,Storage::{StorageFile,Streams::InMemoryRandomAccessStream}};

pub const OCR_VERSION:u32=1;

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct OcrAvailability{status:&'static str,language:Option<String>,ocr_version:u32}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct OcrPageResult{raw_text:String,language:String,ocr_version:u32}

fn availability()->OcrAvailability{
 let languages=match OcrEngine::AvailableRecognizerLanguages(){Ok(value)=>value,Err(_)=>return OcrAvailability{status:"platform_unavailable",language:None,ocr_version:OCR_VERSION}};
 if languages.Size().unwrap_or(0)==0{return OcrAvailability{status:"language_support_missing",language:None,ocr_version:OCR_VERSION};}
 match OcrEngine::TryCreateFromUserProfileLanguages(){
  Ok(engine)=>OcrAvailability{status:"available",language:engine.RecognizerLanguage().ok().and_then(|value|value.LanguageTag().ok()).map(|value|value.to_string()),ocr_version:OCR_VERSION},
  Err(_)=>OcrAvailability{status:"engine_creation_failed",language:None,ocr_version:OCR_VERSION}
 }
}

async fn source_path(state:&WorkspaceState,token:&str,session_id:&str)->Result<PathBuf,String>{
 let guard=state.0.lock().await;let session=checked(&guard,token)?;
 if session.lease.read_only{return Err("WORKSPACE_EXPORT_ONLY".into());}
 if !valid_id(session_id){return Err("SDS_IMPORT_SESSION_INVALID".into());}
 let relative:String=sqlx::query_scalar("SELECT managed_source_path FROM sds_import_session WHERE id=? AND company_id=?")
  .bind(session_id).bind(&session.lease.company_id).fetch_optional(&session.pool).await.map_err(|_|"OCR_SOURCE_LOOKUP_FAILED".to_string())?.ok_or("SDS_IMPORT_SESSION_NOT_FOUND")?;
 let relative_path=Path::new(&relative);if relative.is_empty()||relative.contains(':')||relative_path.components().any(|part|!matches!(part,std::path::Component::Normal(_))){return Err("WORKSPACE_FILE_PATH_INVALID".into());}
 let root=session.files.canonicalize().map_err(|_|"OCR_SOURCE_UNAVAILABLE".to_string())?;let path=session.files.join(relative_path).canonicalize().map_err(|_|"OCR_SOURCE_UNAVAILABLE".to_string())?;
 if !path.starts_with(root){return Err("WORKSPACE_PATH_ESCAPE".into());}Ok(path)
}

fn engine()->Result<OcrEngine,String>{
 match availability().status{
  "language_support_missing"=>Err("OCR_LANGUAGE_SUPPORT_MISSING".into()),
  "platform_unavailable"=>Err("OCR_PLATFORM_UNAVAILABLE".into()),
  "engine_creation_failed"=>Err("OCR_ENGINE_CREATION_FAILED".into()),
  _=>OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_|"OCR_ENGINE_CREATION_FAILED".into())
 }
}

fn recognize(path:PathBuf,page_number:u32)->Result<OcrPageResult,String>{
 if page_number==0{return Err("OCR_PAGE_RANGE_INVALID".into());}
 let engine=engine()?;let language=engine.RecognizerLanguage().ok().and_then(|value|value.LanguageTag().ok()).map(|value|value.to_string()).unwrap_or_else(||"und".into());
 let file=StorageFile::GetFileFromPathAsync(&HSTRING::from(path.to_string_lossy().as_ref())).map_err(|_|"OCR_SOURCE_UNAVAILABLE".to_string())?.get().map_err(|_|"OCR_SOURCE_UNAVAILABLE".to_string())?;
 let document=PdfDocument::LoadFromFileAsync(&file).map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?.get().map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?;
 if page_number>document.PageCount().map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?{return Err("OCR_PAGE_RANGE_INVALID".into());}
 let page=document.GetPage(page_number-1).map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?;let size=page.Size().map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?;
 let max=OcrEngine::MaxImageDimension().map_err(|_|"OCR_PLATFORM_UNAVAILABLE".to_string())?.min(2400);let longest=size.Width.max(size.Height);if !longest.is_finite()||longest<=0.0{return Err("OCR_PDF_RENDER_FAILED".into());}
 let scale=max as f32/longest;let options=PdfPageRenderOptions::new().map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?;options.SetDestinationWidth((size.Width*scale).round().max(1.0) as u32).map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?;options.SetDestinationHeight((size.Height*scale).round().max(1.0) as u32).map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?;
 let stream=InMemoryRandomAccessStream::new().map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?;page.RenderWithOptionsToStreamAsync(&stream,&options).map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?.get().map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?;page.Close().ok();stream.Seek(0).map_err(|_|"OCR_PDF_RENDER_FAILED".to_string())?;
 let decoder=BitmapDecoder::CreateAsync(&stream).map_err(|_|"OCR_BITMAP_DECODE_FAILED".to_string())?.get().map_err(|_|"OCR_BITMAP_DECODE_FAILED".to_string())?;let bitmap=decoder.GetSoftwareBitmapAsync().map_err(|_|"OCR_BITMAP_DECODE_FAILED".to_string())?.get().map_err(|_|"OCR_BITMAP_DECODE_FAILED".to_string())?;
 let result=engine.RecognizeAsync(&bitmap).map_err(|_|"OCR_PAGE_FAILED".to_string())?.get().map_err(|_|"OCR_PAGE_FAILED".to_string())?;let text=result.Text().map_err(|_|"OCR_PAGE_FAILED".to_string())?.to_string();
 if text.len()>256*1024{return Err("OCR_TEXT_LIMIT".into());}Ok(OcrPageResult{raw_text:text,language,ocr_version:OCR_VERSION})
}

#[tauri::command]
pub fn windows_ocr_availability()->OcrAvailability{availability()}

#[tauri::command]
pub async fn workspace_ocr_sds_page(state:tauri::State<'_,WorkspaceState>,token:String,session_id:String,page_number:u32)->Result<OcrPageResult,String>{let path=source_path(&state,&token,&session_id).await?;tokio::task::spawn_blocking(move||recognize(path,page_number)).await.map_err(|_|"OCR_TASK_FAILED".to_string())?}

#[cfg(test)]
mod tests{
 use super::*;
 use font8x8::{BASIC_FONTS,UnicodeFonts};
 use lopdf::{dictionary,Document,Object,Stream};
 use std::{fs,time::{SystemTime,UNIX_EPOCH}};

 fn image_only_fixture()->PathBuf{
  const WIDTH:usize=1600;const HEIGHT:usize=1100;const SCALE:usize=6;
  let mut pixels=vec![255u8;WIDTH*HEIGHT];
  let lines=["SAFETY DATA SHEET","SECTION 1 IDENTIFICATION","PRODUCT NAME SYNTHETIC CLEANER","MANUFACTURER EXAMPLE SAFETY PRODUCTS","SECTION 3 COMPOSITION","ACETONE 67-64-1","SECTION 16 OTHER INFORMATION","REVISION DATE 2026-09-28"];
  for (line_index,line) in lines.iter().enumerate(){let y=70+line_index*120;for (character_index,character) in line.chars().enumerate(){if let Some(glyph)=BASIC_FONTS.get(character){for (row,bits) in glyph.iter().enumerate(){for column in 0..8{if bits&(1<<column)!=0{for dy in 0..SCALE{for dx in 0..SCALE{let px=70+character_index*8*SCALE+column*SCALE+dx;let py=y+row*SCALE+dy;if px<WIDTH&&py<HEIGHT{pixels[py*WIDTH+px]=0;}}}}}}}}}
  let mut document=Document::with_version("1.5");let pages_id=document.new_object_id();
  let image_id=document.add_object(Stream::new(dictionary!{"Type"=>"XObject","Subtype"=>"Image","Width"=>WIDTH as i64,"Height"=>HEIGHT as i64,"ColorSpace"=>"DeviceGray","BitsPerComponent"=>8},pixels));
  let resources_id=document.add_object(dictionary!{"XObject"=>dictionary!{"Im1"=>Object::Reference(image_id)}});
  let content=Stream::new(dictionary!{},format!("q {WIDTH} 0 0 {HEIGHT} 0 0 cm /Im1 Do Q").into_bytes());let content_id=document.add_object(content);
  let page_id=document.add_object(dictionary!{"Type"=>"Page","Parent"=>pages_id,"Resources"=>resources_id,"MediaBox"=>vec![0.into(),0.into(),(WIDTH as i64).into(),(HEIGHT as i64).into()],"Contents"=>content_id});
  document.objects.insert(pages_id,Object::Dictionary(dictionary!{"Type"=>"Pages","Kids"=>vec![Object::Reference(page_id)],"Count"=>1}));let catalog=document.add_object(dictionary!{"Type"=>"Catalog","Pages"=>pages_id});document.trailer.set("Root",catalog);
  let name=format!("hazcom-ocr-{}-{}.pdf",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos());let path=std::env::temp_dir().join(name);document.save(&path).unwrap();path
 }

 #[test]
 fn availability_is_categorized_without_exposing_platform_errors(){let value=availability();println!("Windows OCR availability: {} {:?}",value.status,value.language);assert!(["available","language_support_missing","platform_unavailable","engine_creation_failed"].contains(&value.status));assert_eq!(value.ocr_version,1);}

 #[test]
 fn native_ocr_reads_a_synthetic_image_only_pdf_when_available(){
  let state=availability();if state.status!="available"{println!("Native OCR fixture skipped because availability is {}",state.status);return;}
  let path=image_only_fixture();let result=recognize(path.clone(),1);fs::remove_file(path).ok();let text=result.unwrap().raw_text.to_uppercase();println!("Synthetic image-only OCR: {text}");assert!(text.contains("SYNTHETIC"));assert!(text.contains("CLEANER"));assert!(text.contains("67-64-1")||text.contains("67 64 1"));
 }
}
