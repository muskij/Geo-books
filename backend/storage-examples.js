import fs from "fs"; 
import path from "path"; 
import { uploadToR2 } from "./r2-storage.js"; 
 
/** 
 * USE CASE 1: Batch File Migrations from Local FileSystem 
 */ 
export async function migrateLocalFile(localFilePath, bucketFolder = "archive") { 
  try { 
    const fileBuffer = fs.readFileSync(localFilePath); 
    const fileName = path.basename(localFilePath); 
    const destinationKey = `${bucketFolder}/${fileName}`; 
     
    // Fallback MIME inference for standard assets 
    const mimeType = fileName.endsWith(".pdf") ? "application/pdf" : "image/jpeg"; 
 
    const publicUrl = await uploadToR2(fileBuffer, destinationKey, mimeType); 
    console.log(`[Migration Success] Local asset moved over. URL: ${publicUrl}`); 
    return publicUrl; 
  } catch (err) { 
    console.error("[Migration Failure] Processing failed:", err.message); 
  } 
} 
 
/** 
 * USE CASE 2: User Upload Handling via Middleware (e.g., Multer MemoryStorage) 
 */ 
export async function handleUserMultipartUpload(expressMulterFile) { 
  // expressMulterFile contains: buffer, originalname, mimetype 
  const timestamp = Date.now(); 
  const sanitizedName = expressMulterFile.originalname.replace(/\s+/g, "_"); 
  const destinationKey = `books/covers/${timestamp}_${sanitizedName}`; 
 
  const publicUrl = await uploadToR2( 
    expressMulterFile.buffer, 
    destinationKey, 
    expressMulterFile.mimetype 
  ); 
   
  return publicUrl; // Ready to pass to your database layer 
} 
 
/** 
 * USE CASE 3: Direct System Payload / JSON Content State Backups 
 */ 
export async function backupSystemPayload(jsonObject, referenceId) { 
  const payloadString = JSON.stringify(jsonObject, null, 2); 
  const fileBuffer = Buffer.from(payloadString, "utf-8"); 
  const destinationKey = `system/backups/state_${referenceId}.json`; 
 
  const publicUrl = await uploadToR2(fileBuffer, destinationKey, "application/json"); 
  console.log(`[Backup Success] System payload state preserved. URL: ${publicUrl}`); 
  return publicUrl; 
}
