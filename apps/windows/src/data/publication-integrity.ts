export async function verifyWindowsSdsIntegrity(
 attachments:Array<{attachmentId:string;ownerId:string;sha256:string}>,
 select:(sql:string,values:unknown[])=>Promise<Array<{sha256:string}>>
){
 for(const attachment of attachments){
  const rows=await select('SELECT sha256 FROM authoring_sds_integrity WHERE attachment_id=$1',[attachment.attachmentId]);
  if(rows[0]?.sha256!==attachment.sha256)throw Error(`SDS hash mismatch: ${attachment.attachmentId} for Chemical Product ${attachment.ownerId}. Reattach the file.`);
 }
}
